/**
 * LoRA trainer adapter interface — the single seam between the
 * `LoraTrainingAgent` and any concrete training backend (kohya_ss,
 * A1111 Dreambooth extension, ComfyUI training workflows, hosted fine-tuners,
 * etc.).
 *
 * Design goals mirror `StableDiffusionAdapter`:
 *  - Keep the training agent free of backend-specific branching.
 *  - Make it trivial to add new backends by implementing this interface and
 *    registering the adapter in the factory.
 *  - Present identical shapes regardless of where the training actually runs,
 *    so the rest of the pipeline (dataset builder, registry, merge into
 *    `StableDiffusionSettings`) never has to care.
 *
 * Only the Stable Diffusion inference path can *consume* trained LoRAs today
 * (see `providerCapabilities.supportsLoraTraining`). Non-SD providers short
 * circuit before reaching an adapter at all.
 */

/**
 * Kind of LoRA being trained. Drives captioning, trigger-token selection,
 * regularization image selection, and the registry sub-directory the
 * resulting `.safetensors` lands in.
 */
export type LoraTrainingKind = 'character' | 'style';

/** One labeled training sample. Captions are optional — some trainers auto-caption. */
export interface LoraTrainingImage {
  /** Absolute or workspace-relative path to the image on disk. */
  path: string;
  /** Optional caption text. Passed through verbatim to the trainer. */
  caption?: string;
  /** MIME type, if known, used for uploads that need a content type. */
  mimeType?: string;
}

/** Knobs forwarded to the trainer. Defaults handled by the adapter. */
export interface LoraTrainingHyperparameters {
  /** Base model to train on top of (e.g. `sd_xl_base_1.0.safetensors`). */
  baseModel?: string;
  /** Total optimizer steps. */
  steps?: number;
  /** LoRA rank (network dim). Typical 16-64 for characters, 8-32 for styles. */
  rank?: number;
  /** Network alpha. Defaults to rank when omitted. */
  networkAlpha?: number;
  /** Unet / text-encoder learning rate. */
  learningRate?: number;
  /** Batch size. */
  batchSize?: number;
  /** Resolution for training samples (square edge, e.g. 1024). */
  resolution?: number;
  /** Number of times each image is seen per epoch. */
  repeats?: number;
  /** Optimizer id (e.g. `adamw8bit`, `prodigy`). */
  optimizer?: string;
  /** LR scheduler id (e.g. `cosine`, `constant`). */
  scheduler?: string;
  /** Deterministic training seed. */
  seed?: number;
  /** Mixed precision mode (`fp16` | `bf16` | `no`). */
  mixedPrecision?: string;
  /** Save the trained weights in this format (`safetensors` recommended). */
  saveFormat?: 'safetensors' | 'ckpt';
}

/** Request envelope handed to an adapter. */
export interface LoraTrainingRequest {
  /** Story this training belongs to (used for per-story registry paths). */
  storyId: string;
  /** Training kind (character vs style). */
  kind: LoraTrainingKind;
  /**
   * Stable fingerprint derived from inputs (identity fingerprint for
   * characters, style-DNA hash for styles). Adapter treats this as opaque
   * but should echo it back on `LoraJobHandle` so callers can correlate.
   */
  fingerprint: string;
  /**
   * Canonical name for the resulting LoRA. Must be safe for filesystem and
   * for A1111's inline `<lora:name:weight>` tag — letters, digits, `-`, `_`.
   */
  name: string;
  /**
   * Trigger token embedded into every caption. For character LoRAs this is
   * typically `<name>_${shortFingerprint}`; for style LoRAs the
   * `ArtStyleProfile.name` slug. Adapters are responsible for ensuring each
   * caption contains it.
   */
  trigger: string;
  /** The actual training images + captions. */
  images: LoraTrainingImage[];
  /** Optional regularization / class images (category sanity anchors). */
  regularization?: LoraTrainingImage[];
  /** Training knobs, merged over adapter defaults. */
  hyperparameters?: LoraTrainingHyperparameters;
  /** Freeform metadata persisted alongside the artifact for diagnostics. */
  metadata?: Record<string, unknown>;
}

export type LoraTrainingJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** Handle returned from `train()` and consumed by `pollStatus` / `fetchArtifact`. */
export interface LoraJobHandle {
  jobId: string;
  storyId: string;
  name: string;
  kind: LoraTrainingKind;
  fingerprint: string;
}

/** Snapshot of a job's progress. */
export interface LoraJobStatus {
  state: LoraTrainingJobState;
  /** 0..1 progress when known, undefined when the backend doesn't report it. */
  progress?: number;
  /** Current training step, when known. */
  step?: number;
  /** Total training steps, when known. */
  totalSteps?: number;
  /** Human-readable status line for the UI / logs. */
  message?: string;
  /** Populated on `failed`. */
  error?: string;
}

/**
 * The trained artifact plus enough metadata to land it into the A1111 model
 * folder and persist it in the LoraRegistry. Either `filePath` (when the
 * trainer shares a filesystem with the app) or `data` (when we need to
 * download bytes over HTTP) must be set.
 */
export interface LoraArtifact {
  name: string;
  kind: LoraTrainingKind;
  fingerprint: string;
  storyId: string;
  /** Absolute filesystem path to the produced `.safetensors`, if available. */
  filePath?: string;
  /** Base64 encoded bytes, when the adapter returns the file inline. */
  data?: string;
  /** File byte length (informational; helps UI sanity check downloads). */
  sizeBytes?: number;
  /** Arbitrary extra fields the trainer emitted (loss curves, etc.). */
  metadata?: Record<string, unknown>;
}

/** Adapter status check, used for preflight and UI readiness indicators. */
export interface LoraTrainerPreflightResult {
  ok: boolean;
  /** When `ok` is false, a short description of the failure. */
  message?: string;
  /** Optional backend version string. */
  version?: string;
  /**
   * Known base models the trainer can target. Useful for UI dropdowns but
   * optional — adapters can return `undefined` when discovery isn't
   * supported.
   */
  availableBaseModels?: string[];
}

export interface LoraTrainerAdapter {
  /** Stable identifier used in logs and registry metadata. */
  readonly id: string;

  /**
   * Submit a new training job. Implementations should *not* block on the
   * actual training run — they return a handle that the caller then polls.
   */
  train(request: LoraTrainingRequest): Promise<LoraJobHandle>;

  /** Fetch the current status of a job. */
  pollStatus(handle: LoraJobHandle): Promise<LoraJobStatus>;

  /**
   * Retrieve the final artifact for a succeeded job. Calling this before the
   * job reaches `succeeded` should throw a clear error.
   */
  fetchArtifact(handle: LoraJobHandle): Promise<LoraArtifact>;

  /**
   * Make the artifact available to the SD inference backend. For a shared
   * filesystem this might symlink/copy the file into `models/Lora`; for
   * isolated deployments it could upload or point the backend at a URL.
   * Implementations may no-op when installation is automatic.
   */
  installArtifact(artifact: LoraArtifact): Promise<void>;

  /** Cancel a running job. Adapters without cancellation may throw. */
  cancel?(handle: LoraJobHandle): Promise<void>;

  /** Canary health check; should be cheap and not start a training run. */
  preflight(): Promise<LoraTrainerPreflightResult>;
}
