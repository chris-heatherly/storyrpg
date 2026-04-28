/**
 * Unified per-story checkpoint log — proxy side (CJS).
 *
 * Each story directory gets a `checkpoints.jsonl` file. Every write
 * is a single JSON object on its own line, appended via `fs.appendFile`.
 * The file is crash-safe by construction: a partial write is a
 * truncated final line, which the reader skips.
 *
 * Line kinds:
 *   { kind: 'job',        ts, jobId, phase, state, ... }
 *   { kind: 'phase',      ts, jobId, phase, status, ... }
 *   { kind: 'stepOutput', ts, jobId, stepId, assetSha256, size }
 *
 * `reduce(lines)` replays the log and produces the latest-known state
 * for every jobId so resume logic can work off a single data source.
 */

const fs = require('fs');
const path = require('path');

const CHECKPOINT_FILENAME = 'checkpoints.jsonl';

function checkpointPath(storyDir) {
  return path.join(storyDir, CHECKPOINT_FILENAME);
}

function appendCheckpoint(storyDir, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('appendCheckpoint: entry must be an object');
  }
  if (!entry.kind || !entry.ts) {
    entry = { kind: entry.kind || 'stepOutput', ts: entry.ts || new Date().toISOString(), ...entry };
  }
  const target = checkpointPath(storyDir);
  if (!fs.existsSync(storyDir)) fs.mkdirSync(storyDir, { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

function readCheckpoints(storyDir) {
  const target = checkpointPath(storyDir);
  if (!fs.existsSync(target)) return [];
  const raw = fs.readFileSync(target, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Partial/truncated final line — stop here; the rest may be lost.
      break;
    }
  }
  return out;
}

function reduceCheckpoints(entries) {
  const jobs = new Map();
  const phases = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind === 'job' && typeof entry.jobId === 'string') {
      const prev = jobs.get(entry.jobId) || {};
      jobs.set(entry.jobId, { ...prev, ...entry });
    } else if (entry.kind === 'phase' && typeof entry.jobId === 'string' && typeof entry.phase === 'string') {
      const key = `${entry.jobId}:${entry.phase}`;
      const prev = phases.get(key) || {};
      phases.set(key, { ...prev, ...entry });
    }
  }
  return {
    jobs: Array.from(jobs.values()),
    phases: Array.from(phases.values()),
  };
}

module.exports = {
  CHECKPOINT_FILENAME,
  checkpointPath,
  appendCheckpoint,
  readCheckpoints,
  reduceCheckpoints,
};
