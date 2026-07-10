import type {
  ArcPressureTreatmentContract,
  AuthoredTreatmentFieldContract,
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
} from '../../types/scenePlan';
import {
  arcPressureContractTargetsScene,
  isSceneBoundArcPressureKind,
} from '../utils/arcPressureContracts';
import { attachColdOpenProfiles } from '../utils/coldOpenProfile';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import {
  analyzeEpisodeTreatmentDensity,
  hasTimelineCue,
  unsafeTreatmentDensityReports,
} from './gateRepairRouter';
import { detectStoryEventCues, type StoryEventCue } from './storyEventCues';

export type PlannedSceneBindingAction =
  | 'kept'
  | 'rebound'
  | 'ledgered'
  | 'unresolved';

export type PlannedSceneBindingIssueKind =
  | 'wrong_scene_binding'
  | 'ledger_scope_pollution'
  | 'encounter_scope_pollution'
  | 'chronology_conflict'
  | 'valid_dense_scene_needs_more_beats'
  | 'unsatisfiable_plan';

export interface PlannedSceneBindingDecision {
  action: PlannedSceneBindingAction;
  issueKind?: PlannedSceneBindingIssueKind;
  contractId: string;
  contractKind: AuthoredTreatmentFieldContract['contractKind'];
  episodeNumber: number;
  fromSceneId?: string;
  toSceneId?: string;
  reason: string;
}

export interface PlannedSceneBeatBudgetRecommendation {
  sceneId: string;
  episodeNumber: number;
  currentHardUnitEstimate: number;
  recommendedBeatCount: number;
  reason: string;
}

export interface PlannedSceneBindingReport {
  episodeNumber?: number;
  decisions: PlannedSceneBindingDecision[];
  beatBudgetRecommendations: PlannedSceneBeatBudgetRecommendation[];
  unresolved: PlannedSceneBindingDecision[];
}

export interface PlannedSceneBindingResult {
  scenes: PlannedScene[];
  report: PlannedSceneBindingReport;
  planLevelAuthoredTreatmentFields: AuthoredTreatmentFieldContract[];
}

const ENCOUNTER_KINDS = new Set<AuthoredTreatmentFieldContract['contractKind']>([
  'encounter_anchor',
  'encounter_conflict',
  'encounter_buildup',
]);

const ENDING_KINDS = new Set<AuthoredTreatmentFieldContract['contractKind']>([
  'ending_turnout',
  'resolved_episode_tension',
  'cliffhanger_hook',
  'cliffhanger_question',
  'next_episode_pressure',
  'cliffhanger_setup',
  'cliffhanger_type',
  'emotional_charge',
  'end_state_change',
]);

const CHOICE_KINDS = new Set<AuthoredTreatmentFieldContract['contractKind']>([
  'major_choice_pressure',
  'alternative_path',
]);

const LEDGER_ONLY_RE = /\b(?:INFO[-_\s]*[A-Z0-9]+|information\s+ledger|later episode|future|pay\s*off|payoff|paid off|confirmed|revealed later|not yet|mystery box|box question|ending state|possible end state|season resolution|finale)\b/i;
const FUTURE_RESIDUE_RE = /\b(?:choice residue|later|future|mid-arc|catchable|confess(?:es|ion)? earlier|paid off|payoff|episode\s+\d+|e\d+\b|reconverge|season brand|downstream|going forward|canonical|route|path)\b/i;
const BROAD_FUTURE_LEDGER_RE = /\b(?:episode cannot be removed|cannot be removed|launch(?:es)? the entire|back half|future arc|later arc|anonymous warning|no-photo account|last party|cliffhanger|left unexplained|too-perfect|too perfect|happened to break down|was staged|had been staged)\b/i;
const ABSTRACT_PLAN_LEVEL_ANCHOR_RE = /\b(?:becomes?|remains?|are|is)\s+(?:a\s+|an\s+|the\s+)?(?:live\s+)?(?:season|series|arc|future|downstream)\s+anchors?\b|\b(?:live\s+)?(?:season|series|arc|future|downstream)\s+anchors?\b/i;
const NEXT_PRESSURE_RE = /\b(?:accepts?|invitation|invites?|weekend|retreat|country[-\s]?house|next pressure|next episode|doorway|threshold question)\b/i;
const INTENT_TO_REBUILD_FRAGMENT_RE = /(?:,\s*)?(?:and\s+)?(?:the\s+)?(?:intent|intends?|determined)\s+to\s+(?:rebuild|start\s+over|begin\s+again|make\s+a\s+new\s+life)\b[^.!?\n,;]*/ig;

const LOCATION_KEYWORDS = [
  'bookshop',
  'bookstore',
  'rooftop',
  'terrace',
  'park',
  'cismigiu',
  'gardens',
  'venue',
  'club',
  'apartment',
  'courtyard',
  'blog',
];

type SceneEventCue = StoryEventCue;

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | undefined): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4);
}

function tokenOverlap(needle: string | undefined, haystack: string): number {
  const wanted = Array.from(new Set(tokens(needle)));
  if (wanted.length === 0) return 0;
  const have = Array.from(new Set(tokens(haystack)));
  const haveSet = new Set(have);
  const hits = wanted.filter((token) =>
    haveSet.has(token) || have.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate)),
  );
  return hits.length / wanted.length;
}

const GENERIC_LOCALITY_TOKENS = new Set([
  'protagonist',
  'traveler',
  'character',
  'scene',
  'episode',
  'starts',
  'start',
  'begins',
  'begin',
  'forms',
  'form',
  'turns',
  'turn',
  'arrives',
  'arrive',
  'public',
  'private',
]);

function distinctiveTokens(value: string | undefined): string[] {
  return tokens(value).filter((token) => !GENERIC_LOCALITY_TOKENS.has(token));
}

function distinctiveTokenOverlap(needle: string | undefined, haystack: string): number {
  const wanted = Array.from(new Set(distinctiveTokens(needle)));
  if (wanted.length === 0) return 0;
  const have = Array.from(new Set(distinctiveTokens(haystack)));
  const hits = wanted.filter((token) =>
    have.includes(token) || have.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate)),
  );
  return hits.length / wanted.length;
}

function sceneText(scene: PlannedScene, excludeRequiredBeatId?: string): string {
  return [
    scene.id,
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.locations?.join(' '),
    scene.npcsInvolved?.join(' '),
    scene.timeOfDay,
    scene.timeJump,
    scene.signatureMoment,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.handoff,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.encounter?.aftermathConsequence,
    ...(scene.requiredBeats ?? [])
      .filter((beat) => !excludeRequiredBeatId || beat.id !== excludeRequiredBeatId)
      .map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
  ].filter(Boolean).join(' ');
}

function isBroadMixedChoiceTurn(turn: PlannedScene['turnContract'] | undefined): boolean {
  if (!turn || (turn.source !== 'choice' && turn.source !== 'treatment')) return false;
  const text = [turn.centralTurn, turn.turnEvent, turn.handoff].filter(Boolean).join(' ');
  if (!text) return false;
  return text.length >= 260 || eventCues(text).size >= 2 || explicitTimeCues(text).length >= 2;
}

function sceneBindingTurnText(scene: PlannedScene): string[] {
  if (!scene.turnContract || scene.turnContract.source === 'planner') return [];
  if (isBroadMixedChoiceTurn(scene.turnContract)) return [];
  return [
    scene.turnContract.centralTurn,
    scene.turnContract.turnEvent,
    scene.turnContract.handoff,
  ].filter(Boolean);
}

function sceneSpecificText(scene: PlannedScene, excludeRequiredBeatId?: string): string {
  return [
    scene.id,
    scene.title,
    scene.locations?.join(' '),
    scene.npcsInvolved?.join(' '),
    scene.timeOfDay,
    scene.timeJump,
    ...sceneBindingTurnText(scene),
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.encounter?.aftermathConsequence,
    ...(scene.requiredBeats ?? [])
      .filter((beat) => !excludeRequiredBeatId || beat.id !== excludeRequiredBeatId)
      .map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
  ].filter(Boolean).join(' ');
}

