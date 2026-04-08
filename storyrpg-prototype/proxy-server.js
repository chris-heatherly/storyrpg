/**
 * Anthropic API Proxy Server
 *
 * This server proxies requests to the Anthropic API to avoid CORS issues
 * when running the app in a web browser during development.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getBudgets: getLlmTransportBudgets } = require('./llm-transport-policy');
const { createCachedStore } = require('./proxy/cachedJsonStore');
const { createStoryCatalog } = require('./proxy/storyCatalog');
const { estimateWorkerProgress } = require('./proxy/workerProgress');
const { createSyncGenerationMirrorFromWorker } = require('./proxy/workerJobSync');
const { registerCatalogRoutes } = require('./proxy/catalogRoutes');
const { registerRefImageRoutes } = require('./proxy/refImageRoutes');
const { registerFileRoutes } = require('./proxy/fileRoutes');
const { registerStoryMutationRoutes } = require('./proxy/storyMutationRoutes');
const { registerModelScanRoutes } = require('./proxy/modelScanRoutes');
const { registerGeneratorSettingsRoutes } = require('./proxy/generatorSettingsRoutes');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const STORIES_DIR = path.resolve(__dirname, 'generated-stories');
const { listLatestStoryRecords, createStoryCatalogEntry, createFullStoryResponse } = createStoryCatalog(STORIES_DIR, PORT);

// General logger for ALL requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [Proxy] ${req.method} ${req.url} (Origin: ${req.headers.origin || 'none'})`);
  next();
});

// 1. Handle Static Files FIRST (with bare CORS)
const storiesDir = path.resolve(__dirname, 'generated-stories');
app.use('/generated-stories', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Private-Network', 'true');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const filePathWithinDir = req.path;
  const fullPath = path.join(storiesDir, filePathWithinDir);
  
  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('File not found');
  }

  let contentType = 'application/octet-stream';
  if (fullPath.endsWith('.png')) contentType = 'image/png';
  else if (fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (fullPath.endsWith('.webp')) contentType = 'image/webp';
  else if (fullPath.endsWith('.mp4')) contentType = 'video/mp4';
  else if (fullPath.endsWith('.webm')) contentType = 'video/webm';
  else if (fullPath.endsWith('.json')) contentType = 'application/json';
  else if (fullPath.endsWith('.mp3')) contentType = 'audio/mpeg';
  res.set('Content-Type', contentType);

  const stream = fs.createReadStream(fullPath);
  stream.on('error', (err) => {
    console.error(`[Proxy] Stream error: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Error');
  });
  stream.pipe(res);
});

// 2. Enable regular CORS for other routes
app.use(cors({
  origin: true,
  credentials: true
}));

// 3. Parse JSON
app.use(express.json({ limit: '50mb' }));

const REF_IMAGES_DIR = path.resolve(__dirname, '.ref-images');
const PIPELINE_MEMORY_ROOT = path.resolve(process.env.MEMORY_DIR || path.join(__dirname, 'pipeline-memories'));
const DELETED_STORIES_FILE = path.resolve(__dirname, 'generated-stories', '.deleted-stories.json');
registerCatalogRoutes(app, {
  listLatestStoryRecords,
  createStoryCatalogEntry,
  createFullStoryResponse,
});
registerRefImageRoutes(app, { refImagesDir: REF_IMAGES_DIR, port: PORT });
registerFileRoutes(app, {
  rootDir: __dirname,
  storiesDir: STORIES_DIR,
  refImagesDir: REF_IMAGES_DIR,
  pipelineMemoryRoot: PIPELINE_MEMORY_ROOT,
  workerCheckpointOutputDir: path.resolve(__dirname, '.worker-checkpoint-outputs'),
});
registerStoryMutationRoutes(app, {
  storiesDir: STORIES_DIR,
  deletedStoriesFile: DELETED_STORIES_FILE,
});
registerModelScanRoutes(app);
registerGeneratorSettingsRoutes(app);

// ============================================
// GENERATION JOB TRACKING
// ============================================
const JOBS_FILE = path.resolve(__dirname, '.generation-jobs.json');
const JOB_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

const jobsStore = createCachedStore(JOBS_FILE, 'generation-jobs');

function loadJobs() {
  return jobsStore.get();
}

function normalizeStaleRunningJobs(jobs) {
  const now = Date.now();
  let changed = false;

  const normalized = jobs.map((job) => {
    if (!job || (job.status !== 'running' && job.status !== 'pending')) {
      return job;
    }

    const heartbeatIso = job.updatedAt || job.startedAt;
    const heartbeatMs = heartbeatIso ? new Date(heartbeatIso).getTime() : NaN;
    if (!Number.isFinite(heartbeatMs)) return job;

    const staleMs = now - heartbeatMs;
    if (staleMs < JOB_STALE_RUNNING_MS) {
      return job;
    }

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

function saveJobs(jobs) {
  jobsStore.set(jobs);
}

// Get all generation jobs
app.get('/generation-jobs', (req, res) => {
  const jobs = loadJobs();
  const { normalized, changed } = normalizeStaleRunningJobs(jobs);
  if (changed) saveJobs(normalized);
  res.json(normalized);
});

// Get all generation jobs (legacy alias)
app.get('/generation-jobs/all', (req, res) => {
  const jobs = loadJobs();
  const { normalized, changed } = normalizeStaleRunningJobs(jobs);
  if (changed) saveJobs(normalized);
  res.json(normalized);
});

// Refresh stale state helper endpoint (diagnostics)
app.post('/generation-jobs/refresh', (req, res) => {
  const jobs = loadJobs();
  const { normalized, changed } = normalizeStaleRunningJobs(jobs);
  if (changed) saveJobs(normalized);
  res.json({ success: true, changed, count: normalized.length });
});

// Register a new generation job
app.post('/generation-jobs', (req, res) => {
  const job = req.body;
  if (!job || !job.id) {
    return res.status(400).json({ error: 'Invalid job data' });
  }

  const jobs = loadJobs();
  const existingIndex = jobs.findIndex(j => j.id === job.id);
  
  if (existingIndex >= 0) {
    jobs[existingIndex] = job;
  } else {
    jobs.unshift(job);
  }

  // Keep only the last 50 jobs
  if (jobs.length > 50) {
    jobs.length = 50;
  }

  saveJobs(jobs);
  console.log(`[Proxy] Registered generation job: ${job.id} - ${job.storyTitle}`);
  res.json({ success: true });
});

// Get a single generation job
app.get('/generation-jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const jobs = loadJobs();
  const { normalized, changed } = normalizeStaleRunningJobs(jobs);
  if (changed) saveJobs(normalized);
  const job = normalized.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Update a generation job (upsert: creates the job if it doesn't exist)
app.patch('/generation-jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const updates = req.body;

  const jobs = loadJobs();
  const jobIndex = jobs.findIndex(j => j.id === jobId);

  if (jobIndex < 0) {
    const newJob = { id: jobId, ...updates, startedAt: updates.startedAt || new Date().toISOString() };
    jobs.unshift(newJob);
    if (jobs.length > 50) jobs.length = 50;
    saveJobs(jobs);
    console.log(`[Proxy] Upserted generation job via PATCH: ${jobId}`);
    return res.json({ success: true, upserted: true });
  }

  jobs[jobIndex] = { ...jobs[jobIndex], ...updates };
  saveJobs(jobs);
  res.json({ success: true });
});

// Cancel a generation job
app.post('/generation-jobs/:jobId/cancel', (req, res) => {
  const { jobId } = req.params;
  const workerJob = loadWorkerJobs().find((j) => j.id === jobId);
  if (workerJob) {
    upsertWorkerJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
    const active = activeWorkers.get(jobId);
    if (active?.proc && !active.proc.killed) {
      try { active.proc.kill('SIGTERM'); } catch {}
    }
    const updatedWorkerJob = loadWorkerJobs().find((j) => j.id === jobId);
    if (updatedWorkerJob) {
      syncGenerationMirrorFromWorker(updatedWorkerJob);
    }
    return res.json({ success: true, jobId, delegatedTo: 'worker-jobs' });
  }

  const jobs = loadJobs();
  const jobIndex = jobs.findIndex(j => j.id === jobId);

  if (jobIndex < 0) {
    return res.status(404).json({ error: 'Job not found' });
  }

  jobs[jobIndex].status = 'cancelled';
  jobs[jobIndex].updatedAt = new Date().toISOString();
  saveJobs(jobs);
  console.log(`[Proxy] Cancelled generation job: ${jobId}`);
  res.json({ success: true });
});

// Delete a generation job
app.delete('/generation-jobs/:jobId', (req, res) => {
  const { jobId } = req.params;

  let jobs = loadJobs();
  const initialLength = jobs.length;
  jobs = jobs.filter(j => j.id !== jobId);

  if (jobs.length < initialLength) {
    saveJobs(jobs);
    console.log(`[Proxy] Deleted generation job: ${jobId}`);
  }

  res.json({ success: true });
});

// Check if a job is cancelled (for pipeline to poll)
app.get('/generation-jobs/:jobId/status', (req, res) => {
  const { jobId } = req.params;
  const jobs = loadJobs();
  const { normalized, changed } = normalizeStaleRunningJobs(jobs);
  if (changed) saveJobs(normalized);
  const job = normalized.find(j => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ status: job.status, cancelled: job.status === 'cancelled' });
});

// ============================================
// BACKEND WORKER JOBS (DURABLE ORCHESTRATION)
// ============================================

// In-memory cache for worker results — the full result object is too large for the
// JSON job store but must be available when the client polls after completion.
// Entries are evicted after 10 minutes or when explicitly fetched.
const workerResultCache = new Map(); // jobId -> { result, storedAt }
const WORKER_RESULT_TTL_MS = 10 * 60 * 1000;

const WORKER_JOBS_FILE = path.resolve(__dirname, '.worker-jobs.json');
const WORKER_CHECKPOINTS_FILE = path.resolve(__dirname, '.worker-checkpoints.json');
const WORKER_DEAD_LETTER_FILE = path.resolve(__dirname, '.worker-dead-letter.json');
const WORKER_CHECKPOINT_OUTPUT_DIR = path.resolve(__dirname, '.worker-checkpoint-outputs');
const WORKER_STALE_RUNNING_MS = 3 * 60 * 1000; // 3 minutes — worker heartbeats every 60s, so 3 missed = dead
const WORKER_MAX_TIMELINE = 200;
const WORKER_MAX_IMAGE_JOBS = 200;
const WORKER_MAX_VIDEO_JOBS = 200;
const WORKER_MAX_IMAGE_MANIFEST = 200;
const WORKER_MAX_CHECKPOINT_ARTIFACTS = 100;
const WORKER_COMPLETED_PRUNE_MS = 2 * 60 * 60 * 1000;
const WORKER_MAX_ENTRY_BYTES = 4096;

/**
 * Strip base64 data URIs and large blobs from an object to prevent OOM in proxy memory.
 * Returns a shallow-cloned object with large strings replaced by placeholders.
 */
