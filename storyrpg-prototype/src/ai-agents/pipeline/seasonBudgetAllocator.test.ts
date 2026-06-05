/**
 * Unit tests for the season choice/consequence budget allocator.
 *
 * Covers buildBudgetUnits (which scenes become budgeted units + weighting),
 * allocateChoiceTypes (weighted choice mix, encounter-never-expression,
 * encounters claim non-expression slots first), allocateConsequenceTiers
 * (the per-type/per-kind invariants), and the weighted mixers (an encounter
 * counts triple). The DIET CHECK reproduces the 8-encounter worked example
 * from the design and asserts the weighted mix lands within tolerance.
 */

import { describe, expect, it } from 'vitest';
import {
  buildBudgetUnits,
  allocateChoiceTypes,
  allocateConsequenceTiers,
  weightedChoiceMix,
  weightedConsequenceMix,
} from './seasonBudgetAllocator';
import { SeasonBudgetValidator } from '../validators/SeasonBudgetValidator';
import {
  CHOICE_TYPE_TARGET,
  CONSEQUENCE_TARGET,
  SCENE_BUDGET_WEIGHT,
  ENCOUNTER_BUDGET_WEIGHT,
  BUDGET_TOLERANCE,
} from '../../types/scenePlan';
import type {
  SeasonScenePlan,
  PlannedScene,
  PlannedSceneEncounter,
  ConsequenceTier,
} from '../../types/scenePlan';
import type { ChoiceType } from '../../types/choice';

// ========================================
// FIXTURE BUILDERS
// ========================================

let nextOrder = 0;

function standardScene(opts: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id: opts.id ?? `scene-${nextOrder}`,
    episodeNumber: opts.episodeNumber ?? 1,
    order: opts.order ?? nextOrder++,
    title: opts.title ?? 'A quiet scene',
    dramaticPurpose: 'serve the episode beat',
    narrativeRole: opts.narrativeRole ?? 'development',
    locations: ['town'],
    npcsInvolved: ['ally'],
    setsUp: [],
    paysOff: [],
    ...opts,
    kind: 'standard',
  };
}

function encounterScene(opts: Partial<PlannedScene> = {}): PlannedScene {
  const encounter: PlannedSceneEncounter = {
    type: 'combat',
    difficulty: 'moderate',
    relevantSkills: ['combat'],
    isBranchPoint: false,
    ...(opts.encounter ?? {}),
  };
  return {
    id: opts.id ?? `enc-${nextOrder}`,
    episodeNumber: opts.episodeNumber ?? 1,
    order: opts.order ?? nextOrder++,
    title: opts.title ?? 'A confrontation',
    dramaticPurpose: 'force a stakes-driven choice',
    narrativeRole: opts.narrativeRole ?? 'turn',
    locations: ['arena'],
    npcsInvolved: ['rival'],
    setsUp: [],
    paysOff: [],
    ...opts,
    kind: 'encounter',
    encounter,
  };
}

function scenePlanFrom(scenes: PlannedScene[]): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) {
    (byEpisode[s.episodeNumber] ??= []).push(s.id);
  }
  return { scenes, byEpisode, setupPayoffEdges: [] };
}

// ========================================
// buildBudgetUnits
// ========================================

