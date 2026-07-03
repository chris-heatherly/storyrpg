import type { Story } from '../../types/story';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { ContractRepairReport } from './finalContractRepair';
import { evaluateMomentRealization, normalizeRealizationText } from './realizationEvaluator';
import { classifyTreatmentObligation } from '../validators/treatmentObligationClassifier';
import { isGateEnabled } from './gateDefaults';

export type RepairDirectiveKind =
  | 'deterministic_cleanup'
  | 'same_scene_retry'
  | 'scene_cluster_rewrite'
  | 'blueprint_rebalance'
  | 'episode_replan'
  | 'partial_scope_defer'
  | 'diagnostic_stop';

export interface RepairDirective {
  kind: RepairDirectiveKind;
  validator?: string;
  episodeNumber?: number;
  sceneIds: string[];
  reason: string;
  attemptBudget: number;
  qualityFloor: {
    overall: number;
    voice: number;
    stakes: number;
    rejectDrop: number;
  };
  unsafeForProsePatch: boolean;
}

export interface RepairHistoryEntry {
  attempts: number;
  directivesUsed: RepairDirectiveKind[];
  qualityDeltas: number[];
  finalDisposition?: RepairDirectiveKind | 'passed';
}

export type RepairHistory = Record<string, RepairHistoryEntry>;

export interface TreatmentDensityObligation {
  kind: string;
  label: string;
  hardUnits: number;
  totalUnits: number;
  source?: string;
}

export interface TreatmentDensityThreshold {
  hardUnits: number;
  totalUnits: number;
  profile: 'standard' | 'encounter' | 'opening';
}

export interface TreatmentDensityReport {
  episodeNumber?: number;
  sceneId: string;
  hardUnits: number;
  totalUnits: number;
  threshold: TreatmentDensityThreshold;
  obligations: TreatmentDensityObligation[];
  overloaded: boolean;
  overloadReasons: string[];
  explicitTimeJumpCount: number;
  recommendedDirective: RepairDirectiveKind;
}

type RepairIssue = ContractRepairReport['blockingIssues'][number];
type ClassifierSeverity = 'error' | 'warning' | 'info' | 'suggestion';

interface StorySceneLike {
  id?: string;
  name?: string;
  beats?: unknown[];
  encounter?: unknown;
  requiredBeats?: SceneBlueprint['requiredBeats'];
  signatureMoment?: string;
  turnContract?: SceneBlueprint['turnContract'];
  authoredTreatmentFields?: SceneBlueprint['authoredTreatmentFields'];
  storyCircleBeatContracts?: SceneBlueprint['storyCircleBeatContracts'];
  choicePoint?: SceneBlueprint['choicePoint'];
  sceneConstructionProfile?: SceneBlueprint['sceneConstructionProfile'];
}

export interface GateRepairRouterContext {
  story?: Story;
  densityReports?: TreatmentDensityReport[];
  generatedThroughEpisode?: number;
  repairHistory?: RepairHistory;
}

const QUALITY_FLOOR = {
  overall: 90,
  voice: 85,
  stakes: 85,
  rejectDrop: 5,
};

const HARD_VALIDATOR_NAMES = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
  'EncounterAnchorContentValidator',
  'TreatmentEventLedgerValidator',
  'ReferencedEventPresenceValidator',
  'CharacterIntroductionValidator',
]);

const SAME_SCENE_STYLE_VALIDATORS = new Set([
  'SentenceOpenerVarietyValidator',
  'EncounterProseIntegrityValidator',
  'NarrativeMechanicPressureValidator',
]);

const CLUSTER_DEFAULT_VALIDATORS = new Set([
  'SceneTurnRealizationValidator',
  'SceneTransitionContinuityValidator',
]);

export function repairHistoryKey(issue: RepairIssue): string {
  const moment = extractQuotedMoment(issue.message ?? '') || issue.message || '';
  return [
    issue.validator ?? '',
    issue.episodeNumber ?? '',
    issue.sceneId ?? '',
    moment,
  ].join('::');
}

export function hasTimelineCue(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:night|morning|dawn|dusk|sunset|midnight|noon|weekend|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hour|day|week|month|year|later|earlier|before|after|next|previous|second|third|fourth|1\s*a\.?m\.?|2\s*a\.?m\.?|3\s*a\.?m\.?|[0-9]+\s*(?:am|pm|a\.m\.|p\.m\.))\b/i
    .test(value);
}

export function hasCrossSceneCue(value: string | undefined): boolean {
  if (!value) return false;
  return /\b(?:earlier|later|previous|next|before|after|return(?:s|ed)?|again|back|meanwhile|elsewhere|the following|last time|from the prior|in the prior|leaving|arriv(?:e|es|ed|ing)|handoff|transition)\b/i
    .test(value);
}

function extractQuotedMoment(value: string): string | undefined {
  const match = /"([^"]{16,})"/.exec(value);
  return match?.[1];
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return [
    record.mustDepict,
    record.sourceTurn,
    record.sourceText,
    record.centralTurn,
    record.turnEvent,
    record.description,
    record.label,
    record.fieldName,
  ].filter((part): part is string => typeof part === 'string').join(' ');
}

