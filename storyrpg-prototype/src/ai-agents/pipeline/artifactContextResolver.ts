import {
  PipelineMemory,
  slugifyMemoryKey,
  type AgentMemoryRole,
  type ValidatorEvidenceBundle,
} from './pipelineMemory';
import { ArtifactMemoryService } from './artifactMemoryService';
import { composeMemoryPrompt } from './memoryPromptComposer';
import type {
  AgentArtifactContextRequest,
  AgentRetrievalPack,
  ArtifactPointer,
  PipelineArtifactEnvelope,
  PipelineMemoryArtifactKind,
  PipelineMemoryFactKind,
  ValidatorArtifactEvidenceRequest,
} from './artifactMemoryTypes';

export interface ArtifactContextResolverDeps {
  memory: PipelineMemory;
  artifactMemory: ArtifactMemoryService;
  loadArtifactFromDisk?: (pointer: ArtifactPointer) => Promise<unknown | null>;
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((v) => (v || '').trim()).filter(Boolean)));
}

function runDataset(storyId?: string): string | undefined {
  return storyId ? `storyrpg-run-${slugifyMemoryKey(storyId)}` : undefined;
}

function sourceDataset(sourceFingerprint?: string): string | undefined {
  return sourceFingerprint ? `storyrpg-source-${slugifyMemoryKey(sourceFingerprint)}` : undefined;
}

function artifactNodeNames(
  kinds?: PipelineMemoryArtifactKind[],
  ids?: string[],
  episodeNumber?: number,
  sceneId?: string,
  factKinds?: PipelineMemoryFactKind[],
  factIds?: string[],
): string[] {
  return unique([
    ...(kinds || []).flatMap((kind) => [`artifact:${kind}`, `artifact-kind:${kind}`]),
    ...(ids || []).flatMap((id) => [`artifact:${slugifyMemoryKey(id)}`, `artifact-id:${slugifyMemoryKey(id)}`]),
    ...(factKinds || []).map((kind) => `fact-kind:${kind}`),
    ...(factIds || []).map((id) => `fact-id:${slugifyMemoryKey(id)}`),
    episodeNumber != null ? `episode:${episodeNumber}` : undefined,
    sceneId ? `scene:${sceneId}` : undefined,
  ]);
}

