import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Story, StoryCatalogEntry } from '../types';
import { PROXY_CONFIG } from '../config/endpoints';
import {
  createStoryCatalogEntry,
  fetchDeletedStoryIds,
  fetchStoryByCatalogEntry,
  fetchStoryCatalog,
  normalizeStoryMediaUrls,
} from '../services/storyLibrary';

type CachedStoryRecord = {
  story: Story;
  sourceKey: string;
};

function getCatalogSourceKey(entry: StoryCatalogEntry): string {
  if (entry.isBuiltIn) return `builtin:${entry.id}`;
  return entry.fullStoryUrl || entry.outputDir || `story:${entry.id}`;
}

function getStorySourceKey(story: Story): string {
  if ((story as any).isBuiltIn === true) return `builtin:${story.id}`;
  return story.outputDir || `story:${story.id}`;
}

export function useStoryLibrary(builtInStories: Story[]) {
  const [stories, setStories] = useState<StoryCatalogEntry[]>([]);
  const [storiesLoaded, setStoriesLoaded] = useState(false);
  const [fileLoadedStoryIds, setFileLoadedStoryIds] = useState<Set<string>>(new Set());
  const [deletedStoryIds, setDeletedStoryIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const storyCacheRef = useRef<Map<string, CachedStoryRecord>>(new Map());

  const installBuiltInStories = useCallback(async (deletedIds: Set<string>) => {
    if (Platform.OS !== 'web' || builtInStories.length === 0) return;

    try {
      const checkResponse = await fetch(`${PROXY_CONFIG.getProxyUrl()}/check-builtin-stories`);
      const checkResult = await checkResponse.json() as { installedIds: string[]; deletedIds?: string[] };
      const installedSet = new Set(checkResult.installedIds);
      const serverDeletedIds = new Set(checkResult.deletedIds || []);
      const allDeletedIds = new Set([...deletedIds, ...serverDeletedIds]);

      if (serverDeletedIds.size > 0) {
        setDeletedStoryIds((prev) => new Set([...prev, ...serverDeletedIds]));
      }

      for (const story of builtInStories) {
        if (!installedSet.has(story.id) && !allDeletedIds.has(story.id)) {
          await fetch(`${PROXY_CONFIG.getProxyUrl()}/install-builtin-story`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ story }),
          });
        }
      }
    } catch (err) {
      console.warn('[StoryLibrary] Failed to check/install built-in stories:', err);
    }
  }, [builtInStories]);

  const loadStories = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const currentDeletedIds = await fetchDeletedStoryIds();
      setDeletedStoryIds(currentDeletedIds);

      await installBuiltInStories(currentDeletedIds);

      const builtInCatalog = builtInStories
        .filter((story) => !currentDeletedIds.has(story.id))
        .map((story) => createStoryCatalogEntry(story));
      const builtInCacheEntries = builtInStories
        .filter((story) => !currentDeletedIds.has(story.id))
        .map((story) => {
          const normalizedStory = normalizeStoryMediaUrls(story);
          return [
            story.id,
            {
              story: normalizedStory,
              sourceKey: getStorySourceKey(normalizedStory),
            },
          ] as const;
        });

      const { stories: remoteCatalog, fileLoadedStoryIds: remoteIds } = await fetchStoryCatalog();
      const deduped = [...builtInCatalog, ...remoteCatalog].filter((story, index, all) =>
        all.findIndex((candidate) => candidate.id === story.id) === index
      );

      storyCacheRef.current = new Map(builtInCacheEntries);
      setStories(deduped);
      setFileLoadedStoryIds(remoteIds);
    } catch (err) {
      console.error('[StoryLibrary] Failed to load stories:', err);
      const fallbackStories = builtInStories.map((story) => createStoryCatalogEntry(story));
      storyCacheRef.current = new Map(
        builtInStories.map((story) => {
          const normalizedStory = normalizeStoryMediaUrls(story);
          return [
            story.id,
            {
              story: normalizedStory,
              sourceKey: getStorySourceKey(normalizedStory),
            },
          ] as const;
        })
      );
      setStories(fallbackStories);
      setFileLoadedStoryIds(new Set());
    } finally {
      setStoriesLoaded(true);
      setIsRefreshing(false);
    }
  }, [builtInStories, installBuiltInStories]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  const loadFullStory = useCallback(async (storyId: string): Promise<Story | null> => {
    const storyEntry = stories.find((candidate) => candidate.id === storyId);
    const cached = storyCacheRef.current.get(storyId);
    if (!storyEntry) {
      return cached?.story || null;
    }

    if (cached && cached.sourceKey === getCatalogSourceKey(storyEntry)) {
      return cached.story;
    }

    const loadedStory = await fetchStoryByCatalogEntry(storyEntry, builtInStories);
    if (!loadedStory) return null;
    storyCacheRef.current.set(storyId, {
      story: loadedStory,
      sourceKey: getCatalogSourceKey(storyEntry),
    });
    return loadedStory;
  }, [builtInStories, stories]);

  const upsertStory = useCallback((story: Story) => {
    const normalizedStory = normalizeStoryMediaUrls(story);
    storyCacheRef.current.set(normalizedStory.id, {
      story: normalizedStory,
      sourceKey: getStorySourceKey(normalizedStory),
    });
    const catalogEntry = createStoryCatalogEntry(normalizedStory, {
      isBuiltIn: (normalizedStory as any).isBuiltIn === true,
    });

    setStories((prev) => {
      const existingIndex = prev.findIndex((candidate) => candidate.id === normalizedStory.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...catalogEntry };
        return updated;
      }
      return [...prev, catalogEntry];
    });

    setFileLoadedStoryIds((prev) => new Set([...prev, normalizedStory.id]));
  }, []);

  const removeStory = useCallback((storyId: string) => {
    storyCacheRef.current.delete(storyId);
    setStories((prev) => prev.filter((story) => story.id !== storyId));
    setFileLoadedStoryIds((prev) => {
      const next = new Set(prev);
      next.delete(storyId);
      return next;
    });
  }, []);

  return {
    stories,
    setStories,
    storiesLoaded,
    fileLoadedStoryIds,
    setFileLoadedStoryIds,
    deletedStoryIds,
    setDeletedStoryIds,
    isRefreshing,
    storyCacheRef,
    loadStories,
    loadFullStory,
    upsertStory,
    removeStory,
  };
}
