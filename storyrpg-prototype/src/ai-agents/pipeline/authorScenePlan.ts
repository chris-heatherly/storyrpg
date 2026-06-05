/**
 * LLM-authored season scene plan.
 *
 * Where {@link buildSeasonScenePlan} *arranges* scenes deterministically from
 * data the season plan already holds, this module *plans* them: it prompts the
 * model to author each episode's scenes with real dramatic content and explicit
 * cross-scene setup/payoff logic, then normalizes the result into a validated
 * {@link SeasonScenePlan}.
 *
 * The agent owns the LLM call; this module owns the (pure, testable) prompt and
 * normalization. Normalization is defensive: it pins ids, fills gaps from the
 * deterministic per-episode builder, forces encounters to match the planned
 * encounter set, enforces forward-only setup/payoff, rebuilds reciprocal
 * paysOff from setsUp, and finally validates the spine — returning `null` (so
 * the caller falls back to the deterministic plan) if anything is unrecoverable.
 */

import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type {
  ConsequenceTier,
  PlannedScene,
  SceneNarrativeRole,
  SeasonScenePlan,
  SetupPayoffEdge,
} from '../../types/scenePlan';
import {
  ENCOUNTER_BUDGET_WEIGHT,
  SCENE_BUDGET_WEIGHT,
} from '../../types/scenePlan';
import type { ChoiceType } from '../../types/choice';
import {
  buildEpisodeScenes,
  sevenPointTextForEpisode,
  toSceneEncounter,
} from './seasonScenePlanBuilder';
import { SceneSpineValidator } from '../validators/SceneSpineValidator';

const VALID_ROLES: ReadonlySet<SceneNarrativeRole> = new Set([
  'setup',
  'development',
  'turn',
  'payoff',
  'release',
]);

const VALID_CHOICE_TYPES: ReadonlySet<ChoiceType> = new Set([
  'expression',
  'relationship',
  'strategic',
  'dilemma',
]);

/** Choice roles an encounter may carry — encounters are stakes-driven, never 'expression'. */
const ENCOUNTER_CHOICE_TYPES: ReadonlySet<ChoiceType> = new Set([
  'relationship',
  'strategic',
  'dilemma',
]);

const VALID_TIERS: ReadonlySet<ConsequenceTier> = new Set([
  'callback',
  'tint',
  'branchlet',
  'branch',
]);

// ========================================
// PROMPT
// ========================================

/**
 * Build the scene-authoring prompt. Gives the model the season spine and each
 * episode's brief (role, synopsis, turns, planned encounters, cross-episode
 * setups/payoffs) and asks for an authored scene list per episode.
 */
