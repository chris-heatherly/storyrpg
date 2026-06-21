import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { EncounterProseIntegrityValidator } from './EncounterProseIntegrityValidator';
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
                  {
                    id: 'choice-2',
                    text: 'Knock before opening',
                    nextBeatId: 'beat-2',
                    consequences: [{ type: 'setFlag', flag: 'knocked_first', value: true }],
                  } as any,
                  {
                    id: 'choice-3',
                    text: 'Listen at the door',
                    nextBeatId: 'beat-2',
                    consequences: [{ type: 'setFlag', flag: 'listened_first', value: true }],
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
              {
                id: 'enc-choice-2',
                text: 'Ask the chamber what it wants',
                approach: 'clever',
                primarySkill: 'persuasion',
                outcomes: {
                  success: outcome('victory'),
                  complicated: outcome('victory'),
                  failure: outcome('defeat'),
                },
              },
              {
                id: 'enc-choice-3',
                text: 'Brace yourself and step forward',
                approach: 'bold',
                primarySkill: 'intimidation',
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
                id: 'enc-choice-4',
                text: 'Pay the cost openly',
                approach: 'cautious',
                primarySkill: 'persuasion',
                outcomes: {
                  success: outcome('victory'),
                  complicated: outcome('victory'),
                  failure: outcome('defeat'),
                },
              },
              {
                id: 'enc-choice-5',
                text: 'Offer a truth instead',
                approach: 'clever',
                primarySkill: 'perception',
                outcomes: {
                  success: outcome('victory'),
                  complicated: outcome('victory'),
                  failure: outcome('defeat'),
                },
              },
              {
                id: 'enc-choice-6',
                text: 'Refuse the bargain and push through',
                approach: 'bold',
                primarySkill: 'intimidation',
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
  it('blocks reader-facing choice surfaces outside the 3-4 option contract', async () => {
    const story = validStory();
    story.episodes[0].scenes[0].beats[0].choices = story.episodes[0].scenes[0].beats[0].choices!.slice(0, 2);

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'choice_count_contract',
        sceneId: 'scene-1',
        beatId: 'beat-1',
      }),
    ]));
  });

  it('blocks vampire or strigoi characters being scheduled for daytime meals', async () => {
    const story = validStory({
      npcs: [
        { id: 'victor', name: 'Victor Valcescu', description: 'A vampire patron and romantic stranger.' } as any,
      ],
    });
    story.episodes[0].scenes[0].beats[1].text =
      "The first message is from Victor: Lunch Saturday at Casa Stelarum, the whole weekend if you can stand it.";

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'supernatural_canon_contradiction',
        sceneId: 'scene-1',
        beatId: 'beat-2',
      }),
    ]));
  });

  it('allows daytime-meal absence as a vampire tell instead of treating it as a contradiction', async () => {
    const story = validStory({
      npcs: [
        { id: 'victor', name: 'Victor Valcescu', description: 'A strigoi patron and romantic stranger.' } as any,
      ],
    });
    story.episodes[0].scenes[0].beats[1].text =
      'Mika jokes that Victor is never at brunch, and the absence lands like a clue.';

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.blockingIssues.some((issue) => issue.type === 'supernatural_canon_contradiction')).toBe(false);
  });

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

  it('does NOT hard-block an incremental failure when no regeneration was requested (advisory)', async () => {
    const story = validStory();
    const report = await new FinalStoryContractValidator().validate({
      story,
      incrementalValidationResults: [{
        sceneId: 'scene-1',
        sceneName: 'Opening Choice',
        overallPassed: false,
        regenerationRequested: 'none', // soft/heuristic fail — the runner didn't want a regen
        validationTimeMs: 0,
      }],
    });
    // The finding is recorded but as a warning, not a blocking error — no contract abort.
    expect(report.blockingIssues.some((i) => i.type === 'failed_incremental_validation')).toBe(false);
    expect(report.metrics.failedIncrementalResults).toBe(1);
  });

  it('downgrades a SOLE frozen incremental flag so the repaired report passes (bite-me-g20)', async () => {
    // A scene whose choices failed incremental validation (regen requested), but the contract's
    // own validators find NO other blocking issue on the current story (the repair loop fixed
    // the stubs). The frozen flag must not dead-end the run.
    const story = validStory();
    const report = await new FinalStoryContractValidator().validate({
      story,
      incrementalValidationResults: [{
        sceneId: 'scene-1',
        sceneName: 'Opening Choice',
        overallPassed: false,
        regenerationRequested: 'choices', // not 'encounter' → no independent missing_runtime_encounter
        validationTimeMs: 0,
      }],
    });
    expect(report.passed).toBe(true);
    expect(report.blockingIssues.some((i) => i.type === 'failed_incremental_validation')).toBe(false);
    // Still surfaced, as advisory.
    expect(report.warnings.some((i) => i.type === 'failed_incremental_validation')).toBe(true);
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

  it('fails malformed second-person rewrite residue in encounter prose', async () => {
    const encounter = validEncounter();
    (encounter.phases[0].beats[0] as any).setupText = 'Moonlight splits over you rooftop as the threat closes in.';
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Corrupted Encounter',
          startingBeatId: '',
          beats: [],
          encounter: encounter as any,
        }],
      }],
    });

    const direct = new EncounterProseIntegrityValidator().validate({ story });
    expect(direct.valid).toBe(false);
    expect(direct.findings[0]).toMatchObject({ sceneId: 'scene-1', pattern: 'malformed-you-noun' });

    const defaultReport = await new FinalStoryContractValidator().validate({ story });
    expect(defaultReport.passed).toBe(true);
    expect(defaultReport.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'encounter_prose_integrity', sceneId: 'scene-1' }),
    ]));

    const prev = process.env.GATE_ENCOUNTER_PROSE_INTEGRITY;
    process.env.GATE_ENCOUNTER_PROSE_INTEGRITY = '1';
    try {
      const report = await new FinalStoryContractValidator().validate({ story });
      expect(report.passed).toBe(false);
      expect(report.blockingIssues).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'encounter_prose_integrity', sceneId: 'scene-1' }),
      ]));
    } finally {
      if (prev === undefined) delete process.env.GATE_ENCOUNTER_PROSE_INTEGRITY;
      else process.env.GATE_ENCOUNTER_PROSE_INTEGRITY = prev;
    }
  });

  it('does not flag ordinary second-person encounter phrasing', () => {
    const encounter = validEncounter();
    (encounter.phases[0].beats[0].choices[0].outcomes.success as any).narrativeText =
      'You kiss him on the cheek and keep your eyes open for the next clue.';
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Clean Encounter',
          startingBeatId: '',
          beats: [],
          encounter: encounter as any,
        }],
      }],
    });

    const direct = new EncounterProseIntegrityValidator().validate({ story });
    expect(direct.valid).toBe(true);
  });

  it('uses the roster protagonist instead of an unsafe brief protagonist for encounter POV repair', async () => {
    const encounter = validEncounter();
    (encounter.phases[0].beats[0] as any).setupText =
      'The Cișmigiu paths are dead quiet. A second figure steps from the fog.';
    (encounter.phases[0].beats[0].choices[0].outcomes.success as any).narrativeText =
      'Kylie straightens her collar as Victor watches.';
    const story = validStory({
      npcs: [
        {
          id: 'char-kylie',
          name: 'Kylie Marinescu',
          description: 'The protagonist.',
          role: 'protagonist',
          pronouns: 'she/her',
        },
        {
          id: 'char-victor',
          name: 'Victor',
          description: 'A vampire.',
          role: 'ally',
          pronouns: 'he/him',
        },
      ],
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Encounter',
          startingBeatId: '',
          beats: [],
          encounter: encounter as any,
        }],
      }],
    });

    await new FinalStoryContractValidator().validate({
      story,
      protagonist: { name: 'The', pronouns: 'she/her' },
    });

    const beat = (story.episodes[0].scenes[0].encounter as any).phases[0].beats[0];
    expect(beat.setupText).toBe('The Cișmigiu paths are dead quiet. A second figure steps from the fog.');
    expect(beat.choices[0].outcomes.success.narrativeText).toBe('You straighten your collar as Victor watches.');
  });

  it('flags a routing contradiction: a choice targets a real scene not in scene.leadsTo', async () => {
    const mkScene = (id: string, leadsTo: string[], choiceTarget?: string) => ({
      id,
      name: id,
      startingBeatId: `${id}-b1`,
      leadsTo,
      beats: [{
        id: `${id}-b1`,
        text: `Content for ${id} that is clearly not a placeholder beat.`,
        choices: [{
          id: `${id}-continue`,
          text: 'Continue...',
          choiceType: 'expression',
          nextSceneId: choiceTarget ?? leadsTo[0],
        }],
      }],
    } as any);
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        startingSceneId: 'scene-1',
        scenes: [
          // scene-1 leadsTo scene-2, but its continue points at scene-3 (a real
          // scene NOT in leadsTo) — the scene-2a→scene-2b bug shape.
          mkScene('scene-1', ['scene-2'], 'scene-3'),
          mkScene('scene-2', ['episode-end']),
          mkScene('scene-3', ['episode-end']),
        ],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'routing_contradiction', sceneId: 'scene-1' }),
    ]));
  });

  it('does not flag a choice that targets a scene listed in leadsTo', async () => {
    const mkScene = (id: string, leadsTo: string[], choiceTarget?: string) => ({
      id, name: id, startingBeatId: `${id}-b1`, leadsTo,
      beats: [{
        id: `${id}-b1`,
        text: `Content for ${id} that is clearly not a placeholder beat.`,
        choices: [{ id: `${id}-continue`, text: 'Continue...', choiceType: 'expression', nextSceneId: choiceTarget ?? leadsTo[0] }],
      }],
    } as any);
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        startingSceneId: 'scene-1',
        scenes: [
          mkScene('scene-1', ['scene-2']),
          mkScene('scene-2', ['episode-end']),
        ],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });
    expect(report.blockingIssues.filter((i) => i.type === 'routing_contradiction')).toEqual([]);
  });

  it('blocks a direct choice bridge that skips required setup scenes', async () => {
    const mkScene = (id: string, leadsTo: string[], choiceTarget?: string) => ({
      id,
      name: id,
      startingBeatId: `${id}-b1`,
      leadsTo,
      beats: [{
        id: `${id}-b1`,
        text: `Substantive setup for ${id}.`,
        choices: choiceTarget
          ? [{ id: `${id}-skip`, text: 'Skip the uncomfortable setup', choiceType: 'expression', nextSceneId: choiceTarget, isChoiceBridge: true }]
          : [{ id: `${id}-continue`, text: 'Continue...', choiceType: 'expression', nextSceneId: leadsTo[0] }],
      }],
    } as any);
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        startingSceneId: 'scene-1',
        scenes: [
          mkScene('scene-1', ['scene-2', 'scene-3'], 'scene-3'),
          mkScene('scene-2', ['scene-3']),
          mkScene('scene-3', ['episode-end']),
        ],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'choice_bridge_skips_required_setup', sceneId: 'scene-1' }),
    ]));
  });

  it('blocks planning-register prose leaked into beats, variants, encounters, and visual metadata', async () => {
    const story = validStory();
    const scene = story.episodes[0].scenes[0] as any;
    scene.geography = 'Aftermath that resettles stakes; serves the plotTurn1 beat ("The post goes viral.").';
    scene.visualMetadata = {
      prompt: 'Introduce Victor on-page with a clear silhouette before the reveal.',
    };
    scene.encounter = {
      ...validEncounter(),
      phases: [{
        id: 'phase-leak',
        beats: [{
          id: 'enc-leak',
          setupText: 'Decide how to handle the bookshop witness before the fight begins.',
          choices: [],
        }],
      }],
    };
    scene.beats[0].text = 'Open the episode with the door already waiting for you.';
    scene.beats[1].textVariants = [{
      condition: { type: 'flag', flag: 'opened_carefully', value: true },
      text: 'The next beat visibly responds to the authored choice: take the careful opening or rush through.',
    }];

    const report = await new FinalStoryContractValidator().validate({ story });
    const leaks = report.blockingIssues.filter((issue) => issue.type === 'planning_register_prose');

    expect(report.passed).toBe(false);
    expect(leaks).toHaveLength(6);
    expect(leaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ validator: 'PlanningRegisterLeakValidator', sceneId: 'scene-1' }),
      expect.objectContaining({ validator: 'PlanningRegisterLeakValidator', sceneId: 'scene-1', beatId: 'beat-1' }),
      expect.objectContaining({ validator: 'PlanningRegisterLeakValidator', sceneId: 'scene-1', beatId: 'beat-2' }),
      expect.objectContaining({ validator: 'PlanningRegisterLeakValidator', sceneId: 'scene-1' }),
    ]));
  });

  it('blocks choice reminder text appended to base beat prose', async () => {
    const story = validStory();
    const scene = story.episodes[0].scenes[0] as any;
    scene.beats[1].text = `Because you opened the door carefully, the room keeps its breath.\n\nThe hinge stays quiet.`;

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'echo_summary_variant',
        validator: 'FinalStoryContractValidator',
        sceneId: 'scene-1',
        beatId: 'beat-2',
      }),
    ]));
  });

  it('blocks a cross-scene beat-id collision (exact and prefix)', async () => {
    const mkScene = (id: string, beatIds: string[], leadsTo: string[]) => ({
      id, name: id, startingBeatId: beatIds[0], leadsTo,
      beats: beatIds.map((bid, i) => ({
        id: bid,
        text: `Real content for ${id}/${bid}, not a placeholder.`,
        ...(i === beatIds.length - 1
          ? { choices: [{ id: `${id}-c`, text: 'Continue...', choiceType: 'expression', nextSceneId: leadsTo[0] }] }
          : { nextBeatId: beatIds[i + 1] }),
      })),
    } as any);
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        startingSceneId: 'scene-1',
        scenes: [
          mkScene('scene-1', ['beat-1', 'beat-2b'], ['scene-2b']),       // beat-2b
          mkScene('scene-2b', ['beat-2b-1'], ['episode-end']),           // beat-2b-1 (prefix collision)
        ],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'beat_id_collision' }),
    ]));
  });

  it('treats a terminal sentinel (episode-end) as a valid ending, not broken navigation', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          ...validStory().episodes[0].scenes[0],
          beats: [{
            id: 'beat-1',
            text: 'The road ends at the cliff.',
            choices: [{ id: 'continue', text: 'Continue...', choiceType: 'expression', nextSceneId: 'episode-end' }],
          } as any],
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.blockingIssues.filter((i) => i.type === 'broken_navigation')).toEqual([]);
  });

  // §4.2 (Treatment-Fidelity Remediation): on a TREATMENT-SOURCED run, a TRULY HOLLOW
  // encounter scene (zero reader-facing prose ANYWHERE — no scene beats, no phase
  // setupText, no storylets) is empty. This closes the wall-breach-is-empty →
  // poisoning-never-administered hole where an anchor materialized as a placeholder.
  it('fails a hollow (no-prose) encounter scene on a treatment-sourced run', async () => {
    const base = validEncounter();
    const hollowEncounter = {
      ...base,
      phases: (base.phases as any[]).map((p) => ({ ...p, beats: (p.beats ?? []).map((b: any) => ({ ...b, setupText: '' })) })),
      outcomes: {},
    };
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Hollow Encounter',
          startingBeatId: '',
          beats: [],
          encounter: hollowEncounter as any,
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story, treatmentSourced: true });

    expect(report.blockingIssues.some((i) => i.type === 'empty_scene')).toBe(true);
  });

  // Regression (endsong-gen-7): a 0-scene-beat encounter whose anchor IS dramatized in
  // its phase setupText / outcome storylets must NOT be flagged empty on a treatment run.
  // The encounter prose lives in `scene.encounter`, not `scene.beats` — and this is the
  // exact shape EncounterAnchorContentValidator already passes, so the two must agree.
  it('does NOT fail a dramatized 0-scene-beat encounter on a treatment-sourced run', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Dramatized Encounter',
          startingBeatId: '',
          beats: [],
          encounter: validEncounter() as any, // carries phase setupText prose
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story, treatmentSourced: true });

    expect(report.blockingIssues.some((i) => i.type === 'empty_scene')).toBe(false);
  });

  // Regression guard: a 0-beat scene whose content legitimately lives in its runtime
  // encounter (storylets) must NOT be failed on a non-treatment run — that would
  // contradict StructuralValidator's deliberate encounter exemption and break the
  // broad existing corpus. The §4.2 tightening is scoped to treatment-sourced runs.
  it('does NOT fail a 0-beat valid-encounter scene on a non-treatment run', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Storylet Encounter',
          startingBeatId: '',
          beats: [],
          encounter: validEncounter() as any,
        }],
      }],
    });

    const report = await new FinalStoryContractValidator().validate({ story });

    expect(report.blockingIssues.some((i) => i.type === 'empty_scene')).toBe(false);
  });

  it('passes an encounter scene that carries at least one reader-facing beat', async () => {
    const story = validStory({
      episodes: [{
        ...validStory().episodes[0],
        scenes: [{
          id: 'scene-1',
          name: 'Good Encounter',
          startingBeatId: 'beat-1',
          beats: [{ id: 'beat-1', text: 'Steel rings against the breach as the wall gives way.' } as any],
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

  it('does NOT block on craft-only QA failures — tiering (F3)', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      // A failing QA self-assessment (score 61) used to hard-block the run.
      qaReport: { passesQA: false, overallScore: 61, criticalIssues: [] } as any,
    });

    // Story still ships...
    expect(report.passed).toBe(true);
    // ...with the QA failure recorded as a warning, not a blocking issue.
    expect(report.warnings.some((i) => i.type === 'qa_blocker_present')).toBe(true);
    expect(report.blockingIssues.some((i) => i.type === 'qa_blocker_present')).toBe(false);
  });

  it('blocks QA failures for treatment-sourced output', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
      qaReport: { passesQA: false, overallScore: 61, criticalIssues: ['Encounter prose is malformed.'] } as any,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'qa_blocker_present', validator: 'QARunner' }),
    ]));
  });

  it('blocks callback debt from best-practices reports for treatment-sourced output only', async () => {
    const bestPracticesReport = {
      overallPassed: false,
      overallScore: 72,
      blockingIssues: [{
        category: 'callback_opportunities',
        level: 'error',
        message: 'Flag stela_herbs_accepted_gracefully is set but never paid off.',
        location: {},
        suggestion: 'Add an in-slice payoff or qualify it as future-window debt.',
      }],
      warnings: [],
      suggestions: [],
      metrics: {} as any,
      timestamp: new Date(),
      duration: 0,
    } as any;

    const freeform = await new FinalStoryContractValidator().validate({
      story: validStory(),
      bestPracticesReport,
    });
    expect(freeform.passed).toBe(true);
    expect(freeform.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unrepaired_callback_debt' }),
    ]));

    const treatment = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
      bestPracticesReport,
    });
    expect(treatment.passed).toBe(false);
    expect(treatment.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unrepaired_callback_debt' }),
    ]));
  });

  it('does not block callback debt when the callback ledger records an in-window payoff', async () => {
    const story = validStory();
    (story.episodes[0].scenes[0].beats[0].choices![1] as any).consequences = [
      { type: 'relationship', npcId: 'keeper', dimension: 'trust', change: 1 },
    ];
    (story.episodes[0].scenes[0].beats[0].choices![1] as any).reminderPlan = {
      immediate: 'The knock changes the silence.',
      shortTerm: 'The keeper remembers the courtesy.',
    };
    (story.episodes[0].scenes[0].beats[0].choices![2] as any).consequences = [
      { type: 'relationship', npcId: 'keeper', dimension: 'respect', change: 1 },
    ];
    (story.episodes[0].scenes[0].beats[0].choices![2] as any).reminderPlan = {
      immediate: 'The listening buys you a breath.',
      shortTerm: 'The keeper notices the restraint.',
    };
    const choice = story.episodes[0].scenes[0].beats[0].choices![0] as any;
    choice.consequences = [{ type: 'setFlag', flag: 'treatment_seed_ep1_1', value: true }];

    const withoutLedger = await new FinalStoryContractValidator().validate({
      story,
      treatmentSourced: true,
    });
    expect(withoutLedger.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unrepaired_callback_debt', message: expect.stringContaining('treatment_seed_ep1_1') }),
    ]));

    const withLedger = await new FinalStoryContractValidator().validate({
      story,
      treatmentSourced: true,
      generatedThroughEpisode: 1,
      callbackLedger: {
        version: 1,
        config: { defaultWindowSpan: 3, resolveAfterPayoffs: 2 },
        hooks: [{
          id: 'flag:treatment_seed_ep1_1',
          sourceEpisode: 1,
          sourceSceneId: 'scene-1',
          sourceChoiceId: 'choice-1',
          flags: ['treatment_seed_ep1_1'],
          conditionKeys: ['treatment_seed_ep1_1'],
          summary: 'The quartz choice is acknowledged.',
          payoffWindow: { minEpisode: 1, maxEpisode: 4 },
          payoffCount: 2,
          resolved: true,
        }],
      },
    });
    expect(withLedger.blockingIssues.some((i) => i.type === 'unrepaired_callback_debt')).toBe(false);
  });

  it('labels fewer generated treatment episodes as a partial slice instead of full completion', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
      requestedEpisodeNumbers: [1, 2, 3],
      sourceSeasonPlan: {
        totalEpisodes: 8,
        episodes: Array.from({ length: 8 }, (_, index) => ({ episodeNumber: index + 1, title: `Episode ${index + 1}` })),
      },
    });

    expect(report.passed).toBe(false); // requested episodes 2 and 3 are still missing.
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'partial_season_scope', message: expect.stringContaining('partial slice') }),
    ]));
  });

  it('fails full-season treatment mode when planned episodes are missing', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
      requestedEpisodeNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
      sourceSeasonPlan: {
        totalEpisodes: 8,
        episodes: Array.from({ length: 8 }, (_, index) => ({ episodeNumber: index + 1, title: `Episode ${index + 1}` })),
      },
    });

    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'partial_season_scope', message: expect.stringContaining('Full-season mode cannot pass') }),
    ]));
  });

  // §4.6 — treatment-fidelity findings (4.1–4.5) hard-fail when the source is an
  // authored treatment; QA-prose downgrades are unaffected.
  it('hard-fails a treatment-fidelity finding when the source is an authored treatment', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
      fidelityFindings: [{
        validator: 'AuthoredEpisodeConformanceValidator',
        severity: 'error',
        message: 'Episode 2 title drifted from the authored treatment.',
      }],
    });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((i) => i.type === 'treatment_fidelity_violation')).toBe(true);
  });

  it('downgrades a fidelity finding to advisory when the source is NOT a treatment', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: false,
      fidelityFindings: [{
        validator: 'SignatureDevicePresenceValidator',
        severity: 'error',
        message: 'Signature device not found in prose.',
      }],
    });

    expect(report.passed).toBe(true);
    expect(report.warnings.some((i) => i.type === 'treatment_fidelity_violation')).toBe(true);
  });

  it('does not block on fidelity findings at all when none are dispatched (default-off)', async () => {
    const report = await new FinalStoryContractValidator().validate({
      story: validStory(),
      treatmentSourced: true,
    });

    expect(report.blockingIssues.some((i) => i.type === 'treatment_fidelity_violation')).toBe(false);
  });

  describe('W6 continuity remediation gate', () => {
    const qaReportWithContradiction = () => ({
      continuity: {
        overallScore: 70,
        issueCount: { errors: 1, warnings: 0, suggestions: 0 },
        issues: [{
          severity: 'error' as const,
          type: 'contradiction' as const,
          location: { sceneId: 'scene-1', beatId: 'beat-1' },
          description: 'Two scenes stage the same first entry.',
          suggestedFix: 'Make the second a continuation.',
        }],
        passedChecks: [], recommendations: [],
      },
      voice: { overallScore: 95, characterScores: [], issues: [], distinctionScore: 90, recommendations: [] },
      stakes: { overallScore: 95, choiceSetAnalysis: [], metrics: {} as any, issues: [], strengths: [], recommendations: [] },
      overallScore: 88,
      passesQA: true,
      criticalIssues: [],
      summary: 'fixture',
    }) as any;

    it('does NOT promote continuity errors to blocking when the gate is off', async () => {
      const report = await new FinalStoryContractValidator().validate({
        story: validStory(), qaReport: qaReportWithContradiction(),
      });
      expect(report.blockingIssues.some((i) => i.type === 'continuity_error')).toBe(false);
    });

    it('promotes error-class continuity issues to blocking when GATE_CONTINUITY_REMEDIATION=1', async () => {
      const prev = process.env.GATE_CONTINUITY_REMEDIATION;
      process.env.GATE_CONTINUITY_REMEDIATION = '1';
      try {
        const report = await new FinalStoryContractValidator().validate({
          story: validStory(), qaReport: qaReportWithContradiction(),
        });
        const ce = report.blockingIssues.find((i) => i.type === 'continuity_error');
        expect(ce).toBeDefined();
        expect(ce?.sceneId).toBe('scene-1');
      } finally {
        if (prev === undefined) delete process.env.GATE_CONTINUITY_REMEDIATION;
        else process.env.GATE_CONTINUITY_REMEDIATION = prev;
      }
    });
  });
});
