/**
 * Episode-time charge-materialization wiring (Plan Part 9 + Part 10 Phase 6).
 *
 * This is the live seam between the per-episode generation loop and the
 * {@link runChargeMaterializationGate} helper. The big pipeline files must NOT
 * grow (the monolith ratchet on `FullStoryPipeline.ts`) and `EpisodePipeline.ts`
 * is `@ts-nocheck`, so the projection + adapter + gate orchestration lives HERE,
 * in one small typechecked module the pipeline calls with a few lines.
 *
 * What it does, all gated DEFAULT-OFF:
 *
 *  1. If `consequenceFlags().ledger` (`CONVERGENCE_LEDGER`) is unset, it returns
 *     immediately (`ran: false`) — no ledger is built, no validator runs, no
 *     diagnostic is written. With the flag unset the episode loop is byte-identical
 *     to before this phase.
 *  2. Otherwise it PROJECTS the episode's authored {@link Consequence}[] (from the
 *     ChoiceAuthor `choiceSets`) per scene, builds the {@link ConvergenceLedger}
 *     from the season scene plan via {@link buildConvergenceLedger}, optionally
 *     adapts trajectory/roadblock edges to exact {@link MaterializationTarget}s,
 *     and runs {@link runChargeMaterializationGate}.
 *  3. The gate is ADVISORY unless `GATE_CHARGE_MATERIALIZATION='1'`, in which case
 *     a hollow-branch error THROWS — bubbling out of episode generation so the
 *     run's retry/repair pipeline kicks in (or fails loud, opt-in).
 *  4. Whenever the ledger is built (flag on), the annotated ledger (`edge.materialized`)
 *     is persisted via the injected `persist` writer for cross-run analysis —
 *     written even when the gate blocks, so the diagnostic survives the throw.
 *
 * Scene-id alignment: the ledger's `edge.to` are {@link PlannedScene} ids; in
 * scene-first ("elaborate") mode the StoryArchitect builds each blueprint scene
 * with `id = plannedScene.id`, and the ChoiceAuthor stamps that same id onto its
 * `choiceSet.sceneId`. So the projection keys (choiceSet.sceneId) line up exactly
 * with the ledger edges. Outside scene-first mode there is no `scenePlan`, so the
 * ledger cannot be built and this module no-ops by construction.
 *
 * Pure apart from the env-flag reads (the gate decision) and the injected async
 * `persist` side effect; the validation itself is a pure function of (plan,
 * ledger, episode, consequences).
 */

import {
  ChargeMaterializationValidator,
  edgeKey,
  type ChargeMaterializationContext,
  type ChargeMaterializationResult,
  type MaterializationTarget,
  type SceneConsequences,
} from '../validators/ChargeMaterializationValidator';
import {
  runChargeMaterializationGate,
  type ChargeMaterializationGateOutcome,
} from './chargeMaterializationGate';
import {
  buildConvergenceLedger,
  type SkillRoadblock,
  type StateTrajectoryCrossing,
} from './convergenceLedgerBuilder';
import { consequenceFlags } from './consequenceFlags';
import type { ConvergenceLedger } from '../../types/convergenceLedger';
import type { SeasonScenePlan } from '../../types/scenePlan';
import type { Consequence } from '../../types/consequences';
import type { ThreadLedger } from '../../types/narrativeThread';
import type { SeasonPlan } from '../../types/seasonPlan';

/**
 * The minimal structural shape of a ChoiceAuthor `ChoiceSet` this module reads —
 * the scene it belongs to and the authored consequences across its choices. Kept
 * structural (not an import of the full `ChoiceSet`) so the live, `@ts-nocheck`
 * pipeline can pass its choice sets without a type dependency.
 */
export interface AuthoredChoiceSetLike {
  /** The scene id this choice set belongs to (a {@link PlannedScene} id in scene-first mode). */
  sceneId?: string;
  /** This set's choices; each may carry authored consequences. */
  choices?: Array<{ consequences?: Consequence[] }>;
}

