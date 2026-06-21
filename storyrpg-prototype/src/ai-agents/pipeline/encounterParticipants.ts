export interface EncounterProtagonistRef {
  id?: string;
  name?: string;
}

function normalizeEncounterParticipantRef(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isProtagonistEncounterRef(value: unknown, protagonist: EncounterProtagonistRef): boolean {
  const ref = normalizeEncounterParticipantRef(value);
  if (!ref) return false;
  const id = normalizeEncounterParticipantRef(protagonist.id);
  const name = normalizeEncounterParticipantRef(protagonist.name);
  const firstName = name.split(/\s+/)[0] || '';
  return ref === id || ref === name || (firstName.length > 0 && ref === firstName);
}

export function filterProtagonistEncounterRefs<T>(
  values: T[],
  protagonist: EncounterProtagonistRef,
): T[] {
  return values.filter((value) => !isProtagonistEncounterRef(value, protagonist));
}
