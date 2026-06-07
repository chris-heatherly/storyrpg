import { describe, it, expect } from 'vitest';
import { isUnsafeCallbackProse, READER_PROSE_LEAK_PATTERNS } from './metaProse';

describe('isUnsafeCallbackProse', () => {
  it('rejects scene/encounter meta references', () => {
    expect(isUnsafeCallbackProse('In the caravan scene, she stops pretending.')).toBe(true);
    expect(isUnsafeCallbackProse('In the wall-breach encounter, Darian is where you placed him.')).toBe(true);
    expect(isUnsafeCallbackProse('In the next scene, she addresses him only when necessary.')).toBe(true);
    expect(isUnsafeCallbackProse('The next scene should remember this choice.')).toBe(true);
  });

  it('rejects synthesized ledger stubs and raw flag identifiers', () => {
    expect(isUnsafeCallbackProse('Earlier choice: "Take the key." (sets accepted_keycard).')).toBe(true);
    expect(isUnsafeCallbackProse('This nudges treatment_seed_ep2_1 forward.')).toBe(true);
    expect(isUnsafeCallbackProse('(moved thorne_loyalty)')).toBe(true);
  });

  it('treats empty/undefined as unsafe', () => {
    expect(isUnsafeCallbackProse(undefined)).toBe(true);
    expect(isUnsafeCallbackProse('')).toBe(true);
  });

  it('accepts clean in-fiction recaps', () => {
    expect(isUnsafeCallbackProse('The valley still remembers your mercy.')).toBe(false);
    expect(isUnsafeCallbackProse('The warmth of that shared cup stays with him.')).toBe(false);
    expect(isUnsafeCallbackProse('You chose pressure over comfort.')).toBe(false);
  });

  it('does not fire on mid-sentence diegetic uses of "scene"', () => {
    // Anchored to sentence start, so the high-confidence validator set stays quiet here.
    const sceneRef = READER_PROSE_LEAK_PATTERNS[0].pattern;
    expect(sceneRef.test('She lingered over the final scene of the opera.')).toBe(false);
  });
});
