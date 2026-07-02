#!/usr/bin/env npx ts-node
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from '../config';
import { ImageGenerationService, type ReferenceImage } from '../services/imageGenerationService';
import type { ImagePrompt } from '../images/imageTypes';
import type { ImageProvider } from '../config';

type RegenerationPayload = {
  resultPath: string;
  imageUrl: string;
  identifier?: string;
  promptPath?: string;
  metadata?: Record<string, unknown>;
  feedback?: {
    notes?: string;
    reasons?: string[];
    rating?: 'positive' | 'negative';
  };
};

type SavedReferenceMeta = Partial<ReferenceImage> & {
  uri?: string;
  localPath?: string;
};

/**
 * E3: Translate structured feedback reasons into concrete directive phrasing
 * that the image model can act on. Maps the reason ids emitted by
 * `imageFeedbackStore` to actionable prompt fragments and negative-prompt
 * additions. Unknown reason ids fall back to a generic "address this issue"
 * line so future categories never silently disappear.
 */
const FEEDBACK_REASON_PROMPT: Record<string, { directive: string; negative?: string }> = {
  // Basic
  wrong_style: { directive: 'Match the canonical art style exactly; do not drift toward other aesthetics.' },
  wrong_character: { directive: 'Render the referenced character accurately using their visual anchors.' },
  wrong_mood: { directive: 'Adjust lighting, palette, and expression to match the specified mood.' },
  wrong_setting: { directive: 'Anchor the scene in the correct environment described in the prompt.' },
  poor_quality: { directive: 'Increase rendering quality; sharp focus, clean anatomy, cohesive composition.', negative: 'blurry, low quality, distorted anatomy' },
  doesnt_match_text: { directive: 'Render exactly what the beat text describes; do not substitute generic imagery.' },
  // Camera
  wrong_shot_type: { directive: 'Reassess shot distance to serve the emotional beat — tighter for intimacy, wider for scope.' },
  wrong_camera_angle: { directive: 'Use a camera angle that reinforces the power dynamic (low angle = dominant, high angle = vulnerable).' },
  flat_staging: { directive: 'Stage characters with depth — foreground, midground, background; avoid a flat line parallel to camera.', negative: 'flat staging, characters lined up, perpendicular to camera' },
  poor_eye_flow: { directive: 'Use composition lines (eyelines, leading lines) to guide the viewer to the focal point.' },
  // Silhouette
  silhouette_unclear: { directive: 'Ensure the primary action reads at thumbnail size through silhouette alone.', negative: 'cluttered silhouette, merging shapes' },
  pose_static: { directive: 'Break symmetry — asymmetric stance, weight shift, line of action through the body.', negative: 'symmetrical stance, arms at sides, mannequin pose' },
  merging_issues: { directive: 'Separate character limbs and weapons against the background; no overlapping edges.' },
  // Expression
  expression_wrong: { directive: 'Render the facial expression that matches the emotional read described in the prompt.' },
  body_language_off: { directive: 'Match body language to the emotional intent — posture, gesture, tension visible.' },
  // Impact
  impact_not_dominant: { directive: 'Make the point of impact the clearest and largest element in the frame.' },
  foreshortening_needed: { directive: 'Exaggerate foreshortening on the action coming toward camera.' },
  // Lighting
  lighting_mismatch: { directive: 'Adjust light direction, hardness, and temperature to match the specified mood.' },
  color_palette_wrong: { directive: 'Honor the specified color palette exactly; do not improvise alternatives.' },
  // Spatial
  perspective_wrong: { directive: 'Establish consistent vanishing points appropriate for the shot distance.' },
  depth_lacking: { directive: 'Add layered depth — foreground elements, midground subjects, background atmosphere.' },
  // Texture
  texture_obscures_silhouette: { directive: 'Reduce surface texture where it hides character edges; preserve silhouette clarity.' },
  texture_mood_mismatch: { directive: 'Choose a surface texture treatment consistent with the scene mood.' },
};

