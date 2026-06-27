import { describe, it, expect } from 'vitest';
import { isUnsafeCallbackProse, READER_PROSE_LEAK_PATTERNS, STRUCTURAL_SCAFFOLDING_PATTERNS } from './metaProse';

describe('isUnsafeCallbackProse', () => {
  it('rejects scene/encounter meta references', () => {
    expect(isUnsafeCallbackProse('In the caravan scene, she stops pretending.')).toBe(true);
    expect(isUnsafeCallbackProse('In the wall-breach encounter, Darian is where you placed him.')).toBe(true);
    expect(isUnsafeCallbackProse('In the next scene, she addresses him only when necessary.')).toBe(true);
    expect(isUnsafeCallbackProse('The next scene should remember this choice.')).toBe(true);
    expect(isUnsafeCallbackProse('Later pressure remembers which option the player chose.')).toBe(true);
  });

  it('rejects synthesized ledger stubs and raw flag identifiers', () => {
    expect(isUnsafeCallbackProse('Earlier choice: "Take the key." (sets accepted_keycard).')).toBe(true);
    expect(isUnsafeCallbackProse('This nudges treatment_seed_ep2_1 forward.')).toBe(true);
    expect(isUnsafeCallbackProse('(moved thorne_loyalty)')).toBe(true);
  });

  it('rejects choice-response planning language', () => {
    expect(isUnsafeCallbackProse('The next beat visibly responds to the authored choice: take the key card or leave it.')).toBe(true);
    expect(isUnsafeCallbackProse('The authored choice colors the room.')).toBe(true);
    expect(isUnsafeCallbackProse('Show immediate residue from the authored path: Mika invents a reason she warned you off.')).toBe(true);
    expect(isUnsafeCallbackProse('Keep this authored residue visible after reconvergence: Mika keeps watching the exits.')).toBe(true);
    expect(isUnsafeCallbackProse('Hook — Kylie unpacks in the Lipscani apartment; promise — reinvention; stakes — Sadie asks about vampires.')).toBe(true);
    expect(isUnsafeCallbackProse('Hook — Kylie unpacks in the Lipscani apartment.')).toBe(true);
    expect(isUnsafeCallbackProse('Cold-open prelude: Kylie unpacks.\n\nThen continue into the planned scene: Mika opens the club door.')).toBe(true);
    expect(isUnsafeCallbackProse('The response changes access, trust, information, or danger around At a Lipscani bookshop.')).toBe(true);
    expect(isUnsafeCallbackProse('Stage the pressure through visible action, reaction, object movement, distance, or dialogue around Kylie unpacking.')).toBe(true);
    expect(isUnsafeCallbackProse('The room answers through posture around Hook — Kylie unpacks in the Lipscani apartment.')).toBe(true);
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

describe('STRUCTURAL_SCAFFOLDING_PATTERNS (gen-5 third-class meta leaks)', () => {
  const matchesAny = (text: string): boolean =>
    STRUCTURAL_SCAFFOLDING_PATTERNS.some((p) => p.pattern.test(text));

  it('catches the branch-residue and forward-motion scaffolding that shipped', () => {
    expect(matchesAny('The path here still matters: Viral / The Lawyer leaves a visible residue in how everyone enters The Velvet Booth.')).toBe(true);
    expect(matchesAny('The route chosen before this moment still colors how everyone enters the room.')).toBe(true);
    expect(matchesAny('The next threshold waits ahead.')).toBe(true);
    expect(matchesAny('The path forward is set.')).toBe(true);
    expect(matchesAny('Accepting the rose quartz from her still changes how this moment lands.')).toBe(true);
  });

  it('is rejected by the callback injection filter', () => {
    expect(isUnsafeCallbackProse('It leaves a visible residue in how everyone enters.')).toBe(true);
    expect(isUnsafeCallbackProse('The path forward is set.')).toBe(true);
    expect(isUnsafeCallbackProse('Accepting the rose quartz from her still changes how this moment lands.')).toBe(true);
  });

  it('does not fire on diegetic uses of residue/threshold/path', () => {
    expect(matchesAny('Chemical residue clung to the workbench.')).toBe(false);
    expect(matchesAny('She paused at the threshold of the old house.')).toBe(false);
    expect(matchesAny('He could not see the path forward through the fog.')).toBe(false);
  });
});
