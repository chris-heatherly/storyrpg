import type { SeasonPlan } from '../../types/seasonPlan';
import type {
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type {
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
  StoryCircleBeatRealizationContract,
  StoryCircleBeatRealizationTarget,
} from '../../types/scenePlan';
import { classifyTreatmentObligation } from '../validators/treatmentObligationClassifier';
import { detectStoryEventCues } from '../remediation/storyEventCues';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const BEAT_LABELS: Record<StoryCircleBeat, RegExp[]> = {
  you: [/\byou\b/i],
  need: [/\bneed\b/i, /\bwant\s*(?:vs\.?|\/)?\s*need\b/i, /\bprotagonist\s+need\b/i],
  go: [/\bgo\b/i, /\bthreshold\b/i],
  search: [/\bsearch\b/i],
  find: [/\bfind\b/i],
  take: [/\btake\b/i, /\bprice\b/i],
  return: [/\breturn\b/i],
  change: [/\bchange\b/i],
};

const STATE_CHANGE_RE =
  /\b(goes viral|go viral|skips? a day|genre changes?|changes?|reveals?|confesses?|confession|offers?|frames?|hospitalized|turns?|dies?|dark|saved?|rescued?|runs?|walks? out|chooses?|choice|ends?|final post|dawn|truths?|mirror|contract|freed|forgiven|surrender|refuse|humanity|voice)\b/i;
const ACTION_VERB_RE = /\b(?:accepts?|adopts?|arrives?|asks?|assaults?|attacks?|buzzes?|calls?|closes?|confronts?|cuts?|declines?|deflects?|delivers?|drops?|finds?|follows?|forms?|gathers?|gives?|hands?|interrupts?|kisses?|lands?|launches?|leaps?|leaves?|names?|offers?|opens?|pins?|presses?|publishes?|refuses?|rescues?|scrolls?|sees?|starts?|swaps?|takes?|turns?|unpacks?|vanishes?|walks?|warns?|writes?)\b/i;

export interface EpisodeCircleContractScene {
  id: string;
  order?: number;
  name?: string;
  description?: string;
  dramaticPurpose?: string;
  narrativeFunction?: string;
  narrativeRole?: string;
  isEncounter?: boolean;
  hasChoice?: boolean;
  choicePoint?: unknown;
  keyBeats?: string[];
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'beat';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeBeatLine(line: string, beat: StoryCircleBeat): string | undefined {
  const label = BEAT_LABELS[beat].find((candidate) => candidate.test(line));
  if (!label) return undefined;
  const clean = line
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  const withoutLabel = clean
    .replace(label, '')
    .replace(/^\s*[:\-–—]\s*/, '')
    .trim();
  return withoutLabel || clean;
}

function extractBeatText(spine: string | undefined, beat: StoryCircleBeat): string | undefined {
  if (!spine?.trim()) return undefined;
  const matchingLines = spine
    .split(/\r?\n/)
    .map((line) => normalizeBeatLine(line, beat))
    .filter((line): line is string => Boolean(line));
  if (matchingLines.length === 0) return undefined;
  return matchingLines.sort((a, b) => b.length - a.length)[0];
}

function eventAtoms(text: string): string[] {
  const atoms = text
    .replace(/\([^)]*\bEp(?:isode)?\.?\s*#?\s*\d+[^)]*\)/gi, '')
    .replace(/\b(Mr|Mrs|Ms|Dr)\./g, '$1')
    .replace(/^\s*[^.!?\n:]{1,160}:\s+/, '')
    .split(/\s*(?:→|;|\.|\band then\b|\bwhile\b|\bbut\b)\s*/i)
    .flatMap(expandCompositeEventAtom)
    .map((part) => part.trim().replace(/^[-–—:,]+|[-–—:,]+$/g, '').trim())
    .filter((part) => treatmentFieldTokens(part).length >= 3);
  return dedupe(atoms).slice(0, 8);
}

function protectQuotedCommas(text: string): string {
  return text.replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, (match) => match.replace(/,/g, '__COMMA__'));
}

function restoreQuotedCommas(text: string): string {
  return text.replace(/__COMMA__/g, ',');
}

function splitSubjectActionSeries(text: string): string[] {
  const raw = protectQuotedCommas(text)
    .replace(/^\s*(?:and|then)\s+/i, '')
    .split(/\s*,\s*|\s+\band\s+/i)
    .map((part) => restoreQuotedCommas(part).trim().replace(/^(?:and|then)\s+/i, ''))
    .filter((part) => treatmentFieldTokens(part).length >= 3);
  if (raw.length < 2) return [text.trim()].filter(Boolean);

  const firstVerb = ACTION_VERB_RE.exec(raw[0]);
  if (!firstVerb || firstVerb.index <= 0) return [text.trim()].filter(Boolean);
  const subject = raw[0].slice(0, firstVerb.index).trim();
  if (subject.length < 2 || subject.length > 90) return [text.trim()].filter(Boolean);
  let actionPrefixEnd = 1;
  while (actionPrefixEnd < raw.length && ACTION_VERB_RE.test(raw[actionPrefixEnd])) {
    actionPrefixEnd++;
  }
  if (actionPrefixEnd < 2) return [text.trim()].filter(Boolean);

  const actionParts = raw.slice(0, actionPrefixEnd);
  const trailingDescription = raw.slice(actionPrefixEnd).join(', ');
  if (trailingDescription) {
    actionParts[actionParts.length - 1] = `${actionParts[actionParts.length - 1]}, ${trailingDescription}`;
  }

  const parts = actionParts.map((part, index) => {
    if (index === 0) return part;
    return `${subject} ${part}`;
  });
  return parts.length > 1 ? parts : [text.trim()].filter(Boolean);
}

function expandCompositeEventAtom(atom: string): string[] {
  const text = atom.trim().replace(/\s+/g, ' ');
  const normalized = text.toLowerCase();
  const expanded: string[] = [];
  const actionSeries = splitSubjectActionSeries(text);
  if (actionSeries.length > 1) expanded.push(...actionSeries);

  if (/\barrives?\s+in\s+bucharest\b/.test(normalized) && /\bdusk club\b/.test(normalized)) {
    const arrival = text.match(/\b(?:she|kylie)\s+arrives?\s+in\s+bucharest\b[\s\S]*?(?=,\s*(?:and\s+)?gathers?\b|\s+and\s+gathers?\b|$)/i)?.[0];
    const duskClub = text.match(/\b(?:(?:she|kylie)\s+)?gathers?\s+the\s+Dusk\s+Club\b[\s\S]*?(?=,\s*(?:and\s+)?protects?\b|\s+and\s+protects?\b|$)/i)?.[0];
    const selfProtection = text.match(/\b(?:(?:she|kylie)\s+)?protects?\s+herself\b[\s\S]*$/i)?.[0];
    expanded.push(...[arrival, duskClub, selfProtection].filter(Boolean) as string[]);
  }

  if (/\bstaged rescue\b/.test(normalized) && /\bviral\b/.test(normalized)) {
    expanded.push('The staged rescue happens.');
    const viral = text.match(/\b(?:the\s+)?viral\b[\s\S]*$/i)?.[0];
    expanded.push(viral ? viral.replace(/\bclose(?:s)?\s+the\s+beat\b/i, 'changes the aftermath').trim() : 'The viral post makes her a name.');
  }

  if (expanded.length > 0) return expanded;
  return [text];
}

function requiredRealizationFor(beat: StoryCircleBeat, sourceText: string): StoryCircleBeatRealizationTarget[] {
  const targets: StoryCircleBeatRealizationTarget[] = ['season_plan', 'scene_turn', 'final_prose'];
  if (beat === 'return' || beat === 'change') targets.push('episode_ending');
  if (STATE_CHANGE_RE.test(sourceText)) targets.push('mechanic_pressure');
  return dedupe(targets) as StoryCircleBeatRealizationTarget[];
}

function defaultTargetEpisode(beat: StoryCircleBeat, totalEpisodes: number): number {
  const max = Math.max(1, totalEpisodes || 1);
  const index = STORY_CIRCLE_BEATS.indexOf(beat);
  if (index <= 0) return 1;
  return Math.max(1, Math.min(max, Math.ceil(((index + 1) / STORY_CIRCLE_BEATS.length) * max)));
}

function targetEpisodeFor(
  guidance: TreatmentSeasonGuidance | undefined,
  beat: StoryCircleBeat,
  totalEpisodes: number,
): number {
  const explicit = guidance?.storyCircleBeatEpisodeAnchors?.[beat];
  if (explicit) return explicit;
  return defaultTargetEpisode(beat, totalEpisodes);
}

export function buildStoryCircleBeatContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  storyCircle?: StoryCircleStructure;
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): StoryCircleBeatRealizationContract[] {
  const out: StoryCircleBeatRealizationContract[] = [];
  const hasAuthoredSpine = Boolean(input.guidance?.seasonSpine?.trim());
  const level: StoryCircleBeatRealizationContract['blockingLevel'] = input.treatmentSourced && hasAuthoredSpine
    ? 'treatment'
    : 'warning';

  for (const beat of STORY_CIRCLE_BEATS) {
    const authoredText = extractBeatText(input.guidance?.seasonSpine, beat);
    const sourceText = hasAuthoredSpine
      ? authoredText ?? ''
      : input.storyCircle?.[beat] ?? '';
    if (!sourceText.trim()) continue;
    const atoms = eventAtoms(sourceText);
    out.push({
      id: `story-circle-${beat}-${slug(sourceText)}`,
      beat,
      sourceText,
      targetEpisodeNumber: targetEpisodeFor(input.guidance, beat, input.totalEpisodes),
      requiredRealization: requiredRealizationFor(beat, sourceText),
      eventAtoms: atoms.length > 0 ? atoms : [sourceText],
      stateChange: STATE_CHANGE_RE.test(sourceText) ? sourceText : undefined,
      targetSceneIds: [],
      blockingLevel: level,
    });
  }

  return out;
}

export function buildStoryCircleBeatContractsForPlan(
  plan: Pick<SeasonPlan, 'storyCircleBeatContracts' | 'storyCircle' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): StoryCircleBeatRealizationContract[] {
  if ((plan.storyCircleBeatContracts ?? []).length > 0) return plan.storyCircleBeatContracts ?? [];
  return buildStoryCircleBeatContracts({
    guidance: plan.treatmentSeasonGuidance,
    storyCircle: plan.storyCircle,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.seasonSpine),
  });
}

