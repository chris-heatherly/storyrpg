/**
 * v1 → v2 migration
 *
 * v1 = in-the-wild `08-final-story.json` produced by older pipelines.
 *      It has no `schemaVersion` and is the bare `Story` object.
 * v2 = `{ schemaVersion: 2, storyId, createdAt, generator?, story }`.
 *
 * The migration is purely structural: no media refs are touched.
 * The returned object is a valid `StoryPackageV2` and is guaranteed
 * to decode through `decodeStory` again.
 */

import { z } from 'zod';
import { StoryPackageV2Schema, type StoryPackageV2, StoryValidationError } from '../storyCodec';

const V1StorySchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  genre: z.string().optional(),
  synopsis: z.string().optional(),
  episodes: z.array(z.unknown()).default([]),
}).passthrough();

export interface V1ToV2Result {
  migrated: StoryPackageV2;
  notes: string[];
}

export function migrateV1ToV2(rawV1: unknown, opts: { createdAt?: string; pipelineTag?: string } = {}): V1ToV2Result {
  const parsed = V1StorySchema.safeParse(rawV1);
  if (!parsed.success) {
    throw new StoryValidationError(
      'v1→v2: input does not look like a v1 Story',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      1,
    );
  }

  const notes: string[] = [];
  if (!parsed.data.title) notes.push('story.title was missing; defaulting to empty string');
  if (!parsed.data.genre) notes.push('story.genre was missing; defaulting to empty string');
  if (!parsed.data.synopsis) notes.push('story.synopsis was missing; defaulting to empty string');

  const v2: StoryPackageV2 = {
    schemaVersion: 2,
    storyId: parsed.data.id,
    createdAt: opts.createdAt ?? new Date(0).toISOString(),
    generator: { pipeline: opts.pipelineTag ?? 'migration-v1-to-v2' },
    story: {
      ...parsed.data,
      title: parsed.data.title ?? '',
      genre: parsed.data.genre ?? '',
      synopsis: parsed.data.synopsis ?? '',
    },
  };

  const validated = StoryPackageV2Schema.safeParse(v2);
  if (!validated.success) {
    throw new StoryValidationError(
      'v1→v2: produced package failed v2 self-validation',
      validated.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      2,
    );
  }
  return { migrated: validated.data, notes };
}
