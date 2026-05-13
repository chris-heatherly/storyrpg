/**
 * Pipeline Events
 *
 * Shared event/telemetry types plus a tiny event-bus used by the story
 * generation pipelines (EpisodePipeline / FullStoryPipeline).
 *
 * These types were historically duplicated / re-exported between
 * FullStoryPipeline.ts (~13k lines) and EpisodePipeline.ts (~950 lines).
 * Phase 3 of the tech-debt plan pulls them into a standalone module so we
 * can grow an orchestrator-level test harness and swap out transports
 * (SSE vs in-process) without touching the monoliths.
 */

export interface PipelineProgressTelemetry {
  overallProgress?: number;
  phaseProgress?: number;
  currentItem?: number;
  totalItems?: number;
  subphaseLabel?: string;
  /**
   * Estimated seconds remaining. `null` is intentionally allowed so
   * callers can distinguish "unknown" from "not reported".
   */
  etaSeconds?: number | null;
  elapsedSeconds?: number;
}

export type PipelineEventType =
  | 'phase_start'
  | 'phase_complete'
  | 'agent_start'
  | 'agent_complete'
  | 'error'
  | 'checkpoint'
  | 'debug'
  | 'warning'
  | 'incremental_validation'
  | 'regeneration_triggered'
  | 'validation_aggregated';

export interface PipelineEvent {
  type: PipelineEventType;
  phase?: string;
  agent?: string;
  message: string;
  data?: unknown;
  telemetry?: PipelineProgressTelemetry;
  timestamp: Date;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

/**
 * Minimal event bus. Split out of the monoliths so the pipeline's
 * observer plumbing can be tested in isolation (see Phase 3 TODOs).
 *
 * Semantics:
 *   - Handlers are invoked synchronously in subscription order.
 *   - Handler errors are swallowed so one buggy subscriber can't take
 *     down the pipeline mid-generation. We surface them via console.error
 *     so they remain visible in logs.
 *   - `emit()` stamps `timestamp` if the caller didn't provide one.
 */
export class PipelineEventBus {
  private handlers: PipelineEventHandler[] = [];

  subscribe(handler: PipelineEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  unsubscribeAll(): void {
    this.handlers = [];
  }

  get size(): number {
    return this.handlers.length;
  }

  emit(event: Omit<PipelineEvent, 'timestamp'> & { timestamp?: Date }): void {
    const stamped: PipelineEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date(),
    };
    for (const handler of this.handlers) {
      try {
        handler(stamped);
      } catch (err) {
        console.error('[PipelineEventBus] handler threw', err);
      }
    }
  }
}
