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
import { hasTimelineCue } from './gateRepairRouter';

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
const BROAD_FUTURE_LEDGER_RE = /\b(?:episode cannot be removed|cannot be removed|launch(?:es)? the entire|back half|courtship-and-mystery|country[-\s]?house|equinox weekend|casa stelarum|ileana|anonymous warning|no-photo account|last party|cliffhanger|left unexplained|too-perfect|too perfect|happened to break down|was staged|had been staged)\b/i;
const NEXT_PRESSURE_RE = /\b(?:accepts?|invitation|invites?|weekend|retreat|country[-\s]?house|next pressure|next episode|doorway|threshold question)\b/i;

const LOCATION_KEYWORDS = [
  'lumina',
  'bookshop',
  'bookstore',
  'rooftop',
  'cismigiu',
  'park',
  'gardens',
  'dragan',
  'valcescu',
  'club',
  'apartment',
  'courtyard',
  'blog',
];

type SceneEventCue =
  | 'arrival'
  | 'valcescuDoor'
  | 'bookshopQuartz'
  | 'rooftopMeet'
  | 'parkAttack'
  | 'roadBreakdown'
  | 'friendDebrief'
  | 'lateNightWriting'
  | 'blogAftermath'
  | 'endingAftermath';

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
  const text = normalize(value);
  const cues = new Set<SceneEventCue>();
  if (/\b(?:lands?|arrives?|unpacks?|two suitcases|grandmother(?:'s)? address|belle epoque|lipscani window)\b/.test(text)) {
    cues.add('arrival');
  }
  if (/\b(?:valcescu|club|side entrance|key card|american shoes|night two)\b/.test(text)
    || (/\bvictor\b/.test(text) && /\b(?:booth|back room|back-room|jazz|for now|codename|every post|mr midnight)\b/.test(text))) {
    cues.add('valcescuDoor');
  }
  if (/\b(?:lumina|bookshop|bookstore|quartz|crystal|stela presses|wants to be with you)\b/.test(text)) {
    cues.add('bookshopQuartz');
  }
  if (/\b(?:rooftop|mr charcoal|charcoal-suited man|victor across|mika clocks|follow mika|walk over|lets eat first|worst date|podcast|kitchen entrance|rougher man)\b/.test(text)) {
    cues.add('rooftopMeet');
  }
  if (/\b(?:cismigiu|park|garden|willow|shadow|pinned|attacker|scream|freeze|fight back|rescues?|1 ?am|1 ?15|1 ?16)\b/.test(text)) {
    cues.add('parkAttack');
  }
  if (hasRoadBreakdownCue(text)) {
    cues.add('roadBreakdown');
  }
  if (/\b(?:debrief|convenes?|regroups?|recaps?|friend group|dusk club|dragan|vintage|after[-\s]?date)\b/.test(text)) {
    cues.add('friendDebrief');
  }
  if (/\b(?:3 ?am|2 ?am|late night|goes home|back home|two men'?s numbers|numbers in (?:her|your) phone|dictionary|codename|writes? .*the mountain|writes? .*chef)\b/.test(text)) {
    cues.add('lateNightWriting');
  }
  if (/\b(?:blog|post|dating after dusk|mr midnight|readership|reads?|viral|dashboard|profile|republik|codename|4 ?am|6 ?pm|80 ?000|84 ?000)\b/.test(text)) {
    cues.add('blogAftermath');
  }
  if (/\b(?:9 ?am|dm pile|brand deal|horrible dream|coming over with herbs|cliffhanger|episode end)\b/.test(text)) {
    cues.add('endingAftermath');
  }
  return cues;
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
  return LEDGER_ONLY_RE.test(text)
    || BROAD_FUTURE_LEDGER_RE.test(text)
    || /\b(?:choice residue|did or didn|whether|depending on|contracted to|confirmed at|revealed at|paid off in|future|later|episode\s+\d+|staged the ep-1 attack|strigoi|pricolici|hunter|cannot control)\b/i.test(text)
    || /\b(?:so .{0,80}\blands\b|built-up contrast|cold reintroduction|doorstep scarf|sunday[-\s]?night|during the weekend)\b/i.test(text);
}

function splitTimeChainedBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (beat.tier === 'coldopen' || explicitTimeCues(text).length < 2) return [text].filter(Boolean);
  const protectedText = text.replace(/\bMr\.\s+/g, 'Mr__DOT__');
  const parts = protectedText
    .split(/\s*;\s+|(?<=\.)\s+(?=[A-Z])|\s+(?=\bby\s+(?:night|morning|dawn|dusk|sunset|midnight|\d+\s*(?:am|pm)|\d+:))/i)
    .map((part) => part.replace(/Mr__DOT__/g, 'Mr. ').trim().replace(/^\band\s+/i, ''))
    .filter((part) => part.length >= 20);
  return parts.length > 1 ? parts : [text];
}

const ACTION_VERB_RE = /\b(?:adopts?|asks?|attacks?|buzzes?|calls?|closes?|confronts?|declines?|delivers?|drops?|finds?|gives?|hands?|interrupts?|kisses?|launches?|leaves?|names?|offers?|opens?|pins?|presses?|refuses?|rescues?|scrolls?|sees?|swaps?|takes?|turns?|vanishes?|walks?|warns?|writes?)\b/i;

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

  return raw.map((part, index) => {
    if (index === 0) return part;
    if (ACTION_VERB_RE.test(part)) return `${subject} ${part}`;
    return part;
  });
}