function stripLargeValues(obj, maxStringLen = 512) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => stripLargeValues(item, maxStringLen));
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      if (val.startsWith('data:') && val.length > 200) {
        result[key] = null;
      } else if (val.length > maxStringLen) {
        result[key] = val.slice(0, maxStringLen) + `...[truncated]`;
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
          .filter(([, agentCfg]) => !!agentCfg)
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
          story: brief?.story ? {
            title: brief.story.title,
            genre: brief.story.genre,
          } : undefined,
          episode: brief?.episode ? {
            number: brief.episode.number,
            title: brief.episode.title,
          } : undefined,
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

function resolveVideoUrl(videoUrl) {
  if (typeof videoUrl !== 'string') return videoUrl;
  const gsIdx = videoUrl.indexOf('generated-stories/');
  if (gsIdx >= 0 && !videoUrl.startsWith('http')) {
    return `http://localhost:3001/${videoUrl.slice(gsIdx)}`;
  }
  return videoUrl;
}

/**
 * For image job events, convert base64/absolute-path imageUrl to an HTTP URL.
 * Uses existing image jobs to infer the story output directory when needed.
 */
function resolveImageUrl(imageUrl, identifier, existingImageJobs) {
  if (typeof imageUrl !== 'string') return imageUrl;

  // Extract the story images base path from a sibling URL that's already resolved.
  function inferImagesBase() {
    const ref = (existingImageJobs || []).find(j => j.imageUrl && j.imageUrl.startsWith('http') && j.imageUrl.includes('/images/'));
    if (ref) {
      const imagesIdx = ref.imageUrl.lastIndexOf('/images/');
      if (imagesIdx > 0) return ref.imageUrl.slice(0, imagesIdx + '/images/'.length);
    }
    return null;
  }

  // Large base64 data URI — replace with HTTP URL based on identifier
  if (imageUrl.startsWith('data:') && imageUrl.length > 200) {
    if (identifier) {
      const base = inferImagesBase();
      if (base) return `${base}${identifier}.png`;
    }
    return null;
  }

  // Absolute file path from Docker worker (e.g. /app/generated-stories/...)
  const gsIdx = imageUrl.indexOf('generated-stories/');
  if (gsIdx >= 0 && !imageUrl.startsWith('http')) {
    return `http://localhost:3001/${imageUrl.slice(gsIdx)}`;
  }

  return imageUrl;
}
const activeWorkers = new Map();
const workerStreamClients = new Map(); // jobId -> Set<response>

const workerJobsStore = createCachedStore(WORKER_JOBS_FILE, 'worker-jobs');
const checkpointsStore = createCachedStore(WORKER_CHECKPOINTS_FILE, 'worker-checkpoints');
const deadLetterStore = createCachedStore(WORKER_DEAD_LETTER_FILE, 'worker-dead-letter');

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

function loadWorkerJobs() {
  return workerJobsStore.get();
}

function saveWorkerJobs(jobs) {
  workerJobsStore.set(jobs);
}

function loadCheckpoints() {
  return checkpointsStore.get();
}

function saveCheckpoints(rows) {
  checkpointsStore.set(rows);
}

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
  return {
    ...checkpoint,
    outputs: hydratedOutputs,
  };
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
        // Drop broken clients eagerly
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

function normalizeStaleWorkerJobs(jobs) {
  let changed = false;
  const now = Date.now();
  const normalized = jobs.map((job) => {
    if (!job || (job.status !== 'running' && job.status !== 'pending')) return job;
    // Fast-path zombie detection:
    // if a job claims to be running but has no tracked process and PID is dead,
    // fail it immediately instead of waiting for the stale timeout window.
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
  const runnerPath = path.resolve(__dirname, 'src/ai-agents/server/worker-runner.ts');
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
    cwd: __dirname,
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
            const strippedShots = evt.data.shots.map(s => stripLargeValues(s, 200));
            updates.imageManifest = existing.concat(strippedShots);
          }
          upsertWorkerJob(workerJob.id, updates);
          if (evt.eventType === 'checkpoint' && evt.data && typeof evt.data === 'object' && evt.data.stepId && Object.prototype.hasOwnProperty.call(evt.data, 'output')) {
            const checkpointFile = persistCheckpointOutput(workerJob.id, evt.data.stepId, evt.data.output);
            updateCheckpoint(workerJob.id, {
              outputs: {
                [evt.data.stepId]: {
                  __checkpointFile: checkpointFile,
                },
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
            const promptSummary = typeof rawData.prompt === 'string' ? rawData.prompt.slice(0, 200) : undefined;
            imageJobs.push({ id: rawData.id, identifier: rawData.identifier, status: rawData.status || 'pending', prompt: promptSummary, metadata: rawData.metadata });
          } else if (evt.eventType === 'job_updated' && rawData.id) {
            const idx = imageJobs.findIndex((j) => j.id === rawData.id);
            const existingJob = idx >= 0 ? imageJobs[idx] : null;
            const identifier = existingJob?.identifier || rawData.identifier;
            const resolvedUrl = resolveImageUrl(rawData.imageUrl, identifier, imageJobs);
            const safeUpdates = { status: rawData.status, progress: rawData.progress, error: rawData.error, attempts: rawData.attempts, endTime: rawData.endTime };
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
              sourceImageUrl: resolveImageUrl(rawData.sourceImageUrl, rawData.identifier, currentJob?.imageJobs || []),
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
            const resolvedUrl = resolveVideoUrl(rawData.videoUrl);
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
          updateCheckpoint(workerJob.id, {
            lastEvent: evt,
            failureContext,
          });
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

    // Clean up temp files to avoid /tmp accumulation
    try { fs.unlinkSync(payloadPath); } catch {}
    try { fs.unlinkSync(resultPath); } catch {}
  });
}

function isMissingApiKey(value) {
  if (typeof value !== 'string') return true;
  const v = value.trim().toLowerCase();
  return !v || v === 'dummy' || v === 'placeholder' || v === 'your-api-key';
}

function hydrateWorkerConfigApiKeys(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const cfg = payload.config;
  if (!cfg || typeof cfg !== 'object') return payload;
  const agents = cfg.agents;
  if (!agents || typeof agents !== 'object') return payload;

  const envAnthropicKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    '';

  if (!envAnthropicKey) return payload;

  for (const agentName of Object.keys(agents)) {
    const agentCfg = agents[agentName];
    if (!agentCfg || typeof agentCfg !== 'object') continue;
    if (agentCfg.provider !== 'anthropic') continue;
    if (isMissingApiKey(agentCfg.apiKey)) {
      agentCfg.apiKey = envAnthropicKey;
    }
  }

  return payload;
}

// Start server-side worker job (analysis/generation) with idempotency support.
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
    // Dedupe only active jobs. Allow reruns after completion.
    const existing = normalizedJobs.find((j) => j.idempotencyKey === idempotencyKey && ['pending', 'running'].includes(j.status));
    if (existing) {
      // Guard against rare race where a running job appears active but its process is gone.
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

  // Attach the full result from memory cache when job is completed.
  // The result is too large for the on-disk JSON store but must be
  // available for the client's polling loop to pick up.
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
  const job = loadWorkerJobs().find((j) => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Worker job not found' });
  const checkpoint = hydrateCheckpointOutputs(loadCheckpoints().find((c) => c.jobId === job.id));
  res.json({
    jobId: job.id,
    status: job.status,
    failureContext: job.failureContext || checkpoint?.failureContext || null,
    checkpoint,
  });
});

app.patch('/worker-jobs/:jobId/failure-context', (req, res) => {
  const job = loadWorkerJobs().find((j) => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Worker job not found' });
  const patch = req.body || {};
  updateCheckpoint(job.id, {
    failureContext: patch,
  });
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
    try { res.write(':\n\n'); } catch {}
  }, 15000);

  const clients = workerStreamClients.get(jobId) || new Set();
  clients.add(res);
  workerStreamClients.set(jobId, clients);

  // Send initial snapshot so UI can hydrate instantly.
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

// One-command diagnostics export for audit/review.
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
    try { active.proc.kill('SIGTERM'); } catch {}
  }
  const updated = loadWorkerJobs().find((j) => j.id === jobId);
  syncGenerationMirrorFromWorker(updated);
  res.json({ success: true, jobId });
});

app.post('/worker-jobs/:jobId/resume', (req, res) => {
  const sourceJob = loadWorkerJobs().find((j) => j.id === req.params.jobId);
  if (!sourceJob) return res.status(404).json({ error: 'Worker job not found' });
  const hydratedCheckpoint = hydrateCheckpointOutputs(loadCheckpoints().find((c) => c.jobId === sourceJob.id));
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
  const resumeCheckpoint = {
    ...(hydratedCheckpoint || {}),
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
    },
  });

  startWorkerProcess(workerJob, { ...patchedPayload, mode, resumeCheckpoint });
  syncGenerationMirrorFromWorker(workerJob);
  res.json({ success: true, jobId, resumedFromJobId: sourceJob.id });
});

