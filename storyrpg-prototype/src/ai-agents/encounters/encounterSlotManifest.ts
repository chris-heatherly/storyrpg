/**
 * Single source of truth for encounter image slot keys, identifiers, and tree depth.
 * Used for counting, completeness verification, and resume — must match FullStoryPipeline wiring.
 */

import { getEncounterBeats, type EncounterLike } from '../utils/encounterImageCoverage';

/** Controlled branching cap: enough for tactical payoff, low enough to prevent image explosions. */
export const ENCOUNTER_TREE_MAX_DEPTH = 3;

/** Matches ImageGenerationService.generateImage identifier sanitization (stable filenames). */
export function sanitizeEncounterIdentifier(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
}

function encodeEncounterPathSegment(value: string): string {
  return value
    .replace(/::/g, '-path-')
    .replace(/[^a-zA-Z0-9_\-./]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export type EncounterSlotKind = 'setup' | 'outcome' | 'situation';

export interface EncounterImageSlot {
  kind: EncounterSlotKind;
  sceneId: string;
  scopedSceneId: string;
  beatId: string;
  /** For outcome/situation; empty for setup */
  choiceMapKey: string;
  tier?: 'success' | 'complicated' | 'failure';
  /** Key used in setupImages Map for nested situation frames */
  situationKey?: string;
  /** Depth in the nextSituation recursion (0 = top-level choices under the beat) */
  treeDepth: number;
  /** Primary identifier passed to ImageGenerationService (retries append -textfixN or -retry) */
  baseIdentifier: string;
}

export interface EncounterSlotManifest {
  sceneId: string;
  scopedSceneId: string;
  maxTreeDepth: number;
  /** Full ordered list: setup per beat, then DFS tree slots for that beat */
  slots: EncounterImageSlot[];
  /** Subtrees skipped because depth exceeded ENCOUNTER_TREE_MAX_DEPTH */
  truncatedPaths: string[];
}

export function encounterSetupIdentifier(scopedSceneId: string, beatId: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-${beatId}-setup`);
}

export function encounterSetupFallbackIdentifier(scopedSceneId: string, beatId: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-${beatId}-setup-fallback`);
}

export function encounterOutcomeIdentifier(
  scopedSceneId: string,
  beatId: string,
  choiceMapKey: string,
  tier: string
): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-${beatId}-${encodeEncounterPathSegment(choiceMapKey)}-${tier}`);
}

export function encounterSituationKey(beatId: string, choiceMapKey: string, tier: string): string {
  return `${beatId}::${choiceMapKey}::${tier}::situation`;
}

export function legacyEncounterSituationKey(choiceMapKey: string, tier: string): string {
  return `${choiceMapKey}::${tier}::situation`;
}

export function encounterSituationIdentifier(scopedSceneId: string, beatId: string, choiceMapKey: string, tier: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-situation-${beatId}-${encodeEncounterPathSegment(choiceMapKey)}-${tier}`);
}

export function legacyEncounterSituationIdentifier(scopedSceneId: string, choiceMapKey: string, tier: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-situation-${encodeEncounterPathSegment(choiceMapKey)}-${tier}`);
}

export function encounterOutcomeRetryIdentifier(scopedSceneId: string, beatId: string, choiceMapKey: string, tier: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-${beatId}-${encodeEncounterPathSegment(choiceMapKey)}-${tier}-retry`);
}

