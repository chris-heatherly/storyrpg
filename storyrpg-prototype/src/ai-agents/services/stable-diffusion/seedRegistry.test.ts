import { describe, expect, it } from 'vitest';
import { SeedRegistry } from './seedRegistry';

describe('SeedRegistry', () => {
  it('returns the same seed for the same key across calls', () => {
    const r = new SeedRegistry('test');
    const a = r.get({ scope: 'character', characterId: 'hero' });
    const b = r.get({ scope: 'character', characterId: 'hero' });
    expect(a).toBe(b);
  });

  it('returns different seeds for different scopes', () => {
    const r = new SeedRegistry('test');
    const char = r.get({ scope: 'character', characterId: 'hero' });
    const scene = r.get({ scope: 'scene', sceneId: 'hero' });
    expect(char).not.toBe(scene);
  });

  it('produces stable seeds across registry instances with the same namespace', () => {
    const r1 = new SeedRegistry('story-xyz');
    const r2 = new SeedRegistry('story-xyz');
    const k = { scope: 'characterInScene' as const, characterId: 'elena', sceneId: 'prologue' };
    expect(r1.get(k)).toBe(r2.get(k));
  });

  it('produces different seeds when namespaces differ', () => {
    const r1 = new SeedRegistry('story-a');
    const r2 = new SeedRegistry('story-b');
    const k = { scope: 'character' as const, characterId: 'elena' };
    expect(r1.get(k)).not.toBe(r2.get(k));
  });

  it('allows overriding via set()', () => {
    const r = new SeedRegistry('test');
    r.set({ scope: 'anchor', raw: 'pinned' }, 42);
    expect(r.get({ scope: 'anchor', raw: 'pinned' })).toBe(42);
  });

  it('returns positive 32-bit unsigned integers', () => {
    const r = new SeedRegistry('test');
    for (const id of ['a', 'b', 'c', 'hero-long-id-xyz']) {
      const seed = r.get({ scope: 'character', characterId: id });
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });
});
