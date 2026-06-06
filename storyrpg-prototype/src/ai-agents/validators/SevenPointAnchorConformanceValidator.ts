/**
 * Seven-Point Anchor Conformance Validator
 * (Treatment-Fidelity Remediation Plan §4.5, blocking — registered DEFAULT-OFF.)
 *
 * The existing {@link SevenPointCoverageValidator} is structurally BLIND to the
 * authored treatment: it only checks that the season carries every beat in
 * canonical order, never *which authored episode* a beat was anchored to. When a
 * treatment is the source, Section 7 of that treatment anchors each 7-point beat
 * to a specific episode (`Plot turn 1 (Ep3)`, `Pinch 1 (Ep4)`, `Climax (Ep10)`),
 * parsed by Phase 1 into
 * `seasonGuidance.beatEpisodeAnchors: Partial<Record<SevenPointBeat, number>>`.
 *
 * This validator takes that authored anchor map plus the final season's per-episode
 * `structuralRole` assignments and asserts every authored beat→episode anchor is
 * HONORED in the final story ("expand, do not rewrite"): each anchored beat must
 * land on the episode the treatment placed it on — not earlier, not later, not on
 * multiple episodes.
 *
 * Asserts (all blocking / error severity):
 *  1. Each authored beat anchor points to a real episode in the plan.
 *  2. The anchored episode's `structuralRole` actually carries that beat.
 *  3. No OTHER episode also carries an anchored beat (no beat duplication /
 *     re-anchoring away from the authored slot).
 *
 * Warnings (score only, non-blocking):
 *  - An authored beat that no episode carries at all (likely a buffer/role-array
 *    gap rather than an outright re-cut) — surfaced so it is visible, but the
 *    blocking signal is reserved for an anchor that landed on the WRONG episode.
 *
 * Mirrors the {@link SevenPointCoverageValidator} contract: extends
 * {@link BaseValidator}, takes a self-contained input shape, and returns a
 * {@link ValidationResult} where any `error`-severity issue is blocking. Pure /
 * deterministic — no clock, no randomness; unit-testable without a live run.
 *
 * NOTE: this file does NOT register itself. Registration in `validatorRegistry.ts`
 * (and gating in `architectGatePolicy.ts`) is handled by the Wiring phase, behind a
 * default-off gate consistent with how recent validators landed.
 */

import { SevenPointBeat, SEVEN_POINT_BEATS, StructuralRole } from '../../types/sourceAnalysis';
import { SeasonPlan } from '../../types/seasonPlan';
import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
} from './BaseValidator';

const BEAT_SET = new Set<string>(SEVEN_POINT_BEATS as readonly string[]);

function isSevenPointBeat(beat: string): beat is Exclude<StructuralRole, 'rising' | 'falling'> {
  return BEAT_SET.has(beat);
}

/** Minimal per-episode shape this validator reasons over. */
export interface SevenPointAnchorEpisode {
  episodeNumber: number;
  structuralRole?: StructuralRole[];
}

export interface SevenPointAnchorConformanceInput {
  /**
   * The authored Section-7 beat→episode anchor map (Phase 1,
   * `seasonGuidance.beatEpisodeAnchors`). When absent or empty the validator is a
   * no-op pass — there is no authored anchoring to conform to (treatment is silent
   * or the source was not a treatment).
   */
  beatEpisodeAnchors?: Partial<Record<SevenPointBeat, number>>;
  /** The final season's episodes, carrying their assigned `structuralRole`. */
  episodes: SevenPointAnchorEpisode[];
}

/**
 * Extract the validator's input shape from a fully-built {@link SeasonPlan} plus
 * the authored anchor map. Helper so callers (the pipeline wiring, tests, CLI
 * diagnostics) can run this validator without reshaping data by hand. The anchor
 * map lives on the source analysis (`treatmentSeasonGuidance.beatEpisodeAnchors`),
 * not on the SeasonPlan, so it is passed in explicitly.
 */
