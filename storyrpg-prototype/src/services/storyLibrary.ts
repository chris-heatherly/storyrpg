import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { BLOB_CONFIG, PROXY_CONFIG, isVercelDeployment } from '../config/endpoints';
import { Story, StoryCatalogEntry } from '../types';

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

function getProxyAssetBase(): string {
  return `${PROXY_CONFIG.getProxyUrl()}/`;
}

function normalizeAssetUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  if (/^https?:\/\//i.test(url)) {
    if (url.includes('/generated-stories/') || url.includes('/ref-images/')) {
      return url.replace(/^https?:\/\/[^/]+\/?/, getProxyAssetBase());
    }
    return url;
  }
  const normalized = url.replace(/^\/+/, '');
  if (normalized.startsWith('generated-stories/') || normalized.startsWith('ref-images/')) {
    return `${getProxyAssetBase()}${normalized}`;
  }
  return url;
}

function normalizeEncounterLikeMedia<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const cloned = Array.isArray(value)
    ? value.map((item) => normalizeEncounterLikeMedia(item))
    : { ...(value as Record<string, unknown>) };

  if (Array.isArray(cloned)) {
    return cloned as T;
  }

  for (const [key, raw] of Object.entries(cloned)) {
    if (typeof raw === 'string' && /(image|video|portrait)$/i.test(key)) {
      cloned[key] = normalizeAssetUrl(raw);
      continue;
    }
    if (raw && typeof raw === 'object') {
      cloned[key] = normalizeEncounterLikeMedia(raw);
    }
  }

  return cloned as T;
}

export function normalizeStoryMediaUrls(story: Story): Story {
  const normalized: Story = {
    ...story,
    coverImage: normalizeAssetUrl(story.coverImage),
    episodes: story.episodes.map((episode) => ({
      ...episode,
      coverImage: normalizeAssetUrl(episode.coverImage),
      scenes: episode.scenes.map((scene) => ({
        ...scene,
        backgroundImage: normalizeAssetUrl(scene.backgroundImage),
        beats: scene.beats.map((beat) => ({
          ...beat,
          image: normalizeAssetUrl(beat.image),
          video: normalizeAssetUrl(beat.video),
        })),
        encounter: scene.encounter ? normalizeEncounterLikeMedia(scene.encounter) : scene.encounter,
      })),
    })),
  };

  if (story.npcs) {
    normalized.npcs = story.npcs.map((npc) => ({
      ...npc,
      portrait: normalizeAssetUrl(npc.portrait),
    }));
  }

  return normalized;
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
    coverImage: normalizeAssetUrl(story.coverImage),
    author: story.author,
    tags: story.tags,
    outputDir: story.outputDir,
    episodeCount: story.episodes.length,
    episodes: story.episodes.map((episode) => ({
      id: episode.id,
      number: episode.number,
      title: episode.title,
      synopsis: episode.synopsis,
      coverImage: normalizeAssetUrl(episode.coverImage),
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
    const stories = await response.json() as StoryCatalogEntry[];
    return {
      stories: stories.map((story) => ({
        ...story,
        coverImage: normalizeAssetUrl(story.coverImage),
        episodes: (story.episodes || []).map((episode) => ({
          ...episode,
          coverImage: normalizeAssetUrl(episode.coverImage),
        })),
      })),
      fileLoadedStoryIds: new Set(stories.map((story) => story.id)),
    };
  }

  const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
  const parsed = stored ? JSON.parse(stored) as Story[] : [];
  return {
    stories: parsed.map((story) => createStoryCatalogEntry(story)),
    fileLoadedStoryIds: new Set<string>(),
  };
}

export async function fetchStoryByCatalogEntry(
  entry: StoryCatalogEntry,
  fallbackStories: Story[] = [],
): Promise<Story | null> {
  const builtIn = fallbackStories.find((story) => story.id === entry.id);
  if (builtIn) return normalizeStoryMediaUrls(builtIn);

  if (entry.fullStoryUrl) {
    const response = await fetch(entry.fullStoryUrl);
    if (!response.ok) throw new Error(`Story fetch failed: ${response.status}`);
    const story = await response.json() as Story;
    return normalizeStoryMediaUrls({ ...story, outputDir: story.outputDir || entry.outputDir });
  }

  if (Platform.OS === 'web') {
    const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/stories/${encodeURIComponent(entry.id)}`, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const story = await response.json() as Story;
      return normalizeStoryMediaUrls(story);
    }
  }

  const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
  if (!stored) return null;
  const stories = JSON.parse(stored) as Story[];
  const story = stories.find((candidate) => candidate.id === entry.id);
  return story ? normalizeStoryMediaUrls(story) : null;
}
