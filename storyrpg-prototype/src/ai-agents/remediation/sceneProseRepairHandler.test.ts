import { describe, expect, it, vi } from 'vitest';
import {
  buildSceneProseRepairHandler,
  buildSceneRepairDirectorNotes,
  selectSceneProseRepairs,
} from './sceneProseRepairHandler';
import type { Story } from '../../types/story';

const SIGNATURE =
  'Two anchors, light then dark — the rooftop bar at sunset on night three where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.';

const requiredBeatIssue = (sceneId: string, episodeNumber = 2) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Authored required beat is missing from the final prose of episode ${episodeNumber} scene "${sceneId}": "A strategy argument over the route sharpens the old hostility.". The authored turn must be dramatized on-page, not dropped or truncated.`,
  validator: 'RequiredBeatRealizationValidator',
  suggestion: 'Dramatize this authored beat on-page in its scene.',
  sceneId,
  episodeNumber,
});

const signatureIssue = (sceneId: string) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Signature device is missing from the final prose of episode 1 scene "${sceneId}": "${SIGNATURE}". The staged signature moment must be depicted, not summarized away.`,
  validator: 'SignatureDevicePresenceValidator',
  suggestion: 'Dramatize the signature device on-page in this scene.',
  sceneId,
  episodeNumber: 1,
});

function makeStory(): Story {
  return {
    id: 'st',
    title: 'T',
    episodes: [
      {
        id: 'ep-1', number: 1,
        scenes: [
          { id: 's1-4', name: 'Willow', beats: [{ id: 'b1', text: 'Kylie walks home through the park.' }, { id: 'b2', text: 'The night is quiet.' }] },
          {
            id: 'treatment-enc-1-1', name: 'Encounter', beats: [],
            encounter: {
              id: 'enc',
              phases: [{ beats: [{ id: 'p1', setupText: 'A sunset on the stoop, the door locks.', text: '' }] }],
              storylets: [
                { beats: [{ id: 'sv-1', text: 'Fog clings as she fumbles the key.' }] },
                { beats: [{ id: 'sp-1', text: 'A taxi blares; she dives in.' }] },
              ],
            },
          },
          { id: 'treatment-enc-1-2', name: 'Empty Encounter', beats: [], encounter: { id: 'enc2' } },
        ],
      },
      {
        id: 'ep-2', number: 2,
        scenes: [
          { id: 's2-1', name: 'Route', beats: [{ id: 'b1', text: 'They study the map in silence.' }] },
        ],
      },
    ],
  } as unknown as Story;
}

describe('selectSceneProseRepairs', () => {
  it('selects only prose-realization validators with a sceneId, grouped by scene', () => {
    const groups = selectSceneProseRepairs([
      requiredBeatIssue('s2-1'),
      signatureIssue('s1-4'),
      requiredBeatIssue('s2-1'), // second finding on same scene merges into the group
      { type: 'skill_plan_nonconformance', severity: 'error', validator: 'SkillPlanConformanceValidator', message: 'off-plan' }, // not prose-repairable
      { type: 'treatment_fidelity_violation', severity: 'error', validator: 'AuthoredEpisodeConformanceValidator', message: 'episode list mismatch' }, // fidelity but not prose
      { type: 'treatment_fidelity_violation', severity: 'error', validator: 'RequiredBeatRealizationValidator', message: 'no scene id' }, // missing sceneId
    ]);
    expect([...groups.keys()].sort()).toEqual(['s1-4', 's2-1']);
    expect(groups.get('s2-1')).toHaveLength(2);
  });

  it('routes planning-register prose leaks to scene-prose repair', () => {
    const groups = selectSceneProseRepairs([
      {
        type: 'planning_register_prose',
        severity: 'error',
        message: 'Planning-register instruction leaked into story content (Open the episode).',
        validator: 'PlanningRegisterLeakValidator',
        sceneId: 's1-4',
        episodeNumber: 1,
      },
    ]);

    expect([...groups.keys()]).toEqual(['s1-4']);
  });

  it('caps the number of scenes per round but keeps extra findings for capped scenes', () => {
    const groups = selectSceneProseRepairs(
      [requiredBeatIssue('a'), requiredBeatIssue('b'), requiredBeatIssue('c'), requiredBeatIssue('a')],
      2,
    );
    expect([...groups.keys()]).toEqual(['a', 'b']);
    expect(groups.get('a')).toHaveLength(2);
  });
});