function hasRoadBreakdownCue(text: string): boolean {
  if (/\b(?:roadside|mountain road|broken down|breaks down|cab breaks|country road)\b/.test(text)) return true;
  const signals = [
    /\bcab\b/,
    /\btow\b/,
    /\broad\b/,
    /\blift\b/,
    /\bchef\b/,
    /\bhand knit\b/,
    /\bsweater\b/,
    /\bwoodsmoke\b/,
    /\bbay leaf\b/,
    /\bbread\b/,
    /\bradu\b/,
    /\bthe mountain\b/,
    /\bcousins\b/,
    /\bdiner\b/,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}

function eventCues(value: string | undefined): Set<SceneEventCue> {
  return detectStoryEventCues(value);
}

function cueOverlapScore(source: string | undefined, scene: PlannedScene, excludeRequiredBeatId?: string): number {
  const sourceCues = eventCues(source);
  if (sourceCues.size === 0) return 0;
  const sceneCues = primarySceneCues(scene);
  let score = 0;
  for (const cue of sourceCues) {
    if (sceneCues.has(cue)) score += 4;
  }
  if (score === 0 && sourceCues.size > 0) score -= 1;
  return score;
}

function cueSetsOverlap(left: Set<SceneEventCue>, right: Set<SceneEventCue>): boolean {
  for (const cue of left) {
    if (right.has(cue)) return true;
  }
  return false;
}

function primarySceneCues(scene: PlannedScene): Set<SceneEventCue> {
  const cues = eventCues([
    scene.id,
    scene.title,
    scene.locations?.join(' '),
    scene.timeOfDay,
    scene.timeJump,
    ...sceneBindingTurnText(scene),
    scene.encounter?.description,
    scene.encounter?.centralConflict,
  ].filter(Boolean).join(' '));
  if (scene.narrativeRole === 'release') cues.add('endingAftermath');
  return cues;
}

function sceneHasLocationCue(scene: PlannedScene, sourceText: string): boolean {
  const source = normalize(sourceText);
  if (!source) return false;
  const text = normalize(sceneSpecificText(scene));
  return LOCATION_KEYWORDS.some((keyword) => source.includes(keyword) && text.includes(keyword));
}

function sceneHasTimeCueMatch(scene: PlannedScene, sourceText: string): boolean {
  const source = normalize(sourceText);
  const text = normalize(sceneSpecificText(scene));
  const patterns = [
    /night (?:one|two|three|four|\d+)/g,
    /\b\d+\s*(?:am|pm)\b/g,
    /\b\d+\s+\d+\b/g,
    /\b(?:morning|dawn|dusk|sunset|midnight|noon|afternoon|evening)\b/g,
  ];
  return patterns.some((pattern) => {
    const values = source.match(pattern) ?? [];
    return values.some((value) => text.includes(value));
  });
}

function explicitTimeCues(value: string | undefined): string[] {
  return Array.from(new Set(normalize(value).match(/\b(?:night (?:one|two|three|four|\d+)|\d+\s*(?:am|pm)|morning|dawn|dusk|sunset|midnight|noon|afternoon|evening|later|earlier|next (?:day|morning|night)|previous (?:day|night))\b/g) ?? []));
}

function isLedgerOnly(contract: AuthoredTreatmentFieldContract): boolean {
  if (ABSTRACT_PLAN_LEVEL_ANCHOR_RE.test(contract.sourceText)) return true;
  if (contract.contractKind === 'next_episode_pressure') return true;
  if (contract.contractKind === 'alternative_path' && FUTURE_RESIDUE_RE.test(contract.sourceText)) return true;
  if (contract.contractKind === 'consequence_seed' && FUTURE_RESIDUE_RE.test(contract.sourceText)) return true;
  if (contract.contractKind === 'consequence_seed' && BROAD_FUTURE_LEDGER_RE.test(contract.sourceText)) return true;
  if (ENDING_KINDS.has(contract.contractKind) && (FUTURE_RESIDUE_RE.test(contract.sourceText) || BROAD_FUTURE_LEDGER_RE.test(contract.sourceText))) return true;
  if (
    (contract.contractKind === 'theme_angle' || contract.contractKind === 'lie_pressure')
    && !sceneHasConcreteCue(contract.sourceText)
  ) return true;
  if (
    contract.contractKind === 'stakes_layer'
    && (
      eventCues(contract.sourceText).size === 0
      || /\bmaterial\b.{0,120}\brelational\b.{0,120}\bidentity\b/i.test(contract.sourceText)
      || /\brelational\b.{0,120}\bidentity\b.{0,120}\bexistential\b/i.test(contract.sourceText)
    )
  ) return true;
  if (contract.contractKind === 'pressure_lane' && eventCues(contract.sourceText).size > 1 && !hasTimelineCue(contract.sourceText)) return true;
  if (contract.contractKind !== 'information_movement' && contract.contractKind !== 'consequence_seed') return false;
  return LEDGER_ONLY_RE.test(contract.sourceText) || BROAD_FUTURE_LEDGER_RE.test(contract.sourceText);
}

function sceneHasConcreteCue(value: string | undefined): boolean {
  return eventCues(value).size > 0 || explicitTimeCues(value).length > 0 || LOCATION_KEYWORDS.some((keyword) => normalize(value).includes(keyword));
}

function beatText(beat: RequiredBeat): string {
  return [beat.mustDepict, beat.sourceTurn].filter(Boolean).join(' ');
}

function isLedgerOnlyBeat(beat: RequiredBeat): boolean {
  const text = beatText(beat);
  if (ABSTRACT_PLAN_LEVEL_ANCHOR_RE.test(text)) return true;
  if (/\bseason\s+central\s+pressure\b/i.test(text)) return true;
  if (/\b(?:can'?t move later|founds everything downstream)\b/i.test(text)) return true;
  if (isAbstractQuestionBeat(text)) return true;
  if (/\barc[-_]?late[-_]?crisis\b/i.test(beat.id)) return true;
  if (/\bE\d+\s+ends?\s+on\b/i.test(text)) return true;
  if (BROAD_FUTURE_LEDGER_RE.test(text)) return true;
  if (/\bthat her job is to observe and describe other people'?s lives\b/i.test(text)) return true;
  if (/\b(?:late[-\s]?arc crisis|at the .*weekend)\b/i.test(text) && /\b(?:first crack|private man|powder room|photograph|missing|vanished|disappear|doesn'?t come back)\b/i.test(text)) return true;
  if (/\b(?:visible only on (?:a )?replay|replay-only|audience (?:clocks|catches) later|underneath\b.{0,80}\bfunnel|was staged|had been staged)\b/i.test(text)) return true;
  if (
    (beat.tier === 'authored' || beat.tier === 'coldopen')
    && eventCues(text).size === 0
    && explicitTimeCues(text).length === 0
    && !LOCATION_KEYWORDS.some((keyword) => normalize(text).includes(keyword))
    && !ACTION_VERB_RE.test(text)
  ) return true;
  if (beat.tier !== 'seed') return false;
  if (/\b(?:keeps? (?:his|her|their)?\s*face out of every frame|casts? no reflection|no reflection|unphotographable|cannot be photographed)\b/i.test(text)) {
    return false;
  }
  return LEDGER_ONLY_RE.test(text)
    || BROAD_FUTURE_LEDGER_RE.test(text)
    || /\b(?:choice residue|did or didn|whether|depending on|contracted to|confirmed at|revealed at|paid off in|future|later|episode\s+\d+|staged the ep-1 attack|strigoi|pricolici|hunter|cannot control)\b/i.test(text)
    || /\b(?:so .{0,80}\blands\b|built-up contrast|cold reintroduction|doorstep scarf|sunday[-\s]?night|during the weekend)\b/i.test(text);
}

function splitTimeChainedBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (explicitTimeCues(text).length < 2) return [text].filter(Boolean);
  const protectedText = text.replace(/\bMr\.\s+/g, 'Mr__DOT__');
  const parts = protectedText
    .split(/\s*;\s+|(?<=\.)\s+(?=[A-Z])|\s+(?=\bby\s+(?:night|morning|dawn|dusk|sunset|midnight|\d+\s*(?:am|pm)|\d+:))/i)
    .map((part) => part.replace(/Mr__DOT__/g, 'Mr. ').trim().replace(/^\band\s+/i, ''))
    .filter((part) => part.length >= 20);
  return parts.length > 1 ? parts : [text];
}

function splitBroadArrivalIdentityBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (!text || text.length < 120) return [text].filter(Boolean);
  const cues = eventCues(text);
  if (!cues.has('arrival') || cues.size < 2) return [text];

  const parts = splitActionSeries(text)
    .map((part) => part.trim().replace(/[;,]\s*$/, ''))
    .filter((part) => part.length >= 16);
  return parts.length > 1 ? parts : [text];
}

function fallbackNonArrivalScene(scenes: PlannedScene[], sourceScene: PlannedScene): PlannedScene | undefined {
  return scenes
    .filter((candidate) =>
      candidate.episodeNumber === sourceScene.episodeNumber
      && candidate.id !== sourceScene.id
      && !primarySceneCues(candidate).has('arrival')
      && candidate.kind === 'standard'
    )
    .sort((a, b) => a.order - b.order)[0];
}

function targetForBroadArrivalPart(part: string, scenes: PlannedScene[], sourceScene: PlannedScene, beatId: string): PlannedScene | undefined {
  const cues = eventCues(part);
  if (cues.has('lateNightWriting')) {
    return scenes
      .filter((scene) => scene.episodeNumber === sourceScene.episodeNumber && isPrimaryBlogDraftScene(scene))
      .sort((a, b) => scoreSceneForBeat(part, b, beatId) - scoreSceneForBeat(part, a, beatId) || a.order - b.order)[0];
  }
  const targetPool = cues.has('arrival')
    ? scenes
    : scenes.filter((scene) => scene.id !== sourceScene.id && !primarySceneCues(scene).has('arrival'));
  return bestSceneForBeat(part, targetPool, beatId)
    ?? (cues.has('arrival') ? sourceScene : fallbackNonArrivalScene(scenes, sourceScene));
}

function splitBroadEpisodeTurnoutBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (!text || text.length < 90) return [text].filter(Boolean);
  const cues = eventCues(text);
  const episodeSpanCues: SceneEventCue[] = [
    'arrival',
    'socialMeet',
    'threatEncounter',
    'friendDebrief',
    'lateNightWriting',
    'blogAftermath',
    'roadBreakdown',
  ];
  const episodeSpanCueCount = episodeSpanCues.filter((cue) => cues.has(cue)).length;
  const hasCompositeSignals = episodeSpanCueCount >= 2 || explicitTimeCues(text).length >= 2;
  if (!hasCompositeSignals) return [text];

  const parts = splitActionSeries(text)
    .map((part) => part.trim().replace(/[;,]\s*$/, ''))
    .filter((part) => part.length >= 16);
  return parts.length > 1 ? parts : [text];
}

function targetForBroadTurnoutPart(part: string, scenes: PlannedScene[], sourceScene: PlannedScene, beatId: string): PlannedScene | undefined {
  if (isBlogDraftText(part)) {
    return scenes
      .filter((scene) => scene.episodeNumber === sourceScene.episodeNumber && isPrimaryBlogDraftScene(scene))
      .sort((a, b) => scoreSceneForBeat(part, b, beatId) - scoreSceneForBeat(part, a, beatId) || a.order - b.order)[0];
  }
  if (hasCue(part, 'blogAftermath')) {
    return findOrCreateBlogAftermathScene(scenes, sourceScene.episodeNumber, sourceScene, part);
  }
  if (hasCue(part, 'threatEncounter')) {
    return scenes
      .filter((scene) => scene.episodeNumber === sourceScene.episodeNumber && primarySceneCues(scene).has('threatEncounter'))
      .sort((a, b) => scoreSceneForBeat(part, b, beatId) - scoreSceneForBeat(part, a, beatId) || a.order - b.order)[0];
  }
  if (hasCue(part, 'friendDebrief')) {
    return bestSceneForBeat(
      part,
      scenes.filter((scene) => scene.id !== sourceScene.id && scene.kind === 'standard'),
      beatId,
    );
  }
  const target = bestSceneForBeat(part, scenes, beatId);
  if (target && target.id !== sourceScene.id) return target;
  return fallbackNonArrivalScene(scenes, sourceScene);
}

const ACTION_VERB_RE = /\b(?:accepts?|adopts?|arrives?|asks?|assaults?|attacks?|befriends?|buzzes?|calls?|closes?|confronts?|cuts?|declines?|deflects?|delivers?|drops?|explores?|finds?|follows?|forms?|gathers?|gives?|hands?|interrupts?|introduces?|kisses?|lands?|launches?|leaps?|leaves?|meets?|names?|offers?|opens?|pins?|presses?|publishes?|refuses?|rescues?|scrolls?|sees?|starts?|swaps?|takes?|trades?|turns?|unpacks?|vanishes?|walks?|wand(?:er)?s?|warns?|writes?)\b/i;

function protectQuotedCommas(text: string): string {
  return text.replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, (match) => match.replace(/,/g, '__COMMA__'));
}

function restoreQuotedCommas(text: string): string {
  return text.replace(/__COMMA__/g, ',');
}

function splitActionSeries(text: string): string[] {
  const raw = protectQuotedCommas(text)
    .replace(/^\s*(?:and|then)\s+/i, '')
    .split(/\s*,\s*|\s+\band\s+/i)
    .map((part) => restoreQuotedCommas(part).trim().replace(/^(?:and|then)\s+/i, ''))
    .filter((part) => part.length >= 8);
  if (raw.length < 3) return [text.trim()].filter(Boolean);

  const firstVerb = ACTION_VERB_RE.exec(raw[0]);
  if (!firstVerb || firstVerb.index <= 0) return [text.trim()].filter(Boolean);

  const subject = raw[0].slice(0, firstVerb.index).trim();
  if (subject.length < 3 || subject.length > 90) return [text.trim()].filter(Boolean);

  const out: string[] = [];
  raw.forEach((part, index) => {
    if (index === 0) {
      out.push(part);
      return;
    }
    if (ACTION_VERB_RE.test(part)) {
      out.push(`${subject} ${part}`);
      return;
    }
    const previous = out.pop();
    out.push(previous ? `${previous}, ${part}` : part);
  });
  return out;
}

function splitActionChainedBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (!text || beat.tier === 'seed' || beat.tier === 'connective') return [text].filter(Boolean);
  const sameSceneParts = splitActionSeries(text)
    .map((part) => part.trim().replace(/[;,]\s*$/, ''))
    .filter((part) => part.length >= 16);
  if (sameSceneParts.length >= 3) return sameSceneParts;
  if (text.length < 150 || !/[—–-]/.test(text)) return [text];

  const protectedText = text.replace(/\bMr\.\s+/g, 'Mr__DOT__');
  const sections = protectedText
    .split(/\s+[—–-]\s+(?:and\s+)?/i)
    .map((part) => part.replace(/Mr__DOT__/g, 'Mr. ').trim())
    .filter((part) => part.length >= 20);
  if (sections.length < 2) return [text];

  const parts = [
    sections[0],
    ...sections.slice(1).flatMap(splitActionSeries),
  ].map((part) => part.trim().replace(/[;,]\s*$/, ''))
    .filter((part) => part.length >= 16);

  return parts.length >= 3 ? parts : [text];
}

function isAbstractQuestionBeat(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || !/[?]/.test(text)) return false;
  if (eventCues(text).size > 0 || explicitTimeCues(text).length > 0) return false;
  if (LOCATION_KEYWORDS.some((keyword) => normalized.includes(keyword))) return false;
  return /\b(?:can|whether|what|whose|who|does|is|are)\b/.test(normalized)
    && /\b(?:start over|make friends|sex life|wanted|known|owned|voice|belong|forgive|becomes|theme|question|safe)\b/.test(normalized);
}

function episodeNumberFromBeatId(beatId: string | undefined): number | undefined {
  const match = /^(?:s|treatment-enc-)(\d+)-/.exec(beatId ?? '');
  if (!match) return undefined;
  const episodeNumber = Number(match[1]);
  return Number.isFinite(episodeNumber) && episodeNumber > 0 ? episodeNumber : undefined;
}

function sceneIdFromRequiredBeatId(beatId: string | undefined): string | undefined {
  const match = /^(s\d+-\d+)-/.exec(beatId ?? '');
  return match?.[1];
}

function estimateHardUnits(scene: PlannedScene): number {
  let units = 0;
  units += (scene.requiredBeats ?? []).filter((beat) => beat.tier !== 'connective' && beat.tier !== 'seed').length;
  if (scene.signatureMoment) units += 1;
  if (scene.turnContract) units += 1;
  if (scene.hasChoice) units += 1;
  for (const field of scene.authoredTreatmentFields ?? []) {
    if (field.contractKind === 'encounter_anchor' || field.contractKind === 'encounter_conflict') units += 2;
  }
  return units;
}

function estimateTotalUnits(scene: PlannedScene): number {
  let units = 0;
  units += (scene.requiredBeats ?? []).filter((beat) => beat.tier !== 'connective').reduce((sum, beat) => sum + (beat.tier === 'seed' ? 0.5 : 1), 0);
  if (scene.signatureMoment) units += 1;
  if (scene.turnContract) units += 1;
  if (scene.hasChoice) units += 1;
  for (const field of scene.authoredTreatmentFields ?? []) {
    if (field.contractKind === 'encounter_anchor' || field.contractKind === 'encounter_conflict') units += 2;
    else if (field.requiredRealization?.includes('final_prose')) units += 0.5;
  }
  return Number(units.toFixed(2));
}

function scoreScene(contract: AuthoredTreatmentFieldContract, scene: PlannedScene): number {
  let score = tokenOverlap(contract.sourceText, sceneSpecificText(scene));
  score += cueOverlapScore(contract.sourceText, scene);
  if (sceneHasLocationCue(scene, contract.sourceText)) score += 1.5;
  if (sceneHasTimeCueMatch(scene, contract.sourceText)) score += 1.5;

  if (ENCOUNTER_KINDS.has(contract.contractKind)) {
    score += scene.kind === 'encounter' || Boolean(scene.encounter) ? 5 : -3;
  }
  if (CHOICE_KINDS.has(contract.contractKind)) {
    score += scene.hasChoice ? 1.25 : 0;
  }
  if (ENDING_KINDS.has(contract.contractKind)) {
    score += scene.narrativeRole === 'release' ? 2 : 0;
  }
  return score;
}

function scoreSceneForBeat(text: string, scene: PlannedScene, excludeRequiredBeatId?: string): number {
  let score = tokenOverlap(text, sceneSpecificText(scene, excludeRequiredBeatId));
  score += cueOverlapScore(text, scene, excludeRequiredBeatId);
  if (sceneHasLocationCue(scene, text)) score += 1.5;
  if (sceneHasTimeCueMatch(scene, text)) score += 2;
  if (/\b(?:attack|pinned|throat|rescue|rescued|attacker|shadow)\b/i.test(text) && scene.kind === 'encounter') score += 1;
  if (/\b(?:post|blog|reads|viral|write|writes|publishes)\b/i.test(text) && scene.hasChoice) score += 0.75;
  if (NEXT_PRESSURE_RE.test(text)) {
    if (scene.narrativeRole === 'release' || scene.narrativeRole === 'payoff') score += 3;
    if (scene.kind === 'encounter') score -= 1.5;
  }
  return score;
}

function isSpecificSocialMeetSeed(text: string): boolean {
  return /\b(?:second figure|unfamiliar figure|stranger|newcomer)\b/i.test(text)
    && /\b(?:entrance|doorway|threshold|across the room|bar|terrace|rooftop)\b/i.test(text);
}

