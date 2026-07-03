/**
 * Pipeline memory facade.
 *
 * Cognee is the preferred generator-side memory provider when configured. The
 * local file provider remains as a fail-open fallback and migration source.
 * Memory is advisory prompt context only; validators and typed artifacts remain
 * authoritative.
 */

import { PipelineConfig, type MemoryConfig, type MemoryLlmConfig } from '../config';
import { getMemoryStore, NodeMemoryStore, type MemoryStore } from '../utils/memoryStore';
import type {
  PipelineFactRecord,
  PipelineMemoryArtifactKind,
  PipelineMemoryFactKind,
} from './artifactMemoryTypes';
import { planAgentMemoryQueries, planValidatorMemoryQueries } from './memoryQueryPlanner';

export type PipelineMemoryProviderName = 'cognee' | 'file' | 'disabled';

export interface PipelineMemoryPacket {
  summary: string;
  sourceSnippets: string[];
  datasetNames: string[];
  queryLog: Array<{
    query: string;
    searchType: string;
    topK: number;
    resultCount: number;
    datasets?: string[];
    nodeNames?: string[];
  }>;
  warnings: string[];
}

export interface PipelineMemoryRecord {
  kind:
    | 'generation'
    | 'qa-learning'
    | 'character'
    | 'validator'
    | 'artifact'
    | 'fact'
    | 'project';
  dataset?: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
  nodeSet?: string[];
  cognify?: boolean;
}

export interface PipelineMemoryRecallRequest {
  queries?: string[];
  datasets?: string[];
  nodeNames?: string[];
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  factKinds?: PipelineMemoryFactKind[];
  factIds?: string[];
  recallMode?: 'facts-first' | 'artifact-projection' | 'validator-history' | 'exact-artifact-pointer';
  searchType?: string;
  topK?: number;
  maxPromptChars?: number;
}

export interface MemoryProvider {
  readonly name: PipelineMemoryProviderName;
  remember(record: PipelineMemoryRecord): Promise<void>;
  recall(request: PipelineMemoryRecallRequest): Promise<PipelineMemoryPacket | null>;
  cognify?(datasets: string[], options?: { background?: boolean }): Promise<void>;
  readCharacterMemory(characterName: string): Promise<string | null>;
}

export interface PipelineMemoryDeps {
  config: PipelineConfig;
}

const DEFAULT_PROJECT_DATASET = 'storyrpg-project';
const DEFAULT_RUN_DATASET_PREFIX = 'storyrpg-run';
const DEFAULT_VALIDATOR_DATASET = 'storyrpg-validator-history';
const AGENT_HISTORY_DATASET = 'storyrpg-agent-history';
const DEFAULT_MAX_PROMPT_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOP_K = 6;

export type AgentMemoryRole =
  | 'SourceMaterialAnalyzer'
  | 'WorldBuilder'
  | 'CharacterDesigner'
  | 'StoryArchitect'
  | 'BranchManager'
  | 'SceneWriter'
  | 'ChoiceAuthor'
  | 'EncounterArchitect'
  | 'ThreadPlanner'
  | 'TwistArchitect'
  | 'CharacterArcTracker'
  | 'ImageAgentTeam'
  | 'AudioGenerationService'
  | 'VideoDirectorAgent'
  | 'QARunner'
  | 'FinalContract';

export interface AgentMemoryRequest {
  agentRole: AgentMemoryRole;
  lifecycle: string;
  storyId?: string;
  episodeNumber?: number;
  sourceFingerprint?: string;
  treatmentId?: string;
  characterIds?: string[];
  sceneId?: string;
  validatorNames?: string[];
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  factKinds?: PipelineMemoryFactKind[];
  factIds?: string[];
  recallMode?: 'facts-first' | 'artifact-projection' | 'validator-history' | 'exact-artifact-pointer';
  queries?: string[];
  datasets?: string[];
  nodeNames?: string[];
  topK?: number;
  maxPromptChars?: number;
}

export interface AgentMemoryContext {
  renderedPromptBlock: string | null;
  retrievals: PipelineMemoryPacket[];
  datasetNames: string[];
  nodeNames: string[];
  warnings: string[];
  provenance: Array<{
    query: string;
    datasets: string[];
    nodeNames: string[];
    resultCount: number;
  }>;
}

export type ValidatorEvidenceMode = 'none' | 'advisory-memory' | 'corroborated-evidence' | 'artifact-required';

export interface ValidatorEvidenceRequest {
  validator: string;
  lifecycle: string;
  storyId?: string;
  episodeNumber?: number;
  sourceFingerprint?: string;
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  factKinds?: PipelineMemoryFactKind[];
  factIds?: string[];
  validatorNames?: string[];
  evidenceMode?: ValidatorEvidenceMode;
  recallMode?: 'facts-first' | 'artifact-projection' | 'validator-history' | 'exact-artifact-pointer';
  queries?: string[];
  datasets?: string[];
  nodeNames?: string[];
  topK?: number;
  maxPromptChars?: number;
}

export interface ValidatorEvidenceBundle {
  validator: string;
  lifecycle: string;
  artifactIds: string[];
  facts: Array<{
    fact: string;
    corroboratedBy: string[];
    confidence: number;
  }>;
  priorFailures: string[];
  relatedFindings: string[];
  sourceSnippets: string[];
  confidence: number;
  provenance: Array<{
    query: string;
    datasets: string[];
    nodeNames: string[];
    resultCount: number;
  }>;
  retrievalWarnings: string[];
  validatedFacts?: PipelineFactRecord[];
  candidateFacts?: PipelineFactRecord[];
  artifactPointers?: Array<{
    artifactKind: PipelineMemoryArtifactKind;
    artifactId: string;
    contentHash?: string;
  }>;
  corroborationRequired?: boolean;
}

