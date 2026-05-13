import { describe, expect, it } from 'vitest';

import { findUnsupportedQuotedRecallIssues } from './quoteRecallValidator';
import type { Story } from '../../types';

function storyWithScenes(scenes: Story['episodes'][number]['scenes']): Pick<Story, 'episodes'> {
  return {
    episodes: [{
      id: 'episode-1',
      number: 1,
      title: 'Episode',
      synopsis: '',
      coverImage: '',
      startingSceneId: scenes[0]?.id || 'scene-1',
      scenes,
    }],
  };
}

describe('quoteRecallValidator', () => {
  it('flags recalled quoted dialogue that did not appear earlier', () => {
    const issues = findUnsupportedQuotedRecallIssues(storyWithScenes([
      { id: 'scene-1', name: 'Before', beats: [{ id: 'beat-1', text: 'Kenji says nothing like that.' } as any], startingBeatId: 'beat-1' },
      { id: 'scene-2', name: 'After', beats: [{ id: 'beat-2', text: 'You remember Kenji asking, *So who are you going to ruin this year?*' } as any], startingBeatId: 'beat-2' },
    ]));

    expect(issues).toEqual([expect.objectContaining({
      sceneId: 'scene-2',
      beatId: 'beat-2',
      quote: 'So who are you going to ruin this year?',
    })]);
  });

  it('allows recalled quoted dialogue when the exact quote appeared earlier in an encounter', () => {
    const issues = findUnsupportedQuotedRecallIssues(storyWithScenes([
      {
        id: 'scene-encounter',
        name: 'Encounter',
        beats: [],
        startingBeatId: 'encounter-start',
        encounter: {
          id: 'encounter-1',
          type: 'social',
          name: 'Confrontation',
          description: '',
          goalClock: {} as any,
          threatClock: {} as any,
          stakes: { victory: '', defeat: '' },
          phases: [{
            id: 'phase-1',
            name: 'Phase',
            description: '',
            situationImage: '',
            beats: [{
              id: 'encounter-beat-1',
              phase: 'setup',
              name: '',
              setupText: 'Kenji asks, "Which one of those is you?"',
              choices: [],
            } as any],
          }],
          startingPhaseId: 'phase-1',
          outcomes: {},
        } as any,
      },
      { id: 'scene-after', name: 'After', beats: [{ id: 'beat-1', text: 'His words echo back: *Which one of those is you?*' } as any], startingBeatId: 'beat-1' },
    ]));

    expect(issues).toEqual([]);
  });
});
