/**
 * Shared hygiene for image/coverage metadata fields (visualThread,
 * relationshipBlocking, visualContinuity.reason, encounter.description).
 *
 * These fields are scanned by RouteContinuityValidator. Deterministic scaffolds
 * that paste treatment titles into them must never ship.
 */

import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { READER_PROSE_LEAK_PATTERNS } from '../constants/metaProse';

const COVERAGE_SCAFFOLD_RE =
  /\bTrack\s+the\s+visible\s+consequence\s+of\b|\bSequenceDirector:\s*preserve\b|\bshow\s+who\s+gains\s+or\s+loses\s+distance,\s*control,\s*or\s+attention\b/i;

const TREATMENT_SYNOPSIS_RE =
  /(?:^|[.!?]\s+)(?:She|He|They)\s+(?:explores?|wanders?|arrives?|lands?|catches?|forms?|becomes?|returns?)\b|\bWalking\s+home\s+through\b[^.!?]{0,100}\bshe\s+is\s+attacked\b|\bAfter\s+testing\b|\bShe\s+wanders\s+into\s+a\s+bookshop\b/i;

/** True when text is unsafe to keep in coveragePlan / sequenceIntent / encounter meta. */
export function isUnsafeCoverageMetadataText(text: string | undefined): boolean {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return false;
  if (COVERAGE_SCAFFOLD_RE.test(trimmed)) return true;
  if (isPlanningRegisterText(trimmed)) return true;
  if (TREATMENT_SYNOPSIS_RE.test(trimmed)) return true;
  return READER_PROSE_LEAK_PATTERNS.some((entry) => entry.pattern.test(trimmed));
}

/** Concrete spatial default — never paste a treatment title into visualThread. */
export function defaultVisualThreadForLocation(location: string | undefined): string {
  const place = String(location ?? '').trim();
  if (place) {
    return `Hold the ${place} room through doors, thresholds, and who controls the frame.`;
  }
  return 'the changing distance, gaze, and hand positions between the visible characters';
}

export const DEFAULT_COVERAGE_RELATIONSHIP_BLOCKING =
  'Keep bodies and thresholds readable: who advances, who yields, and what object or doorway holds control.';

export const DEFAULT_VISUAL_CONTINUITY_REASON =
  'Preserve environment and lighting axis while varying shot size, camera side, and focal subject.';

/** Concrete blocking default when relationshipDynamic is missing/weak. */
export function defaultRelationshipBlocking(): string {
  return DEFAULT_COVERAGE_RELATIONSHIP_BLOCKING;
}

/** Continuity reason that does not echo treatment titles. */
export function defaultVisualContinuityReason(mode: 'preserve_scene_axis' | 'fresh_composition'): string {
  return mode === 'preserve_scene_axis'
    ? DEFAULT_VISUAL_CONTINUITY_REASON
    : 'Fresh composition within the same geography; keep lighting family and key props continuous.';
}

type CoveragePlanLike = {
  relationshipBlocking?: string;
  coverageReason?: string;
  visualContinuity?: {
    mode?: string;
    reason?: string;
    preserve?: string[];
    preserveFromBeatId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Replace unsafe coveragePlan strings in place; returns a shallow-cloned plan. */
export function sanitizeCoveragePlanMetadata<T extends CoveragePlanLike>(plan: T): T {
  const next = { ...plan } as T;
  if (typeof next.relationshipBlocking === 'string' && isUnsafeCoverageMetadataText(next.relationshipBlocking)) {
    next.relationshipBlocking = defaultRelationshipBlocking();
  }
  if (typeof next.coverageReason === 'string' && isUnsafeCoverageMetadataText(next.coverageReason)) {
    next.coverageReason = 'Beat coverage follows the scene geography and visible turn.';
  }
  if (next.visualContinuity && typeof next.visualContinuity === 'object') {
    const continuity = { ...next.visualContinuity };
    if (typeof continuity.reason === 'string' && isUnsafeCoverageMetadataText(continuity.reason)) {
      const mode = continuity.mode === 'fresh_composition' ? 'fresh_composition' : 'preserve_scene_axis';
      continuity.reason = defaultVisualContinuityReason(mode);
    }
    next.visualContinuity = continuity;
  }
  return next;
}

type SequenceIntentLike = {
  visualThread?: string;
  [key: string]: unknown;
};

/** Replace unsafe sequenceIntent.visualThread; returns a shallow-cloned intent. */
export function sanitizeSequenceIntentMetadata<T extends SequenceIntentLike>(
  intent: T,
  location?: string,
): T {
  const next = { ...intent } as T;
  if (typeof next.visualThread === 'string' && isUnsafeCoverageMetadataText(next.visualThread)) {
    next.visualThread = defaultVisualThreadForLocation(location);
  }
  return next;
}