function bestSceneForBeat(text: string, scenes: PlannedScene[], excludeRequiredBeatId?: string): PlannedScene | undefined {
  const sourceCues = eventCues(text);
  const normalizedText = normalize(text);
  if (normalizedText.includes('cismigiu')) {
    const cismigiuMatches = scenes.filter((scene) => normalize(sceneSpecificText(scene, excludeRequiredBeatId)).includes('cismigiu'));
    if (cismigiuMatches.length > 0) {
      return cismigiuMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('arrival')) {
    const arrivalMatches = scenes.filter((scene) => primarySceneCues(scene).has('arrival'));
    if (arrivalMatches.length > 0) {
      return arrivalMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('blogAftermath') && isBlogMetricText(text)) {
    const blogMatches = scenes.filter(isPrimaryBlogAftermathScene);
    if (blogMatches.length > 0) {
      return blogMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('lateNightWriting') || isBlogDraftText(text)) {
    const draftMatches = scenes.filter(isPrimaryBlogDraftScene);
    if (draftMatches.length > 0) {
      return draftMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('venueDoor')) {
    const doorMatches = scenes.filter(isPrimaryVenueDoorScene);
    if (doorMatches.length > 0) {
      return doorMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('friendDebrief')) {
    const debriefMatches = scenes.filter((scene) => {
      const cues = primarySceneCues(scene);
      return cues.has('friendDebrief') && !cues.has('lateNightWriting');
    });
    if (debriefMatches.length > 0) {
      return debriefMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('roadBreakdown')) {
    const primaryCueMatches = scenes.filter((scene) => primarySceneCues(scene).has('roadBreakdown'));
    if (primaryCueMatches.length > 0) {
      return primaryCueMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }
  if (sourceCues.has('socialMeet')) {
    const rooftopMatches = scenes.filter((scene) => {
      const cues = primarySceneCues(scene);
      return cues.has('socialMeet') && !cues.has('venueDoor');
    });
    if (rooftopMatches.length > 0) {
      return rooftopMatches
        .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }

  const scored = scenes
    .map((scene) => ({ scene, score: scoreSceneForBeat(text, scene, excludeRequiredBeatId) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order);
  if (scored[0]?.score > 0) return scored[0].scene;
  return undefined;
}

function isEpisodeOpeningScene(scene: PlannedScene, scenes: PlannedScene[]): boolean {
  if (scene.coldOpenProfile) return true;
  const episodeScenes = scenes
    .filter((candidate) => candidate.episodeNumber === scene.episodeNumber)
    .sort((a, b) => a.order - b.order);
  return episodeScenes[0]?.id === scene.id;
}

/** Spatial splits of the opening scene remain part of the cold-open family. */
function isEpisodeOpeningFamilyScene(scene: PlannedScene, scenes: PlannedScene[]): boolean {
  if (isEpisodeOpeningScene(scene, scenes)) return true;
  const opening = scenes
    .filter((candidate) => candidate.episodeNumber === scene.episodeNumber)
    .sort((a, b) => a.order - b.order)[0];
  return Boolean(opening && scene.id.startsWith(`${opening.id}-spatial-`));
}

function sceneOwningColdOpenBeat(scene: PlannedScene, scenes: PlannedScene[], beat: RequiredBeat): PlannedScene {
  if (beat.tier !== 'coldopen' || isEpisodeOpeningScene(scene, scenes)) return scene;
  const text = beatText(beat);
  const target = primaryCueTargetForOverloadBeat(scenes, scene, beat) ?? bestSceneForBeat(text, scenes, beat.id);
  return target ?? scenes
    .filter((candidate) => candidate.episodeNumber === scene.episodeNumber)
    .sort((a, b) => a.order - b.order)[0] ?? scene;
}

function retierColdOpenBeatForOwner(beat: RequiredBeat, owner: PlannedScene, scenes: PlannedScene[]): RequiredBeat {
  if (beat.tier !== 'coldopen' || isEpisodeOpeningFamilyScene(owner, scenes)) return beat;
  return {
    ...beat,
    tier: 'authored',
  };
}

function drainNonOpeningColdOpenBeats(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  const additions = new Map<string, RequiredBeat[]>();
  for (const scene of scenes) {
    if (isEpisodeOpeningScene(scene, scenes)) continue;
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      if (beat.tier !== 'coldopen') {
        kept.push(beat);
        continue;
      }
      const owner = sceneOwningColdOpenBeat(scene, scenes, beat);
      additions.set(owner.id, [
        ...(additions.get(owner.id) ?? []),
        retierColdOpenBeatForOwner(beat, owner, scenes),
      ]);
      decisions.push({
        action: 'rebound',
        issueKind: 'wrong_scene_binding',
        contractId: beat.id,
        contractKind: 'pressure_lane',
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        toSceneId: owner.id,
        reason: 'Non-opening scenes cannot own cold-open beats; the beat was routed to the opening owner or retiered as a scene-local authored obligation for the best matching scene.',
      });
    }
    replaceRequiredBeats(scene, kept);
  }
  for (const scene of scenes) {
    const moved = additions.get(scene.id) ?? [];
    if (moved.length > 0) scene.requiredBeats = [...(scene.requiredBeats ?? []), ...moved];
  }
}

function isStoryCircleDerivedBeat(beat: RequiredBeat): boolean {
  return /\b(?:story-circle|episode-circle)\b/i.test(beat.id);
}

function isLocalOpeningStoryCircleBeat(text: string, scene: PlannedScene, beatId?: string): boolean {
  const localText = sceneSpecificText(scene, beatId);
  const normalizedText = normalize(text);
  const normalizedLocal = normalize(localText);
  if (normalizedText && normalizedLocal && (normalizedText.includes(normalizedLocal) || normalizedLocal.includes(normalizedText))) return true;
  if (distinctiveTokenOverlap(text, localText) >= 0.32 || distinctiveTokenOverlap(localText, text) >= 0.32) return true;
  const sourceCues = eventCues(text);
  const localCues = primarySceneCues(scene);
  return sourceCues.size > 0 && cueSetsOverlap(sourceCues, localCues);
}

function openingStoryCircleTarget(
  scenes: PlannedScene[],
  scene: PlannedScene,
  beat: RequiredBeat,
): PlannedScene | undefined {
  const text = beatText(beat);
  if (!isEpisodeOpeningScene(scene, scenes) || !isStoryCircleDerivedBeat(beat)) return undefined;
  if (isLocalOpeningStoryCircleBeat(text, scene, beat.id)) return undefined;
  if (!ACTION_VERB_RE.test(text) && eventCues(text).size === 0 && explicitTimeCues(text).length === 0) return undefined;
  const candidates = scenes.filter((candidate) => candidate.episodeNumber === scene.episodeNumber && candidate.id !== scene.id);
  const target = bestSceneForBeat(text, candidates, beat.id);
  if (!target) return undefined;
  const targetScore = scoreSceneForBeat(text, target, beat.id);
  return targetScore > 0 ? target : undefined;
}

function bestSceneForContract(
  contract: AuthoredTreatmentFieldContract,
  scenes: PlannedScene[],
): PlannedScene | undefined {
  const sameEpisode = scenes
    .filter((scene) => scene.episodeNumber === contract.episodeNumber)
    .sort((a, b) => a.order - b.order);
  if (sameEpisode.length === 0) return undefined;

  if (ENCOUNTER_KINDS.has(contract.contractKind)) {
    const encounters = sameEpisode.filter((scene) => scene.kind === 'encounter' || Boolean(scene.encounter));
    if (encounters.length === 1) return encounters[0];
    if (encounters.length > 1) {
      return encounters
        .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
    return undefined;
  }

  if (ENDING_KINDS.has(contract.contractKind)) {
    const releaseScenes = sameEpisode.filter((scene) => scene.narrativeRole === 'release');
    if (releaseScenes.length > 0) {
      return releaseScenes
        .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
        .sort((a, b) => b.score - a.score || b.scene.order - a.scene.order)[0]?.scene;
    }
    return sameEpisode[sameEpisode.length - 1];
  }

  const sourceCues = eventCues(contract.sourceText);
  if (sourceCues.size > 0) {
    if (contract.contractKind === 'major_choice_pressure') {
      const priority: SceneEventCue[] = ['threatEncounter', 'roadBreakdown', 'objectHandoff', 'venueDoor', 'socialMeet', 'blogAftermath'];
      const priorityCue = priority.find((cue) => sourceCues.has(cue));
      if (priorityCue) {
        const priorityCandidates = priorityCue === 'venueDoor'
          ? sameEpisode.filter(isPrimaryVenueDoorScene)
          : sameEpisode.filter((scene) => primarySceneCues(scene).has(priorityCue));
        if (priorityCandidates.length > 0) {
          return priorityCandidates
            .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
            .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
        }
      }
    }
    const cueCandidates = sameEpisode.filter((scene) => cueSetsOverlap(sourceCues, primarySceneCues(scene)));
    if (cueCandidates.length > 0) {
      return cueCandidates
        .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
        .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    }
  }

  const scored = sameEpisode
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order);
  const topScene = scored[0]?.scene;
  if ((hasTimelineCue(contract.sourceText) || (topScene && sceneHasLocationCue(topScene, contract.sourceText))) && scored[0]?.score >= 1.5) {
    return scored[0].scene;
  }
  if (scored[0]?.score >= 0.28) return scored[0].scene;

  if (CHOICE_KINDS.has(contract.contractKind)) {
    return sameEpisode.find((scene) => scene.hasChoice)
      ?? sameEpisode.find((scene) => scene.narrativeRole === 'turn')
      ?? sameEpisode.find((scene) => contract.targetSceneIds?.includes(scene.id))
      ?? sameEpisode[0];
  }
  return sameEpisode.find((scene) => scene.narrativeRole !== 'release') ?? sameEpisode[0];
}

function removeContract(scene: PlannedScene, contractId: string): void {
  scene.authoredTreatmentFields = (scene.authoredTreatmentFields ?? []).filter((field) => field.id !== contractId);
  if (scene.authoredTreatmentFields.length === 0) delete scene.authoredTreatmentFields;
  scene.mechanicPressure = (scene.mechanicPressure ?? []).filter((pressure) => pressure.id !== `${contractId}-mechanic-pressure`);
  if (scene.mechanicPressure.length === 0) delete scene.mechanicPressure;
}

function addContract(scene: PlannedScene, contract: AuthoredTreatmentFieldContract): void {
  const existing = scene.authoredTreatmentFields ?? [];
  if (!existing.some((field) => field.id === contract.id)) {
    scene.authoredTreatmentFields = [...existing, contract];
  }
}

function updateSceneContractTargets(scene: PlannedScene, contractId: string, targetSceneIds: string[]): void {
  scene.authoredTreatmentFields = (scene.authoredTreatmentFields ?? []).map((field) =>
    field.id === contractId ? { ...field, targetSceneIds: [...targetSceneIds] } : field,
  );
}

function replaceRequiredBeats(scene: PlannedScene, beats: RequiredBeat[]): void {
  if (beats.length > 0) scene.requiredBeats = beats;
  else delete scene.requiredBeats;
}

function sanitizePlanningRegisterBeatText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(INTENT_TO_REBUILD_FRAGMENT_RE, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/,\s*$/, '');
  if (!cleaned) return undefined;
  const concreteEventText = eventCues(cleaned).size > 0
    || explicitTimeCues(cleaned).length > 0
    || ACTION_VERB_RE.test(cleaned);
  if (isPlanningRegisterText(cleaned) && !concreteEventText) return undefined;
  return cleaned;
}

function sanitizeRequiredBeatPlanningRegisterText(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  for (const scene of scenes) {
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const sourceTurn = sanitizePlanningRegisterBeatText(beat.sourceTurn);
      const mustDepict = sanitizePlanningRegisterBeatText(beat.mustDepict);
      if (!sourceTurn && !mustDepict) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: beat.id,
          contractKind: 'information_movement',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Required beat contained only planning-register synopsis text, so it remains plan-level instead of entering the blueprint.',
        });
        continue;
      }
      const sanitizedSourceTurn = sourceTurn ?? mustDepict ?? '';
      const sanitizedMustDepict = mustDepict ?? sourceTurn ?? '';
      const sanitized = {
        ...beat,
        sourceTurn: sanitizedSourceTurn,
        mustDepict: sanitizedMustDepict,
      };
      if (sanitized.sourceTurn !== beat.sourceTurn || sanitized.mustDepict !== beat.mustDepict) {
        decisions.push({
          action: 'kept',
          issueKind: 'ledger_scope_pollution',
          contractId: beat.id,
          contractKind: 'information_movement',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: scene.id,
          reason: 'Removed planning-register synopsis wording from required beat text before blueprint hygiene validation.',
        });
      }
      kept.push(sanitized);
    }
    replaceRequiredBeats(scene, kept);
  }
}

function moveMechanicPressure(
  from: PlannedScene | undefined,
  to: PlannedScene,
  contract: AuthoredTreatmentFieldContract,
): void {
  const pressureId = `${contract.id}-mechanic-pressure`;
  const existing = from?.mechanicPressure?.find((pressure) => pressure.id === pressureId);
  if (!existing) return;
  const moved: MechanicPressureContract = { ...existing, originatingSceneId: to.id };
  const targetPressure = to.mechanicPressure ?? [];
  if (!targetPressure.some((pressure) => pressure.id === pressureId)) {
    to.mechanicPressure = [...targetPressure, moved];
  }
}

function cloneScenes(scenes: PlannedScene[]): PlannedScene[] {
  return scenes.map((scene) => ({
    ...scene,
    locations: [...(scene.locations ?? [])],
    npcsInvolved: [...(scene.npcsInvolved ?? [])],
    setsUp: [...(scene.setsUp ?? [])],
    paysOff: [...(scene.paysOff ?? [])],
    requiredBeats: scene.requiredBeats?.map((beat) => ({ ...beat })),
    encounter: scene.encounter ? {
      ...scene.encounter,
      relevantSkills: [...(scene.encounter.relevantSkills ?? [])],
      requiredBeats: scene.encounter.requiredBeats?.map((beat) => ({ ...beat })),
      branchOutcomes: scene.encounter.branchOutcomes ? { ...scene.encounter.branchOutcomes } : undefined,
    } : undefined,
    authoredTreatmentFields: scene.authoredTreatmentFields?.map((field) => ({ ...field, targetSceneIds: [...(field.targetSceneIds ?? [])] })),
    arcPressureContracts: scene.arcPressureContracts?.map((contract) => ({
      ...contract,
      requiredRealization: [...(contract.requiredRealization ?? [])],
      targetEpisodeNumbers: [...(contract.targetEpisodeNumbers ?? [])],
      targetSceneIds: [...(contract.targetSceneIds ?? [])],
      eventAtoms: [...(contract.eventAtoms ?? [])],
    })),
    mechanicPressure: scene.mechanicPressure?.map((pressure) => ({ ...pressure })),
  }));
}

function makeColdOpenArrivalScene(episodeNumber: number, sourceBeat: RequiredBeat, order: number): PlannedScene {
  return {
    id: `s${episodeNumber}-arrival-cold-open`,
    episodeNumber,
    order,
    kind: 'standard',
    title: 'Opening arrival',
    dramaticPurpose: sourceBeat.mustDepict,
    narrativeRole: 'setup',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    requiredBeats: [sourceBeat],
    ownedChronologyKeys: ['arrival'],
    stakes: 'The protagonist reaches a new threshold with the opening promise still intact.',
    turnContract: {
      turnId: `s${episodeNumber}-arrival-cold-open-turn`,
      source: 'treatment',
      centralTurn: sourceBeat.mustDepict,
      beforeState: 'The protagonist has not yet crossed into the episode promise.',
      turnEvent: sourceBeat.mustDepict,
      afterState: 'The episode promise is planted, but not without cost.',
      handoff: 'Hand forward to the first social pressure of the new city.',
    },
  };
}

function hasCue(value: string | undefined, cue: SceneEventCue): boolean {
  return eventCues(value).has(cue);
}

function hasAnyCue(value: string | undefined, cues: SceneEventCue[]): boolean {
  const found = eventCues(value);
  return cues.some((cue) => found.has(cue));
}

function isBlogMetricText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:readership|reads|views|comments|brand deal|dm pile|dashboard|profile|public attention|public signal|ticking past|viral|goes viral|gone viral)\b/.test(text)
    && !isBlogDraftText(value);
}

function isPublicBlogAftermathText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:brand deal|brand deals|dm pile|profile|readership|dashboard|public attention|public signal|public leverage|blog as public|public sellable|sellable codenamed)\b/.test(text)
    && !isBlogDraftText(value);
}

