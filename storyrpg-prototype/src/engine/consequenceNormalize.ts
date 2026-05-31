import type { Consequence } from '../types';

/**
 * Tolerate non-canonical consequence shapes emitted by some generation agents
 * before the runtime applies them. Without this, those consequences are
 * silently dropped (changeScore warns "missing score field"; relationship adds
 * compute `value + undefined` → NaN). Normalizes:
 *   - `delta` → `change` (when `change` is absent)
 *   - `adjustRelationship` / `changeRelationship` type → `relationship`
 *
 * Returns the original object untouched when no normalization is needed so
 * callers can rely on referential stability for the common case.
 */
export function normalizeConsequenceShape(consequence: Consequence): Consequence {
  const c = consequence as Record<string, unknown> & { type: string };
  const needsTypeRemap = c.type === 'adjustRelationship' || c.type === 'changeRelationship';
  const needsDeltaRemap = typeof c.change !== 'number' && typeof c.delta === 'number';
  if (!needsTypeRemap && !needsDeltaRemap) return consequence;

  const normalized: Record<string, unknown> = { ...c };
  if (needsTypeRemap) normalized.type = 'relationship';
  if (needsDeltaRemap) normalized.change = c.delta;
  return normalized as Consequence;
}
