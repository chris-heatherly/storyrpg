import { describe, expect, it, vi } from 'vitest';

import { ArtifactMemoryService } from './artifactMemoryService';
import { FactMemoryService } from './factMemoryService';
import { executeRecall } from './memoryRecallRouter';
import type { PipelineMemory } from './pipelineMemory';

describe('memoryRecallRouter', () => {
  it('exact-artifact-pointer resolves live artifacts without provider recall', async () => {
    const recall = vi.fn(async () => null);
    const memory = {
      writeArtifactSnapshot: async () => undefined,
      writeFactSnapshot: async () => undefined,
      cognifyDatasets: async () => undefined,
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'episode-blueprint',
      storyId: 'Story',
      episodeNumber: 1,
      lifecycle: 'episode-architecture',
      payload: { episodeId: 'ep-1', title: 'Pilot' },
    });

    const packet = await executeRecall({
      recallMode: 'exact-artifact-pointer',
      artifactIds: [envelope.artifactId],
      artifactKinds: ['episode-blueprint'],
    }, {
      provider: { name: 'cognee', remember: async () => undefined, recall, readCharacterMemory: async () => null },
      artifactMemory,
      defaultDatasets: ['storyrpg-project'],
      validatorDataset: 'storyrpg-validator-history',
      projectDataset: 'storyrpg-project',
    });

    expect(recall).not.toHaveBeenCalled();
    expect(packet?.sourceSnippets.length).toBeGreaterThan(0);
    expect(packet?.datasetNames).toContain('live-artifacts');
  });

  it('facts-first reads from the live fact store before Cognee', async () => {
    const recall = vi.fn(async () => null);
    const memory = {
      writeArtifactSnapshot: async () => undefined,
      writeFactSnapshot: async () => undefined,
      cognifyDatasets: async () => undefined,
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'choice-set',
      storyId: 'Story',
      episodeNumber: 1,
      lifecycle: 'choice-authoring',
      payload: {
        sceneId: 'scene-1',
        choices: [{ id: 'c1', text: 'Stay', consequences: [{ type: 'flag', name: 'stayed', value: true }] }],
      },
    });
    await factMemory.writeFactsForArtifact(envelope);

    const packet = await executeRecall({
      recallMode: 'facts-first',
      factKinds: ['choice-consequence'],
    }, {
      provider: { name: 'cognee', remember: async () => undefined, recall, readCharacterMemory: async () => null },
      artifactMemory,
      factMemory,
      defaultDatasets: ['storyrpg-project'],
      validatorDataset: 'storyrpg-validator-history',
      projectDataset: 'storyrpg-project',
    });

    expect(recall).not.toHaveBeenCalled();
    expect(packet?.sourceSnippets.some((snippet) => snippet.includes('choice-consequence'))).toBe(true);
  });
});
