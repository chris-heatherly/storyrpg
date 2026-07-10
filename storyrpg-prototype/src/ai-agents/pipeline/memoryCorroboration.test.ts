import { describe, expect, it } from 'vitest';

import { ArtifactMemoryService } from './artifactMemoryService';
import { corroborateFacts } from './memoryCorroboration';
import { FactMemoryService } from './factMemoryService';
import type { PipelineMemory } from './pipelineMemory';

describe('memoryCorroboration', () => {
  it('promotes facts whose artifact refs match live envelopes', async () => {
    const memory = {
      writeArtifactSnapshot: async () => undefined,
      writeFactSnapshot: async () => undefined,
      cognifyDatasets: async () => undefined,
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Story',
      episodeNumber: 1,
      sceneId: 'scene-1',
      lifecycle: 'scene-authoring',
      payload: { sceneId: 'scene-1', summary: 'Canon scene.' },
    });
    const [fact] = await factMemory.writeFactsForArtifact(envelope);

    const result = corroborateFacts(['advisory snippet'], [fact!], artifactMemory);
    expect(result.validatedFacts).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.candidateFacts).toHaveLength(0);
  });

  it('demotes facts when live artifact hash does not match', async () => {
    const memory = {
      writeArtifactSnapshot: async () => undefined,
      writeFactSnapshot: async () => undefined,
      cognifyDatasets: async () => undefined,
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Story',
      lifecycle: 'scene-authoring',
      payload: { sceneId: 'scene-1', summary: 'Current canon.' },
    });
    const staleFact = {
      factId: 'scene-canon:scene-1:abc',
      factKind: 'scene-canon' as const,
      statement: 'Old canon',
      storyId: 'Story',
      runId: 'story',
      status: 'validated' as const,
      confidence: 0.9,
      artifactRefs: [{
        artifactKind: 'scene-content' as const,
        artifactId: envelope.artifactId,
        contentHash: 'stale-hash',
      }],
      createdAt: new Date().toISOString(),
    };

    const result = corroborateFacts([], [staleFact], artifactMemory);
    expect(result.validatedFacts).toHaveLength(0);
    expect(result.candidateFacts).toHaveLength(1);
  });
});
