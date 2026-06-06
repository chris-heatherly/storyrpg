/**
 * Season Scene Plan builder.
 *
 * Builds a {@link SeasonScenePlan} from a {@link SeasonPlan}. This is the
 * scene-first planning step: episodes and their scenes are enumerated at the
 * season level, with encounters expressed as `kind: 'encounter'` scenes and a
 * resolved setup/payoff graph. Beats are NOT produced here — they are generated
 * later, in the per-episode loop, to serve each scene.
 *
 * v1 is deterministic: it synthesizes the spine from data the season plan
 * already carries (per-episode `structuralRole`, `plannedEncounters`,
 * `synopsis`, `treatmentGuidance`, plus season-level `consequenceChains`,
 * `choiceMoments`, and `informationLedger` for the setup/payoff edges). This is
 * path-agnostic — it works for authored-treatment and from-scratch runs alike,
 * because both populate the season plan. An LLM-authored scene plan can later
 * replace or enrich this builder behind the same flag.
 */

import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type {
  PlannedScene,
  PlannedSceneEncounter,
  RequiredBeat,
  SceneNarrativeRole,
  SeasonScenePlan,
  SetupPayoffEdge,
} from '../../types/scenePlan';
import type { StructuralRole } from '../../types/sourceAnalysis';
import { SCENE_BUDGET_WEIGHT, ENCOUNTER_BUDGET_WEIGHT } from '../../types/scenePlan';

const MIN_SCENES_PER_EPISODE = 3;
const MAX_SCENES_PER_EPISODE = 8;
/**
 * When an episode carries more authored turns than the normal scene cap, we let
 * the spine grow to fit them rather than starve turns (§6 over-constraining
 * mitigation). This is the hard ceiling even then, so pacing can't explode.
 */
const MAX_SCENES_WITH_AUTHORED_TURNS = 12;

/**
 * Which standard-scene narrative roles bear a budgeted central choice on the
 * deterministic path. Setup/development/turn/payoff scenes carry the episode's
 * choices; a `release` scene is aftermath/breather and does not (the budget
 * allocator owns choiceType/consequenceTier — this only marks WHICH scenes are
 * budgeted units and their weight).
 */
const CHOICE_BEARING_ROLES: ReadonlySet<SceneNarrativeRole> = new Set([
  'setup',
  'development',
  'turn',
  'payoff',
]);

/**
 * Clamp a desired scene count into the allowed range. When `authoredTurnCount`
 * is supplied, the budget is `max(estimatedSceneCount, authoredTurnCount)` so an
 * episode with more authored turns than its estimate is NOT starved — every
 * authored turn can land as a required beat (multiple beats per scene are still
 * allowed; this only guarantees enough scenes to carry them). The hard ceiling
 * relaxes from MAX_SCENES_PER_EPISODE to MAX_SCENES_WITH_AUTHORED_TURNS in that case.
 */
function clampSceneCount(n: number, authoredTurnCount = 0): number {
  const base = Number.isFinite(n) ? Math.round(n) : 5;
  const desired = Math.max(base, authoredTurnCount);
  const ceiling = authoredTurnCount > MAX_SCENES_PER_EPISODE
    ? MAX_SCENES_WITH_AUTHORED_TURNS
    : MAX_SCENES_PER_EPISODE;
  return Math.max(MIN_SCENES_PER_EPISODE, Math.min(ceiling, desired));
}

/** Human-readable label for an episode's structural role(s). */
function roleLabel(roles?: StructuralRole[]): string {
  if (!roles || roles.length === 0) return 'the episode arc';
  return roles.join(' / ');
}

/** Map a season-level PlannedEncounter onto the encounter sub-object of a scene. */
export function toSceneEncounter(enc: NonNullable<SeasonEpisode['plannedEncounters']>[number]): PlannedSceneEncounter {
  return {
    type: enc.type,
    style: enc.style,
    difficulty: enc.difficulty,
    relevantSkills: enc.relevantSkills ?? [],
    centralConflict: enc.centralConflict,
    aftermathConsequence: enc.aftermathConsequence,
    isBranchPoint: Boolean(enc.isBranchPoint),
    branchOutcomes: enc.branchOutcomes,
  };
}

