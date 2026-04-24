import { describe, expect, it } from 'vitest';
import { resolveShotCast, type ShotCastCharacter } from './shotCastResolver';

const characters: ShotCastCharacter[] = [
  { id: 'protagonist', name: 'Clara' },
  { id: 'mustard', name: 'Colonel Mustard' },
  { id: 'scarlet', name: 'Miss Scarlet' },
  { id: 'plum', name: 'Professor Plum' },
  { id: 'peacock', name: 'Mrs Peacock' },
];

const sceneCharacterIds = characters.map(c => c.id);

describe('resolveShotCast', () => {
  it('excludes the protagonist from an NPC-only beat when the protagonist is merely scene-present', () => {
    const cast = resolveShotCast({
      beat: {
        text: 'Across the study, Colonel Mustard corners Miss Scarlet beside the locked desk.',
        visualMoment: 'Colonel Mustard blocks Miss Scarlet at the desk.',
        primaryAction: 'Colonel Mustard blocks Miss Scarlet',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual(['mustard', 'scarlet']);
    expect(cast.offscreenCharacterIds).toContain('protagonist');
  });

  it('includes the protagonist when visible second-person action makes them part of the shot', () => {
    const cast = resolveShotCast({
      beat: {
        text: 'You step between Colonel Mustard and the door before he can leave.',
        visualMoment: 'Clara steps between Colonel Mustard and the door.',
        primaryAction: 'Clara blocks Colonel Mustard',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual(['protagonist', 'mustard']);
  });

  it('includes all characters required by the beat instead of applying a count cap', () => {
    const cast = resolveShotCast({
      beat: {
        text: 'Colonel Mustard, Miss Scarlet, Professor Plum, and Mrs Peacock all reach for the same envelope.',
        visualMoment: 'Colonel Mustard, Miss Scarlet, Professor Plum, and Mrs Peacock reach for the envelope at once.',
        primaryAction: 'four suspects reach for the envelope',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual(['mustard', 'scarlet', 'plum', 'peacock']);
    expect(cast.offscreenCharacterIds).toContain('protagonist');
  });

  it('keeps scene-present characters offscreen when they are not visually needed', () => {
    const cast = resolveShotCast({
      beat: {
        text: 'Miss Scarlet lowers her voice and slides the brass key toward Professor Plum.',
        visualMoment: 'Miss Scarlet slides the brass key toward Professor Plum.',
        primaryAction: 'Miss Scarlet slides the key',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual(['scarlet', 'plum']);
    expect(cast.offscreenCharacterIds).toEqual(['protagonist', 'mustard', 'peacock']);
  });

  it('keeps observers as optional background only when visible observation matters', () => {
    const cast = resolveShotCast({
      beat: {
        text: 'Mrs Peacock watches from the doorway as Miss Scarlet slides the brass key toward Professor Plum.',
        visualMoment: 'Miss Scarlet slides the brass key toward Professor Plum.',
        primaryAction: 'Miss Scarlet slides the key',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual(['scarlet', 'plum']);
    expect(cast.optionalBackgroundCharacterIds).toEqual(['peacock']);
    expect(cast.offscreenCharacterIds).toContain('protagonist');
  });

  it('returns no visible cast for establishing shots', () => {
    const cast = resolveShotCast({
      beat: {
        shotType: 'establishing',
        text: 'Rain beads on the conservatory glass.',
        visualMoment: 'Rain beads on the empty conservatory glass.',
      },
      sceneCharacterIds,
      characters,
      protagonistId: 'protagonist',
    });

    expect(cast.requiredForegroundCharacterIds).toEqual([]);
    expect(cast.optionalBackgroundCharacterIds).toEqual([]);
    expect(cast.offscreenCharacterIds).toEqual(sceneCharacterIds);
  });
});
