import type { Story } from '../../types/story';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
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
  /^\s*Escalate\s+the\s+episode\s+pressure\s+through\s+a\s+concrete\s+turn\s*:\s*/i,
  /^\s*Let\s+the\s+fallout\s+settle\s+into\s+the\s+next\s+pressure\s*:\s*/i,
  /^\s*Forward\s+pressure\s*:\s*/i,
];

function cleanupSentence(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?]){2,}$/g, '$1')
    .trim();
}

function stripPlanningPrefix(text: string): string {
  let cleaned = text;
  for (const pattern of PLANNING_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleanupSentence(cleaned);
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

function replacementForSceneField(scene: MutableRecord, original: string): string | undefined {
  const stripped = stripPlanningPrefix(original);
  if (!isWeakReplacement(stripped)) return stripped;

  const firstBeat = Array.isArray(scene.beats) ? scene.beats[0] as MutableRecord | undefined : undefined;
  return firstReadableSentence(firstBeat?.text);
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
          for (const field of BEAT_METADATA_FIELDS) {
            const value = beat[field];
            if (typeof value !== 'string' || !isPlanningRegisterText(value)) continue;
            const replacement = replacementForBeatField(field, beat, value);
            if (!replacement || replacement === value) continue;
            beat[field] = replacement;
            rewritten += 1;
          }
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
