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

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBudgetUnits,
  allocateChoiceTypes,
  allocateConsequenceTiers,
  weightedChoiceMix,
  weightedConsequenceMix,
  episodePosture,
  positionalMagnitude,
  proposeTierPositional,
  autoTuneMajorThreshold,
  encounterSpineTier,
  spineDerivedHeavyPercent,
  type BudgetContext,
} from './seasonBudgetAllocator';
import type { StoryCircleBeat } from '../../types/sourceAnalysis';
import { SeasonBudgetValidator } from '../validators/SeasonBudgetValidator';
import {
  CHOICE_TYPE_TARGET,
  CONSEQUENCE_TARGET,
  SCENE_CONSEQUENCE_TARGET,
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

// ========================================
// PHASE 1 — POSITIONAL TIERING (Plan Part 3, Layers A–C)
// ========================================

const RANK: Record<string, number> = { callback: 0, tint: 1, branchlet: 2, branch: 3 };

describe('episodePosture (Layer C)', () => {
  it('maps convergent tentpole beats to convergent', () => {
    for (const r of ['you', 'find', 'return', 'change', 'return'] as StoryCircleBeat[]) {
      expect(episodePosture([r])).toBe('convergent');
    }
  });

  it('maps go / search / search to open-field', () => {
    for (const r of ['go', 'search', 'search'] as StoryCircleBeat[]) {
      expect(episodePosture([r])).toBe('open-field');
    }
  });

  it('maps take to open-field-short', () => {
    expect(episodePosture(['take'])).toBe('open-field-short');
  });

  it('defaults to open-field for an absent / unknown role', () => {
    expect(episodePosture(undefined)).toBe('open-field');
    expect(episodePosture([])).toBe('open-field');
  });

  it('takes the most permissive posture when an episode fuses beats', () => {
    // you (convergent) + go (open-field) → open-field wins.
    expect(episodePosture(['you', 'go'])).toBe('open-field');
    // you (convergent) + take (open-field-short) → open-field-short wins.
    expect(episodePosture(['you', 'take'])).toBe('open-field-short');
  });
});

describe('positionalMagnitude (Layer B)', () => {
  it('orders dilemma > strategic > relationship on the choiceType base alone', () => {
    const base = (ct: 'dilemma' | 'strategic' | 'relationship') =>
      positionalMagnitude(standardScene({ id: ct, hasChoice: true, choiceType: ct, narrativeRole: 'release' }));
    expect(base('dilemma')).toBeGreaterThan(base('strategic'));
    expect(base('strategic')).toBeGreaterThan(base('relationship'));
  });

  it('a turn scene out-weighs a release scene of the same choiceType', () => {
    const turn = positionalMagnitude(standardScene({ id: 't', hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn' }));
    const release = positionalMagnitude(standardScene({ id: 'r', hasChoice: true, choiceType: 'strategic', narrativeRole: 'release' }));
    expect(turn).toBeGreaterThan(release);
  });

  it('rewards setup load, paysOff, and explicit stakes; caps setsUp contribution', () => {
    const plain = positionalMagnitude(standardScene({ id: 'p', hasChoice: true, choiceType: 'relationship', narrativeRole: 'development' }));
    const loaded = positionalMagnitude(standardScene({
      id: 'l', hasChoice: true, choiceType: 'relationship', narrativeRole: 'development',
      setsUp: ['a', 'b', 'c'], paysOff: ['x'], stakes: 'the alliance fractures',
    }));
    expect(loaded).toBeGreaterThan(plain);

    // setsUp contribution is capped at +.25 (6 edges = same as 5+).
    const five = positionalMagnitude(standardScene({ id: '5', hasChoice: true, choiceType: 'relationship', narrativeRole: 'release', setsUp: ['1', '2', '3', '4', '5'] }));
    const ten = positionalMagnitude(standardScene({ id: '10', hasChoice: true, choiceType: 'relationship', narrativeRole: 'release', setsUp: Array.from({ length: 10 }, (_, i) => `${i}`) }));
    expect(ten).toBeCloseTo(five, 9);
  });

  it('stays within [0,1]', () => {
    const maxed = positionalMagnitude(standardScene({
      id: 'm', hasChoice: true, choiceType: 'dilemma', narrativeRole: 'turn',
      setsUp: Array.from({ length: 10 }, (_, i) => `${i}`), paysOff: ['x'], stakes: 'everything',
    }));
    expect(maxed).toBeGreaterThan(0);
    expect(maxed).toBeLessThanOrEqual(1);
  });
});

describe('proposeTierPositional (Layers A + C)', () => {
  it('expression is callback-only regardless of posture', () => {
    const u = standardScene({ id: 'e', hasChoice: true, choiceType: 'expression' });
    const p = proposeTierPositional(u, ['go'], 0);
    expect(p).toEqual({ floor: 'callback', ceil: 'callback', preferred: 'callback' });
  });

  it('branch-point encounters propose branch anywhere', () => {
    const enc = encounterScene({ id: 'bp', encounter: { type: 'combat', difficulty: 'hard', relevantSkills: ['c'], isBranchPoint: true } });
    expect(proposeTierPositional(enc, ['you'], 0).preferred).toBe('branch');
    expect(proposeTierPositional(enc, ['change'], 0).preferred).toBe('branch');
  });

  it('non-branch encounters propose branchlet, escalating to branch at take/return', () => {
    const enc = encounterScene({ id: 'ne', encounter: { type: 'combat', difficulty: 'moderate', relevantSkills: ['c'], isBranchPoint: false } });
    expect(proposeTierPositional(enc, ['you'], 0).preferred).toBe('branchlet');
    expect(proposeTierPositional(enc, ['return'], 0).preferred).toBe('branch');
    expect(proposeTierPositional(enc, ['take'], 0).preferred).toBe('branch');
  });

  it('a convergent episode caps a non-encounter major at branchlet; open-field reaches branch', () => {
    const major = standardScene({ id: 'maj', hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn' });
    // τ = 0 so the unit clears the major threshold.
    const conv = proposeTierPositional(major, ['find'], 0);
    expect(conv.ceil).toBe('branchlet');
    expect(conv.preferred).toBe('branchlet');

    const open = proposeTierPositional(major, ['go'], 0);
    expect(open.ceil).toBe('branch');
    expect(open.preferred).toBe('branch');
  });

  it('a minor (sub-τ) non-encounter lands in the light band; change leans callback', () => {
    const minor = standardScene({ id: 'min', hasChoice: true, choiceType: 'relationship', narrativeRole: 'release' });
    // τ above the unit's magnitude → light band.
    const open = proposeTierPositional(minor, ['search'], 1);
    expect(open.floor).toBe('callback');
    expect(open.ceil).toBe('tint');
    expect(open.preferred).toBe('tint');

    const res = proposeTierPositional(minor, ['change'], 1);
    expect(res.preferred).toBe('callback');
  });

  it('dilemmas always sit in the heavy band even below τ', () => {
    const dil = standardScene({ id: 'd', hasChoice: true, choiceType: 'dilemma', narrativeRole: 'release' });
    const p = proposeTierPositional(dil, ['search'], 1); // τ high
    expect(RANK[p.floor]).toBeGreaterThanOrEqual(RANK.branchlet);
  });
});

describe('autoTuneMajorThreshold (deterministic τ solve)', () => {
  it('τ is set so exactly the top-k eligible magnitudes clear it', () => {
    const units = [
      standardScene({ id: 'a', hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn' }),    // high
      standardScene({ id: 'b', hasChoice: true, choiceType: 'strategic', narrativeRole: 'development' }),
      standardScene({ id: 'c', hasChoice: true, choiceType: 'relationship', narrativeRole: 'release' }), // low
    ];
    const tau = autoTuneMajorThreshold(units, 1);
    const clearing = units.filter((u) => positionalMagnitude(u) >= tau);
    expect(clearing).toHaveLength(1);
    expect(clearing[0].id).toBe('a');
  });

  it('is deterministic across repeated calls on identical input', () => {
    const make = () => [
      standardScene({ id: 'a', hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn' }),
      standardScene({ id: 'b', hasChoice: true, choiceType: 'relationship', narrativeRole: 'development' }),
    ];
    expect(autoTuneMajorThreshold(make(), 1)).toBe(autoTuneMajorThreshold(make(), 1));
  });

  it('reserves nothing → τ above the max (no scene-majors)', () => {
    const units = [standardScene({ id: 'a', hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn' })];
    const tau = autoTuneMajorThreshold(units, 0);
    expect(units.every((u) => positionalMagnitude(u) < tau)).toBe(true);
  });
});

describe('allocateConsequenceTiers — flag gating (Phase 1)', () => {
  afterEach(() => {
    delete process.env.CONSEQUENCE_POSITIONAL;
  });

  function buildPlan(): { units: ReturnType<typeof buildBudgetUnits>; ctx: BudgetContext } {
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    // Episode 2 = go (open-field): a strong major scene → can reach branch.
    scenes.push(standardScene({ id: 'open-major', episodeNumber: 2, hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn', setsUp: ['x', 'y'], stakes: 'the plan' }));
    // Episode 5 = find (convergent): an equally strong major → capped at branchlet.
    scenes.push(standardScene({ id: 'conv-major', episodeNumber: 5, hasChoice: true, choiceType: 'strategic', narrativeRole: 'turn', setsUp: ['x', 'y'], stakes: 'the plan' }));
    // Filler light scenes so the budget has room.
    for (let i = 0; i < 18; i++) {
      scenes.push(standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression', narrativeRole: 'release' }));
    }
    const plan = scenePlanFrom(scenes);
    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);
    const roleByEpisode: Record<number, StoryCircleBeat[]> = {
      1: ['you'],
      2: ['go'],
      5: ['find'],
    };
    return { units, ctx: { roleByEpisode } };
  }

  it('flag OFF: ctx is ignored — identical to the legacy allocator', () => {
    delete process.env.CONSEQUENCE_POSITIONAL;
    const { units: withCtx, ctx } = buildPlan();
    allocateConsequenceTiers(withCtx, ctx);
    const withCtxTiers = withCtx.map((u) => `${u.id}:${u.consequenceTier}`);

    const { units: noCtx } = buildPlan();
    allocateConsequenceTiers(noCtx);
    const noCtxTiers = noCtx.map((u) => `${u.id}:${u.consequenceTier}`);

    expect(withCtxTiers).toEqual(noCtxTiers);
  });

  it('flag ON: a convergent episode never gets a non-encounter branch, while open-field can', () => {
    process.env.CONSEQUENCE_POSITIONAL = '1';
    const { units, ctx } = buildPlan();
    allocateConsequenceTiers(units, ctx);

    const openMajor = units.find((u) => u.id === 'open-major')!;
    const convMajor = units.find((u) => u.id === 'conv-major')!;

    // The convergent major is capped at branchlet (never a durable branch).
    expect(convMajor.consequenceTier).not.toBe('branch');
    expect(RANK[convMajor.consequenceTier!]).toBeLessThanOrEqual(RANK.branchlet);

    // The open-field major can reach branch.
    expect(openMajor.consequenceTier).toBe('branch');

    // No NON-encounter unit in a convergent episode is a branch.
    for (const u of units) {
      if (u.kind === 'encounter') continue;
      const roles = ctx.roleByEpisode![u.episodeNumber] ?? [];
      if (episodePosture(roles) === 'convergent') {
        expect(u.consequenceTier).not.toBe('branch');
      }
    }
  });

  it('flag ON: expression invariant still holds (expression → callback)', () => {
    process.env.CONSEQUENCE_POSITIONAL = '1';
    const { units, ctx } = buildPlan();
    allocateConsequenceTiers(units, ctx);
    for (const u of units) {
      if (u.choiceType === 'expression') expect(u.consequenceTier).toBe('callback');
    }
  });
});

// ========================================
// PHASE 2 — TWO-POPULATION BUDGET (Plan Part 3, Layer D)
// ========================================

describe('encounterSpineTier (Layer D invariant)', () => {
  it('branch-point encounters → branch anywhere', () => {
    const bp = encounterScene({ id: 'bp', encounter: { type: 'combat', difficulty: 'hard', relevantSkills: ['c'], isBranchPoint: true } });
    expect(encounterSpineTier(bp, ['you'])).toBe('branch');
    expect(encounterSpineTier(bp, ['change'])).toBe('branch');
    expect(encounterSpineTier(bp, undefined)).toBe('branch');
  });

  it('non-branch encounters → branchlet, escalating to branch at take/return', () => {
    const ne = encounterScene({ id: 'ne', encounter: { type: 'combat', difficulty: 'moderate', relevantSkills: ['c'], isBranchPoint: false } });
    expect(encounterSpineTier(ne, ['you'])).toBe('branchlet');
    expect(encounterSpineTier(ne, undefined)).toBe('branchlet');
    expect(encounterSpineTier(ne, ['take'])).toBe('branch');
    expect(encounterSpineTier(ne, ['return'])).toBe('branch');
  });
});

describe('spineDerivedHeavyPercent (Layer D band)', () => {
  it('floors at the encounter weight share plus the scene heavy reserve', () => {
    nextOrder = 0;
    // 8 encounters (weight 3 = 24) + 40 scenes (weight 1 = 40) → total 64.
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 8; i++) scenes.push(encounterScene({ id: `e${i}` }));
    for (let i = 0; i < 40; i++) scenes.push(standardScene({ id: `s${i}`, hasChoice: true }));
    const units = buildBudgetUnits(scenePlanFrom(scenes));

    const sceneHeavyPct = SCENE_CONSEQUENCE_TARGET.branchlet + SCENE_CONSEQUENCE_TARGET.branch; // 10
    // encounters 24/64 + scene reserve (40 * 10%)/64 = (24 + 4)/64 = 43.75%.
    const expected = ((24 + (40 * sceneHeavyPct) / 100) / 64) * 100;
    expect(spineDerivedHeavyPercent(units)).toBeCloseTo(expected, 6);
    expect(spineDerivedHeavyPercent(units)).toBeCloseTo(43.75, 6);
  });

  it('is 0 for an empty unit set', () => {
    expect(spineDerivedHeavyPercent([])).toBe(0);
  });
});

describe('allocateConsequenceTiers — two-population (Phase 2)', () => {
  afterEach(() => {
    delete process.env.CONSEQUENCE_TWO_POP;
    delete process.env.CONSEQUENCE_POSITIONAL;
  });

  function buildEightAndForty(): { units: ReturnType<typeof buildBudgetUnits>; plan: SeasonScenePlan } {
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 8; i++) {
      scenes.push(encounterScene({ id: `enc-${i}`, encounter: {
        type: 'combat', difficulty: 'moderate', relevantSkills: ['combat'], isBranchPoint: i < 3,
      } }));
    }
    for (let i = 0; i < 40; i++) {
      scenes.push(standardScene({ id: `scn-${i}`, hasChoice: true }));
    }
    const plan = scenePlanFrom(scenes);
    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);
    return { units, plan };
  }

  it('flag OFF: identical to the legacy allocator', () => {
    delete process.env.CONSEQUENCE_TWO_POP;
    const a = buildEightAndForty();
    allocateConsequenceTiers(a.units);
    const offTiers = a.units.map((u) => `${u.id}:${u.consequenceTier}`);

    const b = buildEightAndForty();
    allocateConsequenceTiers(b.units);
    const legacyTiers = b.units.map((u) => `${u.id}:${u.consequenceTier}`);

    expect(offTiers).toEqual(legacyTiers);
    // And the legacy mix is the unified one (heavy mass well over the scene-only %).
    const mix = weightedConsequenceMix(a.units);
    expect(mix.percentages.branch + mix.percentages.branchlet).toBeGreaterThan(20);
  });

  it('flag ON: encounters stay all-heavy and the scene-only mix lands near 60/30/8/2', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    const { units } = buildEightAndForty();
    allocateConsequenceTiers(units);

    const encounters = units.filter((u) => u.kind === 'encounter');
    const scenes = units.filter((u) => u.kind === 'standard');

    // Encounters are all heavy (branchlet/branch); branch-points are branch.
    for (const e of encounters) {
      expect(['branchlet', 'branch']).toContain(e.consequenceTier);
    }
    for (const e of encounters) {
      if (e.encounter?.isBranchPoint) expect(e.consequenceTier).toBe('branch');
    }

    // Scene-only weighted mix lands near SCENE_CONSEQUENCE_TARGET (60/30/8/2).
    const sceneMix = weightedConsequenceMix(scenes);
    for (const tier of ['callback', 'tint', 'branchlet', 'branch'] as const) {
      const drift = Math.abs(sceneMix.percentages[tier] - SCENE_CONSEQUENCE_TARGET[tier]);
      expect(drift).toBeLessThanOrEqual(BUDGET_TOLERANCE.warn);
    }
  });

  it('flag ON: non-branch encounters escalate to branch at take/return via ctx', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    nextOrder = 0;
    const ne = encounterScene({ id: 'ne', episodeNumber: 7, encounter: {
      type: 'combat', difficulty: 'moderate', relevantSkills: ['c'], isBranchPoint: false,
    } });
    const filler = Array.from({ length: 10 }, (_, i) =>
      standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression' }));
    const units = buildBudgetUnits(scenePlanFrom([ne, ...filler]));
    allocateChoiceTypes(units);
    const ctx: BudgetContext = { roleByEpisode: { 7: ['return'] } };
    allocateConsequenceTiers(units, ctx);
    expect(units.find((u) => u.id === 'ne')!.consequenceTier).toBe('branch');
  });

  it('flag ON: expression invariant still holds (expression → callback)', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 6; i++) scenes.push(standardScene({ id: `x${i}`, hasChoice: true, choiceType: 'expression' }));
    const units = buildBudgetUnits(scenePlanFrom(scenes));
    allocateConsequenceTiers(units);
    for (const u of units) {
      if (u.choiceType === 'expression') expect(u.consequenceTier).toBe('callback');
    }
  });
});

// ========================================
// PHASE 3 — DRAMATIC CHARGE (Plan Part 4, Layer E)
// ========================================

describe('allocateConsequenceTiers — charge (Phase 3)', () => {
  afterEach(() => {
    delete process.env.CONSEQUENCE_CHARGE;
    delete process.env.CONSEQUENCE_TWO_POP;
    delete process.env.CONSEQUENCE_POSITIONAL;
  });

  it('flag OFF: ctx (incl. a chargeMap) is ignored — identical to the legacy allocator', () => {
    delete process.env.CONSEQUENCE_CHARGE;
    nextOrder = 0;
    const make = () => {
      nextOrder = 0;
      const scenes: PlannedScene[] = [];
      for (let i = 0; i < 8; i++) {
        scenes.push(encounterScene({ id: `enc-${i}`, encounter: {
          type: 'combat', difficulty: 'moderate', relevantSkills: ['combat'], isBranchPoint: i < 3,
        } }));
      }
      for (let i = 0; i < 40; i++) scenes.push(standardScene({ id: `scn-${i}`, hasChoice: true }));
      const units = buildBudgetUnits(scenePlanFrom(scenes));
      allocateChoiceTypes(units);
      return units;
    };

    const withCtx = make();
    const chargeMap = new Map<string, number>(withCtx.map((u) => [u.id, 0.9]));
    allocateConsequenceTiers(withCtx, { chargeMap });
    const withTiers = withCtx.map((u) => `${u.id}:${u.consequenceTier}`);

    const noCtx = make();
    allocateConsequenceTiers(noCtx);
    const noTiers = noCtx.map((u) => `${u.id}:${u.consequenceTier}`);

    expect(withTiers).toEqual(noTiers);
  });

  it('flag ON, Rule 1: a low-base relationship scene with high inbound charge is elevated to the heavy band', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    // A relationship/release scene — low positional magnitude, normally light.
    const betrayal = standardScene({
      id: 'betrayal',
      episodeNumber: 2, // go → open-field, so an elevated unit may reach branch
      hasChoice: true,
      choiceType: 'relationship',
      narrativeRole: 'release',
    });
    const filler: PlannedScene[] = [];
    for (let i = 0; i < 18; i++) {
      filler.push(standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression', narrativeRole: 'release' }));
    }
    const units = buildBudgetUnits(scenePlanFrom([betrayal, ...filler]));
    allocateChoiceTypes(units);
    // Force the choiceType back (allocateChoiceTypes may reassign): pin betrayal.
    units.find((u) => u.id === 'betrayal')!.choiceType = 'relationship';

    const ctx: BudgetContext = {
      roleByEpisode: { 1: ['you'], 2: ['go'] },
      chargeMap: new Map([['betrayal', 0.95]]),
    };
    allocateConsequenceTiers(units, ctx);

    const u = units.find((u) => u.id === 'betrayal')!;
    expect(RANK[u.consequenceTier!]).toBeGreaterThanOrEqual(RANK.branchlet);
    expect(u.tierRationale).toBeTruthy();
    expect(u.chargeScore).toBe(0.95);
  });

  it('flag ON, Rule 2: a structurally-major scene with ZERO charge is demoted out of the heavy band', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    // A strong positional major (strategic turn, setsUp, stakes) in an open-field
    // episode — positionally it would be a branch — but with no charge behind it.
    const hollow = standardScene({
      id: 'hollow-major',
      episodeNumber: 2,
      hasChoice: true,
      choiceType: 'strategic',
      narrativeRole: 'turn',
      setsUp: ['a', 'b', 'c'],
      stakes: 'the whole plan',
    });
    const filler: PlannedScene[] = [];
    for (let i = 0; i < 18; i++) {
      filler.push(standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression', narrativeRole: 'release' }));
    }
    const units = buildBudgetUnits(scenePlanFrom([hollow, ...filler]));
    allocateChoiceTypes(units);
    units.find((u) => u.id === 'hollow-major')!.choiceType = 'strategic';

    const ctx: BudgetContext = {
      roleByEpisode: { 1: ['you'], 2: ['go'] },
      chargeMap: new Map([['hollow-major', 0]]), // zero charge
    };
    allocateConsequenceTiers(units, ctx);

    const u = units.find((u) => u.id === 'hollow-major')!;
    // Demoted to the light band (callback/tint) — hollow-branch ban.
    expect(RANK[u.consequenceTier!]).toBeLessThan(RANK.branchlet);
    expect(u.tierRationale).toMatch(/hollow|under-charged|Rule 2/i);
  });

  it('flag ON: encounters stay heavy by invariant regardless of charge', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 4; i++) {
      scenes.push(encounterScene({ id: `enc-${i}`, encounter: {
        type: 'combat', difficulty: 'moderate', relevantSkills: ['combat'], isBranchPoint: i < 2,
      } }));
    }
    for (let i = 0; i < 12; i++) scenes.push(standardScene({ id: `s${i}`, hasChoice: true }));
    const units = buildBudgetUnits(scenePlanFrom(scenes));
    allocateChoiceTypes(units);
    // No charge map at all → encounters must still be heavy.
    allocateConsequenceTiers(units, { roleByEpisode: {} });
    for (const u of units) {
      if (u.kind === 'encounter') {
        expect(['branchlet', 'branch']).toContain(u.consequenceTier);
        if (u.encounter?.isBranchPoint) expect(u.consequenceTier).toBe('branch');
      }
    }
  });

  it('flag ON: a charged convergent-episode unit is capped at branchlet (posture still holds)', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    const conv = standardScene({
      id: 'conv-charged',
      episodeNumber: 5, // find → convergent
      hasChoice: true,
      choiceType: 'relationship',
      narrativeRole: 'release',
    });
    const filler: PlannedScene[] = [];
    for (let i = 0; i < 18; i++) {
      filler.push(standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression', narrativeRole: 'release' }));
    }
    const units = buildBudgetUnits(scenePlanFrom([conv, ...filler]));
    allocateChoiceTypes(units);
    units.find((u) => u.id === 'conv-charged')!.choiceType = 'relationship';

    const ctx: BudgetContext = {
      roleByEpisode: { 1: ['you'], 5: ['find'] },
      chargeMap: new Map([['conv-charged', 0.99]]),
    };
    allocateConsequenceTiers(units, ctx);

    const u = units.find((u) => u.id === 'conv-charged')!;
    // Elevated into the heavy band, but capped at branchlet (no durable branch in
    // a convergent episode).
    expect(u.consequenceTier).toBe('branchlet');
  });

  it('flag ON: expression invariant still holds (expression → callback)', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 6; i++) scenes.push(standardScene({ id: `x${i}`, hasChoice: true, choiceType: 'expression' }));
    const units = buildBudgetUnits(scenePlanFrom(scenes));
    allocateChoiceTypes(units);
    // Even with a high charge map, expression stays callback.
    const ctx: BudgetContext = { chargeMap: new Map(scenes.map((s) => [s.id, 0.99])) };
    allocateConsequenceTiers(units, ctx);
    for (const u of units) {
      if (u.choiceType === 'expression') expect(u.consequenceTier).toBe('callback');
    }
  });

  // Regression (review LOW): a charged non-encounter unit in a RESOLUTION episode
  // stays callback-dominant — change has no runway to reconverge a fork, so
  // even high charge discharges as acknowledgment, not a branchlet (Layer C).
  it('flag ON: a charged change-episode unit stays callback (no runway)', () => {
    process.env.CONSEQUENCE_CHARGE = '1';
    nextOrder = 0;
    const res = standardScene({
      id: 'res-charged',
      episodeNumber: 8, // change → convergent, terminal
      hasChoice: true,
      choiceType: 'relationship',
      narrativeRole: 'payoff',
    });
    const filler: PlannedScene[] = [];
    for (let i = 0; i < 18; i++) {
      filler.push(standardScene({ id: `f${i}`, episodeNumber: 1, hasChoice: true, choiceType: 'expression', narrativeRole: 'release' }));
    }
    const units = buildBudgetUnits(scenePlanFrom([res, ...filler]));
    allocateChoiceTypes(units);
    units.find((u) => u.id === 'res-charged')!.choiceType = 'relationship';

    const ctx: BudgetContext = {
      roleByEpisode: { 1: ['you'], 8: ['change'] },
      chargeMap: new Map([['res-charged', 0.99]]),
    };
    allocateConsequenceTiers(units, ctx);

    expect(units.find((u) => u.id === 'res-charged')!.consequenceTier).toBe('callback');
  });
});
