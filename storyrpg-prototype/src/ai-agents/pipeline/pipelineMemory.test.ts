import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  CogneeHttpMemoryProvider,
  PipelineMemory,
  renderPipelineMemoryPacket,
  type PipelineMemoryPacket,
} from './pipelineMemory';
import type { PipelineConfig } from '../config';

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
});

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
  it('posts add and cognify requests for memory records', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '', json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, text: async () => '', json: async () => ({}) });
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/add');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8000/api/v1/cognify');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      datasets: ['storyrpg-validator-history'],
      runInBackground: true,
    });
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      searchType: 'GRAPH_COMPLETION',
      datasets: ['storyrpg-project'],
      query: 'branching failures',
      topK: 3,
      onlyContext: true,
      nodeNames: ['agent:StoryArchitect'],
      nodeName: 'agent:StoryArchitect',
    });
    expect(packet?.sourceSnippets).toEqual(['Prior failure: branch fan-out collapsed.']);
    expect(packet?.queryLog[0]).toMatchObject({ query: 'branching failures', resultCount: 1 });
  });
});

describe('PipelineMemory', () => {
  it('fails open when Cognee recall is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const memory = new PipelineMemory({ config: makeConfig() });

    await expect(memory.recallPacket()).resolves.toBeNull();
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.datasets).toEqual(expect.arrayContaining([
      'storyrpg-project',
      'storyrpg-run-bite-me',
      'storyrpg-character-mara-voss',
      'storyrpg-validator-history',
      'storyrpg-agent-history',
    ]));
    expect(body.nodeNames).toEqual(expect.arrayContaining([
      'agent:SceneWriter',
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
