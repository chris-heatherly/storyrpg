/**
 * Seven-Point Distribution Helper
 *
 * Pure, deterministic function that maps the season's 7 structural beats
 * (Hook, Plot Turn 1, Pinch 1, Midpoint, Pinch 2, Climax, Resolution) onto
 * N episodes.
 *
 * Usage
 * -----
 *  - `SeasonPlannerAgent` calls {@link distributeSevenPoints} to seed a
 *    default `structuralRole` for every episode.
 *  - The LLM prompt includes the resulting mapping as a HINT, not a rule —
 *    the LLM may reassign beats if the source material strongly demands it.
 *  - `SevenPointCoverageValidator` uses the same helper to build the
 *    expected-coverage report when the planner's output is missing roles.
 *
 * Rules
 * -----
 *  - Every named beat must land on at least ONE episode.
 *  - Beats must appear in canonical order across the season (hook before
 *    plotTurn1, etc.); the function guarantees monotonicity.
 *  - Episodes that fall BETWEEN two named beats receive a single `rising`
 *    or `falling` role based on whether they precede or follow the
 *    Midpoint.
 *  - Short seasons (<= 4 episodes) fuse beats onto shared episodes. For
 *    N=1 every beat lands on episode 1. For N=2 beats 1-3 go to ep1 and
 *    4-7 go to ep2. This gives the LLM and validators a sane baseline
 *    even on tiny seasons used for tests and spikes.
 */

import type { StructuralRole } from '../../types/sourceAnalysis';

const CANONICAL_BEATS: Exclude<StructuralRole, 'rising' | 'falling'>[] = [
  'hook',
  'plotTurn1',
  'pinch1',
  'midpoint',
  'pinch2',
  'climax',
  'resolution',
];

/**
 * Canonical pacing anchors as a fraction of the season (0 <= p <= 1).
 * These are the "preferred" landing points for each beat and match the
 * 3-act / 9-chapter structure this adaptation is based on:
 *
 *   Act 1 (0 - 1/3):  hook at start, plotTurn1 at the act 1 / act 2 wall
 *   Act 2 (1/3 - 2/3): pinch1 mid-way through the first half of act 2,
 *                       midpoint at the center, pinch2 mid-way through
 *                       the second half of act 2
 *   Act 3 (2/3 - 1):  climax at the act 2 / act 3 wall (or one episode
 *                       later), resolution at the very end.
 */
const BEAT_ANCHORS: Record<Exclude<StructuralRole, 'rising' | 'falling'>, number> = {
  hook: 0.0,
  plotTurn1: 0.2,
  pinch1: 0.35,
  midpoint: 0.5,
  pinch2: 0.65,
  climax: 0.85,
  resolution: 1.0,
};

export interface DistributionEntry {
  episodeNumber: number;
  structuralRole: StructuralRole[];
}

/**
 * Assign every beat to an episode using the canonical pacing anchors.
 *
 * @param totalEpisodes - Number of episodes in the season (must be >= 1).
 * @returns An array of length `totalEpisodes`, one entry per episode,
 *          each containing the `structuralRole[]` for that episode.
 *          Guaranteed to contain every canonical beat at least once,
 *          in canonical order.
 */
export function distributeSevenPoints(totalEpisodes: number): DistributionEntry[] {
  if (!Number.isFinite(totalEpisodes) || totalEpisodes < 1) {
    return [];
  }

  const entries: DistributionEntry[] = Array.from({ length: totalEpisodes }, (_, idx) => ({
    episodeNumber: idx + 1,
    structuralRole: [],
  }));

  // For each canonical beat, pick the episode whose normalized position is
  // closest to the beat's anchor. Ties break to the EARLIER episode so the
  // monotonicity guarantee below is easy to maintain. We then enforce that
  // later beats never land on an earlier episode than prior beats.
  let lastAssignedEpisode = 1;
  for (const beat of CANONICAL_BEATS) {
    const anchor = BEAT_ANCHORS[beat];
    // Map anchor (0..1) to episode index (1..N)
    let target = Math.round(anchor * (totalEpisodes - 1)) + 1;
    if (target < lastAssignedEpisode) {
      target = Math.min(lastAssignedEpisode, totalEpisodes);
    }
    entries[target - 1].structuralRole.push(beat);
    lastAssignedEpisode = target;
  }

  // Any episode that still has no beat is a pure escalation / de-escalation
  // buffer. Pre-Midpoint buffers get 'rising'; post-Midpoint buffers get
  // 'falling'. The Midpoint's episode itself always has a named beat, so
  // this split is unambiguous.
  const midpointEntry = entries.find((e) => e.structuralRole.includes('midpoint'));
  const midpointEpisode = midpointEntry ? midpointEntry.episodeNumber : Math.ceil(totalEpisodes / 2);

  for (const entry of entries) {
    if (entry.structuralRole.length === 0) {
      entry.structuralRole.push(entry.episodeNumber <= midpointEpisode ? 'rising' : 'falling');
    }
  }

  return entries;
}

/**
 * Build a short human-readable summary of a distribution, suitable for
 * embedding in an LLM prompt as a hint.
 */
export function describeDistribution(entries: DistributionEntry[]): string {
  return entries
    .map((entry) => `  Episode ${entry.episodeNumber}: ${entry.structuralRole.join(', ')}`)
    .join('\n');
}

/**
 * Verify that a set of per-episode structuralRole assignments covers every
 * canonical beat at least once and that the beats appear in canonical
 * order. Returns a list of human-readable issues; empty array means the
 * coverage is clean.
 */
export function checkSevenPointCoverage(
  perEpisodeRoles: Array<{ episodeNumber: number; structuralRole?: StructuralRole[] }>
): string[] {
  const issues: string[] = [];
  const beatToEpisode = new Map<StructuralRole, number>();

  for (const entry of perEpisodeRoles) {
    for (const role of entry.structuralRole || []) {
      if (!beatToEpisode.has(role)) {
        beatToEpisode.set(role, entry.episodeNumber);
      }
    }
  }

  for (const beat of CANONICAL_BEATS) {
    if (!beatToEpisode.has(beat)) {
      issues.push(`Missing 7-point beat: "${beat}" is not carried by any episode.`);
    }
  }

  // Monotonicity check: beats must appear in canonical order.
  let lastEp = -Infinity;
  for (const beat of CANONICAL_BEATS) {
    const ep = beatToEpisode.get(beat);
    if (ep === undefined) continue;
    if (ep < lastEp) {
      issues.push(`Beat ordering violation: "${beat}" lands on episode ${ep} but a later beat in the canonical order was already placed on episode ${lastEp}.`);
    }
    lastEp = Math.max(lastEp, ep);
  }

  return issues;
}

export { CANONICAL_BEATS };
