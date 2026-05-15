/**
 * Atomic file writes for Node-side TS code (worker + ts-node scripts).
 *
 * Writes to a sibling tmp file, fsyncs, then renames in place. Callers
 * that observe the committed path can trust the bytes are fully flushed
 * and are either the old or the new version — never partial.
 *
 * The browser cannot support atomic writes in the same sense (all
 * writes to the proxy / IndexedDB / blob storage are remote). For that
 * reason this module is gated behind `hasNodeFs()`; in non-Node runtimes
 * callers should go through `pipelineOutputWriter.writeJsonFile` which
 * POSTs to the proxy.
 */

import type { StoryWriteResult } from '../codec/storyCodec';

export interface AtomicWriteResult {
  sha256: string;
  bytes: number;
}

const NODE_ENABLED = typeof process !== 'undefined' && !!(process as unknown as { versions?: { node?: string } })?.versions?.node;

function requireNode<T>(moduleName: string): T {
  // Avoid bundler static analysis; react-native/expo-web should never hit this.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(moduleName) as T;
}

function lazyModules() {
  if (!NODE_ENABLED) {
    throw new Error('atomicIo: Node fs not available in this runtime');
  }
  const fs = requireNode<typeof import('fs')>('fs');
  const path = requireNode<typeof import('path')>('path');
  const crypto = requireNode<typeof import('crypto')>('crypto');
  return { fs, path, crypto };
}

export function hasNodeFs(): boolean {
  return NODE_ENABLED;
}

export function sha256Hex(buffer: Uint8Array | string): string {
  const { crypto } = lazyModules();
  const hash = crypto.createHash('sha256');
  if (typeof buffer === 'string') {
    hash.update(buffer, 'utf8');
  } else {
    hash.update(Buffer.from(buffer));
  }
  return hash.digest('hex');
}

function ensureParentDir(absPath: string) {
  const { fs, path } = lazyModules();
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeTempPath(absPath: string): string {
  const { crypto } = lazyModules();
  const rand = crypto.randomBytes(6).toString('hex');
  return `${absPath}.tmp-${process.pid}-${rand}`;
}

function writeAndFsyncSync(tmpPath: string, buffer: Buffer) {
  const { fs } = lazyModules();
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, buffer);
    try {
      fs.fsyncSync(fd);
    } catch {
      // Best-effort; some filesystems (tmpfs, virtio-fs) reject fsync.
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function atomicWriteFileSync(absPath: string, data: Buffer | Uint8Array | string): AtomicWriteResult {
  if (typeof absPath !== 'string' || absPath.length === 0) {
    throw new Error('atomicWriteFileSync: absPath is required');
  }
  const { fs } = lazyModules();
  const buffer = Buffer.isBuffer(data)
    ? (data as Buffer)
    : typeof data === 'string'
      ? Buffer.from(data, 'utf8')
      : Buffer.from(data);
  ensureParentDir(absPath);
  const tmp = makeTempPath(absPath);
  try {
    writeAndFsyncSync(tmp, buffer);
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { sha256: sha256Hex(buffer), bytes: buffer.length };
}

export interface AtomicJsonOptions {
  pretty?: boolean;
}

export function atomicWriteJsonSync(
  absPath: string,
  value: unknown,
  options: AtomicJsonOptions = {},
): AtomicWriteResult {
  const json = options.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  return atomicWriteFileSync(absPath, Buffer.from(json, 'utf8'));
}

export async function atomicWriteFile(
  absPath: string,
  data: Buffer | Uint8Array | string,
): Promise<AtomicWriteResult> {
  return atomicWriteFileSync(absPath, data);
}

export async function atomicWriteJson(
  absPath: string,
  value: unknown,
  options: AtomicJsonOptions = {},
): Promise<AtomicWriteResult> {
  return atomicWriteJsonSync(absPath, value, options);
}

/**
 * Convenience: atomically write a JSON value and return the result shape
 * the StoryCodec manifest writer expects.
 */
export async function atomicWriteStoryJson(
  absPath: string,
  value: unknown,
): Promise<StoryWriteResult> {
  const { sha256, bytes } = await atomicWriteJson(absPath, value, { pretty: false });
  return { path: absPath, sha256, bytes };
}
