/**
 * LoRA artifact registry.
 *
 * Persists the `.safetensors` + metadata produced by `LoraTrainerAdapter` for
 * each story so subsequent runs reuse the same trained weights rather than
 * paying for retraining. Designed to live alongside
 * `generated-stories/<storyId>/loras/`:
 *
 *   generated-stories/<storyId>/loras/
 *     ├── character/
 *     │   ├── char_hero_abcdef12.safetensors
 *     │   └── char_hero_abcdef12.meta.json
 *     └── style/
 *         ├── style_graphic_novel_ink.safetensors
 *         └── style_graphic_novel_ink.meta.json
 *
 * Each `.meta.json` captures the fingerprint the LoRA was trained for, the
 * character name or style slug it serves, hyperparameters, and a timestamp
 * so `invalidateStaleLoras` can purge mismatches quickly.
 *
 * The module is split into two layers:
 *   - Pure helpers: fingerprint + merge. Fully unit-testable, used by every
 *     consumer including the browser UI.
 *   - `LoraRegistry` class: optional FS-backed persistence. Only used by
 *     pipeline/worker code that has `fs/promises` available. Fails loudly
 *     (rather than silently no-oping) when fs is missing, so callers decide
 *     whether to skip registry writes when running in a bundle.
 */

import type {
  LoraArtifact,
  LoraTrainingKind,
} from '../services/lora-training/LoraTrainerAdapter';
import type {
  ArtStyleProfile,
} from './artStyleProfile';
import type {
  LoraHyperparameters,
  StableDiffusionLoraRef,
  StableDiffusionSettings,
} from '../config';

/** Serialized metadata stored alongside each `.safetensors`. */
export interface LoraRegistryRecord {
  /** LoRA filename stem (no extension, no path) — matches inline `<lora:name:...>`. */
  name: string;
  kind: LoraTrainingKind;
  /** Stable hash of the training inputs. */
  fingerprint: string;
  /** For character LoRAs: canonical character name used in prompts. */
  characterName?: string;
  /** For style LoRAs: readable style slug (debug aid, not used for lookup). */
  styleName?: string;
  /** Recommended inference weight (A1111 `<lora:name:weight>`). Defaults to 0.8. */
  weight?: number;
  /** Absolute or workspace-relative path to the `.safetensors`. */
  filePath: string;
  /** Byte length at time of registration, when known. */
  sizeBytes?: number;
  /** Hyperparameters the trainer actually used. */
  hyperparameters?: LoraHyperparameters;
  /** Adapter id that produced the file (for diagnostics). */
  trainerId?: string;
  /** ISO timestamp when the record was written. */
  createdAt: string;
}

