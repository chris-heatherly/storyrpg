import { describe, it, expect } from 'vitest';
import { StructuralValidator } from './StructuralValidator';
import type { Story } from '../../types';

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    title: 'Structural Fixtures',
    genre: 'test',
    synopsis: 'Story used for structural validator tests',
    coverImage: 'http://localhost:3001/cover.png',
    initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Ep 1',
        synopsis: 'Ep 1',
        coverImage: 'http://localhost:3001/ep.png',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            backgroundImage: 'http://localhost:3001/scene.png',
            beats: [
              { id: 'beat-1', text: 'Opening text', image: 'http://localhost:3001/b1.png' },
              { id: 'beat-2', text: 'Middle text', image: 'http://localhost:3001/b2.png' },
              {
                id: 'beat-3',
                text: 'Closing text',
                image: 'http://localhost:3001/b3.png',
                choices: [
                  {
                    id: 'continue',
                    text: 'Continue',
                    choiceType: 'expression',
                    nextSceneId: 'episode-end',
                  },
                ],
              },
            ],
            startingBeatId: 'beat-1',
          } as any,
        ],
        startingSceneId: 'scene-1',
      } as any,
    ],
    ...overrides,
  } as Story;
}

describe('StructuralValidator.autoFix', () => {
  it('repairs a missing startingBeatId by pointing at the first beat', () => {
    const story = makeStory();
    // Corrupt the story: clear startingBeatId on the first scene.
    (story.episodes[0].scenes[0] as any).startingBeatId = undefined;

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    expect(result.fixedCount).toBeGreaterThanOrEqual(1);
    expect((result.story.episodes[0].scenes[0] as any).startingBeatId).toBe('beat-1');
    expect(result.fixes.some((f) => f.includes('startingBeatId'))).toBe(true);
  });

  it('repairs a beat that self-references via nextBeatId', () => {
    const story = makeStory();
    const beats = (story.episodes[0].scenes[0] as any).beats;
    beats[0].nextBeatId = beats[0].id;

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    expect(result.fixedCount).toBeGreaterThanOrEqual(1);
    expect((result.story.episodes[0].scenes[0] as any).beats[0].nextBeatId).toBe('beat-2');
    expect(result.fixes.some((f) => f.includes('self-reference'))).toBe(true);
  });

  it('repairs a broken nextBeatId that points to a missing beat', () => {
    const story = makeStory();
    const beats = (story.episodes[0].scenes[0] as any).beats;
    beats[1].nextBeatId = 'beat-does-not-exist';

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    expect(result.fixedCount).toBeGreaterThanOrEqual(1);
    expect((result.story.episodes[0].scenes[0] as any).beats[1].nextBeatId).toBe('beat-3');
    expect(result.fixes.some((f) => f.toLowerCase().includes('broken'))).toBe(true);
  });

  it('recovers empty beat text from alternate fields or falls back to a safe placeholder', () => {
    const story = makeStory();
    const beats = (story.episodes[0].scenes[0] as any).beats;
    beats[0].text = '';
    beats[0].content = 'Narrative sourced from content field';

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    expect(result.fixedCount).toBeGreaterThanOrEqual(1);
    expect((result.story.episodes[0].scenes[0] as any).beats[0].text).toBe(
      'Narrative sourced from content field'
    );
  });

  it('is idempotent: running autoFix twice on the same story yields zero fixes the second time', () => {
    const story = makeStory();
    const beats = (story.episodes[0].scenes[0] as any).beats;
    beats[0].nextBeatId = beats[0].id;
    (story.episodes[0].scenes[0] as any).startingBeatId = undefined;

    const validator = new StructuralValidator();
    const first = validator.autoFix(story);
    const second = validator.autoFix(first.story);

    expect(first.fixedCount).toBeGreaterThan(0);
    expect(second.fixedCount).toBe(0);
    expect(second.fixes).toEqual([]);
  });

  it('leaves a clean story untouched', () => {
    const story = makeStory();
    const before = JSON.stringify(story);

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    expect(result.fixedCount).toBe(0);
    expect(result.fixes).toEqual([]);
    expect(JSON.stringify(result.story)).toBe(before);
  });
});

describe('StructuralValidator encounter consequence checks', () => {
  it('warns when encounter outcomes and costs have no durable consequence hook', () => {
    const story = makeStory();
    (story.episodes[0].scenes[0] as any).encounter = {
      id: 'enc-1',
      name: 'Test Encounter',
      type: 'social',
      description: 'A tense exchange',
      goalClock: { id: 'goal', name: 'Goal', description: 'Goal', segments: 4, filled: 0, type: 'goal' },
      threatClock: { id: 'threat', name: 'Threat', description: 'Threat', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: 'Win', defeat: 'Lose' },
      startingPhaseId: 'phase-1',
      outcomes: {},
      phases: [
        {
          id: 'phase-1',
          name: 'Phase 1',
          beats: [
            {
              id: 'beat-1',
              phase: 'setup',
              name: 'Beat 1',
              setupText: 'The room goes quiet.',
              choices: [
                {
                  id: 'choice-1',
                  text: 'Take the risk',
                  approach: 'bold',
                  outcomes: {
                    success: {
                      tier: 'success',
                      goalTicks: 2,
                      threatTicks: 0,
                      narrativeText: 'It works.',
                      isTerminal: true,
                      encounterOutcome: 'victory',
                    },
                    complicated: {
                      tier: 'complicated',
                      goalTicks: 1,
                      threatTicks: 1,
                      narrativeText: 'It works at a price.',
                      isTerminal: true,
                      encounterOutcome: 'partialVictory',
                      cost: {
                        domain: 'relationship',
                        severity: 'minor',
                        whoPays: 'protagonist',
                        immediateEffect: 'A friend sees the compromise.',
                        visibleComplication: 'Trust frays.',
                        consequences: [],
                      },
                      visualContract: { visibleCost: 'Trust frays.' },
                    },
                    failure: {
                      tier: 'failure',
                      goalTicks: 0,
                      threatTicks: 2,
                      narrativeText: 'It fails.',
                      isTerminal: true,
                      encounterOutcome: 'defeat',
                      consequences: [
                        { type: 'setFlag', flag: 'encounter_failure_remembered', value: true },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const report = new StructuralValidator().validateStory(story);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining('has no durable consequence hook'),
        }),
        expect.objectContaining({
          description: expect.stringContaining('has a cost without mechanical consequences'),
        }),
      ])
    );
  });
});
