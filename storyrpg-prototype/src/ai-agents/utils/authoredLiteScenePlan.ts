import type { SeasonEpisode } from '../../types/seasonPlan';
import type {
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
} from '../../types/scenePlan';
import type { StoryCircleBeat } from '../../types/sourceAnalysis';
import type { EncounterCategory } from '../../types/sourceAnalysis';
import type { EncounterNarrativeStyle } from '../../types/encounter';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import { detectPrimaryStoryEventCues, type StoryEventCue } from '../remediation/storyEventCues';
import { storyCircleRoleBeats } from './storyCircleDistribution';
import { normalizeCharacterSlug, resolveRosterCharacter } from './npcIntroductionLedger';
import {
  coalesceFragmentedEpisodeTurns,
  countAuthoredLiteSceneBudget,
  orderAuthoredEpisodeTurns,
  sortPlannedScenesByChronologyCue,
  splitCompoundSpatialTurnText,
} from './treatmentTurnOrdering';
import { filterAuthoredLiteEpisodeTurns } from './authoredLiteTurnFilter';
import { detectSpatialUnitViolations, hardBeatTexts } from './sceneSpatialUnitPolicy';
import { isContainerLocationCue, uniqueMajorLocationCues } from './sceneLocationCues';
import { stripRegressiveAuthoredBeats } from './sceneEventOwnership';

function bindTokens(value: string | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = bindTokens(a);
  const bSet = new Set(bindTokens(b));
  if (aTokens.length === 0 || bSet.size === 0) return 0;
  const hits = aTokens.filter((token) => bSet.has(token)).length;
  return hits / aTokens.length;
}

function authoredLiteSpineTurns(ep: SeasonEpisode): string[] {
  const guidance = ep.treatmentGuidance;
  let turns: string[] = [];
  if (guidance?.episodeTurns?.length) turns = guidance.episodeTurns.filter((turn) => turn?.trim());
  else if (guidance?.majorChoicePressures?.length) turns = guidance.majorChoicePressures.filter((turn) => turn?.trim());
  else if (guidance?.encounterAnchors?.length) turns = guidance.encounterAnchors.filter((turn) => turn?.trim());
  turns = filterAuthoredLiteEpisodeTurns(turns, ep.episodeNumber);
  turns = coalesceFragmentedEpisodeTurns(turns);
  return orderAuthoredEpisodeTurns(turns);
}

function authoredTurnCount(ep: SeasonEpisode): number {
  return authoredLiteSpineTurns(ep).length;
}

const INTRODUCES_TURN_RE = /\bintroduces?\b/i;
const SOCIAL_ESTABLISHMENT_RE = /\b(?:befriend(?:s|ed|ing)?|becomes?\s+friends?|wanders?\s+into|meets?\s+(?:\w+|her|him|them)|bookshop|bookstore|welcomes?)\b/i;
const THREAT_ENCOUNTER_RE = /\b(?:attack(?:s|ed|ing)?|attacked|ambush(?:ed|es)?|knife|scream(?:s|ed|ing)?|rescue(?:s|d)?|saved?|saves|threat(?:en(?:s|ed|ing)?)?|danger(?:ous)?|grab(?:s|bed)?|pinned|corners?|lunges?|chases?|fight(?:s|ing)?\s+back)\b/i;
const ROMANTIC_ENCOUNTER_RE = /\b(?:romantic|flirt(?:s|ed|ing)?|kiss(?:es|ed)?|seduc(?:e|es|ed|tion))\b/i;

export function isAuthoredLiteEpisode(ep: SeasonEpisode | undefined): boolean {
  return ep?.treatmentGuidance?.sourceKind === 'authored_lite';
}

export function activeStoryCircleBeatsForEpisode(ep: SeasonEpisode | undefined): StoryCircleBeat[] {
  const active = storyCircleRoleBeats(ep?.storyCircleRole);
  return active.length > 0 ? active : [];
}

export function isIntroducesEpisodeTurn(turn: string): boolean {
  return INTRODUCES_TURN_RE.test(turn);
}

