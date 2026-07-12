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
