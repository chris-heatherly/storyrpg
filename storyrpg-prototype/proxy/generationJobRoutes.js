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
const { publicJobState, sanitizeJobState } = require('./sanitizeJobState');

const MAX_SYNC_REGISTRY_SCAN_BYTES = 50 * 1024 * 1024;

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
  if (!fs.existsSync(imagesDir)) return { generatedFiles: 0, referenceFiles: 0, storyFiles: 0 };
  let generatedFiles = 0;
  let referenceFiles = 0;
  for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) continue;
    generatedFiles++;
    if (/^ref_/i.test(entry.name)) referenceFiles++;
  }
  return { generatedFiles, referenceFiles, storyFiles: Math.max(0, generatedFiles - referenceFiles) };
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
  const fileStats = countTopLevelImageFiles(path.join(outputDirAbs, 'images'));
  const manifest = readJsonIfExists(path.join(outputDirAbs, 'image-manifest.json'));
  const resumeScan = readJsonIfExists(path.join(outputDirAbs, 'image-resume-scan.json'));
  const manifestSlots = Array.isArray(manifest?.slots) ? manifest.slots.length : undefined;
  const scanSlots = typeof resumeScan?.totalSlots === 'number' ? resumeScan.totalSlots : undefined;
  const totalSlots = typeof manifestSlots === 'number' && typeof scanSlots === 'number'
    ? Math.max(manifestSlots, scanSlots)
    : manifestSlots ?? scanSlots;

  let resolvedSlots = typeof resumeScan?.resolvedSlotsAfter === 'number'
    ? resumeScan.resolvedSlotsAfter
    : undefined;
  const registryPath = path.join(outputDirAbs, 'asset-registry.jsonl');
  if (fs.existsSync(registryPath)) {
    try {
      const registryStats = fs.statSync(registryPath);
      if (registryStats.size <= MAX_SYNC_REGISTRY_SCAN_BYTES) {
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
      }
    } catch {
      // Image stats should never make generation job routes unavailable.
    }
  }

  return {
    generatedFiles: fileStats.generatedFiles,
    referenceFiles: fileStats.referenceFiles,
    storyFiles: fileStats.storyFiles,
    resolvedSlots,
    totalSlots,
    missingSlots: typeof totalSlots === 'number' && typeof resolvedSlots === 'number'
      ? Math.max(0, totalSlots - resolvedSlots)
      : undefined,
  };
}

/**
 * Episode-completion watermarks written by the pipeline (WS1a):
 * checkpoints/episode-{N}-complete.json. Surfacing them on the job record lets
 * a resume tell which episodes are already paid for and assembled.
 */
