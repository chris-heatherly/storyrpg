#!/usr/bin/env npx ts-node
// @ts-nocheck — TODO(tech-debt): Phase 4 client/pipeline decoupling.
import * as fs from 'fs/promises';
import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import { PipelineError } from '../pipeline/FullStoryPipeline';
import { sanitizePipelineResultForTransfer } from '../utils/storyPayloads';
import { runStoryAnalysis, runStoryGeneration } from '../services/storyGenerationService';
import { WorkerPayload, assertValidWorkerPayload } from './workerPayload';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';

function emit(type: string, payload: Record<string, unknown> = {}) {
  try {
    console.log(JSON.stringify({ workerEvent: true, type, timestamp: new Date().toISOString(), ...payload }));
  } catch {
    // stdout may be closed if parent already killed us — nothing to do
  }
}

function buildFailurePayload(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  if (error instanceof PipelineError) {
    const context = error.context || {};
    return {
      message,
      stack,
      failurePhase: error.phase,
      failureStepId: typeof context.stepId === 'string' ? context.stepId : error.phase,
      failureKind: typeof context.failureKind === 'string' ? context.failureKind : 'pipeline',
      failureArtifactKey: typeof context.failureArtifactKey === 'string' ? context.failureArtifactKey : undefined,
      resumeFromStepId: typeof context.resumeFromStepId === 'string' ? context.resumeFromStepId : error.phase,
      resumePatchableInputs: Array.isArray(context.resumePatchableInputs) ? context.resumePatchableInputs : ['settings'],
      context,
    };
  }
  return {
    message,
    stack,
    failureKind: 'worker',
    resumePatchableInputs: ['settings'],
  };
}

// --- Heartbeat: emit a periodic signal so the proxy can detect hung workers ---
const heartbeatInterval = setInterval(() => {
  const mem = process.memoryUsage();
  emit('heartbeat', {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
  });
}, 60_000);
// Don't let the heartbeat timer keep the process alive after main() finishes
heartbeatInterval.unref();

// --- Graceful shutdown: report back to proxy before dying ---
process.on('SIGTERM', () => {
  emit('worker_error', { message: 'Worker received SIGTERM — shutting down', signal: 'SIGTERM' });
  clearInterval(heartbeatInterval);
  process.exit(130);
});

process.on('SIGINT', () => {
  emit('worker_error', { message: 'Worker received SIGINT — shutting down', signal: 'SIGINT' });
  clearInterval(heartbeatInterval);
  process.exit(130);
});

process.on('unhandledRejection', (reason: unknown) => {
  const failure = buildFailurePayload(reason);
  emit('worker_error', { ...failure, message: `Unhandled rejection: ${failure.message}` });
  clearInterval(heartbeatInterval);
  process.exit(1);
});

async function runAnalysis(payload: WorkerPayload) {
  if (!payload.analysisInput) throw new Error('analysisInput is required for analysis mode');
  const { sourceText, title, prompt, preferences } = payload.analysisInput;
  emit('step_start', { step: 'source_analysis' });
  emit('step_start', { step: 'season_plan' });
  const result = await runStoryAnalysis({
    config: payload.config,
    externalJobId: payload.externalJobId,
    sourceText,
    title,
    prompt,
    preferences,
    resumeCheckpoint: payload.resumeCheckpoint,
    onEvent: (event) => {
      emit('pipeline_event', {
        eventType: event.type,
        phase: event.phase,
        agent: event.agent,
        message: event.message,
        data: event.data,
        telemetry: event.telemetry,
      });
    },
  });
  emit('step_complete', { step: 'source_analysis', output: result.analysisResult });
  emit('step_complete', {
    step: 'season_plan',
    success: !!result.seasonPlan,
    output: result.seasonPlan
      ? { success: true, data: result.seasonPlan }
      : { success: false, error: result.seasonPlanError },
  });

  const output = {
    success: true,
    analysisResult: result.analysisResult,
    sourceAnalysis: result.sourceAnalysis,
    seasonPlan: result.seasonPlan,
    seasonPlanError: result.seasonPlanError,
  };
  await fs.writeFile(payload.resultPath, JSON.stringify(output), 'utf8');
}

