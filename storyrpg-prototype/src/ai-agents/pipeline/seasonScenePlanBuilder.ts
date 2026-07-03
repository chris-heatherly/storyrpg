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
 * already carries (per-episode `storyCircleRole`, `plannedEncounters`,
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
  MechanicPressureContract,
  MechanicPressureDomain,
  MechanicPressureSource,
  RelationshipPacingContract,
  RequiredBeat,
  SceneNarrativeRole,
  SceneTurnContract,
  SeasonScenePlan,
  SetupPayoffEdge,
} from '../../types/scenePlan';
import { SCENE_BUDGET_WEIGHT, ENCOUNTER_BUDGET_WEIGHT } from '../../types/scenePlan';
import { assignTreatmentFieldContractsToScenes } from '../utils/treatmentFieldContracts';
import { atomizeTreatmentText } from '../utils/treatmentEventAtomizer';
import { assignSeasonPromiseContractsToScenes } from '../utils/seasonPromiseContracts';
import { assignCharacterTreatmentContractsToScenes } from '../utils/characterTreatmentContracts';
import { assignStakesArchitectureContractsToScenes } from '../utils/stakesArchitectureContracts';
import { assignArcPressureContractsToScenes } from '../utils/arcPressureContracts';
import { assignWorldTreatmentContractsToScenes } from '../utils/worldTreatmentContracts';
import { assignBranchConsequenceContractsToScenes } from '../utils/branchConsequenceContracts';
import { assignEndingRealizationContractsToScenes } from '../utils/endingRealizationContracts';
import { assignFailureModeAuditContractsToScenes } from '../utils/failureModeAuditContracts';
import { assignStoryCircleBeatContractsToScenes } from '../utils/storyCircleBeatContracts';
import {
  buildEncounterEventSignature,
  compareEncounterEventSignatures,
} from '../utils/encounterEventSignature';
import { attachSceneConstructionProfiles } from '../utils/sceneConstructionProfile';
import { attachSceneEventOwnershipProfiles } from '../utils/sceneEventOwnership';
import { finalizeEpisodeSceneOwnership } from '../utils/episodeSceneOwnership';
import { normalizeRelationshipPacingStages } from '../utils/relationshipPacingStagePolicy';
import { rebindPlannedSceneObligations } from '../remediation/plannedSceneObligationBinder';

export const MIN_SCENES_PER_EPISODE = 3;
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

/** Human-readable label for an episode's Story Circle role(s). */
function storyCircleRoleLabel(ep: SeasonEpisode): string {
  const roles = ep.storyCircleRole;
  if (!roles || roles.length === 0) return 'the episode Story Circle loop';
  return roles
    .map((role) => role.roleKind === 'expansion' ? `${role.beat} expansion` : role.beat)
    .join(' / ');
}

/**
 * Truncate a label at a word boundary (≤ maxLength chars, with an ellipsis when
 * cut). Titles are display labels — a mid-word cut ("…set piece (wall bre")
 * reads as corruption when it leaks into prompts and validator messages.
 */
function truncateAtWordBoundary(text: string | undefined, maxLength: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Map a season-level PlannedEncounter onto the encounter sub-object of a scene. */
export function toSceneEncounter(enc: NonNullable<SeasonEpisode['plannedEncounters']>[number]): PlannedSceneEncounter {
  return {
    type: enc.type,
    // The FULL authored description — the scene title is a truncated label and
    // must never be the only surviving copy of the anchor text (G12 endsong).
    description: enc.description,
    style: enc.style,
    difficulty: enc.difficulty,
    relevantSkills: enc.relevantSkills ?? [],
    centralConflict: enc.centralConflict,
    storyCircleTarget: enc.storyCircleTarget,
    storyCircleTargetRationale: enc.storyCircleTargetRationale,
    storyCircleTargetEvidence: enc.storyCircleTargetEvidence,
    aftermathConsequence: enc.aftermathConsequence,
    isBranchPoint: Boolean(enc.isBranchPoint),
    branchOutcomes: enc.branchOutcomes,
  };
}

type EpisodePlannedEncounter = NonNullable<SeasonEpisode['plannedEncounters']>[number];

/**
 * Compose a planning-only dramatic purpose for a scene FRAMING (role + the
 * episode's Story Circle role). It no longer folds the authored episode turns into a
 * single string — authored turns are now first-class {@link RequiredBeat}s bound
 * to the scene that lands them (see {@link buildEpisodeScenes}). Not player-facing.
 */
function composeDramaticPurpose(
  role: SceneNarrativeRole,
  ep: SeasonEpisode,
  storyCircleText: string | undefined,
): string {
  const structuralPressure = episodeLocalStructuralPressure(ep)
    || storyCircleText
    || `${storyCircleRoleLabel(ep)} pressure`;
  switch (role) {
    case 'setup':
      return `Open the episode through its immediate question: ${structuralPressure}.`;
    case 'development':
      return `Escalate the episode pressure through a concrete turn: ${structuralPressure}.`;
    case 'turn':
      return `Reverse or reveal something the scene can no longer hide: ${structuralPressure}.`;
    case 'payoff':
      return `Pay off an earlier setup through visible action: ${structuralPressure}.`;
    case 'release':
      return `Let the fallout settle into the next pressure: ${structuralPressure}.`;
    default:
      return structuralPressure;
  }
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, ' ').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function episodeLocalStructuralPressure(ep: SeasonEpisode): string | undefined {
  const guidance = ep.treatmentGuidance;
  if (!guidance) return undefined;
  const localPressure = uniqueNonEmpty([
    guidance.episodePromise,
    guidance.openingSituation,
    guidance.synopsis,
    guidance.encounterBuildup,
    ...(guidance.majorChoicePressures ?? []),
    guidance.endingPressure,
    guidance.cliffhangerHook,
  ]);
  if (localPressure.length === 0) return undefined;
  return localPressure.slice(0, 4).join(' ');
}

function composeRoleOnlyDramaticPurpose(role: SceneNarrativeRole, ep: SeasonEpisode): string {
  const structuralPressure = `${storyCircleRoleLabel(ep)} pressure`;
  switch (role) {
    case 'setup':
      return `Open the episode through its immediate question: ${structuralPressure}.`;
    case 'development':
      return `Escalate the episode pressure through a concrete turn: ${structuralPressure}.`;
    case 'turn':
      return `Reverse or reveal something the scene can no longer hide: ${structuralPressure}.`;
    case 'payoff':
      return `Pay off an earlier setup through visible action: ${structuralPressure}.`;
    case 'release':
      return `Let the fallout settle into the next pressure: ${structuralPressure}.`;
    default:
      return structuralPressure;
  }
}

/**
 * Build a {@link RequiredBeat} from an authored episode turn. Turns are
 * `authored`-tier (must occur, in order); the season planner can later promote a
 * staged device to `signature` via {@link PlannedScene.signatureMoment}.
 */
function requiredBeatFromTurn(sceneId: string, beatIndex: number, turnText: string): RequiredBeat {
  const requiredText = structuralTreatmentRequiredBeatText(turnText);
  return {
    id: `${sceneId}-rb${beatIndex + 1}`,
    sourceTurn: requiredText,
    mustDepict: requiredText,
    tier: 'authored',
  };
}

type StructuralTreatmentSegments = Partial<Record<'hook' | 'promise' | 'stakes', string>>;

function cleanupStructuralSegment(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[;,\s]+$/g, '')
    .trim();
}

function structuralTreatmentSegments(text: string): StructuralTreatmentSegments | undefined {
  const matches = Array.from(text.matchAll(/\b(hook|promise|stakes)\s*(?:—|-|:)\s*/gi));
  if (matches.length === 0) return undefined;
  const segments: StructuralTreatmentSegments = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const label = match[1].toLowerCase() as keyof StructuralTreatmentSegments;
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const segment = cleanupStructuralSegment(text.slice(start, end).replace(/^\s*[;:,-]+\s*/, ''));
    if (segment) segments[label] = segment;
  }
  return segments;
}

function structuralTreatmentRequiredBeatTexts(text: string): string[] {
  const segments = structuralTreatmentSegments(text);
  if (!segments) return [text];

  const concrete = [segments.hook, segments.stakes]
    .filter((segment): segment is string => Boolean(segment?.trim()))
    .map((segment) => segment.trim());
  if (concrete.length > 0) return Array.from(new Set(concrete));

  const fallback = Object.values(segments).find((segment) => segment?.trim());
  return fallback ? [fallback] : [text];
}

function structuralTreatmentRequiredBeatText(text: string): string {
  return structuralTreatmentRequiredBeatTexts(text).join('; ');
}

function roleAfterState(role: SceneNarrativeRole): string {
  switch (role) {
    case 'setup':
      return 'A concrete question, pressure, promise, or relationship imbalance has been planted on-page.';
    case 'development':
      return 'The pressure is sharper, more specific, or harder to avoid than when the scene opened.';
    case 'turn':
      return 'The scene has reversed, revealed, or recontextualized the situation.';
    case 'payoff':
      return 'An earlier setup has discharged into visible consequence.';
    case 'release':
      return 'The fallout has settled into a changed emotional, social, or logistical state.';
    default:
      return 'The scene ends in a changed state.';
  }
}

function roleHandoff(role: SceneNarrativeRole): string {
  switch (role) {
    case 'setup':
      return 'Hand the player to the next pressure with a clear reason to continue.';
    case 'development':
      return 'Hand off the escalated pressure rather than resetting the scene.';
    case 'turn':
      return 'Let the turn land before the story moves on.';
    case 'payoff':
      return 'Show the consequence of the payoff before moving to the next scene.';
    case 'release':
      return 'Bridge cleanly into the next episode or scene pressure.';
    default:
      return 'End with forward pressure and continuity.';
  }
}

