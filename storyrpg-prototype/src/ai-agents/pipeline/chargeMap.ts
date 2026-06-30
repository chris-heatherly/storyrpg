/**
 * Dramatic-charge pre-pass (Plan Part 4 — Layer E), gated by `CONSEQUENCE_CHARGE`.
 *
 * `charge(scene)` is the second axis of consequence weight (Plan Part 2): how much
 * accumulated, primed state *discharges here*. Where {@link positionalMagnitude}
 * answers "what KIND of moment is this, and where in the spine?", charge answers
 * "what authored plants converge and detonate at this scene?". The allocator reads
 * both: `magnitude(unit) = max(positional, charge)`.
 *
 * Charge is a FORWARD FLOW along the scene graph, not a per-row scalar. Two edge
 * families feed it (Plan Part 4 table):
 *
 *   1. **Setup in-degree** — every `setupPayoffEdge` (from `setsUp`/`paysOff`)
 *      flows charge from its plant (`from`) forward to its payoff (`to`). The
 *      number of plants converging on a scene is its setup in-degree; many plants
 *      converging ⇒ a load-bearing detonation.
 *   2. **Convergence-ledger edges** — when a {@link ConvergenceLedger} is supplied,
 *      its thread / relationship / identity / score / … edges flow charge to their
 *      `to` scene too (the same direction), aggregated via {@link aggregateCharge}.
 *
 * **Aggregation (documented):** charge at a scene is the SUM of the magnitudes of
 * every edge whose `to` is that scene — i.e. inbound edges accumulate at the
 * convergence node. This is a single deterministic forward pass: edges already
 * point plant→payoff (earlier→later), so summing inbound magnitude at each node is
 * the forward flow. The result is then normalized into [0,1] so it is directly
 * comparable to {@link positionalMagnitude}. Pure / deterministic — no clock, no
 * randomness; the same (plan, ledger) always yields the same map.
 *
 * **Story-first split (Plan Part 7 #1).** Charge has two components:
 *  - `narrativeIntentCharge` — anchored edges (threads, milestones, trajectory
 *    targets, setup edges): each names an authored object. This is PRIMARY and may
 *    elevate a moment to the heavy band on its own.
 *  - `statTrajectoryCharge` — a bare meter crossing (`source: 'score'`). This is a
 *    bounded CONFIRMING multiplier, capped (see {@link STAT_CHARGE_CAP}) so a score
 *    hitting a cutoff with no narrative object behind it can NEVER manufacture a
 *    branch on its own. The cap is enforced against the major threshold: stat
 *    charge alone always stays strictly below `tau_charge`.
 */

import { aggregateCharge } from '../../types/convergenceLedger';
import type {
  ConvergenceLedger,
  ConvergenceSource,
} from '../../types/convergenceLedger';
import type { SeasonScenePlan } from '../../types/scenePlan';

/**
 * The charge threshold a standard-scene unit must clear to be allowed into the
 * heavy band (Rule 2, Plan Part 4). A unit at/above `TAU_CHARGE` is "charged"; a
 * unit below it may not occupy branchlet/branch unless it is an encounter. Chosen
 * conservatively in the normalized [0,1] charge space — a single inbound major
 * edge (or a couple of convergent setup plants) clears it, a lone light plant does
 * not.
 */
export const TAU_CHARGE = 0.5;

/**
 * The cap on `statTrajectoryCharge` (Plan Part 7 #1, Part 11 risk 4). Stat charge
 * is a confirming multiplier, never a driver: it is clamped to this fraction of
 * {@link TAU_CHARGE} so a bare meter crossing can NEVER, on its own, lift a unit to
 * or past the charge threshold (and therefore can never manufacture a heavy tier).
 * Start conservative (Part 11 #4 suggests ≤30% of the elevation needed).
 */
export const STAT_CHARGE_CAP = TAU_CHARGE * 0.3;

