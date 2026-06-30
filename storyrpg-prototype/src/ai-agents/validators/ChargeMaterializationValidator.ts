/**
 * Charge Materialization Validator (Plan Part 9, the episode-time pass).
 *
 * The plan-time validators (`SeasonBudgetValidator`, `ConvergenceLedgerValidator`)
 * reason over *intent*: a {@link ConvergenceEdge} promises that charge flows from a
 * plant to a payoff scene. This validator is the BACKSTOP for plan-time vs
 * episode-time drift (Plan Part 11 #3): when `ChoiceAuthor` has written the actual
 * {@link Consequence}[] for an episode, it confirms each promise *materialized* —
 * the plant was really authored and really moves its dimension toward the
 * threshold.
 *
 * For every ledger edge whose `to` scene lands in THIS episode, the validator:
 *
 *  1. Looks at the authored {@link Consequence}[] on the `to` scene's choices.
 *  2. Confirms a consequence of the edge's `source` family is present AND moves
 *     the dimension in the promised direction (toward its threshold). When the
 *     caller supplies a {@link MaterializationTarget} (the planned dimension key +
 *     direction), the match is exact; absent a target it falls back to
 *     source-family presence.
 *  3. Sets `edge.materialized` accordingly (a pure annotation on a copy — the
 *     input ledger is not mutated).
 *
 * A HEAVY-tier (`branchlet`/`branch`) unit whose inbound charge never materialized
 * is a **hollow branch** (Plan Part 9, Rule 2 at episode time) — an error-severity
 * finding sent back through the repair pipeline. Lighter tiers that fail to
 * materialize are advisory (a plant that thinned out, not a structural lie).
 *
 * The five-factor checklist as the materialization gauge (Plan Part 9): a
 * high-charge discharge naturally affects ≥3 of Outcome/Process/Information/
 * Relationship/Identity. This validator reuses that idea — a heavy edge whose
 * payoff scene's consequences touch fewer than {@link FIVE_FACTOR_MIN} of the five
 * factors is flagged as an under-materialized major (advisory), the same signal
 * the {@link FiveFactorValidator} enforces per choice.
 *
 * STORY-FIRST GUARDRAILS (Plan Part 7), held as code:
 *  - Encounters are EXEMPT from the hollow-branch error — their branch-ness is the
 *    spread of their own outcome tree, not an inbound plant (mirrors
 *    {@link ConvergenceLedgerValidator}'s charge-coverage exemption).
 *  - A `score`-sourced edge alone never escalates to a hollow-branch error: a bare
 *    meter is confirming evidence, never the load-bearing reason a branch is heavy
 *    (Part 7 #1, the stat cap). It materializes as advisory only.
 *  - Fiction-first: none of this reaches the player — it is generator-internal
 *    quality machinery (`docs/STORY_QUALITY_CONTRACT.md`).
 *
 * Pure / deterministic — no clock, no randomness. The same (plan, ledger, episode,
 * authored consequences) always yields the same result and the same
 * `edge.materialized` flags. Unit-testable without a live run.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { ConvergenceEdge, ConvergenceLedger } from '../../types/convergenceLedger';
import type { ConsequenceTier, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { Consequence } from '../../types/consequences';

/** Heaviness rank for consequence tiers (heavy = branchlet/branch). */
const TIER_RANK: Record<ConsequenceTier, number> = {
  callback: 0,
  tint: 1,
  branchlet: 2,
  branch: 3,
};
const HEAVY_RANK = TIER_RANK.branchlet;

/** Minimum five-factor breadth a heavy discharge should reach (Plan Part 9). */
const FIVE_FACTOR_MIN = 3;

/** The five-factor axes a choice's consequences can touch (Plan Part 9). */
type FiveFactor = 'outcome' | 'process' | 'information' | 'relationship' | 'identity';

/**
 * The authored {@link Consequence}[] for one scene in the episode (flattened
 * across all of the scene's choices/arms). The caller (EpisodePipeline projection)
 * supplies one entry per scene whose id appears as a ledger edge's `to`.
 */