function makeTurnContract(
  scene: PlannedScene,
  source: SceneTurnContract['source'],
  centralTurn: string,
  overrides: Partial<Omit<SceneTurnContract, 'turnId' | 'source' | 'centralTurn'>> = {},
): SceneTurnContract {
  const cleanTurn = centralTurn.trim() || scene.dramaticPurpose || scene.title;
  return {
    turnId: `${scene.id}-turn`,
    source,
    centralTurn: cleanTurn,
    beforeState: overrides.beforeState || `Before the turn, the scene is still governed by: ${scene.dramaticPurpose || scene.stakes || scene.title}.`,
    turnEvent: overrides.turnEvent || cleanTurn,
    afterState: overrides.afterState || roleAfterState(scene.narrativeRole),
    handoff: overrides.handoff || roleHandoff(scene.narrativeRole),
  };
}

function countScenePlanningSignals(value: string | undefined): number {
  const text = (value ?? '').toLowerCase();
  const signals = [
    /\bclub|booth|velvet|jazz|dance|door|party|weekend\b/,
    /\broad|cab|tow|car|mountain|diner|roadside|lift\b/,
    /\bblog|post|read(?:s|ership)?|viral|profile|inbox|dashboard\b/,
    /\bmessage|dm|warning|warns?|missing|disappear\b/,
    /\bdate|brunch|dinner|breakfast|lunch\b/,
    /\battack|fight|rescue|blood|scream|shadow|throat\b/,
  ];
  return signals.filter((signal) => signal.test(text)).length;
}

function looksLikeBroadEpisodeSummary(value: string | undefined): boolean {
  const text = (value ?? '').trim();
  if (text.length < 220) return false;
  const sentenceCount = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  const clauseCount = text.split(/[;—-]+/).map((part) => part.trim()).filter((part) => part.length > 20).length;
  const planningSignals = countScenePlanningSignals(text);
  return (sentenceCount >= 2 || clauseCount >= 3) && planningSignals >= 2;
}

function sceneLocalPressure(scene: PlannedScene): string {
  if (scene.stakes && !looksLikeBroadEpisodeSummary(scene.stakes)) return scene.stakes;
  return scene.dramaticPurpose || scene.title || scene.stakes || '';
}

function inferPlannerTurnContract(scene: PlannedScene): SceneTurnContract {
  if (scene.kind === 'encounter') {
    const central =
      scene.encounter?.centralConflict
      || scene.encounter?.description
      || scene.dramaticPurpose
      || scene.title;
    return makeTurnContract(scene, 'encounter', central, {
      beforeState: `Before the encounter turns, the player understands the stakes: ${scene.stakes || scene.dramaticPurpose}.`,
      afterState: scene.encounter?.aftermathConsequence || 'The encounter outcome leaves visible fallout, cost, or changed leverage.',
      handoff: 'Resolve the encounter into a clear consequence, aftermath beat, or sharpened pressure.',
    });
  }
  if (scene.hasChoice) {
    const localPressure = sceneLocalPressure(scene);
    return makeTurnContract(scene, 'choice', localPressure, {
      turnEvent: `The player-facing choice changes the scene pressure: ${localPressure}.`,
      handoff: 'After the choice, show the immediate consequence or residue before routing onward.',
    });
  }
  return makeTurnContract(scene, 'planner', scene.dramaticPurpose || sceneLocalPressure(scene) || scene.title);
}

function applyPlannerTurnContract(scene: PlannedScene): void {
  if (scene.turnContract?.centralTurn?.trim()) return;
  scene.turnContract = inferPlannerTurnContract(scene);
}

function applyAuthoredTurnContract(scene: PlannedScene, beat: RequiredBeat): void {
  scene.turnContract = makeTurnContract(scene, 'treatment', beat.mustDepict, {
    beforeState: `Before the authored turn, establish where the player is, who is present, and what pressure makes this moment happen.`,
    turnEvent: beat.mustDepict,
    afterState: `After the authored turn, show the immediate emotional, social, practical, or informational consequence on-page.`,
    handoff: `After "${beat.mustDepict}", keep the aftermath on-page until a visible consequence carries the moment forward.`,
  });
}

function applySceneTurnContracts(scenes: PlannedScene[]): void {
  for (const scene of scenes) {
    const authored = (scene.requiredBeats ?? []).find((beat) => beat.tier === 'authored' && beat.mustDepict?.trim());
    if (authored) applyAuthoredTurnContract(scene, authored);
    else applyPlannerTurnContract(scene);
  }
}

const RELATIONSHIP_TURN_RE =
  /\b(friend|friends|ally|allies|trust|trusted|bond|belong|club|crew|circle|adopts?|invites?|joins?|together|with you|love|lover|kiss|date|romance|protects?|rescues?|vow|promise)\b/i;
const HIGH_RELATIONSHIP_LABEL_RE =
  /\b(friend|friends|ally|allies|trusted|trusts|inner circle|lover|lovers|family|crew|club|is now|are now|becomes?|joined|joins)\b/i;
const MAJOR_EVIDENCE_RE =
  /\b(rescue|rescues|saves|protects|sacrifice|bleeds?|wound|secret|confess|confesses|risk|risks|vow|promise|key|card|threshold)\b/i;
const GROUP_RE = /\b(dusk club|club|crew|circle|group)\b/i;

function slugId(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'relationship';
}

function relationshipTextForScene(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
  ].filter(Boolean).join(' ');
}

function pacingTargetStage(priorScenes: number, text: string): RelationshipPacingContract['targetStage'] {
  if (priorScenes <= 0) return MAJOR_EVIDENCE_RE.test(text) ? 'acquaintance' : 'spark';
  if (priorScenes === 1) return 'acquaintance';
  if (priorScenes === 2) return 'tentative_ally';
  return HIGH_RELATIONSHIP_LABEL_RE.test(text) ? 'friend' : 'tentative_ally';
}

function pacingStartStage(priorScenes: number): RelationshipPacingContract['startStage'] {
  if (priorScenes <= 0) return 'unmet';
  if (priorScenes === 1) return 'spark';
  if (priorScenes === 2) return 'acquaintance';
  return 'tentative_ally';
}

const RELATIONSHIP_STAGE_RANK: Record<RelationshipPacingContract['targetStage'], number> = {
  unmet: 0,
  noticed: 1,
  spark: 2,
  acquaintance: 3,
  tentative_ally: 4,
  friend: 5,
  trusted_ally: 6,
  intimate: 7,
};

function lowerRelationshipStage<T extends RelationshipPacingContract['targetStage']>(stage: T, maxStage: T): T {
  return RELATIONSHIP_STAGE_RANK[stage] <= RELATIONSHIP_STAGE_RANK[maxStage] ? stage : maxStage;
}

function sceneCanEarnRelationshipAdvancement(scene: PlannedScene): boolean {
  return scene.choiceType === 'relationship';
}

function maxRelationshipStageWithoutChoice(priorScenes: number): RelationshipPacingContract['targetStage'] {
  return priorScenes <= 0 ? 'spark' : 'acquaintance';
}

function pacingMaxDelta(priorScenes: number, text: string): number {
  if (priorScenes <= 0) return MAJOR_EVIDENCE_RE.test(text) ? 8 : 6;
  if (priorScenes === 1) return 8;
  return 12;
}

function relationshipSourceForScene(scene: PlannedScene): RelationshipPacingContract['source'] {
  if ((scene.requiredBeats ?? []).some((beat) => beat.tier === 'authored' && RELATIONSHIP_TURN_RE.test(beat.mustDepict || beat.sourceTurn))) {
    return 'treatment';
  }
  if (scene.kind === 'encounter') return 'encounter';
  if (scene.choiceType === 'relationship') return 'choice';
  return 'planner';
}