function classifierSeverity(value: unknown): ClassifierSeverity | undefined {
  return value === 'error' || value === 'warning' || value === 'info' || value === 'suggestion'
    ? value
    : undefined;
}

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isChoiceContingentSeed(value: string): boolean {
  return /\b(did or did(?:n['’]t| not)|accept(?:ed|s)? or refus(?:ed|es)?|refus(?:ed|es)? or accept(?:ed|s)?|whether|depending on|chosen path|choice path|route|residue|plant(?:ed|s)?|paid off|payoff|confirmed|later|future|INFO-[A-Z])\b/i
    .test(value);
}

function isConcreteSeedObligation(value: string): boolean {
  if (isChoiceContingentSeed(value)) return false;
  const words = normalizedWords(value);
  if (words.length < 5) return false;
  const hasSpatialAnchor = words.some((word) => [
    'in', 'inside', 'outside', 'on', 'under', 'behind', 'beside', 'near', 'across', 'through', 'into', 'from', 'at',
  ].includes(word));
  const hasPhysicalSignal = words.some((word) => [
    'body', 'blood', 'car', 'card', 'chain', 'chair', 'courtyard', 'door', 'eyes', 'face', 'floor', 'glass', 'hand',
    'key', 'letter', 'light', 'mirror', 'phone', 'pocket', 'room', 'shadow', 'shoe', 'stone', 'table', 'voice',
    'wall', 'window',
  ].includes(word));
  return hasSpatialAnchor && hasPhysicalSignal;
}

function substantiallyDuplicates(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (left.length === 0 || right.length === 0) return false;
  const smaller = left.length <= right.length ? left : right;
  const larger = new Set(left.length <= right.length ? right : left);
  const overlap = smaller.filter((word) => larger.has(word)).length / smaller.length;
  return overlap >= 0.72;
}

function pushObligation(
  obligations: TreatmentDensityObligation[],
  kind: string,
  label: string | undefined,
  hardUnits: number,
  totalUnits: number,
  source?: string,
): void {
  const clean = (label || kind).trim();
  if (!clean) return;
  obligations.push({ kind, label: clean, hardUnits, totalUnits, source });
}

function compiledPrimaryTurnText(scene: StorySceneLike): string | undefined {
  const primaryTurn = scene.sceneConstructionProfile?.primaryTurn;
  if (!primaryTurn?.text) return undefined;
  const turnId = scene.turnContract?.turnId;
  if (!turnId) return primaryTurn.text;
  const sourceIds = primaryTurn.sourceContractIds ?? [];
  return primaryTurn.id === turnId || sourceIds.includes(turnId)
    ? primaryTurn.text
    : undefined;
}

function countExplicitTimeCuesInTexts(texts: string[]): number {
  const joined = texts.join(' ')
    .toLowerCase()
    .replace(/\bdating after dusk\b/g, 'dating after title')
    .replace(/\bdusk club\b/g, 'club')
    .replace(/\bafter dusk\b/g, 'after title');
  const matches = joined.match(/\b(?:night\s+(?:one|two|three|four|[0-9]+)|[0-9]+\s*(?:am|pm|a\.m\.|p\.m\.)|morning|dawn|dusk|sunset|evening|later|earlier|next\s+(?:day|morning|night)|previous\s+(?:day|night))\b/g);
  const normalized = (matches ?? [])
    .filter((cue) => cue !== 'later' && cue !== 'earlier')
    .map((cue) => {
      if (cue === 'dusk' || cue === 'sunset' || cue === 'evening') return 'evening';
      if (cue === 'morning' || cue === 'next morning') return 'morning';
      return cue;
    });
  const unique = new Set(normalized);
  const ordinalNightCues = new Set(normalized.filter((cue) => /^night\s+(?:one|two|three|four|[0-9]+)$/.test(cue)));
  if (ordinalNightCues.size === 1 && unique.has('evening')) {
    unique.delete('evening');
  }
  for (const cue of normalized) {
    const match = /^([0-9]+)\s*(am|pm|a\.m\.|p\.m\.)$/.exec(cue);
    if (!match) continue;
    const hour = Number(match[1]);
    const meridiem = match[2].replace(/\./g, '');
    if (!Number.isFinite(hour)) continue;
    if (meridiem === 'pm' && (hour >= 5 || hour === 12)) unique.delete('evening');
    if (meridiem === 'am' && hour >= 5 && hour <= 11) unique.delete('morning');
  }
  return unique.size;
}

function countExplicitTimeJumps(scene: StorySceneLike): number {
  const texts: string[] = [
    scene.name,
    ...(scene.requiredBeats ?? [])
      .filter((beat) => beat.tier !== 'seed' || isConcreteSeedObligation(textOf(beat)))
      .map(textOf),
    scene.signatureMoment,
    compiledPrimaryTurnText(scene) || textOf(scene.turnContract),
    ...(scene.authoredTreatmentFields ?? [])
      .filter((field) =>
        (field.requiredRealization?.includes('final_prose') ?? true)
        && field.contractKind !== 'encounter_anchor'
        && field.contractKind !== 'encounter_conflict'
        && field.contractKind !== 'encounter_buildup'
      )
      .map(textOf),
  ].filter((part): part is string => Boolean(part));
  return countExplicitTimeCuesInTexts(texts);
}

function hasSingleObligationTimeJump(report: TreatmentDensityReport): boolean {
  return report.obligations.some((obligation) =>
    countExplicitTimeCuesInTexts([obligation.label]) >= 2
  );
}

function textPartsOf(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textPartsOf);
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    record.mustDepict,
    record.sourceTurn,
    record.sourceText,
    record.centralTurn,
    record.turnEvent,
    record.description,
    record.centralConflict,
    record.fieldName,
  ].flatMap(textPartsOf);
}

function sceneProseParts(scene: StorySceneLike | undefined): string[] {
  if (!scene) return [];
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.trim()) parts.push(value);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'dialogue', 'description', 'summary', 'narration']) {
      if (typeof record[key] === 'string') visit(record[key]);
    }
    for (const key of ['textVariants', 'beats', 'storylets', 'phases']) {
      if (Array.isArray(record[key])) {
        for (const child of record[key] as unknown[]) visit(child);
      }
    }
  };
  visit({ beats: scene.beats, encounter: scene.encounter });
  return parts;
}

