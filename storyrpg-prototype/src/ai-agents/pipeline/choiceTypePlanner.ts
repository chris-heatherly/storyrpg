/**
 * Choice-type & skill planning (pure).
 *
 * StoryArchitect and ChoiceAuthor only *prompt* the target choice-type mix
 * (expression / relationship / strategic / dilemma) and skill spread, so the LLM
 * routinely ignores it — the Endsong episode shipped 0% expression / 0%
 * relationship / 50% strategic / 50% dilemma (targets 35/30/20/15), and
 * persuasion carried 43% of stat-checks. These helpers run AFTER StoryArchitect
 * and BEFORE ChoiceAuthor to assign each planned choice point an explicit
 * `choicePoint.type` (largest-remainder allocation to the target distribution)
 * and a rotated `primarySkill`, turning aspirational prompt guidance into a
 * concrete plan ChoiceAuthor authors against.
 *
 * Pure + structurally-typed (operates on `{ id, choicePoint?, isEncounter? }`)
 * so it's unit-testable and doesn't couple to the full blueprint type.
 */

export type ChoiceType = 'expression' | 'relationship' | 'strategic' | 'dilemma';

export interface ChoiceTypeTarget {
  expression: number;
  relationship: number;
  strategic: number;
  dilemma: number;
}

export const DEFAULT_CHOICE_TYPE_TARGET: ChoiceTypeTarget = {
  expression: 35,
  relationship: 30,
  strategic: 20,
  dilemma: 15,
};

interface PlannableChoicePoint {
  type?: ChoiceType;
  /** Branching choice points cannot be 'expression' (expression never branches). */
  branches?: boolean;
  primarySkill?: string;
}
interface PlannableScene {
  id: string;
  isEncounter?: boolean;
  choicePoint?: PlannableChoicePoint;
}

const ORDER: ChoiceType[] = ['expression', 'relationship', 'strategic', 'dilemma'];

/**
 * Largest-remainder allocation of `n` items across the four types in the given
 * proportions. Always sums to exactly `n`.
 */
