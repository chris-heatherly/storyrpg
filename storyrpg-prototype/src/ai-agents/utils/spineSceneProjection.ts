/**
 * ESC → PlannedScene order reconciliation.
 * When an Episode Spine Contract is present, unit order is the only chronology
 * authority; helper scenes without spineUnitId keep relative placement.
 */

import type { EpisodeSpineContract } from '../../types/episodeSpine';
import type { PlannedScene } from '../../types/scenePlan';

/**
 * Force PlannedScene array order (and contiguous `.order`) to mirror ESC unit
 * order. Synthetic helper scenes without spineUnitId keep relative placement
 * among mapped units by original index.
 */
export function reconcileSceneOrderToSpine(
  episodeSpine: EpisodeSpineContract | undefined,
  scenes: PlannedScene[],
): number {
  if (!episodeSpine?.units.length || scenes.length === 0) return 0;
  const unitById = new Map(episodeSpine.units.map((unit) => [unit.id, unit]));
  const mapped = scenes.filter((scene) => scene.spineUnitId && unitById.has(scene.spineUnitId));
  const unmapped = scenes.filter((scene) => !scene.spineUnitId || !unitById.has(scene.spineUnitId));
  const byId = new Map(scenes.map((scene, index) => [scene.id, { scene, index }]));

  const result: PlannedScene[] = [];
  const used = new Set<string>();
  for (const unit of episodeSpine.units) {
    const scene = mapped.find((candidate) => candidate.spineUnitId === unit.id);
    if (scene && !used.has(scene.id)) {
      result.push(scene);
      used.add(scene.id);
    }
  }
  for (const scene of unmapped) {
    if (used.has(scene.id)) continue;
    const originalIndex = byId.get(scene.id)?.index ?? Number.MAX_SAFE_INTEGER;
    let insertAt = result.length;
    for (let i = 0; i < result.length; i += 1) {
      const mappedOriginal = byId.get(result[i].id)?.index ?? -1;
      if (mappedOriginal > originalIndex) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, scene);
    used.add(scene.id);
  }

  let changes = 0;
  result.forEach((scene, index) => {
    if (scenes[index] !== scene || scene.order !== index) changes += 1;
    scenes[index] = scene;
    // Contiguous 0..n for StoryArchitect leadsTo linearization; ESC unit.order
    // is preserved via spineUnitId and validated separately.
    scene.order = index;
  });
  return changes;
}
