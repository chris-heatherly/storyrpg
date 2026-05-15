/**
 * scripts/migrate-stories.ts
 *
 * Walks `generated-stories/<dir>/` and upgrades each directory to the
 * current schema:
 *   - no `story.json`       → convert `08-final-story.json` to a v3
 *                              `StoryPackageV3` and write both.
 *   - `story.json` at v1/v2  → decode (auto-migrates in the codec) and
 *                              rewrite as v3.
 *   - missing `manifest.json`→ rebuild from the primary file.
 *
 * This script is intentionally conservative:
 *   - It never deletes the legacy `08-final-story.json`; the manifest
 *     carries sha256s for both so the catalog can serve whichever file
 *     is present.
 *   - It never mutates media files or writes into `assets/`. The
 *     content-addressed ingest pass is a v4 concern tracked separately.
 *
 * Usage:
 *   npx tsx scripts/migrate-stories.ts               # migrate every story dir
 *   npx tsx scripts/migrate-stories.ts path/to/dir   # migrate a specific dir
 *   npx tsx scripts/migrate-stories.ts --dry-run     # report plan, don't write
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  decodeStory,
  encodeStory,
  StoryValidationError,
  type StoryPackageV3,
} from '../src/ai-agents/codec/storyCodec';
import { atomicWriteJsonSync } from '../src/ai-agents/utils/atomicIo';
import {
  buildManifest,
  sha256OfFileSync,
  writeManifest,
  type StoryManifest,
} from '../src/ai-agents/codec/storyManifest';

const LEGACY_FILE = '08-final-story.json';
const PRIMARY_FILE = 'story.json';
const MANIFEST_FILE = 'manifest.json';

interface MigrationReport {
  dir: string;
  action: 'already-v3' | 'migrated' | 'rebuilt-manifest' | 'skipped' | 'error';
  fromVersion?: number | null;
  error?: string;
}

function readJsonIfExists(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function migrateDir(storyDirAbs: string, dryRun: boolean): MigrationReport {
  const primaryPath = path.join(storyDirAbs, PRIMARY_FILE);
  const legacyPath = path.join(storyDirAbs, LEGACY_FILE);
  const manifestPath = path.join(storyDirAbs, MANIFEST_FILE);

  const primary = readJsonIfExists(primaryPath);
  const legacy = readJsonIfExists(legacyPath);

  const source = primary ?? legacy;
  if (!source) {
    return { dir: storyDirAbs, action: 'skipped' };
  }

  let pkgV3: StoryPackageV3;
  let detectedVersion: number | null = null;
  try {
    const decoded = decodeStory(source);
    detectedVersion = decoded.detectedSchemaVersion;
    if (decoded.detectedSchemaVersion === 3 && fs.existsSync(manifestPath)) {
      return { dir: storyDirAbs, action: 'already-v3', fromVersion: 3 };
    }
    pkgV3 = encodeStory(decoded.story, {
      targetVersion: 3,
      createdAt: decoded.createdAt,
      generator: decoded.generator,
      assets: decoded.assets,
    }) as StoryPackageV3;
  } catch (err) {
    return {
      dir: storyDirAbs,
      action: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (dryRun) {
    return {
      dir: storyDirAbs,
      action: detectedVersion === 3 ? 'rebuilt-manifest' : 'migrated',
      fromVersion: detectedVersion,
    };
  }

  atomicWriteJsonSync(primaryPath, pkgV3);

  const { sha256, bytes } = sha256OfFileSync(primaryPath);
  const manifest: StoryManifest = buildManifest({
    storyId: pkgV3.storyId,
    storySchemaVersion: 3,
    primaryStoryFile: PRIMARY_FILE,
    primaryStoryHash: sha256,
    primaryStoryBytes: bytes,
    generator: pkgV3.generator,
  });
  writeManifest(storyDirAbs, manifest);

  return {
    dir: storyDirAbs,
    action: detectedVersion === 3 ? 'rebuilt-manifest' : 'migrated',
    fromVersion: detectedVersion,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positionals = args.filter((a) => !a.startsWith('--'));
  const repoRoot = path.resolve(__dirname, '..');
  const generatedRoot = path.join(repoRoot, 'generated-stories');

  let dirs: string[];
  if (positionals.length > 0) {
    dirs = positionals.map((p) => path.resolve(p));
  } else {
    if (!fs.existsSync(generatedRoot)) {
      console.error(`No generated-stories/ directory at ${generatedRoot}`);
      process.exit(1);
    }
    dirs = fs
      .readdirSync(generatedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(generatedRoot, entry.name));
  }

  const reports: MigrationReport[] = [];
  for (const dir of dirs) {
    try {
      reports.push(migrateDir(dir, dryRun));
    } catch (err) {
      reports.push({
        dir,
        action: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const byAction: Record<string, number> = {};
  for (const r of reports) {
    byAction[r.action] = (byAction[r.action] || 0) + 1;
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}Migration report (${reports.length} dirs):`);
  for (const r of reports) {
    const prefix = r.action === 'error' ? '[ERR]' : '[ok]';
    const from = r.fromVersion != null ? ` (v${r.fromVersion})` : '';
    console.log(`  ${prefix} ${r.action}${from}  ${path.basename(r.dir)}${r.error ? `  — ${r.error}` : ''}`);
  }
  console.log('\nSummary:', byAction);

  if (reports.some((r) => r.action === 'error')) {
    process.exit(2);
  }
}

main();
