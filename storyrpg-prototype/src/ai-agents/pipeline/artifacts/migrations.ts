import type { ArtifactCurrentIndex, ArtifactRef, PipelineArtifact } from './types';
import { ARTIFACT_SCHEMA_VERSION, defaultValidationSummary } from './types';

interface LegacyArtifactCurrentIndex {
  version: 1;
  updatedAt: string;
  artifacts: ArtifactCurrentIndex['artifacts'];
}

export function migrateCurrentIndex(raw: unknown): ArtifactCurrentIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ArtifactCurrentIndex> | Partial<LegacyArtifactCurrentIndex>;
  if (!candidate.artifacts) return null;
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  return {
    version: 2,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
    artifacts: candidate.artifacts,
    supersededArtifactIds: candidate.version === 2
      ? (candidate as Partial<ArtifactCurrentIndex>).supersededArtifactIds ?? []
      : [],
  };
}

export function migrateArtifactEnvelope<T>(raw: unknown, expectedRef?: ArtifactRef): PipelineArtifact<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const artifact = raw as PipelineArtifact<T>;
  if (!artifact.kind || !artifact.artifactId || !artifact.payloadHash || artifact.payload === undefined) return null;
  if (artifact.schemaVersion !== 1 && artifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION) return null;
  if (expectedRef && (artifact.artifactId !== expectedRef.artifactId || artifact.payloadHash !== expectedRef.payloadHash)) return null;
  if (artifact.schemaVersion === ARTIFACT_SCHEMA_VERSION) return artifact;
  return {
    ...artifact,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    status: artifact.status ?? 'valid',
    upstream: artifact.upstream ?? [],
    provenance: {
      ...artifact.provenance,
      phase: artifact.provenance?.phase || 'legacy_migration',
    },
    validation: artifact.validation ?? defaultValidationSummary(artifact.kind),
  };
}
