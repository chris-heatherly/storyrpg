/**
 * Image Generation Service
 *
 * Handles actual image generation using various backends.
 * Supports nano-banana (Gemini API), DALL-E, Stable Diffusion, and placeholder mode.
 */

import * as ExpoFileSystem from 'expo-file-system';
import { ImagePrompt, GeneratedImage } from '../agents/ImageGenerator';
import { GeminiSettings, DEFAULT_GEMINI_SETTINGS, MidjourneySettings, DEFAULT_MIDJOURNEY_SETTINGS, ImageProvider, StableDiffusionSettings } from '../config';
import type { SDReferencePurpose } from '../agents/ImageGenerator';
import { budgetCanonicalPrompt } from '../images/promptComposer';
import { ProviderPolicy } from '../images/providerPolicy';
import type { ImageSlotFamily } from '../images/slotTypes';
import { ProviderThrottle } from './providerThrottle';
import { getProviderCapabilities } from '../images/providerCapabilities';
import { createStableDiffusionAdapter } from './stable-diffusion/factory';
import type { StableDiffusionAdapter } from './stable-diffusion/StableDiffusionAdapter';
import { SeedRegistry, type SeedKey } from './stable-diffusion/seedRegistry';
import { isNativeRuntime, isWebRuntime } from '../../utils/runtimeEnv';
import { selectStyleAdaptation } from '../utils/styleAdaptation';
import { ENCOUNTER_VISUAL_PRINCIPLES_COMPACT, STORY_BEAT_VISUAL_PRINCIPLES_COMPACT, getBeatStagingDirection } from '../prompts';

// Dynamic import for Node.js fs module
let nodeFs: any;
let nodePath: any;

// Only attempt to load Node.js modules if we are definitely not in a mobile app
if (!isNativeRuntime()) {
  try {
    const req = typeof eval !== 'undefined' ? eval('require') : undefined;
    if (typeof req === 'function') {
      const isRealNode = typeof process !== 'undefined' && process.versions && process.versions.node;
      if (isRealNode) {
        nodeFs = req('fs');
        nodePath = req('path');
      }
    }
  } catch (e) {}
}

export interface ImageGenerationConfig {
  enabled?: boolean;
  provider?: ImageProvider;
  outputDirectory?: string;
  savePrompts?: boolean;
  geminiApiKey?: string;
  geminiModel?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview';
  // Atlas Cloud configuration
  atlasCloudApiKey?: string;
  atlasCloudModel?: string;
  // useapi.net configuration (Midjourney)
  useapiToken?: string;
  midapiToken?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
  // Provider-specific settings
  geminiSettings?: GeminiSettings;
  midjourneySettings?: MidjourneySettings;
  stableDiffusionSettings?: StableDiffusionSettings;
  failurePolicy?: 'fail_fast' | 'recover';
}

export interface EncounterImageDiagnostic {
  timestamp: string;
  identifier: string;
  baseIdentifier?: string;
  resolvedIdentifier?: string;
  provider: string;
  fallbackProvider?: string;
  slotFamily?: 'encounter-tree' | 'storylet-aftermath' | 'provider-preflight';
  imageType?: ImageType;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  tier?: string;
  status: 'success' | 'failed' | 'fallback_success' | 'resumed' | 'preflight_failed';
  errorClass?: 'transient' | 'permanent' | 'text_instead_of_image';
  providerFailureKind?: 'schema_invalid' | 'empty_candidate' | 'safety_block' | 'content_policy' | 'blocked' | 'timeout' | 'quota' | 'rate_limited' | 'network' | 'unknown';
  errorMessage?: string;
  attempts: number;
  durationMs: number;
  promptChars: number;
  negativeChars: number;
  refCount: number;
  effectivePromptChars?: number;
  effectiveNegativeChars?: number;
  effectiveRefCount?: number;
  model?: string;
  fallbackTried?: boolean;
  fallbackSucceeded?: boolean;
  candidateCount?: number;
  hasCandidates?: boolean;
  finishReason?: string;
  blockReason?: string;
  responseExcerpt?: string;
  imagePath?: string;
  imageUrl?: string;
}

export interface ProviderPreflightResult {
  ok: boolean;
  provider: string;
  reason?: string;
  latencyMs: number;
}

type ProviderFailureKind = NonNullable<EncounterImageDiagnostic['providerFailureKind']>;

type GeminiResponseMeta = {
  providerFailureKind?: ProviderFailureKind;
  candidateCount?: number;
  hasCandidates?: boolean;
  finishReason?: string;
  blockReason?: string;
  responseExcerpt?: string;
};

type EffectiveRequestMeta = {
  providerAttemptCount?: number;
  effectivePromptChars?: number;
  effectiveNegativeChars?: number;
  effectiveRefCount?: number;
  providerFailureKind?: ProviderFailureKind;
  candidateCount?: number;
  hasCandidates?: boolean;
  finishReason?: string;
  blockReason?: string;
  responseExcerpt?: string;
  model?: string;
};

function normalizeManagedOutputPath(filePath: string): string {
  if (!filePath) return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  for (const marker of ['generated-stories/', 'generated-images/', 'generated-videos/', 'ref-images/']) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      return normalized.slice(idx);
    }
  }
  return filePath;
}

export type ImageJobEvent = 
  | { type: 'job_added'; job: any }
  | { type: 'job_updated'; id: string; updates: any }
  | { type: 'job_removed'; id: string };

export type ImageType = 'scene' | 'beat' | 'cover' | 'master' | 'expression' | 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath';

/** Reference image with optional character metadata for Gemini consistency */
export interface ReferenceImage {
  data: string;
  mimeType: string;
  role: string;
  /** Character name for labeling (e.g. "Vance") */
  characterName?: string;
  /** View type for labeling (e.g. "front", "profile", "three-quarter") */
  viewType?: string;
  /** Key visual traits to call out (e.g. ["scar on left cheek", "silver hair"]) */
  visualAnchors?: string[];
  /**
   * Optional purpose tag consumed by the Stable Diffusion adapter. Non-SD
   * providers ignore this field entirely — this stays additive for
   * Gemini / Atlas / MidAPI consumers.
   */
  purpose?: SDReferencePurpose;
  /**
   * D7 / A7: Pre-uploaded HTTP(S) URL for this reference, if known. URL-based
   * providers (Midjourney `--cref`/`--sref`, Atlas Seedream) prefer URLs over
   * inline base64. When empty, providers that require URLs fall back to
   * their legacy identity-hint path.
   */
  url?: string;
}

/**
 * Structured per-character identity anchors. Each slot is rendered as a
 * separate labeled line in the prompt identity block so the LLM is far less
 * likely to summarize away critical attributes like hair color or a scar.
 */
export interface CanonicalAppearance {
  face?: string;
  hair?: string;
  eyes?: string;
  skinTone?: string;
  build?: string;
  height?: string;
  distinguishingMarks?: string[];
  defaultAttire?: string;
}

/** Per-character appearance payload passed alongside character names. */
export interface CharacterAppearanceDescription {
  name: string;
  appearance: string;
  canonicalAppearance?: CanonicalAppearance;
}

export interface ReferenceThumbnail {
  id: string;
  uri: string;
  characterName?: string;
  viewType?: string;
  role: string;
}

/**
 * Detect the actual MIME type from a base64-encoded image by inspecting magic bytes,
 * or extract it from a data URI prefix. Falls back to 'image/png' when detection fails.
 */
function detectImageMimeType(output: string): { mimeType: string; extension: string; base64Data: string } {
  // If the output is a data URI, extract the real MIME type from the prefix
  const dataUriMatch = output.match(/^data:(image\/[\w+.-]+);base64,/);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1];
    const base64Data = output.slice(dataUriMatch[0].length);
    const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
      : mimeType.includes('webp') ? 'webp'
      : 'png';
    return { mimeType, extension, base64Data };
  }

  // Raw base64 — sniff magic bytes from the first few bytes
  try {
    const head = atob(output.slice(0, 16));
    if (head.charCodeAt(0) === 0xFF && head.charCodeAt(1) === 0xD8) {
      return { mimeType: 'image/jpeg', extension: 'jpg', base64Data: output };
    }
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', extension: 'webp', base64Data: output };
    }
  } catch (_) { /* atob may fail on non-base64 preamble — fall through */ }

  return { mimeType: 'image/png', extension: 'png', base64Data: output };
}

export class ImageGenerationService {
  private config: ImageGenerationConfig;
  private outputDir: string;
  private listeners: ((event: ImageJobEvent) => void)[] = [];
  
  private maxRetries: number;
  private retryDelayMs: number;
  private retryBackoffMultiplier: number;
  /**
   * Hard cap on exponential-backoff delay (A6). Without this cap a
   * five-retry schedule could grow to 80s on a single bad prompt, blocking
   * the provider's semaphore for minutes. Capped at 20s keeps the worst
   * case bounded while still giving transient failures room to recover.
   */
  private maxRetryBackoffMs: number = 20_000;
  /**
   * Retry cap for `text_instead_of_image` errors (A6). This is a prompt
   * problem, not a transient network failure — once a prompt reliably
   * returns text the provider is unlikely to change its mind on a 5th
   * attempt, so cut the ladder short.
   */
  private maxTextInsteadOfImageRetries: number = 2;
  /**
   * Per-provider rate-limiter + concurrency gate. Replaces the previous
   * single-instance `lastRequestTime` / `_concurrencyLimit` pair that
   * serialized every provider through one throttle. See
   * `services/providerThrottle.ts` and `images/providerCapabilities.ts`.
   */
  private _throttle = new ProviderThrottle();
  /**
   * Inflight dedup (A11). Two concurrent `generateImage` calls with the
   * same prompt hash share the same promise so we never pay for the same
   * image twice concurrently. Entries self-clean on settle.
   */
  private _inflightGenerations: Map<string, Promise<GeneratedImage>> = new Map();

  // Gemini continuity state
  private _geminiSettings: Required<GeminiSettings> = { ...DEFAULT_GEMINI_SETTINGS };
  /**
   * C4: Structured art-style profile. Used by `ensureVisualPromptStrength` to
   * bidirectionally strengthen/soften prompts based on the active style —
   * strip style-inappropriate vocabulary, inject style-positive vocabulary,
   * merge style-specific negative prompts, and skip guardrails the style has
   * explicitly opted out of via `acceptableDeviations`.
   *
   * Leave unset to keep today's default-cinematic behavior.
   */
  private _artStyleProfile: import('../images/artStyleProfile').ArtStyleProfile | null = null;
  private _midjourneySettings: Required<MidjourneySettings> = { ...DEFAULT_MIDJOURNEY_SETTINGS };
  private _stableDiffusionSettings: StableDiffusionSettings | undefined;
  // Lazily-instantiated Stable Diffusion adapter. Created on first use so
  // non-SD pipelines don't pay the cost (and so backend selection can change
  // after construction via `updateStableDiffusionSettings`).
  private _sdAdapter: StableDiffusionAdapter | null = null;
  private _sdSeedRegistry: SeedRegistry = new SeedRegistry('image-gen-service');
  private _geminiStyleReference: { data: string; mimeType: string } | null = null;
  private _geminiPreviousScene: { data: string; mimeType: string } | null = null;
  private _referenceSheetStyleAnchor: { data: string; mimeType: string } | null = null;
  // Multi-turn chat history for within-scene beat continuity (P3-B)
  private _chatHistory: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  private _chatSceneId: string | null = null;

  // Shared efficiency: prompt-hash cache (stores paths/URLs only — not base64 data)
  private _promptCache = new Map<string, { imageUrl?: string; imagePath?: string; mimeType?: string }>();
  // Identifier-based dedup (covers browser runtime where file-existence check is unavailable)
  private _generatedIdentifiers = new Set<string>();
  private providerPolicy = new ProviderPolicy();
  
