export type ArtifactStatus = 'draft' | 'valid' | 'invalid' | 'stale' | 'superseded' | 'migration_blocked';

export type ArtifactKind =
  | 'source-analysis'
  | 'source-canon'
  | 'season-plan'
  | 'season-canon'
  | 'world-bible'
  | 'character-bible'
  | 'style-bible'
  | 'character-arc-plan'
  | 'npc-payoff-ledger'
  | 'thread-ledger'
  | 'callback-ledger'
  | 'information-ledger'
  | 'narrative-contract-graph'
  | 'narrative-realization-ledger'
  | 'context-in'
  | 'episode-blueprint'
  | 'scene-plan'
  | 'branch-plan'
  | 'choice-consequence-plan'
  | 'encounter-plan'
  | 'runtime-episode'
  | 'validation-report'
  | 'context-out'
  | 'story-package';

export interface ArtifactRef {
  kind: ArtifactKind;
  artifactId: string;
  payloadHash: string;
  revision: number;
  path: string;
  episodeNumber?: number;
  /** `exact` pins an immutable historical snapshot even when a newer current revision exists. */
  dependencyMode?: 'current' | 'exact';
}

export interface ArtifactValidationIssue {
  validator: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  path?: string;
}

export interface ArtifactValidationSummary {
  passed: boolean;
  gate: string;
  issues: ArtifactValidationIssue[];
  reportRefs?: ArtifactRef[];
}

export interface ArtifactProvenance {
  phase: string;
  agent?: string;
  model?: string;
  configHash?: string;
  promptHash?: string;
}

export interface PipelineArtifact<T> {
  kind: ArtifactKind;
  schemaVersion: number;
  artifactId: string;
  storyId: string;
  runId: string;
  episodeNumber?: number;
  revision: number;
  status: ArtifactStatus;
  upstream: ArtifactRef[];
  provenance: ArtifactProvenance;
  validation: ArtifactValidationSummary;
  payloadHash: string;
  createdAt: string;
  payload: T;
}

export interface ArtifactCurrentIndex {
  version: 2;
  updatedAt: string;
  artifacts: Partial<Record<ArtifactKind, ArtifactRef>>;
  supersededArtifactIds?: string[];
}

export interface ArtifactStoreIO {
  save: (name: string, data: unknown) => Promise<void>;
  load: <T>(name: string) => T | null;
}

export interface SaveArtifactInput<T> {
  kind: ArtifactKind;
  storyId: string;
  runId: string;
  payload: T;
  episodeNumber?: number;
  status?: ArtifactStatus;
  upstream?: ArtifactRef[];
  provenance: ArtifactProvenance;
  validation?: ArtifactValidationSummary;
  makeCurrent?: boolean;
}

export const ARTIFACT_SCHEMA_VERSION = 2;

export const defaultValidationSummary = (gate: string): ArtifactValidationSummary => ({
  passed: true,
  gate,
  issues: [],
});
