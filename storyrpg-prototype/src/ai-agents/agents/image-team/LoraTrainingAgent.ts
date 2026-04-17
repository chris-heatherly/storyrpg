/**
 * LoRA Training Agent
 *
 * Orchestrates auto-training of character and style LoRAs for the Stable
 * Diffusion inference path. Everything about this agent is designed to be
 * safe-by-default:
 *
 *  1. `shouldRun()` gates on the active image provider's
 *     `supportsLoraTraining` capability and the master `enabled` switch; on
 *     any other provider the whole subsystem transparently no-ops.
 *  2. Per-character and per-style eligibility heuristics (from
 *     `LoraTrainingSettings.characterThresholds` and `.styleThresholds`)
 *     filter out runs that wouldn't converge (too few refs, low-tier NPCs,
 *     single-episode stories unless forced).
 *  3. Jobs are submitted through a `LoraTrainerAdapter` (kohya sidecar by
 *     default). The agent polls until each job reaches `succeeded`/`failed`,
 *     then registers the artifact via `LoraRegistry` and installs it.
 *  4. The returned `LoraTrainingReport` is merged back into
 *     `StableDiffusionSettings.styleLoras` / `.characterLoraByName` by the
 *     caller so the existing `buildSDPrompt` path keeps emitting `<lora:...>`
 *     tags with zero additional surgery.
 *
 * The agent deliberately does not persist any partial state outside the
 * registry; a failed run leaves the pipeline exactly where it started.
 */

import type {
  LoraTrainingSettings,
  StableDiffusionSettings,
  LoraHyperparameters,
  ImageProvider,
} from '../../config';
import {
  providerSupportsLoraTraining,
} from '../../images/providerCapabilities';
import type { ArtStyleProfile } from '../../images/artStyleProfile';
import type {
  LoraArtifact,
  LoraJobHandle,
  LoraJobStatus,
  LoraTrainerAdapter,
  LoraTrainingImage,
  LoraTrainingRequest,
} from '../../services/lora-training/LoraTrainerAdapter';
import {
  LoraRegistry,
  type LoraRegistryRecord,
  computeCharacterLoraFingerprint,
  computeStyleLoraFingerprint,
} from '../../images/loraRegistry';
import {
  buildCharacterDataset,
  buildStyleDataset,
  buildTriggerToken,
  deriveLoraName,
  type CharacterIdentityForDataset,
  type DatasetCharacterReference,
  type DatasetStyleAnchor,
} from '../../images/datasetBuilder';

/** Input for a character-scope training pass. */
export interface CharacterTrainingCandidate {
  character: CharacterIdentityForDataset & { id: string; tier?: string };
  identityFingerprint: string;
  references: DatasetCharacterReference[];
}

/** Input for the style-scope training pass. */
export interface StyleTrainingCandidate {
  profile: ArtStyleProfile;
  anchors: DatasetStyleAnchor[];
  anchorHashes: string[];
  episodeCount: number;
}

export type LoraTrainingOutcome =
  | 'trained'
  | 'cached'
  | 'skipped-ineligible'
  | 'skipped-provider'
  | 'skipped-disabled'
  | 'failed';

/** Per-candidate result. */
export interface LoraTrainingResultEntry {
  kind: 'character' | 'style';
  name: string;
  outcome: LoraTrainingOutcome;
  /** Populated when `outcome === 'trained' | 'cached'`. */
  record?: LoraRegistryRecord;
  /** Populated when `outcome === 'failed'` or `skipped-ineligible`. */
  reason?: string;
}

export interface LoraTrainingReport {
  ran: boolean;
  provider: ImageProvider;
  backend: string;
  entries: LoraTrainingResultEntry[];
}

export interface LoraTrainingAgentOptions {
  storyId: string;
  provider: ImageProvider;
  settings: LoraTrainingSettings;
  adapter: LoraTrainerAdapter;
  registry: LoraRegistry;
  /**
   * Polling cadence. Defaults to 4 seconds. Tests can drop this to zero for
   * deterministic behavior.
   */
  pollIntervalMs?: number;
  /**
   * Upper bound on poll attempts per job. Defaults to 450 (≈30 minutes at
   * 4s cadence). Tests override.
   */
  maxPollAttempts?: number;
  /** Optional logger for diagnostics; defaults to console. */
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Optional progress hook for UI wiring. */
  onProgress?: (event: LoraTrainingProgressEvent) => void;
  /**
   * Optional override so tests can avoid real setTimeout delays.
   */
  sleep?: (ms: number) => Promise<void>;
}

export type LoraTrainingProgressEvent =
  | { type: 'start'; kind: 'character' | 'style'; name: string }
  | { type: 'status'; kind: 'character' | 'style'; name: string; status: LoraJobStatus }
  | { type: 'complete'; kind: 'character' | 'style'; name: string; record: LoraRegistryRecord }
  | { type: 'skip'; kind: 'character' | 'style'; name: string; reason: string }
  | { type: 'fail'; kind: 'character' | 'style'; name: string; reason: string };

const DEFAULT_POLL_MS = 4000;
const DEFAULT_MAX_POLLS = 450;

