/**
 * Convergence Ledger Validator (Plan Part 9, plan-time intent pass).
 *
 * Checks the {@link ConvergenceLedger} produced by
 * {@link buildConvergenceLedger} against the season plan, holding the story-first
 * invariants of Plan Part 7 as code (not comments):
 *
 *  1. **Forward in time** — every edge plants before it pays off
 *     (`order(from) < order(to)`). Charge flows plant→payoff; a backward or
 *     self edge is a contradiction (a payoff before its setup).
 *  2. **No anchorless heavy edge** — every edge must carry an `anchorId`, and an
 *     anchorless edge above the stat cap is illegal (Plan Part 7 #1–2: a meter
 *     with no narrative object behind it can never manufacture a major moment).
 *  3. **Charge-coverage** — every heavy-tier unit (`branchlet`/`branch`) in the
 *     plan has ≥1 INBOUND anchored edge. A heavy tier with nothing behind it is a
 *     hollow branch (Rule 2). Encounters are exempt (heavy by invariant — their
 *     branch-ness is the spread of their own outcome tree, not an inbound plant).
 *  4. **Major promises detonate** — every MAJOR `promise` thread pays off at a
 *     heavy tier; a major promise that fizzles into `tint`/`callback` is an
 *     unkept stakes-commitment (Plan Part 9: "does not fizzle into tint").
 *
 * Default-advisory: it returns issues for the diagnostics trail; gating is the
 * caller's choice. Pure / deterministic — order is read from the plan's scene
 * array, no clock, no randomness.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type {
  ConvergenceLedger,
} from '../../types/convergenceLedger';
import type {
  ConsequenceTier,
  PlannedScene,
  SeasonScenePlan,
} from '../../types/scenePlan';
import type { ThreadLedger } from '../../types/narrativeThread';
import { STAT_CHARGE_CAP } from '../pipeline/chargeMap';

/** Heaviness rank for consequence tiers (heavy = branchlet/branch). */
const TIER_RANK: Record<ConsequenceTier, number> = {
  callback: 0,
  tint: 1,
  branchlet: 2,
  branch: 3,
};
const HEAVY_RANK = TIER_RANK.branchlet;

/** Optional context for the ledger validator. */
export interface ConvergenceLedgerValidatorContext {
  /**
   * The season's {@link ThreadLedger}, when available — needed to check that
   * every MAJOR `promise` thread detonates at a heavy tier. Absence is tolerated
   * (the promise-detonation check simply does not fire).
   */
  threadLedger?: ThreadLedger;
}

export class ConvergenceLedgerValidator extends BaseValidator {
  constructor() {
    super('ConvergenceLedgerValidator');
  }

