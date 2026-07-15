/**
 * Repair carry-forward across resumes (docs/REPAIR_CARRYFORWARD_PLAN_2026-07-15.md).
 *
 * When the final-contract repair loop ends still-failing, the repaired story
 * only survived as unread diagnostics (partial-story.json, repair-snapshots/)
 * — every resume re-assembled the episode from its frozen watermarks and
 * re-repaired the same defects with a fresh round budget. This module makes
 * the repaired candidate a first-class checkpoint with a real reader:
 *
 *   - buildRepairCandidate() captures the in-place-repaired episodes plus the
 *     hash of the PRE-repair contract input they descend from, at the moment
 *     the contract throws.
 *   - On the next enforcement of the same phase, the pipeline consumes the
 *     candidate iff its base hash matches the freshly assembled story —
 *     upstream content unchanged — and uses it as the contract INPUT. Nothing
 *     is trusted: validation re-runs in full; the candidate is only a better
 *     starting text.
 *
 * Content monotonicity comes from the repair loop itself (requireMutationEvidence
 * + rejectIntroducedBlockingIssues mean accepted rounds only improve), so a
 * candidate derived from a consumed candidate strictly extends it — the stored
 * file is only ever replaced by its own descendant.
 *
 * Every failure mode here degrades to the pre-carry-forward behavior (start
 * from watermarks); none may abort the run.
 */

import type { Story } from '../../types';
import {
  contractRepairIssueFingerprint,
  finalContractRepairInputHash,
  type ContractRepairReport,
} from './finalContractRepair';

export const REPAIR_CARRYFORWARD_SCHEMA_VERSION = 1;

export interface FinalContractRepairCandidate {
  schemaVersion: typeof REPAIR_CARRYFORWARD_SCHEMA_VERSION;
  savedAt: string;
  /** Enforcement phase this candidate belongs to (e.g. final_story_contract, incremental_contract_ep_1). */
  phase: string;
  workerGitSha?: string;
  /** Hash of the pre-repair contract input this candidate lineage descends from. */
  baseStoryHash: string;
  /** Hash of candidateEpisodes; unchanged hash + identical fingerprints across enforcements = deterministic re-failure. */
  candidateStoryHash: string;
  /** Sorted unique fingerprints still blocking when this candidate was saved. */
  remainingBlockingFingerprints: string[];
  /** Fingerprints that were remaining at the previous enforcement and cleared by this one. */
  resolvedLastEnforcement: string[];
  /** How many still-failing enforcement runs (across resumes) this lineage has been through. */
  enforcementCount: number;
  /** Per remaining fingerprint: how many enforcement runs have ended with it still blocking. */
  fingerprintEnforcementsSeen: Record<string, number>;
  /** The repaired episodes as of the last accepted repair round. */
  candidateEpisodes: NonNullable<Story['episodes']>;
}

/** What the pipeline remembers after substituting a candidate into the contract input. */
export interface ConsumedCarryForwardCandidate {
  candidateStoryHash: string;
  remainingBlockingFingerprints: string[];
  enforcementCount: number;
  fingerprintEnforcementsSeen: Record<string, number>;
}

/** Threaded from the pipeline wrapper into the contract's failure site. */
export interface FinalContractCarryForwardContext {
  baseStoryHash: string;
  consumed?: ConsumedCarryForwardCandidate;
}

/**
 * Hash the episodes projection only. Top-level story fields (cover art, npc
 * portraits, outputDir) are legitimately recomputed per run and must not
 * invalidate a candidate whose text content still matches.
 */
export function carryForwardStoryHash(story: Story): string {
  return finalContractRepairInputHash(story.episodes ?? []);
}

export function remainingBlockingFingerprintSet(
  report: Pick<ContractRepairReport, 'blockingIssues'>,
): string[] {
  return Array.from(
    new Set((report.blockingIssues ?? []).map((issue) => contractRepairIssueFingerprint(issue))),
  ).sort();
}

export function sameFingerprintSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((key) => other.has(key));
}

