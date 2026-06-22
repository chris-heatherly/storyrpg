import { describe, it, expect, afterEach } from 'vitest';
import { ChoiceAuthor } from './ChoiceAuthor';
import { BaseAgent } from './BaseAgent';
import { buildChoiceSetJsonSchema } from '../schemas/choiceSetSchema';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeInput(overrides?: Record<string, unknown>): any {
  return {
    sceneBlueprint: {
      id: 'scene-1',
      name: 'Test Scene',
      choicePoint: {
        stakes: { want: 'win', cost: 'lose', identity: 'learn' },
        consequenceDomain: 'social',
        optionHints: ['Option A', 'Option B', 'Option C'],
      },
    },
    beatText: 'The moment of truth.',
    beatId: 'beat-1',
    storyContext: { title: 'Test Story', genre: 'Drama', tone: 'Tense' },
    protagonistInfo: { name: 'Alex', pronouns: 'they/them' },
    npcsInScene: [],
    availableFlags: [],
    availableScores: [],
    availableTags: [],
    possibleNextScenes: [{ id: 'scene-2', name: 'Next Scene' }],
    optionCount: 3,
    ...overrides,
  };
}

function makeChoiceSet(overrides?: Record<string, unknown>): any {
  const { allowShortChoices: _allowShortChoices, ...rest } = overrides || {};
  const choiceSet = {
    beatId: 'beat-1',
    choiceType: 'expression',
    choices: [
      { id: 'c1', text: 'Do the first thing', choiceType: 'expression', consequences: [] },
      { id: 'c2', text: 'Do the second thing', choiceType: 'expression', consequences: [] },
      { id: 'c3', text: 'Do the third thing', choiceType: 'expression', consequences: [] },
    ],
    overallStakes: { want: 'win', cost: 'lose', identity: 'learn' },
    designNotes: 'Test notes',
    ...rest,
  };
  if (!_allowShortChoices && Array.isArray(choiceSet.choices) && choiceSet.choices.length > 0 && choiceSet.choices.length < 3) {
    while (choiceSet.choices.length < 3) {
      const i = choiceSet.choices.length + 1;
      choiceSet.choices.push({ id: `fixture-c${i}`, text: `Fixture option ${i}`, choiceType: choiceSet.choiceType, consequences: [] });
    }
  }
  return choiceSet;
}

// -----------------------------------------------------------------------
// validateChoices
// -----------------------------------------------------------------------

