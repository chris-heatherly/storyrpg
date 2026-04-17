import { useCallback } from 'react';
import { Platform } from 'react-native';
import { FullStoryPipeline } from '../ai-agents/pipeline/FullStoryPipeline';
import type { WorkerJobStartRequest, WorkerJobStartResponse } from '../ai-agents/server/workerPayload';
import { useImageJobStore } from '../stores/imageJobStore';
import { useVideoJobStore } from '../stores/videoJobStore';
import { PROXY_CONFIG } from '../config/endpoints';
import type { PipelineEvent } from '../ai-agents/pipeline';
import { applyWorkerTimelineEvent, normalizeVideoJobStatus } from './workerJobTimeline';

export function useGeneratorRunner() {
  const { addJob, updateJob, removeJob } = useImageJobStore();
  const {
    addJob: addVideoJob,
    updateJob: updateVideoJob,
    removeJob: removeVideoJob,
  } = useVideoJobStore();

  const attachPipelineJobListeners = useCallback((pipeline: FullStoryPipeline) => {
    const cleanups: Array<() => void> = [];

    if (pipeline.imageService) {
      cleanups.push(
        pipeline.imageService.onEvent((event) => {
          switch (event.type) {
            case 'job_added':
              addJob(event.job);
              break;
            case 'job_updated':
              updateJob(event.id, event.updates);
              break;
            case 'job_removed':
              removeJob(event.id);
              break;
          }
        }),
      );
    }

    if (pipeline.videoService) {
      cleanups.push(
        pipeline.videoService.onEvent((event) => {
          switch (event.type) {
            case 'job_added':
              addVideoJob({
                id: event.job.id,
                identifier: event.job.identifier,
                sourceImageUrl: event.job.sourceImageUrl,
                metadata: event.job.metadata,
              });
              break;
            case 'job_updated':
              {
                const status = normalizeVideoJobStatus(event.updates.status);
              updateVideoJob(event.id, {
                status,
                progress: event.updates.progress,
                videoUrl: event.updates.videoUrl,
                ...(status === 'completed' || status === 'failed'
                  ? { endTime: Date.now() }
                  : {}),
              });
              }
              break;
            case 'job_removed':
              removeVideoJob(event.id);
              break;
          }
        }),
      );
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [addJob, addVideoJob, removeJob, removeVideoJob, updateJob, updateVideoJob]);

  const ensureProxyAvailable = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/`, { method: 'GET' });
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return !!data && data.status === 'ok';
    } catch {
      return false;
    }
  }, []);

  const runWorkerJob = useCallback(async <T,>(
    request: WorkerJobStartRequest,
    onPipelineEvent?: (event: PipelineEvent) => void,
    onStatusUpdate?: (status: any) => void,
    onJobStarted?: (jobId: string) => void | Promise<void>,
  ): Promise<{ jobId: string; result: T }> => {
    const startResp = await fetch(`${PROXY_CONFIG.workerJobs}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!startResp.ok) {
      throw new Error(`Failed to start worker job (${startResp.status})`);
    }

    const startData = await startResp.json() as WorkerJobStartResponse;
    const jobId = startData.jobId;
    if (!jobId) {
      throw new Error('Worker start response missing jobId');
    }

    await Promise.resolve(onJobStarted?.(jobId));

    let seenTimeline = 0;
    let idlePolls = 0;
    let sseConnected = false;
    let eventSource: EventSource | null = null;
    let pollingConnectionFailures = 0;
    const MAX_POLLING_CONNECTION_FAILURES = 8;
    const closeEventSource = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
    const pushWorkerTimelineEvent = (event: any) =>
      applyWorkerTimelineEvent(event, {
        onPipelineEvent,
        addImageJob: addJob as unknown as (job: { id: string; identifier?: string; prompt?: string; maxRetries?: number; metadata?: unknown }) => void,
        updateImageJob: updateJob,
        removeImageJob: removeJob,
        addVideoJob: addVideoJob as unknown as (job: { id: string; identifier?: string; sourceImageUrl?: string; metadata?: unknown }) => void,
        updateVideoJob,
        removeVideoJob,
      });

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      try {
        eventSource = new EventSource(`${PROXY_CONFIG.workerJobs}/${jobId}/stream`);
        eventSource.addEventListener('open', () => {
          sseConnected = true;
        });
        eventSource.addEventListener('status', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            onStatusUpdate?.(payload);
          } catch {}
        });
        eventSource.addEventListener('timeline', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            pushWorkerTimelineEvent(payload);
          } catch {}
        });
        eventSource.addEventListener('snapshot', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            onStatusUpdate?.(payload);
            const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
            if (timeline.length > seenTimeline) {
              const nextEvents = timeline.slice(seenTimeline);
              seenTimeline = timeline.length;
              nextEvents.forEach((nextEvent: any) => pushWorkerTimelineEvent(nextEvent));
            }
          } catch {}
        });
        eventSource.onerror = () => {
          // Polling remains the fallback path while EventSource reconnects.
          sseConnected = false;
        };
      } catch {
        eventSource = null;
      }
    }

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, sseConnected ? 3500 : 2000));
      let statusResp: Response;
      try {
        statusResp = await fetch(`${PROXY_CONFIG.workerJobs}/${jobId}`);
      } catch (error) {
        pollingConnectionFailures += 1;
        sseConnected = false;
        if (pollingConnectionFailures > MAX_POLLING_CONNECTION_FAILURES) {
          closeEventSource();
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Network request failed while polling worker job (${message})`);
        }
        continue;
      }

      pollingConnectionFailures = 0;
      if (!statusResp.ok) {
        idlePolls += 1;
        if (idlePolls > 5) {
          closeEventSource();
          throw new Error(`Worker job polling failed (${statusResp.status})`);
        }
        continue;
      }
      idlePolls = 0;
      const statusData = await statusResp.json();
      onStatusUpdate?.(statusData);
      const timeline = Array.isArray(statusData.timeline) ? statusData.timeline : [];
      if (timeline.length > seenTimeline) {
        const nextEvents = timeline.slice(seenTimeline);
        seenTimeline = timeline.length;
        nextEvents.forEach((nextEvent: any) => pushWorkerTimelineEvent(nextEvent));
      }

      if (statusData.status === 'completed') {
        closeEventSource();
        return { jobId, result: statusData.result as T };
      }
      if (statusData.status === 'failed') {
        closeEventSource();
        const workerError = new Error(statusData.error || 'Worker job failed') as Error & {
          failureContext?: unknown;
          checkpoint?: unknown;
          job?: unknown;
        };
        workerError.failureContext = statusData.failureContext || statusData.checkpoint?.failureContext;
        workerError.checkpoint = statusData.checkpoint;
        workerError.job = statusData;
        throw workerError;
      }
      if (statusData.status === 'cancelled') {
        closeEventSource();
        throw new Error('Worker job cancelled');
      }
    }
  }, []);

  return {
    attachPipelineJobListeners,
    ensureProxyAvailable,
    runWorkerJob,
  };
}