function hasPublicWritingActionText(text: string): boolean {
  return /\b(?:[234]\s*a\s*m|[234]\s*am|late night|unable to sleep|numbers in (?:her|your|their) phone|dictionary|codename|draft|blank page|publish button|publishes|published)\b/.test(text)
    || /\b(?:writes?|writing|drafts?)\b.{0,100}\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title)\b/.test(text)
    || /\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title)\b.{0,100}\b(?:writes?|writing|drafts?)\b/.test(text);
}

function isBlogDraftText(value: string | undefined): boolean {
  const text = normalize(value);
  return hasPublicWritingActionText(text)
    || /\bpost about\b/.test(text);
}

function hasThreatPrerequisiteText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:attack|attacked|attacker|ambush|terror|rescue|rescued|rescuer|saved|saves|threat|knife|scream|rough hands|grabbed|pinned)\b/.test(text);
}

function isPublicAftermathSummaryText(value: string | undefined): boolean {
  return !isBlogDraftText(value)
    && (isBlogMetricText(value) || isPublicBlogAftermathText(value) || hasCue(value, 'blogAftermath'));
}

function hasLiveThreatPrerequisiteText(value: string | undefined): boolean {
  if (!hasThreatPrerequisiteText(value)) return false;
  const text = normalize(value);
  const liveThreatAction = /\b(?:attack|attacked|attacker|ambush|knife|scream|rough hands|grab(?:s|bed)?|pinned|corners?|lunges?|chases?|fight back|dont scream)\b/.test(text);
  if (isPublicAftermathSummaryText(value) && !liveThreatAction) return false;
  return true;
}

function blogAftermathDisallowedOwnershipCues(value: string | undefined): Set<SceneEventCue> {
  const cues = eventCues(value);
  const disallowed = new Set<SceneEventCue>();
  if (isBlogDraftText(value) || cues.has('lateNightWriting')) disallowed.add('lateNightWriting');
  if (hasLiveThreatPrerequisiteText(value) || cues.has('threatEncounter')) disallowed.add('threatEncounter');
  if (cues.has('roadBreakdown')) disallowed.add('roadBreakdown');
  return disallowed;
}

function targetForBlogAftermathPrerequisiteText(
  scenes: PlannedScene[],
  sourceScene: PlannedScene,
  text: string,
  excludeRequiredBeatId?: string,
): PlannedScene | undefined {
  const disallowed = blogAftermathDisallowedOwnershipCues(text);
  if (disallowed.size === 0) return undefined;
  const sameEpisode = scenes.filter((scene) =>
    scene.episodeNumber === sourceScene.episodeNumber
    && scene.id !== sourceScene.id
    && !isPrimaryBlogAftermathScene(scene)
  );
  if (disallowed.has('lateNightWriting')) {
    const draftTarget = sameEpisode
      .filter((scene) => isPrimaryBlogDraftScene(scene) || isBlogDraftText(sceneText(scene)))
      .sort((a, b) => scoreSceneForBeat(text, b, excludeRequiredBeatId) - scoreSceneForBeat(text, a, excludeRequiredBeatId) || a.order - b.order)[0];
    if (draftTarget) return draftTarget;
  }
  if (disallowed.has('threatEncounter')) {
    const threatTarget = sameEpisode
      .filter((scene) => primarySceneCues(scene).has('threatEncounter') || scene.kind === 'encounter' || Boolean(scene.encounter))
      .sort((a, b) => scoreSceneForBeat(text, b, excludeRequiredBeatId) - scoreSceneForBeat(text, a, excludeRequiredBeatId) || a.order - b.order)[0];
    if (threatTarget) return threatTarget;
  }
  if (disallowed.has('roadBreakdown')) {
    const roadTarget = sameEpisode
      .filter((scene) => primarySceneCues(scene).has('roadBreakdown'))
      .sort((a, b) => scoreSceneForBeat(text, b, excludeRequiredBeatId) - scoreSceneForBeat(text, a, excludeRequiredBeatId) || a.order - b.order)[0];
    if (roadTarget) return roadTarget;
  }
  return undefined;
}

function isPrimaryBlogAftermathScene(scene: PlannedScene): boolean {
  const cues = primarySceneCues(scene);
  return cues.has('blogAftermath')
    && !cues.has('socialMeet')
    && !cues.has('threatEncounter')
    && !cues.has('roadBreakdown')
    && !cues.has('venueDoor');
}

function isPrimaryBlogDraftScene(scene: PlannedScene): boolean {
  const cues = primarySceneCues(scene);
  return cues.has('lateNightWriting')
    && !cues.has('blogAftermath')
    && !cues.has('socialMeet')
    && !cues.has('threatEncounter')
    && !cues.has('roadBreakdown')
    && !cues.has('venueDoor');
}

function isPrimaryVenueDoorScene(scene: PlannedScene): boolean {
  const cues = primarySceneCues(scene);
  return cues.has('venueDoor')
    && !cues.has('socialMeet')
    && !cues.has('threatEncounter')
    && !cues.has('blogAftermath');
}

function isFriendDebriefText(value: string | undefined): boolean {
  const text = normalize(value);
  const strongDebrief = /\b(?:debrief|convenes?|regroups?|recaps?|compares notes|group chat|friend group)\b/.test(text);
  return hasCue(value, 'friendDebrief')
    && !hasCue(value, 'lateNightWriting')
    && (strongDebrief || !hasCue(value, 'venueDoor'));
}

function isLateNightWritingText(value: string | undefined): boolean {
  const text = normalize(value);
  const strongWriting = /\b(?:3 ?am|2 ?am|late night|goes home|back home|numbers in (?:her|your|their) phone|dictionary|codename|draft|blank page)\b/.test(text)
    || hasPublicWritingActionText(text);
  return strongWriting
    && hasCue(value, 'lateNightWriting')
    && !hasCue(value, 'venueDoor');
}

function isSocialDebriefAndWritingAftermathText(value: string | undefined): boolean {
  const cues = eventCues(value);
  if (cues.has('friendDebrief') && cues.has('lateNightWriting')) return true;
  const text = normalize(value);
  return /\b(?:debrief|regroup|recap|friend group|compares notes)\b/.test(text)
    && (/\b(?:3 ?am|2 ?am|late night|numbers in (?:her|your|their) phone|dictionary|codename|draft)\b/.test(text)
      || hasPublicWritingActionText(text));
}

function isRescueAftermathText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:walks? (?:her|him|them|you) home|threshold|declines? to come in|vanishes?|leaves before entering)\b/.test(text);
}

function threatEncounterEncounterFieldText(field: AuthoredTreatmentFieldContract): string | undefined {
  if (field.contractKind !== 'encounter_anchor' && field.contractKind !== 'encounter_conflict') return undefined;
  if (!hasCue(field.sourceText, 'socialMeet') || !hasCue(field.sourceText, 'threatEncounter')) return undefined;
  if (field.contractKind === 'encounter_anchor') {
    return field.sourceText;
  }
  return field.sourceText;
}

function canonicalizeRescueAftermathBeat(beat: RequiredBeat): RequiredBeat {
  return beat;
}

function setSceneTurnContract(
  scene: PlannedScene,
  contract: {
    turnId: string;
    source?: PlannedScene['turnContract'] extends infer T ? T extends { source?: infer S } ? S : never : never;
    centralTurn: string;
    beforeState: string;
    turnEvent: string;
    afterState: string;
    handoff: string;
  },
): void {
  scene.turnContract = {
    ...(scene.turnContract ?? {}),
    source: contract.source ?? scene.turnContract?.source ?? 'planner',
    turnId: contract.turnId,
    centralTurn: contract.centralTurn,
    beforeState: contract.beforeState,
    turnEvent: contract.turnEvent,
    afterState: contract.afterState,
    handoff: contract.handoff,
  };
}

function rewriteStructuralLabelTurnContracts(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  for (const scene of scenes) {
    const turn = scene.turnContract;
    if (!turn) continue;
    const text = [turn.centralTurn, turn.turnEvent].filter(Boolean).join(' ');
    if (!/\b(?:hook|promise|stakes|scene note|theme|question)\s+[—-]/i.test(text)) continue;
    const concreteBeats = (scene.requiredBeats ?? [])
      .filter((beat) => beat.tier !== 'seed' && beat.tier !== 'connective')
      .map((beat) => beat.mustDepict || beat.sourceTurn)
      .filter(Boolean);
    if (concreteBeats.length === 0) continue;
    const concreteTurn = concreteBeats.join('; ');
    setSceneTurnContract(scene, {
      turnId: turn.turnId,
      source: turn.source,
      centralTurn: concreteTurn,
      beforeState: turn.beforeState || 'The scene has not yet made its concrete treatment beat visible.',
      turnEvent: concreteTurn,
      afterState: turn.afterState || 'The concrete treatment beat has changed the scene state on-page.',
      handoff: turn.handoff || 'Hand forward to the next planned scene without restating the structural label.',
    });
    decisions.push({
      action: 'kept',
      issueKind: 'valid_dense_scene_needs_more_beats',
      contractId: `turn-contract:${scene.id}`,
      contractKind: 'pressure_lane',
      episodeNumber: scene.episodeNumber,
      fromSceneId: scene.id,
      toSceneId: scene.id,
      reason: 'Scene turn contract carried structural labels; rewrote it to concrete scene-local required beats before SceneWriter.',
    });
  }
}

function rewriteBroadChoiceTurnContracts(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  for (const scene of scenes) {
    const turn = scene.turnContract;
    if (!turn) continue;
    if (scene.planningOrigin?.kind === 'binder_split') continue;
    if (isNamedSocialAftermathHelperScene(scene)) continue;
    if (!isBroadMixedChoiceTurn(turn)) continue;
    const concreteBeat = (scene.requiredBeats ?? [])
      .find((beat) => beat.tier !== 'seed' && beat.tier !== 'connective' && (beat.mustDepict || beat.sourceTurn));
    if (!concreteBeat) continue;
    const concreteTurn = concreteBeat.mustDepict || concreteBeat.sourceTurn;
    setSceneTurnContract(scene, {
      turnId: turn.turnId,
      source: turn.source,
      centralTurn: concreteTurn,
      beforeState: turn.beforeState || 'The scene has not yet made its local choice pressure visible.',
      turnEvent: concreteTurn,
      afterState: turn.afterState || 'The local choice pressure has changed the scene state on-page.',
      handoff: 'Hand forward to the next planned scene without summarizing later episode events.',
    });
    decisions.push({
      action: 'kept',
      issueKind: 'valid_dense_scene_needs_more_beats',
      contractId: `turn-contract:${scene.id}`,
      contractKind: 'pressure_lane',
      episodeNumber: scene.episodeNumber,
      fromSceneId: scene.id,
      toSceneId: scene.id,
      reason: 'Turn contract summarized multiple episode events; rewrote it to the first scene-local required beat before binding and density checks.',
    });
  }
}

function isThreatEncounterText(value: string | undefined): boolean {
  const text = normalize(value);
  return hasCue(value, 'threatEncounter')
    || /\b(?:shadow|attacker|pinned|willow|scream|fight back|freeze|run|can stand|drops the attacker)\b/.test(text);
}

function isConcreteSidecarSeed(value: string | undefined): boolean {
  if (!value) return false;
  return sceneHasConcreteCue(value)
    && !hasCue(value, 'socialMeet')
    && !isThreatEncounterText(value)
    && !isBlogDraftText(value)
    && !isBlogMetricText(value);
}

function cloneContractForScene(contract: AuthoredTreatmentFieldContract, sceneId: string): AuthoredTreatmentFieldContract {
  return { ...contract, targetSceneIds: [sceneId] };
}

