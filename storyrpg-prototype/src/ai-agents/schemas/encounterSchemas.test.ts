import { describe, expect, it } from 'vitest';

import {
  buildEncounterPhase4JsonSchema,
  buildEncounterStoryletDraftJsonSchema,
  buildEncounterStoryletJsonSchema,
} from './encounterSchemas';

describe('encounter schemas', () => {
  it('gives phase-4 storylets enough deterministic structured-output headroom', () => {
    const schema = buildEncounterPhase4JsonSchema();

    expect(schema.name).toBe('encounter_phase_4');
    expect(schema.maxOutputTokens).toBe(16384);
    expect((schema.schema as any).required).toEqual(['victory', 'partialVictory', 'defeat', 'escape']);
  });

  it('bounds phase-4 storylet prose so Gemini cannot expand compact beats indefinitely', () => {
    const schema = buildEncounterStoryletJsonSchema('partialVictory');
    const storylet = schema.schema as any;

    expect(storylet.properties.beats.items.properties.text.maxLength).toBe(420);
    expect(storylet.properties.narrativeFunction.maxLength).toBe(260);
    expect(storylet.properties.cost.properties.visibleComplication.maxLength).toBe(260);
  });

  it('uses a lean phase-4 draft schema for live per-storylet calls', () => {
    const schema = buildEncounterStoryletDraftJsonSchema('partialVictory');
    const draft = schema.schema as any;

    expect(schema.name).toBe('encounter_phase_4_partialVictory_draft');
    expect(schema.maxOutputTokens).toBe(4096);
    expect(draft.required).toEqual(['beats', 'cost']);
    expect(draft.properties.beats.items.required).toEqual(['text']);
    expect(draft.properties.beats.items.properties.text.maxLength).toBe(420);
    expect(draft.properties).not.toHaveProperty('id');
    expect(draft.properties).not.toHaveProperty('nextSceneId');
  });
});
