/**
 * Re-export of the AssetRef type + schema that lives in
 * `src/ai-agents/codec/assetIndex.ts` so consumers can import the
 * primitive from a media-neutral location (`src/assets/*`).
 */

export {
  AssetKindSchema,
  AssetRefSchema,
  AssetIndexSchema,
  isAssetRef,
} from '../ai-agents/codec/assetIndex';
export type {
  AssetKind,
  AssetRef,
  AssetIndex,
  MediaRefInput,
} from '../ai-agents/codec/assetIndex';

import { isAssetRef } from '../ai-agents/codec/assetIndex';
import type { AssetRef } from '../ai-agents/codec/assetIndex';

/**
 * A `MediaRef` may be either a legacy string URL/path or an
 * `AssetRef` object (content-addressed). Consumers that only need a
 * plain string (for `img.src`, `endsWith` checks, etc.) can call this
 * helper instead of pattern-matching everywhere.
 *
 * At the UI layer the client has already run `resolveStoryMedia`,
 * which turns every media field into a string. This helper is the
 * type-level escape hatch that matches that runtime reality: it never
 * returns an AssetRef.
 */
export function mediaRefAsString(
  ref: string | AssetRef | null | undefined,
): string {
  if (ref == null) return '';
  if (typeof ref === 'string') return ref;
  if (isAssetRef(ref)) return ref.externalUrl || '';
  return '';
}