  // Observability counters
  public pipelineMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    textArtifactRejections: 0,
    transientRetries: 0,
    permanentFailures: 0,
  };
  private encounterDiagnostics: EncounterImageDiagnostic[] = [];

  constructor(config: ImageGenerationConfig) {
    const normalizedGeminiKey =
      config.geminiApiKey ||
      (config as any).apiKey ||
      ((typeof process !== 'undefined' ? process.env : undefined) as any)?.EXPO_PUBLIC_GEMINI_API_KEY ||
      ((typeof process !== 'undefined' ? process.env : undefined) as any)?.GEMINI_API_KEY;
    this.config = {
      ...config,
      geminiApiKey: normalizedGeminiKey,
      provider: this.normalizeProvider(config.provider),
      useapiToken: config.useapiToken || config.midapiToken,
    };
    this.outputDir = config.outputDirectory || './generated-images';
    this.maxRetries = config.maxRetries ?? 5; // Increased retries
    this.retryDelayMs = config.retryDelayMs ?? 5000; // Increased base delay to 5s
    this.retryBackoffMultiplier = config.retryBackoffMultiplier ?? 2;
    // Resolve model with correct priority: explicit UI setting > top-level config > env var > default
    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const resolvedModel = (
      config.geminiSettings?.model
      || config.geminiModel
      || env.EXPO_PUBLIC_GEMINI_MODEL
      || env.GEMINI_MODEL
      || DEFAULT_GEMINI_SETTINGS.model
    ) as Required<GeminiSettings>['model'];
    this._geminiSettings = {
      ...DEFAULT_GEMINI_SETTINGS,
      ...config.geminiSettings,
      model: resolvedModel,
    };
    this._midjourneySettings = {
      ...DEFAULT_MIDJOURNEY_SETTINGS,
      ...config.midjourneySettings,
    };
    this._stableDiffusionSettings = config.stableDiffusionSettings;
    this.ensureDirectory(this.outputDir);
  }

  public getStableDiffusionSettings(): StableDiffusionSettings | undefined {
    return this._stableDiffusionSettings;
  }

  public updateStableDiffusionSettings(settings: StableDiffusionSettings | undefined): void {
    this._stableDiffusionSettings = settings;
    // Invalidate cached adapter so next call picks up the new backend.
    this._sdAdapter = null;
  }

  private getSDAdapter(): StableDiffusionAdapter {
    if (!this._sdAdapter) {
      this._sdAdapter = createStableDiffusionAdapter(this._stableDiffusionSettings);
    }
    return this._sdAdapter;
  }

  private getSDWriteHelpers() {
    return {
      outputDir: this.outputDir,
      writeFile: (p: string, content: string | Buffer, isBase64?: boolean) => this.writeFile(p, content, isBase64),
      joinPath: (base: string, ...parts: string[]) => this.joinPath(base, ...parts),
      toImageHttpUrl: (p: string, mime: string, data: string) => this.toImageHttpUrl(p, mime, data),
    };
  }

  /**
   * Decide a deterministic seed for an SD request when the caller hasn't
   * pinned one. Precedence:
   *  1. `prompt.seed` (caller explicitly chose).
   *  2. character-in-scene seed (best continuity for beat panels).
   *  3. scene seed (for scene masters / establishing shots).
   *  4. character seed (character portraits with no scene context).
   *  5. anchor seed derived from `identifier` (last-resort determinism).
   *
   * Force-regenerate requests deliberately skip caching so users can reroll
   * by clearing the registry entry (or explicitly passing a new seed).
   */
  public applyDeterministicSeed(
    prompt: ImagePrompt,
    identifier: string,
    metadata?: Record<string, any>,
  ): ImagePrompt {
    if (typeof prompt.seed === 'number') return prompt;
    const sceneId = (metadata?.sceneId as string) || undefined;
    const characterName = (metadata?.characterName as string) || (metadata?.characterId as string) || undefined;
    // D6: callers may opt-in to a specific seed scope (e.g. reference sheets
    // want the pure `character` scope so the same face/body noise pattern is
    // reused across every appearance, rather than being scene-salted).
    const override = metadata?.seedScope as SeedKey['scope'] | undefined;
    const characterIds: string[] | undefined = Array.isArray(metadata?.characterIds)
      ? metadata.characterIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : undefined;
    // When multiple characters are in-frame, join their ids deterministically so the
    // noise pattern depends on the full cast rather than an arbitrary primary pick.
    const joinedCharacterId = characterIds && characterIds.length > 0
      ? [...characterIds].sort().join('+')
      : characterName;

    let key: SeedKey;
    const effectiveScope: SeedKey['scope'] | undefined = override
      ?? (sceneId && joinedCharacterId
        ? 'characterInScene'
        : sceneId
          ? 'scene'
          : joinedCharacterId
            ? 'character'
            : 'anchor');

    switch (effectiveScope) {
      case 'character':
        key = joinedCharacterId
          ? { scope: 'character', characterId: joinedCharacterId }
          : { scope: 'anchor', raw: identifier };
        break;
      case 'scene':
        key = sceneId ? { scope: 'scene', sceneId } : { scope: 'anchor', raw: identifier };
        break;
      case 'characterInScene':
        key = sceneId && joinedCharacterId
          ? { scope: 'characterInScene', sceneId, characterId: joinedCharacterId }
          : { scope: 'anchor', raw: identifier };
        break;
      case 'anchor':
      default:
        key = { scope: 'anchor', raw: identifier };
        break;
    }
    const seed = this._sdSeedRegistry.get(key);
    return { ...prompt, seed };
  }

  /** Allow callers (e.g. regen flows) to pin/override a seed for a key. */
  public pinStableDiffusionSeed(key: SeedKey, seed: number): void {
    this._sdSeedRegistry.set(key, seed);
  }

  /** Allow callers to reset deterministic seeds (e.g. "Reroll all" UX). */
  public clearStableDiffusionSeeds(): void {
    this._sdSeedRegistry.clear();
  }

  private isFailFastEnabled(): boolean {
    return this.config.failurePolicy !== 'recover';
  }

  // === Gemini Settings & Continuity ===

  public getGeminiSettings(): Required<GeminiSettings> {
    return this._geminiSettings;
  }

  public isNB2OrProModel(): boolean {
    return this.isNB2OrPro();
  }

  public updateGeminiSettings(settings: GeminiSettings): void {
    this._geminiSettings = { ...DEFAULT_GEMINI_SETTINGS, ...settings };
  }

  /**
   * C4: Install the active art-style profile. Pass `null`/`undefined` to fall
   * back to the default cinematic behavior. Callers typically pull this from
   * `PipelineConfig.imageGen.artStyleProfile` once per pipeline run.
   */
  public setArtStyleProfile(
    profile: import('../images/artStyleProfile').ArtStyleProfile | null | undefined,
  ): void {
    this._artStyleProfile = profile ?? null;
  }

  public getArtStyleProfile(): import('../images/artStyleProfile').ArtStyleProfile | null {
    return this._artStyleProfile;
  }

  public getMidjourneySettings(): Required<MidjourneySettings> {
    return this._midjourneySettings;
  }

  public setGeminiStyleReference(data: string, mimeType: string): void {
    this._geminiStyleReference = { data, mimeType };
  }

  public setGeminiPreviousScene(data: string, mimeType: string): void {
    this._geminiPreviousScene = { data, mimeType };
  }

  /**
   * D10: Drop the stored "previous scene" reference without touching the
   * persistent style anchor, chat history, or style reference. Call this at
   * narrative boundaries (new scene, new encounter branch) where feeding the
   * previous image into the next generation would misguide the model.
   */
  public clearGeminiPreviousScene(): void {
    this._geminiPreviousScene = null;
  }

  public setReferenceSheetStyleAnchor(data: string, mimeType: string): void {
    this._referenceSheetStyleAnchor = { data, mimeType };
  }

  public clearGeminiContext(): void {
    this._geminiStyleReference = null;
    this._geminiPreviousScene = null;
    this._referenceSheetStyleAnchor = null;
    this._chatHistory = [];
    this._chatSceneId = null;
  }

  private static readonly DEFAULT_ART_STYLE = 'dramatic cinematic story art';

  private normalizeProvider(provider?: ImageProvider): ImageProvider {
    if (provider === 'useapi') return 'midapi';
    return provider || 'placeholder';
  }

  public getEncounterDiagnostics(): EncounterImageDiagnostic[] {
    return [...this.encounterDiagnostics];
  }

  public clearEncounterDiagnostics(): void {
    this.encounterDiagnostics = [];
  }

  private shouldTrackEncounterType(type?: ImageType): boolean {
    return type === 'encounter-setup' || type === 'encounter-outcome' || type === 'storylet-aftermath';
  }

  private recordEncounterDiagnostic(entry: EncounterImageDiagnostic): void {
    if (!this.shouldTrackEncounterType(entry.imageType)) return;
    this.encounterDiagnostics.push(entry);
  }

  private getEncounterSlotFamily(type?: ImageType): EncounterImageDiagnostic['slotFamily'] {
    if (type === 'storylet-aftermath') return 'storylet-aftermath';
    if (this.shouldTrackEncounterType(type)) return 'encounter-tree';
    return undefined;
  }

  private getPolicyFamily(type?: ImageType): ImageSlotFamily | undefined {
    switch (type) {
      case 'scene': return 'story-scene';
      case 'beat': return 'story-beat';
      case 'encounter-setup': return 'encounter-setup';
      case 'encounter-outcome': return 'encounter-outcome';
      case 'storylet-aftermath': return 'storylet-aftermath';
      case 'cover': return 'cover';
      case 'master': return 'master';
      case 'expression': return 'expression';
      default: return undefined;
    }
  }

  private static withProviderErrorMeta(error: Error, meta: GeminiResponseMeta & { providerAttemptCount?: number; effectivePromptChars?: number; effectiveNegativeChars?: number; effectiveRefCount?: number; model?: string }): Error {
    Object.assign(error as unknown as Record<string, unknown>, meta);
    return error;
  }

  private buildGeminiMalformedResponseError(data: any, model: string): Error {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const firstCandidate = candidates[0];
    const parts = firstCandidate?.content?.parts;
    const finishReason = typeof firstCandidate?.finishReason === 'string' ? firstCandidate.finishReason : undefined;
    const blockReason = typeof data?.promptFeedback?.blockReason === 'string'
      ? data.promptFeedback.blockReason
      : typeof firstCandidate?.safetyRatings?.[0]?.blocked === 'boolean' && firstCandidate.safetyRatings[0]?.blocked
        ? 'candidate_blocked'
        : undefined;
    const responseExcerpt = JSON.stringify({
      promptFeedback: data?.promptFeedback,
      candidateCount: candidates.length,
      finishReason,
      hasParts: Array.isArray(parts),
      error: data?.error,
    }).slice(0, 500);

    const providerFailureKind: ProviderFailureKind =
      blockReason || /safety|block/i.test(String(finishReason || ''))
        ? 'safety_block'
        : candidates.length === 0
          ? 'empty_candidate'
          : 'schema_invalid';

    const message = providerFailureKind === 'safety_block'
      ? `Gemini response blocked by safety or policy (${blockReason || finishReason || 'unknown'})`
      : 'Invalid API response structure';

    return ImageGenerationService.withProviderErrorMeta(new Error(message), {
      providerFailureKind,
      candidateCount: candidates.length,
      hasCandidates: candidates.length > 0,
      finishReason,
      blockReason,
      responseExcerpt,
      model,
    });
  }

  private extractEffectiveRequestMeta(source: any, prompt: ImagePrompt, refs?: ReferenceImage[]): EffectiveRequestMeta {
    const meta = source?.metadata || source || {};
    return {
      providerAttemptCount: typeof meta.providerAttemptCount === 'number' ? meta.providerAttemptCount : 1,
      effectivePromptChars: typeof meta.effectivePromptChars === 'number' ? meta.effectivePromptChars : (prompt.prompt?.length || 0),
      effectiveNegativeChars: typeof meta.effectiveNegativeChars === 'number' ? meta.effectiveNegativeChars : (prompt.negativePrompt?.length || 0),
      effectiveRefCount: typeof meta.effectiveRefCount === 'number' ? meta.effectiveRefCount : (refs?.length || 0),
      providerFailureKind: meta.providerFailureKind,
      candidateCount: meta.candidateCount,
      hasCandidates: meta.hasCandidates,
      finishReason: meta.finishReason,
      blockReason: meta.blockReason,
      responseExcerpt: meta.responseExcerpt,
      model: meta.model,
    };
  }

  private isPlaceholderResult(result: GeneratedImage | undefined): boolean {
    return result?.metadata?.format === 'prompt' || (!result?.imageUrl && !!result?.imagePath && /\.prompt\.txt$/i.test(result.imagePath));
  }

  private prioritizeReferenceImages(referenceImages: ReferenceImage[], maxRefs: number): ReferenceImage[] {
    if (referenceImages.length <= maxRefs) return referenceImages;
    const scoreRef = (ref: ReferenceImage): number => {
      const role = (ref.role || '').toLowerCase();
      if (role.includes('user-provided')) return 120;
      if (role.startsWith('character-reference-face-')) return 110;
      if (role.startsWith('character-reference-')) return 90;
      if (role.includes('style')) return 80;
      if (role === 'previous-panel-continuity') return 75;
      if (role.includes('expression')) return 70;
      return 50;
    };
    return [...referenceImages]
      .sort((a, b) => scoreRef(b) - scoreRef(a))
      .slice(0, maxRefs);
  }

  private normalizeNegativesText(text: string, hardCap: number): string {
    const chunks = text
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const deduped: string[] = [];
    for (const c of chunks) {
      if (!deduped.some(existing => existing.toLowerCase() === c.toLowerCase())) {
        deduped.push(c);
      }
    }
    const joined = deduped.join(', ');
    return joined.length <= hardCap ? joined : joined.slice(0, hardCap).trim();
  }

  private applyEncounterPromptBudget(
    prompt: ImagePrompt,
    imageType: ImageType | undefined,
    attempt: number
  ): ImagePrompt {
    if (!this.shouldTrackEncounterType(imageType) || !prompt.isEncounterImage) return prompt;
    const SOFT_PROMPT_CAP = 2200;
    const HARD_PROMPT_CAP = 3000;
    const SOFT_NEG_CAP = 800;
    const HARD_NEG_CAP = 1200;
    const compact = attempt >= 2;
    const trim = attempt >= 3;
    const retryStage = attempt >= 3 ? 'aggressive_retry' : attempt >= 2 ? 'retry' : 'primary';
    const out: ImagePrompt = budgetCanonicalPrompt({ ...prompt }, retryStage);
    if (compact) {
      out.negativePrompt = this.normalizeNegativesText(out.negativePrompt || '', HARD_NEG_CAP);
      if ((out.negativePrompt || '').length > SOFT_NEG_CAP) {
        out.negativePrompt = (out.negativePrompt || '').slice(0, SOFT_NEG_CAP);
      }
      if (out.settingAdaptationNotes && out.settingAdaptationNotes.length > 2) {
        out.settingAdaptationNotes = out.settingAdaptationNotes.slice(0, 2);
      }
      if (out.composition && out.composition.length > 420) {
        out.composition = out.composition.slice(0, 420);
      }
    }
    if (trim && out.prompt && out.prompt.length > SOFT_PROMPT_CAP) {
      out.prompt = out.prompt.slice(0, SOFT_PROMPT_CAP);
    }
    if ((out.prompt || '').length > HARD_PROMPT_CAP) {
      out.prompt = (out.prompt || '').slice(0, HARD_PROMPT_CAP);
    }
    if ((out.negativePrompt || '').length > HARD_NEG_CAP) {
      out.negativePrompt = (out.negativePrompt || '').slice(0, HARD_NEG_CAP);
    }
    return out;
  }

  public async preflightImageProvider(forceCanary: boolean = true): Promise<ProviderPreflightResult> {
    const startedAt = Date.now();
    const provider = this.normalizeProvider(this.config.provider);
    const done = (ok: boolean, reason?: string): ProviderPreflightResult => ({
      ok,
      provider,
      reason,
      latencyMs: Date.now() - startedAt,
    });
    if (provider === 'placeholder') {
      return done(false, 'image provider is placeholder');
    }
    if (provider === 'nano-banana') {
      const apiKey = this.config.geminiApiKey;
      if (!apiKey) return done(false, 'missing Gemini API key');
      if (!forceCanary) return done(true);
      const model = this._geminiSettings.model || 'gemini-2.5-flash-image';
      const body = {
        contents: [{ parts: [{ text: 'Canary image: single abstract color gradient square.' }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '1:1' },
        },
      };
      const maxAttempts = 3;
      let lastReason = 'Gemini preflight failed';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
          const timeoutId = controller ? setTimeout(() => controller.abort(), 45000) : undefined;
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller?.signal,
          });
          if (timeoutId) clearTimeout(timeoutId);
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            const reason = `Gemini preflight failed: HTTP ${response.status}${text ? ` - ${text.slice(0, 200)}` : ''}`;
            lastReason = reason;
            const isTransient = response.status >= 500 || response.status === 429 || response.status === 408;
            if (isTransient && attempt < maxAttempts) {
              await this.delay(800 * attempt);
              continue;
            }
            return done(false, reason);
          }
          const data = await response.json();
          const parts = data?.candidates?.[0]?.content?.parts || [];
          const hasImage = parts.some((p: any) => !!p?.inlineData?.data);
          if (hasImage) return done(true);
          lastReason = 'Gemini preflight returned no image';
          if (attempt < maxAttempts) {
            await this.delay(800 * attempt);
            continue;
          }
          return done(false, lastReason);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastReason = `Gemini preflight error: ${msg}`;
          if (attempt < maxAttempts) {
            await this.delay(800 * attempt);
            continue;
          }
          return done(false, lastReason);
        }
      }
      return done(false, lastReason);
    }
    if (provider === 'atlas-cloud') {
      if (!this.config.atlasCloudApiKey) return done(false, 'missing Atlas Cloud API key');
      return done(true, forceCanary ? 'atlas preflight uses key validation only' : undefined);
    }
    if (provider === 'midapi') {
      if (!this.config.useapiToken && !this.config.midapiToken) return done(false, 'missing MidAPI token');
      return done(true, forceCanary ? 'midapi preflight uses token validation only' : undefined);
    }
    if (provider === 'stable-diffusion') {
      const settings = this._stableDiffusionSettings;
      if (!settings || !settings.baseUrl) return done(false, 'missing Stable Diffusion baseUrl');
      if (!forceCanary) return done(true);
      try {
        const adapter = this.getSDAdapter();
        const result = await adapter.preflight(settings);
        return {
          ok: result.ok,
          provider,
          reason: result.reason,
          latencyMs: Date.now() - startedAt,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return done(false, `Stable Diffusion preflight error: ${msg}`);
      }
    }
    return done(true);
  }

  private resolveArtStyle(promptStyle?: string, identifier?: string): string {
    let resolved: string;
    let source: string;
    const canonical = this._geminiSettings.canonicalArtStyle?.trim() || '';
    const promptTrimmed = promptStyle?.trim() || '';
    if (canonical.length > 0) {
      resolved = canonical;
      source = 'canonicalArtStyle';
    } else if (promptTrimmed.length > 0) {
      resolved = promptTrimmed;
      source = 'prompt.style';
    } else {
      resolved = ImageGenerationService.DEFAULT_ART_STYLE;
      source = 'default(fallback)';
      console.warn(
        `[ImageGenService] Art style falling back to default for "${identifier || '(no id)'}" — no canonicalArtStyle or prompt.style was supplied. ` +
        `This is the most common cause of "style keeps reverting". Check that the user's art style is reaching buildPipelineConfig.`,
      );
    }
    if (identifier) {
      console.log(`[ImageGenService] Art style for "${identifier}": "${resolved}" (source: ${source})`);
    }
    return resolved;
  }

  private getSettingAdaptationNotes(prompt: ImagePrompt, identifier?: string): string[] {
    if (prompt.settingAdaptationNotes && prompt.settingAdaptationNotes.length > 0) {
      return prompt.settingAdaptationNotes;
    }
    const notes = selectStyleAdaptation(this.resolveArtStyle(prompt.style, identifier), prompt.settingContext).notes;
    if (notes.length > 0) {
      prompt.settingAdaptationNotes = notes;
    }
    return notes;
  }

  private buildAtlasCloudPrompt(prompt: ImagePrompt, identifier?: string): string {
    const resolvedStyle = this.resolveArtStyle(prompt.style, identifier);
    const settingNotes = this.getSettingAdaptationNotes(prompt, identifier);
    const sections = [
      `Art style (MANDATORY): ${resolvedStyle}.`,
      settingNotes.length > 0
        ? `Setting adaptation (same overall style, not a style switch): ${settingNotes.join(' ')}`
        : '',
      prompt.prompt,
      prompt.visualNarrative,
      prompt.composition,
      prompt.keyExpression,
      prompt.keyGesture,
      prompt.keyBodyLanguage,
      prompt.emotionalCore,
    ].filter(Boolean);
    return `${sections.join(' ')} STYLE CONSISTENCY: Every image in this story uses the exact same art style described above. Maintain identical rendering technique, line weight, color saturation, and shading approach across all images. Avoid: text overlay, captions, multi-panel composition.`;
  }

  /**
   * Structured prompt for Nano Banana models via Atlas Cloud /edit endpoint.
   * Mirrors the Gemini direct prompt architecture: art style first, narrative
   * prompt as primary content, labeled reference image descriptions matching
   * the body.images array order, character identity lock, style consistency.
   */
  private buildAtlasNanoBananaPrompt(
    prompt: ImagePrompt,
    identifier: string | undefined,
    referenceImages: ReferenceImage[],
  ): string {
    const resolvedStyle = this.resolveArtStyle(prompt.style, identifier);
    const settingNotes = this.getSettingAdaptationNotes(prompt, identifier);
    const isReferenceLike = this.isReferenceLikeImage(undefined, identifier);
    const isExpressionLike = this.isExpressionLikeImage(undefined, identifier);
    const sections: string[] = [];

    sections.push(`ART STYLE (MANDATORY): ${resolvedStyle}. Maintain this exact art style throughout the entire image.`);

    if (settingNotes.length > 0) {
      sections.push(`SETTING ADAPTATION (same style, not a style switch): ${settingNotes.join(' ')}`);
    }

    if (!isReferenceLike && !isExpressionLike) {
      const microParts: string[] = [];
      if (prompt.keyExpression) microParts.push(prompt.keyExpression);
      if (prompt.keyGesture) microParts.push(prompt.keyGesture);
      if (prompt.keyBodyLanguage) microParts.push(prompt.keyBodyLanguage);
      if (microParts.length > 0) {
        sections.push(`CHARACTER ACTING: ${microParts.join('. ')}.`);
      }
    }

    if (prompt.visualNarrative) {
      sections.push(`THE STORY MOMENT: ${prompt.visualNarrative}`);
    } else if (prompt.emotionalCore) {
      sections.push(`The moment: ${prompt.emotionalCore}`);
    }

    sections.push(prompt.prompt);

    if (prompt.composition) {
      sections.push(prompt.composition);
    }

    if (referenceImages.length > 0) {
      const charRefs = referenceImages.filter(r => r.characterName);
      const styleRefs = referenceImages.filter(r => r.role === 'style-reference');
      const prevScene = referenceImages.filter(r => r.role === 'previous-scene-reference');
      const otherRefs = referenceImages.filter(r => !r.characterName && r.role !== 'style-reference' && r.role !== 'previous-scene-reference');

      let imageIdx = 1;

      for (const ref of styleRefs) {
        sections.push(`Image ${imageIdx}: Style consistency reference — approximate guide for color temperature, rendering density, and composition feel. The ART STYLE text above is authoritative; follow its description over any visual differences in this reference.`);
        imageIdx++;
      }

      for (const ref of prevScene) {
        sections.push(
          `Image ${imageIdx}: Previous scene — STYLE AND SETTING CONTINUITY REFERENCE ONLY. ` +
          `Match the color grading, lighting temperature, and environmental feel of this image. ` +
          `Do NOT copy character appearance from this image — character identity comes from the dedicated character reference images below.`
        );
        imageIdx++;
      }

      const charNames: string[] = [];
      for (const ref of charRefs) {
        const isComposite = ref.viewType === 'composite' || ref.role?.includes('composite');
        let label = `Image ${imageIdx}: ${ref.characterName}`;
        if (isComposite) {
          label += ` — CHARACTER REFERENCE SHEET showing this ONE character from multiple angles. Use ONLY for identity matching (face, hair, skin tone, distinguishing features). Do NOT copy the rendering style, line weight, or color palette from this sheet — the ART STYLE text above is authoritative.`;
        } else if (ref.viewType && ref.viewType !== 'front') {
          label += ` (${ref.viewType} view) — use ONLY for identity matching, not for rendering style.`;
        } else {
          label += ` — use ONLY for identity matching (face, hair, skin tone, distinguishing features). Do NOT copy the rendering style from this reference.`;
        }
        if (ref.visualAnchors && ref.visualAnchors.length > 0) {
          label += ` Key traits: ${ref.visualAnchors.slice(0, 5).join(', ')}`;
        }
        sections.push(label);
        if (ref.characterName && !charNames.includes(ref.characterName)) {
          charNames.push(ref.characterName);
        }
        imageIdx++;
      }

      for (const ref of otherRefs) {
        sections.push(`Image ${imageIdx}: Reference (${ref.role})`);
        imageIdx++;
      }

      if (charRefs.length > 0 && !isReferenceLike) {
        const anchorsByChar = new Map<string, string[]>();
        for (const ref of charRefs) {
          if (ref.characterName && ref.visualAnchors?.length) {
            const existing = anchorsByChar.get(ref.characterName) || [];
            for (const a of ref.visualAnchors) {
              if (!existing.includes(a)) existing.push(a);
            }
            anchorsByChar.set(ref.characterName, existing);
          }
        }

        let identityText = `CHARACTER IDENTITY: Render the characters using the faces, builds, and distinguishing features from the reference images above.`;
        if (anchorsByChar.size > 0) {
          const anchorLines = Array.from(anchorsByChar.entries())
            .map(([name, anchors]) => `${name}: ${anchors.slice(0, 3).join(', ')}`)
            .join('. ');
          identityText += ` Key identity traits — ${anchorLines}.`;
        }
        identityText += ` Preserve identity but show dynamic poses appropriate to the scene action. Each character appears EXACTLY ONCE.`;
        sections.push(identityText);
      }
    }

    sections.push(`STYLE REMINDER: Maintain "${resolvedStyle}" consistently. Every image in this story uses the exact same art style.`);

    sections.push(
      'OUTPUT: Single continuous image, one unified scene, one camera angle. ' +
      'No triptych, collage, montage, panels, split-screen, or multi-image composition. ' +
      'No text overlays, captions, or labels.'
    );

    if (prompt.negativePrompt) {
      sections.push(`Avoid: ${prompt.negativePrompt}`);
    } else {
      sections.push('Avoid: text overlay, captions, multi-panel composition, duplicate characters.');
    }

    return sections.join('\n\n');
  }

  private buildMidjourneyPrompt(
    prompt: ImagePrompt,
    identifier: string,
    metadata?: { type?: string; omniWeightOverride?: number },
    referenceImages?: ReferenceImage[]
  ): string {
    const resolvedStyle = this.resolveArtStyle(prompt.style, identifier);
    const settingNotes = this.getSettingAdaptationNotes(prompt, identifier);
    const mj = this._midjourneySettings;
    const imageType = metadata?.type || 'scene';
    const isReferenceLike = this.isReferenceLikeImage(imageType, identifier);
    const stylize = isReferenceLike ? mj.refSheetStylization : mj.sceneStylization;
    const speedFlag = mj.speed === 'relaxed' ? '--relax' : '--fast';
    const aspectRatio = this.mapAspectRatioForMidjourney(prompt.aspectRatio || '9:16');
    const identityHints = referenceImages
      ?.filter(ref => ref.characterName || (ref.visualAnchors && ref.visualAnchors.length > 0))
      .slice(0, 3)
      .map(ref => ref.characterName
        ? `${ref.characterName}${ref.visualAnchors?.length ? ` (${ref.visualAnchors.slice(0, 2).join(', ')})` : ''}`
        : ref.visualAnchors?.slice(0, 2).join(', '))
      .filter(Boolean)
      .join('; ');
    const subjectDescription = [
      settingNotes.length > 0 ? `same overall style, setting-specific adaptation: ${settingNotes.join('; ')}` : '',
      prompt.visualNarrative,
      prompt.prompt,
      prompt.composition,
      prompt.keyExpression,
      prompt.keyGesture,
      prompt.keyBodyLanguage,
      prompt.emotionalCore,
      identityHints ? `character identity anchors: ${identityHints}` : '',
    ].filter(Boolean).join(', ');

    // D7: If enabled AND the caller supplied pre-uploaded reference URLs,
    // use Midjourney's native `--cref` (character) and `--sref` (style)
    // flags for maximum character/style lock. For non-reference images
    // (scenes), prefer the highest-priority character ref's URL. For
    // reference sheets themselves we skip `--cref` because they ARE the
    // anchor. The existing `--sref <code>` numeric-code path remains as
    // a fallback when no style-reference URL is available.
    let crefSrefParams: string[] = [];
    if (mj.enableCrefSref && !isReferenceLike) {
      const characterRefUrl = referenceImages
        ?.find(r => r.url && (r.role === 'character-reference' || r.role === 'master-reference'))
        ?.url;
      const styleRefUrl = referenceImages
        ?.find(r => r.url && r.role === 'style-reference')
        ?.url;
      if (characterRefUrl) {
        crefSrefParams.push(`--cref ${characterRefUrl}`);
        const cw = Math.max(0, Math.min(100, mj.characterWeight ?? 100));
        crefSrefParams.push(`--cw ${cw}`);
      }
      if (styleRefUrl) {
        crefSrefParams.push(`--sref ${styleRefUrl}`);
        const sw = Math.max(0, Math.min(1000, mj.styleWeight ?? 100));
        crefSrefParams.push(`--sw ${sw}`);
      }
    }

    const params = [
      `--ar ${aspectRatio}`,
      mj.version ? `--v ${mj.version}` : '',
      typeof stylize === 'number' ? `--stylize ${stylize}` : '',
      // Prefer URL-based --sref from crefSrefParams; fall back to numeric code.
      crefSrefParams.some(p => p.startsWith('--sref ')) ? '' : (mj.srefCode ? `--sref ${mj.srefCode}` : ''),
      ...crefSrefParams,
      speedFlag,
    ].filter(Boolean);

    return `${subjectDescription}, ${resolvedStyle} style, cinematic storytelling, no overlay text, no captions, no collage ${params.join(' ')}`.trim();
  }

  private isExpressionLikeImage(imageType?: string, identifier?: string): boolean {
    return imageType === 'expression' || !!identifier?.startsWith('expr_');
  }

  private isReferenceLikeImage(imageType?: string, identifier?: string): boolean {
    return imageType === 'master' || this.isExpressionLikeImage(imageType, identifier) || !!identifier?.startsWith('ref_');
  }

  private promptExplicitlyAllowsFaceCovering(promptText?: string): boolean {
    const lower = (promptText || '').toLowerCase();
    return /\b(veil|veiled|face veil|bridal veil|niqab|burqa|mask|masked|face covering|covered face|scarf covering face|cloth covering face)\b/.test(lower);
  }

  private collectAtlasReferenceImages(referenceImages?: ReferenceImage[]): ReferenceImage[] {
    const refs: ReferenceImage[] = [];
    if (this._geminiStyleReference) {
      refs.push({ data: this._geminiStyleReference.data, mimeType: this._geminiStyleReference.mimeType, role: 'style-reference' });
    }
    if (this._geminiPreviousScene) {
      refs.push({ data: this._geminiPreviousScene.data, mimeType: this._geminiPreviousScene.mimeType, role: 'previous-scene-reference' });
    }
    if (referenceImages?.length) {
      refs.push(...referenceImages);
    }
    return refs.slice(0, this.modelCapabilities.maxRefImages);
  }

  private static readonly ATLAS_UPLOAD_PAYLOAD_THRESHOLD = 10 * 1024 * 1024; // 10 MB

  /**
   * Upload a base64 image to Atlas Cloud via the uploadMedia proxy route,
   * returning a URL that can be passed in the `images` array instead of
   * a large inline data URL. Falls back to the data URL if upload fails.
   */
  private async uploadAtlasMedia(
    base64Data: string,
    mimeType: string,
    apiKey: string,
  ): Promise<string> {
    try {
      const baseUrl = this.getAtlasCloudProxyUrl();
      const response = await fetch(`${baseUrl}/uploadMedia`, {
        method: 'POST',
        headers: {
          'x-atlas-cloud-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Data, mimeType }),
      });

      if (response.ok) {
        const data = await response.json();
        const url = data?.data?.download_url || data?.download_url;
        if (url) return url;
      }
    } catch (err) {
      console.warn('[ImageGenerationService] Atlas uploadMedia failed, using inline data URL:', (err as Error).message);
    }
    return `data:${mimeType};base64,${base64Data}`;
  }

  /**
   * Convert reference images to Atlas Cloud `body.images` entries.
   * When the total payload exceeds 10 MB, attempts to pre-upload via
   * uploadMedia so the request body stays small.
   */
  async prepareAtlasImageRefs(
    refs: ReferenceImage[],
    apiKey: string,
  ): Promise<string[]> {
    const totalBytes = refs.reduce((sum, r) => sum + (r.data?.length || 0), 0);
    const useUpload = totalBytes > ImageGenerationService.ATLAS_UPLOAD_PAYLOAD_THRESHOLD;

    if (useUpload) {
      console.log(`[ImageGenerationService] Atlas refs payload ~${(totalBytes / 1024 / 1024).toFixed(1)} MB — pre-uploading via uploadMedia`);
      const urls: string[] = [];
      for (const ref of refs) {
        urls.push(await this.uploadAtlasMedia(ref.data, ref.mimeType, apiKey));
      }
      return urls;
    }

    return refs.map(ref => `data:${ref.mimeType};base64,${ref.data}`);
  }

  private injectStyleReferenceImages(parts: any[], gemSettings: any, imageNumber?: number): number {
    let num = imageNumber || parts.length;
    if (gemSettings.includeStyleReference && this._geminiStyleReference) {
      parts.push({ inlineData: { mimeType: this._geminiStyleReference.mimeType, data: this._geminiStyleReference.data } });
      parts.push({ text: `Style consistency reference — approximate guide for color temperature, rendering density, and composition feel. The ART STYLE text directive above is authoritative; follow its description over any visual differences in this reference.` });
      num++;
    }
    if (gemSettings.includePreviousScene && this._geminiPreviousScene) {
      parts.push({ inlineData: { mimeType: this._geminiPreviousScene.mimeType, data: this._geminiPreviousScene.data } });
      parts.push({ text: `Previous scene — STYLE AND SETTING CONTINUITY REFERENCE ONLY. Match color grading, lighting temperature, and environmental feel. Do NOT copy character appearance from this image; character identity comes from the dedicated character reference images.` });
      num++;
    }
    return num;
  }

  /**
   * Start a new multi-turn chat session for a scene.
   * Clears any existing chat history and sets the scene context.
   * Used for within-scene beat generation where Gemini retains visual context.
   */
  public startChatSession(sceneId: string, systemContext?: string): void {
    this._chatHistory = [];
    this._chatSceneId = sceneId;
    // Optionally prime the chat with system context (style, character refs, etc.)
    if (systemContext) {
      this._chatHistory.push({
        role: 'user',
        parts: [{ text: systemContext }]
      });
      // Add a synthetic model response to keep the alternation pattern
      this._chatHistory.push({
        role: 'model',
        parts: [{ text: 'Understood. I will generate images consistent with the provided style and character references.' }]
      });
    }
    console.log(`[ImageGenerationService] Chat session started for scene ${sceneId}`);
  }

  /**
   * End the current chat session.
   */
  public endChatSession(): void {
    const sceneId = this._chatSceneId;
    this._chatHistory = [];
    this._chatSceneId = null;
    console.log(`[ImageGenerationService] Chat session ended for scene ${sceneId}`);
  }

  /**
   * Check if a chat session is active for the given scene.
   */
  public hasChatSession(sceneId: string): boolean {
    return this._chatSceneId === sceneId && this._chatHistory.length > 0;
  }

  /**
   * Generate an image within an active chat session.
   * The conversation history is passed to Gemini so it retains context of
   * previously generated images, providing automatic within-scene continuity.
   * 
   * Falls back to regular generateImage if chat API is not available.
   */
  async generateImageInChat(
    prompt: ImagePrompt,
    identifier: string,
    referenceImages?: ReferenceImage[],
    metadata?: {
      characterNames?: string[];
      characterDescriptions?: CharacterAppearanceDescription[];
    }
  ): Promise<GeneratedImage> {
    if (!this._chatSceneId || this.config.provider !== 'nano-banana') {
      // Fallback to regular generation if no chat session or wrong provider
      return this.generateImage(prompt, identifier, { type: 'scene' }, referenceImages);
    }

    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.geminiApiKey || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) return this.generateImage(prompt, identifier, { type: 'scene' }, referenceImages);

    const normalizedPrompt = this.injectCharacterIdentity(prompt, metadata?.characterNames, metadata?.characterDescriptions);

    const model = this._geminiSettings.model;
    const gemSettings = this._geminiSettings;
    const jobId = `chat-${identifier}-${Date.now()}`;

    this.emit({ type: 'job_added', job: { id: jobId, identifier, prompt: normalizedPrompt.prompt, status: 'pending' } });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.waitForProviderPacing('nano-banana');

        // Build the new user turn
        const userParts: any[] = [];

        // Always include reference images for character identity consistency.
        // Early turns get the full set; later turns get a reduced set (face/character
        // refs only) to manage token budget while preserving identity anchoring.
        if (referenceImages && referenceImages.length > 0) {
          const isEarlyTurn = this._chatHistory.length <= 4;
          const effectiveRefs = isEarlyTurn
            ? referenceImages
            : this.prioritizeReferenceImages(referenceImages, Math.min(referenceImages.length, 3));
          for (const ref of effectiveRefs) {
            userParts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            const label = ref.characterName
              ? `Character reference: ${ref.characterName}${ref.viewType ? ` (${ref.viewType})` : ''}`
              : `Reference (${ref.role})`;
            userParts.push({ text: label });
          }
          if (!isEarlyTurn) {
            userParts.push({ text: `Character identity reminder: match the faces, builds, and distinguishing features from the reference images above exactly.` });
          }
        }

        // Art style — explicit first-class part for consistency
        const chatArtStyle = this.resolveArtStyle(normalizedPrompt.style, identifier);
        userParts.push({ text: `Art style: ${chatArtStyle}.` });

        // Style reference + previous scene for visual continuity
        this.injectStyleReferenceImages(userParts, gemSettings);

        // The scene prompt (uses identity-injected prompt)
        const narrativePrompt = this.buildNarrativePrompt(normalizedPrompt, true);
        userParts.push({ text: `Generate the next story image:\n\n${narrativePrompt}` });

        // Build full contents with history + new turn
        const contents = [
          ...this._chatHistory,
          { role: 'user' as const, parts: userParts }
        ];

        const geminiAspectRatio = this.mapToGeminiAspectRatio(normalizedPrompt.aspectRatio || '9:16');
        const chatGenConfig: Record<string, unknown> = {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: this.buildImageConfig(geminiAspectRatio, 'scene'),
        };
        const chatThinking = this.buildThinkingConfig('scene');
        if (chatThinking) chatGenConfig.thinkingConfig = chatThinking;

        console.log(`[ImageGenerationService] Gemini CHAT request: ${contents.length} turns, model=${model}`);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: chatGenConfig,
          })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status} - ${await response.text()}`);
        const data = await response.json();
        if (!data.candidates?.[0]?.content?.parts) throw this.buildGeminiMalformedResponseError(data, model);

        const candidateContent = data.candidates[0].content;
        const responseParts = candidateContent.parts;
        let imageData: string | undefined;
        let mimeType = 'image/png';
        for (const part of responseParts) {
          if (part.inlineData) {
            imageData = part.inlineData.data;
            mimeType = part.inlineData.mimeType || 'image/png';
            break;
          }
        }
        if (!imageData) throw new Error('No image data in Gemini chat response');

        // Append this exchange to chat history, preserving thought_signature
        // fields from model response parts for NB2 multi-turn continuity.
        // Strip inlineData blobs to prevent unbounded heap growth — the current
        // request already carries reference/style images; history only needs text.
        const stripInlineData = (parts: any[]): any[] =>
          parts
            .filter((p: any) => !p.inlineData)
            .map((p: any) => (p.thought_signature ? { ...p } : p));
        this._chatHistory.push({ role: 'user', parts: stripInlineData(userParts) });
        this._chatHistory.push({ role: 'model', parts: stripInlineData(responseParts) });

        // Trim chat history to avoid token limits (keep last 6 turns = 3 exchanges)
        const MAX_HISTORY_TURNS = 8;
        if (this._chatHistory.length > MAX_HISTORY_TURNS) {
          // Keep the first 2 turns (system context) and the most recent turns
          const systemTurns = this._chatHistory.slice(0, 2);
          const recentTurns = this._chatHistory.slice(-MAX_HISTORY_TURNS + 2);
          this._chatHistory = [...systemTurns, ...recentTurns];
        }

        // Save image to disk
        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
        const imagePath = this.joinPath(this.outputDir, `${identifier}.${extension}`);
        await this.writeFile(imagePath, imageData, true);

        const imageUrl = this.toImageHttpUrl(imagePath, mimeType, imageData);

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl } });
        return {
          prompt: normalizedPrompt,
          imageUrl,
          imagePath,
          imageData,
          mimeType,
          provider: 'nano-banana',
          model,
          metadata: { chatMode: true, chatTurns: this._chatHistory.length },
        };
      } catch (error: any) {
        lastError = error;
        console.error(`[ImageGenerationService] Chat generation attempt ${attempt} failed:`, error.message);
        if (attempt < this.maxRetries) await this.delay(2000 * attempt);
      }
    }
    // If chat fails, fall back to regular generation
    console.warn(`[ImageGenerationService] Chat mode failed after ${this.maxRetries} attempts, falling back to regular generation`);
    return this.generateImage(normalizedPrompt, identifier, { type: 'scene' }, referenceImages);
  }

  public onEvent(listener: (event: ImageJobEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: ImageJobEvent): void {
    this.listeners.forEach(l => l(event));
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public hasAtlasCloudConfigured(): boolean {
    return !!this.config.atlasCloudApiKey?.trim();
  }

  /**
   * If an image file already exists for this identifier (sanitized), return paths for resume/reuse.
   */
  public findExistingGeneratedImage(rawIdentifier: string): { imagePath: string; imageUrl?: string } | undefined {
    const identifier = rawIdentifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
    const existingFile = this.getExistingImageFile(identifier);
    if (!existingFile) return undefined;
    return { imagePath: existingFile, imageUrl: this.getServedImageUrl(existingFile) };
  }

  private getExistingImageFile(identifier: string): string | undefined {
    const extensions = ['png', 'jpg', 'jpeg', 'webp'];
    for (const ext of extensions) {
      const filePath = this.joinPath(this.outputDir, `${identifier}.${ext}`);
      if (nodeFs && typeof nodeFs.existsSync === 'function') {
        if (nodeFs.existsSync(filePath)) return filePath;
      }
    }
    return undefined;
  }

  public setOutputDirectory(dir: string): void {
    this.outputDir = normalizeManagedOutputPath(dir);
    this.ensureDirectory(this.outputDir);
  }

  /**
   * Reconcile cached reference images against the current art style.
   *
   * Cached images on disk (e.g. `ref_char1_front.png`) are keyed by identifier
   * only, NOT by the art style they were generated under. If a user changes
   * the art style between runs and generation resumes, `getExistingImageFile`
   * happily returns the old image — and every scene that references it is
   * then instructed to "match the exact hair / features / distinguishing
   * traits" from that stale image, which drags the whole story back toward
   * the previous aesthetic.
   *
   * This method writes a `.art-style-signature.txt` sidecar into the output
   * directory capturing the currently-effective art style. On a subsequent
   * call, if the signature has changed, it deletes cached reference-sheet
   * images (identifiers matching `ref_*`) and clears in-memory prompt /
   * identifier dedup caches so a fresh generation happens under the new
   * style. Beat images are left alone — they'll be re-linked by normal
   * resume logic, and a mismatched aesthetic on a beat is easier for the
   * user to regenerate than a locked-in reference sheet.
   *
   * Returns the number of invalidated files (0 if signature unchanged or
   * filesystem is unavailable, as in the Expo/web runtime).
   */
  public reconcileCachedReferenceStyle(artStyle: string | undefined): number {
    if (!nodeFs || typeof nodeFs.existsSync !== 'function') return 0;
    const effectiveStyle = (artStyle || '').trim();
    const signaturePath = this.joinPath(this.outputDir, '.art-style-signature.txt');

    let previousStyle: string | null = null;
    try {
      if (nodeFs.existsSync(signaturePath) && typeof nodeFs.readFileSync === 'function') {
        previousStyle = String(nodeFs.readFileSync(signaturePath, 'utf-8')).trim();
      }
    } catch {
      previousStyle = null;
    }

    const styleChanged = previousStyle !== null && previousStyle !== effectiveStyle;

    if (styleChanged) {
      console.warn(
        `[ImageGenService] Art style changed since last run ("${previousStyle}" -> "${effectiveStyle}"). ` +
        `Invalidating cached reference-sheet images so they regenerate under the new style.`,
      );
    }

    let invalidated = 0;
    if (styleChanged && typeof nodeFs.readdirSync === 'function' && typeof nodeFs.unlinkSync === 'function') {
      try {
        const files: string[] = nodeFs.readdirSync(this.outputDir);
        for (const name of files) {
          if (!/^ref_.*\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
          const fullPath = this.joinPath(this.outputDir, name);
          try {
            nodeFs.unlinkSync(fullPath);
            invalidated++;
          } catch (err) {
            console.warn(`[ImageGenService] Failed to invalidate stale ref image "${name}":`, err);
          }
        }
        if (invalidated > 0) {
          this._promptCache.clear();
          this._generatedIdentifiers.clear();
          console.log(`[ImageGenService] Invalidated ${invalidated} stale reference image(s) and cleared dedup caches.`);
        }
      } catch (err) {
        console.warn(`[ImageGenService] Failed to scan output directory for stale references:`, err);
      }
    }

    try {
      if (typeof nodeFs.writeFileSync === 'function') {
        nodeFs.writeFileSync(signaturePath, effectiveStyle, 'utf-8');
      }
    } catch (err) {
      console.warn(`[ImageGenService] Failed to persist art-style signature:`, err);
    }

    return invalidated;
  }

  /**
   * Convert an image file path to an HTTP URL served by the proxy.
   * Handles both relative ('generated-stories/...') and absolute ('/app/generated-stories/...') paths.
   * Returns a data URI fallback only when the path isn't under a served directory.
   */
  private toImageHttpUrl(imagePath: string, mimeType: string, imageData: string): string {
    const gsIndex = imagePath.indexOf('generated-stories/');
    if (gsIndex >= 0) {
      const relativePath = imagePath.slice(gsIndex);
      const hostname = (typeof window !== 'undefined' && window.location?.hostname) || 'localhost';
      return `http://${hostname}:3001/${relativePath}`;
    }
    return `data:${mimeType};base64,${imageData}`;
  }

  private toOutputHttpUrl(filePath: string): string | undefined {
    const gsIndex = filePath.indexOf('generated-stories/');
    if (gsIndex < 0) return undefined;
    const relativePath = filePath.slice(gsIndex);
    const hostname = (typeof window !== 'undefined' && window.location?.hostname) || 'localhost';
    return `http://${hostname}:3001/${relativePath}`;
  }

  private getServedImageUrl(imagePath?: string): string | undefined {
    if (!imagePath || /\.(txt)$/i.test(imagePath)) return undefined;
    return this.toOutputHttpUrl(imagePath);
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    if (!this.config.enabled) return;
    if (nodeFs && typeof nodeFs.existsSync === 'function') {
      try {
        if (nodeFs.existsSync(dirPath)) return;
        if (typeof nodeFs.mkdirSync === 'function') nodeFs.mkdirSync(dirPath, { recursive: true });
        return;
      } catch (e) {
        console.error(`[ImageGen] ensureDirectory FAILED for "${dirPath}":`, e);
        throw e;
      }
    }
    if (!isWebRuntime()) {
      try {
        const info = await ExpoFileSystem.getInfoAsync(dirPath);
        if (!info.exists) await ExpoFileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      } catch (e) {
        console.error(`[ImageGen] ensureDirectory (Expo) FAILED for "${dirPath}":`, e);
        throw e;
      }
    }
  }

  private async writeFile(filePath: string, content: string | Buffer, isBase64: boolean = false): Promise<void> {
    const resolvedPath = normalizeManagedOutputPath(filePath);
    if (nodeFs && typeof nodeFs.writeFileSync === 'function') {
      try {
        if (isBase64 && typeof content === 'string') {
          const buffer = Buffer.from(content, 'base64');
          nodeFs.mkdirSync?.(nodePath?.dirname(resolvedPath) || '.', { recursive: true });
          nodeFs.writeFileSync(resolvedPath, buffer);
        } else {
          nodeFs.mkdirSync?.(nodePath?.dirname(resolvedPath) || '.', { recursive: true });
          nodeFs.writeFileSync(resolvedPath, content);
        }
        return;
      } catch (e) {
        console.error(`[ImageGen] writeFile FAILED for "${resolvedPath}":`, e);
        throw e;
      }
    }
    if (isWebRuntime()) {
      const response = await fetch('http://localhost:3001/write-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: resolvedPath,
          content: typeof content === 'string' ? content : (isBase64 ? content.toString('base64') : content.toString()),
          isBase64: typeof content !== 'string' || isBase64
        }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`Proxy write failed for ${resolvedPath}: ${response.status}${message ? ` - ${message}` : ''}`);
      }
      return;
    }
    const options = isBase64 ? { encoding: 'base64' as any } : { encoding: 'utf8' as any };
    let data = typeof content === 'string' ? content : Buffer.isBuffer(content) ? content.toString('base64') : String(content);
    await ExpoFileSystem.writeAsStringAsync(resolvedPath, data, options);
  }

  private joinPath(base: string, ...parts: string[]): string {
    if (nodePath && typeof nodePath.join === 'function') return nodePath.join(base, ...parts);
    let result = base;
    for (const part of parts) {
      if (!result.endsWith('/') && !part.startsWith('/')) result += '/';
      else if (result.endsWith('/') && part.startsWith('/')) result = result.slice(0, -1);
      result += part;
    }
    return result;
  }

  private async buildReferenceThumbnails(
    identifier: string,
    referenceImages?: ReferenceImage[],
  ): Promise<ReferenceThumbnail[] | undefined> {
    if (!referenceImages?.length) return undefined;

    const previewsDir = this.joinPath(this.outputDir, 'job-reference-previews');
    await this.ensureDirectory(previewsDir);

    const thumbnails: ReferenceThumbnail[] = [];
    const seen = new Set<string>();
    for (const ref of referenceImages) {
      const dedupeKey = `${ref.characterName || ref.role}:${ref.viewType || 'ref'}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const ext = ref.mimeType.includes('jpeg') || ref.mimeType.includes('jpg')
        ? 'jpg'
        : ref.mimeType.includes('webp')
          ? 'webp'
          : 'png';
      const safeKey = dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const filePath = this.joinPath(previewsDir, `${identifier}-${safeKey || thumbnails.length}.${ext}`);
      await this.writeFile(filePath, ref.data, true);
      const uri = this.toOutputHttpUrl(filePath);
      if (!uri) continue;

      thumbnails.push({
        id: `${identifier}-${thumbnails.length}`,
        uri,
        characterName: ref.characterName,
        viewType: ref.viewType,
        role: ref.role,
      });
      if (thumbnails.length >= 4) break;
    }

    return thumbnails.length > 0 ? thumbnails : undefined;
  }

  /**
   * Compute a cache key from prompt text + scene/beat IDs to avoid collisions.
   */
  private computePromptHash(
    prompt: ImagePrompt,
    metadata?: {
      sceneId?: string;
      beatId?: string;
      shotId?: string;
      characterId?: string;
      choiceId?: string;
      tier?: string;
      type?: ImageType;
      baseIdentifier?: string;
    }
  ): string {
    const text = [
      prompt.prompt || '',
      prompt.style || '',
      metadata?.sceneId || '',
      metadata?.beatId || '',
      metadata?.choiceId || '',
      metadata?.tier || '',
      metadata?.shotId || '',
      metadata?.characterId || '',
      metadata?.type || '',
      metadata?.baseIdentifier || '',
    ].join('|');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return `ph_${hash.toString(36)}`;
  }

  /**
   * Wait until the next request against `provider` is allowed by its
   * per-provider pacing (A1). Replaces the former single-instance
   * `lastRequestTime` + `minRequestInterval` pair so one provider's rate
   * ceiling no longer throttles the others.
   */
  private async waitForProviderPacing(provider: ImageProvider): Promise<void> {
    await this._throttle.waitForPacing(provider);
  }

  /**
   * A9: Drop references this provider can't meaningfully consume. Returns
   * a possibly-shorter array; caller should use the result in place of the
   * original refs. Capacity (`maxRefs`) is enforced here too so a downstream
   * provider never sees an over-stuffed payload.
   *
   * Behavior:
   * - `maxRefs === 0`: drop everything.
   * - provider only accepts URL refs and the ref doesn't have a URL-bearing
   *   external representation: drop it (we don't pre-upload in this pass).
   * - otherwise: cap to `maxRefs` and preserve ordering (caller has already
   *   prioritized via the reference pack builder).
   */
  private filterReferencesForProvider(
    provider: ImageProvider,
    refs: ReferenceImage[] | undefined,
  ): ReferenceImage[] | undefined {
    if (!refs || refs.length === 0) return refs;
    const caps = getProviderCapabilities(provider);
    if (caps.maxRefs === 0) return [];

    const usable = refs.filter((ref) => {
      const hasInlineData = typeof ref.data === 'string' && ref.data.length > 0;
      if (hasInlineData && caps.acceptsInlineRefs) return true;
      const hasUrl = typeof (ref as any).url === 'string' && (ref as any).url.length > 0;
      if (hasUrl && (caps.acceptsUrlRefs || caps.usesMidjourneyRefTokens)) return true;
      return false;
    });

    if (usable.length <= caps.maxRefs) return usable;
    return usable.slice(0, caps.maxRefs);
  }

  /**
   * Classify errors as transient (worth retrying) or permanent (do not retry).
   */
  static classifyError(error: any): 'transient' | 'permanent' | 'text_instead_of_image' {
    const msg = (error?.message || error?.toString() || '').toLowerCase();
    const providerFailureKind = error?.providerFailureKind as ProviderFailureKind | undefined;
    if (msg.includes('gemini returned text instead of image')) {
      return 'text_instead_of_image';
    }
    if (providerFailureKind === 'schema_invalid' || providerFailureKind === 'empty_candidate') {
      return 'transient';
    }
    if (providerFailureKind === 'safety_block' || providerFailureKind === 'content_policy' || providerFailureKind === 'blocked') {
      return 'permanent';
    }
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('timeout') || msg.includes('503') || msg.includes('econnreset') || msg.includes('socket hang up')) {
      return 'transient';
    }
    if (msg.includes('content policy') || msg.includes('blocked') || msg.includes('safety')) {
      return 'permanent';
    }
    if (msg.includes('invalid api response structure') || msg.includes('missing candidates') || msg.includes('empty candidate')) {
      return 'transient';
    }
    return 'transient';
  }

  async generateImage(
    prompt: ImagePrompt,
    rawIdentifier: string,
    metadata?: { 
      sceneId?: string; 
      beatId?: string; 
      shotId?: string;
      characterId?: string;
      viewType?: string;
      choiceId?: string;
      tier?: string;
      baseIdentifier?: string;
      resolvedIdentifier?: string;
      type: ImageType; 
      characters?: string[];
      characterNames?: string[];
      characterDescriptions?: CharacterAppearanceDescription[];
      regeneration?: number;
      /** When true (encounter types only), try Atlas Cloud before Gemini if primary provider is nano-banana. */
      preferAtlasFirst?: boolean;
    },
    referenceImages?: ReferenceImage[]
  ): Promise<GeneratedImage> {
    const identifier = rawIdentifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
    const jobId = `${identifier}-${Date.now()}`;
    if (!this.config.enabled) return { prompt, imagePath: undefined, imageUrl: undefined };
    const requestStartedAt = Date.now();

    // Enforce consistent, explicit character naming + physical descriptions.
    const normalizedPrompt = this.injectCharacterIdentity(prompt, metadata?.characterNames, metadata?.characterDescriptions);

    // Check caches BEFORE emitting job_added to avoid phantom UI entries for cache hits
    if (!metadata?.regeneration) {
      const cacheKey = this.computePromptHash(normalizedPrompt, metadata);
      const cached = this._promptCache.get(cacheKey);
      if (cached) {
        this.pipelineMetrics.cacheHits++;
        console.log(`[ImageGenerationService] Prompt cache HIT for ${identifier} (no UI job created)`);
        return {
          prompt: normalizedPrompt,
          imagePath: cached.imagePath,
          imageUrl: cached.imageUrl || this.getServedImageUrl(cached.imagePath),
          mimeType: cached.mimeType,
        };
      }
      this.pipelineMetrics.cacheMisses++;
    }

    const existingFile = this.getExistingImageFile(identifier);
    if (existingFile) {
      const imageUrl = this.getServedImageUrl(existingFile);
      console.log(`[ImageGenerationService] File cache HIT for ${identifier} (no UI job created)`);
      this._generatedIdentifiers.add(identifier);
      return { prompt: normalizedPrompt, imagePath: existingFile, imageUrl, metadata: { format: existingFile.split('.').pop() } };
    }

    // Identifier-based dedup: if we already generated this identifier successfully in this
    // pipeline run, skip. This covers the browser runtime where file-existence checks are unavailable.
    // NOTE: registration now happens AFTER success (see end of method), not here.
    if (!metadata?.regeneration && this._generatedIdentifiers.has(identifier)) {
      console.log(`[ImageGenerationService] Identifier dedup HIT for "${identifier}" — skipping duplicate generation`);
      return { prompt: normalizedPrompt, imagePath: undefined, imageUrl: undefined };
    }

    // A11: Inflight dedup. Two concurrent callers for the same prompt hash
    // share a single provider round-trip instead of racing each other. Only
    // applies to first-try generations (regenerations bypass so the caller
    // always gets a fresh image).
    if (!metadata?.regeneration) {
      const inflightKey = this.computePromptHash(normalizedPrompt, metadata);
      const existingInflight = this._inflightGenerations.get(inflightKey);
      if (existingInflight) {
        console.log(`[ImageGenerationService] Inflight dedup for "${identifier}" — awaiting in-progress generation`);
        return existingInflight;
      }
      const work = this.generateImageCore(
        normalizedPrompt,
        identifier,
        jobId,
        requestStartedAt,
        metadata,
        referenceImages,
      );
      this._inflightGenerations.set(inflightKey, work);
      work.finally(() => {
        if (this._inflightGenerations.get(inflightKey) === work) {
          this._inflightGenerations.delete(inflightKey);
        }
      });
      return work;
    }

    return this.generateImageCore(
      normalizedPrompt,
      identifier,
      jobId,
      requestStartedAt,
      metadata,
      referenceImages,
    );
  }

  /**
   * Inner generation path called by `generateImage` after caches and inflight
   * dedup have been resolved. Factored out so the dedup wrapper doesn't
   * duplicate the ~250 line generation pipeline.
   */
  private async generateImageCore(
    normalizedPrompt: ImagePrompt,
    identifier: string,
    jobId: string,
    requestStartedAt: number,
    metadata: Parameters<ImageGenerationService['generateImage']>[2],
    referenceImages: ReferenceImage[] | undefined,
  ): Promise<GeneratedImage> {
    const promptArtifact = this.config.savePrompts !== false
      ? await this.savePrompt(normalizedPrompt, identifier, metadata)
      : undefined;
    const referenceThumbnails = await this.buildReferenceThumbnails(identifier, referenceImages);
    const jobMetadata = {
      ...(metadata || {}),
      promptUrl: promptArtifact?.promptUrl,
      promptPath: promptArtifact?.promptPath,
      referenceThumbnails,
    };

    // Only emit job_added for actual generation work (cache miss + no existing file + no identifier dedup)
    this.emit({
      type: 'job_added',
      job: {
        id: jobId,
        identifier,
        prompt: JSON.stringify(normalizedPrompt, null, 2),
        status: 'pending',
        maxRetries: this.maxRetries,
        metadata: jobMetadata,
      }
    });

    // Resolve provider first so the concurrency gate is per-provider (A1).
    let provider = this.normalizeProvider(this.config.provider);
    const providerFamily = this.getPolicyFamily(metadata?.type);
    if (!this.providerPolicy.canUseProvider(provider, providerFamily) && provider === 'nano-banana' && this.hasAtlasCloudConfigured()) {
      provider = 'atlas-cloud';
    }
    const releaseProviderSlot = await this._throttle.acquire(provider);
    // A9: Drop reference images the provider can't meaningfully consume. Avoids
    // paying the tokenization / upload cost on refs that would have been
    // silently ignored by the downstream provider.
    const capabilityFilteredRefs = this.filterReferencesForProvider(provider, referenceImages);
    try {
      let result: GeneratedImage;
      const preferAtlasFirst =
        !!metadata?.preferAtlasFirst &&
        this.shouldTrackEncounterType(metadata?.type) &&
        this.hasAtlasCloudConfigured() &&
        provider === 'nano-banana';

      if (preferAtlasFirst) {
        try {
          result = await this.generateWithAtlasCloud(normalizedPrompt, identifier, jobId, capabilityFilteredRefs, metadata?.type);
          if (!result.imageUrl && result.imagePath) {
            result.imageUrl = this.getServedImageUrl(result.imagePath);
          }
          if (result.imageUrl || result.imagePath) {
            // Fall through to shared post-processing below (cache, diagnostics)
          } else {
            throw new Error('Atlas-first encounter slot returned no image');
          }
        } catch (atlasErr) {
          const msg = atlasErr instanceof Error ? atlasErr.message : String(atlasErr);
          console.warn(`[ImageGenerationService] Atlas-first encounter generation failed, using Gemini: ${msg}`);
          this.providerPolicy.observeTransientFailure('atlas-cloud', providerFamily);
          result = await this.generateWithNanoBanana(normalizedPrompt, identifier, jobId, this.filterReferencesForProvider('nano-banana', referenceImages), metadata?.type);
        }
      } else switch (provider) {
        case 'nano-banana': result = await this.generateWithNanoBanana(normalizedPrompt, identifier, jobId, capabilityFilteredRefs, metadata?.type); break;
        case 'atlas-cloud': result = await this.generateWithAtlasCloud(normalizedPrompt, identifier, jobId, capabilityFilteredRefs, metadata?.type); break;
        case 'midapi':
        case 'useapi':
          result = await this.generateWithUseapi(normalizedPrompt, identifier, jobId, metadata, capabilityFilteredRefs);
          break;
        case 'dall-e': result = await this.generateWithDallE(normalizedPrompt, identifier, jobId); break;
        case 'stable-diffusion': result = await this.generateWithStableDiffusion(normalizedPrompt, identifier, jobId, capabilityFilteredRefs, metadata); break;
        default:
          if (this.isFailFastEnabled()) {
            throw new Error(`Image provider "${String(this.config.provider || 'placeholder')}" is not available in fail-fast mode`);
          }
          result = await this.generatePlaceholder(normalizedPrompt, identifier, jobId);
          break;
      }

      if (!result.imageUrl && result.imagePath) {
        result.imageUrl = this.getServedImageUrl(result.imagePath);
      }

      const effectiveMeta = this.extractEffectiveRequestMeta(result, normalizedPrompt, referenceImages);

      if (
        this.shouldTrackEncounterType(metadata?.type) &&
        provider === 'nano-banana' &&
        this.config.atlasCloudApiKey &&
        this.isPlaceholderResult(result)
      ) {
        console.warn(`[ImageGenerationService] Encounter fallback: nano-banana returned placeholder for "${identifier}", trying Atlas Cloud`);
        const fallbackResult = await this.generateWithAtlasCloud(normalizedPrompt, `${identifier}-atlas-fallback`, jobId, referenceImages, metadata?.type);
        if (fallbackResult.imagePath && !fallbackResult.imageUrl) {
          fallbackResult.imageUrl = this.getServedImageUrl(fallbackResult.imagePath);
        }
        if (fallbackResult.imageUrl || fallbackResult.imagePath) {
          this.providerPolicy.observeSuccess('atlas-cloud', providerFamily);
          this.recordEncounterDiagnostic({
            timestamp: new Date().toISOString(),
            identifier,
            baseIdentifier: metadata?.baseIdentifier,
            resolvedIdentifier: metadata?.resolvedIdentifier || identifier,
            provider,
            fallbackProvider: 'atlas-cloud',
            slotFamily: this.getEncounterSlotFamily(metadata?.type),
            imageType: metadata?.type,
            sceneId: metadata?.sceneId,
            beatId: metadata?.beatId,
            choiceId: metadata?.choiceId,
            tier: metadata?.tier,
            status: 'fallback_success',
            attempts: effectiveMeta.providerAttemptCount || 1,
            durationMs: Date.now() - requestStartedAt,
            promptChars: normalizedPrompt.prompt?.length || 0,
            negativeChars: normalizedPrompt.negativePrompt?.length || 0,
            refCount: referenceImages?.length || 0,
            effectivePromptChars: effectiveMeta.effectivePromptChars,
            effectiveNegativeChars: effectiveMeta.effectiveNegativeChars,
            effectiveRefCount: effectiveMeta.effectiveRefCount,
            model: effectiveMeta.model,
            fallbackTried: true,
            fallbackSucceeded: true,
            imagePath: fallbackResult.imagePath,
            imageUrl: fallbackResult.imageUrl,
          });
          return fallbackResult;
        }
      }

      // Store in prompt-hash cache on success (omit imageData to avoid unbounded heap growth)
      if (result.imageUrl || result.imagePath) {
        const cacheKey = this.computePromptHash(normalizedPrompt, metadata);
        this._promptCache.set(cacheKey, {
          imageUrl: result.imageUrl,
          imagePath: result.imagePath,
          mimeType: result.mimeType,
        });
      }

      if (this.shouldTrackEncounterType(metadata?.type)) {
        this.recordEncounterDiagnostic({
          timestamp: new Date().toISOString(),
          identifier,
          baseIdentifier: metadata?.baseIdentifier,
          resolvedIdentifier: metadata?.resolvedIdentifier || identifier,
          provider,
          slotFamily: this.getEncounterSlotFamily(metadata?.type),
          imageType: metadata?.type,
          sceneId: metadata?.sceneId,
          beatId: metadata?.beatId,
          choiceId: metadata?.choiceId,
          tier: metadata?.tier,
          status: result.imageUrl || result.imagePath ? 'success' : 'failed',
          errorClass: result.imageUrl || result.imagePath ? undefined : 'transient',
          errorMessage: result.imageUrl || result.imagePath ? undefined : 'no image URL/path returned',
          attempts: effectiveMeta.providerAttemptCount || 1,
          durationMs: Date.now() - requestStartedAt,
          promptChars: normalizedPrompt.prompt?.length || 0,
          negativeChars: normalizedPrompt.negativePrompt?.length || 0,
          refCount: referenceImages?.length || 0,
          effectivePromptChars: effectiveMeta.effectivePromptChars,
          effectiveNegativeChars: effectiveMeta.effectiveNegativeChars,
          effectiveRefCount: effectiveMeta.effectiveRefCount,
          providerFailureKind: effectiveMeta.providerFailureKind,
          candidateCount: effectiveMeta.candidateCount,
          hasCandidates: effectiveMeta.hasCandidates,
          finishReason: effectiveMeta.finishReason,
          blockReason: effectiveMeta.blockReason,
          responseExcerpt: effectiveMeta.responseExcerpt,
          model: effectiveMeta.model,
          imagePath: result.imagePath,
          imageUrl: result.imageUrl,
        });
      }

      this.providerPolicy.observeSuccess(provider, providerFamily);
      if (result.imageUrl || result.imagePath) {
        this._generatedIdentifiers.add(identifier);
      }
      return result;
    } catch (err) {
      const errorClass = ImageGenerationService.classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      if (errorClass === 'transient' || errorClass === 'text_instead_of_image') {
        this.providerPolicy.observeTransientFailure(provider, providerFamily);
      } else {
        this.providerPolicy.observePermanentFailure(provider, providerFamily);
      }
      const fallbackEligible =
        this.shouldTrackEncounterType(metadata?.type) &&
        provider === 'nano-banana' &&
        this.hasAtlasCloudConfigured() &&
        !metadata?.preferAtlasFirst &&
        errorClass === 'transient';

      if (fallbackEligible) {
        try {
          const fallbackResult = await this.generateWithAtlasCloud(normalizedPrompt, `${identifier}-atlas-fallback`, jobId, referenceImages, metadata?.type);
          if (!fallbackResult.imageUrl && fallbackResult.imagePath) {
            fallbackResult.imageUrl = this.getServedImageUrl(fallbackResult.imagePath);
          }
          if (fallbackResult.imageUrl || fallbackResult.imagePath) {
            this.providerPolicy.observeSuccess('atlas-cloud', providerFamily);
            const effectiveMeta = this.extractEffectiveRequestMeta(err, normalizedPrompt, referenceImages);
            this.recordEncounterDiagnostic({
              timestamp: new Date().toISOString(),
              identifier,
              baseIdentifier: metadata?.baseIdentifier,
              resolvedIdentifier: metadata?.resolvedIdentifier || identifier,
              provider,
              fallbackProvider: 'atlas-cloud',
              slotFamily: this.getEncounterSlotFamily(metadata?.type),
              imageType: metadata?.type,
              sceneId: metadata?.sceneId,
              beatId: metadata?.beatId,
              choiceId: metadata?.choiceId,
              tier: metadata?.tier,
              status: 'fallback_success',
              errorClass,
              errorMessage: message,
              providerFailureKind: effectiveMeta.providerFailureKind,
              attempts: effectiveMeta.providerAttemptCount || 1,
              durationMs: Date.now() - requestStartedAt,
              promptChars: normalizedPrompt.prompt?.length || 0,
              negativeChars: normalizedPrompt.negativePrompt?.length || 0,
              refCount: referenceImages?.length || 0,
              effectivePromptChars: effectiveMeta.effectivePromptChars,
              effectiveNegativeChars: effectiveMeta.effectiveNegativeChars,
              effectiveRefCount: effectiveMeta.effectiveRefCount,
              candidateCount: effectiveMeta.candidateCount,
              hasCandidates: effectiveMeta.hasCandidates,
              finishReason: effectiveMeta.finishReason,
              blockReason: effectiveMeta.blockReason,
              responseExcerpt: effectiveMeta.responseExcerpt,
              model: effectiveMeta.model,
              fallbackTried: true,
              fallbackSucceeded: true,
              imagePath: fallbackResult.imagePath,
              imageUrl: fallbackResult.imageUrl,
            });
            this._generatedIdentifiers.add(identifier);
            return fallbackResult;
          }
        } catch {
          // Fall through to normal failure diagnostics.
        }
      }

      if (this.shouldTrackEncounterType(metadata?.type)) {
        const effectiveMeta = this.extractEffectiveRequestMeta(err, normalizedPrompt, referenceImages);
        this.recordEncounterDiagnostic({
          timestamp: new Date().toISOString(),
          identifier,
          baseIdentifier: metadata?.baseIdentifier,
          resolvedIdentifier: metadata?.resolvedIdentifier || identifier,
          provider: this.normalizeProvider(this.config.provider),
          slotFamily: this.getEncounterSlotFamily(metadata?.type),
          imageType: metadata?.type,
          sceneId: metadata?.sceneId,
          beatId: metadata?.beatId,
          choiceId: metadata?.choiceId,
          tier: metadata?.tier,
          status: 'failed',
          errorClass,
          errorMessage: message,
          providerFailureKind: effectiveMeta.providerFailureKind,
          attempts: effectiveMeta.providerAttemptCount || this.maxRetries,
          durationMs: Date.now() - requestStartedAt,
          promptChars: normalizedPrompt.prompt?.length || 0,
          negativeChars: normalizedPrompt.negativePrompt?.length || 0,
          refCount: referenceImages?.length || 0,
          effectivePromptChars: effectiveMeta.effectivePromptChars,
          effectiveNegativeChars: effectiveMeta.effectiveNegativeChars,
          effectiveRefCount: effectiveMeta.effectiveRefCount,
          candidateCount: effectiveMeta.candidateCount,
          hasCandidates: effectiveMeta.hasCandidates,
          finishReason: effectiveMeta.finishReason,
          blockReason: effectiveMeta.blockReason,
          responseExcerpt: effectiveMeta.responseExcerpt,
          model: effectiveMeta.model,
          fallbackTried: fallbackEligible,
          fallbackSucceeded: false,
        });
      }
      throw err;
    } finally {
      releaseProviderSlot();
    }
  }

  /**
   * Edit an existing image using Gemini's image-to-image capability.
   * Passes the base image as input and asks Gemini to modify it according to the new prompt.
   * This preserves character identity far more reliably than regenerating from scratch.
   * 
   * Only works with the nano-banana (Gemini) provider.
   */
  async editImage(
    baseImage: { data: string; mimeType: string },
    prompt: ImagePrompt,
    identifier: string,
    referenceImages?: ReferenceImage[]
  ): Promise<GeneratedImage> {
    if (!this.config.enabled) return { prompt, imagePath: undefined, imageUrl: undefined };

    const provider = this.normalizeProvider(this.config.provider);

    // Stable Diffusion supports native img2img via its adapter — route there
    // first so we don't lose the base image by falling through to generateImage.
    if (provider === 'stable-diffusion') {
      const settings = this._stableDiffusionSettings;
      if (settings?.baseUrl) {
        const adapter = this.getSDAdapter();
        if (typeof adapter.edit === 'function') {
          try {
            return await adapter.edit(
              {
                prompt,
                identifier,
                jobId: `edit-${identifier}-${Date.now()}`,
                settings,
                referenceImages,
                baseImage,
              },
              this.getSDWriteHelpers(),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[ImageGenerationService] Stable Diffusion editImage failed for "${identifier}": ${msg}`);
            if (this.isFailFastEnabled()) throw err;
          }
        } else if (this.isFailFastEnabled()) {
          throw new Error(`Stable Diffusion adapter "${adapter.id}" does not support editImage`);
        }
      } else if (this.isFailFastEnabled()) {
        throw new Error('Stable Diffusion editImage requires STABLE_DIFFUSION_BASE_URL');
      }
      // Fallback: treat as fresh generation with the base image passed as init reference.
      const initRef: ReferenceImage = {
        data: baseImage.data,
        mimeType: baseImage.mimeType,
        role: 'img2img-init',
        purpose: 'init',
      };
      const combinedRefs = [initRef, ...(referenceImages || [])];
      return this.generateImage(prompt, identifier, { type: 'scene' }, combinedRefs);
    }

    if (provider !== 'nano-banana') {
      console.warn('[ImageGenerationService] editImage only supported for nano-banana and stable-diffusion providers, falling back to generateImage');
      return this.generateImage(prompt, identifier, { type: 'scene' }, referenceImages);
    }

    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.geminiApiKey || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) return this.generateImage(prompt, identifier, { type: 'scene' }, referenceImages);

    const model = this._geminiSettings.model;
    const gemSettings = this._geminiSettings;
    const jobId = `edit-${identifier}-${Date.now()}`;

    this.emit({ type: 'job_added', job: { id: jobId, identifier, prompt: prompt.prompt, status: 'pending', maxRetries: this.maxRetries } });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.waitForProviderPacing('nano-banana');

        const parts: any[] = [];

        // Edit instruction
        const artStyle = this.resolveArtStyle(prompt.style, identifier);
        parts.push({ text:
          `Edit the provided image to show the next moment in this story. ` +
          `Keep ALL characters' appearance IDENTICAL — same face, same hair, same build, same clothing. ` +
          `Art style: ${artStyle}. ` +
          `Change the scene to match the new description below while preserving character identity.`
        });

        // The base image to edit
        parts.push({ inlineData: { mimeType: baseImage.mimeType, data: baseImage.data } });
        parts.push({ text: 'Image to edit — modify this scene while keeping characters identical.' });

        // Character reference images (optional, for identity reinforcement)
        if (referenceImages && referenceImages.length > 0) {
          let imgNum = 2;
          for (const ref of referenceImages) {
            parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            const label = ref.characterName
              ? `Image ${imgNum}: Character reference for ${ref.characterName} — keep this character's appearance exactly.`
              : `Image ${imgNum}: Reference (${ref.role})`;
            parts.push({ text: label });
            imgNum++;
          }
        }

        // Style reference + previous scene for visual continuity
        this.injectStyleReferenceImages(parts, gemSettings);

        // The new scene description
        const narrativePrompt = this.buildNarrativePrompt(prompt, true);
        parts.push({ text: `New scene: ${narrativePrompt}` });

        const geminiAspectRatio = this.mapToGeminiAspectRatio(prompt.aspectRatio || '9:16');
        const editGenConfig: Record<string, unknown> = {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: this.buildImageConfig(geminiAspectRatio, undefined),
        };
        const editThinking = this.buildThinkingConfig(undefined);
        if (editThinking) editGenConfig.thinkingConfig = editThinking;

        console.log(`[ImageGenerationService] Gemini EDIT request: ${parts.length} parts, model=${model}`);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: editGenConfig,
          })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status} - ${await response.text()}`);
        const data = await response.json();
        if (!data.candidates?.[0]?.content?.parts) throw this.buildGeminiMalformedResponseError(data, model);

        let imageData: string | undefined;
        let mimeType = 'image/png';
        for (const part of data.candidates[0].content.parts) {
          if (part.inlineData) {
            imageData = part.inlineData.data;
            mimeType = part.inlineData.mimeType;
            break;
          }
        }
        if (!imageData) throw new Error('No image data in Gemini edit response');

        // Save the edited image to disk
        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
        const imagePath = this.joinPath(this.outputDir, `${identifier}.${extension}`);
        await this.writeFile(imagePath, imageData, true);

        const imageUrl = this.toImageHttpUrl(imagePath, mimeType, imageData);

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl } });
        return {
          prompt,
          imageUrl,
          imagePath,
          imageData,
          mimeType,
          provider: 'nano-banana',
          model,
          metadata: { editMode: true },
        };
      } catch (error: any) {
        lastError = error;
        console.error(`[ImageGenerationService] Edit attempt ${attempt} failed:`, error.message);
        if (attempt < this.maxRetries) await this.delay(2000 * attempt);
      }
    }
    // If all edit attempts fail, fall back to regular generation
    console.warn(`[ImageGenerationService] Edit mode failed after ${this.maxRetries} attempts, falling back to fresh generation`);
    return this.generateImage(prompt, identifier, { type: 'scene' }, referenceImages);
  }

  /**
   * Check if edit mode is enabled in Gemini settings
   */
  isEditModeEnabled(): boolean {
    return this._geminiSettings.useEditMode === true;
  }

  private async savePrompt(prompt: ImagePrompt, identifier: string, metadata?: any): Promise<{ promptPath: string; promptUrl?: string }> {
    const promptDir = this.joinPath(this.outputDir, 'prompts');
    await this.ensureDirectory(promptDir);
    const promptFile = this.joinPath(promptDir, `${identifier}.json`);
    await this.writeFile(promptFile, JSON.stringify({ identifier, metadata, prompt, timestamp: new Date().toISOString() }, null, 2));
    return { promptPath: promptFile, promptUrl: this.toOutputHttpUrl(promptFile) };
  }

  private injectCharacterIdentity(
    prompt: ImagePrompt,
    characterNames?: string[],
    characterDescriptions?: CharacterAppearanceDescription[],
  ): ImagePrompt {
    const names = Array.from(new Set((characterNames || []).map(n => (n || '').trim()).filter(Boolean)));
    const descs = Array.from(
      new Map(
        (characterDescriptions || [])
          .filter(d => d.name && (d.appearance || d.canonicalAppearance))
          .map(d => [d.name.trim().toLowerCase(), {
            name: d.name.trim(),
            appearance: (d.appearance || '').trim(),
            canonicalAppearance: d.canonicalAppearance,
          }])
      ).values()
    );

    if (names.length === 0 && descs.length === 0) return prompt;

    const hasAnyName = (text?: string) => {
      const t = (text || '').toLowerCase();
      return names.some(n => t.includes(n.toLowerCase()));
    };

    const out: ImagePrompt = { ...prompt };

    // Build a structured identity block from canonicalAppearance when the
    // upstream provided it. Each slot is rendered as a separate labeled line
    // — the model is much less likely to drop or summarize individual fields
    // than a prose paragraph.
    const identityLines: string[] = [];
    if (descs.length > 0) {
      for (const d of descs) {
        const ca = d.canonicalAppearance;
        if (ca && (ca.face || ca.hair || ca.eyes || ca.skinTone || ca.build || ca.height || (ca.distinguishingMarks && ca.distinguishingMarks.length) || ca.defaultAttire)) {
          const slotLines: string[] = [`${d.name}:`];
          if (ca.face) slotLines.push(`  - Face: ${ca.face}`);
          if (ca.hair) slotLines.push(`  - Hair: ${ca.hair}`);
          if (ca.eyes) slotLines.push(`  - Eyes: ${ca.eyes}`);
          if (ca.skinTone) slotLines.push(`  - Skin: ${ca.skinTone}`);
          if (ca.build) slotLines.push(`  - Build: ${ca.build}`);
          if (ca.height) slotLines.push(`  - Height: ${ca.height}`);
          if (ca.distinguishingMarks && ca.distinguishingMarks.length > 0) {
            slotLines.push(`  - Distinguishing marks: ${ca.distinguishingMarks.join('; ')}`);
          }
          if (ca.defaultAttire) slotLines.push(`  - Attire: ${ca.defaultAttire}`);
          identityLines.push(slotLines.join('\n'));
        } else if (d.appearance) {
          identityLines.push(`${d.name}: ${d.appearance}`);
        } else {
          identityLines.push(`${d.name}`);
        }
      }
    } else if (names.length > 0) {
      identityLines.push(`Characters: ${names.join(', ')}`);
    }

    const identityBlock = identityLines.length > 0
      ? `CHARACTER VISUAL IDENTITY — match these exact attributes from the reference images. Do NOT change hair color, eye color, skin tone, or distinguishing marks:\n${identityLines.join('\n')}`
      : '';

    // Inject identity whenever we have structured descriptions (this implies
    // the caller is passing reference images), and additionally whenever a
    // character name appears in the prompt text. For pure atmospheric shots
    // with no names and no descs, the early-return above already skipped.
    const promptMentionsCharacter = hasAnyName(out.prompt)
      || hasAnyName(out.visualNarrative)
      || hasAnyName(out.keyBodyLanguage)
      || hasAnyName(out.poseSpec)
      || hasAnyName(out.composition);

    const shouldInjectIdentity = identityBlock && (descs.length > 0 || promptMentionsCharacter);
    if (shouldInjectIdentity) {
      // Append at the end of the text part. Gemini weights text closest to
      // the image references more strongly, and the identity block is the
      // single most important signal to tie the refs to the target image.
      out.prompt = `${out.prompt}\n\n${identityBlock}`;
    }

    // Strengthen the negative prompt with identity-drift terms so the model
    // treats hair/eye/skin/mark changes as explicit failures.
    if (shouldInjectIdentity) {
      const identityNegatives = 'different face, different hair color, changed eye color, missing scar, missing tattoo, wrong skin tone, altered distinguishing feature, character swap';
      out.negativePrompt = out.negativePrompt
        ? `${out.negativePrompt}, ${identityNegatives}`
        : identityNegatives;
    }

    // Replace generic character references with actual names in all text fields.
    // This catches LLM output like "Two young people running" → "Catherine and Heathcliff running"
    if (names.length >= 2) {
      const nameStr = names.join(' and ');
      const genericPatterns = [
        /\btwo (?:young )?(?:people|figures|characters|individuals|persons)\b/gi,
        /\btwo (?:young )?(?:men|women|lovers|companions|friends|strangers)\b/gi,
        /\bthe (?:two|pair|couple)\b/gi,
        /\bboth (?:figures|characters|people)\b/gi,
      ];
      const replaceGenerics = (text: string | undefined): string | undefined => {
        if (!text) return text;
        let result = text;
        for (const pattern of genericPatterns) {
          result = result.replace(pattern, nameStr);
        }
        return result;
      };
      out.prompt = replaceGenerics(out.prompt) || out.prompt;
      out.visualNarrative = replaceGenerics(out.visualNarrative);
      out.emotionalCore = replaceGenerics(out.emotionalCore);
      out.keyBodyLanguage = replaceGenerics(out.keyBodyLanguage);
      out.keyGesture = replaceGenerics(out.keyGesture);
    }
    // Replace single-character generic references ("a woman", "a man", etc.)
    // even in multi-character scenes. When we have character descriptions, try to
    // match gender-specific generics to the right character; otherwise use the
    // first name.
    {
      const fallbackName = names[0] || '';
      const singleGenericPatterns: Array<{ pattern: RegExp; name: string }> = [
        { pattern: /\b(?:a|the) (?:young )?(?:woman|girl|lady|female figure)\b/gi, name: fallbackName },
        { pattern: /\b(?:a|the) (?:young )?(?:man|boy|gentleman|male figure)\b/gi, name: fallbackName },
        { pattern: /\b(?:a|the) (?:lone |solitary )?(?:figure|character|person|individual)\b/gi, name: fallbackName },
      ];
      const replaceGeneric = (text: string | undefined): string | undefined => {
        if (!text) return text;
        let result = text;
        for (const { pattern, name } of singleGenericPatterns) {
          if (name) result = result.replace(pattern, name);
        }
        return result;
      };
      out.prompt = replaceGeneric(out.prompt) || out.prompt;
      out.visualNarrative = replaceGeneric(out.visualNarrative);
      out.emotionalCore = replaceGeneric(out.emotionalCore);
    }

    // Ensure the "story moment" sentence is also name-anchored.
    if (out.visualNarrative && !hasAnyName(out.visualNarrative)) {
      out.visualNarrative = `${names.join(' and ')} — ${out.visualNarrative}`;
    }

    return out;
  }

  private async generateWithNanoBanana(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    imageType?: ImageType
  ): Promise<GeneratedImage> {
    const apiKey = this.config.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is required for nano-banana image generation');
    }

    const model = this._geminiSettings.model;
    const gemSettings = this._geminiSettings;
    let lastError: Error | null = null;
    let textInsteadOfImageCount = 0;
    let lastEffectivePrompt = prompt;
    let lastEffectiveRefCount = referenceImages?.length || 0;
    let lastAttempt = 0;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        lastAttempt = attempt;
        await this.waitForProviderPacing('nano-banana');

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'processing', attempts: attempt, progress: (attempt / (this.maxRetries + 1)) * 50 } });

        const effectivePrompt = this.applyEncounterPromptBudget(prompt, imageType, attempt);
        const reducedRefCap = this.shouldTrackEncounterType(imageType)
          ? (attempt >= 3 ? 3 : 5)
          : (referenceImages?.length || 0);
        const effectiveRefs = referenceImages && reducedRefCap > 0
          ? this.prioritizeReferenceImages(referenceImages, reducedRefCap)
          : referenceImages;
        lastEffectivePrompt = effectivePrompt;
        lastEffectiveRefCount = effectiveRefs?.length || 0;

        // === Build multi-modal parts array ===
        const isExpressionSheet = this.isExpressionLikeImage(imageType, identifier);
        const isReferenceSheet = imageType === 'master';
        const isReferenceLike = isReferenceSheet || isExpressionSheet || identifier.startsWith('ref_');
        const hasRefs = effectiveRefs && effectiveRefs.length > 0;
        const parts: any[] = [];

        if (isReferenceSheet) {
          // ==========================================
          // REFERENCE SHEET MODE — clean studio portrait
          // ==========================================
          // Reference sheets need a completely different prompt strategy:
          // NO dramatic framing, NO scene context, NO previous-scene references.
          // The goal is a clean, neutral character model sheet for visual identity anchoring.
          // BUT we DO inject canonicalArtStyle — style consistency is critical.

          // 1. ART STYLE FIRST — same priority positioning as scene images
          const refArtStyle = this.resolveArtStyle(prompt.style, identifier);
          parts.push({ text: `Art style: ${refArtStyle}. All views must use this exact same style consistently.` });

          // 2. Reference sheet system prompt
          parts.push({ text:
            `Character design reference sheet. Clean, neutral studio portrait. ` +
            `The character stands in a simple neutral pose against a plain solid-color background. ` +
            `No environment, no scene, no action, no narrative. Studio lighting, even and flat. ` +
            `The character fills the frame. This is a model sheet for visual reference only. ` +
            `Every view must be fully detailed and colored — no silhouettes, no shadows, no placeholders.`
          });

          // 3. Cross-character style anchor (if a previous character ref sheet was generated)
          if (this._referenceSheetStyleAnchor) {
            parts.push({ inlineData: { mimeType: this._referenceSheetStyleAnchor.mimeType, data: this._referenceSheetStyleAnchor.data } });
            parts.push({ text: `Style consistency reference from a previously generated character in this story. Approximate guide for rendering density and color palette. The ART STYLE text directive above is authoritative for the actual visual style. Do NOT copy the character identity.` });
          }

          // 4. Pass user-provided reference images with strong identity-matching instruction
          const userRefs = hasRefs ? effectiveRefs!.filter(r => r.role?.includes('user-provided')) : [];
          const otherRefs = hasRefs ? effectiveRefs!.filter(r => !r.role?.includes('user-provided')) : [];

          if (userRefs.length > 0) {
            parts.push({ text:
              `IDENTITY REFERENCE — The following image(s) show the ACTUAL PERSON you must draw. ` +
              `Match their exact face, facial structure, hair color, hair style, skin tone, eye color, ` +
              `body build, and all distinguishing features. This is NOT style guidance — this is the ` +
              `person's identity. The character reference sheet you generate must depict THIS person ` +
              `rendered in the art style specified above.`
            });
            for (const ref of userRefs) {
              parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
              const charLabel = ref.characterName ? `${ref.characterName} — ` : '';
              parts.push({ text:
                `${charLabel}DRAW THIS PERSON. Match their face, hair, build, and skin exactly. ` +
                `Translate their appearance into the specified art style while preserving their identity.`
              });
            }
          }

          // Other references (e.g., previous-view consistency images from individual view pipeline)
          for (const ref of otherRefs) {
            parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            if (ref.role === 'canonical-front-identity') {
              const anchorText = ref.visualAnchors && ref.visualAnchors.length > 0
                ? ` Key traits to preserve: ${ref.visualAnchors.slice(0, 5).join(', ')}.`
                : '';
              parts.push({ text:
                `CANONICAL FRONT VIEW of this exact character — this is the IDENTITY ANCHOR. ` +
                `Match this face, hair color, hair style, eye color, skin tone, body type, clothing, ` +
                `and all distinguishing features EXACTLY. Only the viewing angle should change.${anchorText}`
              });
            } else if (ref.role === 'previous-view-consistency') {
              const viewLabel = ref.viewType ? ` (${ref.viewType} view)` : '';
              parts.push({ text:
                `Previous view${viewLabel} of this SAME character — maintain identical identity, ` +
                `proportions, clothing, hair, skin tone, and coloring. The character must be ` +
                `unmistakably the same person across all views.`
              });
            } else {
              const label = ref.characterName
                ? `Character reference: ${ref.characterName}${ref.viewType ? ` (${ref.viewType} view)` : ''}`
                : `Reference image (${ref.role})`;
              parts.push({ text: label });
            }
          }

          // 5. The character prompt from CharacterReferenceSheetAgent
          if (userRefs.length > 0) {
            parts.push({ text:
              `IMPORTANT: The following character description may include text about hair color, face shape, ` +
              `eye color, or other physical features. IGNORE those text descriptions for physical appearance. ` +
              `Use ONLY the reference photo(s) above for the character's face, hair, skin, and body. ` +
              `From the text below, use ONLY: gender, clothing/outfit, pose direction, and composition instructions.`
            });
          }
          parts.push({ text: effectivePrompt.prompt });

          if (userRefs.length > 0) {
            parts.push({ text:
              `FINAL INSTRUCTION: The character's FACE, HAIR, SKIN TONE, FACIAL STRUCTURE, and BODY BUILD ` +
              `must match the identity reference photo(s) provided earlier — NOT any text description above. ` +
              `The text description defines the outfit, pose, and framing. The photo defines the person. ` +
              `Draw THIS SPECIFIC PERSON in the specified art style and clothing.`
            });
          } else if (otherRefs.some(r => r.role === 'canonical-front-identity' || r.role === 'previous-view-consistency')) {
            parts.push({ text:
              `CRITICAL IDENTITY LOCK: The reference image(s) above show this EXACT character from other angles. ` +
              `You MUST reproduce the same face, same hair color and style, same eye color, same skin tone, ` +
              `same body proportions, same clothing and accessories. Only the viewing angle changes. ` +
              `The character in your output must be unmistakably the same person as in the reference views.`
            });
          }

          // 6. Strengthen negative prompt for reference sheets
          const refNegative = [
            effectivePrompt.negativePrompt || '',
            'scenery, environment, background scene, action pose, dramatic lighting, props, narrative framing, story illustration, dramatic composition, silhouette, shadow figure, black shape, featureless outline',
          ].filter(Boolean).join(', ');
          if (refNegative) {
            parts.push({ text: `Avoid: ${refNegative}` });
          }

        } else if (isExpressionSheet) {
          // ==========================================
          // EXPRESSION REFERENCE MODE — face close-up only
          // ==========================================
          const refArtStyle = this.resolveArtStyle(prompt.style, identifier);
          const allowFaceCovering = this.promptExplicitlyAllowsFaceCovering(effectivePrompt.prompt);
          parts.push({ text: `Art style: ${refArtStyle}. All expression references must use this exact same style consistently.` });
          parts.push({ text:
            `Character expression reference. Head-and-shoulders close-up only. ` +
            `Single character only. Plain solid gray or neutral studio background. ` +
            `Soft even studio lighting. Face fills most of the frame. ` +
            `No environment, no story scene, no action beat, no props, no dramatic staging, no full body.`
          });
          parts.push({ text: allowFaceCovering
            ? 'A face covering is allowed only because it is explicitly specified in the prompt. Keep the expression readable and the eyes, brows, nose bridge, and mouth silhouette clear.'
            : 'The full face must remain unobstructed. No veil, no fabric, no drapery, no hair, no jewelry, and no props crossing the eyes, nose, or mouth.' });

          if (this._referenceSheetStyleAnchor) {
            parts.push({ inlineData: { mimeType: this._referenceSheetStyleAnchor.mimeType, data: this._referenceSheetStyleAnchor.data } });
            parts.push({ text: `Style consistency reference from a previously generated character in this story. Approximate guide for rendering density and color palette. The ART STYLE text directive above is authoritative for the actual visual style.` });
          }

          const userRefs = hasRefs ? effectiveRefs!.filter(r => r.role?.includes('user-provided')) : [];
          const canonicalRefs = hasRefs ? effectiveRefs!.filter(r => !r.role?.includes('user-provided')) : [];

          if (userRefs.length > 0) {
            parts.push({ text:
              `IDENTITY REFERENCE — The following image(s) show the exact person to render. ` +
              `Match face, skin tone, hair, facial structure, and body identity exactly. ` +
              `Render THIS person in the specified art style as an expression-sheet close-up.`
            });
            for (const ref of userRefs) {
              parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
              parts.push({ text: `Draw this specific person. Preserve identity exactly; change only the facial expression and facial tension.` });
            }
          }

          // Collect visual anchors from any canonical ref that carries them
          const allVisualAnchors: string[] = [];
          for (const ref of canonicalRefs) {
            if (ref.visualAnchors) {
              for (const anchor of ref.visualAnchors) {
                if (!allVisualAnchors.includes(anchor)) allVisualAnchors.push(anchor);
              }
            }
          }
          const anchorTraitText = allVisualAnchors.length > 0
            ? ` DISTINGUISHING FEATURES that MUST appear: ${allVisualAnchors.join(', ')}.`
            : '';

          for (const ref of canonicalRefs) {
            parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            if (ref.role === 'canonical-front-identity') {
              parts.push({ text:
                `CANONICAL FRONT VIEW — This is the MASTER identity reference for this character. ` +
                `Match EVERY physical detail from this image: face shape, hair color, hair style, eye color, ` +
                `skin tone, body build, and ALL distinguishing features (scars, marks, tattoos, piercings, ` +
                `facial hair, etc.). Your output is a face close-up of THIS exact character — only the ` +
                `framing and facial expression should differ.${anchorTraitText}`
              });
            } else if (ref.role?.startsWith('character-reference-face-')) {
              parts.push({ text:
                `Supporting face close-up reference — confirms facial detail at higher zoom. ` +
                `Match face shape, hair, eyes, skin tone, and ALL distinguishing facial features. ` +
                `Only change the facial expression.${anchorTraitText}`
              });
            } else if (ref.role?.startsWith('character-reference-')) {
              parts.push({ text:
                `Canonical character reference — match hair, eyes, skin tone, and ALL distinguishing features exactly. ` +
                `Keep output as a face close-up.${anchorTraitText}`
              });
            } else {
              parts.push({ text: `Reference image (${ref.role}) — identity guidance. Match hair color, eye color, skin tone, and all distinguishing features.` });
            }
          }

          parts.push({ text: effectivePrompt.prompt });

          if (canonicalRefs.length > 0 || userRefs.length > 0) {
            let lockText =
              `CRITICAL IDENTITY LOCK: The hair color, hairstyle, eye color, skin tone, and ALL distinguishing ` +
              `features (scars, marks, tattoos, facial hair, etc.) in the generated image MUST exactly match the ` +
              `reference images above. Do NOT omit any facial features visible in the references. ` +
              `Only the facial expression should change.`;
            if (allVisualAnchors.length > 0) {
              lockText += ` Mandatory traits: ${allVisualAnchors.join(', ')}.`;
            }
            parts.push({ text: lockText });
          }

          const expressionNegative = [
            effectivePrompt.negativePrompt || '',
            'full body, medium shot, wide shot, distant subject, tiny face, torso to knees, standing pose',
            'background, environment, scenery, room, office, landscape, props, furniture, story scene, narrative illustration',
            'multiple people, crowd, second character, body interaction, action beat, dramatic staging, mid-action pose',
            'text, watermark, signature, caption, split-screen, collage, multi-panel, storyboard, comic panel',
            ...(allowFaceCovering
              ? ['face fully hidden, eyes obscured, unreadable expression']
              : ['veil, face covering, fabric over face, fabric over nose, fabric over mouth, drapery across face, scarf covering face, obscured nose, obscured mouth, hidden face']),
            'wrong hair color, different hair color, wrong eye color, different eye color',
            'clothing details, high collar, collar fabric, doublet, coat lapel, fabric near face, costume details'
          ].filter(Boolean).join(', ');
          parts.push({ text: `Avoid: ${expressionNegative}` });
        } else if (hasRefs) {
          // ==========================================
          // SCENE ILLUSTRATION MODE (with references)
          // ==========================================
          // ARCHITECTURE: Scene description FIRST, consistency constraints SECOND.
          // Gemini prioritizes early text. If consistency leads, it produces stiff
          // reference-matching portraits. If the scene leads, it produces dynamic
          // illustrations with character identity preserved.

          const artStyle = this.resolveArtStyle(effectivePrompt.style, identifier);
          const charNames = [...new Set(effectiveRefs!.filter(r => r.characterName).map(r => r.characterName!))];

          // 1. ART STYLE + COMPOSITION RULES (shapes the entire generation — FIRST thing Gemini sees)
          parts.push({ text: `Art style (MANDATORY): ${artStyle}. Maintain this exact art style throughout the entire image. OUTPUT MUST BE A SINGLE CONTINUOUS IMAGE — no triptychs, collages, montages, inset panels, picture-in-picture, or any multi-image composition. No text overlays or captions.` });

          // 2. SCENE PROMPT (the actual dramatic scene — the MOST IMPORTANT content)
          // This is what Gemini should focus its creative energy on.
          const narrativePrompt = this.buildNarrativePrompt(effectivePrompt, true);
          parts.push({ text: narrativePrompt });

          // 3. REFERENCE IMAGES (character identity — supporting constraint, not the lead)
          let imageNumber = 1;
          const imageManifest: string[] = [];

          for (const ref of effectiveRefs!) {
            parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            
            let label: string;
            const isComposite = ref.viewType === 'composite' || ref.role?.includes('composite');
            const isPanelContinuity = ref.role === 'previous-panel-continuity';
            if (isPanelContinuity) {
              // IDENTITY-ONLY match. Earlier versions asked Gemini to "match the
              // exact art style, color palette, line weight, and character
              // rendering" from the previous panel — which caused the whole
              // story to lock onto the aesthetic of panel 0 regardless of the
              // user-chosen art style. The text art-style directive is the
              // single source of truth; the previous panel is only a character
              // identity reference.
              label = `Image ${imageNumber}: Previous panel in this sequence — use ONLY for character identity continuity (face, hair, clothing, build). Do NOT copy the rendering style, line weight, or color palette from this image; the art style is dictated by the text directive above.`;
              imageManifest.push(`Image ${imageNumber}: Panel continuity`);
            } else if (ref.characterName) {
              label = `Image ${imageNumber}: ${ref.characterName}`;
              if (isComposite) {
                label += ` — CHARACTER REFERENCE SHEET showing this ONE character from multiple angles (front, side, three-quarter). This is a SINGLE character, not multiple characters. Use ONLY for identity matching (face, hair, skin tone, distinguishing features). Do NOT copy the rendering style, line weight, or color palette from this sheet — the art style is dictated by the text directive above.`;
              } else if (ref.viewType && ref.viewType !== 'front') {
                label += ` (${ref.viewType} view) — use ONLY for identity matching, not for rendering style.`;
              } else {
                label += ` — use ONLY for identity matching (face, hair, skin tone, distinguishing features). Do NOT copy the rendering style from this reference.`;
              }
              if (ref.visualAnchors && ref.visualAnchors.length > 0) {
                label += ` Key traits: ${ref.visualAnchors.slice(0, 5).join(', ')}`;
              }
              imageManifest.push(`Image ${imageNumber}: ${ref.characterName} reference`);
            } else {
              label = `Image ${imageNumber}: Reference (${ref.role})`;
              imageManifest.push(`Image ${imageNumber}: ${ref.role}`);
            }
            parts.push({ text: label });
            imageNumber++;
          }

          // 4. Style reference (for visual consistency across episode)
          if (gemSettings.includeStyleReference && this._geminiStyleReference) {
            parts.push({ inlineData: { mimeType: this._geminiStyleReference.mimeType, data: this._geminiStyleReference.data } });
            parts.push({ text: `Image ${imageNumber}: Style consistency reference — approximate guide for color temperature, rendering density, and composition feel. The ART STYLE text directive above is authoritative; follow its description over any visual differences in this reference.` });
            imageManifest.push(`Image ${imageNumber}: Style reference`);
            imageNumber++;
          }

          // 5. Previous scene image (for scene-to-scene continuity)
          if (gemSettings.includePreviousScene && this._geminiPreviousScene) {
            parts.push({ inlineData: { mimeType: this._geminiPreviousScene.mimeType, data: this._geminiPreviousScene.data } });
            parts.push({ text: `Image ${imageNumber}: Previous scene — STYLE AND SETTING CONTINUITY REFERENCE ONLY. Match color grading, lighting, and environmental feel. Do NOT copy character appearance from this image; character identity comes from the dedicated character reference images.` });
            imageManifest.push(`Image ${imageNumber}: Previous scene continuity`);
            imageNumber++;
          }

          // 6. CONSISTENCY INSTRUCTION (comes AFTER the scene and references — supporting, not leading)
          if (gemSettings.includeConsistencyInstruction) {
            const refImageLabels = imageManifest.filter(m => m.includes('reference')).map(m => m.split(':')[0]);
            const styleLabel = imageManifest.find(m => m.includes('Style'))?.split(':')[0];
            const prevLabel = imageManifest.find(m => m.includes('Previous'))?.split(':')[0];

            // Build per-character identity anchor summary from reference metadata.
            // This gives Gemini textual + visual lock simultaneously.
            const anchorsByChar = new Map<string, string[]>();
            for (const ref of effectiveRefs!) {
              if (ref.characterName && ref.visualAnchors && ref.visualAnchors.length > 0) {
                const existing = anchorsByChar.get(ref.characterName) || [];
                for (const anchor of ref.visualAnchors) {
                  if (!existing.includes(anchor)) existing.push(anchor);
                }
                anchorsByChar.set(ref.characterName, existing);
              }
            }

            const hasCompositeRefs = referenceImages!.some(r => r.role?.includes('composite'));
            const hasIndividualViews = referenceImages!.some(r =>
              r.viewType && ['front', 'three-quarter', 'profile', 'back'].includes(r.viewType) && !r.role?.includes('composite')
            );

            let consistencyText = `Character identity: render the characters in the scene above using the faces, builds, and distinguishing features from ${refImageLabels.join(' and ')}.`;

            if (anchorsByChar.size > 0) {
              const anchorLines = Array.from(anchorsByChar.entries())
                .map(([name, anchors]) => `${name}: ${anchors.slice(0, 3).join(', ')}`)
                .join('. ');
              consistencyText += ` Key identity traits — ${anchorLines}.`;
            } else if (charNames.length > 0) {
              consistencyText += ` Characters: ${charNames.join(', ')}.`;
            }

            consistencyText += ` Preserve their identity but show them in DYNAMIC POSES appropriate to the scene action — do NOT reproduce the neutral reference pose.`;

            if (hasIndividualViews) {
              consistencyText += ` The reference images show individual views of each character (front, side, three-quarter). Use these to lock facial features, body type, clothing, and color palette. Each named character must appear EXACTLY ONCE in the output.`;
            } else if (hasCompositeRefs) {
              consistencyText += ` CRITICAL: The reference images show the SAME character from multiple angles in a single sheet — this is ONE character, NOT multiple characters. Do NOT render the character more than once in the output image. Each named character must appear EXACTLY ONCE.`;
            }
            consistencyText += ` NEVER duplicate a character — each character must appear exactly once in the scene. The reference images are for identity matching only, not for populating the scene.`;

            if (prompt.visualNarrative) {
               consistencyText += ` PRIORITY: The action and emotion described in "THE STORY MOMENT" takes precedence over the reference pose. Use the reference ONLY for face and body type.`;
            }
            
            // Reminder: the authoritative art style is the TEXT directive at
            // the top of this prompt, not any specific reference image. The
            // style reference / previous-scene images are weak visual hints,
            // not style sources.
            if (styleLabel) {
              consistencyText += ` Use ${styleLabel} as a weak hint for color temperature and rendering density only; the text art-style directive above is authoritative when they conflict.`;
            }
            if (prevLabel) {
              consistencyText += ` Maintain environmental / lighting continuity from ${prevLabel} (color grading, time of day), but NOT its rendering style — the text art-style directive governs rendering.`;
            }
            parts.push({ text: consistencyText });

            // Warn if any foreground character has no reference images
            for (const name of charNames) {
              if (!anchorsByChar.has(name)) {
                console.warn(`[ImageGenerationService] Character "${name}" has no visual anchors — identity may drift`);
              }
            }
          }

        } else {
          // No reference images — buildNarrativePrompt leads with quality + style
          const noRefArtStyle = this.resolveArtStyle(effectivePrompt.style, identifier);
          parts.push({ text: `Art style (MANDATORY): ${noRefArtStyle}. OUTPUT MUST BE A SINGLE CONTINUOUS IMAGE — no triptychs, collages, montages, inset panels, picture-in-picture, or any multi-image composition. No text overlays or captions.` });
          const fullPrompt = this.buildNarrativePrompt(effectivePrompt, false);
          parts.push({ text: fullPrompt });
          this.injectStyleReferenceImages(parts, gemSettings);
        }

        const geminiAspectRatio = isReferenceLike
          ? '1:1'
          : this.mapToGeminiAspectRatio(effectivePrompt.aspectRatio || '9:16');

        const mainGenConfig: Record<string, unknown> = {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: this.buildImageConfig(geminiAspectRatio, imageType, isReferenceLike),
        };
        const mainThinking = this.buildThinkingConfig(imageType, isReferenceLike);
        if (mainThinking) mainGenConfig.thinkingConfig = mainThinking;

        if (textInsteadOfImageCount > 0) {
          parts.push({ text: `CRITICAL: Your previous response returned TEXT instead of an IMAGE. You MUST generate an IMAGE this time. Do NOT describe the scene in words — render it as a visual image. Output an image, not text.` });
          console.log(`[ImageGenerationService] Injected image-reinforcement directive (text-instead-of-image count: ${textInsteadOfImageCount})`);
        }

        console.log(`[ImageGenerationService] Gemini request: ${parts.length} parts (${hasRefs ? effectiveRefs!.length + ' refs' : 'no refs'}, model=${model}, mode=${isReferenceSheet ? 'reference-sheet' : isExpressionSheet ? 'expression-sheet' : 'scene'}, aspect=${geminiAspectRatio}, size=${(mainGenConfig.imageConfig as any)?.imageSize || 'default'}${textInsteadOfImageCount > 0 ? `, text-recovery-attempt=${textInsteadOfImageCount}` : ''})`);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            contents: [{ parts }],
            generationConfig: mainGenConfig,
          })
        });

        if (!response.ok) throw new Error(`Gemini API error: ${response.status} - ${await response.text()}`);
        const data = await response.json();
        if (!data.candidates?.[0]?.content?.parts) {
          throw ImageGenerationService.withProviderErrorMeta(
            this.buildGeminiMalformedResponseError(data, model),
            {
              providerAttemptCount: attempt,
              effectivePromptChars: effectivePrompt.prompt?.length || 0,
              effectiveNegativeChars: effectivePrompt.negativePrompt?.length || 0,
              effectiveRefCount: effectiveRefs?.length || 0,
              model,
            },
          );
        }
        
        let imageData: string | undefined;
        let mimeType = 'image/png';
        const textParts: string[] = [];
        for (const part of data.candidates[0].content.parts) {
          if (part.inlineData) {
            imageData = part.inlineData.data;
            mimeType = part.inlineData.mimeType || 'image/png';
            break;
          }
          if (part.text) {
            textParts.push(part.text);
          }
        }
        if (!imageData) {
          textInsteadOfImageCount++;
          const geminiText = textParts.join(' ').slice(0, 500);
          console.warn(`[ImageGenerationService] Gemini returned text instead of image for "${identifier}" (attempt ${attempt}/${this.maxRetries}): "${geminiText}"`);
          throw new Error(`Gemini returned text instead of image: ${geminiText.slice(0, 200)}`);
        }

        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
        const imagePath = this.joinPath(this.outputDir, `${identifier}.${extension}`);
        await this.writeFile(imagePath, imageData, true);

        const imageUrl = this.toImageHttpUrl(imagePath, mimeType, imageData);

        const result = {
          prompt: effectivePrompt,
          imagePath,
          imageUrl,
          imageData,
          mimeType,
          metadata: {
            format: extension,
            attempts: attempt,
            providerAttemptCount: attempt,
            effectivePromptChars: effectivePrompt.prompt?.length || 0,
            effectiveNegativeChars: effectivePrompt.negativePrompt?.length || 0,
            effectiveRefCount: effectiveRefs?.length || 0,
            model,
          },
        };
        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl, endTime: Date.now() } });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        ImageGenerationService.withProviderErrorMeta(lastError, {
          providerAttemptCount: (lastError as any).providerAttemptCount || lastAttempt,
          effectivePromptChars: (lastError as any).effectivePromptChars || lastEffectivePrompt.prompt?.length || 0,
          effectiveNegativeChars: (lastError as any).effectiveNegativeChars || lastEffectivePrompt.negativePrompt?.length || 0,
          effectiveRefCount: (lastError as any).effectiveRefCount || lastEffectiveRefCount,
          model,
        });
        this.emit({ type: 'job_updated', id: jobId, updates: { error: lastError.message, attempts: attempt } });
        
        const errorClass = ImageGenerationService.classifyError(lastError);
        if (errorClass === 'permanent') {
          console.warn(`[ImageGenerationService] Permanent error (no retry): ${lastError.message}`);
          this.pipelineMetrics.permanentFailures++;
          break;
        }
        if (errorClass === 'text_instead_of_image') {
          this.pipelineMetrics.transientRetries++;
          // A6: Cap text-instead-of-image retries — once a prompt consistently
          // returns text, a 5th attempt rarely changes the outcome.
          if (attempt < Math.min(this.maxRetries, this.maxTextInsteadOfImageRetries)) {
            console.log(`[ImageGenerationService] Text-instead-of-image for "${identifier}" — retrying with image-reinforcement directive (attempt ${attempt + 1}/${this.maxTextInsteadOfImageRetries})`);
            await this.delay(this.retryDelayMs);
          } else {
            console.warn(`[ImageGenerationService] Text-instead-of-image cap (${this.maxTextInsteadOfImageRetries}) reached for "${identifier}" — giving up on this prompt`);
            break;
          }
        } else {
          this.pipelineMetrics.transientRetries++;
          if (attempt < this.maxRetries) {
            const rawBackoff = this.retryDelayMs * Math.pow(this.retryBackoffMultiplier, attempt - 1);
            const backoff = Math.min(rawBackoff, this.maxRetryBackoffMs);
            const jitter = Math.floor(Math.random() * 750);
            if (this.shouldTrackEncounterType(imageType) && attempt >= 2) {
              const probe = await this.preflightImageProvider(false);
              if (!probe.ok) {
                throw new Error(`Provider health probe failed during retries: ${probe.reason || 'unknown'}`);
              }
            }
            await this.delay(backoff + jitter);
          }
        }
      }
    }
    this.emit({ type: 'job_updated', id: jobId, updates: { status: 'failed', error: lastError?.message || 'Max retries exceeded', endTime: Date.now() } });
    if (this.isFailFastEnabled()) {
      throw lastError || new Error(`Gemini image generation failed for "${identifier}" after ${this.maxRetries} attempts`);
    }
    const placeholder = await this.generatePlaceholder(prompt, identifier, jobId);
    return placeholder;
  }

  /**
   * Build the narrative prompt for Gemini.
   * When reference images are present (hasRefs=true), focuses on ACTION, EMOTION, and STAGING
   * rather than re-describing physical appearance (the reference images handle identity).
   * When no refs, includes the full descriptive prompt.
   */
  /**
   * Returns true if the current model supports advanced image features
   * (imageSize, extended aspect ratios, 14 input images).
   */
  private isNB2OrPro(): boolean {
    const model = this._geminiSettings.model;
    return model === 'gemini-3.1-flash-image-preview' || model === 'gemini-3-pro-image-preview';
  }

  /**
   * Returns true if the current model supports thinkingConfig in the API.
   * As of April 2026, NO image-preview model actually accepts thinkingLevel
   * despite model metadata claiming "thinking": true.
   */
  private supportsThinking(): boolean {
    return false;
  }

  /**
   * Resolve the imageSize for a given image type based on config.
   * Returns undefined for models that don't support imageSize (gemini-2.5-flash-image).
   */
  private resolveImageSize(imageType?: ImageType): string | undefined {
    if (!this.isNB2OrPro()) return undefined;
    const gem = this._geminiSettings;
    switch (imageType) {
      case 'cover':
      case 'master':
        return gem.coverResolution || '2K';
      default:
        return gem.sceneResolution || '1K';
    }
  }

  /**
   * Resolve imageSize specifically for character reference sheets.
   */
  private resolveReferenceImageSize(): string | undefined {
    if (!this.isNB2OrPro()) return undefined;
    return this._geminiSettings.referenceResolution || '2K';
  }

  /**
   * Build the imageConfig object for Gemini API calls.
   */
  private buildImageConfig(aspectRatio: string, imageType?: ImageType, isReferenceSheet?: boolean): Record<string, unknown> {
    const config: Record<string, unknown> = { aspectRatio };
    const imageSize = isReferenceSheet ? this.resolveReferenceImageSize() : this.resolveImageSize(imageType);
    if (imageSize) config.imageSize = imageSize;
    return config;
  }

  /**
   * Build the thinkingConfig for Gemini API calls (Pro only).
   */
  private buildThinkingConfig(imageType?: ImageType, isReferenceSheet?: boolean): Record<string, unknown> | undefined {
    if (!this.supportsThinking()) return undefined;
    const gem = this._geminiSettings;
    const useHigh = isReferenceSheet || imageType === 'cover' || imageType === 'master';
    const level = useHigh ? (gem.referenceThinkingLevel || 'high') : (gem.thinkingLevel || 'minimal');
    return { thinkingLevel: level, includeThoughts: false };
  }

  /**
   * Map an arbitrary aspect ratio string to a Gemini-supported value.
   * NB2 adds support for 1:4, 4:1, 1:8, 8:1 in addition to the base set.
   */
  private mapToGeminiAspectRatio(ratio: string): string {
    const BASE_SUPPORTED = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    const NB2_EXTRA = ['1:4', '4:1', '1:8', '8:1'];
    const SUPPORTED = this.isNB2OrPro()
      ? [...BASE_SUPPORTED, ...NB2_EXTRA]
      : BASE_SUPPORTED;

    const normalized = ratio.replace(/\s/g, '').toLowerCase();
    if (SUPPORTED.includes(normalized)) return normalized;

    // Parse and find closest supported ratio
    const parts = normalized.split(':').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      const target = parts[0] / parts[1];
      let bestMatch = '9:16';
      let bestDiff = Infinity;
      for (const s of SUPPORTED) {
        const [a, b] = s.split(':').map(Number);
        const diff = Math.abs(a / b - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = s;
        }
      }
      return bestMatch;
    }
    return '9:16';
  }

  /**
   * Build the narrative prompt for Gemini.
   * 
   * Architecture: Art style LEADS (shapes the entire generation), then the scene
   * description as a flowing cinematic narrative, then micro-direction for expression/
   * gesture/body language, then an anti-stiffness directive, then negatives.
   * 
   * Research shows Gemini produces significantly better results with narrative scene
   * descriptions vs. keyword-list prompts. This method constructs a flowing description
   * rather than joining labeled parts with newlines.
   */
  private buildNarrativePrompt(prompt: ImagePrompt, hasRefs: boolean): string {
    if (prompt.isEncounterImage) {
      return this.buildEncounterNarrativePrompt(prompt);
    }

    const strengthenedPrompt = this.ensureVisualPromptStrength(prompt);
    const settingNotes = this.getSettingAdaptationNotes(strengthenedPrompt).slice(0, 2);
    const sections: string[] = [];

    // 1. ART STYLE FIRST — models weight early tokens most heavily; lock in the aesthetic before anything else
    const styleToUse = this.resolveArtStyle(strengthenedPrompt.style);
    if (styleToUse) {
      sections.push(`ART STYLE (MANDATORY): ${styleToUse}.`);
    }

    if (settingNotes.length > 0) {
      sections.push(`SETTING ADAPTATION (SAME STYLE, NOT A STYLE SWITCH): ${settingNotes.join(' ')}`);
    }

    // 2. VISUAL STORYTELLING PRINCIPLES — positive creative guidance (not just defensive rules)
    sections.push(STORY_BEAT_VISUAL_PRINCIPLES_COMPACT.trim());

    // 3. ACTING DIRECTION — front-load micro-directions for maximum impact
    const microParts: string[] = [];
    if (strengthenedPrompt.keyExpression) microParts.push(strengthenedPrompt.keyExpression);
    if (strengthenedPrompt.keyGesture) microParts.push(strengthenedPrompt.keyGesture);
    if (strengthenedPrompt.keyBodyLanguage) microParts.push(strengthenedPrompt.keyBodyLanguage);
    if (microParts.length > 0) {
      sections.push(`CHARACTER ACTING (CRITICAL): ${microParts.join('. ')}.`);
    }

    // 4. DRAMATIC STAGING — beat-aware cinematic direction
    const beatStaging = strengthenedPrompt.beatType
      ? getBeatStagingDirection(strengthenedPrompt.beatType)
      : null;
    if (beatStaging) {
      sections.push(`DRAMATIC STAGING: ${beatStaging}`);
    } else {
      sections.push(
        'DRAMATIC STAGING: This is a moment of real human drama, not a posed portrait. ' +
        'At least one character must be mid-action — shifting weight, turning, reaching, recoiling, or gesturing. ' +
        'Hands must be doing something specific: gripping an object, pressing against a surface, pulling back, fidgeting, or clenching. ' +
        'If two characters are present, their body language must be ASYMMETRIC — one advancing while the other retreats, one open while the other is guarded. ' +
        'Capture the MOMENT OF CHANGE — mid-recoil, mid-reach, mid-turn — not the static before or after.'
      );
    }

    // 5. STORY MOMENT — what is happening
    if (strengthenedPrompt.visualNarrative) {
      sections.push(`THE STORY MOMENT: ${strengthenedPrompt.visualNarrative}`);
    } else if (strengthenedPrompt.emotionalCore) {
      sections.push(`The moment: ${strengthenedPrompt.emotionalCore}`);
    }

    // 6. CORE SCENE DESCRIPTION
    sections.push(strengthenedPrompt.prompt);

    // 7. SHOT DESCRIPTION — camera angle and framing
    if (strengthenedPrompt.shotDescription) {
      sections.push(`${strengthenedPrompt.shotDescription}.`);
    }

    // 8. COMPOSITION — woven in as direction, not a labeled field
    if (strengthenedPrompt.composition) {
      sections.push(strengthenedPrompt.composition);
    }

    // 9. SPATIAL PROPORTIONALITY — characters at similar depth must be similar size
    sections.push(
      'CHARACTER SCALE RULE: Characters who are physically near each other must be drawn at proportional sizes based on their distance from the camera. ' +
      'Do NOT make one character symbolically larger or smaller to represent power or emotion — use body language, posture, and camera angle instead.'
    );

    // 10. STYLE REINFORCEMENT BOOKEND — re-anchor the art style after all scene content
    if (styleToUse) {
      sections.push(`STYLE REMINDER: Maintain the art style "${styleToUse}" consistently throughout the entire image.`);
    }

    // 11. SINGLE-SCENE + NO-TEXT DIRECTIVE
    sections.push(
      'CRITICAL FRAMING: Generate exactly ONE single continuous full-bleed image with ONE unified scene from ONE camera angle. ' +
      'Do NOT split, divide, or composite the image in ANY way. Specifically forbidden: ' +
      'triptych layouts, diptych layouts, collage, montage, picture-in-picture, inset panels, overlaid cutouts, ' +
      'vignettes arranged on a background, character portraits floating over a scene, split-screen, ' +
      'comic panels, manga panels, storyboard cells, grid layouts, side-by-side frames, or ANY multi-image composition. ' +
      'The output must be a SINGLE continuous image with no internal borders, frames, or image boundaries.'
    );

    sections.push(
      'TEXT RULE: The image must contain NO rendered text, NO words, NO letters, NO numbers, NO speech bubbles, NO captions, NO titles, NO watermarks, ' +
      'NO dialog, NO narrative text, NO sound effects, NO onomatopoeia, NO chapter titles, NO scene descriptions, NO character name labels. ' +
      'The ONLY exception is text that physically exists as part of the scene world: signage on buildings, text on clothing/uniforms, book covers, or banners. ' +
      'Never add text to explain, narrate, or caption. This is a purely visual image.'
    );

    // 12. CONSOLIDATED NEGATIVES — comprehensive anti-stiffness + narrative failure modes + anti-text + style-aware negatives
    const antiStiffnessNegatives = 'stiff pose, symmetrical stance, mannequin, T-pose, arms at sides, standing straight, ' +
      'passport photo, character sheet, model sheet, flat lighting, two people standing holding hands, ' +
      'characters standing side by side, symmetrical couple pose, stiff handholding, characters frozen in place, ' +
      'mirrored poses, balanced composition, centered framing, relaxed posture, even weight distribution, ' +
      'parallel arms, same-height positioning, static tableau, portrait composition, ' +
      'both characters facing camera, characters not interacting, wooden pose, lifeless stance, ' +
      'arms hanging loosely, straight spine with no lean, weight on both feet equally';
    const narrativeNegatives = 'character looking directly at camera, posed group photo, characters standing separately not interacting, ' +
      'blank or ambiguous facial expression, neutral expression, decorative background unrelated to story action, ' +
      'multiple competing focal points, unrealistic character size differences when at same depth, ' +
      'generic reaction shot, stock photo composition, corporate portrait style';
    const antiTextNegatives = 'text overlay, caption text, title text, subtitle text, label text, speech bubbles, thought bubbles, credits, watermarks, signatures, annotations, text banner, ' +
      'dialog text, narrative text, sound effect text, onomatopoeia, story text, chapter title, scene description text, character name labels';
    const antiCompositeNegatives = 'triptych, diptych, collage, montage, picture-in-picture, inset panel, overlaid cutout, vignette arrangement, floating portrait, split-screen, ' +
      'comic panels, manga panels, split panels, multi-panel, storyboard, comic strip, panel borders, divided frame, side-by-side frames, grid layout, multiple frames, panel gutters, sequential panels, ' +
      'image within image, photo collage, composite image, layered cutouts, arranged photos, character bust overlay';
    const antiDuplicationNegatives = 'duplicate character, same character twice, cloned character, twin characters, character appearing multiple times, character repeated';
    const combinedNegatives = [
      strengthenedPrompt.negativePrompt || '',
      antiStiffnessNegatives,
      narrativeNegatives,
      antiTextNegatives,
      antiCompositeNegatives,
      antiDuplicationNegatives,
    ].filter(Boolean).join(', ');
    sections.push(`Avoid: ${combinedNegatives}`);

    return sections.join('\n\n');
  }

  /**
   * Encounter-specific prompt builder. Encounter images already carry camera
   * angles, visual contracts, character states, mood, and cost descriptions
   * from cinematicDescriptionToPrompt. The full buildNarrativePrompt adds
   * ~2000 chars of redundant staging (DRAMATIC STAGING paragraph, CHARACTER
   * SCALE RULE, STYLE REMINDER, verbose CRITICAL FRAMING) on top of the
   * encounter's own staging. This method cuts only the redundant sections
   * while preserving every quality-carrying instruction: acting micro-
   * directions, action-verb enforcement, anti-stiffness negatives, and
   * narrative failure-mode negatives.
   */
  private buildEncounterNarrativePrompt(prompt: ImagePrompt): string {
    const strengthenedPrompt = this.ensureVisualPromptStrength(prompt);
    const sections: string[] = [];

    const styleToUse = this.resolveArtStyle(strengthenedPrompt.style);
    if (styleToUse) {
      sections.push(`ART STYLE (MANDATORY): ${styleToUse}.`);
    }

    const settingNotes = this.getSettingAdaptationNotes(strengthenedPrompt);
    if (settingNotes.length > 0) {
      sections.push(`SETTING: ${settingNotes.join(' ')}`);
    }

    sections.push(ENCOUNTER_VISUAL_PRINCIPLES_COMPACT.trim());

    const microParts: string[] = [];
    if (strengthenedPrompt.keyExpression) microParts.push(strengthenedPrompt.keyExpression);
    if (strengthenedPrompt.keyGesture) microParts.push(strengthenedPrompt.keyGesture);
    if (strengthenedPrompt.keyBodyLanguage) microParts.push(strengthenedPrompt.keyBodyLanguage);
    if (microParts.length > 0) {
      sections.push(`CHARACTER ACTING (CRITICAL): ${microParts.join('. ')}.`);
    }

    if (strengthenedPrompt.visualNarrative) {
      sections.push(`THE STORY MOMENT: ${strengthenedPrompt.visualNarrative}`);
    } else if (strengthenedPrompt.emotionalCore) {
      sections.push(`The moment: ${strengthenedPrompt.emotionalCore}`);
    }

    sections.push(strengthenedPrompt.prompt);

    if (strengthenedPrompt.shotDescription) {
      sections.push(strengthenedPrompt.shotDescription);
    }
    if (strengthenedPrompt.composition) {
      sections.push(strengthenedPrompt.composition);
    }

    sections.push('Generate ONE single continuous image. No overlay text, no captions, no speech bubbles, no panels, no collage, no multi-image composition. In-world signage and text on objects is fine.');

    const negatives = [
      strengthenedPrompt.negativePrompt || '',
      'stiff pose, symmetrical stance, mannequin, T-pose, arms at sides, static tableau, portrait composition, wooden pose',
      'blank expression, neutral expression, generic reaction shot, decorative background unrelated to story',
      'triptych, collage, montage, split-screen, comic panels, text overlay, watermarks, signatures',
    ].filter(Boolean).join(', ');
    sections.push(`Avoid: ${negatives}`);

    return sections.join('\n\n');
  }

  private ensureVisualPromptStrength(prompt: ImagePrompt): ImagePrompt {
    const result: ImagePrompt = { ...prompt };
    // C4: Profile-aware guardrails. When a structured `ArtStyleProfile` is
    // installed, it tells us which default rules to skip (`acceptableDeviations`),
    // which vocabulary to inject (`positiveVocabulary`), which vocabulary to
    // strip (`inappropriateVocabulary`), and which extra negatives to merge
    // (`genreNegatives`). No profile = today's cinematic defaults.
    const profile = this._artStyleProfile;
    const allowsDeviation = (rule: import('../images/artStyleProfile').DefaultRuleId): boolean =>
      !!profile && profile.acceptableDeviations.includes(rule);

    const text = `${result.visualNarrative || ''} ${result.emotionalCore || ''} ${result.prompt || ''}`.toLowerCase();
    const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|runs?|walks?|leans?|twists?|lifts?|drops?|wrings?|presses?|squeezes?|clutches?|shields?)\b/.test(text);

    if (!hasActionVerb && !allowsDeviation('mid-action-posing') && !allowsDeviation('frozen-moment-of-change')) {
      const fallbackAction = 'Characters are in the middle of a visible action with clear cause and effect, not standing still.';
      result.visualNarrative = result.visualNarrative
        ? `${result.visualNarrative} ${fallbackAction}`
        : fallbackAction;
      console.warn('[ImageGenerationService] Prompt guardrail: no action verb detected; injected action directive');
    }

    const abstractVisual = result.visualNarrative &&
      /\b(tension rises|emotion deepens|atmosphere shifts|the mood changes)\b/i.test(result.visualNarrative);
    if (abstractVisual) {
      result.visualNarrative = `${result.visualNarrative}. Show the exact physical action and reaction in faces, hands, and posture.`;
      console.warn('[ImageGenerationService] Prompt guardrail: abstract visualNarrative; injected concreteness directive');
    }

    // Derive missing keyExpression from emotionalCore
    if (!result.keyExpression && result.emotionalCore) {
      result.keyExpression = `Expression showing: ${result.emotionalCore}. Show it through specific facial anatomy — brow tension, eye direction, mouth set, jaw position.`;
    }

    // Strengthen vague or missing keyBodyLanguage.
    // C4: Styles that allow symmetric/centered composition (storybook, minimalist,
    // pixel, etc.) opt out of the asymmetric-body-language injection.
    if (!allowsDeviation('asymmetric-body-language')) {
      if (!result.keyBodyLanguage && result.emotionalCore) {
        result.keyBodyLanguage = `Weight shifted to one foot, body angled with intent. Posture reflects: ${result.emotionalCore}.`;
      } else if (result.keyBodyLanguage && /^(tense posture|standing close|facing each other|side by side)$/i.test(result.keyBodyLanguage.trim())) {
        result.keyBodyLanguage = `${result.keyBodyLanguage} — with visible weight shift, one shoulder leading, asymmetric stance showing intent.`;
        console.warn('[ImageGenerationService] Prompt guardrail: vague keyBodyLanguage; injected specificity');
      }
    }

    // Detect stiff-pose patterns and inject overrides.
    // C4: Skip for styles that accept static/posed compositions
    // (storybook, minimalist, pixel, etc.) via `mid-action-posing` deviation.
    if (!allowsDeviation('mid-action-posing')) {
      const stiffPatterns = /\b(holding hands?|standing together|standing side by side|facing each other|standing still|posed together)\b/i;
      const allText = `${result.prompt || ''} ${result.keyGesture || ''} ${result.keyBodyLanguage || ''}`;
      if (stiffPatterns.test(allText)) {
        if (!result.keyGesture || stiffPatterns.test(result.keyGesture)) {
          result.keyGesture = (result.keyGesture || '') +
            ' — hands must be ACTIVE: gripping something, gesturing, pressing against a surface, reaching, or pulling back. Not passively clasped.';
        }
        console.warn('[ImageGenerationService] Prompt guardrail: stiff-pose pattern detected; injected active gesture directive');
      }
    }

    // Strengthen empty or metadata-only composition with actual visual direction
    if (!result.composition || /^Scene:.*Genre:.*Tone:/i.test(result.composition.trim())) {
      const beatType = result.beatType || '';
      const fallbackComposition = this.synthesizeCompositionFromBeat(beatType, result);
      if (fallbackComposition) {
        result.composition = result.composition
          ? `${result.composition}. ${fallbackComposition}`
          : fallbackComposition;
        console.warn('[ImageGenerationService] Prompt guardrail: weak composition; synthesized from beat type');
      }
    }

    // Strip non-diegetic supernatural language in non-fantasy/supernatural genres.
    // Genre is typically embedded in the composition field as "Genre: Drama" etc.
    const compositionLower = (result.composition || '').toLowerCase();
    const isSupernaturalGenre = /genre:\s*(fantasy|supernatural|sci-?fi|science fiction|horror|paranormal|urban fantasy|dark fantasy)/i.test(compositionLower);
    if (!isSupernaturalGenre) {
      const nonDiegeticPatterns = /\b(supernatural sparks?|magical glow|glowing aura|ethereal light|mystical energy|souls? collid(?:e|ing)|magnetic pull|crackling energy|aura of power|levitat(?:e|ing)|floating in air)\b/gi;
      const stripNonDiegetic = (field: string | undefined): string | undefined => {
        if (!field) return field;
        const cleaned = field.replace(nonDiegeticPatterns, '').replace(/\s{2,}/g, ' ').trim();
        if (cleaned !== field.trim()) {
          console.warn('[ImageGenerationService] Prompt guardrail: stripped non-diegetic supernatural language');
        }
        return cleaned || field;
      };
      result.prompt = stripNonDiegetic(result.prompt) || result.prompt;
      result.visualNarrative = stripNonDiegetic(result.visualNarrative);
      result.emotionalCore = stripNonDiegetic(result.emotionalCore);
      result.keyGesture = stripNonDiegetic(result.keyGesture);
    }

    // C4: Bidirectional style-aware vocabulary pass. Strips phrases that
    // contradict the active style (e.g. "photoreal" in a pixel-art profile)
    // and ensures at least one style-positive cue is present in the main
    // prompt so the model commits to the look.
    if (profile) {
      if (profile.inappropriateVocabulary.length > 0) {
        const patterns = profile.inappropriateVocabulary
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .map((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
        if (patterns.length > 0) {
          const stripInappropriate = (field: string | undefined): string | undefined => {
            if (!field) return field;
            let cleaned = field;
            for (const p of patterns) {
              cleaned = cleaned.replace(p, '');
            }
            cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/ ,/g, ',').trim();
            if (cleaned !== field.trim()) {
              console.warn(
                `[ImageGenerationService] Prompt guardrail: stripped style-inappropriate vocabulary for profile "${profile.name}"`,
              );
            }
            return cleaned || field;
          };
          result.prompt = stripInappropriate(result.prompt) || result.prompt;
          result.visualNarrative = stripInappropriate(result.visualNarrative);
          result.composition = stripInappropriate(result.composition);
          result.keyGesture = stripInappropriate(result.keyGesture);
          result.keyExpression = stripInappropriate(result.keyExpression);
        }
      }

      if (profile.positiveVocabulary.length > 0) {
        const existing = (result.prompt || '').toLowerCase();
        const missing = profile.positiveVocabulary.filter(
          (v) => v && !existing.includes(v.toLowerCase()),
        );
        if (missing.length > 0) {
          const injection = `Style cues: ${missing.join(', ')}.`;
          result.prompt = result.prompt ? `${result.prompt}\n${injection}` : injection;
        }
      }

      if (profile.genreNegatives.length > 0) {
        const merged = [result.negativePrompt, ...profile.genreNegatives]
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .join(', ');
        if (merged) result.negativePrompt = merged;
      }
    }

    return result;
  }

  private synthesizeCompositionFromBeat(beatType: string, prompt: ImagePrompt): string {
    const hasTwoChars = /\band\b|\btwo\b|\bboth\b/i.test(prompt.prompt || '');
    switch (beatType) {
      case 'confrontation':
        return hasTwoChars
          ? 'Cinematic composition: two figures squared off, focal point on the tense space between them at rule-of-thirds intersection, leading lines from environment converging on pair'
          : 'Cinematic composition: strong focal point on the confrontation, off-center at thirds intersection, clear foreground-background depth';
      case 'revelation':
      case 'realization':
        return 'Tight composition: focal point on the reactor\'s face at rule-of-thirds, negative space around them for isolation, depth of field softening the background';
      case 'intimacy':
        return 'Close composition: two figures filling the frame together, focal point on point of connection, soft depth of field, warm intimate framing';
      case 'action':
        return 'Dynamic composition: strong diagonal through the action, leading space in direction of movement, focal point on peak-action moment at thirds intersection';
      case 'decision':
        return 'Weighted composition: character centered between options, focal point on face and hands, environment reflecting the weight of choice';
      case 'triumph':
        return 'Elevated composition: low angle, figure rising into upper frame, focal point on triumphant expression, expansive space opening around them';
      case 'defeat':
        return 'Diminished composition: figure small in frame, surrounded by negative space, focal point on collapsed posture, muted depth';
      case 'threat':
        return 'Unbalanced composition: threat dominating the frame, target diminished, focal point on the victim\'s reaction, deep shadows';
      case 'departure':
        return 'Receding composition: growing negative space between figures, focal point on the one remaining, depth stretching toward the departing figure';
      default:
        return 'Cinematic composition: focal point at rule-of-thirds intersection, clear foreground-midground-background depth, environment participating in the story';
    }
  }

  // === Atlas Cloud model capability detection ===

  private get modelCapabilities() {
    const model = this.config.atlasCloudModel || '';
    const isNanoBanana2 = model.startsWith('google/nano-banana-2');
    const isNanoBananaPro = model.startsWith('google/nano-banana-pro');
    const isNanoBananaStd = model.startsWith('google/nano-banana/');
    const isNanoBanana = isNanoBanana2 || isNanoBananaPro || isNanoBananaStd;
    const isSeedream = model.startsWith('bytedance/seedream-');
    const isSeedream5 = model.startsWith('bytedance/seedream-v5');

    return {
      supportsEditRefs: isSeedream || isNanoBanana,
      maxRefImages: isNanoBanana2 ? 14 : isNanoBananaPro ? 10 : isSeedream ? 10 : isNanoBananaStd ? 10 : 0,
      supportsBatch: isSeedream,
      supportsBatchEdit: isSeedream,
      maxBatchSize: isSeedream5 ? 15 : isSeedream ? 14 : 1,
      supportsCharConsistency: isNanoBanana,
      maxConsistentChars: isNanoBanana2 ? 5 : isNanoBananaPro ? 5 : 0,
      supportsRichPrompt: isNanoBanana,
      isNanoBanana,
      isSeedream,
    };
  }

  private getAtlasCloudProxyUrl(): string {
    if (isWebRuntime() && typeof window !== 'undefined') {
      return `http://${window.location.hostname || 'localhost'}:3001/atlas-cloud-api`;
    }
    return 'http://localhost:3001/atlas-cloud-api';
  }

  private isSeedreamModel(model?: string): boolean {
    const m = model || this.config.atlasCloudModel || '';
    return m.startsWith('bytedance/seedream-');
  }

  private isSeedream5Model(model?: string): boolean {
    const m = model || this.config.atlasCloudModel || '';
    return m.startsWith('bytedance/seedream-v5');
  }

  private mapAspectRatioToSize(aspectRatio: string, model?: string): string {
    if (this.isSeedream5Model(model)) {
      const seedream5PresetMap: Record<string, string> = {
        '1:1': 'square_hd',
        '16:9': 'landscape_16_9',
        '9:16': 'portrait_16_9',
        '4:3': 'landscape_4_3',
        '3:4': 'portrait_4_3',
        '3:2': 'landscape_4_3',
        '2:3': 'portrait_4_3',
        '21:9': 'landscape_16_9',
        '9:21': 'portrait_16_9',
      };
      return seedream5PresetMap[aspectRatio] || 'auto_2K';
    }

    if (this.isSeedreamModel(model)) {
      const seedreamSizeMap: Record<string, string> = {
        '9:19.5': '1440*3120',
        '9:16': '1440*2560',
        '16:9': '2560*1440',
        '1:1': '2048*2048',
        '4:3': '2304*1728',
        '3:4': '1728*2304',
        '3:2': '2352*1568',
        '2:3': '1568*2352',
        '21:9': '3008*1280',
        '9:21': '1440*3360',
      };
      return this.ensureSeedreamMinSize(seedreamSizeMap[aspectRatio] || '2048*2048');
    }

    const standardSizeMap: Record<string, string> = {
      '9:19.5': '936*2028',
      '9:16': '1152*2048',
      '16:9': '2048*1152',
      '1:1': '1024*1024',
      '4:3': '1365*1024',
      '3:4': '1024*1365',
      '3:2': '1536*1024',
      '2:3': '1024*1536',
      '21:9': '2048*878',
      '9:21': '878*2048',
    };
    return standardSizeMap[aspectRatio] || '1024*1024';
  }

  private ensureSeedreamMinSize(size: string): string {
    const match = /^(\d+)\*(\d+)$/.exec(size.trim());
    if (!match) return '2048*2048';

    let width = Number(match[1]);
    let height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return '2048*2048';
    }

    const MIN_PIXELS = 3_686_400;
    const MIN_SIDE = 1440;

    const scaleForMinSide = Math.max(MIN_SIDE / width, MIN_SIDE / height, 1);
    if (scaleForMinSide > 1) {
      width = Math.ceil(width * scaleForMinSide);
      height = Math.ceil(height * scaleForMinSide);
    }

    const pixels = width * height;
    if (pixels < MIN_PIXELS) {
      const scaleForPixels = Math.sqrt(MIN_PIXELS / pixels);
      width = Math.ceil(width * scaleForPixels);
      height = Math.ceil(height * scaleForPixels);
    }

    return `${width}*${height}`;
  }

  private classifyAtlasError(error: unknown): 'transient' | 'permanent' {
    const msg = String((error as any)?.message || error || '').toLowerCase();
    if (
      msg.includes('atlas cloud api error: 400') ||
      msg.includes('atlas cloud api error: 401') ||
      msg.includes('atlas cloud api error: 402') ||
      msg.includes('atlas cloud api error: 403') ||
      msg.includes('atlas cloud api error: 404') ||
      msg.includes('atlas cloud poll error: 401') ||
      msg.includes('atlas cloud poll error: 403') ||
      msg.includes('insufficient balance') ||
      msg.includes('content policy') ||
      msg.includes('safety filter')
    ) {
      return 'permanent';
    }
    if (
      msg.includes('prediction timed out') ||
      msg.includes('atlas cloud api error: 504') ||
      msg.includes('atlas cloud api error: 502') ||
      msg.includes('atlas cloud api error: 503') ||
      msg.includes('atlas cloud poll error: 5') ||
      msg.includes('atlas cloud generation failed')
    ) {
      return 'transient';
    }
    return ImageGenerationService.classifyError(error) === 'permanent' ? 'permanent' : 'transient';
  }

  private extractAtlasOutputs(payload: any): string[] {
    if (Array.isArray(payload?.outputs)) {
      return payload.outputs.filter((o: unknown) => typeof o === 'string');
    }
    if (Array.isArray(payload?.data?.outputs)) {
      return payload.data.outputs.filter((o: unknown) => typeof o === 'string');
    }
    return [];
  }

  /**
   * Poll an Atlas Cloud prediction until it completes, fails, or times out.
   * Used for async image generation where the submit call returns a prediction ID.
   */
  private async pollAtlasPrediction(
    predictionId: string,
    apiKey: string,
    baseUrl: string,
    jobId: string,
    maxWaitMs: number = 300000
  ): Promise<any> {
    const startTime = Date.now();
    let pollInterval = 3000;
    const maxPollInterval = 10000;

    while (Date.now() - startTime < maxWaitMs) {
      await this.delay(pollInterval);

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      this.emit({
        type: 'job_updated',
        id: jobId,
        updates: { progress: Math.min(75, 20 + Math.floor(elapsedSec / 2)), message: `Generating image (${elapsedSec}s)...` },
      });

      console.log(`[ImageGenerationService] Polling Atlas Cloud prediction ${predictionId} (${elapsedSec}s elapsed)`);

      const response = await fetch(`${baseUrl}/prediction/${predictionId}`, {
        method: 'GET',
        headers: { 'x-atlas-cloud-key': apiKey },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status >= 500) {
          console.warn(`[ImageGenerationService] Poll got ${response.status}, will retry: ${errorText.slice(0, 200)}`);
          pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
          continue;
        }
        throw new Error(`Atlas Cloud poll error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const status = result?.data?.status || result?.status;

      if (status === 'completed' || status === 'succeeded') {
        console.log(`[ImageGenerationService] Atlas Cloud prediction ${predictionId} completed after ${elapsedSec}s`);
        return result;
      }

      if (status === 'failed') {
        const errorMsg = result?.data?.error || result?.error || 'Generation failed';
        throw new Error(`Atlas Cloud generation failed: ${errorMsg}`);
      }

      pollInterval = Math.min(pollInterval * 1.3, maxPollInterval);
    }

    throw new Error(`Atlas Cloud prediction timed out after ${Math.round(maxWaitMs / 1000)}s`);
  }

  /**
   * Resolve an Atlas Cloud output — download if URL, or detect MIME from base64.
   */
  private async resolveAtlasOutput(output: string): Promise<{ base64Data: string; mimeType: string; extension: string }> {
    if (output.startsWith('http://') || output.startsWith('https://')) {
      console.log(`[ImageGenerationService] Downloading Atlas Cloud image from URL...`);
      const response = await fetch(output);
      if (!response.ok) {
        throw new Error(`Failed to download Atlas Cloud image: ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
        : contentType.includes('webp') ? 'webp'
        : 'png';
      return { base64Data, mimeType: contentType, extension };
    }
    return detectImageMimeType(output);
  }

  /**
   * Resolve the Atlas Cloud model string, auto-routing to the appropriate
   * Seedream variant when references or batch are requested.
   * Nano Banana family routes to /edit when refs present, /text-to-image otherwise.
   * Other models are returned as-is.
   */
  private resolveAtlasCloudModel(opts?: { hasRefs?: boolean; isBatch?: boolean }): string {
    const baseModel = this.config.atlasCloudModel || 'bytedance/seedream-v4.5';

    if (baseModel.startsWith('google/nano-banana')) {
      const stem = baseModel.replace(/\/(text-to-image|edit)$/, '');
      return opts?.hasRefs ? `${stem}/edit` : `${stem}/text-to-image`;
    }

    if (baseModel.startsWith('bytedance/seedream-')) {
      const stem = baseModel.replace(/\/(sequential|edit-sequential|edit)$/, '');
      if (opts?.hasRefs && opts?.isBatch) return `${stem}/edit-sequential`;
      if (opts?.hasRefs) return `${stem}/edit`;
      if (opts?.isBatch) return `${stem}/sequential`;
      return stem;
    }

    return baseModel;
  }

  private async generateWithAtlasCloud(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    imageType?: ImageType
  ): Promise<GeneratedImage> {
    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.atlasCloudApiKey || env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY || env.ATLAS_CLOUD_API_KEY;

    if (!apiKey) {
      throw new Error('Atlas Cloud API key is required for atlas-cloud image generation');
    }

    const baseUrl = this.getAtlasCloudProxyUrl();
    const atlasReferenceImages = this.collectAtlasReferenceImages(referenceImages);
    const caps = this.modelCapabilities;
    const hasRefs = caps.supportsEditRefs && atlasReferenceImages.length > 0;
    const model = this.resolveAtlasCloudModel({ hasRefs: !!hasRefs });

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.waitForProviderPacing('atlas-cloud');

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'processing', attempts: attempt, progress: 10 } });

        const fullPrompt = caps.supportsRichPrompt
          ? this.buildAtlasNanoBananaPrompt(prompt, identifier, atlasReferenceImages)
          : this.buildAtlasCloudPrompt(prompt, identifier);

        const body: Record<string, any> = {
          model,
          prompt: fullPrompt,
        };

        if (caps.isNanoBanana && hasRefs) {
          body.images = await this.prepareAtlasImageRefs(atlasReferenceImages, apiKey);
        } else if (caps.isNanoBanana) {
          body.aspect_ratio = prompt.aspectRatio || '1:1';
          body.resolution = '1k';
          body.output_format = 'png';
        } else {
          body.size = this.mapAspectRatioToSize(prompt.aspectRatio || '1:1', model);
          body.output_format = 'png';
          if (hasRefs) {
            body.images = await this.prepareAtlasImageRefs(atlasReferenceImages, apiKey);
          }
        }

        console.log(`[ImageGenerationService] Atlas Cloud: Submitting async generation with model ${model} (attempt ${attempt}, refs: ${atlasReferenceImages.length})`);

        const response = await fetch(`${baseUrl}/generateImage`, {
          method: 'POST',
          headers: {
            'x-atlas-cloud-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Atlas Cloud API error: ${response.status} - ${errorText}`);
        }

        const submitData = await response.json();

        const inlineOutput = this.extractAtlasOutputs(submitData)[0];
        if (inlineOutput) {
          this.emit({ type: 'job_updated', id: jobId, updates: { progress: 80, message: 'Processing image...' } });
          const detected = await this.resolveAtlasOutput(inlineOutput);
          const imagePath = this.joinPath(this.outputDir, `${identifier}.${detected.extension}`);
          await this.writeFile(imagePath, detected.base64Data, true);
          const resultImageUrl = this.toImageHttpUrl(imagePath, detected.mimeType, detected.base64Data);
          const result = { prompt, imagePath, imageUrl: resultImageUrl, imageData: detected.base64Data, mimeType: detected.mimeType, metadata: { format: detected.extension, provider: 'atlas-cloud', model } };
          this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl: resultImageUrl, endTime: Date.now() } });
          return result;
        }

        const predictionId = submitData?.data?.id || submitData?.id;
        if (!predictionId) {
          const apiMsg = submitData?.message || submitData?.error || submitData?.data?.error;
          throw new Error(apiMsg ? `Atlas Cloud: no prediction ID or outputs: ${apiMsg}` : 'Atlas Cloud: no prediction ID or outputs in response');
        }

        console.log(`[ImageGenerationService] Atlas Cloud prediction submitted: ${predictionId}`);
        this.emit({ type: 'job_updated', id: jobId, updates: { progress: 15, message: 'Image queued, polling for result...' } });

        const pollResult = await this.pollAtlasPrediction(predictionId, apiKey, baseUrl, jobId);
        const output = this.extractAtlasOutputs(pollResult)[0];

        if (!output) {
          const apiMsg = pollResult?.message || pollResult?.error || pollResult?.data?.error;
          throw new Error(apiMsg ? `No image output after polling Atlas Cloud: ${apiMsg}` : 'No image output after polling Atlas Cloud');
        }

        this.emit({ type: 'job_updated', id: jobId, updates: { progress: 85, message: 'Downloading generated image...' } });
        const detected = await this.resolveAtlasOutput(output);
        const imagePath = this.joinPath(this.outputDir, `${identifier}.${detected.extension}`);
        await this.writeFile(imagePath, detected.base64Data, true);

        const resultImageUrl = this.toImageHttpUrl(imagePath, detected.mimeType, detected.base64Data);

        const result = { prompt, imagePath, imageUrl: resultImageUrl, imageData: detected.base64Data, mimeType: detected.mimeType, metadata: { format: detected.extension, provider: 'atlas-cloud', model } };
        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl: resultImageUrl, endTime: Date.now() } });
        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[ImageGenerationService] Atlas Cloud attempt ${attempt} failed:`, lastError.message);
        this.emit({ type: 'job_updated', id: jobId, updates: { error: lastError.message, attempts: attempt } });
        const errorClass = this.classifyAtlasError(lastError);
        if (errorClass === 'permanent') {
          console.warn(`[ImageGenerationService] Atlas Cloud permanent error (no retry): ${lastError.message}`);
          this.pipelineMetrics.permanentFailures++;
          break;
        }
        this.pipelineMetrics.transientRetries++;
        if (attempt < this.maxRetries) {
          const rawBackoff = this.retryDelayMs * Math.pow(this.retryBackoffMultiplier, attempt - 1);
          await this.delay(Math.min(rawBackoff, this.maxRetryBackoffMs));
        }
      }
    }

    // Fallback: try Nano Banana (Gemini) before giving up entirely
    const geminiKey = this.config.geminiApiKey
      || (typeof process !== 'undefined' ? (process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY) : undefined);

    if ((!this.isFailFastEnabled() || this.shouldTrackEncounterType(imageType)) && geminiKey) {
      console.warn(`[ImageGenerationService] Atlas Cloud failed after ${this.maxRetries} attempts for "${identifier}". Falling back to Gemini.`);
      this.emit({ type: 'job_updated', id: jobId, updates: { status: 'processing', progress: 15, message: 'Falling back to Gemini...' } });
      try {
        return await this.generateWithNanoBanana(prompt, identifier, jobId, referenceImages, imageType);
      } catch (fallbackErr) {
        console.error(`[ImageGenerationService] Gemini fallback also failed for "${identifier}":`, fallbackErr);
      }
    }

    this.emit({ type: 'job_updated', id: jobId, updates: { status: 'failed', error: lastError?.message || 'Max retries exceeded', endTime: Date.now() } });
    if (this.isFailFastEnabled()) {
      throw lastError || new Error(`Atlas Cloud image generation failed for "${identifier}"`);
    }
    const placeholder = await this.generatePlaceholder(prompt, identifier, jobId);
    return placeholder;
  }

  /**
   * Batch-generate multiple images. When Atlas Cloud + Seedream is active,
   * uses the sequential or edit-sequential variant in a single API call.
   * For all other providers/models, falls back to a sequential loop over generateImage().
   */
  async generateImageBatch(
    prompts: { prompt: ImagePrompt; identifier: string; metadata?: any }[],
    referenceImages?: ReferenceImage[]
  ): Promise<GeneratedImage[]> {
    if (prompts.length === 0) return [];

    const caps = this.modelCapabilities;
    const hasRefs = referenceImages && referenceImages.length > 0;
    const canBatch = hasRefs ? caps.supportsBatchEdit : caps.supportsBatch;

    if (!canBatch || prompts.length === 1) {
      const results: GeneratedImage[] = [];
      for (const p of prompts) {
        results.push(await this.generateImage(p.prompt, p.identifier, p.metadata, referenceImages));
      }
      return results;
    }

    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.atlasCloudApiKey || env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY || env.ATLAS_CLOUD_API_KEY;
    if (!apiKey) {
      const results: GeneratedImage[] = [];
      for (const p of prompts) {
        results.push(await this.generateImage(p.prompt, p.identifier, p.metadata, referenceImages));
      }
      return results;
    }

    const allResults: GeneratedImage[] = [];
    const chunks: typeof prompts[] = [];
    for (let i = 0; i < prompts.length; i += caps.maxBatchSize) {
      chunks.push(prompts.slice(i, i + caps.maxBatchSize));
    }

    const baseUrl = this.getAtlasCloudProxyUrl();

    for (const chunk of chunks) {
      const model = this.resolveAtlasCloudModel({ hasRefs: !!hasRefs, isBatch: true });
      const batchJobId = `batch-${Date.now()}`;

      this.emit({ type: 'job_added', job: { id: batchJobId, identifier: `batch(${chunk.length})`, prompt: 'Batch generation', status: 'pending' } });

      try {
        await this.waitForProviderPacing('atlas-cloud');

        const combinedPrompt = chunk.map((p, i) => {
          const batchStyle = this.resolveArtStyle(p.prompt.style);
          return `[Image ${i + 1}]: ${p.prompt.prompt}${p.prompt.composition ? ' ' + p.prompt.composition : ''} Style: ${batchStyle}`;
        }).join('\n\n');

        const body: Record<string, any> = {
          model,
          prompt: combinedPrompt,
          max_images: chunk.length,
        };

        if (caps.isNanoBanana && hasRefs) {
          const batchRefs = this.collectAtlasReferenceImages(referenceImages);
          body.images = await this.prepareAtlasImageRefs(batchRefs, apiKey);
        } else if (caps.isNanoBanana) {
          body.aspect_ratio = chunk[0].prompt.aspectRatio || '1:1';
          body.resolution = '1k';
          body.output_format = 'png';
        } else {
          body.size = this.mapAspectRatioToSize(chunk[0].prompt.aspectRatio || '1:1', model);
          body.output_format = 'png';
          if (hasRefs) {
            const batchRefs = this.collectAtlasReferenceImages(referenceImages);
            body.images = await this.prepareAtlasImageRefs(batchRefs, apiKey);
          }
        }

        console.log(`[ImageGenerationService] Atlas Cloud batch: ${chunk.length} images with model ${model} (async)`);
        this.emit({ type: 'job_updated', id: batchJobId, updates: { status: 'processing', progress: 10 } });

        const response = await fetch(`${baseUrl}/generateImage`, {
          method: 'POST',
          headers: {
            'x-atlas-cloud-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Atlas Cloud batch API error: ${response.status} - ${errorText}`);
        }

        const submitData = await response.json();
        let outputs: string[];

        const inlineOutputs = this.extractAtlasOutputs(submitData);
        if (inlineOutputs.length > 0) {
          outputs = inlineOutputs;
        } else {
          const predictionId = submitData?.data?.id || submitData?.id;
          if (!predictionId) {
            throw new Error('Atlas Cloud batch: no prediction ID or outputs in response');
          }
          console.log(`[ImageGenerationService] Atlas Cloud batch prediction submitted: ${predictionId}`);
          const pollResult = await this.pollAtlasPrediction(predictionId, apiKey, baseUrl, batchJobId);
          outputs = this.extractAtlasOutputs(pollResult);
        }

        this.emit({ type: 'job_updated', id: batchJobId, updates: { progress: 80, message: 'Saving batch images...' } });

        for (let i = 0; i < chunk.length; i++) {
          const output = outputs[i];
          if (!output) {
            allResults.push(await this.generatePlaceholder(chunk[i].prompt, chunk[i].identifier, `${batchJobId}-${i}`));
            continue;
          }

          const detected = await this.resolveAtlasOutput(output);
          const imagePath = this.joinPath(this.outputDir, `${chunk[i].identifier}.${detected.extension}`);
          await this.writeFile(imagePath, detected.base64Data, true);

          const resultImageUrl = this.toImageHttpUrl(imagePath, detected.mimeType, detected.base64Data);

          allResults.push({
            prompt: chunk[i].prompt,
            imagePath,
            imageUrl: resultImageUrl,
            imageData: detected.base64Data,
            mimeType: detected.mimeType,
            metadata: { format: detected.extension, provider: 'atlas-cloud', model },
          });
        }

        this.emit({ type: 'job_updated', id: batchJobId, updates: { status: 'completed', progress: 100, endTime: Date.now() } });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[ImageGenerationService] Atlas Cloud batch failed, falling back to sequential:`, errMsg);
        this.emit({ type: 'job_updated', id: batchJobId, updates: { status: 'failed', error: errMsg, endTime: Date.now() } });
        const errorClass = this.classifyAtlasError(error);
        if (errorClass === 'permanent') {
          // Permanent request-shape/config errors — skip Atlas retries but still try Gemini fallback per image.
          for (const p of chunk) {
            allResults.push(await this.generateImage(p.prompt, p.identifier, p.metadata, referenceImages));
          }
        } else {
          for (const p of chunk) {
            allResults.push(await this.generateImage(p.prompt, p.identifier, p.metadata, referenceImages));
          }
        }
      }
    }

    return allResults;
  }

  /**
   * Generate a single image with explicit reference images.
   * When Atlas Cloud + Seedream is active, uses the edit variant with native reference support.
   * For all other providers/models, falls through to the standard generateImage() with referenceImages.
   */
  async generateImageWithReferences(
    prompt: ImagePrompt,
    identifier: string,
    metadata: any,
    referenceImages: ReferenceImage[]
  ): Promise<GeneratedImage> {
    return this.generateImage(prompt, identifier, metadata, referenceImages);
  }

  /**
   * Generate image using useapi.net Midjourney API
   * API Documentation: https://useapi.net/docs/api-midjourney-v3/post-midjourney-jobs-imagine
   */
  private async generateWithUseapi(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    metadata?: {
      type?: string;
      omniWeightOverride?: number;
    },
    referenceImages?: ReferenceImage[]
  ): Promise<GeneratedImage> {
    const token = this.config.useapiToken;
    if (!token) {
      throw new Error('Midjourney/useapi token is required for midapi image generation');
    }

    this.emit({ type: 'job_updated', id: jobId, updates: { status: 'generating', progress: 5, message: 'Calling Midjourney via useapi.net...' } });

    const fullPrompt = this.buildMidjourneyPrompt(prompt, identifier, metadata, referenceImages);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Rate limiting
        await this.waitForProviderPacing('midapi');

        console.log(`[ImageGenerationService] Midjourney: Generating image (attempt ${attempt}/${this.maxRetries})`);
        console.log(`[ImageGenerationService] Midjourney: Prompt: ${fullPrompt.substring(0, 100)}...`);
        this.emit({ type: 'job_updated', id: jobId, updates: { progress: 10, attempts: attempt, message: 'Submitting to Midjourney...' } });

        // Use proxy server to avoid CORS issues
        const getProxyUrl = () => {
          if (isWebRuntime() && typeof window !== 'undefined') {
            return `http://${window.location.hostname || 'localhost'}:3001/useapi`;
          }
          return 'http://localhost:3001/useapi';
        };
        const baseUrl = getProxyUrl();

        // Step 1: Submit the imagine job
        const submitResponse = await fetch(`${baseUrl}/midjourney/jobs/imagine`, {
          method: 'POST',
          headers: {
            'x-useapi-token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: fullPrompt,
            stream: false, // We'll poll for status
          }),
        });

        if (!submitResponse.ok) {
          const errorData = await submitResponse.json().catch(() => ({ error: `HTTP ${submitResponse.status}` }));
          const errorMsg = errorData.error || `HTTP ${submitResponse.status}`;
          
          if (submitResponse.status === 429) {
            console.warn(`[ImageGenerationService] Midjourney: Rate limited, will retry...`);
            throw new Error(`Rate limited: ${errorMsg}`);
          }
          if (submitResponse.status === 596) {
            throw new Error(`Midjourney moderation/CAPTCHA issue: ${errorMsg}`);
          }
          
          throw new Error(`Midjourney API error: ${errorMsg}`);
        }

        const submitData = await submitResponse.json();
        const mjJobId = submitData.jobid;
        
        if (!mjJobId) {
          throw new Error('No job ID returned from Midjourney');
        }

        console.log(`[ImageGenerationService] Midjourney: Job created: ${mjJobId}`);
        this.emit({ type: 'job_updated', id: jobId, updates: { progress: 15, message: 'Job submitted, waiting for Midjourney...' } });

        // Step 2: Poll for completion
        const maxPollAttempts = 120; // Up to 2 minutes of polling (1s intervals)
        let pollAttempts = 0;
        let completedJob: any = null;

        while (pollAttempts < maxPollAttempts) {
          pollAttempts++;
          await this.delay(1000); // Poll every 1 second

          const pollResponse = await fetch(`${baseUrl}/midjourney/jobs/${encodeURIComponent(mjJobId)}`, {
            method: 'GET',
            headers: {
              'x-useapi-token': token,
            },
          });

          if (!pollResponse.ok) {
            console.warn(`[ImageGenerationService] Midjourney: Poll error ${pollResponse.status}`);
            continue;
          }

          const pollData = await pollResponse.json();
          const status = pollData.status;
          const progressPercent = pollData.response?.progress_percent || 0;
          
          // Update progress based on Midjourney's reported progress
          const mappedProgress = 15 + (progressPercent * 0.7); // Map 0-100 to 15-85
          this.emit({ type: 'job_updated', id: jobId, updates: { 
            progress: mappedProgress, 
            message: `Midjourney: ${status} (${progressPercent}%)` 
          } });

          console.log(`[ImageGenerationService] Midjourney: Status ${status} (${progressPercent}%) - poll ${pollAttempts}`);

          if (status === 'completed') {
            completedJob = pollData;
            break;
          } else if (status === 'failed') {
            throw new Error(`Midjourney job failed: ${pollData.error || 'Unknown error'}`);
          } else if (status === 'moderated') {
            throw new Error(`Midjourney content moderated: ${pollData.error || 'Content policy violation'}`);
          }
          // Continue polling for 'created', 'started', 'progress'
        }

        if (!completedJob) {
          throw new Error('Midjourney job timed out after 2 minutes');
        }

        // Step 3: Extract the image URL
        // Midjourney returns a grid of 4 images - we'll take the first one from imageUx
        const imageUx = completedJob.response?.imageUx;
        const attachments = completedJob.response?.attachments;
        
        let imageUrl: string | undefined;
        
        // Prefer individual image from imageUx (first quadrant)
        if (imageUx && imageUx.length > 0) {
          imageUrl = imageUx[0].url;
        } else if (attachments && attachments.length > 0) {
          // Fall back to the full grid image
          imageUrl = attachments[0].url || attachments[0].proxy_url;
        }

        if (!imageUrl) {
          console.error('[ImageGenerationService] Midjourney: Response structure:', JSON.stringify(completedJob, null, 2));
          throw new Error('No image URL found in Midjourney response');
        }

        console.log(`[ImageGenerationService] Midjourney: Downloading image from ${imageUrl}`);
        this.emit({ type: 'job_updated', id: jobId, updates: { progress: 90, message: 'Downloading image...' } });

        // Step 4: Download and save the image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }

        const imageBlob = await imageResponse.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const imageData = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = imageBlob.type || 'image/png';
        
        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 
                         mimeType.includes('webp') ? 'webp' : 'png';
        const imagePath = this.joinPath(this.outputDir, `${identifier}.${extension}`);
        await this.writeFile(imagePath, imageData, true);

        const resultImageUrl = this.toImageHttpUrl(imagePath, mimeType, imageData);

        const result = { prompt, imagePath, imageUrl: resultImageUrl, imageData, mimeType, metadata: { format: extension, provider: 'useapi-midjourney', mjJobId } };
        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', progress: 100, imageUrl: resultImageUrl, endTime: Date.now() } });
        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[ImageGenerationService] Midjourney attempt ${attempt} failed:`, lastError.message);
        this.emit({ type: 'job_updated', id: jobId, updates: { error: lastError.message, attempts: attempt } });
        if (attempt < this.maxRetries) {
          // Longer delay for rate limiting errors
          const rawDelayTime = lastError.message.includes('Rate limited')
            ? 15000 * attempt
            : this.retryDelayMs * Math.pow(this.retryBackoffMultiplier, attempt - 1);
          await this.delay(Math.min(rawDelayTime, this.maxRetryBackoffMs));
        }
      }
    }

    this.emit({ type: 'job_updated', id: jobId, updates: { status: 'failed', error: lastError?.message || 'Max retries exceeded', endTime: Date.now() } });
    if (this.isFailFastEnabled()) {
      throw lastError || new Error(`Midjourney image generation failed for "${identifier}"`);
    }
    const placeholder = await this.generatePlaceholder(prompt, identifier, jobId);
    return placeholder;
  }

  private mapAspectRatioForMidjourney(aspectRatio: string): string {
    // Map common aspect ratios to Midjourney supported values
    const ratioMap: Record<string, string> = {
      '9:19.5': '9:16', // Closest supported ratio
      '9:16': '9:16',
      '16:9': '16:9',
      '1:1': '1:1',
      '4:3': '4:3',
      '3:4': '3:4',
      '3:2': '3:2',
      '2:3': '2:3',
      '21:9': '21:9',
      '9:21': '9:21',
    };
    return ratioMap[aspectRatio] || '16:9'; // Default to landscape for Midjourney
  }

  private async generateWithDallE(prompt: ImagePrompt, identifier: string, jobId: string): Promise<GeneratedImage> {
    if (this.isFailFastEnabled()) {
      throw new Error('DALL-E image generation is not implemented for fail-fast mode');
    }
    return this.generatePlaceholder(prompt, identifier, jobId);
  }

  private async generateWithStableDiffusion(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    metadata?: Record<string, any>,
  ): Promise<GeneratedImage> {
    const settings = this._stableDiffusionSettings;
    if (!settings || !settings.baseUrl) {
      const msg = 'Stable Diffusion is selected but no baseUrl is configured. Set STABLE_DIFFUSION_BASE_URL or update settings.';
      if (this.isFailFastEnabled()) throw new Error(msg);
      console.warn(`[ImageGenerationService] ${msg} — falling back to placeholder for "${identifier}"`);
      return this.generatePlaceholder(prompt, identifier, jobId);
    }

    const adapter = this.getSDAdapter();
    const promptWithSeed = this.applyDeterministicSeed(prompt, identifier, metadata);
    try {
      const result = await adapter.generate(
        { prompt: promptWithSeed, identifier, jobId, metadata, referenceImages, settings },
        this.getSDWriteHelpers(),
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.isFailFastEnabled()) {
        throw new Error(`Stable Diffusion generation failed (${adapter.id}): ${msg}`);
      }
      console.error(`[ImageGenerationService] Stable Diffusion generation failed for "${identifier}" via ${adapter.id}: ${msg}`);
      return this.generatePlaceholder(prompt, identifier, jobId);
    }
  }

  private async generatePlaceholder(prompt: ImagePrompt, identifier: string, jobId: string): Promise<GeneratedImage> {
    const imagePath = this.joinPath(this.outputDir, `${identifier}.prompt.txt`);
    const promptText = `Image Prompt for ${identifier}\n\n${prompt.prompt}\n\nStyle: ${prompt.style || 'default'}\nAspect Ratio: ${prompt.aspectRatio || '9:19.5'}\nComposition: ${prompt.composition || 'standard'}`;
    await this.writeFile(imagePath, promptText);
    return { prompt, imagePath, imageUrl: undefined, metadata: { format: 'prompt' } };
  }

  /**
   * Gemini vision QA gate: check a generated image for text artifacts.
   * Returns { hasText: boolean, description?: string } indicating whether
   * the image contains visible text that should not be there.
   * 
   * @param imageData Base64-encoded image data
   * @param mimeType The MIME type of the image (e.g., 'image/png')
   * @param allowDiegeticText If true, only reject non-diegetic text (watermarks, UI, gibberish)
   */
  async checkImageForTextArtifacts(
    imageData: string,
    mimeType: string,
    allowDiegeticText: boolean = false
  ): Promise<{ hasText: boolean; description?: string }> {
    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.geminiApiKey || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[ImageGenerationService] No Gemini API key for text artifact check — skipping');
      return { hasText: false };
    }

    try {
      const visionModel = 'gemini-2.0-flash';
      const visionPrompt = allowDiegeticText
        ? 'Does this image contain any NON-DIEGETIC text overlaid on the image — narrative captions, dialog text, speech bubbles, thought bubbles, sound effects, onomatopoeia, chapter titles, character name labels, credits, watermarks, or random gibberish letters? IGNORE text that naturally exists on objects in the scene world (neon signs, building signage, clothing text, book covers, screens, banners, license plates, posters). Respond with ONLY "YES" or "NO" on the first line, then a brief description on the second line if YES.'
        : 'Does this image contain any visible text, words, letters, numbers, signs, labels, or captions? Respond with ONLY "YES" or "NO" on the first line, then a brief description on the second line if YES.';

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: imageData } },
              { text: visionPrompt },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
        }),
      });

      if (!response.ok) {
        console.warn(`[ImageGenerationService] Gemini vision QA returned ${response.status} — skipping text check`);
        return { hasText: false };
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const firstLine = text.split('\n')[0].toUpperCase();
      const hasText = firstLine.startsWith('YES');
      const description = hasText ? text.split('\n').slice(1).join(' ').trim() : undefined;

      if (hasText) {
        console.warn(`[ImageGenerationService] Text artifact detected: ${description || 'unknown'}`);
      }

      return { hasText, description };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ImageGenerationService] Text artifact check failed: ${msg} — allowing image`);
      return { hasText: false };
    }
  }
}