export function buildScenePlanPrompt(plan: SeasonPlan): string {
  const sevenPoint = plan.sevenPoint;
  const episodeBlocks = [...plan.episodes]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((ep) => {
      const beat = sevenPointTextForEpisode(plan, ep);
      const role = ep.structuralRole?.join(' / ') || 'rising/falling buffer';
      const turns = ep.treatmentGuidance?.episodeTurns?.length
        ? ep.treatmentGuidance.episodeTurns.map((t) => `    - ${t}`).join('\n')
        : '    - (none authored)';
      const encounters = (ep.plannedEncounters ?? []).length
        ? ep.plannedEncounters!
            .map((e) => `    - encounterId "${e.id}": ${e.type} — ${e.description} (difficulty ${e.difficulty})`)
            .join('\n')
        : '    - (none)';
      return [
        `Episode ${ep.episodeNumber}: "${ep.title}"`,
        `  7-point role: ${role}${beat ? ` — beat: "${beat}"` : ''}`,
        `  Synopsis: ${ep.synopsis}`,
        `  Authored turns:\n${turns}`,
        `  Planned encounters (MUST each appear as one kind:"encounter" scene):\n${encounters}`,
        `  Target scene count: ~${ep.estimatedSceneCount || 5}`,
      ].join('\n');
    })
    .join('\n\n');

  const chains = (plan.consequenceChains ?? [])
    .flatMap((c) => (c.consequences ?? []).map((q) => `  - Episode ${c.origin.episodeNumber} plants "${c.origin.description}" → pays off Episode ${q.episodeNumber}`))
    .join('\n');

  return `You are the season's scene planner. Plan the SCENES for every episode of this season.

A scene is the unit of story. Each scene must do one clear dramatic job and must know its place
relative to the others — what it sets up and what it pays off. Beats are NOT planned here; they are
written later to serve the scene. Encounters ARE scenes (kind:"encounter").

SEASON 7-POINT SPINE (a meta-concept that lives at the season level):
  hook: ${sevenPoint?.hook ?? ''}
  plotTurn1: ${sevenPoint?.plotTurn1 ?? ''}
  pinch1: ${sevenPoint?.pinch1 ?? ''}
  midpoint: ${sevenPoint?.midpoint ?? ''}
  pinch2: ${sevenPoint?.pinch2 ?? ''}
  climax: ${sevenPoint?.climax ?? ''}
  resolution: ${sevenPoint?.resolution ?? ''}

Each EPISODE serves exactly ONE of the 7 points (its role). Each SCENE you author must serve the
purpose its episode's role names. Scenes do NOT carry a 7-point label.

EPISODES:
${episodeBlocks}

CROSS-EPISODE SETUP → PAYOFF (wire these via scene setsUp/paysOff):
${chains || '  - (none specified; infer reasonable setups/payoffs from synopses)'}

RULES:
- Author 3–8 scenes per episode (honor the target). Order them as they will be played.
- Each scene: a SPECIFIC dramatic event, not a placeholder. Give the WHY relative to other scenes.
- narrativeRole ∈ {setup, development, turn, payoff, release}.
- Every planned encounter must appear as exactly one scene with kind:"encounter" and its encounterId.
- setsUp/paysOff reference OTHER scene ids. A setup must pay off in the SAME or a LATER episode — never earlier.
- Use stable scene ids like "s<episode>-<n>" for standard scenes; use the encounterId for encounter scenes.

BUDGET INTENT (declare the dramatic "diet" of each unit — the season balances these later):
- Not every scene carries a player choice. Set "hasChoice": true ONLY where the scene presents a real
  player choice that matters; quiet connective scenes have no choice. Encounters ALWAYS carry a choice.
- When hasChoice is true, declare a "choiceType":
    expression   = voice / self-expression, NO real stakes (only for quiet standard scenes)
    relationship = the choice reshapes a bond with an NPC
    strategic    = a tactical/resource decision with practical fallout
    dilemma      = a moral pressure where every option costs something
  Budget the spine, not the texture: one central choice per choice scene. Aim for a season that leans
  toward expression/relationship in quiet scenes and strategic/dilemma under pressure.
- ENCOUNTERS are stakes-driven: choiceType MUST be one of {relationship, strategic, dilemma} — NEVER
  "expression" — and hasChoice is implicitly true. Pick the role the encounter applies hardest
  (tactical pressure => strategic; a bond tested under fire => relationship; a no-win moral cost => dilemma).
- Declare a "consequenceTier" for each choice-bearing unit — how far its outcome reaches:
    callback  = remembered later in dialogue/flavor, no mechanical fork
    tint      = colors a later scene's tone/state without forking the path
    branchlet = a small, reconverging fork
    branch    = a major, lasting path split
  Invariants you MUST respect: an "expression" choice is always "callback"; a "dilemma" reaches at least
  "branchlet"; an ENCOUNTER's tier is "branch" or "branchlet" (never "callback"/"tint") — a branch-point
  encounter (isBranchPoint) should be "branch".

Return ONLY JSON in this exact shape:
{
  "episodes": [
    {
      "episodeNumber": 1,
      "scenes": [
        {
          "id": "s1-1",
          "kind": "standard",
          "title": "short scene title",
          "dramaticPurpose": "what happens and why it matters relative to other scenes",
          "narrativeRole": "setup",
          "location": "where",
          "npcs": ["npcId"],
          "stakes": "what is at risk",
          "hasChoice": true,
          "choiceType": "relationship",
          "consequenceTier": "tint",
          "setsUp": ["s3-2"],
          "paysOff": []
        }
      ]
    }
  ]
}`;
}

// ========================================
// NORMALIZATION
// ========================================

