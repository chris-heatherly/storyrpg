import { describe, expect, it } from 'vitest';
import { literalPhraseMatch } from './literalPhraseMatch';

describe('literalPhraseMatch (r115: token-boundary, not substring)', () => {
  it('r115: "The Mountain" (codename) never matches inside "the mountains" (common noun)', () => {
    expect(literalPhraseMatch('The Mountain', 'Dressed for the mountains, not the city.')).toBe(false);
    expect(literalPhraseMatch('The Mountain', 'The path grew mountainous near the pass.')).toBe(false);
  });

  it('matches the exact phrase as whole tokens, case/diacritic/punctuation-insensitive', () => {
    expect(literalPhraseMatch('The Mountain', 'They call him The Mountain.')).toBe(true);
    expect(literalPhraseMatch('The Mountain', 'they call him the mountain now')).toBe(true);
    expect(literalPhraseMatch('Dating After Dusk', 'You give the blog a name: Dating After Dusk, and him?')).toBe(true);
    expect(literalPhraseMatch('café', 'She waits at the CAFE on the corner.')).toBe(true);
  });

  it('never matches a partial-word overlap in either direction', () => {
    expect(literalPhraseMatch('cat', 'The catalog is on the table.')).toBe(false);
    expect(literalPhraseMatch('mountains', 'He calls himself the mountain.')).toBe(false);
  });

  it('requires the pattern tokens contiguous and in order', () => {
    expect(literalPhraseMatch('Dating After Dusk', 'Dating well after the Dusk market closed.')).toBe(false);
    expect(literalPhraseMatch('Dating After Dusk', 'Dusk After Dating')).toBe(false);
  });

  it('handles empty/degenerate inputs safely', () => {
    expect(literalPhraseMatch('', 'anything')).toBe(false);
    expect(literalPhraseMatch('The Mountain', '')).toBe(false);
    expect(literalPhraseMatch('a very long pattern nobody wrote', 'short text')).toBe(false);
  });
});
