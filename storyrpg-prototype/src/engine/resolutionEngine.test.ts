import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeEffectiveStat,
  computeOverlap,
  normalizeStatCheck,
  resolveStatCheck,
  calculateSuccessChance,
  computeEncounterWeights,
  applyUseBasedGrowth,
  ResolutionTracker,
  computeSkillCeiling,
} from './resolutionEngine';
import { computeIdentityGrowth } from './identityEngine';
import { buildGrowthTemplates, type GrowthCurveEntry } from './growthConsequenceBuilder';
import {
  validateAttributeCoverage,
  validateGrowthDifficultySequence,
} from '../ai-agents/validators/ChoiceDistributionValidator';
import type { PlayerState, IdentityProfile } from '../types';

function createPlayer(overrides?: Partial<PlayerState>): PlayerState {
  return {
    characterName: 'Test',
    characterPronouns: 'they/them',
    attributes: {
      charm: 50,
      wit: 50,
      courage: 50,
      empathy: 50,
      resolve: 50,
      resourcefulness: 50,
    },
    skills: {},
    relationships: {},
    flags: {},
    scores: {},
    tags: new Set() as any,
    identityProfile: {
      mercy_justice: 0,
      idealism_pragmatism: 0,
      cautious_bold: 0,
      loner_leader: 0,
      heart_head: 0,
      honest_deceptive: 0,
    },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// computeEffectiveStat
// -----------------------------------------------------------------------

describe('computeEffectiveStat', () => {
  it('returns weighted blend when skill is defined and untrained', () => {
    const player = createPlayer();
    // persuasion: charm*0.5 + empathy*0.3 + wit*0.2 = 25+15+10 = 50 ceiling
    // untrained default = 50 * 0.7 = 35
    const result = computeEffectiveStat(player, 'persuasion');
    expect(result).toBe(35);
  });

  it('returns trained value when skill is trained below ceiling', () => {
    const player = createPlayer({ skills: { persuasion: 40 } });
    const result = computeEffectiveStat(player, 'persuasion');
    expect(result).toBe(40);
  });

  it('caps at attribute ceiling when trained exceeds ceiling', () => {
    const player = createPlayer({ skills: { persuasion: 70 } });
    // ceiling is 50 with all attributes at 50
    const result = computeEffectiveStat(player, 'persuasion');
    expect(result).toBe(50);
  });

  it('unknown skill falls back to 50 + skill bonus', () => {
    const player = createPlayer({ skills: { custom_skill: 10 } });
    const result = computeEffectiveStat(player, 'custom_skill');
    expect(result).toBe(60);
  });

  it('ceiling rises with higher attributes', () => {
    const player = createPlayer({
      attributes: { charm: 80, wit: 50, courage: 50, empathy: 70, resolve: 50, resourcefulness: 50 },
      skills: { persuasion: 100 },
    });
    // ceiling: 80*0.5 + 70*0.3 + 50*0.2 = 40+21+10 = 71
    const result = computeEffectiveStat(player, 'persuasion');
    expect(result).toBe(71);
  });
});

// -----------------------------------------------------------------------
// computeSkillCeiling
// -----------------------------------------------------------------------

describe('computeSkillCeiling', () => {
  it('computes ceiling independent of training', () => {
    const player = createPlayer();
    const ceiling = computeSkillCeiling(player, 'persuasion');
    expect(ceiling).toBe(50); // 50*0.5 + 50*0.3 + 50*0.2
  });
});

// -----------------------------------------------------------------------
// computeOverlap
// -----------------------------------------------------------------------

describe('computeOverlap', () => {
  it('single-skill geometry returns effective stat', () => {
    const player = createPlayer({ skills: { persuasion: 40 } });
    const result = computeOverlap(player, { persuasion: 1.0 });
    expect(result).toBe(40);
  });

  it('multi-skill geometry returns weighted sum', () => {
    const player = createPlayer({
      skills: { persuasion: 40, perception: 30, deception: 35 },
    });
    // persuasion eff: min(40, 50) = 40
    // perception eff: min(30, 50) = 30
    // deception eff: min(35, 50) = 35
    const result = computeOverlap(player, { persuasion: 0.5, perception: 0.3, deception: 0.2 });
    expect(result).toBe(40 * 0.5 + 30 * 0.3 + 35 * 0.2); // 20+9+7=36
  });
});

// -----------------------------------------------------------------------
// normalizeStatCheck
// -----------------------------------------------------------------------

describe('normalizeStatCheck', () => {
  it('passes through skillWeights format', () => {
    const result = normalizeStatCheck({
      skillWeights: { persuasion: 0.5, perception: 0.5 },
      difficulty: 55,
    });
    expect(result.skillWeights).toEqual({ persuasion: 0.5, perception: 0.5 });
    expect(result.difficulty).toBe(55);
  });

  it('converts skill-only to { [skill]: 1.0 }', () => {
    const result = normalizeStatCheck({ skill: 'athletics', difficulty: 60 });
    expect(result.skillWeights).toEqual({ athletics: 1.0 });
  });

  it('converts attribute-only via ATTRIBUTE_TO_SKILL', () => {
    const result = normalizeStatCheck({ attribute: 'courage', difficulty: 50 });
    expect(result.skillWeights).toEqual({ athletics: 1.0 });
  });

  it('falls back to survival for empty check', () => {
    const result = normalizeStatCheck({ difficulty: 50 });
    expect(result.skillWeights).toEqual({ survival: 1.0 });
  });
});

// -----------------------------------------------------------------------
// resolveStatCheck
// -----------------------------------------------------------------------

describe('resolveStatCheck', () => {
  it('returns a valid ResolutionResult with tier, roll, target, margin', () => {
    const player = createPlayer({ skills: { persuasion: 40 } });
    const result = resolveStatCheck(player, {
      skillWeights: { persuasion: 1.0 },
      difficulty: 50,
    });
    expect(['success', 'complicated', 'failure']).toContain(result.tier);
    expect(typeof result.roll).toBe('number');
    expect(typeof result.target).toBe('number');
    expect(typeof result.margin).toBe('number');
    expect(typeof result.narrativeText).toBe('string');
  });

  it('populates weakestContributor on failure', () => {
    const player = createPlayer();
    let failureResult;
    for (let i = 0; i < 200; i++) {
      const result = resolveStatCheck(player, {
        skillWeights: { persuasion: 0.5, athletics: 0.5 },
        difficulty: 95,
      });
      if (result.tier === 'failure') {
        failureResult = result;
        break;
      }
    }
    if (failureResult) {
      expect(failureResult.weakestContributor).toBeDefined();
      expect(typeof failureResult.weakestContributor!.skill).toBe('string');
      expect(typeof failureResult.weakestContributor!.effective).toBe('number');
      expect(typeof failureResult.weakestContributor!.ceiling).toBe('number');
    }
  });
});

// -----------------------------------------------------------------------
// ResolutionTracker
// -----------------------------------------------------------------------

describe('ResolutionTracker', () => {
  let tracker: ResolutionTracker;
  beforeEach(() => { tracker = new ResolutionTracker(); });

  it('starts with zero consecutive failures and no bonus', () => {
    expect(tracker.getConsecutiveFailures()).toBe(0);
    expect(tracker.getStreakBonus()).toBe(0);
  });

  it('tracks consecutive failures', () => {
    tracker.recordOutcome('failure');
    tracker.recordOutcome('failure');
    expect(tracker.getConsecutiveFailures()).toBe(2);
    expect(tracker.getStreakBonus()).toBe(15);
  });

  it('gives 25 bonus after 3+ failures', () => {
    tracker.recordOutcome('failure');
    tracker.recordOutcome('failure');
    tracker.recordOutcome('failure');
    expect(tracker.getStreakBonus()).toBe(25);
  });

  it('resets on non-failure outcome', () => {
    tracker.recordOutcome('failure');
    tracker.recordOutcome('failure');
    tracker.recordOutcome('success');
    expect(tracker.getConsecutiveFailures()).toBe(0);
    expect(tracker.getStreakBonus()).toBe(0);
  });

  it('reset() clears state', () => {
    tracker.recordOutcome('failure');
    tracker.recordOutcome('failure');
    tracker.reset();
    expect(tracker.getConsecutiveFailures()).toBe(0);
  });
});

// -----------------------------------------------------------------------
// applyUseBasedGrowth
// -----------------------------------------------------------------------

describe('applyUseBasedGrowth', () => {
  it('grows skills proportional to weights and tier', () => {
    const player = createPlayer();
    applyUseBasedGrowth(player, { persuasion: 0.7, perception: 0.3 }, 'success');
    // success multiplier = 2, so persuasion gets round(0.7*2) = 1, perception gets round(0.3*2) = 1
    expect(player.skills.persuasion).toBe(1);
    expect(player.skills.perception).toBe(1);
  });

  it('success grows more than failure', () => {
    const p1 = createPlayer();
    const p2 = createPlayer();
    applyUseBasedGrowth(p1, { athletics: 1.0 }, 'success');
    applyUseBasedGrowth(p2, { athletics: 1.0 }, 'failure');
    expect(p1.skills.athletics).toBeGreaterThan(p2.skills.athletics);
  });

  it('accumulates growth across multiple checks', () => {
    const player = createPlayer();
    applyUseBasedGrowth(player, { athletics: 1.0 }, 'success');
    applyUseBasedGrowth(player, { athletics: 1.0 }, 'success');
    expect(player.skills.athletics).toBe(4); // 2+2
  });
});

// -----------------------------------------------------------------------
// computeIdentityGrowth
// -----------------------------------------------------------------------

describe('computeIdentityGrowth', () => {
  it('returns empty for small identity shifts', () => {
    const previous: IdentityProfile = {
      mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0,
      loner_leader: 0, heart_head: 0, honest_deceptive: 0,
    };
    const current: IdentityProfile = { ...previous, cautious_bold: 5 };
    const growth = computeIdentityGrowth(current, previous);
    expect(Object.keys(growth)).toHaveLength(0);
  });

  it('grows positive attribute when dimension shifts +10 or more', () => {
    const previous: IdentityProfile = {
      mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0,
      loner_leader: 0, heart_head: 0, honest_deceptive: 0,
    };
    const current: IdentityProfile = { ...previous, cautious_bold: 15 };
    const growth = computeIdentityGrowth(current, previous);
    // cautious_bold positive = courage
    expect(growth.courage).toBe(1);
  });

  it('grows negative attribute when dimension shifts -10 or more', () => {
    const previous: IdentityProfile = {
      mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0,
      loner_leader: 0, heart_head: 0, honest_deceptive: 0,
    };
    const current: IdentityProfile = { ...previous, cautious_bold: -20 };
    const growth = computeIdentityGrowth(current, previous);
    // cautious_bold negative = wit
    expect(growth.wit).toBe(2);
  });

  it('caps attribute growth at 3', () => {
    const previous: IdentityProfile = {
      mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0,
      loner_leader: 0, heart_head: 0, honest_deceptive: 0,
    };
    const current: IdentityProfile = { ...previous, cautious_bold: 50 };
    const growth = computeIdentityGrowth(current, previous);
    expect(growth.courage).toBe(3);
  });
});

// -----------------------------------------------------------------------
// GrowthConsequenceBuilder
// -----------------------------------------------------------------------

describe('buildGrowthTemplates', () => {
  it('produces skill options from focus skills', () => {
    const entry: GrowthCurveEntry = {
      episodeNumber: 1,
      focusSkills: ['persuasion', 'perception'],
      developmentScene: 'Test scene',
    };
    const result = buildGrowthTemplates(entry, 1, 8);
    expect(result.skillOptions).toHaveLength(2);
    expect(result.skillOptions[0].skill).toBe('persuasion');
    expect(result.skillOptions[0].change).toBeGreaterThanOrEqual(5);
    expect(result.skillOptions[0].change).toBeLessThanOrEqual(8);
  });

  it('produces mentorship when available', () => {
    const entry: GrowthCurveEntry = {
      episodeNumber: 3,
      focusSkills: ['athletics'],
      developmentScene: 'Training scene',
      mentorshipOpportunity: {
        npcId: 'marcus',
        npcName: 'Marcus',
        requiredRelationship: { dimension: 'respect', threshold: 60 },
        attribute: 'courage',
        narrativeHook: 'Marcus offers to train you',
      },
    };
    const result = buildGrowthTemplates(entry, 3, 8);
    expect(result.mentorship).toBeDefined();
    expect(result.mentorship!.attribute).toBe('courage');
    expect(result.mentorship!.change).toBeGreaterThanOrEqual(3);
    expect(result.mentorship!.change).toBeLessThanOrEqual(5);
  });

  it('scales growth with episode progression', () => {
    const entry: GrowthCurveEntry = {
      episodeNumber: 1,
      focusSkills: ['athletics'],
      developmentScene: 'Test',
    };
    const early = buildGrowthTemplates(entry, 1, 10);
    const late = buildGrowthTemplates({ ...entry, episodeNumber: 10 }, 10, 10);
    expect(late.skillOptions[0].change).toBeGreaterThanOrEqual(early.skillOptions[0].change);
  });
});

// -----------------------------------------------------------------------
// calculateSuccessChance
// -----------------------------------------------------------------------

describe('calculateSuccessChance', () => {
  it('returns higher chance for skilled player', () => {
    const skilled = createPlayer({ skills: { persuasion: 80 }, attributes: { charm: 90, wit: 50, courage: 50, empathy: 80, resolve: 50, resourcefulness: 50 } });
    const unskilled = createPlayer();
    const check = { skillWeights: { persuasion: 1.0 }, difficulty: 50 };
    const chanceSk = calculateSuccessChance(skilled, check);
    const chanceUs = calculateSuccessChance(unskilled, check);
    expect(chanceSk).toBeGreaterThan(chanceUs);
  });

  it('returns lower chance for higher difficulty', () => {
    const player = createPlayer({ skills: { persuasion: 40 } });
    const easy = calculateSuccessChance(player, { skillWeights: { persuasion: 1.0 }, difficulty: 30 });
    const hard = calculateSuccessChance(player, { skillWeights: { persuasion: 1.0 }, difficulty: 80 });
    expect(easy).toBeGreaterThan(hard);
  });

  it('clamps result to 0-100 range', () => {
    const player = createPlayer();
    const extremeEasy = calculateSuccessChance(player, { skillWeights: { persuasion: 1.0 }, difficulty: -50 });
    const extremeHard = calculateSuccessChance(player, { skillWeights: { persuasion: 1.0 }, difficulty: 200 });
    expect(extremeEasy).toBeLessThanOrEqual(100);
    expect(extremeEasy).toBeGreaterThanOrEqual(0);
    expect(extremeHard).toBeLessThanOrEqual(100);
    expect(extremeHard).toBeGreaterThanOrEqual(0);
  });

  it('works with legacy attribute format', () => {
    const player = createPlayer({ attributes: { charm: 80, wit: 50, courage: 50, empathy: 50, resolve: 50, resourcefulness: 50 } });
    const chance = calculateSuccessChance(player, { attribute: 'charm', difficulty: 50 });
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThanOrEqual(100);
  });
});

// -----------------------------------------------------------------------
// computeEncounterWeights
// -----------------------------------------------------------------------

describe('computeEncounterWeights', () => {
  it('returns base split when no skill and no bonus', () => {
    const player = createPlayer();
    const weights = computeEncounterWeights(player);
    expect(weights.success).toBeCloseTo(0.40, 2);
    expect(weights.complicated).toBeCloseTo(0.35, 2);
    expect(weights.failure).toBeCloseTo(0.25, 2);
  });

  it('shifts toward success for high-stat player', () => {
    const player = createPlayer({
      attributes: { charm: 90, wit: 50, courage: 50, empathy: 80, resolve: 50, resourcefulness: 50 },
      skills: { persuasion: 80 },
    });
    const weights = computeEncounterWeights(player, 'persuasion');
    expect(weights.success).toBeGreaterThan(0.40);
    expect(weights.failure).toBeLessThan(0.25);
  });

  it('shifts toward failure for low-stat player', () => {
    const player = createPlayer({
      attributes: { charm: 20, wit: 20, courage: 20, empathy: 20, resolve: 20, resourcefulness: 20 },
    });
    const weights = computeEncounterWeights(player, 'persuasion');
    expect(weights.success).toBeLessThan(0.40);
    expect(weights.failure).toBeGreaterThan(0.25);
  });

  it('sums to approximately 1.0', () => {
    const player = createPlayer({ skills: { athletics: 60 } });
    const weights = computeEncounterWeights(player, 'athletics', 10);
    expect(weights.success + weights.complicated + weights.failure).toBeCloseTo(1.0, 5);
  });

  it('complicated never drops below 0.10', () => {
    const player = createPlayer({
      attributes: { charm: 100, wit: 100, courage: 100, empathy: 100, resolve: 100, resourcefulness: 100 },
      skills: { athletics: 100 },
    });
    const weights = computeEncounterWeights(player, 'athletics', 50);
    expect(weights.complicated).toBeGreaterThanOrEqual(0.10);
  });
});

// -----------------------------------------------------------------------
// Attribute Coverage Validator
// -----------------------------------------------------------------------

describe('validateAttributeCoverage', () => {
  it('warns when few attributes are covered', () => {
    // Only persuasion checks -> only charm, empathy, wit get exercise
    const checks = [
      { skillWeights: { persuasion: 1.0 } },
      { skillWeights: { persuasion: 1.0 } },
    ];
    const { warnings } = validateAttributeCoverage(checks);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('no warning when diverse skills are checked', () => {
    const checks = [
      { skillWeights: { persuasion: 0.5, athletics: 0.5 } as Record<string, number> },
      { skillWeights: { investigation: 0.5, survival: 0.5 } as Record<string, number> },
      { skillWeights: { stealth: 0.5, intimidation: 0.5 } as Record<string, number> },
    ];
    const { warnings } = validateAttributeCoverage(checks);
    expect(warnings).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// Growth-Difficulty Sequence Validator
// -----------------------------------------------------------------------

describe('validateGrowthDifficultySequence', () => {
  it('flags hard check with no preceding growth scene', () => {
    const scenes = [
      { id: 'scene-1', name: 'Intro', leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'Hard Fight', encounterDifficulty: 65 },
    ];
    const issues = validateGrowthDifficultySequence(scenes);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('Hard Fight');
  });

  it('passes when growth scene precedes hard check', () => {
    const scenes = [
      { id: 'scene-1', name: 'Training', choicePoint: { consequenceDomain: 'resource' }, leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'Hard Fight', encounterDifficulty: 65 },
    ];
    const issues = validateGrowthDifficultySequence(scenes);
    expect(issues).toHaveLength(0);
  });

  it('passes for easy checks without growth', () => {
    const scenes = [
      { id: 'scene-1', name: 'Intro', leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'Easy Check', encounterDifficulty: 40 },
    ];
    const issues = validateGrowthDifficultySequence(scenes);
    expect(issues).toHaveLength(0);
  });
});
