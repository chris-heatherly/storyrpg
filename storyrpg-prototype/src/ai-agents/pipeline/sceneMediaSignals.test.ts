import { describe, expect, it } from 'vitest';
import {
  inferChoiceType,
  inferIntensity,
  inferValence,
  mapSpeakerMoodToEmotion,
  resolveWorldLocationForScene,
} from './sceneMediaSignals';
import type { WorldBible } from '../agents/WorldBuilder';

describe('mapSpeakerMoodToEmotion', () => {
  it('maps mood keywords to emotion categories', () => {
    expect(mapSpeakerMoodToEmotion('hopeful and excited')).toBe('hopeful');
    expect(mapSpeakerMoodToEmotion('anxious')).toBe('tense');
    expect(mapSpeakerMoodToEmotion('mournful grief')).toBe('melancholy');
    expect(mapSpeakerMoodToEmotion('triumphant')).toBe('triumphant');
    expect(mapSpeakerMoodToEmotion('creeping dread')).toBe('eerie');
    expect(mapSpeakerMoodToEmotion(undefined)).toBe('neutral');
  });

  it('maps anger to tense', () => {
    expect(mapSpeakerMoodToEmotion('angry')).toBe('tense');
  });
});

describe('inferIntensity', () => {
  it('flags rage/terror as high', () => {
    expect(inferIntensity('rage')).toBe('high');
  });

  it('flags repeated exclamations as high', () => {
    expect(inferIntensity(undefined, 'Get down! Now!')).toBe('high');
  });

  it('flags calm moods as low', () => {
    expect(inferIntensity('calm')).toBe('low');
  });

  it('defaults to medium', () => {
    expect(inferIntensity('thoughtful', 'She considers the map.')).toBe('medium');
  });
});

describe('inferValence', () => {
  it('classifies positive, negative, and ambiguous moods', () => {
    expect(inferValence('joyful')).toBe('positive');
    expect(inferValence('despairing')).toBe('negative');
    expect(inferValence('curious')).toBe('ambiguous');
  });
});

describe('inferChoiceType', () => {
  it('classifies by keyword', () => {
    expect(inferChoiceType('Trust her with the truth')).toBe('trust');
    expect(inferChoiceType('Doubt his story')).toBe('suspicion');
    expect(inferChoiceType('Fight your way out')).toBe('action');
    expect(inferChoiceType('Wait and stay careful')).toBe('caution');
    expect(inferChoiceType('Help the stranger')).toBe('kindness');
    expect(inferChoiceType('Punish the informant')).toBe('cruelty');
    expect(inferChoiceType('Open the box')).toBe('other');
  });
});

describe('resolveWorldLocationForScene', () => {
  const worldBible = {
    locations: [
      { id: 'loc-docks', name: 'The Docks' },
      { id: 'loc-tower', name: 'Radio Tower' },
    ],
  } as unknown as WorldBible;

  it('matches authored location by id then name', () => {
    expect(resolveWorldLocationForScene({ location: 'loc-tower', name: 'x', description: '' }, worldBible).id).toBe('loc-tower');
    expect(resolveWorldLocationForScene({ location: 'the docks', name: 'x', description: '' }, worldBible).id).toBe('loc-docks');
  });

  it('falls back to a heuristic match from scene text', () => {
    expect(resolveWorldLocationForScene({ location: '', name: 'Meeting at the Radio Tower', description: '' }, worldBible).id).toBe('loc-tower');
  });

  it('defaults to the first location when nothing matches', () => {
    expect(resolveWorldLocationForScene({ location: '', name: 'Nowhere', description: '' }, worldBible).id).toBe('loc-docks');
  });
});
