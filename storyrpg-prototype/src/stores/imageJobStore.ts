import { createJobStore } from './createJobStore';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImageJobMetadata {
  sceneId?: string;
  beatId?: string;
  shotId?: string;
  characterId?: string;
  viewType?: string;
  type?: 'scene' | 'beat' | 'cover' | 'master' | 'reference' | 'expression' | 'encounter-setup' | 'encounter-outcome';
  characters?: string[];
  regeneration?: number;
  [key: string]: unknown;
}

export interface ImageJob {
  id: string;
  identifier: string;
  prompt: string;
  status: JobStatus;
  progress: number; // 0 to 100
  error?: string;
  imageUrl?: string;
  startTime: number;
  endTime?: number;
  attempts: number;
  maxRetries: number;
  metadata?: ImageJobMetadata;
}

export type ImageJobAddInput = Omit<ImageJob, 'status' | 'progress' | 'startTime' | 'attempts'>;

export const useImageJobStore = createJobStore<ImageJob, ImageJobAddInput>({
  buildJob: (input) => ({
    ...input,
    status: 'pending',
    progress: 0,
    startTime: Date.now(),
    attempts: 0,
  }),
});
