/**
 * Upload generated stories to Vercel Blob Storage.
 *
 * For each story directory containing 08-final-story.json:
 *   1. Extracts all base64 data-URL images from the story JSON
 *   2. Uploads each image as a separate blob on the CDN
 *   3. Rewrites image fields in the story to use CDN URLs
 *   4. Uploads the now-lightweight story JSON
 *
 * Then uploads a stories-manifest.json so the web app can
 * discover and load stories without the proxy server.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... npx ts-node --project tsconfig.worker.json scripts/upload-stories-to-blob.ts
 *
 * Supports incremental uploads -- re-running skips images already in blob.
 */

import * as fs from 'fs';
import * as path from 'path';
import { put, list } from '@vercel/blob';

const STORIES_DIR = path.resolve(__dirname, '..', 'generated-stories');
const BLOB_PREFIX = 'stories';

interface StoryManifestEntry {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  tags: string[];
  author: string;
  coverImageUrl: string | null;
  episodeCount: number;
  blobUrl: string;
}

interface StoriesManifest {
  generatedAt: string;
  stories: StoryManifestEntry[];
}

// ─── Helpers ────────────────────────────────────────────────

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,/;

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mime] || 'png';
}

async function listExistingBlobs(): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of result.blobs) {
      existing.set(blob.pathname, blob.url);
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return existing;
}