const TITLE_ABBREVIATION_END_RE = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Capt|Lt|Col|Gen|Rev)\.$/;
const TITLE_ABBREVIATION_CONTINUATION_RE = /^[A-Z][A-Za-z'’-]*(?:\b|[,.])/;

function endsWithTitleAbbreviation(value: string | undefined): boolean {
  return TITLE_ABBREVIATION_END_RE.test((value ?? '').trim());
}

function startsWithAbbreviationContinuation(value: string | undefined): boolean {
  return TITLE_ABBREVIATION_CONTINUATION_RE.test((value ?? '').trim());
}

function isAdjacentTitleAbbreviationSplit(left: string | undefined, right: string | undefined): boolean {
  return endsWithTitleAbbreviation(left) && startsWithAbbreviationContinuation(right);
}

function joinTitleAbbreviationSplit(left: string | undefined, right: string | undefined): string | undefined {
  const first = (left ?? '').trim();
  const second = (right ?? '').trim();
  if (!first) return second || undefined;
  if (!second) return first;
  return `${first} ${second}`.replace(/\s+/g, ' ').trim();
}

function remapContractSceneIds(field: AuthoredTreatmentFieldContract, fromSceneId: string, toSceneId: string): AuthoredTreatmentFieldContract {
  const targetSceneIds = (field.targetSceneIds ?? []).map((id) => id === fromSceneId ? toSceneId : id);
  return {
    ...field,
    targetSceneIds: targetSceneIds.length > 0 ? Array.from(new Set(targetSceneIds)) : [toSceneId],
  };
}

function mergeAbbreviationSplitBeats(left: RequiredBeat[] | undefined, right: RequiredBeat[] | undefined): RequiredBeat[] {
  const merged = [...(left ?? []).map((beat) => ({ ...beat }))];
  const incoming = [...(right ?? []).map((beat) => ({ ...beat }))];
  if (merged.length === 0) return incoming;
  if (incoming.length === 0) return merged;

  const last = merged[merged.length - 1];
  const first = incoming[0];
  const lastText = last.mustDepict || last.sourceTurn;
  const firstText = first.mustDepict || first.sourceTurn;
  if (!isAdjacentTitleAbbreviationSplit(lastText, firstText)) {
    return [...merged, ...incoming];
  }

  const combined = joinTitleAbbreviationSplit(lastText, firstText) ?? lastText;
  merged[merged.length - 1] = {
    ...last,
    sourceTurn: combined,
    mustDepict: combined,
    tier: last.tier === 'authored' || first.tier !== 'authored' ? last.tier : first.tier,
  };
  return [...merged, ...incoming.slice(1)];
}

function mergeAbbreviationSplitTurnContracts(
  target: PlannedScene['turnContract'],
  source: PlannedScene['turnContract'],
): PlannedScene['turnContract'] {
  if (!target) return source;
  if (!source) return target;
  return {
    ...target,
    centralTurn: isAdjacentTitleAbbreviationSplit(target.centralTurn, source.centralTurn)
      ? joinTitleAbbreviationSplit(target.centralTurn, source.centralTurn) ?? target.centralTurn
      : target.centralTurn,
    turnEvent: isAdjacentTitleAbbreviationSplit(target.turnEvent, source.turnEvent)
      ? joinTitleAbbreviationSplit(target.turnEvent, source.turnEvent) ?? target.turnEvent
      : target.turnEvent,
    afterState: source.afterState || target.afterState,
    handoff: source.handoff || target.handoff,
  };
}

function mergeTitleAbbreviationSplitScenes(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  scenes.sort((a, b) => a.episodeNumber - b.episodeNumber || a.order - b.order || a.id.localeCompare(b.id));
  const removedIds = new Map<string, string>();
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const current = scenes[index];
    const next = scenes[index + 1];
    if (
      current.episodeNumber !== next.episodeNumber
      || current.kind === 'encounter'
      || next.kind === 'encounter'
      || !isAdjacentTitleAbbreviationSplit(current.turnContract?.centralTurn || current.dramaticPurpose, next.turnContract?.centralTurn || next.dramaticPurpose)
    ) {
      continue;
    }

    current.dramaticPurpose = joinTitleAbbreviationSplit(current.dramaticPurpose, next.dramaticPurpose) ?? current.dramaticPurpose;
    current.stakes = joinTitleAbbreviationSplit(current.stakes, next.stakes) ?? current.stakes;
    current.signatureMoment = joinTitleAbbreviationSplit(current.signatureMoment, next.signatureMoment) ?? current.signatureMoment;
    current.turnContract = mergeAbbreviationSplitTurnContracts(current.turnContract, next.turnContract);
    current.requiredBeats = mergeAbbreviationSplitBeats(current.requiredBeats, next.requiredBeats);
    current.authoredTreatmentFields = [
      ...(current.authoredTreatmentFields ?? []),
      ...(next.authoredTreatmentFields ?? []).map((field) => remapContractSceneIds(field, next.id, current.id)),
    ];
    current.mechanicPressure = [
      ...(current.mechanicPressure ?? []),
      ...(next.mechanicPressure ?? []),
    ];
    current.locations = Array.from(new Set([...(current.locations ?? []), ...(next.locations ?? [])]));
    current.npcsInvolved = Array.from(new Set([...(current.npcsInvolved ?? []), ...(next.npcsInvolved ?? [])]));
    current.setsUp = Array.from(new Set([...(current.setsUp ?? []), ...(next.setsUp ?? [])]));
    current.paysOff = Array.from(new Set([...(current.paysOff ?? []), ...(next.paysOff ?? [])]));
    current.hasChoice = Boolean(current.hasChoice || next.hasChoice);
    removedIds.set(next.id, current.id);
    scenes.splice(index + 1, 1);
    index -= 1;
    decisions.push({
      action: 'rebound',
      issueKind: 'chronology_conflict',
      contractId: `title-abbreviation-split:${next.id}`,
      contractKind: 'pressure_lane',
      episodeNumber: current.episodeNumber,
      fromSceneId: next.id,
      toSceneId: current.id,
      reason: 'Adjacent planned scenes split a title abbreviation from its following name, so the orphan continuation was merged back into the source scene.',
    });
  }

  if (removedIds.size === 0) return;
  for (const scene of scenes) {
    scene.setsUp = scene.setsUp.map((id) => removedIds.get(id) ?? id);
    scene.paysOff = scene.paysOff.map((id) => removedIds.get(id) ?? id);
    scene.authoredTreatmentFields = scene.authoredTreatmentFields?.map((field) => ({
      ...field,
      targetSceneIds: (field.targetSceneIds ?? []).map((id) => removedIds.get(id) ?? id),
    }));
  }
}

function pushUniqueBeat(scene: PlannedScene, beat: RequiredBeat): void {
  const existing = scene.requiredBeats ?? [];
  if (existing.some((candidate) => candidate.id === beat.id)) return;
  scene.requiredBeats = [...existing, beat];
}

function pushUniqueField(scene: PlannedScene, field: AuthoredTreatmentFieldContract): void {
  const existing = scene.authoredTreatmentFields ?? [];
  if (existing.some((candidate) => candidate.id === field.id)) return;
  scene.authoredTreatmentFields = [...existing, field];
}

function removeFieldIds(scene: PlannedScene, ids: Set<string>): void {
  scene.authoredTreatmentFields = (scene.authoredTreatmentFields ?? []).filter((field) => !ids.has(field.id));
  if (scene.authoredTreatmentFields.length === 0) delete scene.authoredTreatmentFields;
}

function beatPriority(beat: RequiredBeat): number {
  if (beat.tier === 'connective') return 0;
  if (beat.tier === 'seed') return 1;
  return 2;
}

function beatCoveredByEarlierBeat(beat: RequiredBeat, kept: RequiredBeat[]): boolean {
  const text = beatText(beat);
  return kept.some((candidate) => {
    if (beatPriority(candidate) < beatPriority(beat)) return false;
    const candidateText = beatText(candidate);
    const overlap = Math.max(tokenOverlap(text, candidateText), tokenOverlap(candidateText, text));
    if (beat.tier === 'seed' || candidate.tier === 'seed') {
      if (overlap >= 0.58) return true;
    } else if (overlap >= 0.9) {
      return true;
    }
    const beatCues = eventCues(text);
    const candidateCues = eventCues(candidateText);
    if (
      /\bgoes? viral\b/i.test(text)
      && candidateCues.has('blogAftermath')
      && /\b(?:dashboard|readership|reads?|viral post|ticking|[0-9]+\s*k)\b/i.test(candidateText)
    ) return true;
    if (
      beat.id.includes('story-circle-hook-part')
      && beatCues.size > 0
      && cueSetsOverlap(beatCues, candidateCues)
      && /^(?:by|she writes|kylie lands)\b/i.test(text.trim())
    ) return true;
    return beat.tier === 'seed'
      && beatCues.size > 0
      && cueSetsOverlap(beatCues, candidateCues)
      && tokenOverlap(text, candidateText) >= 0.28;
  });
}

function encounterFieldCoversRequiredBeat(scene: PlannedScene, beat: RequiredBeat): boolean {
  if (scene.kind !== 'encounter' && !scene.encounter) return false;
  const text = beatText(beat);
  if (!text) return false;
  const candidates = [
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.authoredTreatmentFields ?? [])
      .filter((field) => field.contractKind === 'encounter_anchor' || field.contractKind === 'encounter_conflict' || field.contractKind === 'encounter_buildup')
      .map((field) => field.sourceText),
  ].filter(Boolean) as string[];
  return candidates.some((candidate) => {
    const overlap = Math.max(tokenOverlap(text, candidate), tokenOverlap(candidate, text));
    if (overlap >= 0.46) return true;
    const beatCues = eventCues(text);
    const fieldCues = eventCues(candidate);
    return beatCues.size > 0 && cueSetsOverlap(beatCues, fieldCues) && overlap >= 0.24;
  });
}

function dedupeEncounterRequiredBeatsAgainstFields(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  for (const scene of scenes) {
    if (scene.kind !== 'encounter' && !scene.encounter) continue;
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      if (beat.tier === 'authored' || beat.tier === 'seed' || beat.tier === 'connective') {
        kept.push(beat);
        continue;
      }
      if (!encounterFieldCoversRequiredBeat(scene, beat)) {
        kept.push(beat);
        continue;
      }
      decisions.push({
        action: 'ledgered',
        issueKind: 'valid_dense_scene_needs_more_beats',
        contractId: beat.id,
        contractKind: 'encounter_anchor',
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        reason: 'Encounter required beat duplicates an encounter anchor/conflict and remains enforced through that encounter contract instead of adding density.',
      });
    }
    replaceRequiredBeats(scene, kept);
  }
}

function dedupeRequiredBeats(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  for (const scene of scenes) {
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        const candidate = kept[index];
        if (beatPriority(candidate) >= beatPriority(beat)) continue;
        if (!beatCoveredByEarlierBeat(candidate, [beat])) continue;
        kept.splice(index, 1);
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: candidate.id,
          contractKind: 'information_movement',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Weaker required beat duplicates a stricter scene-local authored beat and remains enforced through the stronger obligation.',
        });
      }
      if (beatCoveredByEarlierBeat(beat, kept)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: beat.id,
          contractKind: 'information_movement',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Required beat duplicates a stricter scene-local authored beat and remains enforced through the surviving obligation.',
        });
        continue;
      }
      kept.push(beat);
    }
    replaceRequiredBeats(scene, kept);
  }
}

function fieldCoveredByRequiredBeat(field: AuthoredTreatmentFieldContract, scene: PlannedScene): boolean {
  const fieldText = field.sourceText;
  if (!fieldText) return false;
  return (scene.requiredBeats ?? []).some((beat) => {
    const beatLabel = beatText(beat);
    if (!beatLabel) return false;
    const overlap = Math.max(tokenOverlap(fieldText, beatLabel), tokenOverlap(beatLabel, fieldText));
    if (overlap >= 0.58) return true;
    const fieldCues = eventCues(fieldText);
    const beatCues = eventCues(beatLabel);
    return fieldCues.size > 0 && cueSetsOverlap(fieldCues, beatCues) && overlap >= 0.28;
  });
}

function isBroadSceneCommentaryField(field: AuthoredTreatmentFieldContract): boolean {
  const text = field.sourceText;
  if (!text) return false;
  if (/\bscene note\s*:/i.test(text) && eventCues(text).size >= 1) return true;
  if (
    (field.contractKind === 'pressure_lane' || field.contractKind === 'theme_angle' || field.contractKind === 'lie_pressure')
    && text.length >= 220
    && eventCues(text).size >= 2
  ) return true;
  return false;
}

function isMixedAftermathChoiceField(field: AuthoredTreatmentFieldContract): boolean {
  if (field.contractKind !== 'major_choice_pressure') return false;
  if (/\bnext\s+morning\b/i.test(field.sourceText) && eventCues(field.sourceText).size >= 1) return true;
  return eventCues(field.sourceText).size >= 2 || explicitTimeCues(field.sourceText).length >= 2;
}

function fieldDuplicatesEarlierField(
  field: AuthoredTreatmentFieldContract,
  kept: AuthoredTreatmentFieldContract[],
): boolean {
  return kept.some((candidate) => {
    if (candidate.contractKind !== field.contractKind) return false;
    const overlap = Math.max(tokenOverlap(field.sourceText, candidate.sourceText), tokenOverlap(candidate.sourceText, field.sourceText));
    if (overlap >= 0.42) return true;
    const fieldCues = eventCues(field.sourceText);
    const candidateCues = eventCues(candidate.sourceText);
    return fieldCues.size > 0 && cueSetsOverlap(fieldCues, candidateCues) && overlap >= 0.28;
  });
}

