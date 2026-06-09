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

export interface SeasonSkillPlanCheck {
  valid: boolean;
  issues: string[];
  coveredSkills: number;
}

/**
 * Assert the season skill plan is internally sound — this is the SEASON-level coverage
 * guarantee (L1). Balance is a whole-season property: validate it here over the entire
 * plan, NOT against a generated K-of-N slice (that is a category error). The rotation in
 * {@link buildSeasonSkillPlan} satisfies this by construction; the check is a guard so a
 * future change to the rotation cannot silently regress season coverage.
 *
 *   - the union of episode lead skills across the season covers all 8 canonical skills
 *     (for seasons with ≥8 episodes; for shorter seasons, covers min(episodes, 8));
 *   - no two consecutive planned episodes share a lead skill.
 */
export function validateSeasonSkillPlan(plan: SeasonSkillPlan): SeasonSkillPlanCheck {
  const issues: string[] = [];
  const episodes = Object.keys(plan.episodeSkills)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const leads = new Set<string>();
  let prevLead: string | undefined;
  for (const ep of episodes) {
    const lead = plan.episodeSkills[ep]?.[0];
    if (!lead) continue;
    leads.add(lead);
    if (prevLead && lead === prevLead) {
      issues.push(`Episodes share a consecutive lead skill "${lead}" (episode ${ep}).`);
    }
    prevLead = lead;
  }

  const expectedCoverage = Math.min(episodes.length, CANON_SKILLS.length);
  if (leads.size < expectedCoverage) {
    issues.push(
      `Season lead skills cover only ${leads.size}/${expectedCoverage} expected — the rotation is not spreading skills across the season.`,
    );
  }

  return { valid: issues.length === 0, issues, coveredSkills: leads.size };
}