function findStoryScene(story: Story | undefined, sceneId: string | undefined, episodeNumber?: number): StorySceneLike | undefined {
  if (!story || !sceneId) return undefined;
  for (const episode of (story as { episodes?: Array<{ number?: number; scenes?: StorySceneLike[] }> }).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    const scene = episode.scenes?.find((candidate) => candidate.id === sceneId);
    if (scene) return scene;
  }
  return undefined;
}

function isCompactTemporalOrCountToken(token: string): boolean {
  const normalized = normalizeRealizationText(token);
  return /^(?:\d+(?:am|pm)?|am|pm|a\.?m\.?|p\.?m\.?|noon|midnight|morning|evening|dawn|dusk|night|day|hour|minute|week|month|year|read|reads|reader|readers|view|views|vote|votes|signature|signatures|follower|followers|count|counts|thousand|million)$/.test(normalized);
}

function isLocalizedTemporalCompletion(
  issue: RepairIssue,
  story: Story | undefined,
): boolean {
  const moment = extractQuotedMoment(issue.message ?? '');
  if (!moment || !hasTimelineCue(moment)) return false;
  const scene = findStoryScene(story, issue.sceneId, issue.episodeNumber);
  const prose = sceneProseParts(scene).join('\n\n');
  if (!prose.trim()) return false;
  const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', moment, prose);
  if (!assessment.depicted) return false;
  const missing = assessment.missingTokens;
  if (missing.length === 0 || missing.length > 4) return false;
  return missing.every(isCompactTemporalOrCountToken);
}

function sceneAlreadyCarriesStructuralBeat(scene: StorySceneLike, contract: unknown): boolean {
  const record = contract as { eventAtoms?: unknown; sourceText?: unknown };
  const atoms = textPartsOf(record.eventAtoms);
  const contractText = textPartsOf(record.sourceText).join(' ');
  const needles = atoms.length > 0 ? atoms : [contractText].filter(Boolean);
  if (needles.length === 0) return false;

  const localText = [
    ...(scene.requiredBeats ?? []).map(textOf),
    scene.signatureMoment,
    textOf(scene.turnContract),
    textOf(scene.encounter),
    ...(scene.authoredTreatmentFields ?? []).map(textOf),
  ].filter(Boolean).join(' ');

  return needles.some((needle) => substantiallyDuplicates(needle, localText));
}

function isBroadEpisodeCircleContract(contract: unknown): boolean {
  const record = contract as { id?: unknown; eventAtoms?: unknown };
  return typeof record.id === 'string'
    && record.id.startsWith('episode-circle-')
    && Array.isArray(record.eventAtoms)
    && record.eventAtoms.length >= 3;
}

function isEncounterScene(scene: StorySceneLike): boolean {
  return Boolean(scene.encounter) || Boolean((scene as { isEncounter?: boolean }).isEncounter) || /^treatment-enc-/i.test(scene.id ?? '');
}

function thresholdForScene(scene: StorySceneLike, sceneIndex?: number): TreatmentDensityThreshold {
  const isEncounter = isEncounterScene(scene);
  const isOpening = sceneIndex === 0 || /s\d+-1$/i.test(scene.id ?? '');
  if (isEncounter) return { hardUnits: 5, totalUnits: 7, profile: 'encounter' };
  if (isOpening) return { hardUnits: 5, totalUnits: 7.5, profile: 'opening' };
  return { hardUnits: 4, totalUnits: 6, profile: 'standard' };
}

function constructionSlotIsActive(slot: string | undefined): boolean {
  return slot === 'primary_turn' || slot === 'must_stage' || slot === 'must_support';
}

function constructionProfileAllows(scene: StorySceneLike, source: string, id: string | undefined): boolean {
  const profile = scene.sceneConstructionProfile;
  if (!profile) return true;
  return profile.obligations.some((item) =>
    item.source === source &&
    (!id || item.id === id) &&
    constructionSlotIsActive(item.slot),
  );
}

