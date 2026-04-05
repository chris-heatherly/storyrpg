/**
 * Job Tracker Utility
 * 
 * Provides functions to register, update, and check job status with the server.
 * Used by the FullStoryPipeline to enable cancellation and progress tracking.
 */

import { isWebRuntime } from '../../utils/runtimeEnv';
import { GenerationJob, JobStatus } from '../../types/generationJob';

export type GenerationJobUpdate = Partial<GenerationJob>;
export type NewGenerationJob = Omit<GenerationJob, 'updatedAt'>;

const getProxyHost = () => {
  if (isWebRuntime() && typeof window !== 'undefined') {
    return `http://${window.location.hostname || 'localhost'}:3001`;
  }
  return 'http://localhost:3001';
};

/**
 * Register a new generation job with the server
 */
export async function registerJob(job: NewGenerationJob): Promise<boolean> {
  try {
    const fullJob: GenerationJob = {
      ...job,
      updatedAt: new Date().toISOString(),
    };

    const response = await fetch(`${getProxyHost()}/generation-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullJob),
    });

    return response.ok;
  } catch (e) {
    console.warn('[JobTracker] Failed to register job:', e);
    return false;
  }
}

/**
 * Update an existing job's status
 */
export async function updateJob(jobId: string, updates: GenerationJobUpdate): Promise<boolean> {
  try {
    const response = await fetch(`${getProxyHost()}/generation-jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...updates,
        updatedAt: new Date().toISOString(),
      }),
    });

    return response.ok;
  } catch (e) {
    console.warn('[JobTracker] Failed to update job:', e);
    return false;
  }
}

/**
 * Check if a job has been cancelled
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  try {
    const response = await fetch(`${getProxyHost()}/generation-jobs/${jobId}/status`);
    
    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.cancelled === true;
  } catch (e) {
    // If we can't check, assume not cancelled
    return false;
  }
}

/**
 * Mark a job as completed
 */
export async function completeJob(jobId: string, outputDir?: string): Promise<boolean> {
  return updateJob(jobId, {
    status: 'completed',
    progress: 100,
    outputDir,
  });
}

/**
 * Mark a job as failed
 */
export async function failJob(jobId: string, error: string): Promise<boolean> {
  return updateJob(jobId, {
    status: 'failed',
    error,
  });
}

/**
 * Generate a unique job ID
 */
export function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Custom error for job cancellation
 */
export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled by user`);
    this.name = 'JobCancelledError';
  }
}
