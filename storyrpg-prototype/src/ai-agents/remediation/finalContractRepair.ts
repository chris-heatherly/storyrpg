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
import type {
  ValidationOwnerStage,
  ValidationRetryClass,
} from '../../types/validationOwnership';
import type { RemediationLedgerRecord } from './remediationLedger';
import { StructuralValidator } from '../validators/StructuralValidator';
import { canonicalizeStoryWitnessReactions } from '../utils/witnessNpcResolver';
import { buildDesignNoteLeakStripHandler } from './designNoteLeakHandler';
import { buildPlanningRegisterMetadataRepairHandler } from './planningRegisterMetadataRepairHandler';
import { buildPlayerFacingProseRepairHandler } from './playerFacingProseRepairHandler';
import { buildRelationshipPacingLabelRepairHandler } from './relationshipPacingLabelRepairHandler';
import { buildRelationshipDeltaCapRepairHandler } from './relationshipDeltaCapRepairHandler';
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
    /** Exact object path inspected by the validator (for field-owned repair). */
    fieldPath?: string;
    episodeNumber?: number;
    taskId?: string;
    contractId?: string;
    eventId?: string;
    outcomeTier?: string;
    artifactPath?: string;
    repairHandler?: string;
    issueCode?: string;
    ownerStage?: ValidationOwnerStage;
    retryClass?: ValidationRetryClass;
    missingEvidenceAtoms?: string[];
    requiredEvidenceAtoms?: string[];
    realizationFingerprint?: string;
    matchedForbiddenAtoms?: string[];
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
  /**
   * Fingerprints (see {@link contractRepairIssueFingerprint}) of the issues this
   * handler ACTUALLY worked on this round. Handlers that cap per-round work
   * (scene-prose: 4 scenes, cluster: 2 centers) must report these so the loop
   * charges the per-issue budget only for attempted issues — charging on
   * selection starved un-attempted issues out of their repair attempts entirely
   * (the g23 74-blocker season-final abort). Omitted ⇒ legacy behavior (every
   * selected issue is charged when the round changed anything).
   */
  attemptedIssueKeys?: string[];
  /** Exact story paths the handler owns and changed, when known. */
  changedFieldPaths?: string[];
  /**
   * Independently validatable mutation units. When a batched handler changes
   * several scenes, the repair loop can commit safe siblings even if one scene
   * introduces a blocker. Omitting this preserves whole-handler transactions.
   */
  atomicScopes?: Array<{
    kind: 'scene';
    sceneId: string;
    episodeNumber?: number;
  }>;
}

export const FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION = 1;
export const FINAL_CONTRACT_VALIDATOR_VERSION = '2026-07-09';

