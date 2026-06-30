import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Storage } from '@google-cloud/storage';
import { decodeStory } from '../src/ai-agents/codec/storyCodec';

type UploadMode = 'latest' | 'all';

const DEFAULT_UPLOAD_CONCURRENCY = Number(process.env.GCS_UPLOAD_CONCURRENCY || 4);
const DEFAULT_UPLOAD_RETRIES = Number(process.env.GCS_UPLOAD_RETRIES || 3);

type CatalogEntry = {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  tags?: string[];
  author?: string;
  episodeCount?: number;
  /** Proxy-style path (we can later redirect/proxy to GCS). */
  outputDir: string; // "generated-stories/<runDir>/"
  /** Proxy-style path to the story JSON */
  storyPath: string; // "generated-stories/<runDir>/story.json"
  /** Optional proxy-style cover image path */
  coverImage?: string;
  updatedAt?: string;
};

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    [
      'Usage:',
      '  ts-node scripts/upload-stories-to-gcs.ts --latest',
      '  ts-node scripts/upload-stories-to-gcs.ts --all',
      '',
      'Env vars:',
      '  GCS_BUCKET_NAME=prod-story-rpg',
      "  GCS_STORIES_PREFIX=stories (optional; default 'stories')",
      '',
      'Auth:',
      '  gcloud auth application-default login',
    ].join('\n'),
  );
  process.exit(1);
}

function parseArgs(): { mode: UploadMode } {
  const args = process.argv.slice(2);
  if (args.includes('--latest')) return { mode: 'latest' };
  if (args.includes('--all')) return { mode: 'all' };
  usageAndExit('Missing flag: --latest or --all');
}

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) usageAndExit(`Missing env var: ${name}`);
  return v.trim();
}

function getStoriesDir(): string {
  // scripts/ is inside storyrpg-prototype/
  return path.resolve(process.cwd(), 'generated-stories');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency || 1));
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      await handler(items[current], current);
    }
  });

  await Promise.all(workers);
}

function listRunDirs(storiesDir: string): Array<{ dirName: string; mtimeMs: number }> {
  if (!fs.existsSync(storiesDir)) return [];
  const entries = fs.readdirSync(storiesDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = path.join(storiesDir, e.name);
      const st = fs.statSync(full);
      return { dirName: e.name, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs;
}

function readStoryJson(storiesDir: string, runDir: string): any | null {
  const storyFile = path.join(storiesDir, runDir, 'story.json');
  if (!fs.existsSync(storyFile)) return null;
  try {
    return decodeStory(JSON.parse(fs.readFileSync(storyFile, 'utf8'))).story;
  } catch {
    return null;
  }
}

function buildCatalogEntry(runDir: string, story: any, updatedAt: string): CatalogEntry | null {
  if (!story?.id || !story?.title) return null;
  const coverImage = typeof story.coverImage === 'string' ? story.coverImage : undefined;

  return {
    id: story.id,
    title: story.title,
    genre: story.genre || '',
    synopsis: story.synopsis || '',
    tags: Array.isArray(story.tags) ? story.tags : undefined,
    author: story.author || undefined,
    episodeCount: Array.isArray(story.episodes) ? story.episodes.length : undefined,
    outputDir: `generated-stories/${runDir}/`,
    storyPath: `generated-stories/${runDir}/story.json`,
    coverImage,
    updatedAt,
  };
}

async function uploadDirectoryRecursive(storage: Storage, bucketName: string, localDir: string, bucketPrefix: string): Promise<void> {
  const bucket = storage.bucket(bucketName);

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };

  const files = walk(localDir);
  if (files.length === 0) return;

  const concurrency = Number.isFinite(DEFAULT_UPLOAD_CONCURRENCY) ? DEFAULT_UPLOAD_CONCURRENCY : 4;
  const retries = Number.isFinite(DEFAULT_UPLOAD_RETRIES) ? DEFAULT_UPLOAD_RETRIES : 3;
  const logEvery = 25;
  let completed = 0;

  await runWithConcurrency(files, concurrency, async (absPath, index) => {
    const rel = path.relative(localDir, absPath).replace(/\\/g, '/');
    const dest = `${bucketPrefix}/${rel}`.replace(/\/+/g, '/');

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Using non-resumable uploads here is much less likely to hit TLS/connectivity issues
        // when running many parallel uploads from Node locally.
        await bucket.upload(absPath, {
          destination: dest,
          resumable: false,
          validation: 'crc32c',
          metadata: {
            cacheControl: rel.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable',
          },
        });
        completed += 1;
        if (completed % logEvery === 0 || completed === files.length) {
          console.log(`[upload-stories-to-gcs] Progress: ${completed}/${files.length} files uploaded...`);
        }
        return;
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        const isLast = attempt === retries;
        console.warn(
          `[upload-stories-to-gcs] Upload failed (${attempt}/${retries}) ${rel} -> ${dest}: ${msg}`,
        );
        if (isLast) throw err;
        await sleep(250 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250));
      }
    }
  });
}

async function main() {
  const { mode } = parseArgs();
  const bucketName = mustGetEnv('GCS_BUCKET_NAME');
  const prefix = (process.env.GCS_STORIES_PREFIX || 'stories').replace(/^\/+|\/+$/g, '');

  const storiesDir = getStoriesDir();
  const runDirs = listRunDirs(storiesDir);
  const selected = mode === 'latest' ? runDirs.slice(0, 1) : runDirs;

  if (selected.length === 0) {
    console.log(`[upload-stories-to-gcs] No story output directories found at ${storiesDir}`);
    return;
  }

  const storage = new Storage();

  const catalog: CatalogEntry[] = [];
  for (const { dirName } of selected) {
    const localRunDir = path.join(storiesDir, dirName);
    const story = readStoryJson(storiesDir, dirName);
    if (!story) {
      console.warn(`[upload-stories-to-gcs] Skipping ${dirName} (missing or invalid story.json; run scripts/migrate-stories.ts for legacy-only directories)`);
      continue;
    }

    console.log(`[upload-stories-to-gcs] Uploading ${dirName}...`);
    await uploadDirectoryRecursive(storage, bucketName, localRunDir, `${prefix}/${dirName}`);

    const updatedAt = new Date().toISOString();
    const entry = buildCatalogEntry(dirName, story, updatedAt);
    if (entry) catalog.push(entry);
  }

  // If uploading all, build catalog from all local dirs (more complete).
  const catalogSource = mode === 'all' ? runDirs : selected;
  const fullCatalog: CatalogEntry[] = [];
  for (const { dirName, mtimeMs } of catalogSource) {
    const story = readStoryJson(storiesDir, dirName);
    if (!story) continue;
    const entry = buildCatalogEntry(dirName, story, new Date(mtimeMs).toISOString());
    if (entry) fullCatalog.push(entry);
  }

  const catalogPath = `${prefix}/catalog.json`;
  const bucket = storage.bucket(bucketName);
  await bucket.file(catalogPath).save(JSON.stringify({ stories: fullCatalog }, null, 2), {
    contentType: 'application/json; charset=utf-8',
    resumable: false,
    metadata: { cacheControl: 'no-cache' },
  });

  console.log(`[upload-stories-to-gcs] Uploaded ${selected.length} run(s) to gs://${bucketName}/${prefix}/`);
  console.log(`[upload-stories-to-gcs] Wrote catalog to gs://${bucketName}/${catalogPath}`);
}

main().catch((err) => {
  console.error('[upload-stories-to-gcs] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