export function isSocialEstablishmentEpisodeTurn(turn: string): boolean {
  if (isIntroducesEpisodeTurn(turn)) return false;
  if (SOCIAL_ESTABLISHMENT_RE.test(turn)) return true;
  const cues = detectPrimaryStoryEventCues(turn);
  return cues.has('socialMeet') || cues.has('arrival');
}

/** Names or aliases introduced in a turn ("introduces Mika", "introduces the Dusk Club to Kylie"). */
export function introducedEntityTokens(turn: string): string[] {
  if (!isIntroducesEpisodeTurn(turn)) return [];
  const afterIntro = turn.split(/\bintroduces?\b/i)[1] ?? '';
  const subjectClause = (afterIntro.split(/\bto\b/i)[0] ?? afterIntro).trim();
  if (!subjectClause) return [];
  return subjectClause
    .split(/\s*(?:,| and |\/|\|)\s*/i)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').trim())
    .filter((token) => token.length >= 3 && !/^(the|a|an|her|him|them|their|she|he|they|club|group|trio)$/i.test(token));
}

export function introOrderConstraintPairs(turns: string[]): Array<[introTurnIndex: number, afterTurnIndex: number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < turns.length; i += 1) {
    if (!isIntroducesEpisodeTurn(turns[i])) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (isSocialEstablishmentEpisodeTurn(turns[j]) || detectPrimaryStoryEventCues(turns[j]).has('socialMeet')) {
        pairs.push([i, j]);
        break;
      }
    }
  }
  return pairs;
}

/**
 * Ensure "introduces …" turns bind to scenes strictly after the social-establishment
 * turn they depend on, and keep turn order monotonic across scene indices.
 */
export function repairIntroOrderTurnAssignment(
  turns: string[],
  assignment: number[],
  maxSceneIndex: number,
): number {
  if (assignment.length === 0 || maxSceneIndex < 0) return 0;
  let repairs = 0;
  for (const [introIdx, priorIdx] of introOrderConstraintPairs(turns)) {
    if (assignment[introIdx] <= assignment[priorIdx]) {
      assignment[introIdx] = Math.min(maxSceneIndex, assignment[priorIdx] + 1);
      repairs += 1;
    }
  }
  for (let t = 1; t < assignment.length; t += 1) {
    if (assignment[t] < assignment[t - 1]) {
      assignment[t] = assignment[t - 1];
      repairs += 1;
    }
  }
  return repairs;
}

function sceneBindingText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    ...(scene.requiredBeats ?? []).flatMap((beat) => [beat.mustDepict, beat.sourceTurn]),
  ].filter(Boolean).join('\n');
}

function sceneRouteCues(scene: PlannedScene): Set<StoryEventCue> {
  return detectPrimaryStoryEventCues(sceneBindingText(scene));
}

function rosterFromEpisode(ep: SeasonEpisode): Array<{ id: string; name: string }> {
  return (ep.mainCharacters ?? []).map((name) => ({ id: name, name }));
}

function npcSlugSet(ids: Iterable<string>): Set<string> {
  return new Set([...ids].map((id) => normalizeCharacterSlug(id)));
}

function stripNpcFromScene(scene: PlannedScene, blocked: Set<string>): number {
  if (!scene.npcsInvolved?.length || blocked.size === 0) return 0;
  const before = scene.npcsInvolved.length;
  scene.npcsInvolved = scene.npcsInvolved.filter((npc) => {
    const slug = normalizeCharacterSlug(npc);
    for (const blockedSlug of blocked) {
      if (slug === blockedSlug || slug.includes(blockedSlug) || blockedSlug.includes(slug)) return false;
    }
    return true;
  });
  return before - scene.npcsInvolved.length;
}

