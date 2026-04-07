import { describe, expect, it } from 'vitest';
import { EncounterArchitect, type EncounterArchitectInput, type Phase1Result, type Phase2Result, type Phase3Result, type Phase4Result } from './EncounterArchitect';
import { analyzeRelationshipDynamics, type RelationshipSnapshot, type NPCInfo } from '../utils/relationshipDynamics';
import type { Relationship } from '../../types';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

const input: EncounterArchitectInput = {
  sceneId: 'scene-3',
  sceneName: 'Encounter Scene',
  sceneDescription: 'A confrontation reaches its breaking point.',
  sceneMood: 'tense',
  plannedEncounterId: 'enc-3-1',
  storyContext: {
    title: 'Test Story',
    genre: 'Drama',
    tone: 'Intense',
  },
  encounterType: 'dramatic',
  encounterStyle: 'dramatic',
  encounterDescription: 'The protagonist must survive a charged confrontation.',
  encounterStakes: 'A key relationship and the protagonist identity are on the line.',
  encounterRequiredNpcIds: ['eros'],
  encounterRelevantSkills: ['persuasion', 'resolve'],
  encounterBeatPlan: ['Opening pressure', 'Escalation', 'Resolution'],
  difficulty: 'hard',
  protagonistInfo: {
    name: 'Alex',
    pronouns: 'they/them',
  },
  npcsInvolved: [
    {
      id: 'eros',
      name: 'Eros',
      pronouns: 'he/him',
      role: 'enemy',
      description: 'A dangerous god.',
    },
  ],
  availableSkills: [
    { name: 'persuasion', attribute: 'social', description: 'Talk your way through conflict.' },
    { name: 'resolve', attribute: 'mind', description: 'Hold firm under pressure.' },
    { name: 'deception', attribute: 'social', description: 'Misdirect the opponent.' },
  ],
  targetBeatCount: 4,
};

describe('EncounterArchitect deterministic fallback', () => {
  it('builds a valid, normalizable encounter from input data alone', () => {
    const architect = new EncounterArchitect(config);
    const fallback = (architect as any).buildDeterministicFallback(input);

    expect(fallback.sceneId).toBe('scene-3');
    expect(fallback.encounterType).toBe('dramatic');
    expect(fallback.beats).toHaveLength(2);
    expect(fallback.beats[0].choices).toHaveLength(3);
    expect(fallback.beats[1].choices).toHaveLength(3);

    // Terminal outcomes should have encounterOutcome
    for (const choice of fallback.beats[1].choices) {
      expect(choice.outcomes.success.isTerminal).toBe(true);
      expect(choice.outcomes.success.encounterOutcome).toBeDefined();
      expect(choice.outcomes.failure.isTerminal).toBe(true);
      expect(choice.outcomes.failure.encounterOutcome).toBeDefined();
    }

    // Should pass normalization and validation
    const normalized = (architect as any).normalizeStructure(fallback, input);
    expect(() => (architect as any).validateStructure(normalized, input)).not.toThrow();
    expect(normalized.storylets?.victory).toBeDefined();
    expect(normalized.storylets?.defeat).toBeDefined();
  });

  it('uses NPC names and skills from input in fallback narrative', () => {
    const architect = new EncounterArchitect(config);
    const fallback = (architect as any).buildDeterministicFallback(input);

    const allText = JSON.stringify(fallback);
    expect(allText).toContain('Eros');
    expect(allText).toContain('{{player.name}}');
  });
});

describe('EncounterArchitect reliable prompt', () => {
  it('produces a shorter prompt than the full prompt', () => {
    const architect = new EncounterArchitect(config);
    const reliable = (architect as any).buildReliablePrompt(input);
    const full = (architect as any).buildPrompt(input);

    // Reliable prompt should be significantly smaller (< 60% of full)
    expect(reliable.length).toBeLessThan(full.length * 0.6);
    expect(reliable).toContain(input.sceneId);
    expect(reliable).toContain('beat-1');
    expect(reliable).toContain('beat-2');
    // Should NOT contain the heavy structural fields
    expect(reliable).not.toContain('pixarStakes');
    expect(reliable).not.toContain('cinematicSetup');
    expect(reliable).not.toContain('environmentalElements');
  });
});

