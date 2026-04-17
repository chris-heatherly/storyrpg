// @ts-nocheck — TODO(tech-debt): Phase 4 client/pipeline decoupling will split
// this writer and address expo-file-system API drift.
/**
 * Pipeline Output Writer
 *
 * Saves all agent outputs to files for debugging, review, and reuse.
 * Creates a structured output directory for each generation run.
 */

import { Story } from '../../types';
import { ComprehensiveValidationReport } from '../../types/validation';
import { WorldBible } from '../agents/WorldBuilder';
import { CharacterBible } from '../agents/CharacterDesigner';
import { EpisodeBlueprint } from '../agents/StoryArchitect';
import { SceneContent } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { QAReport } from '../agents/QAAgents';
import { EncounterStructure } from '../agents/EncounterArchitect';
import type { EncounterTelemetry } from '../agents/EncounterArchitect';
import type { SceneValidationResult } from '../validators/IncrementalValidators';
import type { LlmLedger } from './pipelineTelemetry';
import type { BranchShadowDiff } from './branchShadowDiff';
import { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import type { 
  ColorScript,
  GeneratedReferenceSheet,
  GeneratedExpressionSheet,
  VisualPlan
} from '../agents/image-team/ImageAgentTeam';
import type {
  CharacterExpressionSheet,
  CharacterBodyVocabulary,
  CharacterSilhouetteProfile
} from '../agents/image-team/CharacterReferenceSheetAgent';

// Import expo-file-system module
import * as ExpoFileSystem from 'expo-file-system';
import { getRuntimeOs, isWebRuntime } from '../../utils/runtimeEnv';
import { PROXY_CONFIG } from '../../config/endpoints';
import {
  cacheWebOutputFile,
  deleteCachedOutputDirectory,
  getCachedOutputsForDownload,
  listCachedOutputManifests,
  readCachedOutputFile,
} from './webOutputCache';

export interface AgentWorkingFile {
  agentName: string;
  timestamp: string;
  input: unknown;
  rawResponse?: string;
  processedOutput?: unknown;
  executionTime?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  errors?: string[];
  retryCount?: number;
}

/**
 * Character visual reference bundle - all visual metadata for a character
 */
export interface CharacterVisualReference {
  characterId: string;
  characterName: string;
  poseSheet?: GeneratedReferenceSheet;
  expressionSheet?: CharacterExpressionSheet;
  generatedExpressionSheet?: GeneratedExpressionSheet;
  bodyVocabulary?: CharacterBodyVocabulary;
  silhouetteProfile?: CharacterSilhouetteProfile;
}

/**
 * Visual planning outputs from the image pipeline
 */
export interface VisualPlanningOutputs {
  colorScript?: ColorScript;
  characterReferences: CharacterVisualReference[];
  visualPlans: VisualPlan[];
}

export interface VideoGenerationDiagnostic {
  timestamp: string;
  sceneId?: string;
  beatId?: string;
  imageKey?: string;
  identifier?: string;
  sourceImageUrl?: string;
  stage: 'selection' | 'direction' | 'image_load' | 'veo_generation';
  status: 'completed' | 'failed' | 'skipped';
  message: string;
  attempts?: number;
  model?: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  videoPath?: string;
  videoUrl?: string;
}

export interface AudioGenerationDiagnostic {
  timestamp: string;
  stage: 'gate' | 'voice_cast' | 'batch_generation' | 'binding';
  status: 'completed' | 'failed' | 'skipped';
  message: string;
  beatId?: string;
  sceneId?: string;
  speaker?: string;
  audioUrl?: string;
  generated?: number;
  cached?: number;
  failed?: number;
  mapped?: number;
}

export interface EncounterImageRunDiagnostic {
  timestamp: string;
  identifier: string;
  baseIdentifier?: string;
  resolvedIdentifier?: string;
  provider: string;
  fallbackProvider?: string;
  slotFamily?: string;
  imageType?: string;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  tier?: string;
  status: string;
  errorClass?: string;
  providerFailureKind?: string;
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

export interface PipelineOutputs {
  brief: FullCreativeBrief;
  worldBible?: WorldBible;
  characterBible?: CharacterBible;
  episodeBlueprint?: EpisodeBlueprint;
  sceneContents?: SceneContent[];
  choiceSets?: ChoiceSet[];
  encounters?: EncounterStructure[];
  qaReport?: QAReport;
  /**
   * Raw per-scene results from the IncrementalValidators run. When present,
   * `savePipelineOutputs` writes an aggregated sidecar (`06b-incremental-aggregate.json`)
   * so QA vs incremental overlap is measurable from saved artifacts.
   * I1 from the determinism/LLM instrumentation plan.
   */
  incrementalValidationResults?: SceneValidationResult[];
  /**
   * Per-encounter telemetry (I2 instrumentation). When present,
   * `savePipelineOutputs` writes a sidecar (`06c-encounter-telemetry.json`)
   * capturing per-phase success, LLM call counts, and wall-clock times
   * for each encounter generated in the run.
   */
  encounterTelemetry?: EncounterTelemetry[];
  /**
   * Run-level LLM call ledger (I4 instrumentation). When present,
   * `savePipelineOutputs` writes a sidecar (`09-llm-ledger.json`) summarising
   * per-agent call counts, token usage, and wall-clock time so future
   * rebalance decisions can be grounded in measured cost rather than guesses.
   */
  llmLedger?: LlmLedger;
  /**
   * Per-episode branch shadow diffs (I5 instrumentation). Only populated
   * when `config.generation.branchShadowModeEnabled` is true. When present,
   * `savePipelineOutputs` writes a sidecar (`06d-branch-shadow-diff.json`)
   * so the LLM-vs-deterministic branch analysis overlap is measurable.
   */
  branchShadowDiffs?: Array<{ episodeId: string; diff: BranchShadowDiff }>;
  bestPracticesReport?: ComprehensiveValidationReport;
  finalStory?: Story;
  // Visual planning assets
  visualPlanning?: VisualPlanningOutputs;
  // Video generation stats
  videoClipsGenerated?: number;
  videoDiagnostics?: VideoGenerationDiagnostic[];
  audioDiagnostics?: AudioGenerationDiagnostic[];
  encounterImageDiagnostics?: EncounterImageRunDiagnostic[];
  // Agent working files
  agentWorkingFiles?: AgentWorkingFile[];
  checkpoints?: Array<{
    phase: string;
    timestamp: string;
    data: unknown;
    requiresApproval: boolean;
  }>;
}

export interface OutputManifest {
  storyTitle: string;
  storyId: string;
  generatedAt: string;
  duration?: number;
  files: {
    name: string;
    path: string;
    type: string;
    size: number;
  }[];
  summary: {
    worldLocations: number;
    worldFactions: number;
    characters: number;
    scenes: number;
    choices: number;
    qaScore?: number;
    validationScore?: number;
    validationPassed?: boolean;
    // Visual planning stats
    hasColorScript?: boolean;
    characterReferencesCount?: number;
    visualPlansCount?: number;
    // Video generation stats
    videoClipsGenerated?: number;
    videoClipsFailed?: number;
    videoClipsAttempted?: number;
    videoDiagnosticsCount?: number;
    audioDiagnosticsCount?: number;
  };
}

// Base directory for pipeline outputs
const getOutputBaseDir = (): string => {
  const runtime = getRuntimeOs();
  if (runtime === 'web' || runtime === 'node') {
    return 'generated-stories/';
  }
  return (ExpoFileSystem.documentDirectory || '') + 'generated-stories/';
};

/**
 * Generate a slug from a title for use in filenames
 */
export function slugify(text: string): string {
  return (text || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50); // Limit length for filesystem
}

/**
 * Generate a timestamp string for folder names
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

/**
 * Ensure the output directory exists
 */
export async function ensureDirectory(path: string): Promise<void> {
  if (isWebRuntime()) {
    // On web, we'll handle this differently (download or IndexedDB)
    return;
  }

  const info = await ExpoFileSystem.getInfoAsync(path);
  if (!info.exists) {
    await ExpoFileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

function getFileExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64: match[2],
  };
}

async function writeBinaryFile(path: string, base64Data: string): Promise<void> {
  if (isWebRuntime()) {
    const response = await fetch(PROXY_CONFIG.writeFile, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath: path,
        content: base64Data,
        isBase64: true,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to write binary file: ${response.status}`);
    }
    return;
  }

  await ExpoFileSystem.writeAsStringAsync(path, base64Data, {
    encoding: ExpoFileSystem.EncodingType.Base64,
  });
}

async function persistInlineStoryMedia(storyPath: string, story: Story): Promise<Story> {
  const storyDir = storyPath.replace(/08-final-story\.json$/, '');
  const mediaDir = `${storyDir}embedded-media/`;
  let mediaIndex = 0;

  const persistImage = async (value: string | undefined, label: string): Promise<string | undefined> => {
    if (!value || !value.startsWith('data:image')) return value;
    const parsed = parseDataUrl(value);
    if (!parsed) return '';

    const ext = getFileExtensionForMimeType(parsed.mimeType);
    const fileName = `${label}-${mediaIndex++}.${ext}`;
    const filePath = `${mediaDir}${fileName}`;
    await writeBinaryFile(filePath, parsed.base64);
    return filePath;
  };

  const cleanedStory = JSON.parse(JSON.stringify(story)) as Story;
  cleanedStory.coverImage = (await persistImage(cleanedStory.coverImage, 'story-cover')) || '';

  for (const episode of cleanedStory.episodes || []) {
    episode.coverImage = (await persistImage(episode.coverImage, `episode-${episode.id}-cover`)) || '';
    for (const scene of episode.scenes || []) {
      const episodeSceneKey = `episode-${episode.number ?? episode.id}-${scene.id}`;
      scene.backgroundImage = await persistImage(scene.backgroundImage, `scene-${episodeSceneKey}-bg`);
      for (const beat of scene.beats || []) {
        beat.image = await persistImage(beat.image, `beat-${episodeSceneKey}-${beat.id}`);
      }
    }
  }

  return cleanedStory;
}

/**
 * Write a JSON file
 */
async function writeJsonFile(path: string, data: unknown): Promise<number> {
  // If this is the final story, we want to strip out the massive imageData base64 strings
  // but keep the imageUrls for the UI to load from the proxy server.
  let cleanData = data;
  if (path.endsWith('08-final-story.json') && typeof data === 'object' && data !== null) {
    try {
      const story = await persistInlineStoryMedia(path, data as Story);
      
      // Strip from episodes -> scenes -> beats -> images
      if (story.episodes) {
        for (const ep of story.episodes) {
          if (ep.coverImage) {
            // @ts-ignore - GeneratedImage structure
            if (typeof ep.coverImage === 'object') delete (ep.coverImage as any).imageData;
          }
          if (ep.scenes) {
            for (const scene of ep.scenes) {
              if (scene.backgroundImage) {
                // @ts-ignore
                if (typeof scene.backgroundImage === 'object') delete (scene.backgroundImage as any).imageData;
              }
              if (scene.beats) {
                for (const beat of scene.beats) {
                  if (beat.image) {
                    // @ts-ignore
                    if (typeof beat.image === 'object') delete (beat.image as any).imageData;
                  }
                  if (beat.encounterSequence && Array.isArray(beat.encounterSequence)) {
                    for (const img of beat.encounterSequence) {
                      if (typeof img === 'object') delete (img as any).imageData;
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // Strip from cover image
      if (story.coverImage && typeof story.coverImage === 'object') {
        delete (story.coverImage as any).imageData;
      }
      
      cleanData = story;
    } catch (e) {
      console.warn('[OutputWriter] Failed to clean final story data:', e);
    }
  }

  const content = JSON.stringify(cleanData, null, 2);

  if (isWebRuntime()) {
    // On web, attempt to write to local filesystem via proxy server
    let wroteViaProxy = false;
    try {
      const response = await fetch(PROXY_CONFIG.writeFile, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath: path,
          content: content,
        }),
      });

      if (!response.ok) {
        console.warn('[OutputWriter] Failed to write file via proxy:', path);
      } else {
        wroteViaProxy = true;
        console.log('[OutputWriter] Successfully wrote file via proxy:', path);
      }
    } catch (e) {
      console.warn('[OutputWriter] Proxy server not available for file writing:', path);
    }

    if (!wroteViaProxy) {
      const cached = cacheWebOutputFile(path, content);
      if (!cached) {
        console.warn('[OutputWriter] Web cache skipped oversized file:', path);
      }
    } else if (path.endsWith('manifest.json')) {
      cacheWebOutputFile(path, content);
    }
    return content.length;
  }

  await ExpoFileSystem.writeAsStringAsync(path, content, {
    encoding: 'utf8',
  });

  return content.length;
}

/**
 * Save a persistent error/diagnostic log to the output directory.
 * Called when the pipeline encounters errors that would otherwise be lost.
 */
export async function savePipelineErrorLog(
  outputDir: string,
  errors: Array<{
    timestamp: string;
    phase: string;
    message: string;
    stack?: string;
    episodeNumber?: number;
  }>
): Promise<void> {
  if (!outputDir || errors.length === 0) return;
  
  try {
    const errorLogPath = outputDir + '99-pipeline-errors.json';
    await writeJsonFile(errorLogPath, {
      generatedAt: new Date().toISOString(),
      errorCount: errors.length,
      errors,
    });
    console.log(`[OutputWriter] Saved ${errors.length} error(s) to ${errorLogPath}`);
  } catch (e) {
    console.warn('[OutputWriter] Failed to save error log:', e);
  }
}

export async function saveVideoDiagnosticsLog(
  outputDir: string,
  diagnostics: VideoGenerationDiagnostic[],
): Promise<{ path: string; size: number } | null> {
  if (!outputDir || diagnostics.length === 0) return null;

  try {
    const completed = diagnostics.filter(d => d.status === 'completed').length;
    const failed = diagnostics.filter(d => d.status === 'failed').length;
    const attempted = diagnostics.filter(d => d.stage === 'veo_generation').length;
    const diagnosticsPath = outputDir + '09-video-diagnostics.json';
    const size = await writeJsonFile(diagnosticsPath, {
      generatedAt: new Date().toISOString(),
      summary: {
        attempted,
        completed,
        failed,
        diagnosticsCount: diagnostics.length,
      },
      diagnostics,
    });
    return { path: diagnosticsPath, size };
  } catch (e) {
    console.warn('[OutputWriter] Failed to save video diagnostics log:', e);
    return null;
  }
}

export async function saveAudioDiagnosticsLog(
  outputDir: string,
  diagnostics: AudioGenerationDiagnostic[],
): Promise<{ path: string; size: number } | null> {
  if (!outputDir || diagnostics.length === 0) return null;

  try {
    const diagnosticsPath = outputDir + '10-audio-diagnostics.json';
    const size = await writeJsonFile(diagnosticsPath, {
      generatedAt: new Date().toISOString(),
      summary: {
        diagnosticsCount: diagnostics.length,
        completed: diagnostics.filter(d => d.status === 'completed').length,
        failed: diagnostics.filter(d => d.status === 'failed').length,
        skipped: diagnostics.filter(d => d.status === 'skipped').length,
      },
      diagnostics,
    });
    return { path: diagnosticsPath, size };
  } catch (e) {
    console.warn('[OutputWriter] Failed to save audio diagnostics log:', e);
    return null;
  }
}

export async function saveEncounterImageDiagnosticsLog(
  outputDir: string,
  diagnostics: EncounterImageRunDiagnostic[],
): Promise<{ path: string; size: number } | null> {
  if (!outputDir || diagnostics.length === 0) return null;

  try {
    const diagnosticsPath = outputDir + '08b-encounter-image-diagnostics.json';
    const size = await writeJsonFile(diagnosticsPath, {
      generatedAt: new Date().toISOString(),
      summary: {
        diagnosticsCount: diagnostics.length,
        completed: diagnostics.filter(d => d.status === 'success' || d.status === 'fallback_success' || d.status === 'resumed').length,
        failed: diagnostics.filter(d => d.status === 'failed' || d.status === 'preflight_failed').length,
        fallbackSuccesses: diagnostics.filter(d => d.status === 'fallback_success').length,
      },
      diagnostics,
    });
    return { path: diagnosticsPath, size };
  } catch (e) {
    console.warn('[OutputWriter] Failed to save encounter image diagnostics log:', e);
    return null;
  }
}

export async function updateOutputManifest(
  outputDir: string,
  update: {
    file?: { name: string; path: string; type: string; size: number };
    summary?: Record<string, unknown>;
  },
): Promise<void> {
  if (!outputDir || (!update.file && !update.summary)) return;

  const manifestPath = outputDir + 'manifest.json';

  try {
    let manifestRaw: string;
    if (isWebRuntime()) {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/${manifestPath}`);
      if (!response.ok) throw new Error(`Failed to read manifest: HTTP ${response.status}`);
      manifestRaw = await response.text();
    } else {
      manifestRaw = await ExpoFileSystem.readAsStringAsync(manifestPath);
    }

    const manifest = JSON.parse(manifestRaw) as OutputManifest;
    if (update.file && !manifest.files.some(file => file.path === update.file!.path)) {
      manifest.files.push(update.file);
    }
    if (update.summary) {
      manifest.summary = {
        ...manifest.summary,
        ...update.summary,
      };
    }

    const content = JSON.stringify(manifest, null, 2);
    if (isWebRuntime()) {
      await fetch(PROXY_CONFIG.writeFile, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: manifestPath,
          content,
          isBase64: false,
        }),
      });
    } else {
      await ExpoFileSystem.writeAsStringAsync(manifestPath, content);
    }
  } catch (e) {
    console.warn('[OutputWriter] Failed to update manifest:', e);
  }
}

