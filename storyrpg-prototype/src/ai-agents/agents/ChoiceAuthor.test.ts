import { describe, it, expect } from 'vitest';
import { ChoiceAuthor } from './ChoiceAuthor';

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
});
