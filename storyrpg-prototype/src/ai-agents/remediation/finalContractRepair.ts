// ========================================
// FINAL-CONTRACT REPAIR LOOP (Wave 4 keystone)
// ========================================
//
// `enforceFinalStoryContract` historically THREW the moment the contract failed —
// no repair attempt. That is the documented hard-abort landmine: a single escalated
// finding (witness-id, design-note, a treatment-fidelity drift, a structural nick)
// aborts an entire multi-episode generation with no chance to self-heal.
//
// This module is the missing loop: given the failing report, it runs a list of
// repair handlers (deterministic first; LLM-backed regen handlers can be injected
// later), RE-VALIDATES after each round, and stops at a fixpoint — the story passes,
// the budget is exhausted, or no handler changed anything. The caller decides what to
// do with a still-failing result (throw, or degrade). Pure w.r.t. wall-clock/random;
// timestamps are stamped by the caller.
//
// GATED: the pipeline only invokes this when `GATE_FINAL_CONTRACT_REPAIR` is on, so
// with the flag off behavior is byte-identical to today (immediate throw).

import type { Story } from '../../types/story';
import type { RemediationLedgerRecord } from './remediationLedger';
import { StructuralValidator } from '../validators/StructuralValidator';
import { canonicalizeStoryWitnessReactions } from '../utils/witnessNpcResolver';
import { buildDesignNoteLeakStripHandler } from './designNoteLeakHandler';

/** Minimal shape this loop needs from a contract report (FinalStoryContractReport-compatible). */
export interface ContractRepairReport {
  passed: boolean;
  blockingIssues: Array<{
    message?: string;
    category?: string;
    severity?: string;
    /** Issue class (e.g. 'treatment_fidelity_violation') — lets handlers route by type. */
    type?: string;
    /** Emitting validator (e.g. 'RequiredBeatRealizationValidator'). */
    validator?: string;
    /** The validator's repair suggestion — fed to LLM repair handlers as guidance. */
    suggestion?: string;
    /** Scene the finding points at — the unit of surgical repair. */
    sceneId?: string;
    episodeNumber?: number;
  }>;
}

/**
 * A repair handler inspects the current story + the still-blocking issues and
 * optionally returns a changed story. `changed: false` means "I had nothing to do"
 * — when every handler reports that, the loop has reached a fixpoint and stops.
 */
export type ContractRepairHandler = (ctx: {
  story: Story;
  blockingIssues: ContractRepairReport['blockingIssues'];
}) => Promise<ContractRepairResult> | ContractRepairResult;

export interface ContractRepairResult {
  story: Story;
  changed: boolean;
  /** Optional ledger record describing what the handler did (timestamp added by caller). */
  record?: Omit<RemediationLedgerRecord, 'timestamp'>;
}

export interface FinalContractRepairOutcome {
  story: Story;
  report: ContractRepairReport;
  /** True when the contract passes after repair. */
  passed: boolean;
  /** How many repair rounds ran. */
  attempts: number;
  /** Ledger records from every handler that changed something. */
  records: Array<Omit<RemediationLedgerRecord, 'timestamp'>>;
}

/**
 * Run the repair loop. Stops when the report passes, `maxAttempts` is hit, the
 * `budget` predicate denies another round, or a full round changes nothing.
 *
 * @param revalidate  Re-runs the full contract over a (possibly repaired) story.
 *                    Must be side-effect-free w.r.t. the returned story.
 */
export async function runFinalContractRepair(opts: {
  story: Story;
  initialReport: ContractRepairReport;
  handlers: ContractRepairHandler[];
  revalidate: (story: Story) => Promise<ContractRepairReport>;
  maxAttempts?: number;
  /** Optional guard: return false to stop spending the remediation budget. */
  canSpend?: () => boolean;
}): Promise<FinalContractRepairOutcome> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let story = opts.story;
  let report = opts.initialReport;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];
  let attempts = 0;

  while (!report.passed && attempts < maxAttempts) {
    if (opts.canSpend && !opts.canSpend()) break;
    attempts += 1;

    let roundChanged = false;
    for (const handler of opts.handlers) {
      const result = await handler({ story, blockingIssues: report.blockingIssues });
      if (result.changed) {
        roundChanged = true;
        story = result.story;
        if (result.record) records.push(result.record);
      }
    }

    if (!roundChanged) break; // fixpoint: nothing left any handler can fix
    report = await opts.revalidate(story);
  }

  return { story, report, passed: report.passed, attempts, records };
}

/**
 * The deterministic (no-LLM) repair handlers, run before the contract aborts:
 *   1. Structural integrity (broken nav, empty beats, beat-id collisions, dead
 *      ends) — StructuralValidator.autoFix returns a NEW story, so we Object.assign
 *      its fields back onto the caller's reference to keep downstream refs valid.
 *   2. Witness-id canonicalization — idempotent safety net mapping raw NPC labels
 *      to canonical ids (drops genuinely-unknown ones).
 *
 * These already run earlier in the pipeline, so here they are a safety net; the
 * real abort-reduction comes from injecting LLM-backed regen handlers (template
 * prose, design-note leaks, treatment drift) into the loop alongside these.
 */
export function buildDeterministicContractHandlers(): ContractRepairHandler[] {
  return [
    ({ story }) => {
      const { story: fixed, fixedCount } = new StructuralValidator().autoFix(story);
      if (fixedCount <= 0) return { story, changed: false };
      Object.assign(story as object, fixed); // propagate onto the caller's ref
      return {
        story,
        changed: true,
        record: { rule: 'final_contract_structural', scope: 'autofix', attempted: fixedCount, succeeded: true, degraded: false, blocked: false, attempts: 1 },
      };
    },
    ({ story }) => {
      const r = canonicalizeStoryWitnessReactions(story);
      const touched = r.remapped + r.dropped;
      if (touched <= 0) return { story, changed: false };
      return {
        story,
        changed: true,
        record: { rule: 'final_contract_witness', scope: 'autofix', attempted: touched, succeeded: true, degraded: r.dropped > 0, blocked: false, attempts: 1 },
      };
    },
    // Design-note leak (echo_summary_variant): strip beat textVariants that are a
    // verbatim feedback-cue/reminder one-liner, so a meta-narration leak repairs
    // instead of hard-aborting (the GATE_DESIGN_NOTE_LEAK planned fix).
    buildDesignNoteLeakStripHandler(),
  ];
}
