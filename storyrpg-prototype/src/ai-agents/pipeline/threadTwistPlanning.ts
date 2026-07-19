/**
 * Thread/Twist planning wiring (Phase 5.3 + Phase 6).
 *
 * ThreadPlanner and TwistArchitect were fully built and exported but nothing in
 * the pipeline ever invoked them: SceneWriter's `activeThreads` /
 * `twistDirectives` inputs were always undefined and the SetupPayoffValidator /
 * TwistQualityValidator validated absent ledgers vacuously. This module is the
 * seam that runs both agents once per episode — after the StoryArchitect
 * blueprint is finalized, before any scene prose — and maps their outputs onto
 * SceneWriter's input shapes and the narrative-diagnostics inputs.
 *
 * All logic lives here rather than in FullStoryPipeline (monolith ratchet); the
 * pipeline calls a small seam.
 *
 * Default-off contract: gated by `STORYRPG_THREAD_TWIST_PLANNING` (env) /
 * `generation.enableThreadAndTwistPlanning` (config). With the flag off the
 * pipeline never constructs the agents, the run-level ledger stays empty, and
 * the per-scene mappers return `undefined` — behavior is byte-identical to
 * before.
 *
 * Both agents are documented fail-open: any failure here (throw, timeout,
 * empty output) logs a pipeline warning and generation continues WITHOUT
 * threads/twists — it never aborts the run.
 */

