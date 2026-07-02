import { describe, expect, it } from 'vitest';
import {
  cleanChoiceBridgeFragment,
  ensureSentence,
  fallbackOutcomeTexts,
  fallbackTintFlag,
  isUnsafeReaderFallbackText,
  safeFallbackReaderText,
  sanitizeReaderFacingSceneName,
  stripAgentFacingFidelityText,
} from './readerTextFallbacks';

describe('ensureSentence', () => {
  it('adds terminal punctuation when missing', () => {
    expect(ensureSentence('The door opens')).toBe('The door opens.');
  });

  it('keeps existing terminal punctuation', () => {
    expect(ensureSentence('Run!')).toBe('Run!');
  });

  it('falls back on empty input', () => {
    expect(ensureSentence('')).toBe('The pressure changes shape.');
  });
});

describe('isUnsafeReaderFallbackText', () => {
  it('rejects empty text', () => {
    expect(isUnsafeReaderFallbackText('')).toBe(true);
  });

  it('rejects planning-register phrasing', () => {
    expect(isUnsafeReaderFallbackText('This serves the climax beat of the scene')).toBe(true);
    expect(isUnsafeReaderFallbackText('Forward pressure: the clock is ticking')).toBe(true);
  });

  it('rejects over-length text', () => {
    expect(isUnsafeReaderFallbackText('a'.repeat(241))).toBe(true);
  });

  it('accepts plain reader prose', () => {
    expect(isUnsafeReaderFallbackText('She closes the door quietly behind her.')).toBe(false);
  });
});

describe('safeFallbackReaderText', () => {
  it('returns cleaned primary text when safe', () => {
    expect(safeFallbackReaderText('The rain keeps falling', 'fallback')).toBe('The rain keeps falling.');
  });

  it('uses fallback when primary is unsafe', () => {
    expect(safeFallbackReaderText('', 'The lights go out')).toBe('The lights go out.');
  });

  it('uses last resort when both are unsafe', () => {
    expect(safeFallbackReaderText('', '', 'Something shifts')).toBe('Something shifts.');
  });
});

describe('fallbackTintFlag', () => {
  it('is deterministic per choice type and index', () => {
    expect(fallbackTintFlag('expression', 0)).toBe('tint:emotion');
    expect(fallbackTintFlag('expression', 1)).toBe('tint:intuition');
    expect(fallbackTintFlag('relationship', 0)).toBe('tint:teamwork');
    expect(fallbackTintFlag('strategic', 1)).toBe('tint:intuition');
    expect(fallbackTintFlag('dilemma', 0)).toBe('tint:sacrifice');
  });
});

describe('fallbackOutcomeTexts', () => {
  it('produces distinct success/partial/failure sentences', () => {
    const texts = fallbackOutcomeTexts('Step forward');
    expect(texts.success).toContain('Step forward.');
    expect(texts.partial).toContain('Step forward.');
    expect(texts.failure).toContain('Step forward.');
    expect(new Set([texts.success, texts.partial, texts.failure]).size).toBe(3);
  });
});

describe('stripAgentFacingFidelityText', () => {
  it('drops pressure-prefixed planning lines', () => {
    const result = stripAgentFacingFidelityText(
      'Pressure: escalate the standoff\n\nShe steps into the light.',
      'fallback text'
    );
    expect(result).toBe('She steps into the light.');
  });

  it('falls back when everything is agent-facing', () => {
    expect(stripAgentFacingFidelityText('Forward pressure: keep moving', 'The scene shifts')).toBe('The scene shifts.');
  });
});

describe('sanitizeReaderFacingSceneName', () => {
  it('strips structural annotations', () => {
    expect(sanitizeReaderFacingSceneName('The Vault (ENCOUNTER: heist)')).toBe('The Vault');
    expect(sanitizeReaderFacingSceneName('Rooftop - Episode Climax showdown')).toBe('Rooftop');
  });

  it('returns fallback for empty names', () => {
    expect(sanitizeReaderFacingSceneName(undefined)).toBe('the next scene');
  });
});

describe('cleanChoiceBridgeFragment', () => {
  it('removes generic bridge scaffolding', () => {
    expect(cleanChoiceBridgeFragment('You slip outside. The decision carries you into the dark.')).toBe('You slip outside.');
  });
});