function constructionProfileCountsSeparately(scene: StorySceneLike, source: string, id: string | undefined): boolean {
  const profile = scene.sceneConstructionProfile;
  if (!profile) return true;
  const obligation = profile.obligations.find((item) =>
    item.source === source &&
    (!id || item.id === id) &&
    constructionSlotIsActive(item.slot),
  );
  return Boolean(obligation && !obligation.mergedInto);
}

export function analyzeSceneTreatmentDensity(
  scene: StorySceneLike,
  options: { episodeNumber?: number; sceneIndex?: number } = {},
): TreatmentDensityReport {
  const obligations: TreatmentDensityObligation[] = [];

  for (const beat of scene.requiredBeats ?? []) {
    if (!beat || beat.tier === 'connective') continue;
    if (!constructionProfileAllows(scene, 'requiredBeat', beat.id)) continue;
    if (!constructionProfileCountsSeparately(scene, 'requiredBeat', beat.id)) continue;
    const label = beat.mustDepict || beat.sourceTurn || beat.id;
    if (beat.tier === 'seed' && !isConcreteSeedObligation(label)) {
      pushObligation(obligations, 'abstract_or_hidden_seed', label, 0, 0.5, beat.id);
      continue;
    }
    const kind = beat.tier === 'signature'
      ? 'signature_moment'
      : beat.tier === 'seed'
        ? 'concrete_seed'
        : 'authored_required_beat';
    pushObligation(obligations, kind, label, 1, 1, beat.id);
  }

  if (scene.signatureMoment) {
    const alreadyCounted = (scene.requiredBeats ?? []).some((beat) => beat.mustDepict === scene.signatureMoment);
    if (!alreadyCounted && constructionProfileAllows(scene, 'signatureMoment', 'signatureMoment') && constructionProfileCountsSeparately(scene, 'signatureMoment', 'signatureMoment')) {
      pushObligation(obligations, 'signature_moment', scene.signatureMoment, 1, 1);
    }
  }

  if (scene.turnContract && constructionProfileAllows(scene, 'sceneTurn', scene.turnContract.turnId) && constructionProfileCountsSeparately(scene, 'sceneTurn', scene.turnContract.turnId)) {
    const turnLabel = compiledPrimaryTurnText(scene) || scene.turnContract.turnEvent || scene.turnContract.centralTurn;
    const duplicatesRequiredBeat = (scene.requiredBeats ?? []).some((beat) =>
      substantiallyDuplicates(turnLabel, beat.mustDepict || beat.sourceTurn),
    );
    if (!duplicatesRequiredBeat) {
      pushObligation(obligations, 'scene_turn', turnLabel, 1, 1, scene.turnContract.turnId);
    }
  }

  const storyCircleContracts = scene.storyCircleBeatContracts ?? [];
  const additionalStoryCircleUnits = storyCircleContracts.filter((contract) =>
    constructionProfileAllows(scene, 'storyCircle', contract.id) &&
    constructionProfileCountsSeparately(scene, 'storyCircle', contract.id) &&
    !isBroadEpisodeCircleContract(contract) &&
    !sceneAlreadyCarriesStructuralBeat(scene, contract)
  ).length;
  if (additionalStoryCircleUnits > 0) {
    pushObligation(obligations, 'story_circle_structural_beat', `${additionalStoryCircleUnits} Story Circle contract(s)`, 1, 1);
  }

  const encounterFields = (scene.authoredTreatmentFields ?? []).filter((contract) =>
    constructionProfileAllows(scene, 'treatmentField', contract.id) &&
    constructionProfileCountsSeparately(scene, 'treatmentField', contract.id) &&
    (contract.contractKind === 'encounter_anchor' || contract.contractKind === 'encounter_conflict')
  );
  if (encounterFields.length > 0) {
    pushObligation(
      obligations,
      'encounter_anchor',
      encounterFields.map((contract) => contract.sourceText || contract.fieldName).filter(Boolean).join(' | '),
      2,
      2,
      encounterFields.map((contract) => contract.id).join(','),
    );
  }

  for (const contract of scene.authoredTreatmentFields ?? []) {
    if (!constructionProfileAllows(scene, 'treatmentField', contract.id)) continue;
    if (!constructionProfileCountsSeparately(scene, 'treatmentField', contract.id)) continue;
    const finalProse = contract.requiredRealization?.includes('final_prose');
    const encounterField = contract.contractKind === 'encounter_anchor' || contract.contractKind === 'encounter_conflict';
    if (!encounterField && finalProse) {
      pushObligation(obligations, 'treatment_final_prose_field', contract.sourceText || contract.fieldName, 0, 0.5, contract.id);
    }
  }

  const keyBeatText = Array.isArray((scene as { keyBeats?: unknown }).keyBeats)
    ? ((scene as { keyBeats?: unknown[] }).keyBeats ?? []).filter((v): v is string => typeof v === 'string')
    : [];
  for (const [index, keyBeat] of keyBeatText.entries()) {
    if (!constructionProfileAllows(scene, 'keyBeat', `keyBeat:${index}`)) continue;
    if (!constructionProfileCountsSeparately(scene, 'keyBeat', `keyBeat:${index}`)) continue;
    if (/\bintroduc(?:e|es|ed|ing)\b/i.test(keyBeat)) {
      pushObligation(obligations, 'character_first_introduction', keyBeat, 0, 0.5);
    }
  }

  if (scene.choicePoint && !isEncounterScene(scene) && constructionProfileAllows(scene, 'choicePressure', `${scene.id ?? 'scene'}-choice-pressure`)) {
    pushObligation(obligations, 'choice_pressure', scene.choicePoint.description, 1, 1);
  }

  // Construction conflicts poison the density score on purpose (99 units →
  // guaranteed blueprint_rebalance). But they are the SAME enforcement class
  // as the preflight gate: with GATE_SCENE_CONSTRUCTION_PREFLIGHT off, they
  // must not re-abort the run through the density gate instead (observed
  // live: the kill-switched location-cue conflict resurfaced as
  // "101 hard/101 total").
  if (isGateEnabled('GATE_SCENE_CONSTRUCTION_PREFLIGHT')) {
    for (const conflict of scene.sceneConstructionProfile?.conflictDiagnostics ?? []) {
      pushObligation(obligations, 'scene_construction_conflict', conflict, 99, 99);
    }
  }

  const hardUnits = Number(obligations.reduce((sum, item) => sum + item.hardUnits, 0).toFixed(2));
  const totalUnits = Number(obligations.reduce((sum, item) => sum + item.totalUnits, 0).toFixed(2));
  const threshold = thresholdForScene(scene, options.sceneIndex);
  const explicitTimeJumpCount = countExplicitTimeJumps(scene);
  const overloadReasons: string[] = [];
  if (hardUnits > threshold.hardUnits) overloadReasons.push(`hard units ${hardUnits} exceed ${threshold.hardUnits}`);
  if (totalUnits > threshold.totalUnits) overloadReasons.push(`total units ${totalUnits} exceed ${threshold.totalUnits}`);
  if (explicitTimeJumpCount >= 2) overloadReasons.push(`scene has ${explicitTimeJumpCount} explicit time cue(s)`);
  const overloaded = overloadReasons.length > 0;

  return {
    episodeNumber: options.episodeNumber,
    sceneId: scene.id ?? '',
    hardUnits,
    totalUnits,
    threshold,
    obligations,
    overloaded,
    overloadReasons,
    explicitTimeJumpCount,
    recommendedDirective: overloaded ? 'blueprint_rebalance' : 'same_scene_retry',
  };
}

