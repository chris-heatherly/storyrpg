import type { CharacterBible } from '../../agents/CharacterDesigner';
import type { SceneContent } from '../../agents/SceneWriter';
import { CharacterIdResolver } from './characterIdResolver';

export interface CoverageCharacterNormalizationChange {
  beatId: string;
  field: 'requiredVisibleCharacterIds' | 'optionalVisibleCharacterIds' | 'offscreenCharacterIds' | 'focalCharacterIds';
  original: string[];
  resolved: string[];
  unresolved: string[];
}

export interface CoverageCharacterNormalizationDiagnostic {
  sceneId: string;
  sceneName: string;
  changes: CoverageCharacterNormalizationChange[];
  warnings: string[];
  blocking: string[];
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];
}

function normalizeField(params: {
  beatId: string;
  field: CoverageCharacterNormalizationChange['field'];
  values: unknown;
  resolver: CharacterIdResolver;
  changes: CoverageCharacterNormalizationChange[];
  warnings: string[];
  blocking: string[];
  required: boolean;
}): string[] {
  const original = normalizeList(params.values);
  if (original.length === 0) return [];
  const result = params.resolver.resolveInputs(original);
  if (result.unresolvedIds.length > 0) {
    const message = `${params.beatId}.${params.field} unresolved character ids/aliases: ${result.unresolvedIds.join(', ')}`;
    if (params.required) params.blocking.push(message);
    else params.warnings.push(message);
  }
  if (result.canonicalIds.join('|') !== original.join('|') || result.unresolvedIds.length > 0) {
    params.changes.push({
      beatId: params.beatId,
      field: params.field,
      original,
      resolved: result.canonicalIds,
      unresolved: result.unresolvedIds,
    });
  }
  return result.canonicalIds;
}

function beatMentionsAny(beat: any, values: string[]): boolean {
  const text = [
    beat.text,
    beat.speaker,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.mustShowDetail,
    beat.relationshipDynamic,
  ].filter(Boolean).join(' ').toLowerCase();
  return values.some((value) => {
    const probe = value.toLowerCase().replace(/^char[-_\s]+/, '').split(/[-_\s]+/).filter(Boolean)[0];
    return Boolean(probe) && text.includes(probe);
  });
}

export function normalizeBeatCoverageCharacterIds(
  scene: SceneContent,
  characterBible: CharacterBible,
  protagonist?: { id?: string; name?: string },
): CoverageCharacterNormalizationDiagnostic {
  const resolver = new CharacterIdResolver(characterBible, protagonist);
  const changes: CoverageCharacterNormalizationChange[] = [];
  const warnings: string[] = [];
  const blocking: string[] = [];

  for (const beat of scene.beats || []) {
    const coverage = beat.coveragePlan;
    if (!coverage) continue;
    const rawRequired = normalizeList(coverage.requiredVisibleCharacterIds);
    coverage.requiredVisibleCharacterIds = normalizeField({
      beatId: beat.id,
      field: 'requiredVisibleCharacterIds',
      values: rawRequired,
      resolver,
      changes,
      warnings,
      blocking,
      required: beatMentionsAny(beat, rawRequired),
    });
    coverage.optionalVisibleCharacterIds = normalizeField({
      beatId: beat.id,
      field: 'optionalVisibleCharacterIds',
      values: coverage.optionalVisibleCharacterIds,
      resolver,
      changes,
      warnings,
      blocking,
      required: false,
    });
    coverage.offscreenCharacterIds = normalizeField({
      beatId: beat.id,
      field: 'offscreenCharacterIds',
      values: coverage.offscreenCharacterIds,
      resolver,
      changes,
      warnings,
      blocking,
      required: false,
    });
    coverage.focalCharacterIds = normalizeField({
      beatId: beat.id,
      field: 'focalCharacterIds',
      values: coverage.focalCharacterIds,
      resolver,
      changes,
      warnings,
      blocking,
      required: false,
    });
  }

  return {
    sceneId: scene.sceneId,
    sceneName: scene.sceneName,
    changes,
    warnings: Array.from(new Set(warnings)),
    blocking: Array.from(new Set(blocking)),
  };
}
