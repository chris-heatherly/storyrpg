#!/usr/bin/env node
/**
 * Ensure the Cognee memory sidecar is running before the generator launches.
 *
 * Wired into `npm run generator:web` (and the launch.json generator configs).
 * Fail-soft by design: memory is advisory and every provider path is
 * fail-open, so this script NEVER blocks the generator — any failure logs a
 * warning and exits 0.
 *
 * Skips when:
 *  - STORYRPG_MEMORY_PROVIDER is not `cognee` (nothing to launch)
 *  - COGNEE_BASE_URL points at a non-local host (a remote Cognee is not ours
 *    to start)
 *  - the sidecar is already healthy
 */
import 'dotenv/config';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(APP_ROOT, 'docker-compose.cognee.yml');
const HEALTH_WAIT_MS = 60_000;
const HEALTH_POLL_MS = 2_000;

const log = (msg) => console.log(`[ensure-cognee] ${msg}`);

async function isHealthy(baseUrl, timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.STORYRPG_MEMORY_PROVIDER !== 'cognee') {
    return; // memory not on cognee — nothing to launch
  }
  const baseUrl = (process.env.COGNEE_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    log(`invalid COGNEE_BASE_URL "${baseUrl}" — skipping`);
    return;
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    log(`COGNEE_BASE_URL is remote (${host}) — not managing it locally`);
    return;
  }

  if (await isHealthy(baseUrl)) {
    log(`Cognee already healthy at ${baseUrl}`);
    return;
  }

  log('Cognee not reachable — starting sidecar (docker compose -f docker-compose.cognee.yml up -d)…');
  const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d'], {
    cwd: APP_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.toString().trim().split('\n').pop() || `exit ${result.status}`;
    log(`could not start Cognee (${detail}). Generator continues; memory falls back / fails open.`);
    return;
  }

  const deadline = Date.now() + HEALTH_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl)) {
      log(`Cognee healthy at ${baseUrl}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  log(`Cognee container started but /health not ready after ${HEALTH_WAIT_MS / 1000}s — continuing anyway (fail-open).`);
}

main().catch((err) => {
  log(`unexpected error: ${err?.message || err} — continuing anyway`);
}).finally(() => {
  process.exit(0);
});
