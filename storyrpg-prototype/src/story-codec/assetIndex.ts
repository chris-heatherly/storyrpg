/**
 * AssetIndex — the sha256-keyed table of media metadata that lives next
 * to `story` inside a v3 StoryPackage. Entries are pure JSON and carry
 * just enough to let a resolver emit a URL, a validator check that the
 * file exists on disk, and a consumer make layout decisions (width,
 * height, duration).
 *
 * v1 / v2 stories have no AssetIndex — their media references are
 * string paths. The codec produces an empty index for those and
 * migrate2to3 populates it from disk during the per-story upgrade.
 */

import { z } from 'zod';

export const AssetKindSchema = z.enum(['image', 'audio', 'video', 'prompt', 'alignment']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetRefSchema = z.object({
  kind: AssetKindSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be lowercase hex of length 64'),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
  alignmentSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /**
   * Rare escape hatch: an external provider URL that can be re-hydrated
   * into `assets/` on first use. Should be null for content produced
   * by our own pipeline.
   */
  externalUrl: z.string().url().optional(),
  /**
   * Optional origin hint — model / seed / prompt-sha used to produce
   * this asset. Lives here (not diagnostics/) so regeneration is cheap.
   */
  origin: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    seed: z.number().optional(),
    promptSha256: z.string().optional(),
  }).partial().optional(),
}).strict();

export type AssetRef = z.infer<typeof AssetRefSchema>;

export const AssetIndexSchema = z.record(z.string(), AssetRefSchema);
export type AssetIndex = z.infer<typeof AssetIndexSchema>;

export function isAssetRef(value: unknown): value is AssetRef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.sha256 === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.kind === 'string';
}

/**
 * An AssetRef or a legacy string path. Beat.image etc. are still typed
 * as strings in the source Story types; the codec understands both
 * forms on input and normalises media refs on output depending on the
 * target schema version.
 */
export type MediaRefInput = string | AssetRef | null | undefined;
