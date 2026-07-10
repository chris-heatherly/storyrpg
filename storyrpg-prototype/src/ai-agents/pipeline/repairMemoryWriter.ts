import { PipelineMemory, slugifyMemoryKey } from './pipelineMemory';

export interface RepairLearningInput {
  validator: string;
  lifecycle: string;
  storyId: string;
  episodeNumber?: number;
  sceneId?: string;
  repairRoute: string;
  issueSummary: string;
  outcome: 'succeeded' | 'degraded' | 'failed';
  artifactIds?: string[];
}

export async function writeRepairLearning(
  memory: PipelineMemory,
  input: RepairLearningInput,
): Promise<void> {
  if (process.env.STORYRPG_MEMORY_REPAIR_LEARNING === '0') return;
  await memory.writeRecord({
    kind: 'fact',
    dataset: `storyrpg-run-${slugifyMemoryKey(input.storyId)}`,
    title: `repair-learning:${input.validator}:${input.repairRoute}`,
    text: [
      `Validator: ${input.validator}`,
      `Lifecycle: ${input.lifecycle}`,
      `Repair route: ${input.repairRoute}`,
      `Outcome: ${input.outcome}`,
      input.episodeNumber != null ? `Episode: ${input.episodeNumber}` : null,
      input.sceneId ? `Scene: ${input.sceneId}` : null,
      `Issue: ${input.issueSummary}`,
      input.artifactIds?.length ? `Artifacts: ${input.artifactIds.join(', ')}` : null,
    ].filter(Boolean).join('\n'),
    metadata: input as unknown as Record<string, unknown>,
    nodeSet: [
      'repair-learning',
      `validator:${input.validator}`,
      `repair-route:${input.repairRoute}`,
      input.episodeNumber != null ? `episode:${input.episodeNumber}` : undefined,
      input.sceneId ? `scene:${input.sceneId}` : undefined,
    ].filter((node): node is string => Boolean(node)),
    cognify: false,
  });
}
