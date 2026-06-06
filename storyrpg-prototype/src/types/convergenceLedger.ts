/**
 * The Convergence Ledger
 * (`docs/CONSEQUENCE_INTELLIGENCE_PLAN_2026-06-05.md`, Parts 4 & 6).
 *
 * Today "this moment matters" is represented five different ways by five agents
 * that can drift apart: `setupPayoffEdges` (SceneSpine),
 * `ThreadLedger.plants/payoffs` (ThreadPlanner), `RelationshipTrajectoryTarget`
 * (CharacterArcTracker), `IdentityAxisTarget`/`ArcMilestone`
 * (CharacterArcTracker), and the `DelayedConsequence` queue (ChoiceAuthor). They
 * are all the SAME underlying thing: dramatic *charge* flowing from a plant to a
 * payoff. The ledger projects them onto one artifact so systems compose instead
 * of fight: many contributors, one read path.
 *
 * Story-first invariant (Part 7): every edge carries an `anchorId` — the
 * authored narrative object that justifies it. There is no anchorless charge.
 */

/**
 * Which authored system contributed an edge — the "kind" of charge flowing along
 * it. The richer state systems (relationship/identity/score/skill/attribute)
 * carry charge as a *trajectory crossing a threshold* (Part 5's value/trajectory
 * duality); `thread`/`setupPayoff`/`delayed` carry it as a structural plant.
 */
export type ConvergenceSource =
  | 'thread' // a NarrativeThread plant→payoff (priority-weighted; major promise = max charge)
  | 'relationship' // a RelationshipTrajectoryTarget dimension crossing a tipping point
  | 'identity' // an IdentityAxisTarget / ArcMilestone crossing its midpoint
  | 'score' // a story score (suspicion, corruption) crossing an authored cutoff
  | 'flag' // accumulated flags discharged at a gated choice
  | 'item' // a Chekhov item tied to a thread; its use is the payoff
  | 'skill' // a competence roadblock (statCheck gate level N) and its later overcome
  | 'attribute' // attribute trajectory (slow growth) backing a competence/character arc
  | 'delayed' // a DelayedConsequence resolving at the `to` scene (butterfly landing)
  | 'setupPayoff'; // a raw setsUp→paysOff edge from the scene spine

/**
 * One directed plant→payoff edge: charge flows from `from` to `to`. Aggregated
 * inbound to each `to` scene, edges form `charge(scene)` — the dramatic-charge
 * axis the allocator reads (Part 2).
 */
export interface ConvergenceEdge {
  /** Scene id that PLANTS the charge (the earlier setup). */
  from: string;
  /** Scene id where the charge DISCHARGES (the payoff / detonation). */
  to: string;
  /** Which authored system this edge came from (Part 5 taxonomy). */
  source: ConvergenceSource;
  /**
   * This edge's contribution to `charge(to)`. Higher for major `promise` threads
   * and `overcomesPriorFailure` payoffs; bounded for stat-trajectory edges so a
   * meter alone can never manufacture a branch (Part 7, stat cap).
   */
  magnitude: number;
  /**
   * The authored narrative object behind this edge (thread id, milestone id,
   * trajectory-target id, …). The story-first seam: no anchorless charge — a
   * heavy tier must name the authored object it serves (Part 7, invariants 1–2).
   */
  anchorId: string;
  /**
   * For skill/attribute roadblocks: the level N the gate requires. Used by the
   * competence-reachability (no-dead-wall) check (Part 5, §Competence loop).
   */
  gateLevel?: number;
  /**
   * True when `to` is the *overcome* of a wall the player previously failed —
   * a high-charge payoff (the player carries the memory of the failure, the
   * grind, and the return). Strongly elevates the tier (Part 5, step 4).
   */
  overcomesPriorFailure?: boolean;
  /**
   * Filled at episode time (Part 9): the promised plant was really authored and
   * really moves its dimension toward the threshold. A `branch` whose charge
   * never materializes is a "hollow branch" sent back for repair.
   */
  materialized?: boolean;
}

/**
 * The whole ledger: the set of scene ids participating (`nodes`) and the
 * plant→payoff `edges`. `computeChargeMap`/`aggregateCharge` reduce it to a
 * per-scene charge value that the allocator, ThreadPlanner, and BranchManager
 * all read.
 */
export interface ConvergenceLedger {
  /** Scene ids participating in the ledger. */
  nodes: string[];
  /** All plant→payoff edges across the season. */
  edges: ConvergenceEdge[];
  /** Optional human-readable design notes (diagnostics only). */
  designNotes?: string;
}

/**
 * Aggregate the ledger into per-scene inbound charge: sum `edge.magnitude` by
 * `edge.to`. The result is `charge(scene)` for every scene that has ≥1 inbound
 * edge. Pure and deterministic — no clock, no randomness; the same ledger always
 * yields the same map.
 */
export function aggregateCharge(ledger: ConvergenceLedger): Map<string, number> {
  const charge = new Map<string, number>();
  for (const edge of ledger.edges) {
    charge.set(edge.to, (charge.get(edge.to) ?? 0) + edge.magnitude);
  }
  return charge;
}
