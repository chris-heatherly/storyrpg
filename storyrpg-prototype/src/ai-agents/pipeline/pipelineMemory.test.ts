import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  CogneeHttpMemoryProvider,
  PipelineMemory,
  renderPipelineMemoryPacket,
  resolveCogneeLlmTarget,
  type PipelineMemoryPacket,
} from './pipelineMemory';
import { memoryTelemetry } from './memoryTelemetry';
import { resolveMemoryConfig, type PipelineConfig } from '../config';

function makeConfig(overrides: Record<string, unknown> = {}): PipelineConfig {
  return {
    agents: { storyArchitect: { provider: 'anthropic' } },
    memory: {
      enabled: true,
      provider: 'cognee',
      baseUrl: 'http://localhost:8000',
      apiKey: 'test-key',
      projectDataset: 'storyrpg-project',
      runDatasetPrefix: 'storyrpg-run',
      validatorDataset: 'storyrpg-validator-history',
      recallEnabled: true,
      writeEnabled: true,
      cognifyEnabled: true,
      maxPromptChars: 2000,
      timeoutMs: 1000,
      failOpen: true,
      pipelineOptimization: true,
      characterKnowledge: true,
      ...overrides,
    },
  } as unknown as PipelineConfig;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  memoryTelemetry.reset();
});

function okResponse(payload: unknown = {}) {
  return { ok: true, text: async () => '', json: async () => payload };
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix));
}

describe('renderPipelineMemoryPacket', () => {
  it('renders bounded memory context for agent prompts', () => {
    const packet: PipelineMemoryPacket = {
      summary: 'Cognee recalled project context.',
      sourceSnippets: ['Validator findings are advisory memory only.', 'Use Story Circle contracts.'],
      datasetNames: ['storyrpg-project'],
      queryLog: [],
      warnings: ['Cognee returned partial context.'],
    };

    const rendered = renderPipelineMemoryPacket(packet, 120);

    expect(rendered).toContain('Summary:');
    expect(rendered).toContain('Relevant Memory:');
    expect(rendered).toContain('[memory truncated]');
    expect(rendered!.length).toBeLessThanOrEqual(143);
  });
});