// ========================================================================
// Relationship Dynamics Analysis
// ========================================================================

describe('analyzeRelationshipDynamics', () => {
  const npcs: NPCInfo[] = [
    { id: 'eros', name: 'Eros', role: 'enemy' },
    { id: 'hera', name: 'Hera', role: 'ally' },
  ];

  it('detects betrayal risk when trust is below -40', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: -45, affection: 10, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 30, affection: 20, respect: 10, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const erosDynamic = brief.npcDynamics.find(d => d.npcId === 'eros');
    expect(erosDynamic).toBeDefined();
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'betrayal_risk')).toBe(true);
  });

  it('detects betrayal likely when trust is below -60', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: -65, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 0, affection: 0, respect: 0, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const erosDynamic = brief.npcDynamics.find(d => d.npcId === 'eros');
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'betrayal_likely')).toBe(true);
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'betrayal_risk')).toBe(false);
  });

  it('detects devotion when affection > 50 and trust >= 0', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: 0, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 10, affection: 60, respect: 30, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const heraDynamic = brief.npcDynamics.find(d => d.npcId === 'hera');
    expect(heraDynamic!.dramaticPossibilities.some(p => p.type === 'devotion')).toBe(true);
  });

  it('detects volatile bond when high affection and negative trust', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: -10, affection: 55, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 0, affection: 0, respect: 0, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const erosDynamic = brief.npcDynamics.find(d => d.npcId === 'eros');
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'volatile_bond')).toBe(true);
  });

  it('detects factional tension between NPCs', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: 35, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: -25, affection: 0, respect: 0, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const erosDynamic = brief.npcDynamics.find(d => d.npcId === 'eros');
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'factional_tension')).toBe(true);
  });

  it('detects relationship shift from previous state', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: -30, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 0, affection: 0, respect: 0, fear: 0 },
      },
      previous: {
        eros: { npcId: 'eros', trust: -5, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 0, affection: 0, respect: 0, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    const erosDynamic = brief.npcDynamics.find(d => d.npcId === 'eros');
    expect(erosDynamic!.dramaticPossibilities.some(p => p.type === 'relationship_shift')).toBe(true);
  });

  it('generates knock-on effects when trust differs significantly between NPCs', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: 40, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: -5, affection: 0, respect: 0, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    expect(brief.knockOnEffects.length).toBeGreaterThan(0);
    const sideEffect = brief.knockOnEffects.find(e => e.trigger.includes('Eros'));
    expect(sideEffect).toBeDefined();
  });

  it('generates briefText with NPC names and dramatic tags', () => {
    const snapshot: RelationshipSnapshot = {
      current: {
        eros: { npcId: 'eros', trust: -50, affection: 0, respect: 0, fear: 0 },
        hera: { npcId: 'hera', trust: 20, affection: 60, respect: 30, fear: 0 },
      },
    };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    expect(brief.briefText).toContain('Eros');
    expect(brief.briefText).toContain('Hera');
    expect(brief.briefText).toContain('BETRAYAL');
    expect(brief.briefText).toContain('DEVOTION');
  });

  it('returns empty briefText when no NPCs have relationships', () => {
    const snapshot: RelationshipSnapshot = { current: {} };
    const brief = analyzeRelationshipDynamics(npcs, snapshot);
    expect(brief.briefText).toBe('');
    expect(brief.npcDynamics).toHaveLength(0);
  });
});

// ========================================================================
// Phased Assembly
// ========================================================================