export interface LoraRegistrySnapshot {
  storyId: string;
  /** Keyed by record name so merge operations can dedupe cleanly. */
  records: Record<string, LoraRegistryRecord>;
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/** Stable subset of the fields that uniquely identify a character LoRA. */
export interface CharacterFingerprintInput {
  characterId: string;
  name: string;
  /** Identity fingerprint from `computeCharacterIdentityFingerprint` in ImageAgentTeam. */
  identityFingerprint: string;
  hyperparameters?: LoraHyperparameters;
}

/** Stable subset of the fields that uniquely identify a style LoRA. */
export interface StyleFingerprintInput {
  profile: ArtStyleProfile;
  /** Content hash of every anchor image, sorted for stability. */
  anchorHashes: string[];
  hyperparameters?: LoraHyperparameters;
}

export function computeCharacterLoraFingerprint(
  input: CharacterFingerprintInput,
): string {
  const seed = JSON.stringify([
    'character',
    input.characterId.toLowerCase(),
    input.name.toLowerCase(),
    input.identityFingerprint,
    normalizeHyperparams(input.hyperparameters),
  ]);
  return sha1Hex(seed);
}

export function computeStyleLoraFingerprint(input: StyleFingerprintInput): string {
  const seed = JSON.stringify([
    'style',
    {
      name: (input.profile.name || '').toLowerCase(),
      family: input.profile.family,
      renderingTechnique: input.profile.renderingTechnique,
      colorPhilosophy: input.profile.colorPhilosophy,
      lightingApproach: input.profile.lightingApproach,
      lineWeight: input.profile.lineWeight,
      compositionStyle: input.profile.compositionStyle,
      positiveVocabulary: [...(input.profile.positiveVocabulary || [])].sort(),
    },
    [...input.anchorHashes].sort(),
    normalizeHyperparams(input.hyperparameters),
  ]);
  return sha1Hex(seed);
}

function normalizeHyperparams(
  hyper: LoraHyperparameters | undefined,
): Record<string, unknown> {
  if (!hyper) return {};
  return {
    rank: hyper.rank,
    networkAlpha: hyper.networkAlpha,
    steps: hyper.steps,
    learningRate: hyper.learningRate,
    batchSize: hyper.batchSize,
    resolution: hyper.resolution,
    repeats: hyper.repeats,
    optimizer: hyper.optimizer,
    scheduler: hyper.scheduler,
    mixedPrecision: hyper.mixedPrecision,
    seed: hyper.seed,
    baseModel: hyper.baseModel,
  };
}

/**
 * Tiny deterministic hex hash. Prefers Node's `crypto.createHash` when
 * available (pipeline/worker context) and falls back to a FNV-1a loop when
 * running in a bundle that shims crypto out. Exported for callers that need
 * to compute their own anchor hashes.
 */
export function sha1Hex(input: string): string {
  try {
    const req: any = (Function('return typeof require !== "undefined" ? require : null'))();
    if (req) {
      const crypto = req('crypto');
      return crypto.createHash('sha1').update(input).digest('hex');
    }
  } catch {
    // fall through
  }
  return fnvHex(input);
}

function fnvHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Merge helpers — the one-line seam into StableDiffusionSettings
// ---------------------------------------------------------------------------

/**
 * Fold registry records into an existing `StableDiffusionSettings`, producing
 * a new settings object with `styleLoras` and `characterLoraByName` populated.
 * Values in the base settings win on conflict so UI-provided LoRAs are never
 * clobbered by the auto-trained ones.
 */
export function mergeIntoStableDiffusionSettings(
  base: StableDiffusionSettings | undefined,
  snapshot: LoraRegistrySnapshot,
): StableDiffusionSettings {
  const result: StableDiffusionSettings = { ...(base || {}) };
  const styleLoras: StableDiffusionLoraRef[] = [...(result.styleLoras || [])];
  const characterLoraByName: Record<string, StableDiffusionLoraRef> = {
    ...(result.characterLoraByName || {}),
  };
  const styleNames = new Set(styleLoras.map((l) => l.name.toLowerCase()));

  for (const record of Object.values(snapshot.records)) {
    const weight = Number.isFinite(record.weight) ? (record.weight as number) : 0.8;
    if (record.kind === 'style') {
      if (!styleNames.has(record.name.toLowerCase())) {
        styleLoras.push({ name: record.name, weight });
        styleNames.add(record.name.toLowerCase());
      }
      continue;
    }
    if (record.kind === 'character' && record.characterName) {
      if (!characterLoraByName[record.characterName]) {
        characterLoraByName[record.characterName] = { name: record.name, weight };
      }
    }
  }

  result.styleLoras = styleLoras.length > 0 ? styleLoras : result.styleLoras;
  result.characterLoraByName =
    Object.keys(characterLoraByName).length > 0 ? characterLoraByName : result.characterLoraByName;
  return result;
}

/**
 * Convenience: empty registry snapshot for tests and for the "no LoRAs yet"
 * initial state on a fresh story.
 */
export function emptySnapshot(storyId: string): LoraRegistrySnapshot {
  return { storyId, records: {} };
}

// ---------------------------------------------------------------------------
// FS-backed registry
// ---------------------------------------------------------------------------

/** Dependency surface so the registry can be unit-tested without touching disk. */
export interface LoraRegistryIO {
  ensureDir(dirPath: string): Promise<void>;
  writeBytes(filePath: string, base64: string): Promise<void>;
  writeText(filePath: string, text: string): Promise<void>;
  readText(filePath: string): Promise<string | undefined>;
  exists(filePath: string): Promise<boolean>;
  listDir(dirPath: string): Promise<string[]>;
  remove(filePath: string): Promise<void>;
  joinPath(base: string, ...parts: string[]): string;
}

/** Per-story registry rooted at `generated-stories/<storyId>/loras/`. */
export class LoraRegistry {
  readonly storyId: string;
  readonly rootDir: string;
  private readonly io: LoraRegistryIO;
  private snapshot: LoraRegistrySnapshot;

  constructor(storyId: string, rootDir: string, io: LoraRegistryIO) {
    this.storyId = storyId;
    this.rootDir = rootDir;
    this.io = io;
    this.snapshot = emptySnapshot(storyId);
  }

  getSnapshot(): LoraRegistrySnapshot {
    return this.snapshot;
  }

  findByFingerprint(fingerprint: string): LoraRegistryRecord | undefined {
    for (const record of Object.values(this.snapshot.records)) {
      if (record.fingerprint === fingerprint) return record;
    }
    return undefined;
  }

  findByCharacterName(name: string): LoraRegistryRecord | undefined {
    for (const record of Object.values(this.snapshot.records)) {
      if (record.kind === 'character' && record.characterName === name) return record;
    }
    return undefined;
  }

  findStyleLora(): LoraRegistryRecord | undefined {
    for (const record of Object.values(this.snapshot.records)) {
      if (record.kind === 'style') return record;
    }
    return undefined;
  }

