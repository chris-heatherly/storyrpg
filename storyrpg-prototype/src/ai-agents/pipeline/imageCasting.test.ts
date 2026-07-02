import { describe, expect, it } from 'vitest';
import {
  analyzeBeatCharacters,
  extractCanonicalAppearance,
  getCharacterIdBySpeaker,
  getCharacterIdsInScene,
  inferBasePostureFromPersonality,
  inferGestureStyleFromPersonality,
  isEstablishingBeat,
  normalizeCharacterIds,
  resolveCharacterId,
  resolveCharacterIdWithBrief,
  resolveProtagonistCharacterId,
} from './imageCasting';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { SceneContent } from '../agents/SceneWriter';

const characterBible = {
  characters: [
    { id: 'char-mara', name: 'Mara Voss', role: 'protagonist' },
    { id: 'char-eli', name: 'Eli Grant', role: 'ally' },
    { id: 'char-warden', name: 'The Warden', role: 'antagonist' },
  ],
} as unknown as CharacterBible;

describe('resolveCharacterId', () => {
  it('resolves direct id and name matches', () => {
    expect(resolveCharacterId('char-eli', characterBible)).toBe('char-eli');
    expect(resolveCharacterId('Eli Grant', characterBible)).toBe('char-eli');
  });

  it('resolves fuzzy matches (char- prefix, underscores, case)', () => {
    expect(resolveCharacterId('eli grant', characterBible)).toBe('char-eli');
    expect(resolveCharacterId('char_eli', characterBible)).toBe('char-eli');
  });

  it('returns null for unknown or empty input', () => {
    expect(resolveCharacterId('nobody', characterBible)).toBeNull();
    expect(resolveCharacterId('', characterBible)).toBeNull();
  });
});

describe('resolveProtagonistCharacterId', () => {
  it('prefers the role-tagged protagonist', () => {
    expect(resolveProtagonistCharacterId(characterBible, { protagonist: { name: 'Eli Grant' } })).toBe('char-mara');
  });

  it('falls back to brief name when no role matches', () => {
    const bible = {
      characters: [
        { id: 'char-a', name: 'Ana', role: 'ally' },
        { id: 'char-b', name: 'Bo', role: 'rival' },
      ],
    } as unknown as CharacterBible;
    expect(resolveProtagonistCharacterId(bible, { protagonist: { name: 'Bo' } })).toBe('char-b');
  });

  it('ignores placeholder Hero names', () => {
    const bible = {
      characters: [{ id: 'char-a', name: 'Ana', role: 'ally' }],
    } as unknown as CharacterBible;
    expect(resolveProtagonistCharacterId(bible, { protagonist: { name: 'Hero' } })).toBe('char-a');
  });
});

describe('resolveCharacterIdWithBrief', () => {
  it('maps protagonist placeholders through the brief', () => {
    expect(resolveCharacterIdWithBrief('p1', characterBible, { protagonist: { name: 'Mara Voss' } })).toBe('char-mara');
    expect(resolveCharacterIdWithBrief('player', characterBible, { protagonist: { name: 'Mara Voss' } })).toBe('char-mara');
  });

  it('resolves normal ids without touching the brief', () => {
    expect(resolveCharacterIdWithBrief('char-warden', characterBible, {})).toBe('char-warden');
  });
});

describe('normalizeCharacterIds', () => {
  it('dedupes and resolves mixed id/name input', () => {
    expect(normalizeCharacterIds(['Eli Grant', 'char-eli', 'char-warden'], characterBible))
      .toEqual(['char-eli', 'char-warden']);
  });
});

describe('getCharacterIdBySpeaker', () => {
  it('matches by name or id, case-insensitively', () => {
    expect(getCharacterIdBySpeaker('eli grant', characterBible)).toEqual(['char-eli']);
    expect(getCharacterIdBySpeaker('CHAR-WARDEN', characterBible)).toEqual(['char-warden']);
    expect(getCharacterIdBySpeaker('stranger', characterBible)).toEqual([]);
  });
});

describe('getCharacterIdsInScene', () => {
  it('always includes the protagonist and finds speakers + mentions', () => {
    const scene = {
      charactersInvolved: ['char-eli'],
      beats: [
        { id: 'b1', text: 'The Warden watches from the balcony.', speaker: undefined },
        { id: 'b2', text: 'Quiet now.', speaker: 'Eli Grant' },
      ],
    } as unknown as SceneContent;
    const ids = getCharacterIdsInScene(scene, characterBible, 'char-mara');
    expect(ids).toContain('char-mara');
    expect(ids).toContain('char-eli');
    expect(ids).toContain('char-warden');
  });
});

describe('analyzeBeatCharacters', () => {
  it('puts the speaker and mentioned characters in the foreground', () => {
    const result = analyzeBeatCharacters(
      'Eli glances at the Warden.',
      'Eli Grant',
      ['char-eli', 'char-warden', 'char-mara'],
      characterBible,
      'char-mara'
    );
    expect(result.foreground).toContain('char-eli');
    expect(result.foreground).toContain('char-warden');
    expect(result.background).toContain('char-mara');
  });

  it('defaults to the protagonist when nobody is referenced', () => {
    const result = analyzeBeatCharacters('The corridor hums.', undefined, [], characterBible, 'char-mara');
    expect(result.foreground).toEqual(['char-mara']);
  });
});

describe('isEstablishingBeat', () => {
  it('detects atmospheric beats with no action', () => {
    expect(isEstablishingBeat(
      'Rain streaks the window; the city glows below.',
      undefined,
      undefined,
      { foreground: ['char-mara'], foregroundNames: ['Mara Voss'] }
    )).toBe(true);
  });

  it('rejects beats with a speaker or action verbs', () => {
    expect(isEstablishingBeat('Hello there.', 'Eli Grant', undefined, { foreground: [], foregroundNames: [] })).toBe(false);
    expect(isEstablishingBeat(
      'You run for the door as the wall collapses.',
      undefined,
      undefined,
      { foreground: ['char-mara'], foregroundNames: ['Mara Voss'] }
    )).toBe(false);
  });
});

describe('extractCanonicalAppearance', () => {
  it('extracts identity slots from free-form description phrases', () => {
    const ca = extractCanonicalAppearance(
      ['Short silver hair, sharp green eyes. Tall and wiry frame, pale skin.'],
      ['burn scar on left forearm'],
      'worn leather duster'
    );
    expect(ca?.hair).toContain('silver hair');
    expect(ca?.eyes).toContain('green eyes');
    expect(ca?.skinTone).toContain('pale skin');
    expect(ca?.distinguishingMarks).toEqual(['burn scar on left forearm']);
    expect(ca?.defaultAttire).toBe('worn leather duster');
  });

  it('returns undefined when nothing can be extracted', () => {
    expect(extractCanonicalAppearance([], undefined, undefined)).toBeUndefined();
    expect(extractCanonicalAppearance(['moves quietly through crowds'], undefined, undefined)).toBeUndefined();
  });
});

describe('personality inference', () => {
  it('maps personality keywords to posture and gesture styles', () => {
    expect(inferBasePostureFromPersonality('bold and confident leader')).toContain('upright');
    expect(inferBasePostureFromPersonality('shy archivist')).toContain('hunched');
    expect(inferBasePostureFromPersonality('')).toBe('natural, comfortable standing posture');
    expect(inferGestureStyleFromPersonality('theatrical storyteller')).toContain('sweeping');
    expect(inferGestureStyleFromPersonality('nervous and fidgety')).toContain('fidgeting');
    expect(inferGestureStyleFromPersonality('')).toBe('natural, moderate hand gestures when speaking');
  });
});