export function allocateChoiceTypeCounts(n: number, target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET): Record<ChoiceType, number> {
  const total = ORDER.reduce((s, t) => s + Math.max(0, target[t]), 0) || 1;
  const raw = ORDER.map((t) => ({ t, exact: (n * Math.max(0, target[t])) / total }));
  const counts: Record<ChoiceType, number> = { expression: 0, relationship: 0, strategic: 0, dilemma: 0 };
  let assigned = 0;
  for (const r of raw) {
    counts[r.t] = Math.floor(r.exact);
    assigned += counts[r.t];
  }
  // Distribute the remainder to the largest fractional parts.
  const remainders = raw
    .map((r) => ({ t: r.t, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (assigned < n) {
    counts[remainders[i % remainders.length].t]++;
    assigned++;
    i++;
  }
  return counts;
}

export interface ChoiceTypeAssignment {
  sceneId: string;
  from?: ChoiceType;
  to: ChoiceType;
}

/**
 * Convert season-plan per-episode counts into a proportion target. Returns undefined when
 * no counts are given or they're all zero (so callers fall back to the default mix).
 */
function countsToTarget(counts?: Record<ChoiceType, number>): ChoiceTypeTarget | undefined {
  if (!counts) return undefined;
  const total = ORDER.reduce((s, t) => s + Math.max(0, counts[t] ?? 0), 0);
  if (total <= 0) return undefined;
  return {
    expression: (Math.max(0, counts.expression ?? 0) / total) * 100,
    relationship: (Math.max(0, counts.relationship ?? 0) / total) * 100,
    strategic: (Math.max(0, counts.strategic ?? 0) / total) * 100,
    dilemma: (Math.max(0, counts.dilemma ?? 0) / total) * 100,
  };
}

/**
 * Assign an explicit `choicePoint.type` to every non-encounter scene that has a
 * choice point, hitting the target distribution. Branching choice points are
 * never assigned 'expression'. Mutates the scenes in place and returns the
 * assignments made (for logging/telemetry).
 */
export function assignChoiceTypes(
  scenes: PlannableScene[],
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
  /**
   * E1: when the season choice plan has already allocated this episode's type mix
   * (`episodeTypeCounts`), pass it here so the per-episode allocation honors the SEASON
   * budget instead of re-deriving 35/30/20/15 locally. Treated as a proportion target and
   * re-allocated to the actual choice-point count, so a count mismatch degrades gracefully.
   */
  seasonCounts?: Record<ChoiceType, number>,
): ChoiceTypeAssignment[] {
  const choicePoints = (scenes || []).filter((s) => !s.isEncounter && s.choicePoint);
  const n = choicePoints.length;
  if (n === 0) return [];

  const effectiveTarget = countsToTarget(seasonCounts) ?? target;
  const counts = allocateChoiceTypeCounts(n, effectiveTarget);

  // Guarantee at least one DILEMMA in a reasonably-sized episode. Largest-
  // remainder gives dilemma (the lowest target weight) 0 slots at small N, so
  // episodes shipped with no high-stakes moral choice (the 0%-dilemma audit
  // finding). The dilemma is the dramatic core, so reserve one slot — stealing
  // from the largest non-dilemma category to stay closest to the target mix.
  // The assignment loop below routes it to a branching/bottleneck choice point
  // first (those are sorted ahead), landing it on the episode's pivotal choice.
  // Skip the local guarantee when the SEASON plan owns the mix (E1) — it may deliberately
  // place this episode's dilemmas in other episodes; forcing one here breaks the budget.
  const MIN_CHOICE_POINTS_FOR_DILEMMA = 3;
  if (!seasonCounts && counts.dilemma === 0 && n >= MIN_CHOICE_POINTS_FOR_DILEMMA) {
    // Steal from the OVER-represented type (largest count), not always 'strategic'.
    // The old code took from strategic first, which zeroed the (already rarest)
    // strategic slot at small N — the audit's `strategic 0%` finding. On ties,
    // prefer the highest-target type (expression > relationship > strategic) so the
    // rarer types survive. 'strategic' is the last resort, only if it's the lone donor.
    const donor = (['expression', 'relationship', 'strategic'] as ChoiceType[])
      .filter((t) => counts[t] > 0)
      .sort((a, b) => counts[b] - counts[a])[0];
    if (donor) {
      counts[donor] -= 1;
      counts.dilemma += 1;
    }
  }

  // Build a slot pool in priority order.
  const pool: ChoiceType[] = [];
  for (const t of ORDER) for (let k = 0; k < counts[t]; k++) pool.push(t);

  // Assign branching choice points first from the non-expression slots, so we
  // never leave a branching CP needing an 'expression' slot.
  const assignments: ChoiceTypeAssignment[] = [];
  const takeSlot = (predicate: (t: ChoiceType) => boolean): ChoiceType | undefined => {
    const idx = pool.findIndex(predicate);
    if (idx === -1) return undefined;
    return pool.splice(idx, 1)[0];
  };

  const ordered = [...choicePoints].sort((a, b) => Number(!!b.choicePoint?.branches) - Number(!!a.choicePoint?.branches));
  for (const scene of ordered) {
    const cp = scene.choicePoint!;
    const wantsNonExpression = !!cp.branches;
    let slot = wantsNonExpression ? takeSlot((t) => t !== 'expression') : takeSlot(() => true);
    // Fallbacks if the pool ran dry for the needed constraint.
    if (!slot) slot = takeSlot(() => true) ?? (wantsNonExpression ? 'strategic' : 'expression');
    assignments.push({ sceneId: scene.id, from: cp.type, to: slot });
    cp.type = slot;
  }
  return assignments;
}

/**
 * Round-robin a skill onto each choice point that lacks one, drawing from
 * `availableSkills` with a least-used budget so no single skill dominates
 * (persuasion ran 43% before). Skips encounters and choice points that already
 * specify a skill. Returns the per-scene skill assignments.
 */
export function planSkillRotation(
  scenes: PlannableScene[],
  availableSkills: string[],
): Array<{ sceneId: string; skill: string }> {
  const skills = (availableSkills || []).filter(Boolean);
  if (skills.length === 0) return [];
  const usage = new Map<string, number>(skills.map((s) => [s, 0]));
  const assignments: Array<{ sceneId: string; skill: string }> = [];

  for (const scene of scenes || []) {
    if (scene.isEncounter || !scene.choicePoint) continue;
    const existing = scene.choicePoint.primarySkill;
    if (existing) {
      usage.set(existing, (usage.get(existing) ?? 0) + 1);
      continue;
    }
    // Pick the least-used skill (stable by input order on ties).
    let best = skills[0];
    for (const s of skills) {
      if ((usage.get(s) ?? 0) < (usage.get(best) ?? 0)) best = s;
    }
    usage.set(best, (usage.get(best) ?? 0) + 1);
    scene.choicePoint.primarySkill = best;
    assignments.push({ sceneId: scene.id, skill: best });
  }
  return assignments;
}
