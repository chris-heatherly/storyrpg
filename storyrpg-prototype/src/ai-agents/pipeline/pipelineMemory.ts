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
  topK?: number;
  maxPromptChars?: number;
}

export interface MemoryProvider {
  readonly name: PipelineMemoryProviderName;
  remember(record: PipelineMemoryRecord): Promise<void>;
  recall(request: PipelineMemoryRecallRequest): Promise<PipelineMemoryPacket | null>;
  readCharacterMemory(characterName: string): Promise<string | null>;
}

export interface PipelineMemoryDeps {
  config: PipelineConfig;
}

const DEFAULT_PROJECT_DATASET = 'storyrpg-project';
const DEFAULT_RUN_DATASET_PREFIX = 'storyrpg-run';
const DEFAULT_VALIDATOR_DATASET = 'storyrpg-validator-history';
const DEFAULT_MAX_PROMPT_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOP_K = 6;

function compactJson(value: unknown, maxChars = 12_000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... [truncated]` : text;
  } catch {
    return String(value);
  }
}

function slugifyMemoryKey(value: string): string {
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
      const cognifyResponse = await fetchWithTimeout(this.endpoint('cognify'), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ datasets: [dataset], runInBackground: true }),
      }, this.timeoutMs());
      if (!cognifyResponse.ok) {
        throw new Error(`Cognee cognify failed: ${cognifyResponse.status} ${await cognifyResponse.text()}`);
      }
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
    const packet = emptyPacket();
    packet.datasetNames = datasets;

    for (const query of queries) {
      const response = await fetchWithTimeout(this.endpoint('search'), {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          searchType: 'GRAPH_COMPLETION',
          query,
          datasets,
          topK,
          onlyContext: true,
        }),
      }, this.timeoutMs());
      if (!response.ok) {
        throw new Error(`Cognee search failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json();
      const snippets = normalizeSearchResults(payload);
      packet.queryLog.push({ query, searchType: 'GRAPH_COMPLETION', topK, resultCount: snippets.length });
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

  async readPipelineMemory(): Promise<string | null> {
    const packet = await this.recallPacket();
    return renderPipelineMemoryPacket(packet, this.defaults.maxPromptChars);
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
