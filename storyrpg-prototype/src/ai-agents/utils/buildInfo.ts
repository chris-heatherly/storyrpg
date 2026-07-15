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
    const sha = execSync('git rev-parse --short=10 HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || undefined;
    if (sha) {
      // A stamp that can't represent a dirty tree is half a stamp: a full day
      // of runs executed uncommitted code under a clean-looking SHA.
      try {
        const dirty = execSync('git status --porcelain', {
          cwd: __dirname,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        }).trim().length > 0;
        cachedSha = dirty ? `${sha}-dirty` : sha;
      } catch {
        cachedSha = sha;
      }
    }
  } catch {
    // Containerized workers (node slim image, repo bind-mounted, no git
    // binary) read .git directly; dirtiness is undetectable there, so the
    // stamp is explicitly marked as mount-derived.
    const sha = readShaFromDotGit();
    cachedSha = sha ? `${sha}+mount` : undefined;
  }
  return cachedSha;
}

function readShaFromDotGit(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // Host layout: repo root is one level above storyrpg-prototype (four above
  // this file). Container layout: the compose file mounts the repo's .git
  // read-only at /repo-git.
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', '..', '.git'),
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
