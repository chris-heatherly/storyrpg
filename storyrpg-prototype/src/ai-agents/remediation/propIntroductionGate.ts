// ========================================
// PROP INTRODUCTION GATE (episode-level input builder)
// ========================================
//
// PropIntroductionValidator (#26C) is an episode-scoped cross-scene continuity
// check: every entity a scene references must resolve to a KNOWN entity — the
// seeded cast/prop set plus any entity a scene explicitly marks as introducing.
//
// The validator itself is already pure and unit-tested. What was previously
// living inline at the all-scenes assembly seam in FullStoryPipeline.ts is the
// *input assembly*: folding the cast/prop ids together with every scene's
// declared introductions to build the cross-scene known-entity set, then shaping
// the per-scene reference rows the validator consumes. That logic is extracted
// here so the heavy lifting stays out of the monolith and gets its own tests.
//
// Pure by construction: no env reads, no wall-clock, no randomness, no I/O. The
// default-OFF gating guarantee lives at the call site (via shouldGate +
// PLAN_GATE_FLAGS.propIntroduction); this module only shapes the validator input.
//
// SCOPE NOTE (episode-level subset). This is the best deterministic subset
// checkable at episode-assembly time:
//   - Cast (character-bible ids AND display names) is fully available.
//   - Cross-scene introductions are folded in regardless of scene order, so a
//     prop/NPC introduced in a *later* scene of the same episode still counts as
//     known (the validator de-dupes; ordering is deliberately not enforced —
//     "used before introduced" needs per-entity intro offsets we don't have).
// No SEASON-level data is required: the validator is purely per-episode
// cross-scene continuity. If a season-wide declared-prop registry ever exists,
// fold its ids into `castAndPropIds` at the call site before invoking this
// builder — the shape below already accepts a flat id list for exactly that.

import type {
  PropIntroductionInput,
  PropIntroductionScene,
} from '../validators/PropIntroductionValidator';

/** A scene as seen at the all-scenes assembly seam, before validator shaping. */
export interface EpisodeSceneForPropGate {
  sceneId?: string;
  sceneName?: string;
  /** Entity ids (characters + props) this scene references. */
  referencedEntityIds?: string[];
  /** Entity ids this scene explicitly introduces (added to the known set). */
  introducesEntityIds?: string[];
}

/**
 * Build the cross-scene known-entity set for an episode: the union of the
 * declared cast/prop ids and every entity any scene marks as introducing.
 *
 * Deterministic: ids are de-duped and returned in first-seen order (cast/prop
 * ids first in input order, then scene introductions in scene/list order).
 * Falsy ids are dropped. The validator also folds introductions in itself, so
 * exposing the set here is purely for transparency/testing — the returned set
 * and the validator's internal set are equivalent.
 */
export function buildEpisodeKnownEntitySet(
  castAndPropIds: ReadonlyArray<string | undefined | null>,
  scenes: ReadonlyArray<EpisodeSceneForPropGate>,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (id: string | undefined | null): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };

  for (const id of castAndPropIds) add(id);
  for (const scene of scenes) {
    for (const id of scene.introducesEntityIds ?? []) add(id);
  }

  return ordered;
}

/**
 * Assemble the ready-to-validate {@link PropIntroductionInput} for an episode.
 *
 * Folds the declared cast/prop ids together with every scene's introductions
 * into the cross-scene known-entity set, and shapes each scene into the
 * validator's {@link PropIntroductionScene} row. The result can be handed
 * straight to `new PropIntroductionValidator().validate(...)`.
 */
export function buildPropIntroductionInput(
  castAndPropIds: ReadonlyArray<string | undefined | null>,
  scenes: ReadonlyArray<EpisodeSceneForPropGate>,
): PropIntroductionInput {
  const knownEntityIds = buildEpisodeKnownEntitySet(castAndPropIds, scenes);

  const sceneContents: PropIntroductionScene[] = scenes.map((scene) => ({
    sceneId: scene.sceneId,
    sceneName: scene.sceneName,
    referencedEntityIds: (scene.referencedEntityIds ?? []).filter(Boolean),
    introducesEntityIds: (scene.introducesEntityIds ?? []).filter(Boolean),
  }));

  return { knownEntityIds, sceneContents };
}
