import { create } from 'zustand';

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
  [key: string]: unknown; // Allow additional properties
}

export interface ImageJob {
  id: string;
  identifier: string; // e.g., "master-char-1"
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

interface ImageJobState {
  jobs: Record<string, ImageJob>;
  activeJobId: string | null;
  
  // Actions
  addJob: (job: Omit<ImageJob, 'status' | 'progress' | 'startTime' | 'attempts'>) => void;
  updateJob: (id: string, updates: Partial<ImageJob>) => void;
  removeJob: (id: string) => void;
  clearCompletedJobs: () => void;
  setActiveJob: (id: string | null) => void;
}

export const useImageJobStore = create<ImageJobState>((set) => ({
  jobs: {},
  activeJobId: null,

  addJob: (job) => set((state) => ({
    jobs: {
      ...state.jobs,
      [job.id]: {
        ...job,
        status: 'pending',
        progress: 0,
        startTime: Date.now(),
        attempts: 0,
      }
    }
  })),

  updateJob: (id, updates) => set((state) => {
    if (!state.jobs[id]) return state;
    return {
      jobs: {
        ...state.jobs,
        [id]: {
          ...state.jobs[id],
          ...updates,
        }
      }
    };
  }),

  removeJob: (id) => set((state) => {
    const newJobs = { ...state.jobs };
    delete newJobs[id];
    return { jobs: newJobs };
  }),

  clearCompletedJobs: () => set((state) => {
    const newJobs = { ...state.jobs };
    Object.keys(newJobs).forEach(id => {
      if (newJobs[id].status === 'completed') {
        delete newJobs[id];
      }
    });
    return { jobs: newJobs };
  }),

  setActiveJob: (id) => set({ activeJobId: id }),
}));
