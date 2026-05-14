/**
 * Story manifest — the small per-story JSON file that describes what
 * is in `generated-stories/<slug>/`. The catalog reads the manifest
 * before the full story, so partial / mid-write story.json files
 * never get served (sha256 mismatch == skip or 500).
 *
 * Shape:
 *   {
 *     schemaVersion: 1,
 *     storyId: string,
 *     createdAt: string,          // ISO 8601
 *     updatedAt: string,
 *     files: {                     // all authoritative artefacts in the dir
 *       "08-final-story.json":    { sha256, bytes },
 *       "story.json":             { sha256, bytes },
 *       "checkpoints.jsonl":      { sha256, bytes, mode: "append" },
 *     },
 *     primaryStoryFile: string,    // filename within files map
 *     storySchemaVersion: 1|2|3    // schemaVersion of the story itself
 *   }
 *
 * The codec is the source of truth for the story contents; the
 * manifest is the source of truth for which files belong to the story
 * and whether the on-disk bytes match what we expect.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJsonSync } = require('./atomicIo');

const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_SCHEMA_VERSION = 1;

function sha256OfFileSync(absPath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(absPath);
  hash.update(buffer);
  return { sha256: hash.digest('hex'), bytes: buffer.length };
}

function manifestPath(storyDir) {
  return path.join(storyDir, MANIFEST_FILENAME);
}

function readManifest(storyDir) {
  const mp = manifestPath(storyDir);
  if (!fs.existsSync(mp)) return null;
  try {
    const raw = fs.readFileSync(mp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) return null;
    if (typeof parsed.storyId !== 'string') return null;
    if (!parsed.files || typeof parsed.files !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeManifest(storyDir, manifest) {
  const target = manifestPath(storyDir);
  return atomicWriteJsonSync(target, manifest, { pretty: true });
}

/**
 * Verify that the on-disk bytes for the primary story file match
 * what's recorded in the manifest. Returns the absolute file path
 * on success, throws on mismatch.
 */
function verifyPrimaryFile(storyDir, manifest) {
  const primary = manifest.primaryStoryFile;
  if (!primary) throw new Error('manifest.primaryStoryFile is missing');
  const entry = manifest.files[primary];
  if (!entry || typeof entry.sha256 !== 'string') {
    throw new Error(`manifest.files["${primary}"] is missing or malformed`);
  }
  const abs = path.join(storyDir, primary);
  if (!fs.existsSync(abs)) throw new Error(`primary story file "${primary}" is missing on disk`);
  const { sha256 } = sha256OfFileSync(abs);
  if (sha256 !== entry.sha256) {
    throw new Error(`primary story file "${primary}" sha256 mismatch (manifest=${entry.sha256} disk=${sha256})`);
  }
  return abs;
}

/**
 * Build a manifest for a directory whose primary story file is
 * already written. Used on the write side (pipelineOutputWriter) and
 * by the migration tool when upgrading existing stories.
 */
function buildManifest({ storyId, storySchemaVersion, primaryStoryFile, primaryStoryHash, primaryStoryBytes, extraFiles, generator }) {
  const files = { [primaryStoryFile]: { sha256: primaryStoryHash, bytes: primaryStoryBytes } };
  if (extraFiles && typeof extraFiles === 'object') {
    for (const [name, entry] of Object.entries(extraFiles)) {
      files[name] = entry;
    }
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    storyId,
    storySchemaVersion,
    primaryStoryFile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generator: generator || {},
    files,
  };
}

/**
 * Resolve the primary story file inside a generated-stories subdir.
 * Honours an on-disk manifest if present, otherwise falls back to
 * `story.json` and then the legacy `08-final-story.json`. Returns
 * `null` when neither is found so callers can fail gracefully.
 */
function resolveStoryFile(storyDir) {
  const manifest = readManifest(storyDir);
  if (manifest) {
    const abs = path.join(storyDir, manifest.primaryStoryFile);
    if (fs.existsSync(abs)) return { filename: manifest.primaryStoryFile, abs, manifest };
  }
  const modern = path.join(storyDir, 'story.json');
  if (fs.existsSync(modern)) return { filename: 'story.json', abs: modern, manifest: null };
  const legacy = path.join(storyDir, '08-final-story.json');
  if (fs.existsSync(legacy)) return { filename: '08-final-story.json', abs: legacy, manifest: null };
  return null;
}

/**
 * Update an existing manifest's primary-file hash/bytes after a
 * rewrite, preserving other file entries.
 */
function updateManifestForPrimaryRewrite(storyDir, { primaryStoryHash, primaryStoryBytes }) {
  const manifest = readManifest(storyDir);
  if (!manifest) return null;
  const entry = manifest.files[manifest.primaryStoryFile] || {};
  manifest.files[manifest.primaryStoryFile] = {
    ...entry,
    sha256: primaryStoryHash,
    bytes: primaryStoryBytes,
  };
  manifest.updatedAt = new Date().toISOString();
  writeManifest(storyDir, manifest);
  return manifest;
}

module.exports = {
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_VERSION,
  manifestPath,
  readManifest,
  writeManifest,
  verifyPrimaryFile,
  buildManifest,
  sha256OfFileSync,
  resolveStoryFile,
  updateManifestForPrimaryRewrite,
};
