import { describe, expect, it } from 'vitest';
import { compileEventRealizationAtoms, stagedLocationsForAtoms } from './eventAtomCompiler';

describe('compileEventRealizationAtoms', () => {
  it('separates staged and referenced locations in a compound introduction event', () => {
    const atoms = compileEventRealizationAtoms({
      eventId: 'event:ep1-u3',
      sourceText: 'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.',
      knownLocations: ['Lumina Books', 'Valescu Club'],
    });

    expect(atoms.length).toBeGreaterThanOrEqual(3);
    expect(stagedLocationsForAtoms(atoms)).toEqual(['Lumina Books']);
    expect(atoms.some((atom) => atom.referencedLocations?.includes('Valescu Club'))).toBe(true);
    expect(atoms.some((atom) => atom.semanticRole === 'relationship_change')).toBe(true);
    expect(atoms.some((atom) => atom.semanticRole === 'introduction')).toBe(true);
    expect(atoms.some((atom) => atom.semanticRole === 'state_change' && atom.acceptedPatterns[0] === 'The bookshop is owned by Stela')).toBe(true);
    expect(atoms.some((atom) => atom.acceptedPatterns.includes('Stela welcomes her'))).toBe(true);
    expect(atoms.some((atom) => atom.acceptedPatterns.includes('Stela introduces Kylie to Mika'))).toBe(true);
    expect(atoms.every((atom) => atom.acceptedPatterns[0].length < 150)).toBe(true);
  });

  it('is deterministic and preserves atom prerequisite order', () => {
    const input = { eventId: 'event:test', sourceText: 'Ari enters the archive and discovers the missing ledger.' };
    const first = compileEventRealizationAtoms(input);
    const second = compileEventRealizationAtoms(input);
    expect(first).toEqual(second);
    expect(first[0]?.prerequisiteAtomIds).toEqual([]);
    expect(first[1]?.prerequisiteAtomIds).toEqual(['event:test:atom:1']);
  });
});