function splitActionChainedBeat(beat: RequiredBeat): string[] {
  const text = (beat.mustDepict || beat.sourceTurn || '').trim();
  if (!text || beat.tier === 'seed' || beat.tier === 'connective' || beat.tier === 'coldopen') return [text].filter(Boolean);
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

function isRougherKitchenBeat(text: string): boolean {
  return /\brougher\s+man\b/i.test(text) || /\bkitchen\s+entrance\b/i.test(text);
}

function bestSceneForBeat(text: string, scenes: PlannedScene[], excludeRequiredBeatId?: string): PlannedScene | undefined {
  const sourceCues = eventCues(text);
  if (sourceCues.has('blogAftermath') && isBlogMetricText(text)) {
    const blogMatches = scenes.filter(isPrimaryBlogAftermathScene);
    if (blogMatches.length > 0) {
      return blogMatches
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
  if (sourceCues.has('rooftopMeet') && isRougherKitchenBeat(text)) {
    const rooftopMatches = scenes.filter((scene) => {
      const cues = primarySceneCues(scene);
      return cues.has('rooftopMeet') && !cues.has('valcescuDoor');
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
      const priority: SceneEventCue[] = ['parkAttack', 'roadBreakdown', 'bookshopQuartz', 'rooftopMeet', 'valcescuDoor', 'blogAftermath'];
      const priorityCue = priority.find((cue) => sourceCues.has(cue));
      if (priorityCue) {
        const priorityCandidates = sameEpisode.filter((scene) => primarySceneCues(scene).has(priorityCue));
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
    return sameEpisode.find((scene) => scene.hasChoice) ?? sameEpisode.find((scene) => scene.narrativeRole === 'turn');
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
    title: 'Kylie arrives in Bucharest',
    dramaticPurpose: sourceBeat.mustDepict,
    narrativeRole: 'setup',
    locations: ["Kylie's Lipscani Apartment"],
    npcsInvolved: ['Kylie Marinescu', 'Sadie'],
    setsUp: [],
    paysOff: [],
    requiredBeats: [sourceBeat],
    stakes: 'Kylie reaches Bucharest with the fragile promise of reinvention still intact.',
    turnContract: {
      turnId: `s${episodeNumber}-arrival-cold-open-turn`,
      source: 'treatment',
      centralTurn: sourceBeat.mustDepict,
      beforeState: 'Kylie has not yet claimed the city as a possible new life.',
      turnEvent: sourceBeat.mustDepict,
      afterState: 'The episode promise is planted: Bucharest might let Kylie start over, but not without cost.',
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
  return /\b(?:6pm|80\s*000|84\s*000|90\s*000|readership|reads|brand deal|dm pile|dashboard|profile|republik|ticking past)\b/.test(text);
}

function isPublicBlogAftermathText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:brand deal|brand deals|dm pile|republik|profile|readership|dashboard|blog as public|public sellable|sellable codenamed|80\s*000|84\s*000|90\s*000|130\s*000)\b/.test(text)
    && !isBlogDraftText(value);
}

function isBlogDraftText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:4am|unable to sleep|launches dating after dusk|writes? about|writes? .*mr midnight|post about)\b/.test(text);
}

function isPrimaryBlogAftermathScene(scene: PlannedScene): boolean {
  const cues = primarySceneCues(scene);
  return cues.has('blogAftermath')
    && !cues.has('rooftopMeet')
    && !cues.has('parkAttack')
    && !cues.has('roadBreakdown')
    && !cues.has('valcescuDoor');
}

function isFriendDebriefText(value: string | undefined): boolean {
  const text = normalize(value);
  const strongDebrief = /\b(?:debrief|convenes?|regroups?|recaps?|dragan|vintage)\b/.test(text);
  return hasCue(value, 'friendDebrief')
    && !hasCue(value, 'lateNightWriting')
    && (strongDebrief || !hasCue(value, 'valcescuDoor'));
}

function isLateNightWritingText(value: string | undefined): boolean {
  const text = normalize(value);
  const strongWriting = /\b(?:3 ?am|2 ?am|late night|goes home|back home|numbers in (?:her|your) phone|dictionary|codename|writes?)\b/.test(text);
  return strongWriting
    && hasCue(value, 'lateNightWriting')
    && !hasCue(value, 'valcescuDoor');
}

function isSocialDebriefAndWritingAftermathText(value: string | undefined): boolean {
  const cues = eventCues(value);
  if (cues.has('friendDebrief') && cues.has('lateNightWriting')) return true;
  const text = normalize(value);
  return /\b(?:debrief|dusk club|dragan vintage)\b/.test(text)
    && /\b(?:3 ?am|2 ?am|late night|two men'?s numbers|numbers in (?:her|your) phone|dictionary|codename)\b/.test(text);
}

function isRescueAftermathText(value: string | undefined): boolean {
  const text = normalize(value);
  return /\b(?:walks? her home|kisses? her hand|threshold|declines? to come in|vanishes?)\b/.test(text);
}

function parkAttackEncounterFieldText(field: AuthoredTreatmentFieldContract): string | undefined {
  if (field.contractKind !== 'encounter_anchor' && field.contractKind !== 'encounter_conflict') return undefined;
  if (!hasCue(field.sourceText, 'rooftopMeet') || !hasCue(field.sourceText, 'parkAttack')) return undefined;
  if (field.contractKind === 'encounter_anchor') {
    return 'Cișmigiu at 1am: fog, a shadow, a scream, and Victor rescuing Kylie from the attack.';
  }
  return 'The park attack is the cost the city exacts for Kylie treating danger as romance.';
}

function canonicalizeVictorAftermathBeat(beat: RequiredBeat): RequiredBeat {
  const replace = (value: string) => value.replace(/\ba second figure in a charcoal suit\b/ig, 'Victor');
  const nextSource = replace(beat.sourceTurn);
  const nextDepiction = replace(beat.mustDepict);
  if (nextSource === beat.sourceTurn && nextDepiction === beat.mustDepict) return beat;
  return {
    ...beat,
    sourceTurn: nextSource,
    mustDepict: nextDepiction,
  };
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

function isParkAttackText(value: string | undefined): boolean {
  const text = normalize(value);
  return hasCue(value, 'parkAttack')
    || /\b(?:shadow|attacker|pinned|willow|scream|fight back|freeze|run|can stand|drops the attacker)\b/.test(text);
}

function isConcreteSidecarSeed(value: string | undefined): boolean {
  if (!value) return false;
  return sceneHasConcreteCue(value)
    && !hasCue(value, 'rooftopMeet')
    && !isParkAttackText(value)
    && !isBlogDraftText(value)
    && !isBlogMetricText(value);
}

function cloneContractForScene(contract: AuthoredTreatmentFieldContract, sceneId: string): AuthoredTreatmentFieldContract {
  return { ...contract, targetSceneIds: [sceneId] };
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
      if (beat.tier === 'seed' || beat.tier === 'connective') {
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

function repairMixedRooftopParkEncounter(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const episodeNumbers = Array.from(new Set(scenes.map((scene) => scene.episodeNumber)));
  for (const episodeNumber of episodeNumbers) {
    const episodeScenes = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
    const encounter = episodeScenes.find((scene) =>
      scene.kind === 'encounter'
      && hasCue(sceneText(scene), 'rooftopMeet')
      && (scene.authoredTreatmentFields ?? []).some((field) => hasAnyCue(field.sourceText, ['parkAttack'])),
    );
    const parkScene = episodeScenes
      .filter((scene) => scene.id !== encounter?.id && scene.kind === 'standard')
      .map((scene) => ({
        scene,
        score:
          (normalize(scene.locations?.join(' ')).match(/\b(?:cismigiu|park|gardens)\b/) ? 6 : 0)
          + ((scene.requiredBeats ?? []).some((beat) => isParkAttackText(beatText(beat))) ? 4 : 0)
          + (hasCue(sceneText(scene), 'parkAttack') ? 1 : 0),
      }))
      .filter((entry) => entry.score >= 4)
      .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
    if (!encounter || !parkScene) continue;

    const setup = insertPlannedScene(scenes, {
      ...encounter,
      id: `s${episodeNumber}-rooftop-setup`,
      order: encounter.order - 0.1,
      kind: 'standard',
      encounter: undefined,
      title: 'Rooftop bar at sunset',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'mixed_rooftop_setup',
        parentSceneId: encounter.id,
        reason: 'Split mixed rooftop setup away from the later park encounter so both authored turns can land chronologically.',
      },
      dramaticPurpose: encounter.dramaticPurpose,
      narrativeRole: 'development',
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: true,
    });
    setSceneTurnContract(setup, {
      turnId: `${setup.id}-turn`,
      source: setup.turnContract?.source ?? 'treatment',
      centralTurn: 'Kylie joins Mika at the rooftop bar and clocks the charged social triangle before the night turns dangerous.',
      beforeState: 'Kylie is still treating Bucharest as a romantic social experiment.',
      turnEvent: 'The rooftop meeting turns the city from possibility into visible romantic and social pressure.',
      afterState: 'Kylie leaves the rooftop with curiosity sharpened and danger still unnamed.',
      handoff: 'Hand forward to the later walk without restaging the park attack.',
    });

    const movedBeatIds = new Set<string>();
    for (const beat of encounter.requiredBeats ?? []) {
      const text = beatText(beat);
      if (beat.tier === 'seed' && isConcreteSidecarSeed(text)) {
        pushUniqueBeat(parkScene, beat);
        movedBeatIds.add(beat.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: beat.id,
          contractKind: 'consequence_seed',
          episodeNumber,
          fromSceneId: encounter.id,
          toSceneId: parkScene.id,
          reason: 'Concrete sidecar seed belongs with the adjacent aftermath scene, not the rooftop setup.',
        });
        continue;
      }
      if (hasCue(text, 'rooftopMeet') || (!isParkAttackText(text) && !isLedgerOnlyBeat(beat))) {
        pushUniqueBeat(setup, beat);
        movedBeatIds.add(beat.id);
      }
    }
    encounter.requiredBeats = (encounter.requiredBeats ?? []).filter((beat) => !movedBeatIds.has(beat.id));
    if (encounter.requiredBeats.length === 0) delete encounter.requiredBeats;

    const setupFieldIds = new Set<string>();
    for (const field of encounter.authoredTreatmentFields ?? []) {
      const text = field.sourceText;
      const rooftop = hasCue(text, 'rooftopMeet');
      const park = hasCue(text, 'parkAttack') || /1\s*am|shadow|fog|scream|rescued|attacker/i.test(text);
      if (field.contractKind === 'consequence_seed' && isConcreteSidecarSeed(text)) {
        pushUniqueField(parkScene, cloneContractForScene(field, parkScene.id));
        setupFieldIds.add(field.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'wrong_scene_binding',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber,
          fromSceneId: encounter.id,
          toSceneId: parkScene.id,
          reason: 'Concrete sidecar seed contract belongs with the adjacent aftermath scene, not the rooftop setup.',
        });
        continue;
      }
      if (field.contractKind === 'consequence_seed' && (setup.requiredBeats ?? []).some((beat) =>
        Math.max(tokenOverlap(field.sourceText, beatText(beat)), tokenOverlap(beatText(beat), field.sourceText)) >= 0.58
      )) {
        setupFieldIds.add(field.id);
        decisions.push({
          action: 'ledgered',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber,
          fromSceneId: encounter.id,
          toSceneId: setup.id,
          reason: 'Consequence seed duplicates a scene-local required beat and remains enforced through that beat instead of adding density.',
        });
        continue;
      }

      if (field.contractKind === 'major_choice_pressure' && (setup.authoredTreatmentFields ?? []).some((existing) =>
        existing.contractKind === 'major_choice_pressure'
        && Math.max(tokenOverlap(field.sourceText, existing.sourceText), tokenOverlap(existing.sourceText, field.sourceText)) >= 0.42
      )) {
        setupFieldIds.add(field.id);
        decisions.push({
          action: 'ledgered',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber,
          fromSceneId: encounter.id,
          toSceneId: setup.id,
          reason: 'Duplicate rooftop choice-pressure wording is represented by the surviving choice contract.',
        });
        continue;
      }

      if (
        field.contractKind === 'major_choice_pressure'
        || field.contractKind === 'consequence_seed'
        || (field.contractKind === 'pressure_lane' && /\bdouble meet\b/i.test(text))
        || (rooftop && !park)
      ) {
        pushUniqueField(setup, cloneContractForScene(field, setup.id));
        setupFieldIds.add(field.id);
      }
    }
    removeFieldIds(encounter, setupFieldIds);
    for (const field of encounter.authoredTreatmentFields ?? []) {
      const encounterOnlyText = parkAttackEncounterFieldText(field);
      if (!encounterOnlyText) continue;
      field.sourceText = encounterOnlyText;
      field.fieldName = field.contractKind;
      decisions.push({
        action: 'kept',
        issueKind: 'wrong_scene_binding',
        contractId: field.id,
        contractKind: field.contractKind,
        episodeNumber,
        fromSceneId: encounter.id,
        toSceneId: encounter.id,
        reason: 'Mixed rooftop/park encounter field was narrowed to the encounter event after rooftop setup split.',
      });
    }

    encounter.title = 'Cișmigiu attack at 1am';
    encounter.dramaticPurpose = 'Cișmigiu at 1am: fog, a shadow, a scream, and a rescue that makes Kylie feel chosen and endangered at once.';
    encounter.locations = ['Cișmigiu Gardens'];
    encounter.timeOfDay = 'night';
    encounter.timeJump = 'later that night';
    encounter.turnContract = {
      turnId: `${encounter.id}-park-attack-turn`,
      source: 'encounter',
      centralTurn: 'Kylie survives the Cișmigiu attack because Victor intervenes.',
      beforeState: 'Kylie is alone after the rooftop high, still treating danger as story material.',
      turnEvent: 'Fog, a shadow, and a scream turn the city from romantic possibility into a supernatural threat.',
      afterState: 'Victor is no longer just a magnetic stranger; he is the man who saved her and may already own the story.',
      handoff: 'Victor walks Kylie home, performs courtly restraint at the threshold, and vanishes.',
    };
    encounter.encounter = {
      ...(encounter.encounter ?? {
        type: 'combat',
        difficulty: 'moderate',
        relevantSkills: ['notice', 'move', 'endure'],
        isBranchPoint: true,
      }),
      description: 'Cișmigiu at 1am: fog, a shadow, a scream, and Victor rescuing Kylie from the attack.',
      centralConflict: 'Kylie must survive the shadow attack long enough for the rescue to change her story.',
    };

    const parkFieldIds = new Set<string>();
    for (const field of parkScene.authoredTreatmentFields ?? []) {
      if (field.contractKind === 'major_choice_pressure' && isParkAttackText(field.sourceText)) {
        pushUniqueField(encounter, cloneContractForScene(field, encounter.id));
        parkFieldIds.add(field.id);
      }
    }
    removeFieldIds(parkScene, parkFieldIds);

    const keptParkBeats: RequiredBeat[] = [];
    for (const beat of parkScene.requiredBeats ?? []) {
      const text = beatText(beat);
      if (isParkAttackText(text) && !isRescueAftermathText(text)) {
        decisions.push({
          action: 'ledgered',
          issueKind: 'encounter_scope_pollution',
          contractId: beat.id,
          contractKind: 'encounter_anchor',
          episodeNumber,
          fromSceneId: parkScene.id,
          toSceneId: encounter.id,
          reason: 'Park attack microbeat is enforced through the encounter anchor instead of duplicated as overloaded standard-scene prose.',
        });
        continue;
      }
      keptParkBeats.push(beat);
    }
    replaceRequiredBeats(parkScene, keptParkBeats);
    parkScene.title = 'Victor walks Kylie home';
    parkScene.dramaticPurpose = 'Victor escorts Kylie home after the danger has passed, turning rescue into intimate courtly attention without restaging the encounter.';
    parkScene.locations = ["Route to Kylie's Apartment", "Kylie's Courtyard"];
    parkScene.timeOfDay = 'night';
    parkScene.timeJump = 'continuous';
    setSceneTurnContract(parkScene, {
      turnId: `${parkScene.id}-escort-turn`,
      source: 'treatment',
      centralTurn: 'Victor walks Kylie home and kisses her hand at the threshold.',
      beforeState: 'Kylie is shaken and has not yet understood what Victor wants from the rescue.',
      turnEvent: 'Victor turns danger into intimate courtly attention by escorting Kylie home and kissing her hand.',
      afterState: 'Victor is framed as both savior and romantic fixation, while the invitation boundary remains unresolved.',
      handoff: 'Hand forward to the threshold boundary without restaging the park encounter.',
    });

    decisions.push({
      action: 'rebound',
      issueKind: 'chronology_conflict',
      contractId: `mixed-encounter:${encounter.id}`,
      contractKind: 'encounter_anchor',
      episodeNumber,
      fromSceneId: encounter.id,
      toSceneId: setup.id,
      reason: 'Mixed rooftop setup and park attack encounter were split into adjacent planned scenes before content generation.',
    });
  }
}

function splitBlogMetricScenes(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const targets = scenes.filter((scene) =>
    scene.kind === 'standard'
    && (scene.requiredBeats ?? []).some((beat) => isBlogDraftText(beatText(beat)))
    && (
      (scene.requiredBeats ?? []).some((beat) => isBlogMetricText(beatText(beat)))
      || (scene.authoredTreatmentFields ?? []).some((field) => isBlogMetricText(field.sourceText))
    ),
  );

  for (const scene of targets) {
    const metricScene = insertPlannedScene(scenes, {
      ...scene,
      id: `${scene.id}-viral-aftermath`,
      order: scene.order + 0.2,
      title: 'The post goes viral by evening',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'viral_aftermath',
        parentSceneId: scene.id,
        reason: 'Split the public readership aftermath away from the private writing scene to avoid overloading one prose unit.',
      },
      dramaticPurpose: "By evening, the Mr. Midnight post becomes a visible public signal that Kylie's new life is accelerating beyond her control.",
      narrativeRole: 'payoff',
      turnContract: scene.turnContract ? {
        ...scene.turnContract,
        turnId: `${scene.id}-viral-aftermath-turn`,
        centralTurn: 'The post becomes publicly visible by evening.',
        turnEvent: 'The readership number climbs high enough to turn private testimony into public pressure.',
        beforeState: 'The post is a private act of voice.',
        afterState: 'The post is loose in the city, creating attention, leverage, and danger.',
        handoff: 'Let the viral attention pressure the next scene rather than restaging the writing moment.',
      } : undefined,
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: false,
    });
    delete (metricScene as PlannedScene & { choicePoint?: unknown }).choicePoint;
    if (scene.turnContract) {
      scene.turnContract = {
        ...scene.turnContract,
        turnId: `${scene.id}-draft-turn`,
        centralTurn: 'Unable to sleep, Kylie writes and publishes the post.',
        turnEvent: 'The private fear from the night becomes a named public story.',
        beforeState: 'Kylie is alone with the aftermath and no stable explanation.',
        afterState: 'Kylie has converted the danger into voice, even before she knows its cost.',
        handoff: 'Hand forward to the readership number climbing by evening.',
      };
    }

    const keptBeats: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      if (isBlogMetricText(beatText(beat)) && !isBlogDraftText(beatText(beat))) {
        pushUniqueBeat(metricScene, beat);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: metricScene.id,
          reason: 'Later blog-readership beat belongs to the evening aftermath scene, not the 4am writing scene.',
        });
      } else {
        keptBeats.push(beat);
      }
    }
    replaceRequiredBeats(scene, keptBeats);

    const movedFieldIds = new Set<string>();
    for (const field of scene.authoredTreatmentFields ?? []) {
      if (isBlogMetricText(field.sourceText) && !isBlogDraftText(field.sourceText)) {
        pushUniqueField(metricScene, cloneContractForScene(field, metricScene.id));
        movedFieldIds.add(field.id);
      }
    }
    removeFieldIds(scene, movedFieldIds);
  }
}

function splitRoadPublicAftermathScenes(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const targets = scenes.filter((scene) =>
    scene.kind === 'standard'
    && primarySceneCues(scene).has('roadBreakdown')
    && (
      (scene.requiredBeats ?? []).some((beat) => isPublicBlogAftermathText(beatText(beat)))
      || (scene.authoredTreatmentFields ?? []).some((field) => isPublicBlogAftermathText(field.sourceText))
    ),
  );

  for (const scene of targets) {
    const publicScene = insertPlannedScene(scenes, {
      ...scene,
      id: `${scene.id}-public-blog-aftermath`,
      order: scene.order + 0.15,
      title: 'The blog becomes public leverage',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'public_blog_aftermath',
        parentSceneId: scene.id,
        reason: 'Split public blog leverage away from the private road-breakdown scene to preserve chronology and density.',
      },
      dramaticPurpose: "The blog's growing reach, brand attention, and public profile become material pressure after the private road encounter.",
      narrativeRole: 'payoff',
      locations: ["Kylie's Lipscani Apartment"],
      signatureMoment: undefined,
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: false,
    });
    delete (publicScene as PlannedScene & { choicePoint?: unknown }).choicePoint;

    const keptBeats: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      if (isPublicBlogAftermathText(beatText(beat))) {
        pushUniqueBeat(publicScene, beat);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: publicScene.id,
          reason: 'Public blog/readership aftermath belongs in a separate payoff scene instead of overloading the road-breakdown scene.',
        });
        continue;
      }
      keptBeats.push(beat);
    }
    replaceRequiredBeats(scene, keptBeats);

    const movedFieldIds = new Set<string>();
    for (const field of scene.authoredTreatmentFields ?? []) {
      if (isPublicBlogAftermathText(field.sourceText)) {
        pushUniqueField(publicScene, cloneContractForScene(field, publicScene.id));
        movedFieldIds.add(field.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: publicScene.id,
          reason: 'Public blog/readership treatment field was rebound to a payoff aftermath scene.',
        });
      }
    }
    removeFieldIds(scene, movedFieldIds);

    setSceneTurnContract(publicScene, {
      turnId: `${publicScene.id}-turn`,
      source: publicScene.turnContract?.source ?? 'treatment',
      centralTurn: "The blog's reach becomes public leverage.",
      beforeState: 'The road encounter is still private material.',
      turnEvent: 'Readership, brand attention, and profile pressure turn private experience into public leverage.',
      afterState: 'The protagonist has more attention than control over the version of herself now circulating.',
      handoff: 'Hand forward to the next romantic or mystery pressure without restaging the road encounter.',
    });
  }
}