  validate(
    plan: SeasonScenePlan,
    ledger: ConvergenceLedger,
    ctx?: ConvergenceLedgerValidatorContext,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Global scene order: index in the plan's (planned-order) scenes array. This
    // is the canonical reading order, so a forward edge has from-index < to-index.
    const orderById = new Map<string, number>();
    const sceneById = new Map<string, PlannedScene>();
    plan.scenes.forEach((s, i) => {
      orderById.set(s.id, i);
      sceneById.set(s.id, s);
    });

    // --- 1) Forward in time + 2) anchorless-edge rules -----------------------
    for (const edge of ledger.edges) {
      const anchor = typeof edge.anchorId === 'string' ? edge.anchorId.trim() : '';
      if (anchor.length === 0) {
        // Anchorless at all is a story-first violation; anchorless ABOVE the stat
        // cap is the hard error (a meter manufacturing a major moment). We treat
        // any anchorless edge whose magnitude exceeds the cap as an error.
        if (edge.magnitude > STAT_CHARGE_CAP) {
          issues.push(this.error(
            `Ledger edge ${edge.from}→${edge.to} (source '${edge.source}', magnitude ${edge.magnitude}) has no anchorId and exceeds the stat cap (${STAT_CHARGE_CAP}); charge above the cap must name an authored narrative object.`,
            `ledgerEdge:${edge.from}->${edge.to}`,
            'Attach an anchorId (the authored thread/milestone/trajectory object), lower the magnitude below the stat cap, or drop the edge.',
          ));
        } else {
          issues.push(this.warning(
            `Ledger edge ${edge.from}→${edge.to} (source '${edge.source}') has no anchorId; every edge should name the authored object behind it.`,
            `ledgerEdge:${edge.from}->${edge.to}`,
            'Attach an anchorId so the charge is anchored to authored intent.',
          ));
        }
      }

      const fromOrder = orderById.get(edge.from);
      const toOrder = orderById.get(edge.to);
      if (fromOrder === undefined || toOrder === undefined) {
        // An edge referencing a scene not in the plan cannot be ordered; flag it
        // so the projection is not silently trusting a dangling reference.
        issues.push(this.warning(
          `Ledger edge ${edge.from}→${edge.to} references a scene not present in the plan; cannot verify it points forward in time.`,
          `ledgerEdge:${edge.from}->${edge.to}`,
          'Ensure both endpoints are scenes in the season plan.',
        ));
        continue;
      }
      if (fromOrder >= toOrder) {
        issues.push(this.error(
          `Ledger edge ${edge.from}→${edge.to} does not point forward in time (from-order ${fromOrder} ≥ to-order ${toOrder}); charge must flow plant→payoff (earlier→later).`,
          `ledgerEdge:${edge.from}->${edge.to}`,
          'A plant must precede its payoff. Re-order the scenes or flip the edge so it points forward.',
        ));
      }
    }

    // --- 3) Charge-coverage: every heavy-tier unit has an inbound anchored edge
    const anchoredInbound = new Set<string>();
    for (const edge of ledger.edges) {
      const anchor = typeof edge.anchorId === 'string' ? edge.anchorId.trim() : '';
      if (anchor.length > 0) anchoredInbound.add(edge.to);
    }
    for (const scene of plan.scenes) {
      const tier = scene.consequenceTier;
      if (!tier) continue;
      if (TIER_RANK[tier] < HEAVY_RANK) continue;
      // Encounters are heavy by invariant — their branch-ness is the spread of
      // their own outcome tree, not an inbound plant — so they are exempt.
      if (scene.kind === 'encounter') continue;
      if (!anchoredInbound.has(scene.id)) {
        issues.push(this.error(
          `Heavy-tier unit "${scene.id}" (consequence '${tier}') has no inbound anchored edge; a branch must name the authored thread/arc/twist it serves (Rule 2 / hollow-branch ban).`,
          `chargeCoverage:${scene.id}`,
          'Plant an upstream charge (a thread/trajectory/setup edge into this scene), or demote it to a light tier (tint/callback).',
        ));
      }
    }

    // --- 4) Major promise threads detonate at a heavy tier -------------------
    const threadLedger = ctx?.threadLedger;
    if (threadLedger) {
      for (const thread of threadLedger.threads) {
        if (thread.priority !== 'major' || thread.kind !== 'promise') continue;
        if (thread.payoffs.length === 0) continue;
        const detonatesHeavy = thread.payoffs.some((p) => {
          const scene = sceneById.get(p.sceneId);
          const tier = scene?.consequenceTier;
          return tier ? TIER_RANK[tier] >= HEAVY_RANK : false;
        });
        if (!detonatesHeavy) {
          issues.push(this.error(
            `Major promise thread "${thread.id}" (${thread.label}) does not detonate at a heavy tier; its payoff scenes are all light, so the stakes-commitment fizzles into tint/callback.`,
            `promiseDetonation:${thread.id}`,
            'Raise at least one payoff scene of this major promise to a heavy tier (branchlet/branch), or downgrade the thread.',
          ));
        }
      }
    }

    return finalize(issues);
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const score = Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
