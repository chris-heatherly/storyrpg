import { describe, it, expect } from 'vitest';
import { sliceNamedSections, resolveAuthoredContext } from './documentSectionSlice';

// A stand-in treatment whose authored content (Section 4 locations 4–6) sits
// well past the old 3000-char truncation point, so we can prove the slice is
// section-aware rather than char-bounded.
function buildDoc(): string {
  const filler = 'lorem ipsum dolor sit amet '.repeat(200); // ~5400 chars
  return [
    '## 1. Premise',
    'A kingdom at the edge of an endless night.',
    '## 3. Character Architecture',
    'Protagonist Lie: I must never be seen as weak.',
    'Supporting micro-lie: the healer believes kindness is currency.',
    '## 4. World + Location Brief',
    filler,
    'Location 4: The Drowned Archive — purpose: lore vault.',
    'Location 5: Fort Dawnwatch — purpose: siege stage.',
    'Location 6: The Ravine Pass — purpose: ambush choke.',
    '## 5. Stakes Architecture',
    'The night never ends if the song is not sung.',
  ].join('\n\n');
}

describe('sliceNamedSections', () => {
  it('returns the named section bodies including their headings, in doc order', () => {
    const doc = buildDoc();
    const result = sliceNamedSections(doc, [
      ['world + location brief', 'location brief'],
      ['character architecture'],
    ]);
    // Section 3 appears before Section 4 in the doc, so order is preserved.
    expect(result.indexOf('Character Architecture')).toBeLessThan(
      result.indexOf('World + Location Brief')
    );
    // Authored locations past the 3000-char mark are retained.
    expect(result).toContain('Location 6: The Ravine Pass');
    expect(result).toContain('Protagonist Lie');
    // Sections NOT requested are excluded.
    expect(result).not.toContain('Stakes Architecture');
  });

  it('returns empty string when no heading matches', () => {
    expect(sliceNamedSections('plain prose, no headings', [['nope']])).toBe('');
    expect(sliceNamedSections('## 1. Premise\n\nx', [['nope']])).toBe('');
  });
});

describe('resolveAuthoredContext', () => {
  it('prefers the named sections over a raw char-count cut', () => {
    const doc = buildDoc();
    const { text, truncated } = resolveAuthoredContext(doc, [
      ['world + location brief'],
    ]);
    expect(text).toContain('Location 6: The Ravine Pass');
    expect(truncated).toBe(false);
  });

  it('falls back to the full doc when no section matches', () => {
    const doc = 'no headings here, just authored prose about a place';
    const { text } = resolveAuthoredContext(doc, [['world + location brief']]);
    expect(text).toBe(doc);
  });

  it('truncates only when the resolved slice exceeds maxChars', () => {
    const big = 'x'.repeat(100);
    const { text, truncated } = resolveAuthoredContext(big, [['nope']], 50);
    expect(text.length).toBe(50);
    expect(truncated).toBe(true);
  });

  it('returns empty for undefined input', () => {
    expect(resolveAuthoredContext(undefined, [['x']])).toEqual({ text: '', truncated: false });
  });
});
