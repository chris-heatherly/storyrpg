import type { PipelineEvent } from '../ai-agents/pipeline';
import type { VideoJobStatus } from '../stores/videoJobStore';

export interface WorkerTimelineBridge {
  onPipelineEvent?: (event: PipelineEvent) => void;
  addImageJob: (job: { id: string; identifier?: string; prompt?: string; maxRetries?: number; metadata?: unknown }) => void;
  updateImageJob: (id: string, updates: Record<string, unknown>) => void;
  removeImageJob: (id: string) => void;
  addVideoJob: (job: { id: string; identifier?: string; sourceImageUrl?: string; metadata?: unknown }) => void;
  updateVideoJob: (id: string, updates: { status?: VideoJobStatus; progress?: string; videoUrl?: string; endTime?: number }) => void;
  removeVideoJob: (id: string) => void;
}

export function normalizeVideoJobStatus(status: unknown): VideoJobStatus | undefined {
  return status === 'pending'
    || status === 'generating'
    || status === 'polling'
    || status === 'completed'
    || status === 'failed'
    ? status
    : undefined;
}

export function applyWorkerTimelineEvent(event: any, bridge: WorkerTimelineBridge): void {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'pipeline_event') {
    const message = event.message || event.eventType || 'Worker event';
    bridge.onPipelineEvent?.({
      type: event.eventType || 'debug',
      phase: event.phase,
      agent: event.agent,
      message,
      timestamp: new Date(event.timestamp || Date.now()),
      data: event.data,
      telemetry: event.telemetry,
    });
    return;
  }

  if (event.type === 'image_job_event') {
    const payload = event.data || {};
    if (event.eventType === 'job_added' && payload.id) {
      bridge.addImageJob({
        id: payload.id,
        identifier: payload.identifier,
        prompt: payload.prompt,
        maxRetries: payload.maxRetries,
        metadata: payload.metadata,
      });
    } else if (event.eventType === 'job_updated' && payload.id) {
      bridge.updateImageJob(payload.id, payload);
    } else if (event.eventType === 'job_removed' && payload.id) {
      bridge.removeImageJob(payload.id);
    }
    return;
  }

  if (event.type === 'video_job_event') {
    const payload = event.data || {};
    if (event.eventType === 'job_added' && payload.id) {
      bridge.addVideoJob({
        id: payload.id,
        identifier: payload.identifier,
        sourceImageUrl: payload.sourceImageUrl,
        metadata: payload.metadata,
      });
    } else if (event.eventType === 'job_updated' && payload.id) {
      const status = normalizeVideoJobStatus(payload.status);
      bridge.updateVideoJob(payload.id, {
        status,
        progress: payload.progress,
        videoUrl: payload.videoUrl,
        ...(status === 'completed' || status === 'failed'
          ? { endTime: Date.now() }
          : {}),
      });
    } else if (event.eventType === 'job_removed' && payload.id) {
      bridge.removeVideoJob(payload.id);
    }
  }
}
