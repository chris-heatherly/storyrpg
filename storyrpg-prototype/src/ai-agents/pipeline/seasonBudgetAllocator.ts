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
  SCENE_CONSEQUENCE_TARGET,
  SCENE_BUDGET_WEIGHT,
  ENCOUNTER_BUDGET_WEIGHT,
} from '../../types/scenePlan';
import type {
  SeasonScenePlan,
  PlannedScene,
  ConsequenceTier,
} from '../../types/scenePlan';
import type { ChoiceType } from '../../types/choice';
import type { StructuralRole } from '../../types/sourceAnalysis';
import { consequenceFlags } from './consequenceFlags';
import { TAU_CHARGE } from './chargeMap';

export {
  computeChargeMap,
  computeChargeParts,
  TAU_CHARGE,
  STAT_CHARGE_CAP,
  type ChargeMapResult,
  type SceneChargeParts,
} from './chargeMap';

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

/**
 * Optional context the later consequence-intelligence phases thread into
 * allocation (Plan Parts 2–6). Foundation phase: the param exists so later
 * phases can fill it, but it is UNUSED here — allocation is byte-identical with
 * or without it. All fields are optional; an empty/absent ctx is the default.
 */
export interface BudgetContext {
  /** Episode structuralRole(s) by episode number — the positional axis (Layers A–C). */
  roleByEpisode?: Record<number, import('../../types/sourceAnalysis').StructuralRole[]>;
  /** Per-scene aggregated inbound charge (from {@link aggregateCharge}) — the dramatic-charge axis. */
  chargeMap?: Map<string, number>;
  /** The Convergence Ledger backing the charge map (anchors, gate levels, edges). */
  ledger?: import('../../types/convergenceLedger').ConvergenceLedger;
  /** Expected skill levels by episode then skill name — the difficulty/winnability curve (Part 5b). */
  expectedSkillByEpisode?: Record<number, Record<string, number>>;
}

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
 *
 * @param ctx Optional consequence-intelligence context (Plan Parts 2–6).
 *   Foundation phase: UNUSED — present so later phases can read positional /
 *   charge signals without changing this signature. Behavior is identical
 *   whether or not it is passed.
 */