// ============================================
// ELEVENLABS AUDIO PROXY
// ============================================
const AUDIO_ROOT_DIR = path.resolve(__dirname, 'generated-stories');
const DEFAULT_ELEVENLABS_VOICES = {
  narrator: 'onwK4e9ZLuTAKqWW03F9',
  male: 'TxGEqnHWrfWFTfGW9XjX',
  female: 'EXAVITQu4vr4xnSDxMaL',
  child: 'jBpfuIE2acCO8z3wKNLl',
};

function findStoryDirByStoryId(storyId) {
  if (!storyId || !fs.existsSync(AUDIO_ROOT_DIR)) return null;
  const dirs = fs.readdirSync(AUDIO_ROOT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const dir of dirs) {
    const storyFile = path.join(AUDIO_ROOT_DIR, dir, '08-final-story.json');
    if (!fs.existsSync(storyFile)) continue;
    try {
      const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
      if (story?.id === storyId || dir.startsWith(storyId)) return dir;
    } catch {}
  }
  return null;
}

function getPublicBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY ENDPOINTS — Proxied memory operations for web runtime
// ═══════════════════════════════════════════════════════════════════

const MEMORY_ROOT = PIPELINE_MEMORY_ROOT;

function assertSafeMemoryPath(requested) {
  const resolved = path.resolve(MEMORY_ROOT, requested.replace(/^\/memories\/?/, ''));
  if (!resolved.startsWith(path.resolve(MEMORY_ROOT))) {
    throw new Error(`Path traversal blocked: ${requested}`);
  }
  return resolved;
}

