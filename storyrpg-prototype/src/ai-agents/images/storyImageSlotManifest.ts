import type { SceneContent } from '../agents/SceneWriter';
import { sanitizeEncounterIdentifier } from '../encounters/encounterSlotManifest';
import type { ImageSlot } from './slotTypes';

export interface StoryImageSlotManifest {
  scopedSceneId: string;
  sceneId: string;
  slots: ImageSlot[];
}

export function storySceneCoverageKey(sceneId: string): string {
  return `scene:${sceneId}`;
}

export function storyBeatCoverageKey(sceneId: string, beatId: string): string {
  return `beat:${sceneId}::${beatId}`;
}

export function storySceneBaseIdentifier(scopedSceneId: string): string {
  return sanitizeEncounterIdentifier(`scene-${scopedSceneId}-bg`);
}

export function storyBeatBaseIdentifier(scopedSceneId: string, beatId: string): string {
  return sanitizeEncounterIdentifier(`beat-${scopedSceneId}-${beatId}`);
}

export function storyBeatRetryIdentifier(scopedSceneId: string, beatId: string, suffix: string): string {
  return sanitizeEncounterIdentifier(`beat-${scopedSceneId}-${beatId}-${suffix}`);
}

export function buildStoryImageSlotManifest(
  scene: Pick<SceneContent, 'sceneId' | 'beats' | 'startingBeatId'>,
  scopedSceneId: string,
): StoryImageSlotManifest {
  const slots: ImageSlot[] = [];
  const firstBeat = scene.beats?.[0];

  slots.push({
    slotId: `story-scene:${scene.sceneId}`,
    family: 'story-scene',
    imageType: 'scene',
    sceneId: scene.sceneId,
    scopedSceneId,
    beatId: firstBeat?.id,
    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
    baseIdentifier: storySceneBaseIdentifier(scopedSceneId),
    required: false,
    qualityTier: 'standard',
    coverageKey: storySceneCoverageKey(scene.sceneId),
    continuitySourceSlotId: firstBeat ? `story-beat:${scene.sceneId}::${firstBeat.id}` : undefined,
    metadata: {
      firstBeatId: firstBeat?.id,
      startingBeatId: scene.startingBeatId,
    },
  });

  for (const beat of scene.beats || []) {
    slots.push({
      slotId: `story-beat:${scene.sceneId}::${beat.id}`,
      family: 'story-beat',
      imageType: 'beat',
      sceneId: scene.sceneId,
      scopedSceneId,
      beatId: beat.id,
      storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beat.id}].image`,
      baseIdentifier: storyBeatBaseIdentifier(scopedSceneId, beat.id),
      required: false,
      qualityTier: 'standard',
      coverageKey: storyBeatCoverageKey(scene.sceneId, beat.id),
      metadata: {
        isChoicePoint: beat.isChoicePoint === true,
        isClimaxBeat: (beat as unknown as Record<string, unknown>).isClimaxBeat === true,
        isKeyStoryBeat: (beat as unknown as Record<string, unknown>).isKeyStoryBeat === true,
      },
    });
  }

  return {
    scopedSceneId,
    sceneId: scene.sceneId,
    slots,
  };
}

export function collectMissingStoryImageSlotsFromManifest(
  manifest: StoryImageSlotManifest,
  beatImages: Map<string, string>,
  sceneImages: Map<string, string>,
): string[] {
  const missing: string[] = [];
  for (const slot of manifest.slots) {
    if (slot.family === 'story-scene') {
      const hasScene = !!sceneImages.get(slot.scopedSceneId || '');
      const hasSourceBeat = !!(slot.beatId && beatImages.get(`${slot.scopedSceneId}::${slot.beatId}`));
      if (!hasScene && !hasSourceBeat) {
        missing.push(slot.coverageKey);
      }
      continue;
    }

    if (slot.family === 'story-beat') {
      const key = `${slot.scopedSceneId}::${slot.beatId}`;
      if (!beatImages.get(key)) {
        missing.push(slot.coverageKey);
      }
    }
  }
  return missing;
}
