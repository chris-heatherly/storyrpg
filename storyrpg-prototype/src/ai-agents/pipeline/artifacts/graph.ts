import type { ArtifactKind, ArtifactRef, ArtifactStoreIO, PipelineArtifact } from './types';
import { ArtifactRevisionStore } from './store';

export type ArtifactGraphStatus =
  | 'clean'
  | 'stale'
  | 'invalid'
  | 'blocked'
  | 'repairable'
  | 'requires-forward-revalidation';

export interface ArtifactStatusReport {
  ref: ArtifactRef;
  status: ArtifactGraphStatus;
  reasons: string[];
}

export function evaluateArtifactStatus(
  ref: ArtifactRef,
  store: ArtifactRevisionStore,
): ArtifactStatusReport {
  const artifact = store.loadRef(ref);
  if (!artifact) {
    return { ref, status: 'blocked', reasons: ['artifact payload is missing or does not match its current pointer'] };
  }
  if (artifact.status === 'invalid' || artifact.validation.passed === false) {
    return { ref, status: 'invalid', reasons: ['artifact validation failed'] };
  }
  if (artifact.status === 'migration_blocked') {
    return { ref, status: 'blocked', reasons: ['legacy artifact migration requires explicit repair'] };
  }
  if (artifact.status === 'stale') {
    return { ref, status: 'stale', reasons: ['artifact was explicitly marked stale'] };
  }

  const missing: string[] = [];
  const changed: string[] = [];
  for (const upstream of artifact.upstream) {
    const loaded = store.loadRef(upstream);
    if (!loaded) {
      missing.push(`${upstream.kind}:${upstream.revision}`);
      continue;
    }
    const current = store.loadCurrentRef(upstream.kind, upstream.episodeNumber);
    if (
      loaded.payloadHash !== upstream.payloadHash
      || (upstream.dependencyMode !== 'exact' && current && current.artifactId !== upstream.artifactId)
    ) {
      changed.push(`${upstream.kind}:${upstream.revision}`);
    }
  }
  if (missing.length > 0) {
    return { ref, status: 'blocked', reasons: [`missing upstream artifact(s): ${missing.join(', ')}`] };
  }
  if (changed.length > 0) {
    return { ref, status: 'stale', reasons: [`changed upstream artifact(s): ${changed.join(', ')}`] };
  }
  return { ref, status: 'clean', reasons: [] };
}

export function evaluateCurrentArtifact(
  io: ArtifactStoreIO,
  kind: ArtifactKind,
  episodeNumber?: number,
): ArtifactStatusReport | null {
  const store = new ArtifactRevisionStore(io);
  const ref = store.loadCurrentRef(kind, episodeNumber);
  return ref ? evaluateArtifactStatus(ref, store) : null;
}

export function forwardRevalidationEpisodes(changedEpisode: number, totalEpisodes: number): number[] {
  const episodes: number[] = [];
  for (let n = changedEpisode + 1; n <= totalEpisodes; n += 1) {
    episodes.push(n);
  }
  return episodes;
}

export function refsFromArtifacts(artifacts: Array<PipelineArtifact<unknown>>, store: ArtifactRevisionStore): ArtifactRef[] {
  return artifacts.map((artifact) => store.refFor(artifact));
}
