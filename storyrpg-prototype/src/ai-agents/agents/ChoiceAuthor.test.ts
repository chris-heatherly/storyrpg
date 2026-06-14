import { describe, it, expect, afterEach } from 'vitest';
import { ChoiceAuthor } from './ChoiceAuthor';
import { BaseAgent } from './BaseAgent';

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
  return {
    beatId: 'beat-1',
    choiceType: 'expression',
    choices: [
      { id: 'c1', text: 'Do the first thing', choiceType: 'expression', consequences: [] },
      { id: 'c2', text: 'Do the second thing', choiceType: 'expression', consequences: [] },
      { id: 'c3', text: 'Do the third thing', choiceType: 'expression', consequences: [] },
    ],
    overallStakes: { want: 'win', cost: 'lose', identity: 'learn' },
    designNotes: 'Test notes',
    ...overrides,
  };
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

  it('throws on fewer than 2 choices', () => {
    const choiceSet = makeChoiceSet({
      choices: [{ id: 'c1', text: 'Only one', choiceType: 'expression', consequences: [] }],
    });
    expect(() => (author as any).validateChoices(choiceSet, input)).toThrow('Must have at least 2 choices');
  });

  it('throws on more than 5 choices', () => {
    const choices = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, text: `Choice ${i}`, choiceType: 'expression', consequences: [],
    }));
    const choiceSet = makeChoiceSet({ choices });
    expect(() => (author as any).validateChoices(choiceSet, input)).toThrow('Should not have more than 5 choices');
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

  it('trims to 5 choices when more are provided', () => {
    const choices = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, text: `Choice ${i}`, choiceType: 'expression', consequences: [],
    }));
    const choiceSet = makeChoiceSet({ choices });
    const result = (author as any).normalizeChoiceSet(choiceSet, input);
    expect(result.choices).toHaveLength(5);
  });

  it('pads to 2 choices when fewer are provided', () => {
    const choiceSet = makeChoiceSet({
      choices: [{ id: 'c1', text: 'Only one', choiceType: 'expression', consequences: [] }],
    });
    const result = (author as any).normalizeChoiceSet(choiceSet, input);
    expect(result.choices.length).toBeGreaterThanOrEqual(2);
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