/** First turn index where an NPC is named on-page or explicitly introduced. */
export function buildNpcFirstAppearanceTurnIndex(
  turns: string[],
  roster: Array<{ id: string; name: string }>,
): Map<string, number> {
  const first = new Map<string, number>();
  for (const member of roster) {
    const nameParts = member.name.split(/\s+/).filter((part) => part.length >= 3);
    const searchTerms = [...new Set([member.name, ...nameParts])];
    for (let t = 0; t < turns.length; t += 1) {
      const turn = turns[t];
      if (searchTerms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(turn))) {
        first.set(normalizeCharacterSlug(member.id), t);
        break;
      }
    }
  }
  for (let t = 0; t < turns.length; t += 1) {
    for (const token of introducedEntityTokens(turns[t])) {
      const match = resolveRosterCharacter(token, roster);
      if (!match) continue;
      const slug = normalizeCharacterSlug(match.id);
      if (!first.has(slug) || t < first.get(slug)!) first.set(slug, t);
    }
  }
  return first;
}

function scenePlayOrder(scene: PlannedScene): number {
  return scene.order ?? 0;
}

/** Remove not-yet-introduced NPCs from scenes that precede their intro turn. */
export function enforceNpcIntroOrderOnScenes(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  turns: string[],
  assignment: number[],
  turnTargets?: PlannedScene[],
): number {
  const roster = rosterFromEpisode(ep);
  if (roster.length === 0 || assignment.length !== turns.length) return 0;
  const targets = turnTargets ?? scenes;
  let removals = 0;

  const firstTurnByNpc = buildNpcFirstAppearanceTurnIndex(turns, roster);
  for (const [npcSlug, turnIndex] of firstTurnByNpc) {
    const targetScene = targets[assignment[turnIndex]];
    if (!targetScene) continue;
    const introOrder = scenePlayOrder(targetScene);
    for (const scene of scenes) {
      if (scenePlayOrder(scene) >= introOrder) continue;
      removals += stripNpcFromScene(scene, new Set([npcSlug]));
    }
  }

  for (let t = 0; t < turns.length; t += 1) {
    const tokens = introducedEntityTokens(turns[t]);
    if (tokens.length === 0) continue;
    const introScene = targets[assignment[t]];
    if (!introScene) continue;
    const introOrder = scenePlayOrder(introScene);
    const introducedIds = npcSlugSet(
      tokens.flatMap((token) => {
        const match = resolveRosterCharacter(token, roster);
        return match ? [normalizeCharacterSlug(match.id), normalizeCharacterSlug(token)] : [normalizeCharacterSlug(token)];
      }),
    );
    for (const scene of scenes) {
      if (scenePlayOrder(scene) >= introOrder) continue;
      removals += stripNpcFromScene(scene, introducedIds);
    }
  }
  return removals;
}

const HARD_DRAIN_TIERS = new Set<RequiredBeat['tier']>(['authored', 'signature', 'coldopen']);

/** Drain later hard beats that duplicate earlier hard beats (≥70% token overlap). */
export function drainDuplicateAuthoredBeats(scenes: PlannedScene[]): number {
  let drained = 0;
  const coveredTexts: string[] = [];
  for (const scene of [...scenes].sort((a, b) => scenePlayOrder(a) - scenePlayOrder(b))) {
    const authored = (scene.requiredBeats ?? []).filter((beat) =>
      beat.tier === 'authored' || beat.tier === 'signature');
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      if (!HARD_DRAIN_TIERS.has(beat.tier)) {
        kept.push(beat);
        continue;
      }
      const text = [beat.mustDepict, beat.sourceTurn].filter(Boolean).join(' ');
      const duplicate = coveredTexts.some((prior) => tokenOverlapRatio(text, prior) >= 0.7
        || tokenOverlapRatio(prior, text) >= 0.7);
      if (duplicate) {
        drained += 1;
        continue;
      }
      kept.push(beat);
      if (text.trim()) coveredTexts.push(text);
    }
    if (authored.length > 0 && kept.filter((beat) => beat.tier === 'authored' || beat.tier === 'signature').length === 0) {
      scene.narrativeRole = scene.narrativeRole === 'setup' ? scene.narrativeRole : 'development';
    }
    scene.requiredBeats = kept;
  }
  return drained;
}

function appendUniqueRequiredBeats(scene: PlannedScene, beats: RequiredBeat[]): void {
  if (beats.length === 0) return;
  const existing = new Set((scene.requiredBeats ?? []).map((beat) => beat.id));
  const merged = [...(scene.requiredBeats ?? [])];
  for (const beat of beats) {
    if (existing.has(beat.id)) continue;
    existing.add(beat.id);
    merged.push(beat);
  }
  scene.requiredBeats = merged;
}