function requiredEpisodeRealizationFor(beat: StoryCircleBeat, sourceText: string): StoryCircleBeatRealizationTarget[] {
  if (isAggregateEpisodeCircleSource(sourceText)) {
    return ['season_plan', 'scene_turn'];
  }
  const targets: StoryCircleBeatRealizationTarget[] = ['scene_turn', 'final_prose'];
  if (beat === 'return' || beat === 'change') targets.push('episode_ending');
  if (STATE_CHANGE_RE.test(sourceText)) targets.push('mechanic_pressure');
  return dedupe(targets) as StoryCircleBeatRealizationTarget[];
}

function isAggregateEpisodeCircleSource(sourceText: string): boolean {
  const atoms = eventAtoms(sourceText);
  const tokenCount = treatmentFieldTokens(sourceText).length;
  const hasRolePrefix = /^\s*[^.!?\n:]{1,120}:\s+/.test(sourceText);
  const hasEpisodeCircleInstruction =
    /^(?:in\s+["“][^"”]+["”],?\s*)?(?:establish|name|frame|showcase|dramatize)\b/i.test(sourceText)
    && /\b(?:episode|known world|current normal|before disruption|ordinary world|opening promise|core value|episode pressure)\b/i.test(sourceText);
  const hasMultipleObligations = atoms.length >= 2 || sourceText.split(/\s*,\s*/).length >= 3;
  return atoms.length >= 4
    || (hasRolePrefix && tokenCount >= 35)
    || (hasEpisodeCircleInstruction && hasMultipleObligations && tokenCount >= 16);
}

function orderedEpisodeScenes(scenes: EpisodeCircleContractScene[]): EpisodeCircleContractScene[] {
  return [...scenes].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
    const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
    return ao - bo;
  });
}

