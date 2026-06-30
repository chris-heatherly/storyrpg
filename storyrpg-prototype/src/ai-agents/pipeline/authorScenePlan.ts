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
  MechanicPressureContract,
  MechanicPressureDomain,
  MechanicPressureFunction,
  MechanicPressureSource,
  PlannedScene,
  SceneTurnContract,
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
  bindAuthoredTurnsToScenes,
  buildEpisodeScenes,
  encounterIsCoveredByAuthoredTurns,
  getAuthoredEpisodeEventTexts,
  legacyStructureTextForEpisode,
  toSceneEncounter,
  MIN_SCENES_PER_EPISODE,
  promoteCoveredAuthoredEncounters,
} from './seasonScenePlanBuilder';
import { SceneSpineValidator } from '../validators/SceneSpineValidator';
import { assignSeasonPromiseContractsToScenes } from '../utils/seasonPromiseContracts';
import { assignCharacterTreatmentContractsToScenes } from '../utils/characterTreatmentContracts';
import { assignStakesArchitectureContractsToScenes } from '../utils/stakesArchitectureContracts';
import { assignArcPressureContractsToScenes } from '../utils/arcPressureContracts';
import { assignWorldTreatmentContractsToScenes } from '../utils/worldTreatmentContracts';
import { assignStoryCircleBeatContractsToScenes } from '../utils/storyCircleBeatContracts';

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
  const legacyStructure = plan.legacyStructure;
  // Treatment-sourced run: any episode carries authored turns. When true, the
  // authored turns/signature moments/encounter anchors are FIXED required beats
  // and the model dramatizes them — it does not re-design the episode (§5).
  const isTreatmentSourced = plan.episodes.some(
    (ep) => (ep.treatmentGuidance?.episodeTurns?.length ?? 0) > 0,
  );

  const episodeBlocks = [...plan.episodes]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((ep) => {
      const beat = legacyStructureTextForEpisode(plan, ep);
      const role = ep.structuralRole?.join(' / ') || 'rising/falling buffer';
      const authoredTurns = ep.treatmentGuidance?.episodeTurns ?? [];
      // Treatment runs: render turns as a NUMBERED required-beat checklist (FIXED,
      // must be depicted in order). Non-treatment runs keep the soft advisory list.
      const turns = authoredTurns.length
        ? authoredTurns
            .map((t, i) => (isTreatmentSourced ? `    ${i + 1}. [REQUIRED BEAT] ${t}` : `    - ${t}`))
            .join('\n')
        : '    - (none authored)';
      const signature = ep.treatmentGuidance?.visualAnchor
        ? `  Signature moment (MUST be depicted, never inverted): ${ep.treatmentGuidance.visualAnchor}\n`
        : '';
      const encounters = (ep.plannedEncounters ?? []).length
        ? ep.plannedEncounters!
            .map((e) => `    - encounterId "${e.id}": ${e.type} — ${e.description} (difficulty ${e.difficulty})`)
            .join('\n')
        : '    - (none)';
      const turnsLabel = isTreatmentSourced
        ? 'REQUIRED BEATS (FIXED — depict every one, in order; do NOT add/drop/re-order/re-interpret)'
        : 'Authored turns';
      return [
        `Episode ${ep.episodeNumber}: "${ep.title}"`,
        `  legacy-structure role: ${role}${beat ? ` — beat: "${beat}"` : ''}`,
        `  Synopsis: ${ep.synopsis}`,
        `${signature}  ${turnsLabel}:\n${turns}`,
        `  Planned encounters (MUST each appear as one kind:"encounter" scene):\n${encounters}`,
        `  Target scene count: ~${ep.estimatedSceneCount || 5}`,
      ].join('\n');
    })
    .join('\n\n');

  const chains = (plan.consequenceChains ?? [])
    .flatMap((c) => (c.consequences ?? []).map((q) => `  - Episode ${c.origin.episodeNumber} plants "${c.origin.description}" → pays off Episode ${q.episodeNumber}`))
    .join('\n');
  const seasonPromiseContracts = (plan.seasonPromiseContracts ?? [])
    .map((contract) => `  - ${contract.contractKind}: ${contract.sourceText} (target episodes ${contract.targetEpisodeNumbers.join(', ') || 'infer from story pressure'})`)
    .join('\n');
  const stakesArchitectureContracts = (plan.stakesArchitectureContracts ?? [])
    .map((contract) => `  - ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText} (target episodes ${contract.targetEpisodeNumbers.join(', ') || 'infer from stakes pressure'})`)
    .join('\n');
  const storyCircleBeatContracts = (plan.storyCircleBeatContracts ?? [])
    .map((contract) => `  - ${contract.beat}: ${contract.sourceText} (target episode ${contract.targetEpisodeNumber ?? 'infer from spine'}; atoms: ${contract.eventAtoms.join(' | ') || contract.sourceText})`)
    .join('\n');
  const arcPressureContracts = (plan.arcPressureContracts ?? [])
    .map((contract) => `  - ${contract.arcTitle} / ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText} (target episodes ${contract.targetEpisodeNumbers.join(', ') || 'infer from arc pressure'}; atoms: ${contract.eventAtoms.join(' | ') || contract.sourceText})`)
    .join('\n');
  const worldTreatmentContracts = (plan.worldTreatmentContracts ?? [])
    .map((contract) => `  - ${contract.fieldName} (${contract.contractKind}${contract.locationName ? ` @ ${contract.locationName}` : ''}): ${contract.sourceText} (target episodes ${contract.targetEpisodeNumbers.join(', ') || 'infer from location use'})`)
    .join('\n');

  const framing = isTreatmentSourced
    ? `You are dramatizing an ALREADY-AUTHORED season into scenes. The episodes, their order and
titles, their legacy-structure roles, their REQUIRED BEATS (authored turns), their signature moments, and
their encounter anchors are FIXED. Your job is to produce scenes that DEPICT every required beat in
its authored order — one clear dramatic job per scene — and to INVENT ONLY the connective tissue:
transitions, sensory texture, NPC micro-beats, and prose framing between the fixed beats. You may
add connective scenes where pacing needs them, but you must NOT add, drop, re-order, merge, split,
or re-interpret a required beat, and you must NOT relocate a beat to a different episode. Where the
treatment is silent, sensible invention is expected; where it speaks, it wins. Beats (prose units)
are written later to serve the scene. Encounters ARE scenes (kind:"encounter").`
    : `You are the season's scene planner. Plan the SCENES for every episode of this season.

A scene is the unit of story. Each scene must do one clear dramatic job and must know its place
relative to the others — what it sets up and what it pays off. Beats are NOT planned here; they are
written later to serve the scene. Encounters ARE scenes (kind:"encounter").`;

  return `${framing}

SEASON 7-POINT SPINE (a meta-concept that lives at the season level):
  hook: ${legacyStructure?.hook ?? ''}
  plotTurn1: ${legacyStructure?.plotTurn1 ?? ''}
  pinch1: ${legacyStructure?.pinch1 ?? ''}
  midpoint: ${legacyStructure?.midpoint ?? ''}
  pinch2: ${legacyStructure?.pinch2 ?? ''}
  climax: ${legacyStructure?.climax ?? ''}
  resolution: ${legacyStructure?.resolution ?? ''}

Each EPISODE serves exactly ONE of the legacy structural beats (its role). Each SCENE you author must serve the
purpose its episode's role names. Scenes do NOT carry a legacy-structure label.

EPISODES:
${episodeBlocks}

CROSS-EPISODE SETUP → PAYOFF (wire these via scene setsUp/paysOff):
${chains || '  - (none specified; infer reasonable setups/payoffs from synopses)'}

TOP-LEVEL SEASON PROMISE CONTRACTS (assign these to concrete scenes, choices, encounters, information moves, consequences, or endings):
${seasonPromiseContracts || '  - (none explicit; infer promise pressure from the season architecture)'}

STAKES ARCHITECTURE CONTRACTS (assign these to concrete scenes, choices, encounters, information moves, consequence chains, or endings):
${stakesArchitectureContracts || '  - (none explicit; infer material/relational/identity/existential stakes from the season architecture)'}

SEVEN-POINT BEAT REALIZATION CONTRACTS (assign authored beat content to concrete scenes; the structural label alone is not enough):
${storyCircleBeatContracts || '  - (none explicit; use the season spine text as guidance)'}

ARC PRESSURE TREATMENT CONTRACTS (assign authored arc question/reframe/crisis/finale/handoff/turnout pressure to concrete scenes):
${arcPressureContracts || '  - (none explicit; use SeasonArc pressure architecture as guidance)'}

WORLD/LOCATION TREATMENT CONTRACTS (assign these to concrete locations, scene turns, choices, encounters, information moves, or mechanic pressure):
${worldTreatmentContracts || '  - (none explicit; infer setting pressure from the world bible)'}

RULES:
- Author 3–8 scenes per episode (honor the target). Order them as they will be played.
- Each scene: a SPECIFIC dramatic event, not a placeholder. Give the WHY relative to other scenes.
- narrativeRole ∈ {setup, development, turn, payoff, release}.
- Each season-promise contract must become staged evidence somewhere: visible premise/core fantasy, genre/tone movement, theme pressure, or inaction cost. Do not copy contract labels into prose.
- Each stakes architecture contract must become staged pressure somewhere: material cost/access/resource, relational risk, identity test, existential threat, escalation step, prerequisite setup, or emotional anchor. Do not copy stake labels into prose.
- Each Story Circle beat realization contract must become a specific scene event/state change. Hook/Plot Turn/Pinch/Midpoint/Climax/Resolution labels are not prose; stage the authored beat atoms.
- Each arc pressure contract must become causal story movement somewhere in its target episode: the arc question is tested, the Lie facet is pressured, the midpoint reframes, the late crisis costs/narrows options, the finale answers, the handoff leaves residue, or the episode turnout changes state.
- Each world/location contract must become staged evidence where relevant: location purpose, authored rule pressure, faction leverage, taboo/cost, or choice pressure. Do not use authored locations as generic backdrops.
- Treat each scene as one spatial unit with exactly one primary dramatic location. A major named location change creates a new scene; the current scene may only hand off to the next location if no major introduction, relationship turn, encounter, clue reveal, or choice happens there.
- Do not compress venue arrival, travel, exterior access, interior/social table, aftermath, and home/blog reflection into one scene. Micro-transitions such as sidewalk, hallway, threshold, car ride, or doorway can be handoff texture only.
- A major NPC introduction must get its own on-page beat at the scene's primary location. Do not introduce one major NPC and immediately jump venue, form a group identity, exchange private contact, or advance to friendship/trust/intimacy in the same beat.
- Every planned encounter must appear as exactly one scene with kind:"encounter" and its encounterId.
- setsUp/paysOff reference OTHER scene ids. A setup must pay off in the SAME or a LATER episode — never earlier.
- Use stable scene ids like "s<episode>-<n>" for standard scenes; use the encounterId for encounter scenes.
- If a scene forms or advances a bond, author it as paced relationship movement: instant chemistry, joke, attraction, invitation, or testing is allowed; friendship, trust, intimacy, private contact, and group membership must be earned by prior full-scene evidence, relationship choices, relationship consequences, and relationshipValueEvidence.
- Relationship movement must have a McKee-square value turn or be explicitly quiet setup: care with agency, withheld care, active hostility, or control/coercion disguised as care. Do not ask the prose model to invent final relationship truth; plan the scene-local evidence that earns the move.

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
          "centralTurn": "the one dramatic turn this scene is built around: before-state changes because of a concrete event, reveal, choice, or consequence",
          "beforeState": "what is true at the start before the turn lands",
          "turnEvent": "the visible action/reveal/choice that bends the scene",
          "afterState": "what has changed after the turn",
          "handoff": "how this scene's changed state leads into the next scene",
          "relationshipPacing": [
            {
              "npcId": "npcId or omit for a group contract",
              "groupId": "groupId only for named group identity",
              "startStage": "unmet|noticed|spark|acquaintance|tentative_ally|friend|trusted_ally|intimate",
              "targetStage": "spark",
              "allowedLabels": ["spark", "invitation", "new acquaintance"],
              "blockedLabels": ["friend", "trusted ally", "inner circle"],
              "requiredEvidence": ["show behavior before naming the bond"],
              "minScenesSinceIntroduction": 1,
              "maxDeltaThisScene": 6,
              "mechanicDimensions": ["trust", "affection"]
            }
          ],
          "mechanicPressure": [
            {
              "id": "s1-1-pressure-keycard",
              "source": "treatment|planner|choice|encounter|arc|callback",
              "domain": "relationship|identity|skill|flag|score|item|route|encounter|information|resource|reputation",
              "function": "plant|intensify|gate|spend|payoff|complicate|resolve",
              "storyPressure": "what fictional pressure the hidden mechanic tracks",
              "evidenceRequired": ["what must be shown on-page to earn it"],
              "visibleResidue": ["what changes immediately in prose/choice wording/NPC posture"],
              "allowedPayoffs": ["what future turn/route/affordance this permits"],
              "blockedPayoffs": ["what this pressure cannot justify yet"]
            }
          ],
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
  centralTurn?: unknown;
  beforeState?: unknown;
  turnEvent?: unknown;
  afterState?: unknown;
  handoff?: unknown;
  setsUp?: unknown;
  paysOff?: unknown;
  encounterId?: unknown;
  hasChoice?: unknown;
  choiceType?: unknown;
  consequenceTier?: unknown;
  mechanicPressure?: unknown;
}

function rawTurnContract(sceneId: string, rs: RawScene, source: SceneTurnContract['source']): SceneTurnContract | undefined {
  const centralTurn = str(rs.centralTurn) || str(rs.turnEvent);
  if (!centralTurn) return undefined;
  return {
    turnId: `${sceneId}-turn`,
    source,
    centralTurn,
    beforeState: str(rs.beforeState) || `Before the turn, the scene is still governed by: ${str(rs.dramaticPurpose) || str(rs.stakes) || str(rs.title) || centralTurn}.`,
    turnEvent: str(rs.turnEvent) || centralTurn,
    afterState: str(rs.afterState) || 'The scene ends in a changed state.',
    handoff: str(rs.handoff) || 'Hand the changed state into visible pressure.',
  };
}

const MECHANIC_PRESSURE_DOMAINS: ReadonlySet<MechanicPressureDomain> = new Set([
  'relationship', 'identity', 'skill', 'flag', 'score', 'item', 'route', 'encounter', 'information', 'resource', 'reputation',
]);
const MECHANIC_PRESSURE_FUNCTIONS: ReadonlySet<MechanicPressureFunction> = new Set([
  'plant', 'intensify', 'gate', 'spend', 'payoff', 'complicate', 'resolve',
]);
const MECHANIC_PRESSURE_SOURCES: ReadonlySet<MechanicPressureSource> = new Set([
  'treatment', 'planner', 'choice', 'encounter', 'arc', 'callback',
]);

function rawMechanicPressure(sceneId: string, rs: RawScene): MechanicPressureContract[] | undefined {
  const raw = Array.isArray(rs.mechanicPressure) ? rs.mechanicPressure : [];
  const contracts: MechanicPressureContract[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const rec = entry as Record<string, unknown>;
    const domain = str(rec.domain) as MechanicPressureDomain | undefined;
    const fn = str(rec.function) as MechanicPressureFunction | undefined;
    const source = str(rec.source) as MechanicPressureSource | undefined;
    const storyPressure = str(rec.storyPressure);
    if (!domain || !MECHANIC_PRESSURE_DOMAINS.has(domain) || !storyPressure) return;
    contracts.push({
      id: str(rec.id) || `${sceneId}-pressure-${index + 1}-${domain}`,
      source: source && MECHANIC_PRESSURE_SOURCES.has(source) ? source : 'planner',
      domain,
      mechanicRef: {},
      function: fn && MECHANIC_PRESSURE_FUNCTIONS.has(fn) ? fn : 'plant',
      storyPressure,
      evidenceRequired: strArray(rec.evidenceRequired),
      visibleResidue: strArray(rec.visibleResidue),
      allowedPayoffs: strArray(rec.allowedPayoffs),
      blockedPayoffs: strArray(rec.blockedPayoffs),
      originatingSceneId: sceneId,
    });
  });
  return contracts.length > 0 ? contracts : undefined;
}

function nextUnusedStandardSceneId(ep: SeasonEpisode, scenes: PlannedScene[]): string {
  const used = new Set(scenes.map((s) => s.id));
  for (let i = 1; i < 99; i += 1) {
    const id = `s${ep.episodeNumber}-${i}`;
    if (!used.has(id)) return id;
  }
  return `s${ep.episodeNumber}-turn-${used.size + 1}`;
}

function ensureAuthoredTurnSceneCapacity(ep: SeasonEpisode, scenes: PlannedScene[]): void {
  const turns = ep.treatmentGuidance?.episodeTurns?.filter((turn) => turn.trim()) ?? [];
  if (turns.length === 0) return;
  const eligible = () => scenes.filter((s) => s.kind !== 'encounter' && s.narrativeRole !== 'release');
  while (eligible().length < turns.length) {
    const turn = turns[eligible().length];
    const id = nextUnusedStandardSceneId(ep, scenes);
    const insertAt = scenes.findIndex((s) => s.narrativeRole === 'release');
    const order = insertAt >= 0 ? insertAt : scenes.length;
    const added: PlannedScene = {
      id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'standard',
      title: `Authored turn ${eligible().length + 1}`,
      dramaticPurpose: `Dramatize the authored episode turn as the dramatic center: ${turn}`,
      narrativeRole: 'turn',
      locations: (ep.locations ?? []).slice(0, 1),
      npcsInvolved: (ep.mainCharacters ?? []).slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: ep.synopsis,
      hasChoice: true,
      budgetWeight: SCENE_BUDGET_WEIGHT,
      turnContract: {
        turnId: `${id}-turn`,
        source: 'treatment',
        centralTurn: turn,
        beforeState: 'Establish where the player is, who is present, and what pressure makes the authored turn happen.',
        turnEvent: turn,
        afterState: 'Show the immediate emotional, social, practical, or informational consequence of the authored turn.',
        handoff: 'Provide aftermath or a grounded consequence that carries the moment forward.',
      },
    };
    if (insertAt >= 0) scenes.splice(insertAt, 0, added);
    else scenes.push(added);
    scenes.forEach((scene, index) => { scene.order = index; });
  }
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
export function normalizeAuthoredScenePlan(
  raw: unknown,
  plan: SeasonPlan,
  opts: {
    /**
     * Minimum scenes an authored episode must carry; an episode below this floor
     * is rebuilt deterministically (same mechanism as a model-skipped episode).
     * Opt-in — omit (or 0) to preserve prior behavior. Pipeline runs pass
     * {@link MIN_SCENES_PER_EPISODE} so a branchable episode is never under-sized.
     */
    minScenesPerEpisode?: number;
  } = {},
): SeasonScenePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const episodesRaw = (raw as { episodes?: unknown }).episodes;
  if (!Array.isArray(episodesRaw)) return null;
  const minScenesPerEpisode = opts.minScenesPerEpisode ?? 0;

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
      scenesByEpisode.set(ep.episodeNumber, buildEpisodeScenes(ep, legacyStructureTextForEpisode(plan, ep), plan.informationLedger, plan.protagonist));
      continue;
    }
    const normalized = normalizeEpisodeScenes(ep, rawScenes, plan.informationLedger, plan.protagonist);
    // Floor guard: an authored episode below the structural minimum (the model
    // returned e.g. only a setup + an encounter) is too small to carry a
    // scene-graph branch and hard-aborts at branch validation downstream
    // (bite-me-g13 2026-06-13: ep1 came back as 2 scenes). Rebuild THAT episode
    // from the deterministic spine — the same gap-fill mechanism used for a
    // skipped episode — so adequately-sized authored episodes are untouched and
    // golden parity holds (only fires when the floor is requested AND violated).
    if (normalized.length < minScenesPerEpisode) {
      scenesByEpisode.set(ep.episodeNumber, buildEpisodeScenes(ep, legacyStructureTextForEpisode(plan, ep), plan.informationLedger, plan.protagonist));
      continue;
    }
    scenesByEpisode.set(ep.episodeNumber, normalized);
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
  const seasonPromiseContracts = assignSeasonPromiseContractsToScenes(plan, scenes);
  const storyCircleBeatContracts = assignStoryCircleBeatContractsToScenes(plan, scenes);
  const arcPressureContracts = assignArcPressureContractsToScenes(plan, scenes);
  const characterTreatmentContracts = assignCharacterTreatmentContractsToScenes(plan, scenes);
  const worldTreatmentContracts = assignWorldTreatmentContractsToScenes(plan, scenes);
  const stakesArchitectureContracts = assignStakesArchitectureContractsToScenes(plan, scenes);

  const scenePlan: SeasonScenePlan = {
    scenes,
    byEpisode,
    setupPayoffEdges: edges,
    seasonPromiseContracts,
    storyCircleBeatContracts,
    arcPressureContracts,
    stakesArchitectureContracts,
    characterTreatmentContracts,
    worldTreatmentContracts,
  };

  // Reject an unrecoverable plan so the caller keeps the deterministic one.
  const result = new SceneSpineValidator().validate(scenePlan);
  if (!result.valid) return null;
  return scenePlan;
}

/** Normalize one episode's raw scenes, guaranteeing encounter coverage. */
function normalizeEpisodeScenes(
  ep: SeasonEpisode,
  rawScenes: RawScene[],
  infoLedger?: NonNullable<SeasonPlan['informationLedger']>,
  protagonist?: SeasonPlan['protagonist'],
): PlannedScene[] {
  const encountersById = new Map((ep.plannedEncounters ?? []).map((e) => [e.id, e]));
  const usedEncounterIds = new Set<string>();
  const authoredEventTexts = getAuthoredEpisodeEventTexts(ep);
  const coveredEncounterIds = new Set(
    (ep.plannedEncounters ?? [])
      .filter((enc) => encounterIsCoveredByAuthoredTurns(enc, authoredEventTexts))
      .map((enc) => enc.id),
  );
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
      turnContract: rawTurnContract(id, rs, isEncounter ? 'encounter' : (budget.hasChoice ? 'choice' : 'planner')),
      mechanicPressure: rawMechanicPressure(id, rs),
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
    if (coveredEncounterIds.has(enc.id)) continue;
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
      turnContract: {
        turnId: `${enc.id}-turn`,
        source: 'encounter',
        centralTurn: enc.centralConflict || enc.description || enc.stakes || `Encounter ${enc.id}`,
        beforeState: `Before the encounter turns, the player understands the stakes: ${enc.stakes || enc.description}.`,
        turnEvent: enc.centralConflict || enc.description || enc.stakes || `Encounter ${enc.id}`,
        afterState: enc.aftermathConsequence || 'The encounter outcome leaves visible fallout, cost, or changed leverage.',
        handoff: 'Resolve the encounter into a clear consequence, aftermath beat, or sharpened pressure.',
      },
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
  ensureAuthoredTurnSceneCapacity(ep, built);

  // Bind the authored turns + signature device deterministically onto the LLM
  // scenes. The model's prose framing of the turns rides in dramaticPurpose; the
  // AUTHORITATIVE required-beat binding is derived from the treatment here so a
  // treatment-sourced run carries discrete requiredBeats + a signatureMoment
  // regardless of what the model returned (§3.2 / §5). Shared with the
  // deterministic path via the same helper.
  bindAuthoredTurnsToScenes(ep, built, infoLedger, protagonist);
  promoteCoveredAuthoredEncounters(ep, built, coveredEncounterIds);
  return built;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
