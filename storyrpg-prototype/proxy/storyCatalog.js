const fs = require('fs');
const path = require('path');

function createStoryCatalog(storiesDir, port) {
  const storyJsonCache = new Map();
  const STORY_FILENAME = '08-final-story.json';

  function getRequestBaseUrl(req) {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader) ? protoHeader[0] : (protoHeader || req.protocol || 'http');
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    return `${proto}://${host}`;
  }

  function normalizeAssetUrlForRequest(value, req) {
    if (!value || typeof value !== 'string') return value || '';
    if (value.startsWith('data:')) return value;

    const baseUrl = getRequestBaseUrl(req);
    if (/^https?:\/\/[^/]+\/generated-stories\//i.test(value) || /^https?:\/\/[^/]+\/ref-images\//i.test(value)) {
      return value.replace(/^https?:\/\/[^/]+/i, baseUrl);
    }
    if (value.startsWith('generated-stories/') || value.startsWith('ref-images/')) {
      return `${baseUrl}/${value.replace(/^\/+/, '')}`;
    }
    return value;
  }

  function normalizeNestedMedia(value, req) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((item) => normalizeNestedMedia(item, req));
    }

    const next = { ...value };
    for (const [key, raw] of Object.entries(next)) {
      if (typeof raw === 'string' && /(image|video|portrait)$/i.test(key)) {
        next[key] = normalizeAssetUrlForRequest(raw, req);
        continue;
      }
      if (raw && typeof raw === 'object') {
        next[key] = normalizeNestedMedia(raw, req);
      }
    }
    return next;
  }

  function listStoryDirectories() {
    if (!fs.existsSync(storiesDir)) return [];
    return fs.readdirSync(storiesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort()
      .reverse();
  }

  function getStoryRecord(dirName) {
    const storyFile = path.join(storiesDir, dirName, STORY_FILENAME);
    if (!fs.existsSync(storyFile)) return null;

    const stats = fs.statSync(storyFile);
    const cached = storyJsonCache.get(storyFile);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return {
        story: cached.story,
        dirName,
        storyFile,
        mtimeMs: cached.mtimeMs,
      };
    }

    try {
      const raw = fs.readFileSync(storyFile, 'utf8');
      const story = JSON.parse(raw);
      storyJsonCache.set(storyFile, { story, mtimeMs: stats.mtimeMs });
      return {
        story,
        dirName,
        storyFile,
        mtimeMs: stats.mtimeMs,
      };
    } catch (err) {
      console.warn(`[StoryCatalog] Skipping ${dirName}: ${err.message}`);
      return null;
    }
  }

  function listLatestStoryRecords() {
    const storyMap = new Map();
    for (const dirName of listStoryDirectories()) {
      const record = getStoryRecord(dirName);
      if (!record?.story?.id || storyMap.has(record.story.id)) continue;
      storyMap.set(record.story.id, record);
    }
    return Array.from(storyMap.values());
  }

  function createStoryCatalogEntry(record, req) {
    const { story, dirName, mtimeMs } = record;
    return {
      id: story.id,
      title: story.title,
      genre: story.genre,
      synopsis: story.synopsis,
      coverImage: normalizeAssetUrlForRequest(story.coverImage || '', req),
      author: story.author,
      tags: story.tags,
      outputDir: `generated-stories/${dirName}/`,
      isBuiltIn: story.isBuiltIn === true,
      updatedAt: new Date(mtimeMs).toISOString(),
      fullStoryUrl: `${getRequestBaseUrl(req)}/stories/${encodeURIComponent(story.id)}`,
      episodeCount: Array.isArray(story.episodes) ? story.episodes.length : 0,
      episodes: Array.isArray(story.episodes)
        ? story.episodes.map((episode) => ({
            id: episode.id,
            number: episode.number,
            title: episode.title,
            synopsis: episode.synopsis,
            coverImage: normalizeAssetUrlForRequest(episode.coverImage || '', req),
          }))
        : [],
    };
  }

  function createFullStoryResponse(record, req) {
    const story = JSON.parse(JSON.stringify(record.story));
    const outputDir = `generated-stories/${record.dirName}/`;
    story.outputDir = outputDir;
    story.coverImage = normalizeAssetUrlForRequest(story.coverImage || '', req);
    if (Array.isArray(story.npcs)) {
      story.npcs = story.npcs.map((npc) => ({
        ...npc,
        portrait: normalizeAssetUrlForRequest(npc.portrait || '', req),
      }));
    }
    if (Array.isArray(story.episodes)) {
      story.episodes = story.episodes.map((episode) => ({
        ...episode,
        coverImage: normalizeAssetUrlForRequest(episode.coverImage || '', req),
        scenes: Array.isArray(episode.scenes)
          ? episode.scenes.map((scene) => ({
              ...scene,
              backgroundImage: normalizeAssetUrlForRequest(scene.backgroundImage || '', req),
              beats: Array.isArray(scene.beats)
                ? scene.beats.map((beat) => ({
                    ...beat,
                    image: normalizeAssetUrlForRequest(beat.image || '', req),
                    video: normalizeAssetUrlForRequest(beat.video || '', req),
                  }))
                : [],
              encounter: scene.encounter ? normalizeNestedMedia(scene.encounter, req) : scene.encounter,
            }))
          : [],
      }));
    }
    return story;
  }

  return {
    listLatestStoryRecords,
    createStoryCatalogEntry,
    createFullStoryResponse,
  };
}

module.exports = {
  createStoryCatalog,
};
