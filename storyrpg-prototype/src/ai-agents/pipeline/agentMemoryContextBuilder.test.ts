import { describe, expect, it, vi } from 'vitest';

import { AgentMemoryContextBuilder } from './agentMemoryContextBuilder';
import type { PipelineMemory } from './pipelineMemory';

describe('AgentMemoryContextBuilder', () => {
  it('caches retrieval by run, role, lifecycle, episode, and scene', async () => {
    const recallForAgent = vi.fn(async () => ({
      renderedPromptBlock: 'Retrieved Pipeline Memory\nAdvisory context; do not contradict fixed canon.',
      retrievals: [],
      datasetNames: ['storyrpg-project'],
      nodeNames: ['agent:SceneWriter'],
      warnings: [],
      provenance: [],
    }));
    const builder = new AgentMemoryContextBuilder({ recallForAgent } as unknown as PipelineMemory);

    const request = {
      agentRole: 'SceneWriter' as const,
      lifecycle: 'scene-authoring',
      storyId: 'Story',
      episodeNumber: 2,
      sceneId: 'scene-4',
    };
    const first = await builder.renderedPromptBlock(request);
    const second = await builder.renderedPromptBlock({ ...request });

    expect(first).toBe(second);
    expect(recallForAgent).toHaveBeenCalledTimes(1);
    expect(recallForAgent).toHaveBeenCalledWith(request);
  });

  it('keeps distinct roles in separate cache entries', async () => {
    const recallForAgent = vi.fn(async (request) => ({
      renderedPromptBlock: `memory:${request.agentRole}`,
      retrievals: [],
      datasetNames: [],
      nodeNames: [],
      warnings: [],
      provenance: [],
    }));
    const builder = new AgentMemoryContextBuilder({ recallForAgent } as unknown as PipelineMemory);

    await builder.renderedPromptBlock({ agentRole: 'SceneWriter', lifecycle: 'scene-authoring', storyId: 'Story' });
    await builder.renderedPromptBlock({ agentRole: 'ChoiceAuthor', lifecycle: 'choice-authoring', storyId: 'Story' });

    expect(recallForAgent).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cache entry when fact or artifact filters differ', async () => {
    const recallForAgent = vi.fn(async () => ({
      renderedPromptBlock: 'memory',
      retrievals: [],
      datasetNames: [],
      nodeNames: [],
      warnings: [],
      provenance: [],
    }));
    const builder = new AgentMemoryContextBuilder({ recallForAgent } as unknown as PipelineMemory);
    const base = { agentRole: 'SceneWriter' as const, lifecycle: 'scene-authoring', storyId: 'Story' };

    await builder.renderedPromptBlock({ ...base, factKinds: ['scene-canon'] });
    await builder.renderedPromptBlock({ ...base, factKinds: ['source-obligation'] });
    await builder.renderedPromptBlock({ ...base, artifactKinds: ['scene-content'] });

    expect(recallForAgent).toHaveBeenCalledTimes(3);
  });
});
