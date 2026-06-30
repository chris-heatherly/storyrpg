/**
 * Pipeline error types.
 *
 * Extracted from FullStoryPipeline.ts (pure move) so pipeline/phases/* can
 * throw PipelineError without importing the monolith (which imports the
 * phases — a cycle). FullStoryPipeline re-exports it for existing consumers.
 */

/**
 * Custom error class for pipeline errors with enhanced context
 */
export class PipelineError extends Error {
  public readonly phase: string;
  public readonly agent?: string;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error;

  constructor(
    message: string,
    phase: string,
    options?: {
      agent?: string;
      context?: Record<string, unknown>;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = 'PipelineError';
    this.phase = phase;
    this.agent = options?.agent;
    this.context = options?.context;
    this.originalError = options?.originalError;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PipelineError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      phase: this.phase,
      agent: this.agent,
      context: this.context,
      stack: this.stack,
    };
  }
}
