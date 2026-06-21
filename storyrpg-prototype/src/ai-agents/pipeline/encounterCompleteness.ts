import type { EncounterStructure } from '../agents/EncounterArchitect';

function hasNarrativeText(value: unknown): boolean {
  return typeof value === 'string' && value.replace(/\s+/g, ' ').trim().length >= 20;
}

function encounterBeatHasNarrative(beat: EncounterStructure['beats'][number] | undefined): boolean {
  if (!beat) return false;
  if (hasNarrativeText(beat.setupText) || hasNarrativeText(beat.description) || hasNarrativeText(beat.escalationText)) {
    return true;
  }
  return (beat.choices ?? []).some((choice) =>
    hasNarrativeText(choice.text) ||
    hasNarrativeText(choice.outcomes?.success?.narrativeText) ||
    hasNarrativeText(choice.outcomes?.success?.nextSituation?.setupText) ||
    hasNarrativeText(choice.outcomes?.complicated?.narrativeText) ||
    hasNarrativeText(choice.outcomes?.complicated?.nextSituation?.setupText) ||
    hasNarrativeText(choice.outcomes?.failure?.narrativeText) ||
    hasNarrativeText(choice.outcomes?.failure?.nextSituation?.setupText)
  );
}

export function isEncounterNarrativelyHollow(encounter: Pick<EncounterStructure, 'beats'> | undefined | null): boolean {
  const beats = encounter?.beats;
  return !Array.isArray(beats) || beats.length === 0 || !beats.some(encounterBeatHasNarrative);
}
