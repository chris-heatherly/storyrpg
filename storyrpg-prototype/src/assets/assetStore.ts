/**
 * assetStore — write side of the content-addressed `assets/` directory.
 *
 *   ingestBuffer(storyDirAbs, buffer, mimeType, kind)  →  AssetRef
 *   ingestFile(storyDirAbs, srcPath, mimeType, kind)   →  AssetRef
 *
 * Hashes the payload with sha256, places it at `assets/<prefix>/<sha>.<ext>`
 * inside the story directory (atomic write, no-op if the file already
 * exists), and returns a fully populated AssetRef.
 *
 * The store is Node-only — browser / react-native callers go through
 * the proxy via the existing /write-file POST; the ingest happens
 * server-side where fs is available.
 */

import type { AssetKind, AssetRef } from './assetRef';
import { atomicWriteFileSync, sha256Hex, hasNodeFs } from '../ai-agents/utils/atomicIo';

function nodeRequire<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(name) as T;
}

function nodeModules() {
  if (!hasNodeFs()) {
    throw new Error('assetStore: Node fs not available in this runtime');
  }
  const fs = nodeRequire<typeof import('fs')>('fs');
  const path = nodeRequire<typeof import('path')>('path');
  return { fs, path };
}

function extensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('json')) return 'json';
  return 'bin';
}

export interface IngestOptions {
  kind: AssetKind;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  origin?: { provider?: string; model?: string; seed?: number; promptSha256?: string };
}

export function ingestBuffer(storyDirAbs: string, buffer: Uint8Array | Buffer, options: IngestOptions): AssetRef {
  const { fs, path } = nodeModules();
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const sha = sha256Hex(buf);
  const prefix = sha.slice(0, 2);
  const ext = extensionForMime(options.mimeType);
  const relPath = `assets/${prefix}/${sha}.${ext}`;
  const abs = path.join(storyDirAbs, relPath);

  if (!fs.existsSync(abs)) {
    atomicWriteFileSync(abs, buf);
  }

  return {
    kind: options.kind,
    sha256: sha,
    mimeType: options.mimeType,
    bytes: buf.length,
    width: options.width,
    height: options.height,
    durationMs: options.durationMs,
    origin: options.origin,
  };
}

export function ingestFile(storyDirAbs: string, sourcePath: string, options: IngestOptions): AssetRef {
  const { fs } = nodeModules();
  const buffer = fs.readFileSync(sourcePath);
  return ingestBuffer(storyDirAbs, buffer, options);
}

export function assetAbsolutePath(storyDirAbs: string, ref: AssetRef): string {
  const { path } = nodeModules();
  const prefix = ref.sha256.slice(0, 2);
  const ext = extensionForMime(ref.mimeType);
  return path.join(storyDirAbs, 'assets', prefix, `${ref.sha256}.${ext}`);
}

export function assetExistsOnDisk(storyDirAbs: string, ref: AssetRef): boolean {
  const { fs } = nodeModules();
  return fs.existsSync(assetAbsolutePath(storyDirAbs, ref));
}
