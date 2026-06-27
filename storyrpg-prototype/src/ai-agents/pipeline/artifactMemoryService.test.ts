import { describe, expect, it, vi } from 'vitest';

import { ArtifactMemoryService } from './artifactMemoryService';
import type { PipelineMemory } from './pipelineMemory';

describe('ArtifactMemoryService', () => {
  it('builds stable envelopes and writes artifact snapshots with retrieval nodes', async () => {
    const writeArtifactSnapshot = vi.fn(async () => undefined);
    const service = new ArtifactMemoryService({ writeArtifactSnapshot } as unknown as PipelineMemory);

    const envelope = await service.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Bite Me',
      episodeNumber: 2,
      sceneId: 'scene-4',
      characterIds: ['mara-voss'],
      lifecycle: 'scene-authoring',
      agentRole: 'SceneWriter',
      payload: { sceneId: 'scene-4', sceneName: 'The Alley', beats: [{ id: 'beat-1' }] },
    });

    expect(envelope.artifactId).toContain('scene-content:ep-2:scene-scene-4');
    expect(envelope.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(writeArtifactSnapshot).toHaveBeenCalledTimes(1);
    expect(writeArtifactSnapshot.mock.calls[0][0]).toMatchObject({
      storyId: 'Bite Me',
      episodeNumber: 2,
      sceneId: 'scene-4',
      artifactIds: [envelope.artifactId, 'scene-content'],
    });
    expect(writeArtifactSnapshot.mock.calls[0][0].nodeSet).toEqual(expect.arrayContaining([
      'artifact:scene-content',
      'episode:2',
      'scene:scene-4',
      'agent:SceneWriter',
      'character:mara-voss',
    ]));
  });

  it('resolves registered exact live artifacts by hash', async () => {
    const service = new ArtifactMemoryService({ writeArtifactSnapshot: vi.fn(async () => undefined) } as unknown as PipelineMemory);
    const envelope = await service.writeArtifact({
      artifactKind: 'choice-set',
      storyId: 'Bite Me',
      lifecycle: 'choice-authoring',
      agentRole: 'ChoiceAuthor',
      payload: { beatId: 'beat-1', choices: [] },
    });

    expect(service.resolveLiveArtifact({ artifactId: envelope.artifactId, artifactKind: 'choice-set', contentHash: envelope.contentHash })?.payload)
      .toEqual({ beatId: 'beat-1', choices: [] });
    expect(service.resolveLiveArtifact({ artifactId: envelope.artifactId, artifactKind: 'choice-set', contentHash: 'wrong' }))
      .toBeNull();
  });
});
