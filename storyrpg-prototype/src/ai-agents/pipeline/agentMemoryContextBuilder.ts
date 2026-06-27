import {
  PipelineMemory,
  type AgentMemoryContext,
  type AgentMemoryRequest,
  type PipelineMemoryOutcomeRecord,
} from './pipelineMemory';

export class AgentMemoryContextBuilder {
  private readonly cache = new Map<string, Promise<AgentMemoryContext>>();

  constructor(private readonly memory: PipelineMemory) {}

  async recall(request: AgentMemoryRequest): Promise<AgentMemoryContext> {
    const key = this.cacheKey(request);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.memory.recallForAgent(request);
    this.cache.set(key, pending);
    return pending;
  }

  async renderedPromptBlock(request: AgentMemoryRequest): Promise<string | null> {
    const context = await this.recall(request);
    return context.renderedPromptBlock;
  }

  async writeOutcome(record: PipelineMemoryOutcomeRecord): Promise<void> {
    await this.memory.writeAgentOutcome(record);
  }

  clear(): void {
    this.cache.clear();
  }

  private cacheKey(request: AgentMemoryRequest): string {
    return JSON.stringify({
      runId: request.storyId || '',
      phase: request.lifecycle,
      agentRole: request.agentRole,
      episodeNumber: request.episodeNumber ?? null,
      sceneId: request.sceneId || '',
      characters: [...(request.characterIds || [])].sort(),
      artifacts: [...(request.artifactIds || [])].sort(),
      validators: [...(request.validatorNames || [])].sort(),
      queries: request.queries || [],
      datasets: request.datasets || [],
      nodeNames: request.nodeNames || [],
      topK: request.topK ?? null,
    });
  }
}
