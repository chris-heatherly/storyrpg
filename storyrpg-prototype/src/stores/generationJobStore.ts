/**
 * Generation Job Store
 * 
 * Tracks active and recent generation jobs, persisting them across sessions.
 * Jobs are stored both locally and on the server for resilience.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  GenerationJob,
  JobStatus,
  PipelineEventData,
  normalizeGenerationJob,
} from '../types/generationJob';

export type { GenerationJob, JobStatus, PipelineEventData } from '../types/generationJob';

const JOBS_STORAGE_KEY = '@storyrpg_generation_jobs';
const MAX_STORED_JOBS = 10;
const MAX_STORED_EVENTS_PER_JOB = 30;

interface GenerationJobStore {
  jobs: GenerationJob[];
  isLoaded: boolean;
  activeJobId: string | null; // Currently viewing job
  
  // Actions
  loadJobs: () => Promise<void>;
  registerJob: (job: Omit<GenerationJob, 'updatedAt'>) => Promise<void>;
  updateJob: (jobId: string, updates: Partial<GenerationJob>) => Promise<void>;
  addJobEvent: (jobId: string, event: PipelineEventData) => void;
  cancelJob: (jobId: string) => Promise<boolean>;
  removeJob: (jobId: string) => Promise<void>;
  clearCompletedJobs: () => Promise<void>;
  isJobCancelled: (jobId: string) => boolean;
  setActiveJobId: (jobId: string | null) => void;
  getJob: (jobId: string) => GenerationJob | undefined;
}

// Get proxy URL from config or fall back to default
const getProxyHost = (): string => {
  try {
    const { PROXY_CONFIG } = require('../config/endpoints');
    return PROXY_CONFIG.getProxyUrl();
  } catch (e) {
    // Fallback if config not available
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `http://${window.location.hostname || 'localhost'}:3001`;
    }
    return 'http://localhost:3001';
  }
};

/**
 * Strip bulky checkpoint/events data before persisting to localStorage.
 * Checkpoint fields (briefJson, sourceAnalysisJson, etc.) can be megabytes each.
 * Events arrays grow unboundedly during generation.
 * We keep them in memory but never write them to storage.
 */
function prepareJobForStorage(job: GenerationJob): GenerationJob {
  const { checkpoint, events, ...rest } = job;
  return {
    ...rest,
    // Keep only a tail of events for resuming the progress view
    events: events ? events.slice(-MAX_STORED_EVENTS_PER_JOB) : undefined,
    // Keep checkpoint metadata but strip the large JSON blobs
    checkpoint: checkpoint ? {
      completedPhases: checkpoint.completedPhases,
      lastSuccessfulPhase: checkpoint.lastSuccessfulPhase,
      isResumable: checkpoint.isResumable,
      resumeHint: checkpoint.resumeHint,
      failureContext: checkpoint.failureContext,
      resumeContext: checkpoint.resumeContext,
      outputs: checkpoint.outputs,
      // Drop the big JSON strings — they're only useful in-memory during active generation
    } : undefined,
  };
}

/**
 * Safely persist jobs to AsyncStorage with quota error handling.
 */
async function persistJobs(jobs: GenerationJob[]): Promise<void> {
  // Limit stored jobs and strip heavy data
  const storable = jobs
    .slice(0, MAX_STORED_JOBS)
    .map(prepareJobForStorage);

  const json = JSON.stringify(storable);
  try {
    await AsyncStorage.setItem(JOBS_STORAGE_KEY, json);
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError' || err?.message?.includes('quota') || err?.message?.includes('QuotaExceeded')) {
      console.warn(`[GenerationJobStore] Quota exceeded (${json.length} chars), pruning...`);
      // Progressive fallback: fewer jobs, then strip events entirely
      const attempts = [
        () => storable.slice(0, 5),
        () => storable.slice(0, 3).map(j => ({ ...j, events: undefined })),
        () => storable.slice(0, 1).map(j => ({ ...j, events: undefined, checkpoint: undefined })),
      ];
      for (const attempt of attempts) {
        try {
          await AsyncStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(attempt()));
          console.log('[GenerationJobStore] Pruned jobs saved successfully');
          return;
        } catch (retryErr: any) {
          if (!(retryErr?.name === 'QuotaExceededError' || retryErr?.message?.includes('quota'))) throw retryErr;
        }
      }
      // All attempts failed — clear job storage
      console.error('[GenerationJobStore] All pruning attempts failed, clearing job storage');
      await AsyncStorage.removeItem(JOBS_STORAGE_KEY);
    } else {
      console.error('[GenerationJobStore] Failed to persist jobs:', err);
    }
  }
}