export function seasonPlanToAnchorConformanceInput(
  plan: SeasonPlan,
  beatEpisodeAnchors: Partial<Record<SevenPointBeat, number>> | undefined,
): SevenPointAnchorConformanceInput {
  return {
    beatEpisodeAnchors,
    episodes: plan.episodes.map((ep) => ({
      episodeNumber: ep.episodeNumber,
      structuralRole: ep.structuralRole,
    })),
  };
}

export class SevenPointAnchorConformanceValidator extends BaseValidator {
  constructor() {
    super('SevenPointAnchorConformanceValidator');
  }

  validate(input: SevenPointAnchorConformanceInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    const anchors = input.beatEpisodeAnchors;
    // No authored anchoring → nothing to conform to. Clean pass.
    if (!anchors || Object.keys(anchors).length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    const byNumber = new Map<number, SevenPointAnchorEpisode>();
    for (const ep of input.episodes) byNumber.set(ep.episodeNumber, ep);

    // Which episodes currently carry each beat (independent of the anchor).
    const carriersByBeat = new Map<string, number[]>();
    for (const ep of input.episodes) {
      for (const role of ep.structuralRole || []) {
        if (!isSevenPointBeat(role)) continue;
        const list = carriersByBeat.get(role) || [];
        list.push(ep.episodeNumber);
        carriersByBeat.set(role, list);
      }
    }

    for (const beatKey of Object.keys(anchors)) {
      if (!isSevenPointBeat(beatKey)) continue;
      const beat = beatKey;
      const anchoredEpisode = anchors[beat];
      if (typeof anchoredEpisode !== 'number' || !Number.isFinite(anchoredEpisode)) continue;

      // (1) The anchored episode must exist in the plan.
      const targetEpisode = byNumber.get(anchoredEpisode);
      if (!targetEpisode) {
        issues.push(this.error(
          `Authored Section-7 anchor places beat "${beat}" on Ep${anchoredEpisode}, but the final season has no episode ${anchoredEpisode}.`,
          `season.episodes[${anchoredEpisode}]`,
          'The episode an authored beat was anchored to must survive into the final season — the treatment must not be re-cut.',
        ));
        continue;
      }

      const carriers = carriersByBeat.get(beat) || [];
      const carriedByAnchored = (targetEpisode.structuralRole || []).some(
        (r) => r === beat,
      );

      // (2) The anchored episode must actually carry the beat.
      if (!carriedByAnchored) {
        if (carriers.length === 0) {
          // Warning: the beat dropped off every episode's role array.
          issues.push(this.warning(
            `Authored beat "${beat}" is anchored to Ep${anchoredEpisode} but no episode in the final season carries it.`,
            `season.episodes[${anchoredEpisode}].structuralRole`,
            `Assign structuralRole "${beat}" to episode ${anchoredEpisode} so the authored anchor is honored.`,
          ));
        } else {
          // Blocking: the beat moved to a DIFFERENT episode than authored.
          issues.push(this.error(
            `Authored beat "${beat}" is anchored to Ep${anchoredEpisode}, but the final season places it on Ep${carriers.join(', Ep')} instead — the authored beat→episode anchor was not honored.`,
            `season.episodes[${anchoredEpisode}].structuralRole`,
            `Move beat "${beat}" back onto episode ${anchoredEpisode} (the authored Section-7 anchor is the spine of record).`,
          ));
        }
        continue;
      }

      // (3) The beat must not ALSO appear on a non-anchored episode.
      const strayCarriers = carriers.filter((n) => n !== anchoredEpisode);
      if (strayCarriers.length > 0) {
        issues.push(this.error(
          `Authored beat "${beat}" is anchored to Ep${anchoredEpisode} but ALSO appears on Ep${strayCarriers.join(', Ep')}; an anchored beat must land on exactly one episode.`,
          `season.episodes[${strayCarriers[0]}].structuralRole`,
          `Remove beat "${beat}" from episode${strayCarriers.length > 1 ? 's' : ''} ${strayCarriers.join(', ')} so it lives only on its authored episode ${anchoredEpisode}.`,
        ));
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 25 - warningCount * 5);

    return {
      valid: errorCount === 0,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