export interface SceneConsequences {
  /** Scene id (matches a {@link ConvergenceEdge.to}). */
  sceneId: string;
  /** Every authored consequence across this scene's choices/arms. */
  consequences: Consequence[];
}

/**
 * The planned dimension a ledger edge promises to move, and the direction toward
 * its threshold. Supplied per edge (keyed by `{from}->{to}@{source}`) when the
 * caller knows the exact dimension (e.g. an npcId + dimension for a relationship
 * edge, or a score key). When absent, the validator falls back to confirming a
 * consequence of the edge's source FAMILY is present, without checking the exact
 * dimension or direction. Either way the match is generator-internal.
 */
export interface MaterializationTarget {
  /**
   * The dimension key the authored consequence must touch:
   *  - relationship → `npcId` (optionally `npcId:dimension`);
   *  - score → the score key;
   *  - identity → the tag/axis flag or tag name;
   *  - flag → the flag name;
   *  - skill/attribute → the skill/attribute key;
   *  - item → the itemId.
   */
  dimension: string;
  /**
   * Direction the consequence must move the dimension to count as "toward the
   * threshold". `+1` = increase, `-1` = decrease, `0`/undefined = any movement
   * counts (presence only).
   */
  direction?: 1 | -1 | 0;
}

/** Context for {@link ChargeMaterializationValidator.validate}. */
export interface ChargeMaterializationContext {
  /** The episode number whose authored consequences are being checked. */
  episodeNumber: number;
  /** Authored consequences per scene in this episode. */
  sceneConsequences: SceneConsequences[];
  /**
   * Optional per-edge planned dimension/direction, keyed by
   * {@link edgeKey}. When present the match is exact; when absent the validator
   * falls back to source-family presence.
   */
  targets?: Record<string, MaterializationTarget>;
}

/** The result of validation plus the annotated ledger (edges carry `materialized`). */
export interface ChargeMaterializationResult extends ValidationResult {
  /**
   * A COPY of the input ledger with `edge.materialized` filled for every edge
   * whose `to` lands in this episode. Edges outside the episode are copied
   * unchanged (their `materialized` is left as-is).
   */
  ledger: ConvergenceLedger;
}

/** Stable key for an edge (used to look up a {@link MaterializationTarget}). */
export function edgeKey(edge: Pick<ConvergenceEdge, 'from' | 'to' | 'source'>): string {
  return `${edge.from}->${edge.to}@${edge.source}`;
}

export class ChargeMaterializationValidator extends BaseValidator {
  constructor() {
    super('ChargeMaterializationValidator');
  }