interface RawScene {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  dramaticPurpose?: unknown;
  narrativeRole?: unknown;
  location?: unknown;
  npcs?: unknown;
  stakes?: unknown;
  setsUp?: unknown;
  paysOff?: unknown;
  encounterId?: unknown;
  hasChoice?: unknown;
  choiceType?: unknown;
  consequenceTier?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

function roleFor(value: unknown, index: number, count: number, isEncounter: boolean): SceneNarrativeRole {
  const raw = str(value) as SceneNarrativeRole | undefined;
  if (raw && VALID_ROLES.has(raw)) return raw;
  if (isEncounter) return 'turn';
  if (index === 0) return 'setup';
  if (index === count - 1) return 'release';
  return 'development';
}

/** Captured per-unit budget intent for one scene, post-sanitization/invariant enforcement. */
interface BudgetIntent {
  hasChoice: boolean;
  choiceType?: ChoiceType;
  consequenceTier?: ConsequenceTier;
  budgetWeight: number;
}

/**
 * Sanitize the authored budget fields (hasChoice/choiceType/consequenceTier) for one
 * unit and enforce the per-unit invariants — encounters always carry a non-expression
 * choice with a branch/branchlet tier; expression always resolves to a callback; a
 * dilemma reaches at least branchlet. This captures validated AUTHORED intent only;
 * hitting the season-wide targets is the allocator's job.
 */
function budgetIntentFor(rs: RawScene, isEncounter: boolean): BudgetIntent {
  const rawType = str(rs.choiceType) as ChoiceType | undefined;
  let choiceType = rawType && VALID_CHOICE_TYPES.has(rawType) ? rawType : undefined;
  // Encounters always carry a choice; standard scenes only if the model said so.
  const hasChoice = isEncounter || rs.hasChoice === true || choiceType != null;

  if (isEncounter) {
    // Encounters are stakes-driven: never 'expression'. Fall back to 'strategic'.
    if (!choiceType || !ENCOUNTER_CHOICE_TYPES.has(choiceType)) choiceType = 'strategic';
  } else if (!hasChoice) {
    // No choice => no choice-type or tier to budget.
    return { hasChoice: false, budgetWeight: SCENE_BUDGET_WEIGHT };
  }

  const rawTier = str(rs.consequenceTier) as ConsequenceTier | undefined;
  let consequenceTier = rawTier && VALID_TIERS.has(rawTier) ? rawTier : undefined;

  // Per-unit invariants (the allocator handles global balance, not these).
  if (choiceType === 'expression') {
    consequenceTier = 'callback';
  } else if (isEncounter) {
    // Encounter tier must be branch/branchlet, never callback/tint.
    if (consequenceTier !== 'branch' && consequenceTier !== 'branchlet') {
      consequenceTier = undefined;
    }
  } else if (choiceType === 'dilemma') {
    // Dilemma reaches at least branchlet.
    if (consequenceTier === 'callback' || consequenceTier === 'tint') {
      consequenceTier = undefined;
    }
  }

  return {
    hasChoice,
    choiceType,
    consequenceTier,
    budgetWeight: isEncounter ? ENCOUNTER_BUDGET_WEIGHT : SCENE_BUDGET_WEIGHT,
  };
}

/**
 * Normalize a raw LLM scene-plan response into a validated SeasonScenePlan, or
 * return null if it can't be made valid (caller falls back to deterministic).
 */
export function normalizeAuthoredScenePlan(raw: unknown, plan: SeasonPlan): SeasonScenePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const episodesRaw = (raw as { episodes?: unknown }).episodes;
  if (!Array.isArray(episodesRaw)) return null;

  const rawByEpisode = new Map<number, RawScene[]>();
  for (const epRaw of episodesRaw) {
    if (!epRaw || typeof epRaw !== 'object') continue;
    const num = (epRaw as { episodeNumber?: unknown }).episodeNumber;
    const scenes = (epRaw as { scenes?: unknown }).scenes;
    if (typeof num === 'number' && Array.isArray(scenes)) {
      rawByEpisode.set(num, scenes as RawScene[]);
    }
  }

  const scenesByEpisode = new Map<number, PlannedScene[]>();

  for (const ep of [...plan.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)) {
    const rawScenes = rawByEpisode.get(ep.episodeNumber);
    if (!rawScenes || rawScenes.length === 0) {
      // Gap fill: deterministic scenes for an episode the model skipped.
      scenesByEpisode.set(ep.episodeNumber, buildEpisodeScenes(ep, sevenPointTextForEpisode(plan, ep)));
      continue;
    }
    scenesByEpisode.set(ep.episodeNumber, normalizeEpisodeScenes(ep, rawScenes));
  }

  // Flatten and clean the cross-scene graph.
  const allScenes = [...scenesByEpisode.values()].flat();
  const idToEpisode = new Map(allScenes.map((s) => [s.id, s.episodeNumber]));
  const allIds = new Set(allScenes.map((s) => s.id));

  // setsUp is the source of truth: keep valid forward refs, then rebuild paysOff.
  for (const s of allScenes) {
    s.setsUp = unique(
      s.setsUp.filter((t) => allIds.has(t) && t !== s.id && (idToEpisode.get(t) ?? 0) >= s.episodeNumber),
    );
    s.paysOff = [];
  }
  const byId = new Map(allScenes.map((s) => [s.id, s]));
  const edges: SetupPayoffEdge[] = [];
  for (const s of allScenes) {
    for (const target of s.setsUp) {
      const to = byId.get(target);
      if (!to) continue;
      if (!to.paysOff.includes(s.id)) to.paysOff.push(s.id);
      edges.push({
        from: s.id,
        to: target,
        span: to.episodeNumber === s.episodeNumber ? 'same_episode' : 'cross_episode',
      });
    }
  }

