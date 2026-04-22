/**
 * Unified per-story checkpoint log — TS twin of proxy/checkpointLog.js.
 *
 * See that file for the rationale + on-disk format. The TS version is
 * used by the worker / Node-side scripts; the proxy uses the CJS one.
 *
 * The storage format is pure JSONL (one JSON object per line), so the
 * file is crash-safe — a partial write only corrupts the final line
 * and the reader stops at the first malformed entry.
 */

import { hasNodeFs } from './atomicIo';

function nodeRequire<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(name) as T;
}

function nodeModules() {
  if (!hasNodeFs()) {
    throw new Error('checkpointLog: Node fs not available in this runtime');
  }
  const fs = nodeRequire<typeof import('fs')>('fs');
  const path = nodeRequire<typeof import('path')>('path');
  return { fs, path };
}

export const CHECKPOINT_FILENAME = 'checkpoints.jsonl';

export type CheckpointKind = 'job' | 'phase' | 'stepOutput';

export interface CheckpointBase {
  kind: CheckpointKind;
  ts: string;
  jobId: string;
}

export interface JobCheckpoint extends CheckpointBase {
  kind: 'job';
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  error?: string;
  phase?: string;
}

export interface PhaseCheckpoint extends CheckpointBase {
  kind: 'phase';
  phase: string;
  status: 'started' | 'completed' | 'failed';
  progress?: number;
  detail?: string;
}

export interface StepOutputCheckpoint extends CheckpointBase {
  kind: 'stepOutput';
  stepId: string;
  assetSha256: string;
  size: number;
  mimeType?: string;
}

export type Checkpoint = JobCheckpoint | PhaseCheckpoint | StepOutputCheckpoint;

export function checkpointPath(storyDir: string): string {
  const { path } = nodeModules();
  return path.join(storyDir, CHECKPOINT_FILENAME);
}

export function appendCheckpoint(storyDir: string, entry: Partial<Checkpoint> & { jobId: string }): Checkpoint {
  const { fs } = nodeModules();
  const kind: CheckpointKind = entry.kind ?? 'stepOutput';
  const normalised: Checkpoint = {
    ...entry,
    kind,
    ts: entry.ts ?? new Date().toISOString(),
  } as Checkpoint;
  if (!fs.existsSync(storyDir)) fs.mkdirSync(storyDir, { recursive: true });
  fs.appendFileSync(checkpointPath(storyDir), `${JSON.stringify(normalised)}\n`, 'utf8');
  return normalised;
}

export function readCheckpoints(storyDir: string): Checkpoint[] {
  const { fs } = nodeModules();
  const target = checkpointPath(storyDir);
  if (!fs.existsSync(target)) return [];
  const raw = fs.readFileSync(target, 'utf8');
  const out: Checkpoint[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Checkpoint);
    } catch {
      break;
    }
  }
  return out;
}

export interface CheckpointReduction {
  jobs: JobCheckpoint[];
  phases: PhaseCheckpoint[];
}

export function reduceCheckpoints(entries: Checkpoint[]): CheckpointReduction {
  const jobs = new Map<string, JobCheckpoint>();
  const phases = new Map<string, PhaseCheckpoint>();
  for (const entry of entries) {
    if (entry.kind === 'job') {
      const prev = jobs.get(entry.jobId) ?? {} as JobCheckpoint;
      jobs.set(entry.jobId, { ...prev, ...entry });
    } else if (entry.kind === 'phase') {
      const key = `${entry.jobId}:${entry.phase}`;
      const prev = phases.get(key) ?? {} as PhaseCheckpoint;
      phases.set(key, { ...prev, ...entry });
    }
  }
  return {
    jobs: Array.from(jobs.values()),
    phases: Array.from(phases.values()),
  };
}