app.post('/memories/operation', async (req, res) => {
  const { command, path: memPath, view_range, file_text, old_str, new_str,
          insert_line, insert_text, old_path, new_path } = req.body;

  if (!command) return res.status(400).json({ error: 'Missing command' });

  try {
    let result;
    switch (command) {
      case 'view': {
        if (!memPath) return res.status(400).json({ error: 'Missing path' });
        const resolved = assertSafeMemoryPath(memPath);
        let stat;
        try { stat = fs.statSync(resolved); } catch {
          return res.json({ result: `The path ${memPath} does not exist.` });
        }
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(resolved).filter(e => !e.startsWith('.'));
          result = `Directory listing of ${memPath}:\n${entries.join('\n')}`;
        } else {
          const content = fs.readFileSync(resolved, 'utf8');
          const lines = content.split('\n');
          let start = 1, end = lines.length;
          if (view_range) {
            start = Math.max(1, view_range[0]);
            end = Math.min(lines.length, view_range[1]);
          }
          const numbered = lines.slice(start - 1, end)
            .map((line, i) => `${String(start + i).padStart(6)}\t${line}`)
            .join('\n');
          result = `Content of ${memPath}:\n${numbered}`;
        }
        break;
      }
      case 'create': {
        if (!memPath || file_text === undefined) return res.status(400).json({ error: 'Missing path or file_text' });
        const resolved = assertSafeMemoryPath(memPath);
        if (fs.existsSync(resolved)) {
          result = `Error: File ${memPath} already exists`;
        } else {
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, file_text, 'utf8');
          result = `File created successfully at: ${memPath}`;
        }
        break;
      }
      case 'str_replace': {
        if (!memPath || !old_str || new_str === undefined) return res.status(400).json({ error: 'Missing path, old_str or new_str' });
        const resolved = assertSafeMemoryPath(memPath);
        if (!fs.existsSync(resolved)) {
          result = `Error: The path ${memPath} does not exist.`;
          break;
        }
        let content = fs.readFileSync(resolved, 'utf8');
        const idx = content.indexOf(old_str);
        if (idx === -1) {
          result = `No replacement performed, old_str not found in ${memPath}.`;
        } else if (content.indexOf(old_str, idx + 1) !== -1) {
          result = `No replacement performed. Multiple occurrences of old_str in ${memPath}.`;
        } else {
          content = content.replace(old_str, new_str);
          fs.writeFileSync(resolved, content, 'utf8');
          result = `File ${memPath} has been edited.`;
        }
        break;
      }
      case 'insert': {
        if (!memPath || insert_line === undefined || !insert_text) return res.status(400).json({ error: 'Missing parameters' });
        const resolved = assertSafeMemoryPath(memPath);
        if (!fs.existsSync(resolved)) {
          result = `Error: The path ${memPath} does not exist`;
          break;
        }
        const lines = fs.readFileSync(resolved, 'utf8').split('\n');
        const newLines = insert_text.split('\n');
        lines.splice(insert_line, 0, ...newLines);
        fs.writeFileSync(resolved, lines.join('\n'), 'utf8');
        result = `File ${memPath} has been edited.`;
        break;
      }
      case 'delete': {
        if (!memPath) return res.status(400).json({ error: 'Missing path' });
        const resolved = assertSafeMemoryPath(memPath);
        if (!fs.existsSync(resolved)) {
          result = `Error: The path ${memPath} does not exist`;
          break;
        }
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          fs.rmSync(resolved, { recursive: true });
        } else {
          fs.unlinkSync(resolved);
        }
        result = `Successfully deleted ${memPath}`;
        break;
      }
      case 'rename': {
        if (!old_path || !new_path) return res.status(400).json({ error: 'Missing old_path or new_path' });
        const resolvedOld = assertSafeMemoryPath(old_path);
        const resolvedNew = assertSafeMemoryPath(new_path);
        if (!fs.existsSync(resolvedOld)) {
          result = `Error: The path ${old_path} does not exist`;
          break;
        }
        if (fs.existsSync(resolvedNew)) {
          result = `Error: The destination ${new_path} already exists`;
          break;
        }
        fs.mkdirSync(path.dirname(resolvedNew), { recursive: true });
        fs.renameSync(resolvedOld, resolvedNew);
        result = `Successfully renamed ${old_path} to ${new_path}`;
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown command: ${command}` });
    }
    res.json({ result });
  } catch (err) {
    console.error('[Memory] Operation error:', err);
    res.status(500).json({ error: err.message || 'Memory operation failed' });
  }
});

function getAudioUrl(req, storyDir, beatId) {
  return `${getPublicBaseUrl(req)}/generated-stories/${storyDir}/audio/${beatId}.mp3`;
}

app.get('/audio-alignment', (req, res) => {
  const storyId = String(req.query.storyId || '');
  const beatId = String(req.query.beatId || '');
  if (!storyId || !beatId) return res.status(400).json({ error: 'Missing storyId or beatId' });

  const storyDir = findStoryDirByStoryId(storyId);
  if (!storyDir) return res.status(404).json({ error: 'Story directory not found' });
  const alignmentPath = path.join(AUDIO_ROOT_DIR, storyDir, 'audio', `${beatId}.alignment.json`);
  if (!fs.existsSync(alignmentPath)) return res.status(404).json({ error: 'Alignment not found' });

  try {
    const alignmentData = JSON.parse(fs.readFileSync(alignmentPath, 'utf8'));
    res.json(alignmentData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/elevenlabs/tts', async (req, res) => {
  try {
    const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });

    const {
      text,
      voiceId,
      voiceType = 'narrator',
      storyId,
      beatId,
      speaker,
      modelId = 'eleven_multilingual_v2',
      outputFormat = 'mp3_44100_128',
    } = req.body || {};

    if (!text) return res.status(400).json({ error: 'Missing text' });
    const resolvedVoiceId = voiceId || DEFAULT_ELEVENLABS_VOICES[voiceType] || DEFAULT_ELEVENLABS_VOICES.narrator;

    let storyDir = storyId ? findStoryDirByStoryId(storyId) : null;
    let audioPath = null;
    let alignmentPath = null;
    if (storyDir && beatId) {
      audioPath = path.join(AUDIO_ROOT_DIR, storyDir, 'audio', `${beatId}.mp3`);
      alignmentPath = path.join(AUDIO_ROOT_DIR, storyDir, 'audio', `${beatId}.alignment.json`);
      if (fs.existsSync(audioPath)) {
        let alignment = null;
        if (fs.existsSync(alignmentPath)) {
          try { alignment = JSON.parse(fs.readFileSync(alignmentPath, 'utf8'))?.alignment || null; } catch {}
        }
        return res.json({
          success: true,
          audioUrl: getAudioUrl(req, storyDir, beatId),
          alignment,
          cached: true,
          characterCount: text.length,
        });
      }
    }

    const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        output_format: outputFormat,
      }),
    });

    if (!ttsResp.ok) {
      const errorText = await ttsResp.text();
      throw new Error(`ElevenLabs API error: ${ttsResp.status} - ${errorText}`);
    }
    const ttsData = await ttsResp.json();
    const audioBase64 = ttsData.audio_base64;
    const alignment = ttsData.alignment || null;
    if (!audioBase64) throw new Error('No audio_base64 received from ElevenLabs');

    if (storyId && beatId && storyDir) {
      const audioSubDir = path.join(AUDIO_ROOT_DIR, storyDir, 'audio');
      if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });
      fs.writeFileSync(path.join(audioSubDir, `${beatId}.mp3`), Buffer.from(audioBase64, 'base64'));
      if (alignment) {
        fs.writeFileSync(
          path.join(audioSubDir, `${beatId}.alignment.json`),
          JSON.stringify(
            {
              text,
              speaker,
              voiceId: resolvedVoiceId,
              alignment,
              generatedAt: new Date().toISOString(),
            },
            null,
            2
          )
        );
      }
      return res.json({
        success: true,
        audioUrl: getAudioUrl(req, storyDir, beatId),
        alignment,
        cached: false,
        characterCount: text.length,
      });
    }

    return res.json({
      success: true,
      audioData: audioBase64,
      alignment,
      mimeType: 'audio/mpeg',
      characterCount: text.length,
    });
  } catch (error) {
    console.error('[Proxy] ElevenLabs TTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/elevenlabs/batch-generate', async (req, res) => {
  try {
    const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });

    const { storyId, beats, characterVoices, modelId = 'eleven_multilingual_v2' } = req.body || {};
    if (!storyId || !Array.isArray(beats)) return res.status(400).json({ error: 'Missing storyId or beats[]' });

    const storyDir = findStoryDirByStoryId(storyId);
    if (!storyDir) return res.status(404).json({ error: `Story directory not found for ${storyId}` });
    const audioSubDir = path.join(AUDIO_ROOT_DIR, storyDir, 'audio');
    if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });

    const results = [];
    const errors = [];
    for (const beat of beats) {
      const { beatId, text, speaker } = beat || {};
      if (!beatId || !text) {
        errors.push({ beatId: beatId || 'unknown', error: 'Missing beatId or text' });
        continue;
      }

      const audioPath = path.join(audioSubDir, `${beatId}.mp3`);
      if (fs.existsSync(audioPath)) {
        results.push({ beatId, success: true, cached: true, audioUrl: getAudioUrl(req, storyDir, beatId) });
        continue;
      }

      let resolvedVoiceId = beat.voiceId;
      if (!resolvedVoiceId && speaker && characterVoices) {
        resolvedVoiceId = characterVoices[speaker.toLowerCase()] || characterVoices[speaker];
      }
      if (!resolvedVoiceId) resolvedVoiceId = DEFAULT_ELEVENLABS_VOICES.narrator;

      try {
        const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({ text, model_id: modelId }),
        });
        if (!ttsResp.ok) {
          const errorText = await ttsResp.text();
          throw new Error(`API error: ${ttsResp.status} - ${errorText}`);
        }
        const ttsData = await ttsResp.json();
        fs.writeFileSync(audioPath, Buffer.from(ttsData.audio_base64, 'base64'));
        if (ttsData.alignment) {
          fs.writeFileSync(
            path.join(audioSubDir, `${beatId}.alignment.json`),
            JSON.stringify(
              {
                text,
                speaker,
                voiceId: resolvedVoiceId,
                alignment: ttsData.alignment,
                generatedAt: new Date().toISOString(),
              },
              null,
              2
            )
          );
        }
        results.push({
          beatId,
          success: true,
          cached: false,
          voiceId: resolvedVoiceId,
          audioUrl: getAudioUrl(req, storyDir, beatId),
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err) {
        errors.push({ beatId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.json({
      success: true,
      generated: results.filter((r) => r.success && !r.cached).length,
      cached: results.filter((r) => r.cached).length,
      failed: errors.length,
      results,
      errors,
    });
  } catch (error) {
    console.error('[Proxy] ElevenLabs batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/elevenlabs/voices', async (req, res) => {
  try {
    const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });
    const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!voicesResp.ok) {
      const errorText = await voicesResp.text();
      throw new Error(`ElevenLabs voices API error: ${voicesResp.status} - ${errorText}`);
    }
    const voicesData = await voicesResp.json();
    const voices = Array.isArray(voicesData?.voices) ? voicesData.voices : [];
    res.json({
      success: true,
      voices: voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        category: v.category,
        description: v.description,
        previewUrl: v.preview_url,
        labels: v.labels,
      })),
      defaults: DEFAULT_ELEVENLABS_VOICES,
    });
  } catch (error) {
    console.error('[Proxy] ElevenLabs voices error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================

// ============================================
// IMAGE FEEDBACK TRACKING
// ============================================
const FEEDBACK_FILE = path.resolve(__dirname, '.image-feedback.json');
const feedbackStore = createCachedStore(FEEDBACK_FILE, 'image-feedback');

function loadFeedback() {
  return feedbackStore.get();
}

function saveFeedback(feedback) {
  feedbackStore.set(feedback);
}

// Get all image feedback
app.get('/image-feedback', (req, res) => {
  const feedback = loadFeedback();
  res.json(feedback);
});

// Add new image feedback
app.post('/image-feedback', (req, res) => {
  const feedbackItem = req.body;
  if (!feedbackItem || !feedbackItem.id) {
    return res.status(400).json({ error: 'Invalid feedback data' });
  }

  const feedback = loadFeedback();
  const existingIndex = feedback.findIndex(f => f.id === feedbackItem.id);
  
  if (existingIndex >= 0) {
    feedback[existingIndex] = feedbackItem;
  } else {
    feedback.unshift(feedbackItem);
  }

  // Keep only the last 500 feedback items
  if (feedback.length > 500) {
    feedback.length = 500;
  }

  saveFeedback(feedback);
  console.log(`[Proxy] Saved image feedback: ${feedbackItem.id} (${feedbackItem.rating})`);
  res.json({ success: true });
});

// Update image feedback
app.patch('/image-feedback/:feedbackId', (req, res) => {
  const { feedbackId } = req.params;
  const updates = req.body;

  const feedback = loadFeedback();
  const feedbackIndex = feedback.findIndex(f => f.id === feedbackId);

  if (feedbackIndex < 0) {
    return res.status(404).json({ error: 'Feedback not found' });
  }

  feedback[feedbackIndex] = { ...feedback[feedbackIndex], ...updates };
  saveFeedback(feedback);
  res.json({ success: true });
});

// Delete image feedback
app.delete('/image-feedback/:feedbackId', (req, res) => {
  const { feedbackId } = req.params;

  let feedback = loadFeedback();
  const initialLength = feedback.length;
  feedback = feedback.filter(f => f.id !== feedbackId);

  if (feedback.length === initialLength) {
    return res.status(404).json({ error: 'Feedback not found' });
  }

  saveFeedback(feedback);
  console.log(`[Proxy] Deleted image feedback: ${feedbackId}`);
  res.json({ success: true });
});

function runRegenerationWorker(payload) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(__dirname, 'src/ai-agents/server/regenerate-image.ts');
    const payloadPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.payload.json`);
    const resultPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.result.json`);

    fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, resultPath }, null, 2), 'utf8');

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
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '0', TS_NODE_PREFER_TS_EXTS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) console.log(`[Proxy][rerender] ${text}`);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    const cleanup = () => {
      try { fs.unlinkSync(payloadPath); } catch {}
      try { fs.unlinkSync(resultPath); } catch {}
    };

    proc.on('error', (err) => {
      cleanup();
      reject(err);
    });

    proc.on('close', (code) => {
      try {
        const raw = fs.readFileSync(resultPath, 'utf8');
        const parsed = JSON.parse(raw);
        cleanup();
        if (code !== 0 || parsed?.success === false) {
          reject(new Error(parsed?.error || stderr || `Rerender worker failed with exit code ${code}`));
          return;
        }
        resolve(parsed);
      } catch (err) {
        cleanup();
        reject(new Error(stderr || err.message || `Rerender worker failed with exit code ${code}`));
      }
    });
  });
}

// Regenerate an image based on feedback
app.post('/regenerate-image', async (req, res) => {
  const { imageUrl, storyId, sceneId, beatId, feedback, promptPath: requestPromptPath, identifier, metadata } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing required field: imageUrl' });
  }

  console.log(`[Proxy] Regenerating image for story ${storyId}, beat ${beatId || sceneId}`);
  console.log(`[Proxy] Feedback reasons: ${feedback?.reasons?.join(', ') || 'none'}`);
  console.log(`[Proxy] Feedback notes: ${feedback?.notes || 'none'}`);

  try {
    const storiesDir = path.resolve(__dirname, 'generated-stories');
    let promptPath = requestPromptPath || null;
    let resolvedIdentifier = identifier || null;

    if (!promptPath && storyId && fs.existsSync(storiesDir)) {
      const dirs = fs.readdirSync(storiesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const dir of dirs) {
        const storyFile = path.join(storiesDir, dir, '08-final-story.json');
        if (fs.existsSync(storyFile)) {
          try {
            const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
            if (story.id === storyId) {
              const outputDir = path.join(storiesDir, dir);
              const promptsDir = path.join(outputDir, 'prompts');
              if (fs.existsSync(promptsDir)) {
                const promptFiles = fs.readdirSync(promptsDir);
                for (const pf of promptFiles) {
                  const pfLower = pf.toLowerCase();
                  if ((beatId && pfLower.includes(beatId.toLowerCase())) ||
                      (sceneId && pfLower.includes(sceneId.toLowerCase()))) {
                    promptPath = path.join(promptsDir, pf);
                    const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
                    resolvedIdentifier = promptData.identifier || pf.replace('.json', '');
                    break;
                  }
                }
              }
              break;
            }
          } catch (err) {
            console.error(`[Proxy] Error reading story ${dir}:`, err.message);
          }
        }
      }
    }

    if (!promptPath) {
      console.log(`[Proxy] Could not find original prompt path for rerender request`);
      return res.json({ 
        success: false, 
        error: 'Could not find original prompt for this image',
        note: 'Image regeneration requires the original prompt file to be available'
      });
    }
    const result = await runRegenerationWorker({
      imageUrl,
      identifier: resolvedIdentifier,
      promptPath,
      metadata,
      feedback,
    });

    res.json({
      success: true,
      message: 'Image rerendered successfully',
      ...result,
    });

  } catch (error) {
    console.error(`[Proxy] Error regenerating image: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get feedback summary/statistics
app.get('/image-feedback/summary', (req, res) => {
  const feedback = loadFeedback();
  
  const positiveCount = feedback.filter(f => f.rating === 'positive').length;
  const negativeCount = feedback.filter(f => f.rating === 'negative').length;
  
  // Count reasons
  const reasonCounts = {};
  feedback.forEach(f => {
    if (f.reasons) {
      f.reasons.forEach(reason => {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      });
    }
  });

  const topIssues = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    totalFeedback: feedback.length,
    positiveCount,
    negativeCount,
    approvalRate: feedback.length > 0 ? (positiveCount / feedback.length * 100).toFixed(1) + '%' : 'N/A',
    topIssues,
    recentFeedback: feedback.slice(0, 10)
  });
});