export interface PipelineMemoryOutcomeRecord {
  role?: AgentMemoryRole;
  validator?: string;
  lifecycle?: string;
  storyId?: string;
  episodeNumber?: number;
  sceneId?: string;
  artifactKinds?: PipelineMemoryArtifactKind[];
  artifactIds?: string[];
  outcome?: string;
  title?: string;
  summary?: string;
  payload?: unknown;
  nodeSet?: string[];
  dataset?: string;
}

function compactJson(value: unknown, maxChars = 12_000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [truncated]` : text;
  } catch {
    return String(value);
  }
}

export function slugifyMemoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'memory';
}

function memoryDefaults(config?: MemoryConfig): Required<Pick<
  MemoryConfig,
  'projectDataset' | 'runDatasetPrefix' | 'validatorDataset' | 'maxPromptChars' | 'timeoutMs' | 'failOpen'
>> {
  return {
    projectDataset: config?.projectDataset || DEFAULT_PROJECT_DATASET,
    runDatasetPrefix: config?.runDatasetPrefix || DEFAULT_RUN_DATASET_PREFIX,
    validatorDataset: config?.validatorDataset || DEFAULT_VALIDATOR_DATASET,
    maxPromptChars: config?.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS,
    timeoutMs: config?.timeoutMs || DEFAULT_TIMEOUT_MS,
    failOpen: config?.failOpen !== false,
  };
}

export function renderPipelineMemoryPacket(packet: PipelineMemoryPacket | null | undefined, maxChars = DEFAULT_MAX_PROMPT_CHARS): string | null {
  if (!packet) return null;
  const sections = [
    packet.summary ? `Summary:\n${packet.summary}` : null,
    packet.sourceSnippets.length ? `Relevant Memory:\n${packet.sourceSnippets.map((s) => `- ${s}`).join('\n')}` : null,
    packet.warnings.length ? `Memory Warnings:\n${packet.warnings.map((w) => `- ${w}`).join('\n')}` : null,
  ].filter(Boolean);
  if (sections.length === 0) return null;
  const rendered = sections.join('\n\n');
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars)}\n... [memory truncated]` : rendered;
}

function emptyPacket(warnings: string[] = []): PipelineMemoryPacket {
  return {
    summary: '',
    sourceSnippets: [],
    datasetNames: [],
    queryLog: [],
    warnings,
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => (v || '').trim()).filter(Boolean)));
}

function runDatasetName(defaults: ReturnType<typeof memoryDefaults>, storyId?: string): string | undefined {
  return storyId ? `${defaults.runDatasetPrefix}-${slugifyMemoryKey(storyId)}` : undefined;
}

function sourceDatasetName(sourceFingerprint?: string, treatmentId?: string): string | undefined {
  const key = sourceFingerprint || treatmentId;
  return key ? `storyrpg-source-${slugifyMemoryKey(key)}` : undefined;
}

function characterDatasetNames(characterIds?: string[]): string[] {
  return (characterIds || []).map((id) => `storyrpg-character-${slugifyMemoryKey(id)}`);
}

function agentNodeNames(request: AgentMemoryRequest): string[] {
  return uniqueStrings([
    `agent:${request.agentRole}`,
    request.lifecycle,
    request.episodeNumber != null ? `episode:${request.episodeNumber}` : undefined,
    request.sceneId ? `scene:${request.sceneId}` : undefined,
    ...(request.characterIds || []).map((id) => `character:${slugifyMemoryKey(id)}`),
    ...(request.artifactKinds || []).flatMap((kind) => [`artifact:${kind}`, `artifact-kind:${kind}`]),
    ...(request.artifactIds || []).flatMap((id) => [`artifact:${slugifyMemoryKey(id)}`, `artifact-id:${slugifyMemoryKey(id)}`]),
    ...(request.factKinds || []).map((kind) => `fact-kind:${kind}`),
    ...(request.factIds || []).map((id) => `fact-id:${slugifyMemoryKey(id)}`),
    ...(request.nodeNames || []),
  ]);
}

function validatorNodeNames(request: ValidatorEvidenceRequest): string[] {
  return uniqueStrings([
    `validator:${request.validator}`,
    request.lifecycle,
    request.episodeNumber != null ? `episode:${request.episodeNumber}` : undefined,
    ...(request.validatorNames || []).map((name) => `validator:${name}`),
    ...(request.artifactKinds || []).flatMap((kind) => [`artifact:${kind}`, `artifact-kind:${kind}`]),
    ...(request.artifactIds || []).flatMap((id) => [`artifact:${slugifyMemoryKey(id)}`, `artifact-id:${slugifyMemoryKey(id)}`]),
    ...(request.factKinds || []).map((kind) => `fact-kind:${kind}`),
    ...(request.factIds || []).map((id) => `fact-id:${slugifyMemoryKey(id)}`),
    ...(request.nodeNames || []),
  ]);
}

function factNodeNames(factKinds?: PipelineMemoryFactKind[], factIds?: string[]): string[] {
  return uniqueStrings([
    ...(factKinds || []).map((kind) => `fact-kind:${kind}`),
    ...(factIds || []).map((id) => `fact-id:${slugifyMemoryKey(id)}`),
  ]);
}

function packetProvenance(packet: PipelineMemoryPacket, nodeNames: string[]): AgentMemoryContext['provenance'] {
  return packet.queryLog.map((entry) => ({
    query: entry.query,
    datasets: entry.datasets || packet.datasetNames,
    nodeNames: entry.nodeNames || nodeNames,
    resultCount: entry.resultCount,
  }));
}

