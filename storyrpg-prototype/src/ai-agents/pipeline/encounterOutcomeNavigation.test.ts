import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { normalizeEncounterOutcomeNavigation } from './encounterOutcomeNavigation';

function storyWithEncounter(encounter: unknown): Story {
  return {
    id: 'story',
    title: 'Story',
    genre: 'test',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      {
        id: 'ep1',
        number: 1,
        title: 'Ep1',
        synopsis: '',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Encounter',
            startingBeatId: 'beat-1',
            beats: [],
            encounter: encounter as never,
          },
        ],
      },
    ],
  };
}

describe('normalizeEncounterOutcomeNavigation', () => {
  it('attaches a same-tier nextSituation to prose outcomes with no route', () => {
    const encounter = {
      beats: [
        {
          id: 'beat-1',
          choices: [
            {
              id: 'c1',
              text: 'Drive your knee into the attacker.',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Your knee connects.' },
              },
            },
            {
              id: 'c2',
              text: 'Study the man in the charcoal suit.',
              outcomes: {
                success: {
                  tier: 'success',
                  narrativeText: 'You read the room.',
                  nextSituation: {
                    setupText: 'The ring catches the streetlamp.',
                    choices: [{ id: 'follow-up', text: 'Demand his name', outcomes: {} }],
                  },
                },
              },
            },
          ],
        },
      ],
    };

    const story = storyWithEncounter(encounter);
    expect(normalizeEncounterOutcomeNavigation(story)).toBe(1);
    const repaired = ((story.episodes[0].scenes[0].encounter as any).beats[0].choices[0].outcomes.success);
    expect(repaired.nextSituation?.setupText).toBe('The ring catches the streetlamp.');
    expect(repaired.nextSituation?.choices[0].id).toBe('follow-up');
    expect(repaired.isTerminal).toBeUndefined();
  });

  it('marks the outcome terminal when no follow-up situation exists', () => {
    const encounter = {
      beats: [
        {
          id: 'beat-1',
          choices: [
            {
              id: 'c1',
              text: 'Stay quiet.',
              outcomes: {
                failure: { tier: 'failure', narrativeText: 'You freeze.' },
              },
            },
          ],
        },
      ],
    };

    const story = storyWithEncounter(encounter);
    expect(normalizeEncounterOutcomeNavigation(story)).toBe(1);
    const repaired = ((story.episodes[0].scenes[0].encounter as any).beats[0].choices[0].outcomes.failure);
    expect(repaired.isTerminal).toBe(true);
    expect(repaired.encounterOutcome).toBe('defeat');
  });
});
