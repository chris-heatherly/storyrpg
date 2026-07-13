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
    expect(atoms.some((atom) => atom.semanticRole === 'state_change'
      && atom.acceptedPatterns[0] === 'The bookshop is owned by Stela'
      && atom.required === false
      && atom.acceptedPatterns.includes("Stela's bookshop"))).toBe(true);
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

  it('separates publication from a later discovery in the same authored line', () => {
    const atoms = compileEventRealizationAtoms({
      eventId: 'event:ep6-post-and-rose',
      sourceText: 'Kylie publishes Don\'t Tell Me What to Write and finds a black rose inside the Lipscani Apartment.',
      knownLocations: ['Lipscani Apartment'],
    });

    expect(atoms.map((atom) => atom.acceptedPatterns[0])).toEqual([
      "Kylie publishes Don't Tell Me What to Write",
      'finds a black rose inside the Lipscani Apartment',
    ]);
  });

  it('compiles friendship and group formation into fiction-first alternatives', () => {
    const atoms = compileEventRealizationAtoms({
      eventId: 'event:bond',
      sourceText: 'The three become friends and form the Dusk Club.',
    });
    expect(atoms[0].semanticRole).toBe('relationship_change');
    expect(atoms[0].acceptedPatterns).toContain('their friendship begins');
    expect(atoms[0].acceptedPatterns).toContain('I like her');
    expect(atoms[0].acceptedPatterns).toContain('she stays');
    expect(atoms[1].acceptedPatterns).toContain('Dusk Club is born');
    expect(atoms.flatMap((atom) => atom.participantIds ?? [])).not.toEqual(expect.arrayContaining(['Dusk', 'Club']));
  });

  it('compiles exploration into location and city-motion alternatives', () => {
    const atoms = compileEventRealizationAtoms({
      eventId: 'event:explore',
      sourceText: 'She explores the streets of Bucharest.',
    });
    expect(atoms[0].acceptedPatterns).toEqual(expect.arrayContaining([
      'walks through Bucharest',
      'walks the city streets',
      'wanders the city',
    ]));
  });

  it('preserves honorific aliases without inventing event or participant boundaries', () => {
    const sourceText = 'At 2am she turns the night into the first City After Dark post under the codename Dr. Nocturne.';
    const atoms = compileEventRealizationAtoms({ eventId: 'event:publish', sourceText });

    expect(atoms).toHaveLength(1);
    expect(atoms[0].acceptedPatterns[0]).toBe(sourceText.slice(0, -1));
    expect(atoms[0].participantIds).not.toEqual(expect.arrayContaining([
      'City', 'After', 'Dark', 'Dr', 'Nocturne',
    ]));
  });
});