function renderAgentMemoryContext(
  request: AgentMemoryRequest,
  packets: PipelineMemoryPacket[],
  maxChars: number,
): string | null {
  const snippets = uniqueStrings(packets.flatMap((packet) => packet.sourceSnippets));
  const warnings = uniqueStrings(packets.flatMap((packet) => packet.warnings));
  if (!snippets.length && !warnings.length) return null;
  const lines = [
    'Retrieved Pipeline Memory',
    'Advisory context; do not contradict fixed canon.',
    `Role: ${request.agentRole}`,
    `Lifecycle: ${request.lifecycle}`,
    request.episodeNumber != null ? `Episode: ${request.episodeNumber}` : null,
    request.sceneId ? `Scene: ${request.sceneId}` : null,
    '',
    snippets.length ? 'Relevant Memory:' : null,
    ...snippets.map((snippet) => `- ${snippet}`),
    warnings.length ? '\nMemory Warnings:' : null,
    ...warnings.map((warning) => `- ${warning}`),
  ].filter((line) => line != null) as string[];
  const rendered = lines.join('\n');
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars)}\n... [retrieved memory truncated]` : rendered;
}

function summarizeValidatorSnippet(snippet: string): string {
  const clean = snippet.replace(/\s+/g, ' ').trim();
  return clean.length > 500 ? `${clean.slice(0, 500)}...` : clean;
}

function normalizeSearchResults(payload: unknown): string[] {
  const raw = Array.isArray(payload) ? payload : [payload];
  const snippets: string[] = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      snippets.push(item);
      continue;
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const candidate = record.search_result ?? record.result ?? record.data ?? record.text;
      snippets.push(typeof candidate === 'string' ? candidate : compactJson(candidate ?? record, 4000));
      continue;
    }
    snippets.push(String(item));
  }
  return snippets.filter((s) => s.trim().length > 0);
}

/**
 * NodeMemoryStore `view` returns a directory listing whose entries are
 * `<size>\t<path>` lines, and file bodies prefixed with a header line plus
 * per-line `<lineNo>\t<content>`. These helpers recover the raw paths/content
 * so the file fallback can enumerate the buckets remember() actually writes.
 */
function parseMemoryDirListing(listing: string, bucket: string): string[] {
  return listing
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('\t');
      return idx >= 0 ? line.slice(idx + 1).trim() : '';
    })
    .filter((entry) => entry.endsWith('.md') && entry.startsWith(`${bucket}/`));
}

function stripMemoryViewFormatting(viewOutput: string): string {
  const firstNewline = viewOutput.indexOf('\n');
  const body = firstNewline >= 0 ? viewOutput.slice(firstNewline + 1) : viewOutput;
  return body
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('\t');
      return idx >= 0 ? line.slice(idx + 1) : line;
    })
    .join('\n');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface CogneeLlmTarget {
  provider: string;
  model: string;
  apiKey?: string;
}

/** Providers Cognee's runtime settings API accepts (openrouter is not one). */
const COGNEE_SUPPORTED_LLM_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'mistral', 'ollama', 'bedrock']);

/**
 * Cognee routes models through litellm, which sends a bare `gemini-*` model to
 * Vertex AI (needing google.auth, absent from the image) instead of the
 * API-key AI-Studio route. The `gemini/` prefix forces the AI-Studio route.
 * Anthropic/OpenAI bare model names route correctly as-is.
 */
function cogneeModelName(provider: string, model: string): string {
  if (provider === 'gemini' && !model.includes('/')) return `gemini/${model}`;
  return model;
}

/**
 * Resolve which LLM Cognee should use for graph extraction on this run.
 *
 * Default (`mirror`) follows the narrative model: the SceneWriter agent's
 * provider/model/key from the run config — so switching the narrative model in
 * the generator retargets memory extraction with it. A `custom` memory.llm
 * (generator setting or STORYRPG_MEMORY_LLM_* env) pins an explicit target.
 * Returns null when nothing usable is configured (Cognee then keeps whatever
 * its server is already set to).
 */
export function resolveCogneeLlmTarget(config: PipelineConfig): CogneeLlmTarget | null {
  const memoryLlm: MemoryLlmConfig | undefined = config.memory?.llm;
  if (memoryLlm?.mode === 'custom') {
    if (!memoryLlm.provider || !memoryLlm.model) return null;
    const provider = memoryLlm.provider === 'google' ? 'gemini' : memoryLlm.provider;
    if (!COGNEE_SUPPORTED_LLM_PROVIDERS.has(provider)) return null;
    return { provider, model: cogneeModelName(provider, memoryLlm.model), apiKey: memoryLlm.apiKey };
  }
  // Mirror: SceneWriter carries the narrative model; storyArchitect is the
  // fallback for configs that omit it.
  const agents = config.agents as Record<string, { provider?: string; model?: string; apiKey?: string } | undefined> | undefined;
  const narrative = agents?.sceneWriter || agents?.storyArchitect;
  if (!narrative?.provider || !narrative.model) return null;
  const provider = narrative.provider === 'google' ? 'gemini' : narrative.provider;
  if (!COGNEE_SUPPORTED_LLM_PROVIDERS.has(provider)) return null;
  return { provider, model: cogneeModelName(provider, narrative.model), apiKey: narrative.apiKey };
}

class DisabledMemoryProvider implements MemoryProvider {
  readonly name = 'disabled' as const;

  async remember(): Promise<void> {}

  async recall(): Promise<PipelineMemoryPacket | null> {
    return null;
  }

  async cognify(): Promise<void> {}

  async readCharacterMemory(): Promise<string | null> {
    return null;
  }
}

class FileMemoryProvider implements MemoryProvider {
  readonly name = 'file' as const;

  constructor(private config: MemoryConfig | undefined) {}

  private getMemoryStoreInstance(): MemoryStore {
    if (this.config?.directory) {
      return new NodeMemoryStore(this.config.directory);
    }
    return getMemoryStore();
  }

  async remember(record: PipelineMemoryRecord): Promise<void> {
    const store = this.getMemoryStoreInstance();
    const bucket = record.kind === 'character' ? 'characters' : record.kind === 'validator' ? 'validators' : 'pipeline';
    const key = record.kind === 'character' && record.metadata?.characterName
      ? slugifyMemoryKey(String(record.metadata.characterName))
      : slugifyMemoryKey(record.title);
    const path = `/memories/${bucket}/${key}.md`;
    const entry = [
      `\n## ${new Date().toISOString()} - ${record.title}`,
      record.text,
      record.metadata ? `\nMetadata:\n${compactJson(record.metadata, 4000)}` : null,
    ].filter(Boolean).join('\n');
    const existing = await store.execute({ command: 'view', path });
    if (existing.includes('does not exist')) {
      await store.execute({ command: 'create', path, file_text: `# ${record.title}\n${entry}\n` });
    } else {
      await store.execute({ command: 'insert', path, insert_line: 0, insert_text: `${entry}\n` });
    }
  }

  async recall(request: PipelineMemoryRecallRequest): Promise<PipelineMemoryPacket | null> {
    const store = this.getMemoryStoreInstance();
    // remember() writes generation/qa/pipeline records under /memories/pipeline
    // and validator records under /memories/validators using title-derived
    // slugs — so enumerate those buckets rather than reading fixed filenames
    // that the write path never creates.
    const buckets = ['/memories/pipeline', '/memories/validators'];
    const maxChars = request.maxPromptChars || this.config?.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS;
    const snippets: string[] = [];
    let budget = maxChars;
    for (const bucket of buckets) {
      if (budget <= 0) break;
      const listing = await store.execute({ command: 'view', path: bucket });
      if (listing.includes('does not exist')) continue;
      for (const filePath of parseMemoryDirListing(listing, bucket)) {
        if (budget <= 0) break;
        const raw = await store.execute({ command: 'view', path: filePath });
        if (raw.includes('does not exist')) continue;
        const content = stripMemoryViewFormatting(raw).trim();
        if (!content) continue;
        const clipped = content.length > budget ? content.slice(0, budget) : content;
        snippets.push(`# ${filePath}\n${clipped}`);
        budget -= clipped.length;
      }
    }
    if (snippets.length === 0) return null;
    return {
      summary: `Local file memory: ${snippets.length} record(s) from pipeline/validator buckets.`,
      sourceSnippets: snippets,
      datasetNames: ['file:pipeline-memories'],
      queryLog: [],
      warnings: [],
    };
  }

  async cognify(): Promise<void> {}

  async readCharacterMemory(characterName: string): Promise<string | null> {
    const store = this.getMemoryStoreInstance();
    const path = `/memories/characters/${slugifyMemoryKey(characterName)}.md`;
    const result = await store.execute({ command: 'view', path });
    if (result.includes('does not exist')) return null;
    return result;
  }
}

