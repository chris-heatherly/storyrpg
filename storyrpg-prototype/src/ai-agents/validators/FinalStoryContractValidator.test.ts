import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { FinalStoryContractValidator } from './FinalStoryContractValidator';

const skills = {
  perception: 10,
  persuasion: 10,
  intimidation: 10,
};

function validStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'contract-fixture',
    title: 'Contract Fixture',
    genre: 'fantasy',
    synopsis: 'A small fixture story.',
    coverImage: '',
    initialState: {
      attributes: {} as any,
      skills: skills as any,
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'The First Door',
        synopsis: 'A fixture episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Opening Choice',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'The old door waits in the rain.',
                choices: [
                  {
                    id: 'choice-1',
                    text: 'Open the door carefully',
                    nextBeatId: 'beat-2',
                    consequences: [{ type: 'setFlag', flag: 'opened_carefully', value: true }],
                    reminderPlan: { immediate: 'The hinge stays quiet.', shortTerm: 'The quiet approach changes the next room.' },
                  } as any,
                ],
              } as any,
              {
                id: 'beat-2',
                text: 'Because you opened the door carefully, the room keeps its breath.',
                textVariants: [
                  {
                    condition: { type: 'flag', flag: 'opened_carefully', value: true },
                    text: 'The careful opening still matters.',
                  },
                ],
              } as any,
            ],
          },
        ],
      },
    ],
    ...overrides,
  } as Story;
}

function validEncounter() {
  const outcome = (encounterOutcome: string) => ({
    tier: encounterOutcome === 'defeat' ? 'failure' : 'success',
    goalTicks: encounterOutcome === 'defeat' ? 0 : 1,
    threatTicks: encounterOutcome === 'defeat' ? 1 : 0,
    narrativeText: encounterOutcome === 'defeat'
      ? 'The chamber turns against you, but the loss leaves a route forward.'
      : 'You win the exchange and carry the lesson forward.',
    encounterOutcome,
    isTerminal: true,
  });

  return {
    id: 'encounter-1',
    type: 'dramatic',
    name: 'The Chamber Test',
    description: 'A playable dramatic encounter.',
    goalClock: { id: 'goal', name: 'Goal', description: 'Win', segments: 4, filled: 0, type: 'goal' },
    threatClock: { id: 'threat', name: 'Threat', description: 'Lose', segments: 4, filled: 0, type: 'threat' },
    stakes: { victory: 'Truth is earned.', defeat: 'Trust fractures.' },
    startingPhaseId: 'phase-1',
    phases: [
      {
        id: 'phase-1',
        name: 'Opening',
        description: 'The first pressure point.',
        situationImage: '',
        beats: [
          {
            id: 'enc-beat-1',
            phase: 'setup',
            name: 'First Beat',
            setupText: 'The chamber asks for proof.',
            choices: [
              {
                id: 'enc-choice-1',
                text: 'Read the symbols before touching them',
                approach: 'cautious',
                primarySkill: 'perception',
                outcomes: {
                  success: outcome('victory'),
                  complicated: outcome('victory'),
                  failure: outcome('defeat'),
                },
              },
            ],
          },
          {
            id: 'enc-beat-2',
            phase: 'resolution',
            name: 'Second Beat',
            setupText: 'The answer demands a cost.',
            choices: [
              {
                id: 'enc-choice-2',
                text: 'Pay the cost openly',
                approach: 'cautious',
                primarySkill: 'persuasion',
                outcomes: {
                  success: outcome('victory'),
                  complicated: outcome('victory'),
                  failure: outcome('defeat'),
                },
              },
            ],
          },
        ],
      },
    ],
    outcomes: {},
  };
}

describe('FinalStoryContractValidator', () => {
  it('fails an empty non-encounter scene', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{ id: 'scene-1', name: 'Empty', startingBeatId: '', beats: [] }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'empty_scene' }),
    ]));
  });

  it('fails a placeholder-only scene', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Placeholder',
          startingBeatId: 'scene-1-branch-residue',
          beats: [{ id: 'scene-1-branch-residue', text: 'What happened in the previous scene changes how everyone enters this scene.' } as any],
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'placeholder_scene' }),
    ]));
  });

  it('fails a scene that failed encounter validation but has no runtime encounter', async () => {
    const story = validStory();

    const report = await new FinalStoryContractValidator().validate({
      story,
      incrementalValidationResults: [{
        sceneId: 'scene-1',
        sceneName: 'Opening Choice',
        overallPassed: false,
        regenerationRequested: 'encounter',
        validationTimeMs: 0,
      }],
    });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing_runtime_encounter' }),
      expect.objectContaining({ type: 'failed_incremental_validation' }),
    ]));
  });

  it('scopes incremental encounter failures by episode when scene ids repeat', async () => {
    const base = validStory();
    const story = validStory({
      episodes: [
        {
          ...base.episodes[0],
          id: 'episode-1',
          number: 1,
          scenes: [{
            ...base.episodes[0].scenes[0],
            id: 'scene-2',
            name: 'Into the Mist',
          }],
          startingSceneId: 'scene-2',
        },
        {
          ...base.episodes[0],
          id: 'episode-2',
          number: 2,
          scenes: [{
            ...base.episodes[0].scenes[0],
            id: 'scene-2',
            name: 'The Wall Falls',
          }],
          startingSceneId: 'scene-2',
        },
      ],
    });

    const report = await new FinalStoryContractValidator().validate({
      story,
      incrementalValidationResults: [{
        episodeNumber: 2,
        sceneId: 'scene-2',
        sceneName: 'The Wall Falls',
        overallPassed: false,
        regenerationRequested: 'encounter',
        validationTimeMs: 0,
      }],
    });

    const missingEncounterIssues = report.blockingIssues.filter(issue => issue.type === 'missing_runtime_encounter');
    expect(missingEncounterIssues).toHaveLength(1);
    expect(missingEncounterIssues[0]).toMatchObject({ episodeNumber: 2, sceneId: 'scene-2' });
    expect(missingEncounterIssues[0]?.message).toContain('The Wall Falls');
  });

  it('fails an invalid runtime encounter', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Bad Encounter',
          startingBeatId: '',
          beats: [],
          encounter: {
            ...validEncounter(),
            phases: [{ ...validEncounter().phases[0], beats: [{ id: 'only-beat', setupText: 'Too thin.', choices: [] }] }],
          } as any,
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'invalid_encounter' }),
    ]));
  });

  it('fails broken beat navigation', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          ...validStory().episodes[0].scenes[0],
          beats: [{ id: 'beat-1', text: 'A broken road.', nextBeatId: 'missing-beat' } as any],
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'broken_navigation' }),
    ]));
  });

  it('passes a sparse encounter scene when the runtime encounter is valid', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Good Encounter',
          startingBeatId: '',
          beats: [],
          encounter: validEncounter() as any,
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(true);
    expect(report.metrics.validEncounterScenes).toBe(1);
  });

  it('fails missing requested episodes', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      requestedEpisodeNumbers: [1, 2],
    });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing_requested_episode', episodeNumber: 2 }),
    ]));
  });
});
