import type { Choice, Consequence } from '../../types';

/**
 * Normalize a Consequence object to fix common LLM field-name deviations.
 */
export function normalizeConsequence(c: Consequence): Consequence {
  const raw = c as Record<string, unknown>;
  if ((c.type === 'changeScore' || c.type === 'setScore') && !('score' in c) && typeof raw.target === 'string') {
    return { ...(c as Record<string, unknown>), score: raw.target as string } as Consequence;
  }
  if (c.type === 'setFlag' && !('flag' in c) && typeof raw.name === 'string') {
    return { ...(c as Record<string, unknown>), flag: raw.name as string } as Consequence;
  }
  if (c.type === 'relationship' && !('dimension' in c)) {
    const dimensionAlias = raw.relationshipType ?? raw.aspect;
    if (typeof dimensionAlias === 'string') {
      return { ...(c as Record<string, unknown>), dimension: dimensionAlias } as Consequence;
    }
  }
  return c;
}

export function normalizeConsequences(consequences: Consequence[] | undefined): Consequence[] | undefined {
  if (!consequences || !Array.isArray(consequences)) return consequences;
  return consequences.map(normalizeConsequence);
}

function normalizeDelayedConsequences(delayedConsequences: Choice['delayedConsequences']): Choice['delayedConsequences'] {
  if (!delayedConsequences || !Array.isArray(delayedConsequences)) return delayedConsequences;
  return delayedConsequences.map((entry) => ({
    ...entry,
    consequence: normalizeConsequence(entry.consequence),
  }));
}

/**
 * Fold a choice's `tintFlag` into its consequences as a real `setFlag`. Previously
 * the tintFlag was dead metadata — never applied at runtime, never counted in the
 * consequence budget (tint stuck at 0%), and never surfaced for tint callbacks.
 * Making it a real consequence fixes all three (the engine sets it, the budget
 * classifies a `tint:` setFlag as the tint tier, and episodePlantContext can surface
 * it). Deduped so a choice that already sets the flag isn't doubled.
 */
export function foldTintFlagIntoConsequences(
  consequences: Consequence[] | undefined,
  tintFlag: string | undefined,
): Consequence[] | undefined {
  if (!tintFlag) return consequences;
  const list = Array.isArray(consequences) ? [...consequences] : [];
  const already = list.some((c) => c.type === 'setFlag' && (c as { flag?: string }).flag === tintFlag);
  if (!already) list.push({ type: 'setFlag', flag: tintFlag, value: true } as Consequence);
  return list;
}

export function assembleChoiceForStory(
  choice: Choice,
  nextSceneId: string | undefined = choice.nextSceneId,
): Choice {
  return {
    id: choice.id,
    text: choice.text,
    choiceType: choice.choiceType,
    choiceIntent: choice.choiceIntent,
    impactFactors: choice.impactFactors,
    consequenceTier: choice.consequenceTier,
    stakes: choice.stakes,
    conditions: choice.conditions,
    showWhenLocked: choice.showWhenLocked,
    lockedText: choice.lockedText,
    statCheck: choice.statCheck,
    consequenceDomain: choice.consequenceDomain,
    storyVerb: choice.storyVerb,
    affordanceSource: choice.affordanceSource,
    reminderPlan: choice.reminderPlan,
    feedbackCue: choice.feedbackCue,
    moralContract: choice.moralContract,
    residueHints: choice.residueHints,
    witnessReactions: choice.witnessReactions,
    failureResidue: choice.failureResidue,
    visualResidueHint: choice.visualResidueHint,
    consequences: foldTintFlagIntoConsequences(normalizeConsequences(choice.consequences), choice.tintFlag),
    delayedConsequences: normalizeDelayedConsequences(choice.delayedConsequences),
    routeContext: choice.routeContext,
    nextSceneId,
    nextBeatId: choice.nextBeatId,
    outcomeTexts: choice.outcomeTexts,
    reactionText: choice.reactionText,
    tintFlag: choice.tintFlag,
    memorableMoment: choice.memorableMoment,
  };
}
