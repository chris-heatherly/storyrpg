import { describe, expect, it } from 'vitest';
import {
  StoryCircleAnchorConformanceValidator,
  type StoryCircleAnchorConformanceInput,
} from './StoryCircleAnchorConformanceValidator';

function honoredInput(
  overrides?: Partial<StoryCircleAnchorConformanceInput>,
): StoryCircleAnchorConformanceInput {
  return {
    storyCircleBeatEpisodeAnchors: {
      you: 1,
      need: 1,
      go: 2,
      search: 3,
      find: 4,
      take: 5,
      return: 6,
      change: 6,
    },
    episodes: [
      {
        episodeNumber: 1,
        storyCircleRole: [
          { beat: 'you', roleKind: 'primary', source: 'llm' },
          { beat: 'need', roleKind: 'primary', source: 'llm' },
        ],
      },
      { episodeNumber: 2, storyCircleRole: [{ beat: 'go', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 3, storyCircleRole: [{ beat: 'search', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 4, storyCircleRole: [{ beat: 'find', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 5, storyCircleRole: [{ beat: 'take', roleKind: 'primary', source: 'llm' }] },
      {
        episodeNumber: 6,
        storyCircleRole: [
          { beat: 'return', roleKind: 'primary', source: 'llm' },
          { beat: 'change', roleKind: 'primary', source: 'llm' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('StoryCircleAnchorConformanceValidator', () => {
  it('passes when authored Story Circle anchors are honored', () => {
    const result = new StoryCircleAnchorConformanceValidator().validate(honoredInput());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('is a clean no-op when there are no authored anchors', () => {
    const result = new StoryCircleAnchorConformanceValidator().validate({
      storyCircleBeatEpisodeAnchors: undefined,
      episodes: [{ episodeNumber: 1, storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'llm' }] }],
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails when an authored beat is moved to the wrong episode', () => {
    const result = new StoryCircleAnchorConformanceValidator().validate(honoredInput({
      episodes: [
        { episodeNumber: 1, storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'llm' }, { beat: 'need', roleKind: 'primary', source: 'llm' }] },
        { episodeNumber: 2, storyCircleRole: [{ beat: 'search', roleKind: 'primary', source: 'llm' }] },
        { episodeNumber: 3, storyCircleRole: [{ beat: 'go', roleKind: 'primary', source: 'llm' }] },
      ],
      storyCircleBeatEpisodeAnchors: { go: 2 },
    }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) =>
      issue.severity === 'error' &&
      issue.message.includes('go') &&
      issue.message.includes('Ep2') &&
      issue.message.includes('Ep3')
    )).toBe(true);
  });

  it('fails when an anchored beat also appears as another primary beat', () => {
    const input = honoredInput({
      episodes: honoredInput().episodes.map((episode) =>
        episode.episodeNumber === 4
          ? {
              ...episode,
              storyCircleRole: [
                ...(episode.storyCircleRole ?? []),
                { beat: 'take', roleKind: 'primary', source: 'llm' },
              ],
            }
          : episode
      ),
    });
    const result = new StoryCircleAnchorConformanceValidator().validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('also carried by Ep4'))).toBe(true);
  });

  it('does not migrate legacy structuralRole carriers when storyCircleRole is absent', () => {
    const result = new StoryCircleAnchorConformanceValidator().validate({
      storyCircleBeatEpisodeAnchors: { go: 2 },
      episodes: [
        { episodeNumber: 1 },
        { episodeNumber: 2 },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('no episode in the final season carries it'))).toBe(true);
  });

  it('requires direct Story Circle roles for anchored beats', () => {
    const result = new StoryCircleAnchorConformanceValidator().validate({
      storyCircleBeatEpisodeAnchors: { search: 4 },
      episodes: [
        { episodeNumber: 3, storyCircleRole: [{ beat: 'search', roleKind: 'expansion', source: 'llm' }] },
        { episodeNumber: 4, storyCircleRole: [{ beat: 'search', roleKind: 'primary', source: 'llm' }] },
        { episodeNumber: 7, storyCircleRole: [{ beat: 'return', roleKind: 'primary', source: 'llm' }] },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});