export function allocateChoiceTypes(units: PlannedScene[], ctx?: BudgetContext): void {
  void ctx;
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

// ========================================
// POSITIONAL TIERING (Plan Part 3, Layers A–C) — gated by CONSEQUENCE_POSITIONAL
// ========================================

/**
 * Episode posture (Plan Part 3, Layer C). Posture gates how heavy a
 * NON-encounter major may go — a durable `branch` needs runway to pay off before
 * the story forces a merge, and tentpole beats are merge points by design.
 *
 *  - **convergent** — hook / midpoint / climax / resolution / falling: a
 *    non-encounter major is capped at `branchlet` (resolution leans `callback`).
 *  - **open-field** — plotTurn1 / pinch1 / rising: a major may reach `branch`.
 *  - **open-field-short** — pinch2: a major reconverges into climax → `branchlet`.
 *
 * An unknown / absent role defaults to **open-field** (the permissive middle).
 */
export type EpisodePosture = 'convergent' | 'open-field' | 'open-field-short';

const POSTURE_BY_ROLE: Record<StructuralRole, EpisodePosture> = {
  hook: 'convergent',
  midpoint: 'convergent',
  climax: 'convergent',
  resolution: 'convergent',
  falling: 'convergent',
  plotTurn1: 'open-field',
  pinch1: 'open-field',
  rising: 'open-field',
  pinch2: 'open-field-short',
};

/**
 * Map an episode's structuralRole(s) to a single posture. When an episode fuses
 * multiple beats we take the most divergence-permissive posture present
 * (open-field > open-field-short > convergent) so a fused open-field beat is not
 * suppressed by a convergent neighbor. No known role → 'open-field'.
 */
export function episodePosture(roles: StructuralRole[] | undefined): EpisodePosture {
  if (!roles || roles.length === 0) return 'open-field';
  let best: EpisodePosture = 'convergent';
  const rank: Record<EpisodePosture, number> = {
    convergent: 0,
    'open-field-short': 1,
    'open-field': 2,
  };
  let seenKnown = false;
  for (const r of roles) {
    const p = POSTURE_BY_ROLE[r];
    if (!p) continue;
    seenKnown = true;
    if (rank[p] > rank[best]) best = p;
  }
  return seenKnown ? best : 'open-field';
}

/** Base positional contribution per choice type (Plan Part 3, Layer B). */
const MAGNITUDE_CHOICE_BASE: Record<string, number> = {
  dilemma: 0.5,
  strategic: 0.35,
  relationship: 0.3,
  expression: 0.0,
};

/** Positional contribution per narrative role (Plan Part 3, Layer B). */
const MAGNITUDE_ROLE: Record<string, number> = {
  turn: 0.3,
  payoff: 0.2,
  development: 0.1,
  setup: 0.05,
  release: 0.0,
};

/** Per-`setsUp`-edge contribution, capped (Plan Part 3, Layer B: up to +.25). */
const MAGNITUDE_SETSUP_PER = 0.05;
const MAGNITUDE_SETSUP_CAP = 0.25;

/**
 * Positional magnitude in [0,1] for a NON-encounter unit (Plan Part 3, Layer B).
 * Pure: derived only from signals already on the {@link PlannedScene} — no clock,
 * no randomness. Higher magnitude ⇒ more eligible for the heavy (major) band.
 *
 *   choiceType base + narrativeRole + min(setsUp.length × .05, .25)
 *     + (paysOff non-empty ? +.10) + (explicit stakes ? +.10)
 *
 * Clamped to [0,1]. Story-first: stakes/role/threads are authored intent — this
 * never invents drama, it only reads what the plan already declared.
 */
export function positionalMagnitude(u: PlannedScene): number {
  let m = MAGNITUDE_CHOICE_BASE[u.choiceType ?? ''] ?? 0;
  m += MAGNITUDE_ROLE[u.narrativeRole ?? ''] ?? 0;
  const setsUp = Array.isArray(u.setsUp) ? u.setsUp.length : 0;
  m += Math.min(setsUp * MAGNITUDE_SETSUP_PER, MAGNITUDE_SETSUP_CAP);
  if (Array.isArray(u.paysOff) && u.paysOff.length > 0) m += 0.1;
  if (typeof u.stakes === 'string' && u.stakes.trim().length > 0) m += 0.1;
  if (m < 0) m = 0;
  if (m > 1) m = 1;
  return m;
}

/** A permissible [floor, ceil] tier band plus a preferred tier within it. */
export interface TierProposal {
  floor: ConsequenceTier;
  ceil: ConsequenceTier;
  preferred: ConsequenceTier;
}

/** Resolve the episode role(s) for a unit from ctx.roleByEpisode. */
function rolesForUnit(u: PlannedScene, ctx?: BudgetContext): StructuralRole[] | undefined {
  return ctx?.roleByEpisode?.[u.episodeNumber];
}

/**
 * The posture-derived ceiling for a NON-encounter unit's heavy band (Layer C):
 *  - convergent / open-field-short → `branchlet` (no runway for a durable branch);
 *  - open-field → `branch`.
 * Encounters are exempt (they carry durable branches anywhere via outcome trees).
 */
function postureCeil(posture: EpisodePosture): ConsequenceTier {
  return posture === 'open-field' ? 'branch' : 'branchlet';
}

/**
 * Propose a tier band + preferred tier for one unit honoring Layer A (eligibility
 * bands by choice type / kind) AND Layer C (posture cap on non-encounter majors).
 * Pure and deterministic. `majorThreshold` (τ) is supplied by the caller's
 * closed-form auto-tune so the count of scene-majors matches the reserved heavy
 * allotment.
 *
 * Layer A:
 *  - expression → callback only (unchanged invariant);
 *  - encounter, branch-point → branch (floor branchlet, ceil branch);
 *  - encounter, non-branch-point → branchlet, escalating to branch at pinch2/climax;
 *  - dilemma → at least branchlet (heavy band);
 *  - relationship/strategic → magnitude ≥ τ ⇒ heavy band, else light band.
 *
 * Layer C: a non-encounter's heavy ceiling is the posture ceiling; resolution
 * leans callback (its preferred light tier is callback, not tint).
 */
export function proposeTierPositional(
  u: PlannedScene,
  roles: StructuralRole[] | undefined,
  majorThreshold: number,
): TierProposal {
  const posture = episodePosture(roles);

  // --- Encounters (Layer A, Layer D spine population) ----------------------
  if (isEncounter(u)) {
    const escalates =
      Array.isArray(roles) && (roles.includes('pinch2') || roles.includes('climax'));
    if (isBranchPointEncounter(u)) {
      // Durable forks live at branch.
      return { floor: 'branchlet', ceil: 'branch', preferred: 'branch' };
    }
    // Non-branch encounter: branchlet, → branch at peak stakes.
    return {
      floor: 'branchlet',
      ceil: 'branch',
      preferred: escalates ? 'branch' : 'branchlet',
    };
  }

  // --- Expression (Layer A: callback only) ---------------------------------
  if (u.choiceType === 'expression') {
    return { floor: 'callback', ceil: 'callback', preferred: 'callback' };
  }

  // --- Non-encounter major-vs-minor (Layer B magnitude + Layer C posture) --
  const heavyCeil = postureCeil(posture);
  const isDilemma = u.choiceType === 'dilemma';
  const magnitude = positionalMagnitude(u);
  // Dilemmas always sit in the heavy band (floor branchlet). Others go heavy
  // only when magnitude clears τ.
  const heavy = isDilemma || magnitude >= majorThreshold;

  if (heavy) {
    // Heavy band: [branchlet, postureCeil]. Prefer the posture ceiling so an
    // open-field major can reach branch while a convergent one caps at branchlet.
    return { floor: 'branchlet', ceil: heavyCeil, preferred: heavyCeil };
  }

  // Light band: [callback, tint]. Resolution episodes lean callback (no runway
  // to even tint a fork); everything else prefers tint as its texture default.
  const leansCallback = Array.isArray(roles) && roles.includes('resolution');
  return {
    floor: 'callback',
    ceil: 'tint',
    preferred: leansCallback ? 'callback' : 'tint',
  };
}

/**
 * Closed-form auto-tune of the major threshold τ (Plan Part 11, risk 1): pick τ
 * so the number of standard-scene non-encounter, non-expression units whose
 * magnitude clears τ matches the reserved scene-heavy allotment. A single
 * deterministic pass over the sorted magnitudes — NO iteration / oscillation.
 *
 * `reservedSceneHeavy` is the count of scene units the budget reserves for the
 * heavy (branchlet/branch) band. We sort eligible magnitudes descending and set
 * τ just below the k-th magnitude (k = reservedSceneHeavy), so exactly the top-k
 * clear it. Dilemmas are always heavy and are NOT counted here (they do not
 * compete for the reserved slots). Ties at the boundary resolve inclusively
 * (everyone at the cutoff magnitude is heavy) — deterministic given identical
 * input.
 */
export function autoTuneMajorThreshold(
  units: PlannedScene[],
  reservedSceneHeavy: number,
): number {
  // Eligible = non-encounter, non-expression, non-dilemma scene units (the ones
  // whose major-ness is decided by magnitude vs τ).
  const magnitudes = units
    .filter(
      (u) =>
        !isEncounter(u) &&
        u.choiceType !== 'expression' &&
        u.choiceType !== 'dilemma',
    )
    .map((u) => positionalMagnitude(u))
    .sort((a, b) => b - a);

  if (magnitudes.length === 0) return Number.POSITIVE_INFINITY;
  const k = Math.max(0, Math.min(reservedSceneHeavy, magnitudes.length));
  if (k <= 0) {
    // No reserved heavy slots → τ above the max, so nobody clears it.
    return magnitudes[0] + 1;
  }
  if (k >= magnitudes.length) {
    // Everyone eligible is heavy → τ at/below the smallest magnitude.
    return magnitudes[magnitudes.length - 1];
  }
  // τ = the k-th largest magnitude: the top-k (≥ τ) are heavy.
  return magnitudes[k - 1];
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
 *
 * @param ctx Optional consequence-intelligence context (Plan Parts 2–6).
 *   Foundation phase: UNUSED — present so later phases can read positional /
 *   charge signals without changing this signature. Behavior is identical
 *   whether or not it is passed.
 */
export function allocateConsequenceTiers(units: PlannedScene[], ctx?: BudgetContext): void {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);
  if (units.length === 0 || totalWeight <= 0) return;

  // Phase 3 (Plan Part 4, Layer E): dramatic charge. Active ONLY when the
  // CONSEQUENCE_CHARGE flag is on. It applies the positional band first, then
  // Rule 1 (high inbound charge elevates a unit into the heavy band) and Rule 2 /
  // the hollow-branch ban (a standard-scene unit may stay heavy only if charged or
  // an encounter — uncharged would-be majors are DEMOTED). It takes precedence
  // over Phase 2 / Phase 1 / the legacy slot machine. Flag off → fall through.
  if (consequenceFlags().charge) {
    allocateConsequenceTiersCharge(units, ctx);
    return;
  }

  // Phase 2 (Plan Part 3, Layer D): two-population budget. Active ONLY when the
  // CONSEQUENCE_TWO_POP flag is on. It budgets the encounter spine by invariant
  // and the standard-scene texture against SCENE_CONSEQUENCE_TARGET, so it takes
  // precedence over the Phase-1 positional path and the legacy slot machine. With
  // the flag off, fall through below — byte-identical behavior.
  if (consequenceFlags().twoPop) {
    allocateConsequenceTiersTwoPop(units, ctx);
    return;
  }

  // Phase 1 (Plan Part 3, Layers A–C): positional tiering. Active ONLY when the
  // CONSEQUENCE_POSITIONAL flag is on AND an episode-role map is supplied. With
  // the flag off (or no roleByEpisode), fall through to the legacy slot machine
  // below — byte-identical behavior.
  if (consequenceFlags().positional && ctx?.roleByEpisode) {
    allocateConsequenceTiersPositional(units, ctx);
    return;
  }
  void ctx;

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

/**
 * Phase 1 positional tier allocation (Plan Part 3, Layers A–C), gated by
 * `CONSEQUENCE_POSITIONAL`. Each unit gets a [floor, ceil] band + a preferred
 * tier from {@link proposeTierPositional} (positional, posture-capped), then the
 * mix is reconciled toward {@link CONSEQUENCE_TARGET} with the SAME
 * largest-remainder budget as the legacy path — but only WITHIN each unit's band,
 * and flexing the LIGHT (minor) scenes first so authored heavy moments stay heavy.
 *
 * Story-first guardrails (Plan Part 7): positional magnitude reads only authored
 * intent (role / stakes / setup edges); the posture cap means a convergent
 * episode never gets a non-encounter durable branch; reconciliation never pushes
 * a unit outside its band, so it can under-allocate (leave the heavy budget
 * unspent) but never fabricate a heavier fork than position earns. Pure /
 * deterministic — no clock, no randomness.
 */
function allocateConsequenceTiersPositional(units: PlannedScene[], ctx: BudgetContext): void {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);

  // Reserved scene-heavy allotment: the weighted heavy budget (branchlet+branch)
  // is the supply; encounters are heavy by invariant and consume it first, so
  // what remains is reserved for scene-majors. We solve τ so the count of
  // scene-majors matches that residual (in unit count, since scenes weigh 1).
  const tierBudget = largestRemainder<ConsequenceTier>(totalWeight, TIER_ORDER, CONSEQUENCE_TARGET);
  const heavyBudgetWeight = tierBudget.branchlet + tierBudget.branch;
  // Encounters are heavy by invariant; they claim heavy budget first.
  const encounterHeavyWeight = units
    .filter((u) => isEncounter(u))
    .reduce((s, u) => s + weightOf(u), 0);
  // Dilemmas are heavy by invariant too (Layer A floor branchlet) and also draw
  // from the heavy budget.
  const dilemmaHeavyWeight = units
    .filter((u) => !isEncounter(u) && u.choiceType === 'dilemma')
    .reduce((s, u) => s + weightOf(u), 0);
  const reservedSceneHeavy = Math.max(
    0,
    heavyBudgetWeight - encounterHeavyWeight - dilemmaHeavyWeight,
  );

  const tau = autoTuneMajorThreshold(units, reservedSceneHeavy);

  // Pass 1: positional proposal → preferred tier, clamped by the hard invariants
  // (clampTier), recording each unit's permissible band for the reconcile pass.
  const band = new Map<PlannedScene, TierProposal>();
  for (const u of units) {
    const proposal = proposeTierPositional(u, rolesForUnit(u, ctx), tau);
    band.set(u, proposal);
    u.consequenceTier = clampTier(u, proposal.preferred);
  }

  // Pass 2: reconcile the realized heavy mass toward the heavy budget, flexing
  // the LIGHT (minor) scenes first and only WITHIN each unit's band. We never
  // touch encounters/dilemmas (heavy by invariant) or push a unit past its
  // posture ceiling. If we are OVER the heavy budget, demote the lowest-magnitude
  // flexible majors down to their light band; if UNDER, we do NOT fabricate forks
  // (honest under-allocation, Plan Part 7.3) — light scenes stay light.
  const HEAVY = TIER_RANK.branchlet;
  const realizedHeavyWeight = units
    .filter((u) => TIER_RANK[u.consequenceTier ?? 'callback'] >= HEAVY)
    .reduce((s, u) => s + weightOf(u), 0);

  let overBy = realizedHeavyWeight - heavyBudgetWeight;
  if (overBy > 0) {
    // Flexible majors = non-encounter, non-dilemma scene units currently heavy
    // whose band floor is below branchlet (i.e. they CAN be demoted to light).
    const flexible = units
      .filter(
        (u) =>
          !isEncounter(u) &&
          u.choiceType !== 'dilemma' &&
          TIER_RANK[u.consequenceTier ?? 'callback'] >= HEAVY &&
          TIER_RANK[band.get(u)!.floor] < HEAVY,
      )
      // Lowest positional magnitude demoted first (least-earned major goes), ties
      // broken by scene order for determinism.
      .sort(
        (a, b) =>
          positionalMagnitude(a) - positionalMagnitude(b) || a.order - b.order,
      );
    for (const u of flexible) {
      if (overBy <= 0) break;
      // Demote into the LIGHT band: resolution leans callback, else tint. The
      // hard invariants (clampTier) still apply; for a flexible scene-major the
      // floor is callback, so this lands at the requested light tier.
      const leansCallback = (rolesForUnit(u, ctx) ?? []).includes('resolution');
      const demoted = clampTier(u, leansCallback ? 'callback' : 'tint');
      if (TIER_RANK[demoted] < HEAVY) {
        overBy -= weightOf(u);
        u.consequenceTier = demoted;
      }
    }
  }
}

// ========================================
// CHARGE TIERING (Plan Part 4, Layer E) — gated by CONSEQUENCE_CHARGE
// ========================================

/** The dramatic charge at a unit, read from `ctx.chargeMap` (0 if absent). */
function chargeForUnit(u: PlannedScene, ctx?: BudgetContext): number {
  return ctx?.chargeMap?.get(u.id) ?? 0;
}

/**
 * Phase 3 charge tier allocation (Plan Part 4, Layer E), gated by
 * `CONSEQUENCE_CHARGE`. Runs the positional band/proposal first (Layers A–C), then
 * applies the two rules that make the charge axis bite:
 *
 *  - **Rule 1 — charge elevates.** A unit whose inbound charge clears
 *    {@link TAU_CHARGE} is forced into the heavy band regardless of its choiceType
 *    base (`magnitude(unit) = max(positional, charge)`), capped by its posture
 *    ceiling (a convergent episode still cannot get a non-encounter durable
 *    branch). Encounters and dilemmas are already heavy by invariant.
 *  - **Rule 2 — no charge, no branch (hollow-branch ban).** A standard-scene unit
 *    may occupy branchlet/branch ONLY if `charge ≥ TAU_CHARGE` OR it is an
 *    encounter. A would-be major (positional or authored) that lacks charge is
 *    DEMOTED to its light band — honest under-allocation (Plan Part 7 #3): we never
 *    fabricate the charge to keep a hollow fork.
 *
 * Each unit records {@link PlannedScene.tierRationale} + `chargeScore` for the
 * diagnostics trail (never read by the player — fiction-first, Plan Part 7 #6).
 *
 * Story-first guardrails: charge is sourced only from anchored authored edges plus
 * a capped stat term ({@link computeChargeMap}); stat charge alone can never clear
 * TAU_CHARGE, so it can never manufacture a branch (Plan Part 7 #1). Pure /
 * deterministic — charge comes from a precomputed map, no clock, no randomness.
 */
function allocateConsequenceTiersCharge(units: PlannedScene[], ctx?: BudgetContext): void {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);

  // Reserved scene-heavy allotment + τ solve, exactly as the positional path: the
  // positional proposal is the starting point onto which charge rules are layered.
  const tierBudget = largestRemainder<ConsequenceTier>(totalWeight, TIER_ORDER, CONSEQUENCE_TARGET);
  const heavyBudgetWeight = tierBudget.branchlet + tierBudget.branch;
  const encounterHeavyWeight = units
    .filter((u) => isEncounter(u))
    .reduce((s, u) => s + weightOf(u), 0);
  const dilemmaHeavyWeight = units
    .filter((u) => !isEncounter(u) && u.choiceType === 'dilemma')
    .reduce((s, u) => s + weightOf(u), 0);
  const reservedSceneHeavy = Math.max(
    0,
    heavyBudgetWeight - encounterHeavyWeight - dilemmaHeavyWeight,
  );
  const tau = autoTuneMajorThreshold(units, reservedSceneHeavy);

  const HEAVY = TIER_RANK.branchlet;

  for (const u of units) {
    const roles = rolesForUnit(u, ctx);
    const proposal = proposeTierPositional(u, roles, tau);
    const charge = chargeForUnit(u, ctx);
    u.chargeScore = charge;

    // Encounters / dilemmas / expression: positional proposal stands (heavy by
    // invariant for the first two; callback-only for expression). Rule 2 exempts
    // encounters; dilemmas are an authored value-test, not a hollow standard scene.
    if (isEncounter(u) || u.choiceType === 'dilemma' || u.choiceType === 'expression') {
      u.consequenceTier = clampTier(u, proposal.preferred);
      u.tierRationale = isEncounter(u)
        ? 'encounter spine: heavy by invariant'
        : u.choiceType === 'dilemma'
          ? 'dilemma: heavy by invariant (value-test)'
          : 'expression: callback-only invariant';
      continue;
    }

    // --- Standard non-encounter, non-dilemma unit: charge rules apply ---------
    const positionalHeavy = TIER_RANK[proposal.preferred] >= HEAVY;
    const charged = charge >= TAU_CHARGE;
    const inResolution = Array.isArray(roles) && roles.includes('resolution');

    if (charged && inResolution) {
      // Resolution is the terminal aftermath — there is no runway left to
      // reconverge a fork (Plan Part 3 Layer C: resolution is callback-dominant).
      // A charged resolution scene discharges as acknowledgment, NOT a new branch.
      u.consequenceTier = clampTier(u, 'callback');
      u.tierRationale = 'charged but in resolution: callback-dominant (no runway, Layer C)';
      continue;
    }

    if (charged) {
      // Rule 1: charge elevates into the heavy band (capped by the posture ceiling
      // via proposal.ceil). Prefer the posture ceiling so an open-field charged
      // unit can reach branch while a convergent one caps at branchlet.
      const elevated = clampTier(u, proposal.ceil);
      u.consequenceTier = TIER_RANK[elevated] >= HEAVY ? elevated : clampTier(u, 'branchlet');
      u.tierRationale = positionalHeavy
        ? 'charged + positional major: heavy band (posture-capped)'
        : 'Rule 1: high inbound charge elevated an otherwise-light unit';
      continue;
    }

    // Uncharged unit.
    if (positionalHeavy) {
      // Rule 2 / hollow-branch ban: a would-be major with no charge behind it is
      // DEMOTED to its light band rather than fabricating a hollow fork (honest
      // under-allocation, Plan Part 7 #3).
      const leansCallback = Array.isArray(roles) && roles.includes('resolution');
      u.consequenceTier = clampTier(u, leansCallback ? 'callback' : 'tint');
      u.tierRationale = 'Rule 2 (hollow-branch ban): under-charged major demoted to light';
    } else {
      // Already light: keep the positional light preference.
      u.consequenceTier = clampTier(u, proposal.preferred);
      u.tierRationale = 'light texture: positional minor, uncharged';
    }
  }
}

