import type { Story } from '../../types/story';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { authorFacingInformationMovementText } from '../utils/treatmentFieldContracts';
import type { ContractRepairHandler } from './finalContractRepair';

type MutableRecord = Record<string, unknown>;

const BEAT_METADATA_FIELDS = [
  'visualMoment',
  'primaryAction',
  'emotionalRead',
  'relationshipDynamic',
] as const;

const SCENE_METADATA_FIELDS = [
  'description',
  'geography',
  'dramaticPurpose',
  'dramaticQuestion',
  'narrativeFunction',
] as const;

const PLANNING_PREFIX_PATTERNS: RegExp[] = [
  /^\s*(?:Everything\.\s*)?Then\s+continue\s+into\s+the\s+planned\s+scene\s*:\s*/i,
  /^\s*Escalate\s+the\s+episode\s+pressure\s+through\s+a\s+concrete\s+turn\s*:\s*/i,
  /^\s*Let\s+the\s+fallout\s+settle\s+into\s+the\s+next\s+pressure\s*:\s*/i,
  /^\s*Forward\s+pressure\s*:\s*/i,
];

const OPEN_EPISODE_PREFIX_PATTERN =
  /^\s*Open\s+the\s+episode\s+(?:through|with)\s+(?:its\s+)?(?:immediate\s+)?(?:question|pressure|hook|turn)?\s*:?\s*/i;

function cleanupSentence(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?])\s*([.!?])+/g, '$1')
    .replace(/([.!?]){2,}$/g, '$1')
    .trim();
}

function stripPlanningPrefix(text: string): string {
  let cleaned = text;
  for (const pattern of PLANNING_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.replace(OPEN_EPISODE_PREFIX_PATTERN, '');
  return cleanupSentence(cleaned);
}

function stripTreatmentEchoLabel(text: string): string {
  return text.replace(/^\s*[a-z_]+:treatment[_a-z0-9-]*\s*[—:-]\s*/i, '');
}

function sanitizeLedgerPlanningText(text: string): string | undefined {
  if (!isPlanningRegisterText(text)) return undefined;
  const stripped = stripTreatmentEchoLabel(stripPlanningPrefix(text));
  const safe = cleanupSentence(authorFacingInformationMovementText(stripped));
  if (!safe || safe === text || isPlanningRegisterText(safe) || isWeakReplacement(safe)) return undefined;
  return safe;
}

function usefulWordCount(text: string): number {
  return (text.match(/[A-Za-z0-9']+/g) ?? []).length;
}

function isWeakReplacement(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return (
    usefulWordCount(text) < 4 ||
    normalized === 'rising pressure' ||
    normalized === 'pressure' ||
    normalized === 'fallout' ||
    isPlanningRegisterText(text)
  );
}

function firstReadableSentence(source: unknown): string | undefined {
  if (typeof source !== 'string') return undefined;
  const normalized = cleanupSentence(source.replace(/\n+/g, ' '));
  if (!normalized) return undefined;
  const match = normalized.match(/^(.{24,220}?[.!?])(?:\s|$)/);
  const sentence = cleanupSentence(match?.[1] ?? normalized.slice(0, 220));
  if (isWeakReplacement(sentence)) return undefined;
  return sentence;
}

function replacementForBeatField(
  field: typeof BEAT_METADATA_FIELDS[number],
  beat: MutableRecord,
  original: string,
): string | undefined {
  const ledgerSafe = sanitizeLedgerPlanningText(original);
  if (ledgerSafe) return ledgerSafe;

  const stripped = stripPlanningPrefix(original);
  if (!isWeakReplacement(stripped)) return stripped;

  const proseFallback = firstReadableSentence(beat.text);
  if (proseFallback) return proseFallback;

  if (field !== 'visualMoment') {
    const visualFallback = firstReadableSentence(beat.visualMoment);
    if (visualFallback) return visualFallback;
  }

  if (field === 'emotionalRead') return 'The moment lands with visible pressure and unease.';
  if (field === 'relationshipDynamic') return 'The exchange shifts the scene leverage without resolving it.';
  return undefined;
}

function replacementForBeatText(beat: MutableRecord, original: string): string | undefined {
  const ledgerSafe = sanitizeLedgerPlanningText(original);
  if (ledgerSafe) return ledgerSafe;

  const stripped = stripPlanningPrefix(original);
  if (!isWeakReplacement(stripped)) return stripped;

  const visualFallback = firstReadableSentence(beat.visualMoment);
  if (visualFallback) return visualFallback;

  const actionFallback = firstReadableSentence(beat.primaryAction);
  if (actionFallback) return actionFallback;

  return undefined;
}

function replacementForVariantText(beat: MutableRecord, original: string): string | undefined {
  const ledgerSafe = sanitizeLedgerPlanningText(original);
  if (ledgerSafe) return ledgerSafe;

  const stripped = stripPlanningPrefix(original).replace(/\.{2,}/g, '.');
  if (!isWeakReplacement(stripped)) return stripped;
  return firstReadableSentence(beat.text);
}

function replacementForSceneField(scene: MutableRecord, original: string): string | undefined {
  const ledgerSafe = sanitizeLedgerPlanningText(original);
  if (ledgerSafe) return ledgerSafe;

  const stripped = stripPlanningPrefix(original);
  if (!isWeakReplacement(stripped)) return stripped;

  const firstBeat = Array.isArray(scene.beats) ? scene.beats[0] as MutableRecord | undefined : undefined;
  return firstReadableSentence(firstBeat?.text);
}

function replacementForEncounterField(scene: MutableRecord, encounter: MutableRecord, original: string): string | undefined {
  const ledgerSafe = sanitizeLedgerPlanningText(original);
  if (ledgerSafe) return ledgerSafe;

  const stripped = stripPlanningPrefix(original);
  if (!isWeakReplacement(stripped)) return stripped;

  const encounterDescription = firstReadableSentence(encounter.description);
  if (encounterDescription) return encounterDescription;

  const sceneDescription = firstReadableSentence(scene.description);
  if (sceneDescription) return sceneDescription;

  const firstBeat = Array.isArray(scene.beats) ? scene.beats[0] as MutableRecord | undefined : undefined;
  return firstReadableSentence(firstBeat?.text);
}

function repairEncounterPlanningText(scene: MutableRecord, encounter: MutableRecord, value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let rewritten = 0;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      if (typeof item === 'string' && isPlanningRegisterText(item)) {
        const replacement = replacementForEncounterField(scene, encounter, item);
        if (replacement && replacement !== item) {
          value[index] = replacement;
          rewritten += 1;
        }
        continue;
      }
      rewritten += repairEncounterPlanningText(scene, encounter, item);
    }
    return rewritten;
  }

  const record = value as MutableRecord;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string') {
      if (!isPlanningRegisterText(child)) continue;
      const replacement = replacementForEncounterField(scene, encounter, child);
      if (!replacement || replacement === child) continue;
      record[key] = replacement;
      rewritten += 1;
    } else if (child && typeof child === 'object') {
      rewritten += repairEncounterPlanningText(scene, encounter, child);
    }
  }

  return rewritten;
}

