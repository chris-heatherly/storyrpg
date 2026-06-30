import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCharacterProfile, resolveNpcPronouns } from './characterProfileResolver';
import type { CharacterProfile } from '../agents/CharacterDesigner';

const mk = (id: string, name: string, pronouns: CharacterProfile['pronouns']): CharacterProfile =>
  ({ id, name, pronouns } as CharacterProfile);

const bible: CharacterProfile[] = [
  mk('char-mika-drgan', 'Mika Drăgan', 'she/her'),
  mk('char-victor-vlcescu', 'Victor Vâlcescu', 'he/him'),
  mk('char-kylie-marinescu', 'Kylie Marinescu', 'she/her'),
];

afterEach(() => vi.restoreAllMocks());

describe('resolveCharacterProfile', () => {
  it('matches on exact canonical id', () => {
    expect(resolveCharacterProfile(bible, 'char-mika-drgan')?.name).toBe('Mika Drăgan');
  });

  it('matches a short treatment id against the first name (the Gen-4 Mika case)', () => {
    // Encounter rosters carry short ids like "mika"; the bible is keyed "char-mika-drgan".
    expect(resolveCharacterProfile(bible, 'mika')?.id).toBe('char-mika-drgan');
    expect(resolveCharacterProfile(bible, 'kylie')?.id).toBe('char-kylie-marinescu');
  });

  it('matches on full name regardless of case/diacritics-free punctuation', () => {
    expect(resolveCharacterProfile(bible, 'Mika Drăgan')?.id).toBe('char-mika-drgan');
  });

  it('returns undefined for an unknown token or empty inputs', () => {
    expect(resolveCharacterProfile(bible, 'nobody')).toBeUndefined();
    expect(resolveCharacterProfile(bible, undefined)).toBeUndefined();
    expect(resolveCharacterProfile([], 'mika')).toBeUndefined();
  });
});

describe('resolveNpcPronouns', () => {
  it('returns the resolved pronouns for a short id instead of a gendered default', () => {
    // Regression: previously fell back to he/him, misgendering Mika.
    expect(resolveNpcPronouns(bible, 'mika', { warn: false })).toBe('she/her');
  });

  it('defaults to they/them (not he/him) and warns when resolution fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveNpcPronouns(bible, 'nobody')).toBe('they/them');
    expect(warn).toHaveBeenCalledOnce();
  });
});
