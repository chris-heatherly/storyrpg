#!/usr/bin/env npx ts-node
// @ts-nocheck — TODO(tech-debt): Phase 4 client/pipeline decoupling.
import * as fs from 'fs/promises';
import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import { PipelineError } from '../pipeline/FullStoryPipeline';
import { atomicWriteJson } from '../utils/atomicIo';
import {
  encodeStory,
  projectForTransfer,
  StoryValidationError,
  type StoryPackage,
} from '../codec/storyCodec';
import { runStoryAnalysis, runStoryGeneration } from '../services/storyGenerationService';
import { WorkerPayload, assertValidWorkerPayload } from './workerPayload';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { Story } from '../../types';

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
  await atomicWriteJson(payload.resultPath, output);
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

  // Build the authoritative transfer payload via the codec's declarative
  // `projectForTransfer`. This replaces the old string-matching
  // `sanitizePipelineResultForTransfer` walk: we emit only documented
  // transfer fields, and the payload is a projection of the same
  // `StoryPackage` that was written to disk.
  //
  // Note: when generation fails, `result.story` may be partial. We still
  // attempt to build a `StoryPackage` for transfer; if encoding fails
  // we fall back to the minimal error shape.
  const resultObj = result as unknown as Record<string, unknown>;
  const story = resultObj.story as Story | undefined;
  let pkg: StoryPackage | null = null;
  if (story && typeof story === 'object') {
    try {
      pkg = encodeStory(story, {
        assets: {},
        generator: { version: '3', pipeline: 'FullStoryPipeline' },
      });
    } catch (encodeErr) {
      if (encodeErr instanceof StoryValidationError) {
        emit('worker_error', {
          message: `encodeStory: ${encodeErr.message}`,
          nonFatal: true,
          issues: encodeErr.issues,
        });
      }
      pkg = null;
    }
  }

  const checkpointSummary = Array.isArray(resultObj.checkpoints)
    ? (resultObj.checkpoints as Array<Record<string, unknown>>).slice(-12).map((cp) => ({
        phase: String(cp.phase ?? cp.stepId ?? 'unknown'),
        ts: typeof cp.timestamp === 'string' ? cp.timestamp : new Date().toISOString(),
      }))
    : [];

  const transferPayload = pkg
    ? {
        ...projectForTransfer(pkg, {
          events: Array.isArray(resultObj.events) ? (resultObj.events as unknown[]) : [],
          checkpointSummary,
          success: result.success === true,
          error: typeof resultObj.error === 'string' ? (resultObj.error as string) : undefined,
        }, { maxEvents: 60 }),
      }
    : {
        schemaVersion: 3,
        storyId: typeof resultObj.storyId === 'string' ? resultObj.storyId : '',
        story: null,
        assets: {},
        events: Array.isArray(resultObj.events) ? (resultObj.events as unknown[]).slice(-60) : [],
        checkpointSummary,
        success: result.success === true,
        error: typeof resultObj.error === 'string' ? (resultObj.error as string) : undefined,
      };

  try {
    await atomicWriteJson(payload.resultPath, transferPayload);
  } catch (writeErr) {
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    emit('worker_error', { message: `Failed to write result file: ${msg}`, nonFatal: true });
    try {
      const stripped = {
        schemaVersion: transferPayload.schemaVersion,
        storyId: transferPayload.storyId,
        success: transferPayload.success,
        error: transferPayload.error,
        events: Array.isArray(transferPayload.events) ? transferPayload.events.slice(-10) : [],
        checkpointSummary: transferPayload.checkpointSummary?.slice(-4) ?? [],
        _note: 'worker result trimmed after write failure',
      };
      await atomicWriteJson(payload.resultPath, stripped);
    } catch {
      throw writeErr;
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

