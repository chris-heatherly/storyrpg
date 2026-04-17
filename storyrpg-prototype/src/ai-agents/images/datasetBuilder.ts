/**
 * LoRA training dataset builder.
 *
 * Turns assets the pipeline already produces (character reference sheets,
 * style-bible anchors) into `LoraTrainingImage[]` payloads the
 * `LoraTrainerAdapter` can submit.
 *
 * Design goals:
 *  - Pure and sync. No filesystem writes, no network calls. The agent that
 *    calls this module is responsible for turning inline base64 payloads
 *    into on-disk files when the trainer needs real paths.
 *  - Keep the trainer-agnostic format. Captions use a leading trigger token
 *    followed by short descriptors; every trainer we plan to target accepts
 *    this layout.
 *  - Defensive against missing / partial inputs. A character with no
 *    reference sheet yields zero images (callers skip training); a style
 *    profile with empty vocabulary falls back to the profile name.
 */

import type {
  LoraTrainingImage,
  LoraTrainingKind,
} from '../services/lora-training/LoraTrainerAdapter';
import type { ArtStyleProfile } from './artStyleProfile';
import type { GeneratedImage } from '../agents/ImageGenerator';
import type { PreapprovedAnchor } from '../config';

/** A single character reference image, however it was sourced. */
export interface DatasetCharacterReference {
  /** Short tag like `front`, `three-quarter`, `profile`, `action-combat-stance`. */
  viewKey: string;
  /** Path to the bytes on disk. Preferred over `data` when both are set. */
  imagePath?: string;
  /** Base64 bytes when the reference hasn't been flushed to disk yet. */
  data?: string;
  mimeType?: string;
  /** Optional free-form view-level caption the agent authored. */
  captionHint?: string;
}

/** Adapter over `GeneratedReferenceSheet.generatedImages` + action poses. */
export function collectCharacterReferences(
  generatedImagesByView: Map<string, GeneratedImage>,
): DatasetCharacterReference[] {
  const refs: DatasetCharacterReference[] = [];
  for (const [viewKey, img] of generatedImagesByView.entries()) {
    if (!img) continue;
    if (!img.imagePath && !img.imageData) continue;
    refs.push({
      viewKey,
      imagePath: img.imagePath,
      data: img.imageData,
      mimeType: img.mimeType,
    });
  }
  return refs;
}

/** Identity-block fields we fold into character captions. */
export interface CharacterIdentityForDataset {
  name: string;
  role?: string;
  pronouns?: string;
  physicalDescription?: string;
  distinctiveFeatures?: string[];
  typicalAttire?: string;
}

export interface BuildCharacterDatasetInput {
  character: CharacterIdentityForDataset;
  /** Stable trigger token the adapter must embed in every caption. */
  trigger: string;
  references: DatasetCharacterReference[];
  /** Art style profile — feeds a short style postfix into every caption. */
  style?: ArtStyleProfile;
}

/**
 * Build a captioned dataset for training a character LoRA.
 *
 * Captions follow the convention used by most kohya_ss training configs:
 *   `<trigger>, <view descriptor>, <identity anchors>, <style postfix>`
 *
 * The trigger token comes first so the resulting LoRA reliably activates
 * when the inference path emits the same token in the positive prompt.
 */
