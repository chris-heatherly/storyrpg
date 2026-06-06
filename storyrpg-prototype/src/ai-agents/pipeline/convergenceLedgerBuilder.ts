/**
 * Convergence Ledger builder (Plan Part 6 + Part 9), gated upstream by
 * `consequenceFlags().ledger` (`CONVERGENCE_LEDGER`).
 *
 * Today "this moment matters" is represented FIVE different ways by five agents
 * that can drift apart (Plan Part 6). This builder is the *single read path*: it
 * PROJECTS those authored representations onto one {@link ConvergenceLedger} so
 * the allocator, ThreadPlanner, and BranchManager all read the same edges.
 *
 * Phase 4 wires the two representations that already exist on the season plan at
 * budget time:
 *
 *   1. **Scene-spine setup/payoff** — every {@link SetupPayoffEdge} on the plan
 *      (`setsUp`/`paysOff`) becomes a `source: 'setupPayoff'` edge. Anchor: the
 *      `from` scene that plants it (`setup:<from>`); a raw structural plant.
 *   2. **Thread plants/payoffs** — every {@link NarrativeThread} in an available
 *      {@link ThreadLedger} fans its plants × payoffs into `source: 'thread'`
 *      edges. Anchor: the thread id. Magnitude scales by {@link ThreadPriority}
 *      (major ≫ minor); a discharging `promise` thread reads as max charge.
 *
 * Phase 5b (`CHARGE_COMPETENCE`) adds the **competence loop** (Part 5
 * §Competence loop): a heavy-tier moment gated on a skill/attribute level *N* is
 * a `source: 'skill'`/`'attribute'` roadblock edge carrying `gateLevel: N`,
 * anchored on an authored `ArcMilestone(phase:'test')` or competence thread — no
 * anchorless skill walls (same story-first rule as everything else). When the
 * wall is the OVERCOME of a wall the player previously failed, the edge carries
 * `overcomesPriorFailure: true` and a boosted magnitude — the high-charge payoff
 * of failed→grew→returned. With `competence` OFF these roadblocks are ignored and
 * the ledger is byte-identical to Phase 5.
 *
 * Phase 5 (`CHARGE_STATS`) adds the **trajectory = charge** half of Part 5's
 * value/trajectory duality. A planned state trajectory (a
 * {@link RelationshipTrajectoryTarget} dimension, an {@link IdentityAxisTarget}
 * axis, or a story score) *crossing a threshold near a scene* projects into a
 * `relationship`/`identity`/`score` edge anchored on the arc target / milestone
 * id. Snapshot *values* remain GATES and contribute NO charge — only a crossing
 * (a trajectory paying off) is charge (Part 5: "trust at 5 is charged only if it
 * is falling through a cutoff here"). With `chargeStats` OFF these crossings are
 * ignored and the ledger is byte-identical to Phase 4.
 *
 * Story-first invariants this builder holds (Plan Part 7):
 *  - **Every edge carries an `anchorId`** — the authored object behind it. There
 *    is no anchorless charge (invariants 1–2). Setup edges anchor on their plant
 *    scene; thread edges anchor on the thread id; trajectory crossings anchor on
 *    the relationship/identity/score target id.
 *  - **Intent drives, stats only confirm** (invariant 1; Part 5 duality).
 *    Relationship/identity crossings are authored arc objects → they carry
 *    `narrativeIntentCharge` and may elevate a moment on their own. A bare
 *    `score` crossing is `statTrajectoryCharge` — a CONFIRMING multiplier that
 *    {@link computeChargeMap} caps (`STAT_CHARGE_CAP`) so it can never manufacture
 *    a major alone. That cap lives in the charge map, downstream of this builder.
 *  - **Dedupe by dramatic event** (Plan Part 11 #2). A thread that plants and
 *    pays off the same pair, or a setup edge that coincides with a thread edge,
 *    is ONE dramatic event, not several — so charge does not inflate. Edges are
 *    deduped by `(anchorId, to)`: at most one edge per authored object per
 *    payoff scene, keeping the strongest magnitude / promise kind seen.
 *    Trajectory crossings additionally **cluster co-moving signals**: an event
 *    that moves a relationship AND an identity axis is ONE dramatic event — when
 *    they share an `eventId` they collapse to a single edge (Part 11 #2), so a
 *    relationship-and-identity tip does not count twice.
 *
 * Pure and deterministic — no clock, no randomness; the same (plan, ledger,
 * crossings) always yields the same ledger, with edges in a stable order.
 */