function dedupeAuthoredTreatmentFieldsAgainstSceneBeats(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  for (const scene of scenes) {
    const kept: AuthoredTreatmentFieldContract[] = [];
    for (const field of scene.authoredTreatmentFields ?? []) {
      if (field.contractKind === 'consequence_seed' && fieldCoveredByRequiredBeat(field, scene)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Consequence seed duplicates a scene-local required beat and remains enforced through that beat instead of adding density.',
        });
        kept.push({
          ...field,
          requiredRealization: (field.requiredRealization ?? []).filter((item) => item !== 'final_prose'),
        });
        continue;
      }
      if (isBroadSceneCommentaryField(field)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Broad multi-event treatment commentary remains plan-level instead of adding scene-prose density.',
        });
        continue;
      }
      if (isMixedAftermathChoiceField(field)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'chronology_conflict',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Choice field mixes multiple scene/time beats; the choice/consequence remains, but final prose stays scene-local.',
        });
        kept.push({
          ...field,
          requiredRealization: (field.requiredRealization ?? []).filter((item) => item !== 'final_prose'),
        });
        continue;
      }
      if (
        field.contractKind === 'major_choice_pressure'
        && field.requiredRealization?.includes('final_prose')
        && scene.narrativeRole === 'release'
      ) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Choice pressure on a release/helper scene keeps choice/consequence ownership, but final prose stays scene-local to avoid density overload.',
        });
        kept.push({
          ...field,
          requiredRealization: (field.requiredRealization ?? []).filter((item) => item !== 'final_prose'),
        });
        continue;
      }
      if (fieldDuplicatesEarlierField(field, kept)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Duplicate treatment field is represented by an earlier field on the same scene.',
        });
        continue;
      }
      kept.push(field);
    }
    scene.authoredTreatmentFields = kept;
  }
}

function insertPlannedScene(scenes: PlannedScene[], scene: PlannedScene): PlannedScene {
  const existing = scenes.find((candidate) => candidate.id === scene.id);
  if (existing) return existing;
  scenes.push(scene);
  return scene;
}

function findOrCreateBlogAftermathScene(
  scenes: PlannedScene[],
  episodeNumber: number,
  sourceScene: PlannedScene,
  triggerText?: string,
): PlannedScene {
  // ESC lockdown: viral metrics helpers must never own lateNightWriting cues.
  // If the source is the dramatized writing scene, still create a separate aftermath.
  const prerequisiteAnchor = latestBlogAftermathPrerequisiteScene(scenes, episodeNumber, sourceScene, triggerText);
  const existing = scenes
    .filter((scene) => scene.episodeNumber === episodeNumber && (isPrimaryBlogAftermathScene(scene) || isSyntheticBlogAftermathScene(scene)))
    .filter((scene) => !primarySceneCues(scene).has('lateNightWriting') || isSyntheticBlogAftermathScene(scene))
    .sort((a, b) => a.order - b.order)[0];
  if (existing) {
    if (existing.order <= prerequisiteAnchor.order) {
      existing.order = prerequisiteAnchor.order + 0.35;
    }
    // Keep handoff text from restaging the writing moment.
    if (existing.turnContract && !/do not restage/i.test(existing.turnContract.handoff || '')) {
      existing.turnContract = {
        ...existing.turnContract,
        handoff: 'Let the public attention become pressure without restaging the writing moment.',
      };
    }
    return existing;
  }

  return insertPlannedScene(scenes, {
    ...sourceScene,
    id: `s${episodeNumber}-blog-aftermath`,
    order: prerequisiteAnchor.order + 0.35,
    kind: 'standard',
    encounter: undefined,
    spineUnitId: undefined,
    encounterProfile: undefined,
    title: 'The post becomes public pressure',
    planningOrigin: {
      kind: 'binder_split',
      splitKind: 'viral_aftermath',
      parentSceneId: sourceScene.id,
      reason: 'Split later blog-readership metrics away from unrelated scene prose to avoid treatment-density overload.',
    },
    dramaticPurpose: 'The public post becomes visible pressure after private testimony turns into audience attention.',
    narrativeRole: 'payoff',
    requiredBeats: [],
    authoredTreatmentFields: [],
    mechanicPressure: [],
    hasChoice: false,
    locations: sourceScene.locations?.filter((location) => /blog|apartment|online|feed|profile|dashboard/i.test(location)) ?? ['Online'],
    turnContract: {
      turnId: `s${episodeNumber}-blog-aftermath-turn`,
      source: 'treatment',
      centralTurn: 'The post becomes visible public pressure.',
      beforeState: 'The protagonist has turned private experience into testimony.',
      turnEvent: 'The readership number climbs until the post becomes a public signal.',
      afterState: 'The story now has attention, leverage, and danger attached to it.',
      handoff: 'Let the public attention become pressure without restaging the writing moment.',
    },
  });
}

function latestBlogAftermathPrerequisiteScene(
  scenes: PlannedScene[],
  episodeNumber: number,
  sourceScene: PlannedScene,
  triggerText?: string,
): PlannedScene {
  // Prefer writing/draft owners when present so newly created aftermath helpers
  // never anchor solely on threat when the writing beat exists later.
  const writingAnchors = scenes
    .filter((scene) => scene.episodeNumber === episodeNumber)
    .filter((scene) =>
      primarySceneCues(scene).has('lateNightWriting')
      || isBlogDraftText(sceneText(scene))
      || isPrimaryBlogDraftScene(scene)
    )
    .sort((a, b) => b.order - a.order);
  if (writingAnchors[0]) return writingAnchors[0];

  const triggerCues = eventCues(triggerText);
  const cueOrder: SceneEventCue[] = [
    'arrival',
    'venueDoor',
    'objectHandoff',
    'socialMeet',
    'threatEncounter',
    'roadBreakdown',
    'friendDebrief',
    'lateNightWriting',
  ];
  const prerequisiteCueSet = new Set<SceneEventCue>(cueOrder.filter((cue) => triggerCues.has(cue)));
  const normalizedTrigger = normalize(triggerText);
  if (triggerCues.has('blogAftermath')) {
    if (/\b(?:attack|attacked|terror|rescue|rescued|rescuer|saved|saves)\b/.test(normalizedTrigger)) {
      prerequisiteCueSet.add('threatEncounter');
      prerequisiteCueSet.add('lateNightWriting');
    }
  }
  const prerequisiteCues = Array.from(prerequisiteCueSet);
  if (prerequisiteCues.length === 0) return sourceScene;

  const anchors = scenes
    .filter((scene) => scene.episodeNumber === episodeNumber)
    .filter((scene) => {
      const cues = primarySceneCues(scene);
      return prerequisiteCues.some((cue) => cues.has(cue));
    })
    .sort((a, b) => b.order - a.order);
  return anchors[0] ?? sourceScene;
}

function isSyntheticBlogAftermathScene(scene: PlannedScene): boolean {
  if (scene.planningOrigin?.kind === 'binder_split') {
    return scene.planningOrigin.splitKind === 'viral_aftermath'
      || scene.planningOrigin.splitKind === 'public_blog_aftermath';
  }
  return /^s\d+-blog-aftermath$/.test(scene.id);
}

function blogAftermathPrerequisiteCues(scene: PlannedScene): Set<SceneEventCue> {
  const cues = new Set<SceneEventCue>(['lateNightWriting']);
  const text = sceneText(scene);
  const detected = eventCues(text);
  for (const cue of detected) {
    if (cue === 'arrival' || cue === 'venueDoor' || cue === 'objectHandoff' || cue === 'socialMeet' || cue === 'threatEncounter' || cue === 'friendDebrief' || cue === 'lateNightWriting') {
      cues.add(cue);
    }
  }
  const normalized = normalize(text);
  if (/\b(?:attack|attacked|terror|rescue|rescued|rescuer|saved|saves)\b/.test(normalized)) {
    cues.add('threatEncounter');
  }
  return cues;
}

function latestPrerequisiteForSyntheticBlogAftermath(
  scenes: PlannedScene[],
  scene: PlannedScene,
): PlannedScene | undefined {
  // Prefer an existing lateNightWriting / draft scene over threat-only anchors
  // so viral aftermath cannot land between the attack and the writing beat
  // (bite-me 2026-07-09: s1-blog-aftermath before s1-7).
  const writingAnchors = scenes
    .filter((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.id !== scene.id
      && !isSyntheticBlogAftermathScene(candidate)
    )
    .filter((candidate) =>
      primarySceneCues(candidate).has('lateNightWriting')
      || isBlogDraftText(sceneText(candidate))
      || isPrimaryBlogDraftScene(candidate)
    )
    .sort((a, b) => b.order - a.order);
  if (writingAnchors[0]) return writingAnchors[0];

  const prerequisiteCues = blogAftermathPrerequisiteCues(scene);
  return scenes
    .filter((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.id !== scene.id
      && !isSyntheticBlogAftermathScene(candidate)
    )
    .filter((candidate) => {
      const candidateCues = primarySceneCues(candidate);
      for (const cue of prerequisiteCues) {
        if (candidateCues.has(cue)) return true;
        if (cue === 'lateNightWriting' && isBlogDraftText(sceneText(candidate))) return true;
        if (cue === 'threatEncounter' && hasThreatPrerequisiteText(sceneText(candidate))) return true;
      }
      return false;
    })
    .sort((a, b) => b.order - a.order)[0];
}

function orderSyntheticBlogAftermathScenes(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  for (const scene of scenes.filter(isSyntheticBlogAftermathScene)) {
    const writingAnchor = scenes
      .filter((candidate) =>
        candidate.episodeNumber === scene.episodeNumber
        && candidate.id !== scene.id
        && !isSyntheticBlogAftermathScene(candidate)
        && (
          primarySceneCues(candidate).has('lateNightWriting')
          || isBlogDraftText(sceneText(candidate))
          || isPrimaryBlogDraftScene(candidate)
        )
      )
      .sort((a, b) => b.order - a.order)[0];
    const anchor = writingAnchor ?? latestPrerequisiteForSyntheticBlogAftermath(scenes, scene);
    if (!anchor) continue;
    // When a writing scene exists, aftermath must follow it even if it already
    // sits after some other prerequisite (e.g. threat).
    if (writingAnchor) {
      if (scene.order > writingAnchor.order) continue;
    } else if (scene.order > anchor.order) {
      continue;
    }
    scene.order = anchor.order + 0.35;
    decisions.push({
      action: 'rebound',
      issueKind: 'chronology_conflict',
      contractId: scene.id,
      contractKind: 'pressure_lane',
      episodeNumber: scene.episodeNumber,
      fromSceneId: scene.id,
      toSceneId: anchor.id,
      reason: writingAnchor
        ? 'Synthetic public-post aftermath helper was ordered before its lateNightWriting owner; moved after the writing scene.'
        : 'Synthetic public-post aftermath helper was ordered after prerequisite scene-local events instead of immediately after its source scene.',
    });
  }
}

function evictInvalidBlogAftermathOwnership(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  for (const scene of scenes.filter((candidate) => isSyntheticBlogAftermathScene(candidate) || isPrimaryBlogAftermathScene(candidate))) {
    const turnText = [
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      scene.turnContract?.handoff,
    ].filter(Boolean).join(' ');
    if (blogAftermathDisallowedOwnershipCues(turnText).size > 0) {
      setSceneTurnContract(scene, {
        turnId: scene.turnContract?.turnId ?? `${scene.id}-turn`,
        source: scene.turnContract?.source ?? 'treatment',
        centralTurn: 'The post becomes visible public pressure.',
        beforeState: 'The protagonist has turned private experience into testimony.',
        turnEvent: 'The readership number climbs until the post becomes a public signal.',
        afterState: 'The story now has attention, leverage, and danger attached to it.',
        handoff: 'Let the public attention become pressure without restaging the prerequisite event.',
      });
      decisions.push({
        action: 'rebound',
        issueKind: 'chronology_conflict',
        contractId: `turn-contract:${scene.id}`,
        contractKind: 'pressure_lane',
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        toSceneId: scene.id,
        reason: 'Public-post aftermath helper carried a prerequisite event in its turn contract, so the turn was reset to public-pressure aftermath only.',
      });
    }

    const keptBeats: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const text = beatText(beat);
      if (blogAftermathDisallowedOwnershipCues(text).size === 0) {
        keptBeats.push(beat);
        continue;
      }
      const target = targetForBlogAftermathPrerequisiteText(scenes, scene, text, beat.id);
      if (!target || target.id === scene.id) {
        keptBeats.push(beat);
        continue;
      }
      pushUniqueBeat(target, beat);
      decisions.push({
        action: 'rebound',
        issueKind: 'chronology_conflict',
        contractId: beat.id,
        contractKind: 'pressure_lane',
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        toSceneId: target.id,
        reason: 'Public-post aftermath helper cannot own the live prerequisite event it summarizes; the required beat was moved back to its primary scene.',
      });
    }
    replaceRequiredBeats(scene, keptBeats);

    const keptFields: AuthoredTreatmentFieldContract[] = [];
    for (const field of scene.authoredTreatmentFields ?? []) {
      if (blogAftermathDisallowedOwnershipCues(field.sourceText).size === 0) {
        keptFields.push(field);
        continue;
      }
      const target = targetForBlogAftermathPrerequisiteText(scenes, scene, field.sourceText);
      if (!target || target.id === scene.id) {
        keptFields.push(field);
        continue;
      }
      pushUniqueField(target, cloneContractForScene(field, target.id));
      decisions.push({
        action: 'rebound',
        issueKind: 'chronology_conflict',
        contractId: field.id,
        contractKind: field.contractKind,
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        toSceneId: target.id,
        reason: 'Public-post aftermath helper cannot own an authored field for the live prerequisite event it summarizes; the field was moved back to its primary scene.',
      });
    }
    scene.authoredTreatmentFields = keptFields;
    if (scene.authoredTreatmentFields.length === 0) delete scene.authoredTreatmentFields;
  }
}

function primaryCueTargetForOverloadBeat(
  scenes: PlannedScene[],
  scene: PlannedScene,
  beat: RequiredBeat,
): PlannedScene | undefined {
  const text = beatText(beat);
  const explicitSceneId = sceneIdFromRequiredBeatId(beat.id);
  if (explicitSceneId && explicitSceneId !== scene.id && sceneHasConcreteCue(text)) {
    const explicitTarget = scenes.find((candidate) =>
      candidate.episodeNumber === scene.episodeNumber && candidate.id === explicitSceneId
    );
    if (explicitTarget) return explicitTarget;
  }
  if (isBlogDraftText(text) && !isPrimaryBlogDraftScene(scene)) {
    return scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber && isPrimaryBlogDraftScene(candidate))
      .sort((a, b) => scoreSceneForBeat(text, b, beat.id) - scoreSceneForBeat(text, a, beat.id) || a.order - b.order)[0];
  }
  if (isBlogMetricText(text) && !isPrimaryBlogAftermathScene(scene)) {
    return findOrCreateBlogAftermathScene(scenes, scene.episodeNumber, scene, text);
  }
  if (hasCue(text, 'threatEncounter') && !primarySceneCues(scene).has('threatEncounter')) {
    return scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber && primarySceneCues(candidate).has('threatEncounter'))
      .sort((a, b) => scoreSceneForBeat(text, b, beat.id) - scoreSceneForBeat(text, a, beat.id) || a.order - b.order)[0];
  }
  if (hasCue(text, 'venueDoor') && !isPrimaryVenueDoorScene(scene)) {
    return scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber && isPrimaryVenueDoorScene(candidate))
      .sort((a, b) => scoreSceneForBeat(text, b, beat.id) - scoreSceneForBeat(text, a, beat.id) || a.order - b.order)[0];
  }
  if (hasCue(text, 'arrival') && !primarySceneCues(scene).has('arrival')) {
    return scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber && primarySceneCues(candidate).has('arrival'))
      .sort((a, b) => scoreSceneForBeat(text, b, beat.id) - scoreSceneForBeat(text, a, beat.id) || a.order - b.order)[0];
  }
  if (hasCue(text, 'socialMeet') && !primarySceneCues(scene).has('socialMeet')) {
    return scenes
      .filter((candidate) => {
        if (candidate.episodeNumber !== scene.episodeNumber) return false;
        const cues = primarySceneCues(candidate);
        return cues.has('socialMeet') && !cues.has('venueDoor');
      })
      .sort((a, b) => scoreSceneForBeat(text, b, beat.id) - scoreSceneForBeat(text, a, beat.id) || a.order - b.order)[0];
  }
  return undefined;
}