export function buildCharacterDataset(
  input: BuildCharacterDatasetInput,
): LoraTrainingImage[] {
  const identityAnchors = composeIdentityAnchors(input.character);
  const stylePostfix = composeStylePostfix(input.style);
  const result: LoraTrainingImage[] = [];
  for (const ref of input.references) {
    const path = ref.imagePath;
    if (!path) continue; // trainer needs on-disk bytes; inline-only refs are skipped
    const view = humanizeViewKey(ref.viewKey);
    const captionParts = [
      input.trigger,
      view,
      ref.captionHint,
      identityAnchors,
      stylePostfix,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    result.push({
      path,
      mimeType: ref.mimeType,
      caption: dedupeCaptionParts(captionParts).join(', '),
    });
  }
  return result;
}

/** One style-bible anchor ready to feed into the dataset builder. */
export interface DatasetStyleAnchor {
  role: 'character' | 'arcStrip' | 'environment' | string;
  imagePath?: string;
  data?: string;
  mimeType?: string;
}

export interface BuildStyleDatasetInput {
  style: ArtStyleProfile;
  /** Stable trigger token for the resulting style LoRA. */
  trigger: string;
  /** Style-bible anchors (character/arcStrip/environment + any extras). */
  anchors: DatasetStyleAnchor[];
  /** Additional curated beat images from prior episodes, if any. */
  additional?: DatasetStyleAnchor[];
}

/**
 * Build a captioned dataset for training an episode-style LoRA.
 *
 * Style training captions lead with the trigger token, describe the anchor
 * role in one word, and append the profile's DNA slots so the trainer learns
 * *how* the style renders — not just which character is in the frame.
 */
export function buildStyleDataset(
  input: BuildStyleDatasetInput,
): LoraTrainingImage[] {
  const styleHeader = composeStyleHeader(input.style);
  const all = [...input.anchors, ...(input.additional ?? [])];
  const result: LoraTrainingImage[] = [];
  for (const anchor of all) {
    if (!anchor.imagePath) continue;
    const captionParts = [input.trigger, anchor.role, styleHeader].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    result.push({
      path: anchor.imagePath,
      mimeType: anchor.mimeType,
      caption: dedupeCaptionParts(captionParts).join(', '),
    });
  }
  return result;
}

/**
 * Derive a deterministic, filesystem-safe LoRA name from a trigger seed.
 * Strips anything that wouldn't survive A1111's inline `<lora:...>` parser.
 */
export function deriveLoraName(kind: LoraTrainingKind, seed: string): string {
  const slug = seed
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = kind === 'character' ? 'char' : 'style';
  return `${prefix}_${slug || 'unnamed'}`;
}

/**
 * Compose the trigger token embedded into every caption. Deterministic so
 * the registry fingerprint plus the name are enough to reproduce training.
 */
export function buildTriggerToken(name: string, fingerprint: string): string {
  const shortPrint = fingerprint.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return shortPrint ? `${name}_${shortPrint}` : name;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function composeIdentityAnchors(char: CharacterIdentityForDataset): string | undefined {
  const parts: string[] = [];
  if (char.physicalDescription) parts.push(char.physicalDescription);
  if (char.distinctiveFeatures && char.distinctiveFeatures.length > 0) {
    parts.push(char.distinctiveFeatures.slice(0, 3).join(', '));
  }
  if (char.typicalAttire) parts.push(char.typicalAttire);
  const joined = parts.filter(Boolean).join(', ').trim();
  return joined.length > 0 ? joined : undefined;
}

function composeStylePostfix(style: ArtStyleProfile | undefined): string | undefined {
  if (!style) return undefined;
  const pickedVocab = (style.positiveVocabulary || []).slice(0, 3);
  const postfix = [style.name, ...pickedVocab].filter(Boolean).join(', ').trim();
  return postfix.length > 0 ? postfix : undefined;
}

function composeStyleHeader(style: ArtStyleProfile): string {
  const parts = [
    style.name,
    style.renderingTechnique,
    style.colorPhilosophy,
    style.lightingApproach,
    ...((style.positiveVocabulary || []).slice(0, 4)),
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return parts.join(', ');
}

function humanizeViewKey(viewKey: string): string {
  const [viewType, expressionName] = viewKey.split('-');
  const view = (viewType || 'view').replace(/_/g, ' ');
  if (expressionName) return `${view}, ${expressionName} expression`;
  return `${view} view`;
}

function dedupeCaptionParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

/** Convenience: normalize a `PreapprovedAnchor` into a dataset-friendly shape. */
export function preapprovedAnchorToDataset(
  role: DatasetStyleAnchor['role'],
  anchor: PreapprovedAnchor | undefined,
): DatasetStyleAnchor | undefined {
  if (!anchor) return undefined;
  if (!anchor.imagePath && !anchor.data) return undefined;
  return {
    role,
    imagePath: anchor.imagePath,
    data: anchor.data,
    mimeType: anchor.mimeType,
  };
}
