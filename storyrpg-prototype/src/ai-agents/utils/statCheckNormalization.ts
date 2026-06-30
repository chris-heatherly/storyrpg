import type { Choice, Story } from '../../types';

export function normalizeChoiceStatCheck(statCheck: Choice['statCheck']): Choice['statCheck'] {
  if (!statCheck) return statCheck;
  const normalized = { ...statCheck };
  if (typeof normalized.difficulty === 'number' && Number.isFinite(normalized.difficulty)) {
    normalized.difficulty = Math.max(35, Math.min(80, normalized.difficulty));
  }
  const weights = normalized.skillWeights;
  if (weights && typeof weights === 'object' && !Array.isArray(weights)) {
    const entries = Object.entries(weights);
    const positive = entries.filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const total = positive.reduce((sum, [, value]) => sum + value, 0);
    if (total > 0) {
      normalized.skillWeights = Object.fromEntries(
        positive.map(([skill, value]) => [skill, Number((value / total).toFixed(4))]),
      );
    } else {
      const salvage = entries.filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value !== 0);
      const salvageTotal = salvage.reduce((sum, [, value]) => sum + Math.abs(value), 0);
      if (salvageTotal > 0) {
        normalized.skillWeights = Object.fromEntries(
          salvage.map(([skill, value]) => [skill, Number((Math.abs(value) / salvageTotal).toFixed(4))]),
        );
      } else if (entries.length > 0) {
        normalized.skillWeights = { [entries[0][0]]: 1 };
      }
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

export function normalizeStoryStatChecks(story: Story): number {
  let fixedCount = 0;
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          if (!choice.statCheck) continue;
          const before = JSON.stringify(choice.statCheck);
          choice.statCheck = normalizeChoiceStatCheck(choice.statCheck);
          if (JSON.stringify(choice.statCheck) !== before) fixedCount += 1;
        }
      }
    }
  }
  return fixedCount;
}
