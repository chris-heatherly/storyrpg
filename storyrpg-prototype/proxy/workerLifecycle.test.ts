import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkerLifecycle, __test__ } = require('./workerLifecycle.js');

function createInMemoryStore(initial = []) {
  let value = JSON.parse(JSON.stringify(initial));
  return {
    get: () => JSON.parse(JSON.stringify(value)),
    set: (next) => {
      value = JSON.parse(JSON.stringify(next));
    },
  };
}

function makeLifecycle() {
  const stores = new Map();
  return createWorkerLifecycle({
    rootDir: process.cwd(),
    runtimeRoot: process.cwd(),
    port: 3001,
    cachedJsonStore: (file, label) => {
      if (!stores.has(label)) stores.set(label, createInMemoryStore([]));
      return stores.get(label);
    },
    createSyncGenerationMirrorFromWorker: () => () => undefined,
    estimateWorkerProgress: (_mode, _phase, _eventType, prevProgress) => prevProgress,
  });
}

function registerRouteHarness(lifecycle) {
  const routes = {
    get: new Map(),
    patch: new Map(),
    post: new Map(),
  };
  lifecycle.registerWorkerLifecycleRoutes({
    get: (path, handler) => routes.get.set(path, handler),
    patch: (path, handler) => routes.patch.set(path, handler),
    post: (path, handler) => routes.post.set(path, handler),
  });
  return routes;
}

function invokeJsonRoute(handler, req) {
  let statusCode = 200;
  let body;
  const res = {
    status: (nextStatus) => {
      statusCode = nextStatus;
      return res;
    },
    json: (nextBody) => {
      body = nextBody;
      return res;
    },
  };
  handler(req, res);
  return { statusCode, body };
}

