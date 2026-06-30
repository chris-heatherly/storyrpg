import { describe, it, expect } from 'vitest';
import { StructuralValidator } from './StructuralValidator';
import { findBeatIdCollisions } from './beatIdCollisions';
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
                isChoicePoint: true,
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

  it('repairs a choice whose nextBeatId points to a non-existent (payoff) beat', () => {
    // Reproduces the contract failure: the writer gave choices intra-scene
    // payoff targets (beat-3-payoff-N) it never emitted, so the choices dangle.
    const story = makeStory();
    const beat3 = (story.episodes[0].scenes[0] as any).beats[2];
    beat3.choices = [
      { id: 'choice-1', text: 'Accept', choiceType: 'dilemma', nextBeatId: 'beat-3-payoff-1' },
      { id: 'choice-2', text: 'Decline', choiceType: 'dilemma', nextBeatId: 'beat-3-payoff-2' },
    ];

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    const fixedChoices = (result.story.episodes[0].scenes[0] as any).beats[2].choices;
    // Dangling intra-scene targets cleared; routed to the scene's forward target.
    expect(fixedChoices.every((c: any) => !c.nextBeatId)).toBe(true);
    expect(fixedChoices.every((c: any) => c.nextSceneId === 'episode-end')).toBe(true);
    expect(result.fixes.some((f) => f.toLowerCase().includes('dangling choice'))).toBe(true);

    // And the result is clean on a second pass (idempotent).
    const second = validator.autoFix(result.story);
    expect(second.fixes.some((f) => f.toLowerCase().includes('dangling choice'))).toBe(false);
  });

  it('breaks a choice-payoff → choice-point navigation loop and routes payoffs forward', () => {
    // Reproduces the shipped Endsong bug: a choice point whose per-choice
    // payoff beats point back to it (choice → payoff → choice point → ...),
    // trapping the reader on the same question. The single-node self-reference
    // fix does not catch this multi-node back-edge.
    const story = makeStory();
    const scene = story.episodes[0].scenes[0] as any;
    const choicePoint = scene.beats[2]; // beat-3 (has choices)
    choicePoint.nextBeatId = choicePoint.id; // self-referential, as in the bug
    choicePoint.choices = [
      { id: 'choice-1', text: 'A', choiceType: 'expression', nextBeatId: 'beat-3-payoff-1' },
      { id: 'choice-2', text: 'B', choiceType: 'expression', nextBeatId: 'beat-3-payoff-2' },
    ];
    scene.beats.push({ id: 'beat-3-payoff-1', text: 'Outcome A', nextBeatId: 'beat-3' });
    scene.beats.push({ id: 'beat-3-payoff-2', text: 'Outcome B', nextBeatId: 'beat-3' });

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    const fixedScene = result.story.episodes[0].scenes[0] as any;
    const payoff1 = fixedScene.beats.find((b: any) => b.id === 'beat-3-payoff-1');
    const payoff2 = fixedScene.beats.find((b: any) => b.id === 'beat-3-payoff-2');
    // Both payoffs no longer loop back to the choice point...
    expect(payoff1.nextBeatId).toBeUndefined();
    expect(payoff2.nextBeatId).toBeUndefined();
    // ...and instead advance forward (next scene / episode-end).
    expect(payoff1.nextSceneId).toBe('episode-end');
    expect(payoff2.nextSceneId).toBe('episode-end');
    expect(result.fixes.some((f) => f.includes('navigation loop'))).toBe(true);
  });

  it('does not touch a legitimate forward edge into a choice point', () => {
    // beat-2 → beat-3 (the choice point) is normal lead-in flow; it must stay.
    const story = makeStory();
    const scene = story.episodes[0].scenes[0] as any;
    scene.beats[1].nextBeatId = 'beat-3';

    const validator = new StructuralValidator();
    const result = validator.autoFix(story);

    const fixedScene = result.story.episodes[0].scenes[0] as any;
    expect(fixedScene.beats[1].nextBeatId).toBe('beat-3');
    expect(result.fixes.some((f) => f.includes('navigation loop'))).toBe(false);
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

describe('StructuralValidator routing prefers leadsTo over array neighbour', () => {
  // Two parallel branch scenes (scene-2a / scene-2b) are adjacent in the array
  // but both reconverge to the scene-3 bottleneck. The old repair used the
  // array neighbour (scene-2b) for scene-2a's forward target — replaying the
  // wrong branch and corrupting mutually-exclusive flags.
  function makeBranchStory(lastBeatOfA: any): Story {
    return {
      id: 'story-branch',
      title: 'Branch Fixtures',
      genre: 'test',
      synopsis: 's',
      coverImage: 'http://localhost:3001/cover.png',
      initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
      npcs: [],
      episodes: [
        {
          id: 'ep-1', number: 1, title: 'Ep 1', synopsis: 'e',
          coverImage: 'http://localhost:3001/ep.png',
          startingSceneId: 'scene-2a',
          scenes: [
            {
              id: 'scene-2a', name: 'Cold path',
              backgroundImage: 'http://localhost:3001/s.png',
              leadsTo: ['scene-3'],
              startingBeatId: 'beat-2a-1',
              beats: [
                { id: 'beat-2a-1', text: 'cold path beat', image: 'http://localhost:3001/b.png' },
                lastBeatOfA,
              ],
            },
            {
              id: 'scene-2b', name: 'Respect path',
              backgroundImage: 'http://localhost:3001/s.png',
              leadsTo: ['scene-3'],
              startingBeatId: 'beat-2b-1',
              beats: [
                { id: 'beat-2b-1', text: 'respect path beat', image: 'http://localhost:3001/b.png',
                  choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'scene-3' }] },
              ],
            },
            {
              id: 'scene-3', name: 'Bottleneck',
              backgroundImage: 'http://localhost:3001/s.png',
              leadsTo: ['episode-end'],
              startingBeatId: 'beat-3-1',
              beats: [
                { id: 'beat-3-1', text: 'bottleneck beat', image: 'http://localhost:3001/b.png',
                  choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'episode-end' }] },
              ],
            },
          ],
        } as any,
      ],
    } as Story;
  }

  it('dead-end repair routes scene-2a to its leadsTo bottleneck (scene-3), not the array neighbour (scene-2b)', () => {
    // last beat has NO navigation → dead-end repair fires
    const story = makeBranchStory({ id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png' });
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.nextSceneId).toBe('scene-3');
    expect(lastBeat.nextSceneId).not.toBe('scene-2b');
    expect(lastBeat.choices).toBeUndefined();
    expect(lastBeat.isChoicePoint).toBe(false);
  });

  it('corrects a contradictory synthetic continue (scene-2b) to the leadsTo bottleneck (scene-3)', () => {
    const story = makeBranchStory({
      id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png',
      choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'scene-2b' }],
    });
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.choices[0].nextSceneId).toBe('scene-3');
  });

  it('leaves a continue already pointing at a leadsTo target untouched', () => {
    const story = makeBranchStory({
      id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png',
      choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'scene-3' }],
    });
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.choices[0].nextSceneId).toBe('scene-3');
  });

  it('repairs a missing beat scene target to the sole authored forward target', () => {
    const story = makeBranchStory({
      id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png',
      nextSceneId: 'scene-3_alias',
    });
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.nextSceneId).toBe('scene-3');
    expect(result.fixes.some((f) => f.includes('missing beat scene target'))).toBe(true);
  });

  it('repairs a missing choice scene target to the sole authored forward target', () => {
    const story = makeBranchStory({
      id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png',
      choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'scene-3_alias' }],
    });
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.choices[0].nextSceneId).toBe('scene-3');
    expect(result.fixes.some((f) => f.includes('missing choice scene target'))).toBe(true);
  });

  it('does not guess a missing choice scene target across multiple authored branches', () => {
    const story = makeBranchStory({
      id: 'beat-2a-2', text: 'cold path end', image: 'http://localhost:3001/b.png',
      choices: [{ id: 'branch', text: 'Take the branch', choiceType: 'dilemma', nextSceneId: 'scene-alias' }],
    });
    (story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a') as any).leadsTo = ['scene-2b', 'scene-3'];
    const result = new StructuralValidator().autoFix(story);
    const sceneA = result.story.episodes[0].scenes.find((s: any) => s.id === 'scene-2a')!;
    const lastBeat: any = sceneA.beats[sceneA.beats.length - 1];
    expect(lastBeat.choices[0].nextSceneId).toBe('scene-alias');
    expect(result.fixes.some((f) => f.includes('missing choice scene target'))).toBe(false);
  });
});