import { consequenceFlags } from './consequenceFlags';
import type {
  ConvergenceLedger,
  ConvergenceEdge,
  ConvergenceSource,
} from '../../types/convergenceLedger';
import type { SeasonScenePlan } from '../../types/scenePlan';
import type {
  ThreadLedger,
  NarrativeThread,
  ThreadPriority,
  ThreadKind,
} from '../../types/narrativeThread';

/**
 * Per-priority base magnitude for a `thread` edge (Plan Part 4 table: payoff load
 * scales by priority, major ≫ minor). In the normalized charge space the allocator
 * reads (`chargeMap`), a single major thread edge clears `TAU_CHARGE` on its own
 * (an earned betrayal), while a minor thread alone does not — convergence is
 * required for a minor thread to charge a branch.
 */
const THREAD_PRIORITY_MAGNITUDE: Record<ThreadPriority, number> = {
  major: 3,
  minor: 1,
};

/**
 * A discharging `promise` thread reads as MAX charge (Plan Part 4: "`kind:'promise'`
 * discharging = max"). We bump a promise thread's magnitude by this factor on top
 * of its priority base so a major promise payoff is the heaviest detonation in the
 * ledger — the stakes-commitment landing.
 */
const PROMISE_KIND_MULTIPLIER = 1.5;

/** Setup/payoff structural edge magnitude (a raw plant; lighter than a thread). */
const SETUP_EDGE_MAGNITUDE = 1;

/**
 * The trajectory-crossing sources Phase 5 projects. Each is one lane of Part 5's
 * value/trajectory duality (trajectory = charge). `relationship` and `identity`
 * are authored arc objects (narrative intent — they may elevate alone);
 * `score` is a bare meter (stat trajectory — capped downstream so it can only
 * confirm). Skill/attribute crossings are Phase 5b and are intentionally not
 * handled here.
 */
export type TrajectoryCrossingSource = 'relationship' | 'identity' | 'score';

/**
 * Default per-crossing magnitude by source (raw, pre-normalization — the same
 * scale as {@link THREAD_PRIORITY_MAGNITUDE}). A relationship crossing is the
 * "richest source" (Part 5 table) so it reads as a major arc payoff on its own;
 * an identity-axis crossing (a character-defining turn) is comparable; a bare
 * `score` crossing is given a healthy raw value but is capped downstream by
 * {@link computeChargeMap} so it can never manufacture a major. A crossing may
 * override this with an explicit `magnitude`.
 */
const TRAJECTORY_CROSSING_MAGNITUDE: Record<TrajectoryCrossingSource, number> = {
  relationship: 3,
  identity: 3,
  score: 3,
};

/**
 * Relative richness used to pick the surviving source when co-moving crossings
 * (same `eventId`) collapse to one edge. Relationship is the richest charge
 * source (Part 5), then identity, then a bare score. Higher wins.
 */
const TRAJECTORY_SOURCE_RICHNESS: Record<TrajectoryCrossingSource, number> = {
  relationship: 3,
  identity: 2,
  score: 1,
};

/**
 * The competence-roadblock sources Phase 5b projects (Plan Part 5 §Competence
 * loop). `skill` is a genre-specific competence wall; `attribute` is a slow
 * attribute trajectory backing a competence/character arc. Both carry a
 * `gateLevel` and may carry `overcomesPriorFailure`.
 */