function mergeAdjacentAftermathScenes(scenes: PlannedScene[]): number {
  for (let i = 0; i < scenes.length - 1; i += 1) {
    const current = scenes[i];
    const next = scenes[i + 1];
    if (current.kind !== 'standard' || next.kind !== 'standard') continue;
    if (current.narrativeRole === 'release' || next.narrativeRole === 'release') continue;
    const currentCues = sceneRouteCues(current);
    const nextCues = sceneRouteCues(next);
    const mergesAftermath =
      (currentCues.has('lateNightWriting') && nextCues.has('blogAftermath') && !nextCues.has('lateNightWriting'))
      || (currentCues.has('blogAftermath') && nextCues.has('blogAftermath'));
    if (!mergesAftermath) continue;
    appendUniqueRequiredBeats(current, next.requiredBeats ?? []);
    if (next.dramaticPurpose?.trim()) {
      current.dramaticPurpose = [current.dramaticPurpose, next.dramaticPurpose].filter(Boolean).join(' ');
    }
    current.setsUp = Array.from(new Set([...(current.setsUp ?? []), ...(next.setsUp ?? [])]));
    const nextTargets = next.setsUp?.length ? next.setsUp : scenes.slice(i + 2).map((scene) => scene.id);
    for (const scene of scenes) {
      scene.setsUp = (scene.setsUp ?? []).map((target) => (target === next.id ? current.id : target));
      scene.paysOff = (scene.paysOff ?? []).map((target) => (target === next.id ? current.id : target));
    }
    if (nextTargets.length > 0) {
      current.setsUp = Array.from(new Set([...(current.setsUp ?? []), ...nextTargets.filter((id) => id !== next.id)]));
    }
    scenes.splice(i + 1, 1);
    scenes.forEach((scene, index) => { scene.order = index; });
    return 1 + mergeAdjacentAftermathScenes(scenes);
  }
  return 0;
}

function trimSurplusStandardScenes(ep: SeasonEpisode, scenes: PlannedScene[]): number {
  const spineTurns = authoredLiteSpineTurns(ep);
  const encounterCount = scenes.filter((scene) => scene.kind === 'encounter').length;
  const budget = countAuthoredLiteSceneBudget(spineTurns, encounterCount);
  const turnBudget = budget.preThreatScenes + budget.postThreatScenes;
  if (turnBudget === 0) return 0;
  let removed = 0;
  const countStandard = () => scenes.filter((scene) => scene.kind === 'standard' && scene.narrativeRole !== 'release').length;
  while (countStandard() > turnBudget) {
    let candidateIndex = -1;
    for (let i = scenes.length - 1; i >= 0; i -= 1) {
      const scene = scenes[i];
      if (scene.kind !== 'standard' || scene.narrativeRole === 'release') continue;
      const hasAuthored = (scene.requiredBeats ?? []).some((beat) =>
        beat.tier === 'authored' || beat.tier === 'signature' || beat.tier === 'coldopen');
      if (hasAuthored) continue;
      candidateIndex = i;
      break;
    }
    if (candidateIndex < 0) break;
    scenes.splice(candidateIndex, 1);
    removed += 1;
  }
  if (removed > 0) {
    scenes.forEach((scene, index) => { scene.order = index; });
  }
  return removed;
}

export function consolidateAuthoredLiteScenes(ep: SeasonEpisode, scenes: PlannedScene[]): number {
  if (!isAuthoredLiteEpisode(ep)) return 0;
  return mergeAdjacentAftermathScenes(scenes) + trimSurplusStandardScenes(ep, scenes);
}

type LocationInferer = (text: string, locations: string[]) => string | undefined;

const HARD_SPLIT_TIERS = new Set<RequiredBeat['tier']>(['authored', 'signature', 'coldopen']);

function requiredBeatFromSplit(sceneId: string, beatIndex: number, text: string, tier: RequiredBeat['tier']): RequiredBeat {
  return {
    id: `${sceneId}-spatial${beatIndex + 1}`,
    sourceTurn: text,
    mustDepict: text,
    tier,
  };
}