/**
 * Create the output directory for a generation run
 */
export async function createOutputDirectory(storyTitle: string): Promise<string> {
  const slug = slugify(storyTitle);
  const timestamp = getTimestamp();
  const dirName = `${slug}_${timestamp}`;
  const dirPath = getOutputBaseDir() + dirName + '/';

  await ensureDirectory(dirPath);

  console.log(`[OutputWriter] Created output directory: ${dirPath}`);
  return dirPath;
}

/**
 * Save a diagnostic JSON artifact immediately (before the pipeline finishes).
 * Failures here never block the pipeline.
 */
export async function saveEarlyDiagnostic(
  outputDir: string,
  filename: string,
  data: unknown,
): Promise<void> {
  try {
    await ensureDirectory(outputDir);
    await writeJsonFile(outputDir + filename, data);
    console.log(`[OutputWriter] Saved early diagnostic: ${filename}`);
  } catch (e) {
    console.warn(`[OutputWriter] Failed to save diagnostic ${filename}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Persisted list of completed encounter slot base identifiers for resume across pipeline runs. */
export interface EncounterResumeStateV1 {
  version: 1;
  sceneId: string;
  scopedSceneId: string;
  completedBaseIdentifiers: string[];
  generatedAt: string;
}

export async function saveEncounterResumeState(
  outputDir: string,
  sceneSlug: string,
  state: EncounterResumeStateV1,
): Promise<void> {
  await saveEarlyDiagnostic(outputDir, `08a-encounter-resume-${sceneSlug}.json`, state);
}

export function loadEncounterResumeStateSync(outputDir: string, sceneSlug: string): EncounterResumeStateV1 | null {
  let nodeFs: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: BufferEncoding) => string } | undefined;
  try {
    const req = typeof eval !== 'undefined' ? eval('require') : undefined;
    if (typeof req === 'function') nodeFs = req('fs');
  } catch {
    /* non-Node */
  }
  if (!nodeFs?.existsSync || !nodeFs.readFileSync) return null;
  const path = `${outputDir}08a-encounter-resume-${sceneSlug}.json`;
  try {
    if (!nodeFs.existsSync(path)) return null;
    const raw = nodeFs.readFileSync(path, 'utf8');
    const j = JSON.parse(raw) as Partial<EncounterResumeStateV1>;
    if (j.version !== 1 || !Array.isArray(j.completedBaseIdentifiers)) return null;
    return j as EncounterResumeStateV1;
  } catch {
    return null;
  }
}

/** Persisted list of completed beat image identifiers for resume across pipeline runs. */
export interface BeatResumeStateV1 {
  version: 1;
  sceneId: string;
  scopedSceneId: string;
  completedIdentifiers: string[];
  beatImageMap: Record<string, string>;
  generatedAt: string;
}

export async function saveBeatResumeState(
  outputDir: string,
  sceneSlug: string,
  state: BeatResumeStateV1,
): Promise<void> {
  await saveEarlyDiagnostic(outputDir, `08a-beat-resume-${sceneSlug}.json`, state);
}

export function loadBeatResumeStateSync(outputDir: string, sceneSlug: string): BeatResumeStateV1 | null {
  let nodeFs: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: BufferEncoding) => string } | undefined;
  try {
    const req = typeof eval !== 'undefined' ? eval('require') : undefined;
    if (typeof req === 'function') nodeFs = req('fs');
  } catch {
    /* non-Node */
  }
  if (!nodeFs?.existsSync || !nodeFs.readFileSync) return null;
  const path = `${outputDir}08a-beat-resume-${sceneSlug}.json`;
  try {
    if (!nodeFs.existsSync(path)) return null;
    const raw = nodeFs.readFileSync(path, 'utf8');
    const j = JSON.parse(raw) as Partial<BeatResumeStateV1>;
    if (j.version !== 1 || !Array.isArray(j.completedIdentifiers)) return null;
    return j as BeatResumeStateV1;
  } catch {
    return null;
  }
}

/**
 * Save all pipeline outputs to files
 */
export async function savePipelineOutputs(
  outputDir: string,
  outputs: PipelineOutputs,
  duration?: number
): Promise<OutputManifest> {
  const files: OutputManifest['files'] = [];
  const storyTitle = outputs.brief.story.title;
  const storyId = slugify(storyTitle);

  console.log(`[OutputWriter] Saving pipeline outputs for "${storyTitle}"...`);

  // 1. Save the input brief
  const briefPath = outputDir + '00-input-brief.json';
  const briefSize = await writeJsonFile(briefPath, outputs.brief);
  files.push({ name: 'Input Brief', path: briefPath, type: 'brief', size: briefSize });

  // 2. Save World Bible
  if (outputs.worldBible) {
    const worldPath = outputDir + '01-world-bible.json';
    const worldSize = await writeJsonFile(worldPath, outputs.worldBible);
    files.push({ name: 'World Bible', path: worldPath, type: 'world', size: worldSize });
  }

  // 3. Save Character Bible
  if (outputs.characterBible) {
    const charPath = outputDir + '02-character-bible.json';
    const charSize = await writeJsonFile(charPath, outputs.characterBible);
    files.push({ name: 'Character Bible', path: charPath, type: 'characters', size: charSize });
  }

  // 4. Save Episode Blueprint
  if (outputs.episodeBlueprint) {
    const blueprintPath = outputDir + '03-episode-blueprint.json';
    const blueprintSize = await writeJsonFile(blueprintPath, outputs.episodeBlueprint);
    files.push({ name: 'Episode Blueprint', path: blueprintPath, type: 'blueprint', size: blueprintSize });
  }

  // 5. Save Scene Contents
  if (outputs.sceneContents && outputs.sceneContents.length > 0) {
    const scenesPath = outputDir + '04-scene-contents.json';
    const scenesSize = await writeJsonFile(scenesPath, outputs.sceneContents);
    files.push({ name: 'Scene Contents', path: scenesPath, type: 'scenes', size: scenesSize });

    // Also save individual scenes for easier review
    for (let i = 0; i < outputs.sceneContents.length; i++) {
      const scene = outputs.sceneContents[i];
      const scenePath = outputDir + `04-scene-${String(i + 1).padStart(2, '0')}-${slugify(scene.sceneName)}.json`;
      const sceneSize = await writeJsonFile(scenePath, scene);
      files.push({ name: `Scene: ${scene.sceneName}`, path: scenePath, type: 'scene', size: sceneSize });
    }
  }

  // 6. Save Choice Sets
  if (outputs.choiceSets && outputs.choiceSets.length > 0) {
    const choicesPath = outputDir + '05-choice-sets.json';
    const choicesSize = await writeJsonFile(choicesPath, outputs.choiceSets);
    files.push({ name: 'Choice Sets', path: choicesPath, type: 'choices', size: choicesSize });
  }

  // 6b. Save Encounters
  if (outputs.encounters && outputs.encounters.length > 0) {
    const encountersPath = outputDir + '05b-encounters.json';
    const encountersSize = await writeJsonFile(encountersPath, outputs.encounters);
    files.push({ name: 'Encounters', path: encountersPath, type: 'encounters', size: encountersSize });

    // Also save individual encounters for easier review
    for (let i = 0; i < outputs.encounters.length; i++) {
      const encounter = outputs.encounters[i];
      const encounterPath = outputDir + `05b-encounter-${String(i + 1).padStart(2, '0')}-${slugify(encounter.sceneId)}.json`;
      const encounterSize = await writeJsonFile(encounterPath, encounter);
      files.push({ name: `Encounter: ${encounter.sceneId}`, path: encounterPath, type: 'encounter', size: encounterSize });

      // Save storylets separately if they exist
      if (encounter.storylets) {
        const storyletsPath = outputDir + `05b-encounter-${String(i + 1).padStart(2, '0')}-storylets.json`;
        const storyletsSize = await writeJsonFile(storyletsPath, encounter.storylets);
        files.push({ name: `Storylets: ${encounter.sceneId}`, path: storyletsPath, type: 'storylets', size: storyletsSize });
      }
    }
  }

  // 7. Save QA Report
  if (outputs.qaReport) {
    const qaPath = outputDir + '06-qa-report.json';
    const qaSize = await writeJsonFile(qaPath, outputs.qaReport);
    files.push({ name: 'QA Report', path: qaPath, type: 'qa', size: qaSize });
  }

  // 7b. Save IncrementalValidators aggregate (for I1 instrumentation).
  //
  // This sidecar lets us measure overlap between what the incremental
  // validators caught during generation and what end-of-pipeline QA
  // surfaces. It is written whenever incremental validation actually ran
  // (i.e. we have at least one SceneValidationResult).
  if (outputs.incrementalValidationResults && outputs.incrementalValidationResults.length > 0) {
    const rawResults = outputs.incrementalValidationResults;
    const totalIssues = { voice: 0, stakes: 0, sensitivity: 0, continuity: 0, encounter: 0 };
    const regenerationRequests = { scene: 0, choices: 0, encounter: 0, none: 0 };
    let passedScenes = 0;
    let failedScenes = 0;
    let totalValidationMs = 0;

    for (const r of rawResults) {
      totalIssues.voice += r.voice?.issues?.length ?? 0;
      totalIssues.stakes += r.stakes?.issues?.length ?? 0;
      totalIssues.sensitivity += r.sensitivity?.issues?.length ?? 0;
      totalIssues.continuity += r.continuity?.issues?.length ?? 0;
      totalIssues.encounter += r.encounter?.issues?.length ?? 0;
      if (r.overallPassed) passedScenes++; else failedScenes++;
      if (r.regenerationRequested === 'scene') regenerationRequests.scene++;
      else if (r.regenerationRequested === 'choices') regenerationRequests.choices++;
      else if (r.regenerationRequested === 'encounter') regenerationRequests.encounter++;
      else regenerationRequests.none++;
      totalValidationMs += r.validationTimeMs ?? 0;
    }

    const aggregate = {
      generatedAt: new Date().toISOString(),
      totalScenes: rawResults.length,
      passedScenes,
      failedScenes,
      totalIssues,
      regenerationRequests,
      averageValidationTimeMs: rawResults.length > 0
        ? Math.round(totalValidationMs / rawResults.length)
        : 0,
      perScene: rawResults.map(r => ({
        sceneId: r.sceneId,
        sceneName: r.sceneName,
        overallPassed: r.overallPassed,
        regenerationRequested: r.regenerationRequested,
        validationTimeMs: r.validationTimeMs,
        counts: {
          voice: r.voice?.issues?.length ?? 0,
          stakes: r.stakes?.issues?.length ?? 0,
          sensitivity: r.sensitivity?.issues?.length ?? 0,
          continuity: r.continuity?.issues?.length ?? 0,
          encounter: r.encounter?.issues?.length ?? 0,
        },
        issues: {
          voice: r.voice?.issues ?? [],
          stakes: r.stakes?.issues ?? [],
          sensitivity: r.sensitivity?.issues ?? [],
          continuity: r.continuity?.issues ?? [],
          encounter: r.encounter?.issues ?? [],
        },
      })),
    };

    const aggregatePath = outputDir + '06b-incremental-aggregate.json';
    const aggregateSize = await writeJsonFile(aggregatePath, aggregate);
    files.push({
      name: 'Incremental Validation Aggregate',
      path: aggregatePath,
      type: 'incremental-aggregate',
      size: aggregateSize,
    });
  }

  // 7c. Save per-encounter telemetry (I2 instrumentation).
  if (outputs.encounterTelemetry && outputs.encounterTelemetry.length > 0) {
    const telemetry = outputs.encounterTelemetry;
    const modeCounts: Record<string, number> = {};
    let totalLlmCalls = 0;
    let totalMs = 0;
    let phase4FailCount = 0;
    let phase3RanCount = 0;
    for (const t of telemetry) {
      modeCounts[t.mode] = (modeCounts[t.mode] ?? 0) + 1;
      totalLlmCalls += t.llmCallCount ?? 0;
      totalMs += t.msElapsed ?? 0;
      if (!t.phase4Ok) phase4FailCount++;
      if (t.phase3Ran) phase3RanCount++;
    }
    const telemetryDoc = {
      generatedAt: new Date().toISOString(),
      totalEncounters: telemetry.length,
      modeCounts,
      phase3RanCount,
      phase4FailCount,
      totalLlmCalls,
      totalMs,
      averageMs: telemetry.length > 0 ? Math.round(totalMs / telemetry.length) : 0,
      encounters: telemetry,
    };
    const telemetryPath = outputDir + '06c-encounter-telemetry.json';
    const telemetrySize = await writeJsonFile(telemetryPath, telemetryDoc);
    files.push({
      name: 'Encounter Telemetry',
      path: telemetryPath,
      type: 'encounter-telemetry',
      size: telemetrySize,
    });
  }

  // 7d. Save branch shadow diffs (I5 instrumentation).
  //
  // Off by default; only written when shadow mode was enabled in config.
  // Each episode contributes one diff entry. Aggregated totals are
  // recomputed here from the per-episode diffs so consumers don't have to.
  if (outputs.branchShadowDiffs && outputs.branchShadowDiffs.length > 0) {
    const perEpisode = outputs.branchShadowDiffs;
    const totals = perEpisode.reduce(
      (acc, { diff }) => {
        acc.agreed += diff.agreedScenes.length;
        acc.llmOnly += diff.llmOnlyScenes.length;
        acc.deterministicOnly += diff.deterministicOnlyScenes.length;
        acc.llmValidationIssues += diff.counts.llmValidationIssues;
        acc.deterministicUnreachable += diff.counts.deterministicUnreachable;
        acc.deterministicDeadEnds += diff.counts.deterministicDeadEnds;
        acc.deterministicReconvergence += diff.counts.deterministicReconvergence;
        return acc;
      },
      {
        agreed: 0,
        llmOnly: 0,
        deterministicOnly: 0,
        llmValidationIssues: 0,
        deterministicUnreachable: 0,
        deterministicDeadEnds: 0,
        deterministicReconvergence: 0,
      },
    );
    const shadowDoc = {
      generatedAt: new Date().toISOString(),
      episodeCount: perEpisode.length,
      totals,
      episodes: perEpisode,
    };
    const shadowPath = outputDir + '06d-branch-shadow-diff.json';
    const shadowSize = await writeJsonFile(shadowPath, shadowDoc);
    files.push({
      name: 'Branch Shadow Diff',
      path: shadowPath,
      type: 'branch-shadow-diff',
      size: shadowSize,
    });
  }

  // 7e. Save LLM ledger (I4 instrumentation).
  //
  // Run-level aggregation of every LLM call observed via BaseAgent's
  // observer. Token totals are populated from anthropic + gemini transports;
  // `totals.usageReported` surfaces how many calls actually reported usage so
  // gaps (e.g. openai, error paths) remain visible instead of silently
  // counting as zero tokens.
  if (outputs.llmLedger) {
    const ledgerDoc = {
      generatedAt: new Date().toISOString(),
      ...outputs.llmLedger,
    };
    const ledgerPath = outputDir + '09-llm-ledger.json';
    const ledgerSize = await writeJsonFile(ledgerPath, ledgerDoc);
    files.push({
      name: 'LLM Call Ledger',
      path: ledgerPath,
      type: 'llm-ledger',
      size: ledgerSize,
    });
  }

  // 8. Save Best Practices Validation Metrics
  if (outputs.bestPracticesReport) {
    const validationPath = outputDir + '07-validation-metrics.json';
    const validationSize = await writeJsonFile(validationPath, {
      overallPassed: outputs.bestPracticesReport.overallPassed,
      overallScore: outputs.bestPracticesReport.overallScore,
      metrics: outputs.bestPracticesReport.metrics,
      issuesSummary: {
        blocking: outputs.bestPracticesReport.blockingIssues.length,
        warnings: outputs.bestPracticesReport.warnings.length,
        suggestions: outputs.bestPracticesReport.suggestions.length,
      },
      blockingIssues: outputs.bestPracticesReport.blockingIssues,
      warnings: outputs.bestPracticesReport.warnings,
      suggestions: outputs.bestPracticesReport.suggestions,
      timestamp: outputs.bestPracticesReport.timestamp,
      validationDuration: outputs.bestPracticesReport.duration,
    });
    files.push({ name: 'Validation Metrics', path: validationPath, type: 'validation', size: validationSize });
  }

  // 9. Save Final Story
  if (outputs.finalStory) {
    const storyPath = outputDir + '08-final-story.json';
    const storySize = await writeJsonFile(storyPath, outputs.finalStory);
    files.push({ name: 'Final Story', path: storyPath, type: 'story', size: storySize });
    
    // 9b. Save beat images as separate files
    if (!isWebRuntime()) {
      const beatImagesDir = outputDir + 'beat-images/';
      await ensureDirectory(beatImagesDir);
      
      let beatImageCount = 0;
      
      // Extract and save images from the story
      if (outputs.finalStory.episodes) {
        for (const episode of outputs.finalStory.episodes) {
          if (episode.scenes) {
            for (const scene of episode.scenes) {
              const episodeSceneKey = `episode-${episode.number ?? episode.id}-${scene.id || 'unknown'}`;
              // Save scene background image
              if (scene.backgroundImage && typeof scene.backgroundImage === 'object') {
                const bgImage = scene.backgroundImage as any;
                if (bgImage.imageData && bgImage.mimeType) {
                  const ext = bgImage.mimeType.includes('png') ? 'png' : 'jpg';
                  const imagePath = beatImagesDir + `scene-${episodeSceneKey}-bg.${ext}`;
                  try {
                    await ExpoFileSystem.writeAsStringAsync(imagePath, bgImage.imageData, {
                      encoding: ExpoFileSystem.EncodingType.Base64
                    });
                    beatImageCount++;
                    files.push({
                      name: `Scene ${scene.id} - Background`,
                      path: imagePath,
                      type: 'scene_image',
                      size: bgImage.imageData.length
                    });
                  } catch (imgErr) {
                    console.warn(`[OutputWriter] Failed to save scene background:`, imgErr);
                  }
                }
              }
              
              // Save beat images
              if (scene.beats) {
                for (const beat of scene.beats) {
                  if (beat.image && typeof beat.image === 'object') {
                    const beatImage = beat.image as any;
                    if (beatImage.imageData && beatImage.mimeType) {
                      const ext = beatImage.mimeType.includes('png') ? 'png' : 'jpg';
                      const imagePath = beatImagesDir + `beat-${episodeSceneKey}-${beat.id || 'unknown'}.${ext}`;
                      try {
                        await ExpoFileSystem.writeAsStringAsync(imagePath, beatImage.imageData, {
                          encoding: ExpoFileSystem.EncodingType.Base64
                        });
                        beatImageCount++;
                        files.push({
                          name: `Beat ${beat.id}`,
                          path: imagePath,
                          type: 'beat_image',
                          size: beatImage.imageData.length
                        });
                      } catch (imgErr) {
                        console.warn(`[OutputWriter] Failed to save beat image:`, imgErr);
                      }
                    }
                  }
                  
                  // Save encounter sequence images
                  if (beat.encounterSequence && Array.isArray(beat.encounterSequence)) {
                    for (let i = 0; i < beat.encounterSequence.length; i++) {
                      const encounterImg = beat.encounterSequence[i] as any;
                      if (encounterImg && encounterImg.imageData && encounterImg.mimeType) {
                        const ext = encounterImg.mimeType.includes('png') ? 'png' : 'jpg';
                        const imagePath = beatImagesDir + `beat-${episodeSceneKey}-${beat.id}-encounter-${i}.${ext}`;
                        try {
                          await ExpoFileSystem.writeAsStringAsync(imagePath, encounterImg.imageData, {
                            encoding: ExpoFileSystem.EncodingType.Base64
                          });
                          beatImageCount++;
                          files.push({
                            name: `Beat ${beat.id} - Encounter ${i}`,
                            path: imagePath,
                            type: 'encounter_image',
                            size: encounterImg.imageData.length
                          });
                        } catch (imgErr) {
                          console.warn(`[OutputWriter] Failed to save encounter image:`, imgErr);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      if (beatImageCount > 0) {
        console.log(`[OutputWriter] Saved ${beatImageCount} beat/scene images`);
      }
    }
  }

  // 9c. Save video diagnostics
  if (outputs.videoDiagnostics?.length) {
    const savedVideoDiagnostics = await saveVideoDiagnosticsLog(outputDir, outputs.videoDiagnostics);
    if (savedVideoDiagnostics) {
      files.push({
        name: 'Video Diagnostics',
        path: savedVideoDiagnostics.path,
        type: 'video_diagnostics',
        size: savedVideoDiagnostics.size,
      });
    }
  }

  // 9d. Save audio diagnostics
  if (outputs.audioDiagnostics?.length) {
    const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDir, outputs.audioDiagnostics);
    if (savedAudioDiagnostics) {
      files.push({
        name: 'Audio Diagnostics',
        path: savedAudioDiagnostics.path,
        type: 'audio_diagnostics',
        size: savedAudioDiagnostics.size,
      });
    }
  }

  // 9e. Save encounter image diagnostics
  if (outputs.encounterImageDiagnostics?.length) {
    const savedEncounterDiagnostics = await saveEncounterImageDiagnosticsLog(outputDir, outputs.encounterImageDiagnostics);
    if (savedEncounterDiagnostics) {
      files.push({
        name: 'Encounter Image Diagnostics',
        path: savedEncounterDiagnostics.path,
        type: 'encounter_image_diagnostics',
        size: savedEncounterDiagnostics.size,
      });
    }
  }

  // 10. Save Visual Planning Assets
  if (outputs.visualPlanning) {
    const visualDir = outputDir + 'visual-planning/';
    await ensureDirectory(visualDir);

    // 10a. Save Color Script
    if (outputs.visualPlanning.colorScript) {
      const colorScriptPath = visualDir + '00-color-script.json';
      const colorScriptSize = await writeJsonFile(colorScriptPath, outputs.visualPlanning.colorScript);
      files.push({ name: 'Color Script', path: colorScriptPath, type: 'color_script', size: colorScriptSize });
    }

    // 10b. Save Character Visual References
    if (outputs.visualPlanning.characterReferences && outputs.visualPlanning.characterReferences.length > 0) {
      const charRefDir = visualDir + 'character-references/';
      await ensureDirectory(charRefDir);

      for (const charRef of outputs.visualPlanning.characterReferences) {
        const charSlug = slugify(charRef.characterName);
        const charDir = charRefDir + charSlug + '/';
        await ensureDirectory(charDir);

        // Save pose sheet (without base64 image data, just prompts and metadata)
        if (charRef.poseSheet) {
          // FIRST: Save the actual pose images
          if (charRef.poseSheet.generatedImages && charRef.poseSheet.generatedImages.size > 0) {
            const poseImagesDir = charDir + 'pose-images/';
            await ensureDirectory(poseImagesDir);
            
            let poseImageCount = 0;
            const poseImagePaths: Record<string, string> = {};
            
            // Use forEach since it's a Map
            const poseEntries: [string, any][] = [];
            charRef.poseSheet.generatedImages.forEach((image, viewType) => {
              poseEntries.push([viewType, image]);
            });
            
            for (const [viewType, image] of poseEntries) {
              if (image.imageData && image.mimeType) {
                const ext = image.mimeType.includes('png') ? 'png' : 
                           image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
                const imagePath = poseImagesDir + `${viewType}.${ext}`;
                
                try {
                  if (isWebRuntime()) {
                    console.log(`[OutputWriter] Skipping pose image save on web: ${imagePath}`);
                  } else {
                    await ExpoFileSystem.writeAsStringAsync(imagePath, image.imageData, {
                      encoding: ExpoFileSystem.EncodingType.Base64
                    });
                    poseImageCount++;
                    poseImagePaths[viewType] = `pose-images/${viewType}.${ext}`;
                    files.push({ 
                      name: `${charRef.characterName} - ${viewType} pose`, 
                      path: imagePath, 
                      type: 'pose_image', 
                      size: image.imageData.length 
                    });
                  }
                } catch (imgError) {
                  console.warn(`[OutputWriter] Failed to save pose image ${viewType}:`, imgError);
                }
              }
            }
            
            console.log(`[OutputWriter] Saved ${poseImageCount} pose images for ${charRef.characterName}`);
          }
          
          // THEN: Save the metadata (without base64 image data)
          const cleanPoseSheet = {
            ...charRef.poseSheet,
            generatedImages: charRef.poseSheet.generatedImages 
              ? Object.fromEntries(
                  Array.from(charRef.poseSheet.generatedImages.entries()).map(([key, value]) => [
                    key,
                    { ...value, imageData: undefined, imagePath: `pose-images/${key}.png` } // Remove base64, add path
                  ])
                )
              : undefined
          };
          const poseSheetPath = charDir + '01-pose-sheet.json';
          const poseSheetSize = await writeJsonFile(poseSheetPath, cleanPoseSheet);
          files.push({ 
            name: `${charRef.characterName} - Pose Sheet`, 
            path: poseSheetPath, 
            type: 'pose_sheet', 
            size: poseSheetSize 
          });
        }

        // Save expression sheet (prompts/metadata)
        if (charRef.expressionSheet) {
          const exprSheetPath = charDir + '02-expression-sheet.json';
          const exprSheetSize = await writeJsonFile(exprSheetPath, charRef.expressionSheet);
          files.push({ 
            name: `${charRef.characterName} - Expression Sheet`, 
            path: exprSheetPath, 
            type: 'expression_sheet', 
            size: exprSheetSize 
          });
        }

        // Save generated expression images
        if (charRef.generatedExpressionSheet && charRef.generatedExpressionSheet.generatedImages) {
          const exprImagesDir = charDir + 'expression-images/';
          await ensureDirectory(exprImagesDir);
          
          // Convert Map to array for iteration (generatedImages is Map<string, GeneratedImage>)
          const expressionImages = charRef.generatedExpressionSheet.generatedImages;
          let exprImageCount = 0;
          
          // Use forEach since it's a Map
          const imageEntries: [string, any][] = [];
          expressionImages.forEach((image, expressionName) => {
            imageEntries.push([expressionName, image]);
          });
          
          for (const [expressionName, image] of imageEntries) {
            if (image.imageData && image.mimeType) {
              // Determine file extension from mimeType
              const ext = image.mimeType.includes('png') ? 'png' : 
                         image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
              const imagePath = exprImagesDir + `${expressionName}.${ext}`;
              
              try {
                // Write base64 image data to file
                if (isWebRuntime()) {
                  // For web, we'd need a different approach - skip for now
                  console.log(`[OutputWriter] Skipping expression image save on web: ${imagePath}`);
                } else {
                  await ExpoFileSystem.writeAsStringAsync(imagePath, image.imageData, {
                    encoding: ExpoFileSystem.EncodingType.Base64
                  });
                  exprImageCount++;
                  files.push({ 
                    name: `${charRef.characterName} - ${expressionName}`, 
                    path: imagePath, 
                    type: 'expression_image', 
                    size: image.imageData.length 
                  });
                }
              } catch (imgError) {
                console.error(`[OutputWriter] Failed to save expression image ${expressionName}:`, imgError);
              }
            }
          }
          
          // Also save the generated expression sheet metadata (without image data for smaller file)
          const cleanExprSheet = {
            characterId: charRef.generatedExpressionSheet.characterId,
            characterName: charRef.generatedExpressionSheet.characterName,
            expressionTier: charRef.generatedExpressionSheet.expressionTier,
            expressionNotes: charRef.generatedExpressionSheet.expressionNotes,
            personalityInfluence: charRef.generatedExpressionSheet.personalityInfluence,
            expressions: charRef.generatedExpressionSheet.expressions.map(e => ({
              expressionName: e.expressionName,
              prompt: e.prompt,
              imagePath: e.generatedImage?.imagePath || `expression-images/${e.expressionName}.png`,
              hasImage: !!e.generatedImage?.imageData
            })),
            generatedImageCount: exprImageCount
          };
          
          const genExprPath = charDir + '02b-generated-expressions.json';
          const genExprSize = await writeJsonFile(genExprPath, cleanExprSheet);
          files.push({ 
            name: `${charRef.characterName} - Generated Expressions Metadata`, 
            path: genExprPath, 
            type: 'generated_expressions', 
            size: genExprSize 
          });
          
          console.log(`[OutputWriter] Saved ${exprImageCount} expression images for ${charRef.characterName}`);
        }

        // Save body vocabulary
        if (charRef.bodyVocabulary) {
          const bodyVocabPath = charDir + '03-body-vocabulary.json';
          const bodyVocabSize = await writeJsonFile(bodyVocabPath, charRef.bodyVocabulary);
          files.push({ 
            name: `${charRef.characterName} - Body Vocabulary`, 
            path: bodyVocabPath, 
            type: 'body_vocabulary', 
            size: bodyVocabSize 
          });
        }

        // Save silhouette profile
        if (charRef.silhouetteProfile) {
          const silhouettePath = charDir + '04-silhouette-profile.json';
          const silhouetteSize = await writeJsonFile(silhouettePath, charRef.silhouetteProfile);
          files.push({ 
            name: `${charRef.characterName} - Silhouette Profile`, 
            path: silhouettePath, 
            type: 'silhouette_profile', 
            size: silhouetteSize 
          });
        }

        // Save combined character reference summary
        const charSummaryPath = charDir + '00-character-visual-summary.json';
        const charSummary = {
          characterId: charRef.characterId,
          characterName: charRef.characterName,
          hasPoseSheet: !!charRef.poseSheet,
          poseViewCount: charRef.poseSheet?.views?.length || 0,
          hasExpressionSheet: !!charRef.expressionSheet,
          expressionCount: charRef.expressionSheet?.expressions?.length || 0,
          hasGeneratedExpressionImages: !!charRef.generatedExpressionSheet,
          generatedExpressionCount: charRef.generatedExpressionSheet?.generatedImages?.size || 0,
          hasBodyVocabulary: !!charRef.bodyVocabulary,
          hasSilhouetteProfile: !!charRef.silhouetteProfile,
          silhouetteHooks: charRef.silhouetteProfile?.silhouetteHooks || [],
          visualAnchors: charRef.poseSheet?.visualAnchors || {},
        };
        const charSummarySize = await writeJsonFile(charSummaryPath, charSummary);
        files.push({ 
          name: `${charRef.characterName} - Visual Summary`, 
          path: charSummaryPath, 
          type: 'character_visual_summary', 
          size: charSummarySize 
        });
      }
    }

    // 10c. Save Visual Plans (beat-by-beat visual storytelling specs)
    if (outputs.visualPlanning.visualPlans && outputs.visualPlanning.visualPlans.length > 0) {
      const plansDir = visualDir + 'visual-plans/';
      await ensureDirectory(plansDir);

      // Save all plans combined
      const allPlansPath = plansDir + '00-all-visual-plans.json';
      const allPlansSize = await writeJsonFile(allPlansPath, outputs.visualPlanning.visualPlans);
      files.push({ name: 'All Visual Plans', path: allPlansPath, type: 'visual_plans', size: allPlansSize });

      // Save individual scene plans
      for (let i = 0; i < outputs.visualPlanning.visualPlans.length; i++) {
        const plan = outputs.visualPlanning.visualPlans[i];
        const planSlug = slugify(plan.sceneId || `scene-${i + 1}`);
        const planPath = plansDir + `${String(i + 1).padStart(2, '0')}-${planSlug}.json`;
        const planSize = await writeJsonFile(planPath, plan);
        files.push({ 
          name: `Visual Plan: ${plan.sceneId || `Scene ${i + 1}`}`, 
          path: planPath, 
          type: 'visual_plan', 
          size: planSize 
        });
      }
    }

    console.log(`[OutputWriter] Saved visual planning assets: ${
      (outputs.visualPlanning.colorScript ? '1 color script, ' : '') +
      `${outputs.visualPlanning.characterReferences?.length || 0} character refs, ` +
      `${outputs.visualPlanning.visualPlans?.length || 0} visual plans`
    }`);
  }

  // 11. Save Agent Working Files
  if (outputs.agentWorkingFiles && outputs.agentWorkingFiles.length > 0) {
    const agentsDir = outputDir + 'agents/';
    await ensureDirectory(agentsDir);

    // Group by agent name
    const agentGroups = outputs.agentWorkingFiles.reduce((acc, file) => {
      if (!acc[file.agentName]) {
        acc[file.agentName] = [];
      }
      acc[file.agentName].push(file);
      return acc;
    }, {} as Record<string, AgentWorkingFile[]>);

    // Save each agent's working files
    for (const [agentName, agentFiles] of Object.entries(agentGroups)) {
      const agentDir = agentsDir + slugify(agentName) + '/';
      await ensureDirectory(agentDir);

      // Save combined agent output
      const agentCombinedPath = agentDir + '00-all-executions.json';
      const agentCombinedSize = await writeJsonFile(agentCombinedPath, agentFiles);
      files.push({ name: `${agentName} - All Executions`, path: agentCombinedPath, type: 'agent', size: agentCombinedSize });

      // Save individual execution files
      for (let index = 0; index < agentFiles.length; index++) {
        const file = agentFiles[index];
        const execPath = agentDir + `${String(index + 1).padStart(2, '0')}-execution-${slugify(file.timestamp)}.json`;
        const execSize = await writeJsonFile(execPath, {
          agentName: file.agentName,
          timestamp: file.timestamp,
          input: file.input,
          rawResponse: file.rawResponse,
          processedOutput: file.processedOutput,
          executionTime: file.executionTime,
          tokenUsage: file.tokenUsage,
          errors: file.errors,
          retryCount: file.retryCount,
        });
        files.push({ name: `${agentName} - Execution ${index + 1}`, path: execPath, type: 'agent-execution', size: execSize });
      }

      // Save inputs separately for easy review
      const inputsPath = agentDir + '01-inputs.json';
      const inputsSize = await writeJsonFile(inputsPath, agentFiles.map(f => ({
        timestamp: f.timestamp,
        input: f.input,
      })));
      files.push({ name: `${agentName} - Inputs`, path: inputsPath, type: 'agent-input', size: inputsSize });

      // Save raw responses separately
      const rawResponsesPath = agentDir + '02-raw-responses.json';
      const rawResponsesSize = await writeJsonFile(rawResponsesPath, agentFiles
        .filter(f => f.rawResponse)
        .map(f => ({
          timestamp: f.timestamp,
          rawResponse: f.rawResponse,
        })));
      files.push({ name: `${agentName} - Raw Responses`, path: rawResponsesPath, type: 'agent-raw', size: rawResponsesSize });
    }
  }

  // 11. Save Checkpoints
  if (outputs.checkpoints && outputs.checkpoints.length > 0) {
    const checkpointsPath = outputDir + '09-checkpoints.json';
    const checkpointsSize = await writeJsonFile(checkpointsPath, outputs.checkpoints);
    files.push({ name: 'Checkpoints', path: checkpointsPath, type: 'checkpoints', size: checkpointsSize });
  }

  // Fallback: extract counts from the assembled story when intermediate pipeline data isn't provided
  const storyEpisodes = outputs.finalStory?.episodes || [];
  const storyScenes = storyEpisodes.flatMap(ep => ep.scenes || []);
  const storyEncounters = storyScenes.map(s => s.encounter).filter(Boolean);

  // Create manifest
  const manifest: OutputManifest = {
    storyTitle,
    storyId,
    generatedAt: new Date().toISOString(),
    duration,
    files,
    summary: {
      worldLocations: outputs.worldBible?.locations.length || 0,
      worldFactions: outputs.worldBible?.factions.length || 0,
      characters: outputs.characterBible?.characters.length || 0,
      scenes: outputs.sceneContents?.length || storyScenes.length || 0,
      choices: outputs.choiceSets?.reduce((acc, cs) => acc + cs.choices.length, 0)
        || storyScenes.reduce((acc, s) => acc + s.beats.reduce((ba, b) => ba + (b.choices?.length || 0), 0), 0)
        || 0,
      encounters: outputs.encounters?.length || storyEncounters.length || 0,
      encounterBeats: outputs.encounters?.reduce((acc, enc) => acc + (enc.beats?.length || 0), 0)
        || storyEncounters.reduce((acc, enc) => acc + (enc!.phases?.reduce((pa, p) => pa + (p.beats?.length || 0), 0) || 0), 0)
        || 0,
      storylets: outputs.encounters?.reduce((acc, enc) => {
        let count = 0;
        if (enc.storylets?.victory) count++;
        if (enc.storylets?.partialVictory) count++;
        if (enc.storylets?.defeat) count++;
        if (enc.storylets?.escape) count++;
        return acc + count;
      }, 0) || storyEncounters.reduce((acc, enc) => {
        let count = 0;
        if (enc!.storylets?.victory) count++;
        if (enc!.storylets?.partialVictory) count++;
        if (enc!.storylets?.defeat) count++;
        if (enc!.storylets?.escape) count++;
        return acc + count;
      }, 0) || 0,
      environmentalElements: outputs.encounters?.reduce((acc, enc) => acc + (enc.environmentalElements?.length || 0), 0)
        || storyEncounters.reduce((acc, enc) => acc + (enc!.environmentalElements?.length || 0), 0)
        || 0,
      qaScore: outputs.qaReport?.overallScore,
      validationScore: outputs.bestPracticesReport?.overallScore,
      validationPassed: outputs.bestPracticesReport?.overallPassed,
      // Visual planning stats
      hasColorScript: !!outputs.visualPlanning?.colorScript,
      characterReferencesCount: outputs.visualPlanning?.characterReferences?.length || 0,
      visualPlansCount: outputs.visualPlanning?.visualPlans?.length || 0,
      // Video generation stats
      videoClipsGenerated: outputs.videoClipsGenerated || 0,
      videoClipsFailed: outputs.videoDiagnostics?.filter(d => d.status === 'failed').length || 0,
      videoClipsAttempted: outputs.videoDiagnostics?.filter(d => d.stage === 'veo_generation').length || 0,
      videoDiagnosticsCount: outputs.videoDiagnostics?.length || 0,
      audioDiagnosticsCount: outputs.audioDiagnostics?.length || 0,
      encounterImageDiagnosticsCount: outputs.encounterImageDiagnostics?.length || 0,
      encounterImageFailures: outputs.encounterImageDiagnostics?.filter(d => d.status === 'failed' || d.status === 'preflight_failed').length || 0,
    },
  };

  // Save manifest
  const manifestPath = outputDir + 'manifest.json';
  await writeJsonFile(manifestPath, manifest);

  console.log(`[OutputWriter] ✓ Saved ${files.length} files to ${outputDir}`);
  console.log(`[OutputWriter] Summary:`, manifest.summary);

  return manifest;
}

/**
 * List all generated story outputs
 */
export async function listGeneratedOutputs(): Promise<{ name: string; path: string; manifest?: OutputManifest }[]> {
  if (isWebRuntime()) {
    return listCachedOutputManifests();
  }

  // For native, scan the file system
  const outputs: { name: string; path: string; manifest?: OutputManifest }[] = [];
  const OUTPUT_BASE_DIR = getOutputBaseDir();

  try {
    await ensureDirectory(OUTPUT_BASE_DIR);
    const dirs = await ExpoFileSystem.readDirectoryAsync(OUTPUT_BASE_DIR);

    for (const dir of dirs) {
      const dirPath = OUTPUT_BASE_DIR + dir + '/';
      const manifestPath = dirPath + 'manifest.json';

      const manifestInfo = await ExpoFileSystem.getInfoAsync(manifestPath);
      if (manifestInfo.exists) {
        try {
          const content = await ExpoFileSystem.readAsStringAsync(manifestPath);
          const manifest = JSON.parse(content) as OutputManifest;
          outputs.push({
            name: manifest.storyTitle || dir,
            path: dirPath,
            manifest,
          });
        } catch {
          outputs.push({ name: dir, path: dirPath });
        }
      } else {
        outputs.push({ name: dir, path: dirPath });
      }
    }
  } catch (err) {
    console.warn('[OutputWriter] Failed to list outputs:', err);
  }

  return outputs;
}

/**
 * Read a specific output file
 */
export async function readOutputFile(path: string): Promise<unknown> {
  if (isWebRuntime()) {
    return readCachedOutputFile(path);
  }

  const content = await ExpoFileSystem.readAsStringAsync(path);
  return JSON.parse(content);
}

/**
 * Download all outputs as a ZIP (web only) - returns blob URL
 * For now, just returns individual file contents for download
 */
export async function getOutputsForDownload(outputDir: string): Promise<{ name: string; content: string }[]> {
  if (isWebRuntime()) {
    return getCachedOutputsForDownload(outputDir);
  }

  const files: { name: string; content: string }[] = [];
  try {
    const dirFiles = await ExpoFileSystem.readDirectoryAsync(outputDir);
    for (const fileName of dirFiles) {
      if (fileName.endsWith('.json')) {
        const content = await ExpoFileSystem.readAsStringAsync(outputDir + fileName);
        files.push({ name: fileName, content });
      }
    }
  } catch (err) {
    console.warn('[OutputWriter] Failed to read output files:', err);
  }

  return files;
}

/**
 * Delete an output directory
 */
export async function deleteOutputDirectory(outputDir: string): Promise<void> {
  if (isWebRuntime()) {
    deleteCachedOutputDirectory(outputDir);
    console.log(`[OutputWriter] Deleted cached output directory: ${outputDir}`);
  } else {
    await ExpoFileSystem.deleteAsync(outputDir, { idempotent: true });
    console.log(`[OutputWriter] Deleted output directory: ${outputDir}`);
  }
}

/**
 * Rename a story and its output directory
 */
export async function renameStory(storyId: string, oldOutputDir: string, newTitle: string): Promise<boolean> {
  if (isWebRuntime()) {
    try {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/rename-story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, newTitle }),
      });
      const result = await response.json();
      return result.success;
    } catch (e) {
      console.warn('[OutputWriter] Failed to rename story via proxy:', e);
      return false;
    }
  }

  // Native implementation
  try {
    // 1. Load manifest to update it
    const manifestPath = oldOutputDir + 'manifest.json';
    const manifestContent = await ExpoFileSystem.readAsStringAsync(manifestPath);
    const manifest = JSON.parse(manifestContent) as OutputManifest;
    manifest.storyTitle = newTitle;
    await ExpoFileSystem.writeAsStringAsync(manifestPath, JSON.stringify(manifest, null, 2));

    // 2. Load final story to update it
    const storyPath = oldOutputDir + '08-final-story.json';
    const storyContent = await ExpoFileSystem.readAsStringAsync(storyPath);
    const story = JSON.parse(storyContent) as Story;
    story.title = newTitle;
    await ExpoFileSystem.writeAsStringAsync(storyPath, JSON.stringify(story, null, 2));

    // 3. Rename directory
    const baseDir = getOutputBaseDir();
    const oldDirName = oldOutputDir.replace(baseDir, '').replace('/', '');
    const timestamp = oldDirName.includes('_') ? oldDirName.split('_').pop() : getTimestamp();
    const newSlug = slugify(newTitle);
    const newDirName = `${newSlug}_${timestamp}`;
    const newDirPath = baseDir + newDirName + '/';

    if (oldOutputDir !== newDirPath) {
      // Expo FileSystem doesn't have a simple rename for directories that works across all platforms easily, 
      // but we can move it.
      await ExpoFileSystem.moveAsync({
        from: oldOutputDir,
        to: newDirPath
      });
    }

    return true;
  } catch (e) {
    console.error('[OutputWriter] Failed to rename story:', e);
    return false;
  }
}