/** Inputs for {@link runEpisodeChargeMaterialization}. */
export interface EpisodeChargeMaterializationInput {
  /** The season scene plan (only present in scene-first mode; required to build the ledger). */
  scenePlan: SeasonScenePlan;
  /** The episode whose authored consequences are being checked. */
  episodeNumber: number;
  /** The ChoiceAuthor choice sets for this episode (authored consequences, per scene). */
  choiceSets: AuthoredChoiceSetLike[];
  /** The season's ThreadLedger, when available (projects `thread` edges). */
  threadLedger?: ThreadLedger;
  /** Planned trajectory crossings (Phase 5; projected only when `CHARGE_STATS` is on). */
  trajectoryCrossings?: StateTrajectoryCrossing[];
  /** Planned competence roadblocks (Phase 5b; projected only when `CHARGE_COMPETENCE` is on). */
  roadblocks?: SkillRoadblock[];
}

/**
 * Persist the annotated ledger (and the validator result) for cross-run analysis.
 * Injected so this module stays free of filesystem coupling; the pipeline passes a
 * thin wrapper around its diagnostics writer (`saveEarlyDiagnostic`).
 */
export type AnnotatedLedgerWriter = (
  ledger: ConvergenceLedger,
  result: ChargeMaterializationResult,
) => Promise<void> | void;

/** Outcome of the episode-time materialization wiring. */
export interface EpisodeChargeMaterializationOutcome {
  /**
   * False iff the ledger flag was off (the module no-opped). When false, NOTHING
   * ran — no ledger, no validator, no persistence — so behavior is byte-identical
   * to before this phase.
   */
  ran: boolean;
  /** The annotated ledger (edges carry `materialized`). Present iff `ran`. */
  ledger?: ConvergenceLedger;
  /** The full validator result. Present iff `ran`. */
  result?: ChargeMaterializationResult;
  /** True iff `GATE_CHARGE_MATERIALIZATION='1'` (the gate was blocking). Present iff `ran`. */
  blocking?: boolean;
}

/**
 * Flatten the authored {@link Consequence}[] of an episode's choice sets into one
 * {@link SceneConsequences} entry per scene id. Choice sets with no `sceneId` (no
 * planned scene to attribute them to) are skipped; multiple choice sets on one
 * scene are merged. Pure.
 */
export function projectSceneConsequences(
  choiceSets: AuthoredChoiceSetLike[],
): SceneConsequences[] {
  const bySceneId = new Map<string, Consequence[]>();
  for (const cs of choiceSets) {
    const sceneId = cs.sceneId;
    if (typeof sceneId !== 'string' || sceneId.length === 0) continue;
    const bucket = bySceneId.get(sceneId) ?? [];
    for (const choice of cs.choices ?? []) {
      if (Array.isArray(choice.consequences)) bucket.push(...choice.consequences);
    }
    bySceneId.set(sceneId, bucket);
  }
  return [...bySceneId.entries()].map(([sceneId, consequences]) => ({
    sceneId,
    consequences,
  }));
}

/**
 * Adapt planned trajectory crossings and competence roadblocks to per-edge
 * {@link MaterializationTarget}s so the validator matches the EXACT planned
 * dimension (not just the source family). Keyed by {@link edgeKey} (`from->to@source`).
 *
 *  - A trajectory crossing's `anchorId` IS the moved dimension (npcId / identity
 *    axis / score key) → `dimension: anchorId`, direction `0` (presence: the
 *    crossing's magnitude is unsigned, so any movement on that dimension counts).
 *  - A roadblock's gated `skill` is the dimension that must grow toward the wall →
 *    `dimension: skill`, direction `+1` (skill/attribute growth moves up).
 *
 * Gated to MIRROR the builder: crossings only when `CHARGE_STATS` is on, roadblocks
 * only when `CHARGE_COMPETENCE` is on — so the target keys can only reference edges
 * the ledger actually contains. Extra/missing targets are harmless (the validator
 * falls back to source-family presence). Pure apart from the flag reads.
 */
export function buildMaterializationTargets(input: {
  trajectoryCrossings?: StateTrajectoryCrossing[];
  roadblocks?: SkillRoadblock[];
}): Record<string, MaterializationTarget> {
  const flags = consequenceFlags();
  const targets: Record<string, MaterializationTarget> = {};

  if (flags.chargeStats) {
    for (const c of input.trajectoryCrossings ?? []) {
      const dimension = typeof c.anchorId === 'string' ? c.anchorId.trim() : '';
      if (dimension.length === 0) continue;
      targets[edgeKey({ from: c.from, to: c.to, source: c.source })] = {
        dimension,
        direction: 0,
      };
    }
  }

  if (flags.competence) {
    for (const r of input.roadblocks ?? []) {
      const dimension = typeof r.skill === 'string' ? r.skill.trim() : '';
      if (dimension.length === 0) continue;
      targets[edgeKey({ from: r.from, to: r.to, source: r.source })] = {
        dimension,
        direction: 1,
      };
    }
  }

  return targets;
}