function insertSplitScenes(
  scene: PlannedScene,
  splitTexts: string[],
  tiers: RequiredBeat['tier'][],
  staticBeats: RequiredBeat[],
  scenes: PlannedScene[],
  insertAt: number,
  inferLocation: LocationInferer,
  locations: string[],
): number {
  let splits = 0;
  const [keepText, ...overflowTexts] = splitTexts;
  const keepTier = tiers[0] ?? 'authored';
  scene.requiredBeats = [...staticBeats, requiredBeatFromSplit(scene.id, 0, keepText, keepTier)];
  const keepLocation = inferLocation(keepText, locations);
  if (keepLocation) scene.locations = [keepLocation];

  let nextInsert = insertAt;
  for (let beatIndex = 0; beatIndex < overflowTexts.length; beatIndex += 1) {
    const text = overflowTexts[beatIndex];
    const tier = tiers[beatIndex + 1] ?? 'authored';
    const beatLocation = inferLocation(text, locations);
    const splitScene: PlannedScene = {
      id: `${scene.id}-spatial-${beatIndex + 1}`,
      episodeNumber: scene.episodeNumber,
      order: nextInsert,
      kind: 'standard',
      title: text.slice(0, 60) || `${scene.title} (continued)`,
      dramaticPurpose: text || scene.dramaticPurpose,
      narrativeRole: 'development',
      locations: [beatLocation || scene.locations?.[0] || locations[0]].filter(Boolean) as string[],
      npcsInvolved: [...(scene.npcsInvolved ?? [])],
      setsUp: [...(scene.setsUp ?? [])],
      paysOff: [...(scene.paysOff ?? [])],
      hasChoice: scene.hasChoice,
      budgetWeight: scene.budgetWeight,
      requiredBeats: [requiredBeatFromSplit(`${scene.id}-spatial-${beatIndex + 1}`, 0, text, tier)],
    };
    scenes.splice(nextInsert, 0, splitScene);
    nextInsert += 1;
    splits += 1;
  }
  if (splits > 0) {
    scenes.forEach((entry, order) => { entry.order = order; });
  }
  return splits;
}

/** Split scenes whose hard beats span multiple major locations (safety net after bind). */
export function splitStackedSpatialScenes(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  inferLocation: LocationInferer,
): number {
  if (!isAuthoredLiteEpisode(ep)) return 0;
  const locations = ep.locations ?? [];
  let splits = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene.kind !== 'standard') continue;
    const violation = detectSpatialUnitViolations(scene);
    if (!violation) continue;

    const staticBeats = (scene.requiredBeats ?? []).filter((beat) => !HARD_SPLIT_TIERS.has(beat.tier));
    const hardBeats = (scene.requiredBeats ?? []).filter((beat) => HARD_SPLIT_TIERS.has(beat.tier));
    if (hardBeats.length === 0) continue;

    if (hardBeats.length === 1) {
      const beat = hardBeats[0];
      const text = beat.mustDepict || beat.sourceTurn || '';
      const parts = splitCompoundSpatialTurnText(text);
      if (parts.length >= 2) {
        splits += insertSplitScenes(
          scene,
          parts,
          [beat.tier, beat.tier],
          staticBeats,
          scenes,
          index + 1,
          inferLocation,
          locations,
        );
      }
      continue;
    }

    const [keep, ...overflow] = hardBeats;
    scene.requiredBeats = [...staticBeats, keep];
    const keepLocation = inferLocation(keep.mustDepict || keep.sourceTurn || '', locations);
    if (keepLocation) scene.locations = [keepLocation];

    let insertAt = index + 1;
    for (let beatIndex = 0; beatIndex < overflow.length; beatIndex += 1) {
      const beat = overflow[beatIndex];
      const beatLocation = inferLocation(beat.mustDepict || beat.sourceTurn || '', locations);
      const splitScene: PlannedScene = {
        id: `${scene.id}-spatial-${beatIndex + 1}`,
        episodeNumber: scene.episodeNumber,
        order: insertAt,
        kind: 'standard',
        title: beat.mustDepict?.slice(0, 60) || `${scene.title} (continued)`,
        dramaticPurpose: beat.mustDepict || beat.sourceTurn || scene.dramaticPurpose,
        narrativeRole: 'development',
        locations: [beatLocation || scene.locations?.[0] || locations[0]].filter(Boolean) as string[],
        npcsInvolved: [...(scene.npcsInvolved ?? [])],
        setsUp: [...(scene.setsUp ?? [])],
        paysOff: [...(scene.paysOff ?? [])],
        hasChoice: scene.hasChoice,
        budgetWeight: scene.budgetWeight,
        requiredBeats: [beat],
      };
      scenes.splice(insertAt, 0, splitScene);
      insertAt += 1;
      splits += 1;
    }
    if (overflow.length > 0) {
      scenes.forEach((entry, order) => { entry.order = order; });
    }
  }
  return splits;
}

