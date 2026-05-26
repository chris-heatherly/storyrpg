import type { Choice, PlayerState } from '../../types';
import { SKILL_DEFINITIONS } from '../../constants/pipeline';
import { calculateOutcomeChances, normalizeStatCheck } from '../../engine/resolutionEngine';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface StatCheckBalanceChoice extends Choice {
  sceneId?: string;
  beatId?: string;
  episodeTier?: string;
}

export interface StatCheckBalanceInput {
  choices: StatCheckBalanceChoice[];
  episodeTier?: string;
  allowGenreNarrowSkillFocus?: boolean;
}

export interface StatCheckBalanceResult extends ValidationResult {
  metrics: {
    checkedChoices: number;
    hardChecks: number;
    unsupportedHardChecks: number;
  };
}

const DIFFICULTY_BY_TIER: Record<string, [number, number]> = {
  introduction: [35, 50],
  hook: [35, 50],
  rising: [40, 60],
  plotTurn1: [40, 60],
  pinch1: [45, 65],
  peak: [55, 70],
  midpoint: [55, 70],
  pinch2: [55, 72],
  falling: [45, 65],
  finale: [60, 80],
  climax: [60, 80],
  resolution: [35, 60],
};

export class StatCheckBalanceValidator extends BaseValidator {
  constructor() {
    super('StatCheckBalanceValidator');
  }

  validate(input: StatCheckBalanceInput): StatCheckBalanceResult {
    const issues: ValidationIssue[] = [];
    let checkedChoices = 0;
    let hardChecks = 0;
    let unsupportedHardChecks = 0;

    for (const choice of input.choices) {
      if (!choice.statCheck) continue;
      checkedChoices++;

      const location = [choice.sceneId, choice.beatId, choice.id].filter(Boolean).join(':') || choice.id;
      const normalized = normalizeStatCheck(choice.statCheck);
      const weightTotal = Object.values(normalized.skillWeights).reduce((sum, value) => sum + value, 0);

      if (Math.abs(weightTotal - 1) > 0.01) {
        issues.push(this.error(
          `Stat check "${choice.id}" has skillWeights totaling ${weightTotal.toFixed(2)} instead of 1.0.`,
          location,
          'Normalize skillWeights so the challenge geometry sums to 1.0.',
        ));
      }

      for (const skill of Object.keys(normalized.skillWeights)) {
        if (!SKILL_DEFINITIONS[skill.toLowerCase()]) {
          issues.push(this.warning(
            `Stat check "${choice.id}" uses unknown skill "${skill}".`,
            location,
            'Use a canonical skill or explicitly add the skill definition before relying on it for balance.',
          ));
        }
      }

      if (normalized.difficulty < 35 || normalized.difficulty > 80) {
        issues.push(this.error(
          `Stat check "${choice.id}" difficulty ${normalized.difficulty} is outside the narrative-generous 35-80 band.`,
          location,
          'Tune difficulty into the supported band; use prepared advantage or failure residue for extra pressure.',
        ));
      }

      const tier = choice.episodeTier || input.episodeTier;
      const expectedBand = tier ? DIFFICULTY_BY_TIER[tier] : undefined;
      if (expectedBand && (normalized.difficulty < expectedBand[0] || normalized.difficulty > expectedBand[1])) {
        issues.push(this.warning(
          `Stat check "${choice.id}" difficulty ${normalized.difficulty} is outside expected ${tier} band ${expectedBand[0]}-${expectedBand[1]}.`,
          location,
          'Match difficulty to the episode structure unless this is an intentional payoff or recovery moment.',
        ));
      }

      const supportCount = countSupportMechanisms(choice);
      if (normalized.difficulty > 60) {
        hardChecks++;
        if (supportCount < 1) {
          unsupportedHardChecks++;
          issues.push(this.warning(
            `Hard stat check "${choice.id}" has no prepared advantage, growth/recovery route, or playable failure support.`,
            location,
            'Add a modifier, failureResidue, route impact, delayed consequence, or explicit recovery hook.',
          ));
        }
      }

      if (normalized.difficulty > 70 && supportCount < 2) {
        unsupportedHardChecks++;
        issues.push(this.error(
          `Extreme stat check "${choice.id}" needs at least two support mechanisms.`,
          location,
          'Pair extreme checks with prior leverage plus playable failure, alternate routing, or delayed consequence.',
        ));
      }

      const neutral = standardProfile('neutral');
      const focused = focusedProfileFor(normalized.skillWeights);
      const neutralChances = calculateOutcomeChances(neutral, normalized);
      const focusedChances = calculateOutcomeChances(focused, normalized);

      if (neutralChances.failure > 0.35 && normalized.difficulty <= 70) {
        issues.push(this.warning(
          `Neutral profile failure chance for "${choice.id}" is ${(neutralChances.failure * 100).toFixed(0)}%, high for narrative-generous play.`,
          location,
          'Lower difficulty, add prepared advantage, or ensure the failure route produces playable story.',
        ));
      }

      if (focusedChances.success - neutralChances.success < 0.08) {
        issues.push(this.warning(
          `Focused investment barely changes success odds for "${choice.id}".`,
          location,
          'Check skillWeights and difficulty so player build has a noticeable but hidden effect.',
        ));
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;

    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 25 - warnings * 7),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: { checkedChoices, hardChecks, unsupportedHardChecks },
    };
  }
}

function countSupportMechanisms(choice: Choice): number {
  let count = 0;
  if ((choice.statCheck?.modifiers?.length ?? 0) > 0) count++;
  if (choice.failureResidue?.description?.trim()) count++;
  if ((choice.delayedConsequences?.length ?? 0) > 0) count++;
  if ((choice.residueHints?.length ?? 0) > 0) count++;
  if ((choice.consequences?.length ?? 0) > 0) count++;
  if (choice.nextSceneId || choice.nextBeatId || choice.memorableMoment) count++;
  if (choice.outcomeTexts?.failure?.trim()) count++;
  return count;
}

function standardProfile(profile: 'neutral' | 'undertrained' | 'lateBalanced'): PlayerState {
  const base = profile === 'undertrained' ? 45 : profile === 'lateBalanced' ? 65 : 50;
  return {
    characterName: 'Balance Profile',
    characterPronouns: 'they/them',
    attributes: {
      charm: base,
      wit: base,
      courage: base,
      empathy: base,
      resolve: base,
      resourcefulness: base,
    },
    skills: profile === 'lateBalanced'
      ? { athletics: 60, stealth: 60, perception: 60, persuasion: 60, intimidation: 60, deception: 60, investigation: 60, survival: 60 }
      : {},
    relationships: {},
    flags: {},
    scores: {},
    tags: new Set(),
    identityProfile: { mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0, loner_leader: 0, heart_head: 0, honest_deceptive: 0 },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
  };
}

function focusedProfileFor(skillWeights: Record<string, number>): PlayerState {
  const player = standardProfile('neutral');
  const topSkills = Object.entries(skillWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([skill]) => skill);

  player.attributes = {
    charm: 65,
    wit: 65,
    courage: 65,
    empathy: 65,
    resolve: 65,
    resourcefulness: 65,
  };
  player.skills = Object.fromEntries(topSkills.map((skill) => [skill, 70]));
  return player;
}
