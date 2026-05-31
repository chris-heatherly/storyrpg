import { describe, it, expect } from 'vitest';
import type { Consequence } from '../types';
import { normalizeConsequenceShape } from './consequenceNormalize';

describe('normalizeConsequenceShape', () => {
  it('maps `delta` to `change` for changeScore when `change` is absent', () => {
    const raw = { type: 'changeScore', score: 'aethavyr_connection', delta: 15 } as unknown as Consequence;
    const normalized = normalizeConsequenceShape(raw) as Consequence & { change: number; delta?: number };
    expect(normalized.change).toBe(15);
    // original `delta` is preserved; only `change` is added
    expect((normalized as { score: string }).score).toBe('aethavyr_connection');
  });

  it('maps `delta` to `change` for relationship consequences', () => {
    const raw = { type: 'relationship', npcId: 'char-lysandra-brightwell', dimension: 'trust', delta: 10 } as unknown as Consequence;
    const normalized = normalizeConsequenceShape(raw) as Consequence & { change: number };
    expect(normalized.change).toBe(10);
  });

  it('remaps `adjustRelationship` type to `relationship` and `delta` to `change`', () => {
    const raw = { type: 'adjustRelationship', npcId: 'char-lysandra-brightwell', dimension: 'affection', delta: 20 } as unknown as Consequence;
    const normalized = normalizeConsequenceShape(raw) as Consequence & { change: number };
    expect(normalized.type).toBe('relationship');
    expect(normalized.change).toBe(20);
  });

  it('remaps `changeRelationship` type to `relationship`', () => {
    const raw = { type: 'changeRelationship', npcId: 'npc-1', dimension: 'respect', change: 5 } as unknown as Consequence;
    const normalized = normalizeConsequenceShape(raw);
    expect(normalized.type).toBe('relationship');
  });

  it('prefers an existing `change` over `delta`', () => {
    const raw = { type: 'changeScore', score: 's', change: 3, delta: 99 } as unknown as Consequence;
    const normalized = normalizeConsequenceShape(raw) as Consequence & { change: number };
    expect(normalized.change).toBe(3);
  });

  it('returns the original reference when no normalization is needed', () => {
    const raw = { type: 'changeScore', score: 's', change: 4 } as unknown as Consequence;
    expect(normalizeConsequenceShape(raw)).toBe(raw);
  });

  it('does not invent a `change` when neither `change` nor `delta` is numeric', () => {
    const raw = { type: 'setFlag', flag: 'f', value: true } as Consequence;
    const normalized = normalizeConsequenceShape(raw) as Consequence & { change?: number };
    expect(normalized.change).toBeUndefined();
    expect(normalized).toBe(raw);
  });
});