// ============================================
// ATLAS CLOUD API PROXY
// ============================================

const ATLAS_CLOUD_TIMEOUT_MS = 120000;

app.post('/atlas-cloud-api/uploadMedia', async (req, res) => {
  const apiKey = req.headers['x-atlas-cloud-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const { base64Data, mimeType, fileName } = req.body || {};
  if (!base64Data) {
    return res.status(400).json({ error: 'Missing base64Data in request body' });
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const boundary = `----AtlasUpload${Date.now()}`;
    const resolvedMime = mimeType || 'image/png';
    const resolvedName = fileName || `upload.${resolvedMime.includes('jpeg') || resolvedMime.includes('jpg') ? 'jpg' : 'png'}`;

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${resolvedName}"\r\n`,
      `Content-Type: ${resolvedMime}\r\n\r\n`,
    ];
    const header = Buffer.from(bodyParts.join(''));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([header, buffer, footer]);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ATLAS_CLOUD_TIMEOUT_MS);

    const response = await fetch('https://api.atlascloud.ai/api/v1/model/uploadMedia', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(multipartBody.length),
      },
      body: multipartBody,
      signal: abort.signal,
    });
    clearTimeout(timer);

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { rawResponse: text }; }

    console.log(`[Proxy] Atlas Cloud uploadMedia response: ${response.status}`);
    return res.status(response.status).json(data);
  } catch (error) {
    console.error(`[Proxy] Atlas Cloud uploadMedia failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.use('/atlas-cloud-api', async (req, res) => {
  const apiKey = req.headers['x-atlas-cloud-key'];
  if (!apiKey) {
    console.error('[Proxy] Missing Atlas Cloud API key');
    return res.status(401).json({ error: 'Missing API key' });
  }

  const apiPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
  const url = `https://api.atlascloud.ai/api/v1/model/${apiPath}`;

  const MAX_PROXY_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_PROXY_RETRIES; attempt++) {
    try {
      console.log(`[Proxy] Forwarding ${req.method} to Atlas Cloud: ${url} (attempt ${attempt})`);

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), ATLAS_CLOUD_TIMEOUT_MS);

      const fetchOptions = {
        method: req.method,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: abort.signal,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timer);

      console.log(`[Proxy] Atlas Cloud response status: ${response.status}`);

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { rawResponse: text };
      }

      if (response.status >= 400) {
        console.error(`[Proxy] Atlas Cloud error response:`, data);
      }

      return res.status(response.status).json(data);
    } catch (error) {
      const isTimeout = String(error?.message || '').toLowerCase().includes('abort');
      console.error(`[Proxy] Atlas Cloud attempt ${attempt}/${MAX_PROXY_RETRIES} failed: ${error.message} (timeout=${isTimeout})`);

      if (attempt >= MAX_PROXY_RETRIES) {
        return res.status(isTimeout ? 504 : 500).json({ error: error.message, timeout: isTimeout });
      }
      // Brief pause before retry
      await new Promise(r => setTimeout(r, 2000));
    }
  }
});

