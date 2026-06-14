import { describe, expect, it } from 'vitest';
import { findUnconsumed } from './reliabilityGuards';

describe('findUnconsumed', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns items whose key is not in the consumed set', () => {
    const consumed = new Set(['a', 'c']);
    expect(findUnconsumed(items, consumed, (i) => i.id)).toEqual([{ id: 'b' }]);
  });

  it('returns [] when every item was consumed', () => {
    expect(findUnconsumed(items, new Set(['a', 'b', 'c']), (i) => i.id)).toEqual([]);
  });

  it('skips items with no key (cannot be matched either way)', () => {
    const withNull = [{ id: 'a' }, { id: undefined }, { id: '' }];
    expect(findUnconsumed(withNull, new Set(['a']), (i) => i.id)).toEqual([]);
  });
});
