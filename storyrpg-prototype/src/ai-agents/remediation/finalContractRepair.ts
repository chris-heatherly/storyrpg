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
import { buildPlanningRegisterMetadataRepairHandler } from './planningRegisterMetadataRepairHandler';
import { buildPlayerFacingProseRepairHandler } from './playerFacingProseRepairHandler';
import { buildRelationshipPacingLabelRepairHandler } from './relationshipPacingLabelRepairHandler';
import { buildTransitionBridgeRepairHandler } from './transitionBridgeRepairHandler';
import { buildTenseDriftRepairHandler } from './tenseDriftRepairHandler';

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
    /** Beat the finding points at when the validator can localize it. */
    beatId?: string;
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
  /** Unique issue fingerprints skipped because their per-issue repair budget was spent. */
  exhaustedIssueKeys: string[];
  exhaustedIssueCount: number;
  /** Ledger records from every handler that changed something. */
  records: Array<Omit<RemediationLedgerRecord, 'timestamp'>>;
}

type ContractRepairIssue = ContractRepairReport['blockingIssues'][number];
type MutableRecord = Record<string, unknown>;

function extractQuotedMoment(value: string): string | undefined {
  const match = /"([^"]{16,})"/.exec(value);
  return match?.[1];
}

function compactFingerprintText(value: string | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function contractRepairIssueFingerprint(issue: ContractRepairIssue): string {
  const message = issue.message ?? '';
  const moment = extractQuotedMoment(message) ?? message;
  return [
    issue.validator ?? '',
    issue.type ?? '',
    issue.category ?? '',
    issue.severity ?? '',
    issue.episodeNumber ?? '',
    issue.sceneId ?? '',
    issue.beatId ?? '',
    compactFingerprintText(moment),
  ].join('::');
}

function selectRepairableIssuesForRound(
  issues: ContractRepairIssue[],
  issueAttempts: Map<string, number>,
  maxAttemptsPerIssue: number | undefined,
  dedupeIssueFingerprints: boolean
): { issues: ContractRepairIssue[]; keys: string[]; exhaustedKeys: string[] } {
  const selected: ContractRepairIssue[] = [];
  const selectedKeys = new Set<string>();
  const exhaustedKeys = new Set<string>();

  for (const issue of issues) {
    const key = contractRepairIssueFingerprint(issue);
    if (maxAttemptsPerIssue !== undefined && (issueAttempts.get(key) ?? 0) >= maxAttemptsPerIssue) {
      exhaustedKeys.add(key);
      continue;
    }
    if (dedupeIssueFingerprints && selectedKeys.has(key)) continue;
    selected.push(issue);
    selectedKeys.add(key);
  }

  return {
    issues: selected,
    keys: Array.from(selectedKeys),
    exhaustedKeys: Array.from(exhaustedKeys),
  };
}

function sanitizeDramaticIntentText(value: string): string {
  return value
    .replace(/\bthe protagonist wants to shift the moment without saying everything directly\b/gi, 'press for a visible change while keeping the deeper motive guarded')
    .replace(/\bthe protagonist enters without full control of the room\b/gi, 'the room has not yielded control yet')
    .replace(/\bthe protagonist's\b/gi, "the focal character's")
    .replace(/\bthe protagonist\b/gi, 'the focal character');
}

function sanitizeDramaticIntentObject(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let changed = 0;
  const record = value as MutableRecord;

  if (record.characterObjectives && typeof record.characterObjectives === 'object' && !Array.isArray(record.characterObjectives)) {
    const objectives = record.characterObjectives as MutableRecord;
    if (typeof objectives['the protagonist'] === 'string') {
      const sanitized = sanitizeDramaticIntentText(objectives['the protagonist']);
      if (objectives['the focal character'] === undefined) objectives['the focal character'] = sanitized;
      delete objectives['the protagonist'];
      changed += 1;
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string') {
      const sanitized = sanitizeDramaticIntentText(child);
      if (sanitized !== child) {
        record[key] = sanitized;
        changed += 1;
      }
    } else if (child && typeof child === 'object') {
      changed += sanitizeDramaticIntentObject(child);
    }
  }
  return changed;
}

function buildDramaticIntentMetadataHygieneHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const relevant = blockingIssues.some((issue) =>
      issue.validator === 'RouteContinuityValidator'
      || issue.type === 'unsafe_fallback_prose'
      || /\bdramaticIntent\b|\bthe protagonist\b|\bwithout full control of the room\b|\bwithout saying everything directly\b/i.test(issue.message || '')
    );
    if (!relevant) return { story, changed: false };

    let rewritten = 0;
    for (const episode of (story as Story).episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        for (const beat of scene.beats ?? []) {
          rewritten += sanitizeDramaticIntentObject((beat as unknown as MutableRecord).dramaticIntent);
        }
      }
    }

    if (rewritten <= 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_dramatic_intent_metadata_hygiene',
        scope: 'season',
        attempted: rewritten,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Sanitized ${rewritten} dramaticIntent metadata field(s)`,
      },
    };
  };
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
  /**
   * Optional per-finding budget. When set, the loop stops re-sending the same
   * validator fingerprint to handlers after this many changed repair rounds.
   * Leaving it unset preserves the historical global-attempts-only behavior.
   */
  maxAttemptsPerIssue?: number;
  /** Collapse duplicate issue fingerprints within a single repair round. */
  dedupeIssueFingerprints?: boolean;
  /** Optional guard: return false to stop spending the remediation budget. */
  canSpend?: () => boolean;
}): Promise<FinalContractRepairOutcome> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let story = opts.story;
  let report = opts.initialReport;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];
  const issueAttempts = new Map<string, number>();
  const exhaustedIssueKeys = new Set<string>();
  let attempts = 0;

  while (!report.passed && attempts < maxAttempts) {
    if (opts.canSpend && !opts.canSpend()) break;
    const round = selectRepairableIssuesForRound(
      report.blockingIssues,
      issueAttempts,
      opts.maxAttemptsPerIssue,
      opts.dedupeIssueFingerprints ?? false
    );
    for (const key of round.exhaustedKeys) exhaustedIssueKeys.add(key);
    if (round.issues.length === 0) break;

    attempts += 1;

    let roundChanged = false;
    for (const handler of opts.handlers) {
      const result = await handler({ story, blockingIssues: round.issues });
      if (result.changed) {
        roundChanged = true;
        story = result.story;
        if (result.record) records.push(result.record);
      }
    }

    if (!roundChanged) break; // fixpoint: nothing left any handler can fix
    for (const key of round.keys) {
      issueAttempts.set(key, (issueAttempts.get(key) ?? 0) + 1);
    }
    report = await opts.revalidate(story);
  }

  return {
    story,
    report,
    passed: report.passed,
    attempts,
    exhaustedIssueKeys: Array.from(exhaustedIssueKeys),
    exhaustedIssueCount: exhaustedIssueKeys.size,
    records,
  };
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
    // Reader-facing "the player" references are fiction-first leaks even when the
    // surrounding sentence is otherwise diegetic ("the player opposite you").
    // Rewrite the visible prose in-place instead of weakening the leakage gate.
    buildPlayerFacingProseRepairHandler(),
    buildDramaticIntentMetadataHygieneHandler(),
    // Planning-register leak in metadata fields: strip authoring directives from
    // beat/scene metadata that image planning and the reader may consume, without
    // changing story text, choices, encounters, or navigation.
    buildPlanningRegisterMetadataRepairHandler(),
    // Relationship-pacing residue: downgrade unearned high-stage labels in visible
    // prose/choice text for scenes the RelationshipPacingValidator already flagged.
    // This preserves the gate and the relationship turn while avoiding repeated
    // SceneCritic rewrites that leave the same label residue behind.
    buildRelationshipPacingLabelRepairHandler(),
    // Prose-style tense drift introduced by late rewrites: when the validator
    // names one exact beat, convert common live-action past-tense constructions
    // back into present tense before spending another SceneCritic pass.
    buildTenseDriftRepairHandler(),
    // Transition continuity bridge miss: when the validator names the exact
    // choice-bridge beat and planned location jump, add a short in-fiction
    // travel/arrival sentence to that bridge beat before spending LLM repair.
    buildTransitionBridgeRepairHandler(),
  ];
}
