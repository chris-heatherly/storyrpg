/**
 * Which code is actually running? The 2026-07-14 capacity-tier fix landed four
 * minutes AFTER the run it was meant to save failed, and the only way to tell
 * was comparing commit timestamps against worker log lines. Every run artifact
 * that matters (ledger rows, worker startup log) stamps this SHA so "which
 * fixes did this run exercise" is a lookup, not an investigation.
 *
 * Node-only, best-effort: in a non-node runtime or a non-git checkout it
 * returns undefined and nothing downstream cares.
 */

let cachedSha: string | undefined;
let resolved = false;

export function resolveWorkerGitSha(): string | undefined {
  if (resolved) return cachedSha;
  resolved = true;
  // The proxy resolves the SHA at spawn time and passes it down — the worker's
  // own git lookup is only a fallback for CLI runs outside the proxy.
  const fromEnv = typeof process !== 'undefined' ? process.env?.STORYRPG_WORKER_GIT_SHA : undefined;
  if (fromEnv && fromEnv.trim()) {
    cachedSha = fromEnv.trim();
    return cachedSha;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process') as typeof import('child_process');
    cachedSha = execSync('git rev-parse --short=10 HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || undefined;
  } catch {
    cachedSha = undefined;
  }
  return cachedSha;
}
