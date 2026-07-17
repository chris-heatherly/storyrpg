import { describe, expect, it } from 'vitest';
import { addCriticNote, flagSceneForCritic, sceneCriticFlags, sceneCriticNotes } from './sceneCriticFlags';
import type { SceneContent } from '../agents/SceneWriter';

function scene(): SceneContent {
  return {
    sceneId: 's1-1',
    sceneName: 'Club Door',
    beats: [],
    startingBeatId: 'b1',
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  } as unknown as SceneContent;
}

describe('sceneCriticFlags', () => {
  it('is empty for an untagged scene', () => {
    expect(sceneCriticFlags(scene())).toEqual([]);
  });

  it('records distinct reasons and dedupes repeats', () => {
    const sc = scene();
    flagSceneForCritic(sc, 'incremental-validation-regen');
    flagSceneForCritic(sc, 'incremental-validation-regen');
    flagSceneForCritic(sc, 'realization-retry');
    expect(sceneCriticFlags(sc)).toEqual(['incremental-validation-regen', 'realization-retry']);
  });

  it('accepts the A3 advisory reasons', () => {
    const sc = scene();
    flagSceneForCritic(sc, 'advisory-planting-miss');
    flagSceneForCritic(sc, 'advisory-departure-miss');
    flagSceneForCritic(sc, 'advisory-relationship-evidence');
    flagSceneForCritic(sc, 'mechanics-lint-residual');
    expect(sceneCriticFlags(sc)).toHaveLength(4);
  });

  it('critic notes accumulate, dedupe, and ignore empty strings', () => {
    const sc = scene();
    expect(sceneCriticNotes(sc)).toEqual([]);
    addCriticNote(sc, 'Work in the crumpled note from Stela.');
    addCriticNote(sc, 'Work in the crumpled note from Stela.');
    addCriticNote(sc, '   ');
    addCriticNote(sc, 'End with a motivated departure toward the rooftop.');
    expect(sceneCriticNotes(sc)).toEqual([
      'Work in the crumpled note from Stela.',
      'End with a motivated departure toward the rooftop.',
    ]);
  });
});