export function analyzeEpisodeTreatmentDensity(
  scenes: StorySceneLike[] | undefined,
  episodeNumber?: number,
): TreatmentDensityReport[] {
  return (scenes ?? []).map((scene, index) => analyzeSceneTreatmentDensity(scene, { episodeNumber, sceneIndex: index }));
}

export function isTreatmentDensityExpandable(report: TreatmentDensityReport): boolean {
  if (!report.overloaded) return true;
  const hardOverage = Math.max(0, report.hardUnits - report.threshold.hardUnits);
  const totalOverage = Math.max(0, report.totalUnits - report.threshold.totalUnits);
  if (hardOverage === 0 && totalOverage === 0) {
    if (report.explicitTimeJumpCount >= 2 && report.threshold.profile !== 'encounter' && report.obligations.length > 0) return false;
    if (report.explicitTimeJumpCount >= 2 && hasSingleObligationTimeJump(report)) return false;
    return report.explicitTimeJumpCount < 3;
  }
  if (report.explicitTimeJumpCount >= 2) return false;
  if (hardOverage === 0 && totalOverage <= 1.5) return true;
  if (report.threshold.profile === 'encounter') return false;

  return hardOverage <= 1 && totalOverage <= 1.5;
}

export function isUnsafeTreatmentDensityReport(report: TreatmentDensityReport): boolean {
  return report.overloaded && !isTreatmentDensityExpandable(report);
}

export function unsafeTreatmentDensityReports(reports: TreatmentDensityReport[]): TreatmentDensityReport[] {
  return reports.filter(isUnsafeTreatmentDensityReport);
}

export function describeTreatmentDensityReport(report: TreatmentDensityReport): string {
  const threshold = `${report.threshold.profile} max ${report.threshold.hardUnits} hard/${report.threshold.totalUnits} total`;
  const reasons = report.overloadReasons.length > 0
    ? report.overloadReasons.join('; ')
    : 'within density thresholds';
  return `${report.sceneId}: ${report.hardUnits} hard/${report.totalUnits} total (${threshold}); ${reasons}`;
}