// A treatment can DECLARE a bond that predates episode 1 (Mika is "Kylie's
// best friend", placed in her life before arrival; they met online). The
// positional pacing ladder starts every NPC at 'unmet', so scene-1 warmth with
// a declared prior bond reads as an unearned-intimacy violation to the
// relationship ledger (bite-me 2026-07-02T20-30-27 RelationshipArcLedger
// blocker). Declared prior bonds floor the start stage at 'acquaintance' —
// warm-familiar language is in-world truth; deeper trust is still earned.
const PRIOR_BOND_RE = /\b(?:best friend|closest friend|old friend|childhood friend|met online|already (?:friends|close|knows?)|knew (?:each other|her|him|them) (?:before|for years)|friendship began before)\b|\bplaced in \w+(?:'s)? life\b|\bbefore \w+ arriv/i;

export function collectPriorBondNpcKeys(plan: SeasonPlan): Set<string> {
  const keys = new Set<string>();
  const facts = (plan as unknown as { sourceCanon?: { facts?: Array<Record<string, unknown>> } }).sourceCanon?.facts ?? [];
  for (const fact of facts) {
    if (fact.domain !== 'npc') continue;
    const value = (fact.value ?? {}) as Record<string, unknown>;
    const evidence = [value.relationshipToProtagonist, value.leverage, value.role]
      .filter((entry): entry is string => typeof entry === 'string')
      .join(' ');
    if (!PRIOR_BOND_RE.test(evidence)) continue;
    if (typeof value.name === 'string') keys.add(slugId(value.name));
    if (typeof fact.subjectId === 'string') keys.add(slugId(String(fact.subjectId)));
  }
  return keys;
}

function hasPriorBond(npcId: string, priorBondNpcKeys?: Set<string>): boolean {
  if (!priorBondNpcKeys || priorBondNpcKeys.size === 0) return false;
  const key = slugId(npcId);
  if (priorBondNpcKeys.has(key)) return true;
  return [...priorBondNpcKeys].some((bondKey) => bondKey.includes(key) || key.includes(bondKey));
}

function buildNpcPacingContract(
  scene: PlannedScene,
  npcId: string,
  priorScenes: number,
  text: string,
  priorBondNpcKeys?: Set<string>,
): RelationshipPacingContract {
  const priorBond = hasPriorBond(npcId, priorBondNpcKeys);
  const maxStage = sceneCanEarnRelationshipAdvancement(scene)
    ? 'intimate'
    : maxRelationshipStageWithoutChoice(priorScenes);
  const positionalStart = pacingStartStage(priorScenes);
  const startStage = priorBond
    ? (RELATIONSHIP_STAGE_RANK[positionalStart] >= RELATIONSHIP_STAGE_RANK.acquaintance ? positionalStart : 'acquaintance')
    : lowerRelationshipStage(positionalStart, maxStage);
  const positionalTarget = lowerRelationshipStage(pacingTargetStage(priorScenes, text), maxStage);
  const targetStage = priorBond && RELATIONSHIP_STAGE_RANK[positionalTarget] < RELATIONSHIP_STAGE_RANK[startStage]
    ? startStage
    : positionalTarget;
  const early = !priorBond && priorScenes <= 1 && targetStage !== 'friend';
  return {
    id: `${scene.id}-rel-${slugId(npcId)}`,
    source: relationshipSourceForScene(scene),
    npcId,
    startStage,
    targetStage,
    allowedLabels: priorBond
      ? ['established rapport', 'familiar warmth', 'friend', 'bond with history', 'shared shorthand']
      : early
        ? ['spark', 'connection', 'new acquaintance', 'invitation', 'guarded warmth', 'testing trust']
        : ['tentative ally', 'earned friend', 'trusted help', 'bond with history'],
    blockedLabels: priorBond
      ? ['soulmate', 'trusts completely', 'family', 'lover']
      : early
        ? ['friend', 'best friend', 'trusted ally', 'inner circle', 'lover', 'family', 'one of us']
        : ['best friend', 'soulmate', 'family', 'trusts completely'],
    requiredEvidence: priorBond
      ? [
          'ground the familiarity in the declared prior bond (how they know each other)',
          'show reciprocity, testing, vulnerability, protection, or remembered detail',
          'show aftermath or changed behavior after the relationship turn',
        ]
      : [
          'show behavior before naming the bond',
          'show reciprocity, testing, vulnerability, protection, or remembered detail',
          'show aftermath or changed behavior after the relationship turn',
        ],
    minScenesSinceIntroduction: early ? 1 : 0,
    maxDeltaThisScene: pacingMaxDelta(priorScenes, text),
    mechanicDimensions: ['trust', 'affection', 'respect'],
  };
}

function buildGroupPacingContract(scene: PlannedScene, priorScenes: number, text: string): RelationshipPacingContract {
  const groupId = /dusk club/i.test(text) ? 'dusk-club' : `${slugId(scene.title)}-group`;
  const maxStage = sceneCanEarnRelationshipAdvancement(scene)
    ? 'intimate'
    : maxRelationshipStageWithoutChoice(priorScenes);
  const startStage = lowerRelationshipStage(pacingStartStage(priorScenes), maxStage);
  const early = priorScenes <= 1;
  return {
    id: `${scene.id}-rel-${groupId}`,
    source: relationshipSourceForScene(scene),
    groupId,
    startStage,
    targetStage: lowerRelationshipStage(early ? 'spark' : 'tentative_ally', maxStage),
    allowedLabels: early
      ? ['invitation', 'dare', 'inside joke', 'provisional name', 'fragile beginning']
      : ['tentative group', 'earned circle', 'shared ritual'],
    blockedLabels: early
      ? ['inner circle', 'one of us', 'family', 'permanent member', 'trusted club', 'friends now']
      : ['family', 'unbreakable circle', 'trusted completely'],
    requiredEvidence: [
      'make the group label provisional unless prior scenes earned it',
      'show how each person tests, invites, or withholds belonging',
      'tie any group-name payoff to a visible choice, gift, joke, or risk',
    ],
    minScenesSinceIntroduction: early ? 1 : 0,
    maxDeltaThisScene: pacingMaxDelta(priorScenes, text),
    mechanicDimensions: ['trust', 'affection', 'respect'],
  };
}

function protagonistRelationshipKeys(protagonist?: SeasonPlan['protagonist']): Set<string> {
  return new Set(
    ['protagonist', 'hero', 'player', 'you', protagonist?.id, protagonist?.name]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(slugId),
  );
}

function isProtagonistRelationshipRef(value: string, protagonistKeys: Set<string>): boolean {
  return protagonistKeys.has(slugId(value));
}

function applyRelationshipPacingContracts(
  scenes: PlannedScene[],
  protagonist?: SeasonPlan['protagonist'],
  priorBondNpcKeys?: Set<string>,
): void {
  const npcSeen = new Map<string, number>();
  const groupSeen = new Map<string, number>();
  const protagonistKeys = protagonistRelationshipKeys(protagonist);
  for (const scene of [...scenes].sort((a, b) => (a.episodeNumber - b.episodeNumber) || (a.order - b.order))) {
    const text = relationshipTextForScene(scene);
    const relationshipRelevant =
      scene.choiceType === 'relationship'
      || RELATIONSHIP_TURN_RE.test(text)
      || scene.kind === 'encounter';
    if (!relationshipRelevant) {
      for (const npc of scene.npcsInvolved ?? []) {
        if (!isProtagonistRelationshipRef(npc, protagonistKeys)) npcSeen.set(npc, (npcSeen.get(npc) ?? 0) + 1);
      }
      continue;
    }

    const contracts = [...(scene.relationshipPacing ?? [])];
    const npcs = (scene.npcsInvolved ?? [])
      .filter((npc) => npc && !isProtagonistRelationshipRef(npc, protagonistKeys) && !contracts.some((c) => c.npcId === npc))
      .slice(0, 3);
    for (const npc of npcs) {
      contracts.push(buildNpcPacingContract(scene, npc, npcSeen.get(npc) ?? 0, text, priorBondNpcKeys));
    }

    if (GROUP_RE.test(text) && !contracts.some((c) => c.groupId)) {
      const groupKey = /dusk club/i.test(text) ? 'dusk-club' : `${slugId(scene.title)}-group`;
      contracts.push(buildGroupPacingContract(scene, groupSeen.get(groupKey) ?? 0, text));
      groupSeen.set(groupKey, (groupSeen.get(groupKey) ?? 0) + 1);
    }

    if (contracts.length > 0) scene.relationshipPacing = contracts;
    for (const npc of scene.npcsInvolved ?? []) {
      if (!isProtagonistRelationshipRef(npc, protagonistKeys)) npcSeen.set(npc, (npcSeen.get(npc) ?? 0) + 1);
    }
  }
}

const ITEM_PRESSURE_RE = /\b(key\s*card|keycard|card|key|quartz|crystal|ring|knife|letter|book|map|phone|object|gift|token|weapon|access)\b/i;
const INFORMATION_PRESSURE_RE = /\b(secret|learns?|discovers?|reveal|clue|tell|knows?|information|evidence|truth|message|blog|post|reads?|rumor)\b/i;
const ROUTE_PRESSURE_RE = /\b(side entrance|entrance|door|threshold|route|path|access|opens?|unlock|inside|outside|crosses?|moves?|walks?)\b/i;
const IDENTITY_PRESSURE_RE = /\b(identity|becomes?|chooses?|vows?|promise|need|want|fear|hunger|lonely|cannot sleep|posts?|names? only)\b/i;
const REPUTATION_PRESSURE_RE = /\b(reputation|public|viral|reads?|crowd|club|social|humiliation|risk|exposed|gossip)\b/i;
const SKILL_PRESSURE_RE = /\b(investigate|notice|perceive|persuade|sneak|survive|fight|escape|track|decode|read|perform)\b/i;

function mechanicPressureText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.encounter?.centralConflict,
    scene.encounter?.aftermathConsequence,
    ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
  ].filter(Boolean).join(' ');
}

function pressureSourceForScene(scene: PlannedScene): MechanicPressureSource {
  if ((scene.requiredBeats ?? []).some((beat) => beat.tier === 'authored')) return 'treatment';
  if (scene.kind === 'encounter') return 'encounter';
  if (scene.hasChoice || scene.choiceType) return 'choice';
  return 'planner';
}

function inferPressureDomain(scene: PlannedScene, text: string): MechanicPressureDomain {
  if (scene.kind === 'encounter') return 'encounter';
  if (RELATIONSHIP_TURN_RE.test(text) || scene.choiceType === 'relationship') return 'relationship';
  if (ITEM_PRESSURE_RE.test(text)) return 'item';
  if (INFORMATION_PRESSURE_RE.test(text)) return 'information';
  if (ROUTE_PRESSURE_RE.test(text) || scene.consequenceTier === 'branch' || scene.consequenceTier === 'branchlet') return 'route';
  if (REPUTATION_PRESSURE_RE.test(text)) return 'reputation';
  if (SKILL_PRESSURE_RE.test(text) || scene.choiceType === 'strategic') return 'skill';
  if (IDENTITY_PRESSURE_RE.test(text) || scene.choiceType === 'dilemma') return 'identity';
  if (scene.hasChoice) return 'flag';
  return 'resource';
}

function pressureFunctionForScene(scene: PlannedScene): MechanicPressureContract['function'] {
  if (scene.paysOff?.length) return scene.setsUp?.length ? 'payoff' : 'spend';
  if (scene.narrativeRole === 'payoff') return 'payoff';
  if (scene.narrativeRole === 'turn') return 'intensify';
  if (scene.kind === 'encounter') return 'complicate';
  if (scene.consequenceTier === 'branch' || scene.consequenceTier === 'branchlet') return 'gate';
  return 'plant';
}

