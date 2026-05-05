/**
 * Client-facing generation job tracking.
 *
 *   GET    /generation-jobs              — list (stale-filtered)
 *   GET    /generation-jobs/all          — legacy alias
 *   POST   /generation-jobs/refresh      — diagnostics helper
 *   POST   /generation-jobs              — register (upsert)
 *   GET    /generation-jobs/:jobId       — fetch one
 *   PATCH  /generation-jobs/:jobId       — update / upsert
 *   POST   /generation-jobs/:jobId/cancel — cancel (delegates to worker if applicable)
 *   DELETE /generation-jobs/:jobId       — delete
 *   GET    /generation-jobs/:jobId/status — lightweight cancel-poll
 */

const fs = require('fs');
const path = require('path');

const { atomicWriteJsonSync } = require('./atomicIo');
const manifestModule = require('./storyManifest');

function getJobOutputDir(job) {
  return job?.outputDir
    || job?.checkpoint?.resumeContext?.outputDirectory
    || job?.checkpoint?.outputs?.output_directory?.outputDirectory
    || job?.checkpoint?.requestPayload?.imageGenerationInput?.outputDirectory
    || job?.checkpoint?.resumeContext?.requestPayload?.imageGenerationInput?.outputDirectory
    || job?.requestPayload?.imageGenerationInput?.outputDirectory
    || job?.resumeContext?.requestPayload?.imageGenerationInput?.outputDirectory
    || job?.resumeContext?.outputDirectory;
}

