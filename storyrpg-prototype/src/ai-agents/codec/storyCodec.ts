/**
 * StoryCodec — the single source of truth for Story serialisation.
 *
 * Responsibilities:
 *   - `decodeStory(raw)`        parse + migrate + validate anything we
 *                               pull off disk / the wire into a typed
 *                               `StoryPackage { story, assets, meta }`.
 *   - `encodeStory(story, ...)` produce the on-disk JSON shape.
 *   - `projectForTransfer(...)` strip diagnostics/checkpoints by schema,
 *                               not by string-matching.
 *   - `projectForCatalog(...)`  build the small catalog entry shape.
 *
 * The codec is deliberately *permissive on input* — we use
 * `z.passthrough()` for the nested Story body so that new fields added
 * to `src/types/*.ts` don't require a codec bump just to round-trip.
 * Only invariants we actively depend on (schemaVersion, top-level
 * shape, id, episodes array-of-objects, AssetRef well-formedness) are
 * enforced strictly.
 */

import { z } from 'zod';
import type { Story } from '../../types';
import { AssetIndexSchema, type AssetIndex, AssetRefSchema } from './assetIndex';

// ------------------------------------------------------------
// Version identifiers
// ------------------------------------------------------------

export const STORY_SCHEMA_VERSION = 3 as const;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3] as const;
export type StorySchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

// ------------------------------------------------------------
// Error type
// ------------------------------------------------------------

export class StoryValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string }>;
  public readonly detectedVersion: number | null;
  constructor(message: string, issues: Array<{ path: string; message: string }>, detectedVersion: number | null) {
    super(message);
    this.name = 'StoryValidationError';
    this.issues = issues;
    this.detectedVersion = detectedVersion;
  }
}

function zodIssuesToPaths(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

// ------------------------------------------------------------
// Internal Story body schema (permissive)
// ------------------------------------------------------------

const StoryBodySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  genre: z.string(),
  synopsis: z.string(),
  episodes: z.array(z.unknown()),
}).passthrough();

// ------------------------------------------------------------
// v3 package shape (on-disk target)
// ------------------------------------------------------------

export const StoryPackageV3Schema = z.object({
  schemaVersion: z.literal(3),
  storyId: z.string().min(1),
  createdAt: z.string(),
  generator: z.object({
    version: z.string().optional(),
    pipeline: z.string().optional(),
  }).partial().optional(),
  story: StoryBodySchema,
  assets: AssetIndexSchema.default({}),
}).strict();

export type StoryPackageV3 = z.infer<typeof StoryPackageV3Schema>;

// v2 = identical to v3 minus assets index (media refs are still plain strings).
export const StoryPackageV2Schema = z.object({
  schemaVersion: z.literal(2),
  storyId: z.string().min(1),
  createdAt: z.string(),
  generator: z.object({
    version: z.string().optional(),
    pipeline: z.string().optional(),
  }).partial().optional(),
  story: StoryBodySchema,
}).strict();

export type StoryPackageV2 = z.infer<typeof StoryPackageV2Schema>;

// ------------------------------------------------------------
// Runtime view returned by decodeStory
// ------------------------------------------------------------

export interface StoryPackage {
  schemaVersion: StorySchemaVersion;
  storyId: string;
  createdAt: string;
  generator?: { version?: string; pipeline?: string };
  story: Story;
  assets: AssetIndex;
  /** true when the raw input was migrated to reach this package. */
  migrated: boolean;
  /** Source schemaVersion detected before any migration. */
  detectedSchemaVersion: 1 | 2 | 3;
}

export interface StoryWriteResult {
  path: string;
  sha256: string;
  bytes: number;
}

// ------------------------------------------------------------
// Version detection + migrations
// ------------------------------------------------------------

function detectVersion(raw: unknown): 1 | 2 | 3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const v = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : null;
  if (v === 1 || v === 2 || v === 3) return v;
  // v1 = raw Story object with no schemaVersion — detect by shape.
  if (typeof obj.id === 'string' && Array.isArray(obj.episodes)) return 1;
  return null;
}

function extractStoryBody(raw: unknown, version: 1 | 2 | 3): unknown {
  if (version === 1) return raw;
  const obj = raw as Record<string, unknown>;
  return obj.story;
}

function nowIso(): string {
  return new Date().toISOString();
}

function migrateV1toV2(rawStory: unknown): StoryPackageV2 {
  const parsed = StoryBodySchema.safeParse(rawStory);
  if (!parsed.success) {
    throw new StoryValidationError(
      'v1 migration: story body failed validation',
      zodIssuesToPaths(parsed.error),
      1,
    );
  }
  return {
    schemaVersion: 2,
    storyId: parsed.data.id,
    createdAt: nowIso(),
    generator: {},
    story: parsed.data,
  };
}