function pressureRefForScene(
  scene: PlannedScene,
  domain: MechanicPressureDomain,
  index: number,
): MechanicPressureContract['mechanicRef'] {
  switch (domain) {
    case 'relationship':
      return { npcId: scene.npcsInvolved?.[index] || scene.npcsInvolved?.[0], relationshipDimension: 'trust' };
    case 'item':
      return { itemId: ITEM_PRESSURE_RE.test(mechanicPressureText(scene)) ? slugId((ITEM_PRESSURE_RE.exec(mechanicPressureText(scene))?.[1] || scene.title)) : undefined };
    case 'route':
      return { routeId: scene.setsUp?.[0] || scene.paysOff?.[0] || scene.id };
    case 'encounter':
      return { encounterOutcome: scene.encounter?.isBranchPoint ? 'branching_outcome' : 'encounter_aftermath' };
    case 'skill':
      return { skill: scene.encounter?.relevantSkills?.[0] };
    case 'information':
      return { infoId: scene.requiredBeats?.[0]?.id || scene.id };
    case 'flag':
      return { flag: `${slugId(scene.id)}_pressure` };
    case 'score':
      return { score: `${slugId(scene.id)}_pressure` };
    case 'identity':
      return { identityAxis: slugId(scene.stakes || scene.title) };
    default:
      return {};
  }
}

function evidenceForDomain(domain: MechanicPressureDomain): string[] {
  switch (domain) {
    case 'relationship':
      return ['show testing, generosity, guarded warmth, refusal, vulnerability, protection, or reciprocity before the relationship moves'];
    case 'item':
      return ['show the object physically exchanged, noticed, withheld, used, or carried as obligation/access'];
    case 'route':
      return ['show why the route becomes available, costly, suspicious, or blocked'];
    case 'information':
      return ['show the clue, secret, tell, overheard line, discovery, or public signal on-page'];
    case 'skill':
      return ['show what the player perceives, practices, risks, fails, or proves'];
    case 'encounter':
      return ['show how success, partial success, failure, or escape changes danger, cost, access, or posture'];
    case 'identity':
      return ['show the pressure on who the protagonist is becoming through action, compromise, vow, fear, or desire'];
    default:
      return ['show the fictional event that creates the hidden state residue'];
  }
}

function residueForDomain(domain: MechanicPressureDomain): string[] {
  switch (domain) {
    case 'relationship':
      return ['changed distance, invitation, teasing, withholding, remembered detail, challenge, or protection'];
    case 'item':
      return ['the object remains visible as access, burden, clue, debt, danger, or callback'];
    case 'route':
      return ['the next path feels earned by movement, access, cost, or a grounded transition'];
    case 'information':
      return ['dialogue, choice wording, later text variant, secrecy risk, or altered interpretation remembers the information'];
    case 'skill':
      return ['later tactic, clue read, failed scar, or confidence/limitation reflects the demonstrated skill'];
    case 'encounter':
      return ['injury, danger, reputation, ally posture, route condition, or aftermath changes later scenes'];
    case 'identity':
      return ['self-description, vow, hesitation, appetite, fear, or future choice framing shifts'];
    default:
      return ['changed behavior, access, tone, clue, cost, memory, or narrowed option'];
  }
}

function allowedPayoffsForDomain(domain: MechanicPressureDomain): string[] {
  switch (domain) {
    case 'relationship':
      return ['small private warning', 'tentative invitation', 'withheld or offered help', 'changed NPC posture'];
    case 'item':
      return ['access leverage', 'callback object', 'obligation', 'danger', 'suspicion', 'supernatural tell'];
    case 'route':
      return ['believable route split', 'new access', 'blocked access complication', 'grounded transition'];
    case 'information':
      return ['reveal interpretation', 'choice wording', 'investigation affordance', 'secret cost'];
    case 'skill':
      return ['earned tactic', 'noticed clue', 'partial workaround', 'fail-forward complication'];
    case 'encounter':
      return ['outcome-specific aftermath', 'changed danger', 'access shift', 'injury or reputation consequence'];
    case 'identity':
      return ['identity-framed choice', 'vow payoff', 'temptation', 'self-recognition'];
    default:
      return ['callback, text variant, altered tone, choice affordance, or later complication'];
  }
}

function blockedPayoffsForDomain(domain: MechanicPressureDomain): string[] {
  switch (domain) {
    case 'relationship':
      return ['instant loyalty', 'settled friendship', 'trusted ally status', 'romance without staged vulnerability'];
    case 'item':
      return ['instant intimacy', 'unearned mastery', 'unexplained teleport', 'access unrelated to the object'];
    case 'route':
      return ['location jump without movement or elapsed-time language', 'route skip that bypasses required setup'];
    case 'information':
      return ['prose claiming knowledge the player never learned'];
    case 'skill':
      return ['automatic success or hidden information without demonstrated competence'];
    default:
      return ['payoff not supported by on-page evidence or prior pressure'];
  }
}

function contractFromRelationshipPacing(scene: PlannedScene, contract: RelationshipPacingContract): MechanicPressureContract {
  const ref: MechanicPressureContract['mechanicRef'] = {
    npcId: contract.npcId,
    relationshipDimension: contract.mechanicDimensions[0] ?? 'trust',
  };
  return {
    id: `${contract.id}-pressure`,
    source: contract.source,
    domain: 'relationship',
    mechanicRef: ref,
    function: 'intensify',
    storyPressure: contract.groupId
      ? `Group belonging is moving only as far as ${contract.targetStage}.`
      : `Relationship with ${contract.npcId ?? 'the NPC'} is moving only as far as ${contract.targetStage}.`,
    evidenceRequired: contract.requiredEvidence,
    visibleResidue: residueForDomain('relationship'),
    allowedPayoffs: contract.allowedLabels,
    blockedPayoffs: contract.blockedLabels,
    originatingSceneId: scene.id,
    maxMagnitudeThisScene: contract.maxDeltaThisScene,
    payoffWindow: { minScenesLater: Math.max(1, contract.minScenesSinceIntroduction) },
  };
}

function buildMechanicPressureContract(scene: PlannedScene, index = 0, domainOverride?: MechanicPressureDomain): MechanicPressureContract {
  const text = mechanicPressureText(scene);
  const domain = domainOverride ?? inferPressureDomain(scene, text);
  return {
    id: `${scene.id}-pressure-${index + 1}-${domain}`,
    source: pressureSourceForScene(scene),
    domain,
    mechanicRef: pressureRefForScene(scene, domain, index),
    function: pressureFunctionForScene(scene),
    storyPressure: scene.stakes || scene.turnContract?.centralTurn || scene.dramaticPurpose || scene.title,
    evidenceRequired: evidenceForDomain(domain),
    visibleResidue: residueForDomain(domain),
    allowedPayoffs: allowedPayoffsForDomain(domain),
    blockedPayoffs: blockedPayoffsForDomain(domain),
    originatingSceneId: scene.id,
    payoffWindow: scene.setsUp?.length ? { minScenesLater: 1 } : undefined,
    maxMagnitudeThisScene: domain === 'relationship' ? 6 : domain === 'score' || domain === 'identity' || domain === 'skill' ? 10 : undefined,
    requiredBeforeSpend: scene.paysOff?.length ? [{ domain, description: 'Earlier scenes must have planted this pressure before this scene spends it.' }] : undefined,
  };
}

function applyMechanicPressureContracts(scenes: PlannedScene[]): void {
  for (const scene of [...scenes].sort((a, b) => (a.episodeNumber - b.episodeNumber) || (a.order - b.order))) {
    const contracts = new Map<string, MechanicPressureContract>();
    for (const contract of scene.mechanicPressure ?? []) contracts.set(contract.id, contract);
    for (const rel of scene.relationshipPacing ?? []) {
      const converted = contractFromRelationshipPacing(scene, rel);
      contracts.set(converted.id, converted);
    }

    const text = mechanicPressureText(scene);
    const shouldHavePressure =
      scene.hasChoice
      || scene.kind === 'encounter'
      || (scene.requiredBeats ?? []).some((beat) => beat.tier === 'authored')
      || ITEM_PRESSURE_RE.test(text)
      || INFORMATION_PRESSURE_RE.test(text)
      || ROUTE_PRESSURE_RE.test(text)
      || IDENTITY_PRESSURE_RE.test(text);
    if (shouldHavePressure && contracts.size === 0) {
      contracts.set(`${scene.id}-pressure-1`, buildMechanicPressureContract(scene));
    } else if (shouldHavePressure && !Array.from(contracts.values()).some((contract) => contract.source === 'treatment') && (scene.requiredBeats ?? []).some((beat) => beat.tier === 'authored')) {
      const domain = inferPressureDomain(scene, text);
      contracts.set(`${scene.id}-pressure-authored-${domain}`, buildMechanicPressureContract(scene, contracts.size, domain));
    }

    if (scene.choiceType === 'relationship' && !Array.from(contracts.values()).some((contract) => contract.domain === 'relationship')) {
      contracts.set(`${scene.id}-pressure-relationship`, buildMechanicPressureContract(scene, contracts.size, 'relationship'));
    }
    if (ITEM_PRESSURE_RE.test(text) && !Array.from(contracts.values()).some((contract) => contract.domain === 'item')) {
      contracts.set(`${scene.id}-pressure-item`, buildMechanicPressureContract(scene, contracts.size, 'item'));
    }
    if (INFORMATION_PRESSURE_RE.test(text) && !Array.from(contracts.values()).some((contract) => contract.domain === 'information')) {
      contracts.set(`${scene.id}-pressure-information`, buildMechanicPressureContract(scene, contracts.size, 'information'));
    }
    if ((scene.consequenceTier === 'branch' || scene.consequenceTier === 'branchlet') && !Array.from(contracts.values()).some((contract) => contract.domain === 'route')) {
      contracts.set(`${scene.id}-pressure-route`, buildMechanicPressureContract(scene, contracts.size, 'route'));
    }

    if (contracts.size > 0) scene.mechanicPressure = Array.from(contracts.values());
  }
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

/** Stopwords stripped before turn↔scene content-overlap (mirrors the validator). */
const BIND_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'with', 'into', 'onto', 'from', 'that',
  'this', 'then', 'than', 'them', 'they', 'their', 'there', 'here', 'have', 'has',
  'had', 'will', 'would', 'about', 'over', 'under', 'when', 'where', 'while',
  'your', 'you', 'her', 'his', 'him', 'she', 'for', 'are', 'was', 'were', 'been',
  'who', 'whom', 'what', 'which', 'scene', 'episode', 'turn',
]);

