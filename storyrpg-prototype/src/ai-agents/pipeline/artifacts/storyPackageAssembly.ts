import type { Episode, Story } from '../../../types';
import { ArtifactRevisionStore } from './store';
import type { ArtifactProvenance, ArtifactRef, PipelineArtifact } from './types';
import { defaultValidationSummary } from './types';

export interface RuntimeEpisodeAssemblyResult {
  story: Story | null;
  episodeRefs: ArtifactRef[];
  missingEpisodes: number[];
}

export function assembleRuntimeStoryFromArtifacts(params: {
  store: ArtifactRevisionStore;
  baseStory: Story;
  episodeNumbers: number[];
}): RuntimeEpisodeAssemblyResult {
  const episodes: Episode[] = [];
  const episodeRefs: ArtifactRef[] = [];
  const missingEpisodes: number[] = [];

  for (const episodeNumber of params.episodeNumbers) {
    const ref = params.store.loadCurrentRef('runtime-episode', episodeNumber);
    const artifact = ref ? params.store.loadRef<Episode>(ref) : null;
    if (!ref || !artifact) {
      missingEpisodes.push(episodeNumber);
      continue;
    }
    episodes.push(artifact.payload);
    episodeRefs.push(ref);
  }

  if (missingEpisodes.length > 0) {
    return { story: null, episodeRefs, missingEpisodes };
  }

  return {
    story: {
      ...params.baseStory,
      episodes: episodes.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    },
    episodeRefs,
    missingEpisodes,
  };
}

export async function saveStoryPackageArtifact(params: {
  store: ArtifactRevisionStore;
  storyId: string;
  runId: string;
  baseStory: Story;
  episodeNumbers: number[];
  provenance?: ArtifactProvenance;
}): Promise<PipelineArtifact<Story>> {
  const assembled = assembleRuntimeStoryFromArtifacts({
    store: params.store,
    baseStory: params.baseStory,
    episodeNumbers: params.episodeNumbers,
  });
  if (!assembled.story) {
    throw new Error(`Cannot assemble story package; missing runtime episode artifact(s): ${assembled.missingEpisodes.join(', ')}`);
  }

  return params.store.saveRevision({
    kind: 'story-package',
    storyId: params.storyId,
    runId: params.runId,
    payload: assembled.story,
    status: 'valid',
    upstream: assembled.episodeRefs,
    provenance: params.provenance ?? { phase: 'story_package', agent: 'ArtifactStoryPackageAssembler' },
    validation: defaultValidationSummary('story-package'),
  });
}
