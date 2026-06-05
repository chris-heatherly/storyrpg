/**
 * Season choice / consequence budget allocator.
 *
 * The season scene plan ({@link SeasonScenePlan}) enumerates every scene and
 * encounter up front. This module layers a *budget* over that plan: it decides,
 * deterministically, what KIND of central choice each budgeted unit carries
 * (its {@link ChoiceType}) and how heavy a consequence that choice discharges
 * (its {@link ConsequenceTier}) — "budget the spine, not the texture".
 *
 * The budgeted unit is ONE central choice per choice-bearing scene OR per
 * encounter; tactical choices inside an encounter are not individually
 * budgeted. Units are weighted ("dramatic diet"): a scene choice weighs
 * {@link SCENE_BUDGET_WEIGHT} (1), an encounter weighs
 * {@link ENCOUNTER_BUDGET_WEIGHT} (3) — a concentrated, intense serving of ONE
 * role. All budget mixes are measured on WEIGHTED totals.
 *
 * Allocation is consequential-first: encounters are the most consequential
 * units, so they claim their non-expression / branch-heavy slots BEFORE
 * standard scenes fill the remainder. This makes standard scenes auto-absorb
 * expression and relationship choices and lighter consequence tiers, matching
 * the target diet without forcing it. Authored preferences (a pre-set
 * `choiceType` / `consequenceTier` from the LLM scene plan) are respected
 * where they do not violate an invariant; reconciliation toward target is
 * GENTLE —
 * a single deterministic pass, authored-drama-wins.
 *
 * Invariants enforced here (the same ones {@link SeasonBudgetValidator}
 * checks):
 *   - an encounter is NEVER an 'expression' choice (expression is voice /
 *     no-stakes; encounters are stakes-driven);
 *   - an 'expression' unit's consequence is always 'callback';
 *   - a 'dilemma' unit's consequence is at least 'branchlet';
 *   - ANY encounter's consequence is at least 'branchlet' (never 'callback');
 *     branch-point encounters are assigned their 'branch'/'branchlet' slots
 *     first.
 *
 * Apportionment uses the largest-remainder (Hamilton) method over the weighted
 * total, so target percentages turn into exact weighted counts that sum to the
 * total. Everything here is pure and deterministic — no randomness, stable
 * ordering — so a given scene plan always yields the same budget.
 */

import {
  CHOICE_TYPE_TARGET,
  CONSEQUENCE_TARGET,
  SCENE_BUDGET_WEIGHT,
  ENCOUNTER_BUDGET_WEIGHT,
} from '../../types/scenePlan';
import type {
  SeasonScenePlan,
  PlannedScene,
  ConsequenceTier,
} from '../../types/scenePlan';
import type { ChoiceType } from '../../types/choice';

// ========================================
// TYPES
// ========================================

/**
 * A weighted distribution over a fixed key set: raw weighted `counts` per key,
 * the `total` weight, and the derived `percentages` (0–100, summing ~100).
 */
export interface WeightedMix<K extends string> {
  counts: Record<K, number>;
  total: number;
  percentages: Record<K, number>;
}

type ChoiceKey = 'expression' | 'relationship' | 'strategic' | 'dilemma';

/** Choice types an encounter may carry (expression is forbidden for stakes). */
const ENCOUNTER_CHOICE_TYPES: ChoiceType[] = ['relationship', 'strategic', 'dilemma'];

/** Stable ordering for choice-type apportionment / assignment. */
const CHOICE_ORDER: ChoiceKey[] = ['expression', 'relationship', 'strategic', 'dilemma'];

/** Stable ordering for consequence-tier apportionment, light -> heavy. */
const TIER_ORDER: ConsequenceTier[] = ['callback', 'tint', 'branchlet', 'branch'];

/** Heaviness rank for consequence tiers (used to enforce >= invariants). */
const TIER_RANK: Record<ConsequenceTier, number> = {
  callback: 0,
  tint: 1,
  branchlet: 2,
  branch: 3,
};

// ========================================
// HELPERS
// ========================================

