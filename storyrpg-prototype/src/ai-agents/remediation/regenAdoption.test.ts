import { describe, expect, it } from 'vitest';
import { issueFingerprint, shouldAdoptRegenAttempt } from './regenAdoption';

describe('issueFingerprint', () => {
  it('folds case, whitespace, and numbers so re-scored duplicates match', () => {
    expect(issueFingerprint('Voice issue (Mika): too   formal in beat 3'))
      .toBe(issueFingerprint('voice issue (mika): TOO FORMAL in beat 7'));
  });

  it('keeps genuinely different issues distinct', () => {
    expect(issueFingerprint('POV clarity issue: opens on Mika'))
      .not.toBe(issueFingerprint('Continuity: the key card was already handed over'));
  });
});

describe('shouldAdoptRegenAttempt', () => {
  const pov = 'POV clarity issue: first beat opens on Mika, not the player';
  const voice = 'Voice issue (Mika): reads as customer-service script';

  it('adopts when every triggering issue cleared', () => {
    expect(shouldAdoptRegenAttempt([pov, voice], [])).toBe(true);
    expect(shouldAdoptRegenAttempt([pov], ['Continuity: some brand-new finding'])).toBe(true);
  });

  it('rejects when a triggering issue survives (even re-worded only by numbers/case)', () => {
    expect(shouldAdoptRegenAttempt([pov, voice], [voice.toUpperCase()])).toBe(false);
  });

  it('rejects a regen that was triggered by nothing (caller keeps its clean-validation fast path)', () => {
    expect(shouldAdoptRegenAttempt([], ['anything'])).toBe(false);
    expect(shouldAdoptRegenAttempt([], [])).toBe(false);
  });
});