function applyFeedbackToPrompt(
  prompt: ImagePrompt,
  feedback?: RegenerationPayload['feedback'],
): ImagePrompt {
  if (!feedback) return prompt;
  const { notes, reasons } = feedback;
  const reasonDirectives: string[] = [];
  const reasonNegatives: string[] = [];
  if (Array.isArray(reasons) && reasons.length > 0) {
    const seen = new Set<string>();
    for (const reason of reasons) {
      if (!reason || seen.has(reason)) continue;
      seen.add(reason);
      const mapping = FEEDBACK_REASON_PROMPT[reason];
      if (mapping) {
        reasonDirectives.push(mapping.directive);
        if (mapping.negative) reasonNegatives.push(mapping.negative);
      } else {
        reasonDirectives.push(`Address the user-flagged issue: ${reason.replace(/_/g, ' ')}.`);
      }
    }
  }
  const trimmedNotes = notes?.trim();
  if (!reasonDirectives.length && !trimmedNotes) return prompt;

  const improvementLines = [
    ...reasonDirectives.map((d) => `- ${d}`),
    ...(trimmedNotes ? [`- User note: ${trimmedNotes}`] : []),
  ];
  const improvementBlock = `\n\nUSER REQUESTED FIXES:\n${improvementLines.join('\n')}\nKeep the core story moment and composition intent, but address the issues above.`;

  const mergedNegative = reasonNegatives.length
    ? [prompt.negativePrompt, ...reasonNegatives].filter(Boolean).join(', ')
    : prompt.negativePrompt;

  return {
    ...prompt,
    prompt: `${prompt.prompt || ''}${improvementBlock}`.trim(),
    negativePrompt: mergedNegative,
  };
}

async function readPromptPayload(promptPath?: string): Promise<{
  prompt: ImagePrompt;
  metadata?: Record<string, unknown>;
  identifier?: string;
  references?: SavedReferenceMeta[];
}> {
  if (!promptPath) throw new Error('Missing promptPath for image regeneration');
  const raw = await fs.readFile(promptPath, 'utf8');
  const parsed = JSON.parse(raw);
  const prompt = parsed?.prompt;
  if (!prompt || typeof prompt !== 'object') {
    throw new Error('Prompt file did not contain a valid ImagePrompt object');
  }
  return {
    prompt,
    metadata: parsed?.metadata,
    identifier: parsed?.identifier,
    references: Array.isArray(parsed?.references)
      ? parsed.references
      : Array.isArray(parsed?.metadata?.referenceThumbnails)
        ? parsed.metadata.referenceThumbnails
        : undefined,
  };
}

function normalizeProvider(provider: unknown): ImageProvider | undefined {
  const value = String(provider || '').trim();
  if (!value) return undefined;
  if (value === 'openai') return 'dall-e';
  if (value === 'gemini') return 'nano-banana';
  if (['nano-banana', 'atlas-cloud', 'midapi', 'useapi', 'dall-e', 'stable-diffusion', 'placeholder'].includes(value)) {
    return value as ImageProvider;
  }
  return undefined;
}