/**
 * Run the episode-time charge-materialization check for one episode and (when the
 * ledger flag is on) persist the annotated ledger. Throws iff
 * `GATE_CHARGE_MATERIALIZATION='1'` AND a hollow-branch error is found — the
 * annotated ledger is persisted FIRST so the diagnostic survives the throw.
 *
 * Default-off contract: with `CONVERGENCE_LEDGER` unset this returns
 * `{ ran: false }` without building a ledger, running the validator, or writing a
 * diagnostic — byte-identical to before this phase.
 */
export async function runEpisodeChargeMaterialization(
  input: EpisodeChargeMaterializationInput,
  persist?: AnnotatedLedgerWriter,
): Promise<EpisodeChargeMaterializationOutcome> {
  // Default-off: no ledger flag → do nothing at all (no build, no validate, no I/O).
  if (!consequenceFlags().ledger) return { ran: false };

  const ledger = buildConvergenceLedger(input.scenePlan, {
    threadLedger: input.threadLedger,
    trajectoryCrossings: input.trajectoryCrossings,
    roadblocks: input.roadblocks,
  });

  const ctx: ChargeMaterializationContext = {
    episodeNumber: input.episodeNumber,
    sceneConsequences: projectSceneConsequences(input.choiceSets),
    targets: buildMaterializationTargets({
      trajectoryCrossings: input.trajectoryCrossings,
      roadblocks: input.roadblocks,
    }),
  };

  let outcome: ChargeMaterializationGateOutcome;
  try {
    outcome = runChargeMaterializationGate(input.scenePlan, ledger, ctx);
  } catch (gateError) {
    // The gate blocked (GATE_CHARGE_MATERIALIZATION + hollow branch). Persist the
    // annotated ledger anyway so the offending run is analyzable, then rethrow so
    // the caller's repair pipeline kicks in. The validator is pure, so re-running
    // it here yields the same annotated ledger the gate saw.
    if (persist) {
      const advisory = new ChargeMaterializationValidator().validate(
        input.scenePlan,
        ledger,
        ctx,
      );
      await persist(advisory.ledger, advisory);
    }
    throw gateError;
  }

  if (persist) await persist(outcome.result.ledger, outcome.result);

  return {
    ran: true,
    ledger: outcome.result.ledger,
    result: outcome.result,
    blocking: outcome.blocking,
  };
}

/**
 * Convenience seam for the per-episode pipeline (Plan Part 10 Phase 6): pull the
 * scene plan and the (defensively-read, not-yet-canonical) ThreadLedger /
 * trajectory crossings / competence roadblocks off the {@link SeasonPlan} and run
 * {@link runEpisodeChargeMaterialization}. Returns `{ ran: false }` immediately
 * when there is no scene plan (non-scene-first mode → no ledger possible) or when
 * the ledger flag is off — so the monolith's call site stays a single line.
 *
 * The ThreadLedger / crossings / roadblocks are read defensively (they are not yet
 * canonical SeasonPlan fields — same pattern as `SeasonPlannerAgent`), tolerating
 * their absence (Plan Part 6: many contributors, one read path).
 */
export async function runEpisodeChargeMaterializationForSeason(
  seasonPlan: SeasonPlan | undefined,
  episodeNumber: number,
  choiceSets: AuthoredChoiceSetLike[],
  persist?: AnnotatedLedgerWriter,
): Promise<EpisodeChargeMaterializationOutcome> {
  const scenePlan = seasonPlan?.scenePlan;
  if (!scenePlan) return { ran: false };

  const extra = seasonPlan as unknown as {
    threadLedger?: ThreadLedger;
    trajectoryCrossings?: StateTrajectoryCrossing[];
    skillRoadblocks?: SkillRoadblock[];
  };
  return runEpisodeChargeMaterialization(
    {
      scenePlan,
      episodeNumber,
      choiceSets,
      threadLedger: extra.threadLedger,
      trajectoryCrossings: extra.trajectoryCrossings,
      roadblocks: extra.skillRoadblocks,
    },
    persist,
  );
}