function sceneTextForEpisodeCircle(scene: EpisodeCircleContractScene): string {
  return [
    scene.name,
    scene.description,
    scene.dramaticPurpose,
    scene.narrativeFunction,
    scene.narrativeRole,
    ...(scene.keyBeats ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function firstMatchingScene(
  scenes: EpisodeCircleContractScene[],
  predicate: (scene: EpisodeCircleContractScene, index: number) => boolean,
): EpisodeCircleContractScene | undefined {
  return scenes.find(predicate);
}

function bestEpisodeCircleScene(beat: StoryCircleBeat, scenes: EpisodeCircleContractScene[]): EpisodeCircleContractScene | undefined {
  const ordered = orderedEpisodeScenes(scenes);
  if (ordered.length === 0) return undefined;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const encounter = firstMatchingScene(ordered, (scene) => Boolean(scene.isEncounter));
  const turn = firstMatchingScene(ordered, (scene) => scene.narrativeRole === 'turn');
  const development = firstMatchingScene(ordered, (scene) => scene.narrativeRole === 'development');
  const release = [...ordered].reverse().find((scene) => scene.narrativeRole === 'release');
  const choice = firstMatchingScene(ordered, (scene) => Boolean(scene.hasChoice || scene.choicePoint));

  switch (beat) {
    case 'you':
    case 'need':
      return first;
    case 'go':
      return turn ?? choice ?? ordered[1] ?? first;
    case 'search':
      return development ?? turn ?? encounter ?? ordered[Math.min(1, ordered.length - 1)];
    case 'find':
      return encounter ?? turn ?? firstMatchingScene(ordered, (scene) => /reveal|discover|find|proof|answer|access|victory/i.test(sceneTextForEpisodeCircle(scene))) ?? ordered[Math.floor((ordered.length - 1) / 2)];
    case 'take':
      return encounter ?? turn ?? firstMatchingScene(ordered, (scene) => /cost|price|sacrifice|loss|wound|choice|rupture/i.test(sceneTextForEpisodeCircle(scene))) ?? ordered[Math.floor((ordered.length - 1) / 2)];
    case 'return':
    case 'change':
      return release ?? last;
  }
}

export function buildEpisodeCircleBeatContracts(input: {
  episodeNumber: number;
  episodeCircle?: Partial<StoryCircleStructure>;
  storyCircleRole?: StoryCircleRoleAssignment[];
  scenes: EpisodeCircleContractScene[];
}): StoryCircleBeatRealizationContract[] {
  const contracts: StoryCircleBeatRealizationContract[] = [];
  for (const beat of STORY_CIRCLE_BEATS) {
    const sourceText = input.episodeCircle?.[beat]?.trim();
    if (!sourceText) continue;
    const target = bestEpisodeCircleScene(beat, input.scenes);
    const atoms = eventAtoms(sourceText);
    contracts.push({
      id: `episode-circle-ep${input.episodeNumber}-${beat}-${slug(sourceText)}`,
      beat,
      sourceText,
      targetEpisodeNumber: input.episodeNumber,
      requiredRealization: requiredEpisodeRealizationFor(beat, sourceText),
      eventAtoms: atoms.length > 0 ? atoms : [sourceText],
      stateChange: STATE_CHANGE_RE.test(sourceText) ? sourceText : undefined,
      targetSceneIds: target ? [target.id] : [],
      blockingLevel: 'structural',
    });
  }
  return contracts;
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.signatureMoment,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), storyCircleBeatMatchThreshold(contract)) ? 1 : 0;
  score += eventCueScore(contract.sourceText, sceneText(scene));
  if (contract.targetEpisodeNumber === scene.episodeNumber) score += 0.4;
  if (scene.kind === 'encounter' && (contract.beat === 'search' || contract.beat === 'take' || contract.beat === 'return')) score += 0.35;
  if (scene.narrativeRole === 'turn' && (contract.beat === 'go' || contract.beat === 'find')) score += 0.3;
  if (scene.narrativeRole === 'release' && contract.beat === 'change') score += 0.4;
  if (scene.narrativeRole === 'setup' && contract.beat === 'you') score += 0.4;
  if (scene.hasChoice && (contract.beat === 'return' || contract.beat === 'go')) score += 0.2;
  return score;
}

function eventCueScore(sourceText: string, targetText: string): number {
  const source = sourceText.toLowerCase();
  const target = targetText.toLowerCase();
  let score = 0;
  if (/\barrives?\s+in\s+bucharest\b|\btwo suitcases\b|\bgrandmother'?s address\b/.test(source)
    && /\barrival\b|\barrives?\b|\bbucharest\b|\btwo suitcases\b|\bgrandmother'?s address\b/.test(target)) {
    score += 1.2;
  }
  if (/\b(?:arrives?|arrival|lands?|unpacks?|bags?|suitcases?|old address|new address|port city|new city)\b/.test(source)
    && /\b(?:arrives?|arrival|lands?|unpacks?|bags?|suitcases?|old address|new address|port city|new city)\b/.test(target)) {
    score += 1.2;
  }
  if (/\bdusk club\b|\bnegronis?\b/.test(source)
    && /\bdusk club\b|\bnegronis?\b|\brooftop\b|\bclub\b/.test(target)) {
    score += 1.2;
  }
  if (/\b(?:new circle|friend group|allies|bitter drinks|table|booth|bar|gathers?)\b/.test(source)
    && /\b(?:new circle|friend group|allies|bitter drinks|table|booth|bar|gathers?)\b/.test(target)) {
    score += 1.2;
  }
  if (/\bstaged rescue\b|\brescues?\b|\battack\b/.test(source)
    && /\bstaged rescue\b|\brescues?\b|\battack\b|\bpark\b|\bgarden\b|\balley\b|\bstreet\b/.test(target)) {
    score += 1.2;
  }
  if (/\b(?:staged rescue|rescues?|attack|attacked|threat|ambush)\b/.test(source)
    && /\b(?:staged rescue|rescues?|attack|attacked|threat|ambush|park|garden|alley|street)\b/.test(target)) {
    score += 1.2;
  }
  if (/\bviral\b|\bpost\b|\bblog\b|\breadership\b|\bbyline\b/.test(source)
    && /\bviral\b|\bpost\b|\bblog\b|\breadership\b|\bbyline\b|\baftermath\b/.test(target)) {
    score += 1.2;
  }
  if (/\b(?:viral|publication|anonymous post|public post|readership|byline|public name)\b/.test(source)
    && /\b(?:viral|publication|anonymous post|public post|readership|byline|aftermath|public name)\b/.test(target)) {
    score += 1.2;
  }
  return score;
}

function bestSceneForContract(
  contract: StoryCircleBeatRealizationContract,
  scenes: PlannedScene[],
  minSceneOrder?: number,
): PlannedScene | undefined {
  const episodeCandidates = scenes.filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber);
  if (episodeCandidates.length === 0) return undefined;
  const floored = typeof minSceneOrder === 'number'
    ? episodeCandidates.filter((scene) => scene.order >= minSceneOrder)
    : episodeCandidates;
  const candidates = floored.length > 0 ? floored : episodeCandidates;
  return candidates
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
}