function isBroadCompositeRequiredBeat(beat: RequiredBeat): boolean {
  const text = beatText(beat);
  if (!text || text.length < 120) return false;
  const cues = eventCues(text);
  return cues.size >= 2 || explicitTimeCues(text).length >= 2;
}

function primaryCueTargetForOverloadField(
  scenes: PlannedScene[],
  scene: PlannedScene,
  field: AuthoredTreatmentFieldContract,
): PlannedScene | undefined {
  if (isBlogMetricText(field.sourceText) && !isPrimaryBlogAftermathScene(scene)) {
    return findOrCreateBlogAftermathScene(scenes, scene.episodeNumber, scene, field.sourceText);
  }
  if (hasCue(field.sourceText, 'venueDoor') && !isPrimaryVenueDoorScene(scene)) {
    return scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber && isPrimaryVenueDoorScene(candidate))
      .sort((a, b) => scoreScene(field, b) - scoreScene(field, a) || a.order - b.order)[0];
  }
  return undefined;
}

function scenesForDensityAnalysis(scenes: PlannedScene[], episodeNumber: number): unknown[] {
  return scenes
    .filter((scene) => scene.episodeNumber === episodeNumber)
    .map((scene) => ({
      ...scene,
      choicePoint: scene.hasChoice
        ? { description: scene.stakes || scene.dramaticPurpose || scene.title }
        : undefined,
    }));
}

function relieveUnsafeTreatmentDensity(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const episodeNumbers = Array.from(new Set(scenes.map((scene) => scene.episodeNumber)));
  for (const episodeNumber of episodeNumbers) {
    const reports = analyzeEpisodeTreatmentDensity(
      scenesForDensityAnalysis(scenes, episodeNumber) as never,
      episodeNumber,
    );
    const unsafeSceneIds = new Set(unsafeTreatmentDensityReports(reports).map((report) => report.sceneId));
    if (unsafeSceneIds.size === 0) continue;

    for (const scene of scenes.filter((candidate) => unsafeSceneIds.has(candidate.id))) {
      const keptBeats: RequiredBeat[] = [];
      for (const beat of scene.requiredBeats ?? []) {
        if (isLedgerOnlyBeat(beat)) {
          decisions.push({
            action: 'ledgered',
            issueKind: 'ledger_scope_pollution',
            contractId: beat.id,
            contractKind: 'information_movement',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            reason: 'Abstract pressure beat was removed from overloaded scene prose and left as a plan-level obligation.',
          });
          continue;
        }
        if (isBroadCompositeRequiredBeat(beat)) {
          decisions.push({
            action: 'ledgered',
            issueKind: 'ledger_scope_pollution',
            contractId: beat.id,
            contractKind: 'information_movement',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            reason: 'Broad multi-event required beat was removed from overloaded scene prose; its concrete event atoms remain enforced by neighboring scene-local beats.',
          });
          continue;
        }
        const target = primaryCueTargetForOverloadBeat(scenes, scene, beat);
        if (target && target.id !== scene.id) {
          pushUniqueBeat(target, beat);
          decisions.push({
            action: 'rebound',
            issueKind: 'wrong_scene_binding',
            contractId: beat.id,
            contractKind: 'pressure_lane',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            toSceneId: target.id,
            reason: 'Unsafe scene density pass moved concrete cue-bound beat to its primary planned scene.',
          });
          continue;
        }
        keptBeats.push(beat);
      }
      replaceRequiredBeats(scene, keptBeats);

      const movedFieldIds = new Set<string>();
      for (const field of scene.authoredTreatmentFields ?? []) {
        const target = primaryCueTargetForOverloadField(scenes, scene, field);
        if (!target || target.id === scene.id) continue;
        pushUniqueField(target, cloneContractForScene(field, target.id));
        moveMechanicPressure(scene, target, field);
        movedFieldIds.add(field.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: target.id,
          reason: 'Unsafe scene density pass moved concrete cue-bound authored field to its primary planned scene.',
        });
      }
      removeFieldIds(scene, movedFieldIds);
    }
  }
}

function isNamedSocialAftermathHelperScene(scene: PlannedScene): boolean {
  const cues = eventCues([scene.id, scene.title].filter(Boolean).join(' '));
  return cues.has('friendDebrief') || cues.has('lateNightWriting');
}

