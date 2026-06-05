/**
 * Treatment guidance synthesizer (from-scratch path).
 *
 * Scene-first planning consumes treatment-shaped episode guidance (act/arc
 * labels, per-episode turns, synopsis) when it builds the scene spine. Authored
 * treatments carry that directly; from-scratch runs do not. Rather than keeping
 * two downstream code paths, this fills MISSING {@link TreatmentEpisodeGuidance}
 * on each episode from data the season plan already derived — so the scene
 * builder (and any other treatment-consuming code) sees one uniform shape
 * regardless of source.
 *
 * It only ever fills gaps: an episode that already has authored
 * `treatmentGuidance` is left untouched.
 */

import type { SeasonPlan } from '../../types/seasonPlan';
import type { TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';

/**
 * Fill missing per-episode treatment guidance on a season plan, in place.
 * Returns the number of episodes whose guidance was synthesized.
 */
export function synthesizeTreatmentGuidance(plan: SeasonPlan): number {
  let synthesized = 0;

  for (const ep of plan.episodes) {
    if (ep.treatmentGuidance) continue;

    // Arc this episode belongs to (for act/arc labels).
    const arc = plan.arcs?.find(
      (a) => ep.episodeNumber >= a.episodeRange.start && ep.episodeNumber <= a.episodeRange.end,
    );

    // Per-episode turns from the plot points targeted at this episode.
    const turns = (ep.plotPoints ?? [])
      .filter((p) => p.targetEpisode === ep.episodeNumber)
      .map((p) => p.description)
      .filter((d): d is string => Boolean(d && d.trim()));

    const guidance: TreatmentEpisodeGuidance = {
      authoredTitle: ep.title,
      arcLabel: arc?.name,
      actLabel: arc ? `Act covering episodes ${arc.episodeRange.start}-${arc.episodeRange.end}` : undefined,
      normalizedStructuralRoles: ep.structuralRole,
      synopsis: ep.synopsis,
      episodeTurns: turns.length > 0 ? turns : undefined,
    };

    ep.treatmentGuidance = guidance;
    synthesized += 1;
  }

  return synthesized;
}
