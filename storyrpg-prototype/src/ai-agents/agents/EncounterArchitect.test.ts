import { describe, expect, it, vi } from 'vitest';
import { EncounterArchitect, ENCOUNTER_PROSE_DISCIPLINE, enforceStoryletConvergence, type EncounterArchitectInput, type Phase1Result, type Phase2Result, type Phase3Result, type Phase4Result } from './EncounterArchitect';
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
  encounterStoryCircleTarget: 'take',
  encounterStoryCircleTargetRationale: 'The confrontation demands a relationship cost for pursuing the truth.',
  encounterStoryCircleTargetEvidence: {
    episodeStoryCircleRole: ['take'],
    episodeQuestion: 'Will Alex pay the cost of naming the truth?',
    protagonistChange: 'Alex leaves with changed trust and a clearer self-concept.',
    cliffhangerHandoff: 'next_need',
  },
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

const makeAuthoredStorylets = (): Phase4Result => ({
  victory: { id: 'sv', name: 'Custom Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'test', sequenceIntent: { objective: 'Show the win landing.', activity: 'victory aftermath', obstacle: 'The pressure still has residue.', startState: 'The room is tense.', turningPoint: 'The opposition gives ground.', endState: 'The protagonist stands steadier.', visualThread: 'changed posture' }, beats: [{ id: 'sv-1', text: 'The room changes because the choice landed, and the opposition gives ground.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
  partialVictory: { id: 'sp', name: 'Custom Partial', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: 'test', sequenceIntent: { objective: 'Show relief with cost.', activity: 'costly victory aftermath', obstacle: 'The cost remains visible.', startState: 'The goal is close.', turningPoint: 'The complication remains.', endState: 'The next scene carries both success and cost.', visualThread: 'visible complication' }, beats: [{ id: 'sp-1', text: 'The goal is within reach, but the cost stays visible in the room.', isTerminal: true }], startingBeatId: 'sp-1', consequences: [] },
  defeat: { id: 'sd', name: 'Custom Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'test', sequenceIntent: { objective: 'Make the loss usable.', activity: 'defeat aftermath', obstacle: 'The loss has consequences.', startState: 'The effort fails.', turningPoint: 'The lesson becomes clear.', endState: 'Resolve points forward.', visualThread: 'recovery posture' }, beats: [{ id: 'sd-1', text: 'The loss lands plainly, leaving a specific lesson to carry forward.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
  escape: { id: 'se', name: 'Custom Escape', triggerOutcome: 'escape', tone: 'relieved', narrativeFunction: 'test', sequenceIntent: { objective: 'Show temporary safety.', activity: 'escape aftermath', obstacle: 'The danger remains unresolved.', startState: 'The threat is close.', turningPoint: 'Distance opens.', endState: 'There is room to breathe but not closure.', visualThread: 'distance from danger' }, beats: [{ id: 'se-1', text: 'Distance opens at last, but the danger keeps its shape behind you.', isTerminal: true }], startingBeatId: 'se-1', consequences: [] },
});

const withAuthoredStorylets = <T extends { storylets?: any }>(structure: T): T => {
  structure.storylets = makeAuthoredStorylets();
  return structure;
};

describe('execute() refuses the template fallback (no-boilerplate mandate)', () => {
  it('returns success:false when phased AND both lean attempts fail — never ships deterministic template prose', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'executePhased').mockRejectedValue(new Error('phase 1 exhausted'));
    vi.spyOn(architect, 'callLLM').mockRejectedValue(new Error('provider unavailable'));

    const res = await architect.execute(input);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/All LLM attempts failed/);
    expect(res.data).toBeUndefined();
  });
});

