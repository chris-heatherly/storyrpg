import { describe, expect, it } from 'vitest';
import {
  choiceSetBelongsToScene,
  findChoiceSetForScene,
  findSceneForChoiceSet,
} from './choiceSetLookup';

describe('choiceSetLookup', () => {
  const firstScene = {
    sceneId: 'scene-a',
    beats: [{ id: 'beat-1' }, { id: 'beat-6' }],
  };
  const secondScene = {
    sceneId: 'scene-b',
    beats: [{ id: 'beat-1' }, { id: 'beat-6' }],
  };
  const firstChoiceSet = {
    sceneId: 'scene-a',
    beatId: 'beat-6',
    choices: [{ id: 'a-choice' }],
  };
  const secondChoiceSet = {
    sceneId: 'scene-b',
    beatId: 'beat-6',
    choices: [{ id: 'b-choice' }],
  };

  it('requires scene id as well as beat id when local beat ids repeat', () => {
    expect(choiceSetBelongsToScene(firstChoiceSet, firstScene)).toBe(true);
    expect(choiceSetBelongsToScene(firstChoiceSet, secondScene)).toBe(false);
  });

  it('finds the choice set for the matching scene instead of the first reused beat id', () => {
    expect(findChoiceSetForScene([firstChoiceSet, secondChoiceSet], secondScene)).toBe(secondChoiceSet);
  });

  it('finds the scene for a choice set through the scene-scoped key', () => {
    expect(findSceneForChoiceSet([firstScene, secondScene], secondChoiceSet)).toBe(secondScene);
  });

  it('rejects legacy beat-only choice sets as ambiguous in scene-scoped paths', () => {
    expect(choiceSetBelongsToScene({ beatId: 'beat-6' }, secondScene)).toBe(false);
  });
});