  /**
   * Hydrate the in-memory snapshot from `<rootDir>/*.meta.json`. Safe to call
   * repeatedly; it discards any records whose `.safetensors` file is missing.
   */
  async load(): Promise<LoraRegistrySnapshot> {
    const records: Record<string, LoraRegistryRecord> = {};
    for (const kind of ['character', 'style'] as LoraTrainingKind[]) {
      const subdir = this.io.joinPath(this.rootDir, kind);
      const names = await safeListDir(this.io, subdir);
      for (const fileName of names) {
        if (!fileName.endsWith('.meta.json')) continue;
        const metaPath = this.io.joinPath(subdir, fileName);
        const text = await this.io.readText(metaPath).catch(() => undefined);
        if (!text) continue;
        try {
          const parsed = JSON.parse(text) as LoraRegistryRecord;
          if (!parsed?.name || parsed.kind !== kind) continue;
          const safetensorsPath = this.io.joinPath(subdir, `${parsed.name}.safetensors`);
          if (!(await this.io.exists(safetensorsPath))) continue;
          parsed.filePath = safetensorsPath;
          records[parsed.name] = parsed;
        } catch {
          // ignore malformed meta files
        }
      }
    }
    this.snapshot = { storyId: this.storyId, records };
    return this.snapshot;
  }

  /** Persist an artifact fetched from a `LoraTrainerAdapter`. */
  async register(
    artifact: LoraArtifact,
    extras: {
      characterName?: string;
      styleName?: string;
      hyperparameters?: LoraHyperparameters;
      trainerId?: string;
      weight?: number;
    } = {},
  ): Promise<LoraRegistryRecord> {
    const subdir = this.io.joinPath(this.rootDir, artifact.kind);
    await this.io.ensureDir(subdir);
    const safetensorsPath = this.io.joinPath(subdir, `${artifact.name}.safetensors`);
    const metaPath = this.io.joinPath(subdir, `${artifact.name}.meta.json`);

    if (artifact.data) {
      await this.io.writeBytes(safetensorsPath, artifact.data);
    } else if (artifact.filePath && artifact.filePath !== safetensorsPath) {
      // Adapter already placed the file somewhere; we record its path but
      // don't move the bytes. This covers kohya sidecars that share a
      // filesystem with A1111 and write directly into models/Lora.
    }

    const record: LoraRegistryRecord = {
      name: artifact.name,
      kind: artifact.kind,
      fingerprint: artifact.fingerprint,
      characterName: extras.characterName,
      styleName: extras.styleName,
      weight: extras.weight ?? 0.8,
      filePath: artifact.filePath || safetensorsPath,
      sizeBytes: artifact.sizeBytes,
      hyperparameters: extras.hyperparameters,
      trainerId: extras.trainerId,
      createdAt: new Date().toISOString(),
    };
    await this.io.writeText(metaPath, `${JSON.stringify(record, null, 2)}\n`);
    this.snapshot.records[record.name] = record;
    return record;
  }

  /** Remove any records whose fingerprint no longer matches the supplied set. */
  async prune(validFingerprints: Set<string>): Promise<LoraRegistryRecord[]> {
    const removed: LoraRegistryRecord[] = [];
    for (const record of Object.values(this.snapshot.records)) {
      if (validFingerprints.has(record.fingerprint)) continue;
      await safeRemove(this.io, record.filePath);
      const metaPath = record.filePath.replace(/\.safetensors$/, '.meta.json');
      await safeRemove(this.io, metaPath);
      delete this.snapshot.records[record.name];
      removed.push(record);
    }
    return removed;
  }

  /** Convenience wrapper around `mergeIntoStableDiffusionSettings`. */
  mergeIntoStableDiffusionSettings(
    base: StableDiffusionSettings | undefined,
  ): StableDiffusionSettings {
    return mergeIntoStableDiffusionSettings(base, this.snapshot);
  }
}

async function safeListDir(io: LoraRegistryIO, dirPath: string): Promise<string[]> {
  try {
    return await io.listDir(dirPath);
  } catch {
    return [];
  }
}

async function safeRemove(io: LoraRegistryIO, filePath: string): Promise<void> {
  try {
    await io.remove(filePath);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Default Node.js IO implementation
// ---------------------------------------------------------------------------

/**
 * Build an `LoraRegistryIO` backed by `fs/promises`. Only usable in the
 * Node/worker context — the browser bundle must supply its own (or stick to
 * the pure helpers above).
 */
export function createNodeLoraRegistryIO(): LoraRegistryIO {
  const req: any = (Function('return typeof require !== "undefined" ? require : null'))();
  if (!req) {
    throw new Error('createNodeLoraRegistryIO() called outside of Node.js');
  }
  const fs = req('fs/promises');
  const path = req('path');
  return {
    async ensureDir(dirPath: string) {
      await fs.mkdir(dirPath, { recursive: true });
    },
    async writeBytes(filePath: string, base64: string) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
    },
    async writeText(filePath: string, text: string) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, text, 'utf8');
    },
    async readText(filePath: string) {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    async exists(filePath: string) {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    async listDir(dirPath: string) {
      try {
        return await fs.readdir(dirPath);
      } catch {
        return [];
      }
    },
    async remove(filePath: string) {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    },
    joinPath: (base: string, ...parts: string[]) => path.join(base, ...parts),
  };
}
