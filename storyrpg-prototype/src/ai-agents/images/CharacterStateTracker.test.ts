import { describe, expect, it } from 'vitest';
import type { CharacterBible } from '../agents/CharacterDesigner';
import { CharacterStateTracker } from './CharacterStateTracker';

const bible = {
  characters: [
    {
      id: 'mara',
      name: 'Mara',
      typicalAttire: 'weatherproof grey cloak',
    },
    {
      id: 'vale',
      name: 'Vale',
      typicalAttire: 'black duelist coat',
    },
  ],
} as CharacterBible;

describe('CharacterStateTracker', () => {
  it('seeds visible characters with canonical wardrobe', () => {
    const tracker = new CharacterStateTracker(bible);

    const state = tracker.updateForBeat(
      { text: 'Mara waits at the gate.' },
      ['Mara'],
    );

    expect(state.Mara.wardrobe).toBe('weatherproof grey cloak');
  });

  it('replaces wardrobe for strong replacement language and layers outerwear for add-on language', () => {
    const tracker = new CharacterStateTracker(bible);

    let state = tracker.updateForBeat(
      { text: 'Mara changes into a red festival dress.' },
      ['Mara'],
    );
    expect(state.Mara.wardrobe).toBe('red festival dress');

    state = tracker.updateForBeat(
      { text: 'Mara pulls on a soot-black hood.' },
      ['Mara'],
    );
    expect(state.Mara.wardrobe).toBe('red festival dress, with soot-black hood');
  });

  it('accumulates injuries and only removes them on clear recovery language', () => {
    const tracker = new CharacterStateTracker(bible);

    let state = tracker.updateForBeat(
      { text: 'Mara is bleeding from her left arm.' },
      ['Mara'],
    );
    expect(state.Mara.injuries).toContain('bleeding from left arm');

    state = tracker.updateForBeat(
      { text: 'Mara is cut across the cheek.' },
      ['Mara'],
    );
    expect(state.Mara.injuries).toEqual(
      expect.arrayContaining(['bleeding from left arm', 'cut across cheek']),
    );

    state = tracker.updateForBeat(
      { text: 'Mara recovers from the cheek cut.' },
      ['Mara'],
    );
    expect(state.Mara.injuries).toContain('bleeding from left arm');
    expect(state.Mara.injuries?.some(injury => injury.includes('cheek'))).toBe(false);
  });

  it('keeps bandages as visible injury state', () => {
    const tracker = new CharacterStateTracker(bible);

    const state = tracker.updateForBeat(
      { text: 'Mara bandaged her left hand.' },
      ['Mara'],
    );

    expect(state.Mara.injuries).toContain('bandaged left hand');
  });

  it('tracks prop pickup and drop with dedupe', () => {
    const tracker = new CharacterStateTracker(bible);

    let state = tracker.updateForBeat(
      { text: 'Mara grabs the brass lantern.' },
      ['Mara'],
    );
    state = tracker.updateForBeat(
      { text: 'Mara grabs a brass lantern.' },
      ['Mara'],
    );
    expect(state.Mara.heldProps).toEqual(['brass lantern']);

    state = tracker.updateForBeat(
      { text: 'Mara drops the lantern.' },
      ['Mara'],
    );
    expect(state.Mara.heldProps).toBeUndefined();
  });

  it('skips ambiguous multi-character sentences', () => {
    const tracker = new CharacterStateTracker(bible);

    const state = tracker.updateForBeat(
      { text: 'Mara and Vale are wounded in the blast.' },
      ['Mara', 'Vale'],
    );

    expect(state.Mara.injuries).toBeUndefined();
    expect(state.Vale.injuries).toBeUndefined();
    expect(tracker.getDiagnostics().ambiguous).toBe(1);
  });

  it('excludes off-screen characters from the returned snapshot', () => {
    const tracker = new CharacterStateTracker(bible);

    const state = tracker.updateForBeat(
      { text: 'Mara is rain-soaked. Vale waits elsewhere.' },
      ['Vale'],
    );

    expect(state.Mara).toBeUndefined();
    expect(state.Vale.wardrobe).toBe('black duelist coat');
  });

  it('resets scene state to canonical wardrobe', () => {
    const tracker = new CharacterStateTracker(bible);
    tracker.updateForBeat(
      { text: 'Mara changes into a red festival dress. Mara grabs the brass lantern.' },
      ['Mara'],
    );

    tracker.resetToCanonical();
    const state = tracker.updateForBeat(
      { text: 'Mara waits at the gate.' },
      ['Mara'],
    );

    expect(state.Mara.wardrobe).toBe('weatherproof grey cloak');
    expect(state.Mara.heldProps).toBeUndefined();
  });

  it('carries state forward when a prior beat is processed without generating a prompt', () => {
    const tracker = new CharacterStateTracker(bible);

    tracker.updateForBeat(
      { text: 'Mara is bleeding from her left arm.' },
      ['Mara'],
    );
    const nextBeatState = tracker.updateForBeat(
      { text: 'Mara reaches the tower door.' },
      ['Mara'],
    );

    expect(nextBeatState.Mara.injuries).toContain('bleeding from left arm');
  });
});