// Story-circle parts that NARRATE the aftermath of the episode's staged threat
// (writing the post about the rescue, the post going viral) must not bind to a
// scene before the threat happens — bite-me 2026-07-02T20-30-27 bound "She
// starts Dating After Dusk" and "turns a terrifying rescue…into viral proof"
// to scene 1, ahead of the attack, and QA read the whole episode as a
// chronology contradiction.
const POST_THREAT_NARRATION_RE = /\b(?:viral|blog|post(?:s|ed)?|publish(?:es|ed)?|readership|byline|writes?|wrote)\b/i;
const THREAT_REFERENCE_RE = /\b(?:rescue[sd]?|attack(?:s|ed|er)?|terror|terrifying|danger)\b/i;

function partNarratesThreatAftermath(sourceText: string): boolean {
  return POST_THREAT_NARRATION_RE.test(sourceText) && THREAT_REFERENCE_RE.test(sourceText);
}

/**
 * Parts that narrate writing/publishing the night up ("At 4am she turns the
 * night into the first post…") belong AFTER the episode's encounter even when
 * they carry no explicit threat word — the old threat-word requirement let the
 * blog atom bind to the ARRIVAL scene (bite-me 2026-07-03: Mika pitching "a
 * new blog" in s1-1 and a "Start a blog" choice in s1-2, when the treatment
 * has the blog begin after the attack as the protagonist's own turn).
 */
