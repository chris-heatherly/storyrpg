import { sha256Hex } from '../utils/atomicIo';
import {
  PipelineMemory,
  slugifyMemoryKey,
  type PipelineMemoryOutcomeRecord,
} from './pipelineMemory';
import type {
  ArtifactPointer,
  PipelineArtifactEnvelope,
  PipelineArtifactProjection,
  PipelineMemoryArtifactKind,
  WritePipelineArtifactInput,
} from './artifactMemoryTypes';

const DEFAULT_SCHEMA_VERSION = 'storyrpg-artifact-memory-v1';

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  return Object.keys(input).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = sortValue(input[key]);
    return acc;
  }, {});
}

function compact(value: unknown, maxChars = 1200): string {
  const text = typeof value === 'string' ? value : stableStringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function inferProjection(kind: PipelineMemoryArtifactKind, payload: unknown): PipelineArtifactProjection {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const title = String(
    record.title ||
    record.sourceTitle ||
    record.episodeTitle ||
    record.sceneName ||
    record.id ||
    kind
  );
  const ids = new Set<string>();
  const keywords = new Set<string>([kind]);
  collectIds(payload, ids, keywords, 0);
  const metrics: Record<string, number | string | boolean> = {};
  if (Array.isArray(record.scenes)) metrics.sceneCount = record.scenes.length;
  if (Array.isArray(record.episodes)) metrics.episodeCount = record.episodes.length;
  if (Array.isArray(record.characters)) metrics.characterCount = record.characters.length;
  if (Array.isArray(record.choices)) metrics.choiceCount = record.choices.length;
  if (Array.isArray(record.blockingIssues)) metrics.blockingIssueCount = record.blockingIssues.length;
  if (Array.isArray(record.warnings)) metrics.warningCount = record.warnings.length;
  return {
    title,
    summary: compact({
      title,
      kind,
      synopsis: record.synopsis,
      summary: record.summary,
      metrics,
    }),
    keywords: Array.from(keywords).slice(0, 80),
    ids: Array.from(ids).slice(0, 120),
    warnings: [],
    metrics,
  };
}

function collectIds(value: unknown, ids: Set<string>, keywords: Set<string>, depth: number): void {
  if (depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) collectIds(item, ids, keywords, depth + 1);
    return;
  }
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 2 && value.length < 80) keywords.add(value);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'sceneId', 'beatId', 'episodeId', 'characterId', 'validator', 'artifactId']) {
    const candidate = record[key];
    if (typeof candidate === 'string') ids.add(candidate);
  }
  for (const key of ['title', 'name', 'sceneName', 'validator', 'lifecycle']) {
    const candidate = record[key];
    if (typeof candidate === 'string') keywords.add(candidate);
  }
  for (const key of ['scenes', 'episodes', 'characters', 'choices', 'encounters', 'blockingIssues', 'warnings']) {
    collectIds(record[key], ids, keywords, depth + 1);
  }
}

export interface ArtifactQueryFilter {
  artifactKind?: PipelineMemoryArtifactKind;
  artifactIds?: string[];
  storyId?: string;
  episodeNumber?: number;
  sceneId?: string;
  limit?: number;
}

export class ArtifactMemoryService {
  private readonly liveArtifacts = new Map<string, PipelineArtifactEnvelope>();

  constructor(private readonly memory: PipelineMemory) {}

  listLiveArtifacts(filter: ArtifactQueryFilter = {}): PipelineArtifactEnvelope[] {
    const matches = Array.from(this.liveArtifacts.values()).filter((envelope) => {
      if (filter.artifactKind && envelope.artifactKind !== filter.artifactKind) return false;
      if (filter.storyId && envelope.storyId !== filter.storyId) return false;
      if (filter.episodeNumber != null && envelope.episodeNumber !== filter.episodeNumber) return false;
      if (filter.sceneId && envelope.sceneId !== filter.sceneId) return false;
      if (filter.artifactIds?.length && !filter.artifactIds.includes(envelope.artifactId)) return false;
      return true;
    });
    return matches.slice(0, filter.limit || matches.length);
  }

  findByKind(
    kind: PipelineMemoryArtifactKind,
    filter: Pick<ArtifactQueryFilter, 'storyId' | 'episodeNumber' | 'sceneId' | 'limit'> = {},
  ): PipelineArtifactEnvelope[] {
    return this.listLiveArtifacts({ ...filter, artifactKind: kind });
  }