const makePhase1 = (): Phase1Result => ({
  sceneId: 'scene-3',
  encounterType: 'dramatic',
  goalClock: { name: 'Resolve', segments: 6, description: 'Resolve the confrontation' },
  threatClock: { name: 'Escalation', segments: 4, description: 'Things spiral out' },
  stakes: { victory: 'Earn trust', defeat: 'Lose everything' },
  openingBeat: {
    setupText: 'Eros stands before you, dagger drawn.',
    choices: [
      {
        id: 'c1', text: 'Grab the dagger', approach: 'aggressive',
        primarySkill: 'athletics', impliedApproach: 'aggressive',
        outcomes: {
          success: { narrativeText: 'You wrest the blade away.', goalTicks: 2, threatTicks: 0 },
          complicated: { narrativeText: 'You grab it but cut your hand.', goalTicks: 1, threatTicks: 1 },
          failure: { narrativeText: 'He pulls back and slashes.', goalTicks: 0, threatTicks: 2 },
        },
      },
      {
        id: 'c2', text: 'Talk him down', approach: 'cautious',
        primarySkill: 'persuasion',
        outcomes: {
          success: { narrativeText: 'His grip loosens.', goalTicks: 2, threatTicks: 0 },
          complicated: { narrativeText: 'He hesitates but doesn\'t lower it.', goalTicks: 1, threatTicks: 1 },
          failure: { narrativeText: 'Your words enrage him.', goalTicks: 0, threatTicks: 2 },
        },
      },
      {
        id: 'c3', text: 'Feint and dodge', approach: 'clever',
        primarySkill: 'deception',
        outcomes: {
          success: { narrativeText: 'You slip past him.', goalTicks: 2, threatTicks: 0 },
          complicated: { narrativeText: 'You dodge but stumble.', goalTicks: 1, threatTicks: 1 },
          failure: { narrativeText: 'He reads you perfectly.', goalTicks: 0, threatTicks: 2 },
        },
      },
    ],
  },
});

