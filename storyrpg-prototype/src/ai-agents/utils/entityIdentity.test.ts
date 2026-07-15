import { describe, expect, it } from 'vitest';
import { entityTokens, entityTokensMatch, matchesEntityAuthority } from './entityIdentity';

describe('entityIdentity', () => {
  it('matches paraphrased references to the same entity (Lipscani class)', () => {
    expect(entityTokensMatch("Kylie's Lipscani apartment", "Kylie's Apartment")).toBe(true);
    expect(entityTokensMatch('the apartment in Lipscani', 'Lipscani Apartment')).toBe(true);
    // Diacritics fold; no plural stemming (identity, not similarity).
    expect(entityTokensMatch('Cișmigiu Gardens', 'cismigiu gardens')).toBe(true);
  });

  it('does not match different entities', () => {
    expect(entityTokensMatch('the catacombs', "Kylie's Apartment")).toBe(false);
    expect(entityTokensMatch('Lumina Books', 'Valescu Club')).toBe(false);
    expect(entityTokensMatch('', 'Valescu Club')).toBe(false);
  });

  it('authority matching treats empty references as nothing-to-verify', () => {
    const authority = [entityTokens("Kylie's Apartment"), entityTokens('Valescu Club')];
    expect(matchesEntityAuthority("Kylie's Lipscani apartment", authority)).toBe(true);
    expect(matchesEntityAuthority('the catacombs', authority)).toBe(false);
    expect(matchesEntityAuthority('   ', authority)).toBe(true);
  });
});
