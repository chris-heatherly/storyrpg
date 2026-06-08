import type { Choice, Consequence } from '../../types';

/**
 * Route a fallback choice set across a branch point's distinct `leadsTo` targets so
 * every target is reached by ≥1 choice (round-robin), padding the choice list when
 * there are fewer choices than targets. Used to structurally realize a planned branch
 * when ChoiceAuthor fails for a branch point, so GATE_BRANCH_FANOUT passes instead of
 * hard-aborting the episode. Pure (returns new objects); unit-testable.
 */
export function routeFallbackChoicesAcrossTargets<T extends { id: string; nextSceneId?: string }>(
  baseChoices: T[],
  targets: string[],
  beatId: string,
): T[] {
  if (targets.length === 0 || baseChoices.length === 0) return baseChoices.slice();
  const choices = baseChoices.slice();
  while (choices.length < targets.length) {
    const i = choices.length;
    const template = baseChoices[i % baseChoices.length];
    choices.push({ ...template, id: `${beatId}-fallback-choice-${i + 1}` });
  }
  return choices.map((choice, i) => ({ ...choice, nextSceneId: targets[i % targets.length] }));
}

const BRANCH_MATCH_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'her', 'his',
  'him', 'she', 'they', 'them', 'their', 'a', 'an', 'to', 'of', 'it', 'is', 'in', 'on',
  'because', 'rather', 'than', 'not', 'but', 'where', 'when', 'who',
]);

function branchTokens(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !BRANCH_MATCH_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Content-word overlap between a choice's text and a branch path's label. */
function branchAffinity(choiceText: string | undefined, label: string | undefined): number {
  const a = branchTokens(choiceText);
  const b = branchTokens(label);
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return hits;
}

/**
 * Repair an UNDER-FANNED branch point in place: when a multi-target branch scene's
 * AUTHORED choices route to fewer than 2 of its `leadsTo` targets (e.g. the LLM pointed
 * both choices at the same scene, orphaning the other branch — the bite-me-gen-8 s1-1
 * case), re-point spare choices at the unreached targets until ≥2 distinct targets are
 * covered.
 *
 * IMPORTANT (story coherence): this does NOT write or move prose — the choices are
 * already authored. It only corrects each choice's DESTINATION. When `pathHints` give
 * the authored branch-path label for each target (from BranchManager — e.g. s1-3="The
 * Side Entrance / accept the key card", s1-2="The Front Door / decline"), the spare
 * choice routed to a target is the one whose TEXT best matches that target's authored
 * intent — so "decline" lands on the front-door branch, never the side-entrance one.
 * Without hints it falls back to the first safe spare (last resort; logged by caller).
 *
 * "Spare" = a choice whose nextSceneId is not an in-target route, else a redundant
 * choice whose target is already covered by another choice. Existing distinct routing is
 * preserved. Returns true iff any choice was re-pointed. Pure (mutates choices).
 */
export function repairBranchFanOut<T extends { nextSceneId?: string; text?: string }>(
  choices: T[],
  leadsTo: string[] | undefined,
  opts?: { pathHints?: Array<{ target: string; label: string }> },
): boolean {
  const targets = [...new Set((leadsTo ?? []).filter(Boolean))];
  const need = Math.min(2, targets.length, choices.length);
  if (need < 2) return false; // not a multi-target branch (or too few choices to fan out)

  const inTarget = (id: string | undefined): id is string => !!id && targets.includes(id);
  const distinctReached = (): Set<string> => new Set(choices.map((c) => c.nextSceneId).filter(inTarget));
  if (distinctReached().size >= need) return false; // already fans out enough

  const labelByTarget = new Map((opts?.pathHints ?? []).map((h) => [h.target, h.label]));

  // Choices safe to re-point: unrouted / out-of-target, OR redundant (their target is
  // covered by another choice). Never steals the SOLE choice reaching a target.
  const spareChoices = (): T[] => {
    const counts = new Map<string, number>();
    for (const c of choices) if (inTarget(c.nextSceneId)) counts.set(c.nextSceneId, (counts.get(c.nextSceneId) ?? 0) + 1);
    return choices.filter((c) => !inTarget(c.nextSceneId) || (counts.get(c.nextSceneId as string) ?? 0) > 1);
  };

  let changed = false;
  for (const target of targets) {
    if (distinctReached().size >= need) break;
    if (distinctReached().has(target)) continue;
    const spares = spareChoices();
    if (spares.length === 0) break; // nothing safe to re-point
    // Route the spare whose TEXT best matches this target's authored branch label, so
    // the choice goes where the author intended (not by arbitrary order). First spare
    // when there is no label or no signal.
    const label = labelByTarget.get(target);
    let chosen = spares[0];
    if (label) {
      let best = -1;
      for (const c of spares) {
        const score = branchAffinity(c.text, label);
        if (score > best) { best = score; chosen = c; }
      }
    }
    chosen.nextSceneId = target;
    changed = true;
  }
  return changed;
}

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