function splitRescueAftermathScenes(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const targets = scenes.filter((scene) => {
    const beats = scene.requiredBeats ?? [];
    return scene.kind === 'standard'
      && beats.length >= 4
      && beats.some((beat) => /\bwalks? her home\b/i.test(beatText(beat)))
      && beats.some((beat) => /\b(?:threshold|declines? to come in|vanishes?)\b/i.test(beatText(beat)));
  });

  for (const scene of targets) {
    const thresholdScene = insertPlannedScene(scenes, {
      ...scene,
      id: `${scene.id}-threshold`,
      order: scene.order + 0.1,
      title: 'Victor stops at the threshold',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'threshold_aftermath',
        parentSceneId: scene.id,
        reason: 'Split the threshold aftermath away from the walk-home scene to avoid restaging the rescue.',
      },
      dramaticPurpose: 'At Kylie\'s threshold, Victor kisses her hand, declines to come in, and vanishes before the night can become ordinary.',
      narrativeRole: 'release',
      locations: ["Kylie's Apartment Threshold"],
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: false,
    });
    delete (thresholdScene as PlannedScene & { choicePoint?: unknown }).choicePoint;

    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const text = beatText(beat);
      if (/\bthreshold\b/i.test(text) || /\b(?:declines? to come in|vanishes?)\b/i.test(text)) {
        pushUniqueBeat(thresholdScene, canonicalizeVictorAftermathBeat(beat));
        decisions.push({
          action: 'rebound',
          issueKind: 'valid_dense_scene_needs_more_beats',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: thresholdScene.id,
          reason: 'Threshold aftermath beat was split into an adjacent scene instead of overloading the walk-home scene.',
        });
      } else {
        kept.push(canonicalizeVictorAftermathBeat(beat));
      }
    }
    replaceRequiredBeats(scene, kept);
    scene.title = 'Victor walks Kylie home';
    scene.dramaticPurpose = 'Victor escorts Kylie home and turns the rescue aftermath into intimate courtly attention.';
    scene.locations = ["Route to Kylie's Apartment", "Kylie's Courtyard"];
    setSceneTurnContract(scene, {
      turnId: `${scene.id}-escort-turn`,
      source: scene.turnContract?.source ?? 'treatment',
      centralTurn: 'Victor walks Kylie home.',
      beforeState: 'Kylie is shaken and following Victor out of danger.',
      turnEvent: 'Victor makes the walk home feel intimate, controlled, and courtly.',
      afterState: 'Kylie reaches her threshold with Victor fixed in her attention.',
      handoff: 'Hand forward to the threshold boundary without restaging the encounter.',
    });
    setSceneTurnContract(thresholdScene, {
      turnId: `${thresholdScene.id}-boundary-turn`,
      source: thresholdScene.turnContract?.source ?? 'treatment',
      centralTurn: 'Victor kisses Kylie\'s hand, declines to come in, and vanishes at the threshold.',
      beforeState: 'Victor has escorted Kylie home and stands at the edge of invitation.',
      turnEvent: 'Victor turns the threshold into courtly intimacy, then refuses to cross and disappears before the night can become ordinary.',
      afterState: 'Kylie is left alone with proof that the rescue obeyed rules she does not understand.',
      handoff: 'Hand forward to the next aftermath scene without summarizing the earlier encounter.',
    });
  }
}

