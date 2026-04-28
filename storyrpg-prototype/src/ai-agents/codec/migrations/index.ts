/**
 * Migration barrel export.
 *
 * Kept separate from `storyCodec.ts` so the codec stays focused on
 * decode/encode/project contracts and the migration logic can grow
 * independently (and be unit-tested in isolation).
 */

export { migrateV1ToV2, type V1ToV2Result } from './v1ToV2';
export { migrateV2ToV3, type V2ToV3Result, type V2ToV3Options } from './v2ToV3';