function partBelongsAfterEncounter(sourceText: string): boolean {
  if (partNarratesThreatAftermath(sourceText)) return true;
  const cues = detectStoryEventCues(sourceText);
  return cues.has('lateNightWriting') || cues.has('blogAftermath');
}

function firstEncounterOrder(contract: StoryCircleBeatRealizationContract, scenes: PlannedScene[]): number | undefined {
  const encounter = scenes
    .filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber)
    .filter((scene) => scene.kind === 'encounter' || Boolean(scene.encounter))
    .sort((a, b) => a.order - b.order)[0];
  return encounter?.order;
}

function storyCircleOwnsContract(contract: StoryCircleBeatRealizationContract, scenes: PlannedScene[]): boolean {
  return scenes
    .filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber)
    .some((scene) => (scene.storyCircleBeatContracts ?? []).some((storyCircleContract) =>
      storyCircleContract.blockingLevel !== 'warning'
      && storyCircleContract.targetEpisodeNumber === contract.targetEpisodeNumber
      && treatmentFieldCloseMatch(
        contract.sourceText,
        storyCircleContract.sourceText,
        Math.max(0.45, storyCircleBeatMatchThreshold(contract)),
      )
    ));
}

function shouldHardBindSceneContract(contract: StoryCircleBeatRealizationContract): boolean {
  if (contract.blockingLevel !== 'treatment') return true;
  if (!contract.requiredRealization.includes('final_prose')) return true;
  return classifyTreatmentObligation({
    validator: 'TreatmentEventLedgerValidator',
    text: contract.sourceText,
  }).blocksFinalProse;
}