describe('ChoiceAuthor.validateChoices', () => {
  const author = new ChoiceAuthor(config);
  const input = makeInput();

  it('includes StoryRPG-shaped choice residue example without stat-visible prose', () => {
    const prompt = (author as any).getAgentSpecificPrompt();
    expect(prompt).toContain('Example: StoryRPG Choice Residue');
    expect(prompt).toContain('want, cost, identity');
    expect(prompt).toContain('without exposing stats');
    expect(prompt).toContain('Turns over topics');
    expect(prompt).toContain('trust, evidence, leverage');
    expect(prompt).toContain('visible story changes');
    expect(prompt).not.toContain('schema_chapters');
  });

  it('derives required choice schema fields from the deterministic planner choice type', () => {
    const relationship = buildChoiceSetJsonSchema({ choiceType: 'relationship', branching: false });
    expect(relationship.maxOutputTokens).toBe(12000);
    const relChoice = (relationship.schema as any).properties.choices.items;
    expect(relChoice.required).toEqual(expect.arrayContaining([
      'choiceType',
      'choiceIntent',
      'impactFactors',
      'consequenceTier',
      'consequences',
      'reactionText',
      'tintFlag',
      'statCheck',
      'residueHints',
    ]));
    expect(relChoice.properties.statCheck.required).toEqual(['skillWeights', 'difficulty']);
    expect(relChoice.properties.tintFlag.enum).toEqual(expect.arrayContaining(['tint:honesty', 'tint:teamwork']));

    const expression = buildChoiceSetJsonSchema({ choiceType: 'expression', branching: false });
    const expressionChoice = (expression.schema as any).properties.choices.items;
    expect(expressionChoice.required).toEqual(expect.arrayContaining(['reactionText', 'tintFlag']));
    expect(expressionChoice.required).not.toContain('statCheck');
    expect(expressionChoice.required).not.toContain('residueHints');

    const branch = buildChoiceSetJsonSchema({ choiceType: 'strategic', branching: true });
    const branchChoice = (branch.schema as any).properties.choices.items;
    expect(branchChoice.required).toContain('nextSceneId');
    expect(branchChoice.required).not.toContain('tintFlag');
  });

  it('normalizes stat-check difficulty and skill weights before returning choices', async () => {
    BaseAgent.setLlmTransportOverride(async () => JSON.stringify({
      beatId: 'beat-1',
      choiceType: 'relationship',
      choices: [
        {
          id: 'c1',
          text: 'Ask Mika for the truth',
          choiceType: 'relationship',
          choiceIntent: 'truth',
          impactFactors: ['relationship'],
          consequenceTier: 'callback',
          stakesAnnotation: { want: 'understand her', cost: 'risk the friendship', identity: 'choose candor' },
          consequences: [{ type: 'setFlag', flag: 'asked_mika_truth', value: true }],
          outcomeTexts: { success: 'Mika answers softly.', partial: 'Mika gives you half the truth.', failure: 'Mika smiles around the answer.' },
          reactionText: 'The table goes quiet.',
          tintFlag: 'tint:honesty',
          statCheck: { skillWeights: { persuasion: 1, perception: 0.5 }, difficulty: 30 },
          residueHints: [{ kind: 'relationship_behavior', description: 'Mika remembers the direct question.' }],
        },
        {
          id: 'c2',
          text: 'Let Mika change the subject',
          choiceType: 'relationship',
          choiceIntent: 'avoidance',
          impactFactors: ['relationship'],
          consequenceTier: 'callback',
          stakesAnnotation: { want: 'keep peace', cost: 'miss the tell', identity: 'choose comfort' },
          consequences: [{ type: 'setFlag', flag: 'let_mika_evade', value: true }],
          outcomeTexts: { success: 'Mika relaxes.', partial: 'Mika notices the mercy.', failure: 'Mika fills the silence too fast.' },
          reactionText: 'The question dies between you.',
          tintFlag: 'tint:teamwork',
          statCheck: { skillWeights: { perception: 1.5 }, difficulty: 90 },
          residueHints: [{ kind: 'relationship_behavior', description: 'Mika learns you will let her evade.' }],
        },
        {
          id: 'c3',
          text: 'Ask Mika what she needs',
          choiceType: 'relationship',
          choiceIntent: 'support',
          impactFactors: ['relationship'],
          consequenceTier: 'callback',
          stakesAnnotation: { want: 'support Mika', cost: 'invite a difficult answer', identity: 'choose care' },
          consequences: [{ type: 'setFlag', flag: 'asked_mika_needs', value: true }],
          outcomeTexts: { success: 'Mika lets the question soften her.', partial: 'Mika answers around the edges.', failure: 'Mika turns care into a joke.' },
          reactionText: 'The question offers Mika a gentler door.',
          tintFlag: 'tint:empathy',
          statCheck: { skillWeights: { persuasion: 1 }, difficulty: 45 },
          residueHints: [{ kind: 'relationship_behavior', description: 'Mika remembers that you asked what she needed.' }],
        },
      ],
      overallStakes: { want: 'read Mika', cost: 'strain the friendship', identity: 'choose candor or comfort' },
      designNotes: 'Stat normalization test.',
    }));

    const author = new ChoiceAuthor(config);
    const result = await author.execute(makeInput({
      optionCount: 3,
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Mika Table',
        choicePoint: {
          type: 'relationship',
          stakes: { want: 'read Mika', cost: 'strain the friendship', identity: 'choose candor or comfort' },
          optionHints: ['Ask directly', 'Let it go'],
        },
      },
    }));

    expect(result.success).toBe(true);
    expect(result.data?.choices[0].statCheck?.difficulty).toBe(35);
    expect(result.data?.choices[0].statCheck?.skillWeights).toEqual({ persuasion: 0.6667, perception: 0.3333 });
    expect(result.data?.choices[1].statCheck?.difficulty).toBe(80);
    expect(result.data?.choices[1].statCheck?.skillWeights).toEqual({ perception: 1 });
  });

  it('throws on fewer than 3 choices', () => {
    const choiceSet = makeChoiceSet({
      allowShortChoices: true,
      choices: [
        { id: 'c1', text: 'Only one', choiceType: 'expression', consequences: [] },
        { id: 'c2', text: 'Only two', choiceType: 'expression', consequences: [] },
      ],
    });
    expect(() => (author as any).validateChoices(choiceSet, input)).toThrow('Must have at least 3 choices');
  });

  it('throws on more than 4 choices', () => {
    const choices = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`, text: `Choice ${i}`, choiceType: 'expression', consequences: [],
    }));
    const choiceSet = makeChoiceSet({ choices });
    expect(() => (author as any).validateChoices(choiceSet, input)).toThrow('Should not have more than 4 choices');
  });

  it('throws on duplicate choice IDs', () => {
    const choiceSet = makeChoiceSet({
      choices: [
        { id: 'dup', text: 'First', choiceType: 'expression', consequences: [] },
        { id: 'dup', text: 'Second', choiceType: 'expression', consequences: [] },
      ],
    });
    expect(() => (author as any).validateChoices(choiceSet, input)).toThrow('Choice IDs must be unique');
  });

  it('auto-injects skillWeights for strategic type missing statCheck', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'strategic' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].statCheck).toBeDefined();
    expect(choiceSet.choices[0].statCheck.skillWeights).toEqual({ investigation: 1.0 });
    expect(choiceSet.choices[0].statCheck.difficulty).toBe(50);
  });

  it('auto-injects skillWeights for relationship type (persuasion)', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'relationship' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].statCheck).toBeDefined();
    expect(choiceSet.choices[0].statCheck.skillWeights).toEqual({ persuasion: 1.0 });
    expect(choiceSet.choices[0].statCheck.difficulty).toBe(50);
  });

  it('auto-injects skillWeights for dilemma type (survival, difficulty 60)', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'dilemma' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].statCheck).toBeDefined();
    expect(choiceSet.choices[0].statCheck.skillWeights).toEqual({ survival: 1.0 });
    expect(choiceSet.choices[0].statCheck.difficulty).toBe(60);
  });

  it('adds an advisory moral contract to dilemma choices missing one', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'dilemma' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].moralContract).toMatchObject({
      valueA: 'win',
      valueB: 'learn',
      unavoidableCost: 'lose',
    });
  });

  it('adds residue hints for meaningful non-expression choices missing them', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'relationship' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].residueHints).toEqual([
      expect.objectContaining({
        kind: 'immediate_prose_echo',
        description: expect.stringContaining('echo'),
      }),
    ]);
  });

  it('does not inject statCheck for expression type', () => {
    const choiceSet = makeChoiceSet({ choiceType: 'expression' });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].statCheck).toBeUndefined();
  });

  it('does not inject statCheck when a choice already has one', () => {
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        { id: 'c1', text: 'Investigate', choiceType: 'strategic', consequences: [], statCheck: { skillWeights: { perception: 1.0 }, difficulty: 55 } },
        { id: 'c2', text: 'Other approach', choiceType: 'strategic', consequences: [] },
      ],
    });
    (author as any).validateChoices(choiceSet, input);
    expect(choiceSet.choices[0].statCheck.skillWeights).toEqual({ perception: 1.0 });
    expect(choiceSet.choices[1].statCheck).toBeUndefined();
  });

  it('preserves authored skills when no season skill plan is active', () => {
    const fresh = new ChoiceAuthor(config);
    (fresh as any).skillUsage = { perception: 5 };
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        { id: 'c1', text: 'Investigate', choiceType: 'strategic', consequences: [], statCheck: { skillWeights: { perception: 1.0 }, difficulty: 55 } },
        { id: 'c2', text: 'Other approach', choiceType: 'strategic', consequences: [] },
      ],
    });
    (fresh as any).validateChoices(choiceSet, input);
    // No setEpisodeSkillTargets -> rebalance is a no-op even though perception is over-used.
    expect(choiceSet.choices[0].statCheck.skillWeights).toEqual({ perception: 1.0 });
  });

  it('rebalances an over-used authored skill toward an under-used one when a skill plan is active', () => {
    const fresh = new ChoiceAuthor(config);
    fresh.setEpisodeSkillTargets(['investigation', 'perception', 'stealth', 'athletics', 'survival']);
    (fresh as any).skillUsage = { perception: 4 };
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        { id: 'c1', text: 'Investigate', choiceType: 'strategic', consequences: [], statCheck: { skillWeights: { perception: 1.0 }, difficulty: 55 } },
        { id: 'c2', text: 'Other approach', choiceType: 'strategic', consequences: [] },
      ],
    });
    (fresh as any).validateChoices(choiceSet, input);
    const skill = Object.keys(choiceSet.choices[0].statCheck.skillWeights)[0];
    expect(skill).not.toBe('perception');
    expect(['investigation', 'stealth', 'athletics', 'survival']).toContain(skill);
    // difficulty preserved from the authored check
    expect(choiceSet.choices[0].statCheck.difficulty).toBe(55);
  });
});

// -----------------------------------------------------------------------
// normalizeChoiceSet
// -----------------------------------------------------------------------

describe('ChoiceAuthor.normalizeChoiceSet', () => {
  const author = new ChoiceAuthor(config);
  const input = makeInput();

  it('trims to 4 choices when more are provided', () => {
    const choices = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, text: `Choice ${i}`, choiceType: 'expression', consequences: [],
    }));
    const choiceSet = makeChoiceSet({ choices });
    const result = (author as any).normalizeChoiceSet(choiceSet, input);
    expect(result.choices).toHaveLength(4);
  });

  it('rejects fewer than 3 choices instead of padding placeholders', () => {
    const choiceSet = makeChoiceSet({
      allowShortChoices: true,
      choices: [{ id: 'c1', text: 'Only one', choiceType: 'expression', consequences: [] }],
    });
    expect(() => (author as any).normalizeChoiceSet(choiceSet, input)).toThrow('refusing to synthesize placeholder choices');
  });

  it('forces the planner-assigned choicePoint.type over the LLM set type (Phase D)', () => {
    const plannedInput = makeInput({
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        choicePoint: {
          type: 'strategic', // the planner's assignment
          stakes: { want: 'win', cost: 'lose', identity: 'learn' },
        },
      },
    });
    // The LLM authored the set (and every choice) as 'expression'.
    const choiceSet = makeChoiceSet({ choiceType: 'expression' });
    const result = (author as any).normalizeChoiceSet(choiceSet, plannedInput);
    expect(result.choiceType).toBe('strategic');
    expect(result.choices.every((c: any) => c.choiceType === 'strategic')).toBe(true);
  });

  it('falls back to the LLM type when no plan exists', () => {
    const result = (author as any).normalizeChoiceSet(makeChoiceSet({ choiceType: 'relationship' }), input);
    expect(result.choiceType).toBe('relationship'); // makeInput's choicePoint has no `type`
  });

  it('assigns retryableAfterChange when competenceArc with growthPath is present', () => {
    const inputWithArc = makeInput({
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        choicePoint: {
          stakes: { want: 'win', cost: 'lose', identity: 'learn' },
          competenceArc: { testsNow: 'persuasion', shortfall: 'low charm', growthPath: 'practice' },
        },
      },
    });
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        { id: 'c1', text: 'Try it', choiceType: 'strategic', consequences: [], statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 55 } },
        { id: 'c2', text: 'Other', choiceType: 'strategic', consequences: [] },
      ],
    });
    const result = (author as any).normalizeChoiceSet(choiceSet, inputWithArc);
    expect(result.choices[0].statCheck.retryableAfterChange).toBe(true);
  });

  it('sets feedbackCue.checkClass to retryable when competenceArc.growthPath is present', () => {
    const inputWithArc = makeInput({
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        choicePoint: {
          stakes: { want: 'win', cost: 'lose', identity: 'learn' },
          competenceArc: { growthPath: 'mentor training' },
        },
      },
    });
    const choiceSet = makeChoiceSet({
      choices: [
        { id: 'c1', text: 'Try it', choiceType: 'expression', consequences: [] },
        { id: 'c2', text: 'Other', choiceType: 'expression', consequences: [] },
      ],
    });
    const result = (author as any).normalizeChoiceSet(choiceSet, inputWithArc);
    expect(result.choices[0].feedbackCue?.checkClass).toBe('retryable');
  });

  it('does not synthesize generic reminder or echo prose when story-specific text is missing', () => {
    const choiceSet = makeChoiceSet({
      choices: [
        { id: 'c1', text: 'Ask plainly', choiceType: 'expression', consequences: [] },
        { id: 'c2', text: 'Hold back', choiceType: 'expression', consequences: [] },
      ],
    });

    const result = (author as any).normalizeChoiceSet(choiceSet, input);

    expect(result.choices[0].reminderPlan).toBeUndefined();
    expect(result.choices[0].feedbackCue?.echoSummary).toBeUndefined();
    expect(result.choices[0].feedbackCue?.progressSummary).toBeUndefined();
    expect(result.choices[0].feedbackCue?.checkClass).toBe('dramatic');
  });

  it('preserves authored story-specific reminder prose for reader feedback', () => {
    const choiceSet = makeChoiceSet({
      choices: [
        {
          id: 'c1',
          text: 'Give Mika the card',
          choiceType: 'expression',
          consequences: [],
          reminderPlan: {
            immediate: 'Mika tucks the card away without meeting your eyes.',
            shortTerm: 'The lie between you and Mika gets harder to ignore.',
          },
        },
        { id: 'c2', text: 'Keep it', choiceType: 'expression', consequences: [] },
      ],
    });

    const result = (author as any).normalizeChoiceSet(choiceSet, input);

    expect(result.choices[0].reminderPlan?.immediate).toBe('Mika tucks the card away without meeting your eyes.');
    expect(result.choices[0].feedbackCue?.echoSummary).toBe('Mika tucks the card away without meeting your eyes.');
    expect(result.choices[0].feedbackCue?.progressSummary).toBe('The lie between you and Mika gets harder to ignore.');
  });

  it('infers affordanceSource from choice conditions', () => {
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        {
          id: 'c1',
          text: 'Use the stolen seal',
          choiceType: 'strategic',
          consequences: [],
          conditions: { type: 'item', itemId: 'stolen-seal', hasItem: true },
        },
        { id: 'c2', text: 'Try something else', choiceType: 'strategic', consequences: [] },
      ],
    });

    const result = (author as any).normalizeChoiceSet(choiceSet, input);
    expect(result.choices[0].affordanceSource).toBe('item');
  });

  it('infers storyVerb from provided story verbs and consequence domain', () => {
    const inputWithVerbs = makeInput({
      storyVerbs: [
        {
          verb: 'bribe',
          description: 'Buy cooperation.',
          typicalSources: ['item'],
          consequenceDomains: ['resource', 'relationship'],
        },
      ],
    });
    const choiceSet = makeChoiceSet({
      choiceType: 'relationship',
      choices: [
        {
          id: 'c1',
          text: 'Offer a private payment',
          choiceType: 'relationship',
          consequences: [],
          consequenceDomain: 'relationship',
        },
        { id: 'c2', text: 'Ask plainly', choiceType: 'relationship', consequences: [] },
      ],
    });

    const result = (author as any).normalizeChoiceSet(choiceSet, inputWithVerbs);
    expect(result.choices[0].storyVerb).toBe('bribe');
  });

  it('preserves witnessReactions and failureResidue metadata', () => {
    const choiceSet = makeChoiceSet({
      choiceType: 'strategic',
      choices: [
        {
          id: 'c1',
          text: 'Pressure the witness',
          choiceType: 'strategic',
          consequences: [],
          statCheck: { skillWeights: { intimidation: 1.0 }, difficulty: 55 },
          witnessReactions: [{
            npcId: 'mara',
            stance: 'questions',
            reactionText: 'Mara goes quiet.',
          }],
          failureResidue: {
            kind: 'lost_leverage',
            description: 'The witness becomes harder to reach.',
          },
        },
        { id: 'c2', text: 'Wait for calm', choiceType: 'strategic', consequences: [] },
      ],
    });

    const result = (author as any).normalizeChoiceSet(choiceSet, input);
    expect(result.choices[0].witnessReactions).toEqual([
      expect.objectContaining({ npcId: 'mara', stance: 'questions' }),
    ]);
    expect(result.choices[0].failureResidue).toEqual(
      expect.objectContaining({ kind: 'lost_leverage' }),
    );
  });
});

describe('ChoiceAuthor.normalizeConsequenceTier (1.3 flag → callback)', () => {
  const author: any = new ChoiceAuthor(config);
  const tier = (choice: any, choiceType: any) => author.normalizeConsequenceTier(choice, choiceType);

  it('classifies a choice that sets a trackable flag as callback', () => {
    const choice = { id: 'c1', consequences: [{ type: 'setFlag', flag: 'spared_herald', value: true }] };
    expect(tier(choice, 'relationship')).toBe('callback');
  });

  it('does NOT treat tint or routing flags as callback', () => {
    const tintOnly = { id: 'c2', consequences: [{ type: 'setFlag', flag: 'tint:mercy', value: true }] };
    expect(tier(tintOnly, 'relationship')).toBe('sceneTint');
    const routeOnly = { id: 'c3', consequences: [{ type: 'setFlag', flag: 'route_left', value: true }] };
    // routing flag isn't a callback; a non-dilemma with no trackable flag falls to sceneTint
    expect(tier(routeOnly, 'relationship')).toBe('sceneTint');
  });

  it('preserves existing tier and routing precedence', () => {
    expect(tier({ id: 'c4', nextSceneId: 'scene-2', consequences: [{ type: 'setFlag', flag: 'x', value: true }] }, 'strategic')).toBe('structuralBranch');
    expect(tier({ id: 'c5', consequenceTier: 'branchlet', consequences: [{ type: 'setFlag', flag: 'x', value: true }] }, 'strategic')).toBe('branchlet');
    expect(tier({ id: 'c6' }, 'expression')).toBe('sceneTint');
    expect(tier({ id: 'c7', consequences: [] }, 'dilemma')).toBe('branchlet');
  });
});

describe('ChoiceAuthor relationship consequence repair', () => {
  it('adds relationship consequences when a relationship choice omits them', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        { id: 'c1', text: 'Trust Mika with the truth', choiceType: 'relationship', consequences: [] },
        { id: 'c2', text: 'Refuse Mika and hide it', choiceType: 'relationship', consequences: [] },
      ],
    });
    const input = makeInput({
      npcsInScene: [{ id: 'mika', name: 'Mika', pronouns: 'she/her', description: 'Friend' }],
    });

    author.validateChoices(choiceSet, input);

    expect(choiceSet.choices[0].consequences).toContainEqual(
      expect.objectContaining({ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 5 }),
    );
    expect(choiceSet.choices[1].consequences).toContainEqual(
      expect.objectContaining({ type: 'relationship', npcId: 'mika', dimension: 'trust', change: -3 }),
    );
  });

  it('does not target the protagonist when repairing missing relationship consequences', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        { id: 'c1', text: 'Trust Mika with the truth', choiceType: 'relationship', consequences: [] },
        { id: 'c2', text: 'Refuse Mika and hide it', choiceType: 'relationship', consequences: [] },
      ],
    });
    const input = makeInput({
      protagonistInfo: { name: 'Kylie Marinescu', pronouns: 'she/her' },
      npcsInScene: [
        { id: 'char-kylie-marinescu', name: 'Kylie Marinescu', pronouns: 'she/her', description: 'Player protagonist' },
        { id: 'char-mihaela-mika-dragan', name: 'Mika Drăgan', pronouns: 'she/her', description: 'Friend' },
      ],
    });

    const repaired = author.addRelationshipConsequences(choiceSet, input);

    expect(repaired).toBe(3);
    expect(choiceSet.choices.flatMap((choice: any) => choice.consequences.map((c: any) => c.npcId)))
      .toEqual(['char-mihaela-mika-dragan', 'char-mihaela-mika-dragan', 'char-mihaela-mika-dragan']);
  });

  it('retargets model-authored protagonist relationship consequences to a real NPC', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        {
          id: 'c1',
          text: 'Trust Mika with the truth',
          choiceType: 'relationship',
          consequences: [{ type: 'relationship', npcId: 'char-kylie-marinescu', dimension: 'trust', change: 5 }],
        },
        {
          id: 'c2',
          text: 'Refuse Mika and hide it',
          choiceType: 'relationship',
          consequences: [{ type: 'relationship', npcId: 'Kylie Marinescu', dimension: 'trust', change: -3 }],
        },
      ],
    });
    const input = makeInput({
      protagonistInfo: { name: 'Kylie Marinescu', pronouns: 'she/her' },
      npcsInScene: [
        { id: 'char-kylie-marinescu', name: 'Kylie Marinescu', pronouns: 'she/her', description: 'Player protagonist' },
        { id: 'char-mihaela-mika-dragan', name: 'Mika Drăgan', pronouns: 'she/her', description: 'Friend' },
      ],
    });

    const result = author.normalizeChoiceSet(choiceSet, input);

    expect(result.choices.flatMap((choice: any) => choice.consequences.map((c: any) => c.npcId)))
      .toEqual(['char-mihaela-mika-dragan', 'char-mihaela-mika-dragan']);
  });

  it('caps first-meeting relationship deltas from the pacing contract', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        {
          id: 'c1',
          text: 'Trust Mika immediately',
          choiceType: 'relationship',
          consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 20 }],
        },
        {
          id: 'c2',
          text: 'Pull away hard',
          choiceType: 'relationship',
          consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: -14 }],
        },
      ],
    });
    const input = makeInput({
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Door',
        relationshipPacing: [{
          id: 'scene-1-rel-mika',
          source: 'treatment',
          npcId: 'mika',
          startStage: 'unmet',
          targetStage: 'spark',
          allowedLabels: ['spark'],
          blockedLabels: ['friend'],
          requiredEvidence: ['show behavior'],
          minScenesSinceIntroduction: 1,
          maxDeltaThisScene: 6,
          mechanicDimensions: ['trust', 'affection'],
        }],
        choicePoint: { stakes: { want: 'w', cost: 'c', identity: 'i' }, optionHints: [] },
      },
      npcsInScene: [{ id: 'mika', name: 'Mika', pronouns: 'she/her', description: 'Stranger' }],
    });

    author.validateChoices(choiceSet, input);

    expect(choiceSet.choices[0].consequences[0].change).toBe(6);
    expect(choiceSet.choices[1].consequences[0].change).toBe(-6);
  });

  it('adds mechanic pressure metadata and residue to non-expression consequences', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'strategic',
      choices: [
        {
          id: 'c1',
          text: 'Take Mika\'s key card',
          choiceType: 'strategic',
          consequences: [{ type: 'addItem', itemId: 'key-card', name: 'Side card', description: 'Opens a side entrance.' }],
        },
        {
          id: 'c2',
          text: 'Leave the card on the bar',
          choiceType: 'strategic',
          consequences: [{ type: 'setFlag', flag: 'refused_key_card', value: true }],
        },
        {
          id: 'c3',
          text: 'Ask why she trusts you',
          choiceType: 'strategic',
          consequences: [{ type: 'changeScore', score: 'curiosity', change: 4 }],
        },
      ],
    });
    const input = makeInput({
      plannedConsequenceTier: 'tint',
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Club Door',
        wantVsNeed: 'Kylie wants access but needs to understand the cost.',
        mechanicPressure: [{
          id: 'scene-1-pressure-keycard',
          source: 'treatment',
          domain: 'item',
          mechanicRef: { itemId: 'key-card' },
          function: 'plant',
          storyPressure: 'The key card creates access leverage and obligation.',
          evidenceRequired: ['show Mika testing Kylie'],
          visibleResidue: ['the card remains visible'],
          allowedPayoffs: ['access route'],
          blockedPayoffs: ['instant friendship'],
        }],
        choicePoint: { stakes: { want: 'get inside', cost: 'owe Mika', identity: 'decide how much to risk' }, optionHints: [] },
      },
    });

    author.validateChoices(choiceSet, input);

    expect(choiceSet.choices[0].mechanicPressure?.[0].domain).toBe('item');
    expect(choiceSet.choices.every((choice: any) => choice.residueHints?.length)).toBe(true);
    expect(choiceSet.choices.every((choice: any) => choice.reminderPlan?.shortTerm)).toBe(true);
  });

  it('keeps fallback reminder plans fiction-first when pressure contracts contain relationship stage labels', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        {
          id: 'c1',
          text: 'Let Mika change the subject',
          choiceType: 'relationship',
          consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 3 }],
          reminderPlan: {
            immediate: 'The choice leaves visible pressure around Relationship with Mika Drăgan is moving only as far as friend..',
            shortTerm: 'Later scenes should remember how this changed access, posture, information, risk, or trust.',
          },
        },
      ],
    });
    const input = makeInput({
      npcsInScene: [{ id: 'mika', name: 'Mika', pronouns: 'she/her', description: 'Kylie’s new friend' }],
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Club Door',
        mechanicPressure: [{
          id: 'scene-1-pressure-mika',
          source: 'treatment',
          domain: 'relationship',
          mechanicRef: { npcId: 'mika', relationshipDimension: 'trust' },
          function: 'plant',
          storyPressure: 'Relationship with Mika Drăgan is moving only as far as friend.',
          evidenceRequired: ['show Mika testing Kylie'],
          visibleResidue: ['Mika holds back full trust'],
          allowedPayoffs: ['small warmth'],
          blockedPayoffs: ['instant friendship'],
        }],
        choicePoint: { stakes: { want: 'belong', cost: 'stay exposed', identity: 'decide what to admit' }, optionHints: [] },
      },
    });

    author.validateChoices(choiceSet, input);

    const immediate = choiceSet.choices[0].reminderPlan?.immediate;
    expect(immediate).toContain('Mika');
    expect(immediate).not.toMatch(/Relationship with|moving only as far|friend|visible pressure around/i);
  });

  it('maps arc bond targets to affection relationship consequences', () => {
    const author: any = new ChoiceAuthor(config);
    const choiceSet = makeChoiceSet({
      beatId: 'b1',
      choiceType: 'relationship',
      choices: [
        { id: 'c1', text: 'Share the secret gently', choiceType: 'relationship', consequences: [] },
        { id: 'c2', text: 'Refuse to share it', choiceType: 'relationship', consequences: [] },
      ],
    });
    const input = makeInput({
      npcsInScene: [{ id: 'mika', name: 'Mika', pronouns: 'she/her', description: 'Stranger' }],
      arcTargets: {
        relationshipTrajectory: [{ npcId: 'mika', dimension: 'bond', direction: 'positive', hint: 'spark grows slowly' }],
      },
    });

    author.addRelationshipConsequences(choiceSet, input);

    expect(choiceSet.choices[0].consequences[0]).toEqual(
      expect.objectContaining({ type: 'relationship', npcId: 'mika', dimension: 'affection' }),
    );
  });
});

describe('ChoiceAuthor skill rotation (1.7)', () => {
  it('rotates the default relationship skill off persuasion as it gets used', () => {
    const author: any = new ChoiceAuthor(config);
    expect(author.leastUsedRelevantSkill('relationship')).toBe('persuasion');
    author.skillUsage['persuasion'] = 1;
    expect(author.leastUsedRelevantSkill('relationship')).toBe('deception');
  });

  it('counts skills from existing statChecks and avoids the most-used', () => {
    const author: any = new ChoiceAuthor(config);
    author.trackStatCheckSkills([
      { statCheck: { skillWeights: { investigation: 1 } } },
      { statCheck: { skill: 'stealth' } },
    ]);
    expect(author.skillUsage.investigation).toBe(1);
    expect(author.skillUsage.stealth).toBe(1);
    expect(author.leastUsedRelevantSkill('strategic')).not.toBe('investigation');
  });
});

// -----------------------------------------------------------------------
// normalizeChoiceSet — W5.2 BRANCH-tier consequences at real branch points
// -----------------------------------------------------------------------

describe('ChoiceAuthor.normalizeChoiceSet (W5.2 branch-tier)', () => {
  const author: any = new ChoiceAuthor(config);

  it('registers treatment_branch_ flags at a genuine multi-target branch point', () => {
    const choiceSet = makeChoiceSet({
      choiceType: 'dilemma',
      choices: [
        { id: 'c1', text: 'Take the high road', choiceType: 'dilemma', nextSceneId: 'scene-2a', consequences: [] },
        { id: 'c2', text: 'Take the low road', choiceType: 'dilemma', nextSceneId: 'scene-2b', consequences: [] },
      ],
    });
    const input = makeInput({
      sceneBlueprint: {
        id: 'scene-1', name: 'Fork', leadsTo: ['scene-2a', 'scene-2b'],
        choicePoint: { branches: true, stakes: { want: 'w', cost: 'c', identity: 'i' }, optionHints: [] },
      },
      possibleNextScenes: [{ id: 'scene-2a', name: 'A' }, { id: 'scene-2b', name: 'B' }],
    });
    const result = author.normalizeChoiceSet(choiceSet, input);
    const flags = result.choices.flatMap((c: any) =>
      (c.consequences || []).filter((x: any) => x.type === 'setFlag').map((x: any) => x.flag));
    expect(flags.some((f: string) => f.startsWith('treatment_branch_'))).toBe(true);
  });

  it('does not add branch flags when all choices route to the same scene', () => {
    const choiceSet = makeChoiceSet({
      choiceType: 'dilemma',
      choices: [
        { id: 'c1', text: 'a', choiceType: 'dilemma', nextSceneId: 'scene-2', consequences: [] },
        { id: 'c2', text: 'b', choiceType: 'dilemma', nextSceneId: 'scene-2', consequences: [] },
      ],
    });
    const result = author.normalizeChoiceSet(choiceSet, makeInput());
    const flags = result.choices.flatMap((c: any) =>
      (c.consequences || []).filter((x: any) => x.type === 'setFlag').map((x: any) => x.flag));
    expect(flags.some((f: string) => f.startsWith('treatment_branch_'))).toBe(false);
  });
});

// -----------------------------------------------------------------------
// buildPrompt — REQUIRED BRANCHING (branch-repair) quality bar
// -----------------------------------------------------------------------

describe('ChoiceAuthor.buildPrompt (requiredBranchTargets quality bar)', () => {
  const author = new ChoiceAuthor(config);

  it('restates the first-pass quality bar in the branch-repair section', () => {
    const input = makeInput({
      requiredBranchTargets: [
        { sceneId: 'scene-2a', intent: 'Flee through the catacombs' },
        { sceneId: 'scene-2b', intent: 'Stand and bargain' },
      ],
    });
    const prompt = (author as any).buildPrompt(input);

    // The routing contract is still stated…
    expect(prompt).toContain('REQUIRED BRANCHING — author one choice per target');
    expect(prompt).toContain('nextSceneId "scene-2a" → Flee through the catacombs');
    expect(prompt).toContain('nextSceneId "scene-2b" → Stand and bargain');

    // …and the section now restates the first-pass quality bar so branch
    // repair cannot ship thin choices that merely satisfy the validator.
    expect(prompt).toContain('SAME quality bar as first-pass choices');
    expect(prompt).toContain('Full Stakes Triangle on EVERY choice');
    expect(prompt).toContain('Wants');
    expect(prompt).toContain('Costs');
    expect(prompt).toContain('Identity');
    expect(prompt).toContain('Outcome / Process / Information / Relationship / Identity');
    expect(prompt).toContain('Real consequences');
    expect(prompt).toContain('statCheck');
    expect(prompt).toContain('never a stub or an echo of the choice text');
  });

  it('omits the branch-repair section when no targets are required', () => {
    const prompt = (author as any).buildPrompt(makeInput());
    expect(prompt).not.toContain('REQUIRED BRANCHING');
    expect(prompt).not.toContain('SAME quality bar as first-pass choices');
  });

  it('uses the season-assigned consequence tier instead of episode-wide budget percentages', () => {
    const prompt = (author as any).buildPrompt(makeInput({
      plannedConsequenceTier: 'branchlet',
    }));

    expect(prompt).toContain('Season-Assigned Consequence Tier');
    expect(prompt).toContain('assigned THIS scene');
    expect(prompt).toContain('"branchlet"');
    expect(prompt).toContain('do not rebalance this episode toward global percentages');
    expect(prompt).toContain('branchlet -> `consequenceTier: "branchlet"`');
    expect(prompt).not.toContain('Consequence Budget Target (episode-wide 60/25/10/5)');
    expect(prompt).not.toContain('Across the episode, consequences should follow this distribution');
  });
});

describe('ChoiceAuthor.buildCompactPrompt (live generation contract)', () => {
  const author = new ChoiceAuthor(config);

  it('keeps the live prompt materially smaller than the legacy full prompt and names the deterministic schema contract', () => {
    const input = makeInput({
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        location: 'old library',
        mood: 'tense',
        choicePoint: {
          type: 'relationship',
          description: 'Alex has to decide how much truth to risk.',
          stakes: { want: 'earn trust', cost: 'lose control', identity: 'honest or guarded' },
          consequenceDomain: 'relationship',
          optionHints: ['Tell the truth', 'Deflect', 'Ask for help'],
        },
      },
      availableFlags: Array.from({ length: 30 }, (_, i) => ({ name: `flag_${i}`, description: `Flag ${i}` })),
      availableScores: Array.from({ length: 20 }, (_, i) => ({ name: `score_${i}`, description: `Score ${i}` })),
    });

    const full = (author as any).buildPrompt(input);
    const compact = (author as any).buildCompactPrompt(input);

    expect(compact.length).toBeLessThan(full.length * 0.55);
    expect(compact).toContain('deterministic response schema is supplied by the caller');
    expect(compact).toContain('Top level fields: beatId, choiceType, choices, overallStakes, designNotes');
    expect(compact).toContain('Create exactly 3 choices');
  });
});

describe('ChoiceAuthor.reauthorOutcomeTexts (final-contract stub repair)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));

  it('parses the LLM JSON and returns the requested tiers, dropping too-short ones', async () => {
    BaseAgent.setLlmTransportOverride(async () => JSON.stringify({
      success: 'The lock turns and the heavy door swings inward on a dim hall.',
      partial: 'It opens, but a board groans and somewhere above a chair scrapes back.',
      failure: 'no', // below the 12-char floor — filtered out, leaving the stub in place
    }));
    const author = new ChoiceAuthor(config);
    const out = await author.reauthorOutcomeTexts({
      choiceText: 'Force the door',
      stakes: { want: 'get inside', cost: 'be heard' },
      needTiers: ['success', 'partial', 'failure'],
    });
    expect(out.success).toContain('door swings inward');
    expect(out.partial).toContain('board groans');
    expect(out.failure).toBeUndefined();
  });

  it('returns {} (stub kept) when the LLM output cannot be parsed', async () => {
    BaseAgent.setLlmTransportOverride(async () => 'not json at all, just an apology');
    const author = new ChoiceAuthor(config);
    const out = await author.reauthorOutcomeTexts({ choiceText: 'x', needTiers: ['success'] });
    expect(out).toEqual({});
  });
});

describe('ChoiceAuthor.parseChoiceSetWithCompactRetry (reliability)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));
  const GOOD = '{"beatId":"beat-1","choices":[{"id":"c1","text":"A"},{"id":"c2","text":"B"},{"id":"c3","text":"C"}]}';

  it('takes the single-call path on a clean first response (no retry)', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return GOOD; });
    const author: any = new ChoiceAuthor(config);
    const out = await author.parseChoiceSetWithCompactRetry(makeInput(), GOOD);
    expect(out.choiceSet.choices).toHaveLength(3);
    expect(calls).toBe(0); // first response was clean → no compact retry call
  });

  it('retries compactly when the first response is truncated, and the retry succeeds', async () => {
    let calls = 0;
    let retryPrompt = '';
    BaseAgent.setLlmTransportOverride(async (req) => {
      calls += 1;
      retryPrompt = req.messages.map((m) => String(m.content)).join('\n');
      return GOOD;
    });
    const author: any = new ChoiceAuthor(config);
    // Truncated mid-string: parseJSON recovers (drops content) and flags truncation → retry fires.
    const truncated = '{"beatId":"beat-1","choices":[{"id":"c1","text":"truncated mid';
    const out = await author.parseChoiceSetWithCompactRetry(makeInput(), truncated);
    expect(out.choiceSet.choices).toHaveLength(3);
    expect(calls).toBe(1); // exactly one compact retry
    expect(retryPrompt).toContain('Repair reason');
    expect(retryPrompt).toContain('complete compact ChoiceSet');
    expect(retryPrompt).not.toContain('BASE_PROMPT');
  });
});

describe('ChoiceAuthor semantic completeness retry', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));

  const incompleteChoiceSet = JSON.stringify({
    beatId: 'beat-1',
    choiceType: 'relationship',
    choices: [
      {
        id: 'c1',
        text: 'Take the key',
        stakesAnnotation: { want: 'accept Mika', cost: 'owe Mika', identity: 'belong' },
        outcomeTexts: {
          success: 'The card lands warm in your palm.',
          partial: 'The card lands warm, but Mika holds your wrist too long.',
          failure: 'The card nearly slips, and Mika sees the flinch.',
        },
      },
      {
        id: 'c2',
        text: 'Leave the key',
        stakesAnnotation: { want: 'stay independent', cost: 'lose access', identity: 'choose distance' },
        outcomeTexts: {
          success: 'Mika pockets the card with a careful smile.',
          partial: 'Mika laughs, but the laugh arrives a beat late.',
          failure: 'Mika pockets the card like a door closing.',
        },
      },
    ],
    overallStakes: { want: 'choose access', cost: 'owe the wrong person', identity: 'define belonging' },
    designNotes: 'Incomplete on purpose.',
  });

  const completeChoiceSet = JSON.stringify({
    beatId: 'beat-1',
    choiceType: 'relationship',
    choices: [
      {
        id: 'c1',
        text: 'Take the key',
        stakesAnnotation: { want: 'accept Mika', cost: 'owe Mika', identity: 'belong' },
        outcomeTexts: {
          success: 'The card lands warm in your palm.',
          partial: 'The card lands warm, but Mika holds your wrist too long.',
          failure: 'The card nearly slips, and Mika sees the flinch.',
        },
        reactionText: 'Mika steers you toward the side entrance as if the decision has already rewritten your place beside her.',
        tintFlag: 'tint:teamwork',
        residueHints: [{ kind: 'relationship_behavior', description: 'Mika treats Kylie as someone who accepted private access from her.' }],
        statCheck: { skillWeights: { persuasion: 1 }, difficulty: 45 },
      },
      {
        id: 'c2',
        text: 'Leave the key',
        stakesAnnotation: { want: 'stay independent', cost: 'lose access', identity: 'choose distance' },
        outcomeTexts: {
          success: 'Mika pockets the card with a careful smile.',
          partial: 'Mika laughs, but the laugh arrives a beat late.',
          failure: 'Mika pockets the card like a door closing.',
        },
        reactionText: 'The line ahead feels longer after Mika slips the card away.',
        tintFlag: 'tint:independence',
        residueHints: [{ kind: 'relationship_behavior', description: 'Mika remembers that Kylie refused private access when it was offered.' }],
        statCheck: { skillWeights: { persuasion: 1 }, difficulty: 45 },
      },
      {
        id: 'c3',
        text: 'Ask Mika who else has one',
        stakesAnnotation: { want: 'understand the access', cost: 'sound suspicious', identity: 'choose scrutiny' },
        outcomeTexts: {
          success: 'Mika names no one, which answers more than it should.',
          partial: 'Mika smiles, but the smile guards a list.',
          failure: 'Mika makes the question feel rude without saying so.',
        },
        reactionText: 'Mika hears the suspicion under the practical question.',
        tintFlag: 'tint:suspicion',
        residueHints: [{ kind: 'relationship_behavior', description: 'Mika remembers that Kylie questioned the private access.' }],
        statCheck: { skillWeights: { perception: 1 }, difficulty: 45 },
      },
    ],
    overallStakes: { want: 'choose access', cost: 'owe the wrong person', identity: 'define belonging' },
    designNotes: 'Complete after retry.',
  });

  it('retries instead of synthesizing reaction, tint, or residue fallbacks', async () => {
    const prompts: string[] = [];
    BaseAgent.setLlmTransportOverride(async (req) => {
      prompts.push(req.messages.map((m) => String(m.content)).join('\n'));
      return prompts.length === 1 ? incompleteChoiceSet : completeChoiceSet;
    });

    const author = new ChoiceAuthor(config);
    const result = await author.execute(makeInput({
      optionCount: 3,
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        location: 'club door',
        choicePoint: {
          type: 'relationship',
          stakes: { want: 'choose access', cost: 'owe the wrong person', identity: 'define belonging' },
          consequenceDomain: 'relationship',
          optionHints: ['Take the key', 'Leave the key'],
        },
      },
    }));

    expect(result.success).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Repair reason');
    expect(prompts[1]).toContain('"statCheck":{"skillWeights"');
    expect(result.data?.choices[0].reactionText).toContain('side entrance');
    expect(result.data?.choices[0].residueHints?.[0]?.description).toContain('accepted private access');
    expect(result.data?.choices[1].tintFlag).toBe('tint:independence');
    expect(result.data?.choices[0].reactionText).not.toContain('moment settles');
  });

  it('retries malformed setFlag consequences and canonicalizes recoverable flag values', async () => {
    const malformedFlags = JSON.stringify({
      beatId: 'beat-1',
      choiceType: 'expression',
      choices: [
        {
          id: 'c1',
          text: 'Take the quartz',
          stakesAnnotation: { want: 'accept help', cost: 'admit uncertainty', identity: 'trust intuition' },
          outcomeTexts: {
            success: 'The quartz settles cool in your palm.',
            partial: 'The quartz is cool, but Stela watches your hesitation.',
            failure: 'The quartz nearly slips before you close your fingers.',
          },
          reactionText: 'Stela relaxes by a fraction.',
          tintFlag: 'tint:intuition',
          consequences: [{ type: 'setFlag', value: 'true' }],
        },
        {
          id: 'c2',
          text: 'Leave it behind',
          stakesAnnotation: { want: 'stay practical', cost: 'refuse protection', identity: 'trust logic' },
          outcomeTexts: {
            success: 'Stela closes her hand around the stone.',
            partial: 'Stela closes her hand around the stone, slower than before.',
            failure: 'The refusal lands colder than you meant it to.',
          },
          reactionText: 'The shop seems quieter after Stela pockets it.',
          tintFlag: 'tint:logic',
          consequences: [{ type: 'setFlag', value: 'false' }],
        },
        {
          id: 'c3',
          text: 'Ask what the stone protects',
          stakesAnnotation: { want: 'understand the warning', cost: 'show fear', identity: 'choose inquiry' },
          outcomeTexts: {
            success: 'Stela tells you enough to make the stone heavier.',
            partial: 'Stela answers, but not the question you meant.',
            failure: 'Stela hears the fear before the curiosity.',
          },
          reactionText: 'The question makes the little stone feel less decorative.',
          tintFlag: 'tint:curiosity',
          consequences: [{ type: 'setFlag', value: 'asked_about_quartz' }],
        },
      ],
      overallStakes: { want: 'answer Stela', cost: 'shape her trust', identity: 'choose how to read danger' },
      designNotes: 'Malformed flags on purpose.',
    });

    const recoverableFlags = JSON.stringify({
      beatId: 'beat-1',
      choiceType: 'expression',
      choices: [
        {
          id: 'c1',
          text: 'Take the quartz',
          stakesAnnotation: { want: 'accept help', cost: 'admit uncertainty', identity: 'trust intuition' },
          outcomeTexts: {
            success: 'The quartz settles cool in your palm.',
            partial: 'The quartz is cool, but Stela watches your hesitation.',
            failure: 'The quartz nearly slips before you close your fingers.',
          },
          reactionText: 'Stela relaxes by a fraction.',
          tintFlag: 'tint:intuition',
          consequences: [{ type: 'setFlag', value: 'accepted_quartz' }],
        },
        {
          id: 'c2',
          text: 'Leave it behind',
          stakesAnnotation: { want: 'stay practical', cost: 'refuse protection', identity: 'trust logic' },
          outcomeTexts: {
            success: 'Stela closes her hand around the stone.',
            partial: 'Stela closes her hand around the stone, slower than before.',
            failure: 'The refusal lands colder than you meant it to.',
          },
          reactionText: 'The shop seems quieter after Stela pockets it.',
          tintFlag: 'tint:logic',
          consequences: [{ type: 'setFlag', value: 'refused_quartz:false' }],
        },
        {
          id: 'c3',
          text: 'Ask what the stone protects',
          stakesAnnotation: { want: 'understand the warning', cost: 'show fear', identity: 'choose inquiry' },
          outcomeTexts: {
            success: 'Stela tells you enough to make the stone heavier.',
            partial: 'Stela answers, but not the question you meant.',
            failure: 'Stela hears the fear before the curiosity.',
          },
          reactionText: 'The question makes the little stone feel less decorative.',
          tintFlag: 'tint:curiosity',
          consequences: [{ type: 'setFlag', value: 'asked_about_quartz:true' }],
        },
      ],
      overallStakes: { want: 'answer Stela', cost: 'shape her trust', identity: 'choose how to read danger' },
      designNotes: 'Recoverable flag dialect.',
    });

    const prompts: string[] = [];
    BaseAgent.setLlmTransportOverride(async (req) => {
      prompts.push(req.messages.map((m) => String(m.content)).join('\n'));
      return prompts.length === 1 ? malformedFlags : recoverableFlags;
    });

    const author = new ChoiceAuthor(config);
    const result = await author.execute(makeInput({
      optionCount: 3,
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Test Scene',
        location: 'bookshop',
        choicePoint: {
          type: 'expression',
          stakes: { want: 'answer Stela', cost: 'shape her trust', identity: 'choose how to read danger' },
          consequenceDomain: 'callback',
          optionHints: ['Take the quartz', 'Leave it behind'],
        },
      },
    }));

    expect(result.success).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('malformed setFlag consequence');
    expect(result.data?.choices[0].consequences).toContainEqual({ type: 'setFlag', value: true, flag: 'accepted_quartz' });
    expect(result.data?.choices[1].consequences).toContainEqual({ type: 'setFlag', value: false, flag: 'refused_quartz' });
  });
});