const makePhase2 = (choiceId: string): Phase2Result => ({
  choiceId,
  afterSuccess: {
    setupText: `After success on ${choiceId}, a new situation unfolds.`,
    choices: [
      {
        id: `${choiceId}-s-c1`, text: 'Press advantage', approach: 'bold', primarySkill: 'athletics',
        outcomes: {
          success: { narrativeText: 'Victory secured.', goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Won at a cost.', goalTicks: 2, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
          failure: { narrativeText: 'Overextended.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-s-c2`, text: 'Be cautious', approach: 'cautious', primarySkill: 'resolve',
        outcomes: {
          success: { narrativeText: 'Safe win.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Escaped.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'Lost ground.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-s-c3`, text: 'Outmaneuver', approach: 'clever', primarySkill: 'deception',
        outcomes: {
          success: { narrativeText: 'Clever win.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Slipped away.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'Caught.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
    ],
  },
  afterComplicated: {
    setupText: `After complication on ${choiceId}, tension rises.`,
    choices: [
      {
        id: `${choiceId}-p-c1`, text: 'Recover', approach: 'bold', primarySkill: 'athletics',
        outcomes: {
          success: { narrativeText: 'Recovered.', goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Barely.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
          failure: { narrativeText: 'Collapsed.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-p-c2`, text: 'Retreat', approach: 'cautious', primarySkill: 'resolve',
        outcomes: {
          success: { narrativeText: 'Got out.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'escape' },
          complicated: { narrativeText: 'Barely out.', goalTicks: 0, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'Trapped.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-p-c3`, text: 'Improvise', approach: 'clever', primarySkill: 'deception',
        outcomes: {
          success: { narrativeText: 'Turned it around.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Partial escape.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'Total failure.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
    ],
  },
  afterFailure: {
    setupText: `After failure on ${choiceId}, things look grim.`,
    choices: [
      {
        id: `${choiceId}-f-c1`, text: 'Last stand', approach: 'bold', primarySkill: 'athletics',
        outcomes: {
          success: { narrativeText: 'Miracle.', goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Pyrrhic.', goalTicks: 1, threatTicks: 2, isTerminal: true, encounterOutcome: 'partialVictory' },
          failure: { narrativeText: 'Defeated.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-f-c2`, text: 'Beg for mercy', approach: 'cautious', primarySkill: 'persuasion',
        outcomes: {
          success: { narrativeText: 'Mercy granted.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'escape' },
          complicated: { narrativeText: 'Conditional mercy.', goalTicks: 0, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'No mercy.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
      {
        id: `${choiceId}-f-c3`, text: 'Desperate gambit', approach: 'clever', primarySkill: 'deception',
        outcomes: {
          success: { narrativeText: 'It works!', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: { narrativeText: 'Barely.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
          failure: { narrativeText: 'Complete rout.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
        },
      },
    ],
  },
});

describe('assemblePhasedEncounter', () => {
  const architect = new EncounterArchitect(config);
  const emptyBrief = { npcDynamics: [], knockOnEffects: [], briefText: '' };

  it('wires 9 unique nextSituations from Phase 2 results into the tree', () => {
    const phase1 = makePhase1();
    const phase2Results = phase1.openingBeat.choices.map(c => makePhase2(c.id));

    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, null, emptyBrief);

    expect(structure.beats).toHaveLength(1);
    const beat1 = structure.beats[0];
    const choices = beat1.choices!;
    expect(choices).toHaveLength(3);

    for (const choice of choices) {
      for (const tier of ['success', 'complicated', 'failure'] as const) {
        const outcome = choice.outcomes[tier];
        expect(outcome.nextSituation).toBeDefined();
        expect(outcome.nextSituation!.setupText).toBeTruthy();
        expect(outcome.nextSituation!.choices.length).toBe(3);

        for (const branchChoice of outcome.nextSituation!.choices) {
          for (const branchTier of ['success', 'complicated', 'failure'] as const) {
            expect(branchChoice.outcomes[branchTier].isTerminal).toBe(true);
            expect(branchChoice.outcomes[branchTier].encounterOutcome).toBeDefined();
          }
        }
      }
    }
  });

  it('produces unique setupText for each of the 9 branch situations', () => {
    const phase1 = makePhase1();
    const phase2Results = phase1.openingBeat.choices.map(c => makePhase2(c.id));
    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, null, emptyBrief);

    const setupTexts = new Set<string>();
    for (const choice of structure.beats[0].choices!) {
      for (const tier of ['success', 'complicated', 'failure'] as const) {
        setupTexts.add(choice.outcomes[tier].nextSituation!.setupText);
      }
    }
    expect(setupTexts.size).toBe(9);
  });

  it('handles partial Phase 2 failure gracefully', () => {
    const phase1 = makePhase1();
    const phase2Results: (Phase2Result | null)[] = [makePhase2('c1'), null, makePhase2('c3')];
    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, null, emptyBrief);

    expect(structure.beats[0].choices![0].outcomes.success.nextSituation).toBeDefined();
    expect(structure.beats[0].choices![1].outcomes.success.nextSituation).toBeUndefined();
    expect(structure.beats[0].choices![2].outcomes.success.nextSituation).toBeDefined();
  });

  it('uses Phase 4 storylets when provided', () => {
    const phase1 = makePhase1();
    const phase4: Phase4Result = {
      victory: { id: 'sv', name: 'Custom Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'test', beats: [{ id: 'sv-1', text: 'Custom victory text.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
      defeat: { id: 'sd', name: 'Custom Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'test', beats: [{ id: 'sd-1', text: 'Custom defeat text.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
    };

    const structure = architect.assemblePhasedEncounter(input, phase1, [], null, phase4, emptyBrief);
    expect(structure.storylets.victory.name).toBe('Custom Victory');
    expect(structure.storylets.defeat.name).toBe('Custom Defeat');
  });

  it('uses default storylets when Phase 4 fails', () => {
    const phase1 = makePhase1();
    const structure = architect.assemblePhasedEncounter(input, phase1, [], null, null, emptyBrief);
    expect(structure.storylets.victory).toBeDefined();
    expect(structure.storylets.defeat).toBeDefined();
  });
});

// ========================================================================
// Enrichment Patch Application
// ========================================================================

describe('applyEnrichment', () => {
  const architect = new EncounterArchitect(config);
  const emptyBrief = { npcDynamics: [], knockOnEffects: [], briefText: '' };

  it('applies statBonuses to the matching choice', () => {
    const phase1 = makePhase1();
    const enrichment: Phase3Result = {
      statBonuses: [
        { choiceRef: 'c1', condition: { type: 'flag', flag: 'saved_eros', value: true }, difficultyReduction: 15, flavorText: 'He remembers' },
      ],
    };

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, null, emptyBrief);
    const c1 = structure.beats[0].choices!.find(c => c.id === 'c1');
    expect(c1!.statBonus).toBeDefined();
    expect(c1!.statBonus!.difficultyReduction).toBe(15);
  });

  it('adds conditional choices from enrichment', () => {
    const phase1 = makePhase1();
    const enrichment: Phase3Result = {
      conditionalChoices: [{
        id: 'c4', text: 'Invoke the pact', approach: 'social', primarySkill: 'persuasion',
        conditions: { type: 'flag', flag: 'made_pact', value: true },
        showWhenLocked: true, lockedText: 'You need leverage...',
        outcomes: {
          success: { narrativeText: 'The pact holds.', goalTicks: 2, threatTicks: 0 },
          complicated: { narrativeText: 'The pact strains.', goalTicks: 1, threatTicks: 1 },
          failure: { narrativeText: 'The pact shatters.', goalTicks: 0, threatTicks: 2 },
        },
      }],
    };

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, null, emptyBrief);
    expect(structure.beats[0].choices!).toHaveLength(4);
    const c4 = structure.beats[0].choices!.find(c => c.id === 'c4');
    expect(c4).toBeDefined();
    expect(c4!.showWhenLocked).toBe(true);
  });

  it('adds setupTextVariants from enrichment', () => {
    const phase1 = makePhase1();
    const enrichment: Phase3Result = {
      setupTextVariants: [
        { condition: { type: 'relationship', npcId: 'eros', dimension: 'trust', operator: '<', value: -20 }, text: 'Eros looks at you with cold contempt.' },
      ],
    };

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, null, emptyBrief);
    expect(structure.beats[0].setupTextVariants).toHaveLength(1);
  });
});

// ========================================================================
// Relationship Consequence Wiring
// ========================================================================

describe('relationship consequence wiring', () => {
  const architect = new EncounterArchitect(config);
  const emptyBrief = { npcDynamics: [], knockOnEffects: [], briefText: '' };

  it('converts Phase 2 relationshipConsequences into typed Consequence objects', () => {
    const phase1 = makePhase1();
    const phase2 = makePhase2('c1');
    phase2.afterSuccess.choices[0].outcomes.success.relationshipConsequences = [
      { npcId: 'eros', dimension: 'trust', change: 10, reason: 'Earned his respect' },
      { npcId: 'hera', dimension: 'affection', change: -5, reason: 'Hera feels sidelined' },
    ];

    const structure = architect.assemblePhasedEncounter(input, phase1, [phase2, null, null], null, null, emptyBrief);
    const c1SuccessBranch = structure.beats[0].choices![0].outcomes.success.nextSituation!;
    const firstChoiceSuccess = c1SuccessBranch.choices[0].outcomes.success;
    expect(firstChoiceSuccess.consequences).toBeDefined();
    expect(firstChoiceSuccess.consequences!.length).toBe(2);
    expect(firstChoiceSuccess.consequences![0]).toEqual({ type: 'relationship', npcId: 'eros', dimension: 'trust', change: 10 });
    expect(firstChoiceSuccess.consequences![1]).toEqual({ type: 'relationship', npcId: 'hera', dimension: 'affection', change: -5 });
  });
});

// ========================================================================
// Phase Prompt Structure
// ========================================================================

describe('Phase prompt builders', () => {
  const architect = new EncounterArchitect(config);

  it('Phase 1 prompt includes scene context and relationship brief', () => {
    const brief = { npcDynamics: [], knockOnEffects: [], briefText: '**Test dynamics**' };
    const prompt = (architect as any).buildPhase1Prompt(input, brief);
    expect(prompt).toContain(input.sceneId);
    expect(prompt).toContain(input.sceneName);
    expect(prompt).toContain('**Test dynamics**');
    expect(prompt).toContain('openingBeat');
  });

  it('Phase 2 prompt includes the specific choice text and outcomes', () => {
    const brief = { npcDynamics: [], knockOnEffects: [], briefText: '' };
    const choice = { id: 'c1', text: 'Grab the dagger', approach: 'bold', primarySkill: 'athletics', outcomes: {
      success: { narrativeText: 'You grab it.', goalTicks: 2, threatTicks: 0 },
      complicated: { narrativeText: 'You cut yourself.', goalTicks: 1, threatTicks: 1 },
      failure: { narrativeText: 'He slashes.', goalTicks: 0, threatTicks: 2 },
    }};
    const prompt = (architect as any).buildPhase2Prompt(input, brief, choice);
    expect(prompt).toContain('Grab the dagger');
    expect(prompt).toContain('You grab it.');
    expect(prompt).toContain('afterSuccess');
    expect(prompt).toContain('afterComplicated');
    expect(prompt).toContain('afterFailure');
  });

  it('Phase 3 prompt includes prior state context', () => {
    const inputWithCtx = {
      ...input,
      priorStateContext: {
        relevantFlags: [{ name: 'saved_eros', description: 'Player saved Eros earlier' }],
        relevantRelationships: [{ npcId: 'eros', npcName: 'Eros', dimension: 'trust' as const, operator: '>=' as const, threshold: 10, description: 'Trust threshold', authored: true }],
        significantChoices: ['Defended Eros in the throne room'],
      },
    };
    const phase1 = makePhase1();
    const prompt = (architect as any).buildPhase3Prompt(inputWithCtx, phase1);
    expect(prompt).toContain('saved_eros');
    expect(prompt).toContain('Defended Eros');
    expect(prompt).toContain('setupTextVariants');
    expect(prompt).toContain('statBonuses');
  });

  it('Phase 4 prompt includes NPC names and relationship dynamics', () => {
    const brief = { npcDynamics: [], knockOnEffects: [], briefText: '**Eros is volatile**' };
    const prompt = (architect as any).buildPhase4Prompt(input, brief);
    expect(prompt).toContain('Eros');
    expect(prompt).toContain('**Eros is volatile**');
    expect(prompt).toContain('victory');
    expect(prompt).toContain('defeat');
    expect(prompt).toContain('escape');
  });
});

// ========================================================================
// Legacy tests (preserved)
// ========================================================================

describe('EncounterArchitect tree validation', () => {
  it('accepts simplified flat encounters after flat-to-tree conversion', () => {
    const architect = new EncounterArchitect(config);
    const structure: any = {
      sceneId: 'scene-3',
      encounterType: 'dramatic',
      goalClock: { name: 'Win', segments: 6, description: 'Win the confrontation' },
      threatClock: { name: 'Lose', segments: 4, description: 'Things fall apart' },
      stakes: { victory: 'You prevail', defeat: 'You lose everything' },
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'Opening',
          description: 'The confrontation begins.',
          setupText: 'Eros corners Alex and forces a choice.',
          choices: [
            {
              id: 'b1-c1',
              text: 'Stand firm',
              approach: 'bold',
              outcomes: {
                success: { tier: 'success', narrativeText: 'You gain ground.', goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
                complicated: { tier: 'complicated', narrativeText: 'You hold, but barely.', goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
                failure: { tier: 'failure', narrativeText: 'You falter.', goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
              },
            },
            {
              id: 'b1-c2',
              text: 'Appeal to him',
              approach: 'cautious',
              outcomes: {
                success: { tier: 'success', narrativeText: 'He hesitates.', goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
                complicated: { tier: 'complicated', narrativeText: 'He listens, suspiciously.', goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
                failure: { tier: 'failure', narrativeText: 'He grows colder.', goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
              },
            },
            {
              id: 'b1-c3',
              text: 'Change the angle',
              approach: 'clever',
              outcomes: {
                success: { tier: 'success', narrativeText: 'You force a rethink.', goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
                complicated: { tier: 'complicated', narrativeText: 'You buy only a moment.', goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
                failure: { tier: 'failure', narrativeText: 'He sees through it.', goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
              },
            },
          ],
        },
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'Critical Moment',
          description: 'Everything comes to a head.',
          setupText: 'The final choice arrives.',
          isTerminal: true,
          choices: [
            {
              id: 'b2-c1',
              text: 'Claim the truth',
              approach: 'bold',
              outcomes: {
                success: { tier: 'success', narrativeText: 'You win.', goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'You win at a cost.', goalTicks: 2, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'You lose.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'b2-c2',
              text: 'Endure the pressure',
              approach: 'cautious',
              outcomes: {
                success: { tier: 'success', narrativeText: 'You hold.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'You escape battered.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
                failure: { tier: 'failure', narrativeText: 'You break.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'b2-c3',
              text: 'Find a third path',
              approach: 'clever',
              outcomes: {
                success: { tier: 'success', narrativeText: 'You outmaneuver him.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'You slip away changed.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' },
                failure: { tier: 'failure', narrativeText: 'You are trapped.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        },
      ],
      startingBeatId: 'beat-1',
      storylets: {
        victory: { id: 'sv', name: 'Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'Aftermath', beats: [{ id: 'sv-1', text: 'Victory.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
        defeat: { id: 'sd', name: 'Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'Aftermath', beats: [{ id: 'sd-1', text: 'Defeat.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
        partialVictory: { id: 'sp', name: 'Partial', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: 'Aftermath', beats: [{ id: 'sp-1', text: 'Partial.', isTerminal: true }], startingBeatId: 'sp-1', consequences: [] },
      },
      environmentalElements: [],
      npcStates: [],
      escalationTriggers: [],
      informationVisibility: { threatClockVisible: true, npcTellsRevealAt: 'encounter_50_percent', environmentElementsHidden: [], choiceOutcomesUnknown: true },
      estimatedDuration: 'medium',
      replayability: 'medium',
      designNotes: 'test',
    };

    const normalized = (architect as any).normalizeStructure(structure, input);
    expect(normalized.beats).toHaveLength(1);
    expect(() => (architect as any).validateStructure(normalized, input)).not.toThrow();
  });
});

// -----------------------------------------------------------------------
// competenceArc input field
// -----------------------------------------------------------------------

describe('EncounterArchitect competenceArc', () => {
  it('system prompt includes competenceArc guidance for failure recovery', () => {
    const architect = new EncounterArchitect(config);
    const prompt = (architect as any).getAgentSpecificPrompt();
    expect(prompt).toContain('competenceArc');
    expect(prompt).toContain('growth in the recovery choices');
  });

  it('buildReliablePrompt works with competenceArc on input without error', () => {
    const architect = new EncounterArchitect(config);
    const inputWithArc = {
      ...input,
      competenceArc: {
        testsNow: 'persuasion',
        shortfall: 'low charm',
        growthPath: 'mentor training with Marcus',
      },
    };
    const prompt = (architect as any).buildReliablePrompt(inputWithArc);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });
});