// ============================================
// MidAPI Diagnostic Test — test different task types to isolate failures
// ============================================
let lastMidapiToken = null; // Captured from client requests

app.get('/midapi-test', async (req, res) => {
  if (!lastMidapiToken) {
    return res.status(400).json({ error: 'No MidAPI token captured yet. Make a generation request first.' });
  }

  // A known public image URL for testing (Midjourney sample)
  const publicImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';
  // Also test with our ngrok URL if available
  const refImagesDir = path.resolve(__dirname, '.ref-images');
  let ngrokImageUrl = null;
  if (fs.existsSync(refImagesDir)) {
    const files = fs.readdirSync(refImagesDir).filter(f => f.match(/\.(jpg|jpeg|png)$/i));
    if (files.length > 0 && process.env.PROXY_PUBLIC_URL) {
      ngrokImageUrl = `${process.env.PROXY_PUBLIC_URL}/ref-images/${files[files.length - 1]}`;
    }
  }

  const tests = [];
  const baseUrl = 'https://api.midapi.ai/api/v1/mj';
  const headers = { 'Authorization': `Bearer ${lastMidapiToken}`, 'Content-Type': 'application/json' };

  // Test 1: Simple txt2img (no images)
  try {
    const r = await fetch(`${baseUrl}/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({ taskType: 'mj_txt2img', prompt: 'a red circle on white background --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0 })
    });
    const d = await r.json();
    tests.push({ test: 'txt2img (no images)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
  } catch (e) { tests.push({ test: 'txt2img', error: e.message }); }

  // Test 2: omni_reference with PUBLIC image
  try {
    const r = await fetch(`${baseUrl}/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [publicImageUrl], ow: 100 })
    });
    const d = await r.json();
    tests.push({ test: 'omni_reference (public URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
  } catch (e) { tests.push({ test: 'omni_reference (public URL)', error: e.message }); }

  // Test 3: omni_reference with NGROK image (if available)
  if (ngrokImageUrl) {
    try {
      const r = await fetch(`${baseUrl}/generate`, {
        method: 'POST', headers,
        body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [ngrokImageUrl], ow: 100 })
      });
      const d = await r.json();
      tests.push({ test: 'omni_reference (ngrok URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null, imageUrl: ngrokImageUrl });
    } catch (e) { tests.push({ test: 'omni_reference (ngrok URL)', error: e.message }); }
  } else {
    tests.push({ test: 'omni_reference (ngrok URL)', skipped: true, reason: 'No ngrok ref images found' });
  }

  // Test 4: img2img with PUBLIC image
  try {
    const r = await fetch(`${baseUrl}/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({ taskType: 'mj_img2img', prompt: 'a person standing, cartoon style --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [publicImageUrl] })
    });
    const d = await r.json();
    tests.push({ test: 'img2img (public URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
  } catch (e) { tests.push({ test: 'img2img (public URL)', error: e.message }); }

  // Test 5: omni_reference with CATBOX URL (upload an image to catbox first)
  const catboxRefDir = path.resolve(__dirname, '.ref-images');
  let catboxTestUrl = null;
  if (fs.existsSync(catboxRefDir)) {
    const catboxFiles = fs.readdirSync(catboxRefDir).filter(f => f.match(/\.(jpg|jpeg|png)$/i));
    if (catboxFiles.length > 0) {
      try {
        const imgBuf = fs.readFileSync(path.join(catboxRefDir, catboxFiles[catboxFiles.length - 1]));
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', new Blob([imgBuf], { type: 'image/jpeg' }), 'test-ref.jpg');
        const cbRes = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
        catboxTestUrl = (await cbRes.text()).trim();
        if (!catboxTestUrl.startsWith('https://')) catboxTestUrl = null;
      } catch (e) { console.warn('[Proxy] catbox upload for test failed:', e.message); }
    }
  }
  if (catboxTestUrl) {
    try {
      const r = await fetch(`${baseUrl}/generate`, {
        method: 'POST', headers,
        body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [catboxTestUrl], ow: 100 })
      });
      const d = await r.json();
      tests.push({ test: 'omni_reference (catbox URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null, imageUrl: catboxTestUrl });
    } catch (e) { tests.push({ test: 'omni_reference (catbox URL)', error: e.message }); }
  } else {
    tests.push({ test: 'omni_reference (catbox URL)', skipped: true, reason: 'No ref images to upload' });
  }

  // Test 5: Check credits
  try {
    const r = await fetch('https://api.midapi.ai/common/get-account-credits', { method: 'GET', headers });
    const d = await r.json();
    tests.push({ test: 'account credits', status: r.status, data: d });
  } catch (e) { tests.push({ test: 'account credits', error: e.message }); }

  // Now poll the submitted tasks to see if they complete or fail
  console.log('[Proxy] MidAPI diagnostic: waiting 25s for tasks to process...');
  await new Promise(r => setTimeout(r, 25000));

  // Poll each task that was submitted
  const pollResults = [];
  for (const t of tests) {
    if (!t.taskId) continue;
    try {
      const r = await fetch(`${baseUrl}/record-info?taskId=${t.taskId}`, { method: 'GET', headers });
      const d = await r.json();
      const td = d.data || {};
      pollResults.push({
        test: t.test,
        taskId: t.taskId,
        successFlag: td.successFlag,
        errorMessage: td.errorMessage || null,
        hasResultUrls: !!(td.resultInfoJson?.resultUrls?.length),
        resultUrlCount: td.resultInfoJson?.resultUrls?.length || 0,
      });
    } catch (e) { pollResults.push({ test: t.test, taskId: t.taskId, pollError: e.message }); }
  }

  console.log('[Proxy] MidAPI diagnostic submit results:', JSON.stringify(tests, null, 2));
  console.log('[Proxy] MidAPI diagnostic poll results:', JSON.stringify(pollResults, null, 2));
  res.json({ timestamp: new Date().toISOString(), submits: tests, pollAfter25s: pollResults });
});

// Quick poll endpoint for diagnostic tasks
app.get('/midapi-poll/:taskId', async (req, res) => {
  if (!lastMidapiToken) return res.status(400).json({ error: 'No token' });
  try {
    const r = await fetch(`https://api.midapi.ai/api/v1/mj/record-info?taskId=${req.params.taskId}`, {
      method: 'GET', headers: { 'Authorization': `Bearer ${lastMidapiToken}` }
    });
    const d = await r.json();
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// MidAPI Callback Cache — stores results from MidAPI webhook callbacks
// so polling can return instantly from local cache instead of hitting MidAPI again
// ============================================
const midapiCallbackCache = new Map(); // taskId → { receivedAt, data }

// Webhook endpoint: MidAPI POSTs here when a task completes
app.post('/midapi-callback', (req, res) => {
  const callbackData = req.body;
  const taskId = callbackData?.data?.taskId || callbackData?.taskId;
  if (!taskId) {
    console.warn('[Proxy] MidAPI callback received without taskId:', JSON.stringify(callbackData).substring(0, 300));
    return res.status(200).json({ received: true }); // Always 200 so MidAPI doesn't retry
  }
  const d = callbackData?.data || callbackData;
  const successFlag = d?.successFlag;
  const hasResultUrls = Array.isArray(d?.resultUrls) && d.resultUrls.length > 0;
  const hasNestedUrls = Array.isArray(d?.resultInfoJson?.resultUrls) && d.resultInfoJson.resultUrls.length > 0;
  const callbackCode = callbackData?.code;
  const isError = callbackCode >= 400 || (callbackData?.msg && callbackData.msg.toLowerCase().includes('fail'));
  const isTerminal = successFlag === 1 || successFlag === 2 || successFlag === 3 || hasResultUrls || hasNestedUrls || isError;
  console.log(`[Proxy] MidAPI CALLBACK received for task ${taskId}, successFlag=${successFlag}, hasResultUrls=${hasResultUrls}, hasNestedUrls=${hasNestedUrls}, isTerminal=${isTerminal}`);
  console.log(`[Proxy] MidAPI callback data keys: ${Object.keys(d || {}).join(', ')}`);
  console.log(`[Proxy] MidAPI callback data: ${JSON.stringify(callbackData).substring(0, 1500)}`);

  // Only cache callbacks that represent a terminal state (completed, failed, or has result URLs).
  // Intermediate/acknowledgment callbacks (just promptJson + taskId, no results) must NOT be cached,
  // otherwise polling will serve stale cache data and never see actual completion from MidAPI.
  if (isTerminal) {
    const normalizedData = callbackData?.code !== undefined ? callbackData : { code: 200, msg: 'callback', data: callbackData };
    midapiCallbackCache.set(taskId, { receivedAt: Date.now(), data: normalizedData });
    console.log(`[Proxy] MidAPI: Cached terminal callback for task ${taskId}`);
  } else {
    console.log(`[Proxy] MidAPI: Skipped caching non-terminal callback for task ${taskId} (no results yet)`);
  }

  // Clean up old entries (>30 min) to prevent memory leaks
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [tid, entry] of midapiCallbackCache) {
    if (entry.receivedAt < cutoff) midapiCallbackCache.delete(tid);
  }

  res.status(200).json({ received: true, taskId });
});

