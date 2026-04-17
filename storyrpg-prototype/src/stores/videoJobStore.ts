import { createJobStore } from './createJobStore';

export type VideoJobStatus = 'pending' | 'generating' | 'polling' | 'completed' | 'failed';

export interface VideoJob {
  id: string;
  identifier: string;
  status: VideoJobStatus;
  progress?: string;
  videoUrl?: string;
  sourceImageUrl?: string;
  startTime: number;
  endTime?: number;
  metadata?: {
    sceneId?: string;
    beatId?: string;
    [key: string]: unknown;
  };
}

export interface VideoJobAddInput {
  id: string;
  identifier: string;
  sourceImageUrl?: string;
  metadata?: VideoJob['metadata'];
}

export const useVideoJobStore = createJobStore<VideoJob, VideoJobAddInput>({
  buildJob: (input) => ({
    ...input,
    status: 'pending',
    startTime: Date.now(),
  }),
});
