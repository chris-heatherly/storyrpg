/**
 * SeasonBudgetValidator tests.
 *
 * Exercises the season "dramatic diet" validator over a {@link SeasonScenePlan}:
 *   - a balanced weighted mix (within {@link BUDGET_TOLERANCE}) validates clean;
 *   - a skewed mix raises a drift/out-of-band issue on the off type/tier;
 *   - the hard invariants (encounter never 'expression'; encounter never
 *     'callback'; expression always 'callback') each surface an error.
 *
 * Units are constructed with explicit `choiceType` / `consequenceTier`: the
 * validator measures the mix, it does NOT allocate, so the test author owns the
 * distribution. `buildBudgetUnits` (called inside `validate`) defaults the
 * weights and forces encounters to `hasChoice`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SeasonBudgetValidator } from './SeasonBudgetValidator';
import type { ValidationIssue } from './BaseValidator';
import type {
  ConsequenceTier,
  PlannedScene,
  PlannedSceneEncounter,
  SeasonScenePlan,
} from '../../types/scenePlan';
import type { ChoiceType } from '../../types/choice';
import {
  buildBudgetUnits,
  allocateChoiceTypes,
  allocateConsequenceTiers,
} from '../pipeline/seasonBudgetAllocator';

// ----------------------------------------------------------------------------
// Builders
// ----------------------------------------------------------------------------

let nextId = 0;

/** A standard choice-bearing scene with an explicit choice/consequence pair. */
function sceneUnit(choiceType: ChoiceType, consequenceTier: ConsequenceTier): PlannedScene {
  return {
    id: `scene-${nextId++}`,
    episodeNumber: 1,
    order: nextId,
    kind: 'standard',
    title: 'scene',
    dramaticPurpose: 'purpose',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    hasChoice: true,
    choiceType,
    consequenceTier,
  };
}

/** An encounter unit (always a budgeted choice; weight 3). */
function encounterUnit(
  choiceType: ChoiceType,
  consequenceTier: ConsequenceTier,
  opts: Partial<PlannedSceneEncounter> = {},
): PlannedScene {
  return {
    id: `enc-${nextId++}`,
    episodeNumber: 1,
    order: nextId,
    kind: 'encounter',
    title: 'encounter',
    dramaticPurpose: 'purpose',
    narrativeRole: 'turn',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    choiceType,
    consequenceTier,
    encounter: {
      type: 'combat',
      difficulty: 'moderate',
      relevantSkills: [],
      isBranchPoint: false,
      ...opts,
    },
  };
}

/** Wrap a flat scene list into a SeasonScenePlan. */
function planOf(scenes: PlannedScene[]): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) {
    (byEpisode[s.episodeNumber] ??= []).push(s.id);
  }
  return { scenes, byEpisode, setupPayoffEdges: [] };
}

/** Repeat a unit factory `n` times. */
function repeat(n: number, make: () => PlannedScene): PlannedScene[] {
  return Array.from({ length: n }, make);
}

