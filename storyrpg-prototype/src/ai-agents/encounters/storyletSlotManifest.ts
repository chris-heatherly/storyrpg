import { sanitizeEncounterIdentifier } from './encounterSlotManifest';

export interface StoryletBeatLike {
  id: string;
  text?: string;
  visualContract?: unknown;
  cost?: unknown;
}

export interface StoryletLike {
  beats?: StoryletBeatLike[];
  tone?: string;
  cost?: unknown;
}

export interface StoryletSlot {
  sceneId: string;
  scopedSceneId: string;
  outcomeName: string;
  beatId: string;
  baseIdentifier: string;
  coverageKey: string;
  /** The beat data needed for prompt building — carried directly on the slot. */
  beat: StoryletBeatLike;
  /** Storylet tone (e.g. 'triumphant', 'desperate') for mood/lighting in prompt. */
  storyletTone: string;
  /** Storylet-level cost, used for partialVictory visible cost in prompt. */
  storyletCost?: unknown;
}

export interface StoryletSlotManifest {
  sceneId: string;
  scopedSceneId: string;
  slots: StoryletSlot[];
}

export function storyletBaseIdentifier(
  scopedSceneId: string,
  outcomeName: string,
  beatId: string,
): string {
  return sanitizeEncounterIdentifier(`storylet-${scopedSceneId}-${outcomeName}-${beatId}`);
}

export function storyletRetryIdentifier(
  scopedSceneId: string,
  outcomeName: string,
  beatId: string,
): string {
  return sanitizeEncounterIdentifier(`storylet-${scopedSceneId}-${outcomeName}-${beatId}-retry`);
}

export function storyletAggressiveRetryIdentifier(
  scopedSceneId: string,
  outcomeName: string,
  beatId: string,
  pass: number,
): string {
  return sanitizeEncounterIdentifier(`storylet-${scopedSceneId}-${outcomeName}-${beatId}-retry2-${pass}`);
}

export function storyletCoverageKey(sceneId: string, outcomeName: string, beatId: string): string {
  return `storylet:${sceneId}::${outcomeName}::${beatId}`;
}

export function buildStoryletSlotManifest(
  storylets: Record<string, StoryletLike | undefined> | undefined,
  sceneId: string,
  scopedSceneId: string,
): StoryletSlotManifest {
  const slots: StoryletSlot[] = [];
  const entries = Object.entries(storylets || {});
  for (const [outcomeName, storylet] of entries) {
    if (!storylet) continue;
    const tone = storylet.tone ?? 'tense_uncertainty';
    const storyletCost = storylet.cost;
    const beats = storylet.beats || [];
    if (beats.length === 0) {
      console.warn(`[StoryletManifest] ${sceneId}/${outcomeName}: storylet exists but has 0 beats — no image slots created`);
    }
    for (const beat of beats) {
      slots.push({
        sceneId,
        scopedSceneId,
        outcomeName,
        beatId: beat.id,
        baseIdentifier: storyletBaseIdentifier(scopedSceneId, outcomeName, beat.id),
        coverageKey: storyletCoverageKey(sceneId, outcomeName, beat.id),
        beat,
        storyletTone: tone,
        storyletCost,
      });
    }
  }
  if (entries.length > 0 && slots.length === 0) {
    console.warn(
      `[StoryletManifest] ${sceneId}: storylets object has ${entries.length} outcome(s) (${entries.map(([k]) => k).join(', ')}) but produced 0 image slots — all beat arrays are empty or missing`,
    );
  }
  return { sceneId, scopedSceneId, slots };
}

export function collectMissingStoryletSlotsFromManifest(
  manifest: StoryletSlotManifest,
  sceneStoryletImages: Map<string, Map<string, string>>,
): string[] {
  const missing: string[] = [];
  for (const slot of manifest.slots) {
    const outcomeImages = sceneStoryletImages.get(slot.outcomeName);
    if (!outcomeImages?.has(slot.beatId)) {
      missing.push(slot.coverageKey);
    }
  }
  return missing;
}