function requiredBeatFor(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): RequiredBeat {
  return {
    id: `${scene.id}-story-circle-${contract.beat}-${slug(contract.sourceText)}`,
    sourceTurn: contract.sourceText,
    mustDepict: contract.sourceText,
    tier: contract.blockingLevel === 'treatment' ? 'authored' : 'seed',
  };
}

export function normalizeStoryCircleContractForSceneProse(contract: StoryCircleBeatRealizationContract): StoryCircleBeatRealizationContract[] {
  if (!(contract.requiredRealization ?? []).includes('final_prose')) return shouldHardBindSceneContract(contract) ? [contract] : [];

  const recomputedAtoms = eventAtoms(contract.sourceText);
  const atoms = dedupe(recomputedAtoms.length > 0 ? recomputedAtoms : contract.eventAtoms ?? []);
  const hardBindableAtoms = atoms.filter((atom) => shouldHardBindSceneContract({
    ...contract,
    sourceText: atom,
    eventAtoms: [atom],
    stateChange: STATE_CHANGE_RE.test(atom) ? atom : undefined,
  }));
  const actionAtoms = atoms.filter((atom) => ACTION_VERB_RE.test(atom));
  const concreteAtoms = contract.blockingLevel === 'treatment'
    ? dedupe([...hardBindableAtoms, ...actionAtoms])
    : atoms;

  if (concreteAtoms.length > 0 && (concreteAtoms.length > 1 || !shouldHardBindSceneContract(contract))) {
    return concreteAtoms.map((atom, index) => ({
      ...contract,
      id: `${contract.id}-part-${index + 1}-${slug(atom)}`,
      sourceText: atom,
      eventAtoms: [atom],
      stateChange: STATE_CHANGE_RE.test(atom) ? atom : undefined,
      targetSceneIds: [],
    }));
  }

  return shouldHardBindSceneContract(contract) ? [contract] : [];
}