export type RoadblockSource = 'skill' | 'attribute';

/**
 * Base magnitude for a competence roadblock edge (raw, same scale as
 * {@link THREAD_PRIORITY_MAGNITUDE}). A plain roadblock reads as a major arc beat
 * (a `test` milestone) on its own; the overcome of a previously-failed wall is
 * boosted past it (Plan Part 5 step 4: "strongly elevated, often a `branch`").
 */
const ROADBLOCK_MAGNITUDE: Record<RoadblockSource, number> = {
  skill: 3,
  attribute: 3,
};

/**
 * The multiplier applied when a roadblock edge OVERCOMES a wall the player
 * previously failed (Plan Part 5 step 4). The overcome is a high-charge payoff —
 * the player carries the memory of the failure, the grind, and the return — so it
 * is strongly elevated above a first-contact roadblock, pushing the moment toward
 * `branch`.
 */
const OVERCOME_MULTIPLIER = 1.5;

/**
 * One planned competence roadblock (Plan Part 5 §Competence loop). A heavy-tier
 * moment at `to` is gated on skill/attribute `anchorId`'s reaching `gateLevel`,
 * planted/charged from `from`. The roadblock MUST carry an `anchorId` — the
 * authored `ArcMilestone(phase:'test')` or competence thread that justifies the
 * wall (no anchorless skill walls). When it is the overcome of a previously-failed
 * wall, set `overcomesPriorFailure: true` for the high-charge payoff.
 *
 * Crossing detection (which scene the wall is overcome at, whether the player
 * previously failed) is the caller's responsibility (SeasonPlannerAgent), keeping
 * this builder pure and deterministic.
 */
export interface SkillRoadblock {
  /** Which competence lane (skill / attribute). Becomes `edge.source`. */
  source: RoadblockSource;
  /**
   * The authored object behind the wall — the `ArcMilestone(phase:'test')` id or
   * competence thread id. Becomes `edge.anchorId`. REQUIRED: an anchorless
   * roadblock is dropped (no anchorless walls — same story-first rule as charge).
   */
  anchorId: string;
  /** The skill/attribute key the gate tests (for the reachability validator). */
  skill: string;
  /** Scene that plants / charges the wall (the prior `test`/side-growth — `edge.from`). */
  from: string;
  /** Scene where the wall is contacted / overcome (the gated moment — `edge.to`). */
  to: string;
  /** The level *N* the gate requires (becomes `edge.gateLevel`). */
  gateLevel: number;
  /**
   * True when `to` is the OVERCOME of a wall the player previously failed — the
   * high-charge payoff (Plan Part 5 step 4). Boosts magnitude and sets
   * `edge.overcomesPriorFailure`.
   */
  overcomesPriorFailure?: boolean;
  /** Optional magnitude override (defaults by source, then the overcome boost). */
  magnitude?: number;
}

/**
 * One planned state-trajectory crossing (Part 5 — trajectory = charge). It says:
 * "the dimension named by `anchorId` crosses its threshold AT `to`, having been
 * set in motion at `from`." Only crossings are charge; a snapshot value at a
 * scene is a gate and must NOT be expressed as a crossing here.
 *
 * The caller (SeasonPlannerAgent, projecting `RelationshipTrajectoryTarget` /
 * `IdentityAxisTarget` / planned score arcs) is responsible for the crossing
 * detection — deciding which scene a delta tips at — keeping this builder pure
 * and deterministic.
 */
