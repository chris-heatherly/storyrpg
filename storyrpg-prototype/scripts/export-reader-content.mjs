import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'generated-stories');
const outputRoot = path.resolve(root, process.env.READER_CONTENT_OUTPUT_DIR || 'public/reader-content');

const allowedExtensions = new Set([
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp3',
  '.m4a',
  '.wav',
  '.mp4',
  '.webm',
  '.vtt',
]);

const deniedPathParts = [
  '.generation-jobs',
  '.ref-images',
  'checkpoints',
  'diagnostics',
  'pipeline-errors',
  'pipeline-memories',
  'loras',
  'prompts',
  'source-documents',
  'uploads',
];

function isAllowedContentFile(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  if (deniedPathParts.some((part) => normalized.includes(part))) return false;
  if (normalized.endsWith('.prompt.txt')) return false;
  return allowedExtensions.has(path.extname(normalized).toLowerCase());
}

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function walk(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(abs, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, abs));
    }
  }
  return files;
}

async function readJsonIfStory(absPath) {
  try {
    const raw = JSON.parse(await fs.readFile(absPath, 'utf8'));
    const story = raw?.story || raw;
    if (!story?.id || !story?.title || !Array.isArray(story?.episodes)) return null;
    return {
      id: story.id,
      title: story.title,
      genre: story.genre || 'unknown',
      synopsis: story.synopsis || '',
      tags: story.tags,
      author: story.author,
      episodeCount: story.episodes.length,
      coverImageUrl: typeof story.coverImage === 'string' ? story.coverImage : null,
    };
  } catch {
    return null;
  }
}

async function copySanitizedContentFile(source, dest) {
  if (path.extname(source).toLowerCase() !== '.json') {
    await fs.copyFile(source, dest);
    return;
  }

  const text = await fs.readFile(source, 'utf8');
  try {
    const raw = JSON.parse(text);
    const story = raw?.story || raw;
    if (!story?.id || !story?.title || !Array.isArray(story?.episodes)) {
      await fs.writeFile(dest, text);
      return;
    }

    const sanitizedStory = { ...story };
    delete sanitizedStory.generator;
    delete sanitizedStory.diagnostics;
    delete sanitizedStory.checkpoints;

    if (raw?.story) {
      const sanitizedPackage = { ...raw, story: sanitizedStory };
      delete sanitizedPackage.generator;
      delete sanitizedPackage.diagnostics;
      delete sanitizedPackage.checkpoints;
      await fs.writeFile(dest, `${JSON.stringify(sanitizedPackage, null, 2)}\n`);
      return;
    }

    await fs.writeFile(dest, `${JSON.stringify(sanitizedStory, null, 2)}\n`);
  } catch {
    await fs.writeFile(dest, text);
  }
}

async function main() {
  await ensureCleanDir(outputRoot);

  try {
    await fs.access(sourceRoot);
  } catch {
    await fs.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({ stories: [] }, null, 2)}\n`);
    console.log(`No generated-stories directory found; wrote empty reader manifest to ${path.relative(root, outputRoot)}`);
    return;
  }

  const storyDirs = await fs.readdir(sourceRoot, { withFileTypes: true });
  const manifest = { stories: [] };

  for (const dirent of storyDirs) {
    if (!dirent.isDirectory()) continue;
    const storyDir = path.join(sourceRoot, dirent.name);
    const files = await walk(storyDir);
    let primaryStory = null;

    for (const rel of files) {
      if (!isAllowedContentFile(rel)) continue;
      const source = path.join(storyDir, rel);
      const dest = path.join(outputRoot, dirent.name, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await copySanitizedContentFile(source, dest);

      if (!primaryStory && path.extname(rel).toLowerCase() === '.json') {
        const candidate = await readJsonIfStory(source);
        if (candidate) {
          primaryStory = {
            ...candidate,
            blobUrl: `/reader-content/${dirent.name}/${rel.split(path.sep).join('/')}`,
          };
        }
      }
    }

    if (primaryStory) {
      manifest.stories.push(primaryStory);
    }
  }

  manifest.stories.sort((a, b) => a.title.localeCompare(b.title));
  await fs.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Exported ${manifest.stories.length} reader story package(s) to ${path.relative(root, outputRoot)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
