const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { atomicWriteJsonSync } = require('./atomicIo');
const manifestModule = require('./storyManifest');
const codec = require('./storyCodec');

function readDeletedIds(deletedStoriesFile) {
  if (!fs.existsSync(deletedStoriesFile)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(deletedStoriesFile, 'utf8'));
    return Array.isArray(data.deletedIds) ? data.deletedIds : [];
  } catch {
    return [];
  }
}

function writeDeletedIds(deletedStoriesFile, deletedIds) {
  atomicWriteJsonSync(deletedStoriesFile, { deletedIds, updatedAt: new Date().toISOString() });
}

function listStoryDirs(storiesDir) {
  if (!fs.existsSync(storiesDir)) return [];
  return fs
    .readdirSync(storiesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * Try to decode the story living in dir; return `{ pkg, primary }` or null.
 */
function readStoryPackage(storyDir) {
  const primary = manifestModule.resolveStoryFile(storyDir);
  if (!primary) return null;
  try {
    const raw = fs.readFileSync(primary.abs, 'utf8');
    const parsed = JSON.parse(raw);
    const decoded = codec.safeDecodeStory(parsed);
    if (!decoded.ok) return null;
    return { pkg: decoded.pkg, primary };
  } catch {
    return null;
  }
}

function resolveStoryFolderPath(storiesDir, outputDir) {
  if (typeof outputDir !== 'string' || outputDir.trim().length === 0) {
    throw new Error('Missing outputDir');
  }

  const storiesRoot = path.resolve(storiesDir);
  const normalized = outputDir.trim().replace(/\\/g, '/').replace(/^\/app\//, '');
  if (/^https?:\/\//i.test(normalized) || normalized.includes('\0')) {
    throw new Error('outputDir must reference a local generated story folder');
  }

  let candidate;
  if (path.isAbsolute(normalized)) {
    candidate = path.resolve(normalized);
  } else {
    const withoutPrefix = normalized
      .replace(/^\.\//, '')
      .replace(/^generated-stories\/?/, '');
    const storyDirName = withoutPrefix.split('/').filter(Boolean)[0];
    if (!storyDirName) {
      throw new Error('outputDir must include a story folder name');
    }
    candidate = path.resolve(storiesRoot, storyDirName);
  }

  const relative = path.relative(storiesRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('outputDir must stay within generated-stories');
  }

  return candidate;
}

function rewriteStoryFileEpisodes(storyDir, storyFileAbs, targetStoryId, targetEpisodeNumber, updateManifest) {
  if (!fs.existsSync(storyFileAbs)) return 0;
  const raw = JSON.parse(fs.readFileSync(storyFileAbs, 'utf8'));
  const decoded = codec.safeDecodeStory(raw);
  if (!decoded.ok || decoded.pkg.storyId !== targetStoryId) return 0;

  const storyBody = decoded.pkg.story;
  const beforeCount = Array.isArray(storyBody.episodes) ? storyBody.episodes.length : 0;
  storyBody.episodes = (storyBody.episodes || []).filter((episode) => Number(episode.number) !== targetEpisodeNumber);
  const removed = beforeCount - storyBody.episodes.length;
  if (removed <= 0) return 0;

  const nextRaw = decoded.pkg.detectedSchemaVersion === 1
    ? storyBody
    : {
        ...raw,
        story: storyBody,
        updatedAt: new Date().toISOString(),
      };
  const { sha256, bytes } = atomicWriteJsonSync(storyFileAbs, nextRaw, { pretty: true });
  if (updateManifest) {
    manifestModule.updateManifestForPrimaryRewrite(storyDir, {
      primaryStoryHash: sha256,
      primaryStoryBytes: bytes,
    });
  }
  return removed;
}

function openFolderInDesktop(folderPath) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'explorer'
      : 'xdg-open';
  const result = spawnSync(command, [folderPath], { stdio: 'ignore' });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function registerStoryMutationRoutes(app, { storiesDir, deletedStoriesFile }) {
  app.get('/deleted-stories', (req, res) => {
    res.json({ deletedIds: readDeletedIds(deletedStoriesFile) });
  });

  app.post('/deleted-stories', (req, res) => {
    const { deletedIds } = req.body || {};
    try {
      if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });
      writeDeletedIds(deletedStoriesFile, Array.isArray(deletedIds) ? deletedIds : []);
      res.json({ success: true });
    } catch (error) {
      console.error('[Proxy] Failed to save deleted stories file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/delete-story/:storyId', (req, res) => {
    const { storyId } = req.params;
    if (!fs.existsSync(storiesDir)) return res.status(404).send('Not found');

    let deleted = 0;
    for (const dir of listStoryDirs(storiesDir)) {
      const storyDir = path.join(storiesDir, dir);
      const loaded = readStoryPackage(storyDir);
      if (!loaded) continue;
      if (loaded.pkg.storyId === storyId) {
        fs.rmSync(storyDir, { recursive: true, force: true });
        deleted += 1;
      }
    }

    try {
      const deletedIds = readDeletedIds(deletedStoriesFile);
      if (!deletedIds.includes(storyId)) {
        deletedIds.push(storyId);
        writeDeletedIds(deletedStoriesFile, deletedIds);
        console.log(`[Proxy] Added ${storyId} to filesystem deleted stories list`);
      }
    } catch (error) {
      console.warn('[Proxy] Failed to update deleted stories file:', error);
    }

    res.json({ success: deleted > 0, deleted });
  });

  app.delete('/stories/:storyId/episodes/:episodeNumber', (req, res) => {
    const { storyId } = req.params;
    const episodeNumber = Number(req.params.episodeNumber);
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      return res.status(400).json({ error: 'episodeNumber must be a positive number' });
    }
    if (!fs.existsSync(storiesDir)) return res.status(404).json({ error: 'No generated stories directory found' });

    let removed = 0;
    let rewritten = 0;
    for (const dir of listStoryDirs(storiesDir)) {
      const storyDir = path.join(storiesDir, dir);
      const loaded = readStoryPackage(storyDir);
      if (!loaded || loaded.pkg.storyId !== storyId) continue;

      try {
        const primaryRemoved = rewriteStoryFileEpisodes(storyDir, loaded.primary.abs, storyId, episodeNumber, true);
        if (primaryRemoved > 0) {
          removed += primaryRemoved;
          rewritten += 1;
        }

        const legacyAbs = path.join(storyDir, '08-final-story.json');
        if (legacyAbs !== loaded.primary.abs && fs.existsSync(legacyAbs)) {
          const legacyRemoved = rewriteStoryFileEpisodes(storyDir, legacyAbs, storyId, episodeNumber, false);
          if (legacyRemoved > 0) rewritten += 1;
        }
      } catch (error) {
        console.error(`[Proxy] Error deleting episode ${episodeNumber} for story ${storyId}:`, error);
      }
    }

    res.json({ success: removed > 0, removed, rewritten });
  });

  app.post('/open-story-folder', (req, res) => {
    try {
      const folderPath = resolveStoryFolderPath(storiesDir, req.body?.outputDir);
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return res.status(404).json({ error: 'Story folder not found on local disk' });
      }

      openFolderInDesktop(folderPath);
      res.json({ success: true, path: folderPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Proxy] Failed to open story folder:', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/install-builtin-story', (req, res) => {
    const { story } = req.body || {};
    if (!story || !story.id || !story.title) {
      return res.status(400).json({ error: 'Missing story data' });
    }

    try {
      if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

      const deletedIds = readDeletedIds(deletedStoriesFile);
      if (deletedIds.includes(story.id)) {
        console.log(`[Proxy] Blocked installation of deleted story: ${story.title} (${story.id})`);
        return res.json({ success: false, blocked: true, reason: 'Story was previously deleted' });
      }

      for (const dir of listStoryDirs(storiesDir)) {
        const loaded = readStoryPackage(path.join(storiesDir, dir));
        if (loaded && loaded.pkg.storyId === story.id) {
          return res.json({ success: true, alreadyExists: true, outputDir: `generated-stories/${dir}/` });
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
      const dirName = `${slug}_${timestamp}`;
      const storyDir = path.join(storiesDir, dirName);
      fs.mkdirSync(storyDir, { recursive: true });

      story.isBuiltIn = true;
      story.outputDir = `generated-stories/${dirName}/`;

      // Write the v3 story package.
      const pkg = {
        schemaVersion: 3,
        storyId: story.id,
        createdAt: new Date().toISOString(),
        generator: { pipeline: 'install-builtin' },
        story,
        assets: {},
      };
      const storyFilename = 'story.json';
      const storyFileAbs = path.join(storyDir, storyFilename);
      const { sha256, bytes } = atomicWriteJsonSync(storyFileAbs, pkg, { pretty: true });

      const manifest = manifestModule.buildManifest({
        storyId: story.id,
        storySchemaVersion: 3,
        primaryStoryFile: storyFilename,
        primaryStoryHash: sha256,
        primaryStoryBytes: bytes,
        generator: { pipeline: 'install-builtin' },
      });
      manifestModule.writeManifest(storyDir, manifest);

      console.log(`[Proxy] Installed built-in story: ${story.title} -> ${dirName}`);
      res.json({ success: true, outputDir: `generated-stories/${dirName}/` });
    } catch (error) {
      console.error('[Proxy] Error installing built-in story:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/check-builtin-stories', (req, res) => {
    try {
      const installedIds = new Set();
      const deletedIds = readDeletedIds(deletedStoriesFile);

      for (const dir of listStoryDirs(storiesDir)) {
        const loaded = readStoryPackage(path.join(storiesDir, dir));
        if (loaded) installedIds.add(loaded.pkg.storyId);
      }

      res.json({
        installedIds: Array.from(installedIds),
        deletedIds,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/rename-story', (req, res) => {
    const { storyId, newTitle } = req.body || {};
    if (!fs.existsSync(storiesDir)) return res.status(404).send('Not found');

    let updated = 0;
    for (const dir of listStoryDirs(storiesDir)) {
      const oldDirPath = path.join(storiesDir, dir);
      const loaded = readStoryPackage(oldDirPath);
      if (!loaded) continue;
      if (loaded.pkg.storyId !== storyId) continue;

      try {
        // Update the in-memory story + re-encode with the same schema version
        // as on-disk so we don't accidentally upgrade during a rename.
        const storyBody = loaded.pkg.story;
        storyBody.title = newTitle;

        const raw = JSON.parse(fs.readFileSync(loaded.primary.abs, 'utf8'));
        if (loaded.pkg.detectedSchemaVersion === 1) {
          // Legacy v1 = raw story body written at top level.
          const { sha256, bytes } = atomicWriteJsonSync(loaded.primary.abs, storyBody, { pretty: true });
          manifestModule.updateManifestForPrimaryRewrite(oldDirPath, {
            primaryStoryHash: sha256,
            primaryStoryBytes: bytes,
          });
        } else {
          raw.story = storyBody;
          raw.updatedAt = new Date().toISOString();
          const { sha256, bytes } = atomicWriteJsonSync(loaded.primary.abs, raw, { pretty: true });
          manifestModule.updateManifestForPrimaryRewrite(oldDirPath, {
            primaryStoryHash: sha256,
            primaryStoryBytes: bytes,
          });
        }

        const timestamp = dir.includes('_')
          ? dir.split('_').pop()
          : new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const newSlug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
        const newDirName = `${newSlug}_${timestamp}`;
        const newDirPath = path.join(storiesDir, newDirName);

        if (oldDirPath !== newDirPath) {
          fs.renameSync(oldDirPath, newDirPath);
          console.log(`[Proxy] Renamed story directory: ${dir} -> ${newDirName}`);
        }

        updated += 1;
      } catch (error) {
        console.error(`[Proxy] Error renaming story ${storyId}:`, error);
      }
    }

    res.json({ success: updated > 0 });
  });
}

module.exports = {
  registerStoryMutationRoutes,
  resolveStoryFolderPath,
  rewriteStoryFileEpisodes,
};
