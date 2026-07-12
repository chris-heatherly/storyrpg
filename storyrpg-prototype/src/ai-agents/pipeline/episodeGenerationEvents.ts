import type { PipelineEvent } from './events';

export interface EpisodeGenerationResult {
  episodeNumber: number;
  title: string;
  success: boolean;
  error?: string;
}

type EmitPipelineEvent = (event: Omit<PipelineEvent, 'timestamp'>) => void;

export function emitEpisodeGenerationStart(
  emit: EmitPipelineEvent,
  episodeNumber: number,
  title: string,
): void {
  emit({
    type: 'phase_start',
    phase: `episode_${episodeNumber}`,
    message: `Generating Episode ${episodeNumber}: ${title}`,
  });
}

export function handleEpisodeGenerationFailure(input: {
  error: unknown;
  episodeNumber: number;
  title: string;
  strict: boolean;
  results: EpisodeGenerationResult[];
  emit: EmitPipelineEvent;
}): null {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  input.results.push({ episodeNumber: input.episodeNumber, title: input.title, success: false, error: message });
  input.emit({
    type: 'error',
    phase: `episode_${input.episodeNumber}`,
    message: `Episode ${input.episodeNumber} failed: ${message}`,
    data: { episodeNumber: input.episodeNumber, error: message },
  });
  if (input.strict) throw input.error;
  return null;
}

/**
 * Publish a sequential episode into run-level collections only after its
 * incremental contract/canon lock succeeds. A lock failure is handled by the
 * caller as the episode's sole failed result; publishing first would leave a
 * success and failure record for the same episode and make partial content
 * visible to final assembly.
 */
export async function commitEpisodeGenerationAfterLock<TEpisode, TArtifact, TQA, TBP>(input: {
  episode?: TEpisode;
  result: EpisodeGenerationResult;
  artifact?: TArtifact;
  qaReport?: TQA;
  bestPracticesReport?: TBP;
  lockEpisode: () => Promise<void>;
  episodes: TEpisode[];
  results: EpisodeGenerationResult[];
  artifacts: TArtifact[];
  qaReports: TQA[];
  bestPracticesReports: TBP[];
}): Promise<void> {
  if (input.episode) await input.lockEpisode();
  if (input.episode) input.episodes.push(input.episode);
  if (input.artifact) input.artifacts.push(input.artifact);
  input.results.push(input.result);
  if (input.qaReport) input.qaReports.push(input.qaReport);
  if (input.bestPracticesReport) input.bestPracticesReports.push(input.bestPracticesReport);
}
