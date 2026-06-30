import { ArtifactRevisionStore, evaluateArtifactStatus, forwardRevalidationEpisodes, saveStoryPackageArtifact } from '../artifacts';
import type { ArtifactStoreIO } from '../artifacts';
import type { CompileEpisodeRequest, CompileEpisodeResult } from './types';

export interface CompileEpisodeDeps {
  io: ArtifactStoreIO;
}

export async function compileEpisode(
  request: CompileEpisodeRequest,
  deps: CompileEpisodeDeps,
): Promise<CompileEpisodeResult> {
  const store = new ArtifactRevisionStore(deps.io);
  if (request.mode === 'revalidate') {
    return revalidateEpisode(request, store);
  }
  if (request.mode === 'repackage') {
    return repackageStory(request, store);
  }
  return unsupportedMode(request);
}

function revalidateEpisode(
  request: CompileEpisodeRequest,
  store: ArtifactRevisionStore,
): CompileEpisodeResult {
  const refs = [
    store.loadCurrentRef('context-in', request.episodeNumber),
    store.loadCurrentRef('runtime-episode', request.episodeNumber),
    store.loadCurrentRef('validation-report', request.episodeNumber),
    store.loadCurrentRef('context-out', request.episodeNumber),
  ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));

  const reports = refs.map((ref) => evaluateArtifactStatus(ref, store));
  const failed = reports.filter((report) => report.status !== 'clean');
  const missingRequired = refs.length < 4;
  const validationPassed = failed.length === 0 && !missingRequired;

  return {
    storyRunId: request.storyRunId,
    episodeNumber: request.episodeNumber,
    mode: request.mode,
    artifactsWritten: [],
    invalidatedArtifacts: failed.map((report) => report.ref),
    forwardRevalidationRequired: validationPassed
      ? forwardRevalidationEpisodes(request.episodeNumber, request.totalEpisodes)
      : [],
    regeneratedEpisodes: [],
    packageStatus: validationPassed ? 'stale' : 'failed',
    validationPassed,
    status: validationPassed ? 'completed' : 'failed',
    message: validationPassed
      ? `Episode ${request.episodeNumber} artifacts are clean; later episodes require forward revalidation.`
      : `Episode ${request.episodeNumber} artifacts are not clean${missingRequired ? ' (required artifact missing)' : ''}.`,
  };
}

async function repackageStory(
  request: CompileEpisodeRequest,
  store: ArtifactRevisionStore,
): Promise<CompileEpisodeResult> {
  if (!request.baseStory) {
    return failedResult(request, 'Repackage requires baseStory.');
  }
  const episodeNumbers = request.episodeNumbers ?? Array.from(
    { length: request.totalEpisodes },
    (_, index) => index + 1,
  );
  try {
    const artifact = await saveStoryPackageArtifact({
      store,
      storyId: request.baseStory.id,
      runId: request.storyRunId,
      baseStory: request.baseStory,
      episodeNumbers,
    });
    return {
      storyRunId: request.storyRunId,
      episodeNumber: request.episodeNumber,
      mode: request.mode,
      artifactsWritten: [store.refFor(artifact)],
      invalidatedArtifacts: [],
      forwardRevalidationRequired: [],
      regeneratedEpisodes: [],
      packageStatus: 'rebuilt',
      validationPassed: true,
      status: 'completed',
      message: `Story package artifact rebuilt from ${episodeNumbers.length} runtime episode artifact(s).`,
    };
  } catch (error) {
    return failedResult(request, error instanceof Error ? error.message : String(error));
  }
}

function failedResult(request: CompileEpisodeRequest, message: string): CompileEpisodeResult {
  return {
    storyRunId: request.storyRunId,
    episodeNumber: request.episodeNumber,
    mode: request.mode,
    artifactsWritten: [],
    invalidatedArtifacts: [],
    forwardRevalidationRequired: [],
    regeneratedEpisodes: [],
    packageStatus: 'failed',
    validationPassed: false,
    status: 'failed',
    message,
  };
}

function unsupportedMode(request: CompileEpisodeRequest): CompileEpisodeResult {
  return {
    storyRunId: request.storyRunId,
    episodeNumber: request.episodeNumber,
    mode: request.mode,
    artifactsWritten: [],
    invalidatedArtifacts: [],
    forwardRevalidationRequired: [],
    regeneratedEpisodes: [],
    packageStatus: 'stale',
    validationPassed: false,
    status: 'unsupported',
    message: `${request.mode} requires pipeline regeneration integration and is not available in the pure artifact compiler yet.`,
  };
}
