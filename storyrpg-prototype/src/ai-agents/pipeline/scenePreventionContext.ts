/**
 * Scene-authoring prevention context (Gen-4 Phases A1 + B1).
 *
 * Pure, deterministic helpers that build the "get it right the first time"
 * context handed to the SceneWriter, so the common defects never have to be
 * repaired after the fact:
 *
 *  - {@link buildPriorEncounterOutcomes} — when an encounter routes INTO a scene,
 *    surface the encounter's outcomes + their pre-seeded `encounter_<id>_<outcome>`
 *    flags so the scene authors outcome-conditioned textVariants (it reflects
 *    whether an ally was hurt, a win was costly, etc. — W4).
 *  - {@link buildContinueInLocation} — when the prior scene shares this scene's
 *    location, signal "continue the visit" so the writer doesn't re-stage a fresh
 *    arrival (the dual-first-entry continuity defect — B1).
 *
 * Extracted from FullStoryPipeline (monolith non-negotiable: do not grow it) and
 * kept free of `this`, so they're trivially unit-testable.
 */

import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import type { SceneWriterInput } from '../agents/SceneWriter';
import { encounterOutcomeFlag } from '../utils/encounterOutcomeFlags';

const ENCOUNTER_OUTCOMES = ['victory', 'partialVictory', 'defeat', 'escape'] as const;

/** The slice of a generated EncounterStructure the aftermath scene needs. */
export interface GeneratedEncounterPressure {
  goalClock?: { name?: string; segments?: number; description?: string };
  threatClock?: { name?: string; segments?: number; description?: string };
  stakes?: { victory?: string; defeat?: string };
}

/**
 * For a scene that an encounter routes INTO, build the outcome context (outcome
 * flag names + the encounter's stakes) so the SceneWriter authors textVariants
 * that make the scene reflect the encounter result. Returns undefined when no
 * encounter leads here. The flag names match what `seedEncounterOutcomeFlags`
 * stamps on the encounter, so prevention and the post-hoc seeder agree.
 *
 * When the GENERATED encounter structure is available (it is — encounters are
 * built in their own loop iteration, before any scene they lead to), its real
 * stakes and goal/threat clocks are surfaced too. Without them the aftermath
 * prose floats free of the encounter's mechanical pressure: a fight that ended
 * with the threat clock nearly full reads identical to a clean win (the
 * partialVictory state/prose desync class).
 *
 * @param sanitizeName Reader-facing scene-name sanitizer (passed in so this stays
 *   free of pipeline state).
 * @param generatedEncounters Generated EncounterStructure by sceneId, when available.
 */
export function buildPriorEncounterOutcomes(
  blueprint: EpisodeBlueprint,
  sceneBlueprint: SceneBlueprint,
  sanitizeName: (name: string | undefined, fallback: string) => string,
  generatedEncounters?: ReadonlyMap<string, GeneratedEncounterPressure>,
): SceneWriterInput['priorEncounterOutcomes'] {
  const incoming = (blueprint.scenes || []).filter(
    (s) => s.isEncounter && (s.leadsTo || []).includes(sceneBlueprint.id),
  );
  if (incoming.length === 0) return undefined;
  return incoming.map((enc) => {
    const generated = generatedEncounters?.get(enc.id);
    return {
      encounterId: enc.id,
      encounterName: sanitizeName(enc.name, enc.name),
      victoryStakes: generated?.stakes?.victory || enc.encounterStakes,
      defeatStakes: generated?.stakes?.defeat || enc.encounterStakes,
      outcomeFlags: ENCOUNTER_OUTCOMES.map((o) => ({ outcome: o, flag: encounterOutcomeFlag(enc.id, o) })),
      goalPressure: generated?.goalClock?.description || generated?.goalClock?.name,
      threatPressure: generated?.threatClock?.description || generated?.threatClock?.name,
    };
  });
}

/**
 * If the scene that linearly precedes `sceneBlueprint` shares its location, return
 * that location so the SceneWriter continues the visit instead of staging a fresh
 * arrival (the Endsong dual-first-entry). Returns undefined when the prior scene is
 * elsewhere, is an encounter, or no location is recorded.
 */
export function buildContinueInLocation(
  blueprint: EpisodeBlueprint,
  sceneBlueprint: SceneBlueprint,
): string | undefined {
  const scenes = blueprint.scenes || [];
  const idx = scenes.findIndex((s) => s.id === sceneBlueprint.id);
  if (idx <= 0) return undefined;
  const prev = scenes[idx - 1];
  if (!prev || prev.isEncounter) return undefined;
  const here = (sceneBlueprint.location || '').trim();
  const there = (prev.location || '').trim();
  if (!here || !there) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(here) === norm(there) ? here : undefined;
}