  const scenes: PlannedScene[] = [];
  const byEpisode: Record<number, string[]> = {};
  for (const ep of [...plan.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)) {
    const epScenes = scenesByEpisode.get(ep.episodeNumber) ?? [];
    byEpisode[ep.episodeNumber] = epScenes.map((s) => s.id);
    scenes.push(...epScenes);
  }

  const scenePlan: SeasonScenePlan = { scenes, byEpisode, setupPayoffEdges: edges };

  // Reject an unrecoverable plan so the caller keeps the deterministic one.
  const result = new SceneSpineValidator().validate(scenePlan);
  if (!result.valid) return null;
  return scenePlan;
}

/** Normalize one episode's raw scenes, guaranteeing encounter coverage. */
function normalizeEpisodeScenes(ep: SeasonEpisode, rawScenes: RawScene[]): PlannedScene[] {
  const encountersById = new Map((ep.plannedEncounters ?? []).map((e) => [e.id, e]));
  const usedEncounterIds = new Set<string>();
  const actLabel = ep.treatmentGuidance?.actLabel;
  const arcLabel = ep.treatmentGuidance?.arcLabel;
  const built: PlannedScene[] = [];

  rawScenes.forEach((rs, index) => {
    const encounterIdRef = str(rs.encounterId);
    const wantsEncounter = str(rs.kind) === 'encounter' || (encounterIdRef != null && encountersById.has(encounterIdRef));
    let id: string;
    let encounter: PlannedScene['encounter'];

    if (wantsEncounter) {
      const matched = (encounterIdRef && encountersById.get(encounterIdRef))
        || (ep.plannedEncounters ?? []).find((e) => !usedEncounterIds.has(e.id));
      if (matched) {
        id = matched.id;
        encounter = toSceneEncounter(matched);
        usedEncounterIds.add(matched.id);
      } else {
        id = str(rs.id) || `s${ep.episodeNumber}-${index + 1}`;
      }
    } else {
      id = str(rs.id) || `s${ep.episodeNumber}-${index + 1}`;
    }

    const isEncounter = Boolean(encounter);
    const budget = budgetIntentFor(rs, isEncounter);
    built.push({
      id,
      episodeNumber: ep.episodeNumber,
      order: built.length,
      kind: isEncounter ? 'encounter' : 'standard',
      title: str(rs.title) || `Scene ${index + 1}`,
      dramaticPurpose: str(rs.dramaticPurpose) || str(rs.title) || ep.synopsis,
      narrativeRole: roleFor(rs.narrativeRole, index, rawScenes.length, isEncounter),
      locations: str(rs.location) ? [str(rs.location)!] : (ep.locations ?? []).slice(0, 1),
      npcsInvolved: strArray(rs.npcs).length ? strArray(rs.npcs) : (ep.mainCharacters ?? []).slice(0, 3),
      setsUp: strArray(rs.setsUp),
      paysOff: strArray(rs.paysOff),
      stakes: str(rs.stakes) || ep.synopsis,
      actLabel,
      arcLabel,
      encounter,
      hasChoice: budget.hasChoice,
      choiceType: budget.choiceType,
      consequenceTier: budget.consequenceTier,
      budgetWeight: budget.budgetWeight,
    });
  });

  // Guarantee every planned encounter appears as a scene (append any the model dropped).
  for (const enc of ep.plannedEncounters ?? []) {
    if (usedEncounterIds.has(enc.id)) continue;
    const sceneEncounter = toSceneEncounter(enc);
    // No authored intent for a dropped encounter: derive encounter defaults, but
    // honor isBranchPoint by preferring a hard 'branch' tier for branch-point encounters.
    const budget = budgetIntentFor(
      { consequenceTier: sceneEncounter.isBranchPoint ? 'branch' : undefined },
      true,
    );
    built.push({
      id: enc.id,
      episodeNumber: ep.episodeNumber,
      order: built.length,
      kind: 'encounter',
      title: enc.description?.slice(0, 60) || `encounter ${enc.id}`,
      dramaticPurpose: `Encounter: ${enc.description}`,
      narrativeRole: 'turn',
      locations: (ep.locations ?? []).slice(0, 1),
      npcsInvolved: enc.npcsInvolved ?? [],
      setsUp: [],
      paysOff: [],
      stakes: enc.stakes,
      actLabel,
      arcLabel,
      encounter: sceneEncounter,
      hasChoice: budget.hasChoice,
      choiceType: budget.choiceType,
      consequenceTier: budget.consequenceTier,
      budgetWeight: budget.budgetWeight,
    });
    usedEncounterIds.add(enc.id);
  }

  // Renumber order contiguously (ids may have been reused for encounters).
  built.forEach((s, i) => {
    s.order = i;
  });
  return built;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
