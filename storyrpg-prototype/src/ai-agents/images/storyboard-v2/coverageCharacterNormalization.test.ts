import { describe, expect, it } from 'vitest';

import { normalizeBeatCoverageCharacterIds } from './coverageCharacterNormalization';

const characterBible = {
  characters: [
    { id: 'char-kylie-marinescu', name: 'Kylie Marinescu', role: 'protagonist' },
    { id: 'char-mika-dragan', name: 'Mika Dragan', aliases: ['Mika Drăgan'], role: 'mentor' },
  ],
  relationshipSummary: '',
  keyDynamics: [],
  ensembleBalance: '',
  gaps: [],
  voiceDistinctions: '',
  doNotForget: [],
} as any;

describe('normalizeBeatCoverageCharacterIds', () => {
  it('normalizes coverage aliases to canonical character ids', () => {
    const scene = {
      sceneId: 'scene-1',
      sceneName: 'Club threshold',
      beats: [{
        id: 'beat-1',
        text: 'Kylie meets Mika.',
        coveragePlan: {
          stagingPattern: 'two-shot',
          shotDistance: 'MS',
          cameraAngle: 'eye-level',
          cameraSide: 'front-left',
          focalCharacterIds: ['kylie'],
          requiredVisibleCharacterIds: ['Kylie', 'Mika Drăgan'],
          optionalVisibleCharacterIds: ['char-kylie'],
          offscreenCharacterIds: ['char-mika-dragan'],
          relationshipBlocking: 'Mika controls the rope.',
          coverageReason: 'relationship beat',
        },
      }],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    } as any;

    const diagnostic = normalizeBeatCoverageCharacterIds(scene, characterBible, { id: 'char-kylie-marinescu' });

    expect(scene.beats[0].coveragePlan.requiredVisibleCharacterIds).toEqual(['char-kylie-marinescu', 'char-mika-dragan']);
    expect(scene.beats[0].coveragePlan.optionalVisibleCharacterIds).toEqual(['char-kylie-marinescu']);
    expect(scene.beats[0].coveragePlan.focalCharacterIds).toEqual(['char-kylie-marinescu']);
    expect(diagnostic.blocking).toEqual([]);
    expect(diagnostic.changes.length).toBeGreaterThan(0);
  });

  it('keeps unresolved required names out of contract fields and blocks', () => {
    const scene = {
      sceneId: 'scene-1',
      sceneName: 'Club threshold',
      beats: [{
        id: 'beat-1',
        text: 'Unknown Stranger enters.',
        coveragePlan: {
          stagingPattern: 'single',
          shotDistance: 'MS',
          cameraAngle: 'eye-level',
          cameraSide: 'front-left',
          focalCharacterIds: [],
          requiredVisibleCharacterIds: ['Unknown Stranger'],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: [],
          relationshipBlocking: 'The stranger controls the door.',
          coverageReason: 'setup beat',
        },
      }],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    } as any;

    const diagnostic = normalizeBeatCoverageCharacterIds(scene, characterBible);

    expect(scene.beats[0].coveragePlan.requiredVisibleCharacterIds).toEqual([]);
    expect(diagnostic.blocking[0]).toContain('Unknown Stranger');
  });
});
