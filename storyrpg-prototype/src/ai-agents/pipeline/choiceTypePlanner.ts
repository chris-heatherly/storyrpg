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
 * Assign an explicit `choicePoint.type` to every non-encounter scene that has a
 * choice point, hitting the target distribution. Branching choice points are
 * never assigned 'expression'. Mutates the scenes in place and returns the
 * assignments made (for logging/telemetry).
 */
export function assignChoiceTypes(
  scenes: PlannableScene[],
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): ChoiceTypeAssignment[] {
  const choicePoints = (scenes || []).filter((s) => !s.isEncounter && s.choicePoint);
  const n = choicePoints.length;
  if (n === 0) return [];

  const counts = allocateChoiceTypeCounts(n, target);
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