/**
 * Compose a planning-only dramatic purpose for a scene FRAMING (role + the
 * episode's 7-point beat). It no longer folds the authored episode turns into a
 * single string — authored turns are now first-class {@link RequiredBeat}s bound
 * to the scene that lands them (see {@link buildEpisodeScenes}). Not player-facing.
 */
function composeDramaticPurpose(
  role: SceneNarrativeRole,
  ep: SeasonEpisode,
  sevenPointText: string | undefined,
): string {
  const serves = sevenPointText
    ? `serves the ${roleLabel(ep.structuralRole)} beat ("${sevenPointText}")`
    : `serves the ${roleLabel(ep.structuralRole)} purpose of the episode`;
  switch (role) {
    case 'setup':
      return `Open the episode and plant its question; ${serves}.`;
    case 'development':
      return `Escalate the episode's pressure; ${serves}.`;
    case 'turn':
      return `The scene's hinge — reverse or reveal; ${serves}.`;
    case 'payoff':
      return `Discharge a setup planted earlier; ${serves}.`;
    case 'release':
      return `Aftermath that resettles stakes; ${serves}.`;
    default:
      return serves;
  }
}

/**
 * Build a {@link RequiredBeat} from an authored episode turn. Turns are
 * `authored`-tier (must occur, in order); the season planner can later promote a
 * staged device to `signature` via {@link PlannedScene.signatureMoment}.
 */
function requiredBeatFromTurn(sceneId: string, beatIndex: number, turnText: string): RequiredBeat {
  return {
    id: `${sceneId}-rb${beatIndex + 1}`,
    sourceTurn: turnText,
    mustDepict: turnText,
    tier: 'authored',
  };
}

/**
 * Append a list of required beats to a scene without dropping any it already
 * carries (the LLM path may have parsed model-provided beats; the deterministic
 * binding below is authoritative and additive). Keeps ids unique within the scene
 * by re-deriving the index from the running count.
 */
function appendRequiredBeats(scene: PlannedScene, beats: RequiredBeat[]): void {
  if (beats.length === 0) return;
  const existing = scene.requiredBeats ?? [];
  scene.requiredBeats = [...existing, ...beats];
}

/**
 * Deterministically bind an episode's authored content to its scenes — the single
 * source of truth shared by both the deterministic builder ({@link buildEpisodeScenes})
 * and the LLM-authored path ({@link normalizeAuthoredScenePlan}). Given the scenes
 * already built for an episode (in play order), this:
 *
 *  1. Distributes the authored episode beats positionally across the episode's
 *     CONTENT scenes (every scene except a trailing `release`) in authored order,
 *     one beat per content scene, piling any leftover beats onto the last content
 *     scene so none is dropped. The beat source is `episodeTurns` when present,
 *     else `majorChoicePressures` (treatments that omit an "Episode turns" section
 *     still author choice-pressure beats). Each becomes a `tier:'authored'`
 *     {@link RequiredBeat}. This is positional-index binding, not narrative-role
 *     matching — authored turns carry no per-turn role, so we distribute across
 *     content slots in order (see §3.2 over-constraining mitigation).
 *  2. Produces the SIGNATURE device from `treatmentGuidance.visualAnchor` (else the
 *     first `encounterAnchors` entry): it
 *     tags the encounter/anchor scene (the episode's hinge — prefer the encounter
 *     scene, else the first `turn`-role scene, else the last content scene) with a
 *     `tier:'signature'` {@link RequiredBeat} AND sets {@link PlannedScene.signatureMoment}.
 *     This is the input §4.4 SignatureDevicePresenceValidator asserts in the prose.
 *
 * Mutates the scenes in place. Idempotent enough for the deterministic path (which
 * passes freshly-built scenes) and additive for the LLM path (which may carry
 * model-authored beats already). No-op when the episode is not treatment-sourced.
 */