/** Is this scene an encounter (kind === 'encounter')? */
function isEncounter(scene: PlannedScene): boolean {
  return scene.kind === 'encounter';
}

/** Is this encounter a branch point? (Only meaningful for encounters.) */
function isBranchPointEncounter(scene: PlannedScene): boolean {
  return isEncounter(scene) && Boolean(scene.encounter?.isBranchPoint);
}

/**
 * The budget weight for a unit, defaulting by kind when unset. Encounters
 * weigh {@link ENCOUNTER_BUDGET_WEIGHT}; everything else
 * {@link SCENE_BUDGET_WEIGHT}.
 */
function weightOf(scene: PlannedScene): number {
  if (typeof scene.budgetWeight === 'number' && scene.budgetWeight > 0) {
    return scene.budgetWeight;
  }
  return isEncounter(scene) ? ENCOUNTER_BUDGET_WEIGHT : SCENE_BUDGET_WEIGHT;
}

/**
 * Largest-remainder (Hamilton) apportionment: split `total` integer weight
 * across `keys` proportional to `targetPercent`, so the parts sum exactly to
 * `total`. Deterministic: ties on the fractional remainder break by `keys`
 * order.
 */
function largestRemainder<K extends string>(
  total: number,
  keys: readonly K[],
  targetPercent: Record<K, number>,
): Record<K, number> {
  const result = {} as Record<K, number>;
  for (const k of keys) result[k] = 0;
  if (total <= 0) return result;

  const percentSum = keys.reduce((s, k) => s + (targetPercent[k] ?? 0), 0) || 1;
  const ideal = keys.map((k) => (total * (targetPercent[k] ?? 0)) / percentSum);
  const floors = ideal.map((v) => Math.floor(v));
  const assigned = floors.reduce((s, v) => s + v, 0);

  keys.forEach((k, i) => {
    result[k] = floors[i];
  });

  let remaining = total - assigned;
  // Distribute the leftover one unit at a time to the largest fractional
  // remainders, ties broken by `keys` order (stable).
  const order = keys
    .map((k, i) => ({ k, i, frac: ideal[i] - floors[i] }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  let idx = 0;
  while (remaining > 0 && order.length > 0) {
    const { k } = order[idx % order.length];
    result[k] += 1;
    remaining -= 1;
    idx += 1;
  }
  return result;
}

// ========================================
// BUDGET UNITS
// ========================================

/**
 * Collect the budgeted units from a scene plan: every encounter, plus every
 * standard scene already marked `hasChoice === true`. Mutates each returned
 * unit to carry a defaulted `budgetWeight` (and forces `hasChoice = true` on
 * encounters — encounters always budget one central choice).
 *
 * Order is the plan's scene order, preserved, so all downstream allocation is
 * deterministic.
 */
export function buildBudgetUnits(plan: SeasonScenePlan): PlannedScene[] {
  const units: PlannedScene[] = [];
  for (const scene of plan.scenes) {
    if (isEncounter(scene)) {
      scene.hasChoice = true;
      scene.budgetWeight = ENCOUNTER_BUDGET_WEIGHT;
      units.push(scene);
    } else if (scene.hasChoice === true) {
      scene.budgetWeight = SCENE_BUDGET_WEIGHT;
      units.push(scene);
    }
  }
  return units;
}

// ========================================
// CHOICE-TYPE ALLOCATION
// ========================================

/**
 * Assign each unit a {@link ChoiceType}, weighted toward
 * {@link CHOICE_TYPE_TARGET}.
 *
 * Strategy (consequential-first):
 *   1. Compute weighted target counts via largest-remainder over total weight.
 *   2. Honor pre-authored, non-violating choiceTypes first (debit the budget).
 *   3. Assign remaining ENCOUNTERS from the non-expression types only, heaviest
 *      demand first — encounters claim their slots before scenes.
 *   4. Fill remaining STANDARD scenes from whatever budget is left (expression
 *      eligible), preferring under-served types.
 *
 * Mutates `units[].choiceType`.
 */
export function allocateChoiceTypes(units: PlannedScene[]): void {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);
  if (units.length === 0 || totalWeight <= 0) return;

  // Remaining weighted budget per type.
  const budget = largestRemainder<ChoiceKey>(totalWeight, CHOICE_ORDER, CHOICE_TYPE_TARGET);

  const debit = (type: ChoiceKey, weight: number): void => {
    budget[type] = Math.max(0, budget[type] - weight);
  };

  // Best available type for a unit, restricted to `allowed`, preferring the
  // type with the most remaining budget (ties by CHOICE_ORDER).
  const pick = (allowed: readonly ChoiceKey[]): ChoiceKey => {
    let best = allowed[0];
    for (const t of allowed) {
      if (budget[t] > budget[best]) best = t;
    }
    return best;
  };

  const unassignedEncounters: PlannedScene[] = [];
  const unassignedScenes: PlannedScene[] = [];

  // Pass 1: honor pre-authored, non-violating choiceTypes.
  for (const u of units) {
    const authored = u.choiceType as ChoiceKey | undefined;
    const encounter = isEncounter(u);
    if (authored && CHOICE_ORDER.includes(authored)) {
      const violates = encounter && authored === 'expression';
      if (!violates) {
        u.choiceType = authored;
        debit(authored, weightOf(u));
        continue;
      }
    }
    if (encounter) unassignedEncounters.push(u);
    else unassignedScenes.push(u);
  }

  // Pass 2: encounters claim non-expression slots first (consequential-first).
  for (const u of unassignedEncounters) {
    const type = pick(ENCOUNTER_CHOICE_TYPES as ChoiceKey[]);
    u.choiceType = type;
    debit(type, weightOf(u));
  }

  // Pass 3: standard scenes fill the remainder (expression eligible).
  for (const u of unassignedScenes) {
    const type = pick(CHOICE_ORDER);
    u.choiceType = type;
    debit(type, weightOf(u));
  }
}

// ========================================
// CONSEQUENCE-TIER ALLOCATION
// ========================================

/**
 * The minimum permissible consequence tier for a unit given its choiceType /
 * kind invariants:
 *   - expression => exactly 'callback' (also a max, see {@link tierCeil});
 *   - dilemma    => at least 'branchlet';
 *   - any encounter => at least 'branchlet' (encounters are stakes-driven and
 *     never resolve to a bare 'callback');
 * everything else floors at 'callback'.
 */
function tierFloor(u: PlannedScene): ConsequenceTier {
  if (u.choiceType === 'expression') return 'callback';
  if (u.choiceType === 'dilemma') return 'branchlet';
  if (isEncounter(u)) return 'branchlet';
  return 'callback';
}

/**
 * The maximum permissible consequence tier for a unit:
 *   - expression => exactly 'callback';
 * everything else may go up to 'branch'.
 */
function tierCeil(u: PlannedScene): ConsequenceTier {
  if (u.choiceType === 'expression') return 'callback';
  return 'branch';
}

/** Clamp a tier into [floor, ceil] for the given unit. */
function clampTier(u: PlannedScene, tier: ConsequenceTier): ConsequenceTier {
  const lo = TIER_RANK[tierFloor(u)];
  const hi = TIER_RANK[tierCeil(u)];
  let rank = TIER_RANK[tier];
  if (rank < lo) rank = lo;
  if (rank > hi) rank = hi;
  return TIER_ORDER[rank];
}

/**
 * Assign each unit a {@link ConsequenceTier}, weighted toward
 * {@link CONSEQUENCE_TARGET}, subject to the invariants.
 *
 * Strategy (consequential-first):
 *   1. Compute weighted target counts via largest-remainder over total weight.
 *   2. Honor pre-authored tiers that satisfy the unit's invariants first.
 *   3. Assign branch-point encounters their branch/branchlet slots first.
 *   4. Assign remaining encounters, then standard scenes, each clamped into the
 *      unit's permissible band, preferring the heaviest still-funded tier the
 *      unit can take (encounters skew heavy, scenes skew light by what is left).
 *
 * Mutates `units[].consequenceTier`.
 */
export function allocateConsequenceTiers(units: PlannedScene[]): void {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);
  if (units.length === 0 || totalWeight <= 0) return;

  const budget = largestRemainder<ConsequenceTier>(totalWeight, TIER_ORDER, CONSEQUENCE_TARGET);

  const debit = (tier: ConsequenceTier, weight: number): void => {
    budget[tier] = Math.max(0, budget[tier] - weight);
  };

  // Within [floor, ceil] for the unit, pick the funded tier with the most
  // remaining budget; tie-break toward the heavier tier for encounters and the
  // lighter tier for scenes, so the diet self-balances. Falls back to the
  // floor when nothing is funded (so invariants always hold).
  const pickTier = (u: PlannedScene): ConsequenceTier => {
    const lo = TIER_RANK[tierFloor(u)];
    const hi = TIER_RANK[tierCeil(u)];
    const heavyPref = isEncounter(u);
    let best: ConsequenceTier | null = null;
    let bestScore = -Infinity;
    for (let r = lo; r <= hi; r++) {
      const tier = TIER_ORDER[r];
      if (budget[tier] <= 0) continue;
      // Primary: remaining budget. Secondary: heaviness preference.
      const score = budget[tier] * 4 + (heavyPref ? r : hi - r);
      if (score > bestScore) {
        bestScore = score;
        best = tier;
      }
    }
    return best ?? tierFloor(u);
  };

  const branchPointEncounters: PlannedScene[] = [];
  const otherEncounters: PlannedScene[] = [];
  const scenes: PlannedScene[] = [];
  const assigned = new Set<PlannedScene>();

  // Pass 1: honor pre-authored, invariant-satisfying tiers.
  for (const u of units) {
    const authored = u.consequenceTier;
    if (authored && TIER_ORDER.includes(authored)) {
      const clamped = clampTier(u, authored);
      if (clamped === authored) {
        u.consequenceTier = authored;
        debit(authored, weightOf(u));
        assigned.add(u);
        continue;
      }
    }
    if (isBranchPointEncounter(u)) branchPointEncounters.push(u);
    else if (isEncounter(u)) otherEncounters.push(u);
    else scenes.push(u);
  }

  // Passes 2–4: branch-point encounters, then other encounters, then scenes.
  for (const u of [...branchPointEncounters, ...otherEncounters, ...scenes]) {
    if (assigned.has(u)) continue;
    const tier = pickTier(u);
    u.consequenceTier = tier;
    debit(tier, weightOf(u));
  }
}

