import { describe, expect, it } from 'vitest';
import { TwistQualityValidator } from './TwistQualityValidator';
import type { SceneContent, GeneratedBeat } from '../agents/SceneWriter';

function makeBeat(
  id: string,
  plotPointType?: GeneratedBeat['plotPointType'],
): GeneratedBeat {
  return {
    id,
    text: `Prose for beat ${id}.`,
    ...(plotPointType ? { plotPointType } : {}),
  };
}

function makeScene(sceneId: string, beats: GeneratedBeat[]): SceneContent {
  return {
    sceneId,
    sceneName: `Scene ${sceneId}`,
    beats,
    startingBeatId: beats[0]?.id ?? '',
    moodProgression: ['neutral'],
    charactersInvolved: ['protagonist'],
    keyMoments: [],
    continuityNotes: [],
  };
}

describe('TwistQualityValidator', () => {
  it('passes a properly foreshadowed twist where setup precedes the reveal', () => {
    const result = new TwistQualityValidator().validate({
      sceneContents: [
        makeScene('scene-1', [makeBeat('b1'), makeBeat('b2', 'setup')]),
        makeScene('scene-2', [makeBeat('b3'), makeBeat('b4', 'twist')]),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.twistPresent).toBe(true);
    expect(result.metrics.foreshadowPresent).toBe(true);
    expect(result.metrics.foreshadowPrecedesReveal).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('flags an error when a twist has no foreshadow setup beat', () => {
    const result = new TwistQualityValidator().validate({
      sceneContents: [
        makeScene('scene-1', [makeBeat('b1')]),
        makeScene('scene-2', [makeBeat('b2', 'revelation')]),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.twistPresent).toBe(true);
    expect(result.metrics.foreshadowPresent).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'error' && i.message.includes('no foreshadow'),
      ),
    ).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('warns when the foreshadow sits in the same scene as the reveal', () => {
    const result = new TwistQualityValidator().validate({
      sceneContents: [
        makeScene('scene-1', [makeBeat('b1', 'setup'), makeBeat('b2', 'twist')]),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.foreshadowPrecedesReveal).toBe(true);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'warning' && i.message.includes('same scene'),
      ),
    ).toBe(true);
  });

  it('warns when generated scenes do not honor the planned twist scheduling', () => {
    const result = new TwistQualityValidator().validate({
      sceneContents: [
        makeScene('scene-1', [makeBeat('b1', 'setup')]),
        makeScene('scene-2', [makeBeat('b2', 'twist')]),
      ],
      twistPlan: {
        episodeId: 'ep-1',
        headline: 'The mentor was the traitor.',
        kind: 'betrayal',
        // Points at a beat that is NOT marked twist/revelation.
        twistSceneId: 'scene-2',
        twistBeatId: 'b-missing',
        foreshadowSceneId: 'scene-1',
        foreshadowBeatId: 'b1',
        rationale: 'Plan rationale.',
        directives: [],
      },
    });

    expect(result.metrics.matchesPlan).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'warning' &&
          i.message.includes('do not honor the planned twist'),
      ),
    ).toBe(true);
  });

  it('recognizes an encounter-owned foreshadow binding as a planned prose surface', () => {
    const result = new TwistQualityValidator().validate({
      sceneContents: [
        makeScene('enc-1', []),
        makeScene('scene-2', [makeBeat('reveal', 'revelation')]),
      ],
      twistPlan: {
        episodeId: 'ep-1', headline: 'The name changes everything.', kind: 'revelation',
        foreshadowSceneId: 'enc-1', foreshadowBeatId: 'enc-beat-1',
        twistSceneId: 'scene-2', twistBeatId: 'reveal',
        rationale: 'The earlier flinch prepares the reveal.', directives: [],
        surfaceBindings: {
          foreshadow: { kind: 'encounter_beat', id: 'enc-beat-1' },
          twist: { kind: 'scene_beat', id: 'reveal' },
        },
      },
    });

    expect(result.metrics).toMatchObject({
      twistPresent: true,
      foreshadowPresent: true,
      foreshadowPrecedesReveal: true,
      matchesPlan: true,
    });
    expect(result.valid).toBe(true);
  });
});