function resolveOriginalProviderModel(
  metadata: Record<string, unknown>,
  fallback: ReturnType<typeof loadConfig>,
): { provider: ImageProvider | undefined; model: string | undefined; usedFallback: boolean } {
  const provider = normalizeProvider(metadata.effectiveProvider)
    || normalizeProvider(metadata.requestedProvider)
    || normalizeProvider(fallback.imageGen?.provider);
  const model = String(metadata.effectiveModel || metadata.requestedModel || '').trim()
    || (provider === 'dall-e'
      ? fallback.imageGen?.openaiImageModel
      : provider === 'nano-banana'
        ? fallback.imageGen?.model
        : provider === 'atlas-cloud'
          ? fallback.imageGen?.atlasCloudModel
          : provider === 'stable-diffusion'
            ? fallback.imageGen?.stableDiffusion?.defaultModel
            : undefined);
  return {
    provider,
    model: model || undefined,
    usedFallback: !metadata.effectiveProvider && !metadata.requestedProvider,
  };
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function toReferenceLocalPath(value: string | undefined, promptPath: string): string | null {
  if (!value) return null;
  if (value.startsWith('data:')) return null;
  if (path.isAbsolute(value)) return value;
  const generatedIdx = value.indexOf('/generated-stories/');
  if (generatedIdx >= 0) return path.resolve(process.cwd(), value.slice(generatedIdx + 1));
  if (value.startsWith('generated-stories/')) return path.resolve(process.cwd(), value);
  return path.resolve(path.dirname(promptPath), value);
}

function safeReferenceKey(ref: SavedReferenceMeta, fallbackIndex: number): string {
  const dedupeKey = `${ref.characterName || ref.role || 'reference'}:${ref.viewType || 'ref'}`;
  return dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || String(fallbackIndex);
}

async function readReferenceFile(
  filePath: string | null,
  ref: SavedReferenceMeta,
): Promise<ReferenceImage | null> {
  if (!filePath) return null;
  try {
    const data = await fs.readFile(filePath);
    return {
      data: data.toString('base64'),
      mimeType: ref.mimeType || mimeTypeForPath(filePath),
      role: ref.role || 'reference',
      governs: ref.governs,
      prohibited: ref.prohibited,
      characterId: ref.characterId,
      characterName: ref.characterName,
      viewType: ref.viewType,
      visualAnchors: ref.visualAnchors,
      purpose: ref.purpose,
      url: ref.url,
    };
  } catch {
    return null;
  }
}

async function restoreReferenceImages(
  promptPath: string | undefined,
  identifier: string,
  promptPayload: Awaited<ReturnType<typeof readPromptPayload>>,
): Promise<ReferenceImage[] | undefined> {
  if (!promptPath) return undefined;
  const metadata = (promptPayload.metadata || {}) as Record<string, any>;
  const rawRefs: SavedReferenceMeta[] = [
    ...(Array.isArray(promptPayload.references) ? promptPayload.references : []),
    ...(Array.isArray(metadata.effectiveReferences) ? metadata.effectiveReferences : []),
    ...(Array.isArray(metadata.inputReferences) ? metadata.inputReferences : []),
    ...(Array.isArray(metadata.referenceThumbnails) ? metadata.referenceThumbnails : []),
  ];
  if (rawRefs.length === 0) return undefined;

  const outputDir = path.resolve(path.dirname(promptPath), '..');
  const previewsDir = path.join(outputDir, 'job-reference-previews');
  let previewFiles: string[] = [];
  try {
    previewFiles = await fs.readdir(previewsDir);
  } catch {
    previewFiles = [];
  }

  const restored: ReferenceImage[] = [];
  const seen = new Set<string>();
  for (const ref of rawRefs) {
    const key = `${ref.role || ''}:${ref.characterId || ''}:${ref.characterName || ''}:${ref.viewType || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let localPath = toReferenceLocalPath(ref.localPath || ref.uri || ref.url, promptPath);
    if (!localPath) {
      const safeKey = safeReferenceKey(ref, restored.length);
      const match = previewFiles.find((file) => (
        file.startsWith(`${identifier}-${safeKey}.`) ||
        file.startsWith(`${identifier}-${safeKey}-`)
      ));
      if (match) localPath = path.join(previewsDir, match);
    }

    const loaded = await readReferenceFile(localPath, ref);
    if (loaded) restored.push(loaded);
  }

  return restored.length > 0 ? restored : undefined;
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) throw new Error('Missing payload path');
  const payloadRaw = await fs.readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw) as RegenerationPayload;

  const promptPayload = await readPromptPayload(payload.promptPath);
  const originalMetadata = (payload.metadata || promptPayload.metadata || {}) as Record<string, unknown>;
  const originalIdentifier = payload.identifier || promptPayload.identifier || 'image';
  const outputDir = payload.promptPath ? path.resolve(path.dirname(payload.promptPath), '..') : path.resolve(process.cwd(), 'generated-stories');

  const config = loadConfig();
  const imageGenConfig = config.imageGen || {};
  const original = resolveOriginalProviderModel(originalMetadata, config);
  if (original.usedFallback) {
    console.warn(`[RegenerateImage] Prompt metadata did not include original provider/model for ${originalIdentifier}; using current config fallback.`);
  }
  config.outputDir = outputDir;
  config.imageGen = {
    ...imageGenConfig,
    enabled: true,
    provider: original.provider || imageGenConfig.provider,
    model: original.provider === 'nano-banana' && original.model ? original.model : imageGenConfig.model,
    openaiImageModel: original.provider === 'dall-e' && original.model ? original.model : imageGenConfig.openaiImageModel,
    atlasCloudModel: original.provider === 'atlas-cloud' && original.model ? original.model : imageGenConfig.atlasCloudModel,
    stableDiffusion: original.provider === 'stable-diffusion' && original.model
      ? { ...imageGenConfig.stableDiffusion, defaultModel: original.model }
      : imageGenConfig.stableDiffusion,
  };

  const imageService = new ImageGenerationService({
    enabled: true,
    outputDirectory: outputDir,
    provider: config.imageGen.provider,
    geminiApiKey: config.imageGen.geminiApiKey || config.imageGen.apiKey,
    geminiModel: config.imageGen.model as any,
    openaiApiKey: config.imageGen.openaiApiKey || process.env.OPENAI_API_KEY,
    openaiImageModel: config.imageGen.openaiImageModel,
    openaiModeration: config.imageGen.openaiModeration,
    atlasCloudApiKey: process.env.ATLAS_CLOUD_API_KEY,
    atlasCloudModel: process.env.EXPO_PUBLIC_ATLAS_CLOUD_MODEL || process.env.ATLAS_CLOUD_MODEL,
    midapiToken: process.env.MIDAPI_TOKEN,
    useapiToken: process.env.USEAPI_TOKEN,
  });

  const modifiedPrompt = applyFeedbackToPrompt(promptPayload.prompt, payload.feedback);
  const newIdentifier = `${originalIdentifier}-rerender-${Date.now()}`;
  const restoredReferences = await restoreReferenceImages(payload.promptPath, originalIdentifier, promptPayload);

  const result = await imageService.generateImage(
    modifiedPrompt,
    newIdentifier,
    {
      ...(originalMetadata as any),
      type: ((originalMetadata?.type as string) || 'scene') as any,
      regeneration: Number((originalMetadata as any)?.regeneration || 0) + 1,
      regenerationSourceIdentifier: originalIdentifier,
      regenerationProvider: config.imageGen.provider,
      regenerationModel: original.model,
    },
    restoredReferences,
  );

  await fs.writeFile(payload.resultPath, JSON.stringify({
    success: !!result.imageUrl,
    newImageUrl: result.imageUrl,
    imagePath: result.imagePath,
    identifier: newIdentifier,
    provider: config.imageGen.provider,
    model: original.model,
    restoredReferenceCount: restoredReferences?.length || 0,
  }), 'utf8');
}

main().catch(async (error) => {
  const payloadPath = process.argv[2];
  const resultPath = payloadPath
    ? (() => {
        try {
          const payload = JSON.parse(require('fs').readFileSync(payloadPath, 'utf8')) as RegenerationPayload;
          return payload.resultPath;
        } catch {
          return null;
        }
      })()
    : null;
  if (resultPath) {
    await fs.writeFile(resultPath, JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), 'utf8');
  }
  process.exit(1);
});