export function pinAuthoredSceneLocations(
  scenes: PlannedScene[],
  inferLocation: LocationInferer,
  episodeLocations: string[],
): number {
  let pinned = 0;
  for (const scene of scenes) {
    if (scene.kind !== 'standard') continue;
    const authoredTexts = hardBeatTexts((scene.requiredBeats ?? []).filter((beat) =>
      beat.tier === 'authored' || beat.tier === 'signature'));
    if (authoredTexts.length === 0) continue;
    const primaryText = authoredTexts[0];
    const named = inferLocation(primaryText, episodeLocations);
    if (named) {
      scene.locations = [named];
      pinned += 1;
      continue;
    }
    const containerCue = uniqueMajorLocationCues([primaryText]).find((cue) => isContainerLocationCue(cue));
    if (containerCue) {
      const declared = episodeLocations.find((loc) =>
        loc.toLowerCase().includes(containerCue) || containerCue.includes(loc.toLowerCase().split(' ')[0]));
      scene.locations = [declared || containerCue];
      pinned += 1;
    }
  }
  return pinned;
}

export function inferAuthoredEncounterPresentation(text: string): {
  type?: EncounterCategory;
  style?: EncounterNarrativeStyle;
} {
  const normalized = text.toLowerCase();
  const hasThreat = THREAT_ENCOUNTER_RE.test(normalized);
  const hasRescue = /\b(?:rescues?|rescued|rescue|saved?|saves)\b/i.test(normalized);
  if (hasThreat || hasRescue) {
    return { type: 'survival', style: 'dramatic' };
  }
  if (ROMANTIC_ENCOUNTER_RE.test(normalized)) {
    return { type: 'romantic', style: 'romantic' };
  }
  return {};
}

/** Require the rescuer to be named on-page in threat/rescue encounters. */
export function appendEncounterRescuerNamingBeat(scene: PlannedScene): boolean {
  if (scene.kind !== 'encounter' || !scene.encounter) return false;
  const anchor = authoredRequiredBeatText(scene);
  if (!THREAT_ENCOUNTER_RE.test(anchor) && !/\b(?:cismigiu|walk(?:s|ed|ing)?\s+home)\b/i.test(anchor)) return false;
  const beatId = `${scene.id}-rescuer-named`;
  if ((scene.requiredBeats ?? []).some((beat) => beat.id === beatId)) return false;
  const beat: RequiredBeat = {
    id: beatId,
    sourceTurn: anchor,
    mustDepict: 'Name the rescuer on-page (full name or codename such as Mr. Midnight) and let the protagonist register who saved them before the threshold handoff.',
    tier: 'authored',
  };
  scene.requiredBeats = [...(scene.requiredBeats ?? []), beat];
  return true;
}

export function applyAuthoredEncounterPresentation(scene: PlannedScene, anchorText: string): boolean {
  const inferred = inferAuthoredEncounterPresentation(anchorText);
  if (!inferred.type && !inferred.style) return false;
  if (!scene.encounter) return false;
  if (inferred.type) scene.encounter.type = inferred.type;
  if (inferred.style) scene.encounter.style = inferred.style;
  return true;
}