/** Content tokens (≥4 chars, not a stopword), lowercased. */
function bindTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !BIND_STOPWORDS.has(t));
}

function firstSentence(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/(?<=[.!?])\s/)[0]?.trim() || trimmed;
}

function observableInformationPlant(
  entry: NonNullable<SeasonPlan['informationLedger']>[number],
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;
  const state = String(entry.audienceKnowledgeState || '').toLowerCase();
  if (!state.includes('withheld')) return description;

  const whoClause = description.match(/^(.+?)\s+is\s+(?:a|an|the)\s+[^,.]+?\s+who\s+(.+)$/i);
  if (whoClause) {
    return `${whoClause[1]} ${whoClause[2]}`.replace(/\s+/g, ' ').trim();
  }
  return description;
}

function informationLedgerPlantText(
  entry: NonNullable<SeasonPlan['informationLedger']>[number],
): { text: string; sourceTurn: string } | undefined {
  const label = entry.label?.trim();
  const description = observableInformationPlant(entry, firstSentence(entry.description));
  if (!label && !description) return undefined;

  const labelTokens = bindTokens(label);
  const descriptionTokens = bindTokens(description);
  const labelLooksAbstract = labelTokens.length <= 2 && descriptionTokens.length > labelTokens.length;
  const text = labelLooksAbstract
    ? description
    : (label || description);
  if (!text) return undefined;

  return {
    text,
    sourceTurn: label && label !== text ? `${label}: ${text}` : text,
  };
}

/**
 * The text a scene exposes for matching an authored turn against it — its
 * author-meaningful framing (title + dramatic purpose + locations + stakes,
 * plus the encounter description when present). On the deterministic builder
 * path these are generic ("setup scene 1", role-derived purpose) and carry no
 * per-turn signal, which is why {@link alignTurnsToScenes} falls back to
 * positional binding when no scene out-scores the rest.
 */
function sceneMatchText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    ...(scene.locations ?? []),
    looksLikeBroadEpisodeSummary(scene.stakes) ? undefined : scene.stakes,
    scene.encounter?.description,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Fraction of a turn's content tokens that appear in a scene's match text. */
function turnSceneOverlap(turnTokens: string[], sceneTokenSet: Set<string>): number {
  if (turnTokens.length === 0) return 0;
  const hits = turnTokens.filter((t) => sceneTokenSet.has(t)).length;
  return hits / turnTokens.length;
}

function locationAliasHitCount(textTokens: Set<string>, locationTokens: Set<string>): number {
  let hits = 0;
  const hasAny = (tokens: string[]): boolean => tokens.some((token) => textTokens.has(token));
  if (hasAny(['bookshop', 'bookstore']) && (locationTokens.has('book') || locationTokens.has('books') || locationTokens.has('shop') || locationTokens.has('store'))) {
    hits += 3;
  }
  if (hasAny(['garden', 'gardens', 'park']) && (locationTokens.has('garden') || locationTokens.has('gardens') || locationTokens.has('park'))) {
    hits += 3;
  }
  return hits;
}

function tokenHitCount(sourceTokens: string[], targetTokenSet: Set<string>): number {
  return sourceTokens.filter((token) => targetTokenSet.has(token)).length;
}

function plannedEncounterCoverageText(enc: EpisodePlannedEncounter): string {
  return [
    enc.description,
    enc.centralConflict,
    enc.stakes,
    enc.aftermathConsequence,
    ...(enc.npcsInvolved ?? []),
    ...(enc.relevantSkills ?? []),
    enc.branchOutcomes?.victory,
    enc.branchOutcomes?.partialVictory,
    enc.branchOutcomes?.defeat,
    enc.branchOutcomes?.escape,
  ].filter(Boolean).join(' ');
}

export function getAuthoredEpisodeEventTexts(ep: SeasonEpisode): string[] {
  const guidance = ep.treatmentGuidance;
  if (guidance?.episodeTurns?.length) return guidance.episodeTurns.filter((turn) => turn?.trim());
  if (guidance?.majorChoicePressures?.length) return guidance.majorChoicePressures.filter((turn) => turn?.trim());
  if (guidance?.encounterAnchors?.length) return guidance.encounterAnchors.filter((turn) => turn?.trim());
  return [];
}

/**
 * Some treatments use `plannedEncounters` as a high-level label for authored
 * turns already listed under `episodeTurns`.
 * In that case, allocating a separate encounter scene duplicates the same event.
 */
export function encounterIsCoveredByAuthoredTurns(enc: EpisodePlannedEncounter, authoredTurns: string[]): boolean {
  if (authoredTurns.length === 0) return false;
  const encounterTokens = bindTokens(plannedEncounterCoverageText(enc));
  if (encounterTokens.length < 4) return false;
  const encounterSignature = buildEncounterEventSignature([plannedEncounterCoverageText(enc)]);
  if (encounterSignature.pressureActions.size > 0) {
    for (const turn of authoredTurns) {
      const match = compareEncounterEventSignatures(encounterSignature, buildEncounterEventSignature([turn]));
      if (match.matched) return true;
    }
  }
  const encounterTokenSet = new Set(encounterTokens);
  const turnMatches = authoredTurns.map((turn) => {
    const turnTokens = bindTokens(turn);
    const hits = tokenHitCount(turnTokens, encounterTokenSet);
    return {
      hits,
      turnCoverage: turnTokens.length > 0 ? hits / turnTokens.length : 0,
    };
  });
  const matchedTurns = turnMatches.filter((m) => m.hits >= 2 && m.turnCoverage >= 0.18).length;
  const authoredTokenSet = new Set(authoredTurns.flatMap((turn) => bindTokens(turn)));
  const encounterCoverage = tokenHitCount(encounterTokens, authoredTokenSet) / encounterTokens.length;
  return (matchedTurns >= 2 && encounterCoverage >= 0.25)
    || turnMatches.some((m) => m.hits >= 4 && m.turnCoverage >= 0.45);
}

function authoredRequiredBeatText(scene: PlannedScene): string {
  return (scene.requiredBeats ?? [])
    .filter((beat) => beat.tier === 'authored' && beat.mustDepict?.trim())
    .map((beat) => beat.mustDepict.trim())
    .join(' ');
}

const ENCOUNTER_PRESSURE_TERMS = [
  'attack', 'attacker', 'blood', 'chase', 'confront', 'danger', 'duel',
  'escape', 'fight', 'fog', 'hunt', 'hunted', 'kill', 'maze', 'pinned',
  'rescue', 'rescues', 'scream', 'shadow', 'threat', 'trap', 'willow',
];

function pressureTermHits(text: string): number {
  const normalized = text.toLowerCase();
  return ENCOUNTER_PRESSURE_TERMS.filter((term) => normalized.includes(term)).length;
}

function findAuthoredEncounterOwnerScene(scenes: PlannedScene[], enc: EpisodePlannedEncounter): PlannedScene | undefined {
  const encounterTokenSet = new Set(bindTokens(plannedEncounterCoverageText(enc)));
  const encounterPressure = pressureTermHits(plannedEncounterCoverageText(enc));
  const encounterSignature = buildEncounterEventSignature([plannedEncounterCoverageText(enc)]);
  let best: { scene: PlannedScene; index: number; pressure: number; signatureScore: number; tokenScore: number } | undefined;
  scenes.forEach((scene, index) => {
    if (scene.kind === 'encounter' || scene.narrativeRole === 'release') return;
    const authoredText = authoredRequiredBeatText(scene);
    if (!authoredText) return;
    const tokenScore = tokenHitCount(bindTokens(authoredText), encounterTokenSet);
    const signature = compareEncounterEventSignatures(encounterSignature, buildEncounterEventSignature([authoredText]));
    if (tokenScore < 2 && !signature.matched) return;
    const pressure = encounterPressure > 0 ? pressureTermHits(authoredText) : 0;
    // Composite treatment anchors usually name setup + payoff ("rooftop, then
    // park attack"). The encounter owner is the last matching authored turn, not
    // the earlier setup half whose wording may overlap more heavily.
    if (
      !best
      || signature.score > best.signatureScore
      || (signature.score === best.signatureScore && pressure > best.pressure)
      || (signature.score === best.signatureScore && pressure === best.pressure && tokenScore > best.tokenScore)
      || (signature.score === best.signatureScore && pressure === best.pressure && tokenScore === best.tokenScore && index > best.index)
    ) {
      best = { scene, index, pressure, signatureScore: signature.score, tokenScore };
    }
  });
  return best?.scene;
}

function promoteAuthoredSceneToEncounter(scene: PlannedScene, enc: EpisodePlannedEncounter): void {
  const narrowedDescription = authoredRequiredBeatText(scene) || enc.description;
  scene.id = enc.id;
  scene.kind = 'encounter';
  scene.title = truncateAtWordBoundary(narrowedDescription, 60) || scene.title;
  scene.dramaticPurpose = narrowedDescription || scene.dramaticPurpose;
  scene.narrativeRole = 'turn';
  scene.npcsInvolved = Array.from(new Set([...(scene.npcsInvolved ?? []), ...(enc.npcsInvolved ?? [])]));
  scene.stakes = enc.stakes || scene.stakes;
  scene.encounter = {
    ...toSceneEncounter(enc),
    description: narrowedDescription || enc.description,
    centralConflict: narrowedDescription || enc.centralConflict,
  };
  scene.hasChoice = true;
  scene.budgetWeight = ENCOUNTER_BUDGET_WEIGHT;
}

