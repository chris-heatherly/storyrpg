import type { ArtifactMemoryService } from './artifactMemoryService';
import type { FactMemoryService } from './factMemoryService';
import type {
  ArtifactPointer,
  PipelineMemoryArtifactKind,
  PipelineMemoryFactKind,
} from './artifactMemoryTypes';
import {
  renderPipelineMemoryPacket,
  slugifyMemoryKey,
  type MemoryProvider,
  type PipelineMemoryPacket,
  type PipelineMemoryRecallRequest,
} from './pipelineMemory';

export type RecallMode =
  | 'facts-first'
  | 'artifact-projection'
  | 'validator-history'
  | 'exact-artifact-pointer';

export interface MemoryRecallRouterDeps {
  provider: MemoryProvider;
  artifactMemory?: ArtifactMemoryService;
  factMemory?: FactMemoryService;
  loadArtifactFromDisk?: (pointer: ArtifactPointer) => Promise<unknown | null>;
  defaultDatasets: string[];
  validatorDataset: string;
  projectDataset: string;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => (v || '').trim()).filter(Boolean)));
}

function compactJson(value: unknown, maxChars = 4000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [truncated]` : text;
  } catch {
    return String(value);
  }
}

function formatFactSnippet(fact: { factKind: string; statement: string; factId: string }): string {
  return `[${fact.factKind}] ${fact.statement} (fact-id:${fact.factId})`;
}

function formatArtifactSnippet(
  kind: PipelineMemoryArtifactKind,
  artifactId: string,
  payload: unknown,
  projectionSummary?: string,
): string {
  const summary = projectionSummary || compactJson(payload, 2500);
  return `[artifact:${kind}] ${artifactId}\n${summary}`;
}

export function resolveRecallMode(request: PipelineMemoryRecallRequest): RecallMode {
  return (request.recallMode as RecallMode | undefined) || 'artifact-projection';
}

export function recallRouterEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORYRPG_MEMORY_RECALL_ROUTER !== '0';
}

export async function executeRecall(
  request: PipelineMemoryRecallRequest,
  deps: MemoryRecallRouterDeps,
): Promise<PipelineMemoryPacket | null> {
  const mode = resolveRecallMode(request);
  const maxPromptChars = request.maxPromptChars || 6000;

  if (mode === 'exact-artifact-pointer') {
    return recallExactArtifacts(request, deps, maxPromptChars);
  }

  if (mode === 'facts-first' && deps.factMemory) {
    const factPacket = await recallLiveFacts(request, deps, maxPromptChars);
    if (factPacket?.sourceSnippets.length) return factPacket;
  }

  if (mode === 'validator-history') {
    return deps.provider.recall({
      ...request,
      datasets: [deps.validatorDataset],
      searchType: request.searchType || 'GRAPH_COMPLETION',
      topK: request.topK || 5,
    });
  }

  return deps.provider.recall({
    ...request,
    datasets: request.datasets?.length ? request.datasets : deps.defaultDatasets,
    searchType: request.searchType || 'GRAPH_COMPLETION',
  });
}

async function recallExactArtifacts(
  request: PipelineMemoryRecallRequest,
  deps: MemoryRecallRouterDeps,
  maxPromptChars: number,
): Promise<PipelineMemoryPacket | null> {
  if (!deps.artifactMemory) return null;
  const pointers: ArtifactPointer[] = [];
  for (const artifactId of request.artifactIds || []) {
    pointers.push({
      artifactId,
      artifactKind: request.artifactKinds?.[0] || 'story-json',
    });
  }
  if (!pointers.length && request.artifactKinds?.length) {
    for (const envelope of deps.artifactMemory.findByKind(request.artifactKinds[0], request as { episodeNumber?: number })) {
      pointers.push(deps.artifactMemory.pointerFor(envelope));
    }
  }

  const snippets: string[] = [];
  for (const pointer of pointers) {
    const live = deps.artifactMemory.resolveLiveArtifact(pointer);
    if (live) {
      snippets.push(formatArtifactSnippet(live.artifactKind, live.artifactId, live.payload, live.projection.summary));
      continue;
    }
    const loaded = await deps.loadArtifactFromDisk?.(pointer);
    if (loaded != null) {
      snippets.push(formatArtifactSnippet(pointer.artifactKind, pointer.artifactId, loaded));
    }
  }

  if (!snippets.length) return null;
  const packet: PipelineMemoryPacket = {
    summary: `Exact artifact recall: ${snippets.length} live pointer(s).`,
    sourceSnippets: uniqueStrings(snippets),
    datasetNames: ['live-artifacts'],
    queryLog: [{
      query: 'exact-artifact-pointer',
      searchType: 'live-store',
      topK: snippets.length,
      resultCount: snippets.length,
      datasets: ['live-artifacts'],
      nodeNames: request.nodeNames,
    }],
    warnings: snippets.length ? [] : ['Exact artifact pointer recall returned no live artifacts.'],
  };
  const rendered = renderPipelineMemoryPacket(packet, maxPromptChars);
  if (rendered && rendered.length >= maxPromptChars) {
    packet.sourceSnippets = [rendered];
    packet.summary = `Exact artifact recall compacted to ${maxPromptChars} characters.`;
  }
  return packet;
}

async function recallLiveFacts(
  request: PipelineMemoryRecallRequest,
  deps: MemoryRecallRouterDeps,
  maxPromptChars: number,
): Promise<PipelineMemoryPacket | null> {
  const facts = deps.factMemory!.queryLiveFacts({
    storyId: undefined,
    episodeNumber: undefined,
    sceneId: undefined,
    factKinds: request.factKinds,
    factIds: request.factIds,
    artifactIds: request.artifactIds,
    limit: request.topK || 12,
  });
  if (!facts.length) return null;

  const snippets = facts.map(formatFactSnippet);
  const packet: PipelineMemoryPacket = {
    summary: `Live fact recall: ${facts.length} fact(s).`,
    sourceSnippets: snippets,
    datasetNames: ['live-facts'],
    queryLog: [{
      query: 'facts-first',
      searchType: 'live-store',
      topK: request.topK || facts.length,
      resultCount: facts.length,
      datasets: ['live-facts'],
      nodeNames: uniqueStrings([
        ...(request.factKinds || []).map((kind: PipelineMemoryFactKind) => `fact-kind:${kind}`),
        ...(request.factIds || []).map((id) => `fact-id:${slugifyMemoryKey(id)}`),
      ]),
    }],
    warnings: [],
  };
  const rendered = renderPipelineMemoryPacket(packet, maxPromptChars);
  if (rendered && rendered.length >= maxPromptChars) {
    packet.sourceSnippets = [rendered];
    packet.summary = `Live fact recall compacted to ${maxPromptChars} characters.`;
  }
  return packet;
}