export class CogneeHttpMemoryProvider implements MemoryProvider {
  readonly name = 'cognee' as const;

  private llmSyncPromise?: Promise<void>;

  constructor(private config: MemoryConfig, private llmTarget?: CogneeLlmTarget | null) {}

  /**
   * Push the run's LLM target (narrative-model mirror or custom pin) to
   * Cognee's runtime settings once per provider instance, before the first
   * memory operation. Fail-open: on error Cognee keeps its current LLM and
   * memory ops proceed.
   */
  private ensureLlmSynced(): Promise<void> {
    if (!this.llmSyncPromise) {
      this.llmSyncPromise = (async () => {
        if (!this.llmTarget || !this.baseUrl) return;
        try {
          const response = await fetchWithTimeout(this.endpoint('settings'), {
            method: 'POST',
            headers: this.headers(true),
            body: JSON.stringify({
              llm: {
                provider: this.llmTarget.provider,
                model: this.llmTarget.model,
                ...(this.llmTarget.apiKey ? { apiKey: this.llmTarget.apiKey } : {}),
              },
            }),
          }, this.timeoutMs());
          if (!response.ok) {
            console.warn(`[Pipeline] Memory: Cognee LLM settings sync failed (${response.status}); keeping server's current LLM.`);
          }
        } catch (err) {
          console.warn('[Pipeline] Memory: Cognee LLM settings sync failed; keeping server\'s current LLM.', err);
        }
      })();
    }
    return this.llmSyncPromise;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || '').replace(/\/+$/, '');
  }

  private headers(json = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    // Cognee authenticates minted API keys via the `X-Api-Key` header; the
    // `Authorization: Bearer` scheme is reserved for short-lived login JWTs.
    if (this.config.apiKey) headers['X-Api-Key'] = this.config.apiKey;
    return headers;
  }

  private endpoint(path: string): string {
    return `${this.baseUrl}/api/v1/${path.replace(/^\/+/, '')}`;
  }

  private timeoutMs(): number {
    return this.config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  async remember(record: PipelineMemoryRecord): Promise<void> {
    if (!this.config.writeEnabled || !this.baseUrl) return;
    await this.ensureLlmSynced();
    const dataset = record.dataset || this.config.projectDataset || DEFAULT_PROJECT_DATASET;
    const body = new FormData();
    // The /add endpoint expects `data` as uploaded file(s), not a text field.
    const fileName = `${slugifyMemoryKey(record.title)}.md`;
    body.append('data', new Blob([this.formatRecord(record)], { type: 'text/markdown' }), fileName);
    body.append('datasetName', dataset);
    if (record.nodeSet?.length) {
      for (const node of record.nodeSet) body.append('node_set', node);
    }
    // Ingest asynchronously: memory writes are advisory and must never block
    // (or fail) generation on Cognee's LLM-backed graph extraction.
    body.append('run_in_background', 'true');

    const addResponse = await fetchWithTimeout(this.endpoint('add'), {
      method: 'POST',
      headers: this.headers(false),
      body,
    }, this.timeoutMs());
    if (!addResponse.ok) {
      throw new Error(`Cognee add failed: ${addResponse.status} ${await addResponse.text()}`);
    }

    if (this.config.cognifyEnabled && record.cognify !== false) {
      await this.cognify([dataset], { background: true });
    }
  }

  async recall(request: PipelineMemoryRecallRequest): Promise<PipelineMemoryPacket | null> {
    if (!this.config.recallEnabled || !this.baseUrl) return null;
    await this.ensureLlmSynced();
    const defaults = memoryDefaults(this.config);
    const datasets = request.datasets?.length ? request.datasets : [defaults.projectDataset, defaults.validatorDataset];
    const queries = request.queries?.length ? request.queries : [
      'StoryRPG pipeline lessons, validation failures, source fidelity rules, character continuity, branching consequences',
    ];
    const topK = request.topK || DEFAULT_TOP_K;
    const maxPromptChars = request.maxPromptChars || defaults.maxPromptChars;
    const searchType = request.searchType || 'GRAPH_COMPLETION';
    const nodeNames = uniqueStrings([
      ...(request.nodeNames || []),
      ...(request.artifactKinds || []).flatMap((kind) => [`artifact:${kind}`, `artifact-kind:${kind}`]),
      ...(request.artifactIds || []).flatMap((id) => [`artifact:${slugifyMemoryKey(id)}`, `artifact-id:${slugifyMemoryKey(id)}`]),
      ...factNodeNames(request.factKinds, request.factIds),
    ]);
    const packet = emptyPacket();
    packet.datasetNames = datasets;

    for (const query of queries) {
      const response = await fetchWithTimeout(this.endpoint('search'), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          searchType,
          query,
          datasets,
          topK,
          onlyContext: true,
          ...(nodeNames.length ? { nodeNames, nodeName: nodeNames[0] } : {}),
        }),
      }, this.timeoutMs());
      if (!response.ok) {
        throw new Error(`Cognee search failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json();
      const snippets = normalizeSearchResults(payload);
      packet.queryLog.push({ query, searchType, topK, resultCount: snippets.length, datasets, nodeNames });
      packet.sourceSnippets.push(...snippets);
    }

    const unique = Array.from(new Set(packet.sourceSnippets.map((s) => s.trim()).filter(Boolean)));
    packet.sourceSnippets = unique;
    packet.summary = packet.sourceSnippets.length
      ? `Cognee recalled ${packet.sourceSnippets.length} memory snippet(s) from ${datasets.join(', ')}.`
      : 'Cognee recall returned no relevant memory.';
    const rendered = renderPipelineMemoryPacket(packet, maxPromptChars);
    if (rendered && rendered.length >= maxPromptChars) {
      packet.sourceSnippets = [rendered];
      packet.summary = `Cognee memory compacted to ${maxPromptChars} characters.`;
    }
    return packet;
  }

  async cognify(datasets: string[], options: { background?: boolean } = {}): Promise<void> {
    if (!this.config.cognifyEnabled || !this.baseUrl || datasets.length === 0) return;
    await this.ensureLlmSynced();
    const cognifyResponse = await fetchWithTimeout(this.endpoint('cognify'), {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        datasets,
        runInBackground: options.background !== false,
        run_in_background: options.background !== false,
      }),
    }, this.timeoutMs());
    if (!cognifyResponse.ok) {
      throw new Error(`Cognee cognify failed: ${cognifyResponse.status} ${await cognifyResponse.text()}`);
    }
  }

  async readCharacterMemory(characterName: string): Promise<string | null> {
    const defaults = memoryDefaults(this.config);
    const packet = await this.recall({
      datasets: [`storyrpg-character-${slugifyMemoryKey(characterName)}`, defaults.projectDataset],
      queries: [`Character continuity, appearance, reference-image history, and style facts for ${characterName}`],
      topK: 4,
      maxPromptChars: this.config.maxPromptChars,
    });
    return renderPipelineMemoryPacket(packet, this.config.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS);
  }

  private formatRecord(record: PipelineMemoryRecord): string {
    return [
      `# ${record.title}`,
      `Kind: ${record.kind}`,
      record.metadata ? `Metadata:\n${compactJson(record.metadata, 8000)}` : null,
      '',
      record.text,
    ].filter((part) => part != null).join('\n');
  }
}

