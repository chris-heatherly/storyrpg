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
