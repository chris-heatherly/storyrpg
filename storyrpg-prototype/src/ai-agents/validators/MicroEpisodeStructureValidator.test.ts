import { describe, expect, it } from 'vitest';
import { MicroEpisodeStructureValidator } from './MicroEpisodeStructureValidator';
import type { Beat, Episode, Scene } from '../../types';

function makeBeat(id: string, text: string, beat: Partial<Beat> = {}): Beat {
  return { id, text, ...beat };
}

function makeScene(id: string, beats: Beat[], scene: Partial<Scene> = {}): Scene {
  return {
    id,
    name: `Scene ${id}`,
    beats,
    startingBeatId: beats[0]?.id ?? '',
    ...scene,
  };
}

function makeEpisode(scene: Scene, episode: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    number: 1,
    title: 'Test Episode',
    synopsis: 'A single-scene micro episode used for structure validation.',
    coverImage: 'cover.png',
    scenes: [scene],
    startingSceneId: scene.id,
    ...episode,
  };
}

describe('MicroEpisodeStructureValidator', () => {
  it('accepts a well-formed normal micro-episode (1 scene, 6 beats, a visible choice, final cliffhanger beat)', () => {
    const beats: Beat[] = [
      makeBeat('b1', 'The door creaks open into the dark.'),
      makeBeat('b2', 'Footsteps echo from somewhere below.', {
        choices: [{ id: 'c1', text: 'Descend the stairs.' }],
      }),
      makeBeat('b3', 'A faint light flickers ahead.'),
      makeBeat('b4', 'You round the corner.'),
      makeBeat('b5', 'The room is colder than it should be.'),
      makeBeat('b6', 'A hand closes over your shoulder.'),
    ];
    const episode = makeEpisode(makeScene('scene-1', beats));

    const validator = new MicroEpisodeStructureValidator();
    const result = validator.validateEpisode(episode);

    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(result.metrics).toMatchObject({
      sceneCount: 1,
      normalBeatCount: 6,
      visibleChoiceCount: 1,
    });
  });

  it('flags low beat count, a missing visible choice, and a missing cliffhanger beat', () => {
    const beats: Beat[] = [
      makeBeat('b1', 'A short opening line.'),
      makeBeat('b2', 'A second line.'),
      // Locked choice does not count as a visible choice.
      makeBeat('b3', '', { choices: [{ id: 'c1', text: 'Locked option', showWhenLocked: true }] }),
    ];
    const episode = makeEpisode(makeScene('scene-1', beats));

    const validator = new MicroEpisodeStructureValidator();
    const result = validator.validateEpisode(episode);

    expect(result.valid).toBe(false);

    const types = result.issues.map((issue) => issue.type);
    expect(types).toContain('normal_beat_count');
    expect(types).toContain('missing_choice');
    expect(types).toContain('missing_cliffhanger');

    expect(result.metrics.normalBeatCount).toBe(3);
    expect(result.metrics.visibleChoiceCount).toBe(0);
  });

  it('flags scene_count and route_meta when the episode is multi-scene with a mismatched startingSceneId', () => {
    const sceneA = makeScene('scene-a', [
      makeBeat('a1', 'Beat 1'),
      makeBeat('a2', 'Beat 2'),
      makeBeat('a3', 'Beat 3'),
      makeBeat('a4', 'Beat 4'),
      makeBeat('a5', 'Beat 5'),
      makeBeat('a6', 'Beat 6', { choices: [{ id: 'ca', text: 'Continue.' }] }),
    ]);
    const sceneB = makeScene('scene-b', [makeBeat('b1', 'Extra scene beat')]);
    const episode = makeEpisode(sceneA, {
      scenes: [sceneA, sceneB],
      startingSceneId: 'wrong-id',
    });

    const validator = new MicroEpisodeStructureValidator();
    const result = validator.validateEpisode(episode);

    expect(result.valid).toBe(false);
    const types = result.issues.map((issue) => issue.type);
    expect(types).toContain('scene_count');
    expect(types).toContain('route_meta');
    expect(result.metrics.sceneCount).toBe(2);
  });
});