function resolveProvider(config: MemoryConfig | undefined): PipelineMemoryProviderName {
  if (!config?.enabled) return 'disabled';
  if (config.provider === 'disabled') return 'disabled';
  if (config.provider === 'cognee' && config.baseUrl) return 'cognee';
  if (!config.provider && config.baseUrl) return 'cognee';
  return 'file';
}

export class PipelineMemory {
  private provider?: MemoryProvider;

  constructor(private deps: PipelineMemoryDeps) {}

  private get config(): MemoryConfig | undefined {
    return this.deps.config.memory;
  }

  private get defaults() {
    return memoryDefaults(this.config);
  }

  private getProvider(): MemoryProvider {
    if (this.provider) return this.provider;
    const provider = resolveProvider(this.config);
    if (provider === 'cognee') {
      this.provider = new CogneeHttpMemoryProvider(this.config!, resolveCogneeLlmTarget(this.deps.config));
    } else if (provider === 'file') {
      this.provider = new FileMemoryProvider(this.config);
    } else {
      this.provider = new DisabledMemoryProvider();
    }
    return this.provider;
  }

  private async bestEffort<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (this.defaults.failOpen) {
        console.warn(`[Pipeline] Memory: ${label} failed:`, err);
        return fallback;
      }
      throw err;
    }
  }

  private runDataset(storyId?: string): string {
    return storyId ? `${this.defaults.runDatasetPrefix}-${slugifyMemoryKey(storyId)}` : this.defaults.projectDataset;
  }

  private agentDatasets(request: AgentMemoryRequest): string[] {
    return uniqueStrings([
      this.defaults.projectDataset,
      runDatasetName(this.defaults, request.storyId),
      sourceDatasetName(request.sourceFingerprint, request.treatmentId),
      ...characterDatasetNames(request.characterIds),
      this.defaults.validatorDataset,
      AGENT_HISTORY_DATASET,
      ...(request.datasets || []),
    ]);
  }

  private validatorDatasets(request: ValidatorEvidenceRequest): string[] {
    return uniqueStrings([
      this.defaults.projectDataset,
      runDatasetName(this.defaults, request.storyId),
      sourceDatasetName(request.sourceFingerprint),
      this.defaults.validatorDataset,
      AGENT_HISTORY_DATASET,
      ...(request.datasets || []),
    ]);
  }

  async writeRecord(record: PipelineMemoryRecord): Promise<void> {
    const config = this.config;
    if (!config?.enabled || config.writeEnabled === false) return;
    await this.bestEffort('write record', () => this.getProvider().remember(record), undefined);
  }

  async recallPacket(request: PipelineMemoryRecallRequest = {}): Promise<PipelineMemoryPacket | null> {
    const config = this.config;
    if (!config?.enabled || config.recallEnabled === false) return null;
    return this.bestEffort('recall', () => this.getProvider().recall({
      maxPromptChars: this.defaults.maxPromptChars,
      ...request,
    }), null);
  }

  async recallForAgent(request: AgentMemoryRequest): Promise<AgentMemoryContext> {
    const maxPromptChars = request.maxPromptChars || this.defaults.maxPromptChars;
    const datasets = this.agentDatasets(request);
    const nodeNames = agentNodeNames(request);
    const plannedQueries = planAgentMemoryQueries(request);
    const packets = await Promise.all(plannedQueries.map((plan) => this.recallPacket({
      queries: [plan.query],
      datasets,
      nodeNames: uniqueStrings([
        ...nodeNames,
        ...factNodeNames(plan.factKinds, request.factIds),
      ]),
      artifactKinds: request.artifactKinds,
      artifactIds: request.artifactIds,
      factKinds: plan.factKinds,
      factIds: request.factIds,
      recallMode: request.recallMode || 'facts-first',
      topK: request.topK || plan.topK || DEFAULT_TOP_K,
      maxPromptChars,
    })));
    const retrievals = packets.filter((packet): packet is PipelineMemoryPacket => Boolean(packet));
    const warnings = uniqueStrings([
      ...retrievals.flatMap((p) => p.warnings),
      retrievals.length === 0 ? 'Memory recall unavailable; proceeding with deterministic artifacts only.' : undefined,
    ]);
    return {
      renderedPromptBlock: renderAgentMemoryContext(request, retrievals, maxPromptChars),
      retrievals,
      datasetNames: uniqueStrings(retrievals.flatMap((p) => p.datasetNames).concat(datasets)),
      nodeNames,
      warnings,
      provenance: retrievals.flatMap((p) => packetProvenance(p, nodeNames)),
    };
  }

  async recallForValidator(request: ValidatorEvidenceRequest): Promise<ValidatorEvidenceBundle> {
    const datasets = this.validatorDatasets(request);
    const nodeNames = validatorNodeNames(request);
    const plannedQueries = planValidatorMemoryQueries(request);
    const packets = await Promise.all(plannedQueries.map((plan) => this.recallPacket({
      queries: [plan.query],
      datasets,
      nodeNames: uniqueStrings([
        ...nodeNames,
        ...factNodeNames(plan.factKinds, request.factIds),
      ]),
      artifactKinds: request.artifactKinds,
      artifactIds: request.artifactIds,
      factKinds: plan.factKinds,
      factIds: request.factIds,
      recallMode: request.recallMode || 'facts-first',
      topK: request.topK || plan.topK || DEFAULT_TOP_K,
      maxPromptChars: request.maxPromptChars || this.defaults.maxPromptChars,
    })));
    const retrievals = packets.filter((packet): packet is PipelineMemoryPacket => Boolean(packet));
    const snippets = uniqueStrings(retrievals.flatMap((packet) => packet.sourceSnippets)).map(summarizeValidatorSnippet);
    const priorFailures = snippets.filter((snippet) => /\b(fail(?:ed|ure)?|blocking|regression|error|repair)\b/i.test(snippet));
    const relatedFindings = snippets.filter((snippet) => /\b(finding|validator|warning|issue|gate)\b/i.test(snippet));
    const retrievalWarnings = uniqueStrings([
      ...retrievals.flatMap((packet) => packet.warnings),
      request.evidenceMode === 'corroborated-evidence' || request.evidenceMode === 'artifact-required'
        ? 'Cognee evidence must be corroborated against current typed artifacts before deterministic use.'
        : 'Cognee snippets are advisory memory only and do not change validator pass/fail decisions.',
      retrievals.length === 0 ? 'Memory evidence unavailable; validator must use current artifacts only.' : undefined,
    ]);
    return {
      validator: request.validator,
      lifecycle: request.lifecycle,
      artifactIds: request.artifactIds || [],
      facts: [],
      priorFailures,
      relatedFindings,
      sourceSnippets: snippets,
      confidence: snippets.length ? 0.35 : 0,
      provenance: retrievals.flatMap((packet) => packetProvenance(packet, nodeNames)),
      retrievalWarnings,
      validatedFacts: [],
      candidateFacts: [],
      artifactPointers: (request.artifactIds || []).map((artifactId) => ({
        artifactId,
        artifactKind: request.artifactKinds?.[0] || 'story-json',
      })),
      corroborationRequired: request.evidenceMode === 'corroborated-evidence' || request.evidenceMode === 'artifact-required',
    };
  }

  async readPipelineMemory(): Promise<string | null> {
    const packet = await this.recallPacket();
    return renderPipelineMemoryPacket(packet, this.defaults.maxPromptChars);
  }

  async writeAgentOutcome(record: PipelineMemoryOutcomeRecord): Promise<void> {
    const storyDataset = runDatasetName(this.defaults, record.storyId);
    await this.writeRecord({
      kind: 'generation',
      dataset: record.dataset || storyDataset || AGENT_HISTORY_DATASET,
      title: record.title || `${record.role || 'Agent'} ${record.outcome || 'outcome'}`,
      text: [
        record.role ? `Agent: ${record.role}` : null,
        record.lifecycle ? `Lifecycle: ${record.lifecycle}` : null,
        record.episodeNumber != null ? `Episode: ${record.episodeNumber}` : null,
        record.sceneId ? `Scene: ${record.sceneId}` : null,
        record.outcome ? `Outcome: ${record.outcome}` : null,
        record.artifactKinds?.length ? `Artifact kinds: ${record.artifactKinds.join(', ')}` : null,
        record.artifactIds?.length ? `Artifacts: ${record.artifactIds.join(', ')}` : null,
        record.summary || null,
        record.payload !== undefined ? `Payload:\n${compactJson(record.payload, 8000)}` : null,
      ].filter(Boolean).join('\n'),
      metadata: record as unknown as Record<string, unknown>,
      nodeSet: uniqueStrings([
        record.role ? `agent:${record.role}` : 'agent',
        record.lifecycle,
        record.episodeNumber != null ? `episode:${record.episodeNumber}` : undefined,
        record.sceneId ? `scene:${record.sceneId}` : undefined,
        ...(record.artifactKinds || []).flatMap((kind) => [`artifact:${kind}`, `artifact-kind:${kind}`]),
        ...(record.artifactIds || []).map((id) => `artifact:${slugifyMemoryKey(id)}`),
        ...(record.nodeSet || []),
      ]),
    });
  }

  async writeValidatorOutcome(record: PipelineMemoryOutcomeRecord): Promise<void> {
    await this.writeValidatorMemory({
      validator: record.validator || 'validator',
      lifecycle: record.lifecycle,
      storyId: record.storyId,
      artifactIds: record.artifactIds,
      outcome: record.outcome,
      findings: record.payload ?? record.summary,
    });
  }

  async writeArtifactSnapshot(record: PipelineMemoryOutcomeRecord): Promise<void> {
    await this.writeRecord({
      kind: 'artifact',
      dataset: record.dataset || this.runDataset(record.storyId),
      title: record.title || `Artifact snapshot${record.artifactIds?.length ? `: ${record.artifactIds.join(', ')}` : ''}`,
      text: [
        record.lifecycle ? `Lifecycle: ${record.lifecycle}` : null,
        record.episodeNumber != null ? `Episode: ${record.episodeNumber}` : null,
        record.sceneId ? `Scene: ${record.sceneId}` : null,
        record.summary || null,
        record.payload !== undefined ? `Snapshot:\n${compactJson(record.payload, 10_000)}` : null,
      ].filter(Boolean).join('\n'),
      metadata: record as unknown as Record<string, unknown>,
      nodeSet: uniqueStrings([
        'artifact',
        record.lifecycle,
        record.episodeNumber != null ? `episode:${record.episodeNumber}` : undefined,
        record.sceneId ? `scene:${record.sceneId}` : undefined,
        ...(record.artifactIds || []).map((id) => `artifact:${slugifyMemoryKey(id)}`),
        ...(record.nodeSet || []),
      ]),
    });
  }

  async writeFactSnapshot(fact: PipelineFactRecord): Promise<void> {
    await this.writeRecord({
      kind: 'fact',
      dataset: this.runDataset(fact.storyId),
      title: `${fact.factKind}: ${fact.subjectId || fact.factId}`,
      text: [
        `Fact ID: ${fact.factId}`,
        `Fact kind: ${fact.factKind}`,
        `Status: ${fact.status}`,
        fact.episodeNumber != null ? `Episode: ${fact.episodeNumber}` : null,
        fact.sceneId ? `Scene: ${fact.sceneId}` : null,
        fact.subjectId ? `Subject: ${fact.subjectId}` : null,
        fact.predicate ? `Predicate: ${fact.predicate}` : null,
        `Statement: ${fact.statement}`,
        fact.artifactRefs.length ? `Artifact refs: ${fact.artifactRefs.map((ref) => `${ref.artifactKind}:${ref.artifactId}:${ref.contentHash.slice(0, 12)}`).join(', ')}` : null,
      ].filter(Boolean).join('\n'),
      metadata: fact as unknown as Record<string, unknown>,
      nodeSet: uniqueStrings([
        `fact-kind:${fact.factKind}`,
        `fact-id:${slugifyMemoryKey(fact.factId)}`,
        `fact-status:${fact.status}`,
        fact.episodeNumber != null ? `episode:${fact.episodeNumber}` : undefined,
        fact.sceneId ? `scene:${fact.sceneId}` : undefined,
        ...(fact.characterIds || []).map((id) => `character:${slugifyMemoryKey(id)}`),
        ...(fact.locationIds || []).map((id) => `location:${slugifyMemoryKey(id)}`),
        ...fact.artifactRefs.flatMap((ref) => [
          `artifact:${ref.artifactKind}`,
          `artifact-kind:${ref.artifactKind}`,
          `artifact-id:${slugifyMemoryKey(ref.artifactId)}`,
        ]),
        ...(fact.validatorRefs || []).map((ref) => `validator:${ref.validator}`),
      ]),
      cognify: false,
    });
  }

  async cognifyDatasets(datasets: string[], options: { background?: boolean } = { background: true }): Promise<void> {
    const config = this.config;
    if (!config?.enabled || config.cognifyEnabled === false) return;
    const uniqueDatasets = uniqueStrings(datasets);
    if (!uniqueDatasets.length) return;
    await this.bestEffort('cognify datasets', async () => {
      const provider = this.getProvider();
      if (provider.cognify) await provider.cognify(uniqueDatasets, options);
    }, undefined);
  }

  async writeGenerationMemory(opts: {
    success: boolean;
    qaScore?: number;
    qaPassed?: boolean;
    bestPracticesScore?: number;
    duration: number;
    artStyle?: string;
    failedAgents?: string[];
    timeoutAgents?: string[];
    error?: string;
    episodeTitle?: string;
    storyId?: string;
  }): Promise<void> {
    if (!this.config?.pipelineOptimization) return;
    const ts = new Date().toISOString();
    const lines = [
      `Result: ${opts.success ? 'SUCCESS' : 'FAILED'}`,
      opts.qaScore != null ? `QA Score: ${opts.qaScore}/100 (${opts.qaPassed ? 'passed' : 'needs revision'})` : null,
      opts.bestPracticesScore != null ? `Best Practices Score: ${opts.bestPracticesScore}/100` : null,
      `Duration: ${Math.round(opts.duration / 1000)}s`,
      opts.artStyle ? `Art Style: ${opts.artStyle}` : null,
      opts.failedAgents?.length ? `Failed Agents: ${opts.failedAgents.join(', ')}` : null,
      opts.timeoutAgents?.length ? `Timeout Agents: ${opts.timeoutAgents.join(', ')}` : null,
      opts.error ? `Error: ${opts.error.substring(0, 400)}` : null,
    ].filter(Boolean).join('\n');
    await this.writeRecord({
      kind: 'generation',
      dataset: this.runDataset(opts.storyId || opts.episodeTitle),
      title: `${ts} - ${opts.episodeTitle || 'Generation'}`,
      text: lines,
      metadata: opts as unknown as Record<string, unknown>,
      nodeSet: ['generation', opts.success ? 'success' : 'failure'],
    });
  }

  async writeQALearnings(qaReport: {
    continuity?: { issues: Array<{ description: string; severity: string; suggestedFix?: string }> };
    voice?: { characterScores: Array<{ characterName: string; score: number; weaknesses: string[] }>; recommendations: string[] };
    stakes?: { choiceSetAnalysis: Array<{ stakesScore: number; analysis: string; improvements: string[] }> };
    overallScore: number;
    criticalIssues: string[];
  }, episodeTitle?: string): Promise<void> {
    if (!this.config?.pipelineOptimization) return;
    const lines: string[] = [`QA score: ${qaReport.overallScore}/100`];
    const weakVoices = qaReport.voice?.characterScores?.filter((c) => c.score < 70 && c.weaknesses.length > 0) ?? [];
    if (weakVoices.length > 0) lines.push(`Weak voices: ${weakVoices.map((v) => `${v.characterName} (${v.score})`).join(', ')}`);
    const continuityErrors = qaReport.continuity?.issues?.filter((i) => i.severity === 'error') ?? [];
    if (continuityErrors.length > 0) lines.push(`Continuity errors:\n${continuityErrors.slice(0, 5).map((e) => `- ${e.description}${e.suggestedFix ? ` -> ${e.suggestedFix}` : ''}`).join('\n')}`);
    const weakStakes = qaReport.stakes?.choiceSetAnalysis?.filter((cs) => cs.stakesScore < 50) ?? [];
    if (weakStakes.length > 0) lines.push(`Weak stakes:\n${weakStakes.slice(0, 3).map((s) => `- ${s.stakesScore}: ${s.analysis.substring(0, 160)}`).join('\n')}`);
    if (qaReport.criticalIssues.length > 0) lines.push(`Critical issues:\n${qaReport.criticalIssues.slice(0, 5).map((i) => `- ${i}`).join('\n')}`);
    if (lines.length <= 1) return;
    await this.writeRecord({
      kind: 'qa-learning',
      dataset: this.runDataset(episodeTitle),
      title: `${episodeTitle || 'Generation'} QA learnings`,
      text: lines.join('\n\n'),
      metadata: { episodeTitle, overallScore: qaReport.overallScore, criticalIssueCount: qaReport.criticalIssues.length },
      nodeSet: ['qa', 'validator-history'],
    });
  }

  async writeCharacterMemory(opts: {
    characterName: string;
    characterId: string;
    visionAnalysisSucceeded: boolean;
    physicalTraits: Record<string, any>;
    hadUserReferenceImages: boolean;
    userRefCount: number;
    generationSucceeded: boolean;
    artStyle?: string;
  }): Promise<void> {
    if (!this.config?.characterKnowledge) return;
    const traitLines = Object.entries(opts.physicalTraits)
      .filter(([_, value]) => value != null)
      .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\n');
    await this.writeRecord({
      kind: 'character',
      dataset: `storyrpg-character-${slugifyMemoryKey(opts.characterName || opts.characterId)}`,
      title: `Character Knowledge: ${opts.characterName}`,
      text: [
        `Character: ${opts.characterName} (${opts.characterId})`,
        `User reference images: ${opts.hadUserReferenceImages ? `yes (${opts.userRefCount})` : 'none'}`,
        `Vision analysis: ${opts.visionAnalysisSucceeded ? 'succeeded' : 'FAILED'}`,
        `Generation: ${opts.generationSucceeded ? 'succeeded' : 'failed'}`,
        opts.artStyle ? `Art style: ${opts.artStyle}` : null,
        `Physical traits:\n${traitLines || '(none)'}`,
      ].filter(Boolean).join('\n'),
      metadata: { ...opts, characterName: opts.characterName },
      nodeSet: ['character', slugifyMemoryKey(opts.characterName)],
    });
  }

  async readCharacterMemory(characterName: string): Promise<string | null> {
    if (!this.config?.enabled || !this.config.characterKnowledge) return null;
    return this.bestEffort('read character memory', () => this.getProvider().readCharacterMemory(characterName), null);
  }

  async writeValidatorMemory(opts: {
    validator: string;
    lifecycle?: string;
    stage?: string;
    severity?: string;
    outcome?: string;
    storyId?: string;
    artifactIds?: string[];
    repairRoute?: string;
    findings?: unknown;
  }): Promise<void> {
    await this.writeRecord({
      kind: 'validator',
      dataset: this.defaults.validatorDataset,
      title: `${opts.validator} ${opts.outcome || 'validation'}${opts.stage ? ` (${opts.stage})` : ''}`,
      text: [
        `Validator: ${opts.validator}`,
        opts.lifecycle ? `Lifecycle: ${opts.lifecycle}` : null,
        opts.stage ? `Stage: ${opts.stage}` : null,
        opts.severity ? `Severity: ${opts.severity}` : null,
        opts.outcome ? `Outcome: ${opts.outcome}` : null,
        opts.repairRoute ? `Repair route: ${opts.repairRoute}` : null,
        opts.artifactIds?.length ? `Artifacts: ${opts.artifactIds.join(', ')}` : null,
        `Findings:\n${compactJson(opts.findings ?? {}, 8000)}`,
      ].filter(Boolean).join('\n'),
      metadata: opts as unknown as Record<string, unknown>,
      nodeSet: ['validator', slugifyMemoryKey(opts.validator), opts.lifecycle || 'validation'].filter(Boolean),
    });
  }
}