function directive(
  kind: RepairDirectiveKind,
  issue: RepairIssue,
  reason: string,
  sceneIds: string[] = issue.sceneId ? [issue.sceneId] : [],
): RepairDirective {
  const budgets: Record<RepairDirectiveKind, number> = {
    deterministic_cleanup: 1,
    same_scene_retry: 2,
    scene_cluster_rewrite: 2,
    blueprint_rebalance: 1,
    episode_replan: 1,
    partial_scope_defer: 0,
    diagnostic_stop: 0,
  };
  return {
    kind,
    validator: issue.validator,
    episodeNumber: issue.episodeNumber,
    sceneIds,
    reason,
    attemptBudget: budgets[kind],
    qualityFloor: QUALITY_FLOOR,
    unsafeForProsePatch: !['deterministic_cleanup', 'same_scene_retry'].includes(kind),
  };
}

function isOpeningSceneTreatmentEvent(issue: RepairIssue, issueText: string): boolean {
  const sceneId = (issue.sceneId || '').toLowerCase();
  if (issue.episodeNumber !== undefined && issue.episodeNumber !== 1) return false;
  if (!/^s?1[-_]?1$/.test(sceneId)) return false;
  return /\b(?:arrives?|arrival|unpacking|unpacks?|launching|launches|starts?|opening|settles?|new life|blog)\b/i.test(issueText);
}

export class GateRepairRouter {
  private readonly densityByScene = new Map<string, TreatmentDensityReport>();

  constructor(private readonly context: GateRepairRouterContext = {}) {
    for (const report of context.densityReports ?? []) {
      if (report.sceneId) this.densityByScene.set(report.sceneId, report);
    }
    this.indexStoryDensity(context.story);
  }

  routeIssues(issues: RepairIssue[]): RepairDirective[] {
    return (issues ?? []).map((issue) => this.routeIssue(issue));
  }