function migrateV2toV3(pkgV2: StoryPackageV2): StoryPackageV3 {
  // v2 → v3 is a shape-level lift that introduces an empty assets
  // index. Per-story content migration (ingesting media into
  // `assets/`) happens in the on-disk migrator (see
  // `migrations/v2ToV3.ts`); the codec itself only performs the
  // structural lift so in-memory payloads can round-trip.
  return {
    schemaVersion: 3,
    storyId: pkgV2.storyId,
    createdAt: pkgV2.createdAt,
    generator: pkgV2.generator,
    story: pkgV2.story,
    assets: {},
  };
}

// ------------------------------------------------------------
// Decode — the "parse and validate on every load boundary" function
// ------------------------------------------------------------

export interface DecodeOptions {
  /** When true, skip auto-migration and throw if the package is not the target version. */
  strictVersion?: boolean;
}

export function decodeStory(raw: unknown, options: DecodeOptions = {}): StoryPackage {
  const detected = detectVersion(raw);
  if (detected === null) {
    throw new StoryValidationError(
      'decodeStory: input does not look like a Story (missing id / episodes)',
      [{ path: '(root)', message: 'Unknown or missing schemaVersion and no v1-shaped body' }],
      null,
    );
  }

  if (options.strictVersion && detected !== STORY_SCHEMA_VERSION) {
    throw new StoryValidationError(
      `decodeStory: strictVersion=true requires schemaVersion=${STORY_SCHEMA_VERSION}, got ${detected}`,
      [{ path: 'schemaVersion', message: `expected ${STORY_SCHEMA_VERSION}, got ${detected}` }],
      detected,
    );
  }

  let pkgV3: StoryPackageV3;
  if (detected === 1) {
    const v2 = migrateV1toV2(extractStoryBody(raw, 1));
    pkgV3 = migrateV2toV3(v2);
  } else if (detected === 2) {
    const parsed = StoryPackageV2Schema.safeParse(raw);
    if (!parsed.success) {
      throw new StoryValidationError(
        'decodeStory: v2 package failed validation',
        zodIssuesToPaths(parsed.error),
        2,
      );
    }
    pkgV3 = migrateV2toV3(parsed.data);
  } else {
    const parsed = StoryPackageV3Schema.safeParse(raw);
    if (!parsed.success) {
      throw new StoryValidationError(
        'decodeStory: v3 package failed validation',
        zodIssuesToPaths(parsed.error),
        3,
      );
    }
    pkgV3 = parsed.data;
  }

  return {
    schemaVersion: pkgV3.schemaVersion,
    storyId: pkgV3.storyId,
    createdAt: pkgV3.createdAt,
    generator: pkgV3.generator,
    // Cast back to Story — the body is shape-validated against the
    // permissive StoryBodySchema which matches the public Story type
    // at the fields we enforce.
    story: pkgV3.story as unknown as Story,
    assets: pkgV3.assets ?? {},
    migrated: detected !== 3,
    detectedSchemaVersion: detected,
  };
}

// ------------------------------------------------------------
// Encode
// ------------------------------------------------------------

export interface EncodeOptions {
  /** Target schema version (defaults to current, 3). */
  targetVersion?: StorySchemaVersion;
  /** Override createdAt (defaults to now()). */
  createdAt?: string;
  /** Generator metadata; helpful for debugging stale artefacts. */
  generator?: { version?: string; pipeline?: string };
  /** Optional AssetIndex for v3; ignored for v1/v2. */
  assets?: AssetIndex;
}

