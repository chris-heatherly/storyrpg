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
  it('terminates an unrouted outcome instead of cloning an embedded situation (W3: cloning arm deleted)', () => {
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
          ],
        },
      ],
    };
    const story = { episodes: [{ number: 1, scenes: [{ id: 's1', encounter }] }] } as never;
    const repaired = normalizeEncounterOutcomeNavigation(story);
    expect(repaired).toBe(1);
    const outcome = (encounter.beats[0].choices[0].outcomes as { success: { isTerminal?: boolean; encounterOutcome?: string; nextSituation?: unknown } }).success;
    expect(outcome.nextSituation).toBeUndefined();
    expect(outcome.isTerminal).toBe(true);
    expect(outcome.encounterOutcome).toBe('victory');
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

  it('repairs outcomes inside phased encounter beats', () => {
    const encounter = {
      phases: [
        {
          id: 'phase-1',
          beats: [
            {
              id: 'beat-1',
              choices: [
                {
                  id: 'c1',
                  text: 'Call out the flattery directly.',
                  outcomes: {
                    success: { tier: 'success', narrativeText: 'He enjoys the friction.', isTerminal: false },
                    complicated: { tier: 'complicated', narrativeText: 'He regains the tempo.', isTerminal: false },
                    failure: { tier: 'failure', narrativeText: 'He lets the silence stretch.', isTerminal: false },
                  },
                },
              ],
            },
            {
              id: 'beat-2',
              choices: [
                {
                  id: 'c2',
                  text: 'Leave the table.',
                  outcomes: {
                    success: { tier: 'success', narrativeText: 'You stand.', isTerminal: true },
                    complicated: { tier: 'complicated', narrativeText: 'You stand, shaken.', isTerminal: true },
                    failure: { tier: 'failure', narrativeText: 'You stay seated.', isTerminal: true },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const story = storyWithEncounter(encounter);
    expect(normalizeEncounterOutcomeNavigation(story)).toBe(3);
    const repaired = ((story.episodes[0].scenes[0].encounter as any).phases[0].beats[0].choices[0].outcomes);
    expect(repaired.success.nextBeatId).toBe('beat-2');
    expect(repaired.complicated.nextBeatId).toBe('beat-2');
    expect(repaired.failure.nextBeatId).toBe('beat-2');
    expect(repaired.success.isTerminal).toBe(false);
    expect(repaired.complicated.encounterOutcome).toBeUndefined();
  });
});
