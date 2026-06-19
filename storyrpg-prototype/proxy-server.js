/**
 * StoryRPG proxy server bootstrap.
 *
 * All the per-feature route handlers live in `proxy/*.js` modules that
 * each export a `register*Routes(app, deps)` function. This file wires
 * them up, owns periodic cleanup, and handles graceful shutdown.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { getBudgets: getLlmTransportBudgets } = require('./llm-transport-policy');
const { createCachedStore } = require('./proxy/cachedJsonStore');
const { createStoryCatalog } = require('./proxy/storyCatalog');
const { estimateWorkerProgress } = require('./proxy/workerProgress');
const { createSyncGenerationMirrorFromWorker } = require('./proxy/workerJobSync');

const { registerCatalogRoutes } = require('./proxy/catalogRoutes');
const { registerRefImageRoutes } = require('./proxy/refImageRoutes');
const { registerStableDiffusionRoutes } = require('./proxy/stableDiffusionRoutes');
const { registerLoraTrainingRoutes } = require('./proxy/loraTrainingRoutes');
const { registerFileRoutes } = require('./proxy/fileRoutes');
const { registerStoryMutationRoutes } = require('./proxy/storyMutationRoutes');
const { registerModelScanRoutes } = require('./proxy/modelScanRoutes');
const { registerGeneratorSettingsRoutes } = require('./proxy/generatorSettingsRoutes');
const { registerAnthropicProxyRoutes } = require('./proxy/anthropicProxyRoutes');
const { registerMemoryRoutes } = require('./proxy/memoryRoutes');
const { registerElevenLabsRoutes } = require('./proxy/elevenLabsRoutes');
const { registerAtlasCloudRoutes } = require('./proxy/atlasCloudRoutes');
const { registerMidApiRoutes } = require('./proxy/midApiRoutes');
const { registerImageFeedbackRoutes } = require('./proxy/imageFeedbackRoutes');
const { registerStyleRoutes } = require('./proxy/styleRoutes');
const { registerArtifactRoutes } = require('./proxy/artifactRoutes');
const { createWorkerLifecycle } = require('./proxy/workerLifecycle');
const { registerGenerationJobRoutes } = require('./proxy/generationJobRoutes');
const { createRuntimeLayout } = require('./proxy/runtimePaths');
const { getStoryStorageMode, getGcsBucketName, getGcsPublicBaseUrl, mapProxyPathToGcsObjectPath } = require('./proxy/gcsConfig');
const { resolveGeneratedStoryAssetFallback } = require('./proxy/generatedStoryAssetFallback');
const { registerAuthRoutes } = require('./proxy/authRoutes');
const { createCorsOptions, createExposureGuard } = require('./proxy/proxyGuards');

const app = express();
if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
const PORT = Number(process.env.PORT) || 3001;
const ROOT_DIR = __dirname;
const RUNTIME = createRuntimeLayout(ROOT_DIR);
process.env.STORYRPG_RUNTIME_DIR = RUNTIME.runtimeRoot;
process.env.STORIES_DIR = RUNTIME.storiesDir;
process.env.MEMORY_DIR = RUNTIME.pipelineMemoryRoot;
const STORIES_DIR = RUNTIME.storiesDir;
const REF_IMAGES_DIR = RUNTIME.refImagesDir;
const PIPELINE_MEMORY_ROOT = RUNTIME.pipelineMemoryRoot;
const DELETED_STORIES_FILE = RUNTIME.deletedStoriesFile;
const WORKER_CHECKPOINT_OUTPUT_DIR = RUNTIME.workerCheckpointOutputDir;

const { listLatestStoryRecords, createStoryCatalogEntry, createFullStoryResponse } =
  createStoryCatalog(STORIES_DIR, PORT);

// General request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [Proxy] ${req.method} ${req.url} (Origin: ${req.headers.origin || 'none'})`);
  next();
});

// Static file serving for generated-stories (permissive CORS so web build works)
app.use('/generated-stories', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Private-Network', 'true');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const mode = getStoryStorageMode();
  if (mode === 'gcs') {
    const bucket = getGcsBucketName();
    if (!bucket) return res.status(500).send('GCS_BUCKET_NAME is required when STORY_STORAGE_MODE=gcs');

    // Redirect proxy-style paths to GCS objects.
    // /generated-stories/<runDir>/...  ->  https://storage.googleapis.com/<bucket>/stories/<runDir>/...
    const proxyPath = `generated-stories/${req.path.replace(/^\/+/, '')}`;
    const objectPath = mapProxyPathToGcsObjectPath(proxyPath);
    if (!objectPath) return res.status(404).send('Not found');

    const publicBase = getGcsPublicBaseUrl();
    const url = `${publicBase}/${objectPath}`.replace(/([^:]\/)\/+/g, '$1');
    return res.redirect(302, url);
  }

  const filePathWithinDir = req.path;
  let fullPath = path.join(STORIES_DIR, filePathWithinDir);

  if (!fs.existsSync(fullPath)) {
    const fallbackPath = resolveGeneratedStoryAssetFallback(STORIES_DIR, filePathWithinDir);
    if (!fallbackPath) {
      return res.status(404).send('File not found');
    }
    fullPath = fallbackPath;
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

// CORS allowlist (localhost always allowed; external origins must be in
// PROXY_ALLOWED_ORIGINS unless PROXY_ALLOW_ALL_ORIGINS=1). See L1 in
// docs/PROJECT_AUDIT_2026-05-28.md.
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: '50mb' }));

// OAuth (Passport) + sessions — must run before routes that read req.user
registerAuthRoutes(app, { port: PORT });

// Exposure auth gate — no-op locally; when PROXY_REQUIRE_AUTH=1 (set this
// before exposing the proxy via ngrok / deploy) it requires an authenticated
// session or a PROXY_API_TOKEN bearer for all mutating requests.
app.use(createExposureGuard());

registerCatalogRoutes(app, {
  listLatestStoryRecords,
  createStoryCatalogEntry,
  createFullStoryResponse,
});
registerRefImageRoutes(app, { refImagesDir: REF_IMAGES_DIR, port: PORT });
registerStableDiffusionRoutes(app);
registerLoraTrainingRoutes(app);
registerFileRoutes(app, {
  rootDir: ROOT_DIR,
  storiesDir: STORIES_DIR,
  refImagesDir: REF_IMAGES_DIR,
  pipelineMemoryRoot: PIPELINE_MEMORY_ROOT,
  workerCheckpointOutputDir: WORKER_CHECKPOINT_OUTPUT_DIR,
});
registerStoryMutationRoutes(app, {
  storiesDir: STORIES_DIR,
  deletedStoriesFile: DELETED_STORIES_FILE,
});
registerModelScanRoutes(app, { cacheFile: RUNTIME.modelCacheFile });
registerGeneratorSettingsRoutes(app, { settingsFile: RUNTIME.generatorSettingsFile });

// Worker lifecycle owns the generation-jobs / worker-jobs stores and the
// ts-node worker spawn state machine.
const lifecycle = createWorkerLifecycle({
  rootDir: ROOT_DIR,
  storiesDir: STORIES_DIR,
  runtimeRoot: RUNTIME.runtimeRoot,
  generationJobsFile: RUNTIME.generationJobsFile,
  workerJobsFile: RUNTIME.workerJobsFile,
  workerCheckpointsFile: RUNTIME.workerCheckpointsFile,
  workerDeadLetterFile: RUNTIME.workerDeadLetterFile,
  workerCheckpointOutputDir: WORKER_CHECKPOINT_OUTPUT_DIR,
  port: PORT,
  cachedJsonStore: createCachedStore,
  createSyncGenerationMirrorFromWorker,
  estimateWorkerProgress,
});
registerGenerationJobRoutes(app, lifecycle, {
  rootDir: ROOT_DIR,
  storiesDir: STORIES_DIR,
  workerCheckpointOutputDir: WORKER_CHECKPOINT_OUTPUT_DIR,
});
lifecycle.registerWorkerLifecycleRoutes(app);

registerMemoryRoutes(app, { memoryRoot: PIPELINE_MEMORY_ROOT });
registerElevenLabsRoutes(app, { audioRootDir: STORIES_DIR, port: PORT });
const { feedbackStore } = registerImageFeedbackRoutes(app, {
  rootDir: ROOT_DIR,
  storiesDir: STORIES_DIR,
  feedbackFile: RUNTIME.imageFeedbackFile,
  cachedJsonStore: createCachedStore,
});
registerStyleRoutes(app, { storiesDir: STORIES_DIR });
registerArtifactRoutes(app, { storiesDir: STORIES_DIR });
registerAtlasCloudRoutes(app);
const { midapiCallbackCache } = registerMidApiRoutes(app, {
  rootDir: ROOT_DIR,
  refImagesDir: REF_IMAGES_DIR,
});
registerAnthropicProxyRoutes(app, { getLlmTransportBudgets });

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
  console.log(`[Proxy] Runtime root: ${RUNTIME.runtimeRoot}${RUNTIME.ephemeral ? ' (ephemeral)' : ''}`);
  console.log(`[Proxy] Stories dir: ${STORIES_DIR}`);

  // Startup cleanup: fail orphaned worker jobs left over from a prior session.
  const startupJobs = lifecycle.loadWorkerJobs();
  const { normalized: startupNormalized, changed: startupChanged } =
    lifecycle.normalizeStaleWorkerJobs(startupJobs);
  if (startupChanged) {
    lifecycle.saveWorkerJobs(startupNormalized);
    const orphaned = startupNormalized.filter((j) => j.deadLetter && j.error?.includes('orphaned'));
    if (orphaned.length > 0) {
      console.log(`[Proxy] Startup cleanup: marked ${orphaned.length} orphaned job(s) as failed`);
    }
  }

  setInterval(() => {
    try {
      const jobs = lifecycle.loadWorkerJobs();
      const { normalized, changed } = lifecycle.normalizeStaleWorkerJobs(jobs);

      const now = Date.now();
      let pruned = 0;
      const kept = normalized.filter((j) => {
        if (!j) return false;
        if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
          const fin = new Date(j.finishedAt || j.updatedAt || 0).getTime();
          if (Number.isFinite(fin) && now - fin > lifecycle.constants.WORKER_COMPLETED_PRUNE_MS) {
            pruned++;
            return false;
          }
        }
        return true;
      });

      if (changed || pruned > 0) {
        lifecycle.saveWorkerJobs(kept);
        if (pruned > 0) console.log(`[Proxy] Periodic cleanup: pruned ${pruned} old completed worker job(s)`);
        if (changed) console.log('[Proxy] Periodic cleanup: updated stale/orphaned worker job(s)');
      }

      // Prune checkpoints whose jobs no longer exist.
      const jobIds = new Set(kept.map((j) => j.id));
      const checkpoints = lifecycle.loadCheckpoints();
      const keptCheckpoints = checkpoints.filter((c) => jobIds.has(c.jobId));
      if (keptCheckpoints.length < checkpoints.length) {
        lifecycle.saveCheckpoints(keptCheckpoints);
        console.log(`[Proxy] Periodic cleanup: pruned ${checkpoints.length - keptCheckpoints.length} orphaned checkpoint(s)`);
      }

      // Clean midapi callback cache entries older than 30 min.
      const cacheCutoff = now - 30 * 60 * 1000;
      for (const [tid, entry] of midapiCallbackCache) {
        if (entry.receivedAt < cacheCutoff) midapiCallbackCache.delete(tid);
      }

      // Clean stale worker result cache entries.
      for (const [jid, entry] of lifecycle.workerResultCache) {
        if (Date.now() - entry.storedAt > lifecycle.constants.WORKER_RESULT_TTL_MS) {
          lifecycle.workerResultCache.delete(jid);
        }
      }

      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      console.log(
        `[Proxy] Memory: heap=${heapMB}MB, rss=${rssMB}MB, workerJobs=${kept.length}, ` +
        `callbacks=${midapiCallbackCache.size}, resultCache=${lifecycle.workerResultCache.size}, ` +
        `streamClients=${lifecycle.workerStreamClients.size}`,
      );

      // Emergency relief when heap gets too large.
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
          lifecycle.saveWorkerJobs(kept);
          console.warn(`[Proxy] Emergency trim: removed ${trimmed} entries`);
        }
        const cpAll = lifecycle.loadCheckpoints();
        for (const cp of cpAll) {
          if (cp.outputs) cp.outputs = {};
        }
        lifecycle.saveCheckpoints(cpAll);
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
  lifecycle.jobsStore.flushSync();
  lifecycle.workerJobsStore.flushSync();
  lifecycle.checkpointsStore.flushSync();
  lifecycle.deadLetterStore.flushSync();
  feedbackStore.flushSync();
}

process.on('SIGTERM', () => { flushAllStores(); process.exit(0); });
process.on('SIGINT', () => { flushAllStores(); process.exit(0); });