  /**
   * Confirm each ledger edge landing in `ctx.episodeNumber` materialized in the
   * authored consequences. Returns a {@link ChargeMaterializationResult}: the
   * validation issues plus a copy of the ledger with `edge.materialized` set.
   * Pure — does not mutate the input ledger.
   */
  validate(
    plan: SeasonScenePlan,
    ledger: ConvergenceLedger,
    ctx: ChargeMaterializationContext,
  ): ChargeMaterializationResult {
    const issues: ValidationIssue[] = [];

    const sceneById = new Map<string, PlannedScene>();
    for (const s of plan.scenes) sceneById.set(s.id, s);

    const consequencesByScene = new Map<string, Consequence[]>();
    for (const sc of ctx.sceneConsequences) {
      consequencesByScene.set(sc.sceneId, sc.consequences);
    }
    const targets = ctx.targets ?? {};

    // Annotate a COPY so the input ledger is untouched (pure).
    const annotatedEdges = ledger.edges.map((e) => ({ ...e }));

    for (const edge of annotatedEdges) {
      const scene = sceneById.get(edge.to);
      // Only check edges whose payoff lands in THIS episode.
      if (!scene || scene.episodeNumber !== ctx.episodeNumber) continue;

      const authored = consequencesByScene.get(edge.to) ?? [];
      const target = targets[edgeKey(edge)];
      const materialized = this.edgeMaterialized(edge, authored, target);
      edge.materialized = materialized;

      if (materialized) continue;

      const tier = scene.consequenceTier;
      const isHeavy = tier ? TIER_RANK[tier] >= HEAVY_RANK : false;
      const isEncounter = scene.kind === 'encounter';
      // A bare score crossing is confirming evidence only — never load-bearing
      // enough to make a hollow-branch ERROR on its own (Part 7 #1, stat cap).
      const isStatOnly = edge.source === 'score';

      if (isHeavy && !isEncounter && !isStatOnly) {
        issues.push(this.error(
          `Hollow branch: heavy-tier scene "${edge.to}" (${tier}) has an inbound ${edge.source} edge from "${edge.from}" (anchor "${edge.anchorId}") whose promised charge did not materialize — no authored consequence moves the dimension toward its threshold.`,
          `materialization:${edge.from}->${edge.to}`,
          'Author the promised plant on this scene (a consequence that moves the dimension toward its threshold), or demote the tier (branch → tint) so it is no longer an unearned fork.',
        ));
      } else {
        issues.push(this.warning(
          `Under-materialized charge: ${edge.source} edge from "${edge.from}" to "${edge.to}" (anchor "${edge.anchorId}") promised charge that did not appear in the authored consequences.`,
          `materialization:${edge.from}->${edge.to}`,
          'Add the promised consequence, or drop the edge if the plant was deliberately thinned.',
        ));
      }
    }

    // Five-factor breadth on heavy payoff scenes (Plan Part 9 checklist): a
    // high-charge discharge should touch ≥ FIVE_FACTOR_MIN factors. Advisory.
    const heavyToScenes = new Set<string>();
    for (const edge of annotatedEdges) {
      const scene = sceneById.get(edge.to);
      if (!scene || scene.episodeNumber !== ctx.episodeNumber) continue;
      if (scene.kind === 'encounter') continue; // encounters carry their own spread
      const tier = scene.consequenceTier;
      if (tier && TIER_RANK[tier] >= HEAVY_RANK) heavyToScenes.add(edge.to);
    }
    for (const sceneId of heavyToScenes) {
      const authored = consequencesByScene.get(sceneId) ?? [];
      const factors = fiveFactorBreadth(authored);
      if (factors.size < FIVE_FACTOR_MIN) {
        issues.push(this.info(
          `Heavy-tier discharge at "${sceneId}" affects only ${factors.size} of the five factors (${[...factors].join(', ') || 'none'}); a major discharge should reach ≥${FIVE_FACTOR_MIN} (Outcome/Process/Information/Relationship/Identity).`,
          `fiveFactor:${sceneId}`,
          'Broaden the discharge so it changes outcome, process, information, relationships, and/or identity — a major moment moves more than one axis.',
        ));
      }
    }

    const result = finalize(issues);
    return {
      ...result,
      ledger: { ...ledger, edges: annotatedEdges },
    };
  }

  /**
   * True iff an authored consequence on the payoff scene satisfies the edge's
   * promise: a consequence of the edge's source FAMILY is present, and (when a
   * {@link MaterializationTarget} is supplied) it touches the named dimension and
   * moves it in the promised direction. With no target, source-family presence is
   * enough (the exact dimension is folded into `anchorId`, which is not a runtime
   * key on `Consequence`).
   */
  private edgeMaterialized(
    edge: ConvergenceEdge,
    authored: Consequence[],
    target?: MaterializationTarget,
  ): boolean {
    return authored.some((c) => this.consequenceSatisfies(edge, c, target));
  }

  /** Does a single authored consequence satisfy the edge's promised charge? */
  private consequenceSatisfies(
    edge: ConvergenceEdge,
    c: Consequence,
    target?: MaterializationTarget,
  ): boolean {
    if (!sourceMatchesConsequence(edge.source, c)) return false;
    if (!target) return true; // family presence is enough without a planned target

    const dim = target.dimension.trim();
    if (dim.length === 0) return true; // no dimension named → presence only

    if (!consequenceTouchesDimension(c, dim)) return false;

    const dir = target.direction ?? 0;
    if (dir === 0) return true; // any movement counts
    const delta = consequenceDelta(c);
    if (delta === undefined) return true; // non-numeric consequence (flag/tag/item) → presence is movement
    return Math.sign(delta) === dir;
  }
}