export function promoteCoveredAuthoredEncounters(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  coveredEncounterIds: ReadonlySet<string>,
): void {
  for (const enc of ep.plannedEncounters ?? []) {
    if (!coveredEncounterIds.has(enc.id)) continue;
    const owner = findAuthoredEncounterOwnerScene(scenes, enc);
    if (!owner) continue;

    for (let i = scenes.length - 1; i >= 0; i -= 1) {
      const scene = scenes[i];
      if (scene === owner) continue;
      const isStandaloneDuplicate =
        scene.kind === 'encounter'
        && (scene.id === enc.id || scene.encounter?.description === enc.description);
      if (isStandaloneDuplicate) scenes.splice(i, 1);
    }

    promoteAuthoredSceneToEncounter(owner, enc);
  }
  scenes.forEach((scene, index) => {
    scene.order = index;
  });
}

function highPressureSignatureForText(value: string | undefined) {
  const signature = buildEncounterEventSignature([value]);
  if (
    signature.pressureActions.size === 0
    || signature.isSetupOnly
    || signature.isReferenceOnly
  ) {
    return undefined;
  }
  return signature;
}

function sceneRequiredEventTexts(scene: PlannedScene): string[] {
  return [
    scene.signatureMoment,
    ...(scene.requiredBeats ?? [])
      .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature' || beat.tier === 'coldopen')
      .flatMap((beat) => [beat.mustDepict, beat.sourceTurn]),
  ].filter((text): text is string => Boolean(text?.trim()));
}

function sceneHasMatchingRequiredEvent(scene: PlannedScene, purposeSignature: ReturnType<typeof highPressureSignatureForText>): boolean {
  if (!purposeSignature) return true;
  for (const text of sceneRequiredEventTexts(scene)) {
    const requiredSignature = highPressureSignatureForText(text);
    if (!requiredSignature) continue;
    if (compareEncounterEventSignatures(purposeSignature, requiredSignature).matched) {
      return true;
    }
  }
  return false;
}

function standardScenePurposeLooksUnsupported(scene: PlannedScene): boolean {
  if (scene.kind !== 'standard') return false;
  const purposeSignature = highPressureSignatureForText(scene.dramaticPurpose);
  return Boolean(purposeSignature && !sceneHasMatchingRequiredEvent(scene, purposeSignature));
}

function refreshPlannerDerivedTurnContract(scene: PlannedScene): void {
  if (!scene.turnContract || scene.turnContract.source === 'planner') {
    scene.turnContract = inferPlannerTurnContract(scene);
  }
}

function repairUnsupportedPlanningEventPurposes(ep: SeasonEpisode, scenes: PlannedScene[]): void {
  for (const scene of scenes) {
    if (!standardScenePurposeLooksUnsupported(scene)) continue;
    let replacement = composeDramaticPurpose(scene.narrativeRole, ep, undefined);
    const replacementSignature = highPressureSignatureForText(replacement);
    if (replacementSignature && !sceneHasMatchingRequiredEvent(scene, replacementSignature)) {
      replacement = composeRoleOnlyDramaticPurpose(scene.narrativeRole, ep);
    }
    scene.dramaticPurpose = replacement;
    refreshPlannerDerivedTurnContract(scene);
  }
}

/**
 * The episode location whose name a beat's text names, or undefined. Used to pin a
 * scene's setting to the place its authored turn actually happens — the deterministic
 * builder collapses every scene to the episode's FIRST location (so the bite-me-g15
 * ep3 "noticer collects" turn at the estate rendered in "The Black Car"). We require a
 * distinctive name token (≥5 chars, lowercased, diacritics stripped consistently on
 * both sides) so a generic "club"/"room" never triggers a false override; the location
 * with the most matching tokens wins.
 */
