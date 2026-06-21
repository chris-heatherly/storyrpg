import type { Choice } from '../../types';

export function normalizeChoiceStatCheck(statCheck: Choice['statCheck']): Choice['statCheck'] {
  if (!statCheck) return statCheck;
  const normalized = { ...statCheck };
  if (typeof normalized.difficulty === 'number' && Number.isFinite(normalized.difficulty)) {
    normalized.difficulty = Math.max(35, Math.min(80, normalized.difficulty));
  }
  const weights = normalized.skillWeights;
  if (weights && typeof weights === 'object' && !Array.isArray(weights)) {
    const positive = Object.entries(weights)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const total = positive.reduce((sum, [, value]) => sum + value, 0);
    if (total > 0) {
      normalized.skillWeights = Object.fromEntries(
        positive.map(([skill, value]) => [skill, Number((value / total).toFixed(4))]),
      );
    }
  }
  return normalized;
}

export function normalizeChoiceSetStatChecks<T extends { choices?: Array<{ statCheck?: Choice['statCheck'] }> }>(
  choiceSets: T[],
): T[] {
  for (const choiceSet of choiceSets) {
    for (const choice of choiceSet.choices ?? []) {
      choice.statCheck = normalizeChoiceStatCheck(choice.statCheck);
    }
  }
  return choiceSets;
}
