/**
 * Progress telemetry tracker (pure move from FullStoryPipeline).
 *
 * Owns the headline overall-progress state for a run: normalizes raw event
 * phases into telemetry phases, maps them onto the legacy phase ramp, and
 * builds the PipelineProgressTelemetry attached to every emitted event.
 * Once a generation plan exists it is the authoritative source for the
 * headline % (fully unit-weighted); the phase ramp only covers analysis-only
 * runs and very early single-episode emits.
 *
 * Run-scoped inputs (start timestamp, current plan) are injected as lazy
 * reads so the tracker always sees the pipeline's live values; the
 * monotonic `lastOverallProgress` lives HERE and is reset per run via
 * `reset()`.
 */

import type { PipelineEvent, PipelineProgressTelemetry } from './events';
import { computeOverallProgress, type GenerationPlan } from './generationPlan';

export interface ProgressTelemetryDeps {
  /** Live read of the run's start timestamp (0 = not started). */
  pipelineStartedAtMs(): number;
  /** Live read of the current structure plan, if one exists. */
  generationPlan(): GenerationPlan | null;
}

export class ProgressTelemetryTracker {
  private lastOverallProgress = 0;

  constructor(private readonly deps: ProgressTelemetryDeps) {}

  /** Reset the monotonic progress floor at the start of a run. */
  reset(): void {
    this.lastOverallProgress = 0;
  }

  normalizeTelemetryPhase(phase?: string): string {
    if (!phase) return 'initialization';
    if (phase === 'multi_episode_init') return 'initialization';
    if (phase === 'episode_parallelism') return 'content';
    if (/^episode_\d+$/.test(phase)) return 'content';
    if (phase.startsWith('qa_ep_')) return 'qa';
    if (phase.startsWith('images_ep_')) return 'images';
    if (phase === 'image_manifest') return 'images';
    return phase;
  }

  getTelemetryPhaseBounds(phase: string): [number, number] {
    const bounds: Record<string, [number, number]> = {
      initialization: [0, 4],
      source_analysis: [4, 10],
      foundation: [10, 24],
      world: [10, 22],
      characters: [22, 34],
      npc_validation: [34, 38],
      architecture: [38, 48],
      branch_analysis: [48, 54],
      content: [54, 72],
      quick_validation: [72, 76],
      qa: [76, 82],
      master_images: [82, 88],
      images: [88, 93],
      encounter_images: [93, 95],
      video_generation: [95, 97],
      assembly: [97, 98],
      saving: [98, 99],
      audio_generation: [99, 100],
      complete: [100, 100],
    };
    return bounds[phase] || [this.lastOverallProgress, Math.min(100, this.lastOverallProgress + 1)];
  }

  buildProgressTelemetry(event: Omit<PipelineEvent, 'timestamp'>): PipelineProgressTelemetry | undefined {
    const phase = this.normalizeTelemetryPhase(event.phase);
    const [phaseStart, phaseEnd] = this.getTelemetryPhaseBounds(phase);
    const raw = event.data as any;
    const pipelineStartedAtMs = this.deps.pipelineStartedAtMs();
    const elapsedSeconds = pipelineStartedAtMs > 0
      ? Math.max(0, Math.round((Date.now() - pipelineStartedAtMs) / 1000))
      : undefined;

    let currentItem: number | undefined;
    let totalItems: number | undefined;
    let subphaseLabel: string | undefined;
    let phaseProgress: number | undefined;

    if (raw && typeof raw === 'object') {
      if (typeof raw.imageIndex === 'number' && typeof raw.totalImages === 'number' && raw.totalImages > 0) {
        currentItem = raw.imageIndex;
        totalItems = raw.totalImages;
        subphaseLabel = raw.sceneId ? `images:${raw.sceneId}` : 'images';
      } else if (typeof raw.currentItem === 'number' && typeof raw.totalItems === 'number' && raw.totalItems > 0) {
        currentItem = raw.currentItem;
        totalItems = raw.totalItems;
        subphaseLabel = typeof raw.subphaseLabel === 'string' ? raw.subphaseLabel : undefined;
      } else if (typeof raw.completed === 'number' && typeof raw.total === 'number' && raw.total > 0) {
        currentItem = raw.completed;
        totalItems = raw.total;
        subphaseLabel = typeof raw.subphaseLabel === 'string' ? raw.subphaseLabel : undefined;
      }
    }

    if (event.type === 'phase_start') {
      phaseProgress = 0;
    } else if (event.type === 'phase_complete') {
      phaseProgress = 100;
    } else if (currentItem !== undefined && totalItems !== undefined && totalItems > 0) {
      phaseProgress = Math.max(0, Math.min(100, Math.round((currentItem / totalItems) * 100)));
    }

    let overallProgress = this.lastOverallProgress;
    const generationPlan = this.deps.generationPlan();
    if (generationPlan) {
      // Fully unit-weighted: once a structure plan exists it is the authoritative
      // source for the headline %. The legacy phase ramp below is only used for
      // analysis-only runs (no plan) and very early single-episode emits.
      overallProgress = computeOverallProgress(generationPlan);
    } else if (phaseProgress !== undefined) {
      overallProgress = Math.round(phaseStart + ((phaseEnd - phaseStart) * (phaseProgress / 100)));
    } else if (event.type === 'phase_start') {
      overallProgress = phaseStart;
    } else if (event.type === 'phase_complete') {
      overallProgress = phaseEnd;
    } else {
      overallProgress = Math.max(overallProgress, phaseStart);
    }

    overallProgress = Math.max(this.lastOverallProgress, Math.min(100, overallProgress));
    this.lastOverallProgress = overallProgress;

    let etaSeconds: number | null | undefined = undefined;
    if (elapsedSeconds !== undefined && overallProgress > 1 && overallProgress < 100) {
      const rate = overallProgress / Math.max(1, elapsedSeconds);
      etaSeconds = rate > 0 ? Math.round((100 - overallProgress) / rate) : null;
    }

    return {
      overallProgress,
      phaseProgress,
      currentItem,
      totalItems,
      subphaseLabel,
      etaSeconds,
      elapsedSeconds,
    };
  }
}
