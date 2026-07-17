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

import type { NarrativeAnchorContract, NarrativeFirstAppearanceContract } from '../../types/narrativeContract';
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

/**
 * C1 (quality-gap 14-50-23): Radu-in-s1-2 recurred because the anchor-based
 * audit had two failure modes — the graph's anchorContracts can be null while
 * the season plan's are populated (vacuous source), and the LLM anchor
 * compiler simply may not emit a first-sighting anchor at all on a given run.
 * The DETERMINISTIC authority is the compiled first-appearance contract
 * (presence ∪ anchors): it exists for every named character and already
 * names the owning scene and every earlier scene. This audit reads it
 * directly, so cast-order coverage no longer depends on LLM anchor variance.
 */
export interface FirstAppearanceCastOrderFinding {
  contractId: string;
  characterId: string;
  characterName: string;
  owningSceneId: string;
  earlySceneId: string;
  /** True when a treatment anchor backs the contract. */
  anchorBacked: boolean;
  /**
   * True when the premature cast is in an EARLIER EPISODE than the compiled
   * first appearance (the Radu class: presence contracts put him in ep2, the
   * ep1 plan cast him anyway). The contract itself is blocking tier, so this
   * is a would-be blocker caught at plan time.
   */
  crossEpisode: boolean;
  message: string;
}

export interface CastOrderAuditScene {
  id: string;
  episodeNumber?: number;
  npcsPresent?: string[];
  npcsInvolved?: string[];
}

export function auditFirstAppearanceCastOrder(
  contracts: ReadonlyArray<NarrativeFirstAppearanceContract>,
  scenes: ReadonlyArray<CastOrderAuditScene>,
): FirstAppearanceCastOrderFinding[] {
  const findings: FirstAppearanceCastOrderFinding[] = [];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  for (const contract of contracts) {
    // Within the owning episode, the contract's own earlierSceneIds is the
    // authority — positional array order would misclassify branch siblings as
    // "earlier" and make the autofix destructive on branching graphs. Across
    // episodes, ANY scene in an earlier episode precedes the first appearance
    // (earlierSceneIds are episode-local, which is exactly how Radu-in-s1-2
    // evaded the audit while his first appearance was compiled to ep2).
    const earlierIdSet = new Set(contract.earlierSceneIds ?? []);
    const candidateScenes = scenes.filter((scene) =>
      earlierIdSet.has(scene.id)
      || (scene.episodeNumber !== undefined && scene.episodeNumber < contract.episodeNumber));
    if (candidateScenes.length === 0) continue;
    const anchorBacked = (contract.sourceContractIds ?? []).some((id) => id.startsWith('anchor:'));
    for (const scene of candidateScenes) {
      if (scene.id === contract.owningSceneId || !sceneById.has(scene.id)) continue;
      const cast = [...(scene.npcsPresent ?? []), ...(scene.npcsInvolved ?? [])];
      const earlyRef = cast.find((ref) =>
        entityTokensMatch(ref, contract.characterId) || entityTokensMatch(ref, contract.characterName));
      if (!earlyRef) continue;
      const crossEpisode = scene.episodeNumber !== undefined && scene.episodeNumber < contract.episodeNumber;
      findings.push({
        contractId: contract.id,
        characterId: contract.characterId,
        characterName: contract.characterName,
        owningSceneId: contract.owningSceneId,
        earlySceneId: scene.id,
        anchorBacked,
        crossEpisode,
        message: `${contract.characterName} is cast in ${scene.id} (as "${earlyRef}") before their compiled first appearance at ${contract.owningSceneId}${crossEpisode ? ` (episode ${contract.episodeNumber})` : ''} — an early introduction duplicates and defuses the planned moment.`,
      });
    }
  }
  return findings;
}

/**
 * C1 autofix (second occurrence — shadow evidence from runs 20-44-49 and
 * 14-50-23): strip the premature cast placement from the earlier scene's
 * plan metadata. Deterministic plan-metadata edit only — no prose is
 * authored; the scene simply stops staging a character the treatment
 * introduces later. Fixed tiers: anchor-backed findings (treatment
 * authority) and cross-episode findings (the first-appearance contract is
 * blocking tier — the premature cast is a would-be blocker). Same-episode
 * presence-derived findings stay advisory.
 */
export function applyCastOrderAutofix(
  findings: ReadonlyArray<FirstAppearanceCastOrderFinding>,
  scenes: ReadonlyArray<CastOrderAuditScene>,
): FirstAppearanceCastOrderFinding[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const applied: FirstAppearanceCastOrderFinding[] = [];
  for (const finding of findings) {
    if (!finding.anchorBacked && !finding.crossEpisode) continue;
    const scene = sceneById.get(finding.earlySceneId);
    if (!scene) continue;
    const matches = (ref: string) =>
      entityTokensMatch(ref, finding.characterId) || entityTokensMatch(ref, finding.characterName);
    const beforePresent = scene.npcsPresent?.length ?? 0;
    const beforeInvolved = scene.npcsInvolved?.length ?? 0;
    if (scene.npcsPresent) scene.npcsPresent = scene.npcsPresent.filter((ref) => !matches(ref));
    if (scene.npcsInvolved) scene.npcsInvolved = scene.npcsInvolved.filter((ref) => !matches(ref));
    const removed = (beforePresent - (scene.npcsPresent?.length ?? 0)) + (beforeInvolved - (scene.npcsInvolved?.length ?? 0));
    if (removed > 0) applied.push(finding);
  }
  return applied;
}
