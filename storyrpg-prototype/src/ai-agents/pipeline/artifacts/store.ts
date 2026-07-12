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
import { migrateArtifactEnvelope, migrateCurrentIndex } from './migrations';

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

function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface MutableArtifactSession<T> {
  readonly source: ArtifactRef;
  readonly sourceHash: string;
  readonly value: T;
  commit(input: Omit<SaveArtifactInput<T>, 'payload'>): Promise<PipelineArtifact<T>>;
}

function emptyCurrentIndex(): ArtifactCurrentIndex {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    artifacts: {},
    supersededArtifactIds: [],
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

export class ArtifactRevisionStore {
  constructor(private readonly io: ArtifactStoreIO) {}

  loadCurrentIndex(episodeNumber?: number): ArtifactCurrentIndex {
    const current = this.io.load<unknown>(currentIndexPath(episodeNumber));
    return migrateCurrentIndex(current) ?? emptyCurrentIndex();
  }

  loadCurrentRef(kind: ArtifactKind, episodeNumber?: number): ArtifactRef | null {
    return this.loadCurrentIndex(episodeNumber).artifacts[kind] ?? null;
  }

  loadCurrent<T>(kind: ArtifactKind, episodeNumber?: number): PipelineArtifact<T> | null {
    const ref = this.loadCurrentRef(kind, episodeNumber);
    return ref ? this.loadRef<T>(ref) : null;
  }

  loadRef<T>(ref: ArtifactRef): PipelineArtifact<T> | null {
    const artifact = migrateArtifactEnvelope<T>(this.io.load<unknown>(ref.path), ref);
    return artifact ? deepFreeze(artifact) : null;
  }

  loadMutable<T>(ref: ArtifactRef): PipelineArtifact<T> | null {
    const artifact = this.loadRef<T>(ref);
    if (!artifact) return null;
    const mutable = clonePayload(artifact);
    mutable.payload = clonePayload(artifact.payload);
    return mutable;
  }

  loadCurrentMutable<T>(kind: ArtifactKind, episodeNumber?: number): PipelineArtifact<T> | null {
    const ref = this.loadCurrentRef(kind, episodeNumber);
    return ref ? this.loadMutable<T>(ref) : null;
  }

  openMutableSession<T>(ref: ArtifactRef): MutableArtifactSession<T> | null {
    const artifact = this.loadMutable<T>(ref);
    if (!artifact) return null;
    const sourceHash = artifact.payloadHash;
    return {
      source: ref,
      sourceHash,
      value: artifact.payload,
      commit: (input) => {
        if (input.kind !== artifact.kind || input.episodeNumber !== artifact.episodeNumber) {
          throw new Error('Mutable artifact sessions must commit the same kind and episode scope as their source.');
        }
        return this.saveRevision({
          ...input,
          payload: artifact.payload,
          upstream: [...(input.upstream ?? []), ref],
        });
      },
    };
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
      // Do not retain the caller's mutable array. The committed artifact is
      // recursively frozen below, and freezing an aliased input array would
      // make the producer fail when it appends the next upstream revision.
      upstream: [...(input.upstream ?? [])],
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

    return deepFreeze(artifact);
  }

  async setCurrent(ref: ArtifactRef): Promise<ArtifactCurrentIndex> {
    return this.commitCurrentSet([ref]);
  }

  /** Atomically advances all refs sharing an index after validating every payload. */
  async commitCurrentSet(refs: ArtifactRef[]): Promise<ArtifactCurrentIndex> {
    if (refs.length === 0) return emptyCurrentIndex();
    const scope = refs[0].episodeNumber;
    if (refs.some((ref) => ref.episodeNumber !== scope)) {
      throw new Error('Atomic artifact commit cannot span global and episode current indexes.');
    }
    for (const ref of refs) {
      const artifact = this.loadRef(ref);
      if (!artifact) throw new Error(`Cannot commit missing or hash-mismatched artifact ${ref.artifactId}.`);
      if (artifact.status !== 'valid' || artifact.validation.passed === false) {
        throw new Error(`Cannot commit non-valid artifact ${ref.artifactId}.`);
      }
    }
    const current = this.loadCurrentIndex(scope);
    current.updatedAt = new Date().toISOString();
    for (const ref of refs) current.artifacts[ref.kind] = ref;
    await this.io.save(currentIndexPath(scope), current);
    return current;
  }

  /**
   * Materialize schema-v1 current artifacts as new immutable v2 revisions and
   * advance their current pointers in one commit. A failed migration leaves
   * every legacy pointer untouched; callers can surface the thrown diagnostic
   * as `migration_blocked` without silently regenerating upstream work.
   */
  async migrateCurrentRevisionSet(episodeNumber?: number): Promise<ArtifactCurrentIndex> {
    const current = this.loadCurrentIndex(episodeNumber);
    const refs: ArtifactRef[] = [];
    for (const ref of Object.values(current.artifacts)) {
      if (!ref) continue;
      const raw = this.io.load<unknown>(ref.path);
      const schemaVersion = raw && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
      if (schemaVersion !== 1) {
        refs.push(ref);
        continue;
      }
      const artifact = this.loadRef(ref);
      if (!artifact) throw new Error(`migration_blocked: legacy artifact ${ref.artifactId} is missing or hash-mismatched.`);
      const migrated = await this.saveRevision({
        kind: artifact.kind,
        storyId: artifact.storyId,
        runId: artifact.runId,
        episodeNumber: artifact.episodeNumber,
        payload: artifact.payload,
        status: artifact.status,
        upstream: artifact.upstream,
        provenance: { ...artifact.provenance, phase: artifact.provenance.phase || 'legacy_migration' },
        validation: artifact.validation,
        makeCurrent: false,
      });
      if (migrated.status !== 'valid' || !migrated.validation.passed) {
        throw new Error(`migration_blocked: migrated artifact ${artifact.artifactId} did not pass validation.`);
      }
      refs.push(this.refFor(migrated));
    }
    return this.commitCurrentSet(refs);
  }

  async markSuperseded(ref: ArtifactRef): Promise<PipelineArtifact<unknown> | null> {
    const artifact = this.loadRef(ref);
    if (!artifact) return null;
    const current = this.loadCurrentIndex(ref.episodeNumber);
    current.updatedAt = new Date().toISOString();
    current.supersededArtifactIds = Array.from(new Set([...(current.supersededArtifactIds ?? []), ref.artifactId]));
    await this.io.save(currentIndexPath(ref.episodeNumber), current);
    return artifact;
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
