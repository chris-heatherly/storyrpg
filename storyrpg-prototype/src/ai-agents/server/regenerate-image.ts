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
  };
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

function applyFeedbackToPrompt(prompt: ImagePrompt, notes?: string): ImagePrompt {
  if (!notes?.trim()) return prompt;
  const improvementBlock = `\n\nUSER REQUESTED FIXES:\n- ${notes.trim()}\nKeep the core story moment and composition intent, but address the issues above.`;
  return {
    ...prompt,
    prompt: `${prompt.prompt || ''}${improvementBlock}`.trim(),
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
    geminiApiKey: config.imageGen.apiKey,
    geminiModel: config.imageGen.model as any,
    atlasCloudApiKey: process.env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY,
    atlasCloudModel: process.env.EXPO_PUBLIC_ATLAS_CLOUD_MODEL || process.env.ATLAS_CLOUD_MODEL,
    midapiToken: process.env.EXPO_PUBLIC_MIDAPI_TOKEN || process.env.MIDAPI_TOKEN,
    useapiToken: process.env.EXPO_PUBLIC_USEAPI_TOKEN || process.env.USEAPI_TOKEN,
  });

  const modifiedPrompt = applyFeedbackToPrompt(promptPayload.prompt, payload.feedback?.notes);
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