function resolveStoryOutputDir(outputDir, { rootDir, storiesDir }) {
  if (!outputDir || typeof outputDir !== 'string') return null;
  const normalized = outputDir.replace(/^\/+/, '');
  const abs = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(rootDir, normalized);
  const resolved = path.resolve(abs);
  const storiesRoot = path.resolve(storiesDir);
  if (resolved !== storiesRoot && !resolved.startsWith(`${storiesRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function countTopLevelImageFiles(imagesDir) {
  if (!fs.existsSync(imagesDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) count++;
  }
  return count;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function computeImageStatsForOutputDir(outputDirAbs) {
  if (!outputDirAbs || !fs.existsSync(outputDirAbs)) return undefined;
  const generatedFiles = countTopLevelImageFiles(path.join(outputDirAbs, 'images'));
  const manifest = readJsonIfExists(path.join(outputDirAbs, 'image-manifest.json'));
  const totalSlots = Array.isArray(manifest?.slots) ? manifest.slots.length : undefined;

  let resolvedSlots = 0;
  const registryPath = path.join(outputDirAbs, 'asset-registry.jsonl');
  if (fs.existsSync(registryPath)) {
    try {
      const lines = fs.readFileSync(registryPath, 'utf8').split(/\r?\n/).filter(Boolean);
      const resolvedSlotIds = new Set();
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record?.status === 'succeeded' && (record.latestUrl || record.latestPath) && record.slot?.slotId) {
            resolvedSlotIds.add(record.slot.slotId);
          }
        } catch {
          // Ignore malformed historical registry lines.
        }
      }
      resolvedSlots = resolvedSlotIds.size;
    } catch {
      resolvedSlots = 0;
    }
  }

  return {
    generatedFiles,
    resolvedSlots,
    totalSlots,
    missingSlots: typeof totalSlots === 'number' ? Math.max(0, totalSlots - resolvedSlots) : undefined,
  };
}

function enrichJobsWithImageStats(jobs, { rootDir, storiesDir }) {
  const cache = new Map();
  return jobs.map((job) => {
    const outputDirAbs = resolveStoryOutputDir(getJobOutputDir(job), { rootDir, storiesDir });
    if (!outputDirAbs) return job;
    let imageStats = cache.get(outputDirAbs);
    if (!imageStats) {
      imageStats = computeImageStatsForOutputDir(outputDirAbs);
      cache.set(outputDirAbs, imageStats);
    }
    if (!imageStats) return job;
    return {
      ...job,
      outputDir: job.outputDir || path.relative(rootDir, outputDirAbs),
      imageStats,
      generatedImageCount: imageStats.generatedFiles,
      resolvedImageSlotCount: imageStats.resolvedSlots,
      totalImageSlotCount: imageStats.totalSlots,
      missingImageSlotCount: imageStats.missingSlots,
    };
  });
}

function scrubStoryImages(story) {
  if (!story || typeof story !== 'object') return;
  story.imagesStatus = 'pending';
  delete story.coverImage;
  delete story.styleAnchors;

  const episodes = Array.isArray(story.episodes) ? story.episodes : [];
  for (const episode of episodes) {
    if (!episode || typeof episode !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(episode, 'coverImage')) {
      episode.coverImage = '';
    }
    const scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
    for (const scene of scenes) {
      if (!scene || typeof scene !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(scene, 'backgroundImage')) {
        scene.backgroundImage = '';
      }
      const beats = Array.isArray(scene.beats) ? scene.beats : [];
      for (const beat of beats) {
        if (!beat || typeof beat !== 'object') continue;
        delete beat.image;
        delete beat.images;
        delete beat.imageUrl;
        delete beat.imagePath;
        delete beat.imagePrompt;
      }
    }
  }
}

function scrubStorySeasonReferences(story) {
  if (!story || typeof story !== 'object') return;
  delete story.styleAnchors;
}

function scrubStoryEpisodeArt(story) {
  if (!story || typeof story !== 'object') return;
  story.imagesStatus = 'pending';
  delete story.coverImage;

  const episodes = Array.isArray(story.episodes) ? story.episodes : [];
  for (const episode of episodes) {
    if (!episode || typeof episode !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(episode, 'coverImage')) {
      episode.coverImage = '';
    }
    const scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
    for (const scene of scenes) {
      if (!scene || typeof scene !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(scene, 'backgroundImage')) {
        scene.backgroundImage = '';
      }
      const beats = Array.isArray(scene.beats) ? scene.beats : [];
      for (const beat of beats) {
        if (!beat || typeof beat !== 'object') continue;
        delete beat.image;
        delete beat.images;
        delete beat.imageUrl;
        delete beat.imagePath;
        delete beat.imagePrompt;
      }
    }
  }
}

function scrubStoryPackageImages(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  scrubStoryImages(raw);
  if (raw.story && typeof raw.story === 'object') {
    scrubStoryImages(raw.story);
  }
  atomicWriteJsonSync(filePath, raw, { pretty: true });
  return true;
}

function rewriteStoryPackage(filePath, scrubber) {
  if (!fs.existsSync(filePath)) return false;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  scrubber(raw);
  if (raw.story && typeof raw.story === 'object') {
    scrubber(raw.story);
  }
  atomicWriteJsonSync(filePath, raw, { pretty: true });
  return true;
}

function updatePrimaryManifestHash(outputDirAbs) {
  const manifest = manifestModule.readManifest(outputDirAbs);
  const primaryStoryFile = manifest?.primaryStoryFile || (fs.existsSync(path.join(outputDirAbs, 'story.json')) ? 'story.json' : '08-final-story.json');
  const primaryPath = path.join(outputDirAbs, primaryStoryFile);
  if (!fs.existsSync(primaryPath)) return;
  const { sha256, bytes } = manifestModule.sha256OfFileSync(primaryPath);
  manifestModule.updateManifestForPrimaryRewrite(outputDirAbs, {
    primaryStoryHash: sha256,
    primaryStoryBytes: bytes,
  });
}

function rewriteStoryPackages(outputDirAbs, scrubber) {
  const rewritten = [];
  for (const filename of ['story.json', '08-final-story.json']) {
    const storyPath = path.join(outputDirAbs, filename);
    try {
      if (rewriteStoryPackage(storyPath, scrubber)) rewritten.push(filename);
    } catch (err) {
      console.warn(`[Proxy] Failed to scrub image fields from ${storyPath}:`, err.message || err);
    }
  }

  try {
    updatePrimaryManifestHash(outputDirAbs);
  } catch (err) {
    console.warn(`[Proxy] Failed to update story manifest after image cleanup for ${outputDirAbs}:`, err.message || err);
  }

  return rewritten;
}

function deleteSeasonReferenceArtifactsForOutputDir(outputDirAbs) {
  const deleted = [];
  const remove = (target) => {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    deleted.push(path.relative(outputDirAbs, target) || path.basename(target));
  };

  remove(path.join(outputDirAbs, 'style-bible'));
  remove(path.join(outputDirAbs, 'style-references'));
  remove(path.join(outputDirAbs, 'visual-planning'));
  remove(path.join(outputDirAbs, 'season-visual-bible.json'));

  const imagesDir = path.join(outputDirAbs, 'images');
  if (fs.existsSync(imagesDir)) {
    remove(path.join(imagesDir, 'job-reference-previews'));
    for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (/^(ref_|style-bible-)/.test(entry.name)) {
        remove(path.join(imagesDir, entry.name));
      }
    }
    const promptsDir = path.join(imagesDir, 'prompts');
    if (fs.existsSync(promptsDir)) {
      for (const entry of fs.readdirSync(promptsDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (/^(ref_|style-bible-)/.test(entry.name)) {
          remove(path.join(promptsDir, entry.name));
        }
      }
    }
  }

  const rewritten = rewriteStoryPackages(outputDirAbs, scrubStorySeasonReferences);
  return { deleted, rewritten };
}

function deleteEpisodeArtArtifactsForOutputDir(outputDirAbs) {
  const deleted = [];
  const remove = (target) => {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    deleted.push(path.relative(outputDirAbs, target) || path.basename(target));
  };

  const removableExact = new Set([
    'asset-registry.jsonl',
    'image-manifest.json',
    '08-registry-state.json',
  ]);
  for (const entry of fs.readdirSync(outputDirAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (removableExact.has(entry.name) || /^08a-beat-resume-.*\.json$/.test(entry.name)) {
      remove(path.join(outputDirAbs, entry.name));
    }
  }

  const imagesDir = path.join(outputDirAbs, 'images');
  if (fs.existsSync(imagesDir)) {
    for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
      const target = path.join(imagesDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'prompts' && entry.name !== 'job-reference-previews') {
          remove(target);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/^(ref_|style-bible-)/.test(entry.name)) {
        remove(target);
      }
    }

    const promptsDir = path.join(imagesDir, 'prompts');
    if (fs.existsSync(promptsDir)) {
      for (const entry of fs.readdirSync(promptsDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/^(ref_|style-bible-)/.test(entry.name)) {
          remove(path.join(promptsDir, entry.name));
        }
      }
    }
  }

  const rewritten = rewriteStoryPackages(outputDirAbs, scrubStoryEpisodeArt);
  return { deleted, rewritten };
}

function deleteImageArtifactsForOutputDir(outputDirAbs) {
  const deleted = [];
  const remove = (target) => {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    deleted.push(path.relative(outputDirAbs, target) || path.basename(target));
  };

  for (const dirname of ['images', 'visual-planning', 'style-bible']) {
    remove(path.join(outputDirAbs, dirname));
  }

  const removableExact = new Set([
    'asset-registry.jsonl',
    'image-manifest.json',
    '08-registry-state.json',
    'season-visual-bible.json',
  ]);
  for (const entry of fs.readdirSync(outputDirAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (removableExact.has(entry.name) || /^08a-beat-resume-.*\.json$/.test(entry.name)) {
      remove(path.join(outputDirAbs, entry.name));
    }
  }

  const rewritten = rewriteStoryPackages(outputDirAbs, scrubStoryImages);
  return { deleted, rewritten };
}

function registerGenerationJobRoutes(app, lifecycle, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const storiesDir = options.storiesDir || path.resolve(rootDir, 'generated-stories');
  const workerCheckpointOutputDir = options.workerCheckpointOutputDir || path.resolve(rootDir, '.worker-checkpoint-outputs');
  const {
    loadJobs,
    saveJobs,
    normalizeStaleRunningJobs,
    loadWorkerJobs,
    saveWorkerJobs,
    loadCheckpoints,
    saveCheckpoints,
    upsertWorkerJob,
    syncGenerationMirrorFromWorker,
    activeWorkers,
  } = lifecycle;

  app.get('/generation-jobs', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(enrichJobsWithImageStats(normalized, { rootDir, storiesDir }));
  });

  app.get('/generation-jobs/all', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(enrichJobsWithImageStats(normalized, { rootDir, storiesDir }));
  });

  app.post('/generation-jobs/refresh', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json({ success: true, changed, count: normalized.length });
  });

  app.post('/generation-jobs', (req, res) => {
    const job = req.body;
    if (!job || !job.id) {
      return res.status(400).json({ error: 'Invalid job data' });
    }

    const jobs = loadJobs();
    const existingIndex = jobs.findIndex((j) => j.id === job.id);

    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      jobs.unshift(job);
    }

    if (jobs.length > 50) {
      jobs.length = 50;
    }

    saveJobs(jobs);
    console.log(`[Proxy] Registered generation job: ${job.id} - ${job.storyTitle}`);
    res.json({ success: true });
  });

  app.delete('/story-image-artifacts/season-references', (req, res) => {
    const outputDir = req.body?.outputDir;
    const outputDirAbs = resolveStoryOutputDir(outputDir, { rootDir, storiesDir });
    if (!outputDirAbs || !fs.existsSync(outputDirAbs)) {
      return res.status(400).json({ error: 'Missing or invalid outputDir' });
    }

    const artifacts = deleteSeasonReferenceArtifactsForOutputDir(outputDirAbs);
    res.json({ success: true, artifacts });
  });

  app.delete('/story-image-artifacts/episode-art', (req, res) => {
    const outputDir = req.body?.outputDir;
    const outputDirAbs = resolveStoryOutputDir(outputDir, { rootDir, storiesDir });
    if (!outputDirAbs || !fs.existsSync(outputDirAbs)) {
      return res.status(400).json({ error: 'Missing or invalid outputDir' });
    }

    const artifacts = deleteEpisodeArtArtifactsForOutputDir(outputDirAbs);
    res.json({ success: true, artifacts });
  });

  app.get('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    const job = normalized.find((j) => j.id === jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  app.patch('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const updates = req.body;

    const jobs = loadJobs();
    const jobIndex = jobs.findIndex((j) => j.id === jobId);

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

  app.post('/generation-jobs/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    const workerJob = loadWorkerJobs().find((j) => j.id === jobId);
    if (workerJob) {
      upsertWorkerJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
      const active = activeWorkers.get(jobId);
      if (active?.proc && !active.proc.killed) {
        try { active.proc.kill('SIGTERM'); } catch {
          // best-effort; already-dead processes throw ESRCH
        }
      }
      const updatedWorkerJob = loadWorkerJobs().find((j) => j.id === jobId);
      if (updatedWorkerJob) {
        syncGenerationMirrorFromWorker(updatedWorkerJob);
      }
      return res.json({ success: true, jobId, delegatedTo: 'worker-jobs' });
    }

    const jobs = loadJobs();
    const jobIndex = jobs.findIndex((j) => j.id === jobId);

    if (jobIndex < 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    jobs[jobIndex].status = 'cancelled';
    jobs[jobIndex].updatedAt = new Date().toISOString();
    saveJobs(jobs);
    console.log(`[Proxy] Cancelled generation job: ${jobId}`);
    res.json({ success: true });
  });

  app.delete('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;

    let jobs = loadJobs();
    const job = jobs.find((j) => j.id === jobId);
    const workerJobs = loadWorkerJobs();
    const workerJob = workerJobs.find((j) => j.id === jobId);
    const checkpoints = loadCheckpoints();
    const checkpoint = checkpoints.find((c) => c.jobId === jobId);
    const outputDir = getJobOutputDir(job)
      || getJobOutputDir(workerJob)
      || checkpoint?.resumeContext?.outputDirectory
      || checkpoint?.outputs?.output_directory?.outputDirectory
      || checkpoint?.failureContext?.context?.outputDirectory;

    let artifactCleanup = { deleted: [], rewritten: [] };
    const outputDirAbs = resolveStoryOutputDir(outputDir, { rootDir, storiesDir });
    if (outputDirAbs && fs.existsSync(outputDirAbs)) {
      artifactCleanup = deleteImageArtifactsForOutputDir(outputDirAbs);
    } else if (outputDir) {
      console.warn(`[Proxy] Skipped artifact cleanup for job ${jobId}; unsafe or missing outputDir: ${outputDir}`);
    }

    const active = activeWorkers.get(jobId);
    if (active?.proc && !active.proc.killed) {
      try { active.proc.kill('SIGTERM'); } catch {
        // best-effort; already-dead processes throw ESRCH
      }
    }
    activeWorkers.delete(jobId);

    const initialLength = jobs.length;
    jobs = jobs.filter((j) => j.id !== jobId);

    if (jobs.length < initialLength) {
      saveJobs(jobs);
      console.log(`[Proxy] Deleted generation job: ${jobId}`);
    }

    const nextWorkerJobs = workerJobs.filter((j) => j.id !== jobId);
    if (nextWorkerJobs.length !== workerJobs.length) {
      saveWorkerJobs(nextWorkerJobs);
    }

    const nextCheckpoints = checkpoints.filter((c) => c.jobId !== jobId);
    if (nextCheckpoints.length !== checkpoints.length) {
      saveCheckpoints(nextCheckpoints);
    }

    const checkpointOutputDir = path.join(workerCheckpointOutputDir, jobId);
    if (fs.existsSync(checkpointOutputDir)) {
      fs.rmSync(checkpointOutputDir, { recursive: true, force: true });
      artifactCleanup.deleted.push(path.relative(rootDir, checkpointOutputDir));
    }

    res.json({ success: true, artifacts: artifactCleanup });
  });

  app.get('/generation-jobs/:jobId/status', (req, res) => {
    const { jobId } = req.params;
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    const job = normalized.find((j) => j.id === jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ status: job.status, cancelled: job.status === 'cancelled' });
  });
}

module.exports = { registerGenerationJobRoutes };