describe('StructuralValidator namespaces colliding beat ids', () => {
  function makeCollisionStory(): Story {
    return {
      id: 'story-collide', title: 'Collide', genre: 'test', synopsis: 's',
      coverImage: 'http://localhost:3001/cover.png',
      initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'ep-1', number: 1, title: 'Ep 1', synopsis: 'e',
        coverImage: 'http://localhost:3001/ep.png', startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1', name: 'S1', backgroundImage: 'http://localhost:3001/s.png',
            leadsTo: ['scene-2b'], startingBeatId: 'beat-1',
            beats: [
              { id: 'beat-1', text: 'a', image: 'http://localhost:3001/b.png', nextBeatId: 'beat-2b' },
              // collides by prefix with scene-2b's beat-2b-* ids
              { id: 'beat-2b', text: 'b', image: 'http://localhost:3001/b.png',
                choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'scene-2b' }] },
            ],
          },
          {
            id: 'scene-2b', name: 'S2b', backgroundImage: 'http://localhost:3001/s.png',
            leadsTo: ['episode-end'], startingBeatId: 'beat-2b-1',
            beats: [
              { id: 'beat-2b-1', text: 'c', image: 'http://localhost:3001/b.png',
                choices: [{ id: 'continue', text: 'Continue', choiceType: 'expression', nextSceneId: 'episode-end' }] },
            ],
          },
        ],
      } as any],
    } as Story;
  }

  it('eliminates the cross-scene prefix collision and keeps intra-scene refs consistent', () => {
    const story = makeCollisionStory();
    expect(findBeatIdCollisions(story.episodes[0] as any).length).toBeGreaterThan(0);

    const result = new StructuralValidator().autoFix(story);
    const ep: any = result.story.episodes[0];
    // No collisions remain.
    expect(findBeatIdCollisions(ep)).toEqual([]);

    const s1 = ep.scenes.find((s: any) => s.id === 'scene-1');
    expect(s1.beats.map((b: any) => b.id)).toEqual(['scene-1__beat-1', 'scene-1__beat-2b']);
    // intra-scene nextBeatId remapped
    expect(s1.beats[0].nextBeatId).toBe('scene-1__beat-2b');
    // startingBeatId remapped
    expect(s1.startingBeatId).toBe('scene-1__beat-1');
    // cross-scene nextSceneId on the continue is a scene id — untouched (and the
    // earlier leadsTo repair keeps it valid)
    expect(s1.beats[1].choices[0].nextSceneId).toBeDefined();
  });

  it('is idempotent: a second autoFix renames nothing further', () => {
    const validator = new StructuralValidator();
    const first = validator.autoFix(makeCollisionStory());
    const before = JSON.stringify(first.story);
    const second = validator.autoFix(first.story);
    expect(findBeatIdCollisions(second.story.episodes[0] as any)).toEqual([]);
    expect(JSON.stringify(second.story)).toBe(before);
  });
});

