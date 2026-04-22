import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { BLOB_CONFIG, PROXY_CONFIG, isVercelDeployment } from '../config/endpoints';
import { Story, StoryCatalogEntry } from '../types';
import { toUrl, type AssetRuntime } from '../assets/assetResolver';
import { isAssetRef } from '../assets/assetRef';
import { decodeStory, StoryValidationError } from '../ai-agents/codec/storyCodec';

const GENERATED_STORIES_KEY = '@storyrpg_generated_stories';

type BlobManifestEntry = {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  tags?: string[];
  author?: string;
  coverImageUrl?: string | null;
  episodeCount?: number;
  blobUrl: string;
};

type BlobManifest = {
  stories?: BlobManifestEntry[];
};

function currentRuntime(): AssetRuntime {
  return Platform.OS === 'web' ? 'web' : 'native';
}

function runtimeResolveCtx(story?: Story | Partial<Story>) {
  return {
    runtime: currentRuntime(),
    proxyBaseUrl: PROXY_CONFIG.getProxyUrl(),
    storyDirName: story?.outputDir ? story.outputDir.replace(/^generated-stories\/|\/$/g, '') : undefined,
  };
}

/**
 * Public resolver for UI consumers. Given any `MediaRef` (AssetRef
 * object or legacy string) produces the URL the current runtime can
 * load. This is the successor to the old `normalizeAssetUrl` helper.
 */
export function resolveMedia(ref: unknown, story?: Story | Partial<Story>): string {
  if (ref == null) return '';
  if (typeof ref === 'string' || isAssetRef(ref)) {
    return toUrl(ref as never, runtimeResolveCtx(story));
  }
  if (typeof ref === 'object') {
    const maybeString = (ref as Record<string, unknown>).imagePath;
    if (typeof maybeString === 'string') return toUrl(maybeString, runtimeResolveCtx(story));
  }
  return '';
}

/**
 * Walk a Story and replace every media reference (AssetRef or string)
 * with a runtime-resolvable URL string. Used by the UI right before
 * handing a Story to the engine / reader.
 *
 * Replaces the old `normalizeStoryMediaUrls` helper but routes every
 * rewrite through the single resolver, so the transformation rules
 * live in one place.
 */
export function resolveStoryMedia(story: Story): Story {
  const ctx = runtimeResolveCtx(story);
  const r = (ref: unknown) => toUrl(ref as never, ctx);
  const normalized: Story = {
    ...story,
    coverImage: r(story.coverImage),
    episodes: (story.episodes || []).map((episode) => ({
      ...episode,
      coverImage: r(episode.coverImage),
      scenes: (episode.scenes || []).map((scene) => ({
        ...scene,
        backgroundImage: r(scene.backgroundImage),
        beats: (scene.beats || []).map((beat) => ({
          ...beat,
          image: r(beat.image),
          video: r(beat.video),
          audio: r(beat.audio),
          panelImages: Array.isArray(beat.panelImages) ? beat.panelImages.map(r) : beat.panelImages,
        })),
        encounter: scene.encounter ? resolveEncounterMedia(scene.encounter, ctx) : scene.encounter,
      })),
    })),
  };

  if (story.npcs) {
    normalized.npcs = story.npcs.map((npc) => ({ ...npc, portrait: r(npc.portrait) }));
  }

  return normalized;
}

function resolveEncounterMedia<T>(value: T, ctx: ReturnType<typeof runtimeResolveCtx>): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => resolveEncounterMedia(item, ctx)) as unknown as T;
  const cloned = { ...(value as Record<string, unknown>) };
  for (const [key, raw] of Object.entries(cloned)) {
    if ((typeof raw === 'string' || isAssetRef(raw)) && /(image|video|portrait|audio)$/i.test(key)) {
      cloned[key] = toUrl(raw as never, ctx);
      continue;
    }
    if (raw && typeof raw === 'object') {
      cloned[key] = resolveEncounterMedia(raw, ctx);
    }
  }
  return cloned as unknown as T;
}

export function createStoryCatalogEntry(
  story: Story,
  overrides: Partial<StoryCatalogEntry> = {},
): StoryCatalogEntry {
  return {
    id: story.id,
    title: story.title,
    genre: story.genre,
    synopsis: story.synopsis,
    coverImage: resolveMedia(story.coverImage, story),
    author: story.author,
    tags: story.tags,
    outputDir: story.outputDir,
    episodeCount: story.episodes.length,
    episodes: story.episodes.map((episode) => ({
      id: episode.id,
      number: episode.number,
      title: episode.title,
      synopsis: episode.synopsis,
      coverImage: resolveMedia(episode.coverImage, story),
    })),
    ...overrides,
  };
}

