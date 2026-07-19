import { describe, expect, it } from 'vitest';

import type { SceneContent } from '../agents/SceneWriter';
import {
  buildSceneCheckpointEnvelope,
  buildSceneCommitReceipt,
  findSceneCommitMutations,
  readSceneCheckpoint,
  sceneCommitReceiptMatches,
  sceneHandoffHash,
} from './sceneCommit';

const scene = {
  sceneId: 's1-1',
  sceneName: 'The Door',
  keyMoments: ['Ari finds the key.'],
  beats: [
    { id: 'b1', text: 'You find the brass key beneath the lamp.' },
    { id: 'b-mid', text: 'Dust turns in a narrow shaft of light.' },
    { id: 'b2', text: 'You turn it in the door and hear the lock release.' },
  ],
} as SceneContent;

const critic = {
  disposition: 'accepted' as const,
  scene,
  rewrittenBeatIds: ['b1'],
};

describe('scene commit receipts', () => {
  it('round-trips a committed scene envelope and verifies its hashes', () => {
    const receipt = buildSceneCommitReceipt({ episodeNumber: 1, scene, critic, committedAt: '2026-07-19T00:00:00.000Z' });
    const decoded = readSceneCheckpoint(buildSceneCheckpointEnvelope(scene, receipt));

    expect(decoded).toEqual({ scene, receipt, legacy: false });
    expect(sceneCommitReceiptMatches(receipt, scene)).toBe(true);
  });

  it('rejects a checkpoint whose committed prose changed without a new receipt', () => {
    const receipt = buildSceneCommitReceipt({ episodeNumber: 1, scene, critic });
    const changed = {
      ...scene,
      beats: scene.beats.map((beat, index) => index === 0 ? { ...beat, text: 'Changed after commit.' } : beat),
    };

    expect(readSceneCheckpoint(buildSceneCheckpointEnvelope(changed, receipt))).toBeUndefined();
    expect(sceneCommitReceiptMatches(receipt, changed)).toBe(false);
  });

  it('treats interior prose as handoff-neutral but detects a changed closing excerpt', () => {
    const interiorEdit = {
      ...scene,
      beats: [{ ...scene.beats[0], text: 'You spot the brass key beneath the lamp.' }, ...scene.beats.slice(1)],
    };
    const closingEdit = {
      ...scene,
      beats: [...scene.beats.slice(0, -1), { ...scene.beats.at(-1)!, text: 'The lock remains stubbornly closed.' }],
    };

    expect(sceneHandoffHash(interiorEdit)).toBe(sceneHandoffHash(scene));
    expect(sceneHandoffHash(closingEdit)).not.toBe(sceneHandoffHash(scene));
  });

  it('identifies every committed artifact surface changed by a downstream phase', () => {
    const choiceSet = {
      sceneId: scene.sceneId,
      beatId: 'b2',
      choiceType: 'expression',
      choices: [{ id: 'c1', text: 'Open it.' }],
    } as any;
    const encounter = { id: 'enc-1', sceneId: scene.sceneId, type: 'social' } as any;
    const receipt = buildSceneCommitReceipt({ episodeNumber: 1, scene, choiceSet, encounter, critic });
    const changedScene = {
      ...scene,
      beats: scene.beats.map((beat, index) => index === 1 ? { ...beat, text: 'Late mutation.' } : beat),
    } as SceneContent;
    const changedChoiceSet = {
      ...choiceSet,
      choices: [{ ...choiceSet.choices[0], text: 'Force it.' }],
    };

    expect(findSceneCommitMutations({
      receipts: [receipt],
      sceneContents: [changedScene],
      choiceSets: [changedChoiceSet],
      encounters: new Map([[scene.sceneId, { ...encounter, type: 'combat' }]]),
    })).toEqual([{ sceneId: scene.sceneId, surfaces: ['scene', 'handoff', 'choice', 'encounter'] }]);
  });
});