describe('StructuralValidator dead-end-scene gate (C3)', () => {
  const validator = new StructuralValidator();

  it('flags a non-terminal scene with empty leadsTo and no onward route', () => {
    const story = makeStory();
    // Strip the only onward route (the choice nextSceneId) → dead end.
    (story.episodes[0].scenes[0] as any).beats[2].choices = [
      { id: 'c1', text: 'Linger', choiceType: 'expression' },
    ];
    const issues = (validator as any).validateEpisode(story.episodes[0], story);
    expect(issues.some((i: any) => i.type === 'dead_end_scene' && i.location.sceneId === 'scene-1')).toBe(true);
  });

  it('does NOT flag a scene that routes onward via a terminal sentinel', () => {
    const story = makeStory(); // beat-3 choice routes to episode-end
    const issues = (validator as any).validateEpisode(story.episodes[0], story);
    expect(issues.some((i: any) => i.type === 'dead_end_scene')).toBe(false);
  });

  it('does NOT flag a scene that routes onward via leadsTo', () => {
    const story = makeStory();
    (story.episodes[0].scenes[0] as any).beats[2].choices = [];
    (story.episodes[0].scenes[0] as any).leadsTo = ['episode-end'];
    const issues = (validator as any).validateEpisode(story.episodes[0], story);
    expect(issues.some((i: any) => i.type === 'dead_end_scene')).toBe(false);
  });
});