export function bindAuthoredTurnsToScenes(ep: SeasonEpisode, scenes: PlannedScene[]): void {
  if (scenes.length === 0) return;
  const guidance = ep.treatmentGuidance;
  // Primary source is the authored `episodeTurns` list (ENDSONG-style treatments).
  // Many treatments express per-episode beats through other sections instead — e.g.
  // the bite-me schema authors no "Episode turns" bullet but does author "Major choice
  // pressure" beats — so fall back to those when `episodeTurns` is empty. Without this
  // fallback the expand-not-rewrite binding would silently no-op on those formats,
  // leaving requiredBeats empty even though the episode is fully authored.
  const turns = (guidance?.episodeTurns?.length ? guidance.episodeTurns : guidance?.majorChoicePressures) ?? [];
  // Signature device: the explicit `Visual anchor` if authored, else the episode's
  // first `Encounter anchor` (its staged hinge), which well-formed treatments carry
  // even when they omit a dedicated visual-anchor line.
  const visualAnchor = guidance?.visualAnchor?.trim() || guidance?.encounterAnchors?.[0]?.trim();

  // Content scenes are everything except a trailing release breather (release is
  // aftermath, not authored content). Fall back to ALL scenes if every scene is a
  // release (degenerate) so turns are never dropped.
  const contentScenes = scenes.filter((s) => s.narrativeRole !== 'release');
  const targets = contentScenes.length > 0 ? contentScenes : scenes;

  // 1. Positional turn → content-scene binding (one per slot; leftovers pile last).
  if (turns.length > 0) {
    const perScene: RequiredBeat[][] = targets.map(() => []);
    for (let t = 0; t < turns.length; t += 1) {
      const slot = Math.min(t, targets.length - 1);
      const scene = targets[slot];
      const beatIndex = (scene.requiredBeats?.length ?? 0) + perScene[slot].length;
      perScene[slot].push(requiredBeatFromTurn(scene.id, beatIndex, turns[t]));
    }
    targets.forEach((scene, i) => appendRequiredBeats(scene, perScene[i]));
  }

  // 2. Signature device → the episode's anchor scene.
  if (visualAnchor) {
    const anchor =
      scenes.find((s) => s.kind === 'encounter')
      || scenes.find((s) => s.narrativeRole === 'turn')
      || targets[targets.length - 1];
    if (anchor) {
      anchor.signatureMoment = visualAnchor;
      const beatIndex = anchor.requiredBeats?.length ?? 0;
      appendRequiredBeats(anchor, [
        {
          id: `${anchor.id}-sig${beatIndex + 1}`,
          sourceTurn: visualAnchor,
          mustDepict: visualAnchor,
          tier: 'signature',
        },
      ]);
    }
  }
}

/** Resolve the 7-point beat text an episode carries (undefined for buffer roles). */
export function sevenPointTextForEpisode(plan: SeasonPlan, ep: SeasonEpisode): string | undefined {
  const role = ep.structuralRole?.[0];
  if (!role || role === 'rising' || role === 'falling') return undefined;
  return plan.sevenPoint?.[role];
}

