import type { Episode } from '../../../types';
import { slugify as idSlugify } from '../../utils/idUtils';
import type { PipelineContext, PipelinePhase } from './index';
import {
  type ArtifactLoader,
  type ArtifactSaver,
  type EpisodeCompletionWatermark,
  type EpisodeShadowArtifactOptions,
  writeEpisodeCompletion,
} from '../episodeCheckpoints';

export interface RunArtifactPhaseDeps {
  createOutputDirectory: (storyTitle: string) => Promise<string>;
  ensureDirectory: (outputDirectory: string) => Promise<void>;
  save: (outputDirectory: string, name: string, data: unknown) => Promise<void>;
  load: <T>(outputDirectory: string, name: string) => T | null;
}

export interface RunArtifactPhaseInput {
  storyTitle: string;
  resumeOutputDirectory?: string;
}

export interface RunArtifactRuntime {
  outputDirectory: string;
  storyId: string;
  runId: string;
  save: ArtifactSaver;
  load: ArtifactLoader;
  shadowArtifactsFor: (episodeNumber: number) => EpisodeShadowArtifactOptions;
  writeEpisodeCompletion: (options: {
    episode: Episode;
    episodeNumber: number;
    title: string;
  }) => Promise<EpisodeCompletionWatermark>;
}

export class RunArtifactPhase implements PipelinePhase<RunArtifactPhaseInput, RunArtifactRuntime> {
  readonly name = 'RunArtifactPhase';

  constructor(private readonly deps: RunArtifactPhaseDeps) {}

  async run(input: RunArtifactPhaseInput, context: PipelineContext): Promise<RunArtifactRuntime> {
    const outputDirectory = input.resumeOutputDirectory
      ? input.resumeOutputDirectory
      : await this.deps.createOutputDirectory(input.storyTitle);

    if (input.resumeOutputDirectory) {
      await this.deps.ensureDirectory(outputDirectory);
      console.log(`[Pipeline] Resumed output directory: ${outputDirectory}`);
    }

    context.addCheckpoint('Output Directory', { outputDirectory }, false);

    const storyId = idSlugify(input.storyTitle) || 'story';
    const runId = deriveRunId(outputDirectory, storyId);
    const save: ArtifactSaver = (name, data) => this.deps.save(outputDirectory, name, data);
    const load: ArtifactLoader = <T,>(name: string) => this.deps.load<T>(outputDirectory, name);

    const runtime: RunArtifactRuntime = {
      outputDirectory,
      storyId,
      runId,
      save,
      load,
      shadowArtifactsFor: (episodeNumber) => ({
        storyId,
        runId,
        load,
        onError: (error) => context.emit({
          type: 'warning',
          phase: `episode_${episodeNumber}_artifacts`,
          message: `Shadow artifact write failed for Episode ${episodeNumber}: ${error.message}`,
        }),
      }),
      writeEpisodeCompletion: (options) => writeEpisodeCompletion({
        ...options,
        save,
        shadowArtifacts: runtime.shadowArtifactsFor(options.episodeNumber),
      }),
    };

    return runtime;
  }
}

export function deriveRunId(outputDirectory: string, fallbackStoryId: string): string {
  return outputDirectory.replace(/\/+$/, '').split(/[\\/]/).pop() || fallbackStoryId;
}
