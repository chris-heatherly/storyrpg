import { describe, expect, it } from 'vitest';
import { atomizeTreatmentText } from './treatmentEventAtomizer';

describe('treatmentEventAtomizer', () => {
  it('returns no atoms for missing or blank text instead of crashing', () => {
    // Live-run regression: a storyCircleBeatContract with neither eventAtoms
    // nor sourceText fed undefined into the atomizer and aborted the episode
    // blueprint ("Cannot read properties of undefined (reading 'replace')").
    expect(atomizeTreatmentText({
      episodeNumber: 1,
      text: undefined as unknown as string,
    })).toEqual([]);
    expect(atomizeTreatmentText({ episodeNumber: 1, text: '   ' })).toEqual([]);
  });

  it('separates compound playable treatment text into ordered event atoms', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 1,
      text: 'Avery arrives at North Station at dusk, then meets Mira inside the archive, and then the alarm goes public afterward.',
    });

    expect(atoms.map((atom) => atom.isPlayableEvent)).toEqual([true, true, true]);
    expect(atoms.map((atom) => atom.order)).toEqual([1, 2, 3]);
    expect(atoms.map((atom) => atom.eventType)).toEqual(['arrival', 'meeting', 'aftermath']);
    expect(new Set(atoms.map((atom) => atom.chronologyKey)).size).toBe(3);
  });

  it('marks theme, Story Circle, pressure, and future payoff language as non-playable context', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 2,
      text: [
        'Theme: belonging requires honest risk.',
        'Story Circle need: the protagonist must stop hiding.',
        'This scene serves the find pressure and sets up a future payoff.',
        'Major pressure: Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?',
        'Likely consequence: The blog, Dusk Club, Victor staged courtship, Stela protection, Mika placement, Radu first sighting, and Kylie first authored act all become live season anchors.',
      ].join(' '),
      sourceSection: 'Story Circle',
    });

    expect(atoms).toHaveLength(5);
    expect(atoms.every((atom) => !atom.isPlayableEvent)).toBe(true);
    expect(atoms.every((atom) => atom.realizationMode === 'context_only')).toBe(true);
  });

  it('treats high-level descriptions as playable event text instead of planning-only context', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 1,
      text: [
        'High-level description: The protagonist arrives in a new city with one suitcase, then meets a small club at a rooftop bar.',
        'Walking home through the park, the protagonist is attacked and rescued by a stranger.',
        'At 4am the protagonist writes the first public blog post.',
      ].join(' '),
      sourceSection: 'Episode 1',
    });

    expect(atoms.map((atom) => atom.isPlayableEvent)).toEqual([true, true, true, true]);
    expect(atoms.map((atom) => atom.eventType)).toEqual(['arrival', 'meeting', 'conflict', 'aftermath']);
    expect(atoms[0].eventText).not.toMatch(/high-level description/i);
    expect(atoms[2].eventCues).toContain('threatEncounter');
    expect(atoms[2]).toMatchObject({
      sceneKindHint: 'encounter',
      ownershipIntent: 'must_stage',
    });
    expect(atoms[2].dramaticPriority).toBeGreaterThan(atoms[0].dramaticPriority ?? 0);
  });

  it('separates support pressure from ledger-only context without making either playable', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 1,
      text: [
        'Theme: belonging requires honest risk.',
        'The protagonist needs to stop observing from a distance.',
        'Future payoff: the invitation is confirmed in a later episode.',
      ].join(' '),
    });

    expect(atoms.map((atom) => atom.isPlayableEvent)).toEqual([false, false, false]);
    expect(atoms.map((atom) => atom.ownershipIntent)).toEqual(['may_support', 'may_support', 'ledger_only']);
  });
});