describe('buildBudgetUnits', () => {
  it('returns encounters (weight 3) plus hasChoice standard scenes (weight 1), skipping choiceless scenes', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'enc-1' });
    const choiceScene = standardScene({ id: 'scn-choice', hasChoice: true });
    const choicelessScene = standardScene({ id: 'scn-quiet', hasChoice: false });
    const undefinedChoiceScene = standardScene({ id: 'scn-undef' });

    const plan = scenePlanFrom([enc, choiceScene, choicelessScene, undefinedChoiceScene]);
    const units = buildBudgetUnits(plan);

    const ids = units.map((u) => u.id);
    expect(ids).toEqual(['enc-1', 'scn-choice']);

    const encUnit = units.find((u) => u.id === 'enc-1')!;
    const sceneUnit = units.find((u) => u.id === 'scn-choice')!;
    expect(encUnit.budgetWeight).toBe(ENCOUNTER_BUDGET_WEIGHT);
    expect(sceneUnit.budgetWeight).toBe(SCENE_BUDGET_WEIGHT);
  });

  it('forces hasChoice=true on encounters even when unset', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'enc-1', hasChoice: undefined });
    const plan = scenePlanFrom([enc]);
    const units = buildBudgetUnits(plan);
    expect(units).toHaveLength(1);
    expect(plan.scenes[0].hasChoice).toBe(true);
  });

  it('preserves plan scene order in the returned units', () => {
    nextOrder = 0;
    const a = standardScene({ id: 'a', order: 0, hasChoice: true });
    const enc = encounterScene({ id: 'b', order: 1 });
    const c = standardScene({ id: 'c', order: 2, hasChoice: true });
    const units = buildBudgetUnits(scenePlanFrom([a, enc, c]));
    expect(units.map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });
});

// ========================================
// allocateChoiceTypes
// ========================================

describe('allocateChoiceTypes', () => {
  it('never assigns expression to an encounter', () => {
    nextOrder = 0;
    const units = buildBudgetUnits(
      scenePlanFrom([
        encounterScene({ id: 'e1' }),
        encounterScene({ id: 'e2' }),
        encounterScene({ id: 'e3' }),
        standardScene({ id: 's1', hasChoice: true }),
        standardScene({ id: 's2', hasChoice: true }),
      ]),
    );
    allocateChoiceTypes(units);
    for (const u of units) {
      if (u.kind === 'encounter') {
        expect(u.choiceType).not.toBe('expression');
        expect(['relationship', 'strategic', 'dilemma']).toContain(u.choiceType);
      }
    }
    // Every unit got a choiceType.
    expect(units.every((u) => Boolean(u.choiceType))).toBe(true);
  });

  it('overrides a pre-authored "expression" on an encounter (invariant wins)', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'e1', choiceType: 'expression' as ChoiceType });
    const units = buildBudgetUnits(scenePlanFrom([enc, standardScene({ id: 's', hasChoice: true })]));
    allocateChoiceTypes(units);
    expect(units[0].choiceType).not.toBe('expression');
  });

  it('respects a valid pre-authored choiceType', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'e1', choiceType: 'dilemma' as ChoiceType });
    const scn = standardScene({ id: 's1', hasChoice: true, choiceType: 'expression' as ChoiceType });
    const units = buildBudgetUnits(scenePlanFrom([enc, scn]));
    allocateChoiceTypes(units);
    expect(units.find((u) => u.id === 'e1')!.choiceType).toBe('dilemma');
    expect(units.find((u) => u.id === 's1')!.choiceType).toBe('expression');
  });

  it('encounters take non-expression slots first; expression lands on standard scenes', () => {
    nextOrder = 0;
    // Many encounters, a few scenes: encounters should absorb relationship/
    // strategic/dilemma, leaving expression entirely to standard scenes.
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 4; i++) scenes.push(encounterScene({ id: `e${i}` }));
    for (let i = 0; i < 6; i++) scenes.push(standardScene({ id: `s${i}`, hasChoice: true }));
    const units = buildBudgetUnits(scenePlanFrom(scenes));
    allocateChoiceTypes(units);

    const expressionUnits = units.filter((u) => u.choiceType === 'expression');
    // All expression units are standard scenes.
    expect(expressionUnits.every((u) => u.kind === 'standard')).toBe(true);
    expect(expressionUnits.length).toBeGreaterThan(0);
  });
});

// ========================================
// weightedChoiceMix — weighting
// ========================================

