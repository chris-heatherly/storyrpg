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
import type { FinalStoryContractReport } from '../validators/FinalStoryContractValidator';
import type {
  ContractRepairReport,
  ContractRepairRoundSnapshot,
} from '../remediation/finalContractRepair';
import { buildFinalContractRepairReplayArtifact } from '../remediation/finalContractRepairReplay';
import { parseRepairCandidate, type FinalContractRepairCandidate } from '../remediation/finalContractCarryForward';
import type { QualityCouncilReport } from '../quality-council/types';
import type { LlmLedger } from './pipelineTelemetry';
import type { BranchShadowDiff } from './branchShadowDiff';
import { appendQualityLedger } from './qualityLedger';
import { resolveWorkerGitSha } from './buildInfo';
import { analyzeStory as analyzeSentenceOpeners } from './sentenceOpenerStats';
import {
  deriveStoryCircleQualityScore,
  type StoryCircleQualityScoreBasis,
  type StoryCircleQualityScoreOptions,
  type StoryCircleQualityScoreReport,
} from './qualityScoring';
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
import { encodeStory, STORY_SCHEMA_VERSION } from '../codec/storyCodec';

function hasNodeFs(): boolean {
  return typeof process !== 'undefined'
    && !!(process as unknown as { versions?: { node?: string } })?.versions?.node
    && !isWebRuntime();
}

function nodeRequire<T>(name: string): T {
  const getBuiltinModule = (typeof process !== 'undefined'
    ? (process as unknown as { getBuiltinModule?: (mod: string) => unknown }).getBuiltinModule
    : undefined);
  if (typeof getBuiltinModule === 'function') {
    const builtin = getBuiltinModule(name);
    if (builtin) return builtin as T;
  }

  // Hidden from Metro's static analyzer. Metro rejects `require(variable)`
  // because it can't bundle an unknown module; we only call this from Node
  // branches (hasNodeFs() === true), so indirecting through Function lets
  // the web bundle build while Node still resolves at runtime.
  const req = (Function('return typeof require !== "undefined" ? require : null'))() as
    | ((mod: string) => unknown)
    | null;
  if (!req) throw new Error(`nodeRequire called in non-Node runtime for: ${name}`);
  return req(name) as T;
}

function atomicWriteNodeSync(absPath: string, content: string | Buffer): { sha256: string; bytes: number } {
  const fs = nodeRequire<typeof import('fs')>('fs');
  const path = nodeRequire<typeof import('path')>('path');
  const crypto = nodeRequire<typeof import('crypto')>('crypto');
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, buffer);
      try { fs.fsyncSync(fd); } catch { /* best-effort */ }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length };
}

type BoundImagePromptRecord = {
  image: string;
  identifier: string;
  expectedPromptPath: string;
  fieldPaths: string[];
  contexts: Array<Record<string, unknown>>;
};