  routeIssue(issue: RepairIssue): RepairDirective {
    const validator = issue.validator ?? '';
    const issueText = [issue.message, issue.suggestion, issue.type].filter(Boolean).join(' ');
    const density = issue.sceneId ? this.densityByScene.get(issue.sceneId) : undefined;
    const unsafeDensity = Boolean(density && isUnsafeTreatmentDensityReport(density));
    const hasTimeOrOrderCue = hasTimelineCue(issueText) || hasCrossSceneCue(issueText);

    if (validator === 'ResidueObligationValidator' || validator === 'ObligationLedgerValidator') {
      // ObligationLedgerValidator is the unified ledger's final-contract voice
      // (the flip, fec133ca). Its residue-kind findings must inherit the exact
      // routing the legacy validator had — without this branch they fell to
      // diagnostic_stop, which starves the LLM-repair guard (the same
      // no-router-rule shape as the outcome-stub starvation, 595c8e89).
      if (
        (this.context.generatedThroughEpisode !== undefined
          && issue.episodeNumber !== undefined
          && issue.episodeNumber > this.context.generatedThroughEpisode)
        || /\b(?:future|later episode|outside|not due|partial(?:-|\s*)season|defer)\b/i.test(issueText)
      ) {
        return directive('partial_scope_defer', issue, 'Obligation payoff is outside the generated episode slice.');
      }
      if (/\bresidue obligation\b/i.test(issueText) || issue.type === 'planned_residue_debt') {
        return directive('deterministic_cleanup', issue, 'Residue obligation is due in generated scope and can be handled mechanically first.');
      }
      if (/\btreatment seed\b|\bseed obligation\b/i.test(issueText)) {
        return directive('blueprint_rebalance', issue, 'Seed obligation needs a setFlag consequence wired in its owning episode — consequence architecture, not prose.');
      }
      // Thread/callback debts repair deterministically via the auto-callback
      // realizer (buildObligationPayoffRepairHandler) — flag-gated payoff
      // variants sourced from authored choice metadata, credited on the ledger.
      return directive('deterministic_cleanup', issue, 'Obligation debt is repairable by the deterministic fallback-callback realizer.');
    }

    if (validator === 'ContinuityChecker') {
      if (/\b(?:authored|required|order|timeline|sequence|before|after|night)\b/i.test(issueText)) {
        return directive('blueprint_rebalance', issue, 'Continuity contradiction appears to come from authored beat ordering.');
      }
      return directive('scene_cluster_rewrite', issue, 'Continuity issues must repair local sequence context, not direct prose insertion.');
    }

    if (validator === 'RouteContinuityValidator') {
      if (/\b(?:route_chronology_violation|route_duplicate_event|chronology|duplicate|inverts?|stages?.+after|appears to stage)\b/i.test(issueText)) {
        return directive('blueprint_rebalance', issue, 'Route chronology or duplicate-event ownership must be repaired in the scene graph, not direct prose insertion.');
      }
      if (/\brole_fidelity_violation\b/i.test(issueText)) {
        return directive('scene_cluster_rewrite', issue, 'Named role-fidelity issues need the local scene cluster to preserve cause and aftermath.');
      }
      return directive('diagnostic_stop', issue, 'Route continuity issue has no safe direct prose repair route.');
    }

    if (validator === 'RelationshipArcLedgerValidator') {
      // Label-class findings (unearned friend/trusted/intimate language,
      // custom blocked labels, compressed familiarity) are prose-repairable:
      // the deterministic label handler + a same-scene style rewrite fix them
      // without touching architecture. (Route inherited from the deleted
      // RelationshipPacingValidator at the Pair-B merge completion.)
      if (/\b(?:relationship language|unearned relationship label|old-friend familiarity|private contact|phone\/contact access)\b/i.test(issueText)) {
        return directive('same_scene_retry', issue, 'Unearned relationship label or access language is repairable in this scene\'s prose.');
      }
      if (/\b(?:relationship choice|group-defining player choice|only permits|target(?:s|ed)?\s+\w+|before any player relationship choice|ledger-earned)\b/i.test(issueText)) {
        return directive('episode_replan', issue, 'Relationship arc ledger mismatch requires choice/relationship architecture, not prose-only repair.');
      }
      return directive('blueprint_rebalance', issue, 'Relationship arc ledger issue requires relationship pacing or scene-plan correction.');
    }

    if (validator === 'OutcomeTextQualityValidator') {
      // Choice-level outcome-text findings (stub/echo/duplicate tiers) carry no
      // sceneId, so without this rule they fell through to `diagnostic_stop` —
      // an architecture-class kind that made the LLM-repair guard withhold the
      // dedicated outcome re-author handler from its OWN findings (bite-me
      // 2026-07-03T05-47-21: 6 stub blockers + 1 route blocker ⇒ repairable
      // subset empty ⇒ stubs shipped unrepaired). They are localized,
      // prose-only, and repaired by ChoiceAuthor.reauthorOutcomeTexts.
      return directive('same_scene_retry', issue, 'Outcome-text finding is choice-level and repairable via the focused ChoiceAuthor re-author handler.');
    }

    if (validator === 'EncounterAnchorContentValidator') {
      if (unsafeDensity) return directive('episode_replan', issue, `Encounter scene is overloaded: ${density?.overloadReasons.join('; ')}`);
      if (/\b(?:setup|surrounding|lead[ -]?in|context|before|after|transition)\b/i.test(issueText)) {
        return directive('scene_cluster_rewrite', issue, 'Encounter anchor needs surrounding setup/context repaired with the scene cluster.');
      }
      return directive('same_scene_retry', issue, 'Encounter anchor is localized and can retry the encounter scene prose first.');
    }

    if (validator === 'RequiredBeatRealizationValidator') {
      const obligation = classifyTreatmentObligation({ validator, message: issueText, severity: classifierSeverity(issue.severity) });
      if (!obligation.blocksFinalProse) {
        return directive('partial_scope_defer', issue, obligation.reason);
      }
      if (unsafeDensity) return directive('blueprint_rebalance', issue, `Required beat is assigned to an overloaded scene: ${density?.overloadReasons.join('; ')}`);
      if (hasTimeOrOrderCue && isLocalizedTemporalCompletion(issue, this.context.story)) {
        return directive('same_scene_retry', issue, 'Required beat already lands in-scene; only compact time/count wording is missing.');
      }
      if (hasTimeOrOrderCue) return directive('scene_cluster_rewrite', issue, 'Required beat carries time/order context that is unsafe for one-scene stuffing.');
      return directive('same_scene_retry', issue, 'Required beat is concrete, localized, and under density thresholds.');
    }

    if (validator === 'TreatmentEventLedgerValidator') {
      const obligation = classifyTreatmentObligation({ validator, message: issueText, severity: classifierSeverity(issue.severity) });
      if (!obligation.blocksFinalProse) {
        return directive('partial_scope_defer', issue, obligation.reason);
      }
      if (/\b(?:out[- ]of[- ]scene|wrong scene|assigned elsewhere|another scene|planned scene|not scheduled)\b/i.test(issueText)) {
        return directive('blueprint_rebalance', issue, 'Treatment event appears assigned to the wrong scene.');
      }
      if (!unsafeDensity && isOpeningSceneTreatmentEvent(issue, issueText)) {
        return directive('same_scene_retry', issue, 'Opening treatment event is localized to the first scene and should be repaired in-place.');
      }
      if (!unsafeDensity && !hasTimeOrOrderCue) return directive('same_scene_retry', issue, 'Treatment event is concrete and localized.');
      return directive('scene_cluster_rewrite', issue, unsafeDensity ? `Treatment event scene is overloaded: ${density?.overloadReasons.join('; ')}` : 'Treatment event has sequence context.');
    }

    if (validator === 'TreatmentFieldUtilizationValidator') {
      if (!issue.sceneId) {
        if (
          this.context.generatedThroughEpisode !== undefined
          || /\b(?:partial(?:-|\s*)slice|partial(?:-|\s*)season|future|later|season|every episode|E\d\s*(?:-|through|to|→)|episodes?\s+\d)/i.test(issueText)
        ) {
          return directive('partial_scope_defer', issue, 'Treatment field is broad or outside the generated episode slice.');
        }
        return directive('diagnostic_stop', issue, 'Treatment field has no localized scene target for safe prose repair.');
      }
      if (unsafeDensity) return directive('blueprint_rebalance', issue, `Treatment field sits on overloaded scene: ${density?.overloadReasons.join('; ')}`);
      if (hasTimeOrOrderCue) return directive('scene_cluster_rewrite', issue, 'Treatment field includes time/order cues that need adjacent-scene context.');
      return directive('same_scene_retry', issue, 'Localized treatment field is safe for same-scene retry.');
    }

    if (CLUSTER_DEFAULT_VALIDATORS.has(validator)) {
      if (unsafeDensity) return directive('blueprint_rebalance', issue, `Scene-flow issue sits on overloaded scene: ${density?.overloadReasons.join('; ')}`);
      if (
        validator === 'SceneTurnRealizationValidator'
        && issue.sceneId
        && /\bcarries arc pressure\b/i.test(issueText)
        && (
          /\bauthored arc event on-page\b/i.test(issueText)
          || /\bstage its authored event\b/i.test(issueText)
        )
      ) {
        return directive('same_scene_retry', issue, 'Authored arc-pressure event is localized to the flagged scene.');
      }
      if (
        validator === 'SceneTurnRealizationValidator'
        && issue.sceneId
        && /\bcarries Story Circle\b/i.test(issueText)
        && (
          /\bauthored beat event on-page\b/i.test(issueText)
          || /\bstage the authored Story Circle beat\b/i.test(issueText)
        )
      ) {
        return directive('same_scene_retry', issue, 'Authored Story Circle beat is localized to the flagged scene.');
      }
      if (
        validator === 'SceneTurnRealizationValidator'
        && /\b(?:episode\s+\d+\s+turnout|episode turnout|arc_episode_turnout|cliffhanger|episode ending)\b/i.test(issueText)
      ) {
        return directive('same_scene_retry', issue, 'Episode-turnout scene turn is localized to the ending scene.');
      }
      return directive('scene_cluster_rewrite', issue, 'Scene-flow validators need adjacent-scene context.');
    }

    if (SAME_SCENE_STYLE_VALIDATORS.has(validator)) {
      if (
        validator === 'NarrativeMechanicPressureValidator'
        && /\b(?:terminal generated episode|partial slice|later payoff|future generated episodes?|deferred until the target episode exists)\b/i.test(issueText)
      ) {
        return directive('partial_scope_defer', issue, 'Narrative mechanic pressure payoff is outside the generated episode slice.');
      }
      if (unsafeDensity && HARD_VALIDATOR_NAMES.has(validator)) {
        return directive('blueprint_rebalance', issue, `Validator is localized but scene density is unsafe: ${density?.overloadReasons.join('; ')}`);
      }
      return directive('same_scene_retry', issue, 'Localized prose/craft issue is safe for same-scene retry.');
    }

    if (validator === 'SignatureDevicePresenceValidator' || validator === 'ReferencedEventPresenceValidator' || validator === 'CharacterIntroductionValidator') {
      const obligation = classifyTreatmentObligation({ validator, message: issueText, severity: classifierSeverity(issue.severity) });
      if (validator === 'SignatureDevicePresenceValidator' && !obligation.blocksFinalProse) {
        return directive('partial_scope_defer', issue, obligation.reason);
      }
      if (unsafeDensity) return directive('blueprint_rebalance', issue, `Localized fidelity issue sits on overloaded scene: ${density?.overloadReasons.join('; ')}`);
      if (hasTimeOrOrderCue) return directive('scene_cluster_rewrite', issue, 'Localized fidelity issue includes time/order cues.');
      return directive('same_scene_retry', issue, 'Localized fidelity issue is safe for same-scene retry.');
    }

    if (/mechanic|witness|structural|planning|leak|protagonist|pronoun/i.test(validator + issueText)) {
      return directive('deterministic_cleanup', issue, 'Issue class should run deterministic cleanup before prose repair.');
    }

    return directive('diagnostic_stop', issue, 'No safe repair route is registered for this validator.');
  }

