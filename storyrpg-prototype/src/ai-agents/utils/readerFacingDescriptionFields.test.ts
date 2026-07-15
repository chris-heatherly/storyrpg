import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_DESCRIPTION_FIELD_PATH,
  enumerateEncounterDescriptionFields,
  resolveEncounterDescriptionField,
} from './readerFacingDescriptionFields';

const encounter = () => ({
  description: 'Top-level description.',
  phases: [{ description: 'Phase zero description.', beats: [] }],
  storylets: {
    victory: { description: 'Victory aftermath description.', beats: [] },
    partialVictory: { beats: [] }, // no description — must not enumerate
  },
}) as unknown as Record<string, unknown>;

describe('readerFacingDescriptionFields', () => {
  it('enumerates every present description surface with validator-compatible paths', () => {
    const fields = enumerateEncounterDescriptionFields(encounter());
    const paths = fields.map((field) => field.path);
    expect(paths).toEqual([
      'encounter.description',
      'encounter.phases[0].description',
      'encounter.storylets.victory.description',
    ]);
    // Parity: every enumerated path is resolvable and matches the grammar the
    // final-contract repairer filters on — the enumerator and resolver cannot
    // drift apart.
    for (const field of fields) {
      expect(ENCOUNTER_DESCRIPTION_FIELD_PATH.test(field.path)).toBe(true);
    }
  });

  it('resolve returns a live get/set pair for a reported fieldPath', () => {
    const enc = encounter();
    const field = resolveEncounterDescriptionField(enc, 'encounter.phases[0].description');
    expect(field?.get()).toBe('Phase zero description.');
    field!.set('Re-authored phase description.');
    expect((enc.phases as Array<{ description: string }>)[0].description).toBe('Re-authored phase description.');
    expect(resolveEncounterDescriptionField(enc, 'encounter.designNotes')).toBeUndefined();
  });
});