describe('weightedChoiceMix', () => {
  it('counts an encounter triple (weight 3) and a scene single (weight 1)', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'e1', choiceType: 'strategic', budgetWeight: ENCOUNTER_BUDGET_WEIGHT });
    const scn = standardScene({
      id: 's1',
      hasChoice: true,
      choiceType: 'strategic',
      budgetWeight: SCENE_BUDGET_WEIGHT,
    });
    const mix = weightedChoiceMix([enc, scn]);
    // 3 (encounter) + 1 (scene) = 4 weighted strategic.
    expect(mix.counts.strategic).toBe(4);
    expect(mix.total).toBe(4);
    expect(mix.percentages.strategic).toBeCloseTo(100, 5);
  });

  it('reflects the encounter triple-weight in percentages', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'e1', choiceType: 'relationship', budgetWeight: ENCOUNTER_BUDGET_WEIGHT });
    const scn = standardScene({
      id: 's1',
      hasChoice: true,
      choiceType: 'expression',
      budgetWeight: SCENE_BUDGET_WEIGHT,
    });
    const mix = weightedChoiceMix([enc, scn]);
    expect(mix.counts.relationship).toBe(3);
    expect(mix.counts.expression).toBe(1);
    expect(mix.total).toBe(4);
    expect(mix.percentages.relationship).toBeCloseTo(75, 5);
    expect(mix.percentages.expression).toBeCloseTo(25, 5);
  });
});

// ========================================
// allocateConsequenceTiers — invariants
// ========================================

describe('allocateConsequenceTiers', () => {
  const RANK: Record<ConsequenceTier, number> = { callback: 0, tint: 1, branchlet: 2, branch: 3 };

  it('expression units are always callback', () => {
    nextOrder = 0;
    const units = buildBudgetUnits(
      scenePlanFrom([
        standardScene({ id: 's1', hasChoice: true, choiceType: 'expression' }),
        standardScene({ id: 's2', hasChoice: true, choiceType: 'expression' }),
        standardScene({ id: 's3', hasChoice: true, choiceType: 'strategic' }),
        encounterScene({ id: 'e1', choiceType: 'strategic' }),
      ]),
    );
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.choiceType === 'expression') {
        expect(u.consequenceTier).toBe('callback');
      }
    }
  });

  it('dilemma units are at least branchlet', () => {
    nextOrder = 0;
    const units = buildBudgetUnits(
      scenePlanFrom([
        standardScene({ id: 's1', hasChoice: true, choiceType: 'dilemma' }),
        encounterScene({ id: 'e1', choiceType: 'dilemma' }),
        ...Array.from({ length: 8 }, (_, i) =>
          standardScene({ id: `f${i}`, hasChoice: true, choiceType: 'expression' }),
        ),
      ]),
    );
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.choiceType === 'dilemma') {
        expect(RANK[u.consequenceTier!]).toBeGreaterThanOrEqual(RANK.branchlet);
      }
    }
  });

  it('branch-point encounters are branch or branchlet, never callback', () => {
    nextOrder = 0;
    const units = buildBudgetUnits(
      scenePlanFrom([
        encounterScene({ id: 'e1', choiceType: 'strategic', encounter: {
          type: 'combat', difficulty: 'hard', relevantSkills: ['combat'], isBranchPoint: true,
        } }),
        encounterScene({ id: 'e2', choiceType: 'relationship', encounter: {
          type: 'social', difficulty: 'moderate', relevantSkills: ['persuasion'], isBranchPoint: true,
        } }),
        // Padding so callback budget exists and could (wrongly) leak onto encounters.
        ...Array.from({ length: 20 }, (_, i) =>
          standardScene({ id: `f${i}`, hasChoice: true, choiceType: 'expression' }),
        ),
      ]),
    );
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.kind === 'encounter' && u.encounter?.isBranchPoint) {
        expect(['branch', 'branchlet']).toContain(u.consequenceTier);
        expect(u.consequenceTier).not.toBe('callback');
      }
    }
  });

  it('does not starve a branch-point encounter onto callback even under heavy callback demand', () => {
    nextOrder = 0;
    // A flood of expression scenes saturates the callback budget; the
    // branch-point encounters must still clear callback (their floor is
    // branchlet) rather than absorbing leftover callback weight.
    const units = buildBudgetUnits(
      scenePlanFrom([
        encounterScene({ id: 'e1', choiceType: 'strategic', encounter: {
          type: 'combat', difficulty: 'hard', relevantSkills: ['combat'], isBranchPoint: true,
        } }),
        encounterScene({ id: 'e2', choiceType: 'relationship', encounter: {
          type: 'social', difficulty: 'moderate', relevantSkills: ['persuasion'], isBranchPoint: true,
        } }),
        ...Array.from({ length: 30 }, (_, i) =>
          standardScene({ id: `f${i}`, hasChoice: true, choiceType: 'expression' }),
        ),
      ]),
    );
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.kind === 'encounter') {
        expect(u.consequenceTier).not.toBe('callback');
      }
    }
  });

  it('never lands a NON-branch-point encounter on callback, even under callback flood', () => {
    nextOrder = 0;
    // Non-branch encounters (relationship/strategic) must still floor at
    // branchlet — the validator rejects ANY encounter at 'callback', so the
    // allocator must never emit one regardless of isBranchPoint.
    const units = buildBudgetUnits(
      scenePlanFrom([
        encounterScene({ id: 'e1', choiceType: 'relationship', encounter: {
          type: 'social', difficulty: 'moderate', relevantSkills: ['persuasion'], isBranchPoint: false,
        } }),
        encounterScene({ id: 'e2', choiceType: 'strategic', encounter: {
          type: 'combat', difficulty: 'moderate', relevantSkills: ['combat'], isBranchPoint: false,
        } }),
        ...Array.from({ length: 40 }, (_, i) =>
          standardScene({ id: `f${i}`, hasChoice: true, choiceType: 'expression' }),
        ),
      ]),
    );
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.kind === 'encounter') {
        expect(u.consequenceTier).not.toBe('callback');
        expect(RANK[u.consequenceTier!]).toBeGreaterThanOrEqual(RANK.branchlet);
      }
    }
  });

  it('respects a valid pre-authored tier', () => {
    nextOrder = 0;
    const scn = standardScene({ id: 's1', hasChoice: true, choiceType: 'strategic', consequenceTier: 'branch' });
    const units = buildBudgetUnits(
      scenePlanFrom([scn, ...Array.from({ length: 5 }, (_, i) =>
        standardScene({ id: `f${i}`, hasChoice: true, choiceType: 'expression' }),
      )]),
    );
    allocateConsequenceTiers(units);
    expect(units.find((u) => u.id === 's1')!.consequenceTier).toBe('branch');
  });
});

