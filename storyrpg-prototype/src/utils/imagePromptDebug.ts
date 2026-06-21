const STORY_IMAGE_URL_RE = /^https?:\/\/[^/]+\/generated-stories\/.+\.(png|jpe?g|webp)(?:[?#].*)?$/i;
const storyImageUrlCache = new WeakMap<object, string[]>();

function normalizeImageUrlForLookup(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.trim().replace(/^https?:\/\/[^/]+/, '');
}

function collectStoryImageUrls(node: unknown, seen: Set<string>, urls: string[]): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectStoryImageUrls(item, seen, urls);
    return;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (typeof value === 'string' && STORY_IMAGE_URL_RE.test(value)) {
      const normalized = normalizeImageUrlForLookup(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } else {
      collectStoryImageUrls(value, seen, urls);
    }
  }
}

export function getImagePanelNumberFromStory(
  story: unknown,
  imageUrl: string | undefined | null
): number | null {
  const normalizedImageUrl = normalizeImageUrlForLookup(imageUrl);
  if (!story || typeof story !== 'object' || !normalizedImageUrl) return null;

  let urls = storyImageUrlCache.get(story);
  if (!urls) {
    urls = [];
    collectStoryImageUrls(story, new Set<string>(), urls);
    storyImageUrlCache.set(story, urls);
  }
  const index = urls.indexOf(normalizedImageUrl);
  return index >= 0 ? index + 1 : null;
}

export function formatSceneBeatLabelFromImageUrl(
  url: string | undefined,
  fallbackSceneId?: string | null,
  fallbackBeatId?: string | null
): string | null {
  const value = url || '';
  const candidates: Array<
    | { kind: 'beat'; re: RegExp }
    | { kind: 'shot'; re: RegExp }
  > = [
    { kind: 'beat', re: /encounter-scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'beat', re: /beat-scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'beat', re: /scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'shot', re: /shot-scene-([0-9]+[a-z]?)-shot-([0-9]+)/i },
  ];

  for (const candidate of candidates) {
    const match = value.match(candidate.re);
    if (!match) continue;
    const scene = match[1];
    const number = match[2];
    return candidate.kind === 'beat'
      ? `Scene ${scene} • Beat ${number}`
      : `Scene ${scene} • Shot ${number}`;
  }

  const sceneFromId =
    fallbackSceneId?.match(/scene-([0-9]+[a-z]?)/i)?.[1] ||
    fallbackSceneId?.match(/\bs([0-9]+-[0-9]+[a-z]?)\b/i)?.[1];
  const beatFromId =
    fallbackBeatId?.match(/beat-([0-9]+[a-z]?)/i)?.[1] ||
    fallbackBeatId?.match(/\bb([0-9]+[a-z]?)\b/i)?.[1];
  if (sceneFromId && beatFromId) return `Scene ${sceneFromId} • Beat ${beatFromId}`;
  if (sceneFromId) return `Scene ${sceneFromId}`;
  return null;
}

export function formatImageDebugLabel(
  url: string | undefined,
  story: unknown,
  fallbackSceneId?: string | null,
  fallbackBeatId?: string | null
): string | null {
  const parts: string[] = [];
  const sceneBeatLabel = formatSceneBeatLabelFromImageUrl(url, fallbackSceneId, fallbackBeatId);
  if (sceneBeatLabel) parts.push(sceneBeatLabel);

  const panelNumber = getImagePanelNumberFromStory(story, url);
  if (panelNumber) parts.push(`IMG ${panelNumber}`);

  return parts.length > 0 ? parts.join(' • ') : null;
}