/**
 * Does an authored consequence belong to a ledger edge's `source` family? This is
 * the projection of the {@link ConvergenceSource} taxonomy onto the runtime
 * {@link Consequence} types. `setupPayoff`/`thread`/`delayed` are structural
 * sources with no single runtime consequence type — any authored consequence on
 * the payoff scene counts as the plant landing (they are confirmed structurally,
 * not by a specific delta).
 */
function sourceMatchesConsequence(source: ConvergenceEdge['source'], c: Consequence): boolean {
  switch (source) {
    case 'relationship':
      return c.type === 'relationship';
    case 'score':
      return c.type === 'changeScore' || c.type === 'setScore';
    case 'identity':
      // Identity moves via tags or identity flags (the axis-flag convention).
      return c.type === 'addTag' || c.type === 'removeTag' || c.type === 'setFlag';
    case 'flag':
      return c.type === 'setFlag';
    case 'item':
      return c.type === 'addItem' || c.type === 'removeItem';
    case 'skill':
      return c.type === 'skill';
    case 'attribute':
      return c.type === 'attribute';
    case 'thread':
    case 'setupPayoff':
    case 'delayed':
      // Structural plant: any authored consequence on the payoff scene materializes it.
      return true;
    default:
      return false;
  }
}

/** Does an authored consequence touch the named dimension key? */
function consequenceTouchesDimension(c: Consequence, dim: string): boolean {
  switch (c.type) {
    case 'relationship':
      // dim may be `npcId` or `npcId:dimension`.
      if (dim.includes(':')) {
        const [npcId, dimension] = dim.split(':');
        return c.npcId === npcId && c.dimension === dimension;
      }
      return c.npcId === dim;
    case 'changeScore':
    case 'setScore':
      return c.score === dim;
    case 'setFlag':
      return c.flag === dim;
    case 'addTag':
    case 'removeTag':
      return c.tag === dim;
    case 'skill':
      return c.skill === dim;
    case 'attribute':
      return c.attribute === dim;
    case 'addItem':
      return (c.itemId !== undefined && c.itemId === dim) || (c.item !== undefined && c.item.itemId === dim);
    case 'removeItem':
      return c.itemId === dim;
    default:
      return false;
  }
}

/**
 * The signed numeric delta of a consequence, or undefined when it has no numeric
 * direction (a flag/tag/item is presence, not magnitude). For `setFlag`,
 * `value:true` reads as +1 and `value:false` as -1 so identity/flag direction can
 * be checked.
 */
function consequenceDelta(c: Consequence): number | undefined {
  switch (c.type) {
    case 'relationship':
    case 'changeScore':
      return c.change;
    case 'attribute':
      return c.change;
    case 'skill':
      return c.change;
    case 'setScore':
      // An absolute set (e.g. "set suspicion to 70") is not a SIGNED delta — its
      // direction depends on the prior value, which we do not have here. Treat it
      // as presence-only (undefined) so a directional target is satisfied by the
      // set landing, not by an unsound sign-check on the absolute value.
      return undefined;
    case 'setFlag':
      return c.value ? 1 : -1;
    case 'addTag':
    case 'addItem':
      return 1;
    case 'removeTag':
    case 'removeItem':
      return -1;
    default:
      return undefined;
  }
}

/** Which of the five factors a scene's authored consequences touch (Plan Part 9). */
function fiveFactorBreadth(consequences: Consequence[]): Set<FiveFactor> {
  const factors = new Set<FiveFactor>();
  for (const c of consequences) {
    switch (c.type) {
      case 'setFlag':
      case 'changeScore':
      case 'setScore':
        factors.add('outcome');
        break;
      case 'relationship':
        factors.add('relationship');
        break;
      case 'addTag':
      case 'removeTag':
        factors.add('identity');
        break;
      case 'addItem':
      case 'removeItem':
        factors.add('outcome');
        break;
      case 'attribute':
      case 'skill':
        factors.add('process');
        factors.add('identity');
        break;
    }
  }
  return factors;
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const nonErrors = issues.length - errors;
  const score = Math.max(0, 100 - errors * 10 - nonErrors * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
