import { describe, expect, it } from 'vitest';
import { MAX_BEATS_PER_SCENE, clampTargetBeatCount } from './config';

// LEVER B3: the per-scene target beat count must never exceed the cap, so a
// single scene generation can't balloon into a pathologically large LLM call.
describe('clampTargetBeatCount (LEVER B3 beat cap)', () => {
  it('exports a sane default cap above the typical 6-8 beat target', () => {
    expect(MAX_BEATS_PER_SCENE).toBe(10);
    // Default cap must sit above the normal scene target so it never touches
    // ordinary scenes (typical standard/bottleneck target is 8).
    expect(MAX_BEATS_PER_SCENE).toBeGreaterThanOrEqual(8);
  });

  it('leaves a normal (<= cap) request unchanged', () => {
    expect(clampTargetBeatCount(6)).toBe(6);
    expect(clampTargetBeatCount(8)).toBe(8);
    // Exactly at the cap is not clamped.
    expect(clampTargetBeatCount(10)).toBe(10);
  });

  it('clamps an oversized request down to the cap', () => {
    expect(clampTargetBeatCount(12)).toBe(10);
    expect(clampTargetBeatCount(25)).toBe(10);
  });

  it('honors an explicit cap override', () => {
    // A lower override clamps harder.
    expect(clampTargetBeatCount(8, 6)).toBe(6);
    // A higher override lets a larger value through.
    expect(clampTargetBeatCount(12, 14)).toBe(12);
    // Still capped when above the override.
    expect(clampTargetBeatCount(20, 14)).toBe(14);
  });

  it('falls back to the cap for non-finite input', () => {
    expect(clampTargetBeatCount(Number.NaN)).toBe(MAX_BEATS_PER_SCENE);
    expect(clampTargetBeatCount(Number.POSITIVE_INFINITY, 12)).toBe(12);
  });
});