// Middleware to handle MidAPI Midjourney API proxy (no Discord token required)
// Documentation: https://docs.midapi.ai/mj-api/quickstart
// Enhanced: auto-injects callBackUrl and serves cached callback results
app.use('/midapi', async (req, res) => {
  const token = req.headers['x-midapi-token'];
  if (token) lastMidapiToken = token; // Capture for diagnostic endpoint
  if (!token) {
    console.error('[Proxy] Missing MidAPI token');
    return res.status(401).json({ error: 'Missing API token' });
  }

  // Extract the actual API path (everything after /midapi)
  const apiPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;

  // For record-info polls: check callback cache first before hitting MidAPI
  if (apiPath.includes('record-info') && req.method === 'GET') {
    const taskMatch = apiPath.match(/taskId=([^&]+)/);
    const tid = taskMatch ? taskMatch[1] : null;
    if (tid && midapiCallbackCache.has(tid)) {
      const cached = midapiCallbackCache.get(tid);
      const ageSec = Math.round((Date.now() - cached.receivedAt) / 1000);
      console.log(`[Proxy] MidAPI: Returning CACHED callback result for ${tid} (cached ${ageSec}s ago)`);
      return res.status(200).json(cached.data);
    }
  }

  const url = `https://api.midapi.ai/${apiPath}`;
  const midapiAbort = new AbortController();
  const midapiTimer = setTimeout(() => midapiAbort.abort(), 60000);

  try {
    console.log(`[Proxy] Forwarding ${req.method} to MidAPI: ${url}`);
    
    let body = req.body;

    // For generate requests: auto-inject callBackUrl if PROXY_PUBLIC_URL is set
    if (apiPath.includes('generate') && req.method === 'POST' && body) {
      const publicUrl = process.env.PROXY_PUBLIC_URL;
      if (publicUrl && !body.callBackUrl) {
        body = { ...body, callBackUrl: `${publicUrl.replace(/\/$/, '')}/midapi-callback` };
        console.log(`[Proxy] MidAPI: Injected callBackUrl: ${body.callBackUrl}`);
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: midapiAbort.signal,
    };
    
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && body) {
      fetchOptions.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, fetchOptions);
    clearTimeout(midapiTimer);

    console.log(`[Proxy] MidAPI response status: ${response.status}`);
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }
    
    if (response.status >= 400) {
      console.error(`[Proxy] MidAPI error response:`, data);
    }

    if (apiPath.includes('record-info') && data?.data) {
      const d = data.data;
      const taskMatch = apiPath.match(/taskId=([^&]+)/);
      const tid = taskMatch ? taskMatch[1] : 'unknown';
      if (!global._loggedTaskIds) global._loggedTaskIds = new Map();
      if (!global._loggedTaskIds.has(tid)) {
        global._loggedTaskIds.set(tid, Date.now());
        console.log(`[Proxy] MidAPI FULL poll response for ${tid}:`, JSON.stringify(data).substring(0, 2000));
        if (global._loggedTaskIds.size > 200) {
          const oldest = [...global._loggedTaskIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
          for (const [k] of oldest) global._loggedTaskIds.delete(k);
        }
      }
      const hasNestedResultUrls = !!(d.resultInfoJson?.resultUrls?.length);
      const hasDirectResultUrls = !!(d.resultUrls?.length);
      const directResultUrlsSample = d.resultUrls ? JSON.stringify(d.resultUrls).substring(0, 200) : 'none';
      console.log(`[Proxy] MidAPI poll: successFlag=${d.successFlag}, status=${d.status}, errorMessage=${d.errorMessage || 'none'}, hasResultUrls(nested)=${hasNestedResultUrls}, hasResultUrls(direct)=${hasDirectResultUrls}`);
      if (hasDirectResultUrls) {
        console.log(`[Proxy] MidAPI poll: direct resultUrls: ${directResultUrlsSample}`);
      }
      if (!global._pollCounts) global._pollCounts = {};
      if (!global._pollCounts[tid]) global._pollCounts[tid] = 0;
      global._pollCounts[tid]++;
      if (global._pollCounts[tid] <= 5 || global._pollCounts[tid] % 10 === 0) {
        console.log(`[Proxy] MidAPI poll #${global._pollCounts[tid]} keys: ${JSON.stringify(Object.keys(d))}`);
      }
      const pollKeys = Object.keys(global._pollCounts);
      if (pollKeys.length > 200) {
        for (const k of pollKeys.slice(0, pollKeys.length - 100)) delete global._pollCounts[k];
      }
    }
    if (apiPath.includes('generate') && req.method === 'POST') {
      console.log(`[Proxy] MidAPI generate response:`, JSON.stringify(data).substring(0, 500));
    }
    
    res.status(response.status).json(data);
  } catch (error) {
    clearTimeout(midapiTimer);
    console.error(`[Proxy] Error calling MidAPI: ${error.message}`);
    const isTimeout = String(error?.message || '').toLowerCase().includes('abort');
    res.status(isTimeout ? 504 : 500).json({ error: error.message, timeout: isTimeout });
  }
});

// ============================================

// Retryable HTTP status codes from Anthropic (transient errors worth retrying)
const RETRYABLE_ANTHROPIC_STATUSES = new Set([429, 500, 502, 503, 529]);

// Proxy endpoint for Anthropic API — retry/timeout policy is centralized in llm-transport-policy.js