  isSameSceneRetryAllowed(issue: RepairIssue): boolean {
    return this.routeIssue(issue).kind === 'same_scene_retry';
  }

  isSceneClusterRewriteAllowed(issue: RepairIssue): boolean {
    return this.routeIssue(issue).kind === 'scene_cluster_rewrite';
  }

  summarize(issues: RepairIssue[]): Record<RepairDirectiveKind, number> {
    const summary: Record<RepairDirectiveKind, number> = {
      deterministic_cleanup: 0,
      same_scene_retry: 0,
      scene_cluster_rewrite: 0,
      blueprint_rebalance: 0,
      episode_replan: 0,
      partial_scope_defer: 0,
      diagnostic_stop: 0,
    };
    for (const route of this.routeIssues(issues)) summary[route.kind] += 1;
    return summary;
  }

  private indexStoryDensity(story: Story | undefined): void {
    if (!story) return;
    for (const episode of story.episodes ?? []) {
      (episode.scenes ?? []).forEach((scene, index) => {
        const sceneLike = scene as unknown as StorySceneLike;
        if (!sceneLike.id || this.densityByScene.has(sceneLike.id)) return;
        this.densityByScene.set(sceneLike.id, analyzeSceneTreatmentDensity(sceneLike, {
          episodeNumber: episode.number,
          sceneIndex: index,
        }));
      });
    }
  }
}