/**
 * Ledger sources whose charge is a bare meter crossing — the only "stat
 * trajectory" lane (Plan Part 7 #1). Everything else (thread / relationship /
 * identity / skill / attribute / flag / item / delayed / setupPayoff) names an
 * authored narrative object and counts as `narrativeIntentCharge`. Relationship /
 * identity trajectory targets ARE authored objects with anchors (Part 5), so they
 * are intent, not stat.
 */
const STAT_TRAJECTORY_SOURCES: ReadonlySet<ConvergenceSource> = new Set<ConvergenceSource>([
  'score',
]);

/** Per-setup-edge inbound charge contribution (raw, pre-normalization). */
const SETUP_EDGE_CHARGE = 1;

/**
 * The split charge components at a single scene, before combination. All raw
 * (pre-normalization) magnitudes.
 */
export interface SceneChargeParts {
  /** Anchored-edge charge (threads, milestones, trajectories, setup edges). Primary. */
  narrativeIntentCharge: number;
  /** Bare meter-crossing charge (`source: 'score'`). Capped confirming multiplier. */
  statTrajectoryCharge: number;
}

/**
 * The result of the charge pre-pass: per-scene split parts plus the combined,
 * normalized charge map the allocator reads.
 */
export interface ChargeMapResult {
  /** Per-scene raw split (narrative-intent vs stat-trajectory), pre-normalization. */
  parts: Map<string, SceneChargeParts>;
  /**
   * Per-scene combined charge in [0,1], comparable to {@link positionalMagnitude}:
   * `narrativeIntentCharge + min(statTrajectoryCharge, statCapRaw)`, then
   * normalized. The stat term is capped BEFORE combination so it can never push a
   * unit over the heavy threshold on its own.
   */
  charge: Map<string, number>;
}

/**
 * Accumulate the raw inbound charge split for every scene from a season plan's
 * `setupPayoffEdges` and (optionally) a {@link ConvergenceLedger}.
 *
 * Forward flow: each setup edge and each ledger edge contributes its magnitude to
 * its `to` (payoff) scene. Setup edges are anchored structure → narrative intent;
 * ledger edges split by source ({@link STAT_TRAJECTORY_SOURCES} → stat, else
 * intent). Pure / deterministic.
 */
export function computeChargeParts(
  plan: SeasonScenePlan,
  ledger?: ConvergenceLedger,
): Map<string, SceneChargeParts> {
  const parts = new Map<string, SceneChargeParts>();
  const get = (id: string): SceneChargeParts => {
    let p = parts.get(id);
    if (!p) {
      p = { narrativeIntentCharge: 0, statTrajectoryCharge: 0 };
      parts.set(id, p);
    }
    return p;
  };

  // Forward-time guard (Plan Part 6 / Part 11): charge is a FORWARD flow, so an
  // edge only contributes when its plant precedes its payoff in reading order. A
  // backward or self edge (a contributor mistake the ConvergenceLedgerValidator
  // also flags) must NOT add charge to an earlier scene. Scenes with unknown ids
  // are treated permissively (kept) since they cannot be ordered.
  const orderOf = new Map<string, number>();
  plan.scenes.forEach((s, i) => orderOf.set(s.id, i));
  const isForward = (from: string, to: string): boolean => {
    const a = orderOf.get(from);
    const b = orderOf.get(to);
    if (a === undefined || b === undefined) return true;
    return a < b;
  };

  if (ledger) {
    // A ledger is the comprehensive artifact: it ALREADY carries the plan's
    // setupPayoff edges (projected by buildConvergenceLedger). So we read setup
    // in-degree from the ledger, NOT from plan.setupPayoffEdges as well — adding
    // both would double-count setup charge. {@link aggregateCharge} is the
    // documented forward reduction (sum inbound magnitude by `to`); we run it over
    // the FORWARD-filtered edges and split that same flow by source lane
    // (stat-trajectory vs narrative-intent) so the cap applies to the stat portion
    // only. The two lanes always sum back to the aggregate total.
    const forwardEdges = ledger.edges.filter((e) => isForward(e.from, e.to));
    const total = aggregateCharge({ ...ledger, edges: forwardEdges });
    const statByScene = new Map<string, number>();
    for (const edge of forwardEdges) {
      if (STAT_TRAJECTORY_SOURCES.has(edge.source)) {
        statByScene.set(edge.to, (statByScene.get(edge.to) ?? 0) + edge.magnitude);
      }
    }
    for (const [to, totalCharge] of total) {
      const stat = statByScene.get(to) ?? 0;
      const p = get(to);
      p.statTrajectoryCharge += stat;
      // intent = aggregate total minus the stat-lane portion (no double count).
      p.narrativeIntentCharge += totalCharge - stat;
    }
  } else {
    // No ledger supplied: derive setup in-degree directly from the plan's
    // setupPayoffEdges (forward-filtered). Each plant converging on a payoff scene
    // adds one unit of inbound charge.
    for (const edge of plan.setupPayoffEdges) {
      if (!isForward(edge.from, edge.to)) continue;
      get(edge.to).narrativeIntentCharge += SETUP_EDGE_CHARGE;
    }
  }

  return parts;
}

