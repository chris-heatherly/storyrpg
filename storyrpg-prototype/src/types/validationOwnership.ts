/**
 * Shared, generator-safe ownership metadata for validation findings and pipeline
 * failures. This is deliberately data-only: validators, orchestration, repair
 * routers, and persisted reports may all depend on it without importing one
 * another's runtime modules.
 */

export type ValidationOwnerStage =
  | 'provider'
  | 'source_analysis'
  | 'season_plan'
  | 'episode_plan'
  | 'scene_writer'
  | 'choice_author'
  | 'encounter_architect'
  | 'scene_content'
  | 'episode_contract'
  | 'final_contract'
  | 'packaging';

export type ValidationRetryClass =
  | 'retry_provider'
  | 'retry_structured_output'
  | 'recompile_episode_plan'
  | 'repair_scene_prose'
  | 'repair_choice'
  | 'repair_encounter_route'
  | 'repair_final_contract'
  | 'none';

export type ValidationExecutionMode = 'enforce' | 'audit' | 'shadow';

export interface ValidationOwnershipMetadata {
  /** Stable machine-readable defect identity; never derive repair policy from the message. */
  issueCode?: string;
  taskId?: string;
  contractId?: string;
  eventId?: string;
  dependencyId?: string;
  ownerStage?: ValidationOwnerStage;
  retryClass?: ValidationRetryClass;
  repairHandler?: string;
  /** String/address form used in persisted ownership records. */
  repairTargetId?: string;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  outcomeTier?: string;
  artifactPath?: string;
  artifactRefs?: string[];
  missingEvidenceAtoms?: string[];
  requiredEvidenceAtoms?: string[];
  matchedForbiddenAtoms?: string[];
  findingFingerprint?: string;
}