function boundImagePromptIdentifier(image: unknown): string | null {
  if (typeof image !== 'string') return null;
  const clean = image.trim().split(/[?#]/)[0];
  if (!clean || !/\.(png|jpe?g|webp)$/i.test(clean)) return null;
  if (!/(^|\/)generated-stories\/[^/]+\/images\//i.test(clean) && !/(^|\/)images\//i.test(clean)) return null;
  if (/(^|\/)images\/prompts\//i.test(clean)) return null;
  const match = clean.match(/(?:^|\/)images\/(?:.*\/)?([^/]+)\.(png|jpe?g|webp)$/i);
  return match?.[1] || null;
}

function addBoundImagePromptRecord(
  records: Map<string, BoundImagePromptRecord>,
  outputDir: string,
  image: unknown,
  fieldPath: string,
  context: Record<string, unknown>,
): void {
  if (typeof image !== 'string') return;
  const identifier = boundImagePromptIdentifier(image);
  if (!identifier) return;
  const expectedPromptPath = `${outputDir}images/prompts/${identifier}.json`;
  const existing = records.get(expectedPromptPath);
  if (existing) {
    if (!existing.fieldPaths.includes(fieldPath)) existing.fieldPaths.push(fieldPath);
    existing.contexts.push(context);
    return;
  }
  records.set(expectedPromptPath, {
    image,
    identifier,
    expectedPromptPath,
    fieldPaths: [fieldPath],
    contexts: [context],
  });
}

function collectBoundImagePromptRecords(story: Story, outputDir: string): BoundImagePromptRecord[] {
  const records = new Map<string, BoundImagePromptRecord>();
  addBoundImagePromptRecord(records, outputDir, story.coverImage, 'coverImage', {
    storyId: story.id,
    storyTitle: story.title,
    type: 'story-cover',
  });

  for (const [episodeIndex, episode] of (story.episodes || []).entries()) {
    const episodeNumber = episode.number ?? episodeIndex + 1;
    addBoundImagePromptRecord(records, outputDir, episode.coverImage, `episodes[${episodeIndex}].coverImage`, {
      storyId: story.id,
      storyTitle: story.title,
      episodeNumber,
      episodeId: episode.id,
      episodeTitle: episode.title,
      type: 'episode-cover',
    });

    for (const [sceneIndex, scene] of (episode.scenes || []).entries()) {
      const sceneContext = {
        storyId: story.id,
        storyTitle: story.title,
        episodeNumber,
        episodeId: episode.id,
        episodeTitle: episode.title,
        sceneId: scene.id,
        sceneName: scene.name,
      };
      addBoundImagePromptRecord(
        records,
        outputDir,
        scene.backgroundImage,
        `episodes[${episodeIndex}].scenes[${sceneIndex}].backgroundImage`,
        { ...sceneContext, type: 'scene-background' },
      );

      for (const [beatIndex, beat] of (scene.beats || []).entries()) {
        const beatContext = {
          ...sceneContext,
          type: 'story-beat',
          beatId: beat.id,
          beatIndex,
          beatText: beat.text,
          speaker: (beat as any).speaker,
        };
        addBoundImagePromptRecord(
          records,
          outputDir,
          beat.image,
          `episodes[${episodeIndex}].scenes[${sceneIndex}].beats[${beatIndex}].image`,
          beatContext,
        );
        if (Array.isArray((beat as any).panelImages)) {
          for (const [panelIndex, panelImage] of (beat as any).panelImages.entries()) {
            addBoundImagePromptRecord(
              records,
              outputDir,
              panelImage,
              `episodes[${episodeIndex}].scenes[${sceneIndex}].beats[${beatIndex}].panelImages[${panelIndex}]`,
              { ...beatContext, type: 'story-beat-panel', panelIndex },
            );
          }
        }
      }

      const visit = (value: unknown, fieldPath: string): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`));
          return;
        }
        const obj = value as Record<string, unknown>;
        for (const [key, child] of Object.entries(obj)) {
          const childPath = `${fieldPath}.${key}`;
          if (typeof child === 'string' && /(image|cover|portrait)$/i.test(key)) {
            addBoundImagePromptRecord(records, outputDir, child, childPath, {
              ...sceneContext,
              type: 'nested-image',
              id: obj.id,
              beatId: obj.beatId,
              text: obj.text,
              fieldKey: key,
            });
          } else {
            visit(child, childPath);
          }
        }
      };
      visit((scene as any).encounter, `episodes[${episodeIndex}].scenes[${sceneIndex}].encounter`);
      visit((scene as any).storylets, `episodes[${episodeIndex}].scenes[${sceneIndex}].storylets`);
    }
  }

  return Array.from(records.values());
}

function buildRecoveredPromptArtifact(record: BoundImagePromptRecord, story: Story, generator?: Record<string, unknown>) {
  const primaryContext = record.contexts[0] || {};
  const prompt = [
    'RECOVERED PROMPT ARTIFACT: the exact original prompt JSON for this bound image was missing when the final story package was written.',
    'This file was created by the image prompt binding guard so dev tooling can inspect the local image provenance instead of failing silently.',
    '',
    `Story: ${story.title || story.id || 'Untitled story'}`,
    primaryContext.episodeNumber ? `Episode: ${primaryContext.episodeNumber}${primaryContext.episodeTitle ? ` - ${primaryContext.episodeTitle}` : ''}` : undefined,
    primaryContext.sceneId ? `Scene: ${primaryContext.sceneId}${primaryContext.sceneName ? ` - ${primaryContext.sceneName}` : ''}` : undefined,
    primaryContext.beatId ? `Beat: ${primaryContext.beatId}` : undefined,
    primaryContext.speaker ? `Speaker: ${primaryContext.speaker}` : undefined,
    primaryContext.beatText || primaryContext.text ? '' : undefined,
    primaryContext.beatText || primaryContext.text ? 'Story text:' : undefined,
    (primaryContext.beatText || primaryContext.text) as string | undefined,
    '',
    generator?.artStyle || generator?.canonicalArtStyle || story.artStyleProfile
      ? `Style/source metadata: ${JSON.stringify(generator?.artStyle || generator?.canonicalArtStyle || story.artStyleProfile)}`
      : undefined,
  ].filter(Boolean).join('\n');

  return {
    identifier: record.identifier,
    metadata: {
      type: 'recovered-bound-image-prompt',
      storyId: story.id,
      image: record.image,
      source: 'writeFinalStoryPackage prompt binding guard',
      exactOriginalPromptMissing: true,
      fieldPaths: record.fieldPaths,
      contexts: record.contexts,
      recoveredAt: new Date().toISOString(),
    },
    prompt,
    timestamp: new Date().toISOString(),
  };
}

function ensureBoundImagePromptArtifactsNode(
  outputDir: string,
  story: Story,
  generator?: Record<string, unknown>,
): { checked: number; alreadyPresent: number; recovered: number; records: Array<Record<string, unknown>> } {
  const fs = nodeRequire<typeof import('fs')>('fs');
  const path = nodeRequire<typeof import('path')>('path');
  const normalizedOutputDir = outputDir.endsWith('/') ? outputDir : `${outputDir}/`;
  const promptDir = `${normalizedOutputDir}images/prompts`;
  fs.mkdirSync(promptDir, { recursive: true });

  const records = collectBoundImagePromptRecords(story, normalizedOutputDir);
  let alreadyPresent = 0;
  let recovered = 0;
  const reportRecords: Array<Record<string, unknown>> = [];

  for (const record of records) {
    if (fs.existsSync(record.expectedPromptPath)) {
      alreadyPresent += 1;
      reportRecords.push({
        status: 'present',
        image: record.image,
        promptPath: path.relative(normalizedOutputDir, record.expectedPromptPath),
        fieldPaths: record.fieldPaths,
      });
      continue;
    }

    const artifact = buildRecoveredPromptArtifact(record, story, generator);
    atomicWriteNodeSync(record.expectedPromptPath, JSON.stringify(artifact, null, 2));
    recovered += 1;
    reportRecords.push({
      status: 'recovered',
      image: record.image,
      promptPath: path.relative(normalizedOutputDir, record.expectedPromptPath),
      fieldPaths: record.fieldPaths,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    storyId: story.id,
    checked: records.length,
    alreadyPresent,
    recovered,
    records: reportRecords,
  };
  atomicWriteNodeSync(
    `${normalizedOutputDir}image-prompt-binding-report.json`,
    JSON.stringify(report, null, 2),
  );

  return { checked: records.length, alreadyPresent, recovered, records: reportRecords };
}

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
  provider?: 'elevenlabs' | 'gemini' | string;
  model?: string;
  voiceId?: string;
  performanceTagsEnabled?: boolean;
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
  visibleCharacters?: string[];
  expectedCharacterRefs?: Record<string, number>;
  effectiveCharacterRefs?: Record<string, number>;
  missingReferenceCharacters?: string[];
  referenceRoute?: 'text-only' | 'inline-refs' | 'url-refs' | 'edit-with-refs' | 'lora';
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
  finalStoryContractReport?: FinalStoryContractReport;
  qualityCouncilReport?: QualityCouncilReport;
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
  generator?: Record<string, unknown>;
  /**
   * S3: per-run remediation summary (scene/encounter/choice regeneration + autofix).
   * When present, the counts are folded into the success quality-ledger row so
   * remediation frequency / success / degradation is trackable cross-run.
   */
  remediationSummary?: {
    attempted: number;
    succeeded: number;
    degraded: number;
  };
  memorySummary?: {
    recallCount: number;
    writeCount: number;
    emptyRecallCount: number;
    providerEmptyRecallCount: number;
    filterFallbackCount: number;
    breakerOpenCount: number;
    totalResultCount: number;
    totalLatencyMs: number;
    errorCount: number;
  };
}

export type QualityScoreBasis = StoryCircleQualityScoreBasis;
export type QualityScoreReport = StoryCircleQualityScoreReport;

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
    qualityScore?: number;
    qualityScoreBasis?: QualityScoreBasis;
    validationPassed?: boolean;
    finalStoryContractPassed?: boolean;
    finalStoryContractBlockingIssues?: number;
    qualityCouncilEnabled?: boolean;
    qualityCouncilFindings?: number;
    qualityCouncilFusionUsed?: boolean;
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

/**
 * Write a JSON file
 */
async function writeJsonFile(path: string, data: unknown): Promise<number> {
  const cleanData = data;

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

  if (hasNodeFs()) {
    atomicWriteNodeSync(path, content);
    return content.length;
  }

  await ExpoFileSystem.writeAsStringAsync(path, content, {
    encoding: 'utf8',
  });

  return content.length;
}

function withPersistedStoryVisualMetadata(story: Story, generator?: Record<string, unknown>): Story {
  const next = { ...story } as Story;
  if (!next.artStyleProfile && generator?.artStyleProfile) {
    next.artStyleProfile = generator.artStyleProfile;
  }
  if (!next.styleAnchors && generator?.styleAnchors && typeof generator.styleAnchors === 'object') {
    next.styleAnchors = generator.styleAnchors as Story['styleAnchors'];
  }
  return next;
}

function withGeneratedOutputScope(story: Story, brief: FullCreativeBrief): Story {
  const generatedEpisodeNumbers = (story.episodes || [])
    .map(episode => episode.number)
    .filter((episodeNumber): episodeNumber is number => typeof episodeNumber === 'number')
    .sort((a, b) => a - b);
  const startEpisode = generatedEpisodeNumbers[0] ?? brief.episode?.number ?? 1;
  const endEpisode = generatedEpisodeNumbers[generatedEpisodeNumbers.length - 1] ?? startEpisode;
  const requestedEpisodeCount = brief.multiEpisode?.episodeRange
    ? Math.max(0, brief.multiEpisode.episodeRange.end - brief.multiEpisode.episodeRange.start + 1)
    : generatedEpisodeNumbers.length || 1;
  const sourceEpisodeCount =
    brief.seasonPlan?.totalEpisodes
    || brief.multiEpisode?.sourceAnalysis?.totalEstimatedEpisodes
    || Math.max(requestedEpisodeCount, generatedEpisodeNumbers.length || 1);
  const isPartialSeason = generatedEpisodeNumbers.length < sourceEpisodeCount;

  return {
    ...story,
    generatedOutputScope: {
      sourceEpisodeCount,
      requestedEpisodeCount,
      generatedEpisodeRange: { startEpisode, endEpisode },
      isPartialSeason,
      sourceTreatmentTitle: brief.seasonPlan?.sourceTitle || brief.story?.title,
      treatmentCompleteness: isPartialSeason ? 'partial-slice' : 'full-season',
    },
  };
}

/**
 * Write a v3 `story.json` package plus a small `manifest.json` next to
 * it. The manifest records the sha256 of story.json so the catalog
 * can detect partial writes and the migration tool can verify
 * integrity.
 */
export async function writeFinalStoryPackage(
  outputDir: string,
  story: Story,
  options?: { generator?: Record<string, unknown> },
): Promise<{ storyJsonPath: string; manifestPath: string; storySize: number }> {
  const storyJsonPath = outputDir + 'story.json';
  const manifestPath = outputDir + 'manifest.json';
  const storyForPackage = withPersistedStoryVisualMetadata(story, options?.generator);
  const generator = storyForPackage.generatedOutputScope
    ? { ...(options?.generator ?? {}), generatedOutputScope: storyForPackage.generatedOutputScope }
    : options?.generator;

  const pkg = encodeStory(storyForPackage, {
    targetVersion: STORY_SCHEMA_VERSION,
    generator,
  });

  const storyJson = JSON.stringify(pkg, null, 2);

  let sha256 = '';
  let bytes = storyJson.length;

  if (hasNodeFs()) {
    ensureBoundImagePromptArtifactsNode(outputDir, storyForPackage, options?.generator);
    const result = atomicWriteNodeSync(storyJsonPath, storyJson);
    sha256 = result.sha256;
    bytes = result.bytes;
  } else if (isWebRuntime()) {
    await fetch(PROXY_CONFIG.writeFile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: storyJsonPath, content: storyJson }),
    });
    // For web we cannot compute sha256 cheaply here; manifest sha will be empty
    // but the catalog tolerates missing manifest and falls back to the plain
    // file read.
  } else {
    await ExpoFileSystem.writeAsStringAsync(storyJsonPath, storyJson, { encoding: 'utf8' });
  }

  const manifest = {
    schemaVersion: 1,
    storyId: storyForPackage.id,
    storySchemaVersion: STORY_SCHEMA_VERSION,
    primaryStoryFile: 'story.json',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generator: generator ?? {},
    files: {
      'story.json': { sha256, bytes },
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2);
  if (hasNodeFs()) {
    atomicWriteNodeSync(manifestPath, manifestContent);
  } else if (isWebRuntime()) {
    await fetch(PROXY_CONFIG.writeFile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: manifestPath, content: manifestContent }),
    });
  } else {
    await ExpoFileSystem.writeAsStringAsync(manifestPath, manifestContent, { encoding: 'utf8' });
  }

  return { storyJsonPath, manifestPath, storySize: bytes };
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
    // Structured failure context (e.g. the specific blocking issues from the
    // final story contract) so a failed run is inspectable on disk and the
    // generator can be fixed — not just the top-line message.
    details?: Record<string, unknown>;
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
  // Note: the failed-run quality-ledger row is written by appendFailedRunLedger
  // at the true terminal abort (F4), NOT here — savePipelineErrorLog is also
  // called for non-fatal diagnostics and must not mark a run failed.
}

/**
 * Write the run-level LLM ledger sidecar (`09-llm-ledger.json`) on its own.
 * The success path writes it inside savePipelineOutputs; this standalone
 * writer exists so a FAILED run persists its token/usage telemetry too (P3):
 * the bite-me 2026-07-06 truncation abort left no per-call usage evidence on
 * disk precisely because the ledger only shipped with successful runs.
 */
export async function saveLlmLedgerSidecar(
  outputDir: string,
  ledger: LlmLedger | null | undefined,
): Promise<void> {
  if (!outputDir || !ledger) return;
  try {
    const ledgerPath = outputDir + '09-llm-ledger.json';
    await writeJsonFile(ledgerPath, {
      generatedAt: new Date().toISOString(),
      ...ledger,
    });
    console.log(`[OutputWriter] Saved LLM ledger to ${ledgerPath}`);
  } catch (e) {
    console.warn('[OutputWriter] Failed to save LLM ledger sidecar:', e);
  }
}

// The cross-run quality ledger lives in the PARENT of a run's output dir
// (e.g. generated-stories/quality-ledger.jsonl). Deriving the base dir from the
// run dir (rather than a global) keeps test runs writing to their own temp
// dirs instead of polluting the real ledger (F4).
function ledgerBaseDir(outputDir: string): string {
  const trimmed = outputDir.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(0, slash + 1) : './';
}
function runNameFromDir(outputDir: string): string {
  const trimmed = outputDir.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function reconcileBestPracticesReportForFinalStory(
  report: ComprehensiveValidationReport | undefined,
  story: Story | undefined,
): ComprehensiveValidationReport | undefined {
  if (!report || !story || !Array.isArray(report.blockingIssues)) return report;
  const blockingIssues = report.blockingIssues.filter((issue) => {
    return !isStaleRelationshipIdBestPracticeIssue(story, issue)
      && !isStaleStatCheckBalanceIssue(story, issue);
  });
  if (blockingIssues.length === report.blockingIssues.length) return report;
  return {
    ...report,
    blockingIssues,
    overallPassed: blockingIssues.length === 0 ? true : report.overallPassed,
  };
}

function isStaleRelationshipIdBestPracticeIssue(story: Story, issue: { message?: string }): boolean {
  const match = (issue.message || '').match(
    /Relationship consequence on choice "([^"]+)" targets unknown NPC "([^"]+)"/i,
  );
  if (!match) return false;
  const choice = findChoiceInStory(story, match[1]);
  if (!choice) return false;
  return !(choice.consequences || []).some((consequence: any) => {
    if (!consequence || consequence.type !== 'relationship') return false;
    return consequence.npcId === match[2] || consequence.target === match[2];
  });
}

function isStaleStatCheckBalanceIssue(story: Story, issue: { message?: string }): boolean {
  const match = (issue.message || '').match(/Stat check "([^"]+)" has skillWeights totaling/i);
  if (!match) return false;
  const choice = findChoiceInStory(story, match[1]);
  const weights = choice?.statCheck?.skillWeights;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return false;
  const values = Object.values(weights);
  if (values.length === 0 || values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    return false;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 1) <= 0.01;
}

function findChoiceInStory(story: Story, choiceId: string): any | undefined {
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        const choice = (beat.choices || []).find((candidate: any) => candidate?.id === choiceId);
        if (choice) return choice;
      }
    }
  }
  return undefined;
}

export function deriveRunQualityScore(
  outputs: {
    brief?: Record<string, any>;
    finalStory?: Story | null;
    qaReport?: QAReport | null;
    bestPracticesReport?: any;
    finalStoryContractReport?: FinalStoryContractReport | null;
    qualityCouncilReport?: QualityCouncilReport | null;
    incrementalValidationResults?: any;
  },
  options: StoryCircleQualityScoreOptions = {},
): {
  score: number;
  basis: QualityScoreBasis;
  report: QualityScoreReport;
} {
  return deriveStoryCircleQualityScore(outputs, options);
}

/**
 * Append a 'failed' row to the cross-run quality ledger at a genuine terminal
 * abort (F4). Best-effort; never throws.
 */
export async function appendFailedRunLedger(
  outputDir: string,
  errorCount = 1,
  details?: {
    blocked?: boolean;
    failureKind?: string;
    failureCode?: string;
    failureOwnerStage?: string;
    retryClass?: string;
    repairTarget?: string;
    topBlockingValidator?: string;
    gateConfigHash?: string;
    /** Deferral backpressure gauge: findings handed to episode-contract repair. */
    deferredRealizationCount?: number;
    validatorId?: string;
    durationMs?: number;
    llmLedger?: LlmLedger | null;
    remediationSummary?: { attempted: number; succeeded: number; degraded: number };
    memorySummary?: {
      recallCount: number;
      writeCount: number;
      emptyRecallCount: number;
      providerEmptyRecallCount: number;
      filterFallbackCount: number;
      breakerOpenCount: number;
      totalResultCount: number;
      totalLatencyMs: number;
      errorCount: number;
    };
  },
): Promise<void> {
  if (!outputDir) return;
  try {
    await appendQualityLedger(ledgerBaseDir(outputDir), {
      timestamp: new Date().toISOString(),
      runDir: runNameFromDir(outputDir),
      outcome: 'failed',
      workerGitSha: resolveWorkerGitSha(),
      errorCount,
      deferredRealizationCount: details?.deferredRealizationCount,
      blocked: details?.blocked,
      failureKind: details?.failureKind,
      failureCode: details?.failureCode,
      failureOwnerStage: details?.failureOwnerStage,
      retryClass: details?.retryClass,
      repairTarget: details?.repairTarget,
      topBlockingValidator: details?.topBlockingValidator,
      gateConfigHash: details?.gateConfigHash,
      validatorId: details?.validatorId,
      durationMs: details?.durationMs,
      llmCalls: details?.llmLedger?.totals.calls,
      llmFailures: details?.llmLedger?.totals.failures,
      llmInputTokens: details?.llmLedger?.totals.totalInputTokens,
      llmOutputTokens: details?.llmLedger?.totals.totalOutputTokens,
      promptChars: details?.llmLedger?.totals.totalPromptChars,
      remediationsAttempted: details?.remediationSummary?.attempted,
      remediationsSucceeded: details?.remediationSummary?.succeeded,
      remediationsDegraded: details?.remediationSummary?.degraded,
      memory: details?.memorySummary,
    });
  } catch { /* ledger is best-effort */ }
}

function verifyRetainedPackage(outputDir: string): {
  verified: boolean;
  storyArtifact: string;
  manifestArtifact: string;
} {
  const result = {
    verified: false,
    storyArtifact: `${outputDir}story.json`,
    manifestArtifact: `${outputDir}manifest.json`,
  };
  if (!hasNodeFs()) return result;
  try {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const story = JSON.parse(fs.readFileSync(result.storyArtifact, 'utf8')) as unknown;
    const manifest = JSON.parse(fs.readFileSync(result.manifestArtifact, 'utf8')) as {
      files?: Array<{ type?: string; path?: string }>;
    };
    result.verified = Boolean(
      story
      && manifest
      && Array.isArray(manifest.files)
      && manifest.files.some((file) => file.type === 'story' && file.path === result.storyArtifact),
    );
  } catch {
    result.verified = false;
  }
  return result;
}

/**
 * B2: write a recovery snapshot of the assembled story to `partial-story.json`
 * BEFORE the final gates (treatment fidelity, story contract) that can abort
 * the run. If a later phase throws, the completed episodes survive on disk
 * instead of being discarded. Distinct filename so it never shadows the real
 * `story.json` / catalog. Best-effort: never throws.
 * See docs/PROJECT_AUDIT_2026-05-28.md (Track B2).
 */
export async function savePartialStory(
  outputDir: string,
  story: Story,
  options?: { note?: string; diagnostic?: boolean },
): Promise<void> {
  if (!outputDir || !story) return;
  try {
    await ensureDirectory(outputDir);
    await writeJsonFile(outputDir + 'partial-story.json', {
      _partial: true,
      _diagnostic: options?.diagnostic === true,
      _note: options?.note || 'Recovery snapshot written before final validation gates. The completed episodes are playable; later phases may not have run.',
      savedAt: new Date().toISOString(),
      episodeCount: Array.isArray(story.episodes) ? story.episodes.length : 0,
      story,
    });
    console.info(`[OutputWriter] Wrote partial-story.json recovery snapshot (${Array.isArray(story.episodes) ? story.episodes.length : 0} episode(s))`);
  } catch (e) {
    console.warn('[OutputWriter] Failed to write partial story snapshot (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Persist the exact final-contract failure report plus the last assembled/repaired
 * candidate. These are diagnostic artifacts only; they never write story.json
 * or manifest.json, so failed runs stay out of the catalog.
 */
export async function saveFinalStoryContractFailure(
  outputDir: string,
  story: Story,
  report: FinalStoryContractReport,
): Promise<void> {
  if (!outputDir || !story || !report) return;
  try {
    await ensureDirectory(outputDir);
    await writeJsonFile(outputDir + '07b-final-story-contract.failed.json', report);
    await savePartialStory(outputDir, story, {
      diagnostic: true,
      note: 'Diagnostic snapshot of the last assembled/repaired candidate after final-story contract failure. Not a playable package; inspect with the failed contract report.',
    });
    console.info('[OutputWriter] Wrote final-contract failure report and repaired partial snapshot');
  } catch (e) {
    console.warn('[OutputWriter] Failed to write final-contract failure artifacts (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}

/** Persist the post-revalidation candidate for deterministic offline replay. */
export async function saveFinalContractRepairRound(
  outputDir: string,
  snapshot: ContractRepairRoundSnapshot,
  story: Story,
  report: ContractRepairReport,
): Promise<void> {
  if (!outputDir || !story) return;
  try {
    const directory = `${outputDir.replace(/\/?$/, '/')}repair-snapshots/`;
    await ensureDirectory(directory);
    const filename = `round-${String(snapshot.round).padStart(2, '0')}.json`;
    await writeJsonFile(
      directory + filename,
      buildFinalContractRepairReplayArtifact(snapshot, story, report),
    );
  } catch (error) {
    console.warn(
      '[OutputWriter] Failed to write final-contract repair snapshot (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Relative path (within the run directory) of the carried repair candidate
 * for an enforcement phase. Lives under checkpoints/ so it survives resumes
 * alongside the watermark artifacts it complements.
 */
export function finalContractRepairCandidateFilename(phase: string): string {
  const slug = (phase || 'final_story_contract').replace(/[^a-z0-9_-]+/gi, '_');
  return `checkpoints/final-repair-candidate-${slug}.json`;
}

/**
 * Persist the still-failing repair candidate so the NEXT enforcement of this
 * phase (typically after a resume) starts from the repaired text instead of
 * re-repairing the frozen watermarks. Best-effort: a failed write degrades to
 * the pre-carry-forward behavior and must never mask the contract failure.
 */
export async function saveFinalContractRepairCandidate(
  outputDir: string,
  candidate: FinalContractRepairCandidate,
): Promise<void> {
  if (!outputDir || !candidate) return;
  try {
    const normalized = outputDir.replace(/\/?$/, '/');
    await ensureDirectory(`${normalized}checkpoints/`);
    await writeJsonFile(normalized + finalContractRepairCandidateFilename(candidate.phase), candidate);
    console.info(
      `[OutputWriter] Wrote carry-forward repair candidate for ${candidate.phase} `
      + `(enforcement ${candidate.enforcementCount}, ${candidate.remainingBlockingFingerprints.length} remaining blocker(s))`,
    );
  } catch (e) {
    console.warn('[OutputWriter] Failed to write carry-forward repair candidate (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}

/** Load + validate the carried repair candidate for a phase; anything unexpected degrades to null. */
export function loadFinalContractRepairCandidateSync(
  outputDir: string,
  phase: string,
): FinalContractRepairCandidate | null {
  if (!outputDir) return null;
  const raw = loadEarlyDiagnosticSync<unknown>(
    outputDir.replace(/\/?$/, '/'),
    finalContractRepairCandidateFilename(phase),
  );
  return parseRepairCandidate(raw, phase);
}

async function supersedeFailureArtifactsOnSuccessfulPackage(outputDir: string): Promise<void> {
  if (!outputDir || !hasNodeFs()) return;
  const fs = nodeRequire<typeof import('fs')>('fs');
  const path = nodeRequire<typeof import('path')>('path');
  const candidates = [
    '07b-final-story-contract.failed.json',
    '99-pipeline-errors.json',
  ];
  const existing = candidates.filter((name) => fs.existsSync(path.join(outputDir, name)));
  if (existing.length === 0) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const supersededDir = path.join(outputDir, 'superseded-failures', stamp);
  fs.mkdirSync(supersededDir, { recursive: true });
  const moved: Array<{ from: string; to: string }> = [];
  for (const name of existing) {
    const from = path.join(outputDir, name);
    const to = path.join(supersededDir, name);
    try {
      fs.renameSync(from, to);
      moved.push({ from: name, to: path.relative(outputDir, to) });
    } catch (error) {
      console.warn(`[OutputWriter] Failed to supersede stale failure artifact ${name}:`, error instanceof Error ? error.message : error);
    }
  }
  if (moved.length > 0) {
    atomicWriteNodeSync(
      path.join(supersededDir, 'superseded-by-success.json'),
      JSON.stringify({
        supersededAt: new Date().toISOString(),
        reason: 'A later successful final package was written for this run directory.',
        moved,
      }, null, 2),
    );
    console.info(`[OutputWriter] Superseded ${moved.length} stale failure artifact(s) after successful package save`);
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

export function loadEarlyDiagnosticSync<T = unknown>(
  outputDir: string,
  filename: string,
): T | null {
  let nodeFs: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: BufferEncoding) => string } | undefined;
  try {
    nodeFs = nodeRequire<typeof import('fs')>('fs');
  } catch {
    /* non-Node */
  }
  if (!nodeFs?.existsSync || !nodeFs.readFileSync) return null;
  const fullPath = outputDir + filename;
  try {
    if (!nodeFs.existsSync(fullPath)) return null;
    return JSON.parse(nodeFs.readFileSync(fullPath, 'utf8')) as T;
  } catch {
    return null;
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
  outputs.bestPracticesReport = reconcileBestPracticesReportForFinalStory(
    outputs.bestPracticesReport,
    outputs.finalStory,
  );

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
      validationScore: outputs.bestPracticesReport.overallScore,
      legacyValidationQualityScore: outputs.bestPracticesReport.qualityScore,
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

  // 8b. Save final story publish contract
  if (outputs.finalStoryContractReport) {
    const contractPath = outputDir + '07b-final-story-contract.json';
    const contractSize = await writeJsonFile(contractPath, outputs.finalStoryContractReport);
    files.push({ name: 'Final Story Contract', path: contractPath, type: 'final-story-contract', size: contractSize });
  }

  if (outputs.qualityCouncilReport) {
    const councilPath = outputDir + '07d-quality-council-report.json';
    const councilSize = await writeJsonFile(councilPath, outputs.qualityCouncilReport);
    files.push({ name: 'Quality Council Report', path: councilPath, type: 'quality-council', size: councilSize });

    const choiceReports = outputs.qualityCouncilReport.checkpoints.filter((checkpoint) => checkpoint.checkpoint === 'choice');
    if (choiceReports.length > 0) {
      const choicePath = outputDir + '07e-quality-council-choice-reports.json';
      const choiceSize = await writeJsonFile(choicePath, choiceReports);
      files.push({ name: 'Quality Council Choice Reports', path: choicePath, type: 'quality-council-choice', size: choiceSize });
    }

    const routeReports = outputs.qualityCouncilReport.checkpoints.filter((checkpoint) => checkpoint.checkpoint === 'route-playtest');
    if (routeReports.length > 0) {
      const routePath = outputDir + '07f-quality-council-route-playtest.json';
      const routeSize = await writeJsonFile(routePath, routeReports);
      files.push({ name: 'Quality Council Route Playtest', path: routePath, type: 'quality-council-route-playtest', size: routeSize });
    }

    const fusionReports = outputs.qualityCouncilReport.checkpoints.filter((checkpoint) => checkpoint.fusionUsed);
    if (fusionReports.length > 0) {
      const fusionPath = outputDir + '07g-quality-council-fusion-audit.json';
      const fusionSize = await writeJsonFile(fusionPath, fusionReports);
      files.push({ name: 'Quality Council Fusion Audit', path: fusionPath, type: 'quality-council-fusion', size: fusionSize });
    }
  }

  // 9. Save Final Story — atomic write + manifest.json + v3 story.json
  if (outputs.finalStory) {
    outputs.finalStory = withGeneratedOutputScope(outputs.finalStory, outputs.brief);
    const { storyJsonPath, manifestPath: mPath, storySize } =
      await writeFinalStoryPackage(outputDir, outputs.finalStory, {
        generator: outputs.generator || { pipeline: 'FullStoryPipeline' },
      });
    files.push({ name: 'Final Story (v3 package)', path: storyJsonPath, type: 'story', size: storySize });
    files.push({ name: 'Story Manifest', path: mPath, type: 'manifest', size: 0 });
    if (outputs.finalStoryContractReport?.passed === true) {
      await supersedeFailureArtifactsOnSuccessfulPackage(outputDir);
    }
    
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
  // Primary sink: append to the per-story `checkpoints.jsonl` log. The
  // legacy `09-checkpoints.json` is still written for back-compat with
  // external tooling that reads it; the JSONL file is the source of
  // truth for resume logic going forward.
  if (outputs.checkpoints && outputs.checkpoints.length > 0) {
    if (hasNodeFs()) {
      try {
        // Strip the trailing slash; checkpointLog expects a dir path.
        const storyDirAbs = outputDir.replace(/\/+$/, '');
        const ckLog = nodeRequire<typeof import('./checkpointLog')>('./checkpointLog');
        for (const cp of outputs.checkpoints as Array<Record<string, unknown>>) {
          ckLog.appendCheckpoint(storyDirAbs, {
            kind: 'phase',
            jobId: String(cp.jobId ?? storyId),
            phase: String(cp.phase ?? cp.stepId ?? 'unknown'),
            status: cp.status === 'failed' ? 'failed' : 'completed',
            detail: typeof cp.detail === 'string' ? cp.detail : undefined,
          } as unknown as import('./checkpointLog').Checkpoint);
        }
      } catch (e) {
        console.warn('[OutputWriter] checkpoints.jsonl append failed:', e instanceof Error ? e.message : e);
      }
    }
    const checkpointsPath = outputDir + '09-checkpoints.json';
    const checkpointsSize = await writeJsonFile(checkpointsPath, outputs.checkpoints);
    files.push({ name: 'Checkpoints (legacy)', path: checkpointsPath, type: 'checkpoints', size: checkpointsSize });
  }

  // Fallback: extract counts from the assembled story when intermediate pipeline data isn't provided
  const storyEpisodes = outputs.finalStory?.episodes || [];
  const storyScenes = storyEpisodes.flatMap(ep => ep.scenes || []);
  const storyEncounters = storyScenes.map(s => s.encounter).filter(Boolean);

  const quality = deriveRunQualityScore(outputs, { outputDir });
  const qualityReportPath = outputDir + '07c-quality-score-report.json';
  const qualityReportSize = await writeJsonFile(qualityReportPath, quality.report);
  files.push({
    name: 'Quality Score Report',
    path: qualityReportPath,
    type: 'quality-score',
    size: qualityReportSize,
  });

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
      qualityScore: quality.score,
      qualityScoreBasis: quality.basis,
      validationPassed: outputs.bestPracticesReport?.overallPassed,
      finalStoryContractPassed: outputs.finalStoryContractReport?.passed,
      finalStoryContractBlockingIssues: outputs.finalStoryContractReport?.blockingIssues.length,
      ...(outputs.qualityCouncilReport ? {
        qualityCouncilEnabled: true,
        qualityCouncilFindings: outputs.qualityCouncilReport.summary.highConfidenceFindings.length
          + outputs.qualityCouncilReport.summary.advisoryFindings.length,
        qualityCouncilFusionUsed: outputs.qualityCouncilReport.summary.fusionUsed,
      } : {}),
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
  const retainedPackage = outputs.finalStory
    ? verifyRetainedPackage(outputDir)
    : { verified: false, storyArtifact: `${outputDir}story.json`, manifestArtifact: manifestPath };

  console.log(`[OutputWriter] ✓ Saved ${files.length} files to ${outputDir}`);
  console.log(`[OutputWriter] Summary:`, manifest.summary);

  // Diagnostic/partial saves have no retained package and are ledgered by the
  // terminal failure path with the actual failure category and LLM totals.
  if (!outputs.finalStory) return manifest;

  // Record the successful run in the cross-run quality ledger (B3). Base dir is
  // derived from the run dir's parent so test runs don't pollute the real
  // ledger (F4).
  try {
    let openerRatio: number | undefined;
    let openerMonotony: number | undefined;
    try {
      if (outputs.finalStory) {
        const opener = analyzeSentenceOpeners(outputs.finalStory);
        openerRatio = opener.secondPersonRatio;
        openerMonotony = opener.monotonyPassages.length;
      }
    } catch { /* opener stats are best-effort telemetry */ }
    await appendQualityLedger(ledgerBaseDir(outputDir), {
      timestamp: manifest.generatedAt || new Date().toISOString(),
      runDir: runNameFromDir(outputDir),
      workerGitSha: resolveWorkerGitSha(),
      storyId: manifest.storyId,
      storyTitle: manifest.storyTitle,
      outcome: retainedPackage.verified ? 'success' : 'partial',
      overallScore: manifest.summary?.qualityScore,
      qaScore: manifest.summary?.qaScore,
      qaSkippedChecks: outputs.qaReport?.skippedChecks,
      validationScore: manifest.summary?.validationScore,
      validationPassed: manifest.summary?.validationPassed,
      finalStoryContractPassed: manifest.summary?.finalStoryContractPassed,
      remediationsAttempted: outputs.remediationSummary?.attempted,
      remediationsSucceeded: outputs.remediationSummary?.succeeded,
      remediationsDegraded: outputs.remediationSummary?.degraded,
      memory: outputs.memorySummary,
      secondPersonOpenerRatio: openerRatio,
      openerMonotonyPassages: openerMonotony,
      capIds: quality.basis.caps.map((cap) => cap.id),
      blockingCapCount: quality.basis.caps.filter((cap) => cap.maxScore < 90).length,
      durationMs: duration,
      llmCalls: outputs.llmLedger?.totals.calls,
      llmFailures: outputs.llmLedger?.totals.failures,
      llmInputTokens: outputs.llmLedger?.totals.totalInputTokens,
      llmOutputTokens: outputs.llmLedger?.totals.totalOutputTokens,
      promptChars: outputs.llmLedger?.totals.totalPromptChars,
      packageVerified: retainedPackage.verified,
      ...(retainedPackage.verified ? {
        packageRetention: 'retain_success_package' as const,
        storyArtifact: retainedPackage.storyArtifact,
        manifestArtifact: retainedPackage.manifestArtifact,
      } : {}),
    });
  } catch { /* ledger is best-effort */ }

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

    // 2. Load final story package to update it
    const storyPath = oldOutputDir + 'story.json';
    const storyContent = await ExpoFileSystem.readAsStringAsync(storyPath);
    const storyPackage = JSON.parse(storyContent) as { story?: Story; title?: string };
    if (storyPackage.story) {
      storyPackage.story.title = newTitle;
    } else {
      storyPackage.title = newTitle;
    }
    await ExpoFileSystem.writeAsStringAsync(storyPath, JSON.stringify(storyPackage, null, 2));

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