describe('workerLifecycle resume checkpoint normalization', () => {
  it('uses server provider credentials over stale non-empty client keys', () => {
    const agents = {
      sceneWriter: { provider: 'gemini', model: 'gemini-test', apiKey: 'stale-client-key' },
      storyArchitect: { provider: 'anthropic', model: 'claude-test', apiKey: 'client-anthropic' },
    };
    __test__.applyAuthoritativeNarrativeProviderKeys(agents, {
      gemini: 'server-gemini-key', anthropic: 'server-anthropic-key', openai: '', openrouter: '',
    });
    expect(agents.sceneWriter.apiKey).toBe('server-gemini-key');
    expect(agents.storyArchitect.apiKey).toBe('server-anthropic-key');
  });

  it('hashes worker settings deterministically and changes on media/council changes', () => {
    const base = { agents: { writer: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'key' } }, imageGen: { enabled: false }, qualityCouncil: { enabled: false } };
    expect(__test__.computeWorkerJobConfigHash('generation', base)).toBe(__test__.computeWorkerJobConfigHash('generation', { qualityCouncil: { enabled: false }, imageGen: { enabled: false }, agents: base.agents }));
    expect(__test__.computeWorkerJobConfigHash('generation', base)).not.toBe(__test__.computeWorkerJobConfigHash('generation', { ...base, imageGen: { enabled: true } }));
  });

  it('keeps failed worker steps out of the completed checkpoint path', () => {
    expect(__test__.didWorkerStepSucceed({ type: 'step_complete', success: false, output: { success: false } })).toBe(false);
    expect(__test__.didWorkerStepSucceed({ type: 'step_complete', success: true, output: { success: true } })).toBe(true);
  });

  it('does not classify architecture craft gate messages as scene-content resume failures', () => {
    expect(__test__.isArchitectureResumeFailure(
      'Architecture craft gate(s) failed after retries: [SceneTurnContract] Scene s2-2-late-night-writing lacks a power-dynamic shift.',
      {
        failurePhase: 'generation',
        failureStepId: 'generation',
        resumeFromStepId: 'generation',
      },
    )).toBe(true);

    expect(__test__.isArchitectureResumeFailure(
      'SceneWriter.execute(s2-2-late-night-writing) timed out',
      {
        failurePhase: 'scene_content',
        failureStepId: 'scene_content:s2-2-late-night-writing',
      },
    )).toBe(false);
  });

  it('preserves typed semantic failure ownership and receipt references', () => {
    expect(__test__.buildFailureContextFromEvent({
      message: 'Semantic validation remained inconclusive.',
      failurePhase: 'scene_content',
      failureStepId: 'scene_writer:premise_realization',
      failureKind: 'pipeline',
      failureArtifactKey: 'episode-1-scene-s1-semantic-validation.json',
      resumeFromStepId: 'scene_writer:premise_realization',
      context: {
        failureCode: 'semantic_validation_inconclusive',
        failureOwnerStage: 'scene_writer',
        retryClass: 'repair_final_contract',
        issueCodes: ['premise_not_realized'],
        artifactRefs: ['episode-1-scene-s1-semantic-validation.json'],
        repairTarget: 'premise_realization',
      },
      timestamp: '2026-07-13T23:00:00.000Z',
    })).toMatchObject({
      failureCode: 'semantic_validation_inconclusive',
      failureOwnerStage: 'scene_writer',
      retryClass: 'repair_final_contract',
      issueCodes: ['premise_not_realized'],
      artifactRefs: ['episode-1-scene-s1-semantic-validation.json'],
      repairTarget: 'premise_realization',
      failureArtifactKey: 'episode-1-scene-s1-semantic-validation.json',
      resumeFromStepId: 'scene_writer:premise_realization',
    });
  });

  it('marks durable checkpoint outputs completed so resume reuses foundation artifacts', () => {
    const normalized = __test__.normalizeResumeStepsForOutputs(
      {
        output_directory: {
          stepId: 'output_directory',
          status: 'running',
          updatedAt: '2026-06-26T01:00:00.000Z',
        },
        queued: {
          stepId: 'queued',
          status: 'completed',
          updatedAt: '2026-06-26T01:00:00.000Z',
        },
      },
      {
        world_bible: { id: 'world' },
        character_bible: { id: 'characters' },
        output_directory: { outputDirectory: 'generated-stories/bite-me' },
        generation: { partial: true },
      },
      '2026-06-26T02:00:00.000Z',
    );

    expect(normalized.world_bible).toMatchObject({
      stepId: 'world_bible',
      status: 'completed',
      updatedAt: '2026-06-26T02:00:00.000Z',
    });
    expect(normalized.character_bible).toMatchObject({
      stepId: 'character_bible',
      status: 'completed',
      updatedAt: '2026-06-26T02:00:00.000Z',
    });
    expect(normalized.output_directory).toMatchObject({
      stepId: 'output_directory',
      status: 'completed',
      updatedAt: '2026-06-26T02:00:00.000Z',
    });
    expect(normalized.generation).toBeUndefined();
    expect(normalized.queued.status).toBe('completed');
  });
});

