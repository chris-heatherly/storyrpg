#!/usr/bin/env npx ts-node
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from '../config';
import { ImageGenerationService } from '../services/imageGenerationService';
import type { ImagePrompt } from '../agents/ImageGenerator';

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

function toLocalPath(imageUrl: string): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('generated-stories/')) {
    return path.resolve(process.cwd(), imageUrl);
  }
  const generatedIdx = imageUrl.indexOf('/generated-stories/');
  if (generatedIdx >= 0) {
    return path.resolve(process.cwd(), imageUrl.slice(generatedIdx + 1));
  }
  return null;
}

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

async function readPromptPayload(promptPath?: string): Promise<{ prompt: ImagePrompt; metadata?: Record<string, unknown>; identifier?: string }> {
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
  };
}

async function readImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string } | null> {
  const localPath = toLocalPath(imageUrl);
  if (!localPath) return null;
  const file = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png';
  return {
    data: file.toString('base64'),
    mimeType,
  };
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) throw new Error('Missing payload path');
  const payloadRaw = await fs.readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw) as RegenerationPayload;

  const promptPayload = await readPromptPayload(payload.promptPath);
  const baseImage = await readImageAsBase64(payload.imageUrl);
  const originalMetadata = (payload.metadata || promptPayload.metadata || {}) as Record<string, unknown>;
  const originalIdentifier = payload.identifier || promptPayload.identifier || 'image';
  const outputDir = payload.promptPath ? path.resolve(path.dirname(payload.promptPath), '..') : path.resolve(process.cwd(), 'generated-stories');

  const config = loadConfig();
  config.outputDir = outputDir;
  config.imageGen = {
    ...config.imageGen,
    enabled: true,
  };

  const imageService = new ImageGenerationService({
    enabled: true,
    outputDirectory: outputDir,
    provider: config.imageGen.provider,
    geminiApiKey: config.imageGen.geminiApiKey || config.imageGen.apiKey,
    geminiModel: config.imageGen.model as any,
    openaiApiKey: config.imageGen.openaiApiKey || process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY,
    openaiImageModel: config.imageGen.openaiImageModel,
    openaiModeration: config.imageGen.openaiModeration,
    atlasCloudApiKey: process.env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY,
    atlasCloudModel: process.env.EXPO_PUBLIC_ATLAS_CLOUD_MODEL || process.env.ATLAS_CLOUD_MODEL,
    midapiToken: process.env.EXPO_PUBLIC_MIDAPI_TOKEN || process.env.MIDAPI_TOKEN,
    useapiToken: process.env.EXPO_PUBLIC_USEAPI_TOKEN || process.env.USEAPI_TOKEN,
  });

  const modifiedPrompt = applyFeedbackToPrompt(promptPayload.prompt, payload.feedback);
  const newIdentifier = `${originalIdentifier}-rerender-${Date.now()}`;

  const result = (
    config.imageGen.provider === 'nano-banana' && baseImage
      ? await imageService.editImage(baseImage, modifiedPrompt, newIdentifier)
      : await imageService.generateImage(
          modifiedPrompt,
          newIdentifier,
          {
            ...(originalMetadata as any),
            type: ((originalMetadata?.type as string) || 'scene') as any,
            regeneration: Number((originalMetadata as any)?.regeneration || 0) + 1,
          },
        )
  );

  await fs.writeFile(payload.resultPath, JSON.stringify({
    success: !!result.imageUrl,
    newImageUrl: result.imageUrl,
    imagePath: result.imagePath,
    identifier: newIdentifier,
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