describe('StructuralValidator empty-scene gate + isChoicePoint backfill (E4)', () => {
  const validator = new StructuralValidator();

  it('flags a non-encounter scene with 0 beats as empty_scene', () => {
    const story = makeStory();
    (story.episodes[0].scenes[0] as any).beats = [];
    // give it a valid onward route so it isn't a dead_end too
    (story.episodes[0].scenes[0] as any).leadsTo = ['episode-end'];
    const issues = (validator as any).validateEpisode(story.episodes[0], story);
    expect(issues.some((i: any) => i.type === 'empty_scene' && i.location.sceneId === 'scene-1')).toBe(true);
  });

  it('exempts an encounter scene with 0 beats', () => {
    const story = makeStory();
    (story.episodes[0].scenes[0] as any).beats = [];
    (story.episodes[0].scenes[0] as any).leadsTo = ['episode-end'];
    (story.episodes[0].scenes[0] as any).encounter = { situation: 'ambush', storylets: [] };
    const issues = (validator as any).validateEpisode(story.episodes[0], story);
    expect(issues.some((i: any) => i.type === 'empty_scene')).toBe(false);
  });

  it('autoFix backfills isChoicePoint on a choice-bearing beat', () => {
    const story = makeStory();
    // beat-3 has a choice but no isChoicePoint flag
    const beat3 = (story.episodes[0].scenes[0] as any).beats[2];
    delete beat3.isChoicePoint;
    const res = validator.autoFix(story);
    const fixed = res.story.episodes[0].scenes[0].beats.find((b: any) => b.id === 'beat-3');
    expect((fixed as any).isChoicePoint).toBe(true);
  });
});

describe('StructuralValidator unreachable-scene gate (C3)', () => {
  function makeStoryWithScenes(scenes: any[]): Story {
    return makeStory({
      episodes: [
        { id: 'ep-1', number: 1, title: 'Ep 1', synopsis: 'Ep 1', coverImage: 'http://localhost:3001/ep.png', scenes, startingSceneId: 'scene-1' } as any,
      ],
    });
  }

  it('flags a scene nothing routes to', () => {
    const story = makeStoryWithScenes([
      { id: 'scene-1', name: 'S1', beats: [{ id: 'b1', text: 'x' }], startingBeatId: 'b1', leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'S2', beats: [{ id: 'b2', text: 'y' }], startingBeatId: 'b2', leadsTo: ['episode-end'] },
      { id: 'orphan', name: 'Orphan', beats: [{ id: 'b3', text: 'z' }], startingBeatId: 'b3', leadsTo: ['episode-end'] },
    ]);
    const report = new StructuralValidator().validateStory(story);
    expect(report.issues.some((i) => i.type === 'unreachable_scene' && i.location.sceneId === 'orphan')).toBe(true);
  });

  it('does not flag a fully-wired branch-and-bottleneck', () => {
    const story = makeStoryWithScenes([
      { id: 'scene-1', name: 'S1', beats: [{ id: 'b1', text: 'x' }], startingBeatId: 'b1', leadsTo: ['scene-2', 'scene-3'] },
      { id: 'scene-2', name: 'S2', beats: [{ id: 'b2', text: 'y' }], startingBeatId: 'b2', leadsTo: ['scene-3'] },
      { id: 'scene-3', name: 'S3', beats: [{ id: 'b3', text: 'z' }], startingBeatId: 'b3', leadsTo: ['episode-end'] },
    ]);
    const report = new StructuralValidator().validateStory(story);
    expect(report.issues.some((i) => i.type === 'unreachable_scene')).toBe(false);
  });
});