// buildDeterministicFallback is NOT called in production anymore (no-boilerplate
// mandate 2026-06-11) — it is retained only as the TEMPLATE_SIGNATURES reference
// corpus. These tests keep it structurally valid so the signature sync test
// stays meaningful.
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
    withAuthoredStorylets(fallback);
    const normalized = (architect as any).normalizeStructure(fallback, input);
    expect(() => (architect as any).validateStructure(normalized, input)).not.toThrow();
    expect(normalized.storylets?.victory).toBeDefined();
    expect(normalized.storylets?.defeat).toBeDefined();
    expect(normalized.storyboard?.spine.length).toBeGreaterThanOrEqual(7);
    expect(normalized.storyboard?.mechanicsVisibility).toBe('current_clocks_only');
    expect(normalized.storyboard?.sequenceIntent?.objective).toContain('charged confrontation');
    expect(normalized.storyboard?.sequenceIntent?.visualThread).toBeTruthy();
    expect(normalized.storylets?.victory.sequenceIntent?.endState).toBeTruthy();
    expect(normalized.storylets?.defeat.sequenceIntent?.turningPoint).toBeTruthy();
    expect(normalized.payoffContext?.skillPayoffs?.some((p: any) => p.skill === 'persuasion')).toBe(true);
    expect(normalized.beats[0].storyboardFrameId).toBeDefined();
  });

  it('uses NPC names and skills from input in fallback narrative', () => {
    const architect = new EncounterArchitect(config);
    const fallback = (architect as any).buildDeterministicFallback(input);

    const allText = JSON.stringify(fallback);
    expect(allText).toContain('Eros');
    expect(allText).toContain('Alex');
  });

  it('drops unnameable score consequence stubs from normalized storylets', () => {
    const architect = new EncounterArchitect(config);
    const fallback = (architect as any).buildDeterministicFallback(input);
    withAuthoredStorylets(fallback);
    fallback.storylets.victory.consequences = [
      { type: 'score', value: '2' },
      { type: 'score', flag: 'cismigiu_bruised', value: '2', description: 'The trauma forces you to become more resilient.' },
      { type: 'score', name: 'resolve', change: 2 },
    ];

    const normalized = (architect as any).normalizeStructure(fallback, input);
    expect(normalized.storylets.victory.consequences).toEqual([
      { type: 'score', name: 'cismigiu_bruised', change: '2' },
      { type: 'score', name: 'resolve', change: 2 },
    ]);
  });

  it('drops invalid generated encounter conditions instead of shipping dead fields', () => {
    const architect = new EncounterArchitect(config);
    const fallback = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    const openingChoice = fallback.beats[0].choices[0] as any;

    fallback.beats[0].setupTextVariants = [
      { condition: { type: 'flag', value: 'true' }, text: 'This invalid variant should not survive.' },
      { condition: { type: 'flag', flag: 'kept_quartz', value: true }, text: 'The quartz warms against Alex’s palm.' },
    ];
    openingChoice.conditions = { type: 'flag', value: 'true' };
    openingChoice.showWhenLocked = true;
    openingChoice.lockedText = 'Dead locked text';
    openingChoice.statBonus = {
      condition: { type: 'flag', value: 'true' },
      difficultyReduction: 10,
      flavorText: 'Dead bonus',
    };

    const normalized = (architect as any).normalizeStructure(fallback, input);
    const normalizedChoice = normalized.beats[0].choices[0] as any;

    expect(normalized.beats[0].setupTextVariants).toEqual([
      { condition: { type: 'flag', flag: 'kept_quartz', value: true }, text: 'The quartz warms against Alex’s palm.' },
    ]);
    expect(normalizedChoice.conditions).toBeUndefined();
    expect(normalizedChoice.showWhenLocked).toBeUndefined();
    expect(normalizedChoice.lockedText).toBeUndefined();
    expect(normalizedChoice.statBonus).toBeUndefined();
  });

  it('normalizes score stubs in nested encounter outcomes and costs', () => {
    const architect = new EncounterArchitect(config);
    const fallback = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    const openingChoice = fallback.beats[0].choices[0] as any;

    openingChoice.outcomes.success.consequences = [
      { type: 'score', description: 'Alex gains confidence under pressure.', value: '2' },
    ];
    openingChoice.outcomes.complicated.cost = {
      domain: 'self',
      severity: 'minor',
      whoPays: 'protagonist',
      immediateEffect: 'Alex hesitates.',
      visibleComplication: 'Their hesitation remains visible.',
      consequences: [
        { type: 'score', description: 'Alex learns to observe the room.', value: 1 },
      ],
    };

    const normalized = (architect as any).normalizeStructure(fallback, input);
    const normalizedChoice = normalized.beats[0].choices[0] as any;

    expect(normalizedChoice.outcomes.success.consequences).toEqual([
      { type: 'score', name: 'alex_gains_confidence_under', change: '2' },
    ]);
    expect(normalizedChoice.outcomes.complicated.cost.consequences).toEqual([
      { type: 'changeScore', score: 'alex_learns_observe_room', change: 1 },
    ]);
  });

  it('rebalances encounter skill monoculture during normalization', () => {
    const architect = new EncounterArchitect(config);
    const fallback = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    const choices = fallback.beats.flatMap((beat: any) => beat.choices);
    choices[0].primarySkill = 'perception';
    choices[1].primarySkill = 'perception';
    choices[2].primarySkill = 'perception';
    choices[3].primarySkill = 'perception';
    choices[4].primarySkill = 'persuasion';
    choices[5].primarySkill = 'deception';

    const normalized = (architect as any).normalizeStructure(fallback, input);
    const normalizedSkills = normalized.beats
      .flatMap((beat: any) => beat.choices)
      .map((choice: any) => choice.primarySkill);
    const perceptionCount = normalizedSkills.filter((skill: string) => skill === 'perception').length;

    expect(perceptionCount / normalizedSkills.length).toBeLessThanOrEqual(0.4);
  });

  it('uses concrete phase-aware visual fallback actions instead of generic pressure reactions', () => {
    const architect = new EncounterArchitect(config);

    for (const phase of ['setup', 'rising', 'peak', 'resolution'] as const) {
      const contract = (architect as any).buildDefaultVisualContract(
        'The room tightens as everyone waits for the next move.',
        phase,
      );

      expect(contract.primaryAction).toBeTruthy();
      expect(contract.primaryAction).not.toContain('reacts under');
      expect(contract.keyGesture).not.toBe('one decisive hand or body gesture carries the scene');
    expect(contract.mustShowDetail).toMatch(/stance|distance|object|body|outcome|turn|released|tension/i);
    }
  });

  it('Phase-4 fallback emits all four outcome storylets including partialVictory', () => {
    // Regression: buildDefaultStorylets omitted partialVictory, so a defaulted
    // encounter shipped with no costly-victory path and the partialVictory
    // collision check could never fire. The fallback must author all four
    // slots, and partialVictory must carry structured cost data.
    const architect = new EncounterArchitect(config);
    const storylets = (architect as any).buildDefaultStorylets(input);

    expect(storylets.victory).toBeDefined();
    expect(storylets.partialVictory).toBeDefined();
    expect(storylets.defeat).toBeDefined();
    expect(storylets.escape).toBeDefined();

    // partialVictory must satisfy IncrementalEncounterValidator's cost check.
    expect(storylets.partialVictory.cost?.visibleComplication).toBeTruthy();
    expect(storylets.partialVictory.cost?.immediateEffect).toBeTruthy();
  });

  it('prompts for encounter and storylet sequence intent without adding a new mechanics layer', () => {
    const architect = new EncounterArchitect(config);
    const prompt = (architect as any).buildPrompt(input);

    expect(prompt).toContain('sequenceIntent');
    expect(prompt).toContain('required-by-process');
    expect(prompt).toContain('storyboard panels read as one cinematic sequence');
    expect(prompt).toContain('aftermath panels have a narrative objective');
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
    expect(reliable).toContain('storyboard');
    expect(reliable).toContain('current_clocks_only');
    expect(reliable).toContain('position, leverage, information');
    expect(reliable).toContain('opening setupText MUST anchor');
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
  description: 'You face Eros across the hall while the drawn dagger catches the light.',
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

    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, makeAuthoredStorylets(), emptyBrief);

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
    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, makeAuthoredStorylets(), emptyBrief);

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
    const structure = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, makeAuthoredStorylets(), emptyBrief);

    expect(structure.beats[0].choices![0].outcomes.success.nextSituation).toBeDefined();
    expect(structure.beats[0].choices![1].outcomes.success.nextSituation).toBeUndefined();
    expect(structure.beats[0].choices![2].outcomes.success.nextSituation).toBeDefined();
  });

  it('uses Phase 4 storylets when provided', () => {
    const phase1 = makePhase1();
    const phase4: Phase4Result = {
      victory: { id: 'sv', name: 'Custom Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'test', beats: [{ id: 'sv-1', text: 'Custom victory text.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
      partialVictory: { id: 'sp', name: 'Custom Partial', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: 'test', beats: [{ id: 'sp-1', text: 'Custom partial text.', isTerminal: true }], startingBeatId: 'sp-1', consequences: [] },
      defeat: { id: 'sd', name: 'Custom Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'test', beats: [{ id: 'sd-1', text: 'Custom defeat text.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
      escape: { id: 'se', name: 'Custom Escape', triggerOutcome: 'escape', tone: 'relieved', narrativeFunction: 'test', beats: [{ id: 'se-1', text: 'Custom escape text.', isTerminal: true }], startingBeatId: 'se-1', consequences: [] },
    };

    const structure = architect.assemblePhasedEncounter(input, phase1, [], null, phase4, emptyBrief);
    expect(structure.storylets.victory.name).toBe('Custom Victory');
    expect(structure.storylets.defeat.name).toBe('Custom Defeat');
  });

  it('hydrates compact Phase 4 drafts into full runtime storylets', () => {
    const storylet = (architect as any).hydratePhase4StoryletDraft(input, 'defeat', {
      beats: [
        { text: 'The loss lands before Alex can soften it.' },
        { text: 'Eros leaves just enough silence for the lesson to become specific.' },
        { text: 'Alex steadies around what has to change next.' },
      ],
    });

    expect(storylet).toMatchObject({
      id: 'scene-3-sdefeat',
      name: 'Defeat',
      triggerOutcome: 'defeat',
      tone: 'somber',
      startingBeatId: 'scene-3-sdefeat-beat-1',
      consequences: [],
      nextSceneId: 'next-scene',
    });
    expect(storylet.beats.map((beat: any) => beat.id)).toEqual([
      'scene-3-sdefeat-beat-1',
      'scene-3-sdefeat-beat-2',
      'scene-3-sdefeat-beat-3',
    ]);
    expect(storylet.beats[0].nextBeatId).toBe('scene-3-sdefeat-beat-2');
    expect(storylet.beats[2].isTerminal).toBe(true);
  });

  it('rejects Phase 4 drafts that omit required authored prose structure', () => {
    expect(() => (architect as any).hydratePhase4StoryletDraft(input, 'defeat', {
      beats: [{ text: 'Only one defeat beat.' }],
    })).toThrow(/expected 3/);

    expect(() => (architect as any).hydratePhase4StoryletDraft(input, 'partialVictory', {
      beats: [{ text: 'A cost is visible.' }, { text: 'The next moment will remember it.' }],
    })).toThrow(/no cost object/);
  });

  it('recovers nameless generated storylet flags with deterministic encounter outcome names', () => {
    const phase1 = makePhase1();
    const phase4 = makeAuthoredStorylets();
    phase4.victory.consequences = [
      { type: 'flag', value: 'true' } as never,
    ];
    phase4.defeat.consequences = [
      { type: 'flag', value: false } as never,
    ];

    const phase2Results = phase1.openingBeat.choices.map(c => makePhase2(c.id));
    const assembled = architect.assemblePhasedEncounter(input, phase1, phase2Results, null, phase4, emptyBrief);
    const structure = (architect as any).normalizeStructure(assembled, input);

    expect(structure.storylets.victory.consequences).toEqual([
      { type: 'flag', name: 'encounter_scene-3_victory', change: true },
    ]);
    expect(structure.storylets.defeat.consequences).toEqual([
      { type: 'flag', name: 'encounter_scene-3_defeat', change: false },
    ]);
  });

  it('refuses default storylets when Phase 4 fails', () => {
    const phase1 = makePhase1();
    expect(() => architect.assemblePhasedEncounter(input, phase1, [], null, null, emptyBrief))
      .toThrow(/Phase 4 failed to generate authored storylets/);
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

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, makeAuthoredStorylets(), emptyBrief);
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

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, makeAuthoredStorylets(), emptyBrief);
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

    const structure = architect.assemblePhasedEncounter(input, phase1, [], enrichment, makeAuthoredStorylets(), emptyBrief);
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

    const structure = architect.assemblePhasedEncounter(input, phase1, [phase2, null, null], null, makeAuthoredStorylets(), emptyBrief);
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
  it('accepts simplified flat encounters (flat spine is canonical)', () => {
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
          phase: 'change',
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
        escape: { id: 'se', name: 'Escape', triggerOutcome: 'escape', tone: 'relieved', narrativeFunction: 'Aftermath', beats: [{ id: 'se-1', text: 'Escape.', isTerminal: true }], startingBeatId: 'se-1', consequences: [] },
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
    // W2 flip: the flat two-beat spine survives (no tree collapse).
    expect(normalized.beats).toHaveLength(2);
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

// ========================================================================
// Blueprint branch discipline: storylet convergence guard
// ========================================================================

describe('enforceStoryletConvergence', () => {
  const makeStorylets = () => ({
    victory: { id: 'sv', nextSceneId: 'scene-4' } as any,
    partialVictory: { id: 'sp', nextSceneId: 'invented-scene' } as any,
    defeat: { id: 'sd', nextSceneId: 'scene-99' } as any,
    escape: undefined,
  });

  it('rewrites unplanned routes to the planned next scene when isBranchPoint is false', () => {
    const storylets = makeStorylets();
    const corrections = enforceStoryletConvergence(storylets, {
      isBranchPoint: false,
      victoryNextSceneId: 'scene-4',
      defeatNextSceneId: 'scene-4',
    });
    expect(corrections).toEqual([
      { slot: 'partialVictory', from: 'invented-scene', to: 'scene-4' },
      { slot: 'defeat', from: 'scene-99', to: 'scene-4' },
    ]);
    expect(storylets.partialVictory.nextSceneId).toBe('scene-4');
    expect(storylets.defeat.nextSceneId).toBe('scene-4');
    expect(storylets.victory.nextSceneId).toBe('scene-4');
  });

  it('leaves storylets untouched when isBranchPoint is true', () => {
    const storylets = makeStorylets();
    const corrections = enforceStoryletConvergence(storylets, {
      isBranchPoint: true,
      victoryNextSceneId: 'scene-4',
      defeatNextSceneId: 'scene-5',
    });
    expect(corrections).toEqual([]);
    expect(storylets.partialVictory.nextSceneId).toBe('invented-scene');
    expect(storylets.defeat.nextSceneId).toBe('scene-99');
  });

  it('leaves storylets untouched when isBranchPoint is undefined (unknown)', () => {
    const storylets = makeStorylets();
    const corrections = enforceStoryletConvergence(storylets, {
      victoryNextSceneId: 'scene-4',
      defeatNextSceneId: 'scene-4',
    });
    expect(corrections).toEqual([]);
    expect(storylets.partialVictory.nextSceneId).toBe('invented-scene');
  });

  it('no-ops when there is no planned next scene id or no storylets', () => {
    const storylets = makeStorylets();
    expect(enforceStoryletConvergence(storylets, { isBranchPoint: false })).toEqual([]);
    expect(storylets.defeat.nextSceneId).toBe('scene-99');
    expect(enforceStoryletConvergence(undefined, {
      isBranchPoint: false,
      victoryNextSceneId: 'scene-4',
    })).toEqual([]);
  });
});

// ========================================================================
// Prose discipline + NPC voice injection into the phase/lean prompts
// ========================================================================

describe('prose discipline and NPC voice injection', () => {
  const architect = new EncounterArchitect(config);
  const brief = { npcDynamics: [], knockOnEffects: [], briefText: '' };
  const voiceNotes = 'Speaks in clipped, archaic threats; never raises his voice.';
  const voicedInput: EncounterArchitectInput = {
    ...input,
    npcsInvolved: [{ ...input.npcsInvolved[0], voiceNotes }],
  };
  const phase2Choice = {
    id: 'c1', text: 'Grab the dagger', approach: 'bold', primarySkill: 'athletics',
    outcomes: {
      success: { narrativeText: 'You grab it.', goalTicks: 2, threatTicks: 0 },
      complicated: { narrativeText: 'You cut yourself.', goalTicks: 1, threatTicks: 1 },
      failure: { narrativeText: 'He slashes.', goalTicks: 0, threatTicks: 2 },
    },
  };
  const phase3Input: EncounterArchitectInput = {
    ...voicedInput,
    priorStateContext: {
      relevantFlags: [{ name: 'saved_eros', description: 'Player saved Eros earlier' }],
      relevantRelationships: [],
      significantChoices: [],
    },
  };

  const buildAllPrompts = (forInput: EncounterArchitectInput): string[] => [
    (architect as any).buildPhase1Prompt(forInput, brief),
    (architect as any).buildPhase2Prompt(forInput, brief, phase2Choice),
    (architect as any).buildPhase3Prompt({ ...phase3Input, npcsInvolved: forInput.npcsInvolved }, makePhase1()),
    (architect as any).buildPhase4Prompt(forInput, brief),
    (architect as any).buildReliablePrompt(forInput),
  ];

  it('includes ENCOUNTER_PROSE_DISCIPLINE exactly once in every phase prompt and the lean prompt', () => {
    for (const prompt of buildAllPrompts(voicedInput)) {
      expect(prompt).toContain(ENCOUNTER_PROSE_DISCIPLINE);
      expect(prompt.split('## PROSE DISCIPLINE').length - 1).toBe(1);
    }
  });

  it('renders the planned encounter Story Circle target in every generation prompt', () => {
    for (const prompt of buildAllPrompts(voicedInput)) {
      expect(prompt).toContain('Story Circle Target: take');
      expect(prompt).toContain('demands a relationship cost');
    }
  });

  it('renders an NPC Voice line in Phase 1, Phase 2, Phase 4, and lean prompts when voiceNotes is present', () => {
    const [p1, p2, , p4, lean] = buildAllPrompts(voicedInput);
    for (const prompt of [p1, p2, p4, lean]) {
      expect(prompt).toContain(`Voice: ${voiceNotes}`);
    }
  });

  it('omits the Voice line when voiceNotes is absent or empty', () => {
    const emptyVoiceInput: EncounterArchitectInput = {
      ...input,
      npcsInvolved: [{ ...input.npcsInvolved[0], voiceNotes: '' }],
    };
    for (const forInput of [input, emptyVoiceInput]) {
      const [p1, p2, , p4, lean] = buildAllPrompts(forInput);
      for (const prompt of [p1, p2, p4, lean]) {
        expect(prompt).not.toContain('Voice: ');
      }
    }
  });
});

describe('authored anchor (G12)', () => {
  const anchoredInput: EncounterArchitectInput = {
    ...input,
    centralConflict: "Aethavyr's flawless-protector image is eroded by an unwinnable situation.",
    signatureMoment: 'Cordial shared on the battlements as the wall fires gutter.',
    requiredBeats: [
      { id: 'rb1', mustDepict: 'On the battlements, the two confess fears and doubts.', tier: 'authored' },
      { id: 'rb2', mustDepict: "Darian's quiet maneuvering positions the poison; evacuation under truce is forced.", tier: 'authored' },
      { id: 'rb3', mustDepict: 'A connective transition the model may invent.', tier: 'connective' },
    ],
  };

  it('renders the anchor section with central conflict, signature, and non-connective beats', () => {
    const architect = new EncounterArchitect(config);
    const section = (architect as any).buildAuthoredAnchorSection(anchoredInput) as string;

    expect(section).toContain('AUTHORED ANCHOR');
    expect(section).toContain("Aethavyr's flawless-protector image");
    expect(section).toContain('Cordial shared on the battlements');
    expect(section).toContain("Darian's quiet maneuvering positions the poison");
    // connective-tier beats are the model's invention band — never pinned.
    expect(section).not.toContain('connective transition the model may invent');
  });

  it('returns an empty section for unanchored encounters', () => {
    const architect = new EncounterArchitect(config);
    expect((architect as any).buildAuthoredAnchorSection(input)).toBe('');
  });

  it('feeds the anchor into the lean prompt', () => {
    const architect = new EncounterArchitect(config);
    const prompt = (architect as any).buildReliablePrompt(anchoredInput) as string;
    expect(prompt).toContain('AUTHORED ANCHOR');
    expect(prompt).toContain('positions the poison');
  });

  it('detects a sustained set piece from the authored anchor fields', () => {
    const architect = new EncounterArchitect(config);
    const sustained: EncounterArchitectInput = {
      ...input,
      centralConflict: 'A sustained defensive set piece — wall breach and repulse.',
    };
    expect((architect as any).isSustainedSetPieceInput(sustained)).toBe(true);
    expect((architect as any).isSustainedSetPieceInput(input)).toBe(false);
  });

  it('rejects a sustained set piece that collapsed below 3 top-level beats', () => {
    const architect = new EncounterArchitect(config);
    const sustained: EncounterArchitectInput = {
      ...input,
      encounterDescription: 'The siege itself — a sustained defensive set piece (wall breach + repulse).',
    };
    // A collapsed structure: the non-sustained 2-beat fallback shape truncated
    // to a single beat stands in for tree-collapsed output.
    const collapsed = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    collapsed.beats = collapsed.beats.slice(0, 1);
    expect(() => (architect as any).validateStructure(collapsed, sustained))
      .toThrow(/sustained set piece.*top-level beat/i);
    // The 2-beat fallback passes for a non-sustained encounter.
    let plain = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    plain = (architect as any).normalizeStructure(plain, input);
    expect(() => (architect as any).validateStructure(plain, input)).not.toThrow();
  });

  it('sustained set piece survives the full fallback → normalize → validate path', () => {
    // endsong-g13 ep3 regression: normalizeStructure's flat→tree conversion
    // pruned every beat but the first, so validateStructure rejected EVERY
    // attempt including the deterministic fallback and the episode aborted.
    const architect = new EncounterArchitect(config);
    const sustained: EncounterArchitectInput = {
      ...input,
      encounterDescription: 'The siege itself — a sustained defensive set piece (wall breach + repulse).',
    };
    // The fallback ships the 3-beat floor for sustained pieces…
    let structure = withAuthoredStorylets((architect as any).buildDeterministicFallback(sustained));
    expect(structure.beats.length).toBeGreaterThanOrEqual(3);
    // …and normalizeStructure must NOT collapse it back to one top-level beat.
    structure = (architect as any).normalizeStructure(structure, sustained);
    expect(structure.beats.length).toBeGreaterThanOrEqual(3);
    expect(() => (architect as any).validateStructure(structure, sustained)).not.toThrow();
    // The opening beat routes through the escalation beat, which routes to the
    // change — the spine stays connected.
    const beatIds = structure.beats.map((b: any) => b.id);
    expect(beatIds).toContain('beat-escalation');
    for (const choice of structure.beats[0].choices) {
      for (const tier of ['success', 'complicated', 'failure']) {
        const outcome = choice.outcomes?.[tier];
        if (outcome && !outcome.isTerminal && !outcome.nextSituation) {
          expect(outcome.nextBeatId).toBe('beat-escalation');
        }
      }
    }
  });

  it('keeps the flat multi-beat spine for non-sustained encounters (W2 flip: no tree conversion)', () => {
    const architect = new EncounterArchitect(config);
    let plain = withAuthoredStorylets((architect as any).buildDeterministicFallback(input));
    plain = (architect as any).normalizeStructure(plain, input);
    // Flat-canonical: the multi-beat nextBeatId spine survives normalization
    // and no outcome embeds a nextSituation.
    expect(plain.beats.length).toBeGreaterThanOrEqual(2);
    const hasEmbeddedBranch = plain.beats.some((b: any) => (b.choices || []).some((c: any) =>
      ['success', 'complicated', 'failure'].some(t => c.outcomes?.[t]?.nextSituation)
    ));
    expect(hasEmbeddedBranch).toBe(false);
  });
});

describe('flattenTreeToBeats (encounter unification W2b)', () => {
  const makeArchitect = () => new EncounterArchitect(config);

  const treeStructure = () => ({
    sceneId: 'enc-1',
    startingBeatId: 'b1',
    beats: [{
      id: 'b1',
      phase: 'rising',
      name: 'Standoff',
      setupText: 'The guard blocks the corridor.',
      choices: [{
        id: 'c1',
        text: 'Talk your way past',
        approach: 'clever',
        outcomes: {
          success: {
            narrativeText: 'He wavers.',
            nextSituation: {
              setupText: 'The corridor opens ahead, but a second voice calls out.',
              choices: [{
                id: 'c1-deep',
                text: 'Keep walking',
                approach: 'cautious',
                outcomes: {
                  success: { isTerminal: true, encounterOutcome: 'victory', narrativeText: 'You slip through.' },
                  complicated: { isTerminal: true, encounterOutcome: 'partialVictory', narrativeText: 'Through, but seen.', cost: { domain: 'social', severity: 'minor', whoPays: 'you', immediateEffect: 'seen', visibleComplication: 'a raised brow', lingeringEffect: 'watchfulness' } },
                  failure: { isTerminal: true, encounterOutcome: 'defeat', narrativeText: 'Cornered.' },
                },
              }],
            },
          },
          complicated: { isTerminal: true, encounterOutcome: 'partialVictory', narrativeText: 'Half past.', cost: { domain: 'social', severity: 'minor', whoPays: 'you', immediateEffect: 'x', visibleComplication: 'y', lingeringEffect: 'z' } },
          failure: { isTerminal: true, encounterOutcome: 'defeat', narrativeText: 'No.' },
        },
      }],
    }],
  });

  it('materializes embedded situations as beats with nextBeatId routing, recursively and losslessly', () => {
    const architect = makeArchitect();
    const structure = treeStructure();
    (architect as any).flattenTreeToBeats(structure);

    expect(structure.beats).toHaveLength(2);
    const success = structure.beats[0].choices[0].outcomes.success as any;
    expect(success.nextSituation).toBeUndefined();
    expect(success.nextBeatId).toBe('b1-c1-success');
    const newBeat = structure.beats[1] as any;
    expect(newBeat.id).toBe('b1-c1-success');
    expect(newBeat.setupText).toContain('second voice calls out');
    expect(newBeat.phase).toBe('rising');
    expect(newBeat.choices[0].id).toBe('c1-deep');
    expect(newBeat.choices[0].outcomes.success.encounterOutcome).toBe('victory');
  });

  it('is idempotent and a no-op on already-flat structures', () => {
    const architect = makeArchitect();
    const structure = treeStructure();
    (architect as any).flattenTreeToBeats(structure);
    const once = JSON.stringify(structure);
    (architect as any).flattenTreeToBeats(structure);
    expect(JSON.stringify(structure)).toBe(once);
  });

  it('flattenTreeToBeats leaves no embedded situations (flat spine is canonical)', () => {
    const architect = makeArchitect();
    const structure = treeStructure();
    (architect as any).flattenTreeToBeats(structure);
    const treeRouted = structure.beats.some((b: any) => (b.choices || []).some((c: any) =>
      Object.values(c.outcomes || {}).some((o: any) => o?.nextSituation)));
    expect(treeRouted).toBe(false);
  });
});
