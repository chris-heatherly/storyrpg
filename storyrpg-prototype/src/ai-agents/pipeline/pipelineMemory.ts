/**
 * Pipeline memory facade.
 *
 * Cognee is the preferred generator-side memory provider when configured. The
 * local file provider remains as a fail-open fallback and migration source.
 * Memory is advisory prompt context only; validators and typed artifacts remain
 * authoritative.
 */

import { PipelineConfig, type MemoryConfig } from '../config';
import { getMemoryStore, NodeMemoryStore, type MemoryStore } from '../utils/memoryStore';

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
  artifactIds?: string[];
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
  artifactIds?: string[];
  validatorNames?: string[];
  evidenceMode?: ValidatorEvidenceMode;
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
}

export interface PipelineMemoryOutcomeRecord {
  role?: AgentMemoryRole;
  validator?: string;
  lifecycle?: string;
  storyId?: string;
  episodeNumber?: number;
  sceneId?: string;
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

function defaultAgentQueries(request: AgentMemoryRequest): string[] {
  const scope = [
    request.storyId ? `story ${request.storyId}` : null,
    request.episodeNumber != null ? `episode ${request.episodeNumber}` : null,
    request.sceneId ? `scene ${request.sceneId}` : null,
    request.characterIds?.length ? `characters ${request.characterIds.join(', ')}` : null,
    request.artifactIds?.length ? `artifacts ${request.artifactIds.join(', ')}` : null,
  ].filter(Boolean).join(', ');
  const base = scope ? `${request.agentRole} ${request.lifecycle} for ${scope}` : `${request.agentRole} ${request.lifecycle}`;
  const byRole: Partial<Record<AgentMemoryRole, string[]>> = {
    SourceMaterialAnalyzer: [
      `${base}: treatment-fidelity rules, source quote obligations, prior source-analysis failures`,
    ],
    WorldBuilder: [
      `${base}: worldbuilding rules, source constraints, location continuity failures`,
    ],
    CharacterDesigner: [
      `${base}: character facts, reference-image consistency, voice and relationship depth findings`,
    ],
    StoryArchitect: [
      `${base}: Story Circle structure rules, branch topology failures, plan-time fidelity findings`,
    ],
    BranchManager: [
      `${base}: branch fanout, reconvergence, bottleneck, skipped setup, branch-target failures`,
    ],
    SceneWriter: [
      `${base}: scene-local canon, prior residue, callback obligations, continuity failures, prose repair lessons`,
    ],
    ChoiceAuthor: [
      `${base}: choice impact, consequence budget, callback debt, branch target, witness-id findings`,
    ],
    EncounterArchitect: [
      `${base}: encounter anchors, outcome variants, POV prose integrity, encounter QA history`,
    ],
    ThreadPlanner: [
      `${base}: setup payoff ledgers, callback debts, thread pacing lessons`,
    ],
    TwistArchitect: [
      `${base}: foreshadowing, reversal timing, reveal integrity, twist quality failures`,
    ],
    CharacterArcTracker: [
      `${base}: identity deltas, relationship milestones, arc target failures`,
    ],
    ImageAgentTeam: [
      `${base}: style bible, character appearance, pose diversity, provider failure memories`,
    ],
    AudioGenerationService: [
      `${base}: voice casting, narration style, audio provider failure memories`,
    ],
    VideoDirectorAgent: [
      `${base}: visual continuity, camera direction, video provider failure memories`,
    ],
    QARunner: [
      `${base}: validation failures, successful repairs, recurring quality issues`,
    ],
    FinalContract: [
      `${base}: final contract failures, repair routes, regression notes`,
    ],
  };
  return byRole[request.agentRole] || [`${base}: relevant StoryRPG generation memory`];
}

function defaultValidatorQueries(request: ValidatorEvidenceRequest): string[] {
  const scope = [
    request.storyId ? `story ${request.storyId}` : null,
    request.episodeNumber != null ? `episode ${request.episodeNumber}` : null,
    request.artifactIds?.length ? `artifacts ${request.artifactIds.join(', ')}` : null,
  ].filter(Boolean).join(', ');
  return [
    `${request.validator} ${request.lifecycle}${scope ? ` for ${scope}` : ''}: prior failures, related findings, repair routes, source obligations, regression notes`,
  ];
}

function agentNodeNames(request: AgentMemoryRequest): string[] {
  return uniqueStrings([
    `agent:${request.agentRole}`,
    request.lifecycle,
    request.episodeNumber != null ? `episode:${request.episodeNumber}` : undefined,
    request.sceneId ? `scene:${request.sceneId}` : undefined,
    ...(request.characterIds || []).map((id) => `character:${slugifyMemoryKey(id)}`),
    ...(request.artifactIds || []).map((id) => `artifact:${slugifyMemoryKey(id)}`),
    ...(request.nodeNames || []),
  ]);
}

function validatorNodeNames(request: ValidatorEvidenceRequest): string[] {
  return uniqueStrings([
    `validator:${request.validator}`,
    request.lifecycle,
    request.episodeNumber != null ? `episode:${request.episodeNumber}` : undefined,
    ...(request.validatorNames || []).map((name) => `validator:${name}`),
    ...(request.artifactIds || []).map((id) => `artifact:${slugifyMemoryKey(id)}`),
    ...(request.nodeNames || []),
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
    const parts: string[] = [];
    for (const path of ['/memories/pipeline/generation-log.md', '/memories/pipeline/qa-learnings.md']) {
      const result = await store.execute({ command: 'view', path });
      if (!result.includes('does not exist')) parts.push(result);
    }
    if (parts.length === 0) return null;
    const maxChars = request.maxPromptChars || this.config?.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS;
    const text = parts.join('\n\n---\n\n');
    return {
      summary: 'Local file memory fallback.',
      sourceSnippets: [text.length > maxChars ? text.slice(0, maxChars) : text],
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

  constructor(private config: MemoryConfig) {}

  private get baseUrl(): string {
    return (this.config.baseUrl || '').replace(/\/+$/, '');
  }

  private headers(json = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
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
    const dataset = record.dataset || this.config.projectDataset || DEFAULT_PROJECT_DATASET;
    const body = new FormData();
    body.append('data', this.formatRecord(record));
    body.append('datasetName', dataset);
    if (record.nodeSet?.length) {
      for (const node of record.nodeSet) body.append('node_set', node);
    }
    body.append('run_in_background', 'false');

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
    const defaults = memoryDefaults(this.config);
    const datasets = request.datasets?.length ? request.datasets : [defaults.projectDataset, defaults.validatorDataset];
    const queries = request.queries?.length ? request.queries : [
      'StoryRPG pipeline lessons, validation failures, source fidelity rules, character continuity, branching consequences',
    ];
    const topK = request.topK || DEFAULT_TOP_K;
    const maxPromptChars = request.maxPromptChars || defaults.maxPromptChars;
    const searchType = request.searchType || 'GRAPH_COMPLETION';
    const nodeNames = request.nodeNames || [];
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
      this.provider = new CogneeHttpMemoryProvider(this.config!);
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
    const queries = request.queries?.length ? request.queries : defaultAgentQueries(request);
    const packet = await this.recallPacket({
      queries,
      datasets,
      nodeNames,
      topK: request.topK || DEFAULT_TOP_K,
      maxPromptChars,
    });
    const retrievals = packet ? [packet] : [];
    const warnings = uniqueStrings([
      ...retrievals.flatMap((p) => p.warnings),
      !packet ? 'Memory recall unavailable; proceeding with deterministic artifacts only.' : undefined,
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
    const queries = request.queries?.length ? request.queries : defaultValidatorQueries(request);
    const packet = await this.recallPacket({
      queries,
      datasets,
      nodeNames,
      topK: request.topK || DEFAULT_TOP_K,
      maxPromptChars: request.maxPromptChars || this.defaults.maxPromptChars,
    });
    const snippets = uniqueStrings(packet?.sourceSnippets || []).map(summarizeValidatorSnippet);
    const priorFailures = snippets.filter((snippet) => /\b(fail(?:ed|ure)?|blocking|regression|error|repair)\b/i.test(snippet));
    const relatedFindings = snippets.filter((snippet) => /\b(finding|validator|warning|issue|gate)\b/i.test(snippet));
    const retrievalWarnings = uniqueStrings([
      ...(packet?.warnings || []),
      request.evidenceMode === 'corroborated-evidence' || request.evidenceMode === 'artifact-required'
        ? 'Cognee evidence must be corroborated against current typed artifacts before deterministic use.'
        : 'Cognee snippets are advisory memory only and do not change validator pass/fail decisions.',
      !packet ? 'Memory evidence unavailable; validator must use current artifacts only.' : undefined,
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
      provenance: packet ? packetProvenance(packet, nodeNames) : [],
      retrievalWarnings,
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
