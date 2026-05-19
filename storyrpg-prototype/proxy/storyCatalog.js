const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');

const codec = require('./storyCodec');
const manifestModule = require('./storyManifest');
const {
  getStoryStorageMode,
  getGcsBucketName,
  getGcsStoriesPrefix,
  getGcsPublicBaseUrl,
} = require('./gcsConfig');

function createStoryCatalog(storiesDir, port) {
  const storyJsonCache = new Map();
  const LEGACY_STORY_FILENAME = '08-final-story.json';
  const MODERN_STORY_FILENAME = 'story.json';
  const CATALOG_OBJECT = 'catalog.json';

  let gcsCatalogCache = { loadedAtMs: 0, entries: null };
  const GCS_CATALOG_CACHE_TTL_MS = 10_000;

  function listStoryDirectories() {
    if (!fs.existsSync(storiesDir)) return [];
    return fs.readdirSync(storiesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort()
      .reverse();
  }

  function resolvePrimaryStoryFile(dirAbs) {
    const manifest = manifestModule.readManifest(dirAbs);
    if (manifest) {
      const primary = path.join(dirAbs, manifest.primaryStoryFile);
      if (fs.existsSync(primary)) return { filename: manifest.primaryStoryFile, abs: primary, manifest };
    }
    // Fallback order: modern → legacy. Anything else = no story here.
    for (const name of [MODERN_STORY_FILENAME, LEGACY_STORY_FILENAME]) {
      const abs = path.join(dirAbs, name);
      if (fs.existsSync(abs)) return { filename: name, abs, manifest: null };
    }
    return null;
  }

  function getImageArtifactSummary(dirAbs) {
    const has = (target) => fs.existsSync(path.join(dirAbs, target));
    const imagesDir = path.join(dirAbs, 'images');
    let hasSeasonReferences =
      has('style-bible')
      || has('visual-planning')
      || has('season-visual-bible.json');
    let hasEpisodeArt =
      has('asset-registry.jsonl')
      || has('image-manifest.json')
      || has('08-registry-state.json')
      || fs.existsSync(dirAbs) && fs.readdirSync(dirAbs).some((name) => /^08a-beat-resume-.*\.json$/.test(name));

    if (fs.existsSync(imagesDir)) {
      for (const entry of fs.readdirSync(imagesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === 'job-reference-previews') hasSeasonReferences = true;
          if (entry.name !== 'prompts' && entry.name !== 'job-reference-previews') hasEpisodeArt = true;
          continue;
        }
        if (!entry.isFile()) continue;
        if (/^(ref_|style-bible-)/.test(entry.name)) hasSeasonReferences = true;
        else hasEpisodeArt = true;
      }

      const promptsDir = path.join(imagesDir, 'prompts');
      if (fs.existsSync(promptsDir)) {
        for (const entry of fs.readdirSync(promptsDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (/^(ref_|style-bible-)/.test(entry.name)) hasSeasonReferences = true;
          else hasEpisodeArt = true;
        }
      }
    }

    return { hasSeasonReferences, hasEpisodeArt };
  }

  function stripGeneratedStoryTimestamp(dirName) {
    return dirName.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, '');
  }

  function getImageArtifactSummaryForSlug(dirName) {
    const slugBase = stripGeneratedStoryTimestamp(dirName);
    let summary = { hasSeasonReferences: false, hasEpisodeArt: false };
    for (const candidate of listStoryDirectories()) {
      if (stripGeneratedStoryTimestamp(candidate) !== slugBase) continue;
      const source = getImageArtifactSummary(path.join(storiesDir, candidate));
      summary = {
        hasSeasonReferences: summary.hasSeasonReferences || source.hasSeasonReferences,
        hasEpisodeArt: summary.hasEpisodeArt || source.hasEpisodeArt,
      };
    }
    return summary;
  }

  function getStoryRecord(dirName) {
    const dirAbs = path.join(storiesDir, dirName);
    const primary = resolvePrimaryStoryFile(dirAbs);
    if (!primary) return null;

    const stats = fs.statSync(primary.abs);
    const cacheKey = primary.abs;
    const cached = storyJsonCache.get(cacheKey);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return {
        pkg: cached.pkg,
        rawStory: cached.pkg?.story,
        dirName,
        storyFile: primary.abs,
        primaryFilename: primary.filename,
        mtimeMs: cached.mtimeMs,
        manifestVerified: cached.manifestVerified,
        error: cached.error || null,
      };
    }

    let raw;
    try {
      raw = fs.readFileSync(primary.abs, 'utf8');
    } catch (err) {
      const errRecord = {
        pkg: null,
        rawStory: null,
        dirName,
        storyFile: primary.abs,
        primaryFilename: primary.filename,
        mtimeMs: stats.mtimeMs,
        manifestVerified: false,
        error: { kind: 'read_failed', message: err.message },
      };
      console.error(`[StoryCatalog] Failed to read ${dirName}/${primary.filename}: ${err.message}`);
      storyJsonCache.set(cacheKey, { pkg: null, mtimeMs: stats.mtimeMs, manifestVerified: false, error: errRecord.error });
      return errRecord;
    }

    let manifestVerified = false;
    if (primary.manifest) {
      const entry = primary.manifest.files[primary.filename];
      if (entry && typeof entry.sha256 === 'string') {
        const onDiskSha = crypto.createHash('sha256').update(raw).digest('hex');
        if (onDiskSha !== entry.sha256) {
          const err = { kind: 'manifest_sha_mismatch', message: `manifest=${entry.sha256} disk=${onDiskSha}` };
          console.error(`[StoryCatalog] ${dirName}/${primary.filename} sha256 mismatch (${err.message}) — refusing to serve until next write`);
          storyJsonCache.set(cacheKey, { pkg: null, mtimeMs: stats.mtimeMs, manifestVerified: false, error: err });
          return {
            pkg: null, rawStory: null, dirName,
            storyFile: primary.abs, primaryFilename: primary.filename,
            mtimeMs: stats.mtimeMs, manifestVerified: false, error: err,
          };
        }
        manifestVerified = true;
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const e = { kind: 'invalid_json', message: err.message };
      console.error(`[StoryCatalog] ${dirName}/${primary.filename} is not valid JSON: ${err.message}`);
      storyJsonCache.set(cacheKey, { pkg: null, mtimeMs: stats.mtimeMs, manifestVerified, error: e });
      return {
        pkg: null, rawStory: null, dirName,
        storyFile: primary.abs, primaryFilename: primary.filename,
        mtimeMs: stats.mtimeMs, manifestVerified, error: e,
      };
    }

    const decoded = codec.safeDecodeStory(parsed);
    if (!decoded.ok) {
      const issues = Array.isArray(decoded.error?.issues)
        ? decoded.error.issues.map((i) => `${i.path}: ${i.message}`)
        : [{ path: '(root)', message: decoded.error?.message || 'unknown' }];
      const e = { kind: 'codec_validation_failed', message: issues.map((i) => `${i.path}: ${i.message}`).join('; '), issues };
      console.error(`[StoryCatalog] ${dirName}/${primary.filename} failed codec validation: ${e.message}`);
      storyJsonCache.set(cacheKey, { pkg: null, mtimeMs: stats.mtimeMs, manifestVerified, error: e });
      return {
        pkg: null, rawStory: null, dirName,
        storyFile: primary.abs, primaryFilename: primary.filename,
        mtimeMs: stats.mtimeMs, manifestVerified, error: e,
      };
    }

    const pkg = decoded.pkg;
    if (!Array.isArray(pkg.story?.episodes) || pkg.story.episodes.length === 0) {
      const e = {
        kind: 'empty_story',
        message: 'story has no episodes; likely a failed partial generation package',
      };
      console.error(`[StoryCatalog] ${dirName}/${primary.filename} has no episodes — refusing to list as playable`);
      storyJsonCache.set(cacheKey, { pkg: null, mtimeMs: stats.mtimeMs, manifestVerified, error: e });
      return {
        pkg: null, rawStory: null, dirName,
        storyFile: primary.abs, primaryFilename: primary.filename,
        mtimeMs: stats.mtimeMs, manifestVerified, error: e,
      };
    }

    storyJsonCache.set(cacheKey, { pkg, mtimeMs: stats.mtimeMs, manifestVerified });
    return {
      pkg,
      rawStory: pkg.story,
      dirName,
      storyFile: primary.abs,
      primaryFilename: primary.filename,
      mtimeMs: stats.mtimeMs,
      manifestVerified,
      error: null,
    };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normaliseEpisodeOffset(record) {
    const episodes = record.pkg?.story?.episodes;
    if (!Array.isArray(episodes) || episodes.length < 2) return record;

    const numbers = episodes
      .map((episode) => Number(episode?.number))
      .filter((number) => Number.isFinite(number) && number > 0);
    if (numbers.length !== episodes.length) return record;

    const minNumber = Math.min(...numbers);
    if (minNumber <= 1) return record;

    const pkg = cloneJson(record.pkg);
    pkg.story.episodes = pkg.story.episodes
      .map((episode) => ({
        ...episode,
        number: Math.max(1, Number(episode.number) - minNumber + 1),
      }))
      .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));

    return {
      ...record,
      pkg,
      rawStory: pkg.story,
      sourceRecords: [record],
      episodeNumbersNormalized: true,
    };
  }

  function mergeContinuationRecords(records) {
    const sorted = [...records].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const newest = sorted[0];
    const newestEpisodes = newest.pkg?.story?.episodes;
    if (!Array.isArray(newestEpisodes) || newestEpisodes.length === 0) return newest;

    // A multi-episode package should be internally complete. Some resume jobs
    // have been saved with an offset (2,3 instead of 1,2), so normalize those
    // labels without pulling in stale older directories.
    if (newestEpisodes.length > 1) {
      return normaliseEpisodeOffset(newest);
    }

    const newestEpisodeNumber = Number(newestEpisodes[0]?.number || 1);
    if (!Number.isFinite(newestEpisodeNumber) || newestEpisodeNumber <= 1) {
      return newest;
    }

    const episodesByNumber = new Map();
    const sourceRecords = new Set([newest]);
    for (const record of sorted) {
      const episodes = record.pkg?.story?.episodes;
      if (!Array.isArray(episodes)) continue;
      for (const episode of episodes) {
        const number = Number(episode?.number);
        if (!Number.isFinite(number) || number < 1 || number > newestEpisodeNumber) continue;
        if (episodesByNumber.has(number)) continue;
        episodesByNumber.set(number, cloneJson(episode));
        sourceRecords.add(record);
      }
    }

    if (!episodesByNumber.has(newestEpisodeNumber) || episodesByNumber.size <= 1) {
      return newest;
    }

    const pkg = cloneJson(newest.pkg);
    pkg.story.episodes = Array.from(episodesByNumber.entries())
      .sort(([a], [b]) => a - b)
      .map(([, episode]) => episode);

    const coverSource = sorted.find((record) => record.pkg?.story?.coverImage);
    if (coverSource?.pkg?.story?.coverImage && !pkg.story.coverImage) {
      pkg.story.coverImage = coverSource.pkg.story.coverImage;
    }

    return {
      ...newest,
      pkg,
      rawStory: pkg.story,
      sourceRecords: Array.from(sourceRecords),
      mergedContinuationRecords: true,
    };
  }

  function listLatestStoryRecords({ includeInvalid = false } = {}) {
    const recordsByStoryId = new Map();
    const invalid = [];
    for (const dirName of listStoryDirectories()) {
      const record = getStoryRecord(dirName);
      if (!record) continue;
      if (record.error) {
        invalid.push(record);
        continue;
      }
      if (!record.pkg?.storyId) continue;
      const id = record.pkg.storyId;
      const group = recordsByStoryId.get(id) || [];
      group.push(record);
      recordsByStoryId.set(id, group);
    }

    const valid = Array.from(recordsByStoryId.entries())
      .map(([id, records]) => {
        if (records.length > 1) {
          const dirNames = records
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .map((record) => record.dirName)
            .join(', ');
          console.error(`[StoryCatalog] duplicate storyId="${id}": resolving catalog view from ${dirNames}`);
        }
        return mergeContinuationRecords(records);
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return includeInvalid ? { valid, invalid } : valid;
  }

  async function loadGcsCatalogEntries() {
    const now = Date.now();
    if (gcsCatalogCache.entries && now - gcsCatalogCache.loadedAtMs < GCS_CATALOG_CACHE_TTL_MS) {
      return gcsCatalogCache.entries;
    }

    const bucketName = getGcsBucketName();
    const prefix = getGcsStoriesPrefix();
    if (!bucketName) throw new Error('GCS_BUCKET_NAME is required when STORY_STORAGE_MODE=gcs');

    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(`${prefix}/${CATALOG_OBJECT}`.replace(/\/+/g, '/'));

    const [exists] = await file.exists();
    if (!exists) {
      gcsCatalogCache = { loadedAtMs: now, entries: [] };
      return [];
    }

    try {
      const [buf] = await file.download();
      const parsed = JSON.parse(buf.toString('utf8'));
      const entries = Array.isArray(parsed?.stories) ? parsed.stories : [];
      gcsCatalogCache = { loadedAtMs: now, entries };
      return entries;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[StoryCatalog] Failed to load/parse GCS catalog.json (using cached or empty): ${msg}`);
      if (gcsCatalogCache.entries) {
        gcsCatalogCache.loadedAtMs = now;
        return gcsCatalogCache.entries;
      }
      gcsCatalogCache = { loadedAtMs: now, entries: [] };
      return [];
    }
  }

  function projectGcsCatalogEntries(entries) {
    const records = [];
    for (const entry of entries) {
      const outputDir = String(entry.outputDir || '');
      const dirNameMatch = /^generated-stories\/([^/]+)\//.exec(outputDir);
      const dirName = dirNameMatch ? dirNameMatch[1] : null;
      if (!dirName) continue;
      records.push({
        story: {
          id: entry.id,
          title: entry.title,
          genre: entry.genre,
          synopsis: entry.synopsis,
          coverImage: entry.coverImage || '',
          author: entry.author,
          tags: entry.tags,
          episodes: Array.isArray(entry.episodes) ? entry.episodes : [],
          episodeCount: typeof entry.episodeCount === 'number' ? entry.episodeCount : undefined,
          outputDir: entry.outputDir,
        },
        dirName,
        storyFile: entry.storyPath || `generated-stories/${dirName}/${LEGACY_STORY_FILENAME}`,
        mtimeMs: entry.updatedAt ? new Date(entry.updatedAt).getTime() : Date.now(),
      });
    }

    records.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
    const seen = new Set();
    return records.filter((r) => {
      if (!r?.story?.id || seen.has(r.story.id)) return false;
      seen.add(r.story.id);
      return true;
    });
  }

  function listLatestStoryRecordsByMode(options = {}) {
    const mode = getStoryStorageMode();
    if (mode !== 'gcs') return listLatestStoryRecords(options);

    return loadGcsCatalogEntries().then(projectGcsCatalogEntries);
  }

  function createStoryCatalogEntryFromGcsRecord(record, req) {
    const { story, dirName, mtimeMs } = record;
    const episodeCount =
      typeof story.episodeCount === 'number'
        ? story.episodeCount
        : Array.isArray(story.episodes)
          ? story.episodes.length
          : 0;
    return {
      id: story.id,
      title: story.title,
      genre: story.genre,
      synopsis: story.synopsis,
      coverImage: codec.normalizeAssetUrlForRequest(story.coverImage || '', req, port),
      author: story.author,
      tags: story.tags,
      outputDir: `generated-stories/${dirName}/`,
      isBuiltIn: story.isBuiltIn === true,
      updatedAt: new Date(mtimeMs).toISOString(),
      fullStoryUrl: `${codec.getRequestBaseUrl(req, port)}/stories/${encodeURIComponent(story.id)}`,
      episodeCount,
      episodes: Array.isArray(story.episodes)
        ? story.episodes.map((episode) => ({
            id: episode.id,
            number: episode.number,
            title: episode.title,
            synopsis: episode.synopsis,
            coverImage: codec.normalizeAssetUrlForRequest(episode.coverImage || '', req, port),
          }))
        : [],
      imageArtifacts: getImageArtifactSummaryForSlug(dirName),
    };
  }

  function normalizeFullStoryMedia(story, req) {
    const publicBase = getGcsPublicBaseUrl();
    if (!(publicBase && typeof story.coverImage === 'string' && story.coverImage.startsWith(publicBase))) {
      story.coverImage = codec.normalizeAssetUrlForRequest(story.coverImage || '', req, port);
    }
    if (Array.isArray(story.npcs)) {
      story.npcs = story.npcs.map((npc) => ({
        ...npc,
        portrait: codec.normalizeAssetUrlForRequest(npc.portrait || '', req, port),
      }));
    }
    if (Array.isArray(story.episodes)) {
      story.episodes = story.episodes.map((episode) => ({
        ...episode,
        coverImage: codec.normalizeAssetUrlForRequest(episode.coverImage || '', req, port),
        scenes: Array.isArray(episode.scenes)
          ? episode.scenes.map((scene) => ({
              ...scene,
              backgroundImage: codec.normalizeAssetUrlForRequest(scene.backgroundImage || '', req, port),
              beats: Array.isArray(scene.beats)
                ? scene.beats.map((beat) => ({
                    ...beat,
                    image: codec.normalizeAssetUrlForRequest(beat.image || '', req, port),
                    video: codec.normalizeAssetUrlForRequest(beat.video || '', req, port),
                  }))
                : [],
              encounter: scene.encounter ? codec.normalizeNestedMedia(scene.encounter, req, port) : scene.encounter,
            }))
          : [],
      }));
    }
    return story;
  }

  function createStoryCatalogEntry(record, req) {
    if (record.pkg) {
      const entry = codec.projectForCatalog(record.pkg, {
        req,
        port,
        dirName: record.dirName,
        mtimeMs: record.mtimeMs,
      });
      return {
        ...entry,
        imageArtifacts: getImageArtifactSummaryForSlug(record.dirName),
      };
    }

    return createStoryCatalogEntryFromGcsRecord(record, req);
  }

  async function createFullStoryResponse(record, req) {
    if (getStoryStorageMode() === 'gcs') {
      const bucketName = getGcsBucketName();
      const prefix = getGcsStoriesPrefix();
      if (!bucketName) throw new Error('GCS_BUCKET_NAME is required when STORY_STORAGE_MODE=gcs');

      const objectPath = `${prefix}/${record.dirName}/${LEGACY_STORY_FILENAME}`.replace(/\/+/g, '/');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(objectPath);
      const [buf] = await file.download();
      const story = JSON.parse(buf.toString('utf8'));
      story.outputDir = `generated-stories/${record.dirName}/`;
      const normalized = normalizeFullStoryMedia(story, req);
      normalized.imageArtifacts = getImageArtifactSummaryForSlug(record.dirName);
      return normalized;
    }

    if (record.pkg) {
      const story = codec.projectForFullResponse(record.pkg, { req, port, dirName: record.dirName });
      story.imageArtifacts = getImageArtifactSummaryForSlug(record.dirName);
      return story;
    }

    throw new Error('Story record has no decodable package data');
  }

  return {
    listLatestStoryRecords: listLatestStoryRecordsByMode,
    createStoryCatalogEntry,
    createFullStoryResponse,
    getStoryRecord,
  };
}

module.exports = {
  createStoryCatalog,
};
