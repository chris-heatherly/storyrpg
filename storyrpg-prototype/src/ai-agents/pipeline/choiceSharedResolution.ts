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
