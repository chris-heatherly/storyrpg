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
  SceneNarrativeRole,
  SeasonScenePlan,
  SetupPayoffEdge,
} from '../../types/scenePlan';
import type { StructuralRole } from '../../types/sourceAnalysis';
import { SCENE_BUDGET_WEIGHT, ENCOUNTER_BUDGET_WEIGHT } from '../../types/scenePlan';

const MIN_SCENES_PER_EPISODE = 3;
const MAX_SCENES_PER_EPISODE = 8;

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

/** Clamp a desired scene count into the allowed range. */
function clampSceneCount(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(MIN_SCENES_PER_EPISODE, Math.min(MAX_SCENES_PER_EPISODE, Math.round(n)));
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
 * Compose a planning-only dramatic purpose for a scene from the signals the
 * season plan carries. Not player-facing.
 */
function composeDramaticPurpose(
  role: SceneNarrativeRole,
  ep: SeasonEpisode,
  sevenPointText: string | undefined,
  turnText: string | undefined,
): string {
  const serves = sevenPointText
    ? `serves the ${roleLabel(ep.structuralRole)} beat ("${sevenPointText}")`
    : `serves the ${roleLabel(ep.structuralRole)} purpose of the episode`;
  const turn = turnText ? ` Turn: ${turnText}.` : '';
  switch (role) {
    case 'setup':
      return `Open the episode and plant its question; ${serves}.${turn}`;
    case 'development':
      return `Escalate the episode's pressure; ${serves}.${turn}`;
    case 'turn':
      return `The scene's hinge — reverse or reveal; ${serves}.${turn}`;
    case 'payoff':
      return `Discharge a setup planted earlier; ${serves}.${turn}`;
    case 'release':
      return `Aftermath that resettles stakes; ${serves}.${turn}`;
    default:
      return serves;
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
  const desired = clampSceneCount(ep.estimatedSceneCount || 5);
  const encounterCount = encounters.length;

  const scenes: PlannedScene[] = [];
  let order = 0;

  const pushStandard = (role: SceneNarrativeRole, turnIdx?: number): void => {
    const id = `s${ep.episodeNumber}-${order + 1}`;
    scenes.push({
      id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'standard',
      title: `${role} scene ${order + 1}`,
      dramaticPurpose: composeDramaticPurpose(role, ep, sevenPointText, turnIdx != null ? turns[turnIdx] : undefined),
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
    scenes.push({
      id: enc.id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'encounter',
      title: enc.description?.slice(0, 60) || `encounter ${enc.id}`,
      dramaticPurpose: composeDramaticPurpose('turn', ep, sevenPointText, undefined),
      narrativeRole: 'turn',
      locations: locations.slice(0, 1),
      npcsInvolved: enc.npcsInvolved ?? npcs.slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: enc.stakes,
      actLabel,
      arcLabel,
      encounter: toSceneEncounter(enc),
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
  pushStandard('setup', 0);
  // Development
  for (let i = 0; i < developmentCount; i += 1) {
    pushStandard('development', i + 1);
  }
  // Encounters (the episode's turn/climax)
  for (const enc of encounters) {
    pushEncounter(enc);
  }
  // Closing release
  if (hasRelease) {
    pushStandard('release');
  }

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
