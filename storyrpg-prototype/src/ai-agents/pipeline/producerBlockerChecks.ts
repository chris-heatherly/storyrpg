import { SYNTHETIC_FALLBACK_PROSE_PATTERNS } from '../constants/syntheticFallbackProse';
import { normalizeCanonicalConsequences } from '../utils/canonicalChoiceConsequences';
import {
  isUnsafeCoverageMetadataText,
  sanitizeCoveragePlanMetadata,
  sanitizeSequenceIntentMetadata,
} from '../utils/coverageMetadataHygiene';

export type ProducerOwnerPhase = 'scene' | 'choice' | 'encounter';
export type ProducerRepairSurface = 'scene-prose' | 'choice-prose' | 'choice-consequences' | 'encounter-field' | 'coverage-metadata';

export interface ProducerBlockerFinding {
  validator: 'ProducerPhaseBlockerValidator';
  type: 'unsafe_fallback_prose' | 'unsafe_metadata' | 'malformed_relationship_consequence';
  severity: 'error';
  ownerPhase: ProducerOwnerPhase;
  repairSurface: ProducerRepairSurface;
  sceneId: string;
  fieldPath: string;
  message: string;
  suggestion: string;
}

export interface ProducerBlockerOwnership {
  type: ProducerBlockerFinding['type'];
  ownerPhase: ProducerOwnerPhase;
  repairSurface: ProducerRepairSurface;
  handler: string;
  retryBudget: number;
}

/** Executable ownership contract for blockers that must not wait for season-final. */
export const PRODUCER_BLOCKER_OWNERSHIP: readonly ProducerBlockerOwnership[] = [
  {
    type: 'unsafe_fallback_prose',
    ownerPhase: 'scene',
    repairSurface: 'scene-prose',
    handler: 'SceneWriter retry with validator feedback',
    retryBudget: 1,
  },
  {
    type: 'unsafe_fallback_prose',
    ownerPhase: 'choice',
    repairSurface: 'choice-prose',
    handler: 'ChoiceAuthor focused re-author',
    retryBudget: 1,
  },
  {
    type: 'unsafe_fallback_prose',
    ownerPhase: 'encounter',
    repairSurface: 'encounter-field',
    handler: 'EncounterArchitect field re-author',
    retryBudget: 1,
  },
  {
    type: 'unsafe_metadata',
    ownerPhase: 'scene',
    repairSurface: 'coverage-metadata',
    handler: 'postLlmMetadataHygiene',
    retryBudget: 1,
  },
  {
    type: 'malformed_relationship_consequence',
    ownerPhase: 'choice',
    repairSurface: 'choice-consequences',
    handler: 'ChoiceAuthor schema retry',
    retryBudget: 1,
  },
] as const;

type MutableRecord = Record<string, unknown>;

const AUTHOR_ONLY_KEYS = new Set(['sourceSynopsis', 'authoredAnchor']);
const VISIBLE_TEXT_KEYS = new Set([
  'text', 'reactionText', 'lockedText', 'narrativeText', 'outcomeText',
  'setupText', 'escalationText', 'description', 'victory', 'defeat',
  'visibleCost', 'visibleComplication', 'immediateEffect', 'lingeringEffect',
]);
const COVERAGE_KEYS = new Set([
  'visualThread', 'relationshipBlocking', 'coverageReason', 'reason',
]);
const BEAT_VISUAL_METADATA_KEYS = new Set([
  'visualMoment', 'primaryAction', 'emotionalRead', 'relationshipDynamic',
]);

function asRecord(value: unknown): MutableRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MutableRecord
    : undefined;
}

function inspectText(
  findings: ProducerBlockerFinding[],
  text: string,
  ownerPhase: ProducerOwnerPhase,
  sceneId: string,
  fieldPath: string,
  repairSurface: ProducerRepairSurface,
): void {
  for (const fallback of SYNTHETIC_FALLBACK_PROSE_PATTERNS) {
    fallback.pattern.lastIndex = 0;
    if (!fallback.pattern.test(text)) continue;
    findings.push({
      validator: 'ProducerPhaseBlockerValidator',
      type: 'unsafe_fallback_prose',
      severity: 'error',
      ownerPhase,
      repairSurface,
      sceneId,
      fieldPath,
      message: `Unsafe fallback prose detected at ${fieldPath} during ${ownerPhase} production (${fallback.label}).`,
      suggestion: fallback.suggestion,
    });
  }
}

