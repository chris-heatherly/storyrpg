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
const { publicCheckpoint, publicJobState, sanitizeJobState } = require('./sanitizeJobState');
const { spawnTsNodeWorker } = require('./tsNodeSpawn');

const WORKER_STALE_RUNNING_MS = 3 * 60 * 1000;
const WORKER_MAX_TIMELINE = 200;
const WORKER_MAX_IMAGE_JOBS = 200;
const WORKER_MAX_VIDEO_JOBS = 200;
const WORKER_MAX_IMAGE_MANIFEST = 200;
const WORKER_MAX_CHECKPOINT_ARTIFACTS = 100;
const MAX_SYNC_REGISTRY_SCAN_BYTES = 50 * 1024 * 1024;
const WORKER_COMPLETED_PRUNE_MS = 2 * 60 * 60 * 1000;
const WORKER_RESULT_TTL_MS = 10 * 60 * 1000;
const JOB_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

// WS1b: failureKind written by the worker when a run died on provider
// credit/quota exhaustion (see src/ai-agents/utils/providerErrors.ts). Such
// jobs are parked as 'paused' — resumable after a top-up — instead of failed.
// Paused is intentionally NOT swept by the stale reapers (they only look at
// running/pending) and is never dead-lettered.
const PROVIDER_QUOTA_FAILURE_KIND = 'provider-quota';

function isQuotaFailureContext(failureContext) {
  return failureContext?.failureKind === PROVIDER_QUOTA_FAILURE_KIND;
}

function isArchitectureResumeFailure(message, failure = {}) {
  const text = String(message || '');
  const phaseText = [
    failure.failurePhase,
    failure.failureStepId,
    failure.resumeFromStepId,
  ].filter(Boolean).join(' ');
  return /architecture craft gate|story architect failed|blueprint/i.test(text)
    || /\b(?:episode_)?architecture\b/i.test(phaseText);
}

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
  return !v
    || v === 'dummy'
    || v === 'placeholder'
    || v === 'your-api-key'
    || v === 'redacted'
    || v === '[redacted]';
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
      provider: config.narration.provider || 'elevenlabs',
      preGenerateAudio: !!config.narration.preGenerateAudio,
      autoPlay: !!config.narration.autoPlay,
      highlightMode: config.narration.highlightMode,
      elevenLabsConfigured: !isMissingApiKey(config.narration.elevenLabsApiKey),
      geminiTtsConfigured: !isMissingApiKey(config.narration.geminiApiKey),
      performanceTagsEnabled: !!config.narration.performanceTagsEnabled,
      voiceCastingEnabled: config.narration.voiceCastingEnabled !== false,
      voiceIdConfigured: typeof config.narration.voiceId === 'string' && config.narration.voiceId.trim().length > 0,
    } : undefined,
    agents: agents && Object.keys(agents).length > 0 ? agents : undefined,
  }, 200);
}

function buildDefaultWorkerStoryTitle(mode) {
  if (mode === 'generation') return 'Untitled Story';
  if (mode === 'image-generation') return 'Image Batch';
  if (mode === 'compile-episode') return 'Episode Compile';
  return 'Source Analysis';
}

function cleanWorkerLabelPart(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || fallback;
}

function formatEpisodeScope(episodeRange, episodeCount) {
  const specific = Array.isArray(episodeRange?.specific)
    ? episodeRange.specific
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)
    : [];

  if (specific.length > 0) {
    const isContiguous = specific.every((value, index) => index === 0 || value === specific[index - 1] + 1);
    if (isContiguous) {
      const first = specific[0];
      const last = specific[specific.length - 1];
      return first === last ? `Episode ${first}` : `Episodes ${first}-${last}`;
    }
    const display = specific.length > 6
      ? `${specific.slice(0, 6).join(', ')} +${specific.length - 6}`
      : specific.join(', ');
    return `Episodes ${display}`;
  }

  const start = Number(episodeRange?.start);
  const end = Number(episodeRange?.end);
  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > 0) {
    return start === end ? `Episode ${start}` : `Episodes ${start}-${end}`;
  }

  const count = Number(episodeCount);
  if (Number.isFinite(count) && count > 1) return `Episodes 1-${Math.floor(count)}`;
  return 'Episode 1';
}

function buildWorkerFriendlyName(mode, payload, explicitStoryTitle, episodeCount, options = {}) {
  const title = cleanWorkerLabelPart(explicitStoryTitle, buildDefaultWorkerStoryTitle(mode));
  const isResume = !!options.resumeFromJobId;
  let task = 'Source analysis';
  let scope = 'Treatment import';

  if (mode === 'generation') {
    task = isResume ? 'Resume generation' : 'Story generation';
    scope = formatEpisodeScope(payload?.generationInput?.episodeRange, episodeCount);
    const failureStep = options.resumeFromStepId;
    if (isResume && typeof failureStep === 'string' && failureStep.trim()) {
      scope = `${scope} from ${failureStep.trim()}`;
    }
  } else if (mode === 'image-generation') {
    task = 'Image generation';
    const input = payload?.imageGenerationInput || {};
    const targetEpisode = Number(input.targetEpisodeNumber);
    if (Number.isFinite(targetEpisode) && targetEpisode > 0) {
      scope = `Episode ${Math.floor(targetEpisode)}`;
    } else if (Array.isArray(input.targetSlots) && input.targetSlots.length > 0) {
      scope = `${input.targetSlots.length} missing slot${input.targetSlots.length === 1 ? '' : 's'}`;
    } else if (input.mode === 'spot') {
      scope = 'Targeted slots';
    } else {
      scope = 'Missing image slots';
    }
  } else if (mode === 'compile-episode') {
    task = 'Episode compile';
    const request = payload?.compileEpisodeInput?.request || {};
    const episodeNumber = Number(request.episodeNumber);
    scope = Number.isFinite(episodeNumber) && episodeNumber > 0
      ? `Episode ${Math.floor(episodeNumber)}`
      : cleanWorkerLabelPart(request.storyRunId, 'Episode package');
  } else {
    const sourceLength = typeof payload?.analysisInput?.sourceText === 'string'
      ? payload.analysisInput.sourceText.trim().length
      : 0;
    scope = sourceLength > 0 ? 'Treatment import' : 'Source prompt';
  }

  return [title, task, scope]
    .map((part) => cleanWorkerLabelPart(part, ''))
    .filter(Boolean)
    .join(' · ');
}

function buildWorkerProcessTitle(mode, friendlyName) {
  const modeLabel = mode === 'image-generation'
    ? 'images'
    : mode === 'compile-episode'
      ? 'compile'
      : mode || 'worker';
  const rawTitle = String(friendlyName || '')
    .split('·')[0]
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'StoryRPG';
  return `storyrpg:${modeLabel}:${rawTitle}`;
}