describe('CogneeHttpMemoryProvider', () => {
  it('posts memory records without graph extraction during active writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(makeConfig().memory!);
    await provider.remember({
      kind: 'validator',
      dataset: 'storyrpg-validator-history',
      title: 'Final contract passed',
      text: 'No blocking issues.',
      nodeSet: ['validator'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/health');
    const [addCall] = callsTo(fetchMock, '/api/v1/add');
    expect(addCall[1]).toMatchObject({ method: 'POST' });
    expect(addCall[1].headers).toMatchObject({ 'X-Api-Key': 'test-key' });
    // /add requires `data` as an uploaded file, not a text field.
    const addBody = addCall[1].body as FormData;
    expect(addBody.get('data')).toBeInstanceOf(Blob);
    expect(addBody.get('run_in_background')).toBe('true');
    expect(callsTo(fetchMock, '/api/v1/cognify')).toHaveLength(0);
  });

  it('cognifies each dataset at most once per run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(makeConfig({ cognifyOnWrite: true }).memory!);
    await provider.remember({ kind: 'generation', dataset: 'storyrpg-run-x', title: 'A', text: 'a' });
    await provider.remember({ kind: 'generation', dataset: 'storyrpg-run-x', title: 'B', text: 'b' });
    await provider.cognify(['storyrpg-run-x', 'storyrpg-run-y']);

    expect(callsTo(fetchMock, '/api/v1/add')).toHaveLength(2);
    const cognifyCalls = callsTo(fetchMock, '/api/v1/cognify');
    expect(cognifyCalls).toHaveLength(2);
    expect(JSON.parse(cognifyCalls[0][1].body).datasets).toEqual(['storyrpg-run-x']);
    // Only the not-yet-cognified dataset is sent on the later call.
    expect(JSON.parse(cognifyCalls[1][1].body).datasets).toEqual(['storyrpg-run-y']);
  });

  it('disables the provider for the run when the health probe fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(makeConfig().memory!);
    await expect(provider.remember({ kind: 'generation', title: 'A', text: 'a' })).resolves.toBeUndefined();
    await expect(provider.recall({ queries: ['q'] })).resolves.toBeNull();
    await expect(provider.cognify(['storyrpg-project'])).resolves.toBeUndefined();

    // One probe total (cached), no add/search/cognify traffic, one log line.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8000/health');
    const healthWarns = warnSpy.mock.calls.filter(([msg]) => String(msg).includes('health probe failed'));
    expect(healthWarns).toHaveLength(1);
  });

  it('recalls onlyContext graph search into a packet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ([{ search_result: 'Prior failure: branch fan-out collapsed.' }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(makeConfig().memory!);
    const packet = await provider.recall({
      datasets: ['storyrpg-project'],
      queries: ['branching failures'],
      nodeNames: ['agent:StoryArchitect'],
      topK: 3,
    });

    const searchCalls = callsTo(fetchMock, '/api/v1/search');
    expect(searchCalls).toHaveLength(1);
    expect(JSON.parse(searchCalls[0][1].body)).toMatchObject({
      searchType: 'GRAPH_COMPLETION',
      datasets: ['storyrpg-project'],
      query: 'branching failures',
      topK: 3,
      onlyContext: true,
      // Agent/lifecycle labels are provenance, not Cognee record facets.
      // With no stable content facet, search remains semantic and unfiltered.
    });
    expect(packet?.sourceSnippets).toEqual(['Prior failure: branch fan-out collapsed.']);
    expect(packet?.queryLog[0]).toMatchObject({ query: 'branching failures', resultCount: 1 });
  });

  it('retries once without restrictive graph facets when a filtered Cognee search is empty', async () => {
    let searchCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/search')) {
        searchCount += 1;
        return okResponse(searchCount === 1 ? [] : [{ search_result: 'Indexed source obligation.' }]);
      }
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(makeConfig().memory!);
    const packet = await provider.recall({
      datasets: ['storyrpg-project'],
      queries: ['source obligations'],
      nodeNames: ['agent:StoryArchitect', 'episode-architecture', 'fact-kind:source-obligation'],
    });

    const searchCalls = callsTo(fetchMock, '/api/v1/search');
    expect(searchCalls).toHaveLength(2);
    expect(JSON.parse(searchCalls[0][1].body).nodeNames).toEqual(['fact-kind:source-obligation']);
    expect(JSON.parse(searchCalls[1][1].body).nodeNames).toBeUndefined();
    expect(packet?.sourceSnippets).toEqual(['Indexed source obligation.']);
    expect(packet?.queryLog[0]).toMatchObject({ fallbackUsed: true, resultCount: 1 });
  });
});

