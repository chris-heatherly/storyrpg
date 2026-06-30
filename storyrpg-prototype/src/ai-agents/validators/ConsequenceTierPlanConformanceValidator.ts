import type { Story, ChoiceConsequenceTier } from '../../types';
import type { ConsequenceTier } from '../../types/scenePlan';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

/**
 * Consequence-tier PLAN CONFORMANCE.
 *
 * Season consequence budgets are allocated at plan time onto scenes/encounters.
 * A generated episode should realize its assigned scene tiers; it should never
 * be compared to the whole-season percentage mix by itself.
 */

export interface ConsequenceTierPlanConformanceInput {
  story: Story;
  plannedTiersByScene: Record<string, ConsequenceTier>;
}

const CANONICAL_CHOICE_TIER: Record<ChoiceConsequenceTier, ConsequenceTier> = {
  callback: 'callback',
  sceneTint: 'tint',
  branchlet: 'branchlet',
  structuralBranch: 'branch',
};

function normalizeChoiceTier(tier: unknown, hasRouting: boolean): ConsequenceTier | undefined {
  if (tier && typeof tier === 'string' && tier in CANONICAL_CHOICE_TIER) {
    return CANONICAL_CHOICE_TIER[tier as ChoiceConsequenceTier];
  }
  return hasRouting ? 'branchlet' : undefined;
}

function rank(tier: ConsequenceTier): number {
  return ['callback', 'tint', 'branchlet', 'branch'].indexOf(tier);
}

interface SceneTier {
  episodeNumber: number;
  sceneId: string;
  tiers: ConsequenceTier[];
}

function collectSceneTiers(story: Story): SceneTier[] {
  const out: SceneTier[] = [];
  for (const episode of story.episodes || []) {
    if (typeof episode.number !== 'number') continue;
    for (const scene of episode.scenes || []) {
      const tiers: ConsequenceTier[] = [];
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          const tier = normalizeChoiceTier(choice.consequenceTier, Boolean(choice.nextSceneId));
          if (tier) tiers.push(tier);
        }
      }
      if (tiers.length > 0) out.push({ episodeNumber: episode.number, sceneId: scene.id, tiers });
    }
  }
  return out;
}

export class ConsequenceTierPlanConformanceValidator extends BaseValidator {
  constructor() {
    super('ConsequenceTierPlanConformanceValidator');
  }

  validate(input: ConsequenceTierPlanConformanceInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const sceneTiers = collectSceneTiers(input.story);

    for (const scene of sceneTiers) {
      const planned = input.plannedTiersByScene[scene.sceneId];
      if (!planned) continue;

      const strongest = scene.tiers.reduce(
        (best, tier) => (rank(tier) > rank(best) ? tier : best),
        scene.tiers[0],
      );

      if (rank(strongest) < rank(planned)) {
        issues.push(this.warning(
          `Scene "${scene.sceneId}" (episode ${scene.episodeNumber}) was assigned consequence tier "${planned}" by the season plan, but generated only "${strongest}" choice consequences.`,
          `ep${scene.episodeNumber}:${scene.sceneId}`,
          `Raise this scene's central choice consequences to the planned "${planned}" tier, or revise the season plan allocation before generation.`,
        ));
      }
    }

    return {
      valid: true,
      score: Math.max(0, 100 - issues.length * 8),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