describe('workerLifecycle public progress transport', () => {
  it('advances analysis jobs into the season-plan phase from worker step events', () => {
    const update = __test__.buildAnalysisStepProgressUpdate(
      'analysis',
      { type: 'step_start', step: 'season_plan' },
      70,
      '2026-07-15T18:06:44.193Z',
      (_mode, phase) => phase === 'season_plan' ? 90 : 70,
    );

    expect(update).toEqual({
      currentPhase: 'season_plan',
      progress: 90,
      phaseProgress: 0,
      subphaseLabel: 'Building season plan',
      lastWorkerEventAt: '2026-07-15T18:06:44.193Z',
      lastWorkerEventType: 'step_start',
    });
  });

  it('keeps full step outputs out of timelines while retaining completion evidence', () => {
    const compact = __test__.compactWorkerTimelineEntry({
      type: 'step_complete',
      step: 'season_plan',
      timestamp: '2026-07-15T18:09:32.920Z',
      output: { success: true, data: { episodes: Array.from({ length: 1000 }, (_, index) => ({ index })) } },
    });

    expect(compact.output).toBeUndefined();
    expect(compact.outputSummary).toEqual({ omitted: true, success: true });
    expect(JSON.stringify(compact).length).toBeLessThan(500);
  });

  it('returns a compact polling snapshot without result or checkpoint outputs', () => {
    const status = __test__.publicWorkerStatus({
      id: 'worker-analysis',
      status: 'completed',
      progress: 100,
      currentPhase: 'season_plan',
      result: { seasonPlan: { episodes: Array.from({ length: 1000 }, (_, index) => ({ index })) } },
      checkpoint: {
        jobId: 'worker-analysis',
        steps: { season_plan: { status: 'completed' } },
        outputs: { season_plan: { episodes: Array.from({ length: 1000 }, (_, index) => ({ index })) } },
      },
      timeline: [{
        type: 'step_complete',
        step: 'season_plan',
        output: { episodes: Array.from({ length: 1000 }, (_, index) => ({ index })) },
      }],
    }, { includeTimeline: true });

    expect(status.result).toBeUndefined();
    expect(status.checkpoint.outputs).toBeUndefined();
    expect(status.timelineLength).toBe(1);
    expect(status.timeline[0].output).toBeUndefined();
    expect(JSON.stringify(status).length).toBeLessThan(1000);
  });

  it('serves completion results separately from the compact status route', () => {
    const lifecycle = makeLifecycle();
    const routes = registerRouteHarness(lifecycle);
    lifecycle.saveWorkerJobs([{
      id: 'worker-complete',
      mode: 'analysis',
      status: 'completed',
      progress: 100,
      timeline: [{ type: 'step_complete', step: 'season_plan', output: { large: 'x'.repeat(5000) } }],
    }]);
    lifecycle.workerResultCache.set('worker-complete', {
      storedAt: Date.now(),
      result: { success: true, seasonPlan: { id: 'season-plan-1' } },
    });

    const statusResponse = invokeJsonRoute(
      routes.get.get('/worker-jobs/:jobId'),
      { params: { jobId: 'worker-complete' } },
    );
    const resultResponse = invokeJsonRoute(
      routes.get.get('/worker-jobs/:jobId/result'),
      { params: { jobId: 'worker-complete' } },
    );

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.body.result).toBeUndefined();
    expect(JSON.stringify(statusResponse.body).length).toBeLessThan(1000);
    expect(resultResponse).toEqual({
      statusCode: 200,
      body: { success: true, seasonPlan: { id: 'season-plan-1' } },
    });
  });

  it('migrates bulky persisted mirrors without changing authoritative checkpoints', () => {
    const generationJob = __test__.compactPersistedGenerationJob({
      id: 'generation-job',
      checkpoint: {
        isResumable: true,
        failureContext: { message: 'retry me' },
        outputs: { season_plan: { large: 'x'.repeat(5000) } },
      },
    });
    const workerJob = __test__.compactPersistedWorkerJob({
      id: 'worker-job',
      status: 'completed',
      resumeContext: { requestPayload: { source: 'x'.repeat(5000) }, approvedStyleSetup: true },
      resumeCheckpoint: { outputs: { season_plan: { large: 'x'.repeat(5000) } } },
      timeline: [{ type: 'step_complete', step: 'season_plan', output: { large: 'x'.repeat(5000) } }],
    });

    expect(generationJob.checkpoint).toEqual({
      isResumable: true,
      failureContext: { message: 'retry me' },
    });
    expect(workerJob.timeline[0].output).toBeUndefined();
    expect(workerJob.timeline[0].outputSummary).toEqual({ omitted: true, success: undefined });
    expect(workerJob.resumeContext).toEqual(expect.objectContaining({
      approvedStyleSetup: true,
      requestPayloadSummary: expect.any(Object),
    }));
    expect(workerJob.resumeContext.requestPayload).toBeUndefined();
    expect(workerJob.resumeCheckpoint).toBeUndefined();
  });
});