export async function fetchDeletedStoryIds(): Promise<Set<string>> {
  if (Platform.OS === 'web') {
    try {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/deleted-stories`);
      if (response.ok) {
        const { deletedIds } = await response.json() as { deletedIds?: string[] };
        return new Set(deletedIds || []);
      }
    } catch (err) {
      console.warn('[StoryLibrary] Failed to load deleted stories from proxy:', err);
    }
  }

  try {
    const stored = await AsyncStorage.getItem('@storyrpg_deleted_stories');
    if (!stored) return new Set();
    return new Set(JSON.parse(stored) as string[]);
  } catch (err) {
    console.warn('[StoryLibrary] Failed to load deleted stories from storage:', err);
    return new Set();
  }
}

export async function fetchStoryCatalog(): Promise<{
  stories: StoryCatalogEntry[];
  fileLoadedStoryIds: Set<string>;
}> {
  if (Platform.OS === 'web' && isVercelDeployment() && BLOB_CONFIG.manifestUrl) {
    const manifestRes = await fetch(BLOB_CONFIG.manifestUrl);
    if (!manifestRes.ok) throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
    const manifest = await manifestRes.json() as BlobManifest;
    const entries = manifest.stories || [];
    return {
      stories: entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        genre: entry.genre,
        synopsis: entry.synopsis,
        coverImage: entry.coverImageUrl || '',
        author: entry.author,
        tags: entry.tags,
        episodeCount: entry.episodeCount || 0,
        episodes: [],
        fullStoryUrl: entry.blobUrl,
      })),
      fileLoadedStoryIds: new Set(entries.map((entry) => entry.id)),
    };
  }

  if (Platform.OS === 'web') {
    const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/list-stories`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
    const payload = await response.json() as
      | StoryCatalogEntry[]
      | {
          stories: StoryCatalogEntry[];
          invalid?: Array<{ dirName: string; primaryFilename?: string; error?: { kind?: string; message?: string } }>;
        };
    const stories: StoryCatalogEntry[] = Array.isArray(payload) ? payload : payload.stories;
    const invalid = !Array.isArray(payload) && Array.isArray(payload.invalid) ? payload.invalid : [];
    if (invalid.length > 0) {
      // Surface broken stories to the console so the library UI and
      // ops both see them. The plan calls this out as "fail closed":
      // we no longer swallow these silently inside getStoryRecord.
      console.error(
        `[StoryLibrary] Proxy reported ${invalid.length} invalid story dir(s):`,
        invalid.map((i) => `${i.dirName}:${i.error?.kind ?? 'unknown'}`).join(', '),
      );
    }
    // The proxy already resolves media URLs for the current request; trust
    // them as-is to avoid double-rewriting and to keep the resolver the
    // single source of truth.
    return {
      stories,
      fileLoadedStoryIds: new Set(stories.map((story) => story.id)),
    };
  }

  const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
  const parsed = stored ? JSON.parse(stored) as unknown[] : [];
  const valid: Story[] = [];
  const invalidCount: string[] = [];
  for (const raw of parsed) {
    try {
      const pkg = decodeStory(raw);
      valid.push(pkg.story);
    } catch (err) {
      if (err instanceof StoryValidationError) {
        // Log error-level (not warn) so it shows up in production
        // reports. Still non-fatal for the library list — the story
        // is just unreadable until next write.
        console.error('[StoryLibrary] Skipping malformed AsyncStorage story:', err.message, err.issues);
        invalidCount.push(err.message);
      } else {
        throw err;
      }
    }
  }
  if (invalidCount.length > 0) {
    console.error(`[StoryLibrary] ${invalidCount.length} AsyncStorage story/ies failed codec validation and were skipped`);
  }
  return {
    stories: valid.map((story) => createStoryCatalogEntry(story)),
    fileLoadedStoryIds: new Set<string>(),
  };
}

export async function fetchStoryByCatalogEntry(
  entry: StoryCatalogEntry,
  fallbackStories: Story[] = [],
): Promise<Story | null> {
  const builtIn = fallbackStories.find((story) => story.id === entry.id);
  if (builtIn) return resolveStoryMedia(builtIn);

  if (entry.fullStoryUrl) {
    const response = await fetch(entry.fullStoryUrl);
    if (!response.ok) throw new Error(`Story fetch failed: ${response.status}`);
    const raw = await response.json();
    const pkg = decodeStory(raw);
    const story = { ...pkg.story, outputDir: pkg.story.outputDir || entry.outputDir };
    return resolveStoryMedia(story);
  }

  if (Platform.OS === 'web') {
    const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/stories/${encodeURIComponent(entry.id)}`, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const raw = await response.json();
      // /stories/:id returns the story body directly (already URL-rewritten
      // by the proxy). We still run decode for validation.
      try {
        const pkg = decodeStory(raw);
        return resolveStoryMedia(pkg.story);
      } catch (err) {
        if (err instanceof StoryValidationError) {
          // If the proxy flattened to raw Story (the common path today),
          // accept it but resolve media through our single resolver.
          return resolveStoryMedia(raw as Story);
        }
        throw err;
      }
    }
  }

  const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
  if (!stored) return null;
  const stories = JSON.parse(stored) as unknown[];
  for (const raw of stories) {
    try {
      const pkg = decodeStory(raw);
      if (pkg.storyId === entry.id) return resolveStoryMedia(pkg.story);
    } catch {
      // Ignore malformed entries.
    }
  }
  return null;
}

/**
 * Back-compat alias. Kept exported so older imports keep working
 * while the codebase migrates to `resolveStoryMedia`.
 *
 * @deprecated use resolveStoryMedia
 */
export const normalizeStoryMediaUrls = resolveStoryMedia;