function socialAftermathSibling(
  scene: PlannedScene,
  scenes: PlannedScene[],
  splitKind: NonNullable<PlannedScene['planningOrigin']>['splitKind'],
): PlannedScene | undefined {
  if (scene.planningOrigin?.kind === 'binder_split') {
    const sibling = scenes.find((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.planningOrigin?.kind === 'binder_split'
      && candidate.planningOrigin.parentSceneId === scene.planningOrigin?.parentSceneId
      && candidate.planningOrigin.splitKind === splitKind
    );
    if (sibling) return sibling;
  }

  const exactId = splitKind === 'friend_debrief'
    ? scene.id.replace(/-late-night-writing$/, '-debrief')
    : scene.id.replace(/-debrief$/, '-late-night-writing');
  if (exactId !== scene.id) {
    const exact = scenes.find((candidate) => candidate.episodeNumber === scene.episodeNumber && candidate.id === exactId);
    if (exact) return exact;
  }

  const targetCue: SceneEventCue = splitKind === 'friend_debrief' ? 'friendDebrief' : 'lateNightWriting';
  return scenes
    .filter((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.id !== scene.id
      && eventCues([candidate.id, candidate.title].filter(Boolean).join(' ')).has(targetCue)
    )
    .sort((a, b) => Math.abs(a.order - scene.order) - Math.abs(b.order - scene.order) || a.order - b.order)[0];
}

function renormalizeSceneOrders(scenes: PlannedScene[]): void {
  scenes
    .sort((a, b) => a.episodeNumber - b.episodeNumber || a.order - b.order || a.id.localeCompare(b.id))
    .forEach((scene, index) => {
      scene.order = index;
    });
}

function removeArcPressureResidue(scene: PlannedScene, removed: ArcPressureTreatmentContract[]): void {
  if (removed.length === 0) return;
  const removedIds = new Set(removed.map((contract) => contract.id));
  const removedTexts = new Set(removed.map((contract) => contract.sourceText));
  scene.requiredBeats = scene.requiredBeats?.filter((beat) =>
    !removedTexts.has(beat.sourceTurn)
    && !removedTexts.has(beat.mustDepict)
    && !Array.from(removedIds).some((id) => beat.id.includes(id))
  );
  scene.mechanicPressure = scene.mechanicPressure?.filter((pressure) =>
    !removedIds.has(pressure.id)
    && !removedIds.has(pressure.mechanicRef?.flag ?? '')
    && !removedTexts.has(pressure.storyPressure)
  );
}

function scrubArcPressureBindings(scenes: PlannedScene[]): void {
  for (const scene of scenes) {
    const contracts = scene.arcPressureContracts ?? [];
    if (contracts.length === 0) continue;
    const kept = contracts.filter((contract) =>
      isSceneBoundArcPressureKind(contract.contractKind)
      && arcPressureContractTargetsScene(contract, scene)
    );
    const keptIds = new Set(kept.map((contract) => contract.id));
    const removed = contracts.filter((contract) => !keptIds.has(contract.id));
    scene.arcPressureContracts = kept;
    removeArcPressureResidue(scene, removed);
  }
}

function ensureMissingConcreteScenes(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const episodeNumbers = Array.from(new Set(scenes.map((scene) => scene.episodeNumber)));
  for (const episodeNumber of episodeNumbers) {
    const episodeScenes = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
    const hasArrivalScene = episodeScenes.some((scene) => primarySceneCues(scene).has('arrival'));
    if (hasArrivalScene) continue;
    const sourceScene = episodeScenes.find((scene) =>
      (scene.requiredBeats ?? []).some((beat) => beat.tier === 'coldopen' && eventCues(beatText(beat)).has('arrival')),
    );
    const sourceBeat = sourceScene?.requiredBeats?.find((beat) => beat.tier === 'coldopen' && eventCues(beatText(beat)).has('arrival'));
    if (!sourceBeat) continue;
    const firstOrder = Math.min(...episodeScenes.map((scene) => scene.order));
    scenes.push(makeColdOpenArrivalScene(episodeNumber, sourceBeat, firstOrder - 0.5));
    if (sourceScene) {
      replaceRequiredBeats(sourceScene, (sourceScene.requiredBeats ?? []).filter((beat) => beat.id !== sourceBeat.id));
    }
    decisions.push({
      action: 'rebound',
      issueKind: 'wrong_scene_binding',
      contractId: sourceBeat.id,
      contractKind: 'pressure_lane',
      episodeNumber,
      fromSceneId: sourceScene?.id,
      toSceneId: `s${episodeNumber}-arrival-cold-open`,
      reason: 'Concrete cold-open arrival beat had no valid planned scene, so a small opening scene was added instead of binding it to the first available scene.',
    });
  }
}

export function rebindPlannedSceneObligations(
  scenesInput: PlannedScene[],
  options: { episodeNumber?: number } = {},
): PlannedSceneBindingResult {
  const scenes = cloneScenes(scenesInput);
  const decisions: PlannedSceneBindingDecision[] = [];
  const planLevel = new Map<string, AuthoredTreatmentFieldContract>();

  mergeTitleAbbreviationSplitScenes(scenes, decisions);
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  scrubArcPressureBindings(scenes);
  ensureMissingConcreteScenes(scenes, decisions);
  sanitizeRequiredBeatPlanningRegisterText(scenes, decisions);

  for (const scene of scenes) {
    for (const original of scene.authoredTreatmentFields ?? []) {
      const contract = { ...original, targetSceneIds: [...(original.targetSceneIds ?? [])] };
      planLevel.set(contract.id, contract);
    }
  }

  for (const contract of Array.from(planLevel.values())) {
    const boundScenes = scenes.filter((scene) =>
      (scene.authoredTreatmentFields ?? []).some((field) => field.id === contract.id),
    );
    const from = boundScenes[0] ?? (contract.targetSceneIds[0] ? sceneById.get(contract.targetSceneIds[0]) : undefined);

    if (isLedgerOnly(contract)) {
      for (const scene of boundScenes) removeContract(scene, contract.id);
      contract.targetSceneIds = [];
      decisions.push({
        action: 'ledgered',
        issueKind: 'ledger_scope_pollution',
        contractId: contract.id,
        contractKind: contract.contractKind,
        episodeNumber: contract.episodeNumber,
        fromSceneId: from?.id,
        reason: 'Abstract, future, or information-ledger obligation remains plan-level instead of hard-bound to opening prose.',
      });
      continue;
    }

    const target = bestSceneForContract(contract, scenes);
    if (!target) {
      for (const scene of boundScenes) removeContract(scene, contract.id);
      if (CHOICE_KINDS.has(contract.contractKind)) {
        contract.targetSceneIds = [];
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: contract.id,
          contractKind: contract.contractKind,
          episodeNumber: contract.episodeNumber,
          fromSceneId: from?.id,
          reason: 'Choice-pressure obligation had no safe choice-bearing scene target, so it remains plan-level instead of blocking or overloading prose.',
        });
        continue;
      }
      contract.targetSceneIds = [];
      decisions.push({
        action: 'unresolved',
        issueKind: ENCOUNTER_KINDS.has(contract.contractKind) ? 'encounter_scope_pollution' : 'unsatisfiable_plan',
        contractId: contract.id,
        contractKind: contract.contractKind,
        episodeNumber: contract.episodeNumber,
        fromSceneId: from?.id,
        reason: ENCOUNTER_KINDS.has(contract.contractKind)
          ? 'Encounter obligation has no encounter scene in this episode.'
          : 'No safe planned scene target exists for this obligation.',
      });
      continue;
    }

    const wrongEncounterScene = ENCOUNTER_KINDS.has(contract.contractKind)
      && boundScenes.some((scene) => scene.kind !== 'encounter' && !scene.encounter);
    const sourceCues = eventCues(contract.sourceText);
    const cueMismatch = sourceCues.size > 0
      && from
      && target.id !== from.id
      && cueSetsOverlap(sourceCues, primarySceneCues(target))
      && !cueSetsOverlap(sourceCues, primarySceneCues(from));
    const chronologyMismatch = hasTimelineCue(contract.sourceText)
      && from
      && target.id !== from.id
      && (sceneHasTimeCueMatch(target, contract.sourceText) || sceneHasLocationCue(target, contract.sourceText));
    const shouldMove = wrongEncounterScene || cueMismatch || chronologyMismatch || (from && target.id !== from.id && scoreScene(contract, target) - scoreScene(contract, from) >= 1.25);

    if (shouldMove) {
      for (const source of boundScenes) {
        moveMechanicPressure(source, target, contract);
        removeContract(source, contract.id);
      }
      contract.targetSceneIds = [target.id];
      addContract(target, contract);
      decisions.push({
        action: 'rebound',
        issueKind: wrongEncounterScene
          ? 'encounter_scope_pollution'
          : chronologyMismatch
            ? 'chronology_conflict'
          : cueMismatch
            ? 'wrong_scene_binding'
            : 'wrong_scene_binding',
        contractId: contract.id,
        contractKind: contract.contractKind,
        episodeNumber: contract.episodeNumber,
        fromSceneId: from?.id,
        toSceneId: target.id,
        reason: wrongEncounterScene
          ? 'Encounter obligation belongs to an encounter scene, not a standard prose scene.'
          : chronologyMismatch
            ? 'Time/location-coded obligation matched a chronological neighboring scene.'
          : cueMismatch
            ? 'Concrete scene cue matched a different planned scene primary turn/location.'
            : 'Best semantic target differs from current planned scene binding.',
      });
      continue;
    }

    if (boundScenes.length === 0) {
      contract.targetSceneIds = [target.id];
      addContract(target, contract);
    } else {
      contract.targetSceneIds = boundScenes.map((item) => item.id);
      for (const bound of boundScenes) updateSceneContractTargets(bound, contract.id, contract.targetSceneIds);
    }
    decisions.push({
      action: 'kept',
      contractId: contract.id,
      contractKind: contract.contractKind,
      episodeNumber: contract.episodeNumber,
      fromSceneId: from?.id,
      toSceneId: target.id,
      reason: 'Existing planned-scene binding is consistent with obligation scope.',
    });
  }

  const beatAdditions = new Map<string, RequiredBeat[]>();
  for (const scene of scenes) {
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const text = beatText(beat);
      const inferredEpisodeNumber = episodeNumberFromBeatId(beat.id);
      if (inferredEpisodeNumber && inferredEpisodeNumber !== scene.episodeNumber) {
        const episodeTargets = scenes.filter((candidate) => candidate.episodeNumber === inferredEpisodeNumber);
        if (episodeTargets.length > 0) {
          const target = bestSceneForBeat(text, episodeTargets, beat.id) ?? episodeTargets[0];
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), beat]);
          decisions.push({
            action: 'rebound',
            issueKind: 'chronology_conflict',
            contractId: beat.id,
            contractKind: 'pressure_lane',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            toSceneId: target.id,
            reason: `Required beat id belongs to episode ${inferredEpisodeNumber}, so it was rebound out of episode ${scene.episodeNumber}.`,
          });
        } else {
          decisions.push({
            action: 'ledgered',
            issueKind: 'ledger_scope_pollution',
            contractId: beat.id,
            contractKind: 'information_movement',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            reason: `Required beat id belongs to episode ${inferredEpisodeNumber}, which is outside this scoped scene plan; keep it plan-level instead of hard-binding it to episode ${scene.episodeNumber} prose.`,
          });
        }
        continue;
      }

      if (isLedgerOnlyBeat(beat)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'ledger_scope_pollution',
          contractId: beat.id,
          contractKind: 'information_movement',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Abstract or future seed beat remains in the season ledger instead of hard-bound to scene prose.',
        });
        continue;
      }

      const openingStoryCircleScene = openingStoryCircleTarget(scenes, scene, beat);
      if (openingStoryCircleScene && openingStoryCircleScene.id !== scene.id) {
        beatAdditions.set(openingStoryCircleScene.id, [...(beatAdditions.get(openingStoryCircleScene.id) ?? []), beat]);
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: openingStoryCircleScene.id,
          reason: 'Story Circle-derived opening atom did not serve the cold-open turn and was rebound to the matching planned scene.',
        });
        continue;
      }

      if (beat.tier === 'coldopen') {
        const sourceCues = eventCues(text);
        if (!sourceCues.has('arrival') && sourceCues.size === 1) {
          const target = primaryCueTargetForOverloadBeat(scenes, scene, beat) ?? bestSceneForBeat(text, scenes, beat.id);
          if (
            target
            && target.id !== scene.id
            && cueSetsOverlap(sourceCues, primarySceneCues(target))
            && (
              !cueSetsOverlap(sourceCues, primarySceneCues(scene))
              || scoreSceneForBeat(text, target, beat.id) - scoreSceneForBeat(text, scene, beat.id) >= 1.25
            )
          ) {
            beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), beat]);
            decisions.push({
              action: 'rebound',
              issueKind: 'wrong_scene_binding',
              contractId: beat.id,
              contractKind: 'pressure_lane',
              episodeNumber: scene.episodeNumber,
              fromSceneId: scene.id,
              toSceneId: target.id,
              reason: 'Cold-open beat carried a concrete non-arrival event cue and was moved to its matching planned scene instead of overloading the opening.',
            });
            continue;
          }
        }
      }

      const parts = splitTimeChainedBeat(beat);
      if (parts.length > 1) {
        parts.forEach((part, index) => {
          const target = bestSceneForBeat(part, scenes, beat.id) ?? scene;
          const nextBeat: RequiredBeat = {
            ...beat,
            id: `${beat.id}-part-${index + 1}`,
            sourceTurn: part,
            mustDepict: part,
          };
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), nextBeat]);
        });
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Multi-time authored beat was split into chronological scene-local required beats.',
        });
        continue;
      }

      const broadArrivalParts = splitBroadArrivalIdentityBeat(beat);
      if (broadArrivalParts.length > 1) {
        broadArrivalParts.forEach((part, index) => {
          const target = targetForBroadArrivalPart(part, scenes, scene, beat.id);
          if (!target) {
            decisions.push({
              action: 'ledgered',
              issueKind: 'ledger_scope_pollution',
              contractId: `${beat.id}-scene-${index + 1}`,
              contractKind: 'information_movement',
              episodeNumber: scene.episodeNumber,
              fromSceneId: scene.id,
              reason: 'Broad arrival/social-identity fragment had no safe scene-local target, so it remains plan-level instead of binding to the wrong scene.',
            });
            return;
          }
          const nextBeat: RequiredBeat = {
            ...beat,
            id: `${beat.id}-scene-${index + 1}`,
            sourceTurn: part,
            mustDepict: part,
          };
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), nextBeat]);
        });
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Broad arrival/social-identity beat was split into scene-sized obligations so the cold open does not have to realize the full social circle and writing strategy.',
        });
        continue;
      }

      const broadTurnoutParts = splitBroadEpisodeTurnoutBeat(beat);
      if (broadTurnoutParts.length > 1) {
        broadTurnoutParts.forEach((part, index) => {
          const target = targetForBroadTurnoutPart(part, scenes, scene, beat.id);
          if (!target) {
            decisions.push({
              action: 'ledgered',
              issueKind: 'ledger_scope_pollution',
              contractId: `${beat.id}-turnout-${index + 1}`,
              contractKind: 'information_movement',
              episodeNumber: scene.episodeNumber,
              fromSceneId: scene.id,
              reason: 'Broad episode-turnout fragment had no safe scene-local target, so it remains plan-level instead of binding to the wrong scene.',
            });
            return;
          }
          const nextBeat: RequiredBeat = {
            ...beat,
            id: `${beat.id}-turnout-${index + 1}`,
            sourceTurn: part,
            mustDepict: part,
          };
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), nextBeat]);
        });
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Broad episode-turnout summary was split into scene-sized obligations instead of forcing one encounter scene to realize social formation, rescue, and viral aftermath.',
        });
        continue;
      }

      const primaryCueTarget = primaryCueTargetForOverloadBeat(scenes, scene, beat);
      if (primaryCueTarget && primaryCueTarget.id !== scene.id) {
        beatAdditions.set(primaryCueTarget.id, [...(beatAdditions.get(primaryCueTarget.id) ?? []), beat]);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: primaryCueTarget.id,
          reason: 'Concrete cue-bound required beat was moved to its primary planned scene before density checks.',
        });
        continue;
      }

      const actionParts = splitActionChainedBeat(beat);
      if (actionParts.length > 1) {
        const targets = actionParts.map((part) => bestSceneForBeat(part, scenes, beat.id) ?? scene);
        const distinctTargetIds = new Set(targets.map((target) => target.id));
        if (distinctTargetIds.size < 2) {
          kept.push(beat);
          continue;
        }
        actionParts.forEach((part, index) => {
          const target = targets[index];
          const nextBeat: RequiredBeat = {
            ...beat,
            id: `${beat.id}-action-${index + 1}`,
            sourceTurn: part,
            mustDepict: part,
          };
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), nextBeat]);
        });
        decisions.push({
          action: 'kept',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          reason: 'Dense authored action chain was split into smaller scene-local required beats so every action remains enforced without one monolithic prose target.',
        });
        continue;
      }

      if (hasTimelineCue(text) || eventCues(text).size > 0) {
        const primaryCueTarget = primaryCueTargetForOverloadBeat(scenes, scene, beat);
        const target = primaryCueTarget ?? bestSceneForBeat(text, scenes, beat.id);
        const forcePrimaryCueRebound = Boolean(primaryCueTarget && primaryCueTarget.id !== scene.id);
        const forceBlogMetricRebound = Boolean(
          target
          && target.id !== scene.id
          && isBlogMetricText(text)
          && isPrimaryBlogAftermathScene(target)
          && !isPrimaryBlogAftermathScene(scene),
        );
        if (target && target.id !== scene.id && (forcePrimaryCueRebound || forceBlogMetricRebound || scoreSceneForBeat(text, target, beat.id) - scoreSceneForBeat(text, scene, beat.id) >= 1.25)) {
          beatAdditions.set(target.id, [...(beatAdditions.get(target.id) ?? []), beat]);
          decisions.push({
            action: 'rebound',
            issueKind: 'chronology_conflict',
            contractId: beat.id,
            contractKind: 'pressure_lane',
            episodeNumber: scene.episodeNumber,
            fromSceneId: scene.id,
            toSceneId: target.id,
            reason: 'Time-coded required beat matched a later planned scene more strongly than its current scene.',
          });
          continue;
        }
      }

      kept.push(beat);
    }
    replaceRequiredBeats(scene, kept);
  }

  for (const scene of scenes) {
    const additions = beatAdditions.get(scene.id) ?? [];
    if (additions.length > 0) {
      scene.requiredBeats = [...(scene.requiredBeats ?? []), ...additions];
    }
  }

  drainNonOpeningColdOpenBeats(scenes, decisions);
  dedupeRequiredBeats(scenes, decisions);
  // Story-specific split passes were removed; treatment atom ownership and generic
  // density/chronology rules are the authoritative content-agnostic path.
  relieveUnsafeTreatmentDensity(scenes, decisions);
  rewriteStructuralLabelTurnContracts(scenes, decisions);
  rewriteBroadChoiceTurnContracts(scenes, decisions);
  dedupeEncounterRequiredBeatsAgainstFields(scenes, decisions);
  dedupeRequiredBeats(scenes, decisions);
  dedupeAuthoredTreatmentFieldsAgainstSceneBeats(scenes, decisions);
  scrubArcPressureBindings(scenes);
  evictInvalidBlogAftermathOwnership(scenes, decisions);
  orderSyntheticBlogAftermathScenes(scenes, decisions);
  renormalizeSceneOrders(scenes);
  attachColdOpenProfiles(scenes, { episodeNumber: options.episodeNumber });

  const beatBudgetRecommendations = scenes
    .map((scene) => ({ scene, hard: estimateHardUnits(scene), total: estimateTotalUnits(scene) }))
    .filter(({ scene, hard, total }) => {
      const hardThreshold = scene.kind === 'encounter' ? 5 : 4;
      const totalThreshold = scene.kind === 'encounter' ? 7 : 5.5;
      return hard > hardThreshold || total >= totalThreshold;
    })
    .map(({ scene, hard, total }) => ({
      sceneId: scene.id,
      episodeNumber: scene.episodeNumber,
      currentHardUnitEstimate: hard,
      recommendedBeatCount: Math.min(12, Math.max(6, Math.ceil(Math.max(hard, total)) + 2)),
      reason: 'Scene has valid dense obligations after rebinding; expand beat budget instead of moving unrelated obligations into another scene.',
    }));

  for (const recommendation of beatBudgetRecommendations) {
    decisions.push({
      action: 'kept',
      issueKind: 'valid_dense_scene_needs_more_beats',
      contractId: `beat-budget:${recommendation.sceneId}`,
      contractKind: 'pressure_lane',
      episodeNumber: recommendation.episodeNumber,
      fromSceneId: recommendation.sceneId,
      toSceneId: recommendation.sceneId,
      reason: recommendation.reason,
    });
  }

  return {
    scenes,
    report: {
      episodeNumber: options.episodeNumber,
      decisions,
      beatBudgetRecommendations,
      unresolved: decisions.filter((decision) => decision.action === 'unresolved'),
    },
    planLevelAuthoredTreatmentFields: uniqueById(Array.from(planLevel.values())),
  };
}
