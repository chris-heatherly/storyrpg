/**
 * Pipeline Checkpointing
 *
 * Types and helpers for mid-run checkpoints produced by the story generation
 * pipelines. Extracted from FullStoryPipeline.ts as part of the Phase 3
 * tech-debt breakup so the checkpoint data model and phase→step mapping can
 * be reviewed / tested independently of the 13k-line orchestrator.
 */

export interface CheckpointData {
  phase: string;
  data: unknown;
  timestamp: Date;
  requiresApproval: boolean;
}

/**
 * Identifiers for the logical "steps" the UI/worker surfaces during a
 * generation run. These are intentionally stable — the worker persists
 * them in job state, so renaming is a breaking change.
 */
export const CHECKPOINT_STEP_IDS = [
  'brief',
  'sourceAnalysis',
  'worldBible',
  'characterBible',
  'episodeBlueprint',
  'branchAnalysis',
  'sceneContent',
  'choiceContent',
  'encounterContent',
  'qualityAssurance',
  'assembly',
  'imageGeneration',
  'videoGeneration',
  'finalize',
] as const;

export type CheckpointStepId = (typeof CHECKPOINT_STEP_IDS)[number];

/**
 * Map internal phase labels (free-form strings emitted by the pipeline) to
 * the stable CheckpointStepId surfaced to the UI.
 *
 * Keep this exhaustive — new phases should map to an existing step or get
 * a new step id added to CHECKPOINT_STEP_IDS.
 */
const PHASE_TO_STEP: Readonly<Record<string, CheckpointStepId>> = {
  brief: 'brief',
  'source-analysis': 'sourceAnalysis',
  sourceAnalysis: 'sourceAnalysis',
  'world-building': 'worldBible',
  worldBuilding: 'worldBible',
  'character-design': 'characterBible',
  characterDesign: 'characterBible',
  'episode-architecture': 'episodeBlueprint',
  episodeArchitecture: 'episodeBlueprint',
  'branch-analysis': 'branchAnalysis',
  branchAnalysis: 'branchAnalysis',
  'scene-generation': 'sceneContent',
  sceneGeneration: 'sceneContent',
  'choice-generation': 'choiceContent',
  choiceGeneration: 'choiceContent',
  'encounter-generation': 'encounterContent',
  encounterGeneration: 'encounterContent',
  'quality-assurance': 'qualityAssurance',
  qualityAssurance: 'qualityAssurance',
  assembly: 'assembly',
  'image-generation': 'imageGeneration',
  imageGeneration: 'imageGeneration',
  'video-generation': 'videoGeneration',
  videoGeneration: 'videoGeneration',
  finalize: 'finalize',
};

/**
 * Map a pipeline phase string to a stable step id the UI can pin to.
 * Returns null for phases that don't correspond to an approval-worthy step.
 */
export function mapCheckpointPhaseToStepId(
  phase: string,
): CheckpointStepId | null {
  return PHASE_TO_STEP[phase] ?? null;
}

/**
 * Small in-memory registry used by the orchestrator to track checkpoints
 * emitted during a run. The pipeline keeps the authoritative store today;
 * this registry is intended as the seed for a future extraction where
 * FullStoryPipeline delegates to a CheckpointManager instead of holding
 * its own Map.
 */
export class CheckpointRegistry {
  private checkpoints: CheckpointData[] = [];

  add(phase: string, data: unknown, requiresApproval: boolean): CheckpointData {
    const checkpoint: CheckpointData = {
      phase,
      data,
      timestamp: new Date(),
      requiresApproval,
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  list(): readonly CheckpointData[] {
    return this.checkpoints;
  }

  latestFor(phase: string): CheckpointData | undefined {
    for (let i = this.checkpoints.length - 1; i >= 0; i -= 1) {
      const cp = this.checkpoints[i];
      if (cp.phase === phase) return cp;
    }
    return undefined;
  }

  clear(): void {
    this.checkpoints = [];
  }

  get size(): number {
    return this.checkpoints.length;
  }
}