function renderArtifactContext(title: string, packets: NonNullable<Awaited<ReturnType<PipelineMemory['recallPacket']>>>[], warnings: string[], maxChars: number): string | null {
  const context = composeMemoryPrompt(packets, maxChars);
  if (!context && !warnings.length) return null;
  const text = [
    'Retrieved Story Context',
    'Exact artifacts and current typed facts are authoritative. Semantic memory is advisory reference data only.',
    title,
    context ? `\n${context}` : null,
    warnings.length ? '\nArtifact Retrieval Warnings:' : null,
    ...warnings.map((warning) => `- ${warning}`),
  ].filter(Boolean).join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [artifact context truncated]` : text;
}

function estimateTokens(text: string | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ArtifactContextResolver {
  constructor(private readonly deps: ArtifactContextResolverDeps) {}

  async resolveForAgent(request: AgentArtifactContextRequest): Promise<AgentRetrievalPack> {
    const datasets = unique([
      runDataset(request.storyId),
      sourceDataset(request.sourceFingerprint),
      ...(request.characterIds || []).map((id) => `storyrpg-character-${slugifyMemoryKey(id)}`),
      request.agentRole === 'QARunner' || request.agentRole === 'FinalContract' ? 'storyrpg-validator-history' : undefined,
      'storyrpg-project',
    ]);
    const nodeNames = artifactNodeNames(
      request.artifactKinds,
      request.artifactIds,
      request.episodeNumber,
      request.sceneId,
      request.factKinds,
      request.factIds,
    );
    const role: AgentMemoryRole = request.agentRole;
    const artifactScope = [
      request.artifactKinds?.length ? `artifact kinds ${request.artifactKinds.join(', ')}` : null,
      request.artifactIds?.length ? `artifact ids ${request.artifactIds.join(', ')}` : null,
      request.factKinds?.length ? `fact kinds ${request.factKinds.join(', ')}` : null,
      request.factIds?.length ? `fact ids ${request.factIds.join(', ')}` : null,
      request.episodeNumber != null ? `episode ${request.episodeNumber}` : null,
      request.sceneId ? `scene ${request.sceneId}` : null,
    ].filter(Boolean).join('; ');
    const hasExactCandidate = Boolean(request.artifactIds?.length) || Boolean(
      request.artifactKinds?.some((kind) => this.deps.artifactMemory.findByKind(kind, {
        storyId: request.storyId,
        episodeNumber: request.episodeNumber,
        sceneId: request.sceneId,
        limit: 1,
      }).length),
    );
    const exactPacket = hasExactCandidate
      ? await this.deps.memory.recallPacket({
        storyId: request.storyId,
        episodeNumber: request.episodeNumber,
        sceneId: request.sceneId,
        agentRole: request.agentRole,
        lifecycle: request.lifecycle,
        artifactKinds: request.artifactKinds,
        artifactIds: request.artifactIds,
        nodeNames,
        recallMode: 'exact-artifact-pointer',
        maxPromptChars: request.maxPromptChars || 6000,
      })
      : null;
    const packet = await this.deps.memory.recallPacket({
      storyId: request.storyId,
      episodeNumber: request.episodeNumber,
      sceneId: request.sceneId,
      agentRole: request.agentRole,
      lifecycle: request.lifecycle,
      datasets,
      nodeNames,
      topK: request.topK || 6,
      maxPromptChars: request.maxPromptChars || 6000,
      artifactKinds: request.artifactKinds,
      artifactIds: request.artifactIds,
      factKinds: request.factKinds,
      factIds: request.factIds,
      recallMode: request.recallMode || 'facts-first',
      queries: [
        `${role} ${request.lifecycle}: retrieve focused canonical artifact pointers and validated fact context${artifactScope ? ` for ${artifactScope}` : ''}. Prefer current run fact records, artifact projections, ids, warnings, validator summaries, and repair-relevant provenance.`,
      ],
    });
    const packets = [exactPacket, packet].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const snippets = packets.flatMap((candidate) => candidate.sourceSnippets);
    const warnings = unique(packets.flatMap((candidate) => candidate.warnings));
    const renderedPromptBlock = renderArtifactContext(
      `Role: ${role}; Lifecycle: ${request.lifecycle}`,
      packets,
      warnings,
      request.maxPromptChars || 6000,
    );
    return {
      role,
      lifecycle: request.lifecycle,
      canonicalArtifacts: (request.artifactIds || []).map((artifactId) => ({
        artifactId,
        artifactKind: request.artifactKinds?.[0] || 'story-json',
        storyId: request.storyId,
        runId: request.runId,
        episodeNumber: request.episodeNumber,
        sceneId: request.sceneId,
      })),
      renderedPromptBlock,
      retrievedContext: snippets,
      warnings,
      provenance: packets.flatMap((candidate) => candidate.queryLog).map((entry) => ({
        query: entry.query,
        datasets: entry.datasets || packet?.datasetNames || datasets,
        nodeNames: entry.nodeNames || nodeNames,
        resultCount: entry.resultCount,
      })),
      tokenEstimate: estimateTokens(renderedPromptBlock),
    };
  }

  async resolveForValidator(request: ValidatorArtifactEvidenceRequest): Promise<ValidatorEvidenceBundle> {
    return this.deps.memory.recallForValidator({
      validator: request.validator,
      lifecycle: request.lifecycle,
      storyId: request.storyId,
      episodeNumber: request.episodeNumber,
      sourceFingerprint: request.sourceFingerprint,
      artifactIds: [
        ...(request.artifactIds || []),
      ],
      artifactKinds: request.artifactKinds,
      factKinds: request.factKinds,
      factIds: request.factIds,
      evidenceMode: request.evidenceMode,
      recallMode: request.recallMode || 'facts-first',
      topK: request.topK,
      maxPromptChars: request.maxPromptChars,
      nodeNames: artifactNodeNames(request.artifactKinds, request.artifactIds, request.episodeNumber, undefined, request.factKinds, request.factIds),
      queries: [
        `${request.validator} ${request.lifecycle}: retrieve artifact evidence candidates for ${[
          request.artifactKinds?.join(', '),
          request.artifactIds?.join(', '),
          request.factKinds?.join(', '),
          request.episodeNumber != null ? `episode ${request.episodeNumber}` : undefined,
        ].filter(Boolean).join('; ')}. Return provenance, prior failures, and candidate source obligations only.`,
      ],
    });
  }

  async resolveExactArtifact<T>(pointer: ArtifactPointer): Promise<T | null> {
    const live = this.deps.artifactMemory.resolveLiveArtifact<T>(pointer);
    if (live) return live.payload;
    const loaded = await this.deps.loadArtifactFromDisk?.(pointer);
    if (loaded == null) return null;
    return loaded as T;
  }

  registerLiveArtifact<T>(envelope: PipelineArtifactEnvelope<T>): void {
    this.deps.artifactMemory.registerLiveArtifact(envelope);
  }
}