export interface StateTrajectoryCrossing {
  /** Which trajectory lane crossed (relationship / identity / score). */
  source: TrajectoryCrossingSource;
  /**
   * The authored object behind the crossing — the relationship-target id /
   * npcId, the identity axis key, or the score key. Becomes `edge.anchorId`,
   * the story-first seam (no anchorless charge).
   */
  anchorId: string;
  /** Scene where the trajectory was set in motion (the plant / `edge.from`). */
  from: string;
  /** Scene where the trajectory CROSSES its threshold (the payoff / `edge.to`). */
  to: string;
  /**
   * Optional override of {@link TRAJECTORY_CROSSING_MAGNITUDE}. Use the planned
   * delta size if you want a bigger crossing to read heavier; defaults by source.
   */
  magnitude?: number;
  /**
   * Optional dramatic-event id used to DEDUPE co-moving signals (Part 11 #2). An
   * event that moves a relationship AND an identity axis is ONE dramatic event —
   * give both crossings the same `eventId` and they collapse to a single edge
   * (the richest source survives) so charge does not double-count.
   */
  eventId?: string;
}

/** Options for {@link buildConvergenceLedger}. */
export interface BuildConvergenceLedgerOpts {
  /**
   * The season's {@link ThreadLedger}, when available. Threads project into
   * `source: 'thread'` edges. Absence is tolerated — the builder still produces
   * the setup/payoff edges (Plan Part 6: tolerate missing contributors).
   */
  threadLedger?: ThreadLedger;
  /**
   * Planned state-trajectory crossings (Phase 5). Projected into
   * `relationship`/`identity`/`score` edges ONLY when `consequenceFlags()
   * .chargeStats` (`CHARGE_STATS`) is on; ignored otherwise so flag-OFF behavior
   * is byte-identical to Phase 4.
   */
  trajectoryCrossings?: StateTrajectoryCrossing[];
  /**
   * Planned competence roadblocks (Phase 5b). Projected into `skill`/`attribute`
   * edges (with `gateLevel`, and `overcomesPriorFailure` for an overcome) ONLY
   * when `consequenceFlags().competence` (`CHARGE_COMPETENCE`) is on; ignored
   * otherwise so flag-OFF behavior is byte-identical to Phase 5. An anchorless
   * roadblock is dropped (no anchorless skill walls).
   */
  roadblocks?: SkillRoadblock[];
}

/**
 * The magnitude a thread contributes, before dedupe. Scales by priority, with a
 * `promise` thread bumped toward MAX (Plan Part 4: a discharging promise = max
 * charge). Pure.
 */
function threadMagnitude(thread: NarrativeThread): number {
  const base = THREAD_PRIORITY_MAGNITUDE[thread.priority] ?? THREAD_PRIORITY_MAGNITUDE.minor;
  return thread.kind === 'promise' ? base * PROMISE_KIND_MULTIPLIER : base;
}

/**
 * The "promise kind = max" rule (Plan Part 4) when deduping two edges for one
 * dramatic event: keep the stronger promise signal. We treat `promise` as the
 * strongest kind; any non-promise kind is weaker. Returns the kind to retain.
 */
function maxKind(a: ThreadKind, b: ThreadKind): ThreadKind {
  if (a === 'promise' || b === 'promise') return 'promise';
  return a;
}

/** The raw magnitude a crossing contributes (override or per-source default). */
function crossingMagnitude(c: StateTrajectoryCrossing): number {
  return c.magnitude ?? TRAJECTORY_CROSSING_MAGNITUDE[c.source];
}

/**
 * The raw magnitude a competence roadblock contributes (Plan Part 5 §Competence
 * loop). Per-source default, boosted by {@link OVERCOME_MULTIPLIER} when it is the
 * overcome of a previously-failed wall (the high-charge payoff). An explicit
 * `magnitude` overrides the default but the overcome boost still applies on top.
 */
function roadblockMagnitude(r: SkillRoadblock): number {
  const base = r.magnitude ?? ROADBLOCK_MAGNITUDE[r.source];
  return r.overcomesPriorFailure ? base * OVERCOME_MULTIPLIER : base;
}