/**
 * Build the candidate to persist at a still-failing contract. Returns null
 * when there is nothing worth carrying: no candidate was consumed AND no
 * repair changed the story (the next run would start from the same place
 * anyway).
 */
export function buildRepairCandidate(input: {
  story: Story;
  report: Pick<ContractRepairReport, 'blockingIssues'>;
  phase: string;
  context: FinalContractCarryForwardContext;
  workerGitSha?: string;
}): FinalContractRepairCandidate | null {
  const candidateStoryHash = carryForwardStoryHash(input.story);
  const consumed = input.context.consumed;
  if (!consumed && candidateStoryHash === input.context.baseStoryHash) return null;
  const remaining = remainingBlockingFingerprintSet(input.report);
  const remainingSet = new Set(remaining);
  const fingerprintEnforcementsSeen: Record<string, number> = {};
  for (const key of remaining) {
    fingerprintEnforcementsSeen[key] = (consumed?.fingerprintEnforcementsSeen?.[key] ?? 0) + 1;
  }
  return {
    schemaVersion: REPAIR_CARRYFORWARD_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    phase: input.phase,
    workerGitSha: input.workerGitSha,
    baseStoryHash: input.context.baseStoryHash,
    candidateStoryHash,
    remainingBlockingFingerprints: remaining,
    resolvedLastEnforcement: (consumed?.remainingBlockingFingerprints ?? []).filter(
      (key) => !remainingSet.has(key),
    ),
    enforcementCount: (consumed?.enforcementCount ?? 0) + 1,
    fingerprintEnforcementsSeen,
    candidateEpisodes: (input.story.episodes ?? []) as NonNullable<Story['episodes']>,
  };
}

/**
 * True when this enforcement consumed a candidate and ended exactly where that
 * candidate ended: same content hash, same blocking set. Another resume with
 * the same code cannot make progress — it needs a code/gate change or a fresh
 * run. Advisory only; the caller must not turn this into a new abort class.
 */
export function isDeterministicReFailure(
  candidate: Pick<FinalContractRepairCandidate, 'candidateStoryHash' | 'remainingBlockingFingerprints'>,
  consumed: ConsumedCarryForwardCandidate | undefined,
): boolean {
  return Boolean(
    consumed
    && candidate.candidateStoryHash === consumed.candidateStoryHash
    && sameFingerprintSet(candidate.remainingBlockingFingerprints, consumed.remainingBlockingFingerprints),
  );
}

/** Overlay the carried episodes onto the freshly assembled story, in place. */
export function applyCandidateEpisodes(story: Story, candidate: FinalContractRepairCandidate): void {
  story.episodes = JSON.parse(JSON.stringify(candidate.candidateEpisodes)) as Story['episodes'];
}

/**
 * Parse a persisted candidate. Anything unexpected — wrong schema version,
 * torn file, foreign phase, missing episodes — degrades to null (absent), the
 * same crash-degradation discipline as the watermark probe.
 */
export function parseRepairCandidate(raw: unknown, expectedPhase: string): FinalContractRepairCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<FinalContractRepairCandidate>;
  if (candidate.schemaVersion !== REPAIR_CARRYFORWARD_SCHEMA_VERSION) return null;
  if (candidate.phase !== expectedPhase) return null;
  if (typeof candidate.baseStoryHash !== 'string' || typeof candidate.candidateStoryHash !== 'string') return null;
  if (!Array.isArray(candidate.remainingBlockingFingerprints)) return null;
  if (!Array.isArray(candidate.candidateEpisodes) || candidate.candidateEpisodes.length === 0) return null;
  if (typeof candidate.enforcementCount !== 'number' || candidate.enforcementCount < 1) return null;
  return {
    ...candidate,
    resolvedLastEnforcement: Array.isArray(candidate.resolvedLastEnforcement) ? candidate.resolvedLastEnforcement : [],
    fingerprintEnforcementsSeen:
      candidate.fingerprintEnforcementsSeen && typeof candidate.fingerprintEnforcementsSeen === 'object'
        ? candidate.fingerprintEnforcementsSeen
        : {},
  } as FinalContractRepairCandidate;
}
