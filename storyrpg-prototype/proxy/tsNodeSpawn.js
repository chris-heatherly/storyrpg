/**
 * Spawn the TypeScript worker entrypoints with dependencies available in production.
 */

const { spawn } = require('child_process');

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
      ...env,
      FORCE_COLOR: '0',
      TS_NODE_PREFER_TS_EXTS: 'true',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${workerMaxOldSpaceSize}`.trim(),
    },
    stdio,
  });
}

module.exports = { buildTsNodeSpawnArgs, spawnTsNodeWorker };