export class LoraTrainingAgent {
  readonly storyId: string;
  readonly provider: ImageProvider;
  readonly settings: LoraTrainingSettings;
  private readonly adapter: LoraTrainerAdapter;
  private readonly registry: LoraRegistry;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly onProgress?: (event: LoraTrainingProgressEvent) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: LoraTrainingAgentOptions) {
    this.storyId = options.storyId;
    this.provider = options.provider;
    this.settings = options.settings;
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLLS;
    this.logger = options.logger || console;
    this.onProgress = options.onProgress;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Top-level guard: answers "should this agent do *anything* on this run?".
   * False when the provider can't consume LoRAs, when the subsystem is
   * disabled, or when the backend is `'disabled'`.
   */
  shouldRun(): boolean {
    if (!this.settings.enabled) return false;
    if (this.settings.backend === 'disabled') return false;
    return providerSupportsLoraTraining(this.provider);
  }

  /** Convenience: evaluate a single character candidate without running the full pass. */
  evaluateCharacterEligibility(
    candidate: CharacterTrainingCandidate,
  ): { eligible: true } | { eligible: false; reason: string } {
    const thresholds = this.settings.characterThresholds;
    const tier = (candidate.character.tier || '').toLowerCase();
    if (tier && !thresholds.tiers.includes(tier as any)) {
      return { eligible: false, reason: `character tier "${tier}" not in training tier list` };
    }
    if (candidate.references.filter((r) => !!r.imagePath).length < thresholds.minRefs) {
      return {
        eligible: false,
        reason: `only ${candidate.references.length} references (minRefs=${thresholds.minRefs})`,
      };
    }
    if (!candidate.identityFingerprint) {
      return { eligible: false, reason: 'missing identityFingerprint' };
    }
    return { eligible: true };
  }

  evaluateStyleEligibility(
    candidate: StyleTrainingCandidate,
  ): { eligible: true } | { eligible: false; reason: string } {
    const thresholds = this.settings.styleThresholds;
    if (candidate.anchors.filter((a) => !!a.imagePath).length === 0) {
      return { eligible: false, reason: 'no style-bible anchors have a filesystem path' };
    }
    if (thresholds.forceStyle) return { eligible: true };
    if (candidate.episodeCount < thresholds.minEpisodes) {
      return {
        eligible: false,
        reason: `only ${candidate.episodeCount} episode(s) (minEpisodes=${thresholds.minEpisodes})`,
      };
    }
    return { eligible: true };
  }

  /** Train every eligible character and style candidate, respecting cache hits. */
  async trainAll(
    characters: CharacterTrainingCandidate[],
    style: StyleTrainingCandidate | undefined,
  ): Promise<LoraTrainingReport> {
    const entries: LoraTrainingResultEntry[] = [];
    if (!this.settings.enabled) {
      return { ran: false, provider: this.provider, backend: this.settings.backend, entries: [{ kind: 'style', name: '-', outcome: 'skipped-disabled' }] };
    }
    if (!providerSupportsLoraTraining(this.provider)) {
      return {
        ran: false,
        provider: this.provider,
        backend: this.settings.backend,
        entries: [{ kind: 'style', name: '-', outcome: 'skipped-provider' }],
      };
    }

    for (const candidate of characters) {
      entries.push(await this.trainCharacter(candidate));
    }
    if (style) {
      entries.push(await this.trainStyle(style));
    }
    return {
      ran: true,
      provider: this.provider,
      backend: this.settings.backend,
      entries,
    };
  }

  async trainCharacter(
    candidate: CharacterTrainingCandidate,
  ): Promise<LoraTrainingResultEntry> {
    const eligibility = this.evaluateCharacterEligibility(candidate);
    if (!eligibility.eligible) {
      this.emit({
        type: 'skip',
        kind: 'character',
        name: candidate.character.name,
        reason: eligibility.reason,
      });
      return {
        kind: 'character',
        name: candidate.character.name,
        outcome: 'skipped-ineligible',
        reason: eligibility.reason,
      };
    }
    const fingerprint = computeCharacterLoraFingerprint({
      characterId: candidate.character.id,
      name: candidate.character.name,
      identityFingerprint: candidate.identityFingerprint,
      hyperparameters: this.settings.training,
    });
    const cached = this.registry.findByFingerprint(fingerprint);
    if (cached) {
      return {
        kind: 'character',
        name: cached.name,
        outcome: 'cached',
        record: cached,
      };
    }
    const name = deriveLoraName('character', `${candidate.character.name}_${fingerprint.slice(0, 8)}`);
    const trigger = buildTriggerToken(slugify(candidate.character.name), fingerprint);
    const images = buildCharacterDataset({
      character: candidate.character,
      trigger,
      references: candidate.references,
      // Character LoRAs don't embed style in captions — keep it identity-pure.
    });
    if (images.length === 0) {
      const reason = 'no dataset images could be prepared';
      this.emit({ type: 'skip', kind: 'character', name, reason });
      return { kind: 'character', name, outcome: 'skipped-ineligible', reason };
    }
    return this.runTraining({
      kind: 'character',
      name,
      trigger,
      fingerprint,
      images,
      hyperparameters: this.settings.training,
      extras: { characterName: candidate.character.name },
    });
  }

  async trainStyle(candidate: StyleTrainingCandidate): Promise<LoraTrainingResultEntry> {
    const eligibility = this.evaluateStyleEligibility(candidate);
    if (!eligibility.eligible) {
      this.emit({
        type: 'skip',
        kind: 'style',
        name: candidate.profile.name,
        reason: eligibility.reason,
      });
      return {
        kind: 'style',
        name: candidate.profile.name,
        outcome: 'skipped-ineligible',
        reason: eligibility.reason,
      };
    }
    const fingerprint = computeStyleLoraFingerprint({
      profile: candidate.profile,
      anchorHashes: candidate.anchorHashes,
      hyperparameters: this.settings.training,
    });
    const cached = this.registry.findByFingerprint(fingerprint);
    if (cached) {
      return {
        kind: 'style',
        name: cached.name,
        outcome: 'cached',
        record: cached,
      };
    }
    const name = deriveLoraName('style', `${candidate.profile.name}_${fingerprint.slice(0, 8)}`);
    const trigger = buildTriggerToken(slugify(candidate.profile.name) || 'style', fingerprint);
    const images = buildStyleDataset({
      style: candidate.profile,
      trigger,
      anchors: candidate.anchors,
    });
    if (images.length === 0) {
      const reason = 'no dataset images could be prepared';
      this.emit({ type: 'skip', kind: 'style', name, reason });
      return { kind: 'style', name, outcome: 'skipped-ineligible', reason };
    }
    return this.runTraining({
      kind: 'style',
      name,
      trigger,
      fingerprint,
      images,
      hyperparameters: this.settings.training,
      extras: { styleName: candidate.profile.name },
    });
  }

  /** Shared train → poll → fetch → install → register loop. */
  private async runTraining(args: {
    kind: 'character' | 'style';
    name: string;
    trigger: string;
    fingerprint: string;
    images: LoraTrainingImage[];
    hyperparameters: LoraHyperparameters;
    extras: { characterName?: string; styleName?: string };
  }): Promise<LoraTrainingResultEntry> {
    this.emit({ type: 'start', kind: args.kind, name: args.name });
    const request: LoraTrainingRequest = {
      storyId: this.storyId,
      kind: args.kind,
      fingerprint: args.fingerprint,
      name: args.name,
      trigger: args.trigger,
      images: args.images,
      hyperparameters: args.hyperparameters,
      metadata: { ...args.extras },
    };
    let handle: LoraJobHandle;
    try {
      handle = await this.adapter.train(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'fail', kind: args.kind, name: args.name, reason: message });
      this.logger.error(`[LoraTrainingAgent] submit failed for ${args.name}: ${message}`);
      return { kind: args.kind, name: args.name, outcome: 'failed', reason: message };
    }
    let status: LoraJobStatus | undefined;
    for (let i = 0; i < this.maxPollAttempts; i++) {
      status = await this.adapter.pollStatus(handle).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        return { state: 'failed', error: message } as LoraJobStatus;
      });
      this.emit({ type: 'status', kind: args.kind, name: args.name, status });
      if (status.state === 'succeeded' || status.state === 'failed' || status.state === 'cancelled') {
        break;
      }
      if (this.pollIntervalMs > 0) await this.sleep(this.pollIntervalMs);
    }
    if (!status || status.state !== 'succeeded') {
      const reason = status?.error || status?.message || status?.state || 'timed out';
      this.emit({ type: 'fail', kind: args.kind, name: args.name, reason });
      this.logger.warn(`[LoraTrainingAgent] ${args.name} did not succeed: ${reason}`);
      try {
        await this.adapter.cancel?.(handle);
      } catch {
        // best-effort
      }
      return { kind: args.kind, name: args.name, outcome: 'failed', reason };
    }
    let artifact: LoraArtifact;
    try {
      artifact = await this.adapter.fetchArtifact(handle);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'fail', kind: args.kind, name: args.name, reason: message });
      return { kind: args.kind, name: args.name, outcome: 'failed', reason: message };
    }
    try {
      await this.adapter.installArtifact(artifact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[LoraTrainingAgent] install failed for ${args.name}: ${message}`);
      // Keep going — we still want the artifact in the registry so a later
      // run can retry installation without retraining.
    }
    const record = await this.registry.register(artifact, {
      characterName: args.extras.characterName,
      styleName: args.extras.styleName,
      hyperparameters: args.hyperparameters,
      trainerId: this.adapter.id,
    });
    this.emit({ type: 'complete', kind: args.kind, name: args.name, record });
    return { kind: args.kind, name: args.name, outcome: 'trained', record };
  }

  /** Compose an up-to-date `StableDiffusionSettings` reflecting the registry. */
  mergeSettings(base: StableDiffusionSettings | undefined): StableDiffusionSettings {
    return this.registry.mergeIntoStableDiffusionSettings(base);
  }

  private emit(event: LoraTrainingProgressEvent): void {
    try {
      this.onProgress?.(event);
    } catch (err) {
      this.logger.warn('[LoraTrainingAgent] onProgress handler threw', err);
    }
  }
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