/**
 * Cluster co-moving trajectory crossings into one edge per dramatic event
 * (Plan Part 11 #2). Crossings sharing an `eventId` *and* a payoff scene `to`
 * are ONE dramatic event — they collapse to a single survivor: the RICHEST
 * source wins ({@link TRAJECTORY_SOURCE_RICHNESS}; relationship > identity >
 * score), carrying the MAX magnitude across the cluster. Crossings without an
 * `eventId` are never clustered with each other (each is its own event), so an
 * unrelated relationship and identity crossing still sum.
 *
 * Order is preserved by first appearance so edge order stays deterministic.
 * Pure.
 */
function clusterCoMovingCrossings(
  crossings: StateTrajectoryCrossing[],
): StateTrajectoryCrossing[] {
  const survivors: StateTrajectoryCrossing[] = [];
  // Cluster key → index into `survivors` for the current best representative.
  const indexByCluster = new Map<string, number>();

  crossings.forEach((c, i) => {
    // No eventId → unique cluster (use the input index so it never merges).
    const clusterKey =
      c.eventId !== undefined ? `${c.eventId} ${c.to}` : `__solo__${i}`;
    const existingIdx = indexByCluster.get(clusterKey);
    if (existingIdx === undefined) {
      indexByCluster.set(clusterKey, survivors.length);
      survivors.push(c);
      return;
    }
    // Merge into the cluster: richest source survives, MAX magnitude carried.
    const cur = survivors[existingIdx];
    const mergedMagnitude = Math.max(crossingMagnitude(cur), crossingMagnitude(c));
    const winner =
      TRAJECTORY_SOURCE_RICHNESS[c.source] > TRAJECTORY_SOURCE_RICHNESS[cur.source]
        ? c
        : cur;
    survivors[existingIdx] = { ...winner, magnitude: mergedMagnitude };
  });

  return survivors;
}

/**
 * Project a season plan (and optional {@link ThreadLedger}) onto a single
 * {@link ConvergenceLedger} (Plan Part 6). Produces forward-pointing,
 * anchored, deduped edges:
 *
 *  - `setupPayoff` edges from `plan.setupPayoffEdges` (anchor: `setup:<from>`);
 *  - `thread` edges from each thread's plants × payoffs (anchor: thread id),
 *    magnitude scaled by priority and the promise bump;
 *  - (Phase 5, `CHARGE_STATS`) `relationship`/`identity`/`score` edges from
 *    `opts.trajectoryCrossings` — a planned trajectory crossing a threshold near
 *    a scene (anchor: the arc-target / milestone id).
 *
 * Dedupe (Plan Part 11 #2): edges are keyed by `(anchorId, to)` — at most one
 * edge per authored object per payoff scene, keeping the MAX magnitude and the
 * MAX promise kind seen so a single dramatic event cannot inflate charge.
 * Trajectory crossings are first clustered by `(eventId, to)` so CO-MOVING
 * signals (a relationship AND an identity axis moved by one event) collapse to a
 * single edge before summing.
 *
 * Pure / deterministic — stable edge order (setup edges in plan order, then
 * thread edges, then trajectory crossings in input order), no clock, no
 * randomness.
 */
