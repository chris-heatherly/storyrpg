/**
 * Section-7 beat-anchor reconciliation (Treatment-Fidelity Remediation Phase 1,
 * Step 1.2 — RC4 residual + RC2/RC7 gaps).
 *
 * Section 7 of an authored treatment anchors each 7-point beat to a specific
 * episode (e.g. `Plot turn 1 (Ep3)`, `Pinch 1 (Ep4)`, `Climax (Ep10)`). Phase 1
 * Step 1.1 parses those into a structured
 * `seasonGuidance.beatEpisodeAnchors: Partial<Record<SevenPointBeat, number>>`.
 *
 * The per-episode `structuralRole` array (assigned by the LLM and/or the default
 * seven-point distribution) is a SECOND, independently-derived statement of where
 * each beat lives. When those two disagree the authored Section-7 anchor is the
 * spine of record ("expand, do not rewrite"): we move the beat onto the anchored
 * episode and log the conflict. In strict mode the conflict throws instead.
 *
 * Pure / deterministic helper — no env, clock, or randomness. The caller owns
 * logging side-effects via the injected `log` callback so this stays testable.
 */

import type { SevenPointBeat, StructuralRole } from '../../types/sourceAnalysis';
import { SEVEN_POINT_BEATS } from '../../types/sourceAnalysis';
import { TreatmentValidationError } from '../utils/treatmentExtraction';

/** Minimal shape this reconciler needs from an episode outline. */
export interface BeatAnchorReconcilable {
  episodeNumber: number;
  /** Mutated in place when an anchor conflict is resolved in favour of Section 7. */
  structuralRole?: StructuralRole[];
}

export interface BeatAnchorConflict {
  beat: SevenPointBeat;
  /** Episode the Section-7 anchor says the beat belongs to. */
  anchoredEpisode: number;
  /** Episodes whose structuralRole currently carries the beat (before fix). */
  carryingEpisodes: number[];
}

export interface BeatAnchorReconciliationResult {
  /** Conflicts detected (and, outside strict mode, repaired in place). */
  conflicts: BeatAnchorConflict[];
  /** Human-readable messages, one per conflict. */
  messages: string[];
}

const BEAT_SET = new Set<string>(SEVEN_POINT_BEATS as readonly string[]);

function isAnchorableBeat(beat: string): beat is SevenPointBeat {
  return BEAT_SET.has(beat);
}

/**
 * Cross-check each Section-7 anchored beat against the per-episode
 * `structuralRole` assignments and, when they disagree, prefer the anchor.
 *
 * On conflict (non-strict): the beat is REMOVED from every episode that wrongly
 * carries it and ADDED to the anchored episode; if removing it would empty an
 * episode's role list it is backfilled with `'rising'` so downstream validators
 * still see a non-empty array.
 *
 * On conflict (strict): the first conflict throws a {@link TreatmentValidationError}.
 *
 * @returns the conflicts found and the messages emitted. When `anchors` is empty
 * or absent the result is empty and `episodes` is untouched.
 */
export function reconcileBeatAnchors(
  episodes: BeatAnchorReconcilable[],
  anchors: Partial<Record<SevenPointBeat, number>> | undefined,
  options: { strict?: boolean; log?: (message: string) => void } = {},
): BeatAnchorReconciliationResult {
  const conflicts: BeatAnchorConflict[] = [];
  const messages: string[] = [];
  if (!anchors) return { conflicts, messages };

  const { strict = false, log } = options;

  for (const beatKey of Object.keys(anchors)) {
    if (!isAnchorableBeat(beatKey)) continue;
    const beat = beatKey;
    const anchoredEpisode = anchors[beat];
    if (typeof anchoredEpisode !== 'number' || !Number.isFinite(anchoredEpisode)) continue;

    const carryingEpisodes = episodes
      .filter((ep) => ep.structuralRole?.includes(beat))
      .map((ep) => ep.episodeNumber);

    // No conflict: the beat already sits (only) on the anchored episode, OR
    // the anchored episode is one of the carriers and is the sole carrier.
    const carriedCorrectly =
      carryingEpisodes.length === 1 && carryingEpisodes[0] === anchoredEpisode;
    if (carriedCorrectly) continue;

    const message =
      `Section-7 anchor places ${beat} on Ep${anchoredEpisode}, but structuralRole ` +
      (carryingEpisodes.length === 0
        ? `assigns it to no episode`
        : `assigns it to Ep${carryingEpisodes.join(', Ep')}`) +
      `; preferring the authored Section-7 anchor.`;

    conflicts.push({ beat, anchoredEpisode, carryingEpisodes });
    messages.push(message);

    if (strict) {
      throw new TreatmentValidationError(message);
    }

    log?.(message);

    // Repair in favour of the Section-7 anchor.
    for (const ep of episodes) {
      if (!ep.structuralRole) continue;
      if (ep.episodeNumber === anchoredEpisode) continue;
      if (!ep.structuralRole.includes(beat)) continue;
      const filtered = ep.structuralRole.filter((r) => r !== beat);
      ep.structuralRole = filtered.length > 0 ? filtered : ['rising'];
    }
    const target = episodes.find((ep) => ep.episodeNumber === anchoredEpisode);
    if (target) {
      const existing = (target.structuralRole || []).filter((r) => r !== 'rising' && r !== 'falling');
      target.structuralRole = [...new Set([...existing, beat])];
    }
  }

  return { conflicts, messages };
}
