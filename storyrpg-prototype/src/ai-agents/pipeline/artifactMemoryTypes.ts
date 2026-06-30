import type { AgentMemoryRole, ValidatorEvidenceMode } from './pipelineMemory';

export type PipelineMemoryFactKind =
  | 'source-obligation'
  | 'source-quote'
  | 'story-anchor'
  | 'story-circle-role'
  | 'world-rule'
  | 'location-fact'
  | 'character-fact'
  | 'relationship-fact'
  | 'appearance-fact'
  | 'voice-fact'
  | 'episode-canon'
  | 'scene-canon'
  | 'callback-obligation'
  | 'residue-obligation'
  | 'choice-consequence'
  | 'branch-topology'
  | 'encounter-anchor'
  | 'validator-failure'
  | 'repair-learning'
  | 'media-style-fact'
  | 'provider-failure';

export type PipelineMemoryArtifactKind =
  | 'source-analysis'
  | 'season-plan'
  | 'world-bible'
  | 'character-bible'
  | 'episode-blueprint'
  | 'branch-analysis'
  | 'thread-ledger'
  | 'twist-plan'
  | 'arc-targets'
  | 'character-arc-targets'
  | 'scene-content'
  | 'choice-set'
  | 'encounter-structure'
  | 'style-bible'
  | 'quick-validation-report'
  | 'qa-report'
  | 'validator-report'
  | 'final-contract'
  | 'story-json'
  | 'image-results'
  | 'image-diagnostics'
  | 'audio-diagnostics'
  | 'video-diagnostics';

export interface PipelineArtifactProjection {
  title: string;
  summary: string;
  keywords: string[];
  ids: string[];
  warnings: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface PipelineArtifactProvenance {
  lifecycle: string;
  agentRole?: AgentMemoryRole;
  validator?: string;
  adopted: boolean;
  diskPath?: string;
  supersedesArtifactId?: string;
}

export interface PipelineArtifactEnvelope<T = unknown> {
  artifactId: string;
  artifactKind: PipelineMemoryArtifactKind;
  storyId: string;
  runId: string;
  episodeNumber?: number;
  sceneId?: string;
  characterIds: string[];
  sourceFingerprint?: string;
  version: 1;
  schemaVersion: string;
  contentHash: string;
  createdAt: string;
  lifecycle: string;
  payload: T;
  projection: PipelineArtifactProjection;
  provenance: PipelineArtifactProvenance;
}

export interface ArtifactPointer {
  artifactId: string;
  artifactKind: PipelineMemoryArtifactKind;
  storyId?: string;
  runId?: string;
  episodeNumber?: number;
  sceneId?: string;
  contentHash?: string;
  diskPath?: string;
}

export interface PipelineFactArtifactRef {
  artifactKind: PipelineMemoryArtifactKind;
  artifactId: string;
  contentHash: string;
}

export interface PipelineFactValidatorRef {
  validator: string;
  lifecycle: string;
  outcome: 'passed' | 'warning' | 'failed' | 'repaired';
}

export interface PipelineFactRecord {
  factId: string;
  factKind: PipelineMemoryFactKind;
  statement: string;
  subjectId?: string;
  predicate?: string;
  value?: string | number | boolean | string[];
  storyId: string;
  runId: string;
  episodeNumber?: number;
  sceneId?: string;
  characterIds?: string[];
  locationIds?: string[];
  sourceFingerprint?: string;
  status: 'adopted' | 'validated' | 'superseded' | 'rejected';
  confidence: number;
  artifactRefs: PipelineFactArtifactRef[];
  validatorRefs?: PipelineFactValidatorRef[];
  createdAt: string;
  supersedesFactId?: string;
}

export interface AgentRetrievalPack {
  role: AgentMemoryRole;
  lifecycle: string;
  canonicalArtifacts: ArtifactPointer[];
  renderedPromptBlock: string | null;
  retrievedContext: string[];
  warnings: string[];
  provenance: Array<{
    query: string;
    datasets: string[];
    nodeNames: string[];
    resultCount: number;
  }>;
  tokenEstimate: number;
}

export interface AgentArtifactContextRequest {
  agentRole: AgentMemoryRole;
  lifecycle: string;
  storyId?: string;
  runId?: string;
  episodeNumber?: number;
  sceneId?: string;
  characterIds?: string[];
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  factKinds?: PipelineMemoryFactKind[];
  factIds?: string[];
  sourceFingerprint?: string;
  recallMode?: 'facts-first' | 'artifact-projection' | 'validator-history' | 'exact-artifact-pointer';
  topK?: number;
  maxPromptChars?: number;
}

export interface ValidatorArtifactEvidenceRequest {
  validator: string;
  lifecycle: string;
  evidenceMode: ValidatorEvidenceMode;
  storyId?: string;
  runId?: string;
  episodeNumber?: number;
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  factKinds?: PipelineMemoryFactKind[];
  factIds?: string[];
  sourceFingerprint?: string;
  recallMode?: 'facts-first' | 'artifact-projection' | 'validator-history' | 'exact-artifact-pointer';
  topK?: number;
  maxPromptChars?: number;
}

export interface WritePipelineArtifactInput<T = unknown> {
  artifactKind: PipelineMemoryArtifactKind;
  storyId: string;
  runId?: string;
  episodeNumber?: number;
  sceneId?: string;
  characterIds?: string[];
  sourceFingerprint?: string;
  lifecycle: string;
  agentRole?: AgentMemoryRole;
  validator?: string;
  diskPath?: string;
  supersedesArtifactId?: string;
  artifactId?: string;
  schemaVersion?: string;
  payload: T;
  projection?: Partial<PipelineArtifactProjection>;
}