export function buildConvergenceLedger(
  plan: SeasonScenePlan,
  opts?: BuildConvergenceLedgerOpts,
): ConvergenceLedger {
  // Dedupe map keyed by `(anchorId, to)`: one dramatic event per authored object
  // per payoff scene. We keep the strongest magnitude and the strongest (promise)
  // kind so re-projecting the same event never inflates charge.
  const byKey = new Map<
    string,
    { edge: ConvergenceEdge; kind?: ThreadKind }
  >();
  const nodes = new Set<string>();

  const key = (anchorId: string, to: string): string => `${anchorId} ${to}`;

  const add = (
    edge: ConvergenceEdge,
    kind?: ThreadKind,
  ): void => {
    nodes.add(edge.from);
    nodes.add(edge.to);
    const k = key(edge.anchorId, edge.to);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { edge, kind });
      return;
    }
    // Merge into the existing dramatic event: keep MAX magnitude and MAX kind.
    if (edge.magnitude > existing.edge.magnitude) {
      existing.edge.magnitude = edge.magnitude;
    }
    if (kind && existing.kind) {
      existing.kind = maxKind(existing.kind, kind);
    } else if (kind) {
      existing.kind = kind;
    }
  };

  // --- 1) Scene-spine setup/payoff edges -----------------------------------
  // Every authored setsUp→paysOff edge is a structural plant. Anchor on the
  // plant scene (`setup:<from>`): a forward edge that names where it came from.
  for (const e of plan.setupPayoffEdges) {
    add({
      from: e.from,
      to: e.to,
      source: 'setupPayoff',
      magnitude: SETUP_EDGE_MAGNITUDE,
      anchorId: `setup:${e.from}`,
    });
  }

  // --- 2) Thread plants × payoffs ------------------------------------------
  // Each thread fans every plant to every payoff. Anchor: the thread id — the
  // authored object that justifies the charge. Magnitude scales by priority,
  // promise threads bumped toward max. Dedupe by (anchorId=thread.id, to) keeps
  // a multi-plant thread from inflating charge at one payoff scene.
  const threadLedger = opts?.threadLedger;
  if (threadLedger) {
    for (const thread of threadLedger.threads) {
      const magnitude = threadMagnitude(thread);
      for (const plant of thread.plants) {
        for (const payoff of thread.payoffs) {
          add(
            {
              from: plant.sceneId,
              to: payoff.sceneId,
              source: 'thread',
              magnitude,
              anchorId: thread.id,
            },
            thread.kind,
          );
        }
      }
    }
  }

  // --- 3) State-trajectory crossings (Phase 5, CHARGE_STATS) ----------------
  // The trajectory = charge half of Part 5's duality. A planned relationship /
  // identity / score trajectory CROSSING a threshold near a scene projects into
  // an anchored edge. Gated by `chargeStats`: OFF → ignored (Phase-4-identical).
  // Co-moving signals are clustered first (one event that moves a relationship
  // AND an identity = one edge) so charge does not double-count.
  const crossings = opts?.trajectoryCrossings;
  if (crossings && crossings.length > 0 && consequenceFlags().chargeStats) {
    for (const c of clusterCoMovingCrossings(crossings)) {
      add({
        from: c.from,
        to: c.to,
        // The crossing source IS the ledger source (relationship/identity/score).
        source: c.source as ConvergenceSource,
        magnitude: crossingMagnitude(c),
        anchorId: c.anchorId,
      });
    }
  }

  // --- 4) Competence roadblocks (Phase 5b, CHARGE_COMPETENCE) ---------------
  // A skill/attribute wall: a heavy-tier moment gated on reaching `gateLevel`.
  // Anchored on the authored `ArcMilestone(phase:'test')` / competence thread —
  // an anchorless roadblock is DROPPED (no anchorless skill walls, Part 5). The
  // overcome of a previously-failed wall carries a boosted magnitude and the
  // `overcomesPriorFailure` flag (high-charge payoff). Gated by `competence`:
  // OFF → ignored (Phase-5-identical).
  const roadblocks = opts?.roadblocks;
  if (roadblocks && roadblocks.length > 0 && consequenceFlags().competence) {
    for (const r of roadblocks) {
      // No anchorless skill walls (same story-first rule as charge): drop it.
      if (typeof r.anchorId !== 'string' || r.anchorId.trim().length === 0) continue;
      add({
        from: r.from,
        to: r.to,
        source: r.source as ConvergenceSource,
        magnitude: roadblockMagnitude(r),
        anchorId: r.anchorId,
        gateLevel: r.gateLevel,
        ...(r.overcomesPriorFailure ? { overcomesPriorFailure: true } : {}),
      });
    }
  }

  const edges = [...byKey.values()].map((v) => v.edge);

  return {
    nodes: [...nodes],
    edges,
  };
}