import type { AgentResponse } from '../agents/BaseAgent';
import type { ThreadPlannerInput } from '../agents/ThreadPlanner';
import type { TwistArchitectInput, TwistPlan, TwistKind } from '../agents/TwistArchitect';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { GenerationSettingsConfig } from '../config';
import type { NarrativeThread, ThreadLedger } from '../../types';
import type {
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';

// ========================================
// Feature flag
// ========================================

export const THREAD_TWIST_PLANNING_ENV = 'STORYRPG_THREAD_TWIST_PLANNING';

/**
 * Whether thread/twist planning is on. Resolution mirrors the gate-registry
 * convention (gateDefaults.isGateEnabled): env `'1'` forces on, env `'0'`
 * forces off (kill-switch), otherwise the config field decides — and the
 * config default is OFF pending a live validation run.
 */
export function isThreadTwistPlanningEnabled(generation?: GenerationSettingsConfig): boolean {
  const env = typeof process !== 'undefined' ? process.env[THREAD_TWIST_PLANNING_ENV] : undefined;
  if (env === '1') return true;
  if (env === '0') return false;
  return generation?.enableThreadAndTwistPlanning === true;
}

// ========================================
// Agent seams (interfaces so tests can mock without LLM calls)
// ========================================

export interface ThreadPlannerLike {
  execute(input: ThreadPlannerInput): Promise<AgentResponse<ThreadLedger>>;
}

export interface TwistArchitectLike {
  execute(input: TwistArchitectInput): Promise<AgentResponse<TwistPlan>>;
}

export interface PlanEpisodeThreadsAndTwistParams {
  /** Resolved feature flag — when false this is a guaranteed no-op. */
  enabled: boolean;
  threadPlanner: ThreadPlannerLike;
  twistArchitect: TwistArchitectLike;
  episodeBlueprint: EpisodeBlueprint;
  episodeNumber: number;
  seasonAnchors?: StoryAnchors;
  seasonStoryCircle?: StoryCircleStructure;
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  /** Open threads from PRIOR episodes (see `openPriorThreads`). */
  priorThreads?: NarrativeThread[];
  /** Fail-open reporter — wired to `this.emit({ type: 'warning', … })`. */
  emitWarning: (message: string) => void;
  /** Override for tests; defaults to the shared per-agent LLM budget. */
  timeoutMs?: number;
}

export interface EpisodeThreadTwistResult {
  /** Present only when ThreadPlanner produced a non-empty ledger. */
  threadLedger?: ThreadLedger;
  /** Present only when TwistArchitect produced a non-empty plan. */
  twistPlan?: TwistPlan;
}

export interface TwistMaterializationResult {
  status: 'not_planned' | 'materialized' | 'deferred' | 'invalid';
  foreshadowBeatId?: string;
  twistBeatId?: string;
  reason?: string;
}

export interface TwistDeferralContract {
  generatedThroughEpisode: number;
  deferredUntilEpisode: number;
  reason: string;
}

export interface TwistSceneBindingResult {
  status: 'not_planned' | 'not_owner' | 'bound' | 'invalid';
  role?: 'foreshadow' | 'reveal';
  beatId?: string;
  reason?: string;
}

/**
 * Bind one twist-plan role while its owning scene is still mutable. This is
 * the production path: no previously committed scene is reopened when the
 * later reveal scene is generated.
 */
export function materializeTwistSceneBeforeCommit(
  plan: TwistPlan | undefined,
  scene: SceneContent,
): TwistSceneBindingResult {
  if (!plan) return { status: 'not_planned' };
  const isForeshadow = scene.sceneId === plan.foreshadowSceneId;
  const isReveal = scene.sceneId === plan.twistSceneId;
  if (!isForeshadow && !isReveal) return { status: 'not_owner' };
  if (isForeshadow && isReveal) {
    return {
      status: 'invalid',
      reason: `Twist plan assigns foreshadow and reveal to the same scene ${scene.sceneId}.`,
    };
  }

  const role = isForeshadow ? 'foreshadow' : 'reveal';
  const plannedBeatId = isForeshadow ? plan.foreshadowBeatId : plan.twistBeatId;
  const beat = scene.beats.find((candidate) => candidate.id === plannedBeatId)
    || (isForeshadow
      ? scene.beats.find((candidate) => !candidate.isChoicePoint) || scene.beats[0]
      : [...scene.beats].reverse().find((candidate) => !candidate.isChoicePoint) || scene.beats[scene.beats.length - 1]);
  if (!beat) {
    return {
      status: 'invalid',
      role,
      reason: `Twist ${role} scene ${scene.sceneId} has no generated prose beat to bind.`,
    };
  }

  beat.plotPointType = isForeshadow ? 'setup' : plan.kind === 'revelation' ? 'revelation' : 'twist';
  beat.twistKind = plan.kind;
  if (isForeshadow) plan.foreshadowBeatId = beat.id;
  else plan.twistBeatId = beat.id;
  plan.directives = plan.directives.map((directive) => {
    if (directive.sceneId !== scene.sceneId) return directive;
    const ownsRole = isForeshadow
      ? directive.beatRole === 'foreshadow' || directive.beatRole === 'misdirect'
      : directive.beatRole === 'reveal' || directive.beatRole === 'aftermath';
    return ownsRole ? { ...directive, beatId: beat.id } : directive;
  });
  if (isReveal) {
    plan.realization = {
      status: 'materialized',
      foreshadowBeatId: plan.foreshadowBeatId,
      twistBeatId: beat.id,
    };
  }
  return { status: 'bound', role, beatId: beat.id };
}

/**
 * Reconcile plan-time placeholder beat ids with the concrete beats SceneWriter
 * returned. This only writes narrative metadata; it never authors prose.
 */
export function materializeTwistPlan(
  plan: TwistPlan | undefined,
  sceneContents: SceneContent[],
  deferral?: TwistDeferralContract,
): TwistMaterializationResult {
  if (!plan) return { status: 'not_planned' };
  const foreshadowSceneIndex = sceneContents.findIndex((scene) => scene.sceneId === plan.foreshadowSceneId);
  const twistSceneIndex = sceneContents.findIndex((scene) => scene.sceneId === plan.twistSceneId);
  if (foreshadowSceneIndex < 0 || twistSceneIndex < 0) {
    if (deferral && deferral.deferredUntilEpisode > deferral.generatedThroughEpisode) {
      plan.realization = {
        status: 'deferred',
        deferredUntilEpisode: deferral.deferredUntilEpisode,
        reason: deferral.reason,
      };
      return { status: 'deferred', reason: deferral.reason };
    }
    return {
      status: 'invalid',
      reason: `Twist plan references missing scene(s): foreshadow=${plan.foreshadowSceneId}, twist=${plan.twistSceneId}.`,
    };
  }
  if (foreshadowSceneIndex >= twistSceneIndex) {
    return {
      status: 'invalid',
      reason: `Twist foreshadow scene ${plan.foreshadowSceneId} must precede reveal scene ${plan.twistSceneId}.`,
    };
  }
  const foreshadowScene = sceneContents[foreshadowSceneIndex];
  const twistScene = sceneContents[twistSceneIndex];
  const foreshadowBeat = foreshadowScene.beats.find((beat) => beat.id === plan.foreshadowBeatId)
    || foreshadowScene.beats.find((beat) => !beat.isChoicePoint)
    || foreshadowScene.beats[0];
  const twistBeat = twistScene.beats.find((beat) => beat.id === plan.twistBeatId)
    || [...twistScene.beats].reverse().find((beat) => !beat.isChoicePoint)
    || twistScene.beats[twistScene.beats.length - 1];
  if (!foreshadowBeat || !twistBeat) {
    return {
      status: 'invalid',
      reason: `Twist plan cannot materialize because ${!foreshadowBeat ? plan.foreshadowSceneId : plan.twistSceneId} has no generated beat.`,
    };
  }

  foreshadowBeat.plotPointType = 'setup';
  foreshadowBeat.twistKind = plan.kind;
  twistBeat.plotPointType = plan.kind === 'revelation' ? 'revelation' : 'twist';
  twistBeat.twistKind = plan.kind;
  plan.foreshadowBeatId = foreshadowBeat.id;
  plan.twistBeatId = twistBeat.id;
  plan.directives = plan.directives.map((directive) => {
    if (directive.sceneId === plan.foreshadowSceneId && (directive.beatRole === 'foreshadow' || directive.beatRole === 'misdirect')) {
      return { ...directive, beatId: foreshadowBeat.id };
    }
    if (directive.sceneId === plan.twistSceneId && (directive.beatRole === 'reveal' || directive.beatRole === 'aftermath')) {
      return { ...directive, beatId: twistBeat.id };
    }
    return directive;
  });
  plan.realization = {
    status: 'materialized',
    foreshadowBeatId: foreshadowBeat.id,
    twistBeatId: twistBeat.id,
  };
  return {
    status: 'materialized',
    foreshadowBeatId: foreshadowBeat.id,
    twistBeatId: twistBeat.id,
  };
}

/**
 * Run ThreadPlanner then TwistArchitect for one episode. Each call is wrapped
 * in the same withTimeout(PIPELINE_TIMEOUTS.llmAgent) budget neighboring agent
 * calls use, and each fails OPEN: on error/timeout/empty output we warn and
 * return without that half so generation continues unchanged.
 */
export async function planEpisodeThreadsAndTwist(
  params: PlanEpisodeThreadsAndTwistParams,
): Promise<EpisodeThreadTwistResult> {
  if (!params.enabled) return {};
  const timeoutMs = params.timeoutMs ?? PIPELINE_TIMEOUTS.llmAgent;
  const episodeId = params.episodeBlueprint.episodeId;

  let threadLedger: ThreadLedger | undefined;
  try {
    const res = await withTimeout(
      params.threadPlanner.execute({
        episodeBlueprint: params.episodeBlueprint,
        priorThreads: params.priorThreads?.length ? params.priorThreads : undefined,
        seasonAnchors: params.seasonAnchors,
        seasonStoryCircle: params.seasonStoryCircle,
        episodeStoryCircleRole: params.episodeStoryCircleRole,
      }),
      timeoutMs,
      `ThreadPlanner.execute(${episodeId})`,
    );
    if (res.success && res.data?.threads?.length) {
      threadLedger = {
        ...res.data,
        // Stamp the episode so cross-episode mapping (plant-vs-payoff scoping,
        // openPriorThreads) works even when the LLM omitted the field.
        threads: res.data.threads.map((t) => ({
          ...t,
          introducedInEpisode: t.introducedInEpisode ?? params.episodeNumber,
        })),
      };
    } else if (res.error) {
      // The agent fails open internally (success:true + empty ledger + error).
      params.emitWarning(
        `ThreadPlanner produced no threads for ${episodeId} (continuing without thread planning): ${res.error}`,
      );
    }
  } catch (err) {
    params.emitWarning(
      `ThreadPlanner failed for ${episodeId} (continuing without thread planning): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let twistPlan: TwistPlan | undefined;
  try {
    const res = await withTimeout(
      params.twistArchitect.execute({
        episodeBlueprint: params.episodeBlueprint,
        threadLedger,
        seasonAnchors: params.seasonAnchors,
        seasonStoryCircle: params.seasonStoryCircle,
        episodeStoryCircleRole: params.episodeStoryCircleRole,
      }),
      timeoutMs,
      `TwistArchitect.execute(${episodeId})`,
    );
    const plan = res.success ? res.data : undefined;
    // TwistArchitect's internal fail-open returns an EMPTY plan — treat it the
    // same as no plan so downstream consumers stay undefined.
    if (plan && (plan.directives?.length > 0 || plan.twistSceneId)) {
      twistPlan = plan;
    } else if (res.error) {
      params.emitWarning(
        `TwistArchitect produced no twist plan for ${episodeId} (continuing without a scheduled twist): ${res.error}`,
      );
    }
  } catch (err) {
    params.emitWarning(
      `TwistArchitect failed for ${episodeId} (continuing without a scheduled twist): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { threadLedger, twistPlan };
}

// ========================================
// Run-level ledger accumulation (cross-episode state)
// ========================================

/**
 * Merge an episode's fresh ledger into the run-level season ledger (held as a
 * pipeline instance field, mirroring the callback ledger). New threads append;
 * a re-emitted prior thread (the planner may extend / pay off priorThreads) is
 * updated in place with its plants/payoffs unioned (deduped by scene+beat) and
 * its original `introducedInEpisode` preserved.
 */
export function mergeIntoSeasonLedger(
  season: ThreadLedger,
  episode: ThreadLedger,
  episodeNumber: number,
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const refKey = (r: { sceneId: string; beatId: string }) => `${r.sceneId}::${r.beatId}`;
  const dedupe = <T extends { sceneId: string; beatId: string }>(refs: T[]): T[] => {
    const seen = new Set<string>();
    return refs.filter((r) => {
      const key = refKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  for (const incomingRaw of episode.threads ?? []) {
    const incoming: NarrativeThread = {
      ...incomingRaw,
      introducedInEpisode: incomingRaw.introducedInEpisode ?? episodeNumber,
    };
    const idx = season.threads.findIndex((t) => t.id === incoming.id);
    if (idx === -1) {
      season.threads.push(incoming);
      added++;
    } else {
      const existing = season.threads[idx];
      season.threads[idx] = {
        ...existing,
        ...incoming,
        introducedInEpisode: existing.introducedInEpisode ?? incoming.introducedInEpisode,
        plants: dedupe([...(existing.plants ?? []), ...(incoming.plants ?? [])]),
        payoffs: dedupe([...(existing.payoffs ?? []), ...(incoming.payoffs ?? [])]),
      };
      updated++;
    }
  }
  if (episode.designNotes) {
    season.designNotes = [season.designNotes, episode.designNotes].filter(Boolean).join('\n');
  }
  return { added, updated };
}

/**
 * Threads introduced in EARLIER episodes that are still open (no payoff beat
 * recorded yet) — fed to the next episode's ThreadPlanner as `priorThreads` so
 * it can extend / pay off / reframe them instead of always inventing new ones.
 */
export function openPriorThreads(season: ThreadLedger, episodeNumber: number): NarrativeThread[] {
  return (season.threads ?? []).filter(
    (t) =>
      (t.introducedInEpisode ?? episodeNumber) < episodeNumber &&
      (t.payoffs ?? []).length === 0,
  );
}

// ========================================
// Per-scene mapping onto SceneWriter input shapes
// ========================================

/** Matches SceneWriterInput.activeThreads (its own, narrower kind enum). */
export interface SceneActiveThread {
  id: string;
  kind: 'seed' | 'clue' | 'promise' | 'secret' | 'foreshadow';
  label: string;
  action: 'plant' | 'payoff' | 'reference';
  hint?: string;
}

/** Matches SceneWriterInput.twistDirectives (its own, narrower beatRole enum). */
export interface SceneTwistDirective {
  twistKind: TwistKind;
  beatRole: 'setup' | 'twist' | 'satisfaction';
  hint: string;
}

/** Keep prompts tight: at most this many open prior threads referenced per scene. */
const MAX_REFERENCE_THREADS_PER_SCENE = 2;

/** ThreadKind ('reveal' included) -> SceneWriter's activeThreads kind enum. */
function toSceneWriterKind(kind: NarrativeThread['kind']): SceneActiveThread['kind'] {
  // The plant of a 'reveal' thread is, from the writer's seat, a foreshadow.
  return kind === 'reveal' ? 'foreshadow' : kind;
}

/**
 * Threads relevant to one scene: a plant entry for each current-episode thread
 * that plants here, a payoff entry for each thread that pays off here, plus up
 * to MAX_REFERENCE_THREADS_PER_SCENE open MAJOR prior-episode threads as
 * 'reference' (keep-alive, don't resolve). Prior-episode threads never match
 * by plant (their plants live in earlier episodes' scene ids; matching them
 * here could re-plant on a scene-id collision). Returns undefined when there
 * is nothing for the scene so the SceneWriter prompt is unchanged.
 */
export function sceneActiveThreads(
  ledger: ThreadLedger | undefined,
  sceneId: string,
  episodeNumber: number,
): SceneActiveThread[] | undefined {
  if (!ledger || (ledger.threads ?? []).length === 0) return undefined;
  const targeted: SceneActiveThread[] = [];
  const references: SceneActiveThread[] = [];

  for (const t of ledger.threads) {
    const introduced = t.introducedInEpisode ?? episodeNumber;
    const isCurrentEpisode = introduced === episodeNumber;
    const plant = isCurrentEpisode ? (t.plants ?? []).find((p) => p.sceneId === sceneId) : undefined;
    const payoff = (t.payoffs ?? []).find((p) => p.sceneId === sceneId);
    const base = { id: t.id, kind: toSceneWriterKind(t.kind), label: t.label };

    if (plant) targeted.push({ ...base, action: 'plant', hint: plant.note });
    if (payoff) targeted.push({ ...base, action: 'payoff', hint: payoff.reframe ?? payoff.note });
    if (!plant && !payoff && !isCurrentEpisode && t.priority === 'major' && (t.payoffs ?? []).length === 0) {
      references.push({
        ...base,
        action: 'reference',
        hint: `Open thread from episode ${introduced} — keep it alive; do not resolve it here.`,
      });
    }
  }

  const out = [...targeted, ...references.slice(0, MAX_REFERENCE_THREADS_PER_SCENE)];
  return out.length > 0 ? out : undefined;
}

/**
 * TwistArchitect directive beatRole -> SceneWriter's twistDirectives beatRole.
 * (TwistArchitect emits foreshadow|misdirect|reveal|aftermath; SceneWriter
 * consumes the narrower setup|twist|satisfaction.)
 */
function toSceneWriterBeatRole(
  role: 'foreshadow' | 'misdirect' | 'reveal' | 'aftermath',
): SceneTwistDirective['beatRole'] {
  switch (role) {
    case 'reveal':
      return 'twist';
    case 'aftermath':
      return 'satisfaction';
    case 'foreshadow':
    case 'misdirect':
    default:
      return 'setup';
  }
}

/**
 * The TwistPlan directives targeting one scene, mapped onto SceneWriter's
 * shape. Returns undefined when there is no plan or no directive for the scene
 * so the SceneWriter prompt is unchanged.
 */
export function sceneTwistDirectives(
  twistPlan: TwistPlan | undefined,
  sceneId: string,
): SceneTwistDirective[] | undefined {
  if (!twistPlan) return undefined;
  const directives = (twistPlan.directives ?? [])
    .filter((d) => d.sceneId === sceneId)
    .map((d) => ({
      twistKind: d.twistKind,
      beatRole: toSceneWriterBeatRole(d.beatRole),
      hint: d.hint,
    }));
  return directives.length > 0 ? directives : undefined;
}
