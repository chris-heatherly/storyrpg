import { describe, expect, it, vi } from 'vitest';
import {
  buildSceneProseRepairHandler,
  buildSceneRepairDirectorNotes,
  selectSceneProseRepairs,
} from './sceneProseRepairHandler';
import type { Story } from '../../types/story';

const requiredBeatIssue = (sceneId: string, episodeNumber = 2) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Authored required beat is missing from the final prose of episode ${episodeNumber} scene "${sceneId}": "A strategy argument over the route sharpens the old hostility."`,
  validator: 'RequiredBeatRealizationValidator',
  suggestion: 'Dramatize this authored beat on-page in its scene.',
  sceneId,
  episodeNumber,
});

const signatureIssue = (sceneId: string) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Signature device is missing from the final prose of episode 1 scene "${sceneId}".`,
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
          rewrittenBeats: [{ id: 'b1', text: 'Rorik jabs the map; the old hostility sharpens into a route argument neither will lose.' }],
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
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('route argument');
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
