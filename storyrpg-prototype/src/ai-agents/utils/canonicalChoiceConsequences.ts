import type { Consequence } from '../../types';
import type {
  RelationshipEvidenceTag,
  RelationshipSurface,
  RelationshipValueAxis,
} from '../../types/relationshipValue';

export const RELATIONSHIP_DIMENSIONS = ['trust', 'affection', 'respect', 'fear'] as const;
export const RELATIONSHIP_VALUE_AXES: RelationshipValueAxis[] = [
  'love', 'trust', 'loyalty', 'respect', 'belonging', 'freedom', 'safety', 'ambition',
];
export const RELATIONSHIP_EVIDENCE_TAGS: RelationshipEvidenceTag[] = [
  'respected_agency',
  'sacrificed_without_control',
  'repaired_harm',
  'protected_player',
  'withheld_care',
  'ignored_need',
  'sabotaged_player',
  'publicly_attacked',
  'retaliated',
  'overrode_player_choice',
  'aid_with_strings',
  'used_guilt_as_leverage',
  'protective_control',
];
export const RELATIONSHIP_SURFACES: RelationshipSurface[] = [
  'confession',
  'mutual_aid',
  'sacrifice',
  'forgiveness',
  'agency_respecting_protection',
  'absence',
  'cold_greeting',
  'withheld_help',
  'missed_callback',
  'confrontation',
  'sabotage',
  'route_block',
  'public_accusation',
  'aid_with_cost',
  'protective_control',
  'agency_removal',
  'guilt_callback',
  'conditional_help',
];

export interface CanonicalConsequenceOptions {
  resolveNpcId?: (rawNpcId: string) => string | undefined;
  rejectUnresolvedNpcIds?: boolean;
}

export interface CanonicalConsequenceResult {
  consequence?: Consequence;
  reason?: string;
  normalized: boolean;
}

export interface CanonicalConsequenceListResult {
  consequences: Consequence[];
  rejected: Array<{ index: number; reason: string; value: unknown }>;
  normalized: number;
}

