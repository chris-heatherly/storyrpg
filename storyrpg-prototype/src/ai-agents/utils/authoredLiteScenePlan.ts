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

function authoredTurnCount(ep: SeasonEpisode): number {
  const guidance = ep.treatmentGuidance;
  if (guidance?.episodeTurns?.length) return guidance.episodeTurns.filter((turn) => turn?.trim()).length;
  if (guidance?.majorChoicePressures?.length) return guidance.majorChoicePressures.filter((turn) => turn?.trim()).length;
  return 0;
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

/** Remove not-yet-introduced NPCs from scenes that precede their intro turn. */
export function enforceNpcIntroOrderOnScenes(
  ep: SeasonEpisode,
  scenes: PlannedScene[],
  turns: string[],
  assignment: number[],
): number {
  const roster = rosterFromEpisode(ep);
  if (roster.length === 0 || assignment.length !== turns.length) return 0;
  let removals = 0;
  for (let t = 0; t < turns.length; t += 1) {
    const tokens = introducedEntityTokens(turns[t]);
    if (tokens.length === 0) continue;
    const introSceneIndex = assignment[t];
    const introducedIds = new Set<string>();
    for (const token of tokens) {
      const match = resolveRosterCharacter(token, roster);
      if (match) introducedIds.add(normalizeCharacterSlug(match.id));
      introducedIds.add(normalizeCharacterSlug(token));
    }
    for (let s = 0; s < introSceneIndex; s += 1) {
      const scene = scenes[s];
      if (!scene?.npcsInvolved?.length) continue;
      const before = scene.npcsInvolved.length;
      scene.npcsInvolved = scene.npcsInvolved.filter((npc) => {
        const slug = normalizeCharacterSlug(npc);
        for (const introduced of introducedIds) {
          if (slug === introduced || slug.includes(introduced) || introduced.includes(slug)) return false;
        }
        return true;
      });
      if (scene.npcsInvolved.length < before) removals += before - scene.npcsInvolved.length;
    }
  }
  return removals;
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
  const turnBudget = authoredTurnCount(ep);
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

export function inferAuthoredEncounterPresentation(text: string): {
  type?: EncounterCategory;
  style?: EncounterNarrativeStyle;
} {
  const normalized = text.toLowerCase();
  if (THREAT_ENCOUNTER_RE.test(normalized)) {
    return { type: 'survival', style: 'dramatic' };
  }
  if (ROMANTIC_ENCOUNTER_RE.test(normalized) && !THREAT_ENCOUNTER_RE.test(normalized)) {
    return { type: 'romantic', style: 'romantic' };
  }
  return {};
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
  for (const obligation of outgoingResidue) {
    if (obligation.sourceEpisodeNumber !== ep.episodeNumber || !obligation.flag) continue;
    const anchor = obligation.choiceAnchor?.toLowerCase() ?? '';
    const target = scenes.find((scene) =>
      scene.hasChoice
      && (scene.requiredBeats ?? []).some((beat) => beat.mustDepict?.toLowerCase().includes(anchor.slice(0, 20))))
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
  let changes = consolidateAuthoredLiteScenes(ep, scenes);
  for (const scene of scenes) {
    if (scene.kind !== 'encounter' || !scene.encounter) continue;
    const anchor = [
      scene.encounter.description,
      scene.encounter.centralConflict,
      scene.dramaticPurpose,
      authoredRequiredBeatText(scene),
    ].filter(Boolean).join(' ');
    if (applyAuthoredEncounterPresentation(scene, anchor)) changes += 1;
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
