/**
 * Surgical episode invalidation (adoption A4, 2026-06-11).
 *
 * Marks completed episodes in a run directory as NOT-complete so the next
 * resume — legacy loop or run-graph — re-generates them while still
 * rehydrating everything upstream. This is the manual entry point for the
 * run-graph's surgical-repair semantics at episode granularity: "episode N
 * shipped broken, redo N (and what depends on it) without re-paying for the
 * rest of the season."
 *
 * Invalidation is TOMBSTONE-BY-OVERWRITE, not file deletion: the episode's
 * completion watermark is overwritten with a version-0 tombstone that
 * loadCompletedEpisode() rejects (it requires version === 1). That means:
 *   - it works through the same ArtifactSaver IO the pipeline already uses
 *     (saveEarlyDiagnostic has no delete primitive);
 *   - the assembled episode artifact stays on disk for forensics/diffing;
 *   - a torn tombstone write still fails the version probe — invalidation
 *     can't crash into a half-valid state;
 *   - the tombstone records WHEN and WHY, so a run dir explains itself.
 *
 * DOWNSTREAM RULE: episodes are generated under season-canon carry-forward
 * (episode N+1 is sealed against N's canon + priorEpisodeSnapshot), so
 * invalidating N defaults to invalidating every LATER completed episode too.
 * `downstream: false` opts out for the rare in-place single-episode redo —
 * the caller owns the canon-drift risk and the tombstone records the choice.
 */

import {
  type ArtifactLoader,
  type ArtifactSaver,
  type EpisodeCompletionWatermark,
  episodeCompleteArtifact,
  loadCompletedEpisode,
} from './episodeCheckpoints';

export interface EpisodeInvalidationTombstone {
  version: 0;
  invalidatedAt: string;
  reason: string;
  /** Whether this tombstone was planted as downstream fallout of an earlier target. */
  downstreamOf?: number;
  /** The watermark this tombstone replaced, for forensics. */
  replaced: EpisodeCompletionWatermark;
}

export interface EpisodeInvalidationPlan {
  target: number;
  /** Episode numbers that will be (or were) tombstoned, ascending. */
  invalidated: number[];
  /** Completed episodes left intact (upstream of the target), ascending. */
  kept: number[];
}

/**
 * Decide which completed episodes an invalidation of `target` covers.
 * Pure planning — probes watermarks via `load`, writes nothing.
 */
export function planEpisodeInvalidation(options: {
  target: number;
  /** Candidate episode numbers to probe (e.g. 1..seasonLength). */
  episodeNumbers: number[];
  load: ArtifactLoader;
  /** Default true: later completed episodes are canon-downstream of the target. */
  downstream?: boolean;
}): EpisodeInvalidationPlan {
  const { target, episodeNumbers, load } = options;
  const downstream = options.downstream !== false;
  const completed = [...new Set(episodeNumbers)]
    .sort((a, b) => a - b)
    .filter((n) => loadCompletedEpisode(n, load) !== null);
  const invalidated = completed.filter((n) => (downstream ? n >= target : n === target));
  const kept = completed.filter((n) => !invalidated.includes(n));
  return { target, invalidated, kept };
}

/**
 * Execute an invalidation plan: overwrite each covered episode's watermark
 * with a version-0 tombstone. Returns the plan actually applied.
 */
export async function invalidateEpisodes(options: {
  target: number;
  episodeNumbers: number[];
  load: ArtifactLoader;
  save: ArtifactSaver;
  reason: string;
  downstream?: boolean;
}): Promise<EpisodeInvalidationPlan> {
  const plan = planEpisodeInvalidation(options);
  for (const n of plan.invalidated) {
    const existing = loadCompletedEpisode(n, options.load);
    if (!existing) continue; // raced/already tombstoned — nothing to replace
    const tombstone: EpisodeInvalidationTombstone = {
      version: 0,
      invalidatedAt: new Date().toISOString(),
      reason: options.reason,
      ...(n !== options.target ? { downstreamOf: options.target } : {}),
      replaced: existing.watermark,
    };
    await options.save(episodeCompleteArtifact(n), tombstone);
    if (loadCompletedEpisode(n, options.load) !== null) {
      throw new Error(
        `Episode ${n} invalidation did not stick (watermark still probes as complete).`,
      );
    }
  }
  return plan;
}