export function encodeStory(
  story: Story,
  options: EncodeOptions = {},
): StoryPackageV1Raw | StoryPackageV2 | StoryPackageV3 {
  const targetVersion = options.targetVersion ?? STORY_SCHEMA_VERSION;
  const bodyParse = StoryBodySchema.safeParse(story);
  if (!bodyParse.success) {
    throw new StoryValidationError(
      'encodeStory: story body failed validation',
      zodIssuesToPaths(bodyParse.error),
      null,
    );
  }
  const body = bodyParse.data;

  if (targetVersion === 1) {
    return body as unknown as StoryPackageV1Raw;
  }

  if (targetVersion === 2) {
    const v2: StoryPackageV2 = {
      schemaVersion: 2,
      storyId: body.id,
      createdAt: options.createdAt ?? nowIso(),
      generator: options.generator ?? {},
      story: body,
    };
    const parsed = StoryPackageV2Schema.safeParse(v2);
    if (!parsed.success) {
      throw new StoryValidationError(
        'encodeStory(v2): failed self-validation',
        zodIssuesToPaths(parsed.error),
        2,
      );
    }
    return parsed.data;
  }

  const assets = options.assets ?? {};
  // Double-check every AssetRef we're emitting.
  for (const [sha, ref] of Object.entries(assets)) {
    if (sha !== ref.sha256) {
      throw new StoryValidationError(
        `encodeStory: assets["${sha}"].sha256 does not match its key`,
        [{ path: `assets.${sha}.sha256`, message: `expected ${sha}, got ${ref.sha256}` }],
        3,
      );
    }
    const refParse = AssetRefSchema.safeParse(ref);
    if (!refParse.success) {
      throw new StoryValidationError(
        `encodeStory: assets["${sha}"] is malformed`,
        zodIssuesToPaths(refParse.error),
        3,
      );
    }
  }

  const v3: StoryPackageV3 = {
    schemaVersion: 3,
    storyId: body.id,
    createdAt: options.createdAt ?? nowIso(),
    generator: options.generator ?? {},
    story: body,
    assets,
  };
  const parsed = StoryPackageV3Schema.safeParse(v3);
  if (!parsed.success) {
    throw new StoryValidationError(
      'encodeStory(v3): failed self-validation',
      zodIssuesToPaths(parsed.error),
      3,
    );
  }
  return parsed.data;
}

// v1 == a bare Story body written to disk as-is. Represented here as
// an opaque structural alias so the return type is honest.
export type StoryPackageV1Raw = Story;

// ------------------------------------------------------------
// Catalog & transfer projections
// ------------------------------------------------------------

export interface StoryCatalogEntryProjection {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  coverImage: string;
  author?: string;
  tags?: string[];
  episodeCount: number;
  episodes: Array<{
    id: string;
    number: number;
    title: string;
    synopsis: string;
    coverImage: string;
  }>;
}

export function projectForCatalog(pkg: StoryPackage): StoryCatalogEntryProjection {
  const { story } = pkg;
  return {
    id: story.id,
    title: story.title,
    genre: story.genre,
    synopsis: story.synopsis,
    coverImage: typeof story.coverImage === 'string' ? story.coverImage : '',
    author: story.author,
    tags: story.tags,
    episodeCount: Array.isArray(story.episodes) ? story.episodes.length : 0,
    episodes: Array.isArray(story.episodes)
      ? story.episodes.map((ep) => ({
          id: ep.id,
          number: ep.number,
          title: ep.title,
          synopsis: ep.synopsis,
          coverImage: typeof ep.coverImage === 'string' ? ep.coverImage : '',
        }))
      : [],
  };
}

/**
 * Build the payload sent from worker → proxy → client. Unlike the old
 * `sanitizePipelineResultForTransfer` (which walked keys by name
 * looking for `imageData`/`base64`/`data:` prefixes), this projection
 * is declarative: we emit *only* the fields we document as part of
 * the transfer contract. New fields added to the raw payload don't
 * leak by accident.
 */
export interface PipelineTransferPayload {
  story: Story;
  schemaVersion: StorySchemaVersion;
  storyId: string;
  assets: AssetIndex;
  events: unknown[];
  checkpointSummary: Array<{ phase: string; ts: string }>;
  success: boolean;
  error?: string;
}

export interface TransferProjectionOptions {
  maxEvents?: number;
}

export function projectForTransfer(
  pkg: StoryPackage,
  extras: {
    events?: unknown[];
    checkpointSummary?: Array<{ phase: string; ts: string }>;
    success?: boolean;
    error?: string;
  } = {},
  options: TransferProjectionOptions = {},
): PipelineTransferPayload {
  const maxEvents = options.maxEvents ?? 60;
  const events = Array.isArray(extras.events) ? extras.events.slice(-maxEvents) : [];
  return {
    schemaVersion: pkg.schemaVersion,
    storyId: pkg.storyId,
    assets: pkg.assets,
    story: pkg.story,
    events,
    checkpointSummary: extras.checkpointSummary ?? [],
    success: extras.success ?? true,
    error: extras.error,
  };
}

// ------------------------------------------------------------
// Convenience: parse-or-throw from raw buffer / string
// ------------------------------------------------------------

export function decodeStoryFromJson(raw: string | Buffer | Uint8Array, options?: DecodeOptions): StoryPackage {
  const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StoryValidationError(
      `decodeStoryFromJson: not valid JSON (${msg})`,
      [{ path: '(root)', message: msg }],
      null,
    );
  }
  return decodeStory(parsed, options);
}