describe('workerLifecycle stale/orphan diagnostics', () => {
  it('records orphan evidence when a running worker is no longer tracked and its pid is gone', () => {
    const lifecycle = makeLifecycle();
    lifecycle.saveWorkerJobs([{
      id: 'worker-orphan',
      status: 'running',
      pid: -1,
      currentPhase: 'world',
      updatedAt: new Date().toISOString(),
      lastHeartbeatAt: '2026-06-26T16:10:00.000Z',
      lastWorkerEventAt: '2026-06-26T16:10:01.000Z',
      lastWorkerEventType: 'pipeline_event',
      lastPipelineEventAt: '2026-06-26T16:10:01.000Z',
      lastPipelinePhase: 'world',
      lastPipelineMessage: 'Executing revision to fix 2 quality issues',
    }]);
    lifecycle.saveCheckpoints([{
      jobId: 'worker-orphan',
      lastEvent: { type: 'pipeline_event', phase: 'world', message: 'Starting location ID:' },
      outputs: { output_directory: { outputDirectory: 'generated-stories/bite-me/' } },
    }]);

    const { normalized, changed } = lifecycle.normalizeStaleWorkerJobs(lifecycle.loadWorkerJobs());

    expect(changed).toBe(true);
    expect(normalized[0]).toMatchObject({
      status: 'failed',
      error: 'Worker process exited unexpectedly (orphaned running job)',
      failureContext: {
        failureKind: 'orphaned_worker',
        context: {
          trackedByProxy: false,
          pidAlive: false,
          lastHeartbeatAt: '2026-06-26T16:10:00.000Z',
          lastPipelinePhase: 'world',
          lastPipelineMessage: 'Executing revision to fix 2 quality issues',
          outputDirectory: 'generated-stories/bite-me/',
        },
      },
    });
    expect(lifecycle.deadLetterStore.get()[0]).toMatchObject({
      reason: 'orphaned_process',
      failureKind: 'orphaned_worker',
      trackedByProxy: false,
      pidAlive: false,
      lastPipelinePhase: 'world',
    });
  });

  it('classifies a tracked stale running worker as a heartbeat timeout with diagnostics', () => {
    const lifecycle = makeLifecycle();
    lifecycle.saveWorkerJobs([{
      id: 'worker-stale',
      status: 'running',
      pid: -1,
      currentPhase: 'world',
      updatedAt: '2026-06-26T16:00:00.000Z',
      lastHeartbeatAt: '2026-06-26T16:00:00.000Z',
      lastPipelinePhase: 'world',
      lastPipelineMessage: 'Waiting on provider call',
    }]);
    lifecycle.activeWorkers.set('worker-stale', { proc: { pid: -1 } });

    const { normalized, changed } = lifecycle.normalizeStaleWorkerJobs(lifecycle.loadWorkerJobs());

    expect(changed).toBe(true);
    expect(normalized[0]).toMatchObject({
      status: 'failed',
      failureContext: {
        failureKind: 'worker_heartbeat_timeout',
        context: {
          trackedByProxy: true,
          pidAlive: false,
          lastHeartbeatAt: '2026-06-26T16:00:00.000Z',
          lastPipelinePhase: 'world',
          lastPipelineMessage: 'Waiting on provider call',
        },
      },
    });
    expect(normalized[0].error).toContain('Worker stale');
    expect(lifecycle.deadLetterStore.get()[0]).toMatchObject({
      reason: 'stale',
      failureKind: 'worker_heartbeat_timeout',
      trackedByProxy: true,
      pidAlive: false,
      lastHeartbeatAt: '2026-06-26T16:00:00.000Z',
    });
  });
});
