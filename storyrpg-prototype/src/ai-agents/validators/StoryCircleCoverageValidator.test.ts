import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { StoryCircleCoverageInput } from './StoryCircleCoverageValidator';
import {
  StoryCircleCoverageValidator,
  seasonPlanToStoryCircleCoverageInput,
} from './StoryCircleCoverageValidator';

function baseInput(overrides?: Partial<StoryCircleCoverageInput>): StoryCircleCoverageInput {
  return {
    anchors: {
      stakes: 'The city will forget every rebel name if Rhea chooses wrong.',
      goal: 'Rhea must recover the Ashbound Ledger before the winter council.',
      incitingIncident: 'The Court executes Rhea\'s mentor in the opening chapter.',
      climax: 'Rhea brings the ledger back to the council chamber and names the Court.',
    },
    storyCircle: {
      you: 'Rhea forges papers in the archives, hiding her grief behind routine and protecting the rebel names.',
      need: 'Rhea wants the Ashbound Ledger and needs to stop treating survival as silence.',
      go: 'After the mentor execution, Rhea chooses to enter the Court archive where retreat makes her a traitor.',
      search: 'Her heist plans fail, allies are tested, and she learns the archive rules under pressure.',
      find: 'Rhea gets the ledger and proof that the Court built its power on erased names.',
      take: 'Keeping the ledger costs Rhea her safe identity, her ally is exposed, and revenge becomes impossible.',
      return: 'Rhea carries the ledger and the exposed ally back toward the public council chamber.',
      change: 'Rhea names herself in public, changes the city record, and no longer survives by silence.',
    },
    episodes: [
      { episodeNumber: 1, storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'llm' }], difficultyTier: 'introduction' },
      { episodeNumber: 2, storyCircleRole: [{ beat: 'need', roleKind: 'primary', source: 'llm' }], difficultyTier: 'search' },
      { episodeNumber: 3, storyCircleRole: [{ beat: 'go', roleKind: 'primary', source: 'llm' }], difficultyTier: 'search' },
      { episodeNumber: 4, storyCircleRole: [{ beat: 'search', roleKind: 'primary', source: 'llm' }], difficultyTier: 'search' },
      { episodeNumber: 5, storyCircleRole: [{ beat: 'find', roleKind: 'primary', source: 'llm' }], difficultyTier: 'peak' },
      { episodeNumber: 6, storyCircleRole: [{ beat: 'take', roleKind: 'primary', source: 'llm' }], difficultyTier: 'peak' },
      { episodeNumber: 7, storyCircleRole: [{ beat: 'return', roleKind: 'primary', source: 'llm' }], difficultyTier: 'finale' },
      { episodeNumber: 8, storyCircleRole: [{ beat: 'change', roleKind: 'primary', source: 'llm' }], difficultyTier: 'finale' },
    ],
    resolvedEndings: [
      {
        id: 'ending-record',
        name: 'The Record Holds',
        summary: 'The city remembers the rebel names and survives the Court.',
        emotionalRegister: 'bittersweet',
        themePayoff: 'Rhea chooses public truth over private safety.',
        stateDrivers: [
          {
            type: 'theme',
            label: 'stakes',
            details: 'The city does not forget the rebel names.',
          },
        ],
        targetConditions: [],
        sourceConfidence: 'generated',
      },
    ],
    ...overrides,
  };
}

describe('StoryCircleCoverageValidator', () => {
  it('passes when anchors, storyCircle, episode roles, and endings are well-formed', () => {
    const result = new StoryCircleCoverageValidator().validate(baseInput());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('fails when a Story Circle beat is missing from the season map', () => {
    const input = baseInput();
    input.storyCircle!.take = '';
    const result = new StoryCircleCoverageValidator().validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.location?.includes('storyCircle.take'))).toBe(true);
  });

  it('fails when an episode distribution omits a primary beat', () => {
    const input = baseInput();
    input.episodes[5].storyCircleRole = [{ beat: 'find', roleKind: 'expansion', source: 'llm' }];
    const result = new StoryCircleCoverageValidator().validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('take'))).toBe(true);
  });

  it('warns on vague beat text without muting valid coverage', () => {
    const input = baseInput();
    input.storyCircle!.find = 'They change';
    const result = new StoryCircleCoverageValidator().validate(input);
    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.location === 'season.storyCircle.find'
    )).toBe(true);
  });

  it('uses the canonical Story Circle polarity pairs', () => {
    const input = baseInput();
    input.storyCircle!.find = input.storyCircle!.you;
    input.storyCircle!.change = input.storyCircle!.search;

    const result = new StoryCircleCoverageValidator().validate(input);

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.location === 'season.storyCircle.you vs season.storyCircle.find' &&
      issue.suggestion?.includes('starting comfort')
    )).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.location === 'season.storyCircle.search vs season.storyCircle.change' &&
      issue.suggestion?.includes('permanent transformation')
    )).toBe(true);
  });

  it('warns when the descent, return, and return-with-difference shape is not realized', () => {
    const input = baseInput();
    input.storyCircle!.go = 'Rhea considers options in another scene.';
    input.storyCircle!.return = 'Rhea waits quietly afterward.';
    input.storyCircle!.change = 'An unrelated festival begins in another city.';

    const result = new StoryCircleCoverageValidator().validate(input);

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.location === 'season.storyCircle.go' &&
      issue.message.includes('descent crossing')
    )).toBe(true);
    expect(result.issues.some((issue) =>
      issue.location === 'season.storyCircle.return' &&
      issue.message.includes('return crossing')
    )).toBe(true);
    expect(result.issues.some((issue) =>
      issue.location === 'season.storyCircle.you vs season.storyCircle.change' &&
      issue.message.includes('return-with-difference')
    )).toBe(true);
  });

  it('does not migrate legacy Story Circle plans into Story Circle coverage input', () => {
    const legacyPlan = {
      anchors: baseInput().anchors,
      episodes: [
        { episodeNumber: 1, difficultyTier: 'introduction' },
        { episodeNumber: 2, difficultyTier: 'search' },
      ],
    } as unknown as SeasonPlan;

    const input = seasonPlanToStoryCircleCoverageInput(legacyPlan);
    expect(input.storyCircle).toBeUndefined();
    const result = new StoryCircleCoverageValidator().validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('storyCircle block is missing'))).toBe(true);
  });
});