// ========================================
// weightedConsequenceMix
// ========================================

describe('weightedConsequenceMix', () => {
  it('counts encounter tiers triple', () => {
    nextOrder = 0;
    const enc = encounterScene({ id: 'e1', consequenceTier: 'branch', budgetWeight: ENCOUNTER_BUDGET_WEIGHT });
    const scn = standardScene({
      id: 's1',
      hasChoice: true,
      consequenceTier: 'callback',
      budgetWeight: SCENE_BUDGET_WEIGHT,
    });
    const mix = weightedConsequenceMix([enc, scn]);
    expect(mix.counts.branch).toBe(3);
    expect(mix.counts.callback).toBe(1);
    expect(mix.total).toBe(4);
  });
});

// ========================================
// THE DIET CHECK — 8-encounter worked example
// ========================================

describe('the dramatic diet (worked example)', () => {
  /**
   * Reproduce the design's worked example:
   *   8 encounters at weight 3 with authored roles strategic x3, relationship x2,
   *   dilemma x3 (expression x0) => weighted strategic 9, relationship 6,
   *   dilemma 9 (= 24). Plus ~40 scene choices at weight 1 => season total 64.
   * Target 35/30/20/15 of 64 ~= expression 22, relationship 19, strategic 13,
   * dilemma 10. Encounters supply strategic 9 + dilemma 9 + relationship 6, so
   * scene choices fill the remainder and auto-skew to expression/relationship.
   */
  function buildWorkedPlan(): SeasonScenePlan {
    nextOrder = 0;
    const scenes: PlannedScene[] = [];

    const encounterRoles: ChoiceType[] = [
      'strategic', 'strategic', 'strategic',
      'relationship', 'relationship',
      'dilemma', 'dilemma', 'dilemma',
    ];
    encounterRoles.forEach((role, i) => {
      scenes.push(encounterScene({ id: `enc-${i}`, choiceType: role }));
    });

    // 40 standard choice-scenes, roles left to the allocator.
    for (let i = 0; i < 40; i++) {
      scenes.push(standardScene({ id: `scn-${i}`, hasChoice: true }));
    }
    return scenePlanFrom(scenes);
  }

  it('weighted choice mix lands within tolerance of 35/30/20/15', () => {
    const plan = buildWorkedPlan();
    const units = buildBudgetUnits(plan);

    // Sanity: 8 encounters * 3 + 40 scenes * 1 = 64 weighted total.
    const totalWeight = units.reduce((s, u) => s + (u.budgetWeight ?? 0), 0);
    expect(totalWeight).toBe(64);

    allocateChoiceTypes(units);
    const mix = weightedChoiceMix(units);
    expect(mix.total).toBe(64);

    for (const key of ['expression', 'relationship', 'strategic', 'dilemma'] as const) {
      const drift = Math.abs(mix.percentages[key] - CHOICE_TYPE_TARGET[key]);
      expect(drift).toBeLessThanOrEqual(BUDGET_TOLERANCE.error);
    }
  });

  it('encounters supply the strategic/dilemma load; standard scenes skew expression/relationship', () => {
    const plan = buildWorkedPlan();
    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);

    const encounters = units.filter((u) => u.kind === 'encounter');
    const scenes = units.filter((u) => u.kind === 'standard');

    // No encounter is expression.
    expect(encounters.every((u) => u.choiceType !== 'expression')).toBe(true);

    // Standard scenes lean expression + relationship: a clear majority of
    // scene-choice weight is one of those two "softer" types.
    const sceneSoft = scenes.filter(
      (u) => u.choiceType === 'expression' || u.choiceType === 'relationship',
    ).length;
    expect(sceneSoft / scenes.length).toBeGreaterThan(0.5);

    // Expression weight overall is the largest single block (diet skews soft).
    const mix = weightedChoiceMix(units);
    expect(mix.counts.expression).toBeGreaterThanOrEqual(mix.counts.relationship);
    expect(mix.counts.expression).toBeGreaterThanOrEqual(mix.counts.strategic);
    expect(mix.counts.expression).toBeGreaterThanOrEqual(mix.counts.dilemma);
  });

  it('weighted consequence mix lands within tolerance of the unified target', () => {
    const plan = buildWorkedPlan();
    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);
    allocateConsequenceTiers(units);

    const mix = weightedConsequenceMix(units);
    expect(mix.total).toBe(64);
    for (const tier of ['callback', 'tint', 'branchlet', 'branch'] as const) {
      const drift = Math.abs(mix.percentages[tier] - CONSEQUENCE_TARGET[tier]);
      expect(drift).toBeLessThanOrEqual(BUDGET_TOLERANCE.error);
    }
  });

  it('the allocator\'s own output validates clean (no encounter floored to callback)', () => {
    // Regression: tierFloor used to floor only BRANCH-POINT encounters at
    // 'branchlet', letting non-branch-point encounters absorb leftover
    // 'callback' budget — output the SeasonBudgetValidator then rejected
    // ("an encounter earns at least a 'branchlet'"). Build the repro plan
    // (8 encounters, 3 of them branch points, + 40 standard choice scenes),
    // run the full allocation, and assert the validator passes valid=true.
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 8; i++) {
      scenes.push(
        encounterScene({
          id: `enc-${i}`,
          encounter: {
            type: 'combat',
            difficulty: 'moderate',
            relevantSkills: ['combat'],
            isBranchPoint: i < 3, // first three are branch points
          },
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      scenes.push(standardScene({ id: `scn-${i}`, hasChoice: true }));
    }
    const plan = scenePlanFrom(scenes);

    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);
    allocateConsequenceTiers(units);

    // No encounter resolves to 'callback' — the invariant the validator checks.
    for (const u of units) {
      if (u.kind === 'encounter') {
        expect(u.consequenceTier).not.toBe('callback');
      }
    }

    const result = new SeasonBudgetValidator().validate(plan);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
