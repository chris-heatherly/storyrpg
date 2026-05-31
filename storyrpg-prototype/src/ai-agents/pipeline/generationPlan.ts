/**
 * Generation Plan
 *
 * A structure-driven progress model for the story generation pipeline. The
 * pipeline builds this object up as it *discovers* structure — episode count
 * up front, scene count after StoryArchitect, beat count after SceneWriter —
 * and emits snapshots so the generator UI can show real progress (episodes ->
 * scenes -> beats) instead of a hardcoded time ramp.
 *
 * Progress is fully unit-weighted: every phase carries a budget weight and a
 * fraction-complete, and the headline % is the weighted mean of those
 * fractions. The `content` phase is special — its fraction comes from the
 * nested episode -> scene -> beat tree rather than a flat completed/total.
 *
 * This module is intentionally pure (no pipeline/`this` access, no I/O) so the
 * math and accumulation can be unit-tested in isolation and so we don't grow
 * the FullStoryPipeline monolith. Helpers mutate the plan in place and return
 * it for convenience; emit a JSON clone (`snapshotPlan`) when crossing a
 * process/serialization boundary.
 */

import type {
  BeatNode,
  EpisodeNode,
  GenerationPlan,
  PlanUnitStatus,
  SceneActivity,
  SceneNode,
} from '../../types/generationPlan';

export type {
  PlanUnitStatus,
  SceneActivity,
  BeatNode,
  SceneNode,
  EpisodeNode,
  PhaseUnits,
  GenerationPlan,
} from '../../types/generationPlan';

/** The phase whose fraction is computed from the episode tree, not completed/total. */
export const CONTENT_PHASE = 'content';

/**
 * Default phase weights, derived from the spans implied by the legacy
 * GENERATION_MILESTONES ramp (proxy/workerProgress.js) so overall pacing stays
 * familiar. Weights are relative; only the phases actually present in a plan
 * are counted (see `computeOverallProgress`).
 */
export const DEFAULT_PHASE_WEIGHTS: Record<string, number> = {
  foundation: 8, // queued / init / source analysis
  world: 10,
  characters: 16,
  content: 36, // largest block — per-episode architecture + scene/beat tree
  images: 24, // master + per-scene/episode imagery
  audio: 3,
  assembly: 3,
};

/**
 * Map a (normalized) pipeline phase id to the plan phase whose budget it counts
 * toward. `architecture` folds into `content` because it is per-episode work
 * interleaved with scene writing (and the content fraction is driven by the
 * episode tree, not this mapping). Returns undefined for unmapped phases.
 */