export interface ContractRepairRoundSnapshot {
  schemaVersion: typeof FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION;
  validatorVersion: typeof FINAL_CONTRACT_VALIDATOR_VERSION;
  round: number;
  inputHash: string;
  beforeIssueKeys: string[];
  afterIssueKeys: string[];
  attemptedIssueKeys: string[];
  changedFieldPaths: string[];
  handlerAttempts: Array<{
    handler: string;
    attemptedIssueKeys: string[];
    changedFieldPaths: string[];
    claimedChanged: boolean;
  }>;
  clearedIssueKeys: string[];
  introducedIssueKeys: string[];
  revalidationDelta: {
    beforeBlocking: number;
    afterBlocking: number;
    cleared: number;
    introduced: number;
  };
  passed: boolean;
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

function stableIssueMessage(issue: ContractRepairIssue): string {
  // Once a validator supplies a canonical target, quoted prose and model
  // wording are evidence, not identity. Keeping them in the fingerprint made
  // the same unresolved contract look new after every LLM rewrite.
  const hasCanonicalTarget = Boolean(
    issue.taskId || issue.contractId || issue.eventId || issue.fieldPath || issue.sceneId || issue.beatId,
  );
  if (hasCanonicalTarget) return '@canonical-target';
  return compactFingerprintText(issue.message)
    .toLowerCase()
    .replace(/"[^"]*"/g, '"value"')
    .replace(/\b\d+(?:\.\d+)?\b/g, '#');
}

export function contractRepairIssueFingerprint(issue: ContractRepairIssue): string {
  if (issue.realizationFingerprint) {
    const canonicalRealizationTarget = [
      issue.issueCode ?? '',
      issue.taskId ?? '',
      issue.contractId ?? '',
      issue.eventId ?? '',
      issue.sceneId ?? '',
      issue.outcomeTier ?? '',
      issue.fieldPath ?? '',
    ];
    if (canonicalRealizationTarget.some(Boolean)) {
      return ['realization', ...canonicalRealizationTarget].join('::');
    }
    return `realization::${issue.realizationFingerprint}`;
  }
  const message = issue.message ?? '';
  const moment = extractQuotedMoment(message) ?? message;
  return [
    issue.validator ?? '',
    issue.issueCode ?? '',
    issue.type ?? '',
    issue.category ?? '',
    issue.severity ?? '',
    issue.episodeNumber ?? '',
    issue.sceneId ?? '',
    issue.beatId ?? '',
    issue.fieldPath ?? '',
    stableIssueMessage(issue) || compactFingerprintText(moment),
    issue.taskId ?? '',
    issue.contractId ?? '',
    issue.eventId ?? '',
    issue.outcomeTier ?? '',
  ].join('::');
}

function introducedBlockingIssueKeys(
  beforeIssues: ContractRepairIssue[],
  afterIssues: ContractRepairIssue[],
): string[] {
  const beforeFamilies = new Set(beforeIssues.map(contractRepairIssueFingerprint));
  const introduced = new Set(
    afterIssues
      .map(contractRepairIssueFingerprint)
      .filter((key) => !beforeFamilies.has(key)),
  );
  const beforeAtomsByFamily = new Map<string, Set<string>>();
  for (const issue of beforeIssues) {
    const atoms = [...(issue.missingEvidenceAtoms ?? []), ...(issue.matchedForbiddenAtoms ?? [])];
    if (atoms.length === 0) continue;
    const family = contractRepairIssueFingerprint(issue);
    const known = beforeAtomsByFamily.get(family) ?? new Set<string>();
    atoms.forEach((atom) => known.add(atom));
    beforeAtomsByFamily.set(family, known);
  }
  for (const issue of afterIssues) {
    const family = contractRepairIssueFingerprint(issue);
    const beforeAtoms = beforeAtomsByFamily.get(family);
    if (!beforeAtoms) continue;
    for (const atom of [...(issue.missingEvidenceAtoms ?? []), ...(issue.matchedForbiddenAtoms ?? [])]) {
      if (!beforeAtoms.has(atom)) introduced.add(`realization-atom::${family}::${atom}`);
    }
  }
  return Array.from(introduced);
}

export function finalContractRepairInputHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function cloneForRepairEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function restoreStoryInPlace(target: Story, source: Story): void {
  const targetRecord = target as unknown as Record<string, unknown>;
  const sourceRecord = cloneForRepairEvidence(source) as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    if (!(key in sourceRecord)) delete targetRecord[key];
  }
  Object.assign(targetRecord, sourceRecord);
}

function findSceneForAtomicScope(
  story: Story,
  scope: NonNullable<ContractRepairResult['atomicScopes']>[number],
): Record<string, unknown> | undefined {
  for (const episode of story.episodes ?? []) {
    if (scope.episodeNumber !== undefined && episode.number !== scope.episodeNumber) continue;
    const scene = episode.scenes?.find((candidate) => candidate.id === scope.sceneId);
    if (scene) return scene as unknown as Record<string, unknown>;
  }
  return undefined;
}

function applyAtomicScope(
  target: Story,
  source: Story,
  scope: NonNullable<ContractRepairResult['atomicScopes']>[number],
): boolean {
  const targetScene = findSceneForAtomicScope(target, scope);
  const sourceScene = findSceneForAtomicScope(source, scope);
  if (!targetScene || !sourceScene) return false;
  const sourceClone = cloneForRepairEvidence(sourceScene);
  for (const key of Object.keys(targetScene)) {
    if (!(key in sourceClone)) delete targetScene[key];
  }
  Object.assign(targetScene, sourceClone);
  return true;
}