// ========================================
// TWO-POPULATION TIERING (Plan Part 3, Layer D) — gated by CONSEQUENCE_TWO_POP
// ========================================

/**
 * The encounter-spine invariant tier for one encounter (Plan Part 3, Layer D):
 * branch-point encounters carry the durable fork (`branch`); other encounters
 * are `branchlet`, escalating to `branch` at peak stakes (pinch2 / climax).
 *
 * Encounters are *meant* to be heavy — they are NOT measured against the
 * scene-texture %; this invariant is their whole budget. `roles` is the episode's
 * structuralRole(s) (from `ctx.roleByEpisode`); when absent, no escalation fires
 * (a non-branch encounter stays `branchlet`) — deterministic either way. Pure.
 */
export function encounterSpineTier(
  u: PlannedScene,
  roles: StructuralRole[] | undefined,
): ConsequenceTier {
  if (isBranchPointEncounter(u)) return 'branch';
  const escalates =
    Array.isArray(roles) && (roles.includes('pinch2') || roles.includes('climax'));
  return escalates ? 'branch' : 'branchlet';
}

/**
 * The spine-derived heavy-tier band (Plan Part 3, Layer D) the validator reports
 * total heavy-tier mass against, instead of the fixed unified 25%. Encounters are
 * heavy by invariant, so the floor of the band is the encounter weight's share of
 * the season total; a small `sceneReserve` (the scene-only heavy %
 * `SCENE_CONSEQUENCE_TARGET.branchlet + .branch`, applied to scene weight) adds
 * the deliberate non-encounter majors on top.
 *
 * Returns the expected heavy-tier percentage [0,100]. Pure / deterministic.
 */
