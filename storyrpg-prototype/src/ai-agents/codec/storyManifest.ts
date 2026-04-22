/**
 * TypeScript twin of `proxy/storyManifest.js` — used by Node-only
 * pipeline / worker code. Browser / react-native builds never need
 * this because writes from non-Node runtimes go through the proxy.
 */

import { atomicWriteJsonSync, sha256Hex } from '../utils/atomicIo';

export const MANIFEST_FILENAME = 'manifest.json';
export const MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ManifestFileEntry {
  sha256: string;
  bytes: number;
  mode?: 'replace' | 'append';
}

export interface StoryManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  storyId: string;
  storySchemaVersion: 1 | 2 | 3;
  primaryStoryFile: string;
  createdAt: string;
  updatedAt: string;
  generator?: { version?: string; pipeline?: string };
  files: Record<string, ManifestFileEntry>;
}

function requireNode<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(name) as T;
}

function nodeModules() {
  const fs = requireNode<typeof import('fs')>('fs');
  const path = requireNode<typeof import('path')>('path');
  return { fs, path };
}

export function manifestPath(storyDir: string): string {
  const { path } = nodeModules();
  return path.join(storyDir, MANIFEST_FILENAME);
}

export function readManifest(storyDir: string): StoryManifest | null {
  const { fs } = nodeModules();
  const mp = manifestPath(storyDir);
  if (!fs.existsSync(mp)) return null;
  try {
    const raw = fs.readFileSync(mp, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoryManifest>;
    if (!parsed || parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) return null;
    if (typeof parsed.storyId !== 'string') return null;
    if (!parsed.files || typeof parsed.files !== 'object') return null;
    if (typeof parsed.primaryStoryFile !== 'string') return null;
    return parsed as StoryManifest;
  } catch {
    return null;
  }
}

export function writeManifest(storyDir: string, manifest: StoryManifest) {
  return atomicWriteJsonSync(manifestPath(storyDir), manifest, { pretty: true });
}

export interface BuildManifestInput {
  storyId: string;
  storySchemaVersion: 1 | 2 | 3;
  primaryStoryFile: string;
  primaryStoryHash: string;
  primaryStoryBytes: number;
  extraFiles?: Record<string, ManifestFileEntry>;
  generator?: { version?: string; pipeline?: string };
}

export function buildManifest(input: BuildManifestInput): StoryManifest {
  const files: Record<string, ManifestFileEntry> = {
    [input.primaryStoryFile]: { sha256: input.primaryStoryHash, bytes: input.primaryStoryBytes },
    ...(input.extraFiles ?? {}),
  };
  const now = new Date().toISOString();
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    storyId: input.storyId,
    storySchemaVersion: input.storySchemaVersion,
    primaryStoryFile: input.primaryStoryFile,
    createdAt: now,
    updatedAt: now,
    generator: input.generator,
    files,
  };
}

export function sha256OfFileSync(absPath: string): { sha256: string; bytes: number } {
  const { fs } = nodeModules();
  const buf = fs.readFileSync(absPath);
  return { sha256: sha256Hex(buf), bytes: buf.length };
}

/**
 * Returns the absolute path to the primary story file after verifying
 * its bytes match the manifest. Throws if manifest, file, or hash is
 * inconsistent.
 */
export function verifyPrimaryFile(storyDir: string, manifest: StoryManifest): string {
  const { fs, path } = nodeModules();
  const entry = manifest.files[manifest.primaryStoryFile];
  if (!entry) throw new Error(`manifest.files["${manifest.primaryStoryFile}"] missing`);
  const abs = path.join(storyDir, manifest.primaryStoryFile);
  if (!fs.existsSync(abs)) throw new Error(`primary story file missing: ${manifest.primaryStoryFile}`);
  const { sha256 } = sha256OfFileSync(abs);
  if (sha256 !== entry.sha256) {
    throw new Error(`primary story file sha256 mismatch (manifest=${entry.sha256} disk=${sha256})`);
  }
  return abs;
}
