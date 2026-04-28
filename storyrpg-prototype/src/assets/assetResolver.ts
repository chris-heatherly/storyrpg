/**
 * assetResolver — turn an `AssetRef` (or a legacy string path/URL)
 * into something the current runtime can actually load.
 *
 * Runtimes:
 *   - 'web'     the React DOM / web build. Media comes off the proxy
 *               HTTP host; we produce absolute URLs like
 *               `http://localhost:3001/generated-stories/<id>/assets/<prefix>/<sha>.<ext>`.
 *   - 'native'  React Native / Expo. Files live under the app's
 *               document directory; we produce `file://` URLs.
 *   - 'proxy'   Server-side (proxy + worker). Produces absolute
 *               http URLs or filesystem paths depending on caller.
 *
 * The resolver is the *only* place that rewrites media URLs — the
 * old `normalizeStoryMediaUrls` / `normalizeAssetUrlForRequest` /
 * `normalizeNestedMedia` helpers go away once every consumer routes
 * through here.
 */

import { isAssetRef, type AssetRef, type MediaRefInput } from './assetRef';

export type AssetRuntime = 'web' | 'native' | 'proxy';

export interface ResolveContext {
  runtime: AssetRuntime;
  /**
   * Absolute URL of the StoryRPG proxy for web / remote runtimes.
   * e.g. 'http://localhost:3001'. Ignored on native.
   */
  proxyBaseUrl?: string;
  /**
   * Story directory name under `generated-stories/`. Required when
   * resolving AssetRef sha-addressed assets.
   */
  storyDirName?: string;
  /**
   * Absolute directory on disk that corresponds to `storyDirName`.
   * Only required when the resolver should produce native `file://`
   * URLs or when verifying existence server-side.
   */
  storyDirAbs?: string;
}

function extensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('json')) return 'json';
  return 'bin';
}

/**
 * Compute the content-addressed path for a given asset hash, relative
 * to the story's `assets/` directory. Example:
 *
 *   sha = "ab12cd34..."        ->   "ab/ab12cd34....png"
 */
export function pathForSha256(sha256: string, mimeType: string): string {
  if (typeof sha256 !== 'string' || sha256.length < 4) {
    throw new Error(`pathForSha256: invalid sha256 "${sha256}"`);
  }
  const prefix = sha256.slice(0, 2);
  const ext = extensionForMime(mimeType);
  return `${prefix}/${sha256}.${ext}`;
}

/**
 * Resolve an AssetRef to a URL the current runtime can load.
 */
export function resolveAssetRef(ref: AssetRef, ctx: ResolveContext): string {
  if (ref.externalUrl) return ref.externalUrl;
  const relPath = `assets/${pathForSha256(ref.sha256, ref.mimeType)}`;

  if (ctx.runtime === 'native') {
    if (!ctx.storyDirAbs) {
      throw new Error('resolveAssetRef(native): storyDirAbs is required');
    }
    const base = ctx.storyDirAbs.endsWith('/') ? ctx.storyDirAbs : `${ctx.storyDirAbs}/`;
    return `file://${base}${relPath}`;
  }

  // web + proxy share the same shape: http://<host>/generated-stories/<dir>/assets/...
  if (!ctx.proxyBaseUrl) {
    throw new Error(`resolveAssetRef(${ctx.runtime}): proxyBaseUrl is required`);
  }
  if (!ctx.storyDirName) {
    throw new Error(`resolveAssetRef(${ctx.runtime}): storyDirName is required`);
  }
  const base = ctx.proxyBaseUrl.replace(/\/+$/, '');
  return `${base}/generated-stories/${ctx.storyDirName}/${relPath}`;
}

/**
 * Accept either a legacy string (relative path, absolute URL, or
 * `data:` URL) or an AssetRef, and produce a loadable URL. Centralises
 * the tolerance across runtimes so consumers don't reimplement it.
 */
export function toUrl(ref: MediaRefInput, ctx: ResolveContext): string {
  if (!ref) return '';
  if (isAssetRef(ref)) return resolveAssetRef(ref, ctx);
  // Legacy string forms below
  if (typeof ref !== 'string') return '';
  if (!ref) return '';
  if (ref.startsWith('data:')) return ref;

  // Absolute http(s) URL
  if (/^https?:\/\//i.test(ref)) {
    // Rewrite URLs that point at *another* proxy host so we don't make
    // the client try to fetch localhost:3001 while running on a
    // different origin.
    if (ctx.runtime !== 'native' && ctx.proxyBaseUrl
      && (ref.includes('/generated-stories/') || ref.includes('/ref-images/'))) {
      const base = ctx.proxyBaseUrl.replace(/\/+$/, '');
      return ref.replace(/^https?:\/\/[^/]+/i, base);
    }
    return ref;
  }

  // Relative path like "generated-stories/foo/..."
  const normalised = ref.replace(/^\/+/, '');
  if (ctx.runtime === 'native' && ctx.storyDirAbs
    && (normalised.startsWith('generated-stories/') || normalised.startsWith('ref-images/'))) {
    // Native uses absolute disk paths; fall back to the string as-is.
    return `file://${normalised}`;
  }
  if (ctx.proxyBaseUrl
    && (normalised.startsWith('generated-stories/') || normalised.startsWith('ref-images/'))) {
    const base = ctx.proxyBaseUrl.replace(/\/+$/, '');
    return `${base}/${normalised}`;
  }
  return ref;
}
