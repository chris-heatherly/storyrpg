/**
 * Reader-facing encounter DESCRIPTION surfaces — one enumerator (Systemic
 * Guards W2.3). The producer-boundary sanitation pass and the final-contract
 * metadata repairer hand-rolled the same field walker on the same day; the
 * final validator keeps a third view. Collectors that answer "where does
 * reader text live" drift independently and every drift is a future
 * blind-spot kill (walkHome cue ×3, MAJOR_EVIDENCE_RE ×3, route-text
 * collectors ×2). One module, every consumer.
 *
 * Standing rule: one collector per surface — when you touch a private copy,
 * replace it with this one.
 */

export interface DescriptionFieldRef {
  /** Exact validator-compatible path relative to the scene (`encounter.…`). */
  path: string;
  get: () => string | undefined;
  set: (value: string) => void;
}

/** Field-path grammar accepted by {@link resolveEncounterDescriptionField}. */
export const ENCOUNTER_DESCRIPTION_FIELD_PATH =
  /^encounter\.(description|phases\[\d+\]\.description|storylets\.[A-Za-z0-9_-]+\.description)$/;

/** Enumerate every reader-facing description field present on an encounter. */
export function enumerateEncounterDescriptionFields(
  encounter: Record<string, unknown> | undefined,
): DescriptionFieldRef[] {
  if (!encounter) return [];
  const fields: DescriptionFieldRef[] = [];
  if (typeof encounter.description === 'string') {
    fields.push({
      path: 'encounter.description',
      get: () => encounter.description as string,
      set: (value) => { encounter.description = value; },
    });
  }
  const phases = (encounter.phases as Array<Record<string, unknown>> | undefined) ?? [];
  phases.forEach((phase, index) => {
    if (phase && typeof phase.description === 'string') {
      fields.push({
        path: `encounter.phases[${index}].description`,
        get: () => phase.description as string,
        set: (value) => { phase.description = value; },
      });
    }
  });
  const storylets = (encounter.storylets as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const [key, storylet] of Object.entries(storylets)) {
    if (storylet && typeof storylet.description === 'string') {
      fields.push({
        path: `encounter.storylets.${key}.description`,
        get: () => storylet.description as string,
        set: (value) => { storylet.description = value; },
      });
    }
  }
  return fields;
}

/** Resolve one validator-reported fieldPath to its live get/set pair. */
export function resolveEncounterDescriptionField(
  encounter: Record<string, unknown> | undefined,
  fieldPath: string,
): DescriptionFieldRef | undefined {
  if (!encounter || !ENCOUNTER_DESCRIPTION_FIELD_PATH.test(fieldPath)) return undefined;
  return enumerateEncounterDescriptionFields(encounter).find((field) => field.path === fieldPath);
}