export function spineDerivedHeavyPercent(units: PlannedScene[]): number {
  const totalWeight = units.reduce((s, u) => s + weightOf(u), 0);
  if (totalWeight <= 0) return 0;
  const encounterWeight = units
    .filter((u) => isEncounter(u))
    .reduce((s, u) => s + weightOf(u), 0);
  const sceneWeight = totalWeight - encounterWeight;
  const sceneHeavyPct =
    (SCENE_CONSEQUENCE_TARGET.branchlet ?? 0) + (SCENE_CONSEQUENCE_TARGET.branch ?? 0);
  const sceneReserveWeight = (sceneWeight * sceneHeavyPct) / 100;
  return ((encounterWeight + sceneReserveWeight) / totalWeight) * 100;
}

/**
 * Phase 2 two-population tier allocation (Plan Part 3, Layer D), gated by
 * `CONSEQUENCE_TWO_POP`. Budgets two populations with two policies:
 *
 *  - **Encounter spine** — by invariant only ({@link encounterSpineTier}):
 *    branch-point → `branch`; others → `branchlet` (→ `branch` at pinch2/climax).
 *    Encounters are NOT measured against the scene-texture %.
 *  - **Standard-scene texture** — the season % re-expressed over scene-only weight
 *    ({@link SCENE_CONSEQUENCE_TARGET}, e.g. callback 60 / tint 30 / branchlet 8 /
 *    branch 2) via largest-remainder, each unit clamped WITHIN its own band
 *    (Layer A invariants via {@link clampTier}).
 *
 * Story-first guardrails (Plan Part 7): the scene texture reserves only a small,
 * deliberate number of non-encounter majors and never pushes a unit past its band,
 * so it can under-allocate (honest under-allocation, 7.3) but never fabricate a
 * heavier fork than a unit's invariants permit. Pure / deterministic — no clock,
 * no randomness, stable scene order.
 */