function hasPlanningRegisterBlocker(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): boolean {
  return issues.some((issue) => issue.validator === 'PlanningRegisterLeakValidator' || issue.type === 'planning_register_prose');
}

export function buildPlanningRegisterMetadataRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    if (!hasPlanningRegisterBlocker(blockingIssues)) return { story, changed: false };

    let rewritten = 0;

    for (const episode of (story as { episodes?: unknown[] }).episodes ?? []) {
      const ep = episode as MutableRecord;
      for (const sceneValue of (Array.isArray(ep.scenes) ? ep.scenes : [])) {
        const scene = sceneValue as MutableRecord;
        for (const field of SCENE_METADATA_FIELDS) {
          const value = scene[field];
          if (typeof value !== 'string' || !isPlanningRegisterText(value)) continue;
          const replacement = replacementForSceneField(scene, value);
          if (!replacement || replacement === value) continue;
          scene[field] = replacement;
          rewritten += 1;
        }

        for (const beatValue of (Array.isArray(scene.beats) ? scene.beats : [])) {
          const beat = beatValue as MutableRecord;
          const text = beat.text;
          if (typeof text === 'string' && isPlanningRegisterText(text)) {
            const replacement = replacementForBeatText(beat, text);
            if (replacement && replacement !== text) {
              beat.text = replacement;
              rewritten += 1;
            }
          }

          for (const field of BEAT_METADATA_FIELDS) {
            const value = beat[field];
            if (typeof value !== 'string' || !isPlanningRegisterText(value)) continue;
            const replacement = replacementForBeatField(field, beat, value);
            if (!replacement || replacement === value) continue;
            beat[field] = replacement;
            rewritten += 1;
          }

          for (const variantValue of (Array.isArray(beat.textVariants) ? beat.textVariants : [])) {
            const variant = variantValue as MutableRecord;
            const value = variant.text;
            if (typeof value !== 'string' || !isPlanningRegisterText(value)) continue;
            const replacement = replacementForVariantText(beat, value);
            if (!replacement || replacement === value) continue;
            variant.text = replacement;
            rewritten += 1;
          }
        }

        if (scene.encounter && typeof scene.encounter === 'object') {
          rewritten += repairEncounterPlanningText(scene, scene.encounter as MutableRecord, scene.encounter);
        }
      }
    }

    if (rewritten === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_planning_register_metadata',
        scope: 'season',
        attempted: rewritten,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Rewrote ${rewritten} planning-register metadata field(s)`,
      },
    };
  };
}
