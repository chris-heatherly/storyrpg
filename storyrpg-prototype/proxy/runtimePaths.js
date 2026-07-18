/**
 * Resolve writable runtime directories for the proxy server.
 *
 * Cloud Run mounts the application directory read-only; only /tmp is writable.
 * When detected (K_SERVICE), stateful paths are placed under os.tmpdir().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function usesEphemeralRuntimeRoot() {
  if (process.env.STORYRPG_RUNTIME_DIR) return true;
  return Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_SERVICE);
}

function createRuntimeLayout(appRootDir) {
  const appRoot = path.resolve(appRootDir);
  const ephemeral = usesEphemeralRuntimeRoot();
  const runtimeRoot = process.env.STORYRPG_RUNTIME_DIR
    ? path.resolve(process.env.STORYRPG_RUNTIME_DIR)
    : ephemeral
      ? path.join(os.tmpdir(), 'storyrpg-runtime')
      : appRoot;

  const storiesDir = process.env.STORIES_DIR
    ? path.resolve(process.env.STORIES_DIR)
    : path.join(runtimeRoot, 'generated-stories');

  const layout = {
    appRoot,
    runtimeRoot,
    ephemeral,
    storiesDir,
    refImagesDir: path.join(runtimeRoot, '.ref-images'),
    pipelineMemoryRoot: process.env.MEMORY_DIR
      ? path.resolve(process.env.MEMORY_DIR)
      : path.join(runtimeRoot, 'pipeline-memories'),
    deletedStoriesFile: path.join(storiesDir, '.deleted-stories.json'),
    workerCheckpointOutputDir: path.join(runtimeRoot, '.worker-checkpoint-outputs'),
    workerResultsDir: path.join(runtimeRoot, '.worker-results'),
    generationJobsFile: path.join(runtimeRoot, '.generation-jobs.json'),
    workerJobsFile: path.join(runtimeRoot, '.worker-jobs.json'),
    workerCheckpointsFile: path.join(runtimeRoot, '.worker-checkpoints.json'),
    workerDeadLetterFile: path.join(runtimeRoot, '.worker-dead-letter.json'),
    imageFeedbackFile: path.join(runtimeRoot, '.image-feedback.json'),
    modelCacheFile: path.join(runtimeRoot, '.model-cache.json'),
    generatorSettingsFile: path.join(runtimeRoot, '.generator-settings.json'),
  };

  for (const dir of [
    layout.runtimeRoot,
    layout.storiesDir,
    layout.refImagesDir,
    layout.pipelineMemoryRoot,
    layout.workerCheckpointOutputDir,
    layout.workerResultsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return layout;
}

module.exports = { createRuntimeLayout, usesEphemeralRuntimeRoot };