function matchBeatLocation(text: string | undefined, locations: string[]): string | undefined {
  if (!text || locations.length === 0) return undefined;
  const textTokens = new Set(bindTokens(text));
  let best: string | undefined;
  let bestScore = 0;
  for (const loc of locations) {
    const locTokens = bindTokens(loc);
    const distinctiveLocTokens = /(?:'|’)s\b/i.test(loc) ? locTokens.slice(1) : locTokens;
    const locationTokenSet = new Set(locTokens);
    const hits =
      distinctiveLocTokens.filter((t) => t.length >= 5 && textTokens.has(t)).length
      + locationAliasHitCount(textTokens, locationTokenSet);
    if (hits > bestScore) {
      bestScore = hits;
      best = loc;
    }
  }
  return bestScore > 0 ? best : undefined;
}

function inferAuthoredLocationFromText(text: string | undefined, locations: string[]): string | undefined {
  const declared = matchBeatLocation(text, locations);
  if (declared) return declared;

  const normalized = (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized.trim()) return undefined;

  const declaredMatch = (pattern: RegExp) => locations.find((loc) =>
    pattern.test(loc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );
  if (/\b(?:cismigiu|park|gardens?)\b/.test(normalized)) {
    return declaredMatch(/\b(?:park|garden)/) || 'Cișmigiu Gardens';
  }
  if (/\b(?:rooftop|roof\s*top|sunset bar)\b/.test(normalized)) {
    return declaredMatch(/\b(?:rooftop|roof|bar|terrace)/) || 'Rooftop Bar';
  }
  if (/\b(?:club|venue|key card|keycard|side entrance|private door|service entrance)\b/.test(normalized)) {
    return declaredMatch(/\b(?:club|venue|door|entrance)/) || 'Vâlcescu Club';
  }
  if (/\b(?:bookshop|bookstore|quartz|crystal|stone|charm|talisman)\b/.test(normalized)) {
    return declaredMatch(/\b(?:book|shop|store)/) || 'Lumina Books';
  }
  if (/\b(?:estate|country house|hedge maze|rose garden)\b/.test(normalized)) {
    return declaredMatch(/\b(?:estate|country|maze|garden)/) || "Victor's Estate";
  }
  return undefined;
}

/**
 * Index of the scene whose match-text best overlaps `text`, or -1 when nothing
 * overlaps (the deterministic path's generic titles carry no signal). Used to
 * route a distributed seed plant (cold open / consequence seed) to the scene that
 * most plausibly dramatizes it.
 */
function bestMatchSceneIndex(text: string, sceneTokenSets: Array<Set<string>>): number {
  const toks = bindTokens(text);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < sceneTokenSets.length; i += 1) {
    const s = turnSceneOverlap(toks, sceneTokenSets[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/**
 * Assign each authored turn to the content scene that actually dramatizes it,
 * preserving authored order. Returns `assignment[t] = sceneIndex`.
 *
 * Authored turns are ordered and the LLM scene plan authors scenes in roughly
 * that same order, but it freely inserts connective scenes (an arrival, a
 * debrief) that map to NO authored turn. Pure positional binding (turn t → scene
 * t) then cascades off-by-one the moment such a scene appears, landing the
 * "bookshop" turn on the "nightclub" scene (bite-me-g13). We instead pick the
 * order-preserving assignment that maximizes total turn↔scene token overlap via
 * a monotonic DP — turns keep their order, scenes strictly increase, and the
 * connective scenes are simply skipped.
 *
 * When no scene carries a lexical signal (the deterministic path, generic
 * titles), every overlap is 0 and we fall back to exact positional binding so
 * that path's output is byte-identical to before. When there are more turns than
 * scenes, the surplus piles onto the last scene (legacy "never drop a turn").
 */
function alignTurnsToScenes(turns: string[], targets: PlannedScene[]): number[] {
  const n = turns.length;
  const m = targets.length;
  if (n === 0 || m === 0) return [];

  const positional = (): number[] => turns.map((_, t) => Math.min(t, m - 1));

  // More turns than scenes, or no room for a 1:1 distinct assignment: keep the
  // legacy positional pile-on-last behavior.
  if (n > m) return positional();

  const turnTokens = turns.map(bindTokens);
  const sceneTokenSets = targets.map((s) => new Set(bindTokens(sceneMatchText(s))));
  const score = (t: number, s: number): number => turnSceneOverlap(turnTokens[t], sceneTokenSets[s]);

  // No discriminating signal anywhere → reproduce positional binding exactly.
  let maxSingle = 0;
  for (let t = 0; t < n; t += 1) {
    for (let s = 0; s < m; s += 1) maxSingle = Math.max(maxSingle, score(t, s));
  }
  if (maxSingle === 0) return positional();

  // Monotonic DP: f[i][j] = best total score placing the first i turns into the
  // first j scenes (each turn a distinct scene, scene indices strictly
  // increasing). f[i][j] = max(skip scene j, place turn i-1 at scene j-1).
  const NEG = -1;
  const f: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(NEG));
  for (let j = 0; j <= m; j += 1) f[0][j] = 0;
  for (let i = 1; i <= n; i += 1) {
    for (let j = i; j <= m; j += 1) {
      const skip = f[i][j - 1];
      const place = f[i - 1][j - 1] >= 0 ? f[i - 1][j - 1] + score(i - 1, j - 1) : NEG;
      // Prefer placement on ties so each turn binds to the earliest scene that
      // ties its best score (keeps the assignment compact and deterministic).
      f[i][j] = place >= skip ? place : skip;
    }
  }

  // Backtrack to recover the chosen scene for each turn.
  const assignment = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const skip = f[i][j - 1];
    const place = f[i - 1][j - 1] >= 0 ? f[i - 1][j - 1] + score(i - 1, j - 1) : NEG;
    if (place >= skip) {
      assignment[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }
  // Safety: any turn left unplaced (shouldn't happen for n<=m) falls back to its
  // positional slot so no turn is ever dropped.
  for (let t = 0; t < n; t += 1) {
    if (assignment[t] < 0) assignment[t] = Math.min(t, m - 1);
  }
  return assignment;
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
export function bindAuthoredTurnsToScenes(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  infoLedger?: NonNullable<SeasonPlan['informationLedger']>,
  protagonist?: SeasonPlan['protagonist'],
  priorBondNpcKeys?: Set<string>,
): void {
  if (scenes.length === 0) return;
  const guidance = ep.treatmentGuidance;
  // Primary source is the authored `episodeTurns` list (ENDSONG-style treatments).
  // Many treatments express per-episode beats through other sections instead — e.g.
  // the bite-me schema authors no "Episode turns" bullet but does author "Major choice
  // pressure" beats — so fall back to those when `episodeTurns` is empty. Without this
  // fallback the expand-not-rewrite binding would silently no-op on those formats,
  // leaving requiredBeats empty even though the episode is fully authored.
  const turns = getAuthoredEpisodeEventTexts(ep);
  // Signature device: the explicit `Visual anchor` if authored, else the episode's
  // first `Encounter anchor` (its staged hinge), which well-formed treatments carry
  // even when they omit a dedicated visual-anchor line.
  const explicitVisualAnchor = guidance?.visualAnchor?.trim();
  const fallbackEncounterAnchor = guidance?.encounterAnchors?.[0]?.trim();
  const fallbackAnchorAlreadyCovered = Boolean(
    fallbackEncounterAnchor
    && turns.length > 0
    && encounterIsCoveredByAuthoredTurns({ description: fallbackEncounterAnchor } as EpisodePlannedEncounter, turns)
  );
  const visualAnchor = explicitVisualAnchor || (fallbackAnchorAlreadyCovered ? undefined : fallbackEncounterAnchor);

  // Content scenes are everything except a trailing release breather (release is
  // aftermath, not authored content). Fall back to ALL scenes if every scene is a
  // release (degenerate) so turns are never dropped.
  const contentScenes = scenes.filter((s) => s.narrativeRole !== 'release');
  const targets = contentScenes.length > 0 ? contentScenes : scenes;

  // 1. Content-matched turn → scene binding. Each authored turn binds to the
  //    content scene that actually dramatizes it (order-preserving best overlap),
  //    not its positional slot — see {@link alignTurnsToScenes}. Falls back to
  //    exact positional binding when the scenes carry no per-turn signal
  //    (deterministic path) so that path is unchanged.
  //
  //    Bind spine turns to STANDARD prose scenes only — an ENCOUNTER scene's content is
  //    its anchor/signature (bound in step 2 below), and it physically cannot dramatize an
  //    unrelated spine turn. Encounters still get their signature (step 2) and advisory
  //    seeds (step 3); only authored spine turns are kept off them.
  const turnTargetsRaw = targets.filter((s) => s.kind !== 'encounter');
  const turnTargets = turnTargetsRaw.length > 0 ? turnTargetsRaw : targets;
  // A turn that near-duplicates the opening scene's cold-open hook is the SAME
  // event told twice (the story-circle "You" opener and the episode
  // description's first sentence both narrate the arrival). Binding both
  // consumes a second scene and starves the next authored event of its own
  // scene — bite-me run #7 (2026-07-02T23-23-50): two arrival turns took
  // s1-1 AND s1-2, so the dusk-club formation had no turn slot and its
  // socialMeet ownership defaulted to s1-1 where it can never be staged.
  // The hook already stages the event; drop the duplicate from spine binding.
  const coldOpenHookTexts = scenes
    .flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'coldopen'))
    .map((b) => String(b.mustDepict || b.sourceTurn || '').trim())
    .filter(Boolean);
  const hookTokenSets = coldOpenHookTexts.map((text) => new Set(bindTokens(text)));
  const duplicatesColdOpenHook = (turn: string): boolean =>
    hookTokenSets.some((hookSet) => {
      if (hookSet.size === 0) return false;
      const turnTokens = bindTokens(turn);
      if (turnTokens.length === 0) return false;
      const hits = tokenHitCount(turnTokens, hookSet);
      return hits / turnTokens.length >= 0.6;
    });
  const spineTurns = turns.filter((turn) => !duplicatesColdOpenHook(turn));
  const dedupedTurns = spineTurns.length > 0 ? spineTurns : turns;
  if (dedupedTurns.length > 0) {
    const assignment = alignTurnsToScenes(dedupedTurns, turnTargets);
    const perScene: RequiredBeat[][] = turnTargets.map(() => []);
    for (let t = 0; t < dedupedTurns.length; t += 1) {
      const slot = assignment[t];
      const scene = turnTargets[slot];
      const beatIndex = (scene.requiredBeats?.length ?? 0) + perScene[slot].length;
      perScene[slot].push(requiredBeatFromTurn(scene.id, beatIndex, dedupedTurns[t]));
      // Pin the scene's setting to the place its authored turn names (when it names a
      // declared episode location), overriding the deterministic collapse-to-first.
      // Only the LAST naming turn per scene wins (rare; a scene maps to ~1 turn).
      const namedLocation = inferAuthoredLocationFromText(dedupedTurns[t], ep.locations ?? []);
      if (namedLocation) scene.locations = [namedLocation];
    }
    turnTargets.forEach((scene, i) => appendRequiredBeats(scene, perScene[i]));
  }

  // 2. Signature device → the episode's anchor scene.
  if (visualAnchor) {
    const anchor =
      scenes.find((s) => s.kind === 'encounter')
      || scenes.find((s) => s.narrativeRole === 'turn')
      || targets[targets.length - 1];
    if (anchor) {
      anchor.signatureMoment = visualAnchor;
      const namedLocation = inferAuthoredLocationFromText(visualAnchor, ep.locations ?? []);
      if (namedLocation) anchor.locations = [namedLocation];
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

  // 3. Seed plants (ADVISORY, tier:'seed'). The episode turns above are the spine;
  //    the treatment also authors a cold open and a list of consequence seeds: the texture
  //    and setup wires that pay off in later episodes. These were previously carried on
  //    treatmentGuidance but never decomposed into beats, so the authors never saw
  //    them and dropped them. Distribute them as advisory seed beats: the cold open
  //    to the opening scene, each consequence seed to its best-match content scene
  //    (round-robin when the deterministic path offers no lexical signal). Gated on
  //    field presence so episodes the treatment is silent on stay byte-identical.
  const seedSpecs: Array<{ text: string; sourceTurn?: string; toOpening: boolean; tier: 'seed' | 'coldopen' }> = [];
  const coldOpen = guidance?.coldOpenFunction?.trim();
  // The cold open is split out as its own enforceable tier (WS1.3): it is the episode opener,
  // reliably present, so blocking on it is low-FP — unlike the generic consequence seeds, which
  // are texture/foreshadow and FP-prone to enforce. This lets a dedicated gate catch and
  // re-author missing cold opens instead of shipping silent warnings.
  if (coldOpen) {
    const text = structuralTreatmentRequiredBeatText(coldOpen);
    seedSpecs.push({ text, sourceTurn: text, toOpening: true, tier: 'coldopen' });
  }
  for (const seed of guidance?.consequenceSeeds ?? []) {
    const text = seed?.trim();
    if (text) seedSpecs.push({ text, toOpening: false, tier: 'seed' });
  }
  // Information-ledger plants for THIS episode (WS12L). Each ledger entry the episode
  // introduces or touches (the vampire reveal's "unphotographable" property, a model
  // going missing, a friend's tell) becomes an advisory seed so the author actually
  // plants the foreshadow — the per-episode info movement was carried in the season
  // plan but never decomposed into beats. Best-match distributed like consequence seeds.
  for (const entry of infoLedger ?? []) {
    const touches =
      entry.introducedEpisode === ep.episodeNumber
      || (entry.setupTouchEpisodes ?? []).includes(ep.episodeNumber);
    if (!touches) continue;
    const plant = informationLedgerPlantText(entry);
    if (plant) seedSpecs.push({ ...plant, toOpening: false, tier: 'seed' });
  }
  if (seedSpecs.length > 0) {
    const openingScene = targets.find((s) => s.narrativeRole === 'setup') ?? targets[0];
    const sceneTokenSets = targets.map((s) => new Set(bindTokens(sceneMatchText(s))));
    let roundRobin = 0;
    for (const spec of seedSpecs) {
      let scene: PlannedScene;
      if (spec.toOpening) {
        scene = openingScene;
      } else {
        const matchIdx = bestMatchSceneIndex(spec.text, sceneTokenSets);
        if (matchIdx >= 0) {
          scene = targets[matchIdx];
        } else {
          scene = targets[roundRobin % targets.length];
          roundRobin += 1;
        }
      }
      const beatIndex = scene.requiredBeats?.length ?? 0;
      const label = spec.tier === 'coldopen' ? 'coldopen' : 'seed';
      appendRequiredBeats(scene, [
        {
          id: `${scene.id}-${label}${beatIndex + 1}`,
          sourceTurn: spec.sourceTurn || spec.text,
          mustDepict: spec.text,
          tier: spec.tier,
        },
      ]);
    }
  }

  applySceneTurnContracts(scenes);
  applyRelationshipPacingContracts(scenes, protagonist, priorBondNpcKeys);
  applyMechanicPressureContracts(scenes);
  assignTreatmentFieldContractsToScenes(ep, scenes);
}

/** Resolve the Story Circle beat text an episode carries. */
export function storyCircleTextForEpisode(plan: SeasonPlan, ep: SeasonEpisode): string | undefined {
  const beat = ep.storyCircleRole?.[0]?.beat;
  return beat ? plan.storyCircle?.[beat] : undefined;
}

/** Build the ordered list of scenes for a single episode. */
export function buildEpisodeScenes(
  ep: SeasonEpisode,
  storyCircleText: string | undefined,
  infoLedger?: NonNullable<SeasonPlan['informationLedger']>,
  protagonist?: SeasonPlan['protagonist'],
  priorBondNpcKeys?: Set<string>,
): PlannedScene[] {
  const encounters = ep.plannedEncounters ?? [];
  const turns = getAuthoredEpisodeEventTexts(ep);
  const coveredEncounterIds = new Set(
    encounters
      .filter((enc) => encounterIsCoveredByAuthoredTurns(enc, turns))
      .map((enc) => enc.id),
  );
  const locations = ep.locations ?? [];
  const npcs = ep.mainCharacters ?? [];

  // Budget the scene count from max(estimatedSceneCount, authoredTurnCount) so an
  // episode that authored more turns than its estimate gets enough scenes to land
  // every turn as a required beat instead of starving turns (§3.2, §6).
  const turnCount = turns.length;
  const desired = clampSceneCount(ep.estimatedSceneCount || 5, turnCount);
  const standaloneEncounterCount = encounters.filter((enc) => !coveredEncounterIds.has(enc.id)).length;

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
      dramaticPurpose: composeDramaticPurpose(role, ep, storyCircleText),
      narrativeRole: role,
      locations: locations.slice(0, 1),
      npcsInvolved: npcs.slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: ep.synopsis,
      // Budget seed: mark choice-bearing standard scenes so the allocator picks
      // them up as weighted units. choiceType/consequenceTier stay unset here —
      // the allocator owns those.
      hasChoice: CHOICE_BEARING_ROLES.has(role),
      budgetWeight: SCENE_BUDGET_WEIGHT,
    });
    applyPlannerTurnContract(scenes[scenes.length - 1]);
    order += 1;
  };

  const pushEncounter = (enc: NonNullable<SeasonEpisode['plannedEncounters']>[number]): void => {
    const encounter = toSceneEncounter(enc);
    scenes.push({
      id: enc.id,
      episodeNumber: ep.episodeNumber,
      order,
      kind: 'encounter',
      title: truncateAtWordBoundary(enc.description, 60) || `encounter ${enc.id}`,
      // An authored encounter IS the scene's brief — carry its full description
      // (and central conflict) instead of the role boilerplate, so the
      // blueprint's description/dramaticQuestion fields stay anchored to the
      // treatment (G12 endsong: boilerplate here starved EncounterArchitect).
      dramaticPurpose: enc.description
        ? `${enc.description}${enc.centralConflict ? ` — Central conflict: ${enc.centralConflict}` : ''}`
        : composeDramaticPurpose('turn', ep, storyCircleText),
      narrativeRole: 'turn',
      locations: [inferAuthoredLocationFromText(
        [enc.description, enc.centralConflict, enc.stakes].filter(Boolean).join(' '),
        locations,
      ) || locations[0]].filter((location): location is string => Boolean(location)),
      npcsInvolved: enc.npcsInvolved ?? npcs.slice(0, 3),
      setsUp: [],
      paysOff: [],
      stakes: enc.stakes,
      encounter,
      // Budget seed: every encounter is a budgeted unit at encounter weight.
      hasChoice: true,
      budgetWeight: ENCOUNTER_BUDGET_WEIGHT,
    });
    applyPlannerTurnContract(scenes[scenes.length - 1]);
    order += 1;
  };

  // Standard-mode spine: setup -> development(s) -> encounter(s) -> release.
  let standardSlots = Math.max(2, desired - standaloneEncounterCount);
  if (turnCount > 0) standardSlots = Math.max(standardSlots, turnCount + 1);
  const hasRelease = standardSlots >= 2 && desired > standaloneEncounterCount + 1;
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
    if (coveredEncounterIds.has(enc.id)) continue;
    pushEncounter(enc);
  }
  // Closing release (kept free of authored turns when possible — see binder).
  if (hasRelease) {
    pushStandard('release');
  }

  const openingScene = scenes.find((scene) => scene.narrativeRole === 'setup') ?? scenes[0];
  if (ep.treatmentGuidance && openingScene && ep.storyCircleRole?.some((role) => role.beat === 'you') && storyCircleText?.trim()) {
    // Scope the cold-open hook to the FIRST EVENT of the Story Circle text.
    // The full "You" beat is a whole-episode summary ("arrives… forms the Dusk
    // Club… starts the blog… viral proof") — as a single mustDepict it is
    // unstageable in one scene, so SceneWriter echoes it as meta-summary prose
    // and the realization guard injects it verbatim as a reader-facing beat,
    // while the actual opening event (the arrival) never gets dramatized
    // (bite-me 2026-07-02T19-39-25 final-contract arrival blocker). First
    // EVENT ATOM, not first sentence: an analysis roll can emit the whole beat
    // as one run-on sentence ("arrives… while sipping dark negronis"), and a
    // sentence-scoped hook then carries club imagery into the arrival scene —
    // pinning its location to the club and making its turn unstageable
    // (bite-me 2026-07-02T23-54-38 location-mismatch + turn-realization pair).
    const fullHookText = storyCircleText.trim();
    const firstSentence = (fullHookText.match(/^[^.!?]+[.!?]/)?.[0] ?? fullHookText).trim();
    const hookAtoms = atomizeTreatmentText({
      episodeNumber: ep.episodeNumber,
      text: firstSentence,
      sourceSection: `storyCircleHook:${openingScene.id}`,
      idPrefix: `${openingScene.id}-hook`,
    });
    const hookText = (hookAtoms[0]?.eventText || firstSentence).trim();
    appendRequiredBeats(openingScene, [
      {
        id: `${openingScene.id}-hook1`,
        sourceTurn: hookText,
        mustDepict: hookText,
        tier: 'coldopen',
      },
    ]);
    // Only pin the opening scene's location when the FIRST event itself names
    // it — a venue mentioned later in the beat must not relocate the arrival.
    // When the hook names none, the skeleton default (first episode location)
    // can be a nightlife venue; an arrival cold-open staged "at the club" is
    // the location-mismatch abort of bite-me 2026-07-02T23-54-38. Prefer a
    // dwelling-shaped episode location for the arrival when one exists.
    const namedLocation = inferAuthoredLocationFromText(hookText, locations);
    if (namedLocation) {
      openingScene.locations = [namedLocation];
    } else if (/\barriv/i.test(hookText)) {
      const dwelling = locations.find((loc) => /\b(?:apartment|flat|home|house|residence|walk-?up|lodging|room)\b/i.test(loc));
      if (dwelling) openingScene.locations = [dwelling];
    }
  }

  // Bind authored turns + the signature device deterministically (shared with the
  // LLM-authored path). This is the single source of truth for turn→scene binding.
  bindAuthoredTurnsToScenes(ep, scenes, infoLedger, protagonist, priorBondNpcKeys);
  promoteCoveredAuthoredEncounters(ep, scenes, coveredEncounterIds);
  repairUnsupportedPlanningEventPurposes(ep, scenes);

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
  const priorBondNpcKeys = collectPriorBondNpcKeys(plan);
  const episodes = [...plan.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

  const scenesByEpisode = new Map<number, PlannedScene[]>();
  for (const ep of episodes) {
    scenesByEpisode.set(ep.episodeNumber, buildEpisodeScenes(ep, storyCircleTextForEpisode(plan, ep), plan.informationLedger, plan.protagonist, priorBondNpcKeys));
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
  const rawScenes: PlannedScene[] = [];
  const byEpisode: Record<number, string[]> = {};
  for (const ep of episodes) {
    const epScenes = scenesByEpisode.get(ep.episodeNumber) ?? [];
    byEpisode[ep.episodeNumber] = epScenes.map((s) => s.id);
    rawScenes.push(...epScenes);
  }
  const binding = rebindPlannedSceneObligations(rawScenes);
  const scenes = binding.scenes;
  const seasonPromiseContracts = assignSeasonPromiseContractsToScenes(plan, scenes);
  const storyCircleBeatContracts = assignStoryCircleBeatContractsToScenes(plan, scenes);
  const arcPressureContracts = assignArcPressureContractsToScenes(plan, scenes);
  const characterTreatmentContracts = assignCharacterTreatmentContractsToScenes(plan, scenes);
  const worldTreatmentContracts = assignWorldTreatmentContractsToScenes(plan, scenes);
  const stakesArchitectureContracts = assignStakesArchitectureContractsToScenes(plan, scenes);
  const branchConsequenceContracts = assignBranchConsequenceContractsToScenes(plan, scenes);
  const endingRealizationContracts = assignEndingRealizationContractsToScenes({
    ...plan,
    branchConsequenceContracts,
  }, scenes);
  const failureModeAuditContracts = assignFailureModeAuditContractsToScenes(plan, scenes);
  for (const ep of episodes) {
    finalizeEpisodeSceneOwnership(scenes, {
      episodeNumber: ep.episodeNumber,
      storyCircleRole: ep.storyCircleRole,
    });
  }
  normalizeRelationshipPacingStages(scenes);
  attachSceneConstructionProfiles(scenes);
  attachSceneEventOwnershipProfiles(scenes);

  return {
    scenes,
    byEpisode,
    setupPayoffEdges: edges,
    authoredTreatmentFields: binding.planLevelAuthoredTreatmentFields,
    seasonPromiseContracts,
    storyCircleBeatContracts,
    arcPressureContracts,
    stakesArchitectureContracts,
    branchConsequenceContracts,
    endingRealizationContracts,
    failureModeAuditContracts,
    characterTreatmentContracts,
    worldTreatmentContracts,
  };
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
