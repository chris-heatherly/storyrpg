import { describe, expect, it } from 'vitest';

import { buildEncounterPhase4JsonSchema } from './encounterSchemas';

describe('encounter schemas', () => {
  it('gives phase-4 storylets enough deterministic structured-output headroom', () => {
    const schema = buildEncounterPhase4JsonSchema();

    expect(schema.name).toBe('encounter_phase_4');
    expect(schema.maxOutputTokens).toBe(12000);
    expect((schema.schema as any).required).toEqual(['victory', 'partialVictory', 'defeat', 'escape']);
  });
});
