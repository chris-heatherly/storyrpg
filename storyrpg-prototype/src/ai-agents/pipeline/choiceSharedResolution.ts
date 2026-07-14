interface ChoiceOutcomeLike {
  outcomeTexts?: {
    success?: string;
    partial?: string;
    failure?: string;
  };
}

interface ChoiceSetLike {
  sharedResolutionText?: string;
  choices?: ChoiceOutcomeLike[];
}

function cloneChoiceSet<T extends ChoiceSetLike>(choiceSet: T): T {
  return {
    ...choiceSet,
    choices: choiceSet.choices?.map((choice) => ({
      ...choice,
      outcomeTexts: choice.outcomeTexts ? { ...choice.outcomeTexts } : undefined,
    })),
  } as T;
}

/**
 * Projects one LLM-authored route-invariant payoff into every playable choice
 * result. Deterministic code copies prose; it never invents or rewrites it.
 */
export function materializeSharedChoiceResolution(choiceSet: ChoiceSetLike): number {
  const resolution = choiceSet.sharedResolutionText?.trim();
  if (!resolution) return 0;
  const normalizedResolution = resolution.toLowerCase();
  let materialized = 0;
  for (const choice of choiceSet.choices ?? []) {
    if (!choice.outcomeTexts) continue;
    for (const tier of ['success', 'partial', 'failure'] as const) {
      const existing = choice.outcomeTexts[tier]?.trim();
      if (!existing || existing.toLowerCase().includes(normalizedResolution)) continue;
      const separator = /[.!?\u2026\u201d]$/.test(existing) ? ' ' : '. ';
      choice.outcomeTexts[tier] = `${existing}${separator}${resolution}`;
      materialized += 1;
    }
  }
  return materialized;
}

/**
 * Replaces the previously materialized authored resolution without touching
 * the option design or tier-specific prose. The next authored passage is then
 * projected through the same runtime surfaces as the original.
 */
export function withReplacedSharedChoiceResolution<T extends ChoiceSetLike>(
  choiceSet: T,
  nextResolution: string,
): T {
  const candidate = cloneChoiceSet(choiceSet);
  const previousResolution = candidate.sharedResolutionText?.trim();
  if (previousResolution) {
    const normalizedPrevious = previousResolution.toLowerCase();
    for (const choice of candidate.choices ?? []) {
      if (!choice.outcomeTexts) continue;
      for (const tier of ['success', 'partial', 'failure'] as const) {
        const existing = choice.outcomeTexts[tier]?.trim();
        if (!existing || !existing.toLowerCase().endsWith(normalizedPrevious)) continue;
        choice.outcomeTexts[tier] = existing.slice(0, -previousResolution.length).trimEnd();
      }
    }
  }
  candidate.sharedResolutionText = nextResolution.trim();
  materializeSharedChoiceResolution(candidate);
  return candidate;
}
