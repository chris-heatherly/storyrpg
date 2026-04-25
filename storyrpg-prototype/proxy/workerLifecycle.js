/**
 * Worker lifecycle — durable orchestration for the AI pipeline.
 *
 * This module owns:
 *   - The `activeWorkers` / `workerStreamClients` / `workerResultCache`
 *     in-memory registries
 *   - The `worker-jobs.json`, `worker-checkpoints.json`, and
 *     `worker-dead-letter.json` cached stores
 *   - The `startWorkerProcess()` spawn/stream/close state machine
 *   - The `/worker-jobs/*` HTTP routes
 *
 * The exported `createWorkerLifecycle()` returns a bundle of
 * state + helpers so sibling modules (e.g. generation-job routes) can
 * reach into the same worker store without importing the bootstrap file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WORKER_STALE_RUNNING_MS = 3 * 60 * 1000;
const WORKER_MAX_TIMELINE = 200;
const WORKER_MAX_IMAGE_JOBS = 200;
const WORKER_MAX_VIDEO_JOBS = 200;
const WORKER_MAX_IMAGE_MANIFEST = 200;
const WORKER_MAX_CHECKPOINT_ARTIFACTS = 100;
const WORKER_COMPLETED_PRUNE_MS = 2 * 60 * 60 * 1000;
const WORKER_RESULT_TTL_MS = 10 * 60 * 1000;
const JOB_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

function stripLargeValues(obj, maxStringLen = 512) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => stripLargeValues(item, maxStringLen));
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      if (val.startsWith('data:') && val.length > 200) {
        result[key] = null;
      } else if (val.length > maxStringLen) {
        result[key] = `${val.slice(0, maxStringLen)}...[truncated]`;
      } else {
        result[key] = val;
      }
    } else if (val && typeof val === 'object') {
      result[key] = stripLargeValues(val, maxStringLen);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function isMissingApiKey(value) {
  if (typeof value !== 'string') return true;
  const v = value.trim().toLowerCase();
  return !v || v === 'dummy' || v === 'placeholder' || v === 'your-api-key';
}

function buildWorkerConfigSnapshot(config) {
  if (!config || typeof config !== 'object') return undefined;

  const summarizeAgent = (agentCfg) => {
    if (!agentCfg || typeof agentCfg !== 'object') return undefined;
    return stripLargeValues({
      provider: agentCfg.provider,
      model: agentCfg.model,
      maxTokens: agentCfg.maxTokens,
      temperature: agentCfg.temperature,
      apiKeyConfigured: !isMissingApiKey(agentCfg.apiKey),
    }, 200);
  };

  const agents = config.agents && typeof config.agents === 'object'
    ? Object.fromEntries(
      Object.entries(config.agents)
        .map(([agentName, agentCfg]) => [agentName, summarizeAgent(agentCfg)])
        .filter(([, agentCfg]) => !!agentCfg),
    )
    : undefined;

  return stripLargeValues({
    outputDir: config.outputDir,
    artStyle: config.artStyle,
    imageGen: config.imageGen ? {
      enabled: !!config.imageGen.enabled,
      provider: config.imageGen.provider,
      model: config.imageGen.model,
      apiKeyConfigured: !isMissingApiKey(config.imageGen.apiKey),
    } : undefined,
    videoGen: config.videoGen ? {
      enabled: !!config.videoGen.enabled,
      model: config.videoGen.model,
      durationSeconds: config.videoGen.durationSeconds,
      resolution: config.videoGen.resolution,
      aspectRatio: config.videoGen.aspectRatio,
      strategy: config.videoGen.strategy,
      apiKeyConfigured: !isMissingApiKey(config.videoGen.apiKey),
    } : undefined,
    narration: config.narration ? {
      enabled: !!config.narration.enabled,
      preGenerateAudio: !!config.narration.preGenerateAudio,
      autoPlay: !!config.narration.autoPlay,
      highlightMode: config.narration.highlightMode,
      elevenLabsConfigured: !isMissingApiKey(config.narration.elevenLabsApiKey),
      voiceIdConfigured: typeof config.narration.voiceId === 'string' && config.narration.voiceId.trim().length > 0,
    } : undefined,
    agents: agents && Object.keys(agents).length > 0 ? agents : undefined,
  }, 200);
}

function buildWorkerRequestSnapshot(mode, payload, explicitStoryTitle) {
  const generationInput = payload?.generationInput;
  const analysisInput = payload?.analysisInput;
  const brief = generationInput?.brief;

  return stripLargeValues({
    mode,
    storyTitle: explicitStoryTitle
      || brief?.story?.title
      || analysisInput?.title
      || undefined,
    config: buildWorkerConfigSnapshot(payload?.config),
    input: mode === 'generation'
      ? {
        episodeRange: generationInput?.episodeRange,
        hasSourceAnalysis: !!generationInput?.sourceAnalysis,
        story: brief?.story ? { title: brief.story.title, genre: brief.story.genre } : undefined,
        episode: brief?.episode ? { number: brief.episode.number, title: brief.episode.title } : undefined,
        hasSeasonPlan: !!brief?.seasonPlan,
      }
      : {
        title: analysisInput?.title,
        hasPrompt: !!analysisInput?.prompt,
        sourceTextLength: typeof analysisInput?.sourceText === 'string' ? analysisInput.sourceText.length : 0,
        preferences: analysisInput?.preferences,
      },
  }, 200);
}

function resolveVideoUrl(videoUrl, port) {
  if (typeof videoUrl !== 'string') return videoUrl;
  const gsIdx = videoUrl.indexOf('generated-stories/');
  if (gsIdx >= 0 && !videoUrl.startsWith('http')) {
    return `http://localhost:${port}/${videoUrl.slice(gsIdx)}`;
  }
  return videoUrl;
}

function resolveImageUrl(imageUrl, identifier, existingImageJobs, port) {
  if (typeof imageUrl !== 'string') return imageUrl;

  function inferImagesBase() {
    const ref = (existingImageJobs || []).find((j) => j.imageUrl && j.imageUrl.startsWith('http') && j.imageUrl.includes('/images/'));
    if (ref) {
      const imagesIdx = ref.imageUrl.lastIndexOf('/images/');
      if (imagesIdx > 0) return ref.imageUrl.slice(0, imagesIdx + '/images/'.length);
    }
    return null;
  }

  if (imageUrl.startsWith('data:') && imageUrl.length > 200) {
    if (identifier) {
      const base = inferImagesBase();
      if (base) return `${base}${identifier}.png`;
    }
    return null;
  }

  const gsIdx = imageUrl.indexOf('generated-stories/');
  if (gsIdx >= 0 && !imageUrl.startsWith('http')) {
    return `http://localhost:${port}/${imageUrl.slice(gsIdx)}`;
  }

  return imageUrl;
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function mergeJsonLike(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const merged = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = mergeJsonLike(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function createWorkerLifecycle({
  rootDir,
  port,
  cachedJsonStore,
  createStoryCatalogApi, // unused directly; retained for callers that need listLatestStoryRecords
  createSyncGenerationMirrorFromWorker,
  estimateWorkerProgress,
}) {
  if (!rootDir || !port || !cachedJsonStore || !createSyncGenerationMirrorFromWorker || !estimateWorkerProgress) {
    throw new Error('createWorkerLifecycle requires rootDir, port, cachedJsonStore, createSyncGenerationMirrorFromWorker, and estimateWorkerProgress');
  }

  const JOBS_FILE = path.resolve(rootDir, '.generation-jobs.json');
  const WORKER_JOBS_FILE = path.resolve(rootDir, '.worker-jobs.json');
  const WORKER_CHECKPOINTS_FILE = path.resolve(rootDir, '.worker-checkpoints.json');
  const WORKER_DEAD_LETTER_FILE = path.resolve(rootDir, '.worker-dead-letter.json');
  const WORKER_CHECKPOINT_OUTPUT_DIR = path.resolve(rootDir, '.worker-checkpoint-outputs');

  const jobsStore = cachedJsonStore(JOBS_FILE, 'generation-jobs');
  const workerJobsStore = cachedJsonStore(WORKER_JOBS_FILE, 'worker-jobs');
  const checkpointsStore = cachedJsonStore(WORKER_CHECKPOINTS_FILE, 'worker-checkpoints');
  const deadLetterStore = cachedJsonStore(WORKER_DEAD_LETTER_FILE, 'worker-dead-letter');

  const activeWorkers = new Map();
  const workerStreamClients = new Map();
  const workerResultCache = new Map();

  const loadJobs = () => jobsStore.get();
  const saveJobs = (jobs) => jobsStore.set(jobs);
  const loadWorkerJobs = () => workerJobsStore.get();
  const saveWorkerJobs = (jobs) => workerJobsStore.set(jobs);
  const loadCheckpoints = () => checkpointsStore.get();
  const saveCheckpoints = (rows) => checkpointsStore.set(rows);

  function ensureWorkerCheckpointOutputDir(jobId) {
    const dir = path.join(WORKER_CHECKPOINT_OUTPUT_DIR, jobId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function persistCheckpointOutput(jobId, stepId, output) {
    const dir = ensureWorkerCheckpointOutputDir(jobId);
    const safeStepId = String(stepId || 'unknown').replace(/[^a-z0-9._-]+/gi, '-');
    const filePath = path.join(dir, `${safeStepId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(output), 'utf8');
    return filePath;
  }

  function restoreCheckpointOutput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (!value.__checkpointFile) return value;
    try {
      return JSON.parse(fs.readFileSync(value.__checkpointFile, 'utf8'));
    } catch (err) {
      console.warn(`[Proxy] Failed to restore checkpoint output from ${value.__checkpointFile}:`, err.message);
      return undefined;
    }
  }

  function hydrateCheckpointOutputs(checkpoint) {
    if (!checkpoint?.outputs || typeof checkpoint.outputs !== 'object') return checkpoint;
    const hydratedOutputs = {};
    for (const [stepId, value] of Object.entries(checkpoint.outputs)) {
      hydratedOutputs[stepId] = restoreCheckpointOutput(value);
    }
    return { ...checkpoint, outputs: hydratedOutputs };
  }

  function getOutputDirectoryFromCheckpoint(checkpoint) {
    return checkpoint?.resumeContext?.outputDirectory
      || checkpoint?.outputs?.output_directory?.outputDirectory
      || checkpoint?.failureContext?.context?.outputDirectory;
  }

  function resolveOutputDirectory(outputDirectory) {
    if (!outputDirectory || typeof outputDirectory !== 'string') return null;
    return path.isAbsolute(outputDirectory)
      ? outputDirectory
      : path.resolve(rootDir, outputDirectory);
  }

  function loadResumeManifest(checkpoint) {
    const outputDirectory = getOutputDirectoryFromCheckpoint(checkpoint);
    const outputDirAbs = resolveOutputDirectory(outputDirectory);
    if (!outputDirAbs) return { outputDirectory, manifest: null };
    const manifestPath = path.join(outputDirAbs, 'checkpoints', 'checkpoint-manifest.json');
    try {
      if (!fs.existsSync(manifestPath)) return { outputDirectory, manifest: null };
      return { outputDirectory, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    } catch (err) {
      return {
        outputDirectory,
        manifest: null,
        manifestError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function buildResumePlan(job, checkpoint) {
    const failure = job.failureContext || checkpoint?.failureContext || {};
    const message = String(failure.message || job.error || '');
    const { outputDirectory, manifest, manifestError } = loadResumeManifest(checkpoint);
    const units = manifest?.units && typeof manifest.units === 'object' ? manifest.units : {};
    const unitIds = Object.keys(units);
    const reusableUnits = unitIds.filter((id) => units[id]?.status === 'completed');
    let strategy = 'generation';
    let failedUnit = failure.failureStepId || failure.failurePhase || job.currentPhase || 'generation';
    let resumeFromUnit = failure.resumeFromStepId || failedUnit;

    const sceneMatch = message.match(/SceneWriter\.execute\(([^)\s]+)\)/i)
      || message.match(/scene\s+([a-z0-9._-]+)/i);
    if (/final.*save|story package|manifest|writeFinalStoryPackage|nodeRequire/i.test(message)) {
      strategy = 'save';
      failedUnit = 'final_story_package';
      resumeFromUnit = 'final_story_package';
    } else if (/image|encounter_images|images_ep/i.test(message) || /image/i.test(String(failure.failurePhase || ''))) {
      strategy = 'images';
      failedUnit = String(failure.failurePhase || 'image_generation');
      resumeFromUnit = 'missing_or_failed_image_slots';
    } else if (sceneMatch?.[1]) {
      strategy = 'scene';
      failedUnit = `scene_content:${sceneMatch[1]}`;
      resumeFromUnit = failedUnit;
    }

    return {
      jobId: job.id,
      status: job.status,
      strategy,
      failedUnit,
      resumeFromUnit,
      outputDirectory,
      reusableUnitCount: reusableUnits.length,
      reusableUnits: reusableUnits.slice(0, 50),
      manifestAvailable: Boolean(manifest),
      manifestError,
      humanSummary: strategy === 'scene'
        ? `Resume will reuse ${reusableUnits.length} completed checkpoint unit(s) and restart around ${resumeFromUnit}.`
        : strategy === 'images'
          ? `Resume will reuse story/text checkpoints where available and image cache entries in the existing output directory.`
          : strategy === 'save'
            ? `Resume should only rewrite the final story package if a final-story checkpoint is available.`
            : `Resume will reuse durable checkpoints where available; older jobs may restart broad phases.`,
    };
  }

  function buildFailureContextFromEvent(evt, job) {
    return stripLargeValues({
      message: evt.message || job?.error || 'Worker job failed',
      stack: evt.stack,
      failurePhase: evt.failurePhase || job?.currentPhase || 'generation',
      failureStepId: evt.failureStepId || evt.failurePhase || job?.currentPhase || 'generation',
      failureKind: evt.failureKind || 'worker',
      failureArtifactKey: evt.failureArtifactKey,
      resumeFromStepId: evt.resumeFromStepId || evt.failureStepId || evt.failurePhase || job?.currentPhase || 'generation',
      resumePatchableInputs: Array.isArray(evt.resumePatchableInputs) ? evt.resumePatchableInputs : ['settings'],
      context: evt.context,
      timestamp: evt.timestamp || new Date().toISOString(),
    }, 400);
  }

  function appendDeadLetter(entry) {
    const rows = deadLetterStore.get();
    rows.unshift(entry);
    if (rows.length > 200) rows.length = 200;
    deadLetterStore.set(rows);
  }

  function upsertWorkerJob(jobId, updates) {
    const jobs = loadWorkerJobs();
    const idx = jobs.findIndex((j) => j.id === jobId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...updates, updatedAt: now };
    } else {
      jobs.unshift({ id: jobId, createdAt: now, updatedAt: now, ...updates });
    }

    const job = jobs.find((j) => j.id === jobId);
    if (job) {
      if (Array.isArray(job.imageJobs) && job.imageJobs.length > WORKER_MAX_IMAGE_JOBS) {
        job.imageJobs = job.imageJobs.slice(-WORKER_MAX_IMAGE_JOBS);
      }
      if (Array.isArray(job.videoJobs) && job.videoJobs.length > WORKER_MAX_VIDEO_JOBS) {
        job.videoJobs = job.videoJobs.slice(-WORKER_MAX_VIDEO_JOBS);
      }
      if (Array.isArray(job.imageManifest) && job.imageManifest.length > WORKER_MAX_IMAGE_MANIFEST) {
        job.imageManifest = job.imageManifest.slice(-WORKER_MAX_IMAGE_MANIFEST);
      }
      if (Array.isArray(job.timeline) && job.timeline.length > WORKER_MAX_TIMELINE) {
        job.timeline = job.timeline.slice(-WORKER_MAX_TIMELINE);
      }
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        delete job.result;
        delete job.imageJobs;
        delete job.imageManifest;
      }
    }

    if (jobs.length > 200) jobs.length = 200;
    saveWorkerJobs(jobs);
    const updated = jobs.find((j) => j.id === jobId);
    const clients = workerStreamClients.get(jobId);
    if (updated && clients && clients.size > 0) {
      const frame = `event: status\ndata: ${JSON.stringify(updated)}\n\n`;
      for (const client of clients) {
        try {
          client.write(frame);
        } catch {
          clients.delete(client);
        }
      }
      if (clients.size === 0) workerStreamClients.delete(jobId);
    }
    return updated;
  }

  function appendWorkerTimeline(jobId, entry) {
    const jobs = loadWorkerJobs();
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return;
    const timeline = Array.isArray(jobs[idx].timeline) ? jobs[idx].timeline : [];
    const safeEntry = stripLargeValues(entry);
    timeline.push(safeEntry);
    if (timeline.length > WORKER_MAX_TIMELINE) {
      timeline.splice(0, timeline.length - WORKER_MAX_TIMELINE);
    }
    jobs[idx].timeline = timeline;
    jobs[idx].updatedAt = new Date().toISOString();
    saveWorkerJobs(jobs);
    const clients = workerStreamClients.get(jobId);
    if (clients && clients.size > 0) {
      const frame = `event: timeline\ndata: ${JSON.stringify(safeEntry)}\n\n`;
      for (const client of clients) {
        try {
          client.write(frame);
        } catch {
          clients.delete(client);
        }
      }
      if (clients.size === 0) workerStreamClients.delete(jobId);
    }
  }

  function updateCheckpoint(jobId, patch) {
    const rows = loadCheckpoints();
    const idx = rows.findIndex((r) => r.jobId === jobId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      const merged = [...(rows[idx].artifacts || []), ...(patch.artifacts || [])];
      if (merged.length > WORKER_MAX_CHECKPOINT_ARTIFACTS) {
        merged.splice(0, merged.length - WORKER_MAX_CHECKPOINT_ARTIFACTS);
      }
      rows[idx] = {
        ...rows[idx],
        ...patch,
        updatedAt: now,
        steps: { ...(rows[idx].steps || {}), ...(patch.steps || {}) },
        outputs: { ...(rows[idx].outputs || {}), ...(patch.outputs || {}) },
        artifacts: merged,
        failureContext: patch.failureContext ? mergeJsonLike(rows[idx].failureContext, patch.failureContext) : rows[idx].failureContext,
        resumeContext: patch.resumeContext ? mergeJsonLike(rows[idx].resumeContext, patch.resumeContext) : rows[idx].resumeContext,
      };
    } else {
      rows.unshift({
        jobId,
        createdAt: now,
        updatedAt: now,
        steps: patch.steps || {},
        artifacts: (patch.artifacts || []).slice(-WORKER_MAX_CHECKPOINT_ARTIFACTS),
        outputs: patch.outputs || {},
        idempotencyKey: patch.idempotencyKey,
        lastEvent: patch.lastEvent,
        failureContext: patch.failureContext,
        resumeContext: patch.resumeContext,
      });
    }
    saveCheckpoints(rows);
  }

  function markArtifactCommitted(jobId, artifactKey, meta = {}) {
    updateCheckpoint(jobId, {
      artifacts: [{ artifactKey, committedAt: new Date().toISOString(), ...meta }],
    });
  }

  const syncGenerationMirrorFromWorker = createSyncGenerationMirrorFromWorker({
    loadCheckpoints,
    loadJobs,
    saveJobs,
  });

  function normalizeStaleRunningJobs(jobs) {
    const now = Date.now();
    let changed = false;
    const normalized = jobs.map((job) => {
      if (!job || (job.status !== 'running' && job.status !== 'pending')) return job;

      const heartbeatIso = job.updatedAt || job.startedAt;
      const heartbeatMs = heartbeatIso ? new Date(heartbeatIso).getTime() : NaN;
      if (!Number.isFinite(heartbeatMs)) return job;

      const staleMs = now - heartbeatMs;
      if (staleMs < JOB_STALE_RUNNING_MS) return job;

      changed = true;
      const staleMinutes = Math.round(staleMs / 60000);
      const previousStatus = job.status;
      console.warn(`[Proxy] Auto-failing stale job ${job.id} (${previousStatus}, no update for ${staleMinutes} min)`);
      return {
        ...job,
        status: 'failed',
        error: job.error || `Job timed out after ${staleMinutes} minutes without progress updates`,
        updatedAt: new Date().toISOString(),
      };
    });
    return { normalized, changed };
  }

  function normalizeStaleWorkerJobs(jobs) {
    let changed = false;
    const now = Date.now();
    const normalized = jobs.map((job) => {
      if (!job || (job.status !== 'running' && job.status !== 'pending')) return job;
      if (job.status === 'running') {
        const tracked = activeWorkers.has(job.id);
        const pidAlive = isProcessAlive(job.pid);
        if (!tracked && !pidAlive) {
          changed = true;
          const failed = {
            ...job,
            status: 'failed',
            error: job.error || 'Worker process exited unexpectedly (orphaned running job)',
            updatedAt: new Date().toISOString(),
            deadLetter: true,
          };
          appendDeadLetter({
            jobId: job.id,
            reason: 'orphaned_process',
            pid: job.pid,
            at: failed.updatedAt,
          });
          return failed;
        }
      }

      const heartbeat = new Date(job.updatedAt || job.createdAt || 0).getTime();
      if (!Number.isFinite(heartbeat)) return job;
      if (now - heartbeat < WORKER_STALE_RUNNING_MS) return job;
      changed = true;
      const staleMin = Math.round((now - heartbeat) / 60000);
      const failed = {
        ...job,
        status: 'failed',
        error: job.error || `Worker stale for ${staleMin} minutes`,
        updatedAt: new Date().toISOString(),
        deadLetter: true,
      };
      appendDeadLetter({
        jobId: job.id,
        reason: 'stale',
        staleMinutes: staleMin,
        at: failed.updatedAt,
      });
      return failed;
    });
    return { normalized, changed };
  }

  function startWorkerProcess(workerJob, payload) {
    const runnerPath = path.resolve(rootDir, 'src/ai-agents/server/worker-runner.ts');
    const payloadPath = path.join(os.tmpdir(), `storyrpg-worker-${workerJob.id}.payload.json`);
    const resultPath = path.join(os.tmpdir(), `storyrpg-worker-${workerJob.id}.result.json`);
    fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, externalJobId: workerJob.id, resultPath }, null, 2), 'utf8');

    const proc = spawn('npx', [
      'ts-node',
      '-r',
      'tsconfig-paths/register',
      '--project',
      'tsconfig.worker.json',
      '--transpile-only',
      runnerPath,
      payloadPath,
    ], {
      cwd: rootDir,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        TS_NODE_PREFER_TS_EXTS: 'true',
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeWorkers.set(workerJob.id, { proc, payloadPath, resultPath });
    upsertWorkerJob(workerJob.id, { status: 'running', pid: proc.pid, startedAt: new Date().toISOString() });

    proc.on('error', (err) => {
      console.error(`[Proxy] Worker spawn error for ${workerJob.id}: ${err.message}`);
      activeWorkers.delete(workerJob.id);
      const failed = upsertWorkerJob(workerJob.id, {
        status: 'failed',
        progress: 100,
        finishedAt: new Date().toISOString(),
        error: `Worker spawn failed: ${err.message}`,
        deadLetter: true,
      });
      appendDeadLetter({ jobId: workerJob.id, reason: 'spawn_error', error: err.message, at: new Date().toISOString() });
      syncGenerationMirrorFromWorker(failed);
    });

    let stdoutBuffer = '';
    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk || '');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (!evt.workerEvent) continue;
          appendWorkerTimeline(workerJob.id, evt);

          if (evt.type === 'pipeline_event') {
            const phase = evt.phase || 'processing';
            const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
            const prevProgress = Number(currentJob?.progress || 0);
            const nextProgress = estimateWorkerProgress(workerJob.mode, phase, evt.eventType, prevProgress, evt.data || null, evt.telemetry || null);
            const updates = {
              currentPhase: phase,
              progress: phase === 'complete' ? 100 : nextProgress,
            };
            if (evt.telemetry && typeof evt.telemetry === 'object') {
              if (typeof evt.telemetry.phaseProgress === 'number') updates.phaseProgress = evt.telemetry.phaseProgress;
              if (typeof evt.telemetry.currentItem === 'number') updates.currentItem = evt.telemetry.currentItem;
              if (typeof evt.telemetry.totalItems === 'number') updates.totalItems = evt.telemetry.totalItems;
              if (typeof evt.telemetry.subphaseLabel === 'string') updates.subphaseLabel = evt.telemetry.subphaseLabel;
              if (typeof evt.telemetry.etaSeconds === 'number' || evt.telemetry.etaSeconds === null) updates.etaSeconds = evt.telemetry.etaSeconds;
              if (typeof evt.telemetry.elapsedSeconds === 'number') updates.elapsedSeconds = evt.telemetry.elapsedSeconds;
            }
            if (evt.data && typeof evt.data.imageIndex === 'number') {
              updates.imageProgress = { current: evt.data.imageIndex, total: evt.data.totalImages || 0 };
            }
            if (evt.eventType === 'checkpoint' && evt.phase === 'image_manifest' && evt.data && Array.isArray(evt.data.shots)) {
              const existing = currentJob?.imageManifest || [];
              const strippedShots = evt.data.shots.map((s) => stripLargeValues(s, 200));
              updates.imageManifest = existing.concat(strippedShots);
            }
            upsertWorkerJob(workerJob.id, updates);
            if (evt.eventType === 'checkpoint' && evt.data && typeof evt.data === 'object' && evt.data.stepId && Object.prototype.hasOwnProperty.call(evt.data, 'output')) {
              const checkpointFile = persistCheckpointOutput(workerJob.id, evt.data.stepId, evt.data.output);
              updateCheckpoint(workerJob.id, {
                outputs: {
                  [evt.data.stepId]: { __checkpointFile: checkpointFile },
                },
                steps: {
                  [evt.data.stepId]: {
                    stepId: evt.data.stepId,
                    status: 'completed',
                    updatedAt: new Date().toISOString(),
                    idempotencyKey: `${workerJob.id}:${evt.data.stepId}`,
                    artifactKey: evt.data.artifactKey,
                  },
                },
              });
              markArtifactCommitted(workerJob.id, evt.data.artifactKey || `checkpoint:${evt.data.stepId}`, { source: 'pipeline-checkpoint' });
            }
            updateCheckpoint(workerJob.id, {
              lastEvent: evt,
              steps: {
                [phase]: {
                  stepId: phase,
                  status: evt.eventType === 'phase_complete' ? 'completed' : 'running',
                  updatedAt: new Date().toISOString(),
                  idempotencyKey: `${workerJob.id}:${phase}`,
                },
              },
            });
          } else if (evt.type === 'image_job_event') {
            const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
            const imageJobs = currentJob?.imageJobs || [];
            const rawData = evt.data || {};
            if (evt.eventType === 'job_added' && rawData.id) {
              // Be idempotent: if the worker (or a provider path inside it)
              // emits `job_added` more than once for the same jobId, merge into
              // the existing entry instead of pushing a duplicate. Duplicate
              // entries caused UI image flicker (completed image reverts to
              // "generating") because the client iterates all entries and the
              // last one wins.
              const existingIdx = imageJobs.findIndex((j) => j.id === rawData.id);
              const promptSummary = typeof rawData.prompt === 'string' ? rawData.prompt.slice(0, 200) : undefined;
              const addEntry = {
                id: rawData.id,
                identifier: rawData.identifier,
                status: rawData.status || 'pending',
                prompt: promptSummary,
                metadata: rawData.metadata,
              };
              if (existingIdx >= 0) {
                imageJobs[existingIdx] = { ...imageJobs[existingIdx], ...addEntry };
              } else {
                imageJobs.push(addEntry);
              }
            } else if (evt.eventType === 'job_updated' && rawData.id) {
              const idx = imageJobs.findIndex((j) => j.id === rawData.id);
              const existingJob = idx >= 0 ? imageJobs[idx] : null;
              const identifier = existingJob?.identifier || rawData.identifier;
              const resolvedUrl = resolveImageUrl(rawData.imageUrl, identifier, imageJobs, port);
              // Only propagate fields that are actually present on the event.
              // Intermediate updates (e.g. a retry tick that reports only
              // `{ error, attempts }`) must NOT wipe out a previously-set
              // `status` or `imageUrl` by merging `undefined` over them.
              const safeUpdates = {};
              if (rawData.status !== undefined) safeUpdates.status = rawData.status;
              if (rawData.progress !== undefined) safeUpdates.progress = rawData.progress;
              if (rawData.error !== undefined) safeUpdates.error = rawData.error;
              if (rawData.attempts !== undefined) safeUpdates.attempts = rawData.attempts;
              if (rawData.endTime !== undefined) safeUpdates.endTime = rawData.endTime;
              if (resolvedUrl !== undefined) safeUpdates.imageUrl = resolvedUrl;
              if (idx >= 0) Object.assign(imageJobs[idx], safeUpdates);
              else imageJobs.push({ id: rawData.id, ...safeUpdates });
            }
            upsertWorkerJob(workerJob.id, { imageJobs });
          } else if (evt.type === 'video_job_event') {
            const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
            const videoJobs = currentJob?.videoJobs || [];
            const rawData = evt.data || {};
            if (evt.eventType === 'job_added' && rawData.id) {
              videoJobs.push({
                id: rawData.id,
                identifier: rawData.identifier,
                status: rawData.status || 'pending',
                sourceImageUrl: resolveImageUrl(rawData.sourceImageUrl, rawData.identifier, currentJob?.imageJobs || [], port),
                metadata: rawData.metadata,
              });
            } else if (evt.eventType === 'job_updated' && rawData.id) {
              const idx = videoJobs.findIndex((j) => j.id === rawData.id);
              const safeUpdates = {
                status: rawData.status,
                progress: rawData.progress,
                error: rawData.error,
                endTime: rawData.endTime,
              };
              const resolvedUrl = resolveVideoUrl(rawData.videoUrl, port);
              if (resolvedUrl !== undefined) safeUpdates.videoUrl = resolvedUrl;
              if (idx >= 0) Object.assign(videoJobs[idx], safeUpdates);
              else videoJobs.push({ id: rawData.id, ...safeUpdates });
            } else if (evt.eventType === 'job_removed' && rawData.id) {
              const idx = videoJobs.findIndex((j) => j.id === rawData.id);
              if (idx >= 0) videoJobs.splice(idx, 1);
            }
            upsertWorkerJob(workerJob.id, { videoJobs });
          } else if (evt.type === 'worker_error') {
            const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id) || workerJob;
            const failureContext = buildFailureContextFromEvent(evt, currentJob);
            upsertWorkerJob(workerJob.id, {
              status: 'failed',
              currentPhase: failureContext.failurePhase || currentJob.currentPhase || 'generation',
              error: failureContext.message,
              failureContext,
              finishedAt: new Date().toISOString(),
            });
            const checkpointPatch = { lastEvent: evt, failureContext };
            const failOutputDir = evt.context?.outputDirectory || failureContext.context?.outputDirectory;
            if (failOutputDir) checkpointPatch.resumeContext = { outputDirectory: failOutputDir };
            updateCheckpoint(workerJob.id, checkpointPatch);
            syncGenerationMirrorFromWorker(loadWorkerJobs().find((j) => j.id === workerJob.id) || currentJob);
          } else if (evt.type === 'step_complete') {
            let persistedOutput = evt.output || true;
            if (evt.output && typeof evt.output === 'object') {
              const checkpointFile = persistCheckpointOutput(workerJob.id, evt.step || 'unknown', evt.output);
              persistedOutput = {
                __checkpointFile: checkpointFile,
                success: evt.output.success,
              };
            }
            updateCheckpoint(workerJob.id, {
              outputs: { [evt.step || 'unknown']: persistedOutput },
              steps: {
                [evt.step || 'unknown']: {
                  stepId: evt.step || 'unknown',
                  status: 'completed',
                  updatedAt: new Date().toISOString(),
                  idempotencyKey: `${workerJob.id}:${evt.step || 'unknown'}`,
                },
              },
            });
            markArtifactCommitted(workerJob.id, `step:${evt.step || 'unknown'}`, { source: 'worker-step' });
          } else if (evt.type === 'heartbeat') {
            upsertWorkerJob(workerJob.id, {});
          }
        } catch {
          appendWorkerTimeline(workerJob.id, {
            workerEvent: true,
            type: 'stdout',
            message: trimmed.slice(0, 1500),
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (!text) return;
      appendWorkerTimeline(workerJob.id, {
        workerEvent: true,
        type: 'stderr',
        message: text.slice(0, 2000),
        timestamp: new Date().toISOString(),
      });
    });

    proc.on('close', (code, signal) => {
      activeWorkers.delete(workerJob.id);
      let result = null;
      if (fs.existsSync(resultPath)) {
        try {
          result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        } catch (e) {
          console.warn(`[Proxy] Failed reading worker result for ${workerJob.id}:`, e.message);
        }
      }

      const isCancelled = (loadWorkerJobs().find((j) => j.id === workerJob.id)?.status) === 'cancelled';
      if (isCancelled) {
        const cancelled = upsertWorkerJob(workerJob.id, { status: 'cancelled', progress: 100, finishedAt: new Date().toISOString() });
        syncGenerationMirrorFromWorker(cancelled);
        return;
      }

      if (code === 0 && result) {
        if (result.success === false) {
          const failureContext = buildFailureContextFromEvent({
            message: result.error || 'Worker returned unsuccessful result',
            failurePhase: result.failurePhase || 'generation',
            failureStepId: result.failureStepId,
            failureKind: result.failureKind || 'pipeline',
            failureArtifactKey: result.failureArtifactKey,
            resumeFromStepId: result.resumeFromStepId,
            resumePatchableInputs: result.resumePatchableInputs,
            context: result.context,
          }, workerJob);
          const failed = upsertWorkerJob(workerJob.id, {
            status: 'failed',
            progress: 100,
            finishedAt: new Date().toISOString(),
            error: failureContext.message,
            failureContext,
          });
          updateCheckpoint(workerJob.id, { failureContext });
          syncGenerationMirrorFromWorker(failed);
        } else {
          const completed = upsertWorkerJob(workerJob.id, {
            status: 'completed',
            progress: 100,
            finishedAt: new Date().toISOString(),
            resultSummary: { success: true },
          });
          workerResultCache.set(workerJob.id, { result, storedAt: Date.now() });
          markArtifactCommitted(workerJob.id, 'job:result', { resultPath });
          syncGenerationMirrorFromWorker(completed);
        }
      } else {
        const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
        const failureContext = currentJob?.failureContext || buildFailureContextFromEvent({
          message: `Worker exited with code=${code} signal=${signal || 'none'}`,
          failureKind: 'worker_exit',
        }, currentJob || workerJob);
        const errorMsg = failureContext.message || `Worker exited with code=${code} signal=${signal || 'none'}`;
        const failed = upsertWorkerJob(workerJob.id, {
          status: 'failed',
          progress: 100,
          finishedAt: new Date().toISOString(),
          error: errorMsg,
          deadLetter: true,
          failureContext,
        });
        updateCheckpoint(workerJob.id, { failureContext });
        appendDeadLetter({
          jobId: workerJob.id,
          reason: 'worker_exit',
          code,
          signal,
          at: new Date().toISOString(),
        });
        syncGenerationMirrorFromWorker(failed);
      }

      try { fs.unlinkSync(payloadPath); } catch {
        // best-effort cleanup; temp file may already be gone
      }
      try { fs.unlinkSync(resultPath); } catch {
        // best-effort cleanup
      }
    });
  }

  function hydrateWorkerConfigApiKeys(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const cfg = payload.config;
    if (!cfg || typeof cfg !== 'object') return payload;
    const agents = cfg.agents;
    if (!agents || typeof agents !== 'object') return payload;

    const envAnthropicKey =
      process.env.ANTHROPIC_API_KEY
      || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
      || process.env.OPENROUTER_API_KEY
      || '';
    const envOpenAiKey =
      process.env.OPENAI_API_KEY
      || process.env.EXPO_PUBLIC_OPENAI_API_KEY
      || '';

    if (!envAnthropicKey && !envOpenAiKey) return payload;

    for (const agentName of Object.keys(agents)) {
      const agentCfg = agents[agentName];
      if (!agentCfg || typeof agentCfg !== 'object') continue;
      if (agentCfg.provider === 'anthropic' && isMissingApiKey(agentCfg.apiKey)) {
        agentCfg.apiKey = envAnthropicKey;
      } else if (agentCfg.provider === 'openai' && isMissingApiKey(agentCfg.apiKey)) {
        agentCfg.apiKey = envOpenAiKey;
      }
    }

    return payload;
  }

  function registerWorkerLifecycleRoutes(app) {
    app.post('/worker-jobs/start', (req, res) => {
      const { mode, payload, idempotencyKey, storyTitle, episodeCount, resumeFromJobId } = req.body || {};
      if (!mode || !payload || (mode !== 'analysis' && mode !== 'generation')) {
        return res.status(400).json({ error: 'Invalid worker start payload' });
      }

      const jobs = loadWorkerJobs();
      const { normalized: normalizedJobs, changed: normalizedChanged } = normalizeStaleWorkerJobs(jobs);
      if (normalizedChanged) {
        saveWorkerJobs(normalizedJobs);
      }
      if (idempotencyKey) {
        const existing = normalizedJobs.find((j) => j.idempotencyKey === idempotencyKey && ['pending', 'running'].includes(j.status));
        if (existing) {
          const tracked = activeWorkers.has(existing.id);
          const pidAlive = isProcessAlive(existing.pid);
          if (existing.status === 'running' && !tracked && !pidAlive) {
            const failed = upsertWorkerJob(existing.id, {
              status: 'failed',
              error: existing.error || 'Worker process exited unexpectedly (orphaned running job)',
              deadLetter: true,
            });
            appendDeadLetter({
              jobId: existing.id,
              reason: 'orphaned_process',
              pid: existing.pid,
              at: new Date().toISOString(),
            });
            syncGenerationMirrorFromWorker(failed);
          } else {
            return res.json({ success: true, deduped: true, jobId: existing.id, status: existing.status });
          }
        }
      }

      const jobId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const resumeCheckpoint = resumeFromJobId
        ? hydrateCheckpointOutputs(loadCheckpoints().find((c) => c.jobId === resumeFromJobId))
        : undefined;
      const hydratedPayload = hydrateWorkerConfigApiKeys(payload);
      const requestSnapshot = buildWorkerRequestSnapshot(mode, hydratedPayload, storyTitle);

      const workerJob = upsertWorkerJob(jobId, {
        mode,
        status: 'pending',
        progress: 0,
        currentPhase: 'queued',
        storyTitle: storyTitle || (mode === 'generation' ? 'Untitled Story' : 'Source Analysis'),
        episodeCount: episodeCount || 1,
        idempotencyKey: idempotencyKey || `${mode}:${Date.now()}`,
        resumeFromJobId: resumeFromJobId || undefined,
        requestSnapshot,
      });

      updateCheckpoint(jobId, {
        idempotencyKey: workerJob.idempotencyKey,
        steps: {
          queued: {
            stepId: 'queued',
            status: 'completed',
            updatedAt: new Date().toISOString(),
            idempotencyKey: `${jobId}:queued`,
          },
        },
        resumeContext: {
          mode,
          requestPayload: hydratedPayload,
          storyTitle: workerJob.storyTitle,
          episodeCount: workerJob.episodeCount,
          resumeFromJobId: resumeFromJobId || undefined,
        },
      });

      startWorkerProcess(workerJob, { ...hydratedPayload, mode, resumeCheckpoint });
      syncGenerationMirrorFromWorker(workerJob);
      return res.json({ success: true, jobId });
    });

    app.get('/worker-jobs', (req, res) => {
      const jobs = loadWorkerJobs();
      const { normalized, changed } = normalizeStaleWorkerJobs(jobs);
      if (changed) saveWorkerJobs(normalized);
      res.json(normalized);
    });

    app.get('/worker-jobs/:jobId', (req, res) => {
      const jobs = loadWorkerJobs();
      const { normalized, changed } = normalizeStaleWorkerJobs(jobs);
      if (changed) saveWorkerJobs(normalized);
      const job = normalized.find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const checkpoint = loadCheckpoints().find((c) => c.jobId === job.id);

      const cached = workerResultCache.get(job.id);
      if (cached) {
        if (Date.now() - cached.storedAt > WORKER_RESULT_TTL_MS) {
          workerResultCache.delete(job.id);
        } else {
          return res.json({ ...job, checkpoint, result: cached.result });
        }
      }

      res.json({ ...job, checkpoint });
    });

    app.get('/worker-jobs/:jobId/failure-context', (req, res) => {
      const job = loadWorkerJobs().find((j) => j.id === req.params.jobId)
        || loadJobs().find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const checkpoint = hydrateCheckpointOutputs(
        loadCheckpoints().find((c) => c.jobId === job.id)
        || job.checkpoint
      );
      res.json({
        jobId: job.id,
        status: job.status,
        failureContext: job.failureContext || checkpoint?.failureContext || null,
        checkpoint,
      });
    });

    app.get('/worker-jobs/:jobId/resume-plan', (req, res) => {
      const job = loadWorkerJobs().find((j) => j.id === req.params.jobId)
        || loadJobs().find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const checkpoint = hydrateCheckpointOutputs(
        loadCheckpoints().find((c) => c.jobId === job.id)
        || job.checkpoint
      );
      res.json(buildResumePlan(job, checkpoint));
    });

    app.patch('/worker-jobs/:jobId/failure-context', (req, res) => {
      const job = loadWorkerJobs().find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const patch = req.body || {};
      updateCheckpoint(job.id, { failureContext: patch });
      const mergedCheckpoint = hydrateCheckpointOutputs(loadCheckpoints().find((c) => c.jobId === job.id));
      if (patch?.message || patch?.failurePhase || patch?.failureKind) {
        upsertWorkerJob(job.id, {
          failureContext: mergedCheckpoint?.failureContext,
          error: patch.message || job.error,
          currentPhase: patch.failurePhase || job.currentPhase,
        });
        syncGenerationMirrorFromWorker(loadWorkerJobs().find((j) => j.id === job.id) || job);
      }
      res.json({
        success: true,
        failureContext: mergedCheckpoint?.failureContext || null,
        checkpoint: mergedCheckpoint,
      });
    });

    app.get('/worker-jobs/:jobId/stream', (req, res) => {
      const { jobId } = req.params;
      const job = loadWorkerJobs().find((j) => j.id === jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const heartbeat = setInterval(() => {
        try { res.write(':\n\n'); } catch {
          // client went away; close() handler will remove it from the set
        }
      }, 15000);

      const clients = workerStreamClients.get(jobId) || new Set();
      clients.add(res);
      workerStreamClients.set(jobId, clients);

      res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

      req.on('close', () => {
        clearInterval(heartbeat);
        const setForJob = workerStreamClients.get(jobId);
        if (!setForJob) return;
        setForJob.delete(res);
        if (setForJob.size === 0) workerStreamClients.delete(jobId);
      });
    });

    app.patch('/worker-jobs/:jobId/checkpoint', (req, res) => {
      const { jobId } = req.params;
      const job = loadWorkerJobs().find((j) => j.id === jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const patch = req.body || {};
      updateCheckpoint(jobId, patch);
      appendWorkerTimeline(jobId, {
        workerEvent: true,
        type: 'checkpoint_patch',
        timestamp: new Date().toISOString(),
        idempotencyKey: patch?.idempotencyKey,
        step: patch?.stepId || patch?.steps ? 'storyboard_pass' : undefined,
      });
      upsertWorkerJob(jobId, { updatedAt: new Date().toISOString() });
      res.json({ success: true });
    });

    app.get('/worker-jobs/:jobId/timeline', (req, res) => {
      const job = loadWorkerJobs().find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      res.json({ jobId: job.id, timeline: job.timeline || [] });
    });

    app.get('/worker-jobs/:jobId/export', (req, res) => {
      const job = loadWorkerJobs().find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const checkpoint = loadCheckpoints().find((c) => c.jobId === job.id);
      res.json({
        job,
        checkpoint,
        deadLetters: deadLetterStore.get().filter((d) => d.jobId === job.id),
      });
    });

    app.post('/worker-jobs/:jobId/cancel', (req, res) => {
      const { jobId } = req.params;
      const job = loadWorkerJobs().find((j) => j.id === jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      upsertWorkerJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
      const active = activeWorkers.get(jobId);
      if (active?.proc && !active.proc.killed) {
        try { active.proc.kill('SIGTERM'); } catch {
          // best-effort; already-dead processes throw ESRCH
        }
      }
      const updated = loadWorkerJobs().find((j) => j.id === jobId);
      syncGenerationMirrorFromWorker(updated);
      res.json({ success: true, jobId });
    });

    app.post('/worker-jobs/:jobId/resume', (req, res) => {
      const sourceJob = loadWorkerJobs().find((j) => j.id === req.params.jobId)
        || loadJobs().find((j) => j.id === req.params.jobId);
      if (!sourceJob) return res.status(404).json({ error: 'Worker job not found' });
      const hydratedCheckpoint = hydrateCheckpointOutputs(
        loadCheckpoints().find((c) => c.jobId === sourceJob.id)
        || sourceJob.checkpoint
      );
      const resumeContext = hydratedCheckpoint?.resumeContext || {};
      const basePayload = resumeContext.requestPayload;
      if (!basePayload || typeof basePayload !== 'object') {
        return res.status(400).json({ error: 'No resume payload stored for this job' });
      }

      const body = req.body || {};
      const payloadPatch = body.payloadPatch && typeof body.payloadPatch === 'object' ? body.payloadPatch : {};
      const outputsPatch = body.outputsPatch && typeof body.outputsPatch === 'object' ? body.outputsPatch : {};
      const patchedPayload = hydrateWorkerConfigApiKeys(mergeJsonLike(basePayload, payloadPatch));
      const patchedOutputs = mergeJsonLike(hydratedCheckpoint?.outputs || {}, outputsPatch);

      const priorOutputDir = resumeContext.outputDirectory
        || hydratedCheckpoint?.failureContext?.context?.outputDirectory;
      if (priorOutputDir && !patchedOutputs.output_directory) {
        patchedOutputs.output_directory = { outputDirectory: priorOutputDir };
      }

      const resumeSteps = { ...(hydratedCheckpoint?.steps || {}) };
      if (priorOutputDir && !resumeSteps.output_directory) {
        resumeSteps.output_directory = {
          stepId: 'output_directory',
          status: 'completed',
          updatedAt: new Date().toISOString(),
        };
      }

      const resumeCheckpoint = {
        ...(hydratedCheckpoint || {}),
        steps: resumeSteps,
        outputs: patchedOutputs,
      };

      const mode = sourceJob.mode || resumeContext.mode || 'generation';
      const storyTitle = body.storyTitle || resumeContext.storyTitle || sourceJob.storyTitle;
      const episodeCount = body.episodeCount || resumeContext.episodeCount || sourceJob.episodeCount;
      const idempotencyKey = body.idempotencyKey || `${sourceJob.id}:resume:${Date.now()}`;
      const requestSnapshot = buildWorkerRequestSnapshot(mode, patchedPayload, storyTitle);
      const jobId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const workerJob = upsertWorkerJob(jobId, {
        mode,
        status: 'pending',
        progress: 0,
        currentPhase: resumeCheckpoint?.failureContext?.resumeFromStepId || resumeCheckpoint?.failureContext?.failurePhase || 'queued',
        storyTitle: storyTitle || 'Untitled Story',
        episodeCount: episodeCount || 1,
        idempotencyKey,
        resumeFromJobId: sourceJob.id,
        requestSnapshot,
      });

      updateCheckpoint(jobId, {
        idempotencyKey,
        steps: {
          queued: {
            stepId: 'queued',
            status: 'completed',
            updatedAt: new Date().toISOString(),
            idempotencyKey: `${jobId}:queued`,
          },
        },
        outputs: patchedOutputs,
        resumeContext: {
          mode,
          requestPayload: patchedPayload,
          storyTitle: workerJob.storyTitle,
          episodeCount: workerJob.episodeCount,
          resumeFromJobId: sourceJob.id,
          resumedAt: new Date().toISOString(),
          changedInputs: Object.keys(payloadPatch),
          changedOutputs: Object.keys(outputsPatch),
          ...(priorOutputDir ? { outputDirectory: priorOutputDir } : {}),
        },
      });

      startWorkerProcess(workerJob, { ...patchedPayload, mode, resumeCheckpoint });
      syncGenerationMirrorFromWorker(workerJob);
      res.json({ success: true, jobId, resumedFromJobId: sourceJob.id });
    });
  }

  return {
    // state
    jobsStore,
    workerJobsStore,
    checkpointsStore,
    deadLetterStore,
    activeWorkers,
    workerStreamClients,
    workerResultCache,
    // helpers
    loadJobs,
    saveJobs,
    loadWorkerJobs,
    saveWorkerJobs,
    loadCheckpoints,
    saveCheckpoints,
    upsertWorkerJob,
    syncGenerationMirrorFromWorker,
    normalizeStaleRunningJobs,
    normalizeStaleWorkerJobs,
    // registration
    registerWorkerLifecycleRoutes,
    // constants for callers that manage periodic cleanup
    constants: {
      WORKER_RESULT_TTL_MS,
      WORKER_COMPLETED_PRUNE_MS,
    },
  };
}

module.exports = { createWorkerLifecycle };
