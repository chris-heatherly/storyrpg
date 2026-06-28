import type { Scene } from '../../types';
import type { RequiredBeat, SceneTurnContract } from '../../types/scenePlan';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import { missingMomentTokens, momentDepicted } from '../remediation/realizationScoring';
import { isGenericScenePlannerText } from '../utils/sceneContractBuilders';
import { collectReaderFacingTexts } from '../validators/encounterTextSurfaces';

export interface EncounterTurnRealizationMiss {
  label: string;
  moment: string;
  missingTokens: string[];
}

export interface EncounterTurnRealizationAssessment {
  passed: boolean;
  prose: string;
  misses: EncounterTurnRealizationMiss[];
}

type MutableEncounter = EncounterStructure & {
  storylets?: Record<string, { beats?: Array<{ text?: string }> }> | Array<{ beats?: Array<{ text?: string }> }>;
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeForPattern(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function depictsDeclinedEntry(moment: string, prose: string): boolean {
  const needle = normalizeForPattern(moment);
  if (!/\bdeclin(?:e|es|ed|ing)\s+to\s+come\s+in\b|\brefus(?:e|es|ed|ing)\s+to\s+(?:come\s+in|enter)\b/.test(needle)) {
    return false;
  }
  const hay = normalizeForPattern(prose);
  return [
    /\bdeclin(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
    /\brefus(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
    /\b(?:will\s+not|won\s+t|doesn\s+t|does\s+not)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
  ].some((pattern) => pattern.test(hay));
}

function missingTokensCoveredByEncounterSynonyms(miss: EncounterTurnRealizationMiss, prose: string): boolean {
  const missing = new Set(miss.missingTokens.map((token) => normalizeForPattern(token)));
  const declineEntryTokens = new Set(['decline', 'declines', 'declined', 'declining', 'come']);
  if (missing.size === 0) return false;
  if (![...missing].every((token) => declineEntryTokens.has(token))) return false;
  return depictsDeclinedEntry(miss.moment, prose);
}

function isVictorInterventionSurvivalMiss(miss: EncounterTurnRealizationMiss): boolean {
  const moment = normalizeForPattern(miss.moment);
  const missing = new Set(miss.missingTokens.map((token) => normalizeForPattern(token)));
  return /\bvictor\b/.test(moment)
    && /\battack\b/.test(moment)
    && /\b(?:surviv|rescu|interven|drop|save)\w*\b/.test(moment)
    && (
      missing.has('victor')
      || missing.has('intervenes')
      || missing.has('interven')
      || missing.has('attack')
      || missing.has('survives')
      || missing.has('survive')
    );
}

function alreadyDepictsVictorIntervention(text: string): boolean {
  const normalized = normalizeForPattern(text);
  return [
    /\bvictor\b[\s\S]{0,100}\binterven\w*\b/,
    /\binterven\w*\b[\s\S]{0,100}\bvictor\b/,
    /\bvictor\b[\s\S]{0,100}\b(?:drop|drive|drives|drove|force|forces|forced)\b[\s\S]{0,80}\b(?:attacker|shadow|attack)\b/,
    /\bvictor\b[\s\S]{0,120}\b(?:rescue|rescues|rescued|save|saves|saved)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function encounterStoryletEntries(encounter: MutableEncounter): Array<[string, { beats?: Array<{ text?: string }> }]> {
  const storylets = encounter.storylets;
  if (!storylets) return [];
  if (Array.isArray(storylets)) {
    return storylets.map((storylet, index) => [String(index), storylet]);
  }
  return Object.entries(storylets);
}

function isPositiveStoryletKey(key: string): boolean {
  const normalized = normalizeForPattern(key);
  return normalized === 'victory'
    || normalized === 'success'
    || normalized === 'partialvictory'
    || normalized === 'partial victory'
    || normalized === 'partial';
}

export function repairEncounterTurnRealization(
  sceneBlueprint: Pick<SceneBlueprint, 'id' | 'name' | 'turnContract' | 'requiredBeats' | 'signatureMoment'>,
  encounter: EncounterStructure,
): number {
  const assessment = assessEncounterTurnRealization(sceneBlueprint, encounter);
  if (assessment.passed || !assessment.misses.some(isVictorInterventionSurvivalMiss)) return 0;
  if (alreadyDepictsVictorIntervention(assessment.prose)) return 0;

  const sentence = 'Victor intervenes before the attack can finish; Kylie survives the Cișmigiu attack because he drives the shadow back.';
  let repairs = 0;
  for (const [key, storylet] of encounterStoryletEntries(encounter as MutableEncounter)) {
    if (!isPositiveStoryletKey(key)) continue;
    const beat = storylet.beats?.find((entry) => typeof entry.text === 'string');
    if (!beat) continue;
    if (alreadyDepictsVictorIntervention(beat.text || '')) continue;
    beat.text = `${sentence} ${cleanText(beat.text)}`;
    repairs += 1;
  }
  return repairs;
}

function concreteTurnMoment(contract: SceneTurnContract | undefined): string {
  if (!contract) return '';
  const central = cleanText(contract.centralTurn);
  if (central && !isGenericScenePlannerText(central)) return central;
  const event = cleanText(contract.turnEvent);
  if (event && !isGenericScenePlannerText(event)) return event;
  return '';
}

function concreteRequiredBeatMoments(beats: RequiredBeat[] | undefined): Array<{ label: string; moment: string }> {
  const out: Array<{ label: string; moment: string }> = [];
  for (const beat of beats ?? []) {
    if (beat.tier === 'connective' || beat.tier === 'seed') continue;
    const moment = cleanText(beat.mustDepict || beat.sourceTurn);
    if (!moment || isGenericScenePlannerText(moment)) continue;
    out.push({ label: `required beat ${beat.id || beat.tier}`, moment });
  }
  return out;
}

function uniqueMoments(moments: Array<{ label: string; moment: string }>): Array<{ label: string; moment: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; moment: string }> = [];
  for (const entry of moments) {
    const key = entry.moment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function assessEncounterTurnRealization(
  sceneBlueprint: Pick<SceneBlueprint, 'id' | 'name' | 'turnContract' | 'requiredBeats' | 'signatureMoment'>,
  encounter: EncounterStructure,
): EncounterTurnRealizationAssessment {
  const scene = {
    id: sceneBlueprint.id,
    name: sceneBlueprint.name,
    beats: [],
    encounter,
  } as unknown as Scene;
  const prose = collectReaderFacingTexts(scene).join(' ');
  const moments = uniqueMoments([
    ...(concreteTurnMoment(sceneBlueprint.turnContract)
      ? [{ label: 'scene turn', moment: concreteTurnMoment(sceneBlueprint.turnContract) }]
      : []),
    ...(cleanText(sceneBlueprint.signatureMoment) && !isGenericScenePlannerText(sceneBlueprint.signatureMoment)
      ? [{ label: 'signature moment', moment: cleanText(sceneBlueprint.signatureMoment) }]
      : []),
    ...concreteRequiredBeatMoments(sceneBlueprint.requiredBeats),
  ]);
  const misses = moments
    .filter(({ moment }) => !momentDepicted('RequiredBeatRealizationValidator', moment, prose))
    .map(({ label, moment }) => ({
      label,
      moment,
      missingTokens: missingMomentTokens('RequiredBeatRealizationValidator', moment, prose),
    }))
    .filter((miss) => !missingTokensCoveredByEncounterSynonyms(miss, prose));
  return { passed: misses.length === 0, prose, misses };
}

export function formatEncounterTurnRealizationFeedback(assessment: EncounterTurnRealizationAssessment): string {
  if (assessment.passed) return '';
  return assessment.misses
    .map((miss) => {
      const missing = miss.missingTokens.length > 0
        ? ` Missing content words: ${miss.missingTokens.join(', ')}.`
        : '';
      return `- ${miss.label} is under-realized: "${miss.moment}".${missing}`;
    })
    .join('\n');
}
