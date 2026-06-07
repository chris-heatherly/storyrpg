/**
 * Season-level skill plan (P2-skills).
 *
 * Stat-check skill coverage is a SEASON property, not a per-scene one: the
 * SkillCoverageValidator flags a season that exercises <6 of the 8 canonical
 * skills or lets one skill carry >30% of stat-check weight. The audited run used
 * only 4/8 skills with perception at ~40%, because most stat-checks are authored
 * freely by the LLM (which favours perception) and the deterministic auto-assign
 * only fills choices that have no check at all.
 *
 * This module plans, once and up front, which skills each episode should FAVOUR so
 * that across the whole season all eight are exercised and no one skill dominates.
 * ChoiceAuthor consults the per-episode target list when assigning/rebalancing
 * stat-check skills (always staying within a choice type's plausible skill set).
 *
 * Pure + unit-testable. Mirrors seasonChoicePlan.ts.
 */

import { SKILL_DEFINITIONS } from '../../constants/pipeline';

/** The eight canonical skills, in definition order. */
export const CANON_SKILLS: readonly string[] = Object.keys(SKILL_DEFINITIONS);

export interface SeasonSkillPlan {
  /** Ordered priority skill list per episode number (most-favoured first). */
  episodeSkills: Record<number, string[]>;
}

/**
 * Build a per-episode skill priority plan that spreads the eight canonical skills
 * evenly across the season. Each episode receives the full skill list rotated by a
 * per-episode offset, so consecutive episodes lead with different skills and the
 * union across the season covers all eight. The rotation is deterministic (offset =
 * episodeIndex × stride) so the same season always plans the same way.
 */
export function buildSeasonSkillPlan(episodes: number[]): SeasonSkillPlan {
  const ordered = [...new Set(episodes)].sort((a, b) => a - b);
  const n = CANON_SKILLS.length;
  // A stride coprime-ish with n keeps the lead skill moving without short cycles.
  const stride = 3;
  const episodeSkills: Record<number, string[]> = {};
  ordered.forEach((ep, idx) => {
    const offset = (idx * stride) % n;
    episodeSkills[ep] = [...CANON_SKILLS.slice(offset), ...CANON_SKILLS.slice(0, offset)];
  });
  return { episodeSkills };
}

/** The favoured skill order for an episode (empty if the episode isn't planned). */
export function skillsForEpisode(plan: SeasonSkillPlan | undefined, episode: number): string[] {
  return plan?.episodeSkills[episode] ?? [];
}
