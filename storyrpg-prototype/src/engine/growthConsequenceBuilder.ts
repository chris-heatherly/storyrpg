import type { PlayerAttributes, ConditionExpression } from '../types';

/**
 * GrowthConsequenceBuilder — deterministic module
 *
 * Takes the season plan's growth curve for the current episode and produces
 * calibrated consequence templates. The ChoiceAuthor wraps these in narrative;
 * the code handles the numbers.
 */

export interface GrowthCurveEntry {
  episodeNumber: number;
  focusSkills: string[];
  developmentScene: string;
  mentorshipOpportunity?: {
    npcId: string;
    npcName: string;
    requiredRelationship: { dimension: string; threshold: number };
    attribute: keyof PlayerAttributes;
    narrativeHook: string;
  } | null;
}

export interface GrowthTemplate {
  skillOptions: Array<{ skill: string; change: number }>;
  mentorship?: {
    attribute: keyof PlayerAttributes;
    change: number;
    npcId: string;
    npcName: string;
    condition: ConditionExpression;
    narrativeHook: string;
  };
}

export function buildGrowthTemplates(
  growthCurve: GrowthCurveEntry,
  episodeNumber: number,
  totalEpisodes: number
): GrowthTemplate {
  const progressRatio = totalEpisodes > 1
    ? (episodeNumber - 1) / (totalEpisodes - 1)
    : 0;
  const baseSkillGrowth = Math.round(5 + progressRatio * 3); // 5-8 range
  const baseAttrGrowth = Math.round(3 + progressRatio * 2);  // 3-5 range

  const skillOptions = growthCurve.focusSkills.map(skill => ({
    skill,
    change: baseSkillGrowth,
  }));

  let mentorship: GrowthTemplate['mentorship'];
  if (growthCurve.mentorshipOpportunity) {
    const m = growthCurve.mentorshipOpportunity;
    mentorship = {
      attribute: m.attribute,
      change: baseAttrGrowth,
      npcId: m.npcId,
      npcName: m.npcName,
      condition: {
        type: 'relationship',
        npcId: m.npcId,
        dimension: m.requiredRelationship.dimension,
        operator: '>=',
        value: m.requiredRelationship.threshold,
      } as ConditionExpression,
      narrativeHook: m.narrativeHook,
    };
  }

  return { skillOptions, mentorship };
}
