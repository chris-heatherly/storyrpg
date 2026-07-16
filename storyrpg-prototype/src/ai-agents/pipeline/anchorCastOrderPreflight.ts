/**
 * Anchor cast-order preflight (treatment-gap analysis 2026-07-15, G5).
 *
 * Run 20-44-49 staged Radu twice: an internally generated introduce-the-NPC
 * obligation cast him into s1-2 (unnamed, scar, woodsmoke, a full three-way
 * gaze choice) while the treatment anchors his FIRST sighting at the rooftop
 * (s1-5). Once the semantic compiler has bound "X's first sighting" anchors
 * to their owning scenes (NarrativeAnchorContract.firstSighting), the
 * ordering check is pure and deterministic: no earlier scene in the same
 * episode may cast that character.
 *
 * ADVISORY: findings are warnings in the scene-construction diagnostic, not
 * gate input — the anchor linkage is LLM-compiled, so this class earns trust
 * through shadow evidence first.
 */

import type { NarrativeAnchorContract } from '../../types/narrativeContract';
import { entityTokensMatch } from '../utils/entityIdentity';

export interface AnchorCastOrderFinding {
  anchorId: string;
  anchorName: string;
  npcName: string;
  owningSceneId: string;
  earlySceneId: string;
  message: string;
}

export interface AnchorCastOrderScene {
  id: string;
  episodeNumber?: number;
  order?: number;
  npcsPresent?: string[];
  npcsInvolved?: string[];
}

export function auditAnchorCastOrder(
  anchors: ReadonlyArray<NarrativeAnchorContract>,
  scenes: ReadonlyArray<AnchorCastOrderScene>,
): AnchorCastOrderFinding[] {
  const findings: AnchorCastOrderFinding[] = [];
  for (const anchor of anchors) {
    if (!anchor.firstSighting || !anchor.npcName?.trim()) continue;
    const episodeScenes = scenes
      .filter((scene) => scene.episodeNumber === undefined
        || anchor.episodeNumber === undefined
        || scene.episodeNumber === anchor.episodeNumber);
    const owningIndex = episodeScenes.findIndex((scene) => scene.id === anchor.owningSceneId);
    if (owningIndex <= 0) continue;
    for (const scene of episodeScenes.slice(0, owningIndex)) {
      const cast = [...(scene.npcsPresent ?? []), ...(scene.npcsInvolved ?? [])];
      const earlyRef = cast.find((ref) => entityTokensMatch(ref, anchor.npcName));
      if (!earlyRef) continue;
      findings.push({
        anchorId: anchor.id,
        anchorName: anchor.anchorName,
        npcName: anchor.npcName,
        owningSceneId: anchor.owningSceneId,
        earlySceneId: scene.id,
        message: `${anchor.npcName} is cast in ${scene.id} (as "${earlyRef}") but the treatment anchors their first sighting at ${anchor.owningSceneId} ("${anchor.anchorName}") — an early introduction duplicates and defuses the planned sighting.`,
      });
    }
  }
  return findings;
}
