/**
 * Pipeline run state (refactor R1, 2026-06-11).
 *
 * FullStoryPipeline historically held ~40 mutable instance fields with four
 * DIFFERENT lifetimes tangled on one `this`. This module makes the lifetimes
 * explicit by segmenting run state into one typed object:
 *
 *   - `season`  — cross-episode NARRATIVE state (canon, ledgers, plans, the
 *                 carried-forward snapshot). Serializable: this is the resume
 *                 payload — what a future run-graph runner rehydrates to
 *                 re-enter a run at an arbitrary step.
 *   - `episode` — per-episode scratch accumulators, reset at each episode
 *                 boundary (validation findings, encounter telemetry).
 *   - `run`     — run-cumulative accumulators (the all-episode mirrors of the
 *                 episode scratch, shadow diffs, advisory warnings).
 *
 * Migration approach (incremental, reference-preserving): FullStoryPipeline
 * keeps its existing field NAMES as thin delegating get/set accessors over
 * this object, so the ~10k existing `this.<field>` references (and the
 * Object.defineProperties live-read getters the memoized clusters use) keep
 * working unchanged. Later PRs migrate call sites to take state explicitly;
 * the accessors then retire segment by segment.
 */

import { SeasonCanon } from './seasonCanon';
import { CallbackLedger, type SerializedCallbackLedger } from './callbackLedger';
import type { ThreadLedger } from '../../types/narrativeThread';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { SeasonChoicePlan } from './seasonChoicePlan';
import type { SeasonSkillPlan } from './seasonSkillPlan';
import type { EpisodeStateSnapshot } from './episodeStateSnapshot';
import type { SceneValidationResult } from '../validators';
import type { EncounterTelemetry } from '../agents/EncounterArchitect';
import type { BranchShadowDiff } from '../utils/branchShadowDiff';

/**
 * Cross-episode narrative state — everything later episodes are generated
 * AGAINST. Serializable (see {@link serializeSeasonState}); together with the
 * per-artifact checkpoints this is sufficient to resume a run.
 */
export interface SeasonNarrativeState {
  /** Season Canon (P4): durable frozen facts + per-episode seals. */
  canon: SeasonCanon;
  /** Witcher-style delayed-consequence promises (Plan 1); persisted to 09-callback-ledger.json. */
  callbackLedger: CallbackLedger;
  /** Narrative-thread ledger (thread/twist planning; empty when the flag is off). */
  threadLedger: ThreadLedger;
  /** Per-episode twist plans (thread payoffs, setup/payoff timing). */
  episodeTwistPlans: Map<number, TwistPlan>;
  /** Per-episode character-arc targets (arc tracking; empty when the flag is off). */
  episodeArcTargets: Map<number, CharacterArcTargets>;
  /** E1: season-level choice-type budget; episodes draw their slice from it. */
  choicePlan?: SeasonChoicePlan;
  /** Post-architecture, post-rebalance per-scene choice-type contract. */
  choiceTypesByScene?: Record<string, string>;
  /** Season skill-progression plan; per-episode targets. */
  skillPlan?: SeasonSkillPlan;
  /** State at the end of the previous episode (seeded from disk on resume). */
  priorEpisodeSnapshot?: EpisodeStateSnapshot;
}

/** Per-episode scratch — reset at every episode boundary. */
export interface EpisodeScratchState {
  /** Per-scene validator findings for the CURRENT episode (deduped by scene). */
  sceneValidationResults: SceneValidationResult[];
  /** Per-encounter telemetry for the CURRENT episode. */
  encounterTelemetry: EncounterTelemetry[];
}

/** Run-cumulative accumulators — append-only across the whole run. */
export interface RunAccumulatorState {
  /** Cumulative scene-validation findings across all episodes. */
  allSceneValidationResults: SceneValidationResult[];
  /** Cumulative encounter telemetry across all episodes (season-final consumers). */
  allEncounterTelemetry: EncounterTelemetry[];
  /** I5: LLM-vs-deterministic branch-topology diffs (shadow mode only). */
  branchShadowDiffs: Array<{ episodeId: string; diff: BranchShadowDiff }>;
  /** Architecture-phase advisory warnings, folded into the run quality record. */
  architectAdvisoryWarnings: string[];
}

export interface PipelineRunState {
  season: SeasonNarrativeState;
  episode: EpisodeScratchState;
  run: RunAccumulatorState;
}

/** Fresh state for a new run. */
export function createRunState(): PipelineRunState {
  return {
    season: {
      canon: new SeasonCanon(),
      callbackLedger: new CallbackLedger(),
      threadLedger: { threads: [] },
      episodeTwistPlans: new Map(),
      episodeArcTargets: new Map(),
    },
    episode: {
      sceneValidationResults: [],
      encounterTelemetry: [],
    },
    run: {
      allSceneValidationResults: [],
      allEncounterTelemetry: [],
      branchShadowDiffs: [],
      architectAdvisoryWarnings: [],
    },
  };
}

/** Reset the per-episode scratch at an episode boundary. */
export function resetEpisodeScratch(state: PipelineRunState): void {
  state.episode.sceneValidationResults = [];
  state.episode.encounterTelemetry = [];
}

/** JSON-safe snapshot of the cross-episode narrative state (resume payload). */
export interface SerializedSeasonState {
  canon: unknown;
  callbackLedger: SerializedCallbackLedger;
  threadLedger: ThreadLedger;
  episodeTwistPlans: Array<[number, TwistPlan]>;
  episodeArcTargets: Array<[number, CharacterArcTargets]>;
  choicePlan?: SeasonChoicePlan;
  choiceTypesByScene?: Record<string, string>;
  skillPlan?: SeasonSkillPlan;
  priorEpisodeSnapshot?: EpisodeStateSnapshot;
}

/**
 * Serialize the season segment. The per-run artifacts (season-canon.json,
 * season-ledger.json, …) already persist canon + ledger individually; this is
 * the single-payload form a run-graph runner journals between steps.
 */
export function serializeSeasonState(season: SeasonNarrativeState): SerializedSeasonState {
  return {
    canon: season.canon.serialize(),
    callbackLedger: season.callbackLedger.serialize(),
    threadLedger: season.threadLedger,
    episodeTwistPlans: [...season.episodeTwistPlans.entries()],
    episodeArcTargets: [...season.episodeArcTargets.entries()],
    choicePlan: season.choicePlan,
    choiceTypesByScene: season.choiceTypesByScene,
    skillPlan: season.skillPlan,
    priorEpisodeSnapshot: season.priorEpisodeSnapshot,
  };
}
