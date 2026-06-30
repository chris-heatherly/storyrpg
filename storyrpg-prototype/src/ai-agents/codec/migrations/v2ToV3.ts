/**
 * v2 → v3 migration
 *
 * v2 = `{ schemaVersion: 2, storyId, createdAt, generator?, story }`.
 *      Media references are plain strings.
 * v3 = v2 + `assets: AssetIndex`. Media refs may be either legacy
 *      strings OR `AssetRef` objects — the v2→v3 structural lift does
 *      not rewrite them. The on-disk migrator
 *      (`scripts/migrate-stories.ts`) runs a second pass that ingests
 *      each referenced file into `assets/` and rewrites the ref to an
 *      `AssetRef` keyed by sha256.
 *
 * Keeping the structural lift and the media ingest pass separate
 * means the in-memory codec (which has no filesystem) can still walk
 * any story body without paying for disk I/O.
 */

import { StoryPackageV2Schema, type StoryPackageV2, StoryPackageV3Schema, type StoryPackageV3, StoryValidationError } from '../storyCodec';
import type { AssetIndex } from '../assetIndex';

export interface V2ToV3Options {
  /** An optional `AssetIndex` to attach to the migrated package. */
  assets?: AssetIndex;
}

export interface V2ToV3Result {
  migrated: StoryPackageV3;
  notes: string[];
}

export function migrateV2ToV3(rawV2: unknown, options: V2ToV3Options = {}): V2ToV3Result {
  const parsed = StoryPackageV2Schema.safeParse(rawV2);
  if (!parsed.success) {
    throw new StoryValidationError(
      'v2→v3: input failed v2 self-validation',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      2,
    );
  }
  const notes: string[] = [];
  const v3: StoryPackageV3 = {
    schemaVersion: 3,
    storyId: parsed.data.storyId,
    createdAt: parsed.data.createdAt,
    generator: parsed.data.generator,
    story: parsed.data.story,
    assets: options.assets ?? {},
  };
  if (!options.assets) {
    notes.push('assets index empty; run scripts/migrate-stories.ts to content-address media refs');
  }
  const validated = StoryPackageV3Schema.safeParse(v3);
  if (!validated.success) {
    throw new StoryValidationError(
      'v2→v3: produced package failed v3 self-validation',
      validated.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      3,
    );
  }
  return { migrated: validated.data, notes };
}