describe('PipelineMemory', () => {
  it('fails open when Cognee recall is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const memory = new PipelineMemory({ config: makeConfig() });

    await expect(memory.recallPacket()).resolves.toBeNull();
  });

  it('records failed memory operations instead of reporting them as empty successes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/health')) return okResponse();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const memory = new PipelineMemory({ config: makeConfig() });

    await memory.writeRecord({ kind: 'generation', title: 'failed write', text: 'x' });
    const summary = memoryTelemetry.getSummary();

    expect(summary.writeCount).toBe(1);
    expect(summary.writeFailureCount).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('opens the circuit breaker after 3 consecutive failures and short-circuits further calls', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Healthy server whose writes always time out — the 2026-07-04 abort storm.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/health')) return okResponse();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const memory = new PipelineMemory({ config: makeConfig() });

    for (let i = 0; i < 5; i += 1) {
      await memory.writeRecord({ kind: 'generation', title: `W${i}`, text: 'x' });
    }
    await expect(memory.recallPacket()).resolves.toBeNull();

    // Only the first 3 attempts reached the provider; breaker blocked the rest.
    expect(callsTo(fetchMock, '/api/v1/add')).toHaveLength(3);
    expect(callsTo(fetchMock, '/api/v1/search')).toHaveLength(0);
    const disableWarns = warnSpy.mock.calls.filter(([msg]) => String(msg).includes('disabled for the rest of this run'));
    expect(disableWarns).toHaveLength(1);
  });

  it('resets the breaker failure count on success', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let failNext = true;
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/health') || target.endsWith('/api/v1/cognify')) return okResponse();
      if (failNext) throw new DOMException('This operation was aborted', 'AbortError');
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const memory = new PipelineMemory({ config: makeConfig() });

    await memory.writeRecord({ kind: 'generation', title: 'A', text: 'x' });
    await memory.writeRecord({ kind: 'generation', title: 'B', text: 'x' });
    failNext = false;
    await memory.writeRecord({ kind: 'generation', title: 'C', text: 'x' });
    failNext = true;
    await memory.writeRecord({ kind: 'generation', title: 'D', text: 'x' });
    await memory.writeRecord({ kind: 'generation', title: 'E', text: 'x' });

    // 2 failures, success resets, 2 more failures — breaker never opens.
    expect(callsTo(fetchMock, '/api/v1/add')).toHaveLength(5);
    const disableWarns = warnSpy.mock.calls.filter(([msg]) => String(msg).includes('disabled for the rest of this run'));
    expect(disableWarns).toHaveLength(0);
  });

  it('uses local file memory as fallback provider', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-memory-'));
    const memory = new PipelineMemory({
      config: makeConfig({
        provider: 'file',
        directory: dir,
      }),
    });

    await memory.writeCharacterMemory({
      characterName: 'Avery Vale',
      characterId: 'avery',
      visionAnalysisSucceeded: true,
      physicalTraits: { hair: 'black bob', jacket: 'red' },
      hadUserReferenceImages: true,
      userRefCount: 2,
      generationSucceeded: true,
      artStyle: 'ink wash',
    });

    const character = await memory.readCharacterMemory('Avery Vale');
    expect(character).toContain('Character Knowledge: Avery Vale');
    expect(character).toContain('black bob');
  });

  it('builds scoped agent recall with role datasets, node names, and prompt policy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ([{ search_result: 'SceneWriter should preserve callback residue.' }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    const memory = new PipelineMemory({ config: makeConfig() });

    const context = await memory.recallForAgent({
      agentRole: 'SceneWriter',
      lifecycle: 'scene-authoring',
      storyId: 'Bite Me',
      episodeNumber: 3,
      sceneId: 'scene-2',
      characterIds: ['mara-voss'],
      artifactIds: ['episode-blueprint'],
    });

    const body = JSON.parse(callsTo(fetchMock, '/api/v1/search')[0][1].body);
    expect(body.datasets).toEqual(expect.arrayContaining([
      'storyrpg-project',
      'storyrpg-run-bite-me',
      'storyrpg-character-mara-voss',
      'storyrpg-validator-history',
      'storyrpg-agent-history',
    ]));
    expect(body.nodeNames).toEqual(expect.arrayContaining([
      'episode:3',
      'scene:scene-2',
      'character:mara-voss',
      'artifact:episode-blueprint',
    ]));
    expect(context.renderedPromptBlock).toContain('Retrieved Pipeline Memory');
    expect(context.renderedPromptBlock).toContain('Advisory context; do not contradict fixed canon.');
  });

  it('normalizes validator recall as advisory evidence with no uncorroborated facts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ([{ search_result: 'Blocking failure: treatment event was skipped; repair route was regen-scene.' }]),
    }));
    const memory = new PipelineMemory({ config: makeConfig() });

    const evidence = await memory.recallForValidator({
      validator: 'TreatmentFieldUtilizationValidator',
      lifecycle: 'final-contract',
      storyId: 'Bite Me',
      artifactIds: ['story-json'],
      evidenceMode: 'corroborated-evidence',
    });

    expect(evidence.facts).toEqual([]);
    expect(evidence.priorFailures).toHaveLength(1);
    expect(evidence.retrievalWarnings.join('\n')).toContain('corroborated against current typed artifacts');
  });
});