function pressureFor(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.blockingLevel === 'treatment' ? 'treatment' : 'planner',
    domain: contract.beat === 'change' || contract.beat === 'return' ? 'route' : 'flag',
    mechanicRef: { flag: contract.id },
    function: contract.beat === 'change' ? 'resolve' : contract.beat === 'return' ? 'payoff' : 'intensify',
    storyPressure: contract.stateChange ?? contract.sourceText,
    evidenceRequired: contract.eventAtoms,
    visibleResidue: ['show the beat changing story state, options, relationships, access, information, tone, or episode pressure'],
    allowedPayoffs: ['scene turn, choice pressure, reveal, route state, ending state, branch residue, or episode handoff'],
    blockedPayoffs: ['structural label only, metadata-only arc text, or summary that skips the authored beat event'],
    originatingSceneId: scene.id,
  };
}

export function assignStoryCircleBeatContractsToScenes(
  plan: Pick<SeasonPlan, 'storyCircleBeatContracts' | 'storyCircle' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): StoryCircleBeatRealizationContract[] {
  const contracts = buildStoryCircleBeatContractsForPlan(plan);
  for (const contract of contracts) {
    const sceneContracts = normalizeStoryCircleContractForSceneProse(contract);
    if (sceneContracts.length === 0) {
      contract.targetSceneIds = [];
      continue;
    }
    const boundSceneIds: string[] = [];
    // Parts of one contract are in narrative order (normalizeStoryCircleContract
    // ForSceneProse emits atoms in source order): they narrate SEQUENTIAL
    // events, so each later part binds STRICTLY after the previous part's
    // scene (two parts on one scene stacks incompatible location/event
    // obligations — run #9 put "forms the Dusk Club" on the arrival cold-open
    // and the preflight gate refused the two-venue scene). The floor is soft:
    // bestSceneForContract falls back to the full episode list when no scene
    // remains at/after it, so scarce-scene episodes never drop a part.
    // Threat-aftermath narration additionally floors at the episode's
    // encounter.
    let lastBoundOrder: number | undefined;
    for (const sceneContract of sceneContracts) {
      if (storyCircleOwnsContract(sceneContract, scenes)) continue;
      let partFloor = lastBoundOrder === undefined ? undefined : lastBoundOrder + 1;
      if (partBelongsAfterEncounter(sceneContract.sourceText)) {
        const encounterOrder = firstEncounterOrder(sceneContract, scenes);
        if (encounterOrder !== undefined) {
          partFloor = Math.max(partFloor ?? encounterOrder, encounterOrder);
        }
      }
      const target = bestSceneForContract(sceneContract, scenes, partFloor);
      if (!target) continue;
      lastBoundOrder = Math.max(lastBoundOrder ?? target.order, target.order);
      sceneContract.targetSceneIds = dedupe([...sceneContract.targetSceneIds, target.id]);
      boundSceneIds.push(target.id);
      const existing = target.storyCircleBeatContracts ?? [];
      if (!existing.some((candidate) => candidate.id === sceneContract.id)) {
        target.storyCircleBeatContracts = [...existing, sceneContract];
      }
      if (sceneContract.blockingLevel !== 'warning') {
        const beat = requiredBeatFor(sceneContract, target);
        if (!(target.requiredBeats ?? []).some((candidate) => candidate.id === beat.id)) {
          target.requiredBeats = [...(target.requiredBeats ?? []), beat];
        }
        const pressure = pressureFor(sceneContract, target);
        if (pressure && !(target.mechanicPressure ?? []).some((candidate) => candidate.id === pressure.id)) {
          target.mechanicPressure = [...(target.mechanicPressure ?? []), pressure];
        }
      }
    }
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, ...boundSceneIds]);
  }
  return contracts;
}

export function storyCircleBeatMatchThreshold(contract: StoryCircleBeatRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (tokenCount <= 4) return 0.45;
  if (contract.beat === 'return' || contract.beat === 'change') return 0.22;
  return 0.25;
}
