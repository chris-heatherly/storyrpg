import { describe, expect, it, vi } from 'vitest';

import { ArtifactContextResolver } from './artifactContextResolver';
import { ArtifactMemoryService } from './artifactMemoryService';
import type { PipelineMemory } from './pipelineMemory';

describe('ArtifactContextResolver', () => {
  it('uses exact/live context first, then a narrowly scoped semantic fallback', async () => {
    const recallPacket = vi.fn().mockResolvedValue({
      summary: 'ok',
      sourceSnippets: ['Artifact source-analysis hash abc123 contains the requested treatment obligation.'],
      authority: 'advisory',
      source: 'cognee',
      datasetNames: ['storyrpg-run-bite-me'],
      queryLog: [{
        query: 'artifact query',
        searchType: 'GRAPH_COMPLETION',
        topK: 6,
        resultCount: 1,
        datasets: ['storyrpg-run-bite-me'],
        nodeNames: ['artifact:source-analysis'],
      }],
      warnings: [],
    });
    const memory = { recallPacket, writeArtifactSnapshot: vi.fn(async () => undefined) } as unknown as PipelineMemory;
    const resolver = new ArtifactContextResolver({
      memory,
      artifactMemory: new ArtifactMemoryService(memory),
    });

    const pack = await resolver.resolveForAgent({
      agentRole: 'StoryArchitect',
      lifecycle: 'episode-architecture',
      storyId: 'Bite Me',
      episodeNumber: 1,
      artifactKinds: ['source-analysis', 'season-plan'],
    });

    expect(recallPacket).toHaveBeenCalledTimes(1);
    expect(recallPacket).toHaveBeenNthCalledWith(1, expect.objectContaining({
      datasets: expect.arrayContaining(['storyrpg-project', 'storyrpg-run-bite-me']),
      nodeNames: expect.arrayContaining(['artifact:source-analysis', 'artifact:season-plan', 'episode:1']),
      recallMode: 'facts-first',
      topK: 6,
    }));
    expect(pack.renderedPromptBlock).toContain('Retrieved Story Context');
    expect(pack.tokenEstimate).toBeGreaterThan(0);
  });

  it('resolves exact artifacts from the live registry before disk fallback', async () => {
    const memory = { recallPacket: vi.fn(), writeArtifactSnapshot: vi.fn(async () => undefined) } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const resolver = new ArtifactContextResolver({
      memory,
      artifactMemory,
      loadArtifactFromDisk: vi.fn(async () => ({ fromDisk: true })),
    });
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'world-bible',
      storyId: 'Bite Me',
      lifecycle: 'world-building',
      agentRole: 'WorldBuilder',
      payload: { worldRules: ['Rule'] },
    });

    await expect(resolver.resolveExactArtifact({
      artifactId: envelope.artifactId,
      artifactKind: 'world-bible',
      contentHash: envelope.contentHash,
    })).resolves.toEqual({ worldRules: ['Rule'] });
  });
});