async function runGeneration(payload: WorkerPayload) {
  if (!payload.generationInput) throw new Error('generationInput is required for generation mode');
  const { brief, sourceAnalysis, episodeRange } = payload.generationInput;
  emit('step_start', { step: 'generation' });
  const { result } = await runStoryGeneration({
    config: payload.config,
    externalJobId: payload.externalJobId,
    brief: brief as unknown as FullCreativeBrief,
    sourceAnalysis: sourceAnalysis as SourceMaterialAnalysis | undefined,
    episodeRange,
    resumeCheckpoint: payload.resumeCheckpoint,
    onEvent: (event) => {
      emit('pipeline_event', {
        eventType: event.type,
        phase: event.phase,
        agent: event.agent,
        message: event.message,
        data: event.data,
        telemetry: event.telemetry,
      });
    },
    onImageJobEvent: (rawEvent: any) => {
      emit('image_job_event', {
        eventType: rawEvent.type,
        jobId: rawEvent.id || rawEvent.job?.id,
        data: rawEvent.type === 'job_added' ? {
          id: rawEvent.job?.id,
          identifier: rawEvent.job?.identifier,
          prompt: rawEvent.job?.prompt,
          status: rawEvent.job?.status,
          maxRetries: rawEvent.job?.maxRetries,
          metadata: rawEvent.job?.metadata,
        } : rawEvent.type === 'job_updated' ? {
          id: rawEvent.id,
          ...rawEvent.updates,
        } : { id: rawEvent.id },
      });
    },
    onVideoJobEvent: (rawEvent: any) => {
      emit('video_job_event', {
        eventType: rawEvent.type,
        jobId: rawEvent.id || rawEvent.job?.id,
        data: rawEvent.type === 'job_added' ? {
          id: rawEvent.job?.id,
          identifier: rawEvent.job?.identifier,
          status: rawEvent.job?.status,
          sourceImageUrl: rawEvent.job?.sourceImageUrl,
          metadata: rawEvent.job?.metadata,
        } : rawEvent.type === 'job_updated' ? {
          id: rawEvent.id,
          ...rawEvent.updates,
        } : { id: rawEvent.id },
      });
    },
  });
  emit('step_complete', { step: 'generation', success: result.success });

  // Write result file immediately — this is the authoritative output.
  // OutputWriter (disk image save) already ran inside the pipeline and is
  // wrapped in its own try/catch, so it won't block result delivery.
  const transferableResult = sanitizePipelineResultForTransfer(result as unknown as Record<string, unknown>, {
    maxEvents: 60,
    maxCheckpoints: 12,
  });
  try {
    await fs.writeFile(payload.resultPath, JSON.stringify(transferableResult), 'utf8');
  } catch (writeErr) {
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    emit('worker_error', { message: `Failed to write result file: ${msg}`, nonFatal: true });
    // Attempt an aggressively trimmed write as a final fallback.
    try {
      const stripped = {
        ...sanitizePipelineResultForTransfer(result as unknown as Record<string, unknown>, {
          maxEvents: 20,
          maxCheckpoints: 4,
        }),
        _note: 'worker result trimmed after write failure',
      };
      await fs.writeFile(payload.resultPath, JSON.stringify(stripped), 'utf8');
    } catch {
      throw writeErr; // propagate original error
    }
  }
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) throw new Error('Missing payload path');
  const payloadRaw = await fs.readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw) as unknown;
  assertValidWorkerPayload(payload);

  emit('worker_start', { mode: payload.mode });
  if (payload.mode === 'analysis') {
    await runAnalysis(payload);
  } else {
    await runGeneration(payload);
  }
  emit('worker_complete');
}

main()
  .then(() => {
    clearInterval(heartbeatInterval);
  })
  .catch(async (error) => {
    clearInterval(heartbeatInterval);
    emit('worker_error', buildFailurePayload(error));
    process.exit(1);
  });