function errors(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

/**
 * A balanced plan that lands the weighted choice mix at exactly the target
 * (35 / 30 / 20 / 15) and the consequence mix at exactly (50 / 25 / 17 / 8)
 * over 100 weighted units, with every invariant satisfied.
 *
 * Choice mix (weighted): expression 35, relationship 30, strategic 20, dilemma 15.
 * Consequence mix (weighted): callback 50, tint 25, branchlet 17, branch 8.
 *
 * Invariants honored: every expression unit -> callback; every dilemma unit
 * (15) is >= branchlet, supplied as 8 branch + 7 branchlet.
 */
function balancedPlan(): SeasonScenePlan {
  const scenes: PlannedScene[] = [];

  // expression (35) -> all callback (invariant).
  scenes.push(...repeat(35, () => sceneUnit('expression', 'callback')));

  // dilemma (15) must be >= branchlet: 8 branch + 7 branchlet covers the whole
  // branch budget (8) and most of branchlet (7).
  scenes.push(...repeat(8, () => sceneUnit('dilemma', 'branch')));
  scenes.push(...repeat(7, () => sceneUnit('dilemma', 'branchlet')));

  // relationship (30): 10 branchlet (completes branchlet=17) + 5 tint + 15 callback.
  scenes.push(...repeat(10, () => sceneUnit('relationship', 'branchlet')));
  scenes.push(...repeat(5, () => sceneUnit('relationship', 'tint')));
  scenes.push(...repeat(15, () => sceneUnit('relationship', 'callback')));

  // strategic (20): 20 tint (completes tint=25, callback gets the rest).
  scenes.push(...repeat(20, () => sceneUnit('strategic', 'tint')));

  // Tally so far -> callback 50, tint 25, branchlet 17, branch 8. Exactly target.
  return planOf(scenes);
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SeasonBudgetValidator', () => {
  it('passes a balanced plan with no errors', () => {
    const result = new SeasonBudgetValidator().validate(balancedPlan());

    expect(result.valid).toBe(true);
    expect(errors(result.issues)).toHaveLength(0);
    // A perfectly-on-target mix should not even raise drift warnings.
    expect(result.issues).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('flags the off type when the choice mix is heavily skewed to dilemma', () => {
    // 70% dilemma weighted, the rest split — well outside the 15% dilemma target
    // (deviation ~55 pts >> error band of 25). Use scene units so no encounter
    // invariant fires; dilemma units take branchlet to satisfy the >= invariant.
    const scenes: PlannedScene[] = [
      ...repeat(70, () => sceneUnit('dilemma', 'branchlet')),
      ...repeat(10, () => sceneUnit('expression', 'callback')),
      ...repeat(10, () => sceneUnit('relationship', 'callback')),
      ...repeat(10, () => sceneUnit('strategic', 'callback')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const dilemmaIssue = result.issues.find((i) => i.location === 'choiceMix:dilemma');
    expect(dilemmaIssue).toBeDefined();
    expect(dilemmaIssue?.severity).toBe('error');
    // Overshooting dilemma starves expression too -> that should also complain.
    expect(result.issues.find((i) => i.location === 'choiceMix:expression')).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('errors when an encounter is authored as an expression choice', () => {
    // Otherwise-balanced-ish plan plus one invalid encounter. We keep the rest
    // simple; the invariant error is the assertion under test.
    const scenes: PlannedScene[] = [
      encounterUnit('expression', 'branchlet'), // INVALID: encounters are never 'expression'
      ...repeat(10, () => sceneUnit('expression', 'callback')),
      ...repeat(10, () => sceneUnit('relationship', 'callback')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const invariant = result.issues.find(
      (i) => i.severity === 'error' && /expression/.test(i.message) && /[Ee]ncounter/.test(i.message),
    );
    expect(invariant).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('errors when an encounter resolves to a callback consequence', () => {
    const scenes: PlannedScene[] = [
      encounterUnit('strategic', 'callback'), // INVALID: encounter must earn >= branchlet
      ...repeat(10, () => sceneUnit('relationship', 'callback')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const invariant = result.issues.find(
      (i) => i.severity === 'error' && /callback/.test(i.message) && /[Ee]ncounter/.test(i.message),
    );
    expect(invariant).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('errors when an expression unit carries a non-callback consequence', () => {
    const scenes: PlannedScene[] = [
      sceneUnit('expression', 'branchlet'), // INVALID: expression => callback
      ...repeat(10, () => sceneUnit('relationship', 'callback')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const invariant = result.issues.find(
      (i) => i.severity === 'error' && /expression/.test(i.message) && /callback/.test(i.message),
    );
    expect(invariant).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('flags a consequence mix far from the 50/25/17/8 target', () => {
    // All callback: callback ~100% (target 50, deviation 50 > error), and
    // tint/branchlet/branch all at 0% (each well outside the warn band). Choice
    // types kept on-target-ish so the consequence skew is the headline.
    const scenes: PlannedScene[] = [
      ...repeat(35, () => sceneUnit('expression', 'callback')),
      ...repeat(30, () => sceneUnit('relationship', 'callback')),
      ...repeat(20, () => sceneUnit('strategic', 'callback')),
      ...repeat(15, () => sceneUnit('dilemma', 'callback')), // dilemma->callback also trips its own invariant; fine
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const callbackIssue = result.issues.find((i) => i.location === 'consequenceMix:callback');
    expect(callbackIssue).toBeDefined();
    expect(callbackIssue?.severity).toBe('error');
    // The starved tiers should each register an issue too.
    expect(result.issues.find((i) => i.location === 'consequenceMix:branchlet')).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('encounter weight (3x) dominates the weighted mix versus scene weight (1x)', () => {
    // One encounter (weight 3, strategic) vs three scene expression choices
    // (weight 1 each). Weighted strategic share = 3/6 = 50%, not 1/4 = 25%.
    const scenes: PlannedScene[] = [
      encounterUnit('strategic', 'branchlet'),
      ...repeat(3, () => sceneUnit('expression', 'callback')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    // Strategic at 50% is 30 pts over its 20% target -> out of band error.
    const strategicIssue = result.issues.find((i) => i.location === 'choiceMix:strategic');
    expect(strategicIssue).toBeDefined();
    expect(strategicIssue?.severity).toBe('error');
  });

  it('warns when a plan has no budgeted units', () => {
    // A plan of standard scenes with no hasChoice flag yields zero budget units.
    const bare: PlannedScene = {
      id: 'bare',
      episodeNumber: 1,
      order: 0,
      kind: 'standard',
      title: 'bare',
      dramaticPurpose: 'p',
      narrativeRole: 'release',
      locations: [],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
    };

    const result = new SeasonBudgetValidator().validate(planOf([bare]));

    expect(result.issues.some((i) => i.severity === 'warning' && /no budgeted units/.test(i.message))).toBe(true);
    expect(errors(result.issues)).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// PHASE 2 — TWO-POPULATION VALIDATION (Plan Part 3, Layer D)
// ----------------------------------------------------------------------------

/** A choiceless standard scene the allocator will populate. */
function blankScene(id: string): PlannedScene {
  return {
    id,
    episodeNumber: 1,
    order: nextId++,
    kind: 'standard',
    title: 'scene',
    dramaticPurpose: 'purpose',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    hasChoice: true,
  };
}

/** A blank encounter the allocator will populate. */
function blankEncounter(id: string, isBranchPoint = false): PlannedScene {
  return {
    id,
    episodeNumber: 1,
    order: nextId++,
    kind: 'encounter',
    title: 'encounter',
    dramaticPurpose: 'purpose',
    narrativeRole: 'turn',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    encounter: { type: 'combat', difficulty: 'moderate', relevantSkills: [], isBranchPoint },
  };
}

describe('SeasonBudgetValidator — two-population (Phase 2)', () => {
  afterEach(() => {
    delete process.env.CONSEQUENCE_TWO_POP;
  });

  /** Build + fully allocate an 8-encounter / 40-scene season plan. */
  function allocatedEightAndForty(): SeasonScenePlan {
    const scenes: PlannedScene[] = [];
    for (let i = 0; i < 8; i++) scenes.push(blankEncounter(`enc-${i}`, i < 3));
    for (let i = 0; i < 40; i++) scenes.push(blankScene(`scn-${i}`));
    const plan = planOf(scenes);
    const units = buildBudgetUnits(plan);
    allocateChoiceTypes(units);
    allocateConsequenceTiers(units);
    return plan;
  }

  it('flag ON: an allocator-produced 8-enc/40-scene plan validates clean', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    const plan = allocatedEightAndForty();

    const result = new SeasonBudgetValidator().validate(plan);

    expect(errors(result.issues)).toHaveLength(0);
    expect(result.valid).toBe(true);
    // No total-heavy-mass drift: the spine-derived band absorbs the heavy encounters.
    expect(result.issues.find((i) => i.location === 'consequenceMix:heavy')).toBeUndefined();
  });

  it('flag OFF (default): the SAME heavy plan trips the unified consequence band', () => {
    delete process.env.CONSEQUENCE_TWO_POP;
    const plan = allocatedEightAndForty();

    const result = new SeasonBudgetValidator().validate(plan);

    // The unified check measures encounters against the scene-texture %, so the
    // heavy encounter load overshoots branchlet/branch — at least one unified
    // consequence-tier drift fires (and none of the Phase-2 scene-only / heavy
    // locations exist).
    const unifiedDrift = result.issues.filter((i) => /^consequenceMix:(callback|tint|branchlet|branch)$/.test(i.location ?? ''));
    expect(unifiedDrift.length).toBeGreaterThan(0);
    expect(result.issues.find((i) => i.location === 'consequenceMix:heavy')).toBeUndefined();
    expect(result.issues.find((i) => (i.location ?? '').startsWith('sceneConsequenceMix:'))).toBeUndefined();
  });

  it('flag ON: warns when an encounter violates its spine invariant', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    // A branch-point encounter mis-tiered to branchlet (should be branch).
    const scenes: PlannedScene[] = [
      encounterUnit('strategic', 'branchlet', { isBranchPoint: true }),
      ...repeat(20, () => sceneUnit('expression', 'callback')),
      ...repeat(8, () => sceneUnit('relationship', 'tint')),
    ];

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const spineIssue = result.issues.find((i) => (i.location ?? '').startsWith('encounterSpine:'));
    expect(spineIssue).toBeDefined();
    expect(spineIssue?.message).toMatch(/spine invariant 'branch'/);
  });

  it('flag ON: a scene-only mix far from 60/30/8/2 trips the scene texture check', () => {
    process.env.CONSEQUENCE_TWO_POP = '1';
    // All scenes are heavy branchlet dilemmas → scene branchlet % ~100 vs target 8.
    const scenes: PlannedScene[] = repeat(20, () => sceneUnit('dilemma', 'branchlet'));

    const result = new SeasonBudgetValidator().validate(planOf(scenes));

    const sceneBranchlet = result.issues.find((i) => i.location === 'sceneConsequenceMix:branchlet');
    expect(sceneBranchlet).toBeDefined();
    expect(sceneBranchlet?.severity).toBe('error');
  });
});
