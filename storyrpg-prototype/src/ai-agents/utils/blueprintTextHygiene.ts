import { PLANNING_REGISTER_LEAK_PATTERNS } from '../constants/planningRegisterText';

export type BlueprintHygieneIssueType =
  | 'planning_register_leak'
  | 'raw_synopsis_card'
  | 'generic_choice_scaffold';

export interface BlueprintHygienePattern {
  label: string;
  pattern: RegExp;
  type: BlueprintHygieneIssueType;
}

const RAW_SYNOPSIS_LABELS = new Set([
  'Story Circle desire/fear synopsis card',
  'Third-person protagonist synopsis card',
  'Trait-appositive synopsis card',
  'Intent-to-rebuild synopsis card',
]);

const GENERIC_CHOICE_LABELS = new Set([
  'Generic response choice scaffold',
]);

export const BLUEPRINT_SCANNED_SCENE_FIELDS = [
  'name',
  'description',
  'dramaticQuestion',
  'dramaticPurpose',
  'narrativeFunction',
  'wantVsNeed',
  'conflictEngine',
  'themePressure',
  'encounterDescription',
  'encounterCentralConflict',
  'encounterBuildup',
] as const;

export const BLUEPRINT_CONTRACT_HYGIENE_PATTERNS: BlueprintHygienePattern[] =
  PLANNING_REGISTER_LEAK_PATTERNS.map((item) => ({
    label: item.label,
    pattern: item.pattern,
    type: RAW_SYNOPSIS_LABELS.has(item.label)
      ? 'raw_synopsis_card'
      : GENERIC_CHOICE_LABELS.has(item.label)
        ? 'generic_choice_scaffold'
        : 'planning_register_leak',
  }));

export function cleanBlueprintText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function stripStructuralTreatmentLabels(value: unknown): string {
  const text = cleanBlueprintText(value);
  if (!text) return '';
  const matches = Array.from(text.matchAll(/\b(hook|promise|stakes)\s*(?:—|-|:)\s*/gi));
  if (matches.length === 0) return text;

  const segments: Partial<Record<'hook' | 'promise' | 'stakes', string>> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const label = match[1].toLowerCase() as 'hook' | 'promise' | 'stakes';
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const segment = text.slice(start, end).replace(/^[\s;,:-]+|[\s;,:-]+$/g, '').trim();
    if (segment) segments[label] = segment;
  }

  const concrete = [segments.hook, segments.stakes]
    .filter((segment): segment is string => Boolean(segment))
    .join('; ');
  return concrete || text.replace(/\b(?:hook|promise|stakes)\s*(?:—|-|:)\s*/gi, '').trim();
}

export function matchingBlueprintHygienePatterns(value: unknown): BlueprintHygienePattern[] {
  const text = cleanBlueprintText(value);
  if (!text) return [];
  return BLUEPRINT_CONTRACT_HYGIENE_PATTERNS.filter((candidate) => candidate.pattern.test(text));
}

export function isBlueprintHygieneUnsafeText(value: unknown): boolean {
  return matchingBlueprintHygienePatterns(value).length > 0;
}

export function isBlueprintSafeText(value: unknown): value is string {
  const text = stripStructuralTreatmentLabels(value);
  return text.length > 0 && !isBlueprintHygieneUnsafeText(text);
}

export function pickBlueprintSafeText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stripStructuralTreatmentLabels(value);
    if (text && !isBlueprintHygieneUnsafeText(text)) return text;
  }
  return undefined;
}

export function sanitizeBlueprintText(value: unknown, ...fallbacks: unknown[]): string | undefined {
  const text = stripStructuralTreatmentLabels(value);
  if (text && !isBlueprintHygieneUnsafeText(text)) return text;
  return pickBlueprintSafeText(...fallbacks);
}