async function uploadImageBlob(
  blobPathname: string,
  base64Data: string,
  contentType: string,
  existingBlobs: Map<string, string>,
): Promise<string> {
  const existingUrl = existingBlobs.get(blobPathname);
  if (existingUrl) return existingUrl;

  const buffer = Buffer.from(base64Data, 'base64');
  const blob = await put(blobPathname, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

// ─── Image extraction ───────────────────────────────────────

const LOCALHOST_RE = /^https?:\/\/localhost:\d+\/(generated-stories\/[^\s"]+)/;

let imageCounter = 0;

async function extractAndUploadDataUrl(
  dataUrl: string,
  storyDir: string,
  label: string,
  existingBlobs: Map<string, string>,
): Promise<string | null> {
  const match = dataUrl.match(DATA_URL_RE);
  if (!match) return null;

  const mime = match[1];
  const ext = mimeToExt(mime);
  const base64 = dataUrl.slice(match[0].length);
  if (base64.length < 100) return null;

  imageCounter++;
  const blobPath = `${BLOB_PREFIX}/${storyDir}/images/${label}.${ext}`;
  return uploadImageBlob(blobPath, base64, mime, existingBlobs);
}

async function uploadFileImage(
  imageUrl: string,
  existingBlobs: Map<string, string>,
): Promise<string | null> {
  const match = imageUrl.match(LOCALHOST_RE);
  if (!match) return null;

  const relativePath = match[1];
  const absolutePath = path.resolve(__dirname, '..', relativePath);

  if (!fs.existsSync(absolutePath)) {
    console.warn(`    [MISSING] ${relativePath}`);
    return null;
  }

  const ext = path.extname(absolutePath).toLowerCase().replace('.', '');
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  const blobPath = `${BLOB_PREFIX}/${relativePath.replace('generated-stories/', '')}`;
  const existingUrl = existingBlobs.get(blobPath);
  if (existingUrl) { imageCounter++; return existingUrl; }

  const buffer = fs.readFileSync(absolutePath);
  imageCounter++;
  const blob = await put(blobPath, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

async function rewriteImageField(
  imageValue: string,
  storyDir: string,
  label: string,
  existingBlobs: Map<string, string>,
): Promise<string | null> {
  if (!imageValue) return null;
  if (DATA_URL_RE.test(imageValue)) {
    return extractAndUploadDataUrl(imageValue, storyDir, label, existingBlobs);
  }
  if (LOCALHOST_RE.test(imageValue)) {
    return uploadFileImage(imageValue, existingBlobs);
  }
  return null;
}

const IMAGE_KEYS = new Set(['image', 'situationImage', 'backgroundImage', 'coverImage']);

async function processStoryImages(
  story: any,
  storyDir: string,
  existingBlobs: Map<string, string>,
): Promise<{ story: any; imageCount: number }> {
  let count = 0;
  let labelSeq = 0;

  async function walkAndRewrite(obj: any): Promise<void> {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        await walkAndRewrite(item);
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];

      if (IMAGE_KEYS.has(key) && typeof val === 'string' && val.length > 10) {
        const label = `img-${labelSeq++}`;
        const url = await rewriteImageField(val, storyDir, label, existingBlobs);
        if (url) {
          obj[key] = url;
          count++;
        }
      } else if (val && typeof val === 'object') {
        await walkAndRewrite(val);
      }
    }
  }

  await walkAndRewrite(story);
  return { story, imageCount: count };
}

// ─── Story upload ───────────────────────────────────────────

async function uploadStory(
  dirName: string,
  storyFilePath: string,
  existingBlobs: Map<string, string>,
): Promise<StoryManifestEntry | null> {
  const raw = fs.readFileSync(storyFilePath, 'utf8');
  let story: any;
  try {
    story = JSON.parse(raw);
  } catch {
    console.error(`  [SKIP] Invalid JSON: ${storyFilePath}`);
    return null;
  }

  if (!story.id) {
    console.error(`  [SKIP] No story id: ${storyFilePath}`);
    return null;
  }

  const origSizeMB = Buffer.byteLength(raw, 'utf8') / 1024 / 1024;
  console.log(`  Original size: ${origSizeMB.toFixed(1)} MB`);

  // Extract and upload images
  const { story: processed, imageCount } = await processStoryImages(story, dirName, existingBlobs);
  console.log(`  Extracted ${imageCount} images`);

  // Upload the lightweight story JSON
  const jsonContent = JSON.stringify(processed);
  const newSizeMB = Buffer.byteLength(jsonContent, 'utf8') / 1024 / 1024;
  const blobPathname = `${BLOB_PREFIX}/${dirName}/story.json`;

  console.log(`  [UPLOAD] ${blobPathname} (${newSizeMB.toFixed(2)} MB, was ${origSizeMB.toFixed(1)} MB)`);
  const blob = await put(blobPathname, jsonContent, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  console.log(`  [OK] ${blob.url}`);

  return {
    id: processed.id,
    title: processed.title || 'Untitled',
    genre: processed.genre || '',
    synopsis: processed.synopsis || '',
    tags: processed.tags || [],
    author: processed.author || '',
    coverImageUrl: (processed.coverImage && !DATA_URL_RE.test(processed.coverImage)) ? processed.coverImage : null,
    episodeCount: (processed.episodes || []).length,
    blobUrl: blob.url,
  };
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is required.');
    process.exit(1);
  }

  if (!fs.existsSync(STORIES_DIR)) {
    console.error(`Error: Stories directory not found: ${STORIES_DIR}`);
    process.exit(1);
  }

  console.log('Scanning for stories...');
  const dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const storyDirs: { dirName: string; filePath: string }[] = [];
  for (const dir of dirs) {
    const fp = path.join(STORIES_DIR, dir, '08-final-story.json');
    if (fs.existsSync(fp)) {
      storyDirs.push({ dirName: dir, filePath: fp });
    }
  }

  console.log(`Found ${storyDirs.length} stories with 08-final-story.json\n`);
  if (storyDirs.length === 0) { console.log('Nothing to upload.'); return; }

  console.log('Indexing existing blobs...');
  const existingBlobs = await listExistingBlobs();
  console.log(`Found ${existingBlobs.size} existing blobs\n`);

  const manifestEntries: StoryManifestEntry[] = [];

  for (let i = 0; i < storyDirs.length; i++) {
    const { dirName, filePath } = storyDirs[i];
    console.log(`\n[${i + 1}/${storyDirs.length}] ${dirName}`);

    const entry = await uploadStory(dirName, filePath, existingBlobs);
    if (entry) manifestEntries.push(entry);
  }

  // Deduplicate by story ID (keep the latest)
  const seen = new Map<string, StoryManifestEntry>();
  for (const entry of manifestEntries) seen.set(entry.id, entry);
  const dedupedEntries = Array.from(seen.values());

  console.log(`\n\nUploading stories-manifest.json (${dedupedEntries.length} stories)...`);
  const manifest: StoriesManifest = {
    generatedAt: new Date().toISOString(),
    stories: dedupedEntries,
  };

  const manifestBlob = await put(
    `${BLOB_PREFIX}/stories-manifest.json`,
    JSON.stringify(manifest, null, 2),
    { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true },
  );

  console.log(`Manifest: ${manifestBlob.url}`);
  console.log(`\nDone! ${dedupedEntries.length} stories, ${imageCounter} images uploaded.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