function allocateConsequenceTiersTwoPop(units: PlannedScene[], ctx?: BudgetContext): void {
  const encounters: PlannedScene[] = [];
  const scenes: PlannedScene[] = [];
  for (const u of units) {
    if (isEncounter(u)) encounters.push(u);
    else scenes.push(u);
  }

  // --- Population 1: the encounter spine (invariant) -----------------------
  for (const u of encounters) {
    const tier = encounterSpineTier(u, rolesForUnit(u, ctx));
    // clampTier keeps the hard invariants (encounter floor branchlet) intact.
    u.consequenceTier = clampTier(u, tier);
  }

  // --- Population 2: the standard-scene texture (SCENE_CONSEQUENCE_TARGET) --
  const sceneWeight = scenes.reduce((s, u) => s + weightOf(u), 0);
  if (sceneWeight <= 0) return;

  // Honor pre-authored, invariant-satisfying scene tiers first; debit the budget.
  const sceneBudget = largestRemainder<ConsequenceTier>(
    sceneWeight,
    TIER_ORDER,
    SCENE_CONSEQUENCE_TARGET,
  );
  const debit = (tier: ConsequenceTier, weight: number): void => {
    sceneBudget[tier] = Math.max(0, sceneBudget[tier] - weight);
  };

  // Within [floor, ceil] for the unit, pick the funded tier with the most
  // remaining scene budget, tie-breaking toward the LIGHTER tier (scene texture
  // skews light by what is left). Falls back to the floor when nothing is funded,
  // so the invariants always hold (and so we under-allocate honestly rather than
  // overshoot).
  const pickTier = (u: PlannedScene): ConsequenceTier => {
    const lo = TIER_RANK[tierFloor(u)];
    const hi = TIER_RANK[tierCeil(u)];
    let best: ConsequenceTier | null = null;
    let bestScore = -Infinity;
    for (let r = lo; r <= hi; r++) {
      const tier = TIER_ORDER[r];
      if (sceneBudget[tier] <= 0) continue;
      // Primary: remaining budget. Secondary: prefer the lighter tier (hi - r).
      const score = sceneBudget[tier] * 4 + (hi - r);
      if (score > bestScore) {
        bestScore = score;
        best = tier;
      }
    }
    return best ?? tierFloor(u);
  };

  const unassigned: PlannedScene[] = [];
  for (const u of scenes) {
    const authored = u.consequenceTier;
    if (authored && TIER_ORDER.includes(authored)) {
      const clamped = clampTier(u, authored);
      if (clamped === authored) {
        u.consequenceTier = authored;
        debit(authored, weightOf(u));
        continue;
      }
    }
    unassigned.push(u);
  }

  for (const u of unassigned) {
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
