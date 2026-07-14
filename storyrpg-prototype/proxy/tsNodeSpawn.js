/**
 * Spawn the TypeScript worker entrypoints with dependencies available in production.
 */

const { spawn, execSync } = require('child_process');

// Resolve once at proxy startup: the proxy always runs from the repo, while
// the worker's own git lookup can fail in packaged/containerized contexts —
// which left quality-ledger rows with workerGitSha: null and made "which code
// did this run exercise" an investigation again.
let cachedGitSha;
function resolveProxyGitSha() {
  if (cachedGitSha !== undefined) return cachedGitSha;
  try {
    cachedGitSha = execSync('git rev-parse --short=10 HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || null;
  } catch {
    cachedGitSha = null;
  }
  return cachedGitSha;
}

function buildTsNodeSpawnArgs(entryScriptPath, payloadPath) {
  const tsNodeBin = require.resolve('ts-node/dist/bin');
  return {
    command: process.execPath,
    args: [
      tsNodeBin,
      '-r',
      'tsconfig-paths/register',
      '--project',
      'tsconfig.worker.json',
      '--transpile-only',
      entryScriptPath,
      payloadPath,
    ],
  };
}

function spawnTsNodeWorker({ appRootDir, entryScriptPath, payloadPath, env = {}, stdio = ['ignore', 'pipe', 'pipe'] }) {
  const { command, args } = buildTsNodeSpawnArgs(entryScriptPath, payloadPath);
  const workerMaxOldSpaceSize = Number(process.env.STORYRPG_WORKER_MAX_OLD_SPACE_SIZE_MB) || 4096;
  return spawn(command, args, {
    cwd: appRootDir,
    env: {
      ...process.env,
      ...(resolveProxyGitSha() ? { STORYRPG_WORKER_GIT_SHA: resolveProxyGitSha() } : {}),
      ...env,
      FORCE_COLOR: '0',
      TS_NODE_PREFER_TS_EXTS: 'true',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${workerMaxOldSpaceSize}`.trim(),
    },
    stdio,
  });
}

module.exports = { buildTsNodeSpawnArgs, spawnTsNodeWorker };