/**
 * Compute the combined, normalized dramatic-charge map for a season plan (Plan
 * Part 4). Returns both the per-scene split {@link SceneChargeParts} and the
 * combined `charge(scene)` in [0,1].
 *
 * Combination per scene:
 *   1. Cap the stat term: `cappedStat = min(statTrajectoryCharge, statCapRaw)`
 *      where `statCapRaw` is {@link STAT_CHARGE_CAP} expressed in the raw
 *      (pre-normalization) scale. This is the story-first guard: stat charge can
 *      never reach the heavy threshold alone.
 *   2. `raw = narrativeIntentCharge + cappedStat`.
 *   3. Normalize all scenes by the max raw narrative-intent charge present (a
 *      single anchored major edge ≈ full charge), then re-clamp the stat term so
 *      that, post-normalization, a stat-only scene stays strictly below
 *      {@link TAU_CHARGE}.
 *
 * `aggregateCharge` is used as the documented ledger reduction; this wrapper adds
 * the setup-edge family, the intent/stat split, the cap, and normalization. Pure /
 * deterministic.
 */
export function computeChargeMap(
  plan: SeasonScenePlan,
  ledger?: ConvergenceLedger,
): ChargeMapResult {
  const parts = computeChargeParts(plan, ledger);

  // Normalization scale: the largest single narrative-intent inbound mass across
  // scenes. We normalize so that the heaviest convergence node maps to ~1.0 and a
  // lone light plant maps well below TAU_CHARGE. If there is no narrative-intent
  // charge anywhere, fall back to the setup-edge unit so setup in-degree still
  // normalizes sensibly.
  let maxIntent = 0;
  for (const p of parts.values()) {
    if (p.narrativeIntentCharge > maxIntent) maxIntent = p.narrativeIntentCharge;
  }
  // Scale floor: SETUP_EDGE_CHARGE * 3, so a LONE setup plant (1/3 ≈ 0.33) stays
  // below TAU_CHARGE while two converging plants (2/3 ≈ 0.67) clear it — "no charge
  // from a single light plant, charge from convergence". A larger maxIntent (a
  // major anchored thread/relationship edge) only raises the scale, never lowers
  // it, so such edges still clear the threshold. Never 0 (avoids divide-by-zero).
  const SCALE_FLOOR = SETUP_EDGE_CHARGE * 3;
  const scale = Math.max(maxIntent, SCALE_FLOOR);

  // Raw stat cap expressed so that, post-normalization, a stat-only scene's charge
  // is strictly below TAU_CHARGE. We want: normalize(cappedStatRaw) <= STAT_CHARGE_CAP.
  // normalize(x) = x / scale, so cappedStatRaw = STAT_CHARGE_CAP * scale.
  const statCapRaw = STAT_CHARGE_CAP * scale;

  const charge = new Map<string, number>();
  for (const [id, p] of parts) {
    const cappedStat = Math.min(p.statTrajectoryCharge, statCapRaw);
    let value = (p.narrativeIntentCharge + cappedStat) / scale;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    charge.set(id, value);
  }

  return { parts, charge };
}