function computeEpisodeStatsForOutputDir(outputDirAbs) {
  if (!outputDirAbs) return undefined;
  const checkpointsDir = path.join(outputDirAbs, 'checkpoints');
  if (!fs.existsSync(checkpointsDir)) return undefined;
  const completedEpisodes = [];
  try {
    for (const entry of fs.readdirSync(checkpointsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = /^episode-(\d+)-complete\.json$/.exec(entry.name);
      if (!match) continue;
      const watermark = readJsonIfExists(path.join(checkpointsDir, entry.name));
      if (watermark?.version === 1 && typeof watermark.episodeNumber === 'number') {
        completedEpisodes.push(watermark.episodeNumber);
      }
    }
  } catch {
    return undefined;
  }
  if (completedEpisodes.length === 0) return undefined;
  completedEpisodes.sort((a, b) => a - b);
  return {
    completedEpisodes,
    lastCompletedEpisode: completedEpisodes[completedEpisodes.length - 1],
  };
}

function enrichJobsWithImageStats(jobs, { rootDir, storiesDir }) {
  const cache = new Map();
  const episodeCache = new Map();
  return jobs.map((job) => {
    const outputDirAbs = resolveStoryOutputDir(getJobOutputDir(job), { rootDir, storiesDir });
    if (!outputDirAbs) return job;
    let imageStats = cache.get(outputDirAbs);
    if (!imageStats) {
      imageStats = computeImageStatsForOutputDir(outputDirAbs);
      cache.set(outputDirAbs, imageStats);
    }
    if (!episodeCache.has(outputDirAbs)) {
      episodeCache.set(outputDirAbs, computeEpisodeStatsForOutputDir(outputDirAbs));
    }
    const episodeStats = episodeCache.get(outputDirAbs);
    if (!imageStats && !episodeStats) return job;
    if (!imageStats) {
      return { ...job, outputDir: job.outputDir || path.relative(rootDir, outputDirAbs), episodeStats };
    }
    return {
      ...job,
      outputDir: job.outputDir || path.relative(rootDir, outputDirAbs),
      imageStats,
      ...(episodeStats ? { episodeStats } : {}),
      generatedImageCount: imageStats.generatedFiles,
      referenceImageCount: imageStats.referenceFiles,
      storyImageCount: imageStats.storyFiles,
      resolvedImageSlotCount: imageStats.resolvedSlots,
      totalImageSlotCount: imageStats.totalSlots,
      missingImageSlotCount: imageStats.missingSlots,
    };
  });
}

function getResumeSourceId(job) {
  return job?.resumeFromJobId
    || job?.resumeContext?.resumeFromJobId
    || job?.checkpoint?.resumeContext?.resumeFromJobId;
}

function getProjectId(job, jobs) {
  if (job?.projectId) return job.projectId;
  const byId = new Map(jobs.map((candidate) => [candidate.id, candidate]));
  const seen = new Set([job?.id].filter(Boolean));
  let cursor = job;

  while (cursor) {
    const sourceId = getResumeSourceId(cursor);
    if (!sourceId || seen.has(sourceId)) break;
    seen.add(sourceId);
    const source = byId.get(sourceId);
    if (!source) return sourceId;
    if (source.projectId) return source.projectId;
    cursor = source;
  }

  return cursor?.id || job?.id;
}

function collectProjectJobIds(projectId, requestedJobIds, jobs, workerJobs) {
  const allJobs = [...jobs, ...workerJobs];
  const ids = new Set([projectId, ...requestedJobIds].filter(Boolean));
  let changed = true;

  while (changed) {
    changed = false;
    for (const job of allJobs) {
      if (!job?.id || ids.has(job.id)) continue;
      const sourceId = getResumeSourceId(job);
      const shouldInclude = job.projectId === projectId
        || getProjectId(job, allJobs) === projectId
        || (sourceId && ids.has(sourceId))
        || (job.projectId && ids.has(job.projectId));
      if (shouldInclude) {
        ids.add(job.id);
        changed = true;
      }
    }
  }

  return ids;
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

function artifactMatchesEpisode(value, targetEpisodeNumber) {
  if (targetEpisodeNumber == null) return true;
  const text = String(value || '');
  if (!text) return false;
  const escaped = String(targetEpisodeNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`episode-${escaped}(?:\\b|[-_/])`, 'i').test(text);
}

function recordMatchesEpisode(record, targetEpisodeNumber) {
  if (targetEpisodeNumber == null) return true;
  if (!record || typeof record !== 'object') return false;
  const slot = record.slot || {};
  return [
    record.id,
    record.slotId,
    record.baseIdentifier,
    record.latestPath,
    record.latestUrl,
    slot.slotId,
    slot.scopedSceneId,
    slot.baseIdentifier,
    slot.storyFieldPath,
  ].some((value) => artifactMatchesEpisode(value, targetEpisodeNumber));
}

function scrubBeatMedia(beat) {
  if (!beat || typeof beat !== 'object') return;
  delete beat.image;
  delete beat.images;
  delete beat.imageUrl;
  delete beat.imagePath;
  delete beat.imagePrompt;
  delete beat.panelImages;
  delete beat.video;
  delete beat.videoUrl;
  delete beat.videoPath;
}

function scrubEncounterMedia(encounter) {
  if (!encounter || typeof encounter !== 'object') return;
  delete encounter.image;
  delete encounter.images;
  delete encounter.imageUrl;
  delete encounter.imagePath;
  const phases = Array.isArray(encounter.phases) ? encounter.phases : [];
  for (const phase of phases) {
    for (const beat of phase?.beats || []) scrubBeatMedia(beat);
  }
  const storylets = encounter.storylets && typeof encounter.storylets === 'object' ? encounter.storylets : {};
  for (const storylet of Object.values(storylets)) {
    for (const beat of storylet?.beats || []) scrubBeatMedia(beat);
  }
}

function scrubStoryEpisodeArt(story, targetEpisodeNumber) {
  if (!story || typeof story !== 'object') return;
  story.imagesStatus = 'pending';
  if (targetEpisodeNumber == null) {
    delete story.coverImage;
  }

  const episodes = Array.isArray(story.episodes) ? story.episodes : [];
  for (const episode of episodes) {
    if (!episode || typeof episode !== 'object') continue;
    if (targetEpisodeNumber != null && episode.number !== targetEpisodeNumber) continue;
    if (Object.prototype.hasOwnProperty.call(episode, 'coverImage')) {
      episode.coverImage = '';
    }
    const scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
    for (const scene of scenes) {
      if (!scene || typeof scene !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(scene, 'backgroundImage')) {
        scene.backgroundImage = '';
      }
      delete scene.image;
      delete scene.imageUrl;
      delete scene.imagePath;
      delete scene.video;
      delete scene.videoUrl;
      delete scene.videoPath;
      const beats = Array.isArray(scene.beats) ? scene.beats : [];
      for (const beat of beats) {
        scrubBeatMedia(beat);
      }
      scrubEncounterMedia(scene.encounter);
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
  const primaryStoryFile = manifest?.primaryStoryFile || 'story.json';
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
  const filename = 'story.json';
  const storyPath = path.join(outputDirAbs, filename);
  try {
    if (rewriteStoryPackage(storyPath, scrubber)) rewritten.push(filename);
  } catch (err) {
    console.warn(`[Proxy] Failed to scrub image fields from ${storyPath}:`, err.message || err);
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

function filterJsonlFileByEpisode(filePath, targetEpisodeNumber) {
  if (targetEpisodeNumber == null || !fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const kept = [];
  let changed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (recordMatchesEpisode(record, targetEpisodeNumber)) {
        changed = true;
        continue;
      }
    } catch {
      // Keep malformed legacy lines.
    }
    kept.push(line);
  }
  if (changed) fs.writeFileSync(filePath, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
  return changed;
}

function filterJsonFileByEpisode(filePath, targetEpisodeNumber) {
  if (targetEpisodeNumber == null || !fs.existsSync(filePath)) return false;
  const raw = readJsonIfExists(filePath);
  if (!raw || typeof raw !== 'object') return false;
  let changed = false;
  if (Array.isArray(raw.slots)) {
    const before = raw.slots.length;
    raw.slots = raw.slots.filter((slot) => !recordMatchesEpisode({ slot }, targetEpisodeNumber));
    changed = changed || raw.slots.length !== before;
  }
  if (Array.isArray(raw.records)) {
    const before = raw.records.length;
    raw.records = raw.records.filter((record) => !recordMatchesEpisode(record, targetEpisodeNumber));
    changed = changed || raw.records.length !== before;
  }
  if (raw.records && typeof raw.records === 'object' && !Array.isArray(raw.records)) {
    for (const [key, record] of Object.entries(raw.records)) {
      if (artifactMatchesEpisode(key, targetEpisodeNumber) || recordMatchesEpisode(record, targetEpisodeNumber)) {
        delete raw.records[key];
        changed = true;
      }
    }
  }
  if (changed) atomicWriteJsonSync(filePath, raw, { pretty: true });
  return changed;
}

function deleteEpisodeArtArtifactsForOutputDir(outputDirAbs, targetEpisodeNumber) {
  const deleted = [];
  const rewritten = [];
  const remove = (target) => {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    deleted.push(path.relative(outputDirAbs, target) || path.basename(target));
  };

  const removableExact = targetEpisodeNumber == null
    ? new Set([
        'asset-registry.jsonl',
        'image-manifest.json',
        '08-registry-state.json',
      ])
    : new Set();
  for (const entry of fs.readdirSync(outputDirAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const matchesTarget = artifactMatchesEpisode(entry.name, targetEpisodeNumber);
    if (removableExact.has(entry.name) || (/^08a-beat-resume-.*\.json$/.test(entry.name) && matchesTarget)) {
      remove(path.join(outputDirAbs, entry.name));
    }
  }

  if (filterJsonlFileByEpisode(path.join(outputDirAbs, 'asset-registry.jsonl'), targetEpisodeNumber)) rewritten.push('asset-registry.jsonl');
  if (filterJsonFileByEpisode(path.join(outputDirAbs, 'image-manifest.json'), targetEpisodeNumber)) rewritten.push('image-manifest.json');
  if (filterJsonFileByEpisode(path.join(outputDirAbs, '08-registry-state.json'), targetEpisodeNumber)) rewritten.push('08-registry-state.json');

  const imagesDir = path.join(outputDirAbs, 'images');
  if (fs.existsSync(imagesDir)) {
    for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
      const target = path.join(imagesDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'prompts' && entry.name !== 'job-reference-previews' && artifactMatchesEpisode(entry.name, targetEpisodeNumber)) {
          remove(target);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/^(ref_|style-bible-)/.test(entry.name) && artifactMatchesEpisode(entry.name, targetEpisodeNumber)) {
        remove(target);
      }
    }

    const promptsDir = path.join(imagesDir, 'prompts');
    if (fs.existsSync(promptsDir)) {
      for (const entry of fs.readdirSync(promptsDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/^(ref_|style-bible-)/.test(entry.name) && artifactMatchesEpisode(entry.name, targetEpisodeNumber)) {
          remove(path.join(promptsDir, entry.name));
        }
      }
    }
  }

  rewritten.push(...rewriteStoryPackages(outputDirAbs, (story) => scrubStoryEpisodeArt(story, targetEpisodeNumber)));
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

  const deleteGenerationJobRecords = (jobIds, options = {}) => {
    const { protectActiveWorkers = false } = options;
    const ids = new Set(Array.from(jobIds).filter(Boolean));
    let jobs = loadJobs();
    const workerJobs = loadWorkerJobs();
    const checkpoints = loadCheckpoints();
    const artifacts = { deleted: [], rewritten: [] };
    const cleanedOutputDirs = new Set();
    const skippedActiveJobIds = new Set();

    const jobsById = new Map([...jobs, ...workerJobs].map((job) => [job.id, job]));
    const checkpointsByJobId = new Map(checkpoints.map((checkpoint) => [checkpoint.jobId, checkpoint]));

    for (const jobId of ids) {
      const job = jobsById.get(jobId);
      const active = activeWorkers.get(jobId);
      const isLiveWorker = Boolean(active?.proc && !active.proc.killed)
        || job?.status === 'running'
        || job?.status === 'pending';
      if (protectActiveWorkers && isLiveWorker) {
        skippedActiveJobIds.add(jobId);
        continue;
      }
      const checkpoint = checkpointsByJobId.get(jobId);
      const outputDir = getJobOutputDir(job)
        || checkpoint?.resumeContext?.outputDirectory
        || checkpoint?.outputs?.output_directory?.outputDirectory
        || checkpoint?.failureContext?.context?.outputDirectory;

      const outputDirAbs = resolveStoryOutputDir(outputDir, { rootDir, storiesDir });
      if (outputDirAbs && fs.existsSync(outputDirAbs) && !cleanedOutputDirs.has(outputDirAbs)) {
        const cleanup = deleteImageArtifactsForOutputDir(outputDirAbs);
        artifacts.deleted.push(...cleanup.deleted);
        artifacts.rewritten.push(...cleanup.rewritten);
        cleanedOutputDirs.add(outputDirAbs);
      } else if (outputDir && !outputDirAbs) {
        console.warn(`[Proxy] Skipped artifact cleanup for job ${jobId}; unsafe outputDir: ${outputDir}`);
      }

      if (active?.proc && !active.proc.killed) {
        try { active.proc.kill('SIGTERM'); } catch {
          // best-effort; already-dead processes throw ESRCH
        }
      }
      activeWorkers.delete(jobId);

      const checkpointOutputDir = path.join(workerCheckpointOutputDir, jobId);
      if (fs.existsSync(checkpointOutputDir)) {
        fs.rmSync(checkpointOutputDir, { recursive: true, force: true });
        artifacts.deleted.push(path.relative(rootDir, checkpointOutputDir));
      }
    }

    const initialJobsLength = jobs.length;
    jobs = jobs.filter((job) => !ids.has(job.id) || skippedActiveJobIds.has(job.id));
    if (jobs.length !== initialJobsLength) saveJobs(jobs);

    const nextWorkerJobs = workerJobs.filter((job) => !ids.has(job.id) || skippedActiveJobIds.has(job.id));
    if (nextWorkerJobs.length !== workerJobs.length) saveWorkerJobs(nextWorkerJobs);

    const nextCheckpoints = checkpoints.filter((checkpoint) => !ids.has(checkpoint.jobId) || skippedActiveJobIds.has(checkpoint.jobId));
    if (nextCheckpoints.length !== checkpoints.length) saveCheckpoints(nextCheckpoints);

    return {
      deletedJobIds: Array.from(ids).filter((jobId) => !skippedActiveJobIds.has(jobId)),
      skippedActiveJobIds: Array.from(skippedActiveJobIds),
      artifacts,
    };
  };

  app.get('/generation-jobs', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(enrichJobsWithImageStats(normalized, { rootDir, storiesDir }).map(publicJobState));
  });

  app.get('/generation-jobs/all', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(enrichJobsWithImageStats(normalized, { rootDir, storiesDir }).map(publicJobState));
  });

  app.post('/generation-jobs/refresh', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json({ success: true, changed, count: normalized.length });
  });

  app.delete('/generation-projects/:projectId', (req, res) => {
    const { projectId } = req.params;
    const requestedJobIds = Array.isArray(req.body?.jobIds)
      ? req.body.jobIds.filter((id) => typeof id === 'string')
      : [];
    const jobs = loadJobs();
    const workerJobs = loadWorkerJobs();
    const projectJobIds = collectProjectJobIds(projectId, requestedJobIds, jobs, workerJobs);
    const result = deleteGenerationJobRecords(projectJobIds, { protectActiveWorkers: true });
    if (result.skippedActiveJobIds.length > 0) {
      console.warn(`[Proxy] Skipped active generation worker(s) during project cleanup: ${result.skippedActiveJobIds.join(', ')}`);
    }
    console.log(`[Proxy] Deleted generation project: ${projectId} (${result.deletedJobIds.length} job record(s))`);
    res.json({ success: true, projectId, ...result });
  });

  app.post('/generation-jobs', (req, res) => {
    const job = req.body;
    if (!job || !job.id) {
      return res.status(400).json({ error: 'Invalid job data' });
    }

    const jobs = loadJobs();
    const existingIndex = jobs.findIndex((j) => j.id === job.id);

    const sanitizedJob = sanitizeJobState(job);
    if (existingIndex >= 0) {
      jobs[existingIndex] = sanitizedJob;
    } else {
      jobs.unshift(sanitizedJob);
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
    const targetEpisodeNumber = req.body?.targetEpisodeNumber == null
      ? undefined
      : Number(req.body.targetEpisodeNumber);
    if (targetEpisodeNumber != null && (!Number.isFinite(targetEpisodeNumber) || targetEpisodeNumber < 1)) {
      return res.status(400).json({ error: 'targetEpisodeNumber must be a positive number' });
    }
    const outputDirAbs = resolveStoryOutputDir(outputDir, { rootDir, storiesDir });
    if (!outputDirAbs || !fs.existsSync(outputDirAbs)) {
      return res.status(400).json({ error: 'Missing or invalid outputDir' });
    }

    const artifacts = deleteEpisodeArtArtifactsForOutputDir(outputDirAbs, targetEpisodeNumber);
    res.json({ success: true, artifacts });
  });

  app.get('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    const job = normalized.find((j) => j.id === jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(publicJobState(job));
  });

  app.patch('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const updates = req.body;

    const jobs = loadJobs();
    const jobIndex = jobs.findIndex((j) => j.id === jobId);

    if (jobIndex < 0) {
      const newJob = sanitizeJobState({ id: jobId, ...updates, startedAt: updates.startedAt || new Date().toISOString() });
      jobs.unshift(newJob);
      if (jobs.length > 50) jobs.length = 50;
      saveJobs(jobs);
      console.log(`[Proxy] Upserted generation job via PATCH: ${jobId}`);
      return res.json({ success: true, upserted: true });
    }

    jobs[jobIndex] = sanitizeJobState({ ...jobs[jobIndex], ...updates });
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
    const result = deleteGenerationJobRecords(new Set([jobId]));
    console.log(`[Proxy] Deleted generation job: ${jobId}`);
    res.json({ success: true, artifacts: result.artifacts });
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
