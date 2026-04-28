/**
 * CJS twin of `src/ai-agents/codec/storyCodec.ts` — the proxy cannot
 * require the TS file directly, so this module re-implements the
 * structural checks and projections the proxy needs:
 *
 *   - detectSchemaVersion(raw)
 *   - decodeStory(raw)           — returns a normalised { story, assets, schemaVersion, ... }
 *   - projectForCatalog(pkg, req) — the small entry shape /list-stories returns
 *   - projectForFullResponse(pkg, req) — the full-story shape /stories/:id returns
 *
 * This mirror does not pull in Zod. The TS codec is still the
 * authoritative contract; this file only enforces the invariants the
 * proxy relies on (has id, episodes is an array, schemaVersion
 * belongs to the supported set).
 */

const STORY_SCHEMA_VERSION = 3;
const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3];

class StoryValidationError extends Error {
  constructor(message, issues = [], detectedVersion = null) {
    super(message);
    this.name = 'StoryValidationError';
    this.issues = issues;
    this.detectedVersion = detectedVersion;
  }
}

function detectSchemaVersion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (SUPPORTED_SCHEMA_VERSIONS.includes(raw.schemaVersion)) return raw.schemaVersion;
  if (typeof raw.id === 'string' && Array.isArray(raw.episodes)) return 1;
  return null;
}

function extractStoryBody(raw, version) {
  if (version === 1) return raw;
  return raw && raw.story;
}

function assertStoryBody(body, version) {
  if (!body || typeof body !== 'object') {
    throw new StoryValidationError('story body is missing', [{ path: 'story', message: 'not an object' }], version);
  }
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new StoryValidationError('story.id is required', [{ path: 'story.id', message: 'must be a non-empty string' }], version);
  }
  if (!Array.isArray(body.episodes)) {
    throw new StoryValidationError('story.episodes must be an array', [{ path: 'story.episodes', message: 'not an array' }], version);
  }
}

function decodeStory(raw) {
  const detected = detectSchemaVersion(raw);
  if (detected === null) {
    throw new StoryValidationError('decodeStory: unknown schemaVersion', [{ path: '(root)', message: 'missing schemaVersion and not v1-shaped' }], null);
  }
  const body = extractStoryBody(raw, detected);
  assertStoryBody(body, detected);

  const assets = detected === 3 && raw.assets && typeof raw.assets === 'object' && !Array.isArray(raw.assets)
    ? raw.assets
    : {};

  return {
    schemaVersion: detected,
    storyId: body.id,
    createdAt: detected === 1 ? new Date().toISOString() : (raw.createdAt || new Date().toISOString()),
    generator: detected === 1 ? {} : (raw.generator || {}),
    story: body,
    assets,
    migrated: detected !== STORY_SCHEMA_VERSION,
    detectedSchemaVersion: detected,
  };
}

function safeDecodeStory(raw) {
  try {
    return { ok: true, pkg: decodeStory(raw) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// -----------------------------------------------------------
// URL normalisation (relative / bare / http → request-base host)
// -----------------------------------------------------------

function getRequestBaseUrl(req, port) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : (protoHeader || req.protocol || 'http');
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  return `${proto}://${host}`;
}

function normalizeAssetUrlForRequest(value, req, port) {
  if (!value || typeof value !== 'string') return value || '';
  if (value.startsWith('data:')) return value;

  const baseUrl = getRequestBaseUrl(req, port);
  if (/^https?:\/\/[^/]+\/generated-stories\//i.test(value) || /^https?:\/\/[^/]+\/ref-images\//i.test(value)) {
    return value.replace(/^https?:\/\/[^/]+/i, baseUrl);
  }
  if (value.startsWith('generated-stories/') || value.startsWith('ref-images/')) {
    return `${baseUrl}/${value.replace(/^\/+/, '')}`;
  }
  return value;
}

function normalizeNestedMedia(value, req, port) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeNestedMedia(item, req, port));

  const next = { ...value };
  for (const [key, raw] of Object.entries(next)) {
    if (typeof raw === 'string' && /(image|video|portrait)$/i.test(key)) {
      next[key] = normalizeAssetUrlForRequest(raw, req, port);
      continue;
    }
    if (raw && typeof raw === 'object') {
      next[key] = normalizeNestedMedia(raw, req, port);
    }
  }
  return next;
}

// -----------------------------------------------------------
// Projections
// -----------------------------------------------------------

function projectForCatalog(pkg, { req, port, dirName, mtimeMs }) {
  const { story } = pkg;
  return {
    id: story.id,
    title: story.title,
    genre: story.genre,
    synopsis: story.synopsis,
    coverImage: normalizeAssetUrlForRequest(story.coverImage || '', req, port),
    author: story.author,
    tags: story.tags,
    outputDir: `generated-stories/${dirName}/`,
    isBuiltIn: story.isBuiltIn === true,
    updatedAt: new Date(mtimeMs).toISOString(),
    fullStoryUrl: `${getRequestBaseUrl(req, port)}/stories/${encodeURIComponent(story.id)}`,
    episodeCount: Array.isArray(story.episodes) ? story.episodes.length : 0,
    episodes: Array.isArray(story.episodes)
      ? story.episodes.map((ep) => ({
          id: ep.id,
          number: ep.number,
          title: ep.title,
          synopsis: ep.synopsis,
          coverImage: normalizeAssetUrlForRequest(ep.coverImage || '', req, port),
        }))
      : [],
  };
}

function projectForFullResponse(pkg, { req, port, dirName }) {
  const story = JSON.parse(JSON.stringify(pkg.story));
  story.outputDir = `generated-stories/${dirName}/`;
  story.coverImage = normalizeAssetUrlForRequest(story.coverImage || '', req, port);
  if (Array.isArray(story.npcs)) {
    story.npcs = story.npcs.map((npc) => ({
      ...npc,
      portrait: normalizeAssetUrlForRequest(npc.portrait || '', req, port),
    }));
  }
  if (Array.isArray(story.episodes)) {
    story.episodes = story.episodes.map((ep) => ({
      ...ep,
      coverImage: normalizeAssetUrlForRequest(ep.coverImage || '', req, port),
      scenes: Array.isArray(ep.scenes)
        ? ep.scenes.map((scene) => ({
            ...scene,
            backgroundImage: normalizeAssetUrlForRequest(scene.backgroundImage || '', req, port),
            beats: Array.isArray(scene.beats)
              ? scene.beats.map((beat) => ({
                  ...beat,
                  image: normalizeAssetUrlForRequest(beat.image || '', req, port),
                  video: normalizeAssetUrlForRequest(beat.video || '', req, port),
                }))
              : [],
            encounter: scene.encounter ? normalizeNestedMedia(scene.encounter, req, port) : scene.encounter,
          }))
        : [],
    }));
  }
  return story;
}

module.exports = {
  STORY_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  StoryValidationError,
  detectSchemaVersion,
  decodeStory,
  safeDecodeStory,
  projectForCatalog,
  projectForFullResponse,
  normalizeAssetUrlForRequest,
  normalizeNestedMedia,
  getRequestBaseUrl,
};
