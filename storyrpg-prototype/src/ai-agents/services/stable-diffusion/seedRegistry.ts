/**
 * Deterministic seed registry for Stable Diffusion.
 *
 * Problem: SD's biggest consistency lever is the seed — same prompt + same
 * seed + same model = visually identical output. But we're generating across
 * many scenes, characters, and retries, and we don't want to hand-author
 * seeds everywhere.
 *
 * Solution: hash the relevant identity tuple (character id / scene id /
 * character+scene) into a stable 32-bit integer. Callers pass `SeedKey`
 * and get back the same seed across runs.
 *
 * Scopes:
 *  - `character`   — locks a character's face/body across all scenes.
 *  - `scene`       — locks scene master composition across regens.
 *  - `characterInScene` — per-appearance seed; handy when a character's pose
 *    must be identical between scene master and beat panels.
 *  - `anchor`      — caller-provided raw key (style bible, cover art, etc.).
 */

export interface SeedKey {
  scope: 'character' | 'scene' | 'characterInScene' | 'anchor';
  characterId?: string;
  sceneId?: string;
  raw?: string;
}

/**
 * Simple non-crypto 32-bit FNV-1a. Good enough for bucketing — we don't need
 * collision resistance, we need repeatable output across Node and RN bundles.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function keyToString(key: SeedKey, namespace: string): string {
  switch (key.scope) {
    case 'character':
      return `${namespace}|char|${key.characterId || ''}`;
    case 'scene':
      return `${namespace}|scene|${key.sceneId || ''}`;
    case 'characterInScene':
      return `${namespace}|cis|${key.characterId || ''}|${key.sceneId || ''}`;
    case 'anchor':
      return `${namespace}|anchor|${key.raw || ''}`;
  }
}

/**
 * Registry keeps a per-namespace memoization map. Namespacing lets distinct
 * stories live in the same process without colliding (e.g. while batching).
 */
export class SeedRegistry {
  private cache = new Map<string, number>();

  constructor(private readonly namespace: string = 'default') {}

  get(key: SeedKey): number {
    const str = keyToString(key, this.namespace);
    const cached = this.cache.get(str);
    if (cached !== undefined) return cached;
    // A1111 accepts any 32-bit unsigned int; keep it positive so the UI
    // displays something sensible if surfaced.
    const seed = fnv1a(str);
    this.cache.set(str, seed);
    return seed;
  }

  /** Override a seed (e.g. user pinned a favorite from the gallery). */
  set(key: SeedKey, seed: number): void {
    this.cache.set(keyToString(key, this.namespace), seed >>> 0);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Module-level singleton for pipelines that don't want to manage their own
 * registry. Namespaced to `default` so tests can reset it cleanly.
 */
let defaultRegistry: SeedRegistry | null = null;

export function getDefaultSeedRegistry(): SeedRegistry {
  if (!defaultRegistry) defaultRegistry = new SeedRegistry('default');
  return defaultRegistry;
}

export function resetDefaultSeedRegistry(): void {
  defaultRegistry = null;
}
