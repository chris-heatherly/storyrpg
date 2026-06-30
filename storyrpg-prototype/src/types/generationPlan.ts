/**
 * Generation Plan — shared types
 *
 * The structure-driven progress model for story generation (episodes -> scenes
 * -> beats). These are pure types only (no logic, no imports) so they can be
 * shared by the generation pipeline (src/ai-agents), the proxy job-state types,
 * and the generator progress UI without crossing the reader/generator boundary.
 *
 * The accumulation + math helpers live in
 * src/ai-agents/pipeline/generationPlan.ts (generator-only).
 */

export type PlanUnitStatus = 'pending' | 'active' | 'complete' | 'error';

/**
 * What an agent is currently doing on an active scene — drives the plain-language
 * "activity chip" in the generator progress UI. Maps to the responsible agent:
 * writing=SceneWriter, choices=ChoiceAuthor, encounter=EncounterArchitect,
 * art=image team, validating=continuity checks.
 */
export type SceneActivity = 'writing' | 'choices' | 'encounter' | 'art' | 'validating';

export interface BeatNode {
  id: string;
  status: PlanUnitStatus;
  /** True while this beat is a pre-write estimate (not yet a real authored beat). */
  estimated?: boolean;
}

export interface SceneNode {
  id: string;
  title?: string;
  status: PlanUnitStatus;
  /** Beat nodes — estimated up front, replaced with real beats once the scene is written. */
  beats: BeatNode[];
  /** Target/expected beat count (from getTargetBeatCountForScene) before the real count is known. */
  expectedBeatCount?: number;
  /** Current sub-step while this scene is active (cleared when complete). */
  activity?: SceneActivity;
  /** True when this scene is an encounter (combat/skill/social challenge). */
  isEncounter?: boolean;
}

export interface EpisodeNode {
  number: number;
  id?: string;
  title?: string;
  status: PlanUnitStatus;
  /** Scene nodes — empty until StoryArchitect runs for this episode. */
  scenes: SceneNode[];
  /** Expected scene count (from targetScenesPerEpisode) before the architect runs. */
  expectedSceneCount?: number;
}

/**
 * Weighted budget for one pipeline phase. `total` is estimated early and
 * refined as real counts arrive; `weight` is the phase's share of the headline
 * bar. Weights are relative — overall progress normalizes by their sum, so
 * phases that don't run for a given story can simply be omitted.
 */
export interface PhaseUnits {
  phase: string;
  weight: number;
  completed: number;
  total: number;
}

export interface GenerationPlan {
  totalEpisodes: number;
  /** Detailed content-phase tree. Drives the `content` phase fraction. */
  episodes: EpisodeNode[];
  /** All phases (including `content`), carrying budget weights. */
  phases: PhaseUnits[];
}