export function phaseToPlanKey(phase?: string): string | undefined {
  if (!phase) return undefined;
  const p = phase.toLowerCase();
  if (p === 'queued' || p === 'init' || p === 'initialization' || p === 'processing') return 'foundation';
  if (p === 'source_analysis' || p === 'multi_episode_init' || p === 'season_plan') return 'foundation';
  if (p === 'foundation') return 'foundation';
  if (p === 'world' || p === 'world_bible') return 'world';
  if (p === 'characters' || p === 'character_bible' || p === 'character_design' || p === 'npc_validation') return 'characters';
  if (
    p.includes('architecture') ||
    p.startsWith('branch') ||
    p === 'content' ||
    p === 'episode_parallelism' ||
    p.includes('scene') ||
    p.includes('choice') ||
    (p.includes('encounter') && !p.includes('image')) ||
    p === 'quick_validation' ||
    p === 'qa' ||
    p.startsWith('qa_ep_') ||
    /^episode_\d+$/.test(p)
  ) {
    return 'content';
  }
  if (
    p === 'master_images' ||
    p === 'images' ||
    p === 'encounter_images' ||
    p === 'image_manifest' ||
    p === 'video_generation' ||
    p.startsWith('images_ep_')
  ) {
    return 'images';
  }
  if (p === 'audio_generation') return 'audio';
  if (p === 'assembly' || p === 'saving' || p === 'final_story' || p === 'final_story_package' || p === 'browser_qa') {
    return 'assembly';
  }
  return undefined;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const makeEstimatedBeats = (sceneId: string, count: number): BeatNode[] => {
  const safe = Math.max(0, Math.floor(count));
  const beats: BeatNode[] = [];
  for (let i = 0; i < safe; i += 1) {
    beats.push({ id: `${sceneId}#b${i + 1}`, status: 'pending', estimated: true });
  }
  return beats;
};

export interface EpisodeSeed {
  number: number;
  id?: string;
  title?: string;
  expectedSceneCount?: number;
}

export interface PhaseSeed {
  phase: string;
  weight?: number;
  total?: number;
}

/**
 * Seed a fresh plan. Episodes start `pending` with their expected scene counts;
 * phases start at 0/total with their budget weights. Pass an explicit `phases`
 * list to scope the bar to the phases this run will actually execute (e.g. omit
 * `images`/`audio` when those are disabled).
 */
export function initPlan(opts: {
  totalEpisodes: number;
  episodes: EpisodeSeed[];
  phases?: PhaseSeed[];
}): GenerationPlan {
  const phaseSeeds: PhaseSeed[] =
    opts.phases && opts.phases.length > 0
      ? opts.phases
      : Object.keys(DEFAULT_PHASE_WEIGHTS).map((phase) => ({ phase }));

  return {
    totalEpisodes: Math.max(1, opts.totalEpisodes),
    episodes: opts.episodes.map((seed) => ({
      number: seed.number,
      id: seed.id,
      title: seed.title,
      status: 'pending',
      scenes: [],
      expectedSceneCount: seed.expectedSceneCount,
    })),
    phases: phaseSeeds.map((seed) => ({
      phase: seed.phase,
      weight: seed.weight ?? DEFAULT_PHASE_WEIGHTS[seed.phase] ?? 1,
      completed: 0,
      total: Math.max(0, seed.total ?? 0),
    })),
  };
}

const findEpisode = (plan: GenerationPlan, episodeNumber: number): EpisodeNode | undefined =>
  plan.episodes.find((ep) => ep.number === episodeNumber);

/**
 * Fill an episode's scenes once the architect has produced its blueprint. Each
 * scene is pre-seeded with estimated beats (from `expectedBeatCount`) so the UI
 * can show structure before the prose is written. Marks the episode `active`.
 */
export function setEpisodeScenes(
  plan: GenerationPlan,
  episodeNumber: number,
  scenes: Array<{ id: string; title?: string; expectedBeatCount?: number; isEncounter?: boolean }>,
): GenerationPlan {
  const episode = findEpisode(plan, episodeNumber);
  if (!episode) return plan;
  episode.scenes = scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    status: 'pending',
    expectedBeatCount: scene.expectedBeatCount,
    isEncounter: scene.isEncounter,
    beats: makeEstimatedBeats(scene.id, scene.expectedBeatCount ?? 0),
  }));
  episode.expectedSceneCount = scenes.length;
  if (episode.status === 'pending') episode.status = 'active';
  return plan;
}

/**
 * Replace a scene's estimated beats with the real authored count and mark the
 * scene (and its beats) complete. Scenes are written atomically by SceneWriter,
 * so this is the estimate-then-fill transition.
 */
export function setSceneBeats(
  plan: GenerationPlan,
  episodeNumber: number,
  sceneId: string,
  realBeatCount: number,
): GenerationPlan {
  const episode = findEpisode(plan, episodeNumber);
  const scene = episode?.scenes.find((s) => s.id === sceneId);
  if (!scene) return plan;
  const safe = Math.max(0, Math.floor(realBeatCount));
  scene.beats = [];
  for (let i = 0; i < safe; i += 1) {
    scene.beats.push({ id: `${sceneId}#b${i + 1}`, status: 'complete', estimated: false });
  }
  scene.expectedBeatCount = safe;
  scene.status = 'complete';
  scene.activity = undefined;
  return plan;
}

/** Mark a scene active and set what's currently happening on it. */
export function markSceneActive(
  plan: GenerationPlan,
  episodeNumber: number,
  sceneId: string,
  activity: SceneActivity,
): GenerationPlan {
  const episode = findEpisode(plan, episodeNumber);
  const scene = episode?.scenes.find((s) => s.id === sceneId);
  if (scene) {
    if (scene.status !== 'complete') scene.status = 'active';
    scene.activity = activity;
  }
  return plan;
}

export function markScene(
  plan: GenerationPlan,
  episodeNumber: number,
  sceneId: string,
  status: PlanUnitStatus,
): GenerationPlan {
  const episode = findEpisode(plan, episodeNumber);
  const scene = episode?.scenes.find((s) => s.id === sceneId);
  if (scene) scene.status = status;
  return plan;
}

export function markEpisode(
  plan: GenerationPlan,
  episodeNumber: number,
  status: PlanUnitStatus,
): GenerationPlan {
  const episode = findEpisode(plan, episodeNumber);
  if (episode) episode.status = status;
  return plan;
}

