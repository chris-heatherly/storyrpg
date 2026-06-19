/**
 * Episode-granularity completion watermarks (Consistency Plan WS1a).
 *
 * After an episode fully assembles (content + season-canon seal), the pipeline
 * writes two artifacts into the run directory:
 *
 *   checkpoints/episode-{N}-complete.json   — small watermark (metadata only)
 *   checkpoints/episode-{N}-assembled.json  — the full assembled Episode
 *
 * A resumed run pointed at the same output directory probes these per requested
 * episode and rehydrates completed episodes instead of regenerating (and
 * re-paying for) them. A watermark without a loadable assembled artifact — or
 * with a mismatched episode number — is treated as not-complete, so a torn
 * write degrades to regeneration, never to a corrupt resume.
 */

import type { Episode } from '../../types';
import {
  ArtifactRevisionStore,
  type ArtifactRef,
  type ArtifactValidationSummary,
  type EpisodeContextIn,
  type EpisodeContextOut,
  buildEpisodeContextIn,
  deriveEpisodeContextOut,
  defaultValidationSummary,
} from './artifacts';

export interface EpisodeCompletionWatermark {
  version: 1;
  episodeNumber: number;
  title: string;
  completedAt: string;
  sceneCount: number;
  assembledArtifact: string;
}

export type ArtifactSaver = (name: string, data: unknown) => Promise<void>;
export type ArtifactLoader = <T>(name: string) => T | null;

export interface EpisodeShadowArtifactOptions {
  storyId: string;
  runId: string;
  load: ArtifactLoader;
  contextIn?: EpisodeContextIn;
  validation?: ArtifactValidationSummary;
  upstream?: ArtifactRef[];
  onError?: (error: Error) => void;
}

export function episodeCompleteArtifact(episodeNumber: number): string {
  return `checkpoints/episode-${episodeNumber}-complete.json`;
}

export function episodeAssembledArtifact(episodeNumber: number): string {
  return `checkpoints/episode-${episodeNumber}-assembled.json`;
}

/**
 * Persist the assembled episode then its watermark (in that order, so a crash
 * between the two writes leaves no watermark pointing at a missing artifact).
 */
export async function writeEpisodeCompletion(options: {
  episode: Episode;
  episodeNumber: number;
  title: string;
  save: ArtifactSaver;
  shadowArtifacts?: EpisodeShadowArtifactOptions;
}): Promise<EpisodeCompletionWatermark> {
  const { episode, episodeNumber, title, save, shadowArtifacts } = options;
  const assembledArtifact = episodeAssembledArtifact(episodeNumber);
  await save(assembledArtifact, episode);
  const watermark: EpisodeCompletionWatermark = {
    version: 1,
    episodeNumber,
    title,
    completedAt: new Date().toISOString(),
    sceneCount: Array.isArray(episode.scenes) ? episode.scenes.length : 0,
    assembledArtifact,
  };
  await save(episodeCompleteArtifact(episodeNumber), watermark);

  if (shadowArtifacts) {
    await writeEpisodeShadowArtifacts({
      episode,
      episodeNumber,
      title,
      save,
      ...shadowArtifacts,
    });
  }

  return watermark;
}

async function writeEpisodeShadowArtifacts(options: {
  episode: Episode;
  episodeNumber: number;
  title: string;
  save: ArtifactSaver;
} & EpisodeShadowArtifactOptions): Promise<void> {
  try {
    const store = new ArtifactRevisionStore({
      save: options.save,
      load: options.load,
    });
    const previousContextOut = options.episodeNumber > 1
      ? store.loadCurrent<EpisodeContextOut>('context-out', options.episodeNumber - 1)
      : null;
    const upstream = [
      ...(options.upstream ?? []),
      ...(previousContextOut ? [store.refFor(previousContextOut)] : []),
    ];
    const contextInPayload = options.contextIn ?? buildEpisodeContextIn({
      storyId: options.storyId,
      episodeNumber: options.episodeNumber,
      previousContextOut: previousContextOut?.payload,
    });
    const contextIn = await store.saveRevision({
      kind: 'context-in',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: contextInPayload,
      status: 'valid',
      upstream,
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'EpisodeContextBuilder' },
      validation: defaultValidationSummary('context-in'),
    });
    const contextInRef = store.refFor(contextIn);

    const runtimeEpisode = await store.saveRevision({
      kind: 'runtime-episode',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: options.episode,
      status: 'valid',
      upstream: [contextInRef],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'FullStoryPipeline' },
      validation: options.validation ?? defaultValidationSummary('runtime-episode'),
    });
    const runtimeRef = store.refFor(runtimeEpisode);

    const validationReport = await store.saveRevision({
      kind: 'validation-report',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: {
        title: options.title,
        episodeNumber: options.episodeNumber,
        runtimeEpisode: runtimeRef,
        validation: options.validation ?? defaultValidationSummary('runtime-episode'),
      },
      status: 'valid',
      upstream: [runtimeRef],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'ArtifactValidationGate' },
      validation: options.validation ?? defaultValidationSummary('validation-report'),
    });

    await store.saveRevision({
      kind: 'context-out',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: deriveEpisodeContextOut({
        storyId: options.storyId,
        episode: options.episode,
        contextIn: contextInPayload,
      }),
      status: 'valid',
      upstream: [runtimeRef, store.refFor(validationReport)],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'EpisodeContextBuilder' },
      validation: defaultValidationSummary('context-out'),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (options.onError) {
      options.onError(err);
    } else {
      console.warn(`[EpisodeArtifacts] Shadow artifact write failed for episode ${options.episodeNumber}: ${err.message}`);
    }
  }
}

export interface ResumedEpisode {
  episode: Episode;
  watermark: EpisodeCompletionWatermark;
}

/**
 * Probe one episode number for a valid completion watermark + assembled
 * episode. Returns null unless both load and agree on the episode number.
 */
export function loadCompletedEpisode(
  episodeNumber: number,
  load: ArtifactLoader,
): ResumedEpisode | null {
  const watermark = load<EpisodeCompletionWatermark>(episodeCompleteArtifact(episodeNumber));
  if (!watermark || watermark.version !== 1 || watermark.episodeNumber !== episodeNumber) return null;
  const episode = load<Episode>(watermark.assembledArtifact);
  if (!episode || typeof episode !== 'object') return null;
  if (typeof episode.number === 'number' && episode.number !== episodeNumber) return null;
  if (!Array.isArray(episode.scenes) || episode.scenes.length === 0) return null;
  return { episode, watermark };
}

/** Which of the requested episodes already completed in this run directory. */
export function detectCompletedEpisodes(
  episodeNumbers: number[],
  load: ArtifactLoader,
): number[] {
  return episodeNumbers.filter((n) => loadCompletedEpisode(n, load) !== null);
}

/**
 * Split planned episode specs into already-completed (rehydrated from
 * watermarks) and still-pending. A fresh run dir has no watermarks, so this
 * is a no-op outside resume.
 */
export function partitionResumableEpisodes<S extends { episodeNumber: number }>(
  specs: S[],
  load: ArtifactLoader,
): { pending: S[]; resumed: Array<{ spec: S } & ResumedEpisode> } {
  const pending: S[] = [];
  const resumed: Array<{ spec: S } & ResumedEpisode> = [];
  for (const spec of specs) {
    const hit = loadCompletedEpisode(spec.episodeNumber, load);
    if (hit) resumed.push({ spec, ...hit });
    else pending.push(spec);
  }
  return { pending, resumed };
}
