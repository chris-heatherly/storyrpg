import type {
  ValidationOwnerStage,
  ValidationRetryClass,
} from '../../types/validationOwnership';

/**
 * Pipeline error types.
 *
 * Extracted from FullStoryPipeline.ts (pure move) so pipeline/phases/* can
 * throw PipelineError without importing the monolith (which imports the
 * phases — a cycle). FullStoryPipeline re-exports it for existing consumers.
 */

export type PipelineFailureCode =
  | 'provider_transient'
  | 'provider_configuration_invalid'
  | 'provider_model_unavailable'
  | 'job_config_mismatch'
  | 'structured_output_invalid'
  | 'scene_construction_conflict'
  | 'episode_plan_invalid'
  | 'season_graph_invalid'
  | 'treatment_binding_conflict'
  | 'treatment_density_conflict'
  | 'branch_structure_invalid'
  | 'scene_cap_exceeded'
  | 'prose_realization_failed'
  | 'owner_realization_failed'
  | 'validator_snapshot_mismatch'
  | 'character_presence_contract_failed'
  | 'output_boundary_invalid'
  | 'final_contract_drift'
  | 'unknown';

export type PipelineFailureOwnerStage = ValidationOwnerStage;

export type PipelineRetryClass = ValidationRetryClass;

export interface PipelineFailureMetadata {
  code: PipelineFailureCode;
  ownerStage: PipelineFailureOwnerStage;
  retryClass: PipelineRetryClass;
  issueCodes?: string[];
  artifactRefs?: string[];
  repairTarget?: string;
}

/** Custom error class for pipeline errors with typed repair ownership. */
export class PipelineError extends Error {
  public readonly phase: string;
  public readonly agent?: string;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error;
  public readonly code: PipelineFailureCode;
  public readonly ownerStage: PipelineFailureOwnerStage;
  public readonly retryClass: PipelineRetryClass;
  public readonly issueCodes: string[];
  public readonly artifactRefs: string[];
  public readonly repairTarget?: string;

  constructor(
    message: string,
    phase: string,
    options?: {
      agent?: string;
      context?: Record<string, unknown>;
      originalError?: Error;
      failure?: Partial<PipelineFailureMetadata>;
    }
  ) {
    super(message);
    this.name = 'PipelineError';
    this.phase = phase;
    this.agent = options?.agent;
    this.context = options?.context;
    this.originalError = options?.originalError;
    this.code = options?.failure?.code ?? 'unknown';
    this.ownerStage = options?.failure?.ownerStage ?? 'episode_plan';
    this.retryClass = options?.failure?.retryClass ?? 'none';
    this.issueCodes = options?.failure?.issueCodes ?? [];
    this.artifactRefs = options?.failure?.artifactRefs ?? [];
    this.repairTarget = options?.failure?.repairTarget;

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
      code: this.code,
      ownerStage: this.ownerStage,
      retryClass: this.retryClass,
      issueCodes: this.issueCodes,
      artifactRefs: this.artifactRefs,
      repairTarget: this.repairTarget,
      stack: this.stack,
    };
  }
}