/** Build the ordered list of scenes for a single episode. */
export function buildEpisodeScenes(ep: SeasonEpisode, sevenPointText: string | undefined): PlannedScene[] {
  const encounters = ep.plannedEncounters ?? [];
  const turns = ep.treatmentGuidance?.episodeTurns ?? [];
  const actLabel = ep.treatmentGuidance?.actLabel;
  const arcLabel = ep.treatmentGuidance?.arcLabel;
  const locations = ep.locations ?? [];
  const npcs = ep.mainCharacters ?? [];

  // sceneEpisodes mode: the season planner sets targetScenesPerEpisode to 1.
  // We honor that by emitting a minimal spine (the encounter if present, else a
  // single standard scene) — the "1" is a soft target, so multiple encounters
  // still each get a scene.
  //
  // Budget the scene count from max(estimatedSceneCount, authoredTurnCount) so an
  // episode that authored more turns than its estimate gets enough scenes to land
  // every turn as a required beat instead of starving turns (§3.2, §6).
  const turnCount = turns.length;
  const desired = clampSceneCount(ep.estimatedSceneCount || 5, turnCount);
  const encounterCount = encounters.length;

  const scenes: PlannedScene[] = [];
  let order = 0;

  const pushStandard = (role: SceneNarrativeRole): void => {
    const id = `s${ep.episodeNumber}-${order + 1}`;
    scenes.push({
      id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'standard',
      title: `${role} scene ${order + 1}`,
      dramaticPurpose: composeDramaticPurpose(role, ep, sevenPointText),
      narrativeRole: role,
      locations: locations.slice(0, 1),
      npcsInvolved: npcs.slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: ep.synopsis,
      actLabel,
      arcLabel,
      // Budget seed: mark choice-bearing standard scenes so the allocator picks
      // them up as weighted units. choiceType/consequenceTier stay unset here —
      // the allocator owns those.
      hasChoice: CHOICE_BEARING_ROLES.has(role),
      budgetWeight: SCENE_BUDGET_WEIGHT,
    });
    order += 1;
  };

  const pushEncounter = (enc: NonNullable<SeasonEpisode['plannedEncounters']>[number]): void => {
    const encounter = toSceneEncounter(enc);
    scenes.push({
      id: enc.id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'encounter',
      title: enc.description?.slice(0, 60) || `encounter ${enc.id}`,
      dramaticPurpose: composeDramaticPurpose('turn', ep, sevenPointText),
      narrativeRole: 'turn',
      locations: locations.slice(0, 1),
      npcsInvolved: enc.npcsInvolved ?? npcs.slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: enc.stakes,
      actLabel,
      arcLabel,
      encounter,
      // Budget seed: every encounter is a budgeted unit at encounter weight.
      hasChoice: true,
      budgetWeight: ENCOUNTER_BUDGET_WEIGHT,
    });
    order += 1;
  };

  // Standard-mode spine: setup -> development(s) -> encounter(s) -> release.
  const standardSlots = Math.max(2, desired - encounterCount);
  const hasRelease = standardSlots >= 2 && desired > encounterCount + 1;
  const openingCount = 1;
  const closingCount = hasRelease ? 1 : 0;
  const developmentCount = Math.max(0, standardSlots - openingCount - closingCount);

  // Opening setup
  pushStandard('setup');
  // Development
  for (let i = 0; i < developmentCount; i += 1) {
    pushStandard('development');
  }
  // Encounters (the episode's turn/climax)
  for (const enc of encounters) {
    pushEncounter(enc);
  }
  // Closing release (kept free of authored turns when possible — see binder).
  if (hasRelease) {
    pushStandard('release');
  }

  // Bind authored turns + the signature device deterministically (shared with the
  // LLM-authored path). This is the single source of truth for turn→scene binding.
  bindAuthoredTurnsToScenes(ep, scenes);

  return scenes;
}

/** Pick the scene that best represents where a setup ORIGINATES in an episode. */
function originSceneId(scenes: PlannedScene[]): string | undefined {
  // Prefer an encounter (the hinge); else the last scene of the episode.
  const enc = scenes.find((s) => s.kind === 'encounter');
  if (enc) return enc.id;
  return scenes.length > 0 ? scenes[scenes.length - 1].id : undefined;
}

/** Pick the scene that best represents where a setup PAYS OFF in an episode. */
function payoffSceneId(scenes: PlannedScene[]): string | undefined {
  // Prefer a release/payoff scene; else the first scene (consequence lands on entry).
  const release = scenes.find((s) => s.narrativeRole === 'release' || s.narrativeRole === 'payoff');
  if (release) return release.id;
  return scenes.length > 0 ? scenes[0].id : undefined;
}

/**
 * Build the full season scene plan. Deterministic; safe to call on any season
 * plan. Returns a plan whose `scenes` are ordered by (episode, order) and whose
 * `setupPayoffEdges` are derived from the season's cross-episode structures.
 */