// ========================================
// MIXERS
// ========================================

/** Build a {@link WeightedMix} from weighted per-key counts. */
function toMix<K extends string>(counts: Record<K, number>, keys: readonly K[]): WeightedMix<K> {
  const total = keys.reduce((s, k) => s + counts[k], 0);
  const percentages = {} as Record<K, number>;
  for (const k of keys) {
    percentages[k] = total > 0 ? (counts[k] / total) * 100 : 0;
  }
  return { counts, total, percentages };
}

/**
 * Weighted distribution of choiceType across the units (each unit contributes
 * its {@link weightOf}). Units without a choiceType are ignored.
 */
export function weightedChoiceMix(units: PlannedScene[]): WeightedMix<ChoiceKey> {
  const counts: Record<ChoiceKey, number> = {
    expression: 0,
    relationship: 0,
    strategic: 0,
    dilemma: 0,
  };
  for (const u of units) {
    const t = u.choiceType as ChoiceKey | undefined;
    if (t && t in counts) counts[t] += weightOf(u);
  }
  return toMix(counts, CHOICE_ORDER);
}

/**
 * Weighted distribution of consequenceTier across the units (each unit
 * contributes its {@link weightOf}). Units without a tier are ignored.
 */
export function weightedConsequenceMix(units: PlannedScene[]): WeightedMix<ConsequenceTier> {
  const counts: Record<ConsequenceTier, number> = {
    callback: 0,
    tint: 0,
    branchlet: 0,
    branch: 0,
  };
  for (const u of units) {
    const t = u.consequenceTier;
    if (t && t in counts) counts[t] += weightOf(u);
  }
  return toMix(counts, TIER_ORDER);
}
