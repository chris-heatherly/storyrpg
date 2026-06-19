import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactCurrentIndex,
  ArtifactKind,
  ArtifactRef,
  ArtifactStoreIO,
  PipelineArtifact,
  SaveArtifactInput,
  defaultValidationSummary,
} from './types';

export function episodeArtifactDir(episodeNumber: number): string {
  return `artifacts/episodes/${String(episodeNumber).padStart(3, '0')}`;
}

export function artifactFileStem(kind: ArtifactKind): string {
  return kind;
}

export function artifactPath(kind: ArtifactKind, revision: number, episodeNumber?: number): string {
  const file = `${artifactFileStem(kind)}.rev${revision}.json`;
  return typeof episodeNumber === 'number'
    ? `${episodeArtifactDir(episodeNumber)}/${file}`
    : `artifacts/${file}`;
}

export function currentIndexPath(episodeNumber?: number): string {
  return typeof episodeNumber === 'number'
    ? `${episodeArtifactDir(episodeNumber)}/current.json`
    : 'artifacts/current.json';
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      out[key] = normalize((input as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(value));
}

export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function emptyCurrentIndex(): ArtifactCurrentIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    artifacts: {},
  };
}

export class ArtifactRevisionStore {
  constructor(private readonly io: ArtifactStoreIO) {}

  loadCurrentIndex(episodeNumber?: number): ArtifactCurrentIndex {
    const current = this.io.load<ArtifactCurrentIndex>(currentIndexPath(episodeNumber));
    if (!current || current.version !== 1 || !current.artifacts) return emptyCurrentIndex();
    return current;
  }

  loadCurrentRef(kind: ArtifactKind, episodeNumber?: number): ArtifactRef | null {
    return this.loadCurrentIndex(episodeNumber).artifacts[kind] ?? null;
  }

  loadCurrent<T>(kind: ArtifactKind, episodeNumber?: number): PipelineArtifact<T> | null {
    const ref = this.loadCurrentRef(kind, episodeNumber);
    return ref ? this.loadRef<T>(ref) : null;
  }

  loadRef<T>(ref: ArtifactRef): PipelineArtifact<T> | null {
    const artifact = this.io.load<PipelineArtifact<T>>(ref.path);
    if (!artifact || artifact.artifactId !== ref.artifactId || artifact.payloadHash !== ref.payloadHash) return null;
    return artifact;
  }

  async saveRevision<T>(input: SaveArtifactInput<T>): Promise<PipelineArtifact<T>> {
    const status = input.status ?? 'draft';
    const current = this.loadCurrentIndex(input.episodeNumber);
    const previous = current.artifacts[input.kind];
    let revision = previous ? previous.revision + 1 : 1;
    while (this.io.load<unknown>(artifactPath(input.kind, revision, input.episodeNumber))) {
      revision += 1;
    }

    const payloadHash = stableHash(input.payload);
    const artifactId = [
      input.storyId,
      input.runId,
      input.episodeNumber ? `episode-${String(input.episodeNumber).padStart(3, '0')}` : 'global',
      input.kind,
      `rev-${revision}`,
    ].join(':');
    const path = artifactPath(input.kind, revision, input.episodeNumber);
    const artifact: PipelineArtifact<T> = {
      kind: input.kind,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId,
      storyId: input.storyId,
      runId: input.runId,
      episodeNumber: input.episodeNumber,
      revision,
      status,
      upstream: input.upstream ?? [],
      provenance: input.provenance,
      validation: input.validation ?? defaultValidationSummary(input.kind),
      payloadHash,
      createdAt: new Date().toISOString(),
      payload: input.payload,
    };

    await this.io.save(path, artifact);

    if (input.makeCurrent ?? status === 'valid') {
      await this.setCurrent(this.refFor(artifact));
    }

    return artifact;
  }

  async setCurrent(ref: ArtifactRef): Promise<ArtifactCurrentIndex> {
    const current = this.loadCurrentIndex(ref.episodeNumber);
    current.updatedAt = new Date().toISOString();
    current.artifacts[ref.kind] = ref;
    await this.io.save(currentIndexPath(ref.episodeNumber), current);
    return current;
  }

  async markSuperseded(ref: ArtifactRef): Promise<PipelineArtifact<unknown> | null> {
    const artifact = this.loadRef(ref);
    if (!artifact) return null;
    const next = { ...artifact, status: 'superseded' as const };
    await this.io.save(ref.path, next);
    return next;
  }

  refFor<T>(artifact: PipelineArtifact<T>): ArtifactRef {
    return {
      kind: artifact.kind,
      artifactId: artifact.artifactId,
      payloadHash: artifact.payloadHash,
      revision: artifact.revision,
      path: artifactPath(artifact.kind, artifact.revision, artifact.episodeNumber),
      episodeNumber: artifact.episodeNumber,
    };
  }
}