/** Stamp outgoing residue obligations onto choice scenes via mechanic-pressure hooks. */
export function attachAuthoredLiteResidueHooks(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  outgoingResidue: SeasonResidueObligation[] | undefined,
): number {
  if (!isAuthoredLiteEpisode(ep) || !outgoingResidue?.length) return 0;
  let attached = 0;
  const flagKeywords = (flag: string): string[] =>
    flag.replace(/^flag:/, '').split(/[_-]+/).filter((part) => part.length >= 4);

  for (const obligation of outgoingResidue) {
    if (obligation.sourceEpisodeNumber !== ep.episodeNumber || !obligation.flag) continue;
    const anchor = obligation.choiceAnchor?.toLowerCase() ?? '';
    const keywords = flagKeywords(obligation.flag);
    const target = scenes.find((scene) =>
      scene.hasChoice
      && keywords.some((keyword) =>
        sceneBindingText(scene).toLowerCase().includes(keyword)
        || (scene.requiredBeats ?? []).some((beat) => beat.mustDepict?.toLowerCase().includes(keyword)),
      ))
      || scenes.find((scene) =>
        scene.hasChoice
        && (scene.requiredBeats ?? []).some((beat) => beat.mustDepict?.toLowerCase().includes(anchor.slice(0, 20))))
      || scenes.find((scene) => scene.hasChoice && scene.npcsInvolved?.some((npc) =>
        /stela/i.test(npc)) && /trust|open|ward/i.test(sceneBindingText(scene)))
      || scenes.find((scene) => scene.hasChoice && scene.kind !== 'encounter')
      || scenes.find((scene) => scene.hasChoice);
    if (!target) continue;
    const contractId = `${target.id}-residue-${obligation.id}`;
    if ((target.mechanicPressure ?? []).some((contract) => contract.id === contractId)) continue;
    const contract: MechanicPressureContract = {
      id: contractId,
      source: 'treatment',
      domain: 'flag',
      mechanicRef: { flag: obligation.flag },
      function: 'plant',
      storyPressure: obligation.authoringGuidance || obligation.choiceAnchor || obligation.flag,
      evidenceRequired: ['A choice in this scene must set the planned residue flag through visible story consequence.'],
      visibleResidue: obligation.sourceMaterial?.residueHints?.filter(Boolean) ?? [],
      allowedPayoffs: obligation.targetEpisodeNumbers.map((episode) => `episode ${episode}`),
      blockedPayoffs: [],
      originatingSceneId: target.id,
    };
    target.mechanicPressure = [...(target.mechanicPressure ?? []), contract];
    attached += 1;
  }
  return attached;
}

export function finalizeAuthoredLiteScenePlan(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  outgoingResidue?: SeasonResidueObligation[],
): number {
  if (!isAuthoredLiteEpisode(ep)) return 0;
  let changes = sortPlannedScenesByChronologyCue(scenes);
  changes += stripRegressiveAuthoredBeats(scenes);
  changes += drainDuplicateAuthoredBeats(scenes);
  changes += consolidateAuthoredLiteScenes(ep, scenes);
  for (const scene of scenes) {
    if (scene.kind !== 'encounter' || !scene.encounter) continue;
    const anchor = [
      scene.encounter.description,
      scene.encounter.centralConflict,
      scene.dramaticPurpose,
      authoredRequiredBeatText(scene),
    ].filter(Boolean).join(' ');
    if (applyAuthoredEncounterPresentation(scene, anchor)) changes += 1;
    if (appendEncounterRescuerNamingBeat(scene)) changes += 1;
  }
  changes += attachAuthoredLiteResidueHooks(ep, scenes, outgoingResidue);
  return changes;
}

function authoredRequiredBeatText(scene: PlannedScene): string {
  return (scene.requiredBeats ?? [])
    .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature')
    .map((beat) => beat.mustDepict)
    .filter(Boolean)
    .join(' ');
}

export function isAuthoredLiteSeasonPlan(plan: {
  episodes?: Array<{ treatmentGuidance?: { sourceKind?: string } }>;
} | undefined): boolean {
  if (!plan) return false;
  return (plan.episodes ?? []).some((episode) => episode.treatmentGuidance?.sourceKind === 'authored_lite');
}