function walkProducerText(
  value: unknown,
  ownerPhase: ProducerOwnerPhase,
  sceneId: string,
  path: string,
  findings: ProducerBlockerFinding[],
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkProducerText(child, ownerPhase, sceneId, `${path}[${index}]`, findings));
    return;
  }
  for (const [key, child] of Object.entries(value as MutableRecord)) {
    if (AUTHOR_ONLY_KEYS.has(key)) continue;
    const fieldPath = `${path}.${key}`;
    if (typeof child === 'string') {
      if (VISIBLE_TEXT_KEYS.has(key)) {
        inspectText(
          findings,
          child,
          ownerPhase,
          sceneId,
          fieldPath,
          ownerPhase === 'encounter' ? 'encounter-field' : ownerPhase === 'choice' ? 'choice-prose' : 'scene-prose',
        );
      }
      const isCoverageField = COVERAGE_KEYS.has(key)
        && (key !== 'reason' || /\b(?:coveragePlan|visualContinuity)\b/.test(path));
      const isBeatVisualMetadata = BEAT_VISUAL_METADATA_KEYS.has(key);
      if ((isCoverageField || isBeatVisualMetadata) && isUnsafeCoverageMetadataText(child)) {
        findings.push({
          validator: 'ProducerPhaseBlockerValidator',
          type: 'unsafe_metadata',
          severity: 'error',
          ownerPhase,
          repairSurface: 'coverage-metadata',
          sceneId,
          fieldPath,
          message: `Unsafe planning/treatment metadata detected at ${fieldPath} during ${ownerPhase} production.`,
          suggestion: isBeatVisualMetadata
            ? 'Clear or re-derive visualMoment/primaryAction from dramatized beat.text; never paste treatment synopsis.'
            : 'Sanitize the owned metadata field and re-run producer hygiene before checkpointing.',
        });
      }
    } else {
      walkProducerText(child, ownerPhase, sceneId, fieldPath, findings);
    }
  }
}

export function postLlmMetadataHygiene(value: unknown, location?: string): string[] {
  const changedPaths: string[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object' || seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    const record = node as MutableRecord;
    if (asRecord(record.coveragePlan)) {
      const before = JSON.stringify(record.coveragePlan);
      record.coveragePlan = sanitizeCoveragePlanMetadata(record.coveragePlan as never);
      if (JSON.stringify(record.coveragePlan) !== before) changedPaths.push(`${path}.coveragePlan`);
    }
    if (asRecord(record.sequenceIntent)) {
      const before = JSON.stringify(record.sequenceIntent);
      record.sequenceIntent = sanitizeSequenceIntentMetadata(record.sequenceIntent as never, location);
      if (JSON.stringify(record.sequenceIntent) !== before) changedPaths.push(`${path}.sequenceIntent`);
    }
    // Clear treatment synopsis pasted into beat visual metadata (RouteContinuity-scanned).
    for (const key of BEAT_VISUAL_METADATA_KEYS) {
      if (typeof record[key] !== 'string') continue;
      if (!isUnsafeCoverageMetadataText(record[key] as string)) continue;
      const text = typeof record.text === 'string' ? (record.text as string).trim() : '';
      if (text && !isUnsafeCoverageMetadataText(text)) {
        record[key] = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
      } else {
        delete record[key];
      }
      changedPaths.push(`${path}.${key}`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (AUTHOR_ONLY_KEYS.has(key)) continue;
      if (child && typeof child === 'object') visit(child, `${path}.${key}`);
    }
  };
  visit(value, 'producer');
  return changedPaths;
}

export function validateSceneProducerOutput(sceneId: string, sceneContent: unknown): ProducerBlockerFinding[] {
  postLlmMetadataHygiene(sceneContent, asRecord(sceneContent)?.location as string | undefined);
  const findings: ProducerBlockerFinding[] = [];
  walkProducerText(sceneContent, 'scene', sceneId, 'scene', findings);
  return findings;
}

export function validateEncounterProducerOutput(sceneId: string, encounter: unknown): ProducerBlockerFinding[] {
  postLlmMetadataHygiene(encounter);
  const findings: ProducerBlockerFinding[] = [];
  walkProducerText(encounter, 'encounter', sceneId, 'encounter', findings);
  return findings;
}

export function validateChoiceProducerOutput(sceneId: string, choiceSet: unknown): ProducerBlockerFinding[] {
  const findings: ProducerBlockerFinding[] = [];
  walkProducerText(choiceSet, 'choice', sceneId, 'choiceSet', findings);
  const choices = Array.isArray(asRecord(choiceSet)?.choices) ? asRecord(choiceSet)!.choices as unknown[] : [];
  choices.forEach((choice, choiceIndex) => {
    const rawConsequences = asRecord(choice)?.consequences;
    const normalized = normalizeCanonicalConsequences(rawConsequences);
    for (const rejected of normalized.rejected) {
      const raw = asRecord(rejected.value);
      if (!raw || !['relationship', 'adjustRelationship', 'changeRelationship'].includes(String(raw.type ?? ''))) continue;
      const fieldPath = `choiceSet.choices[${choiceIndex}].consequences[${rejected.index}]`;
      findings.push({
        validator: 'ProducerPhaseBlockerValidator',
        type: 'malformed_relationship_consequence',
        severity: 'error',
        ownerPhase: 'choice',
        repairSurface: 'choice-consequences',
        sceneId,
        fieldPath,
        message: `Malformed relationship consequence at ${fieldPath}: ${rejected.reason}.`,
        suggestion: 'Re-run ChoiceAuthor with canonical npcId, dimension, and numeric change fields.',
      });
    }
  });
  return findings;
}
