import type { Story } from '../../../types';
import type { ArtifactKind, ArtifactRef } from '../artifacts';

export type CompileEpisodeMode =
  | 'revalidate'
  | 'repair-artifact'
  | 'regenerate-episode'
  | 'regenerate-forward'
  | 'repackage'
  | 'media-only';

export interface CompileEpisodeRequest {
  storyRunId: string;
  episodeNumber: number;
  mode: CompileEpisodeMode;
  targetArtifactKind?: ArtifactKind;
  frozenPlanningRevision?: number;
  contextSource: 'previous-valid' | 'latest';
  totalEpisodes: number;
  baseStory?: Story;
  episodeNumbers?: number[];
}

export interface CompileEpisodeResult {
  storyRunId: string;
  episodeNumber: number;
  mode: CompileEpisodeMode;
  artifactsWritten: ArtifactRef[];
  invalidatedArtifacts: ArtifactRef[];
  forwardRevalidationRequired: number[];
  regeneratedEpisodes: number[];
  packageStatus: 'clean' | 'stale' | 'rebuilt' | 'failed';
  validationPassed: boolean;
  status: 'completed' | 'unsupported' | 'failed';
  message: string;
}