const LEGACY_RELATIONSHIP_TYPES = new Set(['relationship', 'adjustRelationship', 'changeRelationship']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sameCanonicalShape(raw: Record<string, unknown>, canonical: Consequence): boolean {
  const canonicalRecord = canonical as unknown as Record<string, unknown>;
  const rawKeys = Object.keys(raw).sort();
  const canonicalKeys = Object.keys(canonicalRecord).sort();
  return rawKeys.length === canonicalKeys.length
    && rawKeys.every((key, index) => key === canonicalKeys[index])
    && rawKeys.every((key) => raw[key] === canonicalRecord[key]);
}

function resolveNpcId(
  rawNpcId: string,
  options: CanonicalConsequenceOptions,
): string | undefined {
  if (!options.resolveNpcId) return rawNpcId;
  const resolved = options.resolveNpcId(rawNpcId);
  return resolved ?? (options.rejectUnresolvedNpcIds ? undefined : rawNpcId);
}

function result(raw: Record<string, unknown>, consequence: Consequence): CanonicalConsequenceResult {
  return { consequence, normalized: !sameCanonicalShape(raw, consequence) };
}

function reject(reason: string): CanonicalConsequenceResult {
  return { reason, normalized: false };
}

/**
 * Converts a generated consequence to the runtime's discriminated Consequence union.
 * Only unambiguous legacy aliases are accepted. In particular, relationship meaning is
 * never inferred from a flag/name string: npcId, dimension and numeric movement must exist.
 */
export function normalizeCanonicalConsequence(
  value: unknown,
  options: CanonicalConsequenceOptions = {},
): CanonicalConsequenceResult {
  const raw = record(value);
  if (!raw) return reject('consequence must be an object');
  const type = nonEmptyString(raw.type);
  if (!type) return reject('consequence.type is required');

  if (LEGACY_RELATIONSHIP_TYPES.has(type)) {
    const rawNpcId = nonEmptyString(raw.npcId) ?? nonEmptyString(raw.characterId);
    const dimension = nonEmptyString(raw.dimension) ?? nonEmptyString(raw.relationshipType) ?? nonEmptyString(raw.aspect);
    const change = finiteNumber(raw.change) ?? finiteNumber(raw.delta);
    if (!rawNpcId || !dimension || change === undefined) {
      return reject('relationship requires npcId, dimension, and numeric change');
    }
    if (!RELATIONSHIP_DIMENSIONS.includes(dimension as typeof RELATIONSHIP_DIMENSIONS[number])) {
      return reject(`relationship dimension "${dimension}" is not canonical`);
    }
    const npcId = resolveNpcId(rawNpcId, options);
    if (!npcId) return reject(`relationship npcId "${rawNpcId}" is not in the authoritative roster`);
    return result(raw, {
      type: 'relationship',
      npcId,
      dimension: dimension as typeof RELATIONSHIP_DIMENSIONS[number],
      change,
    });
  }

  switch (type) {
    case 'attribute': {
      const attribute = nonEmptyString(raw.attribute);
      const change = finiteNumber(raw.change);
      return attribute && change !== undefined
        ? result(raw, { type, attribute: attribute as never, change })
        : reject('attribute requires attribute and numeric change');
    }
    case 'skill': {
      const skill = nonEmptyString(raw.skill);
      const change = finiteNumber(raw.change);
      return skill && change !== undefined
        ? result(raw, { type, skill, change })
        : reject('skill requires skill and numeric change');
    }
    case 'setFlag': {
      const flag = nonEmptyString(raw.flag) ?? nonEmptyString(raw.name);
      let booleanValue = typeof raw.value === 'boolean' ? raw.value : undefined;
      if (typeof raw.value === 'string') {
        const text = raw.value.trim();
        if (/^(true|false)$/i.test(text)) booleanValue = text.toLowerCase() === 'true';
        if (!flag) {
          const match = text.match(/^([A-Za-z0-9_:\-./]+):(true|false)$/i);
          if (match) booleanValue = match[2].toLowerCase() === 'true';
          const legacyFlag = match?.[1] ?? (!/^(true|false)$/i.test(text) ? text : undefined);
          if (legacyFlag) return result(raw, { type, flag: legacyFlag, value: booleanValue ?? true });
        }
      }
      return flag && booleanValue !== undefined
        ? result(raw, { type, flag, value: booleanValue })
        : reject('malformed setFlag consequence: setFlag requires flag and boolean value');
    }
    case 'changeScore': {
      const score = nonEmptyString(raw.score) ?? nonEmptyString(raw.target) ?? nonEmptyString(raw.name);
      const change = finiteNumber(raw.change);
      return score && change !== undefined
        ? result(raw, { type, score, change })
        : reject('changeScore requires score and numeric change');
    }
    case 'setScore': {
      const score = nonEmptyString(raw.score) ?? nonEmptyString(raw.target) ?? nonEmptyString(raw.name);
      const scoreValue = finiteNumber(raw.value);
      return score && scoreValue !== undefined
        ? result(raw, { type, score, value: scoreValue })
        : reject('setScore requires score and numeric value');
    }
    case 'addTag':
    case 'removeTag': {
      const tag = nonEmptyString(raw.tag);
      return tag ? result(raw, { type, tag }) : reject(`${type} requires tag`);
    }
    case 'addItem': {
      const quantity = raw.quantity === undefined ? undefined : finiteNumber(raw.quantity);
      if (raw.quantity !== undefined && quantity === undefined) return reject('addItem quantity must be numeric');
      const item = record(raw.item);
      if (item) {
        return result(raw, { type, item: item as never, ...(quantity !== undefined ? { quantity } : {}) });
      }
      const itemId = nonEmptyString(raw.itemId);
      const name = nonEmptyString(raw.name);
      const description = nonEmptyString(raw.description);
      return itemId && name && description
        ? result(raw, { type, itemId, name, description, ...(quantity !== undefined ? { quantity } : {}) })
        : reject('addItem requires item or itemId, name, and description');
    }
    case 'removeItem': {
      const itemId = nonEmptyString(raw.itemId);
      const quantity = finiteNumber(raw.quantity);
      return itemId && quantity !== undefined
        ? result(raw, { type, itemId, quantity })
        : reject('removeItem requires itemId and numeric quantity');
    }
    case 'relationshipEvidence': {
      const rawNpcId = nonEmptyString(raw.npcId);
      const axis = nonEmptyString(raw.axis);
      const reason = nonEmptyString(raw.reason);
      const evidenceTags = Array.isArray(raw.evidenceTags)
        ? raw.evidenceTags.filter((tag): tag is RelationshipEvidenceTag =>
          typeof tag === 'string' && RELATIONSHIP_EVIDENCE_TAGS.includes(tag as RelationshipEvidenceTag))
        : [];
      const intendedSurface = nonEmptyString(raw.intendedSurface);
      if (!rawNpcId || !axis || !reason || evidenceTags.length === 0) {
        return reject('relationshipEvidence requires npcId, axis, evidenceTags, and reason');
      }
      if (!RELATIONSHIP_VALUE_AXES.includes(axis as RelationshipValueAxis)) {
        return reject(`relationshipEvidence axis "${axis}" is not canonical`);
      }
      if (
        intendedSurface
        && !RELATIONSHIP_SURFACES.includes(intendedSurface as RelationshipSurface)
      ) {
        return reject(`relationshipEvidence surface "${intendedSurface}" is not canonical`);
      }
      const npcId = resolveNpcId(rawNpcId, options);
      if (!npcId) return reject(`relationshipEvidence npcId "${rawNpcId}" is not in the authoritative roster`);
      return result(raw, {
        type,
        npcId,
        axis: axis as RelationshipValueAxis,
        evidenceTags,
        reason,
        ...(intendedSurface ? { intendedSurface: intendedSurface as RelationshipSurface } : {}),
      });
    }
    default:
      return reject(`unsupported consequence type "${type}"`);
  }
}

export function normalizeCanonicalConsequences(
  values: unknown,
  options: CanonicalConsequenceOptions = {},
): CanonicalConsequenceListResult {
  if (!Array.isArray(values)) {
    return {
      consequences: [],
      rejected: values === undefined
        ? []
        : [{ index: 0, reason: 'consequences must be an array', value: values }],
      normalized: 0,
    };
  }
  const consequences: Consequence[] = [];
  const rejected: CanonicalConsequenceListResult['rejected'] = [];
  let normalized = 0;
  values.forEach((value, index) => {
    const item = normalizeCanonicalConsequence(value, options);
    if (!item.consequence) {
      rejected.push({ index, reason: item.reason ?? 'invalid consequence', value });
      return;
    }
    consequences.push(item.consequence);
    if (item.normalized) normalized += 1;
  });
  return { consequences, rejected, normalized };
}