export const useGenerationJobStore = create<GenerationJobStore>((set, get) => ({
  jobs: [],
  isLoaded: false,
  activeJobId: null,

  loadJobs: async () => {
    try {
      // Load from AsyncStorage first
      const stored = await AsyncStorage.getItem(JOBS_STORAGE_KEY);
      let localJobs: GenerationJob[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          localJobs = Array.isArray(parsed)
            ? parsed
                .map((job) => normalizeGenerationJob(job))
                .filter((job): job is GenerationJob => job !== null)
            : [];
        } catch (e) {
          console.warn('[GenerationJobStore] Failed to parse stored jobs');
        }
      }

      // Also fetch from server for sync
      if (Platform.OS === 'web') {
        try {
          const response = await fetch(`${getProxyHost()}/generation-jobs`);
          if (response.ok) {
            const serverPayload = await response.json();
            const serverJobs = Array.isArray(serverPayload)
              ? serverPayload
                  .map((job) => normalizeGenerationJob(job))
                  .filter((job): job is GenerationJob => job !== null)
              : [];
            // Merge: prefer server state for running jobs
            const jobMap = new Map<string, GenerationJob>();
            localJobs.forEach(j => jobMap.set(j.id, j));
            serverJobs.forEach((j: GenerationJob) => {
              const existing = jobMap.get(j.id);
              if (!existing || new Date(j.updatedAt) > new Date(existing.updatedAt)) {
                jobMap.set(j.id, j);
              }
            });
            localJobs = Array.from(jobMap.values());
          }
        } catch (e) {
          console.warn('[GenerationJobStore] Failed to fetch server jobs');
        }
      }

      // Mark any "running" jobs as potentially stale if they haven't updated in 5 minutes
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      localJobs = localJobs.map(job => {
        if (job.status === 'running' && new Date(job.updatedAt).getTime() < fiveMinutesAgo) {
          return { ...job, status: 'failed' as JobStatus, error: 'Job appears to have stopped unexpectedly' };
        }
        return job;
      });

      // Auto-remove finished jobs (completed, failed, cancelled) that are older than 1 hour
      // This keeps the job list clean without removing jobs the user might still want to see
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const terminalStatuses: JobStatus[] = ['completed', 'failed', 'cancelled'];
      localJobs = localJobs.filter(job => {
        if (terminalStatuses.includes(job.status)) {
          const jobTime = new Date(job.updatedAt).getTime();
          if (jobTime < oneHourAgo) {
            console.log(`[GenerationJobStore] Auto-removing old finished job: ${job.id} (${job.status})`);
            return false;
          }
        }
        return true;
      });

      // Sort by most recent first
      localJobs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

      set({ jobs: localJobs, isLoaded: true });
      
      // Persist the merged/cleaned state
      await persistJobs(localJobs);
    } catch (e) {
      console.error('[GenerationJobStore] Failed to load jobs:', e);
      set({ isLoaded: true });
    }
  },

  registerJob: async (job) => {
    const fullJob: GenerationJob = {
      ...job,
      updatedAt: new Date().toISOString(),
    };

    // Capture updated jobs from the setter for persistence
    let updatedJobs: GenerationJob[] = [];
    set(state => {
      updatedJobs = [fullJob, ...state.jobs.filter(j => j.id !== job.id)];
      return { jobs: updatedJobs };
    });

    // Persist locally (using captured jobs, not get())
    await persistJobs(updatedJobs);

    // Sync to server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/generation-jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fullJob),
        });
      } catch (e) {
        console.warn('[GenerationJobStore] Failed to sync job to server');
      }
    }
  },

  updateJob: async (jobId, updates) => {
    const updatedAt = new Date().toISOString();
    
    // Capture updated jobs from the setter for persistence
    let updatedJobs: GenerationJob[] = [];
    set(state => {
      updatedJobs = state.jobs.map(job =>
        job.id === jobId ? { ...job, ...updates, updatedAt } : job
      );
      return { jobs: updatedJobs };
    });

    // Persist locally (using captured jobs, not get())
    await persistJobs(updatedJobs);

    // Sync to server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/generation-jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...updates, updatedAt }),
        });
      } catch (e) {
        console.warn('[GenerationJobStore] Failed to sync job update to server');
      }
    }

  },

  cancelJob: async (jobId) => {
    // Mark as cancelled
    await get().updateJob(jobId, { status: 'cancelled' });

    // Request cancellation on server
    if (Platform.OS === 'web') {
      try {
        let response = await fetch(`${getProxyHost()}/worker-jobs/${jobId}/cancel`, {
          method: 'POST',
        });
        if (!response.ok) {
          response = await fetch(`${getProxyHost()}/generation-jobs/${jobId}/cancel`, {
            method: 'POST',
          });
        }
        return response.ok;
      } catch (e) {
        console.warn('[GenerationJobStore] Failed to request cancellation on server');
      }
    }
    return true;
  },

  removeJob: async (jobId) => {
    // Capture updated jobs from the setter for persistence
    let updatedJobs: GenerationJob[] = [];
    set(state => {
      updatedJobs = state.jobs.filter(job => job.id !== jobId);
      return { jobs: updatedJobs };
    });

    // Persist locally (using captured jobs, not get())
    await persistJobs(updatedJobs);

    // Remove from server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/generation-jobs/${jobId}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('[GenerationJobStore] Failed to remove job from server');
      }
    }
  },

  clearCompletedJobs: async () => {
    // Capture updated jobs from the setter for persistence
    let updatedJobs: GenerationJob[] = [];
    set(state => {
      updatedJobs = state.jobs.filter(job => job.status === 'running' || job.status === 'pending');
      return { jobs: updatedJobs };
    });

    // Persist locally (using captured jobs, not get())
    await persistJobs(updatedJobs);
  },

  isJobCancelled: (jobId) => {
    const job = get().jobs.find(j => j.id === jobId);
    return job?.status === 'cancelled';
  },

  addJobEvent: (jobId, event) => {
    set(state => ({
      jobs: state.jobs.map(job =>
        job.id === jobId
          ? { 
              ...job, 
              events: [...(job.events || []), event],
              updatedAt: new Date().toISOString(),
            }
          : job
      ),
    }));
    // Note: We don't persist events to storage immediately for performance
    // They'll be persisted on the next updateJob call
  },

  setActiveJobId: (jobId) => {
    set({ activeJobId: jobId });
  },

  getJob: (jobId) => {
    return get().jobs.find(j => j.id === jobId);
  },
}));
