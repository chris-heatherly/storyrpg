import { create } from 'zustand';

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

interface VideoJobState {
  jobs: Record<string, VideoJob>;
  activeJobId: string | null;

  addJob: (job: { id: string; identifier: string; sourceImageUrl?: string; metadata?: VideoJob['metadata'] }) => void;
  updateJob: (id: string, updates: Partial<VideoJob>) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
  setActiveJob: (id: string | null) => void;
}

export const useVideoJobStore = create<VideoJobState>((set) => ({
  jobs: {},
  activeJobId: null,

  addJob: (job) => set((state) => ({
    jobs: {
      ...state.jobs,
      [job.id]: {
        ...job,
        status: 'pending',
        startTime: Date.now(),
      },
    },
  })),

  updateJob: (id, updates) => set((state) => {
    if (!state.jobs[id]) return state;
    return {
      jobs: {
        ...state.jobs,
        [id]: { ...state.jobs[id], ...updates },
      },
    };
  }),

  removeJob: (id) => set((state) => {
    const newJobs = { ...state.jobs };
    delete newJobs[id];
    return { jobs: newJobs };
  }),

  clearJobs: () => set({ jobs: {}, activeJobId: null }),

  setActiveJob: (id) => set({ activeJobId: id }),
}));