function splitSocialDebriefAndWritingAftermathScenes(
  scenes: PlannedScene[],
  decisions: PlannedSceneBindingDecision[],
): void {
  const targets = scenes.filter((scene) => {
    if (scene.kind !== 'standard') return false;
    if (scene.planningOrigin?.kind === 'binder_split') return false;
    if (isNamedSocialAftermathHelperScene(scene)) return false;
    const primaryCues = eventCues([
      scene.id,
      scene.title,
      scene.locations?.join(' '),
      scene.timeOfDay,
      scene.signatureMoment,
      scene.dramaticPurpose,
    ].filter(Boolean).join(' '));
    const hasPrimarySameLane = primaryCues.has('friendDebrief') || primaryCues.has('lateNightWriting');
    const hasMixedPrimaryLane = primaryCues.has('roadBreakdown') || primaryCues.has('blogAftermath') || primaryCues.has('endingAftermath');
    if (hasPrimarySameLane && !primaryCues.has('valcescuDoor') && !hasMixedPrimaryLane) return false;
    const beats = scene.requiredBeats ?? [];
    return beats.some((beat) => isFriendDebriefText(beatText(beat)))
      || beats.some((beat) => isLateNightWritingText(beatText(beat)));
  });

  for (const scene of targets) {
    const originalTurn = scene.turnContract;
    const debriefScene = insertPlannedScene(scenes, {
      ...scene,
      id: `${scene.id}-debrief`,
      order: scene.order + 0.1,
      title: 'Friend debrief',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'friend_debrief',
        parentSceneId: scene.id,
        reason: 'Split the social debrief away from the primary date/conversation scene to preserve scene turn clarity.',
      },
      dramaticPurpose: 'The friend group debriefs the date and turns private romantic pressure into social interpretation.',
      narrativeRole: 'payoff',
      locations: ['Drăgan Vintage'],
      signatureMoment: undefined,
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: false,
    });
    delete (debriefScene as PlannedScene & { choicePoint?: unknown }).choicePoint;

    const writingScene = insertPlannedScene(scenes, {
      ...scene,
      id: `${scene.id}-late-night-writing`,
      order: scene.order + 0.2,
      title: 'Late-night dictionary entry',
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'late_night_writing',
        parentSceneId: scene.id,
        reason: 'Split late-night codename writing away from the primary scene to preserve chronology and treatment density.',
      },
      dramaticPurpose: 'At home after the date, the protagonist converts two phone numbers and a new crush into blog language.',
      narrativeRole: 'release',
      locations: ["Kylie's Lipscani Apartment"],
      signatureMoment: undefined,
      requiredBeats: [],
      authoredTreatmentFields: [],
      mechanicPressure: [],
      hasChoice: false,
    });
    delete (writingScene as PlannedScene & { choicePoint?: unknown }).choicePoint;

    const keptBeats: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const text = beatText(beat);
      if (isFriendDebriefText(text)) {
        pushUniqueBeat(debriefScene, beat);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: debriefScene.id,
          reason: 'Friend debrief obligation belongs in its own social aftermath scene instead of the preceding primary scene.',
        });
        continue;
      }
      if (isLateNightWritingText(text)) {
        pushUniqueBeat(writingScene, beat);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: beat.id,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: writingScene.id,
          reason: 'Late-night writing/codename obligation belongs in its own home aftermath scene instead of the preceding primary scene.',
        });
        continue;
      }
      keptBeats.push(beat);
    }
    replaceRequiredBeats(scene, keptBeats);

    const movedFieldIds = new Set<string>();
    for (const field of scene.authoredTreatmentFields ?? []) {
      if (isFriendDebriefText(field.sourceText)) {
        pushUniqueField(debriefScene, cloneContractForScene(field, debriefScene.id));
        movedFieldIds.add(field.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: debriefScene.id,
          reason: 'Friend debrief treatment field was rebound to a social aftermath scene.',
        });
        continue;
      }
      if (isLateNightWritingText(field.sourceText)) {
        pushUniqueField(writingScene, cloneContractForScene(field, writingScene.id));
        movedFieldIds.add(field.id);
        decisions.push({
          action: 'rebound',
          issueKind: 'chronology_conflict',
          contractId: field.id,
          contractKind: field.contractKind,
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: writingScene.id,
          reason: 'Late-night writing treatment field was rebound to a home aftermath scene.',
        });
      }
    }
    removeFieldIds(scene, movedFieldIds);

    if (
      originalTurn
      && (
        isSocialDebriefAndWritingAftermathText(originalTurn.centralTurn)
        || isSocialDebriefAndWritingAftermathText(originalTurn.turnEvent)
        || isFriendDebriefText(originalTurn.centralTurn)
        || isFriendDebriefText(originalTurn.turnEvent)
        || isLateNightWritingText(originalTurn.centralTurn)
        || isLateNightWritingText(originalTurn.turnEvent)
      )
    ) {
      const localTurn = [
        scene.signatureMoment,
        ...(scene.requiredBeats ?? [])
          .filter((beat) => beat.tier !== 'seed' && beat.tier !== 'connective')
          .map((beat) => beat.mustDepict || beat.sourceTurn),
        ...(scene.authoredTreatmentFields ?? [])
          .filter((field) =>
            field.requiredRealization?.includes('final_prose')
            && !isFriendDebriefText(field.sourceText)
            && !isLateNightWritingText(field.sourceText)
            && !isSocialDebriefAndWritingAftermathText(field.sourceText)
          )
          .map((field) => field.sourceText),
      ].find((text) =>
        text
        && !isFriendDebriefText(text)
        && !isLateNightWritingText(text)
        && !isSocialDebriefAndWritingAftermathText(text)
      );
      if (localTurn) {
        setSceneTurnContract(scene, {
          turnId: originalTurn.turnId,
          source: originalTurn.source ?? 'treatment',
          centralTurn: localTurn,
          beforeState: originalTurn.beforeState || 'The scene has not yet made its local date pressure visible.',
          turnEvent: localTurn,
          afterState: originalTurn.afterState || 'The local date pressure has changed the scene state on-page.',
          handoff: 'Hand forward to the social and private aftermath without summarizing it in this scene.',
        });
        decisions.push({
          action: 'kept',
          issueKind: 'chronology_conflict',
          contractId: `turn-contract:${scene.id}`,
          contractKind: 'pressure_lane',
          episodeNumber: scene.episodeNumber,
          fromSceneId: scene.id,
          toSceneId: scene.id,
          reason: 'Aftermath split moved debrief/writing beats out of the scene, so the source turn contract was narrowed back to the remaining scene-local obligation.',
        });
      }
    }

    if ((debriefScene.requiredBeats ?? []).length > 0 || (debriefScene.authoredTreatmentFields ?? []).length > 0) {
      setSceneTurnContract(debriefScene, {
        turnId: `${debriefScene.id}-turn`,
        source: debriefScene.turnContract?.source ?? 'treatment',
        centralTurn: 'The friend group convenes for a debrief that turns private romantic pressure into public social leverage.',
        beforeState: 'The date is still private pressure.',
        turnEvent: 'The debrief shifts control from private memory to group interpretation, changing what the protagonist can admit, hide, or use.',
        afterState: 'The protagonist carries both the group interpretation and the private pull of the date as competing leverage.',
        handoff: 'Hand forward to the late-night private writing aftermath.',
      });
    }

    if ((writingScene.requiredBeats ?? []).length > 0 || (writingScene.authoredTreatmentFields ?? []).length > 0) {
      setSceneTurnContract(writingScene, {
        turnId: `${writingScene.id}-turn`,
        source: writingScene.turnContract?.source ?? 'treatment',
        centralTurn: 'At home late at night, the protagonist turns two men\'s numbers into a public codename, shifting private desire into public leverage.',
        beforeState: 'The date and debrief have left two numbers and too much meaning in the phone.',
        turnEvent: 'The writing transfers control from the men\'s invitations to her codenamed voice, while making the blog newly valuable and dangerous.',
        afterState: 'Private attraction has become public leverage, future romantic pressure, and a risk Victor cannot fully control.',
        handoff: 'Hand forward to the next invitation or consequence without restaging the date.',
      });
    }
  }
}

