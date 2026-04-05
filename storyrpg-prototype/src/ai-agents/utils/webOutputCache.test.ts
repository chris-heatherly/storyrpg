import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheWebOutputFile,
  deleteCachedOutputDirectory,
  getCachedOutputsForDownload,
  listCachedOutputManifests,
  readCachedOutputFile,
} from './webOutputCache';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('webOutputCache', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('caches manifests and lists them by output directory', () => {
    cacheWebOutputFile(
      'generated-stories/story-1/manifest.json',
      JSON.stringify({ storyTitle: 'Story One', storyId: 'story-1' }),
    );

    const outputs = listCachedOutputManifests();
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('Story One');
    expect(outputs[0].path).toBe('generated-stories/story-1/');
  });

  it('skips oversized non-manifest files but keeps small files downloadable', () => {
    const smallContent = JSON.stringify({ hello: 'world' });
    const oversizedContent = 'x'.repeat(140_000);

    expect(cacheWebOutputFile('generated-stories/story-1/08-final-story.json', smallContent)).toBe(true);
    expect(cacheWebOutputFile('generated-stories/story-1/09-large.json', oversizedContent)).toBe(false);

    expect(readCachedOutputFile('generated-stories/story-1/08-final-story.json')).toEqual({ hello: 'world' });
    expect(getCachedOutputsForDownload('generated-stories/story-1/')).toEqual([
      { name: '08-final-story.json', content: smallContent },
    ]);
  });

  it('removes cached files for a deleted output directory', () => {
    cacheWebOutputFile(
      'generated-stories/story-1/manifest.json',
      JSON.stringify({ storyTitle: 'Story One', storyId: 'story-1' }),
    );
    cacheWebOutputFile(
      'generated-stories/story-1/08-final-story.json',
      JSON.stringify({ storyId: 'story-1' }),
    );

    deleteCachedOutputDirectory('generated-stories/story-1/');

    expect(listCachedOutputManifests()).toEqual([]);
    expect(getCachedOutputsForDownload('generated-stories/story-1/')).toEqual([]);
  });
});
