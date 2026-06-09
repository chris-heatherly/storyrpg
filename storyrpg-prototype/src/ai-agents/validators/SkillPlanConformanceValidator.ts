import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { skillsForEpisode, type SeasonSkillPlan } from '../pipeline/seasonSkillPlan';

/**
 * Skill PLAN CONFORMANCE (G10, L2).
 *
 * Stat-check skill COVERAGE/dominance is a whole-season property. The season skill plan
 * (`buildSeasonSkillPlan`) spreads the 8 canonical skills across episodes and is validated
 * for season coverage at plan time (`validateSeasonSkillPlan`, L1). Measuring a generated
 * K-of-N slice against the season ≥6/8 + <30%-dominance targets is a category error — a
 * 3-episode slice legitimately exercises few skills.
 *
 * This validator does the correct per-episode thing: each GENERATED episode should lean on
 * the skills its season plan STEERED it toward, not collapse back onto an off-plan
 * dominant skill (the audited failure: perception carrying ~40-45% regardless of plan).
 *
 *   For each generated episode E with stat checks: if one skill carries more than
 *   `dominanceThreshold` of the episode's stat-check weight AND that skill is NOT in E's
 *   planned favoured lead (`skillsForEpisode(plan, E)` top-`leadN`), flag it. No season-
 *   wide ≥6/8 judgment here — that's L1's job.
 *
 * Deterministic, no LLM. Pure.
 */

const DEFAULT_LEAD_N = 4;            // how many of the episode's favoured skills count as "on-plan lead"
const DEFAULT_DOMINANCE = 0.4;       // a skill carrying >40% of an episode's stat-check weight is "dominant"

export interface SkillPlanConformanceInput {
  story: Story;
  seasonSkillPlan: SeasonSkillPlan;
  leadN?: number;
  dominanceThreshold?: number;
}

export class SkillPlanConformanceValidator extends BaseValidator {
  constructor() {
    super('SkillPlanConformanceValidator');
  }

  validate(input: SkillPlanConformanceInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const leadN = input.leadN ?? DEFAULT_LEAD_N;
    const dominance = input.dominanceThreshold ?? DEFAULT_DOMINANCE;

    for (const episode of input.story.episodes || []) {
      if (typeof episode.number !== 'number') continue;
      const favoured = skillsForEpisode(input.seasonSkillPlan, episode.number);
      if (favoured.length === 0) continue; // no plan for this episode
      const leadSet = new Set(favoured.slice(0, leadN).map((s) => s.toLowerCase()));

      // Aggregate stat-check skill weight across the episode's choices.
      const weights: Record<string, number> = {};
      let total = 0;
      for (const scene of episode.scenes || []) {
        for (const beat of scene.beats || []) {
          for (const choice of beat.choices || []) {
            const sw = choice.statCheck?.skillWeights;
            if (!sw) continue;
            for (const [skill, w] of Object.entries(sw)) {
              if (typeof w !== 'number' || w <= 0) continue;
              const k = skill.toLowerCase();
              weights[k] = (weights[k] ?? 0) + w;
              total += w;
            }
          }
        }
      }
      if (total <= 0) continue;

      const [dominantSkill, dominantWeight = 0] = Object.entries(weights).sort((a, b) => b[1] - a[1])[0] ?? [];
      const share = dominantWeight / total;
      if (dominantSkill && share > dominance && !leadSet.has(dominantSkill)) {
        issues.push(this.warning(
          `Episode ${episode.number} leans on "${dominantSkill}" (${(share * 100).toFixed(0)}% of stat-check weight), which is off the skills its season plan favoured for this episode (${favoured.slice(0, leadN).join(', ')}). The episode ignored its skill-rotation plan.`,
          `ep${episode.number}`,
          `Rebalance this episode's stat checks toward its planned skills (${favoured.slice(0, leadN).join(', ')}); ChoiceAuthor.rebalanceStatCheckSkills should steer off "${dominantSkill}".`,
        ));
      }
    }

    return {
      valid: true, // advisory by nature; gating handled by the caller
      score: Math.max(0, 100 - issues.length * 10),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