export function buildSeasonScenePlan(plan: SeasonPlan): SeasonScenePlan {
  const sevenPoint = plan.sevenPoint;
  const episodes = [...plan.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

  const scenesByEpisode = new Map<number, PlannedScene[]>();
  for (const ep of episodes) {
    const role = ep.structuralRole?.[0];
    const sevenPointText = role && role !== 'rising' && role !== 'falling'
      ? sevenPoint?.[role]
      : undefined;
    scenesByEpisode.set(ep.episodeNumber, buildEpisodeScenes(ep, sevenPointText));
  }

  // Resolve setup/payoff edges from the season's cross-episode structures.
  const edges: SetupPayoffEdge[] = [];
  const seen = new Set<string>();

  const link = (fromEp: number, toEp: number, description?: string): void => {
    if (fromEp == null || toEp == null) return;
    if (fromEp === toEp) {
      const scenes = scenesByEpisode.get(fromEp);
      if (!scenes || scenes.length < 2) return;
      const from = scenes[0].id;
      const to = scenes[scenes.length - 1].id;
      if (from === to) return;
      const key = `${from}->${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      scenes[0].setsUp.push(to);
      scenes[scenes.length - 1].paysOff.push(from);
      edges.push({ from, to, description, span: 'same_episode' });
      return;
    }
    const fromScenes = scenesByEpisode.get(fromEp);
    const toScenes = scenesByEpisode.get(toEp);
    if (!fromScenes || !toScenes) return;
    const from = originSceneId(fromScenes);
    const to = payoffSceneId(toScenes);
    if (!from || !to) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    fromScenes.find((s) => s.id === from)?.setsUp.push(to);
    toScenes.find((s) => s.id === to)?.paysOff.push(from);
    edges.push({ from, to, description, span: 'cross_episode' });
  };

  // Consequence chains: origin episode plants; each consequence episode pays off.
  for (const chain of plan.consequenceChains ?? []) {
    for (const conseq of chain.consequences ?? []) {
      link(chain.origin.episodeNumber, conseq.episodeNumber, chain.origin.description);
    }
  }
  // Choice moments: decided in `episode`, paid off in `paysOffEpisode`.
  for (const moment of plan.choiceMoments ?? []) {
    if (moment.paysOffEpisode && moment.paysOffEpisode !== moment.episode) {
      link(moment.episode, moment.paysOffEpisode, moment.anchor);
    }
  }
  // Information ledger: introduced episode plants; reveal/payoff episode discharges.
  for (const entry of plan.informationLedger ?? []) {
    const payoff = entry.plannedPayoffEpisode ?? entry.plannedRevealEpisode;
    if (payoff && payoff !== entry.introducedEpisode) {
      link(entry.introducedEpisode, payoff, entry.label);
    }
  }

  // Flatten in (episode, order) order.
  const scenes: PlannedScene[] = [];
  const byEpisode: Record<number, string[]> = {};
  for (const ep of episodes) {
    const epScenes = scenesByEpisode.get(ep.episodeNumber) ?? [];
    byEpisode[ep.episodeNumber] = epScenes.map((s) => s.id);
    scenes.push(...epScenes);
  }

  return { scenes, byEpisode, setupPayoffEdges: edges };
}

/** Return just the scenes belonging to a given episode, in order. */
export function scenesForEpisode(scenePlan: SeasonScenePlan, episodeNumber: number): PlannedScene[] {
  return scenePlan.scenes
    .filter((s) => s.episodeNumber === episodeNumber)
    .sort((a, b) => a.order - b.order);
}

/** Return setup/payoff edges that touch a given episode (as origin or payoff). */
export function edgesForEpisode(scenePlan: SeasonScenePlan, episodeNumber: number): SetupPayoffEdge[] {
  const ids = new Set(scenePlan.byEpisode[episodeNumber] ?? []);
  return scenePlan.setupPayoffEdges.filter((e) => ids.has(e.from) || ids.has(e.to));
}
