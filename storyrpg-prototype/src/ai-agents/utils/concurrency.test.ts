import { describe, expect, it } from 'vitest';

import { mapOrderedWithConcurrency } from './concurrency';

describe('mapOrderedWithConcurrency', () => {
  it('preserves input order even when later items resolve first', async () => {
    const result = await mapOrderedWithConcurrency([30, 10, 20], 3, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(['0:30', '1:10', '2:20']);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapOrderedWithConcurrency(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('runs every item exactly once and passes the index', async () => {
    const seen: number[] = [];
    const result = await mapOrderedWithConcurrency([10, 11, 12, 13], 2, async (item, index) => {
      seen.push(index);
      return item * 2;
    });
    expect(result).toEqual([20, 22, 24, 26]);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('rejects on the first failing call (fail-fast)', async () => {
    await expect(
      mapOrderedWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('handles an empty input list', async () => {
    expect(await mapOrderedWithConcurrency([], 3, async (x) => x)).toEqual([]);
  });
});