/** Update a non-content phase's unit counts (characters, images, audio, …). */
export function setPhaseUnits(
  plan: GenerationPlan,
  phase: string,
  units: { completed?: number; total?: number },
): GenerationPlan {
  const entry = plan.phases.find((p) => p.phase === phase);
  if (!entry) return plan;
  if (typeof units.total === 'number') entry.total = Math.max(0, units.total);
  if (typeof units.completed === 'number') {
    entry.completed = Math.max(0, Math.min(units.completed, entry.total || units.completed));
  }
  return plan;
}

const completedBeats = (scene: SceneNode): number =>
  scene.beats.filter((b) => b.status === 'complete').length;

const sceneFraction = (scene: SceneNode): number => {
  if (scene.status === 'complete') return 1;
  if (scene.beats.length > 0) {
    const denom = Math.max(scene.expectedBeatCount ?? 0, scene.beats.length);
    return denom > 0 ? clamp01(completedBeats(scene) / denom) : 0;
  }
  return 0;
};

/** Weight a scene by its (expected or real) beat count, floored at 1. */
const sceneWeight = (scene: SceneNode): number =>
  Math.max(1, scene.expectedBeatCount ?? scene.beats.length ?? 1);

const episodeFraction = (episode: EpisodeNode): number => {
  if (episode.status === 'complete') return 1;
  if (episode.scenes.length > 0) {
    let wsum = 0;
    let acc = 0;
    for (const scene of episode.scenes) {
      const w = sceneWeight(scene);
      wsum += w;
      acc += w * sceneFraction(scene);
    }
    return wsum > 0 ? clamp01(acc / wsum) : 0;
  }
  return 0;
};

/**
 * Nested fractional progress of the content phase: the mean episode fraction
 * over the planned episode count. 1 of 3 episodes complete ⇒ ~0.333.
 */
export function computeContentFraction(plan: GenerationPlan): number {
  const total = Math.max(1, plan.totalEpisodes);
  let acc = 0;
  for (const episode of plan.episodes) acc += episodeFraction(episode);
  return clamp01(acc / total);
}

/**
 * Headline overall progress (0-100): the weight-normalized mean of each phase's
 * fraction. The `content` phase fraction comes from the episode tree; all other
 * phases use completed/total.
 */
export function computeOverallProgress(plan: GenerationPlan): number {
  let wsum = 0;
  let acc = 0;
  for (const phase of plan.phases) {
    const fraction =
      phase.phase === CONTENT_PHASE
        ? computeContentFraction(plan)
        : phase.total > 0
          ? clamp01(phase.completed / phase.total)
          : 0;
    wsum += phase.weight;
    acc += phase.weight * fraction;
  }
  return wsum > 0 ? Math.max(0, Math.min(100, Math.round((acc / wsum) * 100))) : 0;
}

/**
 * Keep the non-content phases of a plan in sync from the generic phase/telemetry
 * events the pipeline already emits. The `content` phase is driven exclusively by
 * the episode tree, so it is skipped here. Mutates and returns the plan.
 */
export function applyEventToPlan(
  plan: GenerationPlan,
  event: { type?: string; phase?: string; data?: unknown },
): GenerationPlan {
  const raw = event.data as
    | { generationPlan?: unknown; currentItem?: number; totalItems?: number; imageIndex?: number; totalImages?: number }
    | undefined;
  if (raw && raw.generationPlan) return plan; // our own snapshot emit — don't reprocess
  const planKey = phaseToPlanKey(event.phase);
  if (!planKey || planKey === CONTENT_PHASE) return plan;

  if (event.type === 'phase_complete') {
    const entry = plan.phases.find((p) => p.phase === planKey);
    const total = entry && entry.total > 0 ? entry.total : 1;
    return setPhaseUnits(plan, planKey, { total, completed: total });
  }

  if (raw && typeof raw === 'object') {
    if (typeof raw.imageIndex === 'number' && typeof raw.totalImages === 'number' && raw.totalImages > 0) {
      return setPhaseUnits(plan, planKey, { total: raw.totalImages, completed: raw.imageIndex });
    }
    if (typeof raw.currentItem === 'number' && typeof raw.totalItems === 'number' && raw.totalItems > 0) {
      return setPhaseUnits(plan, planKey, { total: raw.totalItems, completed: raw.currentItem });
    }
  }
  return plan;
}

/** Deep clone for emission across a serialization boundary. */
export function snapshotPlan(plan: GenerationPlan): GenerationPlan {
  return JSON.parse(JSON.stringify(plan)) as GenerationPlan;
}