describe('resolveMemoryConfig', () => {
  it('enables memory with the file default when no provider env is set (anthropic default LLM)', () => {
    const config = resolveMemoryConfig({});
    expect(config.enabled).toBe(true);
    expect(config.provider).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
  });

  it('routes to Cognee when STORYRPG_MEMORY_PROVIDER + COGNEE_BASE_URL are present', () => {
    const config = resolveMemoryConfig({
      STORYRPG_MEMORY_PROVIDER: 'cognee',
      COGNEE_BASE_URL: 'http://cognee:8000',
      COGNEE_API_KEY: 'ck_test',
    });
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe('cognee');
    expect(config.baseUrl).toBe('http://cognee:8000');
    expect(config.apiKey).toBe('ck_test');
  });

  it('disables memory when explicitly turned off', () => {
    expect(resolveMemoryConfig({ STORYRPG_MEMORY_PROVIDER: 'disabled' }).enabled).toBe(false);
  });

  it('defaults the extraction LLM to mirror; STORYRPG_MEMORY_LLM_* pins a custom one', () => {
    expect(resolveMemoryConfig({}).llm).toEqual({ mode: 'mirror' });
    expect(resolveMemoryConfig({
      STORYRPG_MEMORY_LLM_PROVIDER: 'anthropic',
      STORYRPG_MEMORY_LLM_MODEL: 'claude-sonnet-4-6',
      STORYRPG_MEMORY_LLM_API_KEY: 'k',
    }).llm).toEqual({ mode: 'custom', provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' });
  });

  it('defaults to bounded recall concurrency and deferred cognify', () => {
    const config = resolveMemoryConfig({});
    expect(config.searchConcurrency).toBe(2);
    expect(config.cognifyOnWrite).toBe(false);
  });
});

describe('resolveCogneeLlmTarget', () => {
  const withAgents = (agents: Record<string, unknown>, memoryLlm?: unknown): PipelineConfig => ({
    ...makeConfig(memoryLlm ? { llm: memoryLlm } : {}),
    agents,
  } as unknown as PipelineConfig);

  it('mirrors the narrative model (SceneWriter) and applies the gemini/ litellm route prefix', () => {
    const target = resolveCogneeLlmTarget(withAgents({
      sceneWriter: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'gem-key' },
      storyArchitect: { provider: 'openai', model: 'gpt-4o', apiKey: 'oa-key' },
    }));
    expect(target).toEqual({ provider: 'gemini', model: 'gemini/gemini-2.5-pro', apiKey: 'gem-key' });
  });

  it('prefers an explicit custom memory.llm over the narrative model', () => {
    const target = resolveCogneeLlmTarget(withAgents(
      { sceneWriter: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'gem-key' } },
      { mode: 'custom', provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'ant-key' },
    ));
    expect(target).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'ant-key' });
  });

  it('returns null for providers Cognee does not support (openrouter)', () => {
    const target = resolveCogneeLlmTarget(withAgents({
      sceneWriter: { provider: 'openrouter', model: 'meta-llama/llama-3-70b', apiKey: 'or-key' },
    }));
    expect(target).toBeNull();
  });
});

describe('CogneeHttpMemoryProvider LLM settings sync', () => {
  it('POSTs the LLM target to /settings once, before the first memory operation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '', json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(
      makeConfig().memory!,
      { provider: 'gemini', model: 'gemini/gemini-2.5-flash', apiKey: 'gem-key' },
    );
    await provider.remember({ kind: 'generation', title: 'A', text: 'a' });
    await provider.remember({ kind: 'generation', title: 'B', text: 'b' });

    const settingsCalls = callsTo(fetchMock, '/api/v1/settings');
    expect(settingsCalls).toHaveLength(1);
    // Settings sync happens before the first add (health probe is call 0).
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8000/api/v1/settings');
    expect(JSON.parse(settingsCalls[0][1].body)).toEqual({
      llm: { provider: 'gemini', model: 'gemini/gemini-2.5-flash', apiKey: 'gem-key' },
    });
  });

  it('fails open: a settings sync error does not block memory writes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v1/settings')) throw new Error('settings down');
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CogneeHttpMemoryProvider(
      makeConfig().memory!,
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    );
    await expect(provider.remember({ kind: 'generation', title: 'A', text: 'a' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/add'))).toBe(true);
  });
});

describe('FileMemoryProvider recall (bucket round-trip)', () => {
  it('recalls the records that remember() actually wrote', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-mem-'));
    try {
      const config = makeConfig({ provider: 'file', baseUrl: undefined, directory: dir });
      const memory = new PipelineMemory({ config });

      await memory.writeRecord({
        kind: 'generation',
        title: 'Round Trip Log',
        text: 'branch fan-out collapsed at scene-3',
      });

      const packet = await memory.recallPacket();
      expect(packet).not.toBeNull();
      expect(packet!.sourceSnippets.join('\n')).toContain('branch fan-out collapsed at scene-3');
      expect(packet!.datasetNames).toContain('file:pipeline-memories');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