export function encounterSituationRetryIdentifier(scopedSceneId: string, beatId: string, choiceMapKey: string, tier: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-situation-${beatId}-${encodeEncounterPathSegment(choiceMapKey)}-${tier}-retry`);
}

export function legacyEncounterSituationRetryIdentifier(scopedSceneId: string, choiceMapKey: string, tier: string): string {
  return sanitizeEncounterIdentifier(`encounter-${scopedSceneId}-situation-${encodeEncounterPathSegment(choiceMapKey)}-${tier}-retry`);
}

function walkChoices(
  choices: Array<{ id: string; outcomes?: Record<string, any> }> | undefined,
  pathPrefix: string,
  beatId: string,
  depth: number,
  maxDepth: number,
  slots: EncounterImageSlot[],
  truncated: string[],
  sceneId: string,
  scopedSceneId: string
): void {
  if (!choices?.length) return;
  if (depth > maxDepth) {
    truncated.push(`beat:${beatId}:${pathPrefix || '<root>'}`);
    return;
  }

  for (const choice of choices) {
    if (!choice.outcomes) continue;
    const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;

    for (const tier of ['success', 'complicated', 'failure'] as const) {
      const outcomeData = choice.outcomes[tier];
      if (!outcomeData) continue;

      slots.push({
        kind: 'outcome',
        sceneId,
        scopedSceneId,
        beatId,
        choiceMapKey,
        tier,
        treeDepth: depth,
        baseIdentifier: encounterOutcomeIdentifier(scopedSceneId, beatId, choiceMapKey, tier),
      });

      const nextSituation = outcomeData.nextSituation;
      if (nextSituation?.choices?.length) {
        const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
        slots.push({
          kind: 'situation',
          sceneId,
          scopedSceneId,
          beatId,
          choiceMapKey,
          tier,
          situationKey,
          treeDepth: depth,
          baseIdentifier: encounterSituationIdentifier(scopedSceneId, beatId, choiceMapKey, tier),
        });

        walkChoices(
          nextSituation.choices,
          `${choiceMapKey}::${tier}`,
          beatId,
          depth + 1,
          maxDepth,
          slots,
          truncated,
          sceneId,
          scopedSceneId
        );
      }
    }
  }
}

/**
 * Build the ordered slot list for one encounter scene. Same depth rules as generation.
 */
export function buildEncounterSlotManifest(
  encounter: EncounterLike,
  sceneId: string,
  scopedSceneId: string,
  maxTreeDepth: number = ENCOUNTER_TREE_MAX_DEPTH
): EncounterSlotManifest {
  const beats = getEncounterBeats(encounter);
  const slots: EncounterImageSlot[] = [];
  const truncated: string[] = [];

  for (const beat of beats) {
    slots.push({
      kind: 'setup',
      sceneId,
      scopedSceneId,
      beatId: beat.id,
      choiceMapKey: '',
      treeDepth: 0,
      baseIdentifier: encounterSetupIdentifier(scopedSceneId, beat.id),
    });
    walkChoices(beat.choices, '', beat.id, 0, maxTreeDepth, slots, truncated, sceneId, scopedSceneId);
  }

  return {
    sceneId,
    scopedSceneId,
    maxTreeDepth: maxTreeDepth,
    slots,
    truncatedPaths: truncated,
  };
}

/**
 * Count tree images only (outcome + situation), excluding setup beats.
 */
export function countTreeSlotsInManifest(manifest: EncounterSlotManifest): number {
  return manifest.slots.filter(s => s.kind !== 'setup').length;
}

/**
 * Verify that all manifest slots have corresponding URLs in the pipeline maps.
 * Key strings align with verifyTreeCoverage / collectMissingEncounterImageKeys semantics.
 */
export function collectMissingSlotsFromManifest(
  manifest: EncounterSlotManifest,
  setupImages: Map<string, string>,
  outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>
): string[] {
  const missing: string[] = [];
  for (const slot of manifest.slots) {
    if (slot.kind === 'setup') {
      if (!setupImages.has(slot.beatId)) {
        missing.push(`setup:${manifest.sceneId}::${slot.beatId}`);
      }
    } else if (slot.kind === 'outcome' && slot.tier) {
      const existing = outcomeImages.get(slot.choiceMapKey);
      if (!existing?.[slot.tier]) {
        missing.push(`outcome:${manifest.sceneId}::${slot.beatId}::${slot.choiceMapKey}::${slot.tier}`);
      }
    } else if (slot.kind === 'situation' && slot.situationKey) {
      const legacySituationKey = legacyEncounterSituationKey(slot.choiceMapKey, slot.tier || '');
      if (!setupImages.has(slot.situationKey) && !setupImages.has(legacySituationKey)) {
        missing.push(`situation:${manifest.sceneId}::${slot.situationKey}`);
      }
    }
  }
  return missing;
}
