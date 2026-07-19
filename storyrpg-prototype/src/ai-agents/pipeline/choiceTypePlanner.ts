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
  /**
   * Scene-first authoring: when the season scene plan has already decided this
   * scene's choice type (`PlannedScene.choiceType`), thread it here so it wins
   * over the local re-derivation. The authored type is AUTHORITATIVE — its slot
   * is pinned and excluded from the target allocation, and only the remaining
   * (un-authored) choice points fill the rest of the distribution. Absent on the
   * default / flag-off path, so behavior there is unchanged.
   */
  authoredChoiceType?: ChoiceType;
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

function emptyCounts(): Record<ChoiceType, number> {
  return { expression: 0, relationship: 0, strategic: 0, dilemma: 0 };
}

function totalCounts(counts: Record<ChoiceType, number>): number {
  return ORDER.reduce((s, t) => s + Math.max(0, counts[t] ?? 0), 0);
}

/**
 * Convert season-plan per-episode counts into a proportion target. Returns undefined when
 * no counts are given or they're all zero (so callers fall back to the default mix).
 */
function countsToTarget(counts?: Record<ChoiceType, number>): ChoiceTypeTarget | undefined {
  if (!counts) return undefined;
  const total = totalCounts(counts);
  if (total <= 0) return undefined;
  return {
    expression: (Math.max(0, counts.expression ?? 0) / total) * 100,
    relationship: (Math.max(0, counts.relationship ?? 0) / total) * 100,
    strategic: (Math.max(0, counts.strategic ?? 0) / total) * 100,
    dilemma: (Math.max(0, counts.dilemma ?? 0) / total) * 100,
  };
}

function allocateChoiceTypeCountsForEpisode(
  n: number,
  target: ChoiceTypeTarget,
  seasonCounts?: Record<ChoiceType, number>,
): Record<ChoiceType, number> {
  if (!seasonCounts) return allocateChoiceTypeCounts(n, target);
  const seasonTotal = totalCounts(seasonCounts);
  if (seasonTotal <= 0) return allocateChoiceTypeCounts(n, target);

  // If the season slice is denser than the episode's actual choice-point count,
  // compress proportionally. If it is sparse, reserve only the explicit planned
  // slots and let extra local choice points use the normal mix instead of
  // inflating a one-item slice into 100% of the episode.
  if (seasonTotal >= n) {
    return allocateChoiceTypeCounts(n, countsToTarget(seasonCounts) ?? target);
  }

  const counts = emptyCounts();
  for (const type of ORDER) counts[type] = Math.max(0, seasonCounts[type] ?? 0);
  const filler = allocateChoiceTypeCounts(n - seasonTotal, target);
  for (const type of ORDER) counts[type] += filler[type];
  return counts;
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
  if (choicePoints.length === 0) return [];

  // Scene-first: honor any AUTHORED per-scene choiceType from the season scene
  // plan. Pin those choice points up front (they win), then allocate the target
  // distribution over only the REMAINING un-authored points. A branching CP can
  // never be 'expression'; if an authored type would violate that, drop the
  // authoring and let allocation place it (conservative — invariants outrank
  // authoring). With no authored types (default / flag-off path) this is a no-op
  // and the original allocation runs over the full set unchanged.
  const assignments: ChoiceTypeAssignment[] = [];
  const unAuthored: PlannableScene[] = [];
  const authoredCounts = emptyCounts();
  for (const scene of choicePoints) {
    const cp = scene.choicePoint!;
    const authored = scene.authoredChoiceType;
    const authoredValid = !!authored && !(cp.branches && authored === 'expression') && ORDER.includes(authored);
    if (authoredValid) {
      if (cp.type !== authored) assignments.push({ sceneId: scene.id, from: cp.type, to: authored! });
      cp.type = authored!;
      authoredCounts[authored!] += 1;
    } else {
      unAuthored.push(scene);
    }
  }

  const n = unAuthored.length;
  if (n === 0) return assignments;

  // The episode slice describes the WHOLE episode, including authored/pinned
  // slots. Allocate only the remaining debt across un-authored scenes. Without
  // this subtraction, a pinned relationship slot is counted twice and can
  // squeeze a rarer strategic slot out of a three-choice episode.
  const remainingSeasonCounts = seasonCounts
    ? Object.fromEntries(ORDER.map((type) => [
        type,
        Math.max(0, (seasonCounts[type] ?? 0) - authoredCounts[type]),
      ])) as Record<ChoiceType, number>
    : undefined;
  const counts = allocateChoiceTypeCountsForEpisode(n, target, remainingSeasonCounts);

  // Guarantee at least one DILEMMA in a reasonably-sized episode. Largest-
  // remainder gives dilemma (the lowest target weight) 0 slots at small N, so
  // episodes shipped with no high-stakes moral choice (the 0%-dilemma audit
  // finding). The dilemma is the dramatic core, so reserve one slot — stealing
  // from the largest non-dilemma category to stay closest to the target mix.
  // The assignment loop below routes it to a branching/bottleneck choice point
  // first (those are sorted ahead), landing it on the episode's pivotal choice.
  // Enforce >=1 dilemma per reasonably-sized episode even when the season plan
  // allocated zero — shipped choice-point count is ground truth and we never starve
  // an episode of moral choices. (Previously this was skipped whenever `seasonCounts`
  // was supplied, but the per-episode path ALWAYS supplies it, so the guarantee never
  // fired and episodes shipped 0 dilemmas — the audit's `dilemma 0%` finding.) The
  // guard fires only when `dilemma === 0`, so it never deletes an existing dilemma; it
  // converts exactly one over-represented choice. The season plan's protest, if any,
  // is surfaced by ChoiceDistributionValidator shadow telemetry.
  const MIN_CHOICE_POINTS_FOR_DILEMMA = 3;
  if (counts.dilemma === 0 && n >= MIN_CHOICE_POINTS_FOR_DILEMMA) {
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
  const takeSlot = (predicate: (t: ChoiceType) => boolean): ChoiceType | undefined => {
    const idx = pool.findIndex(predicate);
    if (idx === -1) return undefined;
    return pool.splice(idx, 1)[0];
  };

  const ordered = [...unAuthored].sort((a, b) => Number(!!b.choicePoint?.branches) - Number(!!a.choicePoint?.branches));
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
