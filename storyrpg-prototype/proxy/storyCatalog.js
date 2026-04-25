const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const codec = require('./storyCodec');
const manifestModule = require('./storyManifest');

function createStoryCatalog(storiesDir, port) {
  const storyJsonCache = new Map();
  const LEGACY_STORY_FILENAME = '08-final-story.json';
  const MODERN_STORY_FILENAME = 'story.json';

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

  function listLatestStoryRecords({ includeInvalid = false } = {}) {
    const storyMap = new Map();
    const seen = new Map();
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
      const prior = seen.get(id);
      if (!prior || record.mtimeMs > prior.mtimeMs) {
        // Fail-closed dedupe: log when we replace a record so the
        // operator sees that two directories claim the same storyId.
        if (prior) {
          console.error(`[StoryCatalog] duplicate storyId="${id}": dropping "${prior.dirName}" in favour of "${dirName}" (newer mtime)`);
        }
        storyMap.set(id, record);
        seen.set(id, { dirName, mtimeMs: record.mtimeMs });
      }
    }
    const valid = Array.from(storyMap.values());
    return includeInvalid ? { valid, invalid } : valid;
  }

  function createStoryCatalogEntry(record, req) {
    return codec.projectForCatalog(record.pkg, {
      req,
      port,
      dirName: record.dirName,
      mtimeMs: record.mtimeMs,
    });
  }

  function createFullStoryResponse(record, req) {
    return codec.projectForFullResponse(record.pkg, { req, port, dirName: record.dirName });
  }

  return {
    listLatestStoryRecords,
    createStoryCatalogEntry,
    createFullStoryResponse,
    getStoryRecord,
  };
}

module.exports = {
  createStoryCatalog,
};