describe('buildSceneRepairDirectorNotes', () => {
  it('includes each finding message and suggestion, and the on-page dramatization instruction', () => {
    const notes = buildSceneRepairDirectorNotes([requiredBeatIssue('s2-1')]);
    expect(notes).toContain('strategy argument over the route');
    expect(notes).toContain('Dramatize this authored beat on-page');
    expect(notes).toContain('ON-PAGE');
    expect(notes).toContain('Keep beat ids');
  });
});

describe('buildSceneProseRepairHandler', () => {
  it('returns changed:false when there are no repairable findings', async () => {
    const critic = { execute: vi.fn() };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [{ type: 'empty_scene', severity: 'error', message: 'x' }] });
    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
  });

  it('rewrites the named scene via SceneCritic and merges beats into the story', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'A strategy argument over the route sharpens the old hostility.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [requiredBeatIssue('s2-1')] });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    const callArg = critic.execute.mock.calls[0][0];
    expect(callArg.scene.sceneId).toBe('s2-1');
    expect(callArg.directorNotes).toContain('strategy argument');
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('strategy argument over the route');
    expect(result.record).toMatchObject({ rule: 'final_contract_scene_prose', scope: 'scene', succeeded: true });
  });

  it('repairs an ENCOUNTER scene: rewrites encounter phase/storylet prose and merges it back', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 'treatment-enc-1-1',
          rewrittenBeats: [
            { id: 'p1', text: 'The rooftop bar locks into place at sunset; Kylie catches both men watching her.' },
            { id: 'sv-1', text: 'Cișmigiu at 1am: eight seconds of fog, a shadow, a scream, a rescue.' },
          ],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [signatureIssue('treatment-enc-1-1')] });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    // SceneCritic saw the flattened encounter prose beats (by their real ids).
    const beatIds = critic.execute.mock.calls[0][0].scene.beats.map((b: { id: string }) => b.id);
    expect(beatIds).toEqual(['p1', 'sv-1', 'sp-1']);
    // Phase prose merged to setupText; storylet prose merged to text.
    const enc = (story as any).episodes[0].scenes[1].encounter;
    expect(enc.phases[0].beats[0].setupText).toContain('rooftop bar');
    expect(enc.storylets[0].beats[0].text).toContain('Cișmigiu');
    expect(result.record).toMatchObject({ rule: 'final_contract_scene_prose', succeeded: true });
  });

  it('skips an encounter scene with no rewritable prose and reports changed:false', async () => {
    const critic = { execute: vi.fn() };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [signatureIssue('treatment-enc-1-2')] });
    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
  });

  // A finding whose message QUOTES the authored moment (the real validator shape) —
  // lets the handler predict clearance with the local scoring mirror.
  const momentIssue = (sceneId: string, episodeNumber: number, moment: string) => ({
    type: 'treatment_fidelity_violation',
    severity: 'error',
    message: `Authored required beat is missing from the final prose of episode ${episodeNumber} scene "${sceneId}": "${moment}". The authored turn must be dramatized on-page, not dropped or truncated.`,
    validator: 'RequiredBeatRealizationValidator',
    suggestion: 'Dramatize this authored beat on-page in its scene.',
    sceneId,
    episodeNumber,
  });
  const MOMENT = 'Kylie posts the rooftop story to the blog before dawn while Mika watches the stairwell.';
  const NOTICER_SPLINTERS = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
  const sceneTurnIssue = (sceneId: string, episodeNumber: number, moment: string) => ({
    type: 'scene_turn_realization_violation',
    severity: 'error',
    message: `Scene "${sceneId}" does not dramatize its central turn on-page: "${moment}".`,
    validator: 'SceneTurnRealizationValidator',
    suggestion: 'Generate reader-facing scene prose that establishes, dramatizes, and follows through on the scene turn.',
    sceneId,
    episodeNumber,
  });

  it('verifies the merge against the scoring mirror and retries ONCE with the still-missing checklist', async () => {
    const critic = {
      execute: vi.fn()
        // Attempt 1: fluent but incomplete — misses blog/dawn/Mika/stairwell.
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: 'Kylie posts the rooftop story.' }], critiqueNotes: [], overallCommentary: '' },
        })
        // Attempt 2: full dramatization.
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: 'Kylie posts the rooftop story to the blog before dawn while Mika watches the stairwell.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [momentIssue('s2-1', 2, MOMENT)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    // The retry's director notes name the words still missing after attempt 1
    // (the checklist line, not the quoted finding which always carries the moment).
    const retryNotes: string = critic.execute.mock.calls[1][0].directorNotes;
    const checklist = retryNotes.split('\n').find((l: string) => l.includes('NON-NEGOTIABLE')) ?? '';
    expect(checklist).toContain('blog');
    expect(checklist).toContain('stairwell');
    expect(checklist).not.toContain('rooftop'); // already landed in attempt 1
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, attempts: 2 });
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('stairwell');
  });

  it('does not retry when the first rewrite already depicts the full moment', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: MOMENT }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const result = await handler({ story: makeStory(), blockingIssues: [momentIssue('s2-1', 2, MOMENT)] });
    expect(critic.execute).toHaveBeenCalledTimes(1);
    expect(result.record).toMatchObject({ succeeded: true, attempts: 1 });
  });

  it('does not report a SceneTurn repair as succeeded when the rewrite only lands part of the central turn', async () => {
    const partial =
      "The mantle photograph bothers you because Victor seems omitted from the family arrangement. A guest smiles too knowingly and uses the Marinescu maiden name before you offer it.";
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: partial }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [sceneTurnIssue('s2-1', 2, NOTICER_SPLINTERS)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: false, degraded: true, attempts: 2 });
  });

  it('reports a SceneTurn repair as succeeded only after every listed splinter is on-page', async () => {
    const partial =
      "The mantle photograph bothers you because Victor seems omitted from the family arrangement. A guest smiles too knowingly and uses the Marinescu maiden name before you offer it.";
    const complete = [
      'In the powder room, Ileana cries into a monogrammed towel and freezes when you see her.',
      'The mantle photograph omits Victor from a family arrangement that otherwise accounts for everyone.',
      "Mika returns from an unexplained missing hour and deflects when you ask where he's been.",
      'A guest knows the Marinescu maiden name before you give him any reason to know it.',
    ].join(' ');
    const critic = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: partial }], critiqueNotes: [], overallCommentary: '' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: complete }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [sceneTurnIssue('s2-1', 2, NOTICER_SPLINTERS)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, degraded: false, attempts: 2 });
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('Ileana cries');
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('missing hour');
  });

  it('prioritizes never-attempted scenes in later rounds instead of re-claiming slots', async () => {
    // Two failing scenes, cap 1/round. Round 1 takes s1-4 (insertion order) and
    // its rewrite does NOT clear; round 2 must pick s2-1 (never attempted),
    // not retry s1-4 again.
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 'x', rewrittenBeats: [{ id: 'b1', text: 'unrelated polish' }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never, maxScenesPerRound: 1 });
    const story = makeStory();
    const blocking = [
      momentIssue('s1-4', 1, 'A note about the crescent card is slipped under the door at midnight.'),
      momentIssue('s2-1', 2, MOMENT),
    ];
    await handler({ story, blockingIssues: blocking }); // round 1: s1-4 (2 attempts, never clears)
    const round1Scenes = critic.execute.mock.calls.map((c) => c[0].scene.sceneId);
    expect(round1Scenes.every((s: string) => s === 's1-4')).toBe(true);

    critic.execute.mockClear();
    await handler({ story, blockingIssues: blocking }); // round 2: s2-1 first
    expect(critic.execute.mock.calls[0][0].scene.sceneId).toBe('s2-1');
  });

  it('survives a critic failure on one scene and still repairs the other', async () => {
    const critic = {
      execute: vi.fn()
        .mockRejectedValueOnce(new Error('LLM unavailable'))
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-4', rewrittenBeats: [{ id: 'b2', text: 'A shadow pins Kylie to the willow; a second figure peels from the dark.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({
      story,
      blockingIssues: [requiredBeatIssue('s2-1'), signatureIssue('s1-4')],
    });
    expect(result.changed).toBe(true);
    expect((story as any).episodes[0].scenes[0].beats[1].text).toContain('willow');
    expect(result.record?.degraded).toBe(true); // one of two scenes failed
  });

  it('returns changed:false when no critic is available', async () => {
    const handler = buildSceneProseRepairHandler({ critic: () => null });
    const result = await handler({ story: makeStory(), blockingIssues: [requiredBeatIssue('s2-1')] });
    expect(result.changed).toBe(false);
  });
});

describe('selectSceneProseRepairs — EncounterAnchorContent is repairable (bite-me-g18)', () => {
  it('selects an EncounterAnchorContentValidator finding by its encounter sceneId', () => {
    const groups = selectSceneProseRepairs([
      { validator: 'EncounterAnchorContentValidator', sceneId: 'treatment-enc-3-1', message: 'does not depict its central conflict…' } as never,
      { validator: 'AuthoredEpisodeConformanceValidator', sceneId: 'x', message: 'episode mismatch' } as never,
    ]);
    expect(groups.has('treatment-enc-3-1')).toBe(true);
    expect(groups.has('x')).toBe(false); // non-prose validator stays excluded
  });
})