function collectChangedFieldPaths(
  before: unknown,
  after: unknown,
  path = 'story',
  output: string[] = [],
  limit = 256,
): string[] {
  if (output.length >= limit || Object.is(before, after)) return output;
  if (
    before === null
    || after === null
    || typeof before !== 'object'
    || typeof after !== 'object'
  ) {
    output.push(path);
    return output;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      output.push(path);
      return output;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length && output.length < limit; index += 1) {
      collectChangedFieldPaths(before[index], after[index], `${path}[${index}]`, output, limit);
    }
    return output;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  for (const key of keys) {
    if (output.length >= limit) break;
    collectChangedFieldPaths(beforeRecord[key], afterRecord[key], `${path}.${key}`, output, limit);
  }
  return output;
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

function isSyntheticColdOpenFallbackBeat(beat: { id?: string }): boolean {
  const id = String(beat.id ?? '');
  return /\bauthored\b/i.test(id) && /\bcoldopen\b/i.test(id);
}

function removeSyntheticColdOpenFallbackBeats(scene: { startingBeatId?: string; beats?: Array<MutableRecord & { id?: string; nextBeatId?: string }> }): number {
  const beats = scene.beats ?? [];
  const removeIds = new Set(beats.filter(isSyntheticColdOpenFallbackBeat).map((beat) => beat.id).filter((id): id is string => Boolean(id)));
  if (removeIds.size === 0) return 0;

  const nextByRemovedId = new Map<string, string | undefined>();
  for (const beat of beats) {
    if (beat.id && removeIds.has(beat.id)) nextByRemovedId.set(beat.id, beat.nextBeatId);
  }

  for (const beat of beats) {
    while (beat.nextBeatId && removeIds.has(beat.nextBeatId)) {
      beat.nextBeatId = nextByRemovedId.get(beat.nextBeatId);
    }
  }

  scene.beats = beats.filter((beat) => !beat.id || !removeIds.has(beat.id));
  if (scene.startingBeatId && removeIds.has(scene.startingBeatId)) {
    scene.startingBeatId = scene.beats[0]?.id;
  }
  return removeIds.size;
}

function buildColdOpenFallbackRouteRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const routeIssues = blockingIssues.filter((issue) =>
      issue.validator === 'RouteContinuityValidator'
      && (issue.type === 'route_chronology_violation' || issue.type === 'route_duplicate_event')
      && issue.sceneId
    );
    if (routeIssues.length === 0) return { story, changed: false };

    const sceneIds = new Set(routeIssues.map((issue) => issue.sceneId).filter((id): id is string => Boolean(id)));
    let removed = 0;
    for (const episode of (story as Story).episodes ?? []) {
      const openingSceneId = episode.startingSceneId || episode.scenes?.[0]?.id;
      for (const scene of episode.scenes ?? []) {
        if (!scene.id || !sceneIds.has(scene.id) || scene.id === openingSceneId) continue;
        removed += removeSyntheticColdOpenFallbackBeats(scene as unknown as { startingBeatId?: string; beats?: Array<MutableRecord & { id?: string; nextBeatId?: string }> });
      }
    }

    if (removed <= 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_coldopen_fallback_route_cleanup',
        scope: 'scene',
        attempted: removed,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Removed ${removed} synthetic cold-open fallback beat(s) from non-opening scene(s) flagged by route continuity.`,
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
  /** Persist or inspect a versioned, replayable record after each changed round. */
  onRoundSnapshot?: (snapshot: ContractRepairRoundSnapshot, story: Story, report: ContractRepairReport) => Promise<void> | void;
  /** Fail when a handler claims success without changing validator-visible story data. */
  requireMutationEvidence?: boolean;
  /** Reject a candidate that introduces any new blocking fingerprint. */
  rejectIntroducedBlockingIssues?: boolean;
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

    const roundInputHash = finalContractRepairInputHash(story);
    const roundBefore = cloneForRepairEvidence(story);
    const allBeforeIssues = [...report.blockingIssues];
    const allBeforeIssueKeys = allBeforeIssues.map(contractRepairIssueFingerprint);
    const beforeIssueKeys = round.issues.map(contractRepairIssueFingerprint);
    let roundChanged = false;
    const roundRecords: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];
    let anyHandlerReportedAttempts = false;
    const attemptedThisRound = new Set<string>();
    const handlerReportedPaths = new Set<string>();
    const handlerAttempts: ContractRepairRoundSnapshot['handlerAttempts'] = [];
    const rejectedIntroducedKeys = new Set<string>();
    for (let handlerIndex = 0; handlerIndex < opts.handlers.length; handlerIndex += 1) {
      const handler = opts.handlers[handlerIndex];
      const handlerBefore = cloneForRepairEvidence(story);
      const activeRoundKeys = new Set(round.keys);
      const activeIssueKeys = new Set<string>();
      const activeIssues = report.blockingIssues.filter((issue) => {
        const key = contractRepairIssueFingerprint(issue);
        if (!activeRoundKeys.has(key)) return false;
        if ((opts.dedupeIssueFingerprints ?? false) && activeIssueKeys.has(key)) return false;
        activeIssueKeys.add(key);
        return true;
      });
      const result = await handler({ story, blockingIssues: activeIssues });
      if (result.attemptedIssueKeys) {
        anyHandlerReportedAttempts = true;
        for (const key of result.attemptedIssueKeys) attemptedThisRound.add(key);
      }
      if (result.changed && result.story !== story) restoreStoryInPlace(story, result.story);
      let acceptedChange = result.changed;
      let acceptedWholeCandidate = result.changed;
      if (result.changed) {
        if (opts.rejectIntroducedBlockingIssues) {
          const beforeHandlerIssues = [...report.blockingIssues];
          const candidateReport = await opts.revalidate(story);
          const introduced = introducedBlockingIssueKeys(beforeHandlerIssues, candidateReport.blockingIssues);
          if (introduced.length > 0) {
            introduced.forEach((key) => rejectedIntroducedKeys.add(key));
            const handlerCandidate = cloneForRepairEvidence(story);
            restoreStoryInPlace(story, handlerBefore);
            acceptedChange = false;
            acceptedWholeCandidate = false;
            for (const scope of result.atomicScopes ?? []) {
              const scopeBefore = cloneForRepairEvidence(story);
              if (!applyAtomicScope(story, handlerCandidate, scope)) continue;
              const scopedReport = await opts.revalidate(story);
              const scopedIntroduced = introducedBlockingIssueKeys(report.blockingIssues, scopedReport.blockingIssues);
              if (scopedIntroduced.length > 0) {
                restoreStoryInPlace(story, scopeBefore);
                scopedIntroduced.forEach((key) => rejectedIntroducedKeys.add(key));
                continue;
              }
              report = scopedReport;
              acceptedChange = true;
            }
          } else {
            report = candidateReport;
          }
        }
        if (acceptedChange) {
          roundChanged = true;
          if (result.record) roundRecords.push(result.record);
        }
      }
      const handlerObservedPaths = acceptedChange
        ? collectChangedFieldPaths(handlerBefore, story)
        : [];
      const handlerChangedPaths = Array.from(new Set([
        ...(acceptedWholeCandidate ? (result.changedFieldPaths ?? []) : []),
        ...handlerObservedPaths,
      ])).sort();
      if (opts.requireMutationEvidence && acceptedChange && handlerChangedPaths.length === 0) {
        throw new Error(`Final contract repair handler ${handler.name || `handler-${handlerIndex + 1}`} claimed success without changing validator-visible story evidence.`);
      }
      for (const path of handlerChangedPaths) handlerReportedPaths.add(path);
      handlerAttempts.push({
        handler: handler.name || `handler-${handlerIndex + 1}`,
        attemptedIssueKeys: result.attemptedIssueKeys ?? [],
        changedFieldPaths: handlerChangedPaths,
        claimedChanged: result.changed,
      });
    }

    if (!roundChanged) {
      if (rejectedIntroducedKeys.size > 0) {
        await opts.onRoundSnapshot?.({
          schemaVersion: FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION,
          validatorVersion: FINAL_CONTRACT_VALIDATOR_VERSION,
          round: attempts,
          inputHash: roundInputHash,
          beforeIssueKeys,
          afterIssueKeys: report.blockingIssues.map(contractRepairIssueFingerprint),
          attemptedIssueKeys: Array.from(attemptedThisRound),
          changedFieldPaths: [],
          handlerAttempts,
          clearedIssueKeys: [],
          introducedIssueKeys: Array.from(rejectedIntroducedKeys),
          revalidationDelta: {
            beforeBlocking: beforeIssueKeys.length,
            afterBlocking: report.blockingIssues.length,
            cleared: 0,
            introduced: rejectedIntroducedKeys.size,
          },
          passed: report.passed,
        }, story, report);
      }
      break; // fixpoint: nothing left any handler can safely commit
    }
    // Revalidate before charging issue fingerprints. A handler only consumes
    // budget after the canonical validators have observed its candidate.
    const candidateReport = opts.rejectIntroducedBlockingIssues
      ? report
      : await opts.revalidate(story);
    const candidateIssueKeys = candidateReport.blockingIssues.map(contractRepairIssueFingerprint);
    const beforeIssueSet = new Set(allBeforeIssueKeys);
    const introducedCandidateKeys = introducedBlockingIssueKeys(allBeforeIssues, candidateReport.blockingIssues);
    if (opts.rejectIntroducedBlockingIssues && introducedCandidateKeys.length > 0) {
      // A repair is transactional for the offending round: revert, then continue
      // attempting other repairable issues instead of aborting the entire loop
      // (R0.6 — one bad rewrite must not starve sibling repairs).
      restoreStoryInPlace(story, roundBefore);
      opts.onRoundSnapshot?.({
        schemaVersion: FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION,
        validatorVersion: FINAL_CONTRACT_VALIDATOR_VERSION,
        round: attempts,
        inputHash: roundInputHash,
        beforeIssueKeys,
        afterIssueKeys: beforeIssueKeys,
        attemptedIssueKeys: [],
        changedFieldPaths: [],
        handlerAttempts,
        clearedIssueKeys: [],
        introducedIssueKeys: Array.from(new Set([...introducedCandidateKeys, ...rejectedIntroducedKeys])),
        revalidationDelta: {
          beforeBlocking: beforeIssueKeys.length,
          afterBlocking: beforeIssueKeys.length,
          cleared: 0,
          introduced: introducedCandidateKeys.length,
        },
        passed: false,
      }, story, report);
      for (const key of introducedCandidateKeys) {
        issueAttempts.set(key, opts.maxAttemptsPerIssue ?? 2);
      }
      continue;
    }
    report = candidateReport;
    records.push(...roundRecords);
    const observedChangedPaths = collectChangedFieldPaths(roundBefore, story);
    const changedFieldPaths = Array.from(new Set([...handlerReportedPaths, ...observedChangedPaths])).sort();
    if (opts.requireMutationEvidence && changedFieldPaths.length === 0) {
      throw new Error(`Final contract repair round ${attempts} claimed success without changing validator-visible story evidence.`);
    }
    // Charge the per-issue budget only for issues a handler actually attempted.
    // Charging on SELECTION (the old behavior) exhausted issues the capped
    // handlers never reached: with maxAttemptsPerIssue=2 and >8 distinct scene
    // fingerprints, un-attempted issues ran out of budget after 2 rounds and the
    // run aborted with blockers that never received a repair pass (g23).
    // Handlers that don't report attempts fall back to charging every selected
    // key, preserving the fixpoint guarantee for legacy handlers.
    const chargeKeys = anyHandlerReportedAttempts ? Array.from(attemptedThisRound) : round.keys;
    for (const key of chargeKeys) {
      issueAttempts.set(key, (issueAttempts.get(key) ?? 0) + 1);
    }
    const afterIssueKeys = report.blockingIssues.map(contractRepairIssueFingerprint);
    const afterIssueSet = new Set(afterIssueKeys);
    const snapshot: ContractRepairRoundSnapshot = {
      schemaVersion: FINAL_CONTRACT_REPAIR_SNAPSHOT_VERSION,
      validatorVersion: FINAL_CONTRACT_VALIDATOR_VERSION,
      round: attempts,
      inputHash: roundInputHash,
      beforeIssueKeys,
      afterIssueKeys,
      attemptedIssueKeys: chargeKeys,
      changedFieldPaths,
      handlerAttempts,
      clearedIssueKeys: beforeIssueKeys.filter((key) => !afterIssueSet.has(key)),
      introducedIssueKeys: Array.from(new Set([
        ...afterIssueKeys.filter((key) => !beforeIssueSet.has(key)),
        ...rejectedIntroducedKeys,
      ])),
      revalidationDelta: {
        beforeBlocking: beforeIssueKeys.length,
        afterBlocking: afterIssueKeys.length,
        cleared: beforeIssueKeys.filter((key) => !afterIssueSet.has(key)).length,
        introduced: afterIssueKeys.filter((key) => !beforeIssueSet.has(key)).length,
      },
      passed: report.passed,
    };
    await opts.onRoundSnapshot?.(snapshot, story, report);
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
    buildColdOpenFallbackRouteRepairHandler(),
    buildDramaticIntentMetadataHygieneHandler(),
    // Planning-register leak in metadata fields: strip authoring directives from
    // beat/scene metadata that image planning and the reader may consume, without
    // changing story text, choices, encounters, or navigation.
    buildPlanningRegisterMetadataRepairHandler(),
    // Relationship ledger delta overshoot: clamp consequence.change to the planned
    // maxDeltaThisScene (preserve sign). Run before label downgrade so numeric
    // overshoot is fixed first; does not invent major-evidence tags.
    buildRelationshipDeltaCapRepairHandler(),
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