  buildEnvelope<T>(input: WritePipelineArtifactInput<T>): PipelineArtifactEnvelope<T> {
    const payloadText = stableStringify(input.payload);
    const contentHash = sha256Hex(payloadText);
    const artifactId = input.artifactId || [
      input.artifactKind,
      input.episodeNumber != null ? `ep-${input.episodeNumber}` : undefined,
      input.sceneId ? `scene-${slugifyMemoryKey(input.sceneId)}` : undefined,
      contentHash.slice(0, 12),
    ].filter(Boolean).join(':');
    const inferred = inferProjection(input.artifactKind, input.payload);
    const projection: PipelineArtifactProjection = {
      ...inferred,
      ...input.projection,
      keywords: Array.from(new Set([...(inferred.keywords || []), ...(input.projection?.keywords || [])])),
      ids: Array.from(new Set([...(inferred.ids || []), ...(input.projection?.ids || [])])),
      warnings: Array.from(new Set([...(inferred.warnings || []), ...(input.projection?.warnings || [])])),
      metrics: { ...inferred.metrics, ...(input.projection?.metrics || {}) },
    };
    return {
      artifactId,
      artifactKind: input.artifactKind,
      storyId: input.storyId,
      runId: input.runId || slugifyMemoryKey(input.storyId),
      episodeNumber: input.episodeNumber,
      sceneId: input.sceneId,
      characterIds: input.characterIds || [],
      sourceFingerprint: input.sourceFingerprint,
      version: 1,
      schemaVersion: input.schemaVersion || DEFAULT_SCHEMA_VERSION,
      contentHash,
      createdAt: new Date().toISOString(),
      lifecycle: input.lifecycle,
      payload: input.payload,
      projection,
      provenance: {
        lifecycle: input.lifecycle,
        agentRole: input.agentRole,
        validator: input.validator,
        adopted: true,
        diskPath: input.diskPath,
        supersedesArtifactId: input.supersedesArtifactId,
      },
    };
  }

  async writeArtifact<T>(input: WritePipelineArtifactInput<T>): Promise<PipelineArtifactEnvelope<T>> {
    const envelope = this.buildEnvelope(input);
    this.liveArtifacts.set(envelope.artifactId, envelope);
    await this.memory.writeArtifactSnapshot(this.toMemoryRecord(envelope));
    return envelope;
  }

  registerLiveArtifact<T>(envelope: PipelineArtifactEnvelope<T>): void {
    this.liveArtifacts.set(envelope.artifactId, envelope);
  }

  resolveLiveArtifact<T>(pointer: ArtifactPointer): PipelineArtifactEnvelope<T> | null {
    const envelope = this.liveArtifacts.get(pointer.artifactId);
    if (!envelope) return null;
    if (pointer.contentHash && pointer.contentHash !== envelope.contentHash) return null;
    return envelope as PipelineArtifactEnvelope<T>;
  }

  pointerFor(envelope: PipelineArtifactEnvelope): ArtifactPointer {
    return {
      artifactId: envelope.artifactId,
      artifactKind: envelope.artifactKind,
      storyId: envelope.storyId,
      runId: envelope.runId,
      episodeNumber: envelope.episodeNumber,
      sceneId: envelope.sceneId,
      contentHash: envelope.contentHash,
      diskPath: envelope.provenance.diskPath,
    };
  }

  private toMemoryRecord(envelope: PipelineArtifactEnvelope): PipelineMemoryOutcomeRecord {
    const artifactNodes = [
      `artifact:${envelope.artifactKind}`,
      `artifact-kind:${envelope.artifactKind}`,
      `artifact:${slugifyMemoryKey(envelope.artifactId)}`,
      `artifact-id:${slugifyMemoryKey(envelope.artifactId)}`,
      envelope.episodeNumber != null ? `episode:${envelope.episodeNumber}` : undefined,
      envelope.sceneId ? `scene:${envelope.sceneId}` : undefined,
      envelope.provenance.agentRole ? `agent:${envelope.provenance.agentRole}` : undefined,
      envelope.provenance.validator ? `validator:${envelope.provenance.validator}` : undefined,
      ...envelope.characterIds.map((id) => `character:${slugifyMemoryKey(id)}`),
    ].filter((node): node is string => Boolean(node));
    return {
      storyId: envelope.storyId,
      episodeNumber: envelope.episodeNumber,
      sceneId: envelope.sceneId,
      lifecycle: envelope.lifecycle,
      artifactIds: [envelope.artifactId, envelope.artifactKind],
      title: `${envelope.artifactKind}: ${envelope.projection.title}`,
      summary: [
        `Artifact: ${envelope.artifactKind}`,
        `Artifact ID: ${envelope.artifactId}`,
        `Content hash: ${envelope.contentHash}`,
        envelope.projection.summary,
        envelope.projection.ids.length ? `IDs: ${envelope.projection.ids.slice(0, 40).join(', ')}` : null,
        envelope.projection.keywords.length ? `Keywords: ${envelope.projection.keywords.slice(0, 40).join(', ')}` : null,
      ].filter(Boolean).join('\n'),
      payload: {
        envelope: {
          ...envelope,
          payload: undefined,
        },
        projection: envelope.projection,
        payload: envelope.payload,
      },
      nodeSet: artifactNodes,
    };
  }
}