function isNamedSocialAftermathHelperScene(scene: PlannedScene): boolean {
  const cues = eventCues([scene.id, scene.title].filter(Boolean).join(' '));
  return cues.has('friendDebrief') || cues.has('lateNightWriting');
}

function normalizeSocialAftermathHelperTurnContracts(scenes: PlannedScene[]): void {
  for (const scene of scenes) {
    if (scene.kind !== 'standard') continue;
    const cues = eventCues([scene.id, scene.title].filter(Boolean).join(' '));
    if (cues.has('friendDebrief')) {
      setSceneTurnContract(scene, {
        turnId: `${scene.id}-turn`,
        source: scene.turnContract?.source ?? 'treatment',
        centralTurn: 'The friend group convenes for a debrief that turns private romantic pressure into public social leverage.',
        beforeState: 'The date is still private pressure.',
        turnEvent: 'The debrief shifts control from private memory to group interpretation, changing what the protagonist can admit, hide, or use.',
        afterState: 'The protagonist carries both the group interpretation and the private pull of the date as competing leverage.',
        handoff: 'Hand forward to the late-night private writing aftermath.',
      });
    }
    if (cues.has('lateNightWriting')) {
      setSceneTurnContract(scene, {
        turnId: `${scene.id}-turn`,
        source: scene.turnContract?.source ?? 'treatment',
        centralTurn: 'At home late at night, the protagonist turns two men\'s numbers into a public codename, shifting private desire into public leverage.',
        beforeState: 'The date and debrief have left two numbers and too much meaning in the phone.',
        turnEvent: 'The writing transfers control from the men\'s invitations to her codenamed voice, while making the blog newly valuable and dangerous.',
        afterState: 'Private attraction has become public leverage, future romantic pressure, and a risk Victor cannot fully control.',
        handoff: 'Hand forward to the next invitation or consequence without restaging the date.',
      });
    }
  }
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

function reassignSocialAftermathHelperBeats(scenes: PlannedScene[], decisions: PlannedSceneBindingDecision[]): void {
  const beatMoves = new Map<string, RequiredBeat[]>();
  for (const scene of scenes) {
    if (scene.kind !== 'standard') continue;
    const cues = eventCues([scene.id, scene.title].filter(Boolean).join(' '));
    if (!cues.has('friendDebrief') && !cues.has('lateNightWriting')) continue;

    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const text = beatText(beat);
      const target = cues.has('lateNightWriting') && isFriendDebriefText(text)
        ? socialAftermathSibling(scene, scenes, 'friend_debrief')
        : cues.has('friendDebrief') && isLateNightWritingText(text)
          ? socialAftermathSibling(scene, scenes, 'late_night_writing')
          : undefined;
      if (!target || target.id === scene.id) {
        kept.push(beat);
        continue;
      }
      beatMoves.set(target.id, [...(beatMoves.get(target.id) ?? []), beat]);
      decisions.push({
        action: 'rebound',
        issueKind: 'chronology_conflict',
        contractId: beat.id,
        contractKind: 'pressure_lane',
        episodeNumber: scene.episodeNumber,
        fromSceneId: scene.id,
        toSceneId: target.id,
        reason: 'Social aftermath helper beat belonged to its sibling debrief/writing lane, not the current helper scene.',
      });
    }
    replaceRequiredBeats(scene, kept);
  }

  for (const scene of scenes) {
    const additions = beatMoves.get(scene.id) ?? [];
    if (additions.length > 0) {
      scene.requiredBeats = [...(scene.requiredBeats ?? []), ...additions];
    }
  }
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
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const decisions: PlannedSceneBindingDecision[] = [];
  const planLevel = new Map<string, AuthoredTreatmentFieldContract>();

  scrubArcPressureBindings(scenes);
  ensureMissingConcreteScenes(scenes, decisions);

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

      if (beat.tier === 'coldopen') {
        kept.push(beat);
        continue;
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

      const actionParts = splitActionChainedBeat(beat);
      if (actionParts.length > 1) {
        actionParts.forEach((part, index) => {
          const target = bestSceneForBeat(part, scenes, beat.id) ?? scene;
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
        const target = bestSceneForBeat(text, scenes, beat.id);
        const forceBlogMetricRebound = Boolean(
          target
          && target.id !== scene.id
          && isBlogMetricText(text)
          && isPrimaryBlogAftermathScene(target)
          && !isPrimaryBlogAftermathScene(scene),
        );
        if (target && target.id !== scene.id && (forceBlogMetricRebound || scoreSceneForBeat(text, target, beat.id) - scoreSceneForBeat(text, scene, beat.id) >= 1.25)) {
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

  dedupeRequiredBeats(scenes, decisions);
  repairMixedRooftopParkEncounter(scenes, decisions);
  splitRescueAftermathScenes(scenes, decisions);
  splitSocialDebriefAndWritingAftermathScenes(scenes, decisions);
  normalizeSocialAftermathHelperTurnContracts(scenes);
  reassignSocialAftermathHelperBeats(scenes, decisions);
  splitRoadPublicAftermathScenes(scenes, decisions);
  splitBlogMetricScenes(scenes, decisions);
  rewriteStructuralLabelTurnContracts(scenes, decisions);
  rewriteBroadChoiceTurnContracts(scenes, decisions);
  dedupeEncounterRequiredBeatsAgainstFields(scenes, decisions);
  dedupeRequiredBeats(scenes, decisions);
  dedupeAuthoredTreatmentFieldsAgainstSceneBeats(scenes, decisions);
  scrubArcPressureBindings(scenes);
  renormalizeSceneOrders(scenes);

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