app.post('/v1/messages', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    console.error('[Proxy] Missing API key');
    return res.status(401).json({ error: 'Missing API key' });
  }

  const bodyStr = JSON.stringify(req.body);
  const bodySize = bodyStr.length;
  const budgets = getLlmTransportBudgets(req, req.body, bodySize);
  const responseTimeoutMs = budgets.responseTimeoutMs;
  let lastError = null;
  let lastElapsedMs = 0;

  for (let attempt = 1; attempt <= budgets.retries; attempt++) {
    const attemptConnectMs = (budgets.connectTimeoutsPerAttempt && budgets.connectTimeoutsPerAttempt[attempt - 1])
      || budgets.connectTimeoutMs;
    const attemptStartedAt = Date.now();
    const connectAbort = new AbortController();
    const connectTimer = setTimeout(() => connectAbort.abort(), attemptConnectMs);

    try {
      if (attempt === 1) {
        console.log(`[Proxy] Forwarding request to Anthropic... (step: ${budgets.step || 'unknown'}, Body size: ${bodySize} bytes, connectTimeout: ${attemptConnectMs}ms, responseTimeout: ${responseTimeoutMs}ms)`);
      } else {
        console.log(`[Proxy] Anthropic retry ${attempt}/${budgets.retries} (step: ${budgets.step || 'unknown'}, connectTimeout: ${attemptConnectMs}ms)`);
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        },
        body: bodyStr,
        signal: connectAbort.signal,
      });
      clearTimeout(connectTimer);

      const headerElapsedMs = Date.now() - attemptStartedAt;
      console.log(`[Proxy] Anthropic response status: ${response.status} (headers in ${headerElapsedMs}ms)`);

      if (RETRYABLE_ANTHROPIC_STATUSES.has(response.status) && attempt < budgets.retries) {
        const errBody = await response.text().catch(() => '');
        const elapsedMs = Date.now() - attemptStartedAt;
        const retryDelay = response.status === 429
          ? Math.max(budgets.retryDelaysMs[attempt - 1], 10000)
          : budgets.retryDelaysMs[attempt - 1];
        console.warn(`[Proxy] Anthropic returned ${response.status} after ${elapsedMs}ms, will retry in ${retryDelay}ms. Body: ${errBody.substring(0, 200)}`);
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }

      const bodyTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Response body timeout after ${responseTimeoutMs}ms`)), responseTimeoutMs)
      );

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await Promise.race([response.text(), bodyTimeout]);
        const data = JSON.parse(text);
        res.status(response.status).json(data);
      } else {
        const text = await Promise.race([response.text(), bodyTimeout]);
        console.error(`[Proxy] Non-JSON response from Anthropic: ${text.substring(0, 200)}`);
        res.status(response.status).send(text);
      }
      return;

    } catch (error) {
      clearTimeout(connectTimer);
      lastError = error;
      lastElapsedMs = Date.now() - attemptStartedAt;
      const causeValue = error?.cause?.message || error?.cause?.code || error?.cause;
      const cause = causeValue ? ` [cause: ${causeValue}]` : '';
      const abortKind = String(error?.message || '').toLowerCase().includes('abort')
        ? (lastElapsedMs >= attemptConnectMs * 0.9 ? 'timeout/abort' : 'connect-abort')
        : 'fetch-error';
      console.error(`[Proxy] Anthropic fetch attempt ${attempt}/${budgets.retries} FAILED (${abortKind}, ${lastElapsedMs}ms, limit ${attemptConnectMs}ms): ${error.message}${cause}`);

      if (attempt < budgets.retries) {
        const delay = budgets.retryDelaysMs[attempt - 1];
        console.log(`[Proxy] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const causeValue = lastError?.cause?.message || lastError?.cause?.code || lastError?.cause;
  const cause = causeValue ? ` [cause: ${causeValue}]` : '';
  console.error(`[Proxy] Anthropic request failed after ${budgets.retries} attempts (${lastElapsedMs}ms last attempt): ${lastError.message}${cause}`);
  res.status(502).json({
    error: `Anthropic API unreachable after ${budgets.retries} attempts: ${lastError.message}`,
    cause: causeValue || undefined,
    retries: budgets.retries,
    elapsedMs: lastElapsedMs,
    bodySize,
    connectTimeoutMs: budgets.connectTimeoutMs,
    responseTimeoutMs,
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on http://localhost:${PORT}`);

  // On startup: immediately clean up any orphaned jobs from a previous proxy session
  const startupJobs = loadWorkerJobs();
  const { normalized: startupNormalized, changed: startupChanged } = normalizeStaleWorkerJobs(startupJobs);
  if (startupChanged) {
    saveWorkerJobs(startupNormalized);
    const orphaned = startupNormalized.filter(j => j.deadLetter && j.error?.includes('orphaned'));
    if (orphaned.length > 0) {
      console.log(`[Proxy] Startup cleanup: marked ${orphaned.length} orphaned job(s) as failed`);
    }
  }

  setInterval(() => {
    try {
      const jobs = loadWorkerJobs();
      const { normalized, changed } = normalizeStaleWorkerJobs(jobs);

      const now = Date.now();
      let pruned = 0;
      const kept = normalized.filter((j) => {
        if (!j) return false;
        if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
          const fin = new Date(j.finishedAt || j.updatedAt || 0).getTime();
          if (Number.isFinite(fin) && now - fin > WORKER_COMPLETED_PRUNE_MS) {
            pruned++;
            return false;
          }
        }
        return true;
      });

      if (changed || pruned > 0) {
        saveWorkerJobs(kept);
        if (pruned > 0) console.log(`[Proxy] Periodic cleanup: pruned ${pruned} old completed worker job(s)`);
        if (changed) console.log('[Proxy] Periodic cleanup: updated stale/orphaned worker job(s)');
      }

      // Prune old checkpoints whose jobs no longer exist
      const jobIds = new Set(kept.map((j) => j.id));
      const checkpoints = loadCheckpoints();
      const keptCheckpoints = checkpoints.filter((c) => jobIds.has(c.jobId));
      if (keptCheckpoints.length < checkpoints.length) {
        saveCheckpoints(keptCheckpoints);
        console.log(`[Proxy] Periodic cleanup: pruned ${checkpoints.length - keptCheckpoints.length} orphaned checkpoint(s)`);
      }

      // Clean midapiCallbackCache entries older than 30 min
      const cacheCutoff = now - 30 * 60 * 1000;
      let cacheDeleted = 0;
      for (const [tid, entry] of midapiCallbackCache) {
        if (entry.receivedAt < cacheCutoff) { midapiCallbackCache.delete(tid); cacheDeleted++; }
      }

      // Clean stale worker result cache entries
      let resultCacheDeleted = 0;
      for (const [jid, entry] of workerResultCache) {
        if (Date.now() - entry.storedAt > WORKER_RESULT_TTL_MS) { workerResultCache.delete(jid); resultCacheDeleted++; }
      }

      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      console.log(`[Proxy] Memory: heap=${heapMB}MB, rss=${rssMB}MB, workerJobs=${kept.length}, callbacks=${midapiCallbackCache.size}, resultCache=${workerResultCache.size}, streamClients=${workerStreamClients.size}`);

      // Emergency memory relief: aggressively trim stored data when heap is high
      if (heapMB > 512) {
        console.warn(`[Proxy] HIGH MEMORY (${heapMB}MB) — emergency trimming worker data`);
        let trimmed = 0;
        for (const job of kept) {
          if (Array.isArray(job.timeline) && job.timeline.length > 50) {
            trimmed += job.timeline.length - 50;
            job.timeline = job.timeline.slice(-50);
          }
          if (Array.isArray(job.imageJobs) && job.imageJobs.length > 50) {
            trimmed += job.imageJobs.length - 50;
            job.imageJobs = job.imageJobs.slice(-50);
          }
          if (Array.isArray(job.imageManifest) && job.imageManifest.length > 50) {
            trimmed += job.imageManifest.length - 50;
            job.imageManifest = job.imageManifest.slice(-50);
          }
          delete job.result;
        }
        if (trimmed > 0) {
          saveWorkerJobs(kept);
          console.warn(`[Proxy] Emergency trim: removed ${trimmed} entries`);
        }
        // Also aggressively prune checkpoints
        const cpAll = loadCheckpoints();
        for (const cp of cpAll) {
          if (cp.outputs) cp.outputs = {};
        }
        saveCheckpoints(cpAll);
        // Force GC if available
        if (global.gc) { global.gc(); console.log('[Proxy] Forced GC after emergency trim'); }
      }
    } catch (err) {
      console.warn('[Proxy] Periodic cleanup error:', err.message || err);
    }
  }, 60 * 1000);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

function flushAllStores() {
  jobsStore.flushSync();
  workerJobsStore.flushSync();
  checkpointsStore.flushSync();
  deadLetterStore.flushSync();
  feedbackStore.flushSync();
}

process.on('SIGTERM', () => { flushAllStores(); process.exit(0); });
process.on('SIGINT', () => { flushAllStores(); process.exit(0); });
process.on('exit', flushAllStores);
