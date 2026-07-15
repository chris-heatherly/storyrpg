/**
 * Spawn the TypeScript worker entrypoints with dependencies available in production.
 */

const { spawn, execSync } = require('child_process');

// Resolve PER SPAWN, never cached: the startup-cached version stamped
// fcedc501ae on every run for a full day while newer commits were actually
// executing — attribution is only useful when it tells the truth. Host runs
// also mark a dirty working tree; container runs (git binary absent, repo
// bind-mounted) mark '+mount' because dirtiness is undetectable there.
function resolveProxyGitSha() {
  try {
    const sha = execSync('git rev-parse --short=10 HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (!sha) return null;
    try {
      const dirty = execSync('git status --porcelain', {
        cwd: __dirname,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim().length > 0;
      return dirty ? `${sha}-dirty` : sha;
    } catch {
      return sha;
    }
  } catch {
    // The compose proxy runs in node:20-bookworm-slim with the repo
    // bind-mounted but no git binary — read .git directly instead of
    // stamping every ledger row "unknown".
    const sha = readGitShaFromDotGit();
    return sha ? `${sha}+mount` : null;
  }
}

function readGitShaFromDotGit() {
  const fs = require('fs');
  const path = require('path');
  // Host layout: repo root is one level ABOVE storyrpg-prototype. Container
  // layout: docker-compose.proxy.yml mounts the repo's .git read-only at
  // /repo-git (the app mount alone carries no .git).
  const candidates = [
    path.resolve(__dirname, '..', '..', '.git'),
    '/repo-git',
  ];
  for (const gitDir of candidates) {
    try {
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      if (!head.startsWith('ref: ')) return head.slice(0, 10);
      const ref = head.slice(5).trim();
      const refPath = path.join(gitDir, ...ref.split('/'));
      if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf8').trim().slice(0, 10);
      const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
      const line = packed.split('\n').find((entry) => entry.endsWith(` ${ref}`));
      if (line) return line.split(' ')[0].slice(0, 10);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
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
  const spawnGitSha = resolveProxyGitSha();
  return spawn(command, args, {
    cwd: appRootDir,
    env: {
      ...process.env,
      ...(spawnGitSha ? { STORYRPG_WORKER_GIT_SHA: spawnGitSha } : {}),
      ...env,
      FORCE_COLOR: '0',
      TS_NODE_PREFER_TS_EXTS: 'true',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${workerMaxOldSpaceSize}`.trim(),
    },
    stdio,
  });
}

module.exports = { buildTsNodeSpawnArgs, spawnTsNodeWorker };