function buildWorkerRequestSnapshot(mode, payload, explicitStoryTitle) {
  const generationInput = payload?.generationInput;
  const analysisInput = payload?.analysisInput;
  const imageGenerationInput = payload?.imageGenerationInput;
  const compileEpisodeInput = payload?.compileEpisodeInput;
  const compileRequest = compileEpisodeInput?.request;
  const brief = generationInput?.brief;

  return stripLargeValues({
    mode,
    storyTitle: explicitStoryTitle
      || brief?.story?.title
      || analysisInput?.title
      || compileRequest?.storyRunId
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
      : mode === 'image-generation'
        ? {
          outputDirectory: imageGenerationInput?.outputDirectory,
          targetEpisodeNumber: imageGenerationInput?.targetEpisodeNumber,
          mode: imageGenerationInput?.mode,
          targetSlotCount: Array.isArray(imageGenerationInput?.targetSlots)
            ? imageGenerationInput.targetSlots.length
            : 0,
        }
        : mode === 'compile-episode'
          ? {
            outputDirectory: compileEpisodeInput?.outputDirectory,
            storyRunId: compileRequest?.storyRunId,
            episodeNumber: compileRequest?.episodeNumber,
            compileMode: compileRequest?.mode,
            targetArtifactKind: compileRequest?.targetArtifactKind,
            contextSource: compileRequest?.contextSource,
            totalEpisodes: compileRequest?.totalEpisodes,
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

const DURABLE_RESUME_OUTPUT_STEP_IDS = [
  'source_analysis',
  'season_plan',
  'world_bible',
  'character_bible',
  'output_directory',
];

function normalizeResumeStepsForOutputs(steps, outputs, now = new Date().toISOString()) {
  const normalized = { ...(steps || {}) };
  if (!outputs || typeof outputs !== 'object') return normalized;

  for (const stepId of DURABLE_RESUME_OUTPUT_STEP_IDS) {
    if (!Object.prototype.hasOwnProperty.call(outputs, stepId) || outputs[stepId] === undefined) continue;
    const existing = normalized[stepId] || {};
    if (existing.status === 'completed') continue;
    normalized[stepId] = {
      ...existing,
      stepId,
      status: 'completed',
      updatedAt: now,
    };
  }

  return normalized;
}

function normalizePipelineOutputDir(cfg, { storiesDir, runtimeRoot, appRoot }) {
  if (!cfg || typeof cfg !== 'object') return;
  const raw = typeof cfg.outputDir === 'string' ? cfg.outputDir.trim() : '';
  if (!raw || raw === './generated' || raw === 'generated') {
    cfg.outputDir = storiesDir;
    return;
  }
  if (path.isAbsolute(raw)) {
    cfg.outputDir = raw;
    return;
  }
  const base = runtimeRoot || appRoot;
  cfg.outputDir = path.resolve(base, raw);
}

function normalizeImageGenerationOutputDirectory(
  outputDirectory,
  { storiesDir, appRoot },
  inputName = 'imageGenerationInput.outputDirectory',
) {
  if (!outputDirectory || typeof outputDirectory !== 'string') return outputDirectory;
  const storiesRoot = path.resolve(storiesDir);
  const appRootAbs = path.resolve(appRoot);
  const raw = outputDirectory.trim();
  const asGeneratedRelative = (absPath) => {
    const resolved = path.resolve(absPath);
    if (resolved === storiesRoot) return 'generated-stories';
    if (resolved.startsWith(`${storiesRoot}${path.sep}`)) {
      return path.relative(appRootAbs, resolved) || 'generated-stories';
    }
    return null;
  };

  if (path.isAbsolute(raw)) {
    const resolved = path.resolve(raw);
    const relativeUnderApp = resolved === appRootAbs || resolved.startsWith(`${appRootAbs}${path.sep}`)
      ? asGeneratedRelative(resolved)
      : null;
    if (relativeUnderApp) return relativeUnderApp;

    if (!fs.existsSync(resolved)) {
      const basename = path.basename(resolved);
      const recovered = path.join(storiesRoot, basename);
      if (basename && fs.existsSync(recovered)) {
        return path.relative(appRootAbs, recovered);
      }
    }

    const relativeUnderStories = asGeneratedRelative(resolved);
    if (relativeUnderStories) return relativeUnderStories;
    throw new Error(`${inputName} path is outside worker filesystem generated-story root: ${raw}`);
  }

  const normalized = raw.replace(/^\/+/, '').replace(/^\.\//, '');
  if (normalized === 'generated' || normalized === 'generated-stories') return 'generated-stories';
  const resolved = path.resolve(appRootAbs, normalized);
  const relativeUnderStories = asGeneratedRelative(resolved);
  if (relativeUnderStories) return relativeUnderStories;
  throw new Error(`${inputName} path is outside worker filesystem generated-story root: ${raw}`);
}

function createWorkerLifecycle({
  rootDir,
  storiesDir: storiesDirInput,
  runtimeRoot: runtimeRootInput,
  generationJobsFile,
  workerJobsFile,
  workerCheckpointsFile,
  workerDeadLetterFile,
  workerCheckpointOutputDir: workerCheckpointOutputDirInput,
  port,
  cachedJsonStore,
  createStoryCatalogApi, // unused directly; retained for callers that need listLatestStoryRecords
  createSyncGenerationMirrorFromWorker,
  estimateWorkerProgress,
}) {
  if (!rootDir || !port || !cachedJsonStore || !createSyncGenerationMirrorFromWorker || !estimateWorkerProgress) {
    throw new Error('createWorkerLifecycle requires rootDir, port, cachedJsonStore, createSyncGenerationMirrorFromWorker, and estimateWorkerProgress');
  }

  const appRoot = path.resolve(rootDir);
  const runtimeRoot = runtimeRootInput ? path.resolve(runtimeRootInput) : appRoot;
  const storiesDir = storiesDirInput ? path.resolve(storiesDirInput) : path.join(runtimeRoot, 'generated-stories');
  const JOBS_FILE = generationJobsFile || path.join(runtimeRoot, '.generation-jobs.json');
  const WORKER_JOBS_FILE = workerJobsFile || path.join(runtimeRoot, '.worker-jobs.json');
  const WORKER_CHECKPOINTS_FILE = workerCheckpointsFile || path.join(runtimeRoot, '.worker-checkpoints.json');
  const WORKER_DEAD_LETTER_FILE = workerDeadLetterFile || path.join(runtimeRoot, '.worker-dead-letter.json');
  const WORKER_CHECKPOINT_OUTPUT_DIR = workerCheckpointOutputDirInput
    || path.join(runtimeRoot, '.worker-checkpoint-outputs');

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
  const saveCheckpoints = (rows) => checkpointsStore.set(sanitizeJobState(rows));

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
      || checkpoint?.failureContext?.context?.outputDirectory
      || checkpoint?.resumeContext?.requestPayload?.imageGenerationInput?.outputDirectory;
  }

  function resolveOutputDirectory(outputDirectory) {
    if (!outputDirectory || typeof outputDirectory !== 'string') return null;
    if (path.isAbsolute(outputDirectory)) return path.resolve(outputDirectory);
    const normalized = outputDirectory.replace(/^\/+/, '');
    if (normalized === 'generated' || normalized === './generated') {
      return path.resolve(storiesDir);
    }
    const resolved = path.resolve(runtimeRoot, normalized);
    const storiesRoot = path.resolve(storiesDir);
    if (resolved === storiesRoot || resolved.startsWith(`${storiesRoot}${path.sep}`)) {
      return resolved;
    }
    const legacy = path.resolve(appRoot, normalized);
    if (legacy === storiesRoot || legacy.startsWith(`${storiesRoot}${path.sep}`)) {
      return legacy;
    }
    return resolved;
  }

  function getOutputDirectoryFromJob(job, checkpoint) {
    return job?.outputDir
      || job?.outputDirectory
      || job?.resumeContext?.outputDirectory
      || job?.resumeContext?.requestPayload?.imageGenerationInput?.outputDirectory
      || getOutputDirectoryFromCheckpoint(checkpoint);
  }

  function computeImageStatsForOutputDirectory(outputDirectory) {
    const outputDirAbs = resolveOutputDirectory(outputDirectory);
    if (!outputDirAbs || !fs.existsSync(outputDirAbs)) return undefined;
    const storiesRoot = path.resolve(storiesDir);
    const resolvedOutputDir = path.resolve(outputDirAbs);
    if (resolvedOutputDir !== storiesRoot && !resolvedOutputDir.startsWith(`${storiesRoot}${path.sep}`)) {
      return undefined;
    }

    const imagesDir = path.join(resolvedOutputDir, 'images');
    let generatedFiles = 0;
    let referenceFiles = 0;
    if (fs.existsSync(imagesDir)) {
      for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) continue;
        generatedFiles += 1;
        if (/^ref_/i.test(entry.name)) referenceFiles += 1;
      }
    }
    const storyFiles = Math.max(0, generatedFiles - referenceFiles);

    let totalSlots;
    let resumeScan;
    try {
      const manifestPath = path.join(resolvedOutputDir, 'image-manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(manifest?.slots)) totalSlots = manifest.slots.length;
      }
      const resumeScanPath = path.join(resolvedOutputDir, 'image-resume-scan.json');
      if (fs.existsSync(resumeScanPath)) {
        resumeScan = JSON.parse(fs.readFileSync(resumeScanPath, 'utf8'));
        if (typeof resumeScan?.totalSlots === 'number') {
          totalSlots = typeof totalSlots === 'number'
            ? Math.max(totalSlots, resumeScan.totalSlots)
            : resumeScan.totalSlots;
        }
      }
    } catch {
      // Image stats should never make the jobs endpoint unavailable.
    }

    let resolvedSlots = typeof resumeScan?.resolvedSlotsAfter === 'number'
      ? resumeScan.resolvedSlotsAfter
      : undefined;
    try {
      const registryPath = path.join(resolvedOutputDir, 'asset-registry.jsonl');
      if (fs.existsSync(registryPath)) {
        const registryStats = fs.statSync(registryPath);
        if (registryStats.size <= MAX_SYNC_REGISTRY_SCAN_BYTES) {
          const resolvedSlotIds = new Set();
          for (const line of fs.readFileSync(registryPath, 'utf8').split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const record = JSON.parse(line);
              if (record?.status === 'succeeded' && record?.slot?.slotId && (record.latestUrl || record.latestPath || record.result?.url || record.result?.imageUrl)) {
                resolvedSlotIds.add(record.slot.slotId);
              }
            } catch {
              // Ignore malformed historical registry rows.
            }
          }
          resolvedSlots = resolvedSlotIds.size;
        }
      }
    } catch {
      // Best-effort stats only.
    }

    return {
      generatedFiles,
      referenceFiles,
      storyFiles,
      resolvedSlots,
      totalSlots,
      missingSlots: typeof totalSlots === 'number' && typeof resolvedSlots === 'number'
        ? Math.max(0, totalSlots - resolvedSlots)
        : undefined,
    };
  }

  function enrichWorkerJobWithOutputState(job, checkpoint, statsCache = new Map()) {
    const outputDirectory = getOutputDirectoryFromJob(job, checkpoint);
    if (!outputDirectory) return job;
    let imageStats = statsCache.get(outputDirectory);
    if (!imageStats) {
      imageStats = computeImageStatsForOutputDirectory(outputDirectory);
      statsCache.set(outputDirectory, imageStats || null);
    }
    const patch = {
      outputDirectory,
      outputDir: outputDirectory,
    };
    if (imageStats) {
      patch.imageStats = imageStats;
      patch.generatedImageCount = imageStats.generatedFiles;
      patch.referenceImageCount = imageStats.referenceFiles;
      patch.storyImageCount = imageStats.storyFiles;
      patch.resolvedImageSlotCount = imageStats.resolvedSlots;
      patch.totalImageSlotCount = imageStats.totalSlots;
      patch.missingImageSlotCount = imageStats.missingSlots;
    }
    return { ...job, ...patch };
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
    const canResume = Boolean(checkpoint?.resumeContext?.requestPayload);
    const units = manifest?.units && typeof manifest.units === 'object' ? manifest.units : {};
    const unitIds = Object.keys(units);
    const reusableUnits = unitIds.filter((id) => units[id]?.status === 'completed');
    let strategy = 'generation';
    let failedUnit = failure.failureStepId || failure.failurePhase || job.currentPhase || 'generation';
    let resumeFromUnit = failure.resumeFromStepId || failedUnit;

    const sceneMatch = isArchitectureResumeFailure(message, failure)
      ? null
      : message.match(/SceneWriter\.execute\(([^)\s]+)\)/i)
        || message.match(/scene\s+([a-z0-9._-]+)/i);
    if (/final.*save|story package|manifest|writeFinalStoryPackage|nodeRequire/i.test(message)) {
      strategy = 'save';
      failedUnit = 'final_story_package';
      resumeFromUnit = 'final_story_package';
    } else if (job?.mode === 'image-generation' || /image|encounter_images|images_ep/i.test(message) || /image/i.test(String(failure.failurePhase || ''))) {
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
      canResume,
      reusableUnitCount: reusableUnits.length,
      reusableUnits: reusableUnits.slice(0, 50),
      manifestAvailable: Boolean(manifest),
      manifestError,
      humanSummary: !canResume
        ? 'Resume is unavailable because the private request payload for this older job is no longer stored. Start a new generation with the same settings.'
        : strategy === 'scene'
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

  function buildOrphanFailureContext(job) {
    const checkpoint = loadCheckpoints().find((c) => c.jobId === job.id);
    const lastEvent = checkpoint?.lastEvent;
    const lastMessage = typeof lastEvent?.message === 'string' ? lastEvent.message : '';
    const requiredSlotFailures = Array.isArray(lastEvent?.data?.requiredSlotFailures)
      ? lastEvent.data.requiredSlotFailures
      : undefined;
    const hasImageCompletenessSignal = /Storyboard v2 incomplete|required image slot/i.test(lastMessage)
      || (requiredSlotFailures && requiredSlotFailures.length > 0);
    const message = hasImageCompletenessSignal
      ? `Worker process disappeared after image completeness failure: ${lastMessage || `${requiredSlotFailures.length} required slot(s) missing`}`
      : 'Worker process exited unexpectedly (orphaned running job)';
    return stripLargeValues({
      message,
      failurePhase: lastEvent?.phase || job.currentPhase || 'generation',
      failureStepId: hasImageCompletenessSignal ? 'storyboard_v2_required_slots' : (lastEvent?.phase || job.currentPhase || 'generation'),
      failureKind: hasImageCompletenessSignal ? 'image_completeness_orphaned_worker' : 'orphaned_worker',
      resumeFromStepId: hasImageCompletenessSignal ? 'missing_or_failed_image_slots' : (lastEvent?.phase || job.currentPhase || 'generation'),
      resumePatchableInputs: ['settings'],
      context: {
        jobId: job.id,
        pid: job.pid,
        orphaned: true,
        trackedByProxy: activeWorkers.has(job.id),
        pidAlive: isProcessAlive(job.pid),
        lastHeartbeatAt: job.lastHeartbeatAt,
        lastWorkerEventAt: job.lastWorkerEventAt,
        lastWorkerEventType: job.lastWorkerEventType,
        lastPipelineEventAt: job.lastPipelineEventAt,
        lastPipelinePhase: job.lastPipelinePhase,
        lastPipelineMessage: job.lastPipelineMessage,
        lastEvent,
        requiredSlotFailures,
        outputDirectory: getOutputDirectoryFromJob(job, checkpoint),
      },
      timestamp: new Date().toISOString(),
    }, 400);
  }

  function buildStaleFailureContext(job, { staleMinutes, isPending }) {
    const message = isPending
      ? `Queued ${staleMinutes} minutes without an available worker slot`
      : `Worker stale for ${staleMinutes} minutes`;
    return stripLargeValues({
      message,
      failurePhase: job.currentPhase || 'generation',
      failureStepId: job.currentPhase || 'generation',
      failureKind: isPending ? 'worker_queue_timeout' : 'worker_heartbeat_timeout',
      resumeFromStepId: job.currentPhase || 'generation',
      resumePatchableInputs: ['settings'],
      context: {
        jobId: job.id,
        pid: job.pid,
        pending: isPending,
        trackedByProxy: activeWorkers.has(job.id),
        pidAlive: isProcessAlive(job.pid),
        staleMinutes,
        lastHeartbeatAt: job.lastHeartbeatAt,
        lastWorkerEventAt: job.lastWorkerEventAt,
        lastWorkerEventType: job.lastWorkerEventType,
        lastPipelineEventAt: job.lastPipelineEventAt,
        lastPipelinePhase: job.lastPipelinePhase,
        lastPipelineMessage: job.lastPipelineMessage,
        outputDirectory: getOutputDirectoryFromJob(job, loadCheckpoints().find((c) => c.jobId === job.id)),
      },
      timestamp: new Date().toISOString(),
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
      const frame = `event: status\ndata: ${JSON.stringify(publicJobState(updated))}\n\n`;
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
          const failureContext = job.failureContext || buildOrphanFailureContext(job);
          changed = true;
          const failed = {
            ...job,
            status: 'failed',
            error: job.error || failureContext.message || 'Worker process exited unexpectedly (orphaned running job)',
            failureContext,
            updatedAt: new Date().toISOString(),
            deadLetter: true,
          };
          updateCheckpoint(job.id, { failureContext });
          appendDeadLetter({
            jobId: job.id,
            reason: 'orphaned_process',
            pid: job.pid,
            failureKind: failureContext.failureKind,
            trackedByProxy: failureContext.context?.trackedByProxy,
            pidAlive: failureContext.context?.pidAlive,
            lastHeartbeatAt: failureContext.context?.lastHeartbeatAt,
            lastWorkerEventAt: failureContext.context?.lastWorkerEventAt,
            lastPipelinePhase: failureContext.context?.lastPipelinePhase,
            at: failed.updatedAt,
          });
          return failed;
        }
      }

      // A `pending` job has NO worker yet — it is waiting in the queue for a slot behind
      // a running job, which can legitimately run far longer than 3 min (e.g. 15-20 min
      // of source analysis on a large document). The 3-min worker-heartbeat timeout is
      // only meaningful for a RUNNING worker that has stopped emitting heartbeats; applying
      // it to a queued job falsely kills the second of two concurrent generations with
      // "Worker stale for 3 minutes" while it was merely waiting its turn. Bound pending
      // jobs by the generous job-level timeout instead, so the queue can drain.
      const isPending = job.status === 'pending';
      const staleThreshold = isPending ? JOB_STALE_RUNNING_MS : WORKER_STALE_RUNNING_MS;
      const heartbeat = new Date(job.updatedAt || job.createdAt || 0).getTime();
      if (!Number.isFinite(heartbeat)) return job;
      if (now - heartbeat < staleThreshold) return job;
      changed = true;
      const staleMin = Math.round((now - heartbeat) / 60000);
      const failureContext = buildStaleFailureContext(job, { staleMinutes: staleMin, isPending });
      const failed = {
        ...job,
        status: 'failed',
        error: job.error || failureContext.message,
        failureContext,
        updatedAt: new Date().toISOString(),
        deadLetter: true,
      };
      updateCheckpoint(job.id, { failureContext });
      appendDeadLetter({
        jobId: job.id,
        reason: isPending ? 'queue_timeout' : 'stale',
        staleMinutes: staleMin,
        failureKind: failureContext.failureKind,
        pid: job.pid,
        trackedByProxy: failureContext.context?.trackedByProxy,
        pidAlive: failureContext.context?.pidAlive,
        lastHeartbeatAt: job.lastHeartbeatAt,
        at: failed.updatedAt,
      });
      return failed;
    });
    return { normalized, changed };
  }

  function saveNormalizedWorkerJobs(previousJobs, normalizedJobs) {
    saveWorkerJobs(normalizedJobs);
    const previousById = new Map(previousJobs.map((job) => [job?.id, job]));
    for (const job of normalizedJobs) {
      if (!job?.id) continue;
      const previous = previousById.get(job.id);
      if (!previous) continue;
      if (
        previous.status !== job.status
        || previous.error !== job.error
        || previous.updatedAt !== job.updatedAt
        || previous.failureContext !== job.failureContext
      ) {
        syncGenerationMirrorFromWorker(job);
      }
    }
    syncOutOfDateWorkerMirrors(normalizedJobs);
  }

  function syncOutOfDateWorkerMirrors(workerJobs) {
    const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'paused']);
    const mirrorById = new Map(loadJobs().map((job) => [job?.id, job]));
    for (const job of workerJobs) {
      if (!job?.id || !terminalStatuses.has(job.status)) continue;
      const mirror = mirrorById.get(job.id);
      if (!mirror) continue;
      if (
        mirror.status !== job.status
        || mirror.error !== job.error
        || mirror.updatedAt !== job.updatedAt
        || mirror.checkpoint?.failureContext?.message !== job.failureContext?.message
      ) {
        syncGenerationMirrorFromWorker(job);
      }
    }
  }

  function getWorkerQueueKind(job) {
    if (job?.mode === 'image-generation') return 'image';
    return 'story';
  }

  function getWorkerQueueLimit(kind) {
    const envKey = kind === 'image' ? 'STORYRPG_IMAGE_WORKER_CONCURRENCY' : 'STORYRPG_STORY_WORKER_CONCURRENCY';
    const fallback = kind === 'image' ? 1 : 2;
    const parsed = Number(process.env[envKey]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  function countRunningByKind(kind) {
    return loadWorkerJobs().filter((job) =>
      job.status === 'running' && getWorkerQueueKind(job) === kind && activeWorkers.has(job.id)
    ).length;
  }

  function scheduleQueuedWorkers() {
    const jobs = loadWorkerJobs();
    for (const kind of ['story', 'image']) {
      let capacity = getWorkerQueueLimit(kind) - countRunningByKind(kind);
      if (capacity <= 0) continue;
      const queued = jobs
        .filter((job) => job.status === 'pending' && getWorkerQueueKind(job) === kind && job.resumeContext?.requestPayload)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      for (const job of queued) {
        if (capacity <= 0) break;
        capacity -= 1;
        startWorkerProcess(job, { ...job.resumeContext.requestPayload, mode: job.mode, resumeCheckpoint: job.resumeCheckpoint });
      }
    }
  }

  function startWorkerProcess(workerJob, payload) {
    const runnerPath = path.resolve(appRoot, 'src/ai-agents/server/worker-runner.ts');
    const payloadPath = path.join(os.tmpdir(), `storyrpg-worker-${workerJob.id}.payload.json`);
    const resultPath = path.join(os.tmpdir(), `storyrpg-worker-${workerJob.id}.result.json`);
    // mode 0o600: the payload carries provider API keys (config.agents.*.apiKey)
    // and os.tmpdir() is world-readable on shared hosts.
    fs.writeFileSync(payloadPath, JSON.stringify({
      ...payload,
      externalJobId: workerJob.id,
      resultPath,
      friendlyName: workerJob.friendlyName,
      processTitle: workerJob.processTitle,
    }, null, 2), { encoding: 'utf8', mode: 0o600 });

    const proc = spawnTsNodeWorker({
      appRootDir: appRoot,
      entryScriptPath: runnerPath,
      payloadPath,
    });
    const workerStartedAt = new Date().toISOString();
    activeWorkers.set(workerJob.id, {
      proc,
      payloadPath,
      resultPath,
      startedAt: workerStartedAt,
      lastWorkerEventAt: workerStartedAt,
      lastWorkerEventType: 'spawn',
    });
    upsertWorkerJob(workerJob.id, {
      status: 'running',
      pid: proc.pid,
      startedAt: workerStartedAt,
      workerSpawnedAt: workerStartedAt,
      lastWorkerEventAt: workerStartedAt,
      lastWorkerEventType: 'spawn',
    });
    appendWorkerTimeline(workerJob.id, {
      workerEvent: true,
      type: 'worker_spawn',
      pid: proc.pid,
      timestamp: workerStartedAt,
      message: `Spawned worker process pid=${proc.pid}`,
    });

    proc.on('error', (err) => {
      console.error(`[Proxy] Worker spawn error for ${workerJob.id}: ${err.message}`);
      appendWorkerTimeline(workerJob.id, {
        workerEvent: true,
        type: 'worker_spawn_error',
        pid: proc.pid,
        message: err.message,
        timestamp: new Date().toISOString(),
      });
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
      scheduleQueuedWorkers();
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
          const active = activeWorkers.get(workerJob.id);
          const eventAt = evt.timestamp || new Date().toISOString();
          if (active) {
            active.lastWorkerEventAt = eventAt;
            active.lastWorkerEventType = evt.type;
          }

          if (evt.type === 'pipeline_event') {
            const phase = evt.phase || 'processing';
            const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
            const prevProgress = Number(currentJob?.progress || 0);
            const nextProgress = estimateWorkerProgress(workerJob.mode, phase, evt.eventType, prevProgress, evt.data || null, evt.telemetry || null);
            const updates = {
              currentPhase: phase,
              progress: phase === 'complete' ? 100 : nextProgress,
              lastWorkerEventAt: eventAt,
              lastWorkerEventType: evt.type,
              lastPipelineEventAt: eventAt,
              lastPipelinePhase: phase,
              lastPipelineMessage: typeof evt.message === 'string' ? evt.message.slice(0, 300) : undefined,
            };
            if (active) {
              active.lastPipelineEventAt = eventAt;
              active.lastPipelinePhase = phase;
              active.lastPipelineMessage = updates.lastPipelineMessage;
            }
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
            // Structure-driven progress plan (episodes -> scenes -> beats).
            // Latest-wins snapshot; flows out to the frontend via publicJobState.
            if (evt.data && evt.data.generationPlan && typeof evt.data.generationPlan === 'object') {
              updates.generationPlan = evt.data.generationPlan;
            }
            upsertWorkerJob(workerJob.id, updates);
            const savedCheckpointStepId = evt.eventType === 'checkpoint'
              && evt.data
              && typeof evt.data === 'object'
              && evt.data.stepId
              && Object.prototype.hasOwnProperty.call(evt.data, 'output')
              ? evt.data.stepId
              : null;
            if (savedCheckpointStepId) {
              const checkpointFile = persistCheckpointOutput(workerJob.id, savedCheckpointStepId, evt.data.output);
              updateCheckpoint(workerJob.id, {
                outputs: {
                  [savedCheckpointStepId]: { __checkpointFile: checkpointFile },
                },
                steps: {
                  [savedCheckpointStepId]: {
                    stepId: savedCheckpointStepId,
                    status: 'completed',
                    updatedAt: new Date().toISOString(),
                    idempotencyKey: `${workerJob.id}:${savedCheckpointStepId}`,
                    artifactKey: evt.data.artifactKey,
                  },
                },
              });
              markArtifactCommitted(workerJob.id, evt.data.artifactKey || `checkpoint:${savedCheckpointStepId}`, { source: 'pipeline-checkpoint' });
            }
            updateCheckpoint(workerJob.id, {
              lastEvent: evt,
              steps: {
                [phase]: {
                  stepId: phase,
                  status: evt.eventType === 'phase_complete' || savedCheckpointStepId === phase ? 'completed' : 'running',
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
              if (rawData.imagePath !== undefined) safeUpdates.imagePath = rawData.imagePath;
              if (rawData.localPath !== undefined) safeUpdates.localPath = rawData.localPath;
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
              // WS1b: provider credit/quota exhaustion parks the job as
              // 'paused' (resumable after top-up) instead of failing it. The
              // stale reapers only sweep running/pending, so paused jobs are
              // never auto-killed.
              status: isQuotaFailureContext(failureContext) ? 'paused' : 'failed',
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
            if (active) {
              active.lastHeartbeatAt = eventAt;
              active.lastHeartbeat = stripLargeValues(evt, 200);
            }
            upsertWorkerJob(workerJob.id, {
              lastHeartbeatAt: eventAt,
              lastWorkerEventAt: eventAt,
              lastWorkerEventType: evt.type,
              heartbeat: stripLargeValues({
                rssBytes: evt.rssBytes,
                heapUsedBytes: evt.heapUsedBytes,
                heapTotalBytes: evt.heapTotalBytes,
                intervalMs: evt.intervalMs,
                boot: evt.boot,
                status: evt.status,
              }, 200),
            });
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
      const active = activeWorkers.get(workerJob.id);
      const closeAt = new Date().toISOString();
      const resultFound = fs.existsSync(resultPath);
      const closeDiagnostics = stripLargeValues({
        pid: proc.pid,
        code,
        signal: signal || null,
        resultFound,
        resultPath,
        payloadPath,
        trackedBeforeClose: activeWorkers.has(workerJob.id),
        startedAt: active?.startedAt,
        closedAt: closeAt,
        lastHeartbeatAt: active?.lastHeartbeatAt,
        lastWorkerEventAt: active?.lastWorkerEventAt,
        lastWorkerEventType: active?.lastWorkerEventType,
        lastPipelineEventAt: active?.lastPipelineEventAt,
        lastPipelinePhase: active?.lastPipelinePhase,
        lastPipelineMessage: active?.lastPipelineMessage,
      }, 400);
      appendWorkerTimeline(workerJob.id, {
        workerEvent: true,
        type: 'worker_close',
        timestamp: closeAt,
        message: `Worker exited with code=${code} signal=${signal || 'none'}`,
        diagnostics: closeDiagnostics,
      });
      activeWorkers.delete(workerJob.id);
      let result = null;
      if (resultFound) {
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
        scheduleQueuedWorkers();
        return;
      }

      if (result?.success === false) {
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
          status: isQuotaFailureContext(failureContext) ? 'paused' : 'failed',
          progress: 100,
          finishedAt: new Date().toISOString(),
          error: failureContext.message,
          failureContext,
        });
        updateCheckpoint(workerJob.id, { failureContext });
        syncGenerationMirrorFromWorker(failed);
      } else if (code === 0 && result) {
        const completed = upsertWorkerJob(workerJob.id, {
          status: 'completed',
          progress: 100,
          finishedAt: new Date().toISOString(),
          resultSummary: { success: true },
        });
        workerResultCache.set(workerJob.id, { result, storedAt: Date.now() });
        markArtifactCommitted(workerJob.id, 'job:result', { resultPath });
        syncGenerationMirrorFromWorker(completed);
      } else {
        const currentJob = loadWorkerJobs().find((j) => j.id === workerJob.id);
        const failureContext = currentJob?.failureContext || buildFailureContextFromEvent({
          message: `Worker exited with code=${code} signal=${signal || 'none'}`,
          failurePhase: currentJob?.currentPhase || workerJob.currentPhase || 'generation',
          failureStepId: currentJob?.currentPhase || workerJob.currentPhase || 'generation',
          failureKind: 'worker_exit',
          resumeFromStepId: currentJob?.currentPhase || workerJob.currentPhase || 'generation',
          context: {
            closeDiagnostics,
          },
        }, currentJob || workerJob);
        const errorMsg = failureContext.message || `Worker exited with code=${code} signal=${signal || 'none'}`;
        const isQuotaPause = isQuotaFailureContext(failureContext);
        const failed = upsertWorkerJob(workerJob.id, {
          status: isQuotaPause ? 'paused' : 'failed',
          progress: 100,
          finishedAt: new Date().toISOString(),
          error: errorMsg,
          deadLetter: !isQuotaPause,
          failureContext,
        });
        updateCheckpoint(workerJob.id, { failureContext });
        if (!isQuotaPause) {
          appendDeadLetter({
            jobId: workerJob.id,
            reason: 'worker_exit',
            code,
            signal,
            pid: proc.pid,
            resultFound,
            lastHeartbeatAt: closeDiagnostics.lastHeartbeatAt,
            lastPipelinePhase: closeDiagnostics.lastPipelinePhase,
            at: new Date().toISOString(),
          });
        }
        syncGenerationMirrorFromWorker(failed);
      }

      try { fs.unlinkSync(payloadPath); } catch {
        // best-effort cleanup; temp file may already be gone
      }
      try { fs.unlinkSync(resultPath); } catch {
        // best-effort cleanup
      }
      scheduleQueuedWorkers();
    });
  }

  function markActiveWorkersInterrupted(reason, signal) {
    const now = new Date().toISOString();
    for (const [jobId, active] of activeWorkers.entries()) {
      const job = loadWorkerJobs().find((j) => j.id === jobId) || { id: jobId };
      const failureContext = stripLargeValues({
        message: `Proxy interrupted worker job (${reason}) before the child reported completion.`,
        failurePhase: job.currentPhase || 'generation',
        failureStepId: job.currentPhase || 'generation',
        failureKind: 'proxy_interrupted_worker',
        resumeFromStepId: job.currentPhase || 'generation',
        resumePatchableInputs: ['settings'],
        context: {
          jobId,
          pid: active?.proc?.pid || job.pid,
          signal,
          outputDirectory: getOutputDirectoryFromJob(job, loadCheckpoints().find((c) => c.jobId === jobId)),
        },
        timestamp: now,
      }, 400);
      const failed = upsertWorkerJob(jobId, {
        status: 'failed',
        error: failureContext.message,
        failureContext,
        deadLetter: true,
        finishedAt: now,
      });
      updateCheckpoint(jobId, { failureContext });
      appendDeadLetter({
        jobId,
        reason,
        signal,
        pid: active?.proc?.pid || job.pid,
        at: now,
      });
      syncGenerationMirrorFromWorker(failed);
      try { active?.proc?.kill(signal || 'SIGTERM'); } catch {
        // Worker may already be gone.
      }
    }
  }

  if (!global.__storyrpgWorkerLifecycleShutdownHandlersInstalled) {
    global.__storyrpgWorkerLifecycleShutdownHandlersInstalled = true;
    process.once('SIGTERM', () => {
      markActiveWorkersInterrupted('proxy_sigterm', 'SIGTERM');
      process.exit(143);
    });
    process.once('SIGINT', () => {
      markActiveWorkersInterrupted('proxy_sigint', 'SIGINT');
      process.exit(130);
    });
    process.once('beforeExit', () => {
      markActiveWorkersInterrupted('proxy_before_exit', 'SIGTERM');
    });
  }

  function hydrateWorkerConfigApiKeys(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const cfg = payload.config;
    if (!cfg || typeof cfg !== 'object') return payload;
    normalizePipelineOutputDir(cfg, { storiesDir, runtimeRoot, appRoot });
    const agents = cfg.agents;

    const envAnthropicKey =
      process.env.ANTHROPIC_API_KEY
      || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
      || '';
    const envOpenAiKey =
      process.env.OPENAI_API_KEY
      || process.env.EXPO_PUBLIC_OPENAI_API_KEY
      || '';
    const envOpenRouterKey =
      process.env.OPENROUTER_API_KEY
      || process.env.EXPO_PUBLIC_OPENROUTER_API_KEY
      || '';
    const envGeminiKey =
      process.env.GEMINI_API_KEY
      || process.env.EXPO_PUBLIC_GEMINI_API_KEY
      || '';
    const envAtlasKey =
      process.env.ATLAS_CLOUD_API_KEY
      || process.env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY
      || '';

    if (agents && typeof agents === 'object') {
      for (const agentName of Object.keys(agents)) {
        const agentCfg = agents[agentName];
        if (!agentCfg || typeof agentCfg !== 'object') continue;
        if (agentCfg.provider === 'anthropic' && isMissingApiKey(agentCfg.apiKey)) {
          agentCfg.apiKey = envAnthropicKey;
        } else if ((agentCfg.provider === 'gemini' || agentCfg.provider === 'google') && isMissingApiKey(agentCfg.apiKey)) {
          agentCfg.apiKey = envGeminiKey;
        } else if (agentCfg.provider === 'openai' && isMissingApiKey(agentCfg.apiKey)) {
          agentCfg.apiKey = envOpenAiKey;
        } else if (agentCfg.provider === 'openrouter' && isMissingApiKey(agentCfg.apiKey)) {
          agentCfg.apiKey = envOpenRouterKey;
        }
      }
    }

    if (cfg.imageGen && typeof cfg.imageGen === 'object') {
      if (isMissingApiKey(cfg.imageGen.apiKey)) {
        cfg.imageGen.apiKey = envGeminiKey || envOpenAiKey || envAtlasKey;
      }
      if (isMissingApiKey(cfg.imageGen.geminiApiKey)) {
        cfg.imageGen.geminiApiKey = envGeminiKey;
      }
      if (isMissingApiKey(cfg.imageGen.openaiApiKey)) {
        cfg.imageGen.openaiApiKey = envOpenAiKey;
      }
      if (isMissingApiKey(cfg.imageGen.atlasCloudApiKey)) {
        cfg.imageGen.atlasCloudApiKey = envAtlasKey;
      }
    }
    if (cfg.narration && typeof cfg.narration === 'object') {
      if (!cfg.narration.provider) {
        cfg.narration.provider = 'elevenlabs';
      }
      if (cfg.narration.provider === 'gemini' && isMissingApiKey(cfg.narration.geminiApiKey)) {
        cfg.narration.geminiApiKey = envGeminiKey || cfg.imageGen?.geminiApiKey || cfg.imageGen?.apiKey || '';
      }
      if (cfg.narration.provider === 'elevenlabs' && isMissingApiKey(cfg.narration.elevenLabsApiKey)) {
        cfg.narration.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
      }
    }

    return payload;
  }

  function registerWorkerLifecycleRoutes(app) {
    app.post('/worker-jobs/start', (req, res) => {
      const { mode, payload, idempotencyKey, storyTitle, episodeCount, resumeFromJobId } = req.body || {};
      if (!mode || !payload || (mode !== 'analysis' && mode !== 'generation' && mode !== 'image-generation' && mode !== 'compile-episode')) {
        return res.status(400).json({ error: 'Invalid worker start payload' });
      }

      const jobs = loadWorkerJobs();
      const { normalized: normalizedJobs, changed: normalizedChanged } = normalizeStaleWorkerJobs(jobs);
      if (normalizedChanged) {
        saveNormalizedWorkerJobs(jobs, normalizedJobs);
      }
      if (idempotencyKey) {
        const existing = normalizedJobs.find((j) => j.idempotencyKey === idempotencyKey && ['pending', 'running'].includes(j.status));
        if (existing) {
          const tracked = activeWorkers.has(existing.id);
          const pidAlive = isProcessAlive(existing.pid);
          if (existing.status === 'running' && !tracked && !pidAlive) {
            const failureContext = existing.failureContext || buildOrphanFailureContext(existing);
            const failed = upsertWorkerJob(existing.id, {
              status: 'failed',
              error: existing.error || failureContext.message || 'Worker process exited unexpectedly (orphaned running job)',
              failureContext,
              deadLetter: true,
            });
            updateCheckpoint(existing.id, { failureContext });
            appendDeadLetter({
              jobId: existing.id,
              reason: 'orphaned_process',
              pid: existing.pid,
              failureKind: failureContext.failureKind,
              trackedByProxy: failureContext.context?.trackedByProxy,
              pidAlive: failureContext.context?.pidAlive,
              lastHeartbeatAt: failureContext.context?.lastHeartbeatAt,
              lastWorkerEventAt: failureContext.context?.lastWorkerEventAt,
              lastPipelinePhase: failureContext.context?.lastPipelinePhase,
              at: new Date().toISOString(),
            });
            syncGenerationMirrorFromWorker(failed);
          } else {
            return res.json({
              success: true,
              deduped: true,
              jobId: existing.id,
              status: existing.status,
              friendlyName: existing.friendlyName || existing.resumeContext?.friendlyName,
              processTitle: existing.processTitle || existing.resumeContext?.processTitle,
            });
          }
        }
      }

      const jobId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const resumeCheckpoint = resumeFromJobId
        ? hydrateCheckpointOutputs(loadCheckpoints().find((c) => c.jobId === resumeFromJobId))
        : undefined;
      const hydratedPayload = hydrateWorkerConfigApiKeys(payload);
      const priorOutputDir = getOutputDirectoryFromCheckpoint(resumeCheckpoint);
      if (priorOutputDir && mode === 'image-generation') {
        hydratedPayload.imageGenerationInput = {
          ...(hydratedPayload.imageGenerationInput || {}),
          outputDirectory: priorOutputDir,
        };
      }
      if (mode === 'image-generation' && hydratedPayload.imageGenerationInput?.outputDirectory) {
        try {
          hydratedPayload.imageGenerationInput.outputDirectory = normalizeImageGenerationOutputDirectory(
            hydratedPayload.imageGenerationInput.outputDirectory,
            { storiesDir, appRoot },
          );
        } catch (error) {
          return res.status(400).json({ error: error.message });
        }
      }
      if (mode === 'compile-episode' && hydratedPayload.compileEpisodeInput?.outputDirectory) {
        try {
          hydratedPayload.compileEpisodeInput.outputDirectory = normalizeImageGenerationOutputDirectory(
            hydratedPayload.compileEpisodeInput.outputDirectory,
            { storiesDir, appRoot },
            'compileEpisodeInput.outputDirectory',
          );
        } catch (error) {
          return res.status(400).json({ error: error.message });
        }
      }
      const requestSnapshot = buildWorkerRequestSnapshot(mode, hydratedPayload, storyTitle);
      const friendlyName = buildWorkerFriendlyName(mode, hydratedPayload, storyTitle, episodeCount, { resumeFromJobId });
      const processTitle = buildWorkerProcessTitle(mode, friendlyName);
      const resumeOutputs = priorOutputDir
        ? { output_directory: { outputDirectory: priorOutputDir } }
        : undefined;
      const workerJob = upsertWorkerJob(jobId, {
        mode,
        status: 'pending',
        progress: 0,
        currentPhase: 'queued',
        storyTitle: storyTitle || buildDefaultWorkerStoryTitle(mode),
        friendlyName,
        processTitle,
        episodeCount: episodeCount || 1,
        idempotencyKey: idempotencyKey || `${mode}:${Date.now()}`,
        resumeFromJobId: resumeFromJobId || undefined,
        requestSnapshot,
        resumeCheckpoint,
        resumeContext: {
          mode,
          requestPayload: hydratedPayload,
          storyTitle: storyTitle || buildDefaultWorkerStoryTitle(mode),
          friendlyName,
          processTitle,
          episodeCount: episodeCount || 1,
          resumeFromJobId: resumeFromJobId || undefined,
          ...(priorOutputDir ? { outputDirectory: priorOutputDir } : {}),
        },
        ...(priorOutputDir ? { outputDirectory: priorOutputDir, outputDir: priorOutputDir } : {}),
        ...(resumeOutputs ? { outputs: resumeOutputs } : {}),
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
        ...(resumeOutputs ? { outputs: resumeOutputs } : {}),
        resumeContext: {
          mode,
          requestPayload: hydratedPayload,
          storyTitle: workerJob.storyTitle,
          friendlyName,
          processTitle,
          episodeCount: workerJob.episodeCount,
          resumeFromJobId: resumeFromJobId || undefined,
          ...(priorOutputDir ? { outputDirectory: priorOutputDir } : {}),
        },
      });

      scheduleQueuedWorkers();
      syncGenerationMirrorFromWorker(workerJob);
      return res.json({ success: true, jobId, friendlyName, processTitle });
    });

    app.get('/worker-jobs', (req, res) => {
      const jobs = loadWorkerJobs();
      const { normalized, changed } = normalizeStaleWorkerJobs(jobs);
      if (changed) saveNormalizedWorkerJobs(jobs, normalized);
      else syncOutOfDateWorkerMirrors(normalized);
      const checkpoints = loadCheckpoints();
      const checkpointByJobId = new Map(checkpoints.map((checkpoint) => [checkpoint.jobId, hydrateCheckpointOutputs(checkpoint)]));
      const statsCache = new Map();
      res.json(normalized.map((job) => publicJobState(enrichWorkerJobWithOutputState(job, checkpointByJobId.get(job.id), statsCache))));
    });

    app.get('/worker-jobs/:jobId', (req, res) => {
      const jobs = loadWorkerJobs();
      const { normalized, changed } = normalizeStaleWorkerJobs(jobs);
      if (changed) saveNormalizedWorkerJobs(jobs, normalized);
      else syncOutOfDateWorkerMirrors(normalized);
      const job = normalized.find((j) => j.id === req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Worker job not found' });
      const checkpoint = loadCheckpoints().find((c) => c.jobId === job.id);
      const hydratedCheckpoint = hydrateCheckpointOutputs(checkpoint);
      const enrichedJob = enrichWorkerJobWithOutputState(job, hydratedCheckpoint);

      const cached = workerResultCache.get(job.id);
      if (cached) {
        if (Date.now() - cached.storedAt > WORKER_RESULT_TTL_MS) {
          workerResultCache.delete(job.id);
        } else {
          return res.json(publicJobState({ ...enrichedJob, checkpoint: hydratedCheckpoint, result: cached.result }));
        }
      }

      res.json(publicJobState({ ...enrichedJob, checkpoint: hydratedCheckpoint }));
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
        checkpoint: publicCheckpoint(checkpoint),
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
        checkpoint: publicCheckpoint(mergedCheckpoint),
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

      res.write(`event: snapshot\ndata: ${JSON.stringify(publicJobState(job))}\n\n`);

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

      const requestedOutputDir = patchedOutputs?.output_directory?.outputDirectory;
      const priorOutputDir = requestedOutputDir
        || resumeContext.outputDirectory
        || hydratedCheckpoint?.failureContext?.context?.outputDirectory;
      if (priorOutputDir && !patchedOutputs.output_directory) {
        patchedOutputs.output_directory = { outputDirectory: priorOutputDir };
      }

      const resumeSteps = normalizeResumeStepsForOutputs(hydratedCheckpoint?.steps || {}, patchedOutputs);

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
      const projectId = sourceJob.projectId
        || sourceJob.resumeFromJobId
        || sourceJob.resumeContext?.resumeFromJobId
        || sourceJob.checkpoint?.resumeContext?.resumeFromJobId
        || sourceJob.id;
      const friendlyName = buildWorkerFriendlyName(mode, patchedPayload, storyTitle, episodeCount, {
        resumeFromJobId: sourceJob.id,
        resumeFromStepId: resumeCheckpoint?.failureContext?.resumeFromStepId || resumeCheckpoint?.failureContext?.failurePhase,
      });
      const processTitle = buildWorkerProcessTitle(mode, friendlyName);

      const workerJob = upsertWorkerJob(jobId, {
        mode,
        projectId,
        status: 'pending',
        progress: 0,
        currentPhase: resumeCheckpoint?.failureContext?.resumeFromStepId || resumeCheckpoint?.failureContext?.failurePhase || 'queued',
        storyTitle: storyTitle || 'Untitled Story',
        friendlyName,
        processTitle,
        episodeCount: episodeCount || 1,
        idempotencyKey,
        resumeFromJobId: sourceJob.id,
        requestSnapshot,
        ...(priorOutputDir ? { outputDirectory: priorOutputDir, outputDir: priorOutputDir } : {}),
        resumeContext: {
          mode,
          requestPayload: patchedPayload,
          storyTitle: storyTitle || 'Untitled Story',
          friendlyName,
          processTitle,
          episodeCount: episodeCount || 1,
          resumeFromJobId: sourceJob.id,
          resumedAt: new Date().toISOString(),
          changedInputs: Object.keys(payloadPatch),
          changedOutputs: Object.keys(outputsPatch),
          ...(priorOutputDir ? { outputDirectory: priorOutputDir } : {}),
        },
        resumeCheckpoint,
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
          friendlyName,
          processTitle,
          episodeCount: workerJob.episodeCount,
          resumeFromJobId: sourceJob.id,
          resumedAt: new Date().toISOString(),
          changedInputs: Object.keys(payloadPatch),
          changedOutputs: Object.keys(outputsPatch),
          ...(priorOutputDir ? { outputDirectory: priorOutputDir } : {}),
        },
      });

      scheduleQueuedWorkers();
      syncGenerationMirrorFromWorker(workerJob);
      res.json({ success: true, jobId, resumedFromJobId: sourceJob.id, projectId, friendlyName, processTitle });
    });

    setImmediate(() => {
      try {
        scheduleQueuedWorkers();
      } catch (err) {
        console.warn('[Proxy] Failed to schedule queued workers on startup:', err?.message || err);
      }
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
    saveNormalizedWorkerJobs,
    syncOutOfDateWorkerMirrors,
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

module.exports = {
  createWorkerLifecycle,
  __test__: {
    isArchitectureResumeFailure,
    normalizeResumeStepsForOutputs,
  },
};
