import type { OutputManifest } from './pipelineOutputWriter';

const CACHE_VERSION = 'v1';
const CACHE_NAMESPACE = `storyrpg:outputs:${CACHE_VERSION}`;
const INDEX_KEY = `${CACHE_NAMESPACE}:index`;
const MAX_CACHEABLE_FILE_BYTES = 128_000;
const MAX_TOTAL_CACHE_BYTES = 768_000;

type CacheEntry = {
  path: string;
  size: number;
  updatedAt: string;
};

type CacheIndex = {
  version: string;
  entries: CacheEntry[];
};

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function getContentKey(path: string): string {
  return `${CACHE_NAMESPACE}:file:${path}`;
}

function loadIndex(storage: Storage): CacheIndex {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return { version: CACHE_VERSION, entries: [] };
    const parsed = JSON.parse(raw) as CacheIndex;
    if (!Array.isArray(parsed.entries)) {
      return { version: CACHE_VERSION, entries: [] };
    }
    return {
      version: CACHE_VERSION,
      entries: parsed.entries.filter((entry) => typeof entry?.path === 'string'),
    };
  } catch {
    return { version: CACHE_VERSION, entries: [] };
  }
}

function saveIndex(storage: Storage, index: CacheIndex): void {
  storage.setItem(INDEX_KEY, JSON.stringify(index));
}

function pruneToBudget(storage: Storage, index: CacheIndex): CacheIndex {
  const sorted = [...index.entries].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  let totalBytes = 0;
  const kept: CacheEntry[] = [];

  for (const entry of sorted) {
    if (totalBytes + entry.size > MAX_TOTAL_CACHE_BYTES && kept.length > 0) {
      storage.removeItem(getContentKey(entry.path));
      continue;
    }
    kept.push(entry);
    totalBytes += entry.size;
  }

  return {
    version: CACHE_VERSION,
    entries: kept,
  };
}

export function cacheWebOutputFile(path: string, content: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  const shouldCache = path.endsWith('manifest.json') || content.length <= MAX_CACHEABLE_FILE_BYTES;
  if (!shouldCache) return false;

  const entry: CacheEntry = {
    path,
    size: content.length,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(getContentKey(path), content);
    const index = loadIndex(storage);
    const nextIndex = pruneToBudget(storage, {
      version: CACHE_VERSION,
      entries: [entry, ...index.entries.filter((existing) => existing.path !== path)],
    });
    saveIndex(storage, nextIndex);
    return true;
  } catch {
    try {
      storage.removeItem(getContentKey(path));
    } catch {
      // Ignore cleanup failures.
    }
    return false;
  }
}

export function listCachedOutputManifests(): Array<{ name: string; path: string; manifest?: OutputManifest }> {
  const storage = getStorage();
  if (!storage) return [];

  const index = loadIndex(storage);
  return index.entries
    .filter((entry) => entry.path.endsWith('manifest.json'))
    .map((entry) => {
      const raw = storage.getItem(getContentKey(entry.path));
      if (!raw) {
        return {
          name: entry.path,
          path: entry.path.replace(/manifest\.json$/, ''),
        };
      }

      try {
        const manifest = JSON.parse(raw) as OutputManifest;
        return {
          name: manifest.storyTitle || entry.path,
          path: entry.path.replace(/manifest\.json$/, ''),
          manifest,
        };
      } catch {
        return {
          name: entry.path,
          path: entry.path.replace(/manifest\.json$/, ''),
        };
      }
    });
}

export function readCachedOutputFile(path: string): unknown {
  const storage = getStorage();
  if (!storage) {
    throw new Error(`File not found in cache: ${path}`);
  }

  const content = storage.getItem(getContentKey(path));
  if (!content) {
    throw new Error(`File not found in cache: ${path}`);
  }
  return JSON.parse(content);
}

export function getCachedOutputsForDownload(outputDir: string): Array<{ name: string; content: string }> {
  const storage = getStorage();
  if (!storage) return [];

  const index = loadIndex(storage);
  return index.entries
    .filter((entry) => entry.path.startsWith(outputDir))
    .map((entry) => {
      const content = storage.getItem(getContentKey(entry.path));
      if (!content) return null;
      return {
        name: entry.path.replace(outputDir, ''),
        content,
      };
    })
    .filter(Boolean) as Array<{ name: string; content: string }>;
}

export function deleteCachedOutputDirectory(outputDir: string): void {
  const storage = getStorage();
  if (!storage) return;

  const index = loadIndex(storage);
  const kept = index.entries.filter((entry) => {
    if (!entry.path.startsWith(outputDir)) return true;
    storage.removeItem(getContentKey(entry.path));
    return false;
  });
  saveIndex(storage, { version: CACHE_VERSION, entries: kept });
}
