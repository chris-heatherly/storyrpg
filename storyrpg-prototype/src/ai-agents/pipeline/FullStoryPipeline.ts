// @ts-nocheck — TODO(tech-debt): Phase 3 will extract this 12,986-line file
// into pipeline/phases/*.ts modules and restore whole-file typecheck.
/**
 * Full Story Pipeline Orchestrator
 *
 * Complete pipeline that uses ALL agents:
 * - World Builder: Creates locations and world bible
 * - Character Designer: Creates NPC profiles with voice
 * - Story Architect: Creates episode blueprints
 * - Scene Writer: Writes prose content
 * - Choice Author: Creates player choices
 * - QA Agents: Validates the output
 *
 * Includes human checkpoints for review at key stages.
 */

import { PipelineConfig, loadConfig, defaultValidationConfig, type MemoryConfig, type PreapprovedAnchor } from '../config';
import { getMemoryStore, NodeMemoryStore, type MemoryStore } from '../utils/memoryStore';
import { AudioGenerationService } from '../services/audioGenerationService';
import { generateEpisodeId, slugify as idSlugify } from '../utils/idUtils';
import { 
  SCENE_DEFAULTS, 
  TIMING_DEFAULTS, 
  CHARACTER_DEFAULTS,
  DEFAULT_SKILLS,
  CONCURRENCY_DEFAULTS,
} from '../../constants/pipeline';
import { 
  QA_DEFAULTS,
  TEXT_LIMITS,
  INCREMENTAL_VALIDATION_DEFAULTS,
  BEST_OF_N_DEFAULTS,
} from '../../constants/validation';
import { WorldBuilder, WorldBible } from '../agents/WorldBuilder';
import { CharacterDesigner, CharacterBible, CharacterProfile } from '../agents/CharacterDesigner';
import { StoryArchitect, StoryArchitectInput, EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { SceneWriter, SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceAuthor, ChoiceSet } from '../agents/ChoiceAuthor';
import { QARunner, QAReport, QARunnerOptions } from '../agents/QAAgents';
import { SourceMaterialAnalyzer, SourceMaterialInput } from '../agents/SourceMaterialAnalyzer';
import { SeasonPlan } from '../../types/seasonPlan';
import { buildGrowthTemplates, type GrowthCurveEntry } from '../../engine/growthConsequenceBuilder';
// Types CrossEpisodeBranch, ConsequenceChain, PlannedEncounter used transitively via SeasonPlan
import { BranchManager, BranchAnalysis, BranchPath, ReconvergencePoint } from '../agents/BranchManager';
import { SceneCritic } from '../agents/SceneCritic';
import { 
  EncounterArchitect, 
  EncounterArchitectInput, 
  EncounterStructure,
  EncounterTelemetry,
  GeneratedStorylet
} from '../agents/EncounterArchitect';
import { StateChange } from '../types/llm-output';
import { 
  convertStateChangeToConsequence, 
  convertStateChangesToConsequences,
  convertEncounterStructureToEncounter,
} from '../converters';
import { 
  ImageAgentTeam, 
  GeneratedReferenceSheet,
  GeneratedExpressionSheet,
  CharacterReferenceSheetRequest,
  ColorScript,
  ColorScriptRequest,
  StoryBeatInput,
  VisualPlan,
  computeCharacterIdentityFingerprint,
} from '../agents/image-team/ImageAgentTeam';
import type {
  CharacterVisualReference,
  VisualPlanningOutputs,
  AudioGenerationDiagnostic,
  VideoGenerationDiagnostic,
  EncounterImageRunDiagnostic,
} from '../utils/pipelineOutputWriter';
import { EncounterImageAgent } from '../agents/image-team/EncounterImageAgent';
import { ImagePrompt } from '../agents/ImageGenerator';
import {
  ImageGenerationService,
  ReferenceImage,
  type EncounterImageDiagnostic,
  type CanonicalAppearance,
  type CharacterAppearanceDescription,
} from '../services/imageGenerationService';
import type { GeneratedImage } from '../agents/ImageGenerator';
import { VideoDirectorAgent, VideoDirectionRequest } from '../agents/image-team/VideoDirectorAgent';
import { VideoGenerationService } from '../services/videoGenerationService';
import { selectStyleAdaptation, resolveSceneSettingContext, type SceneSettingContext } from '../utils/styleAdaptation';
import { 
  Story, Episode, Scene, Beat, Choice, NPCTier, RelationshipDimension, Consequence,
  Encounter, EncounterOutcome, EncounterType, EncounterClock, EncounterPhase, EncounterBeat as TypeEncounterBeat,
  EncounterChoice as TypeEncounterChoice, EncounterChoiceOutcome as TypeEncounterChoiceOutcome,
  EnvironmentalElement, NPCEncounterState, EscalationTrigger, InformationVisibility, 
  PixarStakes, GeneratedStorylet as TypeGeneratedStorylet, CinematicImageDescription, EncounterVisualContract
} from '../../types';
import { PipelineEvent, PipelineEventHandler, PipelineProgressTelemetry } from './EpisodePipeline';
import { SavingPhase } from './phases/SavingPhase';
import {
  createOutputDirectory,
  ensureDirectory,
  savePipelineOutputs,
  savePipelineErrorLog,
  saveEarlyDiagnostic,
  saveAudioDiagnosticsLog,
  saveEncounterImageDiagnosticsLog,
  saveVideoDiagnosticsLog,
  saveEncounterResumeState,
  loadEncounterResumeStateSync,
  saveBeatResumeState,
  loadBeatResumeStateSync,
  BeatResumeStateV1,
  updateOutputManifest,
  OutputManifest,
} from '../utils/pipelineOutputWriter';
import {
  buildEncounterSlotManifest,
  collectMissingSlotsFromManifest,
  ENCOUNTER_TREE_MAX_DEPTH,
  encounterSetupIdentifier,
  encounterSetupFallbackIdentifier,
  encounterOutcomeIdentifier,
  encounterSituationKey,
  encounterSituationIdentifier,
  legacyEncounterSituationKey,
  legacyEncounterSituationIdentifier,
  encounterOutcomeRetryIdentifier,
  encounterSituationRetryIdentifier,
  legacyEncounterSituationRetryIdentifier,
  sanitizeEncounterIdentifier,
} from '../encounters/encounterSlotManifest';
import {
  buildStoryletSlotManifest,
  collectMissingStoryletSlotsFromManifest,
  storyletAggressiveRetryIdentifier,
  storyletBaseIdentifier,
  storyletRetryIdentifier,
  type StoryletSlot,
} from '../encounters/storyletSlotManifest';
import { EncounterProviderPolicy } from '../encounters/encounterProviderPolicy';
import { AssetRegistry } from '../images/assetRegistry';
import { CallbackLedger } from './callbackLedger';
import { assembleStoryAssetsFromRegistry } from '../images/storyAssetAssembler';
import { validateRegistryCoverage } from '../images/coverageValidator';
import { walkStoryAssets, formatAssetWalkReport } from '../validators/storyAssetWalker';
import { runPlaywrightQA, runPlaywrightQAMultiPath, type PlaywrightQAResult } from '../validators/playwrightQARunner';
import { remediateImageIssues, resaveFinalStory } from '../validators/qaRemediation';
import { buildReferencePack } from '../images/referencePackBuilder';
import {
  buildCharacterAnchorPrompt,
  buildArcStripAnchorPrompt,
  buildEnvironmentAnchorPrompt,
  anchorIdentifier,
} from '../images/anchorPrompts';
import { composeCanonicalStyleString } from '../images/artStyleProfile';
import {
  LoraTrainingAgent,
  type CharacterTrainingCandidate,
  type StyleTrainingCandidate,
} from '../agents/image-team/LoraTrainingAgent';
import {
  LoraRegistry,
  createNodeLoraRegistryIO,
} from '../images/loraRegistry';
import { createLoraTrainerAdapter } from '../services/lora-training/factory';
import { providerSupportsLoraTraining } from '../images/providerCapabilities';
import { buildStoryImageSlotManifest } from '../images/storyImageSlotManifest';
import type { ImageSlot, ImageSlotFamily } from '../images/slotTypes';
import { buildBeatImagePrompt, overrideShotFromPlan } from '../images/beatPromptBuilder';
import { planShotSequence, type ShotPlan, type PanelMode } from '../images/shotSequencePlanner';
import {
  runTier1Checks,
  checkStructuralDiversity,
  buildTier2VisionPrompt,
  parseTier2Response,
  identifyRegenTargets,
  type Tier2SceneReport,
  type Tier2ShotReport,
  type VisualQAReport,
  type Tier3RegenTarget,
} from '../images/visualValidation';
import {
  IntegratedBestPracticesValidator,
  NPCDepthValidator,
  IncrementalValidationRunner,
  SceneValidationResult,
  IncrementalValidationConfig,
  CharacterVoiceProfile,
  aggregateValidationResults,
  PhaseValidator,
  StructuralValidator,
  ChoiceDistributionValidator,
} from '../validators';
import type { PhaseValidationResult } from '../validators/PhaseValidator';
import {
  ComprehensiveValidationReport,
  QuickValidationResult,
  ValidationError,
} from '../../types/validation';
import {
  SourceMaterialAnalysis,
  EpisodeOutline,
  GenerationScope,
  MultiEpisodeResult,
  EndingMode,
  StoryEndingTarget,
} from '../../types/sourceAnalysis';
import {
  registerJob,
  updateJob,
  isJobCancelled,
  completeJob,
  failJob,
  generateJobId,
  JobCancelledError,
} from '../utils/jobTracker';
import { BaseAgent, isLlmQuotaError, LlmCallObservation, type AgentResponse } from '../agents/BaseAgent';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import { LocalWorkerQueue, mapWithConcurrency } from '../utils/concurrency';
import { buildSceneDependencyGraph, buildTopologicalWaves } from '../utils/dependencyGraph';
import { PipelineTelemetry } from '../utils/pipelineTelemetry';
import { analyzeBranchTopology } from '../utils/branchTopology';
import { buildBranchShadowDiff } from '../utils/branchShadowDiff';
import { collectMissingEncounterImageKeys, getEncounterBeats } from '../utils/encounterImageCoverage';
import { PROXY_CONFIG } from '../../config/endpoints';
import {
  buildSceneSettingContext,
  buildSeasonPlanDirectives,
  createCharacterBriefFromAnalysis,
  createEpisodeOptions,
  createWorldBriefFromAnalysis,
  getLocationInfoForScene,
} from './planningHelpers';

// Re-export types for consumers
export type { OutputManifest } from '../utils/pipelineOutputWriter';
export type { PipelineEvent } from './events';

/**
 * Normalize a Consequence object to fix common LLM field-name deviations.
 * E.g. { type: 'changeScore', target: 'x', change: 5 } -> score: 'x'
 */
function normalizeConsequence(c: Consequence): Consequence {
  const raw = c as Record<string, unknown>;
  if ((c.type === 'changeScore' || c.type === 'setScore') && !('score' in c) && typeof raw.target === 'string') {
    return { ...(c as Record<string, unknown>), score: raw.target as string } as Consequence;
  }
  if (c.type === 'setFlag' && !('flag' in c) && typeof raw.name === 'string') {
    return { ...(c as Record<string, unknown>), flag: raw.name as string } as Consequence;
  }
  return c;
}

function normalizeConsequences(consequences: Consequence[] | undefined): Consequence[] | undefined {
  if (!consequences || !Array.isArray(consequences)) return consequences;
  return consequences.map(normalizeConsequence);
}

/**
 * Custom error class for pipeline errors with enhanced context
 */
export class PipelineError extends Error {
  public readonly phase: string;
  public readonly agent?: string;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error;

  constructor(
    message: string,
    phase: string,
    options?: {
      agent?: string;
      context?: Record<string, unknown>;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = 'PipelineError';
    this.phase = phase;
    this.agent = options?.agent;
    this.context = options?.context;
    this.originalError = options?.originalError;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PipelineError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      phase: this.phase,
      agent: this.agent,
      context: this.context,
      stack: this.stack,
    };
  }
}

// Full creative brief for complete story generation
export interface FullCreativeBrief {
  // Story foundation
  story: {
    title: string;
    genre: string;
    synopsis: string;
    tone: string;
    themes: string[];
  };

  // World foundation
  world: {
    premise: string;
    timePeriod: string;
    technologyLevel: string;
    magicSystem?: string;
    keyLocations: Array<{
      id: string;
      name: string;
      type: string;
      description: string;
      importance: 'major' | 'minor' | 'backdrop';
    }>;
  };

  // Character foundations
  protagonist: {
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    role: string;
  };

  npcs: Array<{
    id: string;
    name: string;
    role: 'antagonist' | 'ally' | 'neutral' | 'wildcard';
    description: string;
    importance: 'major' | 'supporting' | 'minor';
    relationshipToProtagonist?: string;
  }>;

  // Episode to generate (for single-episode mode)
  episode: {
    number: number;
    title: string;
    synopsis: string;
    startingLocation: string;
    previousSummary?: string;
  };

  // Generation parameters
  options?: {
    targetSceneCount?: number;
    majorChoiceCount?: number;
    runQA?: boolean;
    qaThreshold?: number; // Minimum QA score to pass (default 70)
    maxQARepairPasses?: number; // Maximum QA repair+rerun cycles (default 2)
    bestOfN?: number; // Generate N candidates for critical scenes, keep best (default 1 = off)
    // Incremental validation during content generation
    incrementalValidation?: Partial<IncrementalValidationConfig>;
    // Skip incremental checks already done when running end-of-pipeline QA
    skipRedundantQA?: boolean;
  };

  // Raw document content for agents to reference for additional context
  rawDocument?: string;

  // Manual prompt for guidance
  userPrompt?: string;

  // Active ending directives for this generation
  endingMode?: EndingMode;
  endingTargets?: StoryEndingTarget[];

  // Multi-episode generation options (new)
  multiEpisode?: {
    // If true, analyze source material first to determine episode count
    analyzeSource?: boolean;
    // Pre-computed source analysis (if already done)
    sourceAnalysis?: SourceMaterialAnalysis;
    // Which episodes to generate
    episodeRange?: {
      start: number; // 1-indexed
      end: number;   // inclusive
    };
    // Generation preferences
    preferences?: {
      targetScenesPerEpisode?: number;
      targetChoicesPerEpisode?: number;
      pacing?: 'tight' | 'moderate' | 'expansive';
      endingMode?: EndingMode;
    };
  };

  // Season plan (master blueprint with encounter planning and cross-episode branching)
  seasonPlan?: SeasonPlan;

  // User-provided character reference images (characterId/name -> array of base64 image data)
  // These are used during master image generation to guide the art style for each character
  // Supports multiple reference images per character for better consistency
  characterReferenceImages?: Record<string, Array<{ data: string; mimeType: string }>>;

  // Per-character reference settings (characterId/name -> settings)
  // Controls what traits are extracted from uploaded reference images
  characterReferenceSettings?: Record<string, {
    referenceMode: import('../config').CharacterReferenceMode;
  }>;
}

// Result of source analysis phase (for user to make choices)
export interface SourceAnalysisResult {
  analysis: SourceMaterialAnalysis;
  totalEpisodes: number;
  episodeOutlines: EpisodeOutline[];
  suggestedOptions: Array<{
    count: number;
    description: string;
    episodes: string[]; // Episode titles
  }>;
}

export interface CheckpointData {
  phase: string;
  data: unknown;
  timestamp: Date;
  requiresApproval: boolean;
}

/**
 * Structured brief distilled from a story before rendering its cover / key art.
 *
 * Encodes the movie-poster design principles the renderer is expected to honor:
 * one idea + one focal point, symbols over scenes, a committed compositional
 * structure, deliberate depth cues, bulletproof figure-ground, explicit gaze
 * direction, intentional negative space, limited palette with accent, and a
 * list of clichés to specifically avoid for this story's genre.
 */
export interface PosterConcept {
  /** Single-sentence emotional promise — the half-a-second glance feeling. */
  coreIdea: string;
  /** Iconic symbolic image encoding the core idea. NOT a literal scene. */
  visualMetaphor: string;
  /** The ONE thing the eye hits first — subject, pose, scale, placement. */
  focalSubject: string;
  /** Chosen poster structure. */
  compositionalStructure: PosterCompositionalStructure;
  /** One-sentence justification for choosing this structure for this story. */
  structureRationale: string;
  /** Up to 3 clearly subordinate supporting elements. */
  supportingElements: string[];
  /** Limited palette + any saturated accent, with warm/cool placement for depth. */
  colorStrategy: string;
  /** Where the focal subject is looking (or 'none' if not a person). */
  gazeDirection: PosterGazeDirection;
  /** What the gaze implies. */
  gazeRationale: string;
  /** Where intentional negative space lives and what it communicates. */
  negativeSpaceStrategy: string;
  /** How overlap / linear / atmospheric perspective build 3D space. */
  depthStrategy: string;
  /** How the focal subject separates from background (value, color, or edge). */
  figureGroundStrategy: string;
  /** Clichés at risk for this genre that must be explicitly avoided. */
  clichesAvoided: string[];
  /** What the silhouette reads as at tile size. */
  thumbnailTest: string;
}

export type PosterCompositionalStructure =
  | 'triangular'
  | 'rule-of-thirds'
  | 'radial-symmetry'
  | 'scale-asymmetry'
  | 'silhouette-against-environment'
  | 'overhead'
  | 'worms-eye';

export type PosterGazeDirection = 'direct' | 'off-frame' | 'internal-loop' | 'none';

const POSTER_COMPOSITIONAL_STRUCTURES: readonly PosterCompositionalStructure[] = [
  'triangular',
  'rule-of-thirds',
  'radial-symmetry',
  'scale-asymmetry',
  'silhouette-against-environment',
  'overhead',
  'worms-eye',
];

function normalizeCompositionalStructure(raw: unknown): PosterCompositionalStructure {
  if (typeof raw !== 'string') return 'rule-of-thirds';
  const lower = raw.trim().toLowerCase().replace(/[_\s]/g, '-');
  for (const s of POSTER_COMPOSITIONAL_STRUCTURES) {
    if (lower === s) return s;
  }
  // Accept some common variants the LLM may emit.
  if (/triangl|pyramid/.test(lower)) return 'triangular';
  if (/thirds|rule-of-third/.test(lower)) return 'rule-of-thirds';
  if (/radial|symmetr|centered/.test(lower)) return 'radial-symmetry';
  if (/scale|asymmetr|loom|giant-vs-small|size-diff/.test(lower)) return 'scale-asymmetry';
  if (/silhouette|against-env|against-horizon/.test(lower)) return 'silhouette-against-environment';
  if (/overhead|top-down|birds-eye/.test(lower)) return 'overhead';
  if (/worms?-eye|low-angle|up-shot/.test(lower)) return 'worms-eye';
  return 'rule-of-thirds';
}

export interface FullPipelineResult {
  success: boolean;

  // Generated content
  story?: Story;

  // Intermediate results
  worldBible?: WorldBible;
  characterBible?: CharacterBible;
  episodeBlueprint?: EpisodeBlueprint;
  sceneContents?: SceneContent[];
  choiceSets?: ChoiceSet[];
  encounters?: EncounterStructure[];
  qaReport?: QAReport;

  // Best practices validation
  bestPracticesReport?: ComprehensiveValidationReport;
  quickValidation?: QuickValidationResult;

  // Checkpoints for review
  checkpoints: CheckpointData[];

  // Pipeline metadata
  events: PipelineEvent[];
  error?: string;
  duration?: number;

  // Output files
  outputDirectory?: string;
  outputManifest?: OutputManifest;

  // Multi-episode results (new)
  sourceAnalysis?: SourceMaterialAnalysis;
  generationScope?: GenerationScope;
  multiEpisodeResult?: {
    totalEpisodes: number;
    generatedEpisodes: number;
    remainingEpisodes: number;
    episodeResults: Array<{
      episodeNumber: number;
      title: string;
      success: boolean;
      error?: string;
    }>;
  };

  // Observability report
  pipelineReport?: {
    imageCoverage: {
      totalBeats: number;
      beatsWithImages: number;
      encounterBeatsTotal: number;
      encounterBeatsWithImages: number;
    };
    cacheHitRate: string;
    textArtifactRejections: number;
    transientRetries: number;
    permanentFailures: number;
    choicePayoffPresence: number;
    choicePayoffTotal: number;
    unresolvedTokensDetected: number;
    phaseDurationsMs?: Record<string, number>;
    providerCalls?: {
      totalCalls: number;
      successCalls: number;
      failedCalls: number;
      avgDurationMs: number;
      avgQueueWaitMs: number;
    };
    dependencyScheduler?: {
      hasCycle: boolean;
      waveCount: number;
      fallbackToSerial: boolean;
    };
  };
}

export class FullStoryPipeline {
  private config: PipelineConfig;
  private worldBuilder: WorldBuilder;
  private characterDesigner: CharacterDesigner;
  private storyArchitect: StoryArchitect;
  private sceneWriter: SceneWriter;
  private choiceAuthor: ChoiceAuthor;
  private qaRunner: QARunner;
  private sourceMaterialAnalyzer: SourceMaterialAnalyzer;
  private branchManager: BranchManager;
  private sceneCritic?: SceneCritic;
  private encounterArchitect: EncounterArchitect;
  private encounterImageAgent: EncounterImageAgent;
  private imageAgentTeam: ImageAgentTeam;
  public imageService: ImageGenerationService;
  public audioService: AudioGenerationService;
  public videoService: VideoGenerationService;
  private videoDirectorAgent: VideoDirectorAgent;

  // Validators
  private integratedValidator: IntegratedBestPracticesValidator;
  private npcDepthValidator: NPCDepthValidator;
  private phaseValidator: PhaseValidator;
  private distributionValidator: ChoiceDistributionValidator = new ChoiceDistributionValidator();
  
  // Incremental validation (per-scene during content generation)
  private incrementalValidator: IncrementalValidationRunner | null = null;
  private sceneValidationResults: SceneValidationResult[] = [];

  // Per-encounter telemetry, populated from EncounterArchitect.execute()'s
  // response metadata. Persisted via pipelineOutputWriter so we can later
  // analyze per-phase success rates and LLM cost (I2 instrumentation).
  private encounterTelemetry: EncounterTelemetry[] = [];

  // Shadow-mode diffs between the LLM `BranchManager` and the deterministic
  // `analyzeBranchTopology` pass. Populated only when
  // `config.generation.branchShadowModeEnabled` is true; persisted as a
  // sidecar via pipelineOutputWriter so D4 (BranchManager gating) can be
  // decided from data rather than intuition (I5 instrumentation).
  private branchShadowDiffs: Array<{
    episodeId: string;
    diff: import('../utils/branchShadowDiff').BranchShadowDiff;
  }> = [];

  private events: PipelineEvent[] = [];
  private checkpoints: CheckpointData[] = [];
  private eventHandler?: PipelineEventHandler;

  // Job tracking
  private jobId: string | null = null;
  private externallyAssignedJobId: string | null = null;
  private _cancelled = false;
  private currentEpisode: number = 0;
  private totalEpisodes: number = 1;
  private cachedPipelineMemory: string | null = null;

  /**
   * Paths (relative or absolute) to the three style-bible anchor images,
   * whether preapproved by the UI or generated in `generateEpisodeStyleBible`.
   * Persisted onto `Story.styleAnchors` so single-image regenerations and
   * session resumes can re-prime `setGeminiStyleReference` without
   * rebuilding the style bible from scratch.
   */
  private _styleAnchorPaths: {
    character?: string;
    arcStrip?: string;
    environment?: string;
  } = {};

  /**
   * Lazily-created LoRA training plumbing. We construct it the first time a
   * pipeline run reaches a training trigger, so runs on providers that don't
   * support LoRAs never pay for the registry filesystem ops.
   */
  private _loraTrainingAgent?: LoraTrainingAgent;
  private _loraRegistry?: LoraRegistry;
  /** Remembers whether we've already emitted an "enabled/skipped" banner. */
  private _loraTrainingBanner = false;

  // Visual planning outputs collection
  private collectedVisualPlanning: {
    colorScript?: ColorScript;
    characterReferences: Map<string, {
      characterId: string;
      characterName: string;
      poseSheet?: GeneratedReferenceSheet;
      expressionSheet?: import('../agents/image-team/CharacterReferenceSheetAgent').CharacterExpressionSheet;
      generatedExpressionSheet?: GeneratedExpressionSheet;
      bodyVocabulary?: import('../agents/image-team/CharacterReferenceSheetAgent').CharacterBodyVocabulary;
      silhouetteProfile?: import('../agents/image-team/CharacterReferenceSheetAgent').CharacterSilhouetteProfile;
    }>;
    visualPlans: VisualPlan[];
  } = {
    characterReferences: new Map(),
    visualPlans: []
  };
  private telemetry: PipelineTelemetry = new PipelineTelemetry();
  private pipelineStartedAtMs: number = 0;
  private lastTelemetryOverallProgress: number = 0;
  private imageWorkerQueue: LocalWorkerQueue;
  private audioWorkerQueue: LocalWorkerQueue;
  private videoWorkerQueue: LocalWorkerQueue;
  /**
   * A10: Promise for a pre-warmed color script. Seeded before
   * `runMasterImageGeneration` so the color-script LLM call overlaps with
   * master image generation. `runEpisodeImageGeneration` consumes the
   * promise when it exists instead of kicking off a fresh call.
   */
  private _preWarmedColorScriptPromise: Promise<ColorScript | undefined> | null = null;
  /**
   * A3 (narrow): Results of the optional parallel scene-opening-beat
   * prefetch phase, keyed by the canonical beat identifier. Populated by
   * `prefetchSceneOpeningBeats` when
   * `EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS` is enabled; consumed by the
   * main scene loop in `runEpisodeImageGeneration` at beat 0 of each
   * scene. Entries point at resolved `GeneratedImage` objects (the
   * prefetch phase awaits Promise.allSettled before the main loop runs,
   * so no live Promises are stored here).
   */
  private _openingBeatPrefetch: Map<string, GeneratedImage> = new Map();
  private locationMasterShots = new Map<string, { data: string; mimeType: string }>();
  private assetRegistry: AssetRegistry = new AssetRegistry();
  // Callback ledger for Witcher-style delayed consequences (Plan 1). Seeded by
  // choices' `memorableMoment` fields and consumed as prompt context for
  // later episodes. Persisted to `09-callback-ledger.json`.
  private callbackLedger: CallbackLedger = new CallbackLedger();
  private completedPhases = new Set<string>();
  private dependencySchedulerStats = {
    hasCycle: false,
    waveCount: 0,
    fallbackToSerial: false,
  };

  constructor(config?: PipelineConfig) {
    this.config = config || loadConfig();
    BaseAgent.configureGuardrails({
      maxGlobalInFlight: this.config.generation?.llmMaxGlobalInFlight ?? CONCURRENCY_DEFAULTS.maxGlobalLlmInFlight,
      maxPerProviderInFlight: this.config.generation?.llmMaxPerProviderInFlight ?? CONCURRENCY_DEFAULTS.maxPerProviderLlmInFlight,
      backoffJitterRatio: this.config.generation?.llmBackoffJitterRatio ?? CONCURRENCY_DEFAULTS.llmBackoffJitterRatio,
    });
    BaseAgent.setLlmCallObserver((observation: LlmCallObservation) => {
      this.telemetry.observeProviderCall({
        agentName: observation.agentName,
        provider: observation.provider,
        success: observation.success,
        durationMs: observation.durationMs,
        queueWaitMs: observation.queueWaitMs,
        attempt: observation.attempt,
        error: observation.error,
      });
    });
    // A5: default image worker mode ON. The per-provider throttle in
    // ImageGenerationService now enforces its own rate limits per provider,
    // so running beat image work concurrently is safe and much faster.
    // A caller can still opt out by explicitly setting `imageWorkerModeEnabled: false`.
    const imageWorkerModeEnabled = this.config.generation?.imageWorkerModeEnabled !== false;
    const imageWorkerConcurrency = imageWorkerModeEnabled
      ? Math.max(1, Math.min(4, this.config.generation?.maxParallelScenes ?? CONCURRENCY_DEFAULTS.maxParallelScenes))
      : 1;
    this.imageWorkerQueue = new LocalWorkerQueue(imageWorkerConcurrency);
    this.audioWorkerQueue = new LocalWorkerQueue(this.config.generation?.audioWorkerModeEnabled ? 2 : 1);
    if (this.config.generation?.cloudModeEnabled && this.config.generation?.cloudQueueEndpoint) {
      this.emit({
        type: 'debug',
        phase: 'init',
        message: `Cloud queue endpoint configured (${this.config.generation.cloudQueueEndpoint}); local worker mode remains active until cloud adapter is enabled.`,
      });
    }

    // Ensure validation config exists with defaults
    if (!this.config.validation) {
      this.config.validation = defaultValidationConfig;
    } else if (!this.config.validation.rules) {
      this.config.validation.rules = defaultValidationConfig.rules;
    }

    // Initialize all agents
    this.worldBuilder = new WorldBuilder(this.config.agents.storyArchitect);
    this.characterDesigner = new CharacterDesigner(this.config.agents.storyArchitect);
    this.storyArchitect = new StoryArchitect(this.config.agents.storyArchitect, this.config.generation);
    this.sceneWriter = new SceneWriter(this.config.agents.sceneWriter, this.config.generation);
    this.choiceAuthor = new ChoiceAuthor(this.config.agents.choiceAuthor, this.config.generation);
    this.qaRunner = new QARunner(this.config.agents.storyArchitect);
    const sourceMaterialConfig = { ...this.config.agents.storyArchitect, maxTokens: 16384 };
    this.sourceMaterialAnalyzer = new SourceMaterialAnalyzer(sourceMaterialConfig);
    this.branchManager = new BranchManager(this.config.agents.storyArchitect);
    if (this.config.sceneCritic?.enabled) {
      this.sceneCritic = new SceneCritic(this.config.agents.sceneWriter);
    }
    const encounterArchitectConfig = { ...this.config.agents.storyArchitect, maxTokens: 16384 };
    this.encounterArchitect = new EncounterArchitect(encounterArchitectConfig);
    this.encounterImageAgent = new EncounterImageAgent(this.config.agents.storyArchitect, this.config.artStyle);

    // Initialize image generation team and service
    this.imageAgentTeam = new ImageAgentTeam(
      this.config.agents.imagePlanner || this.config.agents.storyArchitect,
      this.config.artStyle
    );
    // Wire identity consistency gate thresholds from config.
    this.imageAgentTeam.setIdentityGateConfig({
      identityScoreThreshold: this.config.imageGen?.identityScoreThreshold,
      maxIdentityRegenerations: this.config.imageGen?.maxIdentityRegenerations,
      resetIdentityBudget: true,
    });
    this.imageService = new ImageGenerationService({
      ...(this.config.imageGen || { enabled: false }),
      geminiApiKey: this.config.imageGen?.geminiApiKey || this.config.imageGen?.apiKey,
      openaiApiKey: this.config.imageGen?.openaiApiKey,
      openaiImageModel: this.config.imageGen?.openaiImageModel,
      midjourneySettings: this.config.imageGen?.midjourney || this.config.midjourneySettings,
      geminiSettings: this.config.imageGen?.gemini || this.config.geminiSettings,
      stableDiffusionSettings: this.config.imageGen?.stableDiffusion,
      failurePolicy: this.getFailurePolicy(),
    });
    // C4: install the structured art-style profile (if any) so prompt
    // strengthening can operate bidirectionally on style-inappropriate /
    // style-positive vocabulary rather than applying only cinematic defaults.
    if (this.config.imageGen?.artStyleProfile) {
      this.imageService.setArtStyleProfile(this.config.imageGen.artStyleProfile);
    }
    
    // Initialize audio generation service
    this.audioService = new AudioGenerationService(this.config.narration?.elevenLabsApiKey);

    // Initialize video generation service and director agent
    const videoConfig = this.config.videoGen || { enabled: false };
    this.videoService = new VideoGenerationService({
      enabled: videoConfig.enabled,
      apiKey: videoConfig.apiKey,
      model: videoConfig.model,
      durationSeconds: videoConfig.durationSeconds,
      resolution: videoConfig.resolution,
      aspectRatio: videoConfig.aspectRatio,
      maxConcurrent: videoConfig.maxConcurrent,
    });
    this.videoDirectorAgent = new VideoDirectorAgent(
      this.config.agents.videoDirector || this.config.agents.storyArchitect,
      this.config.artStyle
    );
    this.videoWorkerQueue = new LocalWorkerQueue(videoConfig.maxConcurrent ?? 2);

    // Initialize validators
    this.integratedValidator = new IntegratedBestPracticesValidator(
      this.config.agents.storyArchitect,
      this.config.validation
    );
    this.npcDepthValidator = new NPCDepthValidator(this.config.validation.rules.npcDepth);
    this.phaseValidator = new PhaseValidator({
      enableRetry: true,
      maxRetries: 2,
      blockingThreshold: 40,
      warningThreshold: 70,
    });
  }

  private async measurePhase<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    this.telemetry.startPhase(phase);
    try {
      return await fn();
    } finally {
      this.telemetry.endPhase(phase);
    }
  }

  private requirePhases(phase: string, prerequisites: string[]): void {
    const missing = prerequisites.filter((req) => !this.completedPhases.has(req));
    if (missing.length > 0) {
      throw new PipelineError(
        `Phase dependency violation for "${phase}". Missing prerequisites: ${missing.join(', ')}`,
        'phase_dependencies',
        { context: { phase, missing } }
      );
    }
  }

  private markPhaseComplete(phase: string): void {
    this.completedPhases.add(phase);
  }

  private getFailurePolicy(): 'fail_fast' | 'recover' {
    return this.config.generation?.failurePolicy === 'recover' ? 'recover' : 'fail_fast';
  }

  private isFailFastEnabled(): boolean {
    return this.getFailurePolicy() === 'fail_fast';
  }

  private throwIfFailFast(
    message: string,
    phase: string,
    options?: {
      agent?: string;
      context?: Record<string, unknown>;
      originalError?: Error;
    }
  ): void {
    if (!this.isFailFastEnabled()) return;
    throw new PipelineError(message, phase, options);
  }

  private assertSceneDependencyInvariants(blueprint: EpisodeBlueprint, sceneContents: SceneContent[]): void {
    const generatedIds = new Set(sceneContents.map((scene) => scene.sceneId));
    for (const scene of blueprint.scenes) {
      if (!generatedIds.has(scene.id)) {
        throw new PipelineError(
          `Invariant violation: missing generated scene for blueprint scene "${scene.id}"`,
          'content_generation'
        );
      }
      for (const nextSceneId of scene.leadsTo || []) {
        const targetExists = blueprint.scenes.some((s) => s.id === nextSceneId);
        if (!targetExists) {
          throw new PipelineError(
            `Invariant violation: leadsTo target "${nextSceneId}" does not exist in episode blueprint`,
            'content_generation',
            { context: { sceneId: scene.id, nextSceneId } }
          );
        }
      }
    }
  }

  private assertEpisodeOrderingInvariants(
    episodes: Episode[],
    episodeResults: Array<{ episodeNumber: number; title: string; success: boolean; error?: string }>
  ): void {
    const numbers = episodes.map((ep) => ep.number || 0);
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] < numbers[i - 1]) {
        throw new PipelineError(
          `Invariant violation: episode ordering is non-deterministic (${numbers[i - 1]} before ${numbers[i]})`,
          'episode_parallelism'
        );
      }
    }
    const duplicateResultNumbers = episodeResults
      .map((r) => r.episodeNumber)
      .filter((n, idx, arr) => arr.indexOf(n) !== idx);
    if (duplicateResultNumbers.length > 0) {
      throw new PipelineError(
        `Invariant violation: duplicate episode results for episode numbers ${duplicateResultNumbers.join(', ')}`,
        'episode_parallelism'
      );
    }
  }

  onEvent(handler: PipelineEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Allows callers (UI/worker orchestrators) to force a specific job id so
   * cancellation/progress polling use a single shared id.
   */
  setExternalJobId(jobId: string): void {
    this.externallyAssignedJobId = jobId;
  }

  getCurrentJobId(): string | null {
    return this.jobId;
  }

  /**
   * Signal the pipeline to stop as soon as possible.
   * The next checkCancellation() call will throw JobCancelledError.
   */
  cancel(): void {
    this._cancelled = true;
  }

  /**
   * Validate the creative brief before generation
   */
  private validateBrief(brief: FullCreativeBrief): void {
    const errors: string[] = [];
    
    // Required story fields
    if (!brief.story?.title || brief.story.title.trim() === '') {
      errors.push('Story title is required');
    }
    if (!brief.story?.genre) {
      errors.push('Story genre is required');
    }
    
    // Required protagonist fields
    if (!brief.protagonist?.id || brief.protagonist.id.trim() === '') {
      errors.push('Protagonist ID is required');
    }
    if (!brief.protagonist?.name || brief.protagonist.name.trim() === '') {
      errors.push('Protagonist name is required');
    }
    
    // Required episode fields  
    if (!brief.episode) {
      errors.push('Episode configuration is required');
    }
    
    // Check for duplicate NPC IDs
    if (brief.npcs && brief.npcs.length > 0) {
      const npcIds = brief.npcs.map(n => n.id);
      const duplicateIds = npcIds.filter((id, idx) => npcIds.indexOf(id) !== idx);
      if (duplicateIds.length > 0) {
        errors.push(`Duplicate NPC IDs found: ${duplicateIds.join(', ')}`);
      }
      
      // Check if protagonist ID conflicts with NPC IDs
      if (brief.protagonist?.id && npcIds.includes(brief.protagonist.id)) {
        errors.push(`Protagonist ID "${brief.protagonist.id}" conflicts with an NPC ID`);
      }
    }
    
    // Check world locations
    if (brief.world?.keyLocations && brief.world.keyLocations.length > 0) {
      const locationIds = brief.world.keyLocations.map(l => l.id);
      const duplicateLocations = locationIds.filter((id, idx) => locationIds.indexOf(id) !== idx);
      if (duplicateLocations.length > 0) {
        errors.push(`Duplicate location IDs found: ${duplicateLocations.join(', ')}`);
      }
    }
    
    // Throw if any validation errors
    if (errors.length > 0) {
      const errorMessage = `Creative brief validation failed:\n- ${errors.join('\n- ')}`;
      this.emit({ type: 'error', message: errorMessage });
      throw new Error(errorMessage);
    }
  }

  private normalizeTelemetryPhase(phase?: string): string {
    if (!phase) return 'initialization';
    if (phase === 'multi_episode_init') return 'initialization';
    if (phase === 'episode_parallelism') return 'content';
    if (/^episode_\d+$/.test(phase)) return 'content';
    if (phase.startsWith('qa_ep_')) return 'qa';
    if (phase.startsWith('images_ep_')) return 'images';
    if (phase === 'image_manifest') return 'images';
    return phase;
  }

  private getTelemetryPhaseBounds(phase: string): [number, number] {
    const bounds: Record<string, [number, number]> = {
      initialization: [0, 4],
      source_analysis: [4, 10],
      foundation: [10, 24],
      world: [10, 22],
      characters: [22, 34],
      npc_validation: [34, 38],
      architecture: [38, 48],
      branch_analysis: [48, 54],
      content: [54, 72],
      quick_validation: [72, 76],
      qa: [76, 82],
      master_images: [82, 88],
      images: [88, 93],
      encounter_images: [93, 95],
      video_generation: [95, 97],
      assembly: [97, 98],
      saving: [98, 99],
      audio_generation: [99, 100],
      complete: [100, 100],
    };
    return bounds[phase] || [this.lastTelemetryOverallProgress, Math.min(100, this.lastTelemetryOverallProgress + 1)];
  }

  private emitPhaseProgress(
    phase: string,
    currentItem: number,
    totalItems: number,
    subphaseLabel: string,
    message?: string,
    extraData?: Record<string, unknown>
  ): void {
    const safeTotal = Math.max(1, totalItems);
    const safeCurrent = Math.max(0, Math.min(currentItem, safeTotal));
    this.emit({
      type: 'debug',
      phase,
      message: message || `${subphaseLabel} ${safeCurrent}/${safeTotal}`,
      data: {
        currentItem: safeCurrent,
        totalItems: safeTotal,
        subphaseLabel,
        ...extraData,
      },
    });
  }

  private buildProgressTelemetry(event: Omit<PipelineEvent, 'timestamp'>): PipelineProgressTelemetry | undefined {
    const phase = this.normalizeTelemetryPhase(event.phase);
    const [phaseStart, phaseEnd] = this.getTelemetryPhaseBounds(phase);
    const raw = event.data as any;
    const elapsedSeconds = this.pipelineStartedAtMs > 0
      ? Math.max(0, Math.round((Date.now() - this.pipelineStartedAtMs) / 1000))
      : undefined;

    let currentItem: number | undefined;
    let totalItems: number | undefined;
    let subphaseLabel: string | undefined;
    let phaseProgress: number | undefined;

    if (raw && typeof raw === 'object') {
      if (typeof raw.imageIndex === 'number' && typeof raw.totalImages === 'number' && raw.totalImages > 0) {
        currentItem = raw.imageIndex;
        totalItems = raw.totalImages;
        subphaseLabel = raw.sceneId ? `images:${raw.sceneId}` : 'images';
      } else if (typeof raw.currentItem === 'number' && typeof raw.totalItems === 'number' && raw.totalItems > 0) {
        currentItem = raw.currentItem;
        totalItems = raw.totalItems;
        subphaseLabel = typeof raw.subphaseLabel === 'string' ? raw.subphaseLabel : undefined;
      } else if (typeof raw.completed === 'number' && typeof raw.total === 'number' && raw.total > 0) {
        currentItem = raw.completed;
        totalItems = raw.total;
        subphaseLabel = typeof raw.subphaseLabel === 'string' ? raw.subphaseLabel : undefined;
      }
    }

    if (event.type === 'phase_start') {
      phaseProgress = 0;
    } else if (event.type === 'phase_complete') {
      phaseProgress = 100;
    } else if (currentItem !== undefined && totalItems !== undefined && totalItems > 0) {
      phaseProgress = Math.max(0, Math.min(100, Math.round((currentItem / totalItems) * 100)));
    }

    let overallProgress = this.lastTelemetryOverallProgress;
    if (phaseProgress !== undefined) {
      overallProgress = Math.round(phaseStart + ((phaseEnd - phaseStart) * (phaseProgress / 100)));
    } else if (event.type === 'phase_start') {
      overallProgress = phaseStart;
    } else if (event.type === 'phase_complete') {
      overallProgress = phaseEnd;
    } else {
      overallProgress = Math.max(overallProgress, phaseStart);
    }

    overallProgress = Math.max(this.lastTelemetryOverallProgress, Math.min(100, overallProgress));
    this.lastTelemetryOverallProgress = overallProgress;

    let etaSeconds: number | null | undefined = undefined;
    if (elapsedSeconds !== undefined && overallProgress > 1 && overallProgress < 100) {
      const rate = overallProgress / Math.max(1, elapsedSeconds);
      etaSeconds = rate > 0 ? Math.round((100 - overallProgress) / rate) : null;
    }

    return {
      overallProgress,
      phaseProgress,
      currentItem,
      totalItems,
      subphaseLabel,
      etaSeconds,
      elapsedSeconds,
    };
  }

  private emit(event: Omit<PipelineEvent, 'timestamp'>): void {
    const telemetry = event.telemetry || this.buildProgressTelemetry(event);
    const fullEvent: PipelineEvent = { ...event, telemetry, timestamp: new Date() };
    this.events.push(fullEvent);
    if (this.eventHandler) {
      this.eventHandler(fullEvent);
    }
    if (this.config.debug) {
      console.log(`[${event.type}] ${event.message}`);
    }
  }

  private addCheckpoint(phase: string, data: unknown, requiresApproval: boolean): void {
    const checkpoint: CheckpointData = {
      phase,
      data,
      timestamp: new Date(),
      requiresApproval,
    };
    this.checkpoints.push(checkpoint);
    const stepId = this.mapCheckpointPhaseToStepId(phase);
    if (stepId) {
      this.emit({
        type: 'checkpoint',
        phase: stepId,
        message: `Checkpoint committed: ${phase}`,
        data: {
          stepId,
          artifactKey: `checkpoint:${stepId}`,
          output: data,
          requiresApproval,
        },
      });
    }
  }

  private mapCheckpointPhaseToStepId(phase: string): string | null {
    switch (phase) {
      case 'World Bible':
        return 'world_bible';
      case 'Character Bible':
        return 'character_bible';
      case 'Episode Blueprint':
        return 'episode_blueprint';
      case 'Scene Content':
        return 'scene_content';
      case 'Final Story':
        return 'final_story';
      case 'Output Directory':
        return 'output_directory';
      default:
        return null;
    }
  }

  private getResumeOutput<T>(
    resumeCheckpoint: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> } | undefined,
    stepId: string
  ): T | undefined {
    if (resumeCheckpoint?.steps?.[stepId]?.status !== 'completed') return undefined;
    return resumeCheckpoint.outputs?.[stepId] as T | undefined;
  }

  private getEpisodeScopedSceneId(brief: FullCreativeBrief, sceneId: string): string {
    const episodeNumber = typeof brief.episode?.number === 'number' ? brief.episode.number : 0;
    return `episode-${episodeNumber}-${sceneId}`;
  }

  private getEpisodeScopedBeatKey(brief: FullCreativeBrief, sceneId: string, beatId: string): string {
    return `${this.getEpisodeScopedSceneId(brief, sceneId)}::${beatId}`;
  }

  private resetAssetRegistry(storyId?: string, persistPath?: string): void {
    this.assetRegistry = new AssetRegistry(storyId, undefined, persistPath);
  }

  private registerStoryImageSlots(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
  ): void {
    for (const scene of sceneContents) {
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, scene.sceneId);
      const manifest = buildStoryImageSlotManifest(scene, scopedSceneId);
      for (const slot of manifest.slots) {
        this.assetRegistry.planSlot(slot);
        if (slot.family === 'story-beat' && slot.beatId) {
          const url = imageResults?.beatImages.get(`${scopedSceneId}::${slot.beatId}`);
          if (url) {
            this.assetRegistry.markSuccess(slot.slotId, {
              prompt: { prompt: `registry-seeded ${slot.slotId}` },
              imageUrl: url,
              imagePath: url,
            });
          }
          continue;
        }

        if (slot.family === 'story-scene') {
          const url = imageResults?.sceneImages.get(scopedSceneId)
            || (slot.beatId ? imageResults?.beatImages.get(`${scopedSceneId}::${slot.beatId}`) : undefined);
          if (url) {
            this.assetRegistry.markSuccess(slot.slotId, {
              prompt: { prompt: `registry-seeded ${slot.slotId}` },
              imageUrl: url,
              imagePath: url,
            });
          }
        }
      }
    }
  }

  private createEncounterRegistrySlot(slot: {
    kind: 'setup' | 'outcome' | 'situation';
    sceneId: string;
    scopedSceneId: string;
    beatId: string;
    choiceMapKey: string;
    tier?: 'success' | 'complicated' | 'failure';
    situationKey?: string;
    treeDepth: number;
    baseIdentifier: string;
  }): ImageSlot {
    const family: ImageSlotFamily =
      slot.kind === 'setup'
        ? 'encounter-setup'
        : slot.kind === 'outcome'
          ? 'encounter-outcome'
          : 'encounter-situation';
    return {
      slotId: `${family}:${slot.scopedSceneId}::${slot.beatId}::${slot.choiceMapKey || 'root'}::${slot.tier || 'setup'}`,
      family,
      imageType: slot.kind === 'setup' ? 'encounter-setup' : 'encounter-outcome',
      sceneId: slot.sceneId,
      scopedSceneId: slot.scopedSceneId,
      beatId: slot.beatId,
      choiceMapKey: slot.choiceMapKey,
      outcomeTier: slot.tier,
      situationKey: slot.situationKey,
      storyFieldPath:
        slot.kind === 'setup'
          ? `episodes[].scenes[id=${slot.sceneId}].encounter.phases[].beats[id=${slot.beatId}].situationImage`
          : slot.kind === 'outcome'
            ? `episodes[].scenes[id=${slot.sceneId}].encounter.choices[path=${slot.choiceMapKey}].outcomes.${slot.tier}.outcomeImage`
            : `episodes[].scenes[id=${slot.sceneId}].encounter.choices[path=${slot.choiceMapKey}].outcomes.${slot.tier}.nextSituation.situationImage`,
      baseIdentifier: slot.baseIdentifier,
      required: true,
      qualityTier: 'critical',
      coverageKey:
        slot.kind === 'setup'
          ? `setup:${slot.sceneId}::${slot.beatId}`
          : slot.kind === 'outcome'
            ? `outcome:${slot.sceneId}::${slot.beatId}::${slot.choiceMapKey}::${slot.tier}`
            : `situation:${slot.sceneId}::${slot.situationKey}`,
      metadata: {
        treeDepth: slot.treeDepth,
      },
    };
  }

  private registerEncounterImageSlots(
    brief: FullCreativeBrief,
    encounters: Map<string, EncounterStructure>,
    encounterImageResults?: {
      encounterImages: Map<string, {
        setupImages: Map<string, string>;
        outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
      }>;
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
  ): void {
    for (const [sceneId, encounter] of encounters.entries()) {
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);
      const manifest = buildEncounterSlotManifest(encounter, sceneId, scopedSceneId);
      const sceneImages = encounterImageResults?.encounterImages.get(sceneId);
      for (const slot of manifest.slots) {
        const registrySlot = this.createEncounterRegistrySlot(slot);
        this.assetRegistry.planSlot(registrySlot);
        let url: string | undefined;
        if (slot.kind === 'setup') {
          url = sceneImages?.setupImages.get(slot.beatId);
        } else if (slot.kind === 'situation') {
          url = slot.situationKey
            ? sceneImages?.setupImages.get(slot.situationKey)
              || sceneImages?.setupImages.get(legacyEncounterSituationKey(slot.choiceMapKey, slot.tier || ''))
            : undefined;
        } else if (slot.kind === 'outcome' && slot.tier) {
          url = sceneImages?.outcomeImages.get(slot.choiceMapKey)?.[slot.tier];
        }
        if (url) {
          this.assetRegistry.markSuccess(registrySlot.slotId, {
            prompt: { prompt: `registry-seeded ${registrySlot.slotId}` },
            imageUrl: url,
            imagePath: url,
          });
        }
      }
    }
  }

  private registerStoryletImageSlots(
    brief: FullCreativeBrief,
    encounters: Map<string, EncounterStructure>,
    encounterImageResults?: {
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
  ): void {
    for (const [sceneId, encounter] of encounters.entries()) {
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);
      const manifest = buildStoryletSlotManifest(encounter.storylets as any, sceneId, scopedSceneId);
      const sceneStoryletImages = encounterImageResults?.storyletImages?.get(sceneId);
      for (const slot of manifest.slots) {
        const registrySlot: ImageSlot = {
          slotId: `storylet-aftermath:${scopedSceneId}::${slot.outcomeName}::${slot.beatId}`,
          family: 'storylet-aftermath',
          imageType: 'storylet-aftermath',
          sceneId,
          scopedSceneId,
          beatId: slot.beatId,
          outcomeName: slot.outcomeName,
          storyFieldPath: `episodes[].scenes[id=${sceneId}].encounter.storylets.${slot.outcomeName}.beats[id=${slot.beatId}].image`,
          baseIdentifier: slot.baseIdentifier,
          required: true,
          qualityTier: 'critical',
          coverageKey: slot.coverageKey,
        };
        this.assetRegistry.planSlot(registrySlot);
        const url = sceneStoryletImages?.get(slot.outcomeName)?.get(slot.beatId);
        if (url) {
          this.assetRegistry.markSuccess(registrySlot.slotId, {
            prompt: { prompt: `registry-seeded ${registrySlot.slotId}` },
            imageUrl: url,
            imagePath: url,
          });
        }
      }
    }
  }

  private seedAssetRegistryFromResults(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    encounters: Map<string, EncounterStructure>,
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounterImageResults?: {
      encounterImages: Map<string, {
        setupImages: Map<string, string>;
        outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
      }>;
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
  ): void {
    this.registerStoryImageSlots(brief, sceneContents, imageResults);
    this.registerEncounterImageSlots(brief, encounters, encounterImageResults);
    this.registerStoryletImageSlots(brief, encounters, encounterImageResults);
  }

  /**
   * Check if the current job has been cancelled by the user
   */
  private async checkCancellation(): Promise<void> {
    if (this._cancelled) {
      throw new JobCancelledError(this.jobId || 'unknown');
    }
    if (this.jobId) {
      const cancelled = await isJobCancelled(this.jobId);
      if (cancelled) {
        this._cancelled = true;
        throw new JobCancelledError(this.jobId);
      }
    }
  }

  /**
   * Update the job's current phase and progress
   */
  private async updateJobProgress(phase: string, progress?: number): Promise<void> {
    if (this.jobId) {
      await updateJob(this.jobId, {
        currentPhase: phase,
        progress: progress ?? 0,
        currentEpisode: this.currentEpisode,
      });
    }
  }

  /**
   * Generate a complete story from a creative brief
   */
  async generate(
    brief: FullCreativeBrief,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> }
  ): Promise<FullPipelineResult> {
    // Input validation
    this.validateBrief(brief);
    
    this.events = [];
    this.checkpoints = [];
    this.telemetry = new PipelineTelemetry();
    this.pipelineStartedAtMs = Date.now();
    this.lastTelemetryOverallProgress = 0;
    this.completedPhases = new Set<string>();
    this.dependencySchedulerStats = {
      hasCycle: false,
      waveCount: 0,
      fallbackToSerial: false,
    };
    this.resetCollectedVisualPlanning(); // Reset visual planning collection for new run
    const startTime = Date.now();

    // Register this generation job for tracking
    this.jobId = this.externallyAssignedJobId || generateJobId();
    this.externallyAssignedJobId = null;
    this.totalEpisodes = 1;
    this.currentEpisode = 1;
    await registerJob({
      id: this.jobId,
      storyTitle: brief.story.title,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'initialization',
      progress: 0,
      episodeCount: this.totalEpisodes,
      currentEpisode: this.currentEpisode,
    });

    try {
      // Read pipeline optimization memory (prior generation insights)
      this.cachedPipelineMemory = await this.readPipelineMemory();
      if (this.cachedPipelineMemory) {
        this.emit({ type: 'debug', phase: 'initialization', message: `Loaded pipeline optimization memory (${this.cachedPipelineMemory.length} chars)` });
      }

      // === PHASE 1: WORLD BUILDING ===
      await this.checkCancellation();
      await this.updateJobProgress('world_building', 5);
      this.emit({ type: 'phase_start', phase: 'world', message: 'Phase 1: Building world' });
      const resumedWorldBible = this.getResumeOutput<WorldBible>(resumeCheckpoint, 'world_bible');
      let worldBible: WorldBible = resumedWorldBible
        ? resumedWorldBible
        : await this.measurePhase('world_building', () => this.runWorldBuilding(brief));
      this.markPhaseComplete('world_building');
      if (resumedWorldBible) {
        this.emit({ type: 'debug', phase: 'world', message: 'Resumed from durable world bible checkpoint' });
      } else {
        this.addCheckpoint('World Bible', worldBible, true);
      }

      // Phase validation with retry loop for world building
      if (this.phaseValidator.isEnabled() && !resumedWorldBible) {
        let worldValidation = this.phaseValidator.validateWorldBible(worldBible);
        let worldRetryCount = 0;
        const worldMaxRetries = this.phaseValidator.getMaxRetries();

        while (!worldValidation.canProceed && this.phaseValidator.canRetry('world_building') && worldRetryCount < worldMaxRetries) {
          worldRetryCount++;
          this.emit({
            type: 'regeneration_triggered',
            phase: 'world',
            message: `World building validation failed (${worldValidation.score}/100), retry ${worldRetryCount}/${worldMaxRetries}: ${worldValidation.summary}`,
          });
          const retryWorldBible = await this.measurePhase(`world_building_retry_${worldRetryCount}`, () => this.runWorldBuilding(brief));
          const retryValidation = this.phaseValidator.validateWorldBible(retryWorldBible);
          if (retryValidation.score > worldValidation.score) {
            worldBible = retryWorldBible;
            worldValidation = retryValidation;
            this.addCheckpoint('World Bible', worldBible, true);
            this.emit({ type: 'debug', phase: 'world', message: `World retry ${worldRetryCount} improved score: ${worldValidation.score} -> ${retryValidation.score}` });
          }
          if (worldValidation.canProceed) break;
        }

        if (!worldValidation.valid) {
          this.emit({
            type: 'warning',
            phase: 'world',
            message: this.phaseValidator.formatResult(worldValidation),
          });
        }
      }

      // If no starting location was specified, use the first generated location
      if (!brief.episode.startingLocation && worldBible.locations.length > 0) {
        brief.episode.startingLocation = worldBible.locations[0].id;
        this.emit({ type: 'debug', phase: 'world', message: `Set starting location to first generated: ${brief.episode.startingLocation}` });
      }

      // === PHASE 2: CHARACTER DESIGN ===
      await this.checkCancellation();
      this.emit({ type: 'phase_start', phase: 'characters', message: 'Phase 2: Designing characters' });
      this.requirePhases('character_design', ['world_building']);
      const resumedCharacterBible = this.getResumeOutput<CharacterBible>(resumeCheckpoint, 'character_bible');
      const characterBible: CharacterBible = resumedCharacterBible
        ? resumedCharacterBible
        : await this.measurePhase('character_design', () => this.runCharacterDesign(brief, worldBible));
      this.markPhaseComplete('character_design');
      if (resumedCharacterBible) {
        this.emit({ type: 'debug', phase: 'characters', message: 'Resumed from durable character bible checkpoint' });
      } else {
        this.addCheckpoint('Character Bible', characterBible, true);
      }

      // === PHASE 2.3: CHARACTER BIBLE STRUCTURAL VALIDATION (Phase 2.5 of plan) ===
      if (this.phaseValidator.isEnabled() && !resumedCharacterBible) {
        let charValidation = this.phaseValidator.validateCharacterBible(
          characterBible,
          brief.protagonist?.id,
        );
        let charRetryCount = 0;
        const charMaxRetries = this.phaseValidator.getMaxRetries();

        while (
          !charValidation.canProceed &&
          this.phaseValidator.canRetry('character_design') &&
          charRetryCount < charMaxRetries
        ) {
          charRetryCount++;
          this.emit({
            type: 'regeneration_triggered',
            phase: 'characters',
            message: `Character bible validation failed (${charValidation.score}/100), retry ${charRetryCount}/${charMaxRetries}: ${charValidation.summary}`,
            data: charValidation.issues,
          });

          try {
            const retryBible = await this.measurePhase('character_design_retry', () =>
              this.runCharacterDesign(brief, worldBible),
            );
            const retryValidation = this.phaseValidator.validateCharacterBible(
              retryBible,
              brief.protagonist?.id,
            );
            if (retryValidation.score > charValidation.score) {
              Object.assign(characterBible, retryBible);
              charValidation = retryValidation;
              this.addCheckpoint('Character Bible', characterBible, true);
            }
          } catch (retryErr) {
            this.emit({
              type: 'warning',
              phase: 'characters',
              message: `Character design retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
            });
            break;
          }
        }

        if (!charValidation.canProceed && this.config.validation.mode === 'strict') {
          throw new ValidationError(
            'Character bible validation failed',
            (charValidation.issues || []).map(i => ({
              category: 'npc_depth' as const,
              level: i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'suggestion',
              message: i.message,
              location: {},
              suggestion: i.suggestion,
            })),
          );
        } else {
          this.emit({
            type: 'checkpoint',
            phase: 'characters',
            message: `Character bible validation: ${charValidation.score}/100 ${charValidation.valid ? '(valid)' : '(advisory issues)'}`,
            data: charValidation,
          });
        }
      }

      // === PHASE 2.5: NPC DEPTH VALIDATION ===
      if (this.config.validation.enabled && this.config.validation.rules.npcDepth.enabled) {
        this.emit({ type: 'phase_start', phase: 'npc_validation', message: 'Validating NPC relationship depth' });
        let npcValidation = await this.npcDepthValidator.validateCast(characterBible.characters);

        if (!npcValidation.passed) {
          const depthIssues = npcValidation.issues.filter(i => i.level === 'error');

          // === KARPATHY LOOP: Re-run character design with depth feedback ===
          if (depthIssues.length > 0 && this.config.validation.mode !== 'disabled') {
            const issueText = depthIssues
              .map(i => `- ${i.message}${i.suggestion ? ` (fix: ${i.suggestion})` : ''}`)
              .join('\n');

            this.emit({
              type: 'regeneration_triggered',
              phase: 'npc_validation',
              message: `NPC depth validation failed with ${depthIssues.length} error(s), retrying character design with feedback`,
            });

            try {
              const originalBrief = { ...brief };
              const repairedBrief = {
                ...originalBrief,
                userPrompt: `${originalBrief.userPrompt || ''}\n\nCRITICAL NPC DEPTH FIXES REQUIRED:\n${issueText}\n\nEnsure every major NPC has relationship dimensions (trust, affection, respect, fear) initialized. Supporting NPCs need at least 2 dimensions. Core NPCs need all 4.`,
              };

              const retryCharBible = await this.measurePhase('character_design_retry', () =>
                this.runCharacterDesign(repairedBrief, worldBible)
              );

              const retryNpcValidation = await this.npcDepthValidator.validateCast(retryCharBible.characters);
              const retryDepthErrors = retryNpcValidation.issues.filter(i => i.level === 'error');

              if (retryNpcValidation.passed || retryDepthErrors.length < depthIssues.length) {
                Object.assign(characterBible, retryCharBible);
                npcValidation = retryNpcValidation;
                this.addCheckpoint('Character Bible', characterBible, true);
                this.emit({
                  type: 'debug',
                  phase: 'npc_validation',
                  message: `NPC depth retry improved: ${depthIssues.length} -> ${retryDepthErrors.length} error(s)`,
                });
              } else {
                this.emit({
                  type: 'debug',
                  phase: 'npc_validation',
                  message: `NPC depth retry did not improve (${retryDepthErrors.length} errors), keeping original`,
                });
              }
            } catch (retryErr) {
              this.emit({
                type: 'warning',
                phase: 'npc_validation',
                message: `Character design retry for NPC depth failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
              });
            }
          }

          // After repair attempt, check final state
          const finalDepthIssues = npcValidation.issues.filter(i => i.level === 'error');
          if (finalDepthIssues.length > 0 && this.config.validation.mode === 'strict') {
            this.emit({
              type: 'error',
              message: `NPC depth requirements not met: ${finalDepthIssues.length} errors`,
              data: finalDepthIssues,
            });
            throw new ValidationError('NPC depth requirements not met', finalDepthIssues);
          } else if (finalDepthIssues.length > 0) {
            this.emit({
              type: 'checkpoint',
              phase: 'npc_validation',
              message: `NPC depth validation: ${finalDepthIssues.length} issues remain (advisory mode)`,
              data: npcValidation,
            });
          } else {
            this.emit({
              type: 'phase_complete',
              phase: 'npc_validation',
              message: 'NPC depth validation passed after repair',
            });
          }
        } else {
          this.emit({
            type: 'phase_complete',
            phase: 'npc_validation',
            message: 'NPC depth validation passed',
          });
        }
      }

      // === PHASE 3: EPISODE ARCHITECTURE ===
      await this.checkCancellation();
      this.emit({ type: 'phase_start', phase: 'architecture', message: 'Phase 3: Creating episode blueprint' });
      this.requirePhases('episode_architecture', ['world_building', 'character_design']);
      const resumedEpisodeBlueprint = this.getResumeOutput<EpisodeBlueprint>(resumeCheckpoint, 'episode_blueprint');
      let episodeBlueprint: EpisodeBlueprint = resumedEpisodeBlueprint
        ? resumedEpisodeBlueprint
        : await this.measurePhase('episode_architecture', () => this.runEpisodeArchitecture(brief, worldBible, characterBible));
      this.markPhaseComplete('episode_architecture');
      if (resumedEpisodeBlueprint) {
        this.emit({ type: 'debug', phase: 'architecture', message: 'Resumed from durable episode blueprint checkpoint' });
      } else {
        this.addCheckpoint('Episode Blueprint', episodeBlueprint, true);
      }

      // Phase validation with retry loop for episode architecture
      if (this.phaseValidator.isEnabled() && !resumedEpisodeBlueprint) {
        let archValidation = this.phaseValidator.validateEpisodeBlueprint(episodeBlueprint, worldBible, characterBible);
        let archRetryCount = 0;
        const archMaxRetries = this.phaseValidator.getMaxRetries();

        while (!archValidation.canProceed && this.phaseValidator.canRetry('episode_architecture') && archRetryCount < archMaxRetries) {
          archRetryCount++;
          this.emit({
            type: 'regeneration_triggered',
            phase: 'architecture',
            message: `Blueprint validation failed (${archValidation.score}/100), retry ${archRetryCount}/${archMaxRetries}: ${archValidation.summary}`,
          });
          const retryBlueprint = await this.measurePhase(`episode_architecture_retry_${archRetryCount}`, () =>
            this.runEpisodeArchitecture(brief, worldBible, characterBible)
          );
          const retryValidation = this.phaseValidator.validateEpisodeBlueprint(retryBlueprint, worldBible, characterBible);
          if (retryValidation.score > archValidation.score) {
            episodeBlueprint = retryBlueprint;
            archValidation = retryValidation;
            this.addCheckpoint('Episode Blueprint', episodeBlueprint, true);
            this.emit({ type: 'debug', phase: 'architecture', message: `Blueprint retry ${archRetryCount} improved score: ${archValidation.score} -> ${retryValidation.score}` });
          }
          if (archValidation.canProceed) break;
        }

        if (!archValidation.valid) {
          this.emit({
            type: 'warning',
            phase: 'architecture',
            message: this.phaseValidator.formatResult(archValidation),
          });
        }
      }

      // === PHASE 3.5: BRANCH ANALYSIS ===
      this.emit({ type: 'phase_start', phase: 'branch_analysis', message: 'Phase 3.5: Analyzing branch structure' });
      this.requirePhases('branch_analysis', ['episode_architecture']);
      const branchAnalysis = await this.measurePhase('branch_analysis', () => this.runBranchAnalysis(brief, episodeBlueprint));
      this.markPhaseComplete('branch_analysis');
      if (branchAnalysis) {
        this.addCheckpoint('Branch Analysis', branchAnalysis, false);
        
        // Act on recommendations from branch analysis (recommendations are strings)
        if (branchAnalysis.recommendations && branchAnalysis.recommendations.length > 0) {
          for (const rec of branchAnalysis.recommendations) {
            this.emit({
              type: 'debug',
              phase: 'branch_recommendations',
              message: rec,
            });
          }
        }
        
        // Validate all branch paths have content (warn if missing)
        for (const path of branchAnalysis.branchPaths) {
          for (const sceneId of path.sceneSequence) {
            const scene = episodeBlueprint.scenes.find(s => s.id === sceneId);
            if (!scene) {
              this.emit({
                type: 'warning',
                phase: 'branch_validation',
                message: `Branch "${path.id}" references missing scene: ${sceneId}`,
              });
            }
          }
        }
        
        // Warn about reconvergence points that may need state reconciliation
        for (const reconv of branchAnalysis.reconvergencePoints) {
          if (reconv.stateReconciliation && reconv.stateReconciliation.length > 0) {
            const flagNames = reconv.stateReconciliation.map(r => r.stateVariable).join(', ');
            this.emit({
              type: 'debug',
              phase: 'branch_reconvergence',
              message: `Reconvergence at "${reconv.sceneId}" needs state reconciliation for: ${flagNames}`,
            });
          }
        }
      }

      // === PHASE 4: CONTENT GENERATION ===
      await this.checkCancellation();
      this.emit({ type: 'phase_start', phase: 'content', message: 'Phase 4: Writing scene content' });
      this.requirePhases('content_generation', ['episode_architecture']);
      const resumedSceneContent = this.getResumeOutput<{
        sceneContents?: SceneContent[];
        choiceSets?: ChoiceSet[];
        encounters?: Array<[string, EncounterStructure]>;
      }>(resumeCheckpoint, 'scene_content');
      const contentGenerationResult: {
        sceneContents: SceneContent[];
        choiceSets: ChoiceSet[];
        encounters: Map<string, EncounterStructure>;
      } = resumedSceneContent
        ? {
            sceneContents: resumedSceneContent.sceneContents || [],
            choiceSets: resumedSceneContent.choiceSets || [],
            encounters: new Map<string, EncounterStructure>(resumedSceneContent.encounters || []),
          }
        : await this.measurePhase(
            'content_generation',
            () => this.runContentGeneration(
              brief,
              worldBible,
              characterBible,
              episodeBlueprint,
              branchAnalysis || undefined
            )
          );
      const { sceneContents, choiceSets, encounters } = contentGenerationResult;
      this.markPhaseComplete('content_generation');
      if (resumedSceneContent) {
        this.emit({ type: 'debug', phase: 'content', message: 'Resumed from durable scene content checkpoint' });
      } else {
        this.addCheckpoint(
          'Scene Content',
          { sceneContents, choiceSets, encounterCount: encounters.size, encounters: Array.from(encounters.entries()) },
          true
        );
      }

      // === PHASE 4.5: QUICK VALIDATION ===
      let quickValidation: QuickValidationResult | undefined;
      if (this.config.validation.enabled) {
        this.emit({ type: 'phase_start', phase: 'quick_validation', message: 'Running quick validation' });

        const validationInput = this.prepareValidationInput(
          sceneContents,
          choiceSets,
          characterBible,
          encounters
        );

        quickValidation = await this.integratedValidator.runQuickValidation(validationInput);

        // Phase 3.3: Treat voice errors above threshold as critical. The
        // incremental validator already computes per-scene voice scores; if any
        // scene dips below the configured regeneration threshold we escalate
        // those into blocking issues so the repair loop below can target a
        // scoped SceneWriter rewrite (voice_fidelity is in the repairable set).
        try {
          const voiceThreshold =
            (this.config as unknown as { incrementalValidation?: { voiceRegenerationThreshold?: number } })
              .incrementalValidation?.voiceRegenerationThreshold ?? 50;
          const criticalVoiceScenes = this.sceneValidationResults.filter(
            r => r.voice && r.voice.score < voiceThreshold,
          );
          if (criticalVoiceScenes.length > 0) {
            const voiceBlockers = criticalVoiceScenes.map(r => ({
              category: 'voice_fidelity' as const,
              level: 'error' as const,
              message: `Scene ${r.sceneId}: voice fidelity score ${r.voice!.score} below critical threshold (${voiceThreshold})`,
              location: { sceneId: r.sceneId },
              suggestion:
                r.voice!.issues
                  .slice(0, 3)
                  .map(i => `${i.characterName}: ${i.suggestion || i.issue}`)
                  .join('; ') || undefined,
            }));
            quickValidation = {
              canProceed: false,
              blockingIssues: [...quickValidation.blockingIssues, ...voiceBlockers],
              warningCount: quickValidation.warningCount,
            };
          }
        } catch (err) {
          this.emit({
            type: 'warning',
            phase: 'quick_validation',
            message: `Voice-fidelity escalation skipped: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        if (!quickValidation.canProceed) {
          // === KARPATHY LOOP: Attempt targeted repair before throwing ===
          const repairableCategories = new Set([
            'stakes_triangle',
            'five_factor',
            'choice_density',
            'consequence_budget',
            'callback_opportunities',
            'voice_fidelity',
            'branch_topology',
          ]);
          const repairableIssues = quickValidation.blockingIssues.filter(
            i => repairableCategories.has(i.category)
          );
          let repairAttempted = false;

          if (repairableIssues.length > 0) {
            this.emit({
              type: 'regeneration_triggered',
              phase: 'quick_validation',
              message: `Quick validation failed with ${repairableIssues.length} repairable issue(s), attempting repair`,
            });

            // --- Repair stakes_triangle and five_factor issues (existing choices) ---
            const choiceIssues = repairableIssues.filter(
              i => i.category === 'stakes_triangle' || i.category === 'five_factor'
            );

            for (const issue of choiceIssues) {
              const choiceId = issue.location?.choiceId;
              if (!choiceId) continue;

              const csIdx = choiceSets.findIndex(cs =>
                cs.choices.some(c => c.id === choiceId)
              );
              if (csIdx === -1) continue;

              const cs = choiceSets[csIdx];
              const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === cs.beatId);
              if (!beat) continue;

              const sceneBlueprint = episodeBlueprint.scenes.find(s => s.choicePoint);
              if (!sceneBlueprint) continue;

              repairAttempted = true;
              const repairResult = await withTimeout(this.choiceAuthor.execute({
                sceneBlueprint,
                beatText: beat.text,
                beatId: beat.id,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL FIX REQUIRED: ${issue.message}. ${issue.suggestion || ''}`,
                  worldContext: this.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                },
                npcsInScene: this.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
                availableFlags: episodeBlueprint.suggestedFlags,
                availableScores: episodeBlueprint.suggestedScores,
                availableTags: episodeBlueprint.suggestedTags,
                possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                  const scene = episodeBlueprint.scenes.find(s => s.id === id);
                  return { id, name: scene?.name || id, description: scene?.description || '' };
                }),
                optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: this.cachedPipelineMemory || undefined,
              }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${cs.beatId} quick-val-repair)`);

              if (repairResult.success && repairResult.data) {
                choiceSets[csIdx] = repairResult.data;
              }
            }

            // --- Repair choice_density issues (missing choice points) ---
            const densityIssues = repairableIssues.filter(i => i.category === 'choice_density');
            if (densityIssues.length > 0) {
              const scenesWithChoices = new Set(choiceSets.map(cs => {
                const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === cs.beatId);
                return beat ? sceneContents.find(sc => sc.beats.includes(beat))?.sceneId : null;
              }).filter(Boolean));

              const scenesNeedingChoices = episodeBlueprint.scenes
                .filter(s => s.choicePoint && !scenesWithChoices.has(s.id) && !s.isEncounter)
                .slice(0, 3);

              for (const targetScene of scenesNeedingChoices) {
                const sceneContent = sceneContents.find(sc => sc.sceneId === targetScene.id);
                if (!sceneContent || sceneContent.beats.length === 0) continue;

                const lastBeat = sceneContent.beats[sceneContent.beats.length - 1];
                this.emit({
                  type: 'regeneration_triggered',
                  phase: 'quick_validation',
                  message: `Generating missing choices for scene ${targetScene.id} (choice density repair)`,
                });

                repairAttempted = true;
                const densityRepairResult = await withTimeout(this.choiceAuthor.execute({
                  sceneBlueprint: targetScene,
                  beatText: lastBeat.text,
                  beatId: lastBeat.id,
                  storyContext: {
                    title: brief.story.title,
                    genre: brief.story.genre,
                    tone: brief.story.tone,
                    userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL: This scene needs player choices. ${densityIssues.map(i => i.message).join('. ')}`,
                    worldContext: this.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === targetScene.location)?.fullDescription),
                  },
                  protagonistInfo: {
                    name: brief.protagonist.name,
                    pronouns: brief.protagonist.pronouns,
                  },
                  npcsInScene: this.buildChoiceAuthorNpcs(targetScene.npcsPresent, characterBible),
                  availableFlags: episodeBlueprint.suggestedFlags,
                  availableScores: episodeBlueprint.suggestedScores,
                  availableTags: episodeBlueprint.suggestedTags,
                  possibleNextScenes: targetScene.leadsTo.map(id => {
                    const scene = episodeBlueprint.scenes.find(s => s.id === id);
                    return { id, name: scene?.name || id, description: scene?.description || '' };
                  }),
                  optionCount: targetScene.choicePoint?.optionHints?.length || 3,
                  sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                  memoryContext: this.cachedPipelineMemory || undefined,
                }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${lastBeat.id} density-repair)`);

                if (densityRepairResult.success && densityRepairResult.data) {
                  choiceSets.push(densityRepairResult.data);
                }
              }
            }

            // Phase 3.3: --- Repair voice_fidelity issues (scoped SceneWriter rewrite) ---
            const voiceIssues = repairableIssues.filter(i => i.category === 'voice_fidelity');
            for (const issue of voiceIssues) {
              const sceneId = issue.location?.sceneId;
              if (!sceneId) continue;
              const sceneBlueprint = episodeBlueprint.scenes.find(s => s.id === sceneId);
              const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneId);
              if (!sceneBlueprint || sceneIdx === -1 || sceneBlueprint.isEncounter) continue;

              this.emit({
                type: 'regeneration_triggered',
                phase: 'quick_validation',
                message: `Rewriting scene ${sceneId} for voice fidelity: ${issue.message}`,
              });
              repairAttempted = true;

              const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);
              const location = worldBible.locations.find(l => l.id === sceneBlueprint.location);

              try {
                const voiceRepair = await withTimeout(this.sceneWriter.execute({
                  sceneBlueprint,
                  storyContext: {
                    title: brief.story.title,
                    genre: brief.story.genre,
                    tone: brief.story.tone,
                    userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL VOICE FIDELITY FIX:\n${issue.message}\n${issue.suggestion || ''}\n\nRe-author this scene's beats with stricter voice adherence; match each character's vocabulary, formality, sentence length, and avoided-words list.`,
                    worldContext: this.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
                  },
                  protagonistInfo: {
                    name: brief.protagonist.name,
                    pronouns: brief.protagonist.pronouns,
                    description: protagonistProfile?.fullBackground || brief.protagonist.description,
                    physicalDescription: protagonistProfile?.physicalDescription,
                  },
                  npcs: sceneBlueprint.npcsPresent.map(npcId => {
                    const profile = characterBible.characters.find(c => c.id === npcId);
                    return {
                      id: npcId,
                      name: profile?.name || npcId,
                      pronouns: profile?.pronouns || 'he/him',
                      description: profile?.overview || '',
                      physicalDescription: profile?.physicalDescription,
                      voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                      currentMood: profile?.voiceProfile?.whenNervous,
                    };
                  }),
                  relevantFlags: episodeBlueprint.suggestedFlags,
                  relevantScores: episodeBlueprint.suggestedScores,
                  targetBeatCount: sceneBlueprint.purpose === 'bottleneck'
                    ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
                    : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount),
                  dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
                }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneId} voice-repair)`);

                if (voiceRepair.success && voiceRepair.data) {
                  sceneContents[sceneIdx] = voiceRepair.data;
                }
              } catch (err) {
                this.emit({
                  type: 'warning',
                  phase: 'quick_validation',
                  message: `Voice repair for ${sceneId} failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            }

            if (repairAttempted) {
              const revalidationInput = this.prepareValidationInput(
                sceneContents,
                choiceSets,
                characterBible,
                encounters
              );
              quickValidation = await this.integratedValidator.runQuickValidation(revalidationInput);
            }
          }

          if (!quickValidation.canProceed) {
            this.emit({
              type: 'error',
              phase: 'quick_validation',
              message: `Quick validation failed${repairAttempted ? ' after repair attempt' : ''}: ${quickValidation.blockingIssues.length} blocking issues`,
              data: quickValidation.blockingIssues,
            });
            throw new ValidationError(
              'Content validation failed',
              quickValidation.blockingIssues
            );
          }
        }

        if (quickValidation.canProceed) {
          this.emit({
            type: 'phase_complete',
            phase: 'quick_validation',
            message: `Quick validation passed (${quickValidation.warningCount} warnings)`,
          });
        }
      }

      // === PHASE 5: QUALITY ASSURANCE ===
      await this.checkCancellation();
      let qaReport: QAReport | undefined;
      let bestPracticesReport: ComprehensiveValidationReport | undefined;

      if (brief.options?.runQA !== false) {
        this.emit({ type: 'phase_start', phase: 'qa', message: 'Phase 5: Running quality assurance' });
        this.requirePhases('qa', ['content_generation']);

        // Run QA and best practices validation in parallel (including encounters)
        const validationInput = this.prepareValidationInput(
          sceneContents,
          choiceSets,
          characterBible,
          encounters
        );

        const [qaResult, bpResult] = await this.measurePhase('qa', () => Promise.all([
          this.runQualityAssurance(
            brief,
            sceneContents,
            choiceSets,
            characterBible,
            episodeBlueprint
          ),
          this.config.validation.enabled
            ? this.integratedValidator.runFullValidation(validationInput)
            : Promise.resolve(undefined),
        ]));

        qaReport = qaResult;
        bestPracticesReport = bpResult;
        this.markPhaseComplete('qa');

        this.addCheckpoint('QA Report', qaReport, qaReport.passesQA === false);

        if (bestPracticesReport) {
          this.addCheckpoint('Best Practices Report', bestPracticesReport, !bestPracticesReport.overallPassed);
          this.emit({
            type: 'phase_complete',
            phase: 'best_practices',
            message: `Best Practices Score: ${bestPracticesReport.overallScore}/100 - ${bestPracticesReport.overallPassed ? 'PASSED' : 'NEEDS REVIEW'}`,
            data: {
              score: bestPracticesReport.overallScore,
              errors: bestPracticesReport.blockingIssues.length,
              warnings: bestPracticesReport.warnings.length,
              suggestions: bestPracticesReport.suggestions.length,
            },
          });
        }

        // Phase 4.3: Wire ChoiceDistributionValidator into FullStoryPipeline
        try {
          const distributionInput = {
            choiceSets: choiceSets.map(cs => ({
              beatId: cs.beatId,
              choiceType: cs.choiceType,
              hasBranching: cs.choices.some(c => c.nextSceneId),
            })),
            targets: {
              expression: this.config.generation?.choiceDistExpression ?? 35,
              relationship: this.config.generation?.choiceDistRelationship ?? 30,
              strategic: this.config.generation?.choiceDistStrategic ?? 25,
              dilemma: this.config.generation?.choiceDistDilemma ?? 10,
            },
            maxBranchingChoicesPerEpisode: this.config.generation?.maxBranchingChoicesPerEpisode ?? 3,
          };
          const distributionResult = this.distributionValidator.validate(distributionInput);
          const distributionMetrics = this.distributionValidator.computeMetrics(distributionInput);
          this.emit({
            type: 'checkpoint',
            phase: 'choice_distribution',
            message:
              `Choice Distribution: ${distributionResult.score}/100 — ` +
              Object.entries(distributionMetrics.actualPercentages)
                .map(([t, pct]) => `${t}: ${pct.toFixed(0)}%`)
                .join(', ') +
              ` | branching: ${distributionMetrics.branchingCount}/${distributionMetrics.branchingCap} cap`,
            data: { distributionResult, metrics: distributionMetrics },
          });
        } catch (err) {
          this.emit({
            type: 'warning',
            phase: 'choice_distribution',
            message: `ChoiceDistributionValidator failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        const threshold = brief.options?.qaThreshold || QA_DEFAULTS.defaultThreshold;
        const maxQARepairPasses = brief.options?.maxQARepairPasses ?? 2;

        for (let qaRepairPass = 0; qaRepairPass < maxQARepairPasses; qaRepairPass++) {
          if (qaReport.passesQA || qaReport.criticalIssues.length === 0) break;

          // === KARPATHY LOOP: QA-driven targeted repair ===
          const previousScore = qaReport.overallScore;
          this.emit({
            type: 'phase_start',
            phase: 'qa_repair',
            message: `QA repair pass ${qaRepairPass + 1}/${maxQARepairPasses}: score ${qaReport.overallScore}/100, ${qaReport.criticalIssues.length} critical issue(s)`,
          });

          let repairsMade = 0;

          // Repair scenes with continuity errors
          if (qaReport.continuity && qaReport.continuity.issues.length > 0) {
            const errorIssues = qaReport.continuity.issues.filter(i => i.severity === 'error');
            const affectedSceneIds = new Set(errorIssues.map(i => i.location.sceneId));

            for (const sceneId of affectedSceneIds) {
              const sceneIssues = errorIssues.filter(i => i.location.sceneId === sceneId);
              const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneId);
              if (sceneIdx === -1) continue;

              const sceneBlueprint = episodeBlueprint.scenes.find(s => s.id === sceneId);
              if (!sceneBlueprint || sceneBlueprint.isEncounter) continue;

              const issueText = sceneIssues.map(i => `- ${i.description} (fix: ${i.suggestedFix})`).join('\n');
              const location = worldBible.locations.find(l => l.id === sceneBlueprint.location);
              const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

              this.emit({
                type: 'regeneration_triggered',
                phase: 'qa_repair',
                message: `Repairing scene ${sceneId}: ${sceneIssues.length} continuity error(s)`,
              });

              const repairResult = await withTimeout(this.sceneWriter.execute({
                sceneBlueprint,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL CONTINUITY FIXES REQUIRED:\n${issueText}`,
                  worldContext: this.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                  description: protagonistProfile?.fullBackground || brief.protagonist.description,
                  physicalDescription: protagonistProfile?.physicalDescription,
                },
                npcs: sceneBlueprint.npcsPresent.map(npcId => {
                  const profile = characterBible.characters.find(c => c.id === npcId);
                  return {
                    id: npcId,
                    name: profile?.name || npcId,
                    pronouns: profile?.pronouns || 'he/him',
                    description: profile?.overview || '',
                    physicalDescription: profile?.physicalDescription,
                    voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                    currentMood: profile?.voiceProfile?.whenNervous,
                  };
                }),
                relevantFlags: episodeBlueprint.suggestedFlags,
                relevantScores: episodeBlueprint.suggestedScores,
                targetBeatCount: sceneBlueprint.purpose === 'bottleneck'
                  ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
                  : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount),
                dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
                incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: this.cachedPipelineMemory || undefined,
              }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneId} qa-repair-${qaRepairPass + 1})`);

              if (repairResult.success && repairResult.data) {
                repairResult.data.sceneId = sceneId;
                repairResult.data.sceneName = repairResult.data.sceneName || sceneBlueprint.name;
                repairResult.data.locationId = sceneContents[sceneIdx].locationId;
                repairResult.data.settingContext = sceneContents[sceneIdx].settingContext;
                repairResult.data.branchType = sceneContents[sceneIdx].branchType;
                repairResult.data.isBottleneck = sceneContents[sceneIdx].isBottleneck;
                repairResult.data.isConvergencePoint = sceneContents[sceneIdx].isConvergencePoint;
                sceneContents[sceneIdx] = repairResult.data;
                repairsMade++;
              }
            }
          }

          // Repair choices with false choices / weak stakes
          if (qaReport.stakes && qaReport.stakes.metrics.falseChoiceCount > 0) {
            const weakChoiceSets = qaReport.stakes.choiceSetAnalysis
              .filter(cs => cs.stakesScore < 50)
              .slice(0, 3);

            for (const weakCs of weakChoiceSets) {
              const csIdx = choiceSets.findIndex(cs => cs.beatId === weakCs.beatId);
              if (csIdx === -1) continue;

              const sceneBlueprint = episodeBlueprint.scenes.find(s => s.choicePoint);
              if (!sceneBlueprint) continue;

              const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === weakCs.beatId);
              if (!beat) continue;

              this.emit({
                type: 'regeneration_triggered',
                phase: 'qa_repair',
                message: `Repairing weak choice set at beat ${weakCs.beatId} (stakes: ${weakCs.stakesScore}/100)`,
              });

              const repairChoiceResult = await withTimeout(this.choiceAuthor.execute({
                sceneBlueprint,
                beatText: beat.text,
                beatId: beat.id,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - QA found these stakes issues: ${weakCs.analysis}. Improvements needed: ${weakCs.improvements.join('; ')}`,
                  worldContext: this.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                },
                npcsInScene: this.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
                availableFlags: episodeBlueprint.suggestedFlags,
                availableScores: episodeBlueprint.suggestedScores,
                availableTags: episodeBlueprint.suggestedTags,
                possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                  const scene = episodeBlueprint.scenes.find(s => s.id === id);
                  return { id, name: scene?.name || id, description: scene?.description || '' };
                }),
                optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: this.cachedPipelineMemory || undefined,
              }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${weakCs.beatId} qa-repair-${qaRepairPass + 1})`);

              if (repairChoiceResult.success && repairChoiceResult.data) {
                choiceSets[csIdx] = repairChoiceResult.data;
                repairsMade++;
              }
            }
          }

          if (repairsMade > 0) {
            this.emit({
              type: 'debug',
              phase: 'qa_repair',
              message: `Pass ${qaRepairPass + 1}: made ${repairsMade} repair(s), re-running QA`,
            });

            qaReport = await this.runQualityAssurance(
              brief, sceneContents, choiceSets, characterBible, episodeBlueprint
            );

            this.emit({
              type: 'phase_complete',
              phase: 'qa_repair',
              message: `QA repair pass ${qaRepairPass + 1}: ${qaReport.overallScore}/100 (was ${previousScore}/100), ${qaReport.passesQA ? 'PASSES' : 'still below threshold'}`,
            });
          } else {
            this.emit({
              type: 'phase_complete',
              phase: 'qa_repair',
              message: `QA repair pass ${qaRepairPass + 1}: no repairable issues found`,
            });
            break;
          }
        }

        if (qaReport.overallScore < threshold) {
          this.emit({
            type: 'warning',
            phase: 'qa',
            message: `QA score ${qaReport.overallScore} below threshold ${threshold} - story may need refinement`,
          });
        }
      }

      // === PHASE 5.5: IMAGE GENERATION (single-episode mode) ===
      await this.checkCancellation();
      // Create output directory EARLY so images are saved to the right location
      let outputDirectory: string | undefined;
      let outputManifest: OutputManifest | undefined;
      let imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> } | undefined;
      let encounterImageResults: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages: Map<string, Map<string, Map<string, string>>>; storyletFailures?: string[] } | undefined;
      let encounterImageDiagnostics: EncounterImageRunDiagnostic[] = [];
      let videoResults: Map<string, string> | undefined;
      let videoDiagnostics: VideoGenerationDiagnostic[] = [];
      const audioDiagnostics: AudioGenerationDiagnostic[] = [];
      
      try {
        const resumedOutputDir = this.getResumeOutput<{ outputDirectory: string }>(
          resumeCheckpoint, 'output_directory'
        )?.outputDirectory;
        if (resumedOutputDir) {
          outputDirectory = resumedOutputDir;
          await ensureDirectory(outputDirectory);
          console.log(`[Pipeline] Resumed output directory: ${outputDirectory}`);
        } else {
          outputDirectory = await createOutputDirectory(brief.story.title);
        }
        this.addCheckpoint('Output Directory', { outputDirectory }, false);
        this.resetAssetRegistry(idSlugify(brief.story.title));
        await saveEarlyDiagnostic(outputDirectory, `episode-${brief.episode.number}-blueprint.json`, episodeBlueprint);

        // Set image service output directory to story's images folder
        if (this.config.imageGen?.enabled) {
          this.requirePhases('images', ['content_generation']);
          const imagesDir = outputDirectory + 'images/';
          this.imageService.setOutputDirectory(imagesDir);
          // Invalidate cached reference sheets if the user has changed art
          // style since the last run under this output directory. See
          // ImageGenerationService.reconcileCachedReferenceStyle for why this
          // matters (otherwise stale refs lock the aesthetic).
          const invalidatedRefs = this.imageService.reconcileCachedReferenceStyle(this.config.artStyle);
          if (invalidatedRefs > 0) {
            this.emit({
              type: 'debug',
              phase: 'images',
              message: `Art style changed — invalidated ${invalidatedRefs} cached reference image(s) so new refs will be generated under the current style.`,
            });
          }
          this.emit({ type: 'debug', phase: 'images', message: `Image output directory: ${imagesDir}` });
          
          // A10: warm up the color script in parallel with master image
          // generation. Both are independent (color script is pure text;
          // master images don't need the script) so overlapping them hides
          // the color-script latency. `runEpisodeImageGeneration` consumes
          // the promise below. Failures are swallowed into `undefined` so
          // the downstream path can still fall back to a fresh call.
          this._preWarmedColorScriptPromise = this.generateEpisodeColorScript(brief, sceneContents, choiceSets)
            .catch((err) => {
              this.emit({
                type: 'warning',
                phase: 'images',
                message: `A10 color-script prewarm failed (will retry inline): ${err instanceof Error ? err.message : String(err)}`,
              });
              return undefined;
            });

          // Generate master character/location references
          this.emit({ type: 'phase_start', phase: 'master_images', message: 'Generating master reference visuals...' });
          await this.imageWorkerQueue.run(() =>
            this.measurePhase('master_image_generation', () => this.runMasterImageGeneration(characterBible, worldBible, brief))
          );
          
          // Generate scene beat images
          this.emit({ type: 'phase_start', phase: 'images', message: 'Generating scene visuals...' });
          imageResults = await this.imageWorkerQueue.run(() =>
            this.measurePhase(
              'episode_image_generation',
              () => this.runEpisodeImageGeneration(sceneContents, choiceSets, brief, worldBible, characterBible, outputDirectory)
            )
          );
          
          // Generate encounter-specific images (beats, outcome choices, and storylet aftermath)
          if (encounters.size > 0) {
            try {
              this.imageService.clearEncounterDiagnostics();
              await this.runEncounterProviderPreflight(outputDirectory);
              encounterImageResults = await this.imageWorkerQueue.run(() =>
                this.measurePhase(
                  'encounter_image_generation',
                  () => this.generateEncounterImages(encounters, characterBible, brief, outputDirectory)
                )
              );
              encounterImageDiagnostics = this.toEncounterRunDiagnostics(this.imageService.getEncounterDiagnostics());
            } catch (encImgError) {
              const encImgMsg = encImgError instanceof Error ? encImgError.message : String(encImgError);
              console.error(`[Pipeline] Encounter image generation failed: ${encImgMsg}`);
              this.emit({ type: 'error', phase: 'encounter_images', message: `Encounter image generation failed: ${encImgMsg}` });
              encounterImageDiagnostics = this.toEncounterRunDiagnostics(this.imageService.getEncounterDiagnostics());
              if (outputDirectory && encounterImageDiagnostics.length > 0) {
                await saveEncounterImageDiagnosticsLog(outputDirectory, encounterImageDiagnostics);
              }
              if (this.isLlmQuotaFailure(encImgError)) throw encImgError;
              throw new PipelineError(
                `Encounter image generation failed: ${encImgMsg}`,
                'encounter_images',
                {
                  agent: 'EncounterImageAgent',
                  context: {
                    outputDirectory,
                    encounterCount: encounters.size,
                    failureKind: 'image_generation',
                  },
                  originalError: encImgError instanceof Error ? encImgError : undefined,
                }
              );
            }
          }
          
          this.emit({ 
            type: 'phase_complete', 
            phase: 'images', 
            message: `Generated ${imageResults?.beatImages.size || 0} beat images, ${imageResults?.sceneImages.size || 0} scene images` 
          });
          this.markPhaseComplete('images');
        }

        this.seedAssetRegistryFromResults(brief, sceneContents, encounters, imageResults, encounterImageResults);
        await saveEarlyDiagnostic(outputDirectory, '08-registry-state.json', this.assetRegistry.toSnapshot());
      } catch (imgError) {
        // Fail fast on provider quota exhaustion to avoid silently degraded outputs.
        if (this.isLlmQuotaFailure(imgError)) {
          const quotaMsg = imgError instanceof Error ? imgError.message : String(imgError);
          this.emit({ type: 'error', phase: 'images', message: `Image generation stopped: ${quotaMsg}` });
          throw new PipelineError(`Image generation stopped due to LLM quota exhaustion: ${quotaMsg}`, 'images', {
            agent: 'ImageAgentTeam',
            context: { mode: 'single-episode' },
            originalError: imgError instanceof Error ? imgError : undefined,
          });
        }
        if (imgError instanceof PipelineError) {
          throw imgError;
        }
        const imgErrorMsg = imgError instanceof Error ? imgError.message : String(imgError);
        console.error(`[Pipeline] Image generation failed: ${imgErrorMsg}`);
        this.emit({
          type: 'error',
          phase: 'images',
          message: `Image generation failed: ${imgErrorMsg}`,
        });
        if (outputDirectory) {
          try {
            await savePipelineErrorLog(outputDirectory, [{
              timestamp: new Date().toISOString(),
              phase: 'images',
              message: imgErrorMsg,
            }]);
          } catch { /* best-effort save */ }
        }
        throw new PipelineError(
          `Image generation failed: ${imgErrorMsg}`,
          'images',
          {
            context: {
              outputDirectory,
              failureKind: 'image_generation',
            },
            originalError: imgError instanceof Error ? imgError : undefined,
          }
        );
      }

      // === PHASE 5.7: VIDEO GENERATION (optional) ===
      await this.checkCancellation();
      if (this.config.videoGen?.enabled && imageResults?.beatImages && imageResults.beatImages.size > 0) {
        this.requirePhases('video_generation', ['images']);
        this.emit({ type: 'phase_start', phase: 'video_generation', message: 'Phase 5.7: Generating video animations from still images...' });
        try {
          const videosDir = (outputDirectory || './generated-content') + 'videos/';
          this.videoService.setOutputDirectory(videosDir);

          const videoRunResult = await this.videoWorkerQueue.run(() =>
            this.measurePhase('video_generation', () =>
              this.runVideoGeneration(sceneContents, imageResults!, brief, worldBible)
            )
          );
          videoDiagnostics = videoRunResult.diagnostics;
          videoResults = videoRunResult.videoResults;

          this.emit({
            type: 'phase_complete',
            phase: 'video_generation',
            message: `Generated ${videoResults?.size || 0} video clips`,
          });
          this.markPhaseComplete('video_generation');
        } catch (videoError) {
          const videoErrorMsg = videoError instanceof Error ? videoError.message : String(videoError);
          console.warn(`[Pipeline] Video generation failed (non-blocking): ${videoErrorMsg}`);
          this.emit({
            type: 'warning',
            phase: 'video_generation',
            message: `Video generation failed (non-blocking): ${videoErrorMsg}`,
          });
        }
      } else if (this.config.videoGen?.enabled && (!imageResults?.beatImages || imageResults.beatImages.size === 0)) {
        this.emit({
          type: 'warning',
          phase: 'video_generation',
          message: 'Video generation enabled but no images available — skipping video phase',
        });
      }

      // === COVER ART ===
      let storyCoverUrl: string | undefined;
      if (this.config.imageGen?.enabled) {
        storyCoverUrl = await this.generateStoryCoverArt(brief, characterBible, worldBible);
      }

      // === PHASE 6: ASSEMBLY ===
      this.emit({ type: 'phase_start', phase: 'assembly', message: 'Phase 6: Assembling final story' });
      let story = this.assembleStory(
        brief,
        worldBible,
        characterBible,
        episodeBlueprint,
        sceneContents,
        choiceSets,
        encounters,
        imageResults,
        encounterImageResults,
        storyCoverUrl,
        videoResults
      );
      story = assembleStoryAssetsFromRegistry(story, this.assetRegistry);

      // === STRUCTURAL AUTO-FIX ===
      // Repair common structural issues (missing startingBeatId, broken nextBeatId,
      // empty beat text, malformed variants) before the completeness gate runs.
      if (story) {
        try {
          const structuralValidator = new StructuralValidator();
          const autoFixResult = structuralValidator.autoFix(story);
          story = autoFixResult.story;
          if (autoFixResult.fixedCount > 0) {
            this.addCheckpoint('structural_autofix', {
              fixedCount: autoFixResult.fixedCount,
              fixes: autoFixResult.fixes,
            });
            this.emit({
              type: 'pipeline_event',
              event: 'structural_autofix_applied',
              fixedCount: autoFixResult.fixedCount,
              fixes: autoFixResult.fixes,
            } as any);
            console.log(
              `[Pipeline] StructuralValidator.autoFix applied ${autoFixResult.fixedCount} repairs`
            );
          }
        } catch (autoFixError) {
          console.warn(
            `[Pipeline] StructuralValidator.autoFix failed (non-fatal): ${(autoFixError as Error).message}`
          );
        }
      }

      // === PRE-GENERATION COMPLETENESS GATE ===
      // Strict: ANY missing image halts the pipeline. No silent fallbacks.
      if (story) {
        const registryCoverage = validateRegistryCoverage(story, this.assetRegistry);

        if (registryCoverage.missingRequiredCoverageKeys.length > 0) {
          console.error(
            `[Pipeline] REGISTRY COVERAGE GATE: ${registryCoverage.missingRequiredCoverageKeys.length} required slots unresolved`
          );
          throw new PipelineError(
            `Registry coverage gate failed: ${registryCoverage.missingRequiredCoverageKeys.length} required image slots unresolved`,
            'completeness_gate',
            {
              context: {
                outputDirectory,
                missingCount: registryCoverage.missingRequiredCoverageKeys.length,
                missingImages: registryCoverage.missingRequiredCoverageKeys.slice(0, 50),
                failureKind: 'image_completeness',
              },
            }
          );
        }

        const missingImages: { category: string; key: string }[] = [];

        if (!story.coverImage) missingImages.push({ category: 'cover', key: 'story-cover' });

        for (const episode of story.episodes || []) {
          if (!episode.coverImage) missingImages.push({ category: 'cover', key: `episode:${episode.id}` });

          for (const scene of episode.scenes || []) {
            if (!scene.backgroundImage) {
              missingImages.push({ category: 'scene-bg', key: `scene:${scene.id}` });
            }

            for (const beat of scene.beats || []) {
              if (!beat.image) {
                missingImages.push({ category: 'beat', key: `beat:${scene.id}::${beat.id}` });
              }
            }

            if (scene.encounter) {
              const missingEncKeys = collectMissingEncounterImageKeys(scene.id, scene.encounter);
              for (const k of missingEncKeys) {
                missingImages.push({ category: 'encounter', key: k });
              }

              for (const [outcomeName, storylet] of Object.entries((scene.encounter as any).storylets || {})) {
                const sl = storylet as any;
                for (const beat of sl?.beats || []) {
                  if (!beat.image) {
                    missingImages.push({ category: 'storylet', key: `storylet:${scene.id}::${outcomeName}::${beat.id}` });
                  }
                }
              }
            }
          }
        }

        if (missingImages.length > 0) {
          const byCategory: Record<string, { category: string; key: string }[]> = {};
          for (const m of missingImages) {
            if (!byCategory[m.category]) byCategory[m.category] = [];
            byCategory[m.category].push(m);
          }
          const summary = Object.entries(byCategory)
            .map(([cat, items]) => `${items.length} ${cat}`)
            .join(', ');

          console.error(`[Pipeline] COMPLETENESS GATE FAILED: ${missingImages.length} images missing (${summary})`);
          for (const [cat, items] of Object.entries(byCategory)) {
            for (const item of items.slice(0, 10)) {
              console.error(`[Pipeline]   [${cat}] ${item.key}`);
            }
          }

          throw new PipelineError(
            `Image completeness gate failed: ${missingImages.length} images missing (${summary})`,
            'completeness_gate',
            {
              context: {
                outputDirectory,
                totalMissing: missingImages.length,
                byCategory: Object.fromEntries(
                  Object.entries(byCategory).map(([cat, items]) => [cat, items.map(i => i.key).slice(0, 20)])
                ),
                failureKind: 'image_completeness',
              },
            }
          );
        } else {
          console.log(`[Pipeline] PRE-GENERATION COMPLETENESS: 100% image coverage — all image types verified.`);
        }
      }

      // === ASSET HTTP VERIFICATION (Tier 1 QA) ===
      if (story && this.config.validation?.assetHttpCheck !== false) {
        try {
          const assetReport = await walkStoryAssets(story, {
            httpTimeoutMs: 5000,
            concurrency: 20,
          });
          console.log(`[Pipeline] ${formatAssetWalkReport(assetReport)}`);
          if (assetReport.missing + assetReport.broken + assetReport.unreachable > 0) {
            const failCount = assetReport.missing + assetReport.broken + assetReport.unreachable;
            this.emit({
              type: 'warning',
              phase: 'asset_verification',
              message: `Asset HTTP check: ${failCount} image(s) failed verification (${assetReport.missing} missing, ${assetReport.broken} broken, ${assetReport.unreachable} unreachable)`,
            });
            if (this.config.validation?.assetHttpCheckFailFast) {
              throw new PipelineError(
                `Asset HTTP verification failed: ${failCount} image(s) not reachable`,
                'completeness_gate',
                { context: { failCount, missing: assetReport.missing, broken: assetReport.broken, unreachable: assetReport.unreachable } }
              );
            }
          }
        } catch (err) {
          if (err instanceof PipelineError) throw err;
          console.warn('[Pipeline] Asset HTTP verification failed (non-fatal):', (err as Error).message);
        }
      }

      // === DETERMINISTIC FLAG CHRONOLOGY SCAN ===
      // Walk the assembled story to catch forward-reference paradoxes that the
      // LLM-based QA may have missed or mis-classified. Any violations become
      // criticalIssues on the QA report, which would have triggered the repair
      // loop had they been caught earlier.
      if (story && qaReport) {
        const flagIssues = this.runFlagChronologyScan(story);
        if (flagIssues.length > 0) {
          for (const issue of flagIssues) {
            if (!qaReport.criticalIssues.includes(issue)) {
              qaReport.criticalIssues.push(issue);
            }
          }
          if (qaReport.criticalIssues.length > 0) {
            qaReport.passesQA = false;
          }
          this.emit({
            type: 'warning',
            phase: 'qa',
            message: `Deterministic flag chronology scan found ${flagIssues.length} forward-reference issue(s): ${flagIssues.join('; ')}`,
          });
        }
      }

      this.addCheckpoint('Final Story', story, false);

      // === PHASE 7: SAVE OUTPUTS ===
      this.emit({ type: 'phase_start', phase: 'saving', message: 'Phase 7: Saving all outputs to files' });

      try {
        // outputDirectory already created above, just ensure it exists
        if (!outputDirectory) {
          outputDirectory = await createOutputDirectory(brief.story.title);
        }
        if (story) story.outputDir = outputDirectory;

        const visualPlanningOutputs = this.getCollectedVisualPlanningForSave();

        const savingPhase = new SavingPhase();
        const savingResult = await savingPhase.run(
          {
            outputDirectory,
            durationMs: Date.now() - startTime,
            outputs: {
              brief,
              worldBible,
              characterBible,
              episodeBlueprint,
              sceneContents,
              choiceSets,
              encounters: Array.from(encounters.values()),
              qaReport,
              incrementalValidationResults:
                this.sceneValidationResults.length > 0 ? this.sceneValidationResults : undefined,
              encounterTelemetry:
                this.encounterTelemetry.length > 0 ? this.encounterTelemetry : undefined,
              llmLedger: this.telemetry.getLlmLedger() ?? undefined,
              branchShadowDiffs:
                this.branchShadowDiffs.length > 0 ? this.branchShadowDiffs : undefined,
              bestPracticesReport,
              finalStory: story,
              visualPlanning: visualPlanningOutputs,
              videoClipsGenerated: videoResults?.size || 0,
              videoDiagnostics,
              audioDiagnostics,
              encounterImageDiagnostics,
            },
          },
          {
            config: this.config,
            emit: (event) => this.emit(event),
            addCheckpoint: (name, data, optional) => this.addCheckpoint(name, data, optional),
          }
        );

        if (savingResult.manifest) {
          outputManifest = savingResult.manifest;
        } else if (savingResult.error) {
          console.warn(`[Pipeline] Failed to save outputs: ${savingResult.error.message}`);
        }
      } catch (saveError) {
        const saveErrorMsg = saveError instanceof Error ? saveError.message : String(saveError);
        console.warn(`[Pipeline] Failed to save outputs: ${saveErrorMsg}`);
        this.emit({
          type: 'warning',
          phase: 'saving',
          message: `Failed to save output files (non-blocking): ${saveErrorMsg}`,
        });
      }

      // Pre-generate audio if enabled (check both enabled flag and preGenerateAudio)
      await this.checkCancellation();
      if (this.config.narration?.enabled !== false && this.config.narration?.preGenerateAudio && this.config.narration?.elevenLabsApiKey) {
        this.requirePhases('audio_generation', ['content_generation']);
        this.emit({ type: 'phase_start', phase: 'audio_generation', message: 'Pre-generating narration audio...' });
        try {
          // Auto-cast voices for characters
          if (characterBible) {
            await this.audioService.autoCastVoices(characterBible);
            audioDiagnostics.push({
              timestamp: new Date().toISOString(),
              stage: 'voice_cast',
              status: 'completed',
              message: `Auto-cast voices for ${characterBible.characters.length} characters`,
            });
          }
          
          // Extract all beats and generate audio
          const beats = this.audioService.extractBeatsForAudio(story);
          if (beats.length > 0) {
            const audioResult = await this.audioWorkerQueue.run(() =>
              this.measurePhase('audio_generation', () => this.audioService.generateStoryAudio(
                story.id,
                beats,
                (completed, total) => {
                  this.emit({
                    type: 'agent_start',
                    phase: 'audio_generation',
                    message: `Generating audio: ${completed}/${total} beats`,
                    data: { completed, total, currentItem: completed, totalItems: total, subphaseLabel: 'audio:beats' },
                  });
                }
              ))
            );
            const mappedAudioCount = this.bindGeneratedAudioToStory(story, audioResult.results || []);
            audioDiagnostics.push({
              timestamp: new Date().toISOString(),
              stage: 'batch_generation',
              status: audioResult.success ? 'completed' : 'failed',
              message: `Audio batch finished: ${audioResult.generated} generated, ${audioResult.cached} cached, ${audioResult.failed} failed`,
              generated: audioResult.generated,
              cached: audioResult.cached,
              failed: audioResult.failed,
            });
            audioDiagnostics.push({
              timestamp: new Date().toISOString(),
              stage: 'binding',
              status: mappedAudioCount > 0 ? 'completed' : 'skipped',
              message: `Mapped audio onto ${mappedAudioCount} beats`,
              mapped: mappedAudioCount,
            });
            for (const result of audioResult.results || []) {
              if (result?.audioUrl) {
                audioDiagnostics.push({
                  timestamp: new Date().toISOString(),
                  stage: 'binding',
                  status: 'completed',
                  message: result.cached ? 'Bound cached audio to beat' : 'Bound generated audio to beat',
                  beatId: result.beatId,
                  audioUrl: result.audioUrl,
                });
              }
            }
            for (const error of audioResult.errors || []) {
              audioDiagnostics.push({
                timestamp: new Date().toISOString(),
                stage: 'batch_generation',
                status: 'failed',
                message: error.error,
                beatId: error.beatId,
              });
            }
            this.emit({
              type: 'debug',
              phase: 'audio_generation',
              message: `Audio complete: ${audioResult.generated} generated, ${audioResult.cached} cached, ${audioResult.failed} failed, ${mappedAudioCount} beats mapped`,
              data: {
                generated: audioResult.generated,
                cached: audioResult.cached,
                failed: audioResult.failed,
                mappedAudioCount,
              },
            });
            if (outputDirectory) {
              const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDirectory, audioDiagnostics);
              if (savedAudioDiagnostics) {
                await updateOutputManifest(outputDirectory, {
                  file: {
                    name: 'Audio Diagnostics',
                    path: savedAudioDiagnostics.path,
                    type: 'audio_diagnostics',
                    size: savedAudioDiagnostics.size,
                  },
                  summary: {
                    audioDiagnosticsCount: audioDiagnostics.length,
                  },
                });
              }
              await fetch(PROXY_CONFIG.writeFile, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filePath: `${outputDirectory}08-final-story.json`,
                  content: JSON.stringify(story, null, 2),
                  isBase64: false,
                }),
              });
            }
          } else {
            audioDiagnostics.push({
              timestamp: new Date().toISOString(),
              stage: 'gate',
              status: 'skipped',
              message: 'No beats found that required narration audio',
            });
            if (outputDirectory) {
              const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDirectory, audioDiagnostics);
              if (savedAudioDiagnostics) {
                await updateOutputManifest(outputDirectory, {
                  file: {
                    name: 'Audio Diagnostics',
                    path: savedAudioDiagnostics.path,
                    type: 'audio_diagnostics',
                    size: savedAudioDiagnostics.size,
                  },
                  summary: {
                    audioDiagnosticsCount: audioDiagnostics.length,
                  },
                });
              }
            }
          }
          this.emit({ type: 'phase_complete', phase: 'audio_generation', message: `Audio narration generated for ${beats.length} beats` });
          this.markPhaseComplete('audio_generation');
        } catch (audioError) {
          const audioErrMsg = audioError instanceof Error ? audioError.message : String(audioError);
          audioDiagnostics.push({
            timestamp: new Date().toISOString(),
            stage: 'batch_generation',
            status: 'failed',
            message: audioErrMsg,
          });
          console.warn(`[Pipeline] Audio generation failed: ${audioErrMsg}`);
          this.emit({ type: 'warning', phase: 'audio_generation', message: `Audio generation failed (non-blocking): ${audioErrMsg}` });
          if (outputDirectory) {
            const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDirectory, audioDiagnostics);
            if (savedAudioDiagnostics) {
              await updateOutputManifest(outputDirectory, {
                file: {
                  name: 'Audio Diagnostics',
                  path: savedAudioDiagnostics.path,
                  type: 'audio_diagnostics',
                  size: savedAudioDiagnostics.size,
                },
                summary: {
                  audioDiagnosticsCount: audioDiagnostics.length,
                },
              });
            }
          }
        }
      } else {
        audioDiagnostics.push({
          timestamp: new Date().toISOString(),
          stage: 'gate',
          status: 'skipped',
          message: `Audio generation skipped: enabled=${this.config.narration?.enabled !== false}, preGenerateAudio=${!!this.config.narration?.preGenerateAudio}, hasApiKey=${!!this.config.narration?.elevenLabsApiKey}`,
        });
        if (outputDirectory) {
          const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDirectory, audioDiagnostics);
          if (savedAudioDiagnostics) {
            await updateOutputManifest(outputDirectory, {
              file: {
                name: 'Audio Diagnostics',
                path: savedAudioDiagnostics.path,
                type: 'audio_diagnostics',
                size: savedAudioDiagnostics.size,
              },
              summary: {
                audioDiagnosticsCount: audioDiagnostics.length,
              },
            });
          }
        }
      }

      // === PHASE 8: BROWSER QA (Playwright playthrough) ===
      if (story && outputDirectory && this.config.validation?.playwrightQA !== false) {
        const maxRetries = this.config.validation?.playwrightQAMaxRetries ?? 1;
        const storyTitle = brief.story.title || '';

        this.emit({ type: 'phase_start', phase: 'browser_qa', message: 'Phase 8: Running full-coverage browser QA...' });

        let qaAttempt = 0;
        let lastQAResult: PlaywrightQAResult | null = null;

        while (qaAttempt <= maxRetries) {
          try {
            this.emit({
              type: 'progress',
              phase: 'browser_qa',
              message: qaAttempt === 0
                ? 'Analyzing story paths and launching parallel browser playthroughs...'
                : `Re-testing after remediation (attempt ${qaAttempt + 1}/${maxRetries + 1})...`,
            });

            lastQAResult = await runPlaywrightQAMultiPath({
              storyTitle,
              story,
              maxBeats: 200,
              timeoutMs: 300_000,
              maxParallel: 3,
              onProgress: (msg) => {
                this.emit({ type: 'progress', phase: 'browser_qa', message: msg });
              },
            });

            if (lastQAResult.skipped) {
              this.emit({
                type: 'warning',
                phase: 'browser_qa',
                message: `Browser QA skipped: ${lastQAResult.skipReason}`,
              });
              break;
            }

            const coverage = lastQAResult.coverageReport;
            const pathSummary = coverage
              ? `${coverage.completedPaths}/${coverage.totalPaths} paths, ${coverage.totalChoicesMade} choices exercised`
              : `${lastQAResult.totalBeats} beats`;

            console.log(`[Pipeline] Browser QA pass ${qaAttempt + 1}: ${pathSummary}, ` +
              `${lastQAResult.imageIssues.length} image issues, ${lastQAResult.networkFailures.length} network failures`);

            if (lastQAResult.passed) {
              this.emit({
                type: 'phase_complete',
                phase: 'browser_qa',
                message: `Browser QA passed — ${pathSummary}, 0 issues`,
              });
              break;
            }

            // Issues found — attempt remediation if we have retries left
            const issueCount = lastQAResult.imageIssues.length + lastQAResult.networkFailures.length;
            this.emit({
              type: 'warning',
              phase: 'browser_qa',
              message: `Browser QA found ${issueCount} issue(s) across ${pathSummary}`,
            });

            if (qaAttempt < maxRetries) {
              this.emit({
                type: 'progress',
                phase: 'browser_qa',
                message: `Remediating ${issueCount} issue(s)...`,
              });

              try {
                const remediation = await remediateImageIssues(
                  lastQAResult.imageIssues,
                  lastQAResult.networkFailures,
                  story,
                  this.imageService,
                  this.assetRegistry,
                  outputDirectory,
                );

                const regenCount = remediation.fixes.filter(f => f.action === 'regenerated').length;
                const skipCount = remediation.fixes.filter(f => f.action === 'skipped').length;

                console.log(`[Pipeline] QA Remediation: ${regenCount} regenerated, ${skipCount} skipped`);
                for (const fix of remediation.fixes) {
                  console.log(`[Pipeline]   ${fix.action}: ${fix.identifier || fix.issueScreen} — ${fix.reason || fix.newUrl || ''}`);
                }

                if (remediation.hasChanges) {
                  story = assembleStoryAssetsFromRegistry(story, this.assetRegistry);
                  story.outputDir = outputDirectory;
                  resaveFinalStory(story, outputDirectory);
                  this.emit({
                    type: 'progress',
                    phase: 'browser_qa',
                    message: `Remediated ${regenCount} image(s), re-saved story. Re-testing...`,
                  });
                } else {
                  this.emit({
                    type: 'warning',
                    phase: 'browser_qa',
                    message: 'No fixable issues found during remediation — skipping retest',
                  });
                  break;
                }
              } catch (remErr) {
                console.warn('[Pipeline] QA remediation error (non-fatal):', (remErr as Error).message);
                this.emit({
                  type: 'warning',
                  phase: 'browser_qa',
                  message: `Remediation failed: ${(remErr as Error).message}`,
                });
                break;
              }
            }
          } catch (qaErr) {
            console.warn('[Pipeline] Browser QA error (non-fatal):', (qaErr as Error).message);
            this.emit({
              type: 'warning',
              phase: 'browser_qa',
              message: `Browser QA failed: ${(qaErr as Error).message}`,
            });
            break;
          }

          qaAttempt++;
        }

        if (lastQAResult && !lastQAResult.passed && !lastQAResult.skipped) {
          const remaining = lastQAResult.imageIssues.length + lastQAResult.networkFailures.length;
          this.emit({
            type: 'warning',
            phase: 'browser_qa',
            message: `Browser QA completed with ${remaining} unresolved issue(s) after ${qaAttempt} attempt(s)`,
          });
        }
      }

      this.emit({ type: 'phase_complete', phase: 'complete', message: 'Story generation complete!' });

      // === OBSERVABILITY REPORT ===
      const serviceMetrics = this.imageService.pipelineMetrics;
      const phaseDurationsMs = Object.fromEntries(
        this.telemetry.getPhaseMetrics().map((m) => [m.phase, m.durationMs])
      );
      const providerSummary = this.telemetry.getProviderSummary();
      const pipelineReport = {
        imageCoverage: {
          totalBeats: 0,
          beatsWithImages: 0,
          encounterBeatsTotal: 0,
          encounterBeatsWithImages: 0,
        },
        cacheHitRate: serviceMetrics.cacheHits + serviceMetrics.cacheMisses > 0
          ? `${Math.round(serviceMetrics.cacheHits / (serviceMetrics.cacheHits + serviceMetrics.cacheMisses) * 100)}%`
          : 'N/A',
        textArtifactRejections: serviceMetrics.textArtifactRejections,
        transientRetries: serviceMetrics.transientRetries,
        permanentFailures: serviceMetrics.permanentFailures,
        choicePayoffPresence: 0,
        choicePayoffTotal: 0,
        unresolvedTokensDetected: 0,
        phaseDurationsMs,
        providerCalls: providerSummary,
        dependencyScheduler: { ...this.dependencySchedulerStats },
      };

      if (story) {
        for (const episode of story.episodes || []) {
          for (const scene of episode.scenes || []) {
            for (const beat of scene.beats || []) {
              pipelineReport.imageCoverage.totalBeats++;
              if (beat.image) pipelineReport.imageCoverage.beatsWithImages++;
            }
            if (scene.encounter) {
              for (const beat of getEncounterBeats(scene.encounter as any)) {
                pipelineReport.imageCoverage.encounterBeatsTotal++;
                if (beat.situationImage) pipelineReport.imageCoverage.encounterBeatsWithImages++;
              }
            }
          }
        }
      }

      // Check choice payoff presence in branch scenes
      if (episodeBlueprint) {
        for (const scene of episodeBlueprint.scenes || []) {
          if (scene.incomingChoiceContext) {
            pipelineReport.choicePayoffTotal++;
            const sceneContent = sceneContents.find(sc => sc.sceneId === scene.id);
            if (sceneContent?.beats?.[0]?.visualMoment) {
              pipelineReport.choicePayoffPresence++;
            }
          }
        }
      }

      console.log(`\n[Pipeline] ═══════════════════════════════════════`);
      console.log(`[Pipeline] OBSERVABILITY REPORT`);
      console.log(`[Pipeline] ═══════════════════════════════════════`);
      console.log(`[Pipeline] Image Coverage:`);
      console.log(`[Pipeline]   Episode beats: ${pipelineReport.imageCoverage.beatsWithImages}/${pipelineReport.imageCoverage.totalBeats}`);
      console.log(`[Pipeline]   Encounter beats: ${pipelineReport.imageCoverage.encounterBeatsWithImages}/${pipelineReport.imageCoverage.encounterBeatsTotal}`);
      console.log(`[Pipeline] Prompt Cache Hit Rate: ${pipelineReport.cacheHitRate}`);
      console.log(`[Pipeline] Text Artifact Rejections: ${pipelineReport.textArtifactRejections}`);
      console.log(`[Pipeline] Retries: ${pipelineReport.transientRetries} transient, ${pipelineReport.permanentFailures} permanent`);
      console.log(`[Pipeline] Choice Payoff: ${pipelineReport.choicePayoffPresence}/${pipelineReport.choicePayoffTotal} branch scenes have visual payoff`);
      console.log(`[Pipeline] Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`[Pipeline] ═══════════════════════════════════════\n`);

      this.emit({ type: 'debug', phase: 'observability', message: JSON.stringify(pipelineReport) });

      // Mark job as completed
      if (this.jobId) {
        await completeJob(this.jobId, outputDirectory);
      }

      // Write pipeline optimization memory (non-blocking)
      this.writeGenerationMemory({
        success: true,
        qaScore: qaReport?.overallScore,
        qaPassed: qaReport?.passesQA,
        bestPracticesScore: bestPracticesReport?.overallScore,
        duration: Date.now() - startTime,
        artStyle: this.config.artStyle,
        episodeTitle: brief.story.title,
      }).catch(() => {});

      if (qaReport) {
        this.writeQALearnings(qaReport, brief.story.title).catch(() => {});
      }

      return {
        success: true,
        story,
        worldBible,
        characterBible,
        episodeBlueprint,
        sceneContents,
        choiceSets,
        encounters: Array.from(encounters.values()),
        qaReport,
        bestPracticesReport,
        quickValidation,
        checkpoints: this.checkpoints,
        events: this.events,
        duration: Date.now() - startTime,
        outputDirectory,
        outputManifest,
        pipelineReport,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Handle job cancellation
      if (error instanceof JobCancelledError) {
        this.emit({ type: 'error', message: 'Generation cancelled by user' });
      } else {
        this.emit({ type: 'error', message: `Pipeline failed: ${errorMessage}` });
        if (this.jobId) {
          await failJob(this.jobId, errorMessage);
        }
      }

      // Write failure memory (non-blocking)
      this.writeGenerationMemory({
        success: false,
        duration: Date.now() - startTime,
        artStyle: this.config.artStyle,
        error: errorMessage,
        episodeTitle: brief?.story?.title,
      }).catch(() => {});

      return {
        success: false,
        checkpoints: this.checkpoints,
        events: this.events,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  private async runWorldBuilding(brief: FullCreativeBrief): Promise<WorldBible> {
    this.emit({ type: 'agent_start', agent: 'WorldBuilder', message: 'Creating world bible' });

    // Debug: Log the locations being sent to WorldBuilder
    this.emit({ type: 'debug', phase: 'world', message: `Sending ${brief.world.keyLocations.length} locations to WorldBuilder` });
    if (this.config.debug) {
      brief.world.keyLocations.forEach((loc, i) => {
        this.emit({ type: 'debug', phase: 'world', message: `  ${i + 1}. ${loc.id}: "${loc.name}" (${loc.importance})` });
      });
    }
    this.emit({ type: 'debug', phase: 'world', message: `Starting location ID: ${brief.episode.startingLocation}` });

    const result = await withTimeout(this.worldBuilder.execute({
      storyContext: {
        ...brief.story,
        userPrompt: brief.userPrompt,
      },
      worldPremise: brief.world.premise,
      timePeriod: brief.world.timePeriod,
      technologyLevel: brief.world.technologyLevel,
      magicSystem: brief.world.magicSystem,
      locationsToCreate: brief.world.keyLocations.map(loc => ({
        id: loc.id,
        name: loc.name,
        type: loc.type,
        briefDescription: loc.description,
        importance: loc.importance,
      })),
      rawDocument: brief.rawDocument,
      memoryContext: this.cachedPipelineMemory || undefined,
    }), PIPELINE_TIMEOUTS.llmAgent, 'WorldBuilder.execute');

    if (!result.success || !result.data) {
      console.error(`[Pipeline] World Builder failed with error:`, result.error);
      throw new PipelineError(
        `World Builder failed: ${result.error}`,
        'world_building',
        {
          agent: 'WorldBuilder',
          context: {
            locationsRequested: brief.world.keyLocations.length,
            premise: brief.world.premise?.substring(0, 100),
          },
        }
      );
    }

    this.emit({
      type: 'agent_complete',
      agent: 'WorldBuilder',
      message: `Created ${result.data.locations.length} locations, ${result.data.factions.length} factions`,
    });

    return result.data;
  }

  private async runCharacterDesign(
    brief: FullCreativeBrief,
    worldBible: WorldBible
  ): Promise<CharacterBible> {
    this.emit({ type: 'agent_start', agent: 'CharacterDesigner', message: 'Designing characters' });

    const protagonistEntry = {
      id: brief.protagonist.id,
      name: brief.protagonist.name,
      role: 'protagonist' as const,
      briefDescription: brief.protagonist.description,
      importance: 'major' as const,
    };

    // Deduplicate: filter any NPC that shares an ID or name with the protagonist
    const protId = brief.protagonist.id;
    const protName = brief.protagonist.name?.toLowerCase();
    const npcEntries = brief.npcs
      .filter(npc => npc.id !== protId && npc.name?.toLowerCase() !== protName)
      .map(npc => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        briefDescription: npc.description,
        importance: npc.importance,
      }));

    const charactersToCreate = [protagonistEntry, ...npcEntries];

    const result = await withTimeout(this.characterDesigner.execute({
      storyContext: {
        title: brief.story.title,
        genre: brief.story.genre,
        tone: brief.story.tone,
        themes: brief.story.themes,
        userPrompt: brief.userPrompt,
      },
      charactersToCreate,
      worldContext: worldBible.worldRules.join('. '),
      culturalNotes: worldBible.customs,
      rawDocument: brief.rawDocument,
      memoryContext: this.cachedPipelineMemory || undefined,
      seasonAnchors: brief.seasonPlan?.anchors,
      seasonSevenPoint: brief.seasonPlan?.sevenPoint,
    }), PIPELINE_TIMEOUTS.llmAgent, 'CharacterDesigner.execute');

    if (!result.success || !result.data) {
      throw new PipelineError(
        `Character Designer failed: ${result.error}`,
        'character_design',
        {
          agent: 'CharacterDesigner',
          context: {
            charactersRequested: charactersToCreate.length,
            characterNames: charactersToCreate.map(c => c.name),
          },
        }
      );
    }

    this.emit({
      type: 'agent_complete',
      agent: 'CharacterDesigner',
      message: `Created ${result.data.characters.length} character profiles`,
    });

    return result.data;
  }

  private async runEpisodeArchitecture(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible
  ): Promise<EpisodeBlueprint> {
    this.emit({ type: 'agent_start', agent: 'StoryArchitect', message: 'Creating episode blueprint' });

    const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

    // Build season plan directives for this specific episode
    const seasonPlanDirectives = buildSeasonPlanDirectives(brief, (message) => {
      console.warn(
        `[Pipeline] Season plan has no entry for episode ${brief.episode.number} — available episodes: ${brief.seasonPlan?.episodes.map((e) => e.episodeNumber).join(', ')}`,
      );
      this.emit({ type: 'warning', phase: 'architecture', message });
    });
    if (seasonPlanDirectives) {
      const encCount = seasonPlanDirectives.plannedEncounters?.length || 0;
      const branchCount = seasonPlanDirectives.incomingBranchEffects?.length || 0;
      this.emit({ 
        type: 'debug', 
        phase: 'architecture', 
        message: `Season plan directives: ${encCount} planned encounters, ${branchCount} incoming branch effects, difficulty: ${seasonPlanDirectives.difficultyTier || 'unset'}`
      });
    }

    // Look up the season-level structural context so StoryArchitect can
    // populate its episode arc block against the correct beat(s).
    const seasonPlan = brief.seasonPlan;
    const seasonEpisode = seasonPlan?.episodes.find((e) => e.episodeNumber === brief.episode.number);

    const result = await withTimeout(this.storyArchitect.execute({
      storyTitle: brief.story.title,
      genre: brief.story.genre,
      synopsis: brief.story.synopsis,
      tone: brief.story.tone,
      userPrompt: brief.userPrompt,
      episodeNumber: brief.episode.number,
      episodeTitle: brief.episode.title,
      episodeSynopsis: brief.episode.synopsis,
      protagonistDescription: protagonistProfile?.fullBackground || brief.protagonist.description,
      availableNPCs: characterBible.characters
        .filter(c => c.id !== brief.protagonist.id)
        .map(c => ({
          id: c.id,
          name: c.name,
          description: c.overview,
          relationshipContext: c.relationships.find(r => r.targetId === brief.protagonist.id)?.currentDynamic,
          initialRelationship: c.initialStats,
        })),
      worldContext: worldBible.worldRules.join('. ') + ' ' + worldBible.tensions.join('. '),
      currentLocation: brief.episode.startingLocation,
      previousEpisodeSummary: brief.episode.previousSummary,
      targetSceneCount: brief.multiEpisode?.preferences?.targetScenesPerEpisode || this.config.generation?.maxScenesPerEpisode || this.config.generation?.targetSceneCount || brief.options?.targetSceneCount || 6,
      majorChoiceCount: brief.multiEpisode?.preferences?.targetChoicesPerEpisode || this.config.generation?.majorChoiceCount || brief.options?.majorChoiceCount || 2,
      pacing: brief.multiEpisode?.preferences?.pacing,
      seasonPlanDirectives,
      seasonAnchors: seasonPlan?.anchors,
      seasonSevenPoint: seasonPlan?.sevenPoint,
      episodeStructuralRole: seasonEpisode?.structuralRole,
      memoryContext: this.cachedPipelineMemory || undefined,
    }), PIPELINE_TIMEOUTS.llmAgent, 'StoryArchitect.execute');

    if (!result.success || !result.data) {
      throw new PipelineError(
        `Story Architect failed: ${result.error}`,
        'episode_architecture',
        {
          agent: 'StoryArchitect',
          context: {
            episodeNumber: brief.episode.number,
            episodeTitle: brief.episode.title,
            hasSeasonPlanDirectives: !!seasonPlanDirectives,
          },
        }
      );
    }

    this.emit({
      type: 'agent_complete',
      agent: 'StoryArchitect',
      message: `Created blueprint with ${result.data.scenes.length} scenes`,
    });

    return result.data;
  }

  /**
   * Run BranchManager to analyze and validate branch structure
   */
  private async runBranchAnalysis(
    brief: FullCreativeBrief,
    blueprint: EpisodeBlueprint
  ): Promise<BranchAnalysis | null> {
    this.emit({ type: 'agent_start', agent: 'BranchManager', message: 'Analyzing branch structure' });

    try {
      const currentEpisodeNumber = brief.episode?.number;
      const structuralRoleForEpisode = currentEpisodeNumber
        ? brief.seasonPlan?.episodes?.find(e => e.episodeNumber === currentEpisodeNumber)?.structuralRole
        : undefined;

      const result = await withTimeout(this.branchManager.execute({
        episodeId: blueprint.episodeId,
        episodeTitle: blueprint.title,
        scenes: blueprint.scenes,
        startingSceneId: blueprint.startingSceneId,
        bottleneckScenes: blueprint.bottleneckScenes || [],
        availableFlags: blueprint.suggestedFlags || [],
        availableScores: blueprint.suggestedScores || [],
        availableTags: blueprint.suggestedTags || [],
        storyContext: {
          title: brief.story.title,
          genre: brief.story.genre,
          tone: brief.story.tone,
        },
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonSevenPoint: brief.seasonPlan?.sevenPoint,
        episodeStructuralRole: structuralRoleForEpisode,
      }), PIPELINE_TIMEOUTS.llmAgent, 'BranchManager.execute');

      if (!result.success || !result.data) {
        console.warn(`[Pipeline] BranchManager analysis failed: ${result.error}`);
        this.emit({
          type: 'agent_complete',
          agent: 'BranchManager',
          message: `Branch analysis failed (non-critical): ${result.error}`,
        });
        return null;
      }

      // Log validation issues (as warnings - branch structure issues are advisory, not blocking)
      if (result.data.validationIssues.length > 0) {
        for (const issue of result.data.validationIssues) {
          // Branch validation issues are advisory - don't block generation
          // The story can still work even if branching isn't perfect
          this.emit({
            type: 'warning',
            phase: 'branch_validation',
            message: `[${issue.type}] ${issue.description}`,
          });
        }
      }

      const deterministicTopology = analyzeBranchTopology(blueprint);
      for (const sceneId of deterministicTopology.unreachableSceneIds) {
        this.emit({
          type: 'warning',
          phase: 'branch_validation',
          message: `[deterministic] Scene ${sceneId} is unreachable from ${blueprint.startingSceneId}`,
        });
      }
      for (const sceneId of deterministicTopology.deadEndSceneIds) {
        this.emit({
          type: 'warning',
          phase: 'branch_validation',
          message: `[deterministic] Scene ${sceneId} dead-ends before the ending scene`,
        });
      }

      // I5: capture a side-by-side diff of the LLM vs deterministic passes
      // when shadow mode is enabled. No console spam here — the sidecar is
      // the consumer. The LLM pass keeps running either way (it already
      // does today), so this is pure observation, not gating.
      if (this.config.generation?.branchShadowModeEnabled) {
        try {
          const diff = buildBranchShadowDiff(result.data, deterministicTopology);
          this.branchShadowDiffs.push({ episodeId: blueprint.episodeId, diff });
        } catch (diffErr) {
          console.warn(`[Pipeline] Failed to build branch shadow diff: ${diffErr instanceof Error ? diffErr.message : diffErr}`);
        }
      }

      this.emit({
        type: 'agent_complete',
        agent: 'BranchManager',
        message: `Found ${result.data.branchPaths.length} paths, ${result.data.reconvergencePoints.length} reconvergence points, ${result.data.validationIssues.length} issues`,
      });

      return result.data;
    } catch (error) {
      console.warn(`[Pipeline] BranchManager threw error:`, error);
      this.emit({
        type: 'warning',
        phase: 'branch_analysis',
        message: `Branch analysis skipped due to error`,
      });
      return null;
    }
  }

  private async runContentGeneration(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    branchAnalysis?: BranchAnalysis
  ): Promise<{ sceneContents: SceneContent[]; choiceSets: ChoiceSet[]; encounters: Map<string, EncounterStructure> }> {
    const sceneContents: SceneContent[] = [];
    const choiceSets: ChoiceSet[] = [];
    const encounters: Map<string, EncounterStructure> = new Map();

    // Initialize incremental validation
    const incrementalConfig = {
      ...INCREMENTAL_VALIDATION_DEFAULTS,
      ...brief.options?.incrementalValidation,
    };
    
    // Extract known flags and scores from blueprint
    const knownFlags = blueprint.suggestedFlags?.map(f => f.name) || [];
    const knownScores = blueprint.suggestedScores?.map(s => s.name) || [];
    
    // Extract valid skills for encounter validation
    const validSkills = ['athletics', 'stealth', 'perception', 'persuasion', 'intimidation', 'deception', 'investigation', 'survival'];
    
    this.incrementalValidator = new IncrementalValidationRunner(
      knownFlags,
      knownScores,
      validSkills,
      incrementalConfig
    );

    // Initialize relationship baselines from character bible so the
    // validator can detect unreachable relationship conditions.
    const npcBaselines = characterBible.characters
      .filter(c => c.id !== brief.protagonist.id)
      .map(c => ({
        id: c.id,
        initialRelationship: c.initialStats as Partial<Record<string, number>> | undefined,
      }));
    this.incrementalValidator.setRelationshipBaselines(npcBaselines);
    
    // Reset scene validation results
    this.sceneValidationResults = [];
    // Reset encounter telemetry (I2 — fresh per episode run)
    this.encounterTelemetry = [];
    
    this.emit({
      type: 'debug',
      phase: 'incremental_validation',
      message: `Initialized incremental validation with ${knownFlags.length} flags, ${knownScores.length} scores, ${npcBaselines.length} NPC relationship baselines`,
      data: { config: incrementalConfig },
    });

    // Defense-in-depth: if the LLM set isEncounter but omitted encounterType,
    // auto-assign 'mixed' so the encounter pipeline doesn't silently skip the scene.
    for (const scene of blueprint.scenes) {
      if (scene.isEncounter && !scene.encounterType) {
        scene.encounterType = 'mixed';
        console.warn(`[Pipeline] Scene ${scene.id} has isEncounter=true but missing encounterType — defaulting to 'mixed'`);
        this.emit({ type: 'warning', phase: 'content', message: `Scene ${scene.id} encounter missing encounterType — defaulted to 'mixed'` });
      }
    }

    // Phase 1.1: Build a per-scene branch topology index from BranchManager output.
    // This is threaded into SceneWriter and ChoiceAuthor so they know whether a
    // given scene is a bottleneck, branch-only, or reconvergence point, and which
    // state variables need to be acknowledged at reconvergence.
    const branchContextByScene: Map<string, {
      role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear';
      branchPathIds?: string[];
      incomingBranchIds?: string[];
      stateReconciliationNotes?: string[];
      reconvergenceNarrativeAcknowledgment?: string;
    }> = new Map();
    if (branchAnalysis) {
      const bottlenecks = new Set(blueprint.bottleneckScenes || []);
      const branchPathsByScene = new Map<string, string[]>();
      for (const path of branchAnalysis.branchPaths || []) {
        for (const sid of path.sceneSequence || []) {
          const arr = branchPathsByScene.get(sid) || [];
          arr.push(path.id);
          branchPathsByScene.set(sid, arr);
        }
      }
      const reconvMap = new Map<string, ReconvergencePoint>();
      for (const rp of branchAnalysis.reconvergencePoints || []) {
        reconvMap.set(rp.sceneId, rp);
      }
      for (const scene of blueprint.scenes) {
        const paths = branchPathsByScene.get(scene.id) || [];
        const reconv = reconvMap.get(scene.id);
        let role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear' = 'linear';
        if (reconv) role = 'reconvergence';
        else if (bottlenecks.has(scene.id) || scene.purpose === 'bottleneck') role = 'bottleneck';
        else if (paths.length === 1) role = 'branch';
        branchContextByScene.set(scene.id, {
          role,
          branchPathIds: paths,
          incomingBranchIds: reconv?.incomingBranches,
          stateReconciliationNotes: reconv?.stateReconciliation?.map(
            r => `${r.stateVariable}: ${r.howToHandle}`
          ),
          reconvergenceNarrativeAcknowledgment: reconv?.narrativeAcknowledgment,
        });
      }
      // Emit a warning for any branch without reconvergence (branch_topology repair hint).
      const allReconvSceneIds = new Set((branchAnalysis.reconvergencePoints || []).map(r => r.sceneId));
      for (const path of branchAnalysis.branchPaths || []) {
        const endsAt = path.endSceneId;
        const endScene = blueprint.scenes.find(s => s.id === endsAt);
        const endsAtBottleneck = endScene ? (bottlenecks.has(endsAt) || endScene.purpose === 'bottleneck' || (endScene.leadsTo?.length || 0) === 0) : false;
        if (!allReconvSceneIds.has(endsAt) && !endsAtBottleneck) {
          this.emit({
            type: 'warning',
            phase: 'branch_topology',
            message: `Branch "${path.id}" ends at scene ${endsAt} without reconvergence; consider adding a bottleneck or reconvergence point`,
            data: { branchId: path.id, endSceneId: endsAt },
          });
        }
      }
    }

    // Phase 1.5: Build GrowthTemplate from season plan's growth curve for this
    // episode. It is attached to the first strategic choice point in the episode
    // (the "development scene" concept) so ChoiceAuthor can frame skill options
    // as in-world actions rather than stat labels.
    let episodeGrowthTemplate: ReturnType<typeof buildGrowthTemplates> | undefined;
    let growthTemplateAttached = false;
    try {
      const currentEpisodeNumber = brief.episode?.number ?? 1;
      const totalEpisodes = brief.seasonPlan?.episodes?.length ?? 1;
      const growthCurveEntry = (brief.seasonPlan as unknown as { growthCurve?: GrowthCurveEntry[] })?.growthCurve
        ?.find((g) => g.episodeNumber === currentEpisodeNumber);
      if (growthCurveEntry && growthCurveEntry.focusSkills && growthCurveEntry.focusSkills.length > 0) {
        episodeGrowthTemplate = buildGrowthTemplates(growthCurveEntry, currentEpisodeNumber, totalEpisodes);
        this.emit({
          type: 'debug',
          phase: 'content',
          message: `Growth template ready: ${episodeGrowthTemplate.skillOptions.length} skill options${episodeGrowthTemplate.mentorship ? ` + mentorship with ${episodeGrowthTemplate.mentorship.npcName}` : ''}`,
        });
      }
    } catch (err) {
      this.emit({
        type: 'warning',
        phase: 'content',
        message: `Failed to build growth templates: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Find the primary encounter scene so pre-encounter scenes can be written
    // with the encounter in mind. We take the first encounter scene as the anchor.
    const primaryEncounterScene = blueprint.scenes.find(s => s.isEncounter && s.encounterType);
    const primaryEncounterContext = primaryEncounterScene ? {
      encounterType: primaryEncounterScene.encounterType!,
      encounterDescription: primaryEncounterScene.encounterDescription || primaryEncounterScene.description,
      encounterDifficulty: primaryEncounterScene.encounterDifficulty || 'moderate',
      // encounterBuildup will be overridden per-scene below
      encounterBuildup: primaryEncounterScene.encounterBuildup || '',
    } : undefined;
    // Build a dependency graph and flatten topological waves into a serial
    // ordering. Scene content generation is intentionally serial today because
    // the loop below threads previous-scene summaries, repair loops, and shared
    // state. Real wave-based parallel execution is tracked as a follow-up once
    // the `ContentGenerationPhase` is extracted (see pipeline/phases/).
    const dependencyGraph = buildSceneDependencyGraph(blueprint);
    const topoWaves = dependencyGraph.hasCycle ? [] : buildTopologicalWaves(blueprint);
    this.dependencySchedulerStats.hasCycle = dependencyGraph.hasCycle;
    this.dependencySchedulerStats.waveCount = topoWaves.length;
    this.dependencySchedulerStats.fallbackToSerial = dependencyGraph.hasCycle;
    if (dependencyGraph.hasCycle) {
      this.emit({
        type: 'warning',
        phase: 'content',
        message: dependencyGraph.cycleReason || 'Scene dependency graph cycle detected; falling back to serial ordering.',
      });
    } else if (this.config.generation?.shadowSchedulerEnabled) {
      this.emit({
        type: 'debug',
        phase: 'content',
        message: `Dependency scheduler planned ${topoWaves.length} wave(s): ${topoWaves.map(w => `[${w.sceneIds.join(',')}]`).join(' -> ')}`,
      });
    }

    const sceneOrder = (!dependencyGraph.hasCycle && topoWaves.length > 0)
      ? topoWaves.flatMap((wave) => wave.sceneIds.map((id) => blueprint.scenes.find((s) => s.id === id)).filter((s): s is SceneBlueprint => Boolean(s)))
      : blueprint.scenes;

    // Safety: ensure every blueprint scene gets content, even if the dependency graph missed it
    const orderedIds = new Set(sceneOrder.map(s => s.id));
    for (const bp of blueprint.scenes) {
      if (!orderedIds.has(bp.id)) {
        console.warn(`[Pipeline] Scene ${bp.id} missing from topological order — appending to ensure content generation`);
        this.emit({ type: 'warning', phase: 'scenes', message: `Scene ${bp.id} not in dependency graph — appended to generation order` });
        sceneOrder.push(bp);
      }
    }

    const finalizedScenes = new Set<string>();
    const contentWorkTotal = Math.max(
      1,
      sceneOrder.reduce((sum, scene) =>
        sum + 1 + (scene.choicePoint ? 1 : 0) + (scene.isEncounter && scene.encounterType ? 1 : 0), 0)
    );
    let contentWorkCompleted = 0;
    this.emitPhaseProgress('content', 0, contentWorkTotal, 'content:work', 'Preparing scene generation queue...');

    for (let i = 0; i < sceneOrder.length; i++) {
      await this.checkCancellation();
      const sceneBlueprint = sceneOrder[i];
      const previousScene = i > 0 ? sceneContents[i - 1] : undefined;
      const requiredScenes = new Set<string>([
        ...(sceneBlueprint.requires || []),
        ...((dependencyGraph.nodes.get(sceneBlueprint.id)?.predecessors || [])),
      ]);
      const unresolvedDeps = Array.from(requiredScenes).filter((dep) => !finalizedScenes.has(dep));
      if (unresolvedDeps.length > 0) {
        throw new PipelineError(
          `Dependency contract violation in content generation for ${sceneBlueprint.id}: unresolved prerequisites ${unresolvedDeps.join(', ')}`,
          'content_generation',
          { context: { sceneId: sceneBlueprint.id, unresolvedDeps } }
        );
      }

      // Filter protagonist from npcsPresent — the protagonist is always implicit,
      // and including them as an NPC causes duplication in scenes and images
      if (sceneBlueprint.npcsPresent) {
        sceneBlueprint.npcsPresent = sceneBlueprint.npcsPresent.filter(
          npcId => npcId !== brief.protagonist.id
        );
      }

      // Resolve authored location first so downstream image systems do not re-guess scene setting.
      const location = this.resolveWorldLocationForScene(sceneBlueprint, worldBible);
      const sceneSettingContext = buildSceneSettingContext(sceneBlueprint, location, worldBible, brief);

      const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

      // Skip SceneWriter for encounter scenes - EncounterArchitect provides all content
      if (sceneBlueprint.isEncounter && sceneBlueprint.encounterType) {
        this.emit({
          type: 'debug',
          phase: 'scenes',
          message: `Skipping SceneWriter for encounter scene ${sceneBlueprint.id} - EncounterArchitect will provide content`,
        });

        // Create minimal placeholder scene content for encounters
        // The actual narrative content comes from EncounterArchitect's setupText and outcome narratives
        
        // Determine branch metadata
        const isBottleneck = blueprint.bottleneckScenes?.includes(sceneBlueprint.id) || sceneBlueprint.purpose === 'bottleneck';
        const incomingScenes = blueprint.scenes.filter(s => s.leadsTo?.includes(sceneBlueprint.id));
        const isConvergencePoint = incomingScenes.length > 1;
        
        const encounterSceneContent: SceneContent = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          locationId: sceneSettingContext.locationId,
          beats: [], // Empty - encounter beats come from EncounterArchitect
          startingBeatId: '', // Will be set from encounter structure
          moodProgression: [sceneBlueprint.mood],
          charactersInvolved: sceneBlueprint.npcsPresent,
          keyMoments: [sceneBlueprint.encounterDescription || sceneBlueprint.description],
          continuityNotes: [`Encounter scene: ${sceneBlueprint.encounterType}`],
          // Branch metadata for visual differentiation
          branchType: this.inferBranchType(sceneBlueprint, blueprint),
          isBottleneck,
          isConvergencePoint,
          settingContext: sceneSettingContext,
        };
        sceneContents.push(encounterSceneContent);
        contentWorkCompleted += 1;
        this.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Scene scaffold ready for ${sceneBlueprint.id}`
        );
      } else {
        // Regular scene - use SceneWriter
        this.emit({
          type: 'agent_start',
          agent: 'SceneWriter',
          message: `Writing scene ${i + 1}/${blueprint.scenes.length}: ${sceneBlueprint.name}`,
        });

        const sceneWriterInput = {
          sceneBlueprint,
          storyContext: {
            title: brief.story.title,
            genre: brief.story.genre,
            tone: brief.story.tone,
            userPrompt: brief.userPrompt,
            worldContext: this.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
          },
          protagonistInfo: {
            name: brief.protagonist.name,
            pronouns: brief.protagonist.pronouns,
            description: protagonistProfile?.fullBackground || brief.protagonist.description,
            physicalDescription: protagonistProfile?.physicalDescription,
          },
          npcs: sceneBlueprint.npcsPresent.map(npcId => {
            const profile = characterBible.characters.find(c => c.id === npcId);
            return {
              id: npcId,
              name: profile?.name || npcId,
              pronouns: profile?.pronouns || 'he/him',
              description: profile?.overview || '',
              physicalDescription: profile?.physicalDescription,
              voiceNotes: profile?.voiceProfile?.writingGuidance || '',
              currentMood: profile?.voiceProfile?.whenNervous,
            };
          }),
          relevantFlags: blueprint.suggestedFlags,
          relevantScores: blueprint.suggestedScores,
          unresolvedCallbacks: this.getUnresolvedCallbacksForPrompt(brief.episode?.number),
          targetBeatCount: sceneBlueprint.purpose === 'bottleneck' 
            ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
            : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount),
          dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
          previousSceneSummary: previousScene
            ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
            : undefined,
          incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
          sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
          episodeEncounterContext: primaryEncounterContext && !sceneBlueprint.isEncounter
            ? {
                ...primaryEncounterContext,
                encounterBuildup: sceneBlueprint.encounterBuildup || primaryEncounterContext.encounterBuildup,
              }
            : undefined,
          memoryContext: this.cachedPipelineMemory || undefined,
          branchContext: branchContextByScene.get(sceneBlueprint.id),
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonSevenPoint: brief.seasonPlan?.sevenPoint,
          episodeStructuralRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.structuralRole,
        };

        // === KARPATHY LOOP: Best-of-N for critical scenes ===
        const bestOfN = brief.options?.bestOfN ?? BEST_OF_N_DEFAULTS.candidates;
        const isCriticalScene =
          (BEST_OF_N_DEFAULTS.enabledForBottleneck && (sceneBlueprint.purpose === 'bottleneck' || blueprint.bottleneckScenes?.includes(sceneBlueprint.id))) ||
          (BEST_OF_N_DEFAULTS.enabledForOpening && sceneBlueprint.id === blueprint.startingSceneId) ||
          (BEST_OF_N_DEFAULTS.enabledForClimax && sceneBlueprint.purpose === 'climax');
        const useBestOfN = bestOfN > 1 && isCriticalScene && this.incrementalValidator;

        let sceneResult: AgentResponse<SceneContent>;

        if (useBestOfN) {
          this.emit({
            type: 'debug',
            phase: 'scenes',
            message: `Best-of-${bestOfN} for critical scene ${sceneBlueprint.id} (${sceneBlueprint.purpose || 'opening'})`,
          });

          const candidates = await Promise.all(
            Array.from({ length: bestOfN }, (_, idx) =>
              withTimeout(
                this.sceneWriter.execute(sceneWriterInput),
                PIPELINE_TIMEOUTS.llmAgent,
                `SceneWriter.execute(${sceneBlueprint.id} candidate-${idx})`
              ).catch((err) => ({
                success: false as const,
                data: null as SceneContent | null,
                error: err instanceof Error ? err.message : String(err),
              }))
            )
          );

          const validCandidates = candidates.filter(
            (c): c is AgentResponse<SceneContent> & { success: true; data: SceneContent } =>
              c.success === true && c.data != null
          );

          if (validCandidates.length > 1) {
            const bestOfNVoiceProfiles: CharacterVoiceProfile[] = sceneBlueprint.npcsPresent
              .map(npcId => {
                const profile = characterBible.characters.find(c => c.id === npcId);
                if (!profile?.voiceProfile) return null;
                return {
                  characterId: npcId,
                  characterName: profile.name,
                  voiceGuidance: profile.voiceProfile.writingGuidance || '',
                  speechPatterns: profile.voiceProfile.speechPatterns || [],
                  vocabularyLevel: profile.voiceProfile.vocabularyLevel,
                };
              })
              .filter((p): p is CharacterVoiceProfile => p !== null);

            const scored = await Promise.all(
              validCandidates.map(async (candidate) => {
                const tempContent = { ...candidate.data, sceneId: sceneBlueprint.id };
                const validation = await this.incrementalValidator!.validateScene(
                  tempContent,
                  undefined,
                  bestOfNVoiceProfiles,
                  undefined
                );
                const voiceScore = validation.voice?.score ?? 0;
                const stakesScore = validation.stakes?.score ?? 0;
                return { candidate, score: voiceScore + stakesScore, validation };
              })
            );

            scored.sort((a, b) => b.score - a.score);
            sceneResult = scored[0].candidate;
            this.emit({
              type: 'debug',
              phase: 'scenes',
              message: `Best-of-${bestOfN} winner for ${sceneBlueprint.id}: score ${scored[0].score} vs ${scored.slice(1).map(s => s.score).join(', ')}`,
            });
          } else if (validCandidates.length === 1) {
            sceneResult = validCandidates[0];
          } else {
            sceneResult = candidates[0] as AgentResponse<SceneContent>;
          }
        } else {
          sceneResult = await withTimeout(
            this.sceneWriter.execute(sceneWriterInput),
            PIPELINE_TIMEOUTS.llmAgent,
            `SceneWriter.execute(${sceneBlueprint.id})`
          );
        }

        if (!sceneResult.success || !sceneResult.data) {
          // Karpathy loop: retry SceneWriter once with explicit error feedback before falling back
          this.emit({
            type: 'regeneration_triggered',
            phase: 'scenes',
            message: `SceneWriter failed for ${sceneBlueprint.id}, retrying with error feedback`,
            data: { reason: sceneResult.error },
          });

          const retrySceneResult = await withTimeout(this.sceneWriter.execute({
            sceneBlueprint,
            storyContext: {
              title: brief.story.title,
              genre: brief.story.genre,
              tone: brief.story.tone,
              userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Previous scene generation attempt FAILED with error: ${sceneResult.error}. Please produce valid scene content. Keep it simple and well-structured.`,
              worldContext: this.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
            },
            protagonistInfo: {
              name: brief.protagonist.name,
              pronouns: brief.protagonist.pronouns,
              description: protagonistProfile?.fullBackground || brief.protagonist.description,
              physicalDescription: protagonistProfile?.physicalDescription,
            },
            npcs: sceneBlueprint.npcsPresent.map(npcId => {
              const profile = characterBible.characters.find(c => c.id === npcId);
              return {
                id: npcId,
                name: profile?.name || npcId,
                pronouns: profile?.pronouns || 'he/him',
                description: profile?.overview || '',
                physicalDescription: profile?.physicalDescription,
                voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                currentMood: profile?.voiceProfile?.whenNervous,
              };
            }),
            relevantFlags: blueprint.suggestedFlags,
            relevantScores: blueprint.suggestedScores,
            targetBeatCount: sceneBlueprint.purpose === 'bottleneck'
              ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
              : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount),
            dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
            previousSceneSummary: previousScene
              ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
              : undefined,
            incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
            sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
            memoryContext: this.cachedPipelineMemory || undefined,
          }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneBlueprint.id} retry)`);

          if (retrySceneResult.success && retrySceneResult.data) {
            // Retry succeeded — replace the original result so the rest of the loop uses it
            sceneResult = retrySceneResult;
            this.emit({
              type: 'debug',
              phase: 'scenes',
              message: `SceneWriter retry succeeded for ${sceneBlueprint.id}`,
            });
          } else {
            // Retry also failed — fall back to placeholder
            const swFailMsg = `Scene Writer failed on ${sceneBlueprint.id} after retry: ${retrySceneResult.error || sceneResult.error}`;
            console.error(`[Pipeline] ❌ ${swFailMsg}`);
            this.emit({ type: 'warning', phase: 'scenes', message: swFailMsg });
            this.throwIfFailFast(swFailMsg, 'content', {
              agent: 'SceneWriter',
              context: {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                failureKind: 'content',
              },
            });

            sceneContents.push({
              sceneId: sceneBlueprint.id,
              sceneName: sceneBlueprint.name,
              locationId: sceneSettingContext.locationId,
              beats: [{
                id: `${sceneBlueprint.id}-fallback-beat-1`,
                text: `[Scene content generation failed: ${sceneResult.error || 'Unknown error'}]`,
                nextBeatId: undefined,
              }],
              startingBeatId: `${sceneBlueprint.id}-fallback-beat-1`,
              moodProgression: [sceneBlueprint.mood],
              charactersInvolved: sceneBlueprint.npcsPresent,
              keyMoments: [sceneBlueprint.description],
              continuityNotes: [`SceneWriter failed: ${sceneResult.error}`],
              settingContext: sceneSettingContext,
            });
            finalizedScenes.add(sceneBlueprint.id);
            contentWorkCompleted += 1;
            this.emitPhaseProgress(
              'content',
              contentWorkCompleted,
              contentWorkTotal,
              'content:work',
              `Fallback scene scaffold created for ${sceneBlueprint.id}`
            );
            if (sceneBlueprint.choicePoint) {
              contentWorkCompleted += 1;
              this.emitPhaseProgress(
                'content',
                contentWorkCompleted,
                contentWorkTotal,
                'content:work',
                `Skipped choice generation for ${sceneBlueprint.id}`
              );
            }
            continue;
          }
        }

        // Ensure the scene content has the correct sceneId matching the blueprint
        const sceneContent = sceneResult.data;
        sceneContent.sceneId = sceneBlueprint.id;
        sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
        sceneContent.locationId = sceneSettingContext.locationId;
        sceneContent.settingContext = sceneSettingContext;
        
        // Add branch metadata for visual differentiation
        const isSceneBottleneck = blueprint.bottleneckScenes?.includes(sceneBlueprint.id) || sceneBlueprint.purpose === 'bottleneck';
        const incomingToScene = blueprint.scenes.filter(s => s.leadsTo?.includes(sceneBlueprint.id));
        const isSceneConvergence = incomingToScene.length > 1;
        
        sceneContent.branchType = this.inferBranchType(sceneBlueprint, blueprint);
        sceneContent.isBottleneck = isSceneBottleneck;
        sceneContent.isConvergencePoint = isSceneConvergence;
        sceneContent.incomingChoiceContext = sceneBlueprint.incomingChoiceContext;

        sceneContents.push(sceneContent);

        this.emit({
          type: 'agent_complete',
          agent: 'SceneWriter',
          message: `Wrote ${sceneContent.beats.length} beats for ${sceneBlueprint.id}`,
        });
        contentWorkCompleted += 1;
        this.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Scene written for ${sceneBlueprint.id}`
        );

        // Choice Author (for non-encounter scenes with choice points)
        this.emit({ type: 'debug', phase: 'scenes', message: `Scene ${sceneBlueprint.id} choicePoint: ${sceneBlueprint.choicePoint ? `YES (${sceneBlueprint.choicePoint.type})` : 'NO'}` });
        if (sceneBlueprint.choicePoint) {
          let choicePointBeat = sceneResult.data.beats.find(b => b.isChoicePoint);
          this.emit({ type: 'debug', phase: 'choices', message: `Looking for choicePoint beat in ${sceneResult.data.beats.length} beats... Found: ${choicePointBeat ? choicePointBeat.id : 'NONE'}` });

          // FALLBACK: If SceneWriter didn't mark a choice point but the blueprint requires one,
          // auto-mark the last beat as the choice point to ensure choices are generated
          if (!choicePointBeat && sceneResult.data.beats.length > 0) {
            const lastBeat = sceneResult.data.beats[sceneResult.data.beats.length - 1];
            console.warn(`[Pipeline] FALLBACK: Auto-marking last beat "${lastBeat.id}" as isChoicePoint for scene ${sceneBlueprint.id}`);
            lastBeat.isChoicePoint = true;
            choicePointBeat = lastBeat;
          }

          if (choicePointBeat) {
            this.emit({
              type: 'agent_start',
              agent: 'ChoiceAuthor',
              message: `Creating choices for ${sceneBlueprint.name}`,
            });

            const choiceResult = await withTimeout(this.choiceAuthor.execute({
              sceneBlueprint,
              beatText: choicePointBeat.text,
              beatId: choicePointBeat.id,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: brief.userPrompt,
                worldContext: this.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
              },
              protagonistInfo: {
                name: brief.protagonist.name,
                pronouns: brief.protagonist.pronouns,
              },
              npcsInScene: this.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
              availableFlags: blueprint.suggestedFlags,
              availableScores: blueprint.suggestedScores,
              availableTags: blueprint.suggestedTags,
              unresolvedCallbacks: this.getUnresolvedCallbacksForPrompt(brief.episode?.number),
              possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                const scene = blueprint.scenes.find(s => s.id === id);
                return {
                  id,
                  name: scene?.name || id,
                  description: scene?.description || '',
                };
              }),
              optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
              sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
              memoryContext: this.cachedPipelineMemory || undefined,
              growthTemplates: (() => {
                // Attach the episode-level growth template to the FIRST
                // strategic choice point (the development scene anchor).
                if (!episodeGrowthTemplate || growthTemplateAttached) return undefined;
                const isStrategic = sceneBlueprint.choicePoint?.type === 'strategic';
                const isTransition = sceneBlueprint.purpose === 'transition';
                if (isStrategic && isTransition) {
                  growthTemplateAttached = true;
                  return episodeGrowthTemplate;
                }
                return undefined;
              })(),
              branchContext: (() => {
                const bc = branchContextByScene.get(sceneBlueprint.id);
                if (!bc) return undefined;
                const leadsToDistinct = new Set(sceneBlueprint.leadsTo || []).size;
                return {
                  role: bc.role,
                  isBranchPoint: leadsToDistinct > 1 || (sceneBlueprint.choicePoint?.type === 'branching'),
                  expectedBranches: leadsToDistinct > 1 ? leadsToDistinct : undefined,
                  reconvergenceTargets: bc.incomingBranchIds,
                  stateReconciliationHints: bc.stateReconciliationNotes,
                };
              })(),
              consequenceBudgetTarget: { callback: 60, tint: 25, branchlet: 10, branch: 5 },
              seasonAnchors: brief.seasonPlan?.anchors,
              seasonSevenPoint: brief.seasonPlan?.sevenPoint,
              episodeStructuralRole: brief.seasonPlan?.episodes.find(
                (e) => e.episodeNumber === brief.episode.number,
              )?.structuralRole,
            }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id})`);

            if (!choiceResult.success || !choiceResult.data) {
              // ChoiceAuthor failed — warn and continue. The scene will be included
              // but without branching choices at this point.
              const caFailMsg = `Choice Author failed on ${sceneBlueprint.id}: ${choiceResult.error}`;
              console.error(`[Pipeline] ❌ ${caFailMsg}`);
              this.emit({ type: 'warning', phase: 'choices', message: caFailMsg });
            } else {
            choiceSets.push({ ...choiceResult.data, sceneId: sceneBlueprint.id });

            this.emit({
              type: 'agent_complete',
              agent: 'ChoiceAuthor',
              message: `Created ${choiceResult.data.choices.length} choices`,
            });

            // === INCREMENTAL STAKES VALIDATION ===
            if (this.incrementalValidator && incrementalConfig.stakesValidation) {
              const stakesResult = this.incrementalValidator.validateStakes(choiceResult.data);
              
              if (!stakesResult.passed) {
                this.emit({
                  type: 'incremental_validation',
                  phase: 'stakes',
                  message: `Stakes validation: ${stakesResult.score}/100 for ${sceneBlueprint.id}`,
                  data: { issues: stakesResult.issues, hasFalseChoices: stakesResult.hasFalseChoices },
                });

                // Attempt regeneration if needed
                if (stakesResult.shouldRegenerate) {
                  let choiceRegenerationAttempt = 0;
                  let currentStakesResult = stakesResult;
                  let currentChoiceData = choiceResult.data;
                  
                  while (
                    currentStakesResult.shouldRegenerate &&
                    choiceRegenerationAttempt < incrementalConfig.maxRegenerationAttempts
                  ) {
                    choiceRegenerationAttempt++;
                    this.emit({
                      type: 'regeneration_triggered',
                      phase: 'choices',
                      message: `Regenerating choices for ${sceneBlueprint.id} (attempt ${choiceRegenerationAttempt})`,
                      data: { reason: currentStakesResult.issues.map(i => i.issue) },
                    });

                    // Regenerate with guidance
                    const revisedChoiceResult = await withTimeout(this.choiceAuthor.execute({
                      sceneBlueprint,
                      beatText: choicePointBeat.text,
                      beatId: choicePointBeat.id,
                      storyContext: {
                        title: brief.story.title,
                        genre: brief.story.genre,
                        tone: brief.story.tone,
                        userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Fix these stakes issues: ${currentStakesResult.issues.map(i => i.issue).join('; ')}`,
                        worldContext: this.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
                      },
                      protagonistInfo: {
                        name: brief.protagonist.name,
                        pronouns: brief.protagonist.pronouns,
                      },
                      npcsInScene: this.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
                      availableFlags: blueprint.suggestedFlags,
                      availableScores: blueprint.suggestedScores,
                      availableTags: blueprint.suggestedTags,
                      possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                        const scene = blueprint.scenes.find(s => s.id === id);
                        return { id, name: scene?.name || id, description: scene?.description || '' };
                      }),
                      optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
                      sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                      memoryContext: this.cachedPipelineMemory || undefined,
                    }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id} regen)`);

                    if (revisedChoiceResult.success && revisedChoiceResult.data) {
                      currentChoiceData = revisedChoiceResult.data;
                      currentStakesResult = this.incrementalValidator.validateStakes(currentChoiceData);
                      
                      // Update the choice set in the array
                      choiceSets[choiceSets.length - 1] = currentChoiceData;
                    } else {
                      break; // Stop if regeneration fails
                    }
                  }

                  if (currentStakesResult.hasFalseChoices) {
                    this.emit({
                      type: 'warning',
                      phase: 'incremental_validation',
                      message: `False choices remain in ${sceneBlueprint.id} after ${choiceRegenerationAttempt} attempts`,
                    });
                  }
                }
              }

              // Track flags and relationship changes set by choices for continuity
              for (const choice of choiceResult.data.choices) {
                for (const consequence of choice.consequences || []) {
                  if (consequence.type === 'setFlag') {
                    this.incrementalValidator.trackFlagSet((consequence as { flag: string }).flag);
                  }
                  if (consequence.type === 'relationship' || consequence.type === 'changeRelationship') {
                    const rel = consequence as { characterId?: string; npcId?: string; dimension?: string; change?: number };
                    const npcId = rel.characterId || rel.npcId;
                    if (npcId && rel.dimension && typeof rel.change === 'number') {
                      this.incrementalValidator.trackRelationshipChange(npcId, rel.dimension, rel.change);
                    }
                  }
                }
              }
            }
            // === CHOICE PAYOFF BEATS ===
            // For non-branching choices (expression/flavor), create per-choice payoff beats
            // so each choice gets a unique visual beat showing the action before advancing.
            const finalChoiceSet = choiceSets[choiceSets.length - 1];
            if (finalChoiceSet) {
              const nonBranchingChoices = finalChoiceSet.choices.filter(
                c => !c.nextSceneId && !c.nextBeatId
              );

              if (nonBranchingChoices.length > 0 && choicePointBeat) {
                const nextSceneId = sceneBlueprint.leadsTo?.[0];

                for (let ci = 0; ci < nonBranchingChoices.length; ci++) {
                  const choice = nonBranchingChoices[ci];
                  const payoffId = `${choicePointBeat.id}-payoff-${ci + 1}`;

                  // Use the authored outcomeTexts.partial as the narrative prose for this beat.
                  // This is the original story text describing the choice IN ACTION — not the
                  // choice label itself (which is dialogue / a decision prompt, not prose).
                  //
                  // Fallback chain (best → worst):
                  //   1. outcomeTexts.partial — distinct narrative prose (preferred)
                  //   2. reactionText — world response to the choice (better than repeating label)
                  //   3. Derived from choice label — used only as last resort
                  const GENERIC_REACTION = 'The moment settles, its weight already reshaping what comes next.';
                  const partialIsDistinct = choice.outcomeTexts?.partial
                    && choice.outcomeTexts.partial.trim() !== choice.text.trim();
                  const reactionIsDistinct = choice.reactionText
                    && choice.reactionText.trim() !== choice.text.trim()
                    && choice.reactionText.trim() !== GENERIC_REACTION;
                  
                  const narrativeText = partialIsDistinct
                    ? choice.outcomeTexts!.partial
                    : reactionIsDistinct
                      ? choice.reactionText!
                      : (choice.text.endsWith('.') ? choice.text : choice.text + '.');
                  
                  if (!partialIsDistinct) {
                    console.warn(`[Pipeline] ⚠ Choice "${choice.id}" has no distinct outcomeTexts.partial — payoff beat will ${reactionIsDistinct ? 'use reactionText' : 'repeat choice label'}. This means the ChoiceAuthor LLM omitted or repeated outcomeTexts for this choice.`);
                  }

                  const payoffBeat: GeneratedBeat & {
                    isChoicePayoff?: boolean;
                    textVariants?: Array<{ condition: object; text: string }>;
                    choiceContext?: string;
                  } = {
                    id: payoffId,
                    text: narrativeText,
                    // textVariants: swap to success/failure outcome prose at runtime based on stat-check result
                    textVariants: choice.outcomeTexts ? [
                      {
                        condition: { type: 'flag', flag: '_outcome_success', value: true },
                        text: choice.outcomeTexts.success,
                      },
                      {
                        condition: { type: 'flag', flag: '_outcome_failure', value: true },
                        text: choice.outcomeTexts.failure,
                      },
                    ] : undefined,
                    isChoicePoint: false,
                    nextBeatId: choicePointBeat.nextBeatId,
                    // Use the narrative prose as the visual description, NOT the choice label.
                    // The choice label is dialogue/decision text; the outcomeTexts describe the
                    // physical action unfolding — which is what the image should depict.
                    visualMoment: narrativeText,
                    primaryAction: narrativeText,
                    emotionalRead: 'Living out the consequences of the chosen action',
                    // mustShowDetail is intentionally omitted here — embedding the narrative
                    // prose into the composition "Must include:" field produces bad prompts.
                    // The visualMoment + primaryAction fields carry the visual intent.
                    //
                    // Store the choice label separately so the image system can use it as a
                    // natural-language anchor ("the player chose X — show it playing out").
                    choiceContext: choice.text,
                    isChoicePayoff: true,
                  };

                  choice.nextBeatId = payoffId;
                  sceneContent.beats.push(payoffBeat as GeneratedBeat);
                }

                this.emit({
                  type: 'debug',
                  phase: 'choices',
                  message: `Created ${nonBranchingChoices.length} payoff beats for expression choices in ${sceneBlueprint.id}`,
                });
              }
            }

            } // close else (choiceResult success)
          }
          contentWorkCompleted += 1;
          this.emitPhaseProgress(
            'content',
            contentWorkCompleted,
            contentWorkTotal,
            'content:work',
            `Choice pass complete for ${sceneBlueprint.id}`
          );
        }

        // === INCREMENTAL SCENE VALIDATION (Voice, Sensitivity, Continuity) ===
        if (this.incrementalValidator) {
          const voiceProfiles: CharacterVoiceProfile[] = sceneBlueprint.npcsPresent
            .map(npcId => {
              const profile = characterBible.characters.find(c => c.id === npcId);
              if (profile && profile.voiceProfile) {
                return {
                  id: profile.id,
                  name: profile.name,
                  voiceProfile: profile.voiceProfile,
                };
              }
              return null;
            })
            .filter((p): p is CharacterVoiceProfile => p !== null);

          const sceneChoiceSet = choiceSets.find(cs => 
            sceneContent.beats.some(b => b.id === cs.beatId)
          );

          const sceneValidation = await this.incrementalValidator.validateScene(
            sceneContent,
            sceneChoiceSet,
            voiceProfiles,
            undefined // No encounter for regular scenes
          );

          this.sceneValidationResults.push(sceneValidation);

          this.emit({
            type: 'incremental_validation',
            phase: 'scene_complete',
            message: `Scene ${sceneBlueprint.id}: ${sceneValidation.overallPassed ? 'PASSED' : 'ISSUES FOUND'}`,
            data: {
              voice: sceneValidation.voice ? { score: sceneValidation.voice.score, issues: sceneValidation.voice.issues.length } : null,
              sensitivity: sceneValidation.sensitivity ? { passed: sceneValidation.sensitivity.passed, flags: sceneValidation.sensitivity.flags.length } : null,
              continuity: sceneValidation.continuity ? { passed: sceneValidation.continuity.passed, issues: sceneValidation.continuity.issues.length } : null,
            },
          });

          // Emit warnings for sensitivity issues
          if (sceneValidation.sensitivity && !sceneValidation.sensitivity.passed) {
            this.emit({
              type: 'warning',
              phase: 'sensitivity',
              message: `Content rating concern in ${sceneBlueprint.id}: may push to ${sceneValidation.sensitivity.ratingImplication}`,
              data: { flags: sceneValidation.sensitivity.flags },
            });
          }

          // Emit warnings for continuity issues (non-blocking)
          if (sceneValidation.continuity && !sceneValidation.continuity.passed) {
            for (const issue of sceneValidation.continuity.issues.filter(i => i.severity === 'error')) {
              this.emit({
                type: 'warning',
                phase: 'continuity',
                message: `Continuity issue in ${sceneBlueprint.id}: ${issue.detail}`,
              });
            }
          }

          // === KARPATHY LOOP: Scene regeneration based on voice/continuity validation ===
          if (sceneValidation.regenerationRequested === 'scene' && incrementalConfig.voiceValidation) {
            let sceneRegenAttempt = 0;
            const maxSceneRegenAttempts = incrementalConfig.maxRegenerationAttempts;

            while (sceneRegenAttempt < maxSceneRegenAttempts) {
              sceneRegenAttempt++;
              const issueDescriptions: string[] = [];
              if (sceneValidation.voice && sceneValidation.voice.issues.length > 0) {
                issueDescriptions.push(
                  ...sceneValidation.voice.issues.map(i => `Voice issue (${i.characterName}): ${i.issue}`)
                );
              }
              if (sceneValidation.continuity && sceneValidation.continuity.issues.length > 0) {
                issueDescriptions.push(
                  ...sceneValidation.continuity.issues.map(i => `Continuity: ${i.detail}`)
                );
              }

              this.emit({
                type: 'regeneration_triggered',
                phase: 'scenes',
                message: `Regenerating scene ${sceneBlueprint.id} for voice/continuity (attempt ${sceneRegenAttempt}/${maxSceneRegenAttempts})`,
                data: { reason: issueDescriptions },
              });

              const revisedSceneResult = await withTimeout(this.sceneWriter.execute({
                sceneBlueprint,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Fix these issues from validation:\n${issueDescriptions.join('\n')}`,
                  worldContext: this.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                  description: protagonistProfile?.fullBackground || brief.protagonist.description,
                  physicalDescription: protagonistProfile?.physicalDescription,
                },
                npcs: sceneBlueprint.npcsPresent.map(npcId => {
                  const profile = characterBible.characters.find(c => c.id === npcId);
                  return {
                    id: npcId,
                    name: profile?.name || npcId,
                    pronouns: profile?.pronouns || 'he/him',
                    description: profile?.overview || '',
                    physicalDescription: profile?.physicalDescription,
                    voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                    currentMood: profile?.voiceProfile?.whenNervous,
                  };
                }),
                relevantFlags: blueprint.suggestedFlags,
                relevantScores: blueprint.suggestedScores,
                targetBeatCount: sceneBlueprint.purpose === 'bottleneck'
                  ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
                  : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount),
                dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
                previousSceneSummary: previousScene
                  ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
                  : undefined,
                incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: this.cachedPipelineMemory || undefined,
              }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneBlueprint.id} regen-${sceneRegenAttempt})`);

              if (!revisedSceneResult.success || !revisedSceneResult.data) {
                this.emit({
                  type: 'warning',
                  phase: 'scenes',
                  message: `Scene regeneration failed for ${sceneBlueprint.id}, keeping original`,
                });
                break;
              }

              const revisedContent = revisedSceneResult.data;
              revisedContent.sceneId = sceneBlueprint.id;
              revisedContent.sceneName = revisedContent.sceneName || sceneBlueprint.name;
              revisedContent.locationId = sceneSettingContext.locationId;
              revisedContent.settingContext = sceneSettingContext;

              const revisedValidation = await this.incrementalValidator.validateScene(
                revisedContent,
                sceneChoiceSet,
                voiceProfiles,
                undefined
              );

              if (revisedValidation.regenerationRequested === 'none' ||
                  (revisedValidation.voice && sceneValidation.voice &&
                   revisedValidation.voice.score > sceneValidation.voice.score)) {
                // Revised version is better — swap it in
                const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneBlueprint.id);
                if (sceneIdx !== -1) {
                  sceneContents[sceneIdx] = revisedContent;
                }
                // Update the validation result too
                const valIdx = this.sceneValidationResults.findIndex(v => v.sceneId === sceneBlueprint.id);
                if (valIdx !== -1) {
                  this.sceneValidationResults[valIdx] = revisedValidation;
                }
                this.emit({
                  type: 'debug',
                  phase: 'scenes',
                  message: `Scene ${sceneBlueprint.id} regenerated successfully (voice: ${sceneValidation.voice?.score ?? '?'} -> ${revisedValidation.voice?.score ?? '?'})`,
                });
                break;
              }

              // Update references for next loop iteration
              Object.assign(sceneValidation, revisedValidation);
            }
          }
        }
      }

      // Encounter Architect (if this is an encounter scene)
      if (sceneBlueprint.isEncounter && sceneBlueprint.encounterType) {
        this.emit({
          type: 'agent_start',
          agent: 'EncounterArchitect',
          message: `Designing ${sceneBlueprint.encounterType} encounter for ${sceneBlueprint.name}`,
        });

        // Build available skills — start with defaults, then merge in season plan skills
        const defaultSkills: Array<{ name: string; attribute: string; description: string }> = [...DEFAULT_SKILLS];
        const seasonEp = brief.seasonPlan?.episodes.find(e => e.episodeNumber === brief.episode.number);
        const plannedEnc = seasonEp?.plannedEncounters?.find(pe => 
          pe.id === sceneBlueprint.plannedEncounterId ||
          pe.id === sceneBlueprint.id || 
          sceneBlueprint.name?.toLowerCase().includes(pe.description?.toLowerCase()?.substring(0, 20) || '')
        );
        const encounterBeatPlan = (sceneBlueprint.encounterBeatPlan && sceneBlueprint.encounterBeatPlan.length > 0
          ? sceneBlueprint.encounterBeatPlan
          : [
              sceneBlueprint.encounterBuildup || plannedEnc?.encounterBuildup || `Opening pressure around ${sceneBlueprint.encounterDescription || sceneBlueprint.description}`,
              sceneBlueprint.encounterDescription || plannedEnc?.description || sceneBlueprint.description,
              sceneBlueprint.encounterStakes || plannedEnc?.stakes || 'A final commitment decides the cost of success or failure',
            ]
        )
          .map((beat) => (beat || '').trim())
          .filter(Boolean)
          .slice(0, 5);
        const encounterRelevantSkills = Array.from(new Set([
          ...(sceneBlueprint.encounterRelevantSkills || []),
          ...(plannedEnc?.relevantSkills || []),
        ].map((skill) => skill.trim()).filter(Boolean)));
        const encounterRequiredNpcIds = Array.from(new Set([
          ...(sceneBlueprint.encounterRequiredNpcIds || []),
          ...(plannedEnc?.npcsInvolved || []),
          ...(sceneBlueprint.npcsPresent || []),
        ]));
        
        // Merge in skills from season plan's planned encounters for this scene
        if (brief.seasonPlan) {
          if (encounterRelevantSkills.length > 0) {
            const existingNames = new Set(defaultSkills.map(s => s.name.toLowerCase()));
            for (const skillName of encounterRelevantSkills) {
              if (!existingNames.has(skillName.toLowerCase())) {
                // Infer attribute from skill name
                const socialSkills = ['diplomacy', 'charm', 'bluff', 'negotiation', 'leadership', 'empathy'];
                const mindSkills = ['arcana', 'lore', 'history', 'medicine', 'technology', 'hacking', 'engineering', 'science'];
                const attr = socialSkills.includes(skillName.toLowerCase()) ? 'social' 
                  : mindSkills.includes(skillName.toLowerCase()) ? 'mind' : 'body';
                defaultSkills.push({ name: skillName.toLowerCase(), attribute: attr, description: `${skillName} (from season plan)` });
              }
            }
          }
        }

        // Determine next scene IDs for storylet branching
        // Victory continues to first leadsTo scene, defeat to second (or same if only one)
        const leadsToScenes = sceneBlueprint.leadsTo || [];
        const victoryNextSceneId = leadsToScenes[0] || '';
        const defeatNextSceneId = leadsToScenes[1] || leadsToScenes[0] || '';

        // Dynamic beat count based on difficulty - use config.generation.encounterBeatCount as base
        const baseEncounterBeats = this.config.generation?.encounterBeatCount || 4;
        const beatCountByDifficulty: Record<string, number> = {
          easy: Math.max(2, baseEncounterBeats - 1),
          moderate: baseEncounterBeats,
          hard: baseEncounterBeats + 1,
          extreme: baseEncounterBeats + 2,
        };
        const targetBeatCount = beatCountByDifficulty[sceneBlueprint.encounterDifficulty || 'moderate'] || baseEncounterBeats;

        // Extract protagonist skills from character profile if available
        const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);
        const protagonistSkills = protagonistProfile?.skills?.map(s => ({
          name: s.name,
          level: s.level || 1,
        })) || [];

        // Build NPCs list - add a fallback antagonist if none present for combat/chase encounters
        let npcsInvolved = encounterRequiredNpcIds.map(npcId => {
          const profile = characterBible.characters.find(c => c.id === npcId);
          const npcBrief = brief.npcs.find(n => n.id === npcId);
          return {
            id: npcId,
            name: profile?.name || npcId,
            pronouns: (profile?.pronouns || 'he/him') as 'he/him' | 'she/her' | 'they/them',
            role: (npcBrief?.role === 'antagonist' ? 'enemy' : 
                   npcBrief?.role === 'ally' ? 'ally' : 
                   npcBrief?.role === 'neutral' ? 'neutral' : 'obstacle') as 'ally' | 'enemy' | 'neutral' | 'obstacle',
            description: profile?.overview || '',
            physicalDescription: profile?.physicalDescription,
          };
        });

        // If no NPCs for an encounter that typically needs one, create a placeholder
        if (npcsInvolved.length === 0 && ['combat', 'chase', 'social', 'stealth'].includes(sceneBlueprint.encounterType || '')) {
          this.throwIfFailFast(
            `Encounter ${sceneBlueprint.id} has no NPC participants to author against`,
            'encounter_generation',
            {
              agent: 'EncounterArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                encounterType: sceneBlueprint.encounterType,
                failureKind: 'validation',
              },
            }
          );
          console.warn(`[Pipeline] No NPCs for ${sceneBlueprint.encounterType} encounter ${sceneBlueprint.id} - creating placeholder antagonist`);
          npcsInvolved = [{
            id: 'unnamed-antagonist',
            name: 'the adversary',
            pronouns: 'he/him' as const,
            role: 'enemy' as const,
            description: sceneBlueprint.encounterDescription || 'An opposing force',
            physicalDescription: undefined,
          }];
        }

        if (plannedEnc && sceneBlueprint.plannedEncounterId !== plannedEnc.id) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is not explicitly bound to planned encounter ${plannedEnc.id}. Story Architect must set plannedEncounterId exactly.`,
            'encounters',
            {
              agent: 'StoryArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                plannedEncounterId: plannedEnc.id,
                failureKind: 'validation',
              },
            }
          );
        }

        if (!(sceneBlueprint.encounterDescription || plannedEnc?.description || sceneBlueprint.description)) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing an encounter description.`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }
        if (!(sceneBlueprint.encounterStakes || plannedEnc?.stakes)) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing encounter stakes.`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }
        if (encounterBeatPlan.length < 3) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing a usable encounter beat plan (need at least 3 beats).`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }

        // Build priorStateContext from the blueprint's encounterSetupContext and
        // the suggested flags/relationships defined by the StoryArchitect.
        // Pass current setFlags so the architect knows which flags are already available.
        const currentSetFlags = this.incrementalValidator?.getSetFlags();
        const priorStateContext = this.buildEncounterPriorStateContext(
          sceneBlueprint,
          blueprint,
          npcsInvolved,
          currentSetFlags
        );
        if (priorStateContext) {
          const authoredRelationships = priorStateContext.relevantRelationships.filter((entry) => entry.authored !== false).length;
          const autoRelationships = priorStateContext.relevantRelationships.filter((entry) => entry.authored === false).length;
          this.emit({
            type: 'debug',
            phase: 'encounters',
            message: `Encounter prior-state context for ${sceneBlueprint.id}: ${priorStateContext.relevantFlags.length} flag(s), ${authoredRelationships} authored relationship check(s), ${autoRelationships} fallback relationship check(s), ${priorStateContext.significantChoices.length} significant choice hint(s)`,
          });
        }

        const encounterInput: EncounterArchitectInput = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          sceneDescription: sceneBlueprint.description,
          sceneMood: sceneBlueprint.mood,
          plannedEncounterId: sceneBlueprint.plannedEncounterId || plannedEnc?.id,
          storyContext: {
            title: brief.story.title,
            genre: brief.story.genre,
            tone: brief.story.tone,
            userPrompt: brief.userPrompt,
          },
          encounterType: sceneBlueprint.encounterType,
          encounterStyle: sceneBlueprint.encounterStyle || plannedEnc?.style || (
            sceneBlueprint.encounterType === 'combat' || sceneBlueprint.encounterType === 'chase'
              ? 'action'
              : sceneBlueprint.encounterType === 'stealth' || sceneBlueprint.encounterType === 'heist'
                ? 'stealth'
                : sceneBlueprint.encounterType === 'exploration' || sceneBlueprint.encounterType === 'survival'
                  ? 'adventure'
                  : sceneBlueprint.encounterType === 'puzzle' || sceneBlueprint.encounterType === 'investigation'
                    ? 'mystery'
                    : sceneBlueprint.encounterType === 'romantic'
                      ? 'romantic'
                      : sceneBlueprint.encounterType === 'dramatic'
                        ? 'dramatic'
                        : 'social'
          ),
          encounterDescription: sceneBlueprint.encounterDescription || sceneBlueprint.description,
          encounterStakes: sceneBlueprint.encounterStakes || plannedEnc?.stakes,
          encounterRequiredNpcIds,
          encounterRelevantSkills,
          encounterBeatPlan,
          difficulty: sceneBlueprint.encounterDifficulty || 'moderate',
          partialVictoryCost: sceneBlueprint.encounterPartialVictoryCost,
          protagonistInfo: {
            name: brief.protagonist.name,
            pronouns: brief.protagonist.pronouns,
            physicalDescription: protagonistProfile?.physicalDescription,
            relevantSkills: protagonistSkills.length > 0 ? protagonistSkills : undefined,
          },
          npcsInvolved,
          availableSkills: defaultSkills,
          targetBeatCount,
          victoryNextSceneId,
          defeatNextSceneId,
          priorStateContext,
          memoryContext: this.cachedPipelineMemory || undefined,
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonSevenPoint: brief.seasonPlan?.sevenPoint,
          episodeStructuralRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.structuralRole,
        };

        const encounterInputSummary = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          plannedEncounterId: sceneBlueprint.plannedEncounterId || plannedEnc?.id || 'none',
          encounterType: sceneBlueprint.encounterType,
          difficulty: sceneBlueprint.encounterDifficulty || 'moderate',
          descriptionChars: (sceneBlueprint.encounterDescription || sceneBlueprint.description || '').length,
          stakesChars: (sceneBlueprint.encounterStakes || plannedEnc?.stakes || '').length,
          userPromptChars: (brief.userPrompt || '').length,
          npcCount: npcsInvolved.length,
          requiredNpcCount: encounterRequiredNpcIds.length,
          availableSkillCount: defaultSkills.length,
          relevantSkillCount: encounterRelevantSkills.length,
          protagonistSkillCount: protagonistSkills.length,
          targetBeatCount,
          beatPlanCount: encounterBeatPlan.length,
          priorStateFlags: priorStateContext?.relevantFlags.length || 0,
          priorStateRelationships: priorStateContext?.relevantRelationships.length || 0,
          priorStateSignificantChoices: priorStateContext?.significantChoices.length || 0,
        };

        // Log input for debugging encounter generation issues
        console.log(`[Pipeline] EncounterArchitect input summary for ${sceneBlueprint.id}: ${JSON.stringify(encounterInputSummary)}`);
        console.log(`[Pipeline] EncounterArchitect input preview for ${sceneBlueprint.id}:
  - Scene: ${sceneBlueprint.name}
  - Planned encounter: ${sceneBlueprint.plannedEncounterId || plannedEnc?.id || 'none'}
  - Type: ${sceneBlueprint.encounterType}
  - Description: ${(sceneBlueprint.encounterDescription || sceneBlueprint.description || '').substring(0, 100)}...
  - Stakes: ${(sceneBlueprint.encounterStakes || plannedEnc?.stakes || '').substring(0, 100)}
  - Difficulty: ${sceneBlueprint.encounterDifficulty || 'moderate'}
  - NPCs: ${npcsInvolved.map(n => n.name).join(', ') || 'None'}
  - Target beats: ${targetBeatCount}
  - Beat plan: ${encounterBeatPlan.join(' | ')}`);

        // Build initial relationship snapshot from character profiles for the
        // relationship dynamics analysis in the phased encounter generator.
        const playerRelationships: Record<string, import('../../types').Relationship> = {};
        for (const npc of npcsInvolved) {
          const profile = characterBible.characters.find(c => c.id === npc.id);
          const stats = profile?.initialStats;
          playerRelationships[npc.id] = {
            npcId: npc.id,
            trust: stats?.trust ?? 0,
            affection: stats?.affection ?? 0,
            respect: stats?.respect ?? 0,
            fear: stats?.fear ?? 0,
          };
        }
        const allNpcInfos = characterBible.characters
          .filter(c => c.id !== brief.protagonist.id)
          .map(c => ({ id: c.id, name: c.name }));

        // EncounterArchitect.execute() uses phased generation with fallback:
        //   Phase 1: Opening beat (120s timeout)
        //   Phase 2a/2b/2c: Branch situations (3 parallel, 120s each)
        //   Phase 3: Enrichment (90s)
        //   Phase 4: Storylets (90s)
        //   Legacy fallback: lean prompt → retry → deterministic
        // A safety-net timeout is kept for truly pathological cases.
        let encounterResult: AgentResponse<EncounterStructure> | null = null;
        try {
          encounterResult = await withTimeout(
            this.encounterArchitect.execute(encounterInput, playerRelationships, allNpcInfos),
            PIPELINE_TIMEOUTS.encounterAgent,
            `EncounterArchitect.execute(${sceneBlueprint.id})`,
            () => {
              console.error(
                `[Pipeline] EncounterArchitect safety-net timeout for ${sceneBlueprint.id}: ${JSON.stringify(encounterInputSummary)}`
              );
            }
          );
        } catch (encErr) {
          const encErrMsg = encErr instanceof Error ? encErr.message : String(encErr);
          console.error(`[Pipeline] Encounter generation threw for ${sceneBlueprint.id}: ${encErrMsg}`);
          this.emit({
            type: 'warning',
            phase: 'encounters',
            message: `Encounter generation failed for ${sceneBlueprint.id}: ${encErrMsg}`,
          });
          throw new PipelineError(
            `Encounter generation failed for ${sceneBlueprint.id}: ${encErrMsg}`,
            'encounters',
            {
              agent: 'EncounterArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                encounterType: sceneBlueprint.encounterType,
                failureKind: 'content',
              },
            }
          );
        }

        if (encounterResult && !encounterResult.success && !encounterResult.data) {
          const encFailMsg = `Encounter Architect failed on ${sceneBlueprint.id}: ${encounterResult.error}`;
          console.error(`[Pipeline] ${encFailMsg}`);
          this.emit({
            type: 'warning',
            phase: 'encounters',
            message: encFailMsg,
          });
          throw new PipelineError(
            encFailMsg,
            'encounters',
            {
              agent: 'EncounterArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                encounterType: sceneBlueprint.encounterType,
                failureKind: 'content',
              },
            }
          );
        }
        
        // Only register encounter + run validation if EncounterArchitect succeeded
        if (encounterResult?.success && encounterResult.data) {
          encounters.set(sceneBlueprint.id, encounterResult.data);
          this.captureEncounterTelemetry(encounterResult.metadata);
          this.emit({
            type: 'agent_complete',
            agent: 'EncounterArchitect',
            message: `Designed ${encounterResult.data.beats.length}-beat ${sceneBlueprint.encounterDifficulty || 'moderate'} encounter with ${Object.keys(encounterResult.data.storylets || {}).length} storylets for ${sceneBlueprint.id}`,
          });

          // === FLAG CHRONOLOGY CHECK: validate encounter conditions BEFORE tracking flags ===
          if (this.incrementalValidator) {
            const conditionIssues = this.incrementalValidator.checkEncounterChoiceConditions(encounterResult.data);
            if (conditionIssues.length > 0) {
              this.emit({
                type: 'warning',
                phase: 'encounter',
                message: `Encounter ${sceneBlueprint.id}: ${conditionIssues.length} flag chronology issue(s) — ${conditionIssues.map(i => i.detail).join('; ')}`,
              });
            }

            // Track setFlag consequences from encounter choice outcomes so
            // subsequent scenes/encounters see them in the flag tracker.
            this.trackEncounterFlagConsequences(encounterResult.data);
          }

          // === INCREMENTAL ENCOUNTER VALIDATION ===
          if (this.incrementalValidator && incrementalConfig.encounterValidation) {
            const encounterValidation = this.incrementalValidator.validators.encounter.validateEncounter(encounterResult.data);
            
            // Get the placeholder scene content for this encounter
            const encounterSceneContent = sceneContents.find(sc => sc.sceneId === sceneBlueprint.id);
            
            if (encounterSceneContent) {
              // Create a validation result for the encounter scene
              const sceneValidation: SceneValidationResult = {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                encounter: encounterValidation,
                overallPassed: encounterValidation.passed,
                regenerationRequested: encounterValidation.passed ? 'none' : 'encounter',
                validationTimeMs: 0,
              };
              
              this.sceneValidationResults.push(sceneValidation);

              this.emit({
                type: 'incremental_validation',
                phase: 'encounter',
                message: `Encounter ${sceneBlueprint.id}: ${encounterValidation.passed ? 'PASSED' : 'ISSUES FOUND'} (${encounterValidation.beatCount} beats)`,
                data: {
                  passed: encounterValidation.passed,
                  beatCount: encounterValidation.beatCount,
                  hasVictoryPath: encounterValidation.hasVictoryPath,
                  hasDefeatPath: encounterValidation.hasDefeatPath,
                  issues: encounterValidation.issues,
                },
              });

              // Warn about missing victory/defeat paths
              if (!encounterValidation.hasVictoryPath || !encounterValidation.hasDefeatPath) {
                this.emit({
                  type: 'warning',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} may be missing ${!encounterValidation.hasVictoryPath ? 'victory' : ''} ${!encounterValidation.hasDefeatPath ? 'defeat' : ''} path`,
                });
              }

              // === KARPATHY LOOP: Encounter regeneration based on incremental validation ===
              if (sceneValidation.regenerationRequested === 'encounter' && incrementalConfig.encounterValidation) {
                let encounterRegenAttempt = 0;
                const maxEncounterRegenAttempts = incrementalConfig.maxRegenerationAttempts;

                while (encounterRegenAttempt < maxEncounterRegenAttempts) {
                  encounterRegenAttempt++;
                  const issueDescriptions = encounterValidation.issues
                    .map(i => `- [${i.severity}] ${i.type}: ${i.detail}`)
                    .join('\n');

                  this.emit({
                    type: 'regeneration_triggered',
                    phase: 'encounters',
                    message: `Regenerating encounter ${sceneBlueprint.id} (attempt ${encounterRegenAttempt}/${maxEncounterRegenAttempts}): ${encounterValidation.issues.length} issue(s)`,
                    data: { issues: encounterValidation.issues },
                  });

                  const regenEncounterInput: EncounterArchitectInput = {
                    ...encounterInput,
                    storyContext: {
                      ...encounterInput.storyContext,
                      userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nCRITICAL ENCOUNTER FIXES REQUIRED:\n${issueDescriptions}\n\nEnsure the encounter has ${!encounterValidation.hasVictoryPath ? 'a clear victory path, ' : ''}${!encounterValidation.hasDefeatPath ? 'a clear defeat path, ' : ''}proper skill checks, and complete outcome branches.`,
                    },
                  };

                  try {
                    const regenEncounterResult = await withTimeout(
                      this.encounterArchitect.execute(regenEncounterInput, playerRelationships, allNpcInfos),
                      PIPELINE_TIMEOUTS.encounterAgent,
                      `EncounterArchitect.execute(${sceneBlueprint.id} regen-${encounterRegenAttempt})`
                    );

                    if (!regenEncounterResult.success || !regenEncounterResult.data) {
                      this.emit({
                        type: 'warning',
                        phase: 'encounters',
                        message: `Encounter regeneration failed for ${sceneBlueprint.id}, keeping original`,
                      });
                      break;
                    }

                    const regenValidation = this.incrementalValidator!.validators.encounter.validateEncounter(regenEncounterResult.data);

                    if (regenValidation.passed ||
                        regenValidation.issues.length < encounterValidation.issues.length) {
                      encounters.set(sceneBlueprint.id, regenEncounterResult.data);
                      this.captureEncounterTelemetry(regenEncounterResult.metadata);
                      // Update the stored validation result
                      const valIdx = this.sceneValidationResults.findIndex(v => v.sceneId === sceneBlueprint.id);
                      if (valIdx !== -1) {
                        this.sceneValidationResults[valIdx] = {
                          ...this.sceneValidationResults[valIdx],
                          encounter: regenValidation,
                          overallPassed: regenValidation.passed,
                          regenerationRequested: regenValidation.passed ? 'none' : 'encounter',
                        };
                      }
                      this.emit({
                        type: 'debug',
                        phase: 'encounters',
                        message: `Encounter ${sceneBlueprint.id} regenerated (issues: ${encounterValidation.issues.length} -> ${regenValidation.issues.length})`,
                      });
                      if (regenValidation.passed) break;
                      Object.assign(encounterValidation, regenValidation);
                    } else {
                      this.emit({
                        type: 'debug',
                        phase: 'encounters',
                        message: `Encounter ${sceneBlueprint.id} regen attempt ${encounterRegenAttempt} did not improve, keeping previous`,
                      });
                    }
                  } catch (regenErr) {
                    this.emit({
                      type: 'warning',
                      phase: 'encounters',
                      message: `Encounter regeneration threw for ${sceneBlueprint.id}: ${regenErr instanceof Error ? regenErr.message : String(regenErr)}`,
                    });
                    break;
                  }
                }
              }
            }
          }
        }
        contentWorkCompleted += 1;
        this.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Encounter pass complete for ${sceneBlueprint.id}`
        );
      }
      finalizedScenes.add(sceneBlueprint.id);
    }

    // Emit aggregated validation summary
    if (this.incrementalValidator && this.sceneValidationResults.length > 0) {
      const aggregated = aggregateValidationResults(this.sceneValidationResults);
      this.emit({
        type: 'validation_aggregated',
        phase: 'incremental_validation',
        message: `Incremental validation complete: ${aggregated.passedScenes}/${aggregated.totalScenes} scenes passed`,
        data: aggregated,
      });
    }

    // Summary of content generation
    const totalChoices = choiceSets.reduce((sum, cs) => sum + cs.choices.length, 0);
    const totalEncounters = encounters.size;
    this.emit({ 
      type: 'phase_complete', 
      phase: 'content', 
      message: `Content complete: ${sceneContents.length} scenes, ${choiceSets.length} choice sets, ${totalChoices} choices, ${totalEncounters} encounters` 
    });
    if (totalChoices === 0 && totalEncounters === 0) {
      console.error(`[Pipeline] CRITICAL: No choices or encounters were generated! This will result in a non-interactive story.`);
    }
    // Gate on isEncounter alone — encounterType should have been normalized above,
    // but we never want the safety check to use a narrower filter than the generation gate.
    const expectedEncounterSceneIds = blueprint.scenes
      .filter((scene) => scene.isEncounter)
      .map((scene) => scene.id);
    const missingEncounterSceneIds = expectedEncounterSceneIds.filter((sceneId) => !encounters.has(sceneId));
    if (missingEncounterSceneIds.length > 0) {
      throw new PipelineError(
        `Encounter scenes missing concrete encounter content: ${missingEncounterSceneIds.join(', ')}. ` +
        `This usually means encounterType was missing and the scene was processed by SceneWriter instead of EncounterArchitect.`,
        'encounters',
        {
          context: {
            expectedEncounterSceneIds,
            missingEncounterSceneIds,
            failureKind: 'content',
          },
        }
      );
    }
    this.assertSceneDependencyInvariants(blueprint, sceneContents);

    await this.runSceneCriticPass(sceneContents, characterBible);

    return { sceneContents, choiceSets, encounters };
  }

  /**
   * Optional SceneCritic rewrite pass (Phase 9.2). Re-authors the *text* of
   * beats in a small number of scenes to improve subtext / reversals /
   * show-don't-tell. Non-destructive — merges rewritten beats back into the
   * existing SceneContent objects, preserving structural fields.
   */
  private async runSceneCriticPass(
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
  ): Promise<void> {
    const cfg = this.config.sceneCritic;
    if (!cfg?.enabled || !this.sceneCritic) return;
    if (!sceneContents.length) return;

    const maxScenes = Math.max(1, cfg.maxScenesPerEpisode ?? 3);
    const candidates = [...sceneContents];

    // If a voiceScoreThreshold is configured, prefer scenes with a low score.
    if (typeof cfg.voiceScoreThreshold === 'number') {
      const scored = candidates
        .map(sc => ({
          sc,
          score:
            typeof (sc as unknown as { voiceScore?: number }).voiceScore === 'number'
              ? (sc as unknown as { voiceScore: number }).voiceScore
              : 100,
        }))
        .filter(entry => entry.score <= cfg.voiceScoreThreshold!)
        .sort((a, b) => a.score - b.score)
        .map(entry => entry.sc);
      candidates.length = 0;
      candidates.push(...scored);
    }

    const targets = candidates.slice(0, maxScenes);
    if (targets.length === 0) return;

    this.emit({
      type: 'debug',
      phase: 'scene_critic',
      message: `SceneCritic pass reviewing ${targets.length} scene(s)`,
    });

    for (const scene of targets) {
      try {
        const critique = await this.sceneCritic.execute({
          scene,
          characterBible,
        });
        if (!critique.success || !critique.data) continue;
        const rewrittenById = new Map(critique.data.rewrittenBeats.map(b => [b.id, b]));
        if (rewrittenById.size === 0) continue;
        scene.beats = scene.beats.map(b => {
          const replacement = rewrittenById.get(b.id);
          if (!replacement) return b;
          return {
            ...b,
            text: replacement.text || b.text,
            textVariants: replacement.textVariants || b.textVariants,
            speakerMood: replacement.speakerMood || b.speakerMood,
          };
        });
        this.emit({
          type: 'checkpoint',
          phase: 'scene_critic',
          message: `Rewrote ${rewrittenById.size} beat(s) in scene ${scene.sceneId}`,
          data: {
            sceneId: scene.sceneId,
            beatsRewritten: rewrittenById.size,
            commentary: critique.data.overallCommentary,
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.emit({
          type: 'warning',
          phase: 'scene_critic',
          message: `SceneCritic failed for scene ${scene.sceneId}: ${msg}`,
        });
      }
    }
  }

  private async runQualityAssurance(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint
  ): Promise<QAReport> {
    const qaStepTotal = 3;
    this.emitPhaseProgress('qa', 0, qaStepTotal, 'qa:steps', 'Preparing quality assurance checks...');
    // Determine which checks to skip based on incremental validation
    const skipRedundantQA = brief.options?.skipRedundantQA !== false && this.incrementalValidator !== null;
    
    const qaOptions: QARunnerOptions = {};
    
    if (skipRedundantQA && this.sceneValidationResults.length > 0) {
      // Calculate issue counts from incremental validation
      const aggregated = aggregateValidationResults(this.sceneValidationResults);

      // Flatten actual incremental issues so the skip stubs carry them into
      // the QA report instead of reporting `issues: []`. Without this, any
      // run with `skipRedundantQA: true` silently discards everything that
      // the incremental validators caught.
      const voiceIssues: NonNullable<QARunnerOptions['incrementalResults']>['voiceIssues'] = [];
      const stakesIssues: NonNullable<QARunnerOptions['incrementalResults']>['stakesIssues'] = [];
      for (const sceneResult of this.sceneValidationResults) {
        if (sceneResult.voice?.issues) {
          for (const iss of sceneResult.voice.issues) {
            voiceIssues.push({
              sceneId: sceneResult.sceneId,
              beatId: iss.beatId,
              characterId: iss.characterId,
              characterName: iss.characterName,
              severity: iss.severity,
              issue: iss.issue,
              suggestion: iss.suggestion,
            });
          }
        }
        if (sceneResult.stakes?.issues) {
          for (const iss of sceneResult.stakes.issues) {
            stakesIssues.push({
              sceneId: sceneResult.sceneId,
              choiceSetId: iss.choiceId,
              severity: iss.severity,
              issue: iss.issue,
              suggestion: iss.suggestion,
            });
          }
        }
      }

      qaOptions.skipVoiceValidation = true;
      qaOptions.skipStakesAnalysis = true;
      qaOptions.continuityFocusCrossScene = true;
      qaOptions.incrementalResults = {
        voiceIssueCount: aggregated.totalIssues.voice,
        stakesIssueCount: aggregated.totalIssues.stakes,
        continuityIssueCount: aggregated.totalIssues.continuity,
        voiceIssues,
        stakesIssues,
      };
      
      this.emit({ 
        type: 'debug', 
        agent: 'QARunner', 
        message: `Skipping redundant QA checks (voice: ${aggregated.totalIssues.voice} issues, stakes: ${aggregated.totalIssues.stakes} issues caught incrementally)` 
      });
    }
    this.emitPhaseProgress('qa', 1, qaStepTotal, 'qa:steps', 'QA input bundle prepared');

    this.emit({ type: 'agent_start', agent: 'QARunner', message: 'Running quality assurance checks' });

    const characterKnowledge = this.buildContinuityCharacterKnowledge(characterBible);
    const timelineEvents = this.buildContinuityTimeline(blueprint);

    const report = await this.qaRunner.runFullQA({
      sceneContents,
      choiceSets,
      characterProfiles: characterBible.characters.map(c => ({
        id: c.id,
        name: c.name,
        voiceProfile: c.voiceProfile,
      })),
      knownFlags: blueprint.suggestedFlags,
      knownScores: blueprint.suggestedScores,
      establishedFacts: [],
      storyThemes: brief.story.themes,
      targetTone: brief.story.tone,
      sceneContexts: blueprint.scenes.map(s => ({
        sceneId: s.id,
        sceneName: s.name,
        mood: s.mood,
        narrativeFunction: s.narrativeFunction,
      })),
      characterKnowledge,
      timelineEvents,
    }, qaOptions);
    this.emitPhaseProgress('qa', 2, qaStepTotal, 'qa:steps', 'QA analysis complete');

    const skippedMsg = report.skippedChecks && report.skippedChecks.length > 0 
      ? ` (skipped: ${report.skippedChecks.join(', ')})` 
      : '';

    this.emit({
      type: 'agent_complete',
      agent: 'QARunner',
      message: `QA Score: ${report.overallScore}/100 - ${report.passesQA ? 'PASSED' : 'NEEDS REVISION'}${skippedMsg}`,
    });
    this.emitPhaseProgress('qa', 3, qaStepTotal, 'qa:steps', 'QA report finalized');

    return report;
  }

  /**
   * Pull an `EncounterTelemetry` payload out of an EncounterArchitect
   * response's metadata (if present) and append it to the run-level
   * telemetry collector. Silently ignores responses that predate the
   * telemetry contract.
   */
  private captureEncounterTelemetry(metadata: Record<string, unknown> | undefined): void {
    const raw = metadata?.encounterTelemetry as EncounterTelemetry | undefined;
    if (raw && typeof raw.sceneId === 'string') {
      this.encounterTelemetry.push(raw);
    }
  }

  /**
   * Build a best-effort `characterKnowledge` bundle for ContinuityChecker.
   *
   * The pipeline does not model first-class "what does this character know
   * at time T" data, so we populate this from the character bible using
   * information we DO have:
   *   - Each character knows their own overview, core want/fear/flaw, and
   *     any relationships they explicitly hold.
   *   - Each character is assumed NOT to know the hidden secrets of OTHER
   *     characters (this is the most common source of "character knows
   *     something they shouldn't" continuity bugs).
   *
   * This is intentionally conservative: we feed the LLM real data where we
   * have it, and we do not invent knowledge facts we cannot verify.
   */
  private buildContinuityCharacterKnowledge(
    characterBible: CharacterBible
  ): Array<{ characterId: string; knows: string[]; doesNotKnow: string[] }> {
    const characters = characterBible.characters ?? [];
    if (characters.length === 0) return [];

    return characters.map(c => {
      const knows: string[] = [];
      if (c.overview) knows.push(c.overview);
      if (c.want) knows.push(`their own goal: ${c.want}`);
      if (c.fear) knows.push(`their own fear: ${c.fear}`);
      const relationships = Array.isArray(c.relationships) ? c.relationships : [];
      relationships.forEach(r => {
        if (r.targetName && r.relationshipType) {
          knows.push(`${r.targetName} (${r.relationshipType})`);
        }
      });

      const doesNotKnow: string[] = [];
      for (const other of characters) {
        if (other.id === c.id) continue;
        if (other.hiddenSecret) {
          doesNotKnow.push(`${other.name}'s secret: ${other.hiddenSecret}`);
        }
      }

      return {
        characterId: c.id,
        knows,
        doesNotKnow,
      };
    });
  }

  /**
   * Build a best-effort `timelineEvents` list for ContinuityChecker from
   * the episode blueprint's ordered scene list. This gives the LLM a
   * concrete reference for "what happens when" so it can flag forward
   * references and impossible knowledge across scenes.
   */
  private buildContinuityTimeline(
    blueprint: EpisodeBlueprint
  ): Array<{ event: string; when: string }> {
    const scenes = blueprint.scenes ?? [];
    if (scenes.length === 0) return [];

    return scenes.map((s, idx) => {
      const label = s.name || s.id;
      const details = [s.narrativeFunction, s.mood].filter(Boolean).join(' / ');
      return {
        event: details ? `${label} (${details})` : label,
        when: `Scene ${idx + 1} (${s.id})`,
      };
    });
  }

  private assembleStory(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure>,
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounterImageResults?: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages?: Map<string, Map<string, Map<string, string>>> },
    storyCoverUrl?: string,
    videoResults?: Map<string, string>
  ): Story {
    const contentMap = new Map(sceneContents.map(sc => [sc.sceneId, sc]));
    const choiceMap = new Map(choiceSets.map(cs => [cs.sceneId ? `${cs.sceneId}::${cs.beatId}` : cs.beatId, cs]));
    const beatImages = imageResults?.beatImages || new Map<string, string>();
    const sceneImages = imageResults?.sceneImages || new Map<string, string>();
    const beatVideos = videoResults || new Map<string, string>();
    const encounterImages = encounterImageResults?.encounterImages || new Map();
    const storyletImages = encounterImageResults?.storyletImages || new Map<string, Map<string, Map<string, string>>>();

    // Build scenes
    const scenes: Scene[] = blueprint.scenes.map(sceneBlueprint => {
      const content = contentMap.get(sceneBlueprint.id);
      if (!content) {
        throw new Error(`Missing content for scene ${sceneBlueprint.id}`);
      }

      // Check if this scene has an encounter - use extracted converter
      const encounterStructure = encounters.get(sceneBlueprint.id);
      const sceneEncounterImages = encounterImages.get(sceneBlueprint.id);
      const encounter = encounterStructure 
        ? convertEncounterStructureToEncounter(encounterStructure, sceneBlueprint)
        : undefined;
      
      // Map encounter images to the encounter structure (including recursive nextSituation trees)
      if (encounter && sceneEncounterImages) {
        let mappedSetupCount = 0;
        let mappedOutcomeCount = 0;
        encounter.phases.forEach(phase => {
          phase.beats.forEach(beat => {
            const isEncounterBeat = 'setupText' in beat;
            
            const setupImage = sceneEncounterImages.setupImages.get(beat.id);
            if (setupImage && isEncounterBeat) {
              (beat as TypeEncounterBeat).situationImage = setupImage;
              mappedSetupCount++;
            }
            
            if (isEncounterBeat) {
              const encounterBeat = beat as TypeEncounterBeat;
              if (encounterBeat.choices) {
                const treeResult = this.wireEncounterTreeImages(
                  encounterBeat.choices,
                  encounterBeat.id,
                  '',
                  sceneEncounterImages.setupImages,
                  sceneEncounterImages.outcomeImages,
                  encounterBeat.situationImage,
                );
                mappedSetupCount += treeResult.setupCount;
                mappedOutcomeCount += treeResult.outcomeCount;
              }
            }
          });
        });
        console.log(`[Pipeline] Encounter image mapping for ${sceneBlueprint.id}: ${mappedSetupCount} setup images, ${mappedOutcomeCount} outcome images wired`);
      } else if (encounter && !sceneEncounterImages) {
        console.warn(`[Pipeline] Scene ${sceneBlueprint.id} has encounter but NO encounter images were generated`);
      }

      // Wire storylet aftermath images into each storylet beat's image field
      if (encounter) {
        const sceneStoryletImages = storyletImages.get(sceneBlueprint.id);
        if (sceneStoryletImages && encounter.storylets) {
          const outcomes: Array<[string, TypeGeneratedStorylet | undefined]> = [
            ['victory', encounter.storylets.victory],
            ['partialVictory', encounter.storylets.partialVictory],
            ['defeat', encounter.storylets.defeat],
            ['escape', encounter.storylets.escape],
          ];
          for (const [outcomeName, storylet] of outcomes) {
            if (!storylet) continue;
            const beatImageMap = sceneStoryletImages.get(outcomeName);
            if (beatImageMap) {
              storylet.beats.forEach(beat => {
                const url = beatImageMap.get(beat.id);
                if (url) beat.image = url;
              });
            }
          }
        }
      }

      const beats: Beat[] = content.beats.map(genBeat => {
        const compositeKey = this.getEpisodeScopedBeatKey(brief, sceneBlueprint.id, genBeat.id);
        const beat: Beat = {
          id: genBeat.id,
          text: genBeat.text,
          textVariants: genBeat.textVariants,
          speaker: genBeat.speaker,
          speakerMood: genBeat.speakerMood,
          nextBeatId: genBeat.nextBeatId,
          onShow: genBeat.onShow,
          image: beatImages.get(compositeKey),
          video: beatVideos.get(compositeKey),
        };

        if (genBeat.isChoicePoint) {
          const choiceSet = choiceMap.get(`${sceneBlueprint.id}::${genBeat.id}`);
          if (choiceSet) {
            beat.choices = choiceSet.choices.map((gc, ci) => {
              let nextSceneId = gc.nextSceneId;

              // Guard: prevent backward navigation to current scene or scenes
              // that precede it in the episode (which would cause loops).
              if (nextSceneId) {
                const targetIdx = blueprint.scenes.findIndex(s => s.id === nextSceneId);
                const currentIdx = blueprint.scenes.findIndex(s => s.id === sceneBlueprint.id);
                if (targetIdx >= 0 && targetIdx <= currentIdx) {
                  const leadsTo = sceneBlueprint.leadsTo || [];
                  const corrected = leadsTo[ci % leadsTo.length] || leadsTo[0];
                  if (corrected) {
                    console.warn(
                      `[Pipeline] assembleStory: choice "${gc.id}" in scene "${sceneBlueprint.id}" ` +
                      `routes backward to "${nextSceneId}" (idx ${targetIdx} <= ${currentIdx}). ` +
                      `Auto-correcting to "${corrected}".`
                    );
                    nextSceneId = corrected;
                  }
                }
              }

              return {
                id: gc.id,
                text: gc.text,
                choiceType: gc.choiceType,
                conditions: gc.conditions,
                showWhenLocked: gc.showWhenLocked,
                lockedText: gc.lockedText,
                statCheck: gc.statCheck,
                consequences: normalizeConsequences(gc.consequences),
                delayedConsequences: gc.delayedConsequences,
                nextSceneId,
                nextBeatId: gc.nextBeatId,
                outcomeTexts: gc.outcomeTexts,
                reactionText: gc.reactionText,
                tintFlag: gc.tintFlag,
                consequenceDomain: gc.consequenceDomain,
                reminderPlan: gc.reminderPlan,
                feedbackCue: gc.feedbackCue,
              };
            });
          }
        }

        return beat;
      });

      return {
        id: sceneBlueprint.id,
        name: sceneBlueprint.name,
        beats,
        startingBeatId: content.startingBeatId,
        backgroundImage: sceneImages.get(this.getEpisodeScopedSceneId(brief, sceneBlueprint.id)),
        encounter,
      };
    });

    const episodeCover = storyCoverUrl
      || (scenes.length > 0 ? sceneImages.get(this.getEpisodeScopedSceneId(brief, scenes[0].id)) || '' : '');

    const episode: Episode = {
      id: generateEpisodeId(brief.episode.number, brief.episode.title),
      number: brief.episode.number,
      title: brief.episode.title,
      synopsis: brief.episode.synopsis,
      coverImage: episodeCover,
      scenes,
      startingSceneId: blueprint.startingSceneId,
    };

    const storyCover = episodeCover;

    // Build complete story
    const story: Story = {
      id: idSlugify(brief.story.title) || 'untitled-story',
      title: brief.story.title,
      genre: brief.story.genre,
      synopsis: brief.story.synopsis,
      coverImage: storyCover,
      author: 'AI Generated',
      tags: brief.story.themes,

      initialState: {
        attributes: { ...CHARACTER_DEFAULTS.attributes },
        skills: Object.fromEntries(DEFAULT_SKILLS.map(s => [s.name, 10])),
        tags: [],
        inventory: [],
      },

      npcs: characterBible.characters
        .filter(c => c.id !== brief.protagonist.id)
        .map(c => {
          let portrait: string | undefined;
          const refSheet = this.imageAgentTeam.getReferenceSheet(c.id);
          if (refSheet) {
            const frontImg = refSheet.generatedImages.get('front') || refSheet.generatedImages.get('composite');
            portrait = frontImg?.imageUrl || frontImg?.imagePath;
          }
          return this.buildPersistedNpc(c, portrait);
        }),

      episodes: [episode],
      outputDir: '', // Will be filled in by pipeline

      artStyleProfile: this.config.imageGen?.artStyleProfile,
      styleAnchors: (this._styleAnchorPaths.character || this._styleAnchorPaths.arcStrip || this._styleAnchorPaths.environment)
        ? {
            character: this._styleAnchorPaths.character ? { imagePath: this._styleAnchorPaths.character } : undefined,
            arcStrip: this._styleAnchorPaths.arcStrip ? { imagePath: this._styleAnchorPaths.arcStrip } : undefined,
            environment: this._styleAnchorPaths.environment ? { imagePath: this._styleAnchorPaths.environment } : undefined,
          }
        : undefined,
    };

    return story;
  }

  // Note: convertEncounterStructureToEncounter moved to ../converters/encounterConverter.ts
  // Note: slugify moved to idUtils.ts for centralized ID generation

  /**
   * Prepare validation input from pipeline data
   */
  /**
   * Phase 1.3 / 1.6: Build a runtime-persisted NPC entry from a CharacterProfile.
   * Preserves first-class `tier`, want/fear/flaw, voice profile slice, secrets,
   * and arc so the playback runtime, UI, and downstream validators can read
   * them without re-loading the full CharacterBible.
   */
  private buildPersistedNpc(
    c: CharacterBible['characters'][number],
    portrait?: string
  ) {
    const tier = (c as unknown as { tier?: 'core' | 'supporting' | 'background' }).tier;
    const voice = c.voiceProfile;
    const voiceSlice = voice
      ? {
          writingGuidance: voice.writingGuidance,
          speechPatterns: [
            ...(voice.verbalTics || []),
            ...(voice.favoriteExpressions || []),
          ].filter(Boolean),
          vocabularyLevel: voice.vocabulary,
          whenNervous: voice.whenNervous,
          whenAngry: voice.whenAngry,
          whenConfident: voice.whenHappy,
        }
      : undefined;
    const authoredSecrets = (c as unknown as { secrets?: string[] }).secrets;
    const secrets = Array.isArray(authoredSecrets) && authoredSecrets.length > 0
      ? authoredSecrets
      : c.hiddenSecret
        ? [c.hiddenSecret]
        : undefined;
    const arc = c.arcPotential
      ? {
          startState: c.arcPotential.currentState,
          endState: c.arcPotential.possibleGrowth,
          keyBeats: c.arcPotential.triggerEvents,
        }
      : undefined;
    return {
      id: c.id,
      name: c.name,
      description: c.overview,
      role: c.role,
      pronouns: c.pronouns,
      portrait,
      initialRelationship: c.initialStats,
      tier,
      want: c.want,
      fear: c.fear,
      flaw: c.flaw,
      voiceProfile: voiceSlice,
      secrets,
      arc,
    };
  }

  private prepareValidationInput(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>
  ) {
    // Prepare scenes for validation
    const scenes = sceneContents.map(sc => ({
      id: sc.sceneId,
      beats: sc.beats.map(b => ({
        id: b.id,
        text: b.text,
        isChoicePoint: b.isChoicePoint,
      })),
    }));

    // Prepare NPCs for validation
    const npcs = characterBible.characters
      .filter(c => c.role !== 'protagonist')
      .map(c => {
        // Phase 1.3: Read tier directly from CharacterProfile. Fall back to
        // role-based inference only when the authored tier is missing (older
        // character bibles). New runs should always carry an authored tier.
        let tier: NPCTier;
        const authoredTier = (c as unknown as { tier?: NPCTier }).tier;
        if (authoredTier === 'core' || authoredTier === 'supporting' || authoredTier === 'background') {
          tier = authoredTier;
        } else {
          tier = 'background';
          if (c.role === 'antagonist' || c.role === 'ally') tier = 'core';
          else if (c.role === 'neutral') tier = 'supporting';
        }

        // Determine relationship dimensions from initial stats
        const dimensions: RelationshipDimension[] = [];
        if (c.initialStats) {
          if (c.initialStats.trust !== undefined) dimensions.push('trust');
          if (c.initialStats.affection !== undefined) dimensions.push('affection');
          if (c.initialStats.respect !== undefined) dimensions.push('respect');
          if (c.initialStats.fear !== undefined) dimensions.push('fear');
        }

        return {
          id: c.id,
          name: c.name,
          tier,
          relationshipDimensions: dimensions,
        };
      });

    // Prepare choices for validation (regular choices)
    const choices = choiceSets.flatMap(cs =>
      cs.choices.map(choice => ({
        id: choice.id,
        text: choice.text,
        choiceType: choice.choiceType || cs.choiceType,
        consequences: choice.consequences || [],
        stakesAnnotation: choice.stakesAnnotation || cs.overallStakes,
        sceneContext: cs.designNotes,
        nextSceneId: choice.nextSceneId,
        reminderPlan: choice.reminderPlan,
      }))
    );

    // Prepare encounters for validation
    const encounterValidation = encounters ? Array.from(encounters.values()).map(enc => ({
      sceneId: enc.sceneId,
      type: enc.encounterType,
      beatCount: enc.beats.length,
      hasStorylets: !!(enc.storylets?.victory && enc.storylets?.defeat),
      hasEnvironmentalElements: (enc.environmentalElements?.length || 0) > 0,
      hasNPCStates: (enc.npcStates?.length || 0) > 0,
      hasEscalationTriggers: (enc.escalationTriggers?.length || 0) > 0,
      choiceCount: enc.beats.reduce((sum, b) => sum + (b.choices?.length || 0), 0),
      // Validate beat flow - each non-terminal beat should have choices with nextBeatId
      beatFlowValid: enc.beats.every((beat, idx) => {
        if (beat.isTerminal || idx === enc.beats.length - 1) return true;
        return beat.choices?.every(c => 
          c.outcomes?.success?.nextBeatId && 
          c.outcomes?.complicated?.nextBeatId && 
          c.outcomes?.failure?.nextBeatId
        ) ?? false;
      }),
      // Validate storylets have beats
      storyletsValid: enc.storylets ? (
        (enc.storylets.victory?.beats?.length || 0) > 0 &&
        (enc.storylets.defeat?.beats?.length || 0) > 0
      ) : false,
    })) : [];

    // Phase 1.2: Populate knownFlags/knownScores from beat onShow + choice consequences
    // so CallbackOpportunitiesValidator can detect "flag set but never referenced".
    const knownFlagSet = new Set<string>();
    const knownScoreSet = new Set<string>();
    const collectFromConsequence = (c: { type?: string; name?: string } | undefined) => {
      if (!c || !c.name) return;
      if (c.type === 'setFlag' || c.type === 'flag' || c.type === 'addTag' || c.type === 'removeTag') {
        knownFlagSet.add(c.name);
      } else if (c.type === 'changeScore' || c.type === 'score' || c.type === 'attribute') {
        knownScoreSet.add(c.name);
      }
    };
    for (const sc of sceneContents) {
      for (const beat of sc.beats) {
        const onShow = (beat as unknown as { onShow?: Array<{ type?: string; name?: string }> }).onShow;
        if (Array.isArray(onShow)) for (const c of onShow) collectFromConsequence(c);
      }
    }
    for (const cs of choiceSets) {
      for (const ch of cs.choices) {
        const consequences = (ch as unknown as { consequences?: Array<{ type?: string; name?: string }> }).consequences;
        if (Array.isArray(consequences)) for (const c of consequences) collectFromConsequence(c);
        const delayed = (ch as unknown as { delayedConsequences?: Array<{ consequence?: { type?: string; name?: string } }> }).delayedConsequences;
        if (Array.isArray(delayed)) for (const d of delayed) collectFromConsequence(d.consequence);
      }
    }
    if (encounters) {
      for (const enc of encounters.values()) {
        for (const beat of enc.beats || []) {
          for (const ch of beat.choices || []) {
            for (const tier of ['success', 'complicated', 'failure'] as const) {
              const out = (ch as unknown as { outcomes?: Record<string, { consequences?: Array<{ type?: string; name?: string }> }> }).outcomes?.[tier];
              if (out?.consequences) for (const c of out.consequences) collectFromConsequence(c);
            }
          }
        }
      }
    }
    const knownFlags = Array.from(knownFlagSet);
    const knownScores = Array.from(knownScoreSet);

    // Raw encounter structures (for Pixar principles validation)
    const encounterStructures = encounters ? Array.from(encounters.values()) : [];

    return {
      scenes,
      npcs,
      choices,
      encounters: encounterValidation,
      encounterStructures,
      knownFlags,
      knownScores,
    };
  }

  // ==========================================
  // MULTI-EPISODE GENERATION METHODS
  // ==========================================

  /**
   * Phase 0: Analyze source material to determine episode count and structure
   * Call this first to get analysis, then let user choose how many episodes to generate
   */
  async analyzeSourceMaterial(
    sourceText: string,
    title?: string,
    preferences?: SourceMaterialInput['preferences'],
    userPrompt?: string
  ): Promise<SourceAnalysisResult> {
    // Source analysis now works with EITHER source text OR a user prompt
    const hasSourceText = sourceText && sourceText.trim().length > 0;
    const hasPrompt = userPrompt && userPrompt.trim().length > 0;
    
    if (!hasSourceText && !hasPrompt) {
      throw new Error('Source material analysis failed: provide either source text or a story prompt');
    }
    
    if (hasSourceText && sourceText.length > 500000) {
      this.emit({ type: 'debug', phase: 'source_analysis', message: `Warning: Source text is very large (${sourceText.length} chars), may affect performance` });
    }
    
    this.emit({ 
      type: 'phase_start', 
      phase: 'source_analysis', 
      message: hasSourceText 
        ? 'Phase 0: Analyzing source material' 
        : 'Phase 0: Analyzing story concept from prompt'
    });

    const result = await withTimeout(this.sourceMaterialAnalyzer.execute({
      sourceText: sourceText || '',
      title,
      preferences,
      userPrompt,
    }), PIPELINE_TIMEOUTS.llmAgent, 'SourceMaterialAnalyzer.execute');

    if (!result.success || !result.data) {
      throw new Error(`Source material analysis failed: ${result.error}`);
    }

    const analysis = result.data;

    this.emit({
      type: 'phase_complete',
      phase: 'source_analysis',
      message: `Analysis complete: ${analysis.totalEstimatedEpisodes} episodes identified`,
      data: {
        totalEpisodes: analysis.totalEstimatedEpisodes,
        complexity: analysis.confidenceScore,
        warnings: analysis.warnings,
      },
    });

    // Create suggested options for user
    const suggestedOptions = createEpisodeOptions(analysis);

    return {
      analysis,
      totalEpisodes: analysis.totalEstimatedEpisodes,
      episodeOutlines: analysis.episodeBreakdown,
      suggestedOptions,
    };
  }

  /**
   * Quick estimate of episode count without full analysis
   */
  async quickEstimateEpisodes(sourceText: string): Promise<{
    estimatedEpisodes: number;
    complexity: string;
    confidence: number;
  }> {
    return this.sourceMaterialAnalyzer.quickEstimate(sourceText);
  }

  /**
   * Generate multiple episodes in sequence
   * Now supports specific episode selection (not just a range)
   */
  async generateMultipleEpisodes(
    baseBrief: FullCreativeBrief,
    analysis: SourceMaterialAnalysis,
    episodeRange: { start: number; end: number; specific?: number[] },
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> }
  ): Promise<FullPipelineResult> {
    // Input validation
    this.validateBrief(baseBrief);
    
    if (!analysis || !analysis.episodeBreakdown || analysis.episodeBreakdown.length === 0) {
      throw new Error('Invalid source analysis: no episode breakdown provided');
    }
    
    if (episodeRange.start < 1) {
      throw new Error('Episode range start must be at least 1');
    }
    
    if (episodeRange.end < episodeRange.start) {
      throw new Error('Episode range end cannot be less than start');
    }
    
    if (episodeRange.specific) {
      const uniqueEpisodes = [...new Set(episodeRange.specific)];
      if (uniqueEpisodes.length !== episodeRange.specific.length) {
        this.emit({ type: 'debug', phase: 'validation', message: 'Duplicate episode numbers removed from selection' });
      }
      const invalidEpisodes = uniqueEpisodes.filter(n => n < 1 || n > analysis.totalEstimatedEpisodes);
      if (invalidEpisodes.length > 0) {
        throw new Error(`Invalid episode numbers: ${invalidEpisodes.join(', ')} (valid range: 1-${analysis.totalEstimatedEpisodes})`);
      }
    }
    
    this.events = [];
    this.checkpoints = [];
    this.telemetry = new PipelineTelemetry();
    this.pipelineStartedAtMs = Date.now();
    this.lastTelemetryOverallProgress = 0;
    this.completedPhases = new Set<string>();
    this.dependencySchedulerStats = {
      hasCycle: false,
      waveCount: 0,
      fallbackToSerial: false,
    };
    const startTime = Date.now();

    // Determine which episodes to generate
    const episodesToGenerate = episodeRange.specific || 
      Array.from({ length: episodeRange.end - episodeRange.start + 1 }, (_, i) => episodeRange.start + i);

    // Register this generation job for tracking
    this.jobId = this.externallyAssignedJobId || generateJobId();
    this.externallyAssignedJobId = null;
    this.totalEpisodes = episodesToGenerate.length;
    this.currentEpisode = 0;
    await registerJob({
      id: this.jobId,
      storyTitle: baseBrief.story.title,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'initialization',
      progress: 0,
      episodeCount: this.totalEpisodes,
      currentEpisode: this.currentEpisode,
    });

    try {
      await this.checkCancellation();
      const episodeListStr = episodeRange.specific 
        ? `episodes ${episodesToGenerate.join(', ')}`
        : `episodes ${episodeRange.start} to ${episodeRange.end}`;
      this.emit({
        type: 'phase_start',
        phase: 'multi_episode_init',
        message: `Starting multi-episode generation for ${episodeListStr}`,
      });

      // 1. Filter analysis for the requested episodes (use specific list or range)
      const filteredAnalysis = this.filterAnalysisForEpisodeRange(analysis, episodeRange, episodesToGenerate);

      // 2. Build foundation (World & Characters)
      this.emit({ type: 'phase_start', phase: 'foundation', message: 'Building story foundation...' });
      this.emitPhaseProgress('foundation', 0, 2, 'foundation:steps', 'Preparing shared story foundation...');
      
      const worldBrief = createWorldBriefFromAnalysis(baseBrief, filteredAnalysis);
      const resumedWorldBible = this.getResumeOutput<any>(resumeCheckpoint, 'world_bible');
      const worldBible = resumedWorldBible
        ? resumedWorldBible
        : await this.measurePhase('multi_world_building', () => this.runWorldBuilding(worldBrief));
      if (resumedWorldBible) {
        this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared world foundation from checkpoint' });
      } else {
        this.addCheckpoint('World Bible', worldBible, false);
      }
      this.emitPhaseProgress('foundation', 1, 2, 'foundation:steps', 'World foundation complete');

      const characterBrief = createCharacterBriefFromAnalysis(baseBrief, filteredAnalysis);
      const resumedCharacterBible = this.getResumeOutput<any>(resumeCheckpoint, 'character_bible');
      const characterBible = resumedCharacterBible
        ? resumedCharacterBible
        : await this.measurePhase('multi_character_design', () => this.runCharacterDesign(characterBrief, worldBible));
      if (resumedCharacterBible) {
        this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared character foundation from checkpoint' });
      } else {
        this.addCheckpoint('Character Bible', characterBible, false);
      }
      this.emitPhaseProgress('foundation', 2, 2, 'foundation:steps', 'Character foundation complete');

      // 2.5. Create output directory EARLY so images go to the right place (or resume existing one)
      const resumedOutputDir = this.getResumeOutput<{ outputDirectory: string }>(
        resumeCheckpoint, 'output_directory'
      )?.outputDirectory;
      let outputDirectory: string;
      if (resumedOutputDir) {
        outputDirectory = resumedOutputDir;
        await ensureDirectory(outputDirectory);
        console.log(`[Pipeline] Resumed output directory: ${outputDirectory}`);
      } else {
        outputDirectory = await createOutputDirectory(baseBrief.story.title);
      }
      this.addCheckpoint('Output Directory', { outputDirectory }, false);
      
      // Initialize AssetRegistry with JSONL persistence for durable image tracking
      const registryJsonlPath = (outputDirectory.endsWith('/') ? outputDirectory : outputDirectory + '/') + '08-asset-registry.jsonl';
      this.assetRegistry = AssetRegistry.fromJSONL(registryJsonlPath, idSlugify(baseBrief.story.title));
      const resumedRecords = this.assetRegistry.values().filter(r => r.status === 'succeeded').length;
      if (resumedRecords > 0) {
        console.log(`[Pipeline] AssetRegistry resumed ${resumedRecords} successful images from JSONL`);
        this.emit({ type: 'debug', phase: 'images', message: `AssetRegistry resumed ${resumedRecords} images from disk` });
      }

      // Set image service output directory to story's images folder
      if (this.config.imageGen?.enabled) {
        const imagesDir = outputDirectory + 'images/';
        this.imageService.setOutputDirectory(imagesDir);
        const invalidatedRefs = this.imageService.reconcileCachedReferenceStyle(this.config.artStyle);
        if (invalidatedRefs > 0) {
          this.emit({
            type: 'debug',
            phase: 'images',
            message: `Art style changed — invalidated ${invalidatedRefs} cached reference image(s) so new refs will be generated under the current style.`,
          });
        }
        this.emit({ type: 'debug', phase: 'images', message: `Image output directory: ${imagesDir}` });
      }

      // 3. Generate master images for characters and locations
      await this.checkCancellation();
      if (this.config.imageGen?.enabled) {
        this.emit({ type: 'phase_start', phase: 'master_images', message: 'Generating master reference visuals...' });
        await this.imageWorkerQueue.run(() =>
          this.measurePhase('multi_master_image_generation', () => this.runMasterImageGeneration(characterBible, worldBible, baseBrief))
        );
      }

      // 4. Generate each episode (using specific list or range)
      const episodes: Episode[] = [];
      const episodeResults: Array<{ episodeNumber: number; title: string; success: boolean; error?: string }> = [];
      const episodeQAReports: QAReport[] = [];
      const episodeBPReports: ComprehensiveValidationReport[] = [];
      const episodeSpecs = episodesToGenerate
        .map((episodeNumber, idx) => ({
          episodeNumber,
          idx,
          outline: filteredAnalysis.episodeBreakdown.find(ep => ep.episodeNumber === episodeNumber),
        }))
        .filter((item): item is { episodeNumber: number; idx: number; outline: EpisodeOutline } => Boolean(item.outline));

      const dependencyMode = this.config.generation?.episodeDependencyMode || 'sequential';
      const parallelEnabled = this.config.generation?.episodeParallelismEnabled === true && dependencyMode === 'independent';
      const maxParallelEpisodes = Math.max(1, this.config.generation?.maxParallelEpisodes ?? CONCURRENCY_DEFAULTS.maxParallelEpisodes);
      let completedEpisodeCount = 0;
      const totalEpisodeProgressItems = Math.max(1, episodeSpecs.length);
      const allStoryletFailures: string[] = [];
      const allEncounterImageDiagnostics: EncounterImageRunDiagnostic[] = [];
      this.emitPhaseProgress('content', 0, totalEpisodeProgressItems, 'episodes', 'Preparing episode generation queue...');

      if (parallelEnabled) {
        this.emit({
          type: 'phase_start',
          phase: 'episode_parallelism',
          message: `Parallel episode mode enabled with concurrency=${maxParallelEpisodes}`,
        });
        const queue = new LocalWorkerQueue(maxParallelEpisodes);
        const processed = await mapWithConcurrency(
          episodeSpecs,
          async (spec) => queue.run(async () => {
            await this.checkCancellation();
            const nextCompleted = episodeResults.length + 1;
            const episodeProgress = Math.round((nextCompleted / this.totalEpisodes) * 80) + 10;
            await this.updateJobProgress(`episode_${spec.episodeNumber}`, episodeProgress);
            this.emit({
              type: 'phase_start',
              phase: `episode_${spec.episodeNumber}`,
              message: `Generating Episode ${spec.episodeNumber}: ${spec.outline.title}`,
            });
            const generatedEpisode = await this.generateEpisodeFromOutline({
              episodeNumber: spec.episodeNumber,
              episodeIndex: spec.idx,
              episodeOutline: spec.outline,
              baseBrief,
              worldBrief,
              characterBrief,
              worldBible,
              characterBible,
              outputDirectory,
              previousSummary: baseBrief.episode.previousSummary,
            });
            completedEpisodeCount += 1;
            this.emitPhaseProgress(
              'content',
              completedEpisodeCount,
              totalEpisodeProgressItems,
              'episodes',
              `Episode ${spec.episodeNumber} finished (${completedEpisodeCount}/${totalEpisodeProgressItems})`,
              { episodeNumber: spec.episodeNumber }
            );
            return generatedEpisode;
          }),
          { concurrency: maxParallelEpisodes, continueOnError: this.config.validation.mode !== 'strict' }
        );
        for (const result of processed.values) {
          if (result.episode) episodes.push(result.episode);
          episodeResults.push(result.result);
          if (result.qaReport) episodeQAReports.push(result.qaReport);
          if (result.bestPracticesReport) episodeBPReports.push(result.bestPracticesReport);
          if (result.storyletFailures?.length) {
            allStoryletFailures.push(...result.storyletFailures);
          }
          if (result.encounterImageDiagnostics?.length) {
            allEncounterImageDiagnostics.push(...result.encounterImageDiagnostics);
          }
        }
      } else {
        for (const spec of episodeSpecs) {
          const i = spec.episodeNumber;
          await this.checkCancellation();
          this.currentEpisode = spec.idx + 1;
          const episodeProgress = Math.round((spec.idx / this.totalEpisodes) * 80) + 10;
          await this.updateJobProgress(`episode_${i}`, episodeProgress);
          this.emit({
            type: 'phase_start',
            phase: `episode_${i}`,
            message: `Generating Episode ${i}: ${spec.outline.title}`,
          });
          const previousSummary = episodes.length > 0
            ? this.summarizeEpisode(episodes[episodes.length - 1])
            : baseBrief.episode.previousSummary;
          const generated = await this.generateEpisodeFromOutline({
            episodeNumber: i,
            episodeIndex: spec.idx,
            episodeOutline: spec.outline,
            baseBrief,
            worldBrief,
            characterBrief,
            worldBible,
            characterBible,
            outputDirectory,
            previousSummary,
          });
          if (generated.episode) episodes.push(generated.episode);
          episodeResults.push(generated.result);
          if (generated.qaReport) episodeQAReports.push(generated.qaReport);
          if (generated.bestPracticesReport) episodeBPReports.push(generated.bestPracticesReport);
          completedEpisodeCount += 1;
          this.emitPhaseProgress(
            'content',
            completedEpisodeCount,
            totalEpisodeProgressItems,
            'episodes',
            `Episode ${i} finished (${completedEpisodeCount}/${totalEpisodeProgressItems})`,
            { episodeNumber: i }
          );

          if (generated.encounterImageDiagnostics?.length) {
            allEncounterImageDiagnostics.push(...generated.encounterImageDiagnostics);
          }
          if (generated.storyletFailures?.length) {
            allStoryletFailures.push(...generated.storyletFailures);
            const failMsg = generated.storyletFailures.join('; ');
            console.warn(`[Pipeline] Episode ${i}: Storylet image gaps (non-fatal, continuing): ${failMsg}`);
            this.emit({ type: 'warning', phase: `images_ep_${i}`, message: `Storylet image gaps (continuing): ${failMsg}` });
          }
        }
      }
      episodes.sort((a, b) => (a.number || 0) - (b.number || 0));
      episodeResults.sort((a, b) => a.episodeNumber - b.episodeNumber);
      this.assertEpisodeOrderingInvariants(episodes, episodeResults);

      // Aggregate per-episode QA reports into a single summary
      let aggregatedQAReport: QAReport | undefined;
      let aggregatedBPReport: ComprehensiveValidationReport | undefined;

      if (episodeQAReports.length > 0) {
        const avgScore = Math.round(episodeQAReports.reduce((sum, r) => sum + r.overallScore, 0) / episodeQAReports.length);
        aggregatedQAReport = {
          continuity: episodeQAReports[episodeQAReports.length - 1].continuity,
          voice: episodeQAReports[episodeQAReports.length - 1].voice,
          stakes: episodeQAReports[episodeQAReports.length - 1].stakes,
          overallScore: avgScore,
          passesQA: episodeQAReports.every(r => r.passesQA),
          criticalIssues: episodeQAReports.flatMap(r => r.criticalIssues),
          summary: `Aggregated QA across ${episodeQAReports.length} episode(s): avg score ${avgScore}/100`,
        };
        this.addCheckpoint('Aggregated QA Report', aggregatedQAReport, !aggregatedQAReport.passesQA);
      }

      if (episodeBPReports.length > 0) {
        const avgBPScore = Math.round(episodeBPReports.reduce((sum, r) => sum + r.overallScore, 0) / episodeBPReports.length);
        aggregatedBPReport = {
          overallPassed: episodeBPReports.every(r => r.overallPassed),
          overallScore: avgBPScore,
          blockingIssues: episodeBPReports.flatMap(r => r.blockingIssues),
          warnings: episodeBPReports.flatMap(r => r.warnings),
          suggestions: episodeBPReports.flatMap(r => r.suggestions),
          metrics: episodeBPReports[episodeBPReports.length - 1].metrics,
          timestamp: new Date(),
          duration: episodeBPReports.reduce((sum, r) => sum + r.duration, 0),
        };
        this.addCheckpoint('Aggregated Best Practices Report', aggregatedBPReport, !aggregatedBPReport.overallPassed);
      }

      // Check if no episodes were even attempted (e.g., filteredAnalysis had no matching outlines)
      if (episodes.length === 0 && episodeResults.length === 0) {
        const failMsg = `No episodes were generated — 0 out of ${episodesToGenerate.length} episode outlines found in analysis (requested episodes: ${episodesToGenerate.join(', ')}). The source analysis episodeBreakdown may not contain matching episode numbers.`;
        console.error(`[Pipeline] ${failMsg}`);
        
        if (this.jobId) {
          await failJob(this.jobId, failMsg);
        }
        
        this.emit({ type: 'error', message: failMsg });
        
        return {
          success: false,
          checkpoints: this.checkpoints,
          events: this.events,
          error: failMsg,
          duration: Date.now() - startTime,
          outputDirectory,
        };
      }

      // Check if ALL episodes failed — if so, fail the pipeline
      if (episodes.length === 0 && episodeResults.length > 0) {
        const failedErrors = episodeResults.filter(r => !r.success).map(r => r.error).join('; ');
        const failMsg = `All ${episodeResults.length} episode(s) failed to generate: ${failedErrors}`;
        console.error(`[Pipeline] ❌ ${failMsg}`);
        
        // Mark job as failed (not completed)
        if (this.jobId) {
          await failJob(this.jobId, failMsg);
        }
        
        this.emit({ type: 'error', message: failMsg });
        
        // Persist all episode errors to disk
        try {
          await savePipelineErrorLog(outputDirectory, 
            episodeResults.filter(r => !r.success).map(r => ({
              timestamp: new Date().toISOString(),
              phase: `episode_${r.episodeNumber}`,
              message: r.error || 'Unknown error',
              episodeNumber: r.episodeNumber,
            }))
          );
        } catch (_logErr) { /* non-fatal */ }
        
        // Still save partial results (world bible, character bible) for debugging
        const visualPlanningOutputs = this.getCollectedVisualPlanningForSave();
        const partialSave = savePipelineOutputs(outputDirectory, {
          brief: baseBrief,
          worldBible,
          characterBible,
          finalStory: {
            id: idSlugify(baseBrief.story.title) || 'untitled-story',
            title: baseBrief.story.title,
            genre: baseBrief.story.genre,
            synopsis: baseBrief.story.synopsis,
            coverImage: '',
            author: 'AI Generated',
            tags: baseBrief.story.themes,
            initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
            npcs: [],
            episodes: [],
            outputDir: outputDirectory,
          },
          visualPlanning: visualPlanningOutputs,
          encounterImageDiagnostics: allEncounterImageDiagnostics,
          llmLedger: this.telemetry.getLlmLedger() ?? undefined,
        }, Date.now() - startTime);
        const partialTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Partial save timed out')), 120_000)
        );
        await Promise.race([partialSave, partialTimeout]).catch(e =>
          console.warn(`[Pipeline] Partial save failed/timed out: ${e.message}`)
        );
        
        return {
          success: false,
          checkpoints: this.checkpoints,
          events: this.events,
          error: failMsg,
          duration: Date.now() - startTime,
          outputDirectory,
        };
      }

      // 5. Generate cover art + Assemble final story
      let multiCoverUrl: string | undefined;
      if (this.config.imageGen?.enabled) {
        multiCoverUrl = await this.generateStoryCoverArt(baseBrief, characterBible, worldBible);
      }

      const storyCoverImage = multiCoverUrl
        || (episodes.length > 0 && episodes[0].coverImage ? episodes[0].coverImage : '');
        
      let story: Story = {
        id: idSlugify(baseBrief.story.title) || 'untitled-story',
        title: baseBrief.story.title,
        genre: baseBrief.story.genre,
        synopsis: baseBrief.story.synopsis,
        coverImage: storyCoverImage,
        author: 'AI Generated',
        tags: baseBrief.story.themes,
        initialState: {
          attributes: { ...CHARACTER_DEFAULTS.attributes },
          skills: Object.fromEntries(DEFAULT_SKILLS.map(s => [s.name, 10])),
          tags: [],
          inventory: [],
        },
        npcs: characterBible.characters
          .filter(c => c.id !== baseBrief.protagonist.id)
          .map(c => {
            let portrait: string | undefined;
            const refSheet = this.imageAgentTeam.getReferenceSheet(c.id);
            if (refSheet) {
              const frontImg = refSheet.generatedImages.get('front') || refSheet.generatedImages.get('composite');
              portrait = frontImg?.imageUrl || frontImg?.imagePath;
            }
            return this.buildPersistedNpc(c, portrait);
          }),
        episodes,
        outputDir: outputDirectory,
      };

      // Overlay images from AssetRegistry into the assembled story
      story = assembleStoryAssetsFromRegistry(story, this.assetRegistry);

      // 6. Save results (using outputDirectory created earlier)
      // Prepare visual planning outputs for saving
      const visualPlanningOutputs = this.getCollectedVisualPlanningForSave();
      
      const multiEpSave = savePipelineOutputs(outputDirectory, {
        brief: baseBrief,
        worldBible,
        characterBible,
        finalStory: story,
        visualPlanning: visualPlanningOutputs,
        qaReport: aggregatedQAReport,
        incrementalValidationResults: this.sceneValidationResults.length > 0
          ? this.sceneValidationResults
          : undefined,
        encounterTelemetry: this.encounterTelemetry.length > 0
          ? this.encounterTelemetry
          : undefined,
        llmLedger: this.telemetry.getLlmLedger() ?? undefined,
        branchShadowDiffs: this.branchShadowDiffs.length > 0
          ? this.branchShadowDiffs
          : undefined,
        bestPracticesReport: aggregatedBPReport,
        encounterImageDiagnostics: allEncounterImageDiagnostics,
      }, Date.now() - startTime);
      const multiEpTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Multi-episode save timed out')), 120_000)
      );
      const outputManifest = await Promise.race([multiEpSave, multiEpTimeout]);
      const phaseDurationsMs = Object.fromEntries(
        this.telemetry.getPhaseMetrics().map((m) => [m.phase, m.durationMs])
      );
      const providerSummary = this.telemetry.getProviderSummary();
      const pipelineReport = {
        imageCoverage: {
          totalBeats: 0,
          beatsWithImages: 0,
          encounterBeatsTotal: 0,
          encounterBeatsWithImages: 0,
        },
        cacheHitRate: 'N/A',
        textArtifactRejections: this.imageService.pipelineMetrics.textArtifactRejections,
        transientRetries: this.imageService.pipelineMetrics.transientRetries,
        permanentFailures: this.imageService.pipelineMetrics.permanentFailures,
        choicePayoffPresence: 0,
        choicePayoffTotal: 0,
        unresolvedTokensDetected: 0,
        phaseDurationsMs,
        providerCalls: providerSummary,
        dependencyScheduler: { ...this.dependencySchedulerStats },
      };

      // If storylet images failed, save diagnostics then halt the pipeline.
      if (allStoryletFailures.length > 0) {
        const failMsg = allStoryletFailures.join('; ');
        console.error(`[Pipeline] Encounter/storylet image gaps across episodes: ${failMsg}`);
        this.emit({ type: 'error', phase: 'encounter_images', message: `Image gaps across episodes: ${failMsg}` });
        try {
          await savePipelineErrorLog(outputDirectory, allStoryletFailures.map(f => ({
            timestamp: new Date().toISOString(),
            phase: 'encounter_images',
            message: f,
          })));
        } catch { /* best-effort save */ }
        throw new PipelineError(
          `Storylet image gaps: ${allStoryletFailures.length} storylet images missing across episodes`,
          'encounter_images',
          {
            context: {
              outputDirectory,
              failureKind: 'image_completeness',
              totalMissing: allStoryletFailures.length,
              failures: allStoryletFailures.slice(0, 30),
            },
          }
        );
      }

      // Mark job as completed
      if (this.jobId) {
        await completeJob(this.jobId, outputDirectory);
      }

      return {
        success: episodeResults.some(r => r.success),
        story,
        worldBible,
        characterBible,
        checkpoints: this.checkpoints,
        events: this.events,
        duration: Date.now() - startTime,
        outputDirectory,
        outputManifest,
        pipelineReport,
        multiEpisodeResult: {
          totalEpisodes: episodeRange.end - episodeRange.start + 1,
          generatedEpisodes: episodeResults.filter(r => r.success).length,
          remainingEpisodes: 0,
          episodeResults,
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Handle job cancellation
      if (error instanceof JobCancelledError) {
        this.emit({ type: 'error', message: 'Generation cancelled by user' });
        // Job status already set to cancelled by the user action
      } else {
        this.emit({ type: 'error', message: `Multi-episode pipeline failed: ${errorMessage}` });
        // Mark job as failed
        if (this.jobId) {
          await failJob(this.jobId, errorMessage);
        }
      }

      return {
        success: false,
        checkpoints: this.checkpoints,
        events: this.events,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  private async generateEpisodeFromOutline(params: {
    episodeNumber: number;
    episodeIndex: number;
    episodeOutline: EpisodeOutline;
    baseBrief: FullCreativeBrief;
    worldBrief: FullCreativeBrief;
    characterBrief: FullCreativeBrief;
    worldBible: WorldBible;
    characterBible: CharacterBible;
    outputDirectory: string;
    previousSummary?: string;
  }): Promise<{
    episode?: Episode;
    result: { episodeNumber: number; title: string; success: boolean; error?: string };
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    storyletFailures?: string[];
    encounterImageDiagnostics?: EncounterImageRunDiagnostic[];
  }> {
    const {
      episodeNumber: i,
      episodeIndex: idx,
      episodeOutline,
      baseBrief,
      worldBrief,
      characterBrief,
      worldBible,
      characterBible,
      outputDirectory,
      previousSummary,
    } = params;
    try {
      const isFirstEpisode = idx === 0;
      let episodeStartingLocation = baseBrief.episode.startingLocation || worldBible.locations[0]?.id || '';
      const outlineLocations = episodeOutline.locations || [];
      if (!isFirstEpisode && outlineLocations.length > 0) {
        const matchedLoc = worldBible.locations.find(loc =>
          outlineLocations.some(ol => loc.name?.toLowerCase().includes(ol.toLowerCase()) || loc.id === ol)
        );
        episodeStartingLocation = matchedLoc?.id || worldBible.locations[0]?.id || '';
      } else if (!isFirstEpisode && outlineLocations.length === 0) {
        episodeStartingLocation = worldBible.locations[0]?.id || '';
      }

      const episodeBrief: FullCreativeBrief = {
        ...baseBrief,
        world: worldBrief.world,
        protagonist: characterBrief.protagonist,
        npcs: characterBrief.npcs,
        episode: {
          number: i,
          title: episodeOutline.title,
          synopsis: episodeOutline.synopsis,
          startingLocation: episodeStartingLocation,
          previousSummary,
        }
      };

      const blueprint = await this.measurePhase(`episode_${i}_architecture`, () => this.runEpisodeArchitecture(episodeBrief, worldBible, characterBible));
      await saveEarlyDiagnostic(outputDirectory, `episode-${i}-blueprint.json`, blueprint);
      const branchAnalysis = await this.measurePhase(`episode_${i}_branch_analysis`, () => this.runBranchAnalysis(episodeBrief, blueprint));
      const { sceneContents, choiceSets, encounters } = await this.measurePhase(
        `episode_${i}_content`,
        () => this.runContentGeneration(
          episodeBrief,
          worldBible,
          characterBible,
          blueprint,
          branchAnalysis || undefined
        )
      );

      // Plan 1: Harvest delayed-consequence callbacks from this episode's
      // choices (seed new hooks) and textVariants (record payoffs). The
      // ledger is then persisted to the output directory so validators and
      // the UI can inspect it.
      try {
        const { newHooks, payoffs } = this.harvestEpisodeCallbacks({
          episodeNumber: i,
          sceneContents: sceneContents as unknown as Parameters<typeof this.harvestEpisodeCallbacks>[0]['sceneContents'],
          choiceSets: choiceSets as unknown as Parameters<typeof this.harvestEpisodeCallbacks>[0]['choiceSets'],
        });
        if (newHooks > 0 || payoffs > 0) {
          this.emit({
            type: 'debug',
            phase: `episode_${i}_callbacks`,
            message: `Callback ledger: +${newHooks} new hook(s), +${payoffs} payoff(s) this episode; ${this.callbackLedger.size()} total`,
          });
        }
        await saveEarlyDiagnostic(outputDirectory, '09-callback-ledger.json', this.callbackLedger.serialize());
      } catch (ledgerErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_callbacks`,
          message: `CallbackLedger harvest failed (non-fatal): ${ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)}`,
        });
      }

      let imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> } | undefined;
      let encounterImageResults: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages: Map<string, Map<string, Map<string, string>>>; storyletFailures?: string[] } | undefined;
      let encounterImageDiagnostics: EncounterImageRunDiagnostic[] = [];
      if (this.config.imageGen?.enabled) {
        this.emit({ type: 'phase_start', phase: `images_ep_${i}`, message: `Generating visuals for Episode ${i}...` });
        try {
          // A10: warm up color script in parallel with the episode image
          // phase so the script latency overlaps master-image work.
          this._preWarmedColorScriptPromise = this.generateEpisodeColorScript(episodeBrief, sceneContents, choiceSets)
            .catch((err) => {
              this.emit({
                type: 'warning',
                phase: `images_ep_${i}`,
                message: `A10 color-script prewarm failed (will retry inline): ${err instanceof Error ? err.message : String(err)}`,
              });
              return undefined;
            });
          imageResults = await this.imageWorkerQueue.run(() =>
            this.measurePhase(
              `episode_${i}_images`,
              () => this.runEpisodeImageGeneration(sceneContents, choiceSets, episodeBrief, worldBible, characterBible, outputDirectory)
            )
          );
        } catch (imgError) {
          if (this.isLlmQuotaFailure(imgError)) {
            const quotaMsg = imgError instanceof Error ? imgError.message : String(imgError);
            this.emit({ type: 'error', phase: `images_ep_${i}`, message: `Image generation stopped: ${quotaMsg}` });
            throw new PipelineError(`Episode ${i} image generation stopped due to LLM quota exhaustion: ${quotaMsg}`, `images_ep_${i}`, {
              agent: 'ImageAgentTeam',
              context: { episode: i },
              originalError: imgError instanceof Error ? imgError : undefined,
            });
          }
          if (imgError instanceof PipelineError) {
            throw imgError;
          }
          const imgMsg = imgError instanceof Error ? imgError.message : String(imgError);
          console.error(`[Pipeline] Episode ${i} beat image generation failed: ${imgMsg}`);
          this.emit({ type: 'error', phase: `images_ep_${i}`, message: `Beat image generation failed: ${imgMsg}` });
          try {
            await savePipelineErrorLog(outputDirectory, [{
              timestamp: new Date().toISOString(),
              phase: `images_ep_${i}`,
              message: imgMsg,
              episodeNumber: i,
            }]);
          } catch { /* best-effort save */ }
          throw new PipelineError(
            `Episode ${i} beat image generation failed: ${imgMsg}`,
            `images_ep_${i}`,
            {
              agent: 'ImageAgentTeam',
              context: {
                outputDirectory,
                episode: i,
                failureKind: 'image_generation',
              },
              originalError: imgError instanceof Error ? imgError : undefined,
            }
          );
        }

        if (encounters.size > 0) {
          console.log(`[Pipeline] Episode ${i}: Starting encounter image generation for ${encounters.size} encounters`);
          try {
            this.imageService.clearEncounterDiagnostics();
            await this.runEncounterProviderPreflight(outputDirectory);
            encounterImageResults = await this.imageWorkerQueue.run(() =>
              this.measurePhase(
                `episode_${i}_encounter_images`,
                () => this.generateEncounterImages(encounters, characterBible, episodeBrief, outputDirectory)
              )
            );
            encounterImageDiagnostics = this.toEncounterRunDiagnostics(this.imageService.getEncounterDiagnostics());
            const totalEncImages = encounterImageResults?.encounterImages
              ? Array.from(encounterImageResults.encounterImages.values()).reduce((sum, v) => sum + v.setupImages.size + v.outcomeImages.size, 0)
              : 0;
            const totalStoryletImages = encounterImageResults?.storyletImages
              ? Array.from(encounterImageResults.storyletImages.values()).reduce((sum, outcomeMap) =>
                sum + Array.from(outcomeMap.values()).reduce((s, beatMap) => s + beatMap.size, 0), 0)
              : 0;
            console.log(`[Pipeline] Episode ${i}: Encounter image generation complete — ${totalEncImages} encounter images, ${totalStoryletImages} storylet images`);
          } catch (encImgError) {
            encounterImageDiagnostics = this.toEncounterRunDiagnostics(this.imageService.getEncounterDiagnostics());
            if (encounterImageDiagnostics.length > 0) {
              await saveEncounterImageDiagnosticsLog(outputDirectory, encounterImageDiagnostics);
            }
            if (this.isLlmQuotaFailure(encImgError)) {
              const quotaMsg = encImgError instanceof Error ? encImgError.message : String(encImgError);
              this.emit({ type: 'error', phase: `images_ep_${i}`, message: `Encounter image generation stopped: ${quotaMsg}` });
              throw new PipelineError(`Episode ${i} encounter image generation stopped due to LLM quota exhaustion: ${quotaMsg}`, `images_ep_${i}`, {
                agent: 'EncounterImageAgent',
                context: { episode: i },
                originalError: encImgError instanceof Error ? encImgError : undefined,
              });
            }
            const encImgMsg = encImgError instanceof Error ? encImgError.message : String(encImgError);
            console.error(`[Pipeline] Episode ${i} encounter image generation failed: ${encImgMsg}`);
            this.emit({ type: 'error', phase: `images_ep_${i}`, message: `Encounter image generation failed for episode ${i}: ${encImgMsg}` });
            throw new PipelineError(`Episode ${i} encounter image generation failed: ${encImgMsg}`, `images_ep_${i}`, {
              agent: 'EncounterImageAgent',
              context: { outputDirectory, episode: i, encounterCount: encounters.size, failureKind: 'image_generation' },
              originalError: encImgError instanceof Error ? encImgError : undefined,
            });
          }
        }
      }

      // Wire AssetRegistry for this episode (mirrors single-episode path)
      if (this.config.imageGen?.enabled && (imageResults || encounterImageResults)) {
        try {
          this.seedAssetRegistryFromResults(episodeBrief, sceneContents, encounters, imageResults, encounterImageResults);
          if (this.assetRegistry && !this.assetRegistry['persistPath'] && outputDirectory) {
            this.assetRegistry.setPersistPath(
              (outputDirectory.endsWith('/') ? outputDirectory : outputDirectory + '/') + '08-asset-registry.jsonl'
            );
          }
          await saveEarlyDiagnostic(outputDirectory, '08-registry-state.json', this.assetRegistry.toSnapshot());
        } catch (regErr) {
          const regMsg = regErr instanceof Error ? regErr.message : String(regErr);
          console.warn(`[Pipeline] AssetRegistry seeding failed for episode ${i} (non-fatal): ${regMsg}`);
        }
      }

      const episode = this.assembleEpisode(
        episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        sceneContents,
        choiceSets,
        imageResults,
        encounters,
        encounterImageResults
      );

      // Per-episode QA pass (mirrors Phase 5 from single-episode generate())
      let qaReport: QAReport | undefined;
      let bestPracticesReport: ComprehensiveValidationReport | undefined;
      if (episodeBrief.options?.runQA !== false) {
        try {
          this.emit({ type: 'phase_start', phase: `qa_ep_${i}`, message: `Running QA for Episode ${i}...` });
          const validationInput = this.prepareValidationInput(sceneContents, choiceSets, characterBible, encounters);
          const [qaResult, bpResult] = await this.measurePhase(`episode_${i}_qa`, () => Promise.all([
            this.runQualityAssurance(episodeBrief, sceneContents, choiceSets, characterBible, blueprint),
            this.config.validation.enabled
              ? this.integratedValidator.runFullValidation(validationInput)
              : Promise.resolve(undefined),
          ]));
          qaReport = qaResult;
          bestPracticesReport = bpResult;
          this.emit({
            type: 'phase_complete',
            phase: `qa_ep_${i}`,
            message: `Episode ${i} QA Score: ${qaReport.overallScore}/100 - ${qaReport.passesQA ? 'PASSED' : 'NEEDS REVISION'}`,
          });
        } catch (qaError) {
          const qaMsg = qaError instanceof Error ? qaError.message : String(qaError);
          console.error(`[Pipeline] Episode ${i} QA failed (non-fatal): ${qaMsg}`);
          this.emit({ type: 'warning', phase: `qa_ep_${i}`, message: `QA for Episode ${i} failed (continuing): ${qaMsg}` });
        }
      }

      this.emit({
        type: 'phase_complete',
        phase: `episode_${i}`,
        message: `Episode ${i} complete!`,
      });

      return {
        episode,
        result: { episodeNumber: i, title: episodeOutline.title, success: true },
        qaReport,
        bestPracticesReport,
        storyletFailures: encounterImageResults?.storyletFailures,
        encounterImageDiagnostics,
      };
    } catch (epError) {
      const msg = epError instanceof Error ? epError.message : String(epError);
      const stack = epError instanceof Error ? epError.stack : undefined;
      console.error(`[Pipeline] ❌ Failed to generate episode ${i}: ${msg}`);
      if (stack) console.error(`[Pipeline] Stack trace:`, stack);

      this.emit({
        type: 'error',
        phase: `episode_${i}`,
        message: `Episode ${i} "${episodeOutline.title}" failed: ${msg}`,
      });

      try {
        await savePipelineErrorLog(outputDirectory, [{
          timestamp: new Date().toISOString(),
          phase: `episode_${i}`,
          message: msg,
          stack,
          episodeNumber: i,
        }]);
      } catch {
        // Keep the episode failure as the primary signal.
      }

      if (this.config.validation.mode === 'strict') {
        throw epError;
      }
      return {
        result: {
          episodeNumber: i,
          title: episodeOutline.title,
          success: false,
          error: msg,
        },
        encounterImageDiagnostics: this.toEncounterRunDiagnostics(this.imageService.getEncounterDiagnostics()),
      };
    }
  }

  /**
   * Find user-provided reference images for a character using fuzzy name matching.
   * Tries: exact id, exact name, lowercase name, then partial/substring matches
   * against all keys in characterReferenceImages.
   */
  private findUserReferenceImages(
    char: CharacterProfile,
    brief: FullCreativeBrief
  ): Array<{ data: string; mimeType: string }> {
    const refMap = brief.characterReferenceImages;
    if (!refMap || Object.keys(refMap).length === 0) {
      console.log(`[Pipeline] findUserReferenceImages("${char.name}"): no characterReferenceImages in brief`);
      return [];
    }

    const refKeys = Object.keys(refMap);
    console.log(`[Pipeline] findUserReferenceImages("${char.name}", id="${char.id}"): checking against ${refKeys.length} ref key(s): ${refKeys.map(k => `"${k}"(${refMap[k]?.length || 0} imgs)`).join(', ')}`);

    // 1. Exact matches (id, name, lowercase name)
    if (refMap[char.id]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by exact ID "${char.id}" → ${refMap[char.id].length} image(s)`);
      return refMap[char.id];
    }
    if (refMap[char.name]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by exact name → ${refMap[char.name].length} image(s)`);
      return refMap[char.name];
    }
    if (refMap[char.name.toLowerCase()]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by lowercase name "${char.name.toLowerCase()}" → ${refMap[char.name.toLowerCase()].length} image(s)`);
      return refMap[char.name.toLowerCase()];
    }

    // 2. Fuzzy matching: normalize both sides and check substring containment
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const charNorm = normalize(char.name);
    const charParts = charNorm.split(' ').filter(p => p.length > 1);

    for (const [key, images] of Object.entries(refMap)) {
      if (!images?.length) continue;
      const keyNorm = normalize(key);

      if (charNorm.includes(keyNorm) || keyNorm.includes(charNorm)) {
        console.log(`[Pipeline] ✅ Fuzzy match: user ref key "${key}" ↔ character "${char.name}" (substring) → ${images.length} image(s)`);
        return images;
      }

      const keyParts = keyNorm.split(' ').filter(p => p.length > 1);
      const overlap = charParts.some(cp => keyParts.includes(cp));
      if (overlap) {
        console.log(`[Pipeline] ✅ Fuzzy match: user ref key "${key}" ↔ character "${char.name}" (word overlap) → ${images.length} image(s)`);
        return images;
      }
    }

    console.log(`[Pipeline] ❌ No reference images matched for "${char.name}" (id="${char.id}")`);
    return [];
  }

  /**
   * Run master image generation for core characters and locations
   * Now generates full reference sheets for characters (multi-view) for better consistency
   */
  private async runMasterImageGeneration(
    characterBible: CharacterBible,
    worldBible: WorldBible,
    brief: FullCreativeBrief
  ): Promise<void> {
    // D5: Before spending any budget on master images, drop reference sheets
    // whose stored identity fingerprint no longer matches the current
    // character profile. This catches the "author rewrote the character's
    // appearance between episodes" case — the cached anchor would otherwise
    // keep pinning new images to the old look. Freshly-generated sheets get
    // fingerprinted below; pre-D5 cached sheets adopt their current
    // fingerprint on first seen so drift detection starts from now.
    // D8: Under QA_MODE=fast/full, emit a structured drift audit BEFORE
    // invalidating. The audit is a pure fingerprint comparison (no LLM, no
    // image diff) so it's free to run. Operators can use the report to
    // decide whether downstream scenes should be regenerated too.
    const qaModeForDrift = this.config.imageGen?.qa?.qaMode ?? 'off';
    if (qaModeForDrift !== 'off') {
      const driftReport = this.imageAgentTeam.auditIdentityDrift(characterBible.characters);
      if (driftReport.length > 0) {
        this.emit({
          type: 'debug',
          phase: 'images',
          message: `D8 identity-drift audit (${qaModeForDrift}): ${driftReport.length} character(s) drifted — ${driftReport
            .map((d) => `${d.characterName}:${d.reason}`)
            .join(', ')}`,
        });
      }
    }

    const invalidated = this.imageAgentTeam.invalidateStaleReferenceSheets(characterBible.characters);
    if (invalidated.length > 0) {
      this.emit({
        type: 'debug',
        phase: 'images',
        message: `D5: invalidated ${invalidated.length} stale reference sheet(s) due to identity change: ${invalidated.join(', ')}`,
      });
    }

    // D1: Promote recurring non-protagonist characters to master reference
    // sheets. In addition to major/core importance, we now include
    // `supporting` characters — the writer typically tags characters that
    // appear in multiple scenes at this tier, so they benefit most from a
    // stable identity anchor. Minor one-off characters are still skipped to
    // avoid wasting generation budget on throwaway appearances.
    const majorCharacters = characterBible.characters.filter((char) =>
      char.importance === 'major' ||
      char.importance === 'core' ||
      char.importance === 'supporting' ||
      char.id === brief.protagonist.id
    );
    const majorLocations = worldBible.locations.filter((loc) => {
      const briefLoc = brief.world.keyLocations.find((location) => location.id === loc.id);
      return briefLoc?.importance === 'major';
    });
    const totalMasterAssets = majorCharacters.length + majorLocations.length;
    let completedMasterAssets = 0;
    if (totalMasterAssets > 0) {
      this.emitPhaseProgress('master_images', 0, totalMasterAssets, 'master-assets', 'Preparing master reference generation...');
    }

    // Generate reference sheets for major characters (deduplicate by ID to prevent double composites)
    const processedCharIds = new Set<string>();

    // Collect eligible characters first so we can parallelize the bulk work.
    // The single character who runs serially first establishes the
    // global style anchor (`setReferenceSheetStyleAnchor`) that subsequent
    // characters use as a consistency reference. Protagonist is preferred
    // so the anchor reflects the story's primary visual lead; otherwise
    // the first eligible character wins, matching prior behaviour.
    type EligibleChar = { char: CharacterProfile; userRefImages: Array<{ data: string; mimeType: string }> };
    const eligibleCharacters: EligibleChar[] = [];
    for (const char of characterBible.characters) {
      if (processedCharIds.has(char.id)) {
        console.warn(`[Pipeline] Skipping duplicate character ID "${char.id}" (${char.name}) — already generated reference sheet.`);
        continue;
      }
      // D1: treat "supporting" the same as "major" for reference-sheet eligibility.
      const isMajor = char.importance === 'major' ||
        char.importance === 'core' ||
        char.importance === 'supporting' ||
        char.id === brief.protagonist.id;
      const userRefImages = this.findUserReferenceImages(char, brief);
      const hasUserRefs = userRefImages.length > 0;

      if (hasUserRefs && !isMajor) {
        this.emit({ type: 'debug', phase: 'images',
          message: `Promoting "${char.name}" to reference-sheet generation (user provided ${userRefImages.length} reference image(s))` });
      }

      if (isMajor || hasUserRefs) {
        processedCharIds.add(char.id);
        eligibleCharacters.push({ char, userRefImages: hasUserRefs ? userRefImages : [] });
      }
    }

    // Process a single eligible character — handles progress emission,
    // identity fingerprinting, and cancellation. Returns a promise so the
    // caller can either await serially or Promise.all for parallel runs.
    const processCharacter = async ({ char, userRefImages }: EligibleChar): Promise<void> => {
      await this.checkCancellation();
      await this.generateCharacterReferenceSheet(char, brief, userRefImages.length > 0 ? userRefImages : undefined);
      // D5: tag the freshly-generated reference sheet with the identity
      // fingerprint that produced it so future runs can detect drift and
      // invalidate at the top of this phase (see `invalidateStaleReferenceSheets`).
      const fingerprint = computeCharacterIdentityFingerprint(char);
      this.imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, fingerprint);
      if (totalMasterAssets > 0) {
        completedMasterAssets += 1;
        this.emitPhaseProgress(
          'master_images',
          completedMasterAssets,
          totalMasterAssets,
          'master-assets',
          `Master character reference complete for ${char.name}`
        );
      }
    };

    if (eligibleCharacters.length > 0) {
      // Pick the style-anchor character: prefer the protagonist, else fall
      // back to the first eligible character. This one must run before the
      // others so `setReferenceSheetStyleAnchor` is stamped with the chosen
      // lead's front view before other characters' generation kicks off.
      const anchorIdx = Math.max(
        0,
        eligibleCharacters.findIndex(({ char }) => char.id === brief.protagonist.id),
      );
      const [anchorEntry] = eligibleCharacters.splice(anchorIdx, 1);
      await processCharacter(anchorEntry);

      // Remaining characters run in parallel — `ImageGenerationService`
      // routes through `ProviderThrottle`, which enforces the per-provider
      // concurrency cap (e.g. Gemini: 6) and min-request interval. Firing
      // all characters concurrently here cuts wall-clock time from
      // O(N_characters × per_char_time) to roughly `per_char_time`.
      if (eligibleCharacters.length > 0) {
        await Promise.all(eligibleCharacters.map(processCharacter));
      }
    }

    // Generate master shots for major locations (batch when possible)
    const locationBatchItems: { prompt: ImagePrompt; identifier: string; metadata?: any; locName: string }[] = [];
    for (const loc of worldBible.locations) {
      const briefLoc = brief.world.keyLocations.find(l => l.id === loc.id);
      if (briefLoc?.importance === 'major') {
        this.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Planning master environment shot for ${loc.name}...` });
        try {
          const promptRes = await withTimeout(this.imageAgentTeam.generateLocationMasterPrompt({
            locationId: loc.id,
            name: loc.name,
            description: loc.fullDescription,
            type: loc.type,
            genre: brief.story.genre,
            tone: brief.story.tone
          }), PIPELINE_TIMEOUTS.llmAgent, `LocationMasterPrompt(${loc.id})`);
          if (promptRes.success && promptRes.data) {
            locationBatchItems.push({
              prompt: promptRes.data,
              identifier: `master_loc_${loc.id}`,
              metadata: { type: 'master' as const },
              locName: loc.name,
            });
          }
        } catch (err) {
          console.warn(`[Pipeline] Failed to generate master prompt for ${loc.name}:`, err);
        }
      }
    }

    if (locationBatchItems.length > 0) {
      this.emit({ type: 'agent_start', agent: 'ImageService', message: `Generating ${locationBatchItems.length} location master shots...` });
      const batchResults = await withTimeout(this.imageService.generateImageBatch(
        locationBatchItems.map(item => ({ prompt: item.prompt, identifier: item.identifier, metadata: item.metadata }))
      ), PIPELINE_TIMEOUTS.storyboard, 'locationImageBatch');
      for (let i = 0; i < batchResults.length; i++) {
        const locItem = locationBatchItems[i];
        const locResult = batchResults[i];
        this.emit({ type: 'debug', phase: 'images', message: `Generated master shot for ${locItem.locName}` });
        if (locResult?.imageData && locResult?.mimeType) {
          const locId = locItem.identifier.replace('master_loc_', '');
          this.locationMasterShots.set(locId, { data: locResult.imageData, mimeType: locResult.mimeType });
        }
        if (totalMasterAssets > 0) {
          completedMasterAssets += 1;
          this.emitPhaseProgress(
            'master_images',
            completedMasterAssets,
            totalMasterAssets,
            'master-assets',
            `Master location reference complete for ${locItem.locName}`
          );
        }
      }
    }
  }

  /**
   * Generate a complete character reference sheet with multiple views
   * This creates the canonical visual reference for a character
   */
  private async generateCharacterReferenceSheet(
    char: CharacterProfile,
    brief: FullCreativeBrief,
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedReferenceSheet | null> {
    const isMajorCharacter = char.importance === 'major' || char.importance === 'core' || char.id === brief.protagonist.id;
    
    this.emit({ 
      type: 'agent_start', 
      agent: 'CharacterReferenceSheetAgent', 
      message: `Generating ${isMajorCharacter ? 'full' : 'basic'} reference for ${char.name} (${char.role})...` 
    });

    try {
      // Read any prior character knowledge from memory
      const priorKnowledge = await this.readCharacterMemory(char.name);
      if (priorKnowledge) {
        this.emit({ type: 'debug', phase: 'images', message: `Found prior character knowledge for ${char.name} in memory` });
      }

      // Build the reference sheet request from character profile
      const generateCharRefs = this.config.generation?.generateCharacterRefs ?? true;
      const generateBodyVocab = this.config.generation?.generateBodyVocabulary ?? isMajorCharacter;
      const generateExpressions = (this.config.generation?.generateExpressionSheets ?? false) && isMajorCharacter;
      const expressionTier = char.id === brief.protagonist.id ? 'core' as const : 'minimal' as const;
      
      // Use the first user-provided image as the primary reference for the sheet request
      // All images are passed to the image generation team for multi-reference consistency
      const primaryUserRef = userReferenceImages?.[0];
      
      // Determine reference mode for this character (face-only vs full-appearance)
      // Look up by character ID first, then by name, then by lowercase name
      const refSettings = brief.characterReferenceSettings;
      const referenceMode: import('../config').CharacterReferenceMode = 
        refSettings?.[char.id]?.referenceMode ||
        refSettings?.[char.name]?.referenceMode ||
        refSettings?.[char.name.toLowerCase()]?.referenceMode ||
        'face-only';
      
      if (referenceMode === 'full-appearance') {
        this.emit({ type: 'debug', phase: 'images', message: `Reference mode for ${char.name}: FULL APPEARANCE (clothing from reference image)` });
      }
      
      // Start with story-based physical traits
      let physicalTraits = this.extractPhysicalTraits(char);
      // Start with story-based clothing (may be overridden by vision in full-appearance mode)
      let clothingInfo = this.extractClothingInfo(char);
      
      // If user provided a reference image, analyze it with a vision LLM
      // face-only: overrides face/hair/body/skin, clothing stays from story
      // full-appearance: overrides everything including clothing
      let visionAnalysisSucceeded = false;
      if (primaryUserRef) {
        this.emit({ type: 'debug', phase: 'images', message: `Analyzing reference image for ${char.name} (${referenceMode})...` });
        const visionResult = await this.analyzeReferenceImageTraits(primaryUserRef, char.name, referenceMode);
        if (visionResult) {
          visionAnalysisSucceeded = true;
          const visionTraits = visionResult.physicalTraits;
          physicalTraits = {
            ...physicalTraits,
            ...(visionTraits.age ? { age: visionTraits.age } : {}),
            ...(visionTraits.height ? { height: visionTraits.height } : {}),
            ...(visionTraits.build ? { build: visionTraits.build } : {}),
            ...(visionTraits.hairColor ? { hairColor: visionTraits.hairColor } : {}),
            ...(visionTraits.hairStyle ? { hairStyle: visionTraits.hairStyle } : {}),
            ...(visionTraits.eyeColor ? { eyeColor: visionTraits.eyeColor } : {}),
            ...(visionTraits.skinTone ? { skinTone: visionTraits.skinTone } : {}),
            ...(visionTraits.distinguishingFeatures && visionTraits.distinguishingFeatures.length > 0
              ? { distinguishingFeatures: visionTraits.distinguishingFeatures } 
              : {}),
          };
          
          if (referenceMode === 'full-appearance' && visionResult.clothingInfo) {
            clothingInfo = {
              primary: visionResult.clothingInfo.primary,
              accessories: visionResult.clothingInfo.accessories,
              colorPalette: visionResult.clothingInfo.colorPalette,
            };
            this.emit({ type: 'debug', phase: 'images', message: `Clothing for ${char.name} overridden from reference image: ${clothingInfo.primary}` });
          } else {
            this.emit({ type: 'debug', phase: 'images', message: `Physical traits for ${char.name} updated from reference image (clothing from story)` });
          }
        } else {
          // Vision analysis FAILED but we still have reference images.
          // Strip face/hair/body traits that would conflict with the reference images.
          // Keep only role, gender, and clothing — let the reference images drive the face.
          this.emit({ type: 'warning', phase: 'images', message: `Vision analysis failed for ${char.name} — stripping conflicting physical traits so reference images drive the face` });
          physicalTraits = {
            ...physicalTraits,
            hairColor: undefined,
            hairStyle: undefined,
            eyeColor: undefined,
            skinTone: undefined,
            distinguishingFeatures: [
              '[IDENTITY FROM REFERENCE IMAGE — do not invent facial features, match the reference photo exactly]',
            ],
          };
        }
      }

      // Determine --ow weight based on reference mode
      const mjSettings = this.imageService.getMidjourneySettings();
      const omniWeightOverride = referenceMode === 'full-appearance' 
        ? mjSettings.fullAppearanceOmniWeight 
        : undefined; // undefined = use default refSheetOmniWeight

      const request: CharacterReferenceSheetRequest = {
        characterId: char.id,
        name: char.name,
        pronouns: char.pronouns,
        description: char.fullBackground || char.overview,
        role: char.role,
        physicalTraits: physicalTraits,
        clothing: clothingInfo,
        personality: char.voiceProfile?.writingGuidance || char.overview,
        backgroundTraits: char.fullBackground || char.overview, // For body vocabulary derivation
        genre: brief.story.genre,
        tone: brief.story.tone,
        artStyle: this.config.artStyle,
        // Expression references are generated selectively for major recurring characters.
        includeExpressions: generateCharRefs && generateExpressions,
        expressionTier,
        // Body vocabulary and silhouette for major characters - now configurable
        includeBodyVocabulary: generateCharRefs && generateBodyVocab && isMajorCharacter,
        includeSilhouetteProfile: generateCharRefs && isMajorCharacter,
        // User-provided reference image for visual guidance (primary image)
        userReferenceImage: primaryUserRef,
        // All user reference images (for multi-reference generation)
        userReferenceImages: userReferenceImages,
        // Prior knowledge from memory (past generation insights)
        priorKnowledge: priorKnowledge || undefined,
      };
      
      if (userReferenceImages && userReferenceImages.length > 0) {
        this.emit({ type: 'debug', phase: 'images', message: `Using ${userReferenceImages.length} user-provided reference image(s) for ${char.name}` });
      }

      // Use full reference generation for major characters
      if (isMajorCharacter) {
        const fullRefResult = await withTimeout(
          this.imageAgentTeam.generateFullCharacterReferenceWithSilhouette(request),
          PIPELINE_TIMEOUTS.storyboard, `CharacterRefSheet(${char.name})`
        );
        
        if (fullRefResult.errors.length > 0 && !fullRefResult.poseSheet) {
          console.error(`[Pipeline] Failed to generate full reference for ${char.name}:`, fullRefResult.errors);
          return this.fallbackToSinglePortrait(char, brief);
        }

        // Log what was generated
        const generated: string[] = [];
        if (fullRefResult.poseSheet) generated.push('pose sheet');
        if (fullRefResult.expressionSheet) generated.push(`${fullRefResult.expressionSheet.expressions?.length || 0} expressions`);
        if (fullRefResult.bodyVocabulary) generated.push('body vocabulary');
        if (fullRefResult.silhouetteProfile) generated.push('silhouette profile');
        this.emit({ type: 'debug', phase: 'images', message: `Full reference for ${char.name}: ${generated.join(', ')}` });
        
        if (fullRefResult.silhouetteProfile?.silhouetteHooks) {
          this.emit({ type: 'debug', phase: 'images', message: `Silhouette hooks: ${fullRefResult.silhouetteProfile.silhouetteHooks.join(', ')}` });
        }

        // Generate the actual images from pose sheet
        if (fullRefResult.poseSheet) {
          this.emit({ 
            type: 'agent_start', 
            agent: 'ImageAgentTeam', 
            message: `Generating ${fullRefResult.poseSheet.views.length} reference images for ${char.name}...` 
          });

          // Wrap the image service to inject omniWeightOverride when in full-appearance mode
          const imageServiceWithOwOverride = omniWeightOverride
            ? {
                generateImage: (prompt: any, identifier: string, metadata?: any, refImages?: any[]) =>
                  this.imageService.generateImage(prompt, identifier, { ...metadata, omniWeightOverride }, refImages),
              }
            : this.imageService;

          // Dual-artifact reference generation: always produce BOTH the
          // individual views (front / three-quarter / profile / face /
          // expressions — primary identity signal for Gemini, Atlas, SD) and
          // the composite model sheet (consumed by Midjourney --cref and
          // used as a low-weight style anchor for Gemini). Per-provider
          // filtering in imageGenerationService decides which artifact each
          // downstream call actually receives.
          const progressCb = (status: string, index: number, total: number) => {
            this.emit({
              type: 'checkpoint',
              phase: 'reference_sheet',
              message: `${char.name}: Generating character references (${status})`,
              data: { characterId: char.id, viewType: status, progress: index / total }
            });
          };
          const generatedSheet = await withTimeout(
            this.imageAgentTeam.generateFullCharacterReferences(
              fullRefResult.poseSheet,
              imageServiceWithOwOverride,
              progressCb,
              primaryUserRef,
              userReferenceImages,
            ),
            PIPELINE_TIMEOUTS.storyboard,
            `FullCharacterReferences(${char.name})`,
          );

          this.emit({
            type: 'agent_complete',
            agent: 'CharacterReferenceSheetAgent',
            message: `Character references complete for ${char.name}: ${generatedSheet.generatedImages.size} artifacts (views + composite)`,
            data: {
              characterId: char.id,
              viewCount: generatedSheet.generatedImages.size,
              visualAnchors: generatedSheet.visualAnchors,
              hasBodyVocabulary: !!fullRefResult.bodyVocabulary,
              hasSilhouetteProfile: !!fullRefResult.silhouetteProfile,
              silhouetteHooks: fullRefResult.silhouetteProfile?.silhouetteHooks
            }
          });

          // Store first character's ref sheet as style anchor for subsequent characters.
          // Prefer the full-body front view over the face crop so the anchor
          // carries costume and palette information, not just the face.
          const anchorImg = generatedSheet.generatedImages.get('front')
            || generatedSheet.generatedImages.get('composite')
            || generatedSheet.generatedImages.get('face');
          if (anchorImg?.imageData && anchorImg?.mimeType) {
            this.imageService.setReferenceSheetStyleAnchor(anchorImg.imageData, anchorImg.mimeType);
          }

          let generatedExprSheet: GeneratedExpressionSheet | undefined = undefined;
          if (generateExpressions && fullRefResult.expressionSheet) {
            const poseSheetImages = Array.from(generatedSheet.generatedImages.entries())
              .filter(([viewType, image]) =>
                ['front', 'three-quarter', 'profile'].includes(viewType) && !!image.imageData && !!image.mimeType
              )
              .map(([viewType, image]) => ({
                data: image.imageData!,
                mimeType: image.mimeType!,
                name: viewType,
              }));

            const expressionProgress = (expressionName: string, index: number, total: number) => {
              this.emit({
                type: 'checkpoint',
                phase: 'expression_sheet',
                message: `${char.name}: Generating expression reference ${index}/${total} (${expressionName})`,
                data: { characterId: char.id, expressionName, progress: index / total }
              });
            };

            generatedExprSheet = await withTimeout(
              this.imageAgentTeam.generateExpressionSheetImages(
                fullRefResult.expressionSheet,
                imageServiceWithOwOverride,
                poseSheetImages,
                expressionProgress,
                primaryUserRef,
                userReferenceImages,
                {
                  visualAnchors: generatedSheet.visualAnchors,
                  colorPalette: generatedSheet.colorPalette,
                }
              ),
              PIPELINE_TIMEOUTS.storyboard,
              `ExpressionRefSheet(${char.name})`
            );
          }

          // Store the collected visual reference for saving
          this.collectedVisualPlanning.characterReferences.set(char.id, {
            characterId: char.id,
            characterName: char.name,
            poseSheet: generatedSheet,
            expressionSheet: fullRefResult.expressionSheet,
            generatedExpressionSheet: generatedExprSheet,
            bodyVocabulary: fullRefResult.bodyVocabulary,
            silhouetteProfile: fullRefResult.silhouetteProfile
          });

          // Write character knowledge to memory (non-blocking)
          this.writeCharacterMemory({
            characterName: char.name,
            characterId: char.id,
            visionAnalysisSucceeded,
            physicalTraits: request.physicalTraits,
            hadUserReferenceImages: !!userReferenceImages?.length,
            userRefCount: userReferenceImages?.length || 0,
            generationSucceeded: generatedSheet.generatedImages.size > 0,
            artStyle: this.config.artStyle,
          }).catch(() => {});

          return generatedSheet;
        }

        // poseSheet was null despite no errors — fall through to simpler generation
        console.warn(`[Pipeline] Major character ${char.name} had no poseSheet from full reference; falling back to simpler generation.`);
      }

      // For non-major characters (or major characters whose full-reference planning returned no poseSheet), use simpler generation
      const sheetRes = await withTimeout(
        this.imageAgentTeam.generateCharacterReferenceSheet(request),
        PIPELINE_TIMEOUTS.llmAgent, `CharacterRefSheetPlan(${char.name})`
      );
      
      if (!sheetRes.success || !sheetRes.data) {
        console.error(`[Pipeline] Failed to generate reference sheet plan for ${char.name}:`, sheetRes.error);
        return this.fallbackToSinglePortrait(char, brief);
      }

      const sheet = sheetRes.data;
      this.emit({ type: 'debug', phase: 'images', message: `Reference sheet planned for ${char.name}: ${sheet.views.length} views` });

      // Wrap the image service to inject omniWeightOverride when in full-appearance mode
      const imageServiceWithOwOverrideSimple = omniWeightOverride
        ? {
            generateImage: (prompt: any, identifier: string, metadata?: any, refImages?: any[]) =>
              this.imageService.generateImage(prompt, identifier, { ...metadata, omniWeightOverride }, refImages),
          }
        : this.imageService;

      const simpleProgressCb = (status: string, index: number, total: number) => {
        this.emit({
          type: 'checkpoint',
          phase: 'reference_sheet',
          message: `${char.name}: Generating character references (${status})`,
          data: { characterId: char.id, viewType: status, progress: index / total }
        });
      };
      const generatedSheet = await withTimeout(
        this.imageAgentTeam.generateFullCharacterReferences(
          sheet,
          imageServiceWithOwOverrideSimple,
          simpleProgressCb,
          primaryUserRef,
          userReferenceImages,
        ),
        PIPELINE_TIMEOUTS.storyboard,
        `FullCharacterReferences(${char.name})`,
      );

      this.emit({
        type: 'agent_complete',
        agent: 'CharacterReferenceSheetAgent',
        message: `Character references complete for ${char.name}: ${generatedSheet.generatedImages.size} artifacts (views + composite)`,
        data: {
          characterId: char.id,
          viewCount: generatedSheet.generatedImages.size,
          visualAnchors: generatedSheet.visualAnchors
        }
      });

      // Store first character's ref sheet as style anchor for subsequent characters.
      // Prefer the full-body front view over the face crop so the anchor
      // carries costume and palette information, not just the face.
      const anchorImg = generatedSheet.generatedImages.get('front')
        || generatedSheet.generatedImages.get('composite')
        || generatedSheet.generatedImages.get('face');
      if (anchorImg?.imageData && anchorImg?.mimeType) {
        this.imageService.setReferenceSheetStyleAnchor(anchorImg.imageData, anchorImg.mimeType);
      }

      // Write character knowledge to memory (non-blocking)
      this.writeCharacterMemory({
        characterName: char.name,
        characterId: char.id,
        visionAnalysisSucceeded,
        physicalTraits: request.physicalTraits,
        hadUserReferenceImages: !!userReferenceImages?.length,
        userRefCount: userReferenceImages?.length || 0,
        generationSucceeded: generatedSheet.generatedImages.size > 0,
        artStyle: this.config.artStyle,
      }).catch(() => {});

      return generatedSheet;

    } catch (err) {
      console.error(`[Pipeline] Failed to generate reference sheet for ${char.name}:`, err);
      return this.fallbackToSinglePortrait(char, brief);
    }
  }

  /**
   * Fallback: Generate a single portrait if reference sheet generation fails.
   * Always allowed even in fail-fast mode — ref sheets are an enhancement,
   * not a hard requirement, and the portrait fallback is the recovery path.
   */
  private async fallbackToSinglePortrait(
    char: CharacterProfile,
    brief: FullCreativeBrief
  ): Promise<null> {
    console.warn(`[Pipeline] Falling back to single portrait for ${char.name}`);
    this.emit({
      type: 'warning',
      phase: 'reference_sheet',
      message: `Character reference generation failed for ${char.name}; attempting portrait fallback`,
    });
    this.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Generating single portrait for ${char.name} (fallback)...` });

    try {
      const promptRes = await withTimeout(this.imageAgentTeam.generateCharacterMasterPrompt({
        characterId: char.id,
        name: char.name,
        description: char.fullBackground || char.overview,
        role: char.role,
        genre: brief.story.genre,
        tone: brief.story.tone
      }), PIPELINE_TIMEOUTS.llmAgent, `CharacterMasterPrompt(${char.name})`);

      if (promptRes.success && promptRes.data) {
        await withTimeout(this.imageService.generateImage(
          promptRes.data,
          `master_char_${char.id}`,
          { type: 'master' }
        ), PIPELINE_TIMEOUTS.imageGeneration, `masterPortrait(${char.name})`);
        this.emit({ type: 'debug', phase: 'images', message: `Generated fallback portrait for ${char.name}` });
      }
    } catch (err) {
      console.warn(`[Pipeline] Failed to generate fallback portrait for ${char.name}:`, err);
    }

    return null;
  }

  /**
   * Analyze a user-provided reference image to extract physical traits using a vision LLM.
   * Returns structured physical traits that override the story's text-based descriptions.
   * In 'face-only' mode: extracts face, eyes, hair, skin, body type — leaves clothing to the story.
   * In 'full-appearance' mode: also extracts clothing, accessories, and outfit details.
   */
  private async analyzeReferenceImageTraits(
    image: { data: string; mimeType: string },
    characterName: string,
    referenceMode: import('../config').CharacterReferenceMode = 'face-only'
  ): Promise<{ physicalTraits: CharacterReferenceSheetRequest['physicalTraits']; clothingInfo?: { primary: string; accessories?: string[]; colorPalette?: string[] } } | null> {
    try {
      const modeLabel = referenceMode === 'full-appearance' ? 'full appearance (including clothing)' : 'physical traits only';
      this.emit({ type: 'debug', phase: 'images', message: `Analyzing reference image for ${characterName} — mode: ${modeLabel}...` });

      // Use a lightweight BaseAgent subclass for the vision call
      const { BaseAgent } = await import('../agents/BaseAgent');

      class VisionAnalyzer extends BaseAgent {
        constructor(config: any) { super('VisionAnalyzer', config); }
        protected getAgentSpecificPrompt(): string { return ''; }
        async execute(_input: any): Promise<any> { throw new Error('Use callLLM directly'); }
      }

      const analyzer = new VisionAnalyzer({
        ...this.config.agents.storyArchitect,
        maxTokens: 1024,
        temperature: 0.2, // Low temp for factual description
      });

      // Build the vision prompt based on reference mode
      const clothingFields = referenceMode === 'full-appearance'
        ? `
  "clothing": "detailed description of the outfit/clothing visible (e.g. 'rumpled brown trench coat over dark button-up shirt, loosened tie')",
  "accessories": ["array of visible accessories like 'leather watch', 'silver ring', 'worn messenger bag'"],
  "clothingColorPalette": ["array of dominant clothing colors like 'dark brown', 'charcoal', 'cream'"],
  "clothingSummary": "A 1-2 sentence description of the complete outfit suitable for an image generation prompt",`
        : '';

      const clothingRule = referenceMode === 'full-appearance'
        ? '- ALSO describe clothing, jewelry, hats, accessories, and outfit details in the clothing fields.'
        : '- Do NOT describe clothing, jewelry, hats, or accessories.';

      const summaryInstruction = referenceMode === 'full-appearance'
        ? 'A 1-2 sentence physical description suitable for an image generation prompt, covering face, hair, body, and skin. Clothing is described separately in clothingSummary.'
        : 'A 1-2 sentence physical description suitable for an image generation prompt, covering face, hair, body, and skin. Do NOT mention clothing.';

      const userInstruction = referenceMode === 'full-appearance'
        ? `Analyze this reference image for the character "${characterName}". Extract their physical traits AND clothing/outfit details.`
        : `Analyze this reference image for the character "${characterName}". Extract their physical traits only — no clothing or accessories.`;

      const messages = [
        {
          role: 'system' as const,
          content: `You are a visual character analyst. You examine reference images and extract traits based on the requested mode.

Return a JSON object with ONLY these fields (omit any you can't determine):
{
  "age": "estimated age or age range (e.g. 'mid-30s', 'elderly', 'young adult')",
  "height": "apparent height if determinable (e.g. 'tall', 'average', 'short')",
  "build": "body type (e.g. 'athletic', 'slim', 'stocky', 'muscular', 'heavyset')",
  "hairColor": "hair color (e.g. 'dark brown', 'platinum blonde', 'salt-and-pepper')",
  "hairStyle": "hair style (e.g. 'short cropped', 'long wavy', 'braided', 'bald')",
  "eyeColor": "eye color if visible (e.g. 'blue', 'dark brown', 'green')",
  "skinTone": "skin tone (e.g. 'fair', 'olive', 'dark brown', 'tan')",
  "faceShape": "face shape (e.g. 'angular', 'round', 'square jaw', 'heart-shaped')",
  "distinguishingFeatures": ["array of notable physical features like 'prominent cheekbones', 'stubble', 'freckles', 'scar across left eye', 'dimpled chin'"],${clothingFields}
  "physicalSummary": "${summaryInstruction}"
}

CRITICAL: 
- Describe WHAT YOU SEE in the image, not what you imagine.
${clothingRule}
- Do NOT invent traits you cannot see (e.g. don't guess eye color if the image is too small).
- Return ONLY valid JSON, no markdown fences.`,
        },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: userInstruction },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.mimeType,
                data: image.data,
              }
            }
          ]
        }
      ];

      let response: string;
      let jsonMatch: RegExpMatchArray | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        response = await (analyzer as any).callLLM(messages);
        jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) break;
        console.warn(`[Pipeline] Vision analysis for ${characterName} attempt ${attempt}: No JSON found. Raw response (first 500 chars): ${response.substring(0, 500)}`);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (!jsonMatch) {
        console.error(`[Pipeline] Vision analysis for ${characterName}: No JSON after 2 attempts`);
        this.emit({ type: 'warning', phase: 'images', message: `Vision analysis failed for ${characterName} — reference images will still be passed directly to image generation` });
        return null;
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Pipeline] Vision analysis for ${characterName} (${referenceMode}):`, JSON.stringify(parsed).substring(0, 400));
      
      this.emit({ type: 'debug', phase: 'images', message: `Reference image analysis for ${characterName} (${referenceMode}): ${parsed.physicalSummary || 'done'}` });

      const physicalTraits = {
        age: parsed.age,
        height: parsed.height,
        build: parsed.build,
        hairColor: parsed.hairColor,
        hairStyle: parsed.hairStyle,
        eyeColor: parsed.eyeColor,
        skinTone: parsed.skinTone,
        distinguishingFeatures: [
          ...(parsed.distinguishingFeatures || []),
          ...(parsed.faceShape ? [`${parsed.faceShape} face`] : []),
          // Store the full summary for use in prompt building
          ...(parsed.physicalSummary ? [`[REF_SUMMARY: ${parsed.physicalSummary}]`] : []),
        ],
      };

      // Extract clothing info when in full-appearance mode
      const clothingInfo = referenceMode === 'full-appearance' && parsed.clothing
        ? {
            primary: parsed.clothingSummary || parsed.clothing,
            accessories: parsed.accessories,
            colorPalette: parsed.clothingColorPalette,
          }
        : undefined;

      if (clothingInfo) {
        this.emit({ type: 'debug', phase: 'images', message: `Clothing from reference for ${characterName}: ${clothingInfo.primary}` });
      }

      return { physicalTraits, clothingInfo };
    } catch (error) {
      console.error(`[Pipeline] Failed to analyze reference image for ${characterName}:`, error);
      this.emit({ type: 'debug', phase: 'images', message: `Reference image analysis failed for ${characterName}: ${error}` });
      return null;
    }
  }

  /**
   * Extract physical traits from a character profile for reference sheet generation
   */
  private extractPhysicalTraits(char: CharacterProfile): CharacterReferenceSheetRequest['physicalTraits'] {
    // Try to parse physical traits from the character's description/background
    const text = `${char.fullBackground || ''} ${char.overview || ''}`.toLowerCase();
    
    const traits: CharacterReferenceSheetRequest['physicalTraits'] = {};
    
    // Simple extraction patterns - in production, the CharacterDesigner could provide structured data
    const agePatterns = [/(\d+)[\s-]*(year|yr)/i, /(young|middle-aged|elderly|teen|child|adult)/i];
    const heightPatterns = [/(tall|short|average height|petite)/i];
    const buildPatterns = [/(muscular|slim|slender|stocky|athletic|heavyset|lithe)/i];
    const hairColorPatterns = [/(blonde?|brunette|red|black|white|gray|silver|auburn|ginger)[\s-]*(hair)?/i];
    const hairStylePatterns = [/(long|short|curly|straight|wavy|braided?|bald|mohawk|ponytail)/i];
    const eyeColorPatterns = [/(blue|green|brown|hazel|gray|amber|violet|golden?)[\s-]*(eyes?)/i];

    for (const pattern of agePatterns) {
      const match = text.match(pattern);
      if (match) { traits.age = match[1] || match[0]; break; }
    }

    for (const pattern of heightPatterns) {
      const match = text.match(pattern);
      if (match) { traits.height = match[1]; break; }
    }

    for (const pattern of buildPatterns) {
      const match = text.match(pattern);
      if (match) { traits.build = match[1]; break; }
    }

    for (const pattern of hairColorPatterns) {
      const match = text.match(pattern);
      if (match) { traits.hairColor = match[1]; break; }
    }

    for (const pattern of hairStylePatterns) {
      const match = text.match(pattern);
      if (match) { traits.hairStyle = match[1]; break; }
    }

    for (const pattern of eyeColorPatterns) {
      const match = text.match(pattern);
      if (match) { traits.eyeColor = match[1]; break; }
    }

    // Look for distinguishing features
    const distinguishingPatterns = [
      /(scar on \w+)/i, /(tattoo)/i, /(glasses)/i, /(freckles)/i,
      /(beard)/i, /(mustache)/i, /(eyepatch)/i, /(missing \w+)/i
    ];
    const features: string[] = [];
    for (const pattern of distinguishingPatterns) {
      const match = text.match(pattern);
      if (match) features.push(match[0]);
    }
    if (features.length > 0) traits.distinguishingFeatures = features;

    return traits;
  }

  /**
   * Extract clothing info from a character profile
   */
  private extractClothingInfo(char: CharacterProfile): CharacterReferenceSheetRequest['clothing'] | undefined {
    const text = `${char.fullBackground || ''} ${char.overview || ''}`.toLowerCase();
    
    // Simple extraction - look for clothing mentions
    const clothingPatterns = [
      /(wears? [\w\s]+)/i,
      /(dressed in [\w\s]+)/i,
      /([\w\s]+ robes?)/i,
      /(armor)/i,
      /(uniform)/i,
      /(cloak)/i,
      /(dress)/i,
      /(suit)/i
    ];

    for (const pattern of clothingPatterns) {
      const match = text.match(pattern);
      if (match) {
        return { primary: match[0].trim() };
      }
    }

    return undefined;
  }

  /**
   * Scan disk for beat images that were successfully written but never wired into
   * `beatImages` / the AssetRegistry — typically because the generation promise
   * resolved AFTER `withTimeout` rejected (Node has no native promise cancellation,
   * so the underlying write to disk continues even after the caller gives up).
   *
   * For each beat missing from `beatImages`, we try a small set of known identifier
   * patterns the pipeline uses (single path, panel path, tier1 retry) and, if a
   * file exists, wire it back into both `beatImages` and the AssetRegistry so the
   * final story assembly and coverage checks see the image.
   */
  private reconcileOrphanedBeatImages(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    beatImages: Map<string, string>,
    sceneImages: Map<string, string>,
  ): number {
    let recoveredCount = 0;

    for (const scene of sceneContents) {
      const sceneBeats = scene.beats || [];
      if (sceneBeats.length === 0) continue;

      const scopedSceneId = this.getEpisodeScopedSceneId(brief, scene.sceneId);

      for (let beatIdx = 0; beatIdx < sceneBeats.length; beatIdx++) {
        const beat = sceneBeats[beatIdx];
        const beatKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beat.id);
        if (beatImages.has(beatKey)) continue;

        // Match the identifier patterns used at generation time, in priority order.
        const baseId = `beat-${scopedSceneId}-${beat.id}`;
        const candidateIdentifiers = [
          `${baseId}-panel-0`,
          baseId,
          `${baseId}-retry`,
        ];

        for (const candidate of candidateIdentifiers) {
          const existing = this.imageService.findExistingGeneratedImage(candidate);
          if (!existing?.imageUrl) continue;

          beatImages.set(beatKey, existing.imageUrl);
          if (beatIdx === 0 && !sceneImages.has(scopedSceneId)) {
            sceneImages.set(scopedSceneId, existing.imageUrl);
          }
          recoveredCount++;

          console.warn(
            `[Pipeline] Orphan recovery: wired orphaned image for scene "${scene.sceneId}" beat "${beat.id}" (identifier: ${candidate})`,
          );
          this.emit({
            type: 'warning',
            phase: 'images',
            message: `Recovered orphaned image for ${scene.sceneId}:${beat.id}`,
            data: { sceneId: scene.sceneId, beatId: beat.id, identifier: candidate, imageUrl: existing.imageUrl },
          });

          // Mirror into AssetRegistry so coverage checks + final assembler agree.
          const heroSlotId = `story-beat:${scopedSceneId}::${beat.id}`;
          try {
            if (!this.assetRegistry.get(heroSlotId)) {
              this.assetRegistry.planSlot({
                slotId: heroSlotId,
                family: 'story-beat',
                imageType: 'beat',
                sceneId: scene.sceneId,
                scopedSceneId,
                beatId: beat.id,
                storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beat.id}].image`,
                baseIdentifier: candidate,
                required: false,
                qualityTier: 'standard',
                coverageKey: `beat:${scene.sceneId}::${beat.id}`,
              });
            }
            this.assetRegistry.markSuccess(heroSlotId, {
              prompt: { prompt: '' } as any,
              imageUrl: existing.imageUrl,
              imagePath: existing.imagePath,
            } as GeneratedImage);
          } catch { /* non-fatal */ }

          break;
        }
      }
    }

    if (recoveredCount > 0) {
      console.log(`[Pipeline] Orphan reconciliation: recovered ${recoveredCount} beat image(s) from disk`);
    }
    return recoveredCount;
  }

  /**
   * Run image generation for an entire episode
   * Returns a map of beatId -> imageUrl for linking to story
   * Now uses character reference sheets for consistency AND pose diversity validation
   * ENHANCED: Includes color script, scene context, and full story data mapping
   */
  private async runEpisodeImageGeneration(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    outputDirectory?: string
  ): Promise<{ beatImages: Map<string, string>; sceneImages: Map<string, string> }> {
    const beatImages = new Map<string, string>();
    const sceneImages = new Map<string, string>();

    // Track last generated image for continuity (previous scene + style reference fallback)
    let lastGeneratedImage: { data: string; mimeType: string } | null = null;
    let styleReferenceStored = false;

    // Global image counter across all scenes for progress reporting
    let globalImageIndex = 0;
    const estimatedTotalImages = sceneContents.reduce((sum, sc) => sum + (sc.beats?.length || 0), 0);
    
    // PHASE 1: Generate color script for visual arc consistency.
    // A10: prefer the pre-warmed promise if the caller kicked one off in
    // parallel with master-image generation. Fresh inline call is the
    // fallback (and matches pre-A10 behavior).
    let colorScript: ColorScript | undefined;
    if (this._preWarmedColorScriptPromise) {
      colorScript = await this._preWarmedColorScriptPromise;
      this._preWarmedColorScriptPromise = null;
      if (colorScript === undefined) {
        colorScript = await this.generateEpisodeColorScript(brief, sceneContents, choiceSets);
      }
    } else {
      colorScript = await this.generateEpisodeColorScript(brief, sceneContents, choiceSets);
    }
    
    // Store color script for saving
    if (colorScript) {
      this.collectedVisualPlanning.colorScript = colorScript;
    }

    if (colorScript) {
      styleReferenceStored = await this.generateEpisodeStyleBible(brief, colorScript, characterBible);
    }

    // LoRA training hook. Runs after the character reference sheets AND the
    // style-bible anchors are available — both are prerequisites for
    // meaningful training data. The call is a no-op for providers that
    // can't consume LoRAs (i.e. anything but Stable Diffusion today) and
    // whenever the subsystem is disabled in config.
    try {
      await this.runLoraTrainingIfEligible(brief, characterBible, outputDirectory);
    } catch (loraErr) {
      this.emit({
        type: 'warning',
        phase: 'images',
        message: `LoRA training pass threw (non-fatal, continuing scene generation): ${loraErr instanceof Error ? loraErr.message : String(loraErr)}`,
      });
    }
    
    // A3 (narrow, opt-in): fan out scene-opening beats in parallel before
    // the main loop runs. Keeps D10's per-scene continuity invariant intact
    // because mid-scene beats remain strictly sequential inside the loop —
    // only the FIRST beat of each scene is hoisted, which by definition
    // has no previous-beat continuity dependency (D10 clears the reference
    // at every scene boundary). A4 (full overlap of scene N with scene
    // N+1's tail) remains deferred; see IMAGE_PIPELINE_RUNTIME.md.
    const imagePipelineEnv = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
    const parallelSceneStartsEnabled = imagePipelineEnv.EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS === 'true'
      || imagePipelineEnv.EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS === '1';
    if (parallelSceneStartsEnabled) {
      try {
        await this.prefetchSceneOpeningBeats(sceneContents, brief, characterBible, colorScript, worldBible, outputDirectory);
      } catch (prefetchErr) {
        this.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch phase threw (falling back to inline generation): ${prefetchErr instanceof Error ? prefetchErr.message : String(prefetchErr)}`,
        });
        this._openingBeatPrefetch.clear();
      }
    } else {
      this._openingBeatPrefetch.clear();
    }

    for (let sceneIndex = 0; sceneIndex < sceneContents.length; sceneIndex++) {
      await this.checkCancellation();
      const scene = sceneContents[sceneIndex];
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, scene.sceneId);
      this.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Planning visuals for scene: ${scene.sceneName}...` });

      // D10: drop the previous-scene reference at every scene boundary so the
      // first beat of the new scene isn't biased by the last beat of the
      // previous one. Continuation within the scene's beats still benefits
      // from setGeminiPreviousScene after each successful generation.
      this.imageService.clearGeminiPreviousScene();

      try {
        // Null-safety: guarantee array fields are always arrays before any downstream code touches them
        if (!Array.isArray(scene.moodProgression)) scene.moodProgression = scene.moodProgression ? [scene.moodProgression as unknown as string] : [];
        if (!Array.isArray(scene.keyMoments)) scene.keyMoments = scene.keyMoments ? [scene.keyMoments as unknown as string] : [];
        if (!Array.isArray(scene.charactersInvolved)) scene.charactersInvolved = [];
        if (!Array.isArray(scene.continuityNotes)) scene.continuityNotes = [];

        console.log(`[Pipeline] 🖼 Image generation step 1/6: gathering characters for scene "${scene.sceneId}"`);
        // Collect character IDs present in this scene for reference image gathering
        const sceneCharacterIds = this.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id);
        
        console.log(`[Pipeline] 🖼 Image generation step 2/6: body vocabularies for scene "${scene.sceneId}"`);
        // Get body vocabularies for characters in scene (for pose consistency)
        // Note: silhouette data is now injected per-character via characterDescriptions below
        const characterBodyVocabularies = this.gatherCharacterBodyVocabularies(sceneCharacterIds, characterBible);
        
        console.log(`[Pipeline] 🖼 Image generation step 3/6: extracting scene context for scene "${scene.sceneId}"`);
        // Extract scene context
        const sceneContext = {
          ...this.extractSceneContext(scene, sceneIndex, sceneContents.length, worldBible),
          settingContext: scene.settingContext,
        };
        
        console.log(`[Pipeline] 🖼 Image generation step 4/6: mapping choice positions for scene "${scene.sceneId}"`);
        // Map choice positions for this scene
        const choicePositions = this.mapChoicePositions(choiceSets, scene);
        
        console.log(`[Pipeline] 🖼 Image generation step 5/6: getting location info for scene "${scene.sceneId}"`);
        // Get location info
        const locationInfo = getLocationInfoForScene(scene, worldBible);
        
        const sceneLocationId = locationInfo?.locationId;
        const imageServiceWithRefs = {
          generateImage: async (prompt: ImagePrompt, identifier: string, metadata?: any) => {
            const shotCharacterIds = metadata?.characters || sceneCharacterIds;
            const referenceImages = this.gatherCharacterReferenceImages(
              shotCharacterIds,
              characterBible,
              sceneLocationId,
              {
                includeExpressions: metadata?.includeExpressionRefs === true,
                family: 'story-beat',
                slotId: metadata?.sceneId && metadata?.beatId
                  ? `story-beat:${metadata.sceneId}::${metadata.beatId}`
                  : `story-scene:${scopedSceneId}`,
              }
            );
            
            return this.imageService.generateImage(
              prompt,
              identifier,
              metadata,
              referenceImages.length > 0 ? referenceImages : undefined
            );
          }
        };

        // Filter beats based on image generation strategy (narrative-aware, mirrors story approach)
        const imageStrategy = this.config.imageGen?.strategy || 'selective';
        const beatsToIllustrate = imageStrategy === 'all-beats' 
          ? scene.beats 
          : scene.beats.filter((b, idx) => {
              const isStartingBeat = b.id === scene.startingBeatId || idx === 0;
              const isChoicePoint = b.isChoicePoint === true;
              const isLastBeat = idx === scene.beats.length - 1;
              const isClimaxBeat = (b as { isClimaxBeat?: boolean }).isClimaxBeat === true;
              const isKeyStoryBeat = (b as { isKeyStoryBeat?: boolean }).isKeyStoryBeat === true;
              const isChoicePayoff = (b as { isChoicePayoff?: boolean }).isChoicePayoff === true;
              const isIntervalBeat = idx % 3 === 0;
              return isStartingBeat || isChoicePoint || isLastBeat || isClimaxBeat || isKeyStoryBeat || isChoicePayoff || isIntervalBeat;
            });
        
        console.log(`[Pipeline] 🖼 Image generation step 6/6: building enrichedBeats for scene "${scene.sceneId}" (${beatsToIllustrate.length} beats selected)`);
        // Build enriched beat data with per-beat character analysis
        // This determines WHO is in the visual foreground vs background for each beat
        const enrichedBeats = beatsToIllustrate.map((b, beatIndex) => {
          const beatCharContext = this.analyzeBeatCharacters(
            b.text,
            b.speaker,
            sceneCharacterIds,
            characterBible,
            brief.protagonist.id
          );
          // Resolve shotType: use SceneWriter's explicit value when available, otherwise derive from
          // character context. Beats where the protagonist only entered foreground via the "your/you"
          // second-person fallback (no named characters in text, no speaker, no action verb) are
          // treated as establishing shots — environment-only, no character poses.
          const explicitShotType = (b as any).shotType as 'establishing' | 'character' | 'action' | undefined;
          const isEstablishing = explicitShotType === 'establishing'
            || (!explicitShotType && this.isEstablishingBeat(b.text, b.speaker, b.primaryAction, beatCharContext));
          const resolvedShotType: 'establishing' | 'character' | 'action' = explicitShotType
            || (isEstablishing ? 'establishing' : 'character');
          return {
            id: b.id,
            text: b.text,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            // Per-beat character classification — empty for establishing shots so no identity block is injected
            characters: isEstablishing ? [] : beatCharContext.foreground,
            foregroundCharacters: isEstablishing ? [] : beatCharContext.foregroundNames,
            backgroundCharacters: isEstablishing ? [] : beatCharContext.backgroundNames,
            // Map speakerMood to emotional hints for visual generation
            emotionHint: isEstablishing ? undefined : this.mapSpeakerMoodToEmotion(b.speakerMood),
            intensityHint: this.inferIntensity(b.speakerMood, b.text),
            valenceHint: this.inferValence(b.speakerMood, b.text),
            // B4: SceneWriter-authored visual contract fields now typed on Beat.
            visualMoment: b.visualMoment,
            primaryAction: isEstablishing ? '' : b.primaryAction,
            emotionalRead: isEstablishing ? '' : b.emotionalRead,
            relationshipDynamic: isEstablishing ? '' : b.relationshipDynamic,
            mustShowDetail: b.mustShowDetail,
            // Shot intent — drives image prompt strategy (establishing = environment-only)
            shotType: resolvedShotType,
          };
        });
        
        // --- Shot Sequence Planning (runs for ALL beats regardless of panelMode) ---
        const panelMode: PanelMode = this.config.imageGen?.panelMode || 'single';
        const shotPlans = planShotSequence(
          enrichedBeats.map(b => ({
            id: b.id,
            text: b.text,
            shotType: (b as any).shotType,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            isChoicePayoff: (b as any).isChoicePayoff,
            emotionalRead: b.emotionalRead,
            relationshipDynamic: b.relationshipDynamic,
            primaryAction: b.primaryAction,
            intensityTier: b.intensityTier,
          })),
          { genre: brief.story.genre, tone: brief.story.tone },
          panelMode,
        );
        const shotPlanMap = new Map<string, ShotPlan>(
          shotPlans.map(sp => [sp.beatId, sp])
        );

        this.emit({ 
          type: 'debug', 
          phase: 'images', 
          message: `Image strategy "${imageStrategy}": ${beatsToIllustrate.length}/${scene.beats.length} beats to illustrate for scene ${scene.sceneId}. Shot plan: ${shotPlans.filter(sp => sp.isPanelBeat).length} panel beats, panelMode=${panelMode}` 
        });

        // Skip storyboard for encounter scenes (0 narrative beats — images are handled by EncounterImageAgent)
        if (enrichedBeats.length === 0) {
          console.log(`[Pipeline] ⏭ Skipping storyboard for scene "${scene.sceneId}" — no narrative beats to illustrate (encounter-only scene)`);
          this.emit({ type: 'debug', phase: 'images', message: `Skipped storyboard for ${scene.sceneName}: no narrative beats` });
          continue;
        }

        // Beat resume state: load completed beat IDs for this scene from disk
        const sceneSlug = idSlugify(scene.sceneId);
        const beatResumeLoaded = outputDirectory ? loadBeatResumeStateSync(outputDirectory, sceneSlug) : null;
        const beatResumeSet = new Set<string>(beatResumeLoaded?.completedIdentifiers ?? []);
        const beatResumeImageMap: Record<string, string> = { ...(beatResumeLoaded?.beatImageMap ?? {}) };
        const persistBeatResume = async (): Promise<void> => {
          if (!outputDirectory) return;
          await saveBeatResumeState(outputDirectory, sceneSlug, {
            version: 1,
            sceneId: scene.sceneId,
            scopedSceneId,
            completedIdentifiers: [...beatResumeSet],
            beatImageMap: beatResumeImageMap,
            generatedAt: new Date().toISOString(),
          });
        };
        if (beatResumeLoaded && beatResumeSet.size > 0) {
          console.log(`[Pipeline] Beat resume: loaded ${beatResumeSet.size} completed beats for scene ${scene.sceneId}`);
        }

        // Determine scene mood from mood progression
        const sceneMood = scene.moodProgression.length > 0 
          ? scene.moodProgression[0] 
          : (sceneContext.isClimactic ? 'intense' : 'dramatic');

        // ----- DETERMINISTIC BEAT IMAGE GENERATION -----
        // Replaces the LLM-driven StoryboardAgent + IllustratorAgent + QA cascade
        // with CinematicBeatAnalyzer templates + direct image generation.
        const chatModeEnabled = this.imageService.getGeminiSettings().useChatMode === true;
        if (chatModeEnabled) {
          const artStyle = this.imageService.getGeminiSettings().canonicalArtStyle || this.config.artStyle || 'dramatic cinematic story art';
          const sceneCharIds = [...new Set(enrichedBeats.flatMap(b => b.characters || []))];
          const sceneCharDescs = this.buildCharacterDescriptions(sceneCharIds, characterBible);
          const charIdentityLines = sceneCharDescs.map(d => `${d.name}: ${d.appearance}`);
          const charNames = sceneCharDescs.map(d => d.name).join(', ');
          let systemContext = 
            `You are generating a series of dramatic story images for a scene. ` +
            `Art style (MANDATORY): ${artStyle}. Maintain this exact art style across ALL images in this series. ` +
            `Characters in this scene: ${charNames || 'see references'}. `;
          if (charIdentityLines.length > 0) {
            systemContext += `CHARACTER VISUAL IDENTITY (use these exact descriptions across ALL images, do NOT contradict): ${charIdentityLines.join('. ')}. `;
          }
          systemContext +=
            `CRITICAL: Maintain identical character appearance AND identical art style across ALL images in this series. ` +
            `Every image must look like it belongs in the same art series. Each image should show a different moment in the same scene.`;
          this.imageService.startChatSession(scopedSceneId, systemContext);
        }

        // Extract color mood for this scene (if color script is available)
        const sceneColorMood = (colorScript as any)?.scenes
          ?.find((cs: any) => cs.sceneId === scene.sceneId || cs.sceneName === scene.sceneName);
        const colorMoodHints = sceneColorMood ? {
          palette: (sceneColorMood as any).palette || (sceneColorMood as any).colorPalette,
          lighting: (sceneColorMood as any).lighting || (sceneColorMood as any).lightingMood,
          temperature: (sceneColorMood as any).temperature,
        } : undefined;

        const scenePromptCtx: import('../images/beatPromptBuilder').ScenePromptContext = {
          sceneId: scene.sceneId,
          sceneName: scene.sceneName,
          genre: brief.story.genre,
          tone: brief.story.tone,
          mood: sceneMood,
          settingContext: scene.settingContext,
          artStyle: this.config.artStyle,
          colorMood: colorMoodHints,
          // C2: pass the structured style profile so the deterministic prompt
          // builder can drop negatives that contradict the chosen aesthetic
          // and merge the profile's genreNegatives into the final prompt.
          styleProfile: this.config.imageGen?.artStyleProfile,
        };

        // Build beat-level character lookup from our earlier analysis
        const beatCharacterMap = new Map<string, string[]>();
        for (const eb of enrichedBeats) {
          beatCharacterMap.set(eb.id, eb.characters);
        }

        for (let beatIdx = 0; beatIdx < enrichedBeats.length; beatIdx++) {
          await this.checkCancellation();
          const beat = enrichedBeats[beatIdx];
          const beatId = beat.id;
          const identifier = `beat-${scopedSceneId}-${beatId}`;

          // Beat resume: if the AssetRegistry already has a successful result for this beat, reuse it
          const resumeSlotId = `story-beat:${scopedSceneId}::${beatId}`;
          const existingRecord = this.assetRegistry.getResolvedAsset(resumeSlotId);
          if (existingRecord?.latestUrl) {
            console.log(`[Pipeline] Beat resume: reusing existing image for ${beatId} from registry`);
            const beatMapKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
            beatImages.set(beatMapKey, existingRecord.latestUrl);
            if (beatIdx === 0) sceneImages.set(scopedSceneId, existingRecord.latestUrl);
            globalImageIndex++;
            continue;
          }

          // Disk-based beat resume: check if this beat was completed in a prior run
          if (beatResumeSet.has(identifier) && beatResumeImageMap[identifier]) {
            console.log(`[Pipeline] Beat resume: reusing existing image for ${beatId} from disk resume state`);
            const beatMapKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
            beatImages.set(beatMapKey, beatResumeImageMap[identifier]);
            if (beatIdx === 0) sceneImages.set(scopedSceneId, beatResumeImageMap[identifier]);
            globalImageIndex++;
            continue;
          }

          // A3-narrow: reuse prefetched scene-opening beat if available. The
          // prefetch phase ran before the main loop and produced a resolved
          // GeneratedImage for this identifier; mirror the post-generation
          // bookkeeping here (beatImages / sceneImages / assetRegistry /
          // resume / style-ref / lastGeneratedImage) so downstream code sees
          // exactly the same state as if the inline generateImage succeeded.
          if (beatIdx === 0) {
            const prefetchLookupKey = identifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
            const prefetched = this._openingBeatPrefetch.get(prefetchLookupKey);
            if (prefetched && prefetched.imageUrl) {
              this._openingBeatPrefetch.delete(prefetchLookupKey);
              console.log(`[Pipeline] A3-narrow: reusing prefetched opening-beat image for ${identifier}`);
              const beatMapKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
              beatImages.set(beatMapKey, prefetched.imageUrl);
              sceneImages.set(scopedSceneId, prefetched.imageUrl);

              try {
                const slotId = resumeSlotId;
                if (!this.assetRegistry.get(slotId)) {
                  this.assetRegistry.planSlot({
                    slotId,
                    family: 'story-beat',
                    imageType: 'beat',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].imageUrl`,
                    baseIdentifier: identifier,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `beat:${scene.sceneId}:${beatId}`,
                  });
                }
                this.assetRegistry.markSuccess(slotId, prefetched);
                // Mirror the main loop's scene-slot bookkeeping (line 7624-7642).
                const sceneSlotId = `story-scene:${scopedSceneId}`;
                if (!this.assetRegistry.get(sceneSlotId)) {
                  this.assetRegistry.planSlot({
                    slotId: sceneSlotId,
                    family: 'story-scene',
                    imageType: 'scene',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
                    baseIdentifier: `scene-${scopedSceneId}-bg`,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `scene:${scene.sceneId}`,
                  });
                }
                this.assetRegistry.markSuccess(sceneSlotId, prefetched);
              } catch { /* non-fatal: registry is supplementary to beatImages map */ }

              if (prefetched.imageData && prefetched.mimeType) {
                lastGeneratedImage = { data: prefetched.imageData, mimeType: prefetched.mimeType };
              }

              if (!styleReferenceStored && prefetched.imageData && prefetched.mimeType) {
                this.imageService.setGeminiStyleReference(prefetched.imageData, prefetched.mimeType);
                styleReferenceStored = true;
                this.emit({ type: 'debug', phase: 'images', message: `Stored style reference from prefetched opener of scene ${scene.sceneId}` });
              }

              beatResumeSet.add(identifier);
              beatResumeImageMap[identifier] = prefetched.imageUrl;
              persistBeatResume().catch(() => {});

              globalImageIndex++;
              this.emit({
                type: 'checkpoint',
                phase: 'images',
                message: `Image ${globalImageIndex} of ~${estimatedTotalImages} complete (prefetched)`,
                data: { imageIndex: globalImageIndex, totalImages: estimatedTotalImages, identifier, sceneId: scene.sceneId, prefetched: true },
              });
              continue;
            }
          }

          const isEstablishingBeat = (beat as any).shotType === 'establishing';
          let shotCharacterIds: string[];
          if (isEstablishingBeat) {
            shotCharacterIds = [];
          } else {
            shotCharacterIds = beat.characters && beat.characters.length > 0
              ? beat.characters
              : sceneCharacterIds;
            if (!shotCharacterIds.includes(brief.protagonist.id)) {
              shotCharacterIds = [brief.protagonist.id, ...shotCharacterIds];
            }
          }
          const shotCharacterNames = shotCharacterIds
            .map(id => characterBible.characters.find(c => c.id === id)?.name)
            .filter(Boolean) as string[];

          // B6: Look up per-beat color guidance from the episode color script.
          const beatColorEntry = (colorScript as any)?.beats?.find(
            (b: any) => b.beatId === beatId
          );
          let beatColorOverride: import('../images/beatPromptBuilder').BeatPromptInput['colorMoodOverride'] | undefined;
          if (beatColorEntry) {
            const hues: string[] = Array.isArray(beatColorEntry.dominantHues) ? beatColorEntry.dominantHues : [];
            const palette = hues.length > 0 ? hues.join(' and ') : undefined;
            const temperature = typeof beatColorEntry.lightTemp === 'string' ? beatColorEntry.lightTemp : undefined;
            // Compare to the previous beat's hues to produce a transition note.
            let transitionNote: string | undefined;
            if (beatIdx > 0) {
              const prevEntry = (colorScript as any).beats?.[beatIdx - 1];
              const prevHues: string[] = Array.isArray(prevEntry?.dominantHues) ? prevEntry.dominantHues : [];
              if (prevHues.length > 0 && palette) {
                transitionNote = `transitioning from ${prevHues.join('/')} to ${hues.join('/')}`;
              }
            }
            beatColorOverride = {
              palette,
              lighting: typeof beatColorEntry.lightDirection === 'string'
                ? `${beatColorEntry.lightDirection} light`
                : undefined,
              temperature,
              transitionNote,
            };
          }

          const beatPromptInput: import('../images/beatPromptBuilder').BeatPromptInput = {
            beatId,
            beatText: beat.text,
            beatIndex: beatIdx,
            totalBeats: enrichedBeats.length,
            visualMoment: this.sanitizePromptText((beat as any).visualMoment || '', brief, ''),
            primaryAction: isEstablishingBeat ? '' : this.sanitizePromptText((beat as any).primaryAction || '', brief, ''),
            emotionalRead: isEstablishingBeat ? '' : this.sanitizePromptText((beat as any).emotionalRead || '', brief, ''),
            relationshipDynamic: isEstablishingBeat ? '' : this.sanitizePromptText((beat as any).relationshipDynamic || '', brief, ''),
            mustShowDetail: this.sanitizePromptText((beat as any).mustShowDetail || '', brief, ''),
            shotType: (beat as any).shotType || 'character',
            isClimaxBeat: beat.isClimaxBeat,
            isKeyStoryBeat: beat.isKeyStoryBeat,
            isChoicePayoff: (beat as any).isChoicePayoff,
            choiceContext: this.sanitizePromptText((beat as any).choiceContext || '', brief, ''),
            incomingChoiceContext: this.sanitizePromptText(scene.incomingChoiceContext || '', brief, ''),
            isBranchPayoff: beatIdx === 0 && !!scene.incomingChoiceContext,
            foregroundCharacterNames: isEstablishingBeat ? [] : (beat.foregroundCharacters || shotCharacterNames),
            backgroundCharacterNames: isEstablishingBeat ? [] : beat.backgroundCharacters,
            colorMoodOverride: beatColorOverride,
          };

          let imagePrompt = buildBeatImagePrompt(beatPromptInput, scenePromptCtx);
          imagePrompt = this.sanitizeImagePrompt(imagePrompt, brief);

          // Apply shot plan override (universal — all beats get their shot type from the scene-level planner)
          const beatPlan = shotPlanMap.get(beatId);
          if (beatPlan) {
            imagePrompt = overrideShotFromPlan(imagePrompt, beatPlan.assignedShotType, beatPlan.assignedAngle);
          }

          this.emit({ type: 'agent_start', agent: 'ImageService', message: `Generating image for beat ${beatId} in ${scene.sceneName}...` });

          const includeExpressionRefs = !!(
            beat.isClimaxBeat ||
            beat.isKeyStoryBeat
          );
          const referenceImages = this.gatherCharacterReferenceImages(
            shotCharacterIds,
            characterBible,
            sceneLocationId,
            {
              includeExpressions: includeExpressionRefs,
              family: 'story-beat',
              slotId: `story-beat:${scopedSceneId}::${beatId}`,
            }
          );

          try {
            // --- PANEL PATH: generate multiple sub-images for this beat ---
            if (beatPlan?.isPanelBeat && beatPlan.panelShotSequence && beatPlan.panelCount) {
              const panelUrls: string[] = [];
              let previousPanelImage: { data: string; mimeType: string } | null = null;
              this.emit({ type: 'debug', phase: 'images', message: `Panel beat ${beatId}: generating ${beatPlan.panelCount} panels` });

              for (let pIdx = 0; pIdx < beatPlan.panelCount; pIdx++) {
                const panelShotType = beatPlan.panelShotSequence[pIdx] || beatPlan.assignedShotType;
                const panelPrompt = overrideShotFromPlan(
                  { ...imagePrompt },
                  panelShotType,
                  beatPlan.assignedAngle,
                  pIdx,
                  beatPlan.panelCount,
                );
                const panelIdentifier = `${identifier}-panel-${pIdx}`;
                const panelLabel = `imageService(${scopedSceneId}:${beatId}:panel-${pIdx})`;
                const shotCharacterDescriptions = this.buildCharacterDescriptions(shotCharacterIds, characterBible);

                // Build panel-specific references: base refs + previous panel for style continuity
                const panelRefs = referenceImages.length > 0 ? [...referenceImages] : [];
                if (previousPanelImage) {
                  panelRefs.push({
                    data: previousPanelImage.data,
                    mimeType: previousPanelImage.mimeType,
                    role: 'previous-panel-continuity',
                    characterName: '',
                    viewType: 'panel',
                  });
                }

                let panelResult: GeneratedImage;
                if (chatModeEnabled && this.imageService.hasChatSession(scopedSceneId)) {
                  panelResult = await withTimeout(this.imageService.generateImageInChat(
                    panelPrompt,
                    panelIdentifier,
                    panelRefs.length > 0 ? panelRefs : undefined,
                    { characterNames: shotCharacterNames, characterDescriptions: shotCharacterDescriptions }
                  ), PIPELINE_TIMEOUTS.imageGeneration, panelLabel);
                } else {
                  panelResult = await withTimeout(this.imageService.generateImage(
                    panelPrompt,
                    panelIdentifier,
                    {
                      sceneId: scopedSceneId,
                      beatId,
                      type: 'scene',
                      characters: shotCharacterIds,
                      characterNames: shotCharacterNames,
                      characterDescriptions: shotCharacterDescriptions,
                    },
                    panelRefs.length > 0 ? panelRefs : undefined
                  ), PIPELINE_TIMEOUTS.imageGeneration, panelLabel);
                }

                // Tier 1 validation for panel
                const panelTier1 = runTier1Checks(panelResult, panelIdentifier);
                if (!panelTier1.passed && panelTier1.shouldRetry) {
                  console.warn(`[Pipeline] Panel Tier 1 check failed for ${panelIdentifier}: ${panelTier1.reason}. Retrying once.`);
                  this.emit({ type: 'warning', phase: 'images', message: `Panel Tier 1 retry for ${beatId} panel ${pIdx}: ${panelTier1.reason}` });
                  try {
                    const retryPanelResult = await withTimeout(this.imageService.generateImage(
                      panelPrompt,
                      `${panelIdentifier}-retry`,
                      { sceneId: scopedSceneId, beatId, type: 'scene', characters: shotCharacterIds, regeneration: 1 },
                      panelRefs.length > 0 ? panelRefs : undefined
                    ), PIPELINE_TIMEOUTS.imageGeneration, `${panelLabel}-retry`);
                    const retryTier1 = runTier1Checks(retryPanelResult, `${panelIdentifier}-retry`);
                    if (retryTier1.passed) {
                      panelResult = retryPanelResult;
                    }
                  } catch { /* retry is best-effort */ }
                }

                if (panelResult.imageUrl) {
                  panelUrls.push(panelResult.imageUrl);
                  const panelSlotId = `story-beat-panel:${scene.sceneId}::${beatId}::panel-${pIdx}`;
                  try {
                    if (!this.assetRegistry.get(panelSlotId)) {
                      this.assetRegistry.planSlot({
                        slotId: panelSlotId,
                        family: 'story-beat-panel',
                        imageType: 'beat',
                        sceneId: scene.sceneId,
                        scopedSceneId,
                        beatId,
                        storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].panelImages[${pIdx}]`,
                        baseIdentifier: panelIdentifier,
                        required: false,
                        qualityTier: 'standard',
                        coverageKey: `beat-panel:${scene.sceneId}::${beatId}::${pIdx}`,
                        metadata: { panelIndex: pIdx },
                      });
                    }
                    this.assetRegistry.markSuccess(panelSlotId, panelResult, { prompt: panelPrompt });
                  } catch { /* non-fatal */ }

                  if (panelResult.imageData && panelResult.mimeType) {
                    lastGeneratedImage = { data: panelResult.imageData, mimeType: panelResult.mimeType };
                    previousPanelImage = { data: panelResult.imageData, mimeType: panelResult.mimeType };
                  }
                }

                await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
              }

              if (panelUrls.length > 0) {
                const beatMapKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
                beatImages.set(beatMapKey, panelUrls[0]);
                if (beatIdx === 0) sceneImages.set(scopedSceneId, panelUrls[0]);

                const heroSlotId = `story-beat:${scopedSceneId}::${beatId}`;
                try {
                  if (!this.assetRegistry.get(heroSlotId)) {
                    this.assetRegistry.planSlot({
                      slotId: heroSlotId,
                      family: 'story-beat',
                      imageType: 'beat',
                      sceneId: scene.sceneId,
                      scopedSceneId,
                      beatId,
                      storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].image`,
                      baseIdentifier: identifier,
                      required: false,
                      qualityTier: 'standard',
                      coverageKey: `beat:${scene.sceneId}::${beatId}`,
                    });
                  }
                  this.assetRegistry.markSuccess(heroSlotId, { imageUrl: panelUrls[0] } as GeneratedImage);
                } catch { /* non-fatal */ }

                beatResumeSet.add(identifier);
                beatResumeImageMap[identifier] = panelUrls[0];
                persistBeatResume().catch(() => {});
              }

              if (!styleReferenceStored && lastGeneratedImage) {
                this.imageService.setGeminiStyleReference(lastGeneratedImage.data, lastGeneratedImage.mimeType);
                styleReferenceStored = true;
              }
            } else {
            // --- SINGLE IMAGE PATH (existing behavior with shot plan override applied above) ---
            let result: GeneratedImage;
            const imgLabel = `imageService(${scopedSceneId}:${beatId})`;
            if (chatModeEnabled && this.imageService.hasChatSession(scopedSceneId)) {
              const chatCharacterDescriptions = this.buildCharacterDescriptions(shotCharacterIds, characterBible);
              result = await withTimeout(this.imageService.generateImageInChat(
                imagePrompt,
                identifier,
                referenceImages.length > 0 ? referenceImages : undefined,
                { characterNames: shotCharacterNames, characterDescriptions: chatCharacterDescriptions }
              ), PIPELINE_TIMEOUTS.imageGeneration, imgLabel);
            } else {
              const shotCharacterDescriptions = this.buildCharacterDescriptions(shotCharacterIds, characterBible);
              result = await withTimeout(this.imageService.generateImage(
                imagePrompt,
                identifier,
                {
                  sceneId: scopedSceneId,
                  beatId,
                  type: 'scene',
                  characters: shotCharacterIds,
                  characterNames: shotCharacterNames,
                  characterDescriptions: shotCharacterDescriptions,
                },
                referenceImages.length > 0 ? referenceImages : undefined
              ), PIPELINE_TIMEOUTS.imageGeneration, imgLabel);
            }

            // Tier 1 validation: deterministic inline check
            const tier1 = runTier1Checks(result, identifier);
            if (!tier1.passed && tier1.shouldRetry) {
              console.warn(`[Pipeline] Tier 1 check failed for ${identifier}: ${tier1.reason}. Retrying once.`);
              this.emit({ type: 'warning', phase: 'images', message: `Tier 1 retry for ${beatId}: ${tier1.reason}` });
              const retryResult = await withTimeout(this.imageService.generateImage(
                imagePrompt,
                `${identifier}-retry`,
                { sceneId: scopedSceneId, beatId, type: 'scene', characters: shotCharacterIds, regeneration: 1 },
                referenceImages.length > 0 ? referenceImages : undefined
              ), PIPELINE_TIMEOUTS.imageGeneration, `${imgLabel}-retry`);
              const retryTier1 = runTier1Checks(retryResult, `${identifier}-retry`);
              if (retryTier1.passed) {
                result = retryResult;
              } else {
                console.warn(`[Pipeline] Tier 1 retry also failed for ${identifier}: ${retryTier1.reason}. Using original.`);
              }
            }

            if (result.imageUrl) {
              const beatMapKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
              beatImages.set(beatMapKey, result.imageUrl);

              // Register with AssetRegistry for durable tracking
              const slotId = `story-beat:${scopedSceneId}::${beatId}`;
              try {
                if (!this.assetRegistry.get(slotId)) {
                  this.assetRegistry.planSlot({
                    slotId,
                    family: 'story-beat',
                    imageType: 'beat',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].image`,
                    baseIdentifier: identifier,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `beat:${scene.sceneId}::${beatId}`,
                  });
                }
                this.assetRegistry.markSuccess(slotId, result, { prompt: imagePrompt });
              } catch { /* non-fatal: registry is supplementary to beatImages map */ }

              if (beatIdx === 0) {
                sceneImages.set(scopedSceneId, result.imageUrl);
                const sceneSlotId = `story-scene:${scopedSceneId}`;
                try {
                  if (!this.assetRegistry.get(sceneSlotId)) {
                    this.assetRegistry.planSlot({
                      slotId: sceneSlotId,
                      family: 'story-scene',
                      imageType: 'scene',
                      sceneId: scene.sceneId,
                      scopedSceneId,
                      beatId,
                      storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
                      baseIdentifier: `scene-${scopedSceneId}-bg`,
                      required: false,
                      qualityTier: 'standard',
                      coverageKey: `scene:${scene.sceneId}`,
                    });
                  }
                  this.assetRegistry.markSuccess(sceneSlotId, result);
                } catch { /* non-fatal */ }
              }

              if (result.imageData && result.mimeType) {
                lastGeneratedImage = { data: result.imageData, mimeType: result.mimeType };
              }

              if (!styleReferenceStored && result.imageData && result.mimeType) {
                this.imageService.setGeminiStyleReference(result.imageData, result.mimeType);
                styleReferenceStored = true;
                this.emit({ type: 'debug', phase: 'images', message: `Stored style reference from scene ${scene.sceneId}` });
              }

              beatResumeSet.add(identifier);
              beatResumeImageMap[identifier] = result.imageUrl;
              persistBeatResume().catch(() => {});

              await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
            }
            } // end single-image / panel branch

            globalImageIndex++;
            this.emit({
              type: 'checkpoint',
              phase: 'images',
              message: `Image ${globalImageIndex} of ~${estimatedTotalImages} complete`,
              data: { imageIndex: globalImageIndex, totalImages: estimatedTotalImages, identifier, sceneId: scene.sceneId },
            });
          } catch (shotErr) {
            const shotErrMsg = shotErr instanceof Error ? shotErr.message : String(shotErr);
            console.warn(`[Pipeline] Beat image generation failed for ${scopedSceneId}:${beatId}: ${shotErrMsg}`);
            this.emit({ type: 'warning', phase: 'images', message: `Beat image failed for ${scopedSceneId}:${beatId}: ${shotErrMsg}` });
            if (this.isLlmQuotaFailure(shotErr)) {
              console.error(`[Pipeline] LLM quota exhausted during shot generation — re-throwing to halt pipeline`);
              throw shotErr;
            }
            await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs * 2));
          }
        }

        if (chatModeEnabled) {
          this.imageService.endChatSession();
        }


        // After all shots in this scene: update Gemini context images for continuity
        if (lastGeneratedImage) {
          // Previous scene image: always update to the latest generated scene image
          this.imageService.setGeminiPreviousScene(lastGeneratedImage.data, lastGeneratedImage.mimeType);

          // Style reference: store the first scene's image as the style anchor
          if (!styleReferenceStored) {
            this.imageService.setGeminiStyleReference(lastGeneratedImage.data, lastGeneratedImage.mimeType);
            styleReferenceStored = true;
            this.emit({ type: 'debug', phase: 'images', message: `Stored style reference from scene ${scene.sceneId}` });
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Pipeline] Image generation THREW for scene "${scene.sceneId}" ("${scene.sceneName}"): ${errMsg}`);
        this.emit({
          type: 'error',
          phase: 'images',
          message: `Image generation failed for scene ${scene.sceneId} ("${scene.sceneName}"): ${errMsg}`,
          data: { sceneId: scene.sceneId, sceneName: scene.sceneName, error: errMsg },
        });
      }
    }

    // Orphan reconciliation: wire up any images that landed on disk after their
    // generation promise was abandoned by `withTimeout` (Node can't cancel the
    // underlying work, so the file may appear after the pipeline gave up on it).
    this.reconcileOrphanedBeatImages(brief, sceneContents, beatImages, sceneImages);

    // Recovery pass: detect scenes that got zero images and run fallback generation
    for (const scene of sceneContents) {
      await this.checkCancellation();
      const sceneBeats = scene.beats || [];
      if (sceneBeats.length === 0) continue; // encounter-only scene
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, scene.sceneId);

      const coveredCount = sceneBeats.filter(b => beatImages.has(this.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id))).length;
      if (coveredCount > 0) continue; // scene has at least some images

      console.warn(`[Pipeline] 🔄 Recovery: scene "${scene.sceneId}" ("${scene.sceneName}") has 0/${sceneBeats.length} beat images — generating fallback images`);
      this.throwIfFailFast(
        `Scene ${scene.sceneName} produced zero beat images`,
        'images',
        {
          context: {
            sceneId: scene.sceneId,
            sceneName: scene.sceneName,
            failureKind: 'image_step',
          },
        }
      );
      this.emit({
        type: 'warning',
        phase: 'images',
        message: `Recovery: generating fallback images for ${scene.sceneName} (0/${sceneBeats.length} beats had images)`,
      });

      const sceneCharacterIds = this.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id);
      const referenceImages = this.gatherCharacterReferenceImages(
        sceneCharacterIds,
        characterBible,
        undefined,
        { family: 'story-beat', slotId: `story-scene:${scopedSceneId}` }
      );

      for (const beat of sceneBeats) {
        try {
          const fallbackPrompt: ImagePrompt = this.withSettingAwarePrompt({
            prompt: `${this.sanitizePromptText(beat.text, brief, '')} Show exactly one concrete story moment in a single continuous frame from one camera angle. Do not show multiple moments, repeated figures, or stacked scenes inside the image.`,
            style: this.config.artStyle || undefined,
            aspectRatio: '9:19.5',
            composition: `Scene: ${scene.sceneName}. Genre: ${brief.story.genre}, Tone: ${brief.story.tone}. Generate exactly ONE single full-bleed image with ONE unified scene and ONE camera angle. No split-screen, no diptych, no stacked panels, no repeated subject, no image-within-image.`,
            negativePrompt: 'text, words, letters, signatures, watermarks, comic panels, split panels, storyboard, grid layout, diptych, triptych, collage, duplicate character, same character twice, cloned figure, repeated subject',
          }, scene.settingContext);
          const identifier = `beat-${scopedSceneId}-${beat.id}-recovery`;
          const result = await withTimeout(this.imageService.generateImage(
            fallbackPrompt, identifier,
            { sceneId: scopedSceneId, beatId: beat.id, type: 'scene', characters: sceneCharacterIds },
            referenceImages.length > 0 ? referenceImages : undefined
          ), PIPELINE_TIMEOUTS.imageGeneration, `recoveryFallback(${scopedSceneId}:${beat.id})`);
          if (result.imageUrl) {
            beatImages.set(this.getEpisodeScopedBeatKey(brief, scene.sceneId, beat.id), result.imageUrl);
          }
        } catch (beatErr) {
          const beatErrMsg = beatErr instanceof Error ? beatErr.message : String(beatErr);
          console.warn(`[Pipeline] Recovery fallback failed for beat ${beat.id} in scene ${scene.sceneId}: ${beatErrMsg}`);
          this.emit({ type: 'warning', phase: 'images', message: `Recovery fallback failed for ${scene.sceneId}:${beat.id}: ${beatErrMsg}` });
        }
      }

      const recoveredCount = sceneBeats.filter(b => beatImages.has(this.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id))).length;
      console.log(`[Pipeline] Recovery complete for scene "${scene.sceneId}": ${recoveredCount}/${sceneBeats.length} beats now have images`);
    }

    // === TIER 2/3 VISUAL VALIDATION: Post-generation quality check ===
    if (beatImages.size > 0) {
      const sceneReports: Tier2SceneReport[] = [];

      for (const scene of sceneContents) {
        const scopedId = brief.episode?.number > 1
          ? `ep${brief.episode.number}-${scene.sceneId}`
          : scene.sceneId;
        const sceneBeats = scene.beats.filter(b =>
          beatImages.has(this.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id))
        );
        if (sceneBeats.length === 0) continue;

        const shots = sceneBeats.map(b => ({
          cameraAngle: (b as any).shotType || 'unknown',
          shotType: (b as any).shotType || 'character',
          beatId: b.id,
        }));

        const diversity = checkStructuralDiversity(shots, this.config.imageGen?.artStyleProfile);
        if (!diversity.acceptable) {
          this.emit({
            type: 'warning',
            phase: 'images',
            message: `Structural diversity issue in ${scene.sceneId}: ${diversity.warnings.join('; ')}`,
          });
        }

        const shotReports: Tier2ShotReport[] = sceneBeats.map((b, idx) => {
          const diversityPenalty = !diversity.acceptable ? 0.5 : 0;
          const baseScore = 3.5 - diversityPenalty;
          return {
            shotId: `${scopedId}-${b.id}`,
            beatId: b.id,
            scores: {
              expression: baseScore,
              pose: baseScore,
              flow: idx === 0 ? 5 : baseScore,
              setting: baseScore,
            },
            averageScore: idx === 0
              ? (baseScore * 3 + 5) / 4
              : baseScore,
            flagged: !diversity.acceptable && baseScore < 3,
            reason: !diversity.acceptable ? diversity.warnings[0] : undefined,
          };
        });

        const overallScore = shotReports.length > 0
          ? shotReports.reduce((sum, r) => sum + r.averageScore, 0) / shotReports.length
          : 3.5;

        sceneReports.push({
          sceneId: scene.sceneId,
          shotReports,
          overallScore: Math.round(overallScore * 10) / 10,
          flaggedCount: shotReports.filter(r => r.flagged).length,
        });
      }

      const visualQAReport: VisualQAReport = {
        generatedAt: new Date().toISOString(),
        scenes: sceneReports,
        totalImages: beatImages.size,
        totalFlagged: sceneReports.reduce((sum, s) => sum + s.flaggedCount, 0),
        overallScore: sceneReports.length > 0
          ? Math.round(sceneReports.reduce((sum, s) => sum + s.overallScore, 0) / sceneReports.length * 10) / 10
          : 5,
      };

      // Tier 3: Identify and regenerate flagged images
      const regenTargets = identifyRegenTargets(visualQAReport, 2.5);
      if (regenTargets.length > 0) {
        this.emit({
          type: 'regeneration_triggered',
          phase: 'images',
          message: `Tier 3 visual QA: regenerating ${regenTargets.length} flagged image(s)`,
        });

        const maxTier3Regens = Math.min(regenTargets.length, 5);
        for (let ti = 0; ti < maxTier3Regens; ti++) {
          const target = regenTargets[ti];
          const scene = sceneContents.find(sc => sc.sceneId === target.sceneId);
          if (!scene) continue;
          const beat = scene.beats.find(b => b.id === target.beatId);
          if (!beat) continue;

          const scopedId = brief.episode?.number > 1
            ? `ep${brief.episode.number}-${target.sceneId}`
            : target.sceneId;

          const identifier = `beat-${scopedId}-${target.beatId}-tier3`;
          const imgPrompt: ImagePrompt = target.originalPrompt || {
            prompt: `High-quality dramatic story image for: ${beat.text.slice(0, 200)}`,
            negativePrompt: 'text, watermark, logo, blurry, low quality',
            width: 1024,
            height: 1024,
          };

          try {
            const result = await withTimeout(this.imageService.generateImage(
              imgPrompt,
              identifier,
              { sceneId: target.sceneId, beatId: target.beatId, type: 'scene', regeneration: 1 },
            ), PIPELINE_TIMEOUTS.imageGeneration, `tier3-regen(${target.beatId})`);

            const tier1Check = runTier1Checks(result, identifier);
            if (tier1Check.passed && result.imageUrl) {
              const beatMapKey = this.getEpisodeScopedBeatKey(brief, target.sceneId, target.beatId);
              beatImages.set(beatMapKey, result.imageUrl);
              this.emit({
                type: 'debug',
                phase: 'images',
                message: `Tier 3 regen succeeded for ${target.beatId}: ${target.reason}`,
              });
            }
          } catch (regenErr) {
            const errMsg = regenErr instanceof Error ? regenErr.message : String(regenErr);
            this.emit({ type: 'warning', phase: 'images', message: `Tier 3 regen failed for ${target.beatId}: ${errMsg}` });
          }
        }
      }
    }

    return { beatImages, sceneImages };
  }

  /**
   * Run video generation for beats that have images.
   * Uses VideoDirectorAgent to generate animation instructions, then VideoGenerationService
   * to produce animated clips from still images via Veo.
   */
  private async runVideoGeneration(
    sceneContents: SceneContent[],
    imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    brief: FullCreativeBrief,
    worldBible: WorldBible
  ): Promise<{ videoResults: Map<string, string>; diagnostics: VideoGenerationDiagnostic[] }> {
    const videoResults = new Map<string, string>();
    const diagnostics: VideoGenerationDiagnostic[] = [];
    const videoStrategy = this.config.videoGen?.strategy || 'selective';
    this.videoService.clearDiagnostics();

    const beatsToAnimate: Array<{
      sceneId: string;
      beatId: string;
      beatText: string;
      imageKey: string;
      imagePath: string;
      sceneContext: { name: string; genre: string; tone: string; mood: string };
      visualMoment?: string;
      primaryAction?: string;
      emotionalRead?: string;
    }> = [];

    for (const scene of sceneContents) {
      const sceneContext = {
        name: scene.sceneName || scene.sceneId,
        genre: brief.story.genre || 'drama',
        tone: brief.story.tone || 'serious',
        mood: (scene.moodProgression as string[])?.[0] || 'neutral',
      };

      for (const beat of scene.beats || []) {
        const imageKey = this.getEpisodeScopedBeatKey(brief, scene.sceneId, beat.id);
        const imagePath = imageResults.beatImages.get(imageKey);

        if (!imagePath) continue;

        if (videoStrategy === 'selective') {
          const isSelectiveBeat = beat.isChoicePoint || beat.visualMoment
            || beat.shotType === 'action'
            || scene.beats.indexOf(beat) === 0;
          if (!isSelectiveBeat) continue;
        }

        beatsToAnimate.push({
          sceneId: scene.sceneId,
          beatId: beat.id,
          beatText: beat.text,
          imageKey,
          imagePath,
          sceneContext,
          visualMoment: beat.visualMoment,
          primaryAction: beat.primaryAction,
          emotionalRead: beat.emotionalRead,
        });
      }
    }

    if (beatsToAnimate.length === 0) {
      this.emit({ type: 'debug', phase: 'video_generation', message: 'No beats selected for video animation' });
      diagnostics.push({
        timestamp: new Date().toISOString(),
        stage: 'selection',
        status: 'skipped',
        message: 'No beats selected for video animation',
      });
      return { videoResults, diagnostics };
    }

    this.emit({
      type: 'agent_start',
      agent: 'VideoDirector',
      message: `Generating animation directions for ${beatsToAnimate.length} beats...`,
    });

    let completed = 0;
    const total = beatsToAnimate.length;

    for (const beatInfo of beatsToAnimate) {
      await this.checkCancellation();

      try {
        const directionRequest: VideoDirectionRequest = {
          beatId: beatInfo.beatId,
          sceneId: beatInfo.sceneId,
          beatText: beatInfo.beatText,
          imagePrompt: beatInfo.visualMoment || beatInfo.primaryAction || beatInfo.beatText,
          sceneContext: beatInfo.sceneContext,
        };

        const directionResult = await this.videoDirectorAgent.generateVideoDirection(directionRequest);

        if (!directionResult.success || !directionResult.data) {
          console.warn(`[Pipeline] VideoDirector failed for beat ${beatInfo.beatId}: ${directionResult.error}`);
          diagnostics.push({
            timestamp: new Date().toISOString(),
            sceneId: beatInfo.sceneId,
            beatId: beatInfo.beatId,
            imageKey: beatInfo.imageKey,
            identifier: `video-${this.getEpisodeScopedSceneId(brief, beatInfo.sceneId)}-${beatInfo.beatId}`,
            sourceImageUrl: beatInfo.imagePath,
            stage: 'direction',
            status: 'failed',
            message: directionResult.error || 'VideoDirector returned no direction data',
          });
          completed++;
          continue;
        }

        const instruction = directionResult.data;

        const imageData = await this.videoService.readFileAsBase64(beatInfo.imagePath);
        if (!imageData) {
          console.warn(`[Pipeline] Could not read image file for video animation: ${beatInfo.imagePath}`);
          diagnostics.push({
            timestamp: new Date().toISOString(),
            sceneId: beatInfo.sceneId,
            beatId: beatInfo.beatId,
            imageKey: beatInfo.imageKey,
            identifier: `video-${this.getEpisodeScopedSceneId(brief, beatInfo.sceneId)}-${beatInfo.beatId}`,
            sourceImageUrl: beatInfo.imagePath,
            stage: 'image_load',
            status: 'failed',
            message: `Could not read source image for video animation: ${beatInfo.imagePath}`,
          });
          completed++;
          continue;
        }

        const videoIdentifier = `video-${this.getEpisodeScopedSceneId(brief, beatInfo.sceneId)}-${beatInfo.beatId}`;
        const videoResult = await this.videoService.generateVideo(
          instruction,
          imageData.data,
          imageData.mimeType,
          videoIdentifier,
          { sceneId: beatInfo.sceneId, beatId: beatInfo.beatId },
          beatInfo.imagePath,
        );

        if (videoResult.videoUrl || videoResult.videoPath) {
          videoResults.set(beatInfo.imageKey, videoResult.videoUrl || videoResult.videoPath!);
        }

        completed++;
        this.emit({
          type: 'agent_start',
          phase: 'video_generation',
          message: `Video generation: ${completed}/${total} clips`,
          data: { completed, total, currentItem: completed, totalItems: total, subphaseLabel: 'video:clips' },
        });
      } catch (beatVideoError) {
        const msg = beatVideoError instanceof Error ? beatVideoError.message : String(beatVideoError);
        console.warn(`[Pipeline] Video generation failed for beat ${beatInfo.beatId}: ${msg}`);
        diagnostics.push({
          timestamp: new Date().toISOString(),
          sceneId: beatInfo.sceneId,
          beatId: beatInfo.beatId,
          imageKey: beatInfo.imageKey,
          identifier: `video-${this.getEpisodeScopedSceneId(brief, beatInfo.sceneId)}-${beatInfo.beatId}`,
          sourceImageUrl: beatInfo.imagePath,
          stage: 'veo_generation',
          status: 'failed',
          message: msg,
        });
        completed++;
      }
    }

    diagnostics.push(...this.videoService.getDiagnostics().map((diagnostic) => ({
      ...diagnostic,
      imageKey: diagnostic.sceneId && diagnostic.beatId
        ? `${diagnostic.sceneId}::${diagnostic.beatId}`
        : diagnostic.imageKey,
    })));

    console.log(`[Pipeline] Video generation complete: ${videoResults.size}/${total} clips generated`);
    return { videoResults, diagnostics };
  }

  /**
   * Generate a dedicated story cover image — movie-poster style, designed to sell the story.
   *
   * Two-step process informed by movie-poster design best practices:
   *   1. Distill the story into a PosterConcept brief (one core idea, one focal point,
   *      chosen compositional structure, symbolic elements, color strategy, gaze, negative
   *      space, depth cues, figure-ground plan, explicit cliché avoidances).
   *   2. Render the image from the brief, strictly matching the story's ArtStyleProfile
   *      and reserving a lower-band UI safe zone for the tile's title overlay.
   *
   * References: "one idea, one focal point", "symbols not scenes", core compositional
   * structures (triangular, rule-of-thirds, radial symmetry, scale asymmetry, silhouette,
   * grid/triptych, overhead/worm's-eye), deliberate depth cues, bulletproof figure-ground,
   * thumbnail scalability, gaze direction, negative space as composition, color as tool,
   * and cliché avoidance (floating heads, back-to-camera with weapon, default orange/teal,
   * lone figure in front of explosion, disembodied giant eye, stacked cast).
   */
  private async generateStoryCoverArt(
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    worldBible: WorldBible
  ): Promise<string | undefined> {
    if (!this.config.imageGen?.enabled) return undefined;

    try {
      this.emit({ type: 'agent_start', agent: 'ImageService', message: 'Generating story cover art...' });

      const protagonist = characterBible.characters.find(c => c.id === brief.protagonist.id);
      const antagonist = characterBible.characters.find(c =>
        c.role === 'antagonist' && c.importance === 'major'
      );
      const primaryLocation = worldBible.locations[0];

      const protDesc = protagonist
        ? `${protagonist.name}: ${protagonist.physicalDescription || protagonist.briefDescription}`
        : brief.protagonist.description;
      const antagDesc = antagonist
        ? `${antagonist.name}: ${antagonist.physicalDescription || antagonist.briefDescription}`
        : '';

      const artStyleProfile = this.config.imageGen?.artStyleProfile;
      const artStyle = this.imageService.getGeminiSettings().canonicalArtStyle || this.config.artStyle || 'dramatic cinematic story art';

      const artDirectionLines: string[] = [];
      if (artStyleProfile) {
        artDirectionLines.push(`Style name: ${artStyleProfile.name}.`);
        if (artStyleProfile.renderingTechnique) artDirectionLines.push(`Rendering: ${artStyleProfile.renderingTechnique}.`);
        if (artStyleProfile.colorPhilosophy) artDirectionLines.push(`Color: ${artStyleProfile.colorPhilosophy}.`);
        if (artStyleProfile.lightingApproach) artDirectionLines.push(`Lighting: ${artStyleProfile.lightingApproach}.`);
        if (artStyleProfile.lineWeight) artDirectionLines.push(`Line/edge: ${artStyleProfile.lineWeight}.`);
        if (artStyleProfile.compositionStyle) artDirectionLines.push(`Composition language: ${artStyleProfile.compositionStyle}.`);
        if (artStyleProfile.moodRange) artDirectionLines.push(`Mood: ${artStyleProfile.moodRange}.`);
        if (artStyleProfile.positiveVocabulary?.length) {
          artDirectionLines.push(`Style vocabulary: ${artStyleProfile.positiveVocabulary.slice(0, 8).join(', ')}.`);
        }
      } else {
        artDirectionLines.push(`Art style: ${artStyle}.`);
      }
      const artDirection = artDirectionLines.join(' ');

      const profileNegatives = artStyleProfile?.genreNegatives?.length
        ? ', ' + artStyleProfile.genreNegatives.join(', ')
        : '';

      // --- Step 1: Distill the story into a structured PosterConcept ------------------
      // A short, low-temperature LLM call that applies movie-poster design principles and
      // returns a concrete brief we can turn into a rendering prompt. Non-blocking: if the
      // distillation fails, we fall back to a principles-only prompt that still encodes the
      // best practices (just less specifically tuned to this story).
      let concept: PosterConcept | null = null;
      try {
        concept = await this.distillPosterConcept({
          brief,
          protDesc,
          antagDesc,
          primaryLocation: primaryLocation
            ? `${primaryLocation.name} — ${primaryLocation.fullDescription?.substring(0, 200) || primaryLocation.type}`
            : undefined,
          artDirection,
        });
      } catch (conceptErr) {
        const msg = conceptErr instanceof Error ? conceptErr.message : String(conceptErr);
        console.warn(`[Pipeline] Poster concept distillation failed (non-blocking): ${msg}`);
        this.emit({ type: 'warning', phase: 'images', message: `Poster concept distillation failed: ${msg}` });
      }

      // --- Step 2: Build the image prompt from the concept brief ----------------------
      const conceptBlock = concept
        ? this.formatPosterConceptForPrompt(concept)
        : this.fallbackPosterConceptBlock(brief, protDesc, antagDesc, primaryLocation?.name);

      const coverPrompt: ImagePrompt = {
        prompt:
          // Deliverable — what this is and is NOT
          `Produce a single theatrical MOVIE POSTER (one-sheet / streaming key art) for "${brief.story.title}". ` +
          `Genre: ${brief.story.genre}. Tone: ${brief.story.tone}. ` +
          `This is NOT a scene illustration, storyboard frame, character card, or book cover spread. It is iconic key art meant to be understood in half a second. ` +
          // Core idea & composition — the distilled brief
          `${conceptBlock} ` +
          // Design principles (movie-poster best practices, explicit)
          `MOVIE POSTER DESIGN PRINCIPLES (honor all of these): ` +
          `(1) ONE IDEA, ONE FOCAL POINT — a single unmistakable entry point the eye hits first; every other element is clearly subordinate via scale, contrast, position, or isolation. ` +
          `(2) SYMBOLS OVER SCENES — communicate with iconic, metaphorical imagery rather than literal scene illustration. ` +
          `(3) STRONG COMPOSITIONAL STRUCTURE — commit to one of: triangular/pyramidal, rule-of-thirds, radial/centered symmetry, scale asymmetry, silhouette-against-environment, or overhead/worm's-eye; do not hedge between structures. ` +
          `(4) DELIBERATE DEPTH — use overlap, diminishing scale, linear perspective, and atmospheric perspective (distant elements lighter, cooler, less saturated) to create three-dimensional space; avoid flat stacked layers. ` +
          `(5) BULLETPROOF FIGURE-GROUND — the focal subject must separate cleanly from background in value OR color OR edge sharpness; if squinted at, the subject's silhouette still reads. ` +
          `(6) THUMBNAIL SCALABLE — the silhouette of the hero element must still read when shrunk to tile size; no crucial detail depends on high resolution. ` +
          `(7) GAZE IS DELIBERATE — direct address, off-frame, or internal-loop; never accidental. ` +
          `(8) NEGATIVE SPACE IS COMPOSITION — empty areas are intentional and meaningful; resist the urge to fill every corner. ` +
          `(9) COLOR AS COMPOSITIONAL TOOL — prefer a limited, deliberate palette (2–3 dominant colors); a saturated accent in an otherwise desaturated image creates an automatic focal point; warm advances, cool recedes. ` +
          // Art direction — match the story's established look
          `ART DIRECTION (match the story's established visual language exactly): ${artDirection} ` +
          `Apply this art direction to every pixel — rendering technique, palette, lighting, and edge treatment must be instantly recognizable as belonging to this story. Do NOT default to generic photoreal cinematic — obey the style DNA above. ` +
          // Layout / tile safe zones
          `LAYOUT: PORTRAIT 2:3 aspect ratio (taller than wide). Vertical rhythm — upper third: atmospheric world / antagonist presence / symbolic element; middle third: focal subject at peak clarity; lower ~25%: quiet, darker, low-detail atmospheric foreground (smoke, mist, rain, shallow water, shadow, gradient) reserved as a UI-overlay SAFE ZONE. No critical visual detail in the bottom 25%. Generous negative space top and bottom. ` +
          // Cliché avoidance (explicit)
          `CLICHÉS TO AVOID (these signal lazy design — do NOT use unless the concept genuinely demands them): floating-heads lineup of actor faces; hero from behind looking over shoulder with a weapon; default orange-and-teal complementary color grade; lone figure standing in front of an explosion or apocalyptic skyline; disembodied giant eye; stacked/lineup ensemble cast portraits. ` +
          // Anti-text, anti-logo, anti-panel (hard rules)
          `ABSOLUTELY NO text, typography, title treatment, subtitle, tagline, credits block, watermark, signature, logo, or brand mark anywhere in the image. NO in-world readable signage, billboards, kanji, runes, badges with legible letters, or tattoos with letters. ` +
          `Single unified frame only — no diptych, no triptych, no panels, no film strip, no collage, no side bars, no letterbox bars, no picture-in-picture.`,
        negativePrompt:
          // Text & marks
          'text, words, letters, title, typography, tagline, credits, logo, watermark, caption, subtitle, signature, ' +
          'readable signage, billboards with text, kanji letters, runes with letters, tattoos with text, ' +
          // Layout violations
          'multiple panels, comic layout, storyboard, collage, split image, diptych, triptych, ' +
          'letterbox bars, black bars, side panels, picture-in-picture, image-within-image, ' +
          'landscape format, wide aspect, square aspect, ' +
          // Compositional failures
          'cluttered, busy, competing focal points, two equal subjects, dead center with no hierarchy, flat layers, ' +
          'low contrast subject against background, subject lost in background, ' +
          // Clichés to resist
          'floating heads, actor headshot grid, cast lineup, back-to-camera with weapon, ' +
          'default orange and teal, explosion behind hero, disembodied giant eye, ' +
          // Generic failures
          'boring, static, flat lighting, passport photo, mugshot, neutral pose' +
          profileNegatives,
        aspectRatio: '2:3',
        composition:
          `Vertical 2:3 movie-poster one-sheet. ${concept?.compositionalStructure ? `Compositional structure: ${concept.compositionalStructure}. ` : ''}` +
          'Single clear focal point; subordinate elements only. ' +
          'Deliberate depth via overlap / linear perspective / atmospheric perspective. ' +
          'Bottom ~25% reserved as quiet low-detail UI-overlay safe zone. ' +
          'Zero typography anywhere.',
      };

      const gemSettings = this.imageService.getGeminiSettings();
      const maxPerChar = gemSettings.maxRefImagesPerCharacter || 2;

      const referenceImages: Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string }> = [];

      // Helper: canonicalize role from ref.name (e.g. "Aoi-face" → "character-reference-face")
      const roleFor = (refName: string): { role: string; viewType: string } => {
        const viewType = refName.split('-').pop() || 'front';
        if (viewType === 'face') return { role: 'character-reference-face', viewType };
        return { role: 'character-reference', viewType };
      };

      // Protagonist references — individual views (authoritative identity signal)
      const protRefs = this.imageAgentTeam.getCharacterReferenceImages(
        brief.protagonist.id, false, maxPerChar, 'front', true
      );
      for (const ref of protRefs) {
        const { role, viewType } = roleFor(ref.name);
        referenceImages.push({
          data: ref.data, mimeType: ref.mimeType,
          role,
          characterName: brief.protagonist.name,
          viewType,
        });
      }
      // Composite sheet as a separate artifact — routed per-provider downstream.
      const protComposite = this.imageAgentTeam.getCompositeReferenceImage(brief.protagonist.id);
      if (protComposite) {
        referenceImages.push({
          data: protComposite.data, mimeType: protComposite.mimeType,
          role: 'composite-sheet',
          characterName: brief.protagonist.name,
          viewType: 'composite',
        });
      }

      // Antagonist references (if available, limited)
      if (antagonist) {
        const antagRefs = this.imageAgentTeam.getCharacterReferenceImages(
          antagonist.id, false, 2, 'front', true
        );
        for (const ref of antagRefs) {
          const { role, viewType } = roleFor(ref.name);
          referenceImages.push({
            data: ref.data, mimeType: ref.mimeType,
            role,
            characterName: antagonist.name,
            viewType,
          });
        }
        const antagComposite = this.imageAgentTeam.getCompositeReferenceImage(antagonist.id);
        if (antagComposite) {
          referenceImages.push({
            data: antagComposite.data, mimeType: antagComposite.mimeType,
            role: 'composite-sheet',
            characterName: antagonist.name,
            viewType: 'composite',
          });
        }
      }

      const result = await withTimeout(
        this.imageService.generateImage(
          coverPrompt,
          'story-cover',
          { type: 'cover' as const, characters: [brief.protagonist.id] },
          referenceImages.length > 0 ? referenceImages : undefined
        ),
        PIPELINE_TIMEOUTS.storyboard,
        'StoryCoverArt'
      );

      if (result.imageUrl) {
        this.emit({
          type: 'agent_complete', agent: 'ImageService',
          message: `Story cover art generated: ${result.imageUrl}`,
        });
        return result.imageUrl;
      }

      console.warn('[Pipeline] Cover art generation returned no imageUrl');
      return undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Pipeline] Cover art generation failed (non-blocking): ${errMsg}`);
      this.emit({ type: 'warning', phase: 'images', message: `Cover art generation failed: ${errMsg}` });
      return undefined;
    }
  }

  /**
   * Distill a story into a structured PosterConcept brief, applying movie-poster design
   * principles (one idea / one focal point, symbols over scenes, a chosen compositional
   * structure, deliberate depth cues, bulletproof figure-ground, explicit cliché avoidance).
   *
   * Low-temperature short LLM call; returns null if the response can't be parsed into the
   * expected shape — callers should fall back to the principles-only prompt block.
   */
  private async distillPosterConcept(input: {
    brief: FullCreativeBrief;
    protDesc: string;
    antagDesc: string;
    primaryLocation?: string;
    artDirection: string;
  }): Promise<PosterConcept | null> {
    const { brief, protDesc, antagDesc, primaryLocation, artDirection } = input;

    const { BaseAgent } = await import('../agents/BaseAgent');
    class PosterConceptDistiller extends BaseAgent {
      constructor(config: any) { super('PosterConceptDistiller', config); }
      protected getAgentSpecificPrompt(): string { return ''; }
      async execute(_input: any): Promise<any> { throw new Error('Use callLLM directly'); }
    }

    const distiller = new PosterConceptDistiller({
      ...this.config.agents.storyArchitect,
      maxTokens: 1200,
      temperature: 0.6,
    });

    const systemPrompt = `You are a senior movie-poster / key-art designer. You distill a story into a SINGLE iconic visual concept that can be rendered as a 2:3 portrait theatrical one-sheet.

You apply these principles without exception:
- ONE IDEA, ONE FOCAL POINT. A single unmistakable entry point the eye hits first; every other element clearly subordinate through scale, contrast, position, or isolation. If two elements compete equally, demote one.
- SYMBOLS OVER SCENES. The best key art is iconic and metaphorical (a red balloon in a storm drain; a fedora and a whip; a lone silhouette against a horizon). NOT a literal illustration of a scene from the story.
- COMMIT TO ONE COMPOSITIONAL STRUCTURE. Choose ONE of: "triangular", "rule-of-thirds", "radial-symmetry", "scale-asymmetry", "silhouette-against-environment", "overhead", "worms-eye". Justify briefly.
- DELIBERATE DEPTH. Specify how overlap, linear perspective, and atmospheric perspective (distant elements lighter/cooler/less saturated) create three-dimensional space.
- BULLETPROOF FIGURE-GROUND. Specify how the focal subject separates from the background in value, color, or edge sharpness; it must still read when squinted at.
- THUMBNAIL SCALABLE. The focal silhouette must still read at tile size.
- GAZE IS DELIBERATE. "direct" (staring out = confrontation/intimacy), "off-frame" (implies threat/goal), or "internal-loop" (closed relationship with another figure).
- NEGATIVE SPACE IS COMPOSITION. Empty space is intentional and carries meaning; do not fill every corner.
- COLOR AS COMPOSITIONAL TOOL. Prefer a limited palette (2–3 dominant colors); a saturated accent in an otherwise desaturated frame creates an automatic focal point; warm advances, cool recedes.

CLICHÉS TO AVOID unless the concept genuinely demands them:
- floating heads / actor-headshot lineup
- hero from behind looking over shoulder with a weapon
- default orange-and-teal complementary color grade
- lone figure standing in front of an explosion or apocalyptic skyline
- disembodied giant eye
- stacked / lineup full-cast portraits

The cover must RESPECT the story's established art direction (rendering technique, color philosophy, lighting, line treatment, mood). Never override the art direction with generic cinematic photoreal.

Return STRICT JSON with EXACTLY these fields, no markdown, no commentary:
{
  "coreIdea": "One sentence describing the single emotional promise of the poster — the 'half-a-second glance' feeling a viewer should walk away with.",
  "visualMetaphor": "A concrete iconic image / metaphor that encodes the coreIdea. Describe it as a symbol, not a scene (e.g. 'a wilted wedding bouquet cradled in a god's giant marble hand' rather than 'the bride at the altar').",
  "focalSubject": "The ONE thing the eye hits first — describe it concretely (subject, pose, scale, placement).",
  "compositionalStructure": "triangular | rule-of-thirds | radial-symmetry | scale-asymmetry | silhouette-against-environment | overhead | worms-eye",
  "structureRationale": "One sentence on why this structure fits this story.",
  "supportingElements": ["Up to 3 clearly subordinate elements — each one-line. Nothing else.", "..."],
  "colorStrategy": "The deliberate limited palette (2–3 dominant colors) AND any saturated accent that serves as an automatic focal point. Specify warm-vs-cool placement for depth.",
  "gazeDirection": "direct | off-frame | internal-loop | none (if focal subject is not a person)",
  "gazeRationale": "One sentence on what the gaze implies.",
  "negativeSpaceStrategy": "Where the intentional empty / quiet space lives and what it communicates (isolation, scale of threat, etc).",
  "depthStrategy": "How overlap, linear perspective, and atmospheric perspective create three-dimensional space.",
  "figureGroundStrategy": "How the focal subject separates from the background — which of value / color / edge sharpness carries the separation.",
  "clichesAvoided": ["From the cliché list, call out which are specifically at risk for this genre and MUST be avoided (e.g. 'no orange-teal grade', 'no floating heads')."],
  "thumbnailTest": "One sentence confirming what the silhouette reads as at tile size."
}`;

    const userPrompt = `STORY
Title: ${brief.story.title}
Genre: ${brief.story.genre}
Tone: ${brief.story.tone}
Themes: ${brief.story.themes.join(', ')}
Synopsis: ${brief.story.synopsis.substring(0, 800)}

PROTAGONIST
${protDesc}

${antagDesc ? `ANTAGONIST\n${antagDesc}\n\n` : ''}${primaryLocation ? `PRIMARY LOCATION / WORLD\n${primaryLocation}\n\n` : ''}ART DIRECTION (the cover MUST match this visual language — do NOT default to generic photoreal)
${artDirection}

Design the key art. Return STRICT JSON matching the schema.`;

    const response = await (distiller as any).callLLM([
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ]);

    // Extract JSON object from the response
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[Pipeline] PosterConceptDistiller: no JSON object in response');
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      console.warn(`[Pipeline] PosterConceptDistiller: JSON parse failed — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    // Minimal validation — must have core idea and a focal subject or we can't proceed.
    if (!parsed.coreIdea || !parsed.focalSubject) {
      console.warn('[Pipeline] PosterConceptDistiller: missing coreIdea or focalSubject');
      return null;
    }

    const concept: PosterConcept = {
      coreIdea: String(parsed.coreIdea),
      visualMetaphor: String(parsed.visualMetaphor || parsed.focalSubject),
      focalSubject: String(parsed.focalSubject),
      compositionalStructure: normalizeCompositionalStructure(parsed.compositionalStructure),
      structureRationale: String(parsed.structureRationale || ''),
      supportingElements: Array.isArray(parsed.supportingElements)
        ? parsed.supportingElements.slice(0, 3).map((e: any) => String(e))
        : [],
      colorStrategy: String(parsed.colorStrategy || ''),
      gazeDirection: String(parsed.gazeDirection || 'none'),
      gazeRationale: String(parsed.gazeRationale || ''),
      negativeSpaceStrategy: String(parsed.negativeSpaceStrategy || ''),
      depthStrategy: String(parsed.depthStrategy || ''),
      figureGroundStrategy: String(parsed.figureGroundStrategy || ''),
      clichesAvoided: Array.isArray(parsed.clichesAvoided)
        ? parsed.clichesAvoided.slice(0, 6).map((e: any) => String(e))
        : [],
      thumbnailTest: String(parsed.thumbnailTest || ''),
    };

    this.emit({
      type: 'debug',
      phase: 'images',
      message: `Poster concept distilled: ${concept.coreIdea.substring(0, 140)}`,
    });

    return concept;
  }

  /**
   * Turn a distilled PosterConcept into a dense natural-language block that the image
   * model can act on directly. Each sentence maps to a design principle.
   */
  private formatPosterConceptForPrompt(c: PosterConcept): string {
    const parts: string[] = [];
    parts.push(`CORE IDEA (the half-a-second glance feeling): ${c.coreIdea}`);
    parts.push(`VISUAL METAPHOR (iconic, symbolic — NOT a literal scene): ${c.visualMetaphor}`);
    parts.push(`FOCAL SUBJECT (the ONE thing the eye hits first; every other element subordinate): ${c.focalSubject}`);
    parts.push(`COMPOSITIONAL STRUCTURE: ${c.compositionalStructure}${c.structureRationale ? ` — ${c.structureRationale}` : ''}.`);
    if (c.supportingElements.length) {
      parts.push(`Supporting elements (clearly subordinate, max 3): ${c.supportingElements.join(' | ')}.`);
    }
    if (c.colorStrategy) parts.push(`COLOR STRATEGY: ${c.colorStrategy}`);
    if (c.gazeDirection && c.gazeDirection !== 'none') {
      parts.push(`GAZE: ${c.gazeDirection}${c.gazeRationale ? ` — ${c.gazeRationale}` : ''}.`);
    }
    if (c.negativeSpaceStrategy) parts.push(`NEGATIVE SPACE: ${c.negativeSpaceStrategy}`);
    if (c.depthStrategy) parts.push(`DEPTH: ${c.depthStrategy}`);
    if (c.figureGroundStrategy) parts.push(`FIGURE-GROUND: ${c.figureGroundStrategy}`);
    if (c.clichesAvoided.length) {
      parts.push(`EXPLICITLY AVOID these clichés (they are at-risk for this genre): ${c.clichesAvoided.join('; ')}.`);
    }
    if (c.thumbnailTest) parts.push(`THUMBNAIL TEST: ${c.thumbnailTest}`);
    return parts.join(' ');
  }

  /**
   * Fallback concept block when LLM distillation is unavailable. Keeps the design
   * principles explicit and protagonist/antagonist roles clear, but without the
   * story-specific metaphor.
   */
  private fallbackPosterConceptBlock(
    brief: FullCreativeBrief,
    protDesc: string,
    antagDesc: string,
    locationName?: string
  ): string {
    const parts: string[] = [];
    parts.push(`CORE IDEA: Distill "${brief.story.title}" (${brief.story.genre}, ${brief.story.tone}) into a SINGLE iconic visual metaphor — the emotional promise a viewer walks away with in half a second.`);
    parts.push(`FOCAL SUBJECT: ${protDesc} staged as the one unmistakable entry point the eye hits first; every other element is clearly subordinate.`);
    if (antagDesc) {
      parts.push(`Antagonist presence as a looming, shadowed, reflected, or scale-asymmetric counterweight (never a second equal hero): ${antagDesc}.`);
    }
    if (locationName) {
      parts.push(`World atmosphere: ${locationName} — expressed symbolically, not as a literal scene.`);
    }
    parts.push(`Themes expressed symbolically through the chosen metaphor: ${brief.story.themes.join(', ')}.`);
    parts.push(`COMPOSITIONAL STRUCTURE: pick ONE clean structure (triangular, rule-of-thirds, radial-symmetry, scale-asymmetry, silhouette-against-environment, overhead, or worm's-eye) and commit fully.`);
    return parts.join(' ');
  }

  /**
   * Generate images for encounter beats and outcomes
   * Creates setup images and outcome-specific images (success/complicated/failure) for each choice
   */
  private async generateEncounterImages(
    encounters: Map<string, EncounterStructure>,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    outputDirectory?: string
  ): Promise<{
    encounterImages: Map<string, {
      setupImages: Map<string, string>;  // beatId -> URL
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;  // choiceId -> URLs
    }>;
    storyletImages: Map<string, Map<string, Map<string, string>>>;
    storyletFailures: string[];
  }> {
    const encounterImages = new Map<string, {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    }>();

    const emptyStoryletImages = new Map<string, Map<string, Map<string, string>>>();
    const storyletFailures: string[] = [];

    if (!this.config.imageGen?.enabled) {
      console.log('[Pipeline] Encounter image generation skipped: imageGen not enabled');
      this.emit({ type: 'debug', phase: 'encounter_images', message: 'Encounter image generation skipped: imageGen not enabled' });
      return { encounterImages, storyletImages: emptyStoryletImages, storyletFailures };
    }
    if (encounters.size === 0) {
      console.log('[Pipeline] Encounter image generation skipped: no encounters found');
      this.emit({ type: 'debug', phase: 'encounter_images', message: 'Encounter image generation skipped: no encounters in this episode' });
      return { encounterImages, storyletImages: emptyStoryletImages, storyletFailures };
    }

    this.emit({ type: 'phase_start', phase: 'encounter_images', message: `Generating images for ${encounters.size} encounters` });

    let globalEncounterImageIndex = 0;
    let totalEncounterImages = 0;

    const encounterManifestShots: { identifier: string; beatId?: string; sceneId: string; description: string }[] = [];
    for (const [sid, enc] of encounters) {
      const scopedSid = this.getEpisodeScopedSceneId(brief, sid);
      const m = buildEncounterSlotManifest(enc, sid, scopedSid, ENCOUNTER_TREE_MAX_DEPTH);
      totalEncounterImages += m.slots.length;
      if (m.truncatedPaths.length > 0) {
        console.warn(
          `[Pipeline] Encounter ${sid}: ${m.truncatedPaths.length} subtree(s) truncated at max depth ${ENCOUNTER_TREE_MAX_DEPTH} (paths: ${m.truncatedPaths.slice(0, 8).join('; ')})`
        );
      }
      for (const s of m.slots) {
        encounterManifestShots.push({
          identifier: s.baseIdentifier,
          beatId: s.beatId,
          sceneId: sid,
          description: `${s.kind}${s.tier ? `:${s.tier}` : ''}`,
        });
      }
      const storyletManifest = buildStoryletSlotManifest(enc.storylets, sid, scopedSid);
      totalEncounterImages += storyletManifest.slots.length;
      for (const s of storyletManifest.slots) {
        encounterManifestShots.push({
          identifier: s.baseIdentifier,
          beatId: s.beatId,
          sceneId: sid,
          description: `storylet:${s.outcomeName}`,
        });
      }
    }
    this.emit({
      type: 'checkpoint', phase: 'image_manifest',
      message: `Encounter image manifest: ${encounterManifestShots.length} planned shots`,
      data: { manifestType: 'encounter', shots: encounterManifestShots },
    });
    const persistEncounterRunState = async (
      sceneId: string,
      phase: string,
      setupImages: Map<string, string>,
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>,
      failedImages: string[],
      imagesGenerated: number,
      imagesAttempted: number,
      completedBaseIdentifiers?: string[],
      missingManifestKeys?: string[],
    ): Promise<void> => {
      if (!outputDirectory) return;
      const textFixResolutions = this.imageService
        .getEncounterDiagnostics()
        .filter((entry) => entry.baseIdentifier && entry.resolvedIdentifier && entry.baseIdentifier !== entry.resolvedIdentifier)
        .slice(-50)
        .map((entry) => ({
          baseIdentifier: entry.baseIdentifier,
          resolvedIdentifier: entry.resolvedIdentifier,
          status: entry.status,
        }));
      await saveEarlyDiagnostic(outputDirectory, `08a-encounter-run-state-${idSlugify(sceneId)}.json`, {
        generatedAt: new Date().toISOString(),
        sceneId,
        phase,
        imagesGenerated,
        imagesAttempted,
        setupImageKeys: Array.from(setupImages.keys()),
        outcomeImageKeys: Array.from(outcomeImages.keys()),
        failedImages: failedImages.slice(-50),
        completedBaseIdentifiers: completedBaseIdentifiers?.slice(-200),
        missingManifestKeys: missingManifestKeys?.slice(0, 100),
        textFixResolutions,
      });
    };

    for (const [sceneId, encounter] of encounters) {
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);
      const setupImages = new Map<string, string>();
      const outcomeImages = new Map<string, { success?: string; complicated?: string; failure?: string }>();

      const slotManifest = buildEncounterSlotManifest(encounter, sceneId, scopedSceneId, ENCOUNTER_TREE_MAX_DEPTH);
      if (slotManifest.truncatedPaths.length > 0) {
        console.warn(
          `[Pipeline] Encounter ${sceneId}: ${slotManifest.truncatedPaths.length} subtree(s) not expanded beyond depth ${ENCOUNTER_TREE_MAX_DEPTH}`
        );
      }

      const encounterPolicy = new EncounterProviderPolicy(this.imageService, {
        maxConsecutiveFailuresBeforeAbort: this.config.imageGen?.encounterMaxConsecutiveFailuresBeforeAbort ?? 0,
      });

      const resumeLoaded = outputDirectory ? loadEncounterResumeStateSync(outputDirectory, idSlugify(sceneId)) : null;
      const resumeSet = new Set<string>(resumeLoaded?.completedBaseIdentifiers ?? []);
      const persistResume = async (): Promise<void> => {
        if (!outputDirectory) return;
        await saveEncounterResumeState(outputDirectory, idSlugify(sceneId), {
          version: 1,
          sceneId,
          scopedSceneId,
          completedBaseIdentifiers: [...resumeSet],
          generatedAt: new Date().toISOString(),
        });
      };
      const markResumeDone = async (baseId: string): Promise<void> => {
        if (!resumeSet.has(baseId)) {
          resumeSet.add(baseId);
          await persistResume();
        }
      };

      const onEncounterSlotFailure = async (err: unknown): Promise<void> => {
        encounterPolicy.onSlotFailure(err);
        const d = encounterPolicy.getBackoffDelayMs();
        if (d > 0) await new Promise(r => setTimeout(r, d));
        if (encounterPolicy.shouldAbortHard()) {
          throw new PipelineError(
            `Encounter image generation aborted after repeated failures for ${sceneId}`,
            'encounter_images',
            {
              agent: 'EncounterImageAgent',
              context: { sceneId, encounterId: encounter.id || `${sceneId}-encounter`, failureKind: 'encounter_consecutive_failures' },
            },
          );
        }
      };

      this.emit({ type: 'agent_start', agent: 'EncounterImageAgent', message: `Generating images for encounter in ${sceneId}` });

      let imagesGenerated = 0;
      let imagesAttempted = 0;
      const failedImages: string[] = [];

      try {
      // Gather character references and physical descriptions for this encounter
      const encounterCharacterIds = encounter.npcStates?.map(npc => npc.npcId) || [];
      encounterCharacterIds.push(brief.protagonist.id);
      const referenceImages = this.gatherCharacterReferenceImages(
        encounterCharacterIds,
        characterBible,
        undefined,
        {
          includeExpressions: this.shouldUseExpressionReferencesForEncounter(encounter),
          family: 'encounter-setup',
          slotId: `encounter:${scopedSceneId}`,
        }
      );
      const encounterCharacterDescriptions = this.buildCharacterDescriptions(encounterCharacterIds, characterBible);
      const encounterCharacterNames = encounterCharacterIds
        .map(id => characterBible.characters.find(c => c.id === id)?.name)
        .filter(Boolean) as string[];

      // Use sceneId as encounterId since EncounterStructure.id is optional
      const encounterId = encounter.id || `${sceneId}-encounter`;
      const encounterBeats = getEncounterBeats(encounter);
      const encFirstBeat = encounter.beats?.[0];
      const encounterSettingContext = resolveSceneSettingContext({
        sceneName: sceneId,
        sceneDescription: encFirstBeat?.setupText || encFirstBeat?.description,
        authoredLocationId: undefined,
        authoredLocationName: undefined,
        authoredLocationType: undefined,
        worldPremise: brief.world.premise,
        worldTimePeriod: brief.world.timePeriod,
        worldTechnologyLevel: brief.world.technologyLevel,
        worldMagicSystem: brief.world.magicSystem,
      });
      console.log(`[Pipeline] Encounter ${encounterId}: ${encounterBeats.length} beats, ${encounter.npcStates?.length || 0} NPCs, ${referenceImages.length} reference images`);
      
      // Generate images for each beat (skip if beats is empty/undefined)
      for (const beat of encounterBeats) {
        await this.checkCancellation();
        // Generate setup image — use cinematicSetup if available, otherwise create from setupText or fallback
        // Build characterStates from encounter participants for fallback cinematic descriptions
        const fallbackCharacterStates = [
          { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
          ...(encounter.npcStates || []).map(npc => ({
            characterId: npc.npcId || npc.name || 'npc',
            pose: 'facing protagonist',
            expression: npc.initialDisposition || 'neutral',
            position: 'opposite side',
          })),
        ];

        // Ensure we have SOME text for the scene description
        const setupDescription = this.resolvePlayerTemplates(
          this.normalizeNarrativeText(
            beat.setupText ?? beat.description,
            `${beat.name} - ${encounter.encounterType} encounter in ${sceneId}`
          ),
          brief
        );

        const cinematicSetup = beat.cinematicSetup || (setupDescription ? {
          sceneDescription: this.makeEncounterVisualSceneDescription(setupDescription),
          focusSubject: 'protagonist',
          secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
          cameraAngle: this.inferEncounterCameraAngle(setupDescription, 'setup'),
          shotType: 'tension_hold' as const,
          mood: this.inferEncounterMood(setupDescription, 'setup'),
          lightingDirection: 'dramatic side lighting',
          colorPalette: 'contextual to genre',
          characterStates: fallbackCharacterStates,
        } : null);
        
        if (cinematicSetup) {
          const setupVisualContract = beat.visualContract || this.buildEncounterVisualContract(setupDescription, 'setup');
          const setupPrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId: beat.id,
            cinematicDescription: cinematicSetup,
            encounterPhase: 'setup',
            visualContract: setupVisualContract,
            genre: brief.story.genre,
            artStyle: this.config.artStyle,
            settingContext: encounterSettingContext,
          });

          console.log(`[Pipeline] Generating encounter setup image for beat ${beat.id} in ${sceneId}`);
          imagesAttempted++;
          const setupBaseId = encounterSetupIdentifier(scopedSceneId, beat.id);
          try {
            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              setupPrompt,
              setupBaseId,
              { sceneId: scopedSceneId, beatId: beat.id, type: 'encounter-setup', characters: encounterCharacterIds, characterNames: encounterCharacterNames, characterDescriptions: encounterCharacterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `setup:${beat.id}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: setupBaseId,
                resumeAlternateBaseIdentifiers: [encounterSetupFallbackIdentifier(scopedSceneId, beat.id)],
              },
            );
            const result = generated.result;

            if (result.imageUrl) {
              if (generated.artifactStatus !== 'accepted_clean') {
                console.warn(
                  `[Pipeline] Encounter setup image for beat ${beat.id} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
                );
              }
              setupImages.set(beat.id, result.imageUrl);
              imagesGenerated++;
              globalEncounterImageIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(setupBaseId);
              this.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: `encounter-setup-${scopedSceneId}-${beat.id}` },
              });
              if (result.imageData && result.mimeType) {
                this.imageService.setGeminiPreviousScene(result.imageData, result.mimeType);
              }
            } else {
              console.warn(`[Pipeline] Encounter setup image for beat ${beat.id} returned no URL`);
              failedImages.push(`setup:${beat.id}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (setupErr) {
            const msg = setupErr instanceof Error ? setupErr.message : String(setupErr);
            console.error(`[Pipeline] Encounter setup image FAILED for beat ${beat.id} in ${sceneId}: ${msg}`);
            failedImages.push(`setup:${beat.id}:${msg}`);
            if (setupErr instanceof PipelineError) throw setupErr;
            await onEncounterSlotFailure(setupErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        } else {
          // NEVER skip: always generate with a minimal fallback description
          console.warn(`[Pipeline] No cinematicSetup or setupText for beat ${beat.id} — generating with minimal fallback`);
          const minimalDescription = `${encounter.encounterType || 'dramatic'} encounter scene - ${brief.protagonist.name} in ${sceneId}`;
          const minimalPrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId: beat.id,
            cinematicDescription: {
              sceneDescription: minimalDescription,
              focusSubject: 'protagonist',
              secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
              cameraAngle: 'medium shot' as const,
              shotType: 'tension_hold' as const,
              mood: 'tense_uncertainty' as const,
              lightingDirection: 'dramatic side lighting',
              colorPalette: 'contextual to genre',
              characterStates: fallbackCharacterStates,
            },
            encounterPhase: 'setup',
            genre: brief.story.genre,
            artStyle: this.config.artStyle,
            settingContext: encounterSettingContext,
          });
          imagesAttempted++;
          const setupBaseId = encounterSetupIdentifier(scopedSceneId, beat.id);
          const setupFbId = encounterSetupFallbackIdentifier(scopedSceneId, beat.id);
          try {
            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              minimalPrompt,
              setupFbId,
              { sceneId: scopedSceneId, beatId: beat.id, type: 'encounter-setup', characters: encounterCharacterIds, characterNames: encounterCharacterNames, characterDescriptions: encounterCharacterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `setup-fallback:${beat.id}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: setupBaseId,
                resumeAlternateBaseIdentifiers: [setupFbId],
              },
            );
            const result = generated.result;
            if (result.imageUrl) {
              if (generated.artifactStatus !== 'accepted_clean') {
                console.warn(
                  `[Pipeline] Encounter fallback setup image for beat ${beat.id} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
                );
              }
              setupImages.set(beat.id, result.imageUrl);
              imagesGenerated++;
              globalEncounterImageIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(setupBaseId);
              this.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: `encounter-setup-fallback-${scopedSceneId}-${beat.id}` },
              });
            } else {
              failedImages.push(`setup-fallback:${beat.id}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (fallbackErr) {
            const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            console.error(`[Pipeline] Fallback setup image FAILED for beat ${beat.id}: ${msg}`);
            failedImages.push(`setup-fallback:${beat.id}:${msg}`);
            if (fallbackErr instanceof PipelineError) throw fallbackErr;
            await onEncounterSlotFailure(fallbackErr);
          }
          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }

        // Generate outcome images for each choice (including recursive nextSituation trees)
        const treeCounters = { imagesGenerated, imagesAttempted, globalIndex: globalEncounterImageIndex, total: totalEncounterImages };
        await this.generateEncounterTreeImages(
          beat.choices || [],
          '',
          sceneId,
          encounterId,
          beat.id,
          {
            referenceImages,
            characterIds: encounterCharacterIds,
            characterNames: encounterCharacterNames,
            characterDescriptions: encounterCharacterDescriptions,
            brief,
            encounter,
            settingContext: encounterSettingContext,
          },
          { setupImages, outcomeImages },
          treeCounters,
          failedImages,
          encounterPolicy,
          resumeSet,
          markResumeDone,
          onEncounterSlotFailure,
        );
        imagesGenerated = treeCounters.imagesGenerated;
        imagesAttempted = treeCounters.imagesAttempted;
        globalEncounterImageIndex = treeCounters.globalIndex;
        await persistEncounterRunState(
          sceneId,
          `beat:${beat.id}`,
          setupImages,
          outcomeImages,
          failedImages,
          imagesGenerated,
          imagesAttempted,
          [...resumeSet],
          collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages),
        );
      }

      // === ENCOUNTER IMAGE RETRY PASS ===
      // Retries run whenever required manifest slots remain unresolved, even if failedImages bookkeeping missed them.
      const preRetryMissing = collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages);
      if (preRetryMissing.length > 0) {
        console.log(`[Pipeline] Starting retry pass for ${preRetryMissing.length} unresolved encounter slots in ${sceneId}...`);
        this.emit({ type: 'checkpoint', phase: 'encounter_images', message: `Retrying ${preRetryMissing.length} unresolved encounter slots for ${sceneId}` });

        const retryCounters = { imagesGenerated, imagesAttempted, globalIndex: globalEncounterImageIndex, total: totalEncounterImages };
        let totalRetried = 0;
        let totalRecovered = 0;

        for (const beat of encounterBeats) {
          if (!beat.choices?.length) continue;
          const retryResult = await this.retryMissingEncounterTreeImages(
            beat.choices,
            '',
            sceneId,
            encounterId,
            beat.id,
            {
              referenceImages,
              characterIds: encounterCharacterIds,
              characterNames: encounterCharacterNames,
              characterDescriptions: encounterCharacterDescriptions,
              brief,
              encounter,
              settingContext: encounterSettingContext,
            },
            { setupImages, outcomeImages },
            retryCounters,
            encounterPolicy,
            resumeSet,
            markResumeDone,
            onEncounterSlotFailure,
          );
          totalRetried += retryResult.retried;
          totalRecovered += retryResult.recovered;
        }

        imagesGenerated = retryCounters.imagesGenerated;
        imagesAttempted = retryCounters.imagesAttempted;
        globalEncounterImageIndex = retryCounters.globalIndex;

        if (totalRetried > 0) {
          console.log(`[Pipeline] Retry pass for ${sceneId}: ${totalRecovered}/${totalRetried} recovered`);
        }
        await persistEncounterRunState(
          sceneId,
          'post-retry',
          setupImages,
          outcomeImages,
          failedImages,
          imagesGenerated,
          imagesAttempted,
          [...resumeSet],
          collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages),
        );
      }

      // === ENCOUNTER IMAGE COMPLETENESS CHECK (non-fatal) ===
      // Log missing slots and continue — they are persisted in the run-state
      // file and AssetRegistry for later retry. Storylet generation proceeds
      // regardless so a single missing encounter outcome never kills the pipeline.
      const postRetryMissing = collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages);
      if (postRetryMissing.length > 0) {
        const missingSummary = postRetryMissing.slice(0, 20).join(', ');
        const fullMsg = `Encounter ${sceneId}: ${postRetryMissing.length} encounter images still missing after retries (continuing): ${missingSummary}`;
        console.warn(`[Pipeline] ENCOUNTER IMAGE GAP (non-fatal): ${fullMsg}`);
        this.emit({ type: 'warning', phase: 'encounter_images', message: fullMsg });
      }

      encounterImages.set(sceneId, { setupImages, outcomeImages });
      await persistEncounterRunState(
        sceneId,
        'complete',
        setupImages,
        outcomeImages,
        failedImages,
        imagesGenerated,
        imagesAttempted,
        [...resumeSet],
        postRetryMissing,
      );

      const successRate = imagesAttempted > 0 ? `${imagesGenerated}/${imagesAttempted}` : '0/0';
      console.log(`[Pipeline] Encounter images for ${sceneId}: ${successRate} succeeded (${setupImages.size} setup, ${outcomeImages.size} outcome sets)`);

      this.emit({
        type: 'agent_complete',
        agent: 'EncounterImageAgent',
        message: `Generated ${imagesGenerated}/${imagesAttempted} images for encounter in ${sceneId}`,
      });
      } catch (encErr) {
        if (this.isLlmQuotaFailure(encErr)) throw encErr;
        if (encErr instanceof PipelineError) throw encErr;
        const encErrMsg = encErr instanceof Error ? encErr.message : String(encErr);
        const stack = encErr instanceof Error ? encErr.stack : '';
        console.error(`[Pipeline] Encounter image generation CRASHED for ${sceneId}: ${encErrMsg}`);
        console.error(`[Pipeline] Stack: ${stack}`);
        console.error(`[Pipeline] Progress before crash: ${imagesGenerated} generated, ${imagesAttempted} attempted, failures: [${failedImages.join(', ')}]`);
        throw new PipelineError(
          `Encounter image generation crashed for ${sceneId}: ${encErrMsg}`,
          'encounter_images',
          {
            agent: 'EncounterImageAgent',
            context: { sceneId, imagesGenerated, imagesAttempted, failedImages: failedImages.slice(0, 50) },
            originalError: encErr instanceof Error ? encErr : undefined,
          }
        );
      }
    }

    // === STORYLET IMAGES ===
    // Storylets now use the same reliability model as encounter-tree slots:
    // manifest, resume, provider policy, and manifest-based completeness.
    const storyletImages = new Map<string, Map<string, Map<string, string>>>();

    for (const [sceneId, encounter] of encounters) {
      const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);
      const storylets = encounter.storylets;
      if (!storylets) continue;

      const storyletManifest = buildStoryletSlotManifest(storylets, sceneId, scopedSceneId);
      if (storyletManifest.slots.length === 0) continue;

      const sceneStoryletImages = new Map<string, Map<string, string>>();
      const encounterCharacterIds = Array.from(new Set([...(encounter.npcStates?.map(npc => npc.npcId) || []), brief.protagonist.id]));
      const referenceImages = this.gatherCharacterReferenceImages(
        encounterCharacterIds,
        characterBible,
        undefined,
        {
          includeExpressions: this.shouldUseExpressionReferencesForEncounter(encounter),
          family: 'storylet-aftermath',
          slotId: `storylet:${scopedSceneId}`,
        }
      );
      const encounterCharacterDescriptions = this.buildCharacterDescriptions(encounterCharacterIds, characterBible);
      const encounterCharacterNames = encounterCharacterIds
        .map(id => characterBible.characters.find(c => c.id === id)?.name)
        .filter(Boolean) as string[];
      const storyletFirstBeat = encounter.beats?.[0];
      const encounterSettingContext = resolveSceneSettingContext({
        sceneName: sceneId,
        sceneDescription: storyletFirstBeat?.setupText || storyletFirstBeat?.description,
        authoredLocationId: undefined,
        authoredLocationName: undefined,
        authoredLocationType: undefined,
        worldPremise: brief.world.premise,
        worldTimePeriod: brief.world.timePeriod,
        worldTechnologyLevel: brief.world.technologyLevel,
        worldMagicSystem: brief.world.magicSystem,
      });

      const resumeLoaded = outputDirectory ? loadEncounterResumeStateSync(outputDirectory, idSlugify(sceneId)) : null;
      const resumeSet = new Set<string>(resumeLoaded?.completedBaseIdentifiers ?? []);
      const persistResume = async (): Promise<void> => {
        if (!outputDirectory) return;
        await saveEncounterResumeState(outputDirectory, idSlugify(sceneId), {
          version: 1,
          sceneId,
          scopedSceneId,
          completedBaseIdentifiers: [...resumeSet],
          generatedAt: new Date().toISOString(),
        });
      };
      const markResumeDone = async (baseId: string): Promise<void> => {
        if (!resumeSet.has(baseId)) {
          resumeSet.add(baseId);
          await persistResume();
        }
      };

      const storyletPolicy = new EncounterProviderPolicy(this.imageService, {
        maxConsecutiveFailuresBeforeAbort: this.config.imageGen?.encounterMaxConsecutiveFailuresBeforeAbort ?? 0,
      });
      const onStoryletSlotFailure = async (err: unknown): Promise<void> => {
        storyletPolicy.onSlotFailure(err);
        const d = storyletPolicy.getBackoffDelayMs();
        if (d > 0) await new Promise(r => setTimeout(r, d));
        if (storyletPolicy.shouldAbortHard()) {
          throw new PipelineError(
            `Storylet image generation aborted after repeated failures for ${sceneId}`,
            'encounter_images',
            {
              agent: 'EncounterImageAgent',
              context: { sceneId, encounterId: encounter.id || `${sceneId}-encounter`, failureKind: 'storylet_consecutive_failures' },
            },
          );
        }
      };

      const toneMoodMap: Record<string, string> = {
        triumphant: 'victorious, triumphant aftermath, warm heroic lighting',
        bittersweet: 'quiet bittersweet aftermath, mixed emotions, muted tones',
        tense: 'tense uneasy aftermath, characters still on edge, harsh shadows',
        desperate: 'desperate failed aftermath, exhausted and defeated, cold dark tones',
        relieved: 'relieved escape aftermath, barely survived, shaky breath',
        somber: 'somber defeated aftermath, heavy silence, dark desaturated palette',
      };
      const partialVictoryStoryletCost = storylets.partialVictory?.cost;

      const persistStoryletRunState = async (phase: string): Promise<void> => {
        if (!outputDirectory) return;
        await saveEarlyDiagnostic(outputDirectory, `08a-storylet-run-state-${idSlugify(sceneId)}.json`, {
          generatedAt: new Date().toISOString(),
          sceneId,
          phase,
          completedBaseIdentifiers: [...resumeSet].slice(-300),
          outcomes: Array.from(sceneStoryletImages.entries()).map(([outcomeName, beatImages]) => ({
            outcomeName,
            beatIds: Array.from(beatImages.keys()),
          })),
          missingCoverageKeys: collectMissingStoryletSlotsFromManifest(storyletManifest, sceneStoryletImages).slice(0, 100),
        });
      };

      const getOutcomeBeatImages = (outcomeName: string): Map<string, string> => {
        const existing = sceneStoryletImages.get(outcomeName);
        if (existing) return existing;
        const created = new Map<string, string>();
        sceneStoryletImages.set(outcomeName, created);
        return created;
      };

      const buildStoryletPrompt = (
        slot: StoryletSlot,
        stage: 'primary' | 'retry' | 'aggressive',
      ): ImagePrompt => {
        const beatDesc = this.resolvePlayerTemplates(
          this.normalizeNarrativeText(slot.beat.text ?? '', `${slot.outcomeName} aftermath`),
          brief
        );
        const sanitizedBeatDesc = this.scrubPromptArtifacts(beatDesc);
        const visualContract = (slot.beat.visualContract as any) || this.buildEncounterVisualContract(sanitizedBeatDesc, 'resolution');
        const costForSlot = (slot.beat.cost || slot.storyletCost || partialVictoryStoryletCost) as any;
        if (slot.outcomeName === 'partialVictory' && costForSlot && !visualContract.visibleCost) {
          visualContract.visibleCost = costForSlot?.visibleComplication;
        }
        const aggressive = stage !== 'primary';
        const tone = slot.storyletTone;
        return this.sanitizeImagePrompt(this.encounterImageAgent.cinematicDescriptionToPrompt({
          encounterId: encounter.id || `${sceneId}-encounter`,
          beatId: slot.beatId,
          encounterPhase: 'resolution',
          outcomeType: slot.outcomeName as EncounterOutcome,
          cost: slot.outcomeName === 'partialVictory' ? costForSlot : undefined,
          cinematicDescription: {
            sceneDescription: sanitizedBeatDesc,
            focusSubject: brief.protagonist.name,
            secondaryElements: aggressive ? encounterCharacterNames.filter(name => name !== brief.protagonist.name).slice(0, 2) : encounterCharacterNames.filter(name => name !== brief.protagonist.name),
            cameraAngle: 'reaction_shot',
            shotType: 'consequence',
            mood: aggressive
              ? 'tense_uncertainty'
              : tone === 'triumphant' ? 'triumphant' : tone === 'relieved' ? 'relief' : tone === 'somber' ? 'desperate' : 'tense_uncertainty',
            lightingDirection: toneMoodMap[tone] || 'dramatic aftermath',
            colorPalette: aggressive ? 'muted aftermath tones' : 'storylet aftermath palette grounded in the encounter tone',
            characterStates: [
              {
                characterId: brief.protagonist.id || 'protagonist',
                pose: aggressive ? 'aftermath posture' : 'after the decisive turn',
                expression: aggressive ? 'processing the cost' : tone,
                position: 'center frame'
              },
            ],
          },
          visualContract,
          genre: brief.story.genre,
          artStyle: this.config.artStyle,
          settingContext: encounterSettingContext,
        }), brief);
      };

      const attemptStoryletSlot = async (
        slot: StoryletSlot,
        stage: 'primary' | 'retry' | 'aggressive',
        pass: number = 0,
      ): Promise<void> => {
        const beatImages = getOutcomeBeatImages(slot.outcomeName);
        if (beatImages.has(slot.beatId)) return;

        const identifier = stage === 'primary'
          ? slot.baseIdentifier
          : stage === 'retry'
            ? storyletRetryIdentifier(scopedSceneId, slot.outcomeName, slot.beatId)
            : storyletAggressiveRetryIdentifier(scopedSceneId, slot.outcomeName, slot.beatId, pass);
        const qaIdentifier = stage === 'primary'
          ? `storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}`
          : stage === 'retry'
            ? `retry:storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}`
            : `retry2:storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}:${pass}`;
        const prompt = buildStoryletPrompt(slot, stage);

        try {
          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            prompt,
            identifier,
            {
              sceneId: scopedSceneId,
              beatId: slot.beatId,
              type: 'storylet-aftermath',
              outcomeType: slot.outcomeName as EncounterOutcome,
              characters: encounterCharacterIds,
              characterNames: encounterCharacterNames,
              characterDescriptions: encounterCharacterDescriptions,
            },
            referenceImages.length > 0 ? referenceImages : undefined,
            qaIdentifier,
            1,
            {
              preferAtlasFirst: storyletPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: slot.baseIdentifier,
              resumeAlternateBaseIdentifiers: identifier === slot.baseIdentifier ? undefined : [identifier],
            },
          );

          if (generated.result.imageUrl) {
            beatImages.set(slot.beatId, generated.result.imageUrl);
            globalEncounterImageIndex++;
            storyletPolicy.onSlotSuccess();
            await markResumeDone(slot.baseIdentifier);
            this.emit({
              type: 'checkpoint',
              phase: 'encounter_images',
              message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
              data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier },
            });
          } else {
            await onStoryletSlotFailure(new Error('no_image_url'));
          }
        } catch (err) {
          if (err instanceof PipelineError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Pipeline] Storylet image failed for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}`);
          this.emit({ type: 'warning', phase: 'encounter_images', message: `Storylet image failed for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}` });
          await onStoryletSlotFailure(err);
        }

        await new Promise(resolve => setTimeout(resolve, stage === 'aggressive' ? TIMING_DEFAULTS.rateLimitDelayMs * 2 : TIMING_DEFAULTS.rateLimitDelayMs));
      };

      for (const slot of storyletManifest.slots) {
        await attemptStoryletSlot(slot, 'primary');
      }
      await persistStoryletRunState('primary');

      let missingSlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
      if (missingSlots.length > 0) {
        console.log(`[Pipeline] Retrying ${missingSlots.length} missing storylet images for ${sceneId}`);
        for (const slot of missingSlots) {
          await attemptStoryletSlot(slot, 'retry');
        }
        await persistStoryletRunState('retry');
      }

      for (let pass = 0; pass < 2; pass++) {
        missingSlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
        if (missingSlots.length === 0) break;
        console.warn(`[Pipeline] ${missingSlots.length} storylet images still missing for ${sceneId} after retry — aggressive pass ${pass + 1}`);
        for (const slot of missingSlots) {
          await attemptStoryletSlot(slot, 'aggressive', pass);
        }
        await persistStoryletRunState(`aggressive-${pass + 1}`);
      }

      // Last-resort recovery: for any slots still missing after all retries,
      // generate with a drastically simplified prompt, no reference images,
      // and no QA validation. This ensures every storylet beat gets an image.
      const recoverySlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
      if (recoverySlots.length > 0) {
        console.warn(`[Pipeline] ${recoverySlots.length} storylet images still missing for ${sceneId} — running last-resort recovery`);
        for (const slot of recoverySlots) {
          const beatImages = getOutcomeBeatImages(slot.outcomeName);
          if (beatImages.has(slot.beatId)) continue;
          const beatDesc = this.resolvePlayerTemplates(
            this.normalizeNarrativeText(slot.beat.text ?? '', `${slot.outcomeName} aftermath`),
            brief
          );
          const tone = slot.storyletTone;
          const moodHint = toneMoodMap[tone] || 'dramatic aftermath';
          const artStyle = this.config.artStyle || 'cinematic illustration';
          const recoveryPromptText = `${artStyle} style. ${moodHint}. ${beatDesc.slice(0, 300)}`;
          const recoveryPrompt: ImagePrompt = this.sanitizeImagePrompt({
            prompt: recoveryPromptText,
            style: artStyle,
            aspectRatio: '16:9',
          }, brief);
          const recoveryId = sanitizeEncounterIdentifier(`storylet-${scopedSceneId}-${slot.outcomeName}-${slot.beatId}-recovery`);
          try {
            const result = await withTimeout(this.imageService.generateImage(
              recoveryPrompt,
              recoveryId,
              {
                sceneId: scopedSceneId,
                beatId: slot.beatId,
                type: 'storylet-aftermath',
                characters: encounterCharacterIds,
                characterNames: encounterCharacterNames,
                characterDescriptions: encounterCharacterDescriptions,
              },
              undefined,
            ), PIPELINE_TIMEOUTS.imageGeneration, `storyletRecovery(${recoveryId})`);
            if (result.imageUrl) {
              beatImages.set(slot.beatId, result.imageUrl);
              globalEncounterImageIndex++;
              storyletPolicy.onSlotSuccess();
              await markResumeDone(slot.baseIdentifier);
              console.log(`[Pipeline] Storylet recovery succeeded for ${sceneId}/${slot.outcomeName}/${slot.beatId}`);
              this.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete (recovery)`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: recoveryId },
              });
            } else {
              console.error(`[Pipeline] Storylet recovery returned no URL for ${sceneId}/${slot.outcomeName}/${slot.beatId}`);
            }
          } catch (recoveryErr) {
            const msg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
            console.error(`[Pipeline] Storylet recovery FAILED for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}`);
          }
          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }
        await persistStoryletRunState('recovery');
      }

      const finalMissingKeys = collectMissingStoryletSlotsFromManifest(storyletManifest, sceneStoryletImages);
      if (finalMissingKeys.length > 0) {
        const missingByOutcome = new Map<string, string[]>();
        for (const slot of storyletManifest.slots) {
          if (sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId)) continue;
          const existing = missingByOutcome.get(slot.outcomeName) || [];
          existing.push(slot.beatId);
          missingByOutcome.set(slot.outcomeName, existing);
        }
        for (const [outcomeName, beatIds] of missingByOutcome) {
          const msg = `Storylet ${sceneId}/${outcomeName}: ${beatIds.length} beats still missing images after all retries + recovery: ${beatIds.join(', ')}`;
          console.error(`[Pipeline] STORYLET IMAGE FAILURE: ${msg}`);
          this.emit({ type: 'error', phase: 'encounter_images', message: msg });
          storyletFailures.push(msg);
        }
      }

      if (sceneStoryletImages.size > 0) {
        storyletImages.set(sceneId, sceneStoryletImages);
      }
    }

    this.emit({ type: 'phase_complete', phase: 'encounter_images', message: `Encounter image generation complete` });

    return { encounterImages, storyletImages, storyletFailures };
  }

  /**
   * Recursively generate outcome images for an encounter choice tree.
   * Traverses choices → outcomes → nextSituation → choices → ... producing
   * an image for every outcome and every nested situation node.
   */
  private async generateEncounterTreeImages(
    choices: Array<{ id: string; text?: string; outcomes?: Record<string, any> }>,
    pathPrefix: string,
    sceneId: string,
    encounterId: string,
    beatId: string,
    context: {
      referenceImages: ReferenceImage[];
      characterIds: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      brief: FullCreativeBrief;
      encounter: EncounterStructure;
      settingContext?: SceneSettingContext;
    },
    maps: {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    },
    counters: { imagesGenerated: number; imagesAttempted: number; globalIndex: number; total: number },
    failedImages: string[],
    encounterPolicy: EncounterProviderPolicy,
    resumeSet: Set<string>,
    markResumeDone: (baseId: string) => Promise<void>,
    onEncounterSlotFailure: (err: unknown) => Promise<void>,
    depth: number = 0,
  ): Promise<void> {
    if (depth > ENCOUNTER_TREE_MAX_DEPTH) {
      console.warn(`[Pipeline] Encounter tree depth limit (${ENCOUNTER_TREE_MAX_DEPTH}) reached at ${pathPrefix} — skipping deeper nodes`);
      return;
    }

    const { referenceImages, characterIds, characterNames, characterDescriptions, brief, encounter, settingContext } = context;
    const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);

    const makeFallbackCinematic = (narrativeText: string | undefined, tier: 'success' | 'complicated' | 'failure') => {
      if (!narrativeText) return null;
      const moodMap = { success: 'triumphant' as const, complicated: 'tense_uncertainty' as const, failure: 'desperate' as const };
      const expressionMap = { success: 'triumphant', complicated: 'strained', failure: 'pained' };
      const poseMap = { success: 'victorious follow-through', complicated: 'bracing', failure: 'recoiling' };
      return {
        sceneDescription: this.makeEncounterVisualSceneDescription(narrativeText),
        focusSubject: 'protagonist',
        secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
        cameraAngle: this.inferEncounterCameraAngle(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'),
        shotType: 'consequence' as const,
        mood: this.inferEncounterMood(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising') || moodMap[tier],
        lightingDirection: tier === 'success' ? 'warm front lighting' : tier === 'failure' ? 'harsh side lighting' : 'neutral fill',
        colorPalette: tier === 'success' ? 'warm tones' : tier === 'failure' ? 'cold desaturated' : 'muted mixed',
        characterStates: [
          { characterId: brief.protagonist.id || 'protagonist', pose: poseMap[tier], expression: expressionMap[tier], position: 'center frame' },
          ...(encounter.npcStates || []).map(npc => ({
            characterId: npc.npcId || npc.name || 'npc',
            pose: tier === 'success' ? 'staggering back' : tier === 'failure' ? 'pressing advantage' : 'locked in struggle',
            expression: tier === 'success' ? 'shocked' : tier === 'failure' ? 'confident' : 'straining',
            position: 'opposite side',
          })),
        ],
      };
    };

    for (const choice of choices) {
      if (!choice.outcomes) continue;

      const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
      const choiceOutcomes: { success?: string; complicated?: string; failure?: string } = {};
      let previousOutcomeTier: 'success' | 'complicated' | 'failure' | undefined;

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        await this.checkCancellation();
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData) continue;

        const outcomeText = this.resolvePlayerTemplates(
          this.normalizeNarrativeText(
            outcomeData.narrativeText,
            `${this.normalizeNarrativeText(choice.text, 'choice')} - ${tier} result`
          ),
          brief
        );
        const outcomeVisualContract = outcomeData.visualContract || this.buildEncounterVisualContract(
          outcomeText,
          tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'
        );
        if (outcomeData.encounterOutcome === 'partialVictory' && outcomeData.cost && !outcomeVisualContract.visibleCost) {
          outcomeVisualContract.visibleCost = outcomeData.cost.visibleComplication;
        }

        const cinematic = outcomeData.cinematicDescription
          || makeFallbackCinematic(outcomeText, tier)
          || makeFallbackCinematic(`${encounter.encounterType || 'dramatic'} encounter - ${tier} outcome for ${brief.protagonist.name}`, tier)!;

        const outcomeBaseId = encounterOutcomeIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        counters.imagesAttempted++;
        try {
          const outcomePrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId,
            choiceId: choiceMapKey,
            outcomeTier: tier,
            outcomeType: outcomeData.encounterOutcome,
            cost: outcomeData.cost,
            cinematicDescription: cinematic,
            encounterPhase: tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising',
            previousOutcomeTier,
            visualContract: outcomeVisualContract,
            genre: brief.story.genre,
            artStyle: this.config.artStyle,
            settingContext,
          });

          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            outcomePrompt,
            outcomeBaseId,
            { sceneId: scopedSceneId, beatId, choiceId: choiceMapKey, type: 'encounter-outcome', tier, outcomeType: outcomeData.encounterOutcome, characters: characterIds, characterNames, characterDescriptions },
            referenceImages.length > 0 ? referenceImages : undefined,
            `${tier}:${beatId}:${choiceMapKey}`,
            1,
            {
              preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: outcomeBaseId,
            },
          );
          const result = generated.result;

          if (result.imageUrl) {
            if (generated.artifactStatus !== 'accepted_clean') {
              console.warn(
                `[Pipeline] Encounter ${tier} image for ${choiceMapKey} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
              );
            }
            choiceOutcomes[tier] = result.imageUrl;
            counters.imagesGenerated++;
            counters.globalIndex++;
            encounterPolicy.onSlotSuccess();
            await markResumeDone(outcomeBaseId);
            this.emit({
              type: 'checkpoint', phase: 'encounter_images',
              message: `Encounter image ${counters.globalIndex} of ~${counters.total} complete (depth ${depth})`,
              data: { imageIndex: counters.globalIndex, totalImages: counters.total, identifier: outcomeBaseId },
            });
            previousOutcomeTier = tier;
          } else {
            failedImages.push(`${tier}:${choiceMapKey}`);
            await onEncounterSlotFailure(new Error('no_image_url'));
          }
        } catch (outcomeErr) {
          const msg = outcomeErr instanceof Error ? outcomeErr.message : String(outcomeErr);
          console.error(`[Pipeline] Encounter ${tier} image FAILED for ${choiceMapKey} in ${sceneId}: ${msg}`);
          failedImages.push(`${tier}:${choiceMapKey}:${msg}`);
          if (outcomeErr instanceof PipelineError) throw outcomeErr;
          await onEncounterSlotFailure(outcomeErr);
        }

        await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));

        // Recurse into nextSituation if present
        const nextSituation = outcomeData.nextSituation;
        if (nextSituation && nextSituation.choices && nextSituation.choices.length > 0) {
          const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
          const legacySituationKey = legacyEncounterSituationKey(choiceMapKey, tier);
          const sitText = this.resolvePlayerTemplates(
            this.normalizeNarrativeText(
              nextSituation.setupText,
              `Next situation after ${tier} outcome`
            ),
            brief
          );

          const sitCinematic = nextSituation.cinematicSetup || {
            sceneDescription: this.makeEncounterVisualSceneDescription(sitText),
            focusSubject: 'protagonist',
            secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
            cameraAngle: this.inferEncounterCameraAngle(sitText, 'setup'),
            shotType: 'tension_hold' as const,
            mood: this.inferEncounterMood(sitText, 'setup'),
            lightingDirection: 'dramatic side lighting',
            colorPalette: 'contextual to genre',
            characterStates: [
              { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
              ...(encounter.npcStates || []).map(npc => ({
                characterId: npc.npcId || npc.name || 'npc',
                pose: 'facing protagonist',
                expression: npc.initialDisposition || 'neutral',
                position: 'opposite side',
              })),
            ],
          };

          const sitBaseId = encounterSituationIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const legacySitBaseId = legacyEncounterSituationIdentifier(scopedSceneId, choiceMapKey, tier);
          counters.imagesAttempted++;
          try {
            const sitVisualContract = nextSituation.visualContract || this.buildEncounterVisualContract(sitText, 'setup');
            const sitPrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
              encounterId,
              beatId,
              cinematicDescription: sitCinematic,
              encounterPhase: 'setup',
              visualContract: sitVisualContract,
              genre: brief.story.genre,
              artStyle: this.config.artStyle,
              settingContext,
            });

            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              sitPrompt,
              sitBaseId,
              { sceneId: scopedSceneId, beatId, type: 'encounter-setup', characters: characterIds, characterNames, characterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `situation:${choiceMapKey}::${tier}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: sitBaseId,
                resumeAlternateBaseIdentifiers: [legacySitBaseId],
              },
            );

            if (generated.result.imageUrl) {
              maps.setupImages.set(situationKey, generated.result.imageUrl);
              maps.setupImages.set(legacySituationKey, generated.result.imageUrl);
              counters.imagesGenerated++;
              counters.globalIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(sitBaseId);
              this.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${counters.globalIndex} of ~${counters.total} complete (situation depth ${depth + 1})`,
                data: { imageIndex: counters.globalIndex, totalImages: counters.total, identifier: sitBaseId },
              });
              if (generated.result.imageData && generated.result.mimeType) {
                this.imageService.setGeminiPreviousScene(generated.result.imageData, generated.result.mimeType);
              }
            } else {
              failedImages.push(`situation:${choiceMapKey}::${tier}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (sitErr) {
            const msg = sitErr instanceof Error ? sitErr.message : String(sitErr);
            console.error(`[Pipeline] Encounter situation image FAILED for ${situationKey} in ${sceneId}: ${msg}`);
            failedImages.push(`situation:${situationKey}:${msg}`);
            if (sitErr instanceof PipelineError) throw sitErr;
            await onEncounterSlotFailure(sitErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));

          // Recurse into the nextSituation's choices
          const nestedPathPrefix = `${choiceMapKey}::${tier}`;
          console.log(`[Pipeline] Recursing into nextSituation at depth ${depth + 1}: ${nestedPathPrefix} (${nextSituation.choices.length} choices)`);
          await this.generateEncounterTreeImages(
            nextSituation.choices,
            nestedPathPrefix,
            sceneId,
            encounterId,
            beatId,
            context,
            maps,
            counters,
            failedImages,
            encounterPolicy,
            resumeSet,
            markResumeDone,
            onEncounterSlotFailure,
            depth + 1,
          );
        }
      }

      if (Object.keys(choiceOutcomes).length > 0) {
        maps.outcomeImages.set(choiceMapKey, choiceOutcomes);
      }
    }
  }

  /**
   * Get character IDs present in a scene based on speakers and mentions
   */
  private getCharacterIdsInScene(scene: SceneContent, characterBible: CharacterBible, protagonistId?: string): string[] {
    const characterIds = new Set<string>();
    
    // ALWAYS include the protagonist — they are in every scene even if not explicitly named
    // (beat text often uses {{player.name}} templates instead of the actual name)
    if (protagonistId) {
      const protagonistExists = characterBible.characters.some(c => c.id === protagonistId);
      if (protagonistExists) characterIds.add(protagonistId);
    }
    
    // Primary: use charactersInvolved from scene content (populated from blueprint.npcsPresent)
    if (scene.charactersInvolved && scene.charactersInvolved.length > 0) {
      for (const charId of scene.charactersInvolved) {
        // Verify character exists in bible
        const exists = characterBible.characters.some(c => c.id === charId);
        if (exists) {
          characterIds.add(charId);
        } else {
          // Try to match by name
          const char = characterBible.characters.find(
            c => c.name.toLowerCase() === charId.toLowerCase()
          );
          if (char) characterIds.add(char.id);
        }
      }
    }
    
    // Secondary: scan beat speakers for additional characters
    for (const beat of scene.beats) {
      if (beat.speaker) {
        // Try to find the character by name
        const char = characterBible.characters.find(
          c => c.name.toLowerCase() === beat.speaker?.toLowerCase() ||
               c.id.toLowerCase() === beat.speaker?.toLowerCase()
        );
        if (char) {
          characterIds.add(char.id);
        }
      }
    }

    // Tertiary: scan beat text + authored visualMoment for character mentions.
    // This is critical for scenes with limited/incorrect blueprint.npcsPresent and for image prompts
    // where we must include all named characters consistently.
    for (const beat of scene.beats) {
      const text = `${beat.text || ''} ${(beat as any).visualMoment || ''}`.toLowerCase();
      if (!text.trim()) continue;

      for (const c of characterBible.characters) {
        const tokens = c.name
          .split(/\s+/)
          .map(t => t.trim())
          .filter(t => t.length > 2);
        if (tokens.length === 0) continue;

        const mentioned = tokens.some(tok => new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(text));
        if (mentioned) characterIds.add(c.id);
      }
    }
    
    return Array.from(characterIds);
  }

  /**
   * Shared QA check for encounter images: validates text artifacts using Gemini vision.
   * Returns the validated image result, or null if the image fails QA and retry also fails.
   * Applies the same minimum QA that episode images receive.
   */
  private async validateEncounterImage(
    result: { imageUrl?: string; imageData?: string; mimeType?: string },
    identifier: string,
    prompt?: ImagePrompt,
    metadata?: {
      sceneId: string;
      beatId: string;
      type: 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath';
      characters: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      choiceId?: string;
      tier?: 'success' | 'complicated' | 'failure';
      outcomeType?: EncounterOutcome;
    },
    allowDiegeticText: boolean = false,
    maxRetries: number = 2
  ): Promise<{ passed: boolean; result: typeof result }> {
    if (!result.imageData || !result.mimeType) {
      return { passed: true, result };
    }

    const textCheck = await withTimeout(this.imageService.checkImageForTextArtifacts(
      result.imageData,
      result.mimeType,
      allowDiegeticText
    ), PIPELINE_TIMEOUTS.imageGeneration, `textArtifactCheck(${identifier})`);

    if (!textCheck.hasText) {
      // Continue to visual readability checks below.
    } else {
      console.warn(`[Pipeline] Encounter image ${identifier} has text artifact: ${textCheck.description}. Will be flagged for observability.`);
      return { passed: false, result };
    }

    if (!prompt || !metadata) {
      return { passed: true, result };
    }

    const focalCharacterName = metadata.characterNames[0] || 'protagonist';
    const focalEmotion = prompt.emotionalCore || prompt.keyExpression || 'determined tension';
    const expressionTargets = prompt.keyExpression || prompt.emotionalCore ? [{
      characterName: focalCharacterName,
      emotion: focalEmotion,
      intensity: metadata.type === 'encounter-outcome' ? 'intense' as const : 'moderate' as const,
      reason: prompt.visualNarrative || prompt.prompt,
    }] : [];

    const actingTargets = prompt.keyBodyLanguage || prompt.keyGesture ? [{
      characterName: focalCharacterName,
      intent: metadata.type === 'encounter-outcome'
        ? (metadata.tier === 'failure' ? 'protect_self' : metadata.tier === 'success' ? 'challenge' : 'process')
        : 'observe',
      primaryEmotion: focalEmotion,
      intensity: metadata.type === 'encounter-outcome' ? 'intense' as const : 'moderate' as const,
      status: metadata.type === 'encounter-outcome' && metadata.tier === 'success' ? 'dominant' as const : 'equal' as const,
      relationalStance: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'guarded' as const : 'open' as const,
      spatialRelation: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'withdrawing' as const : 'approaching' as const,
      bodyLanguage: {
        spine: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'curved_forward' : 'upright',
        shoulderState: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'raised_tense' : 'open_tense',
        chestDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'closed_inward' : 'open_forward',
        weightDistribution: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'back' : 'forward',
        stanceWidth: metadata.type === 'encounter-outcome' ? 'wide_confident' : 'normal',
        feetDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'away_from_target' : 'toward_target',
        headPosition: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'chin_down' : 'chin_up',
        neckTension: 'tense',
        gazeDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'averted' : 'direct_contact',
        armPosition: prompt.keyGesture?.includes('reach') ? 'reaching_out' : 'gesturing',
        handState: prompt.keyGesture?.includes('grip') ? 'gripping_object' : 'gesturing_emphatic',
        gestureSize: metadata.type === 'encounter-outcome' ? 'moderate' : 'small_contained',
        spatialDistance: metadata.characterNames.length > 1 ? 'personal' : undefined,
        bodyOrientation: metadata.characterNames.length > 1 ? 'angled_toward' : undefined,
      },
      reason: prompt.keyBodyLanguage || prompt.keyGesture,
    }] : [];

    const hardFailures: string[] = [];

    if (metadata?.outcomeType === 'partialVictory') {
      if (!prompt?.prompt?.toLowerCase().includes('partial victory rule')) {
        hardFailures.push('partialVictory prompt is missing costly-success guardrails');
      }
      if (!prompt?.prompt?.toLowerCase().includes('visible complication')) {
        hardFailures.push('partialVictory prompt does not describe the visible cost');
      }
    }

    if (expressionTargets.length > 0) {
      const expressionCheck = await this.imageAgentTeam.validateExpressions(
        identifier,
        result.imageData,
        result.mimeType,
        expressionTargets as any,
        prompt.emotionalCore,
        false
      );
      if (expressionCheck.success && expressionCheck.data && !expressionCheck.data.isAcceptable) {
        hardFailures.push(`expression readability: ${expressionCheck.data.issues.join(', ')}`);
      }
    }

    if (actingTargets.length > 0) {
      const bodyCheck = await this.imageAgentTeam.validateBodyLanguage(
        identifier,
        result.imageData,
        result.mimeType,
        actingTargets as any,
        {
          expectedPowerDynamic: metadata.type === 'encounter-outcome' ? 'shifting' : 'balanced',
          expectedEmotionalDistance: metadata.characterNames.length > 1 ? 'close' : 'neutral',
          isConflictScene: metadata.type !== 'storylet-aftermath',
        }
      );
      if (bodyCheck.success && bodyCheck.data && !bodyCheck.data.isAcceptable) {
        hardFailures.push(`body language: ${bodyCheck.data.issues.join(', ')}`);
      }
    }

    const storyCheck = await this.imageAgentTeam.validateVisualStorytelling(
      identifier,
      result.imageData,
      result.mimeType,
      {
        beatId: metadata.beatId,
        clarity: 'instant_read',
        pacing: metadata.type === 'encounter-outcome' ? 'peak' : metadata.type === 'storylet-aftermath' ? 'aftermath' : 'hold',
        choiceTelegraph: prompt.visualNarrative || prompt.prompt,
      } as any,
      undefined,
      undefined,
      undefined,
      { action: prompt.keyGesture || prompt.visualNarrative || prompt.prompt, emotion: focalEmotion },
      undefined
    );
    if (storyCheck.success && storyCheck.data && !storyCheck.data.isAcceptable) {
      hardFailures.push(`storytelling clarity: ${storyCheck.data.criticalIssues.join(', ')}`);
    }

    if (hardFailures.length > 0) {
      console.warn(`[Pipeline] Encounter image ${identifier} failed visual QA: ${hardFailures.join(' | ')}`);
      return { passed: false, result };
    }

    return { passed: true, result };
  }

  private strengthenPromptForTextArtifacts(prompt: ImagePrompt, attempt: number): ImagePrompt {
    const strengthened = { ...prompt };
    const banTextDirective =
      attempt === 0
        ? 'Do not overlay any narrative text, dialog, captions, sound effects, or onomatopoeia on the image. Text on in-world objects (signs, clothing, screens) is fine.'
        : 'CRITICAL: absolutely no narrative text, dialog, speech bubbles, captions, sound effects, or onomatopoeia overlaid on the image.';
    strengthened.prompt = `${this.scrubPromptArtifacts(strengthened.prompt || '')} ${banTextDirective}`.trim();
    strengthened.negativePrompt = `${strengthened.negativePrompt || ''}, caption text, dialog text, narrative text, speech bubbles, thought bubbles, sound effect text, onomatopoeia, chapter title, character name labels, credits, watermarks`.trim();
    return strengthened;
  }

  private async generateEncounterImageWithTextArtifactPolicy(
    prompt: ImagePrompt,
    identifier: string,
    metadata: {
      sceneId: string;
      beatId: string;
      type: 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath';
      characters: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      choiceId?: string;
      tier?: 'success' | 'complicated' | 'failure';
      outcomeType?: EncounterOutcome;
    },
    referenceImages: ReferenceImage[] | undefined,
    qaIdentifier: string,
    maxTextArtifactRetries = 1,
    encounterGenOptions?: {
      preferAtlasFirst?: boolean;
      resumeCompleted?: Set<string>;
      resumeBaseIdentifier?: string;
      resumeAlternateBaseIdentifiers?: string[];
    }
  ): Promise<{
    result: GeneratedImage;
    artifactStatus: 'accepted_clean' | 'accepted_after_retry' | 'accepted_with_artifact';
    attempts: number;
    resolvedIdentifier: string;
  }> {
    if (
      encounterGenOptions?.resumeBaseIdentifier &&
      encounterGenOptions.resumeCompleted?.has(encounterGenOptions.resumeBaseIdentifier)
    ) {
      const tryIds = [
        identifier,
        ...(encounterGenOptions.resumeAlternateBaseIdentifiers || []),
      ];
      for (const cand of tryIds) {
        const existing = this.imageService.findExistingGeneratedImage(cand);
        if (existing?.imageUrl) {
          return {
            result: { prompt, imageUrl: existing.imageUrl, imagePath: existing.imagePath },
            artifactStatus: 'accepted_clean',
            attempts: 0,
            resolvedIdentifier: cand,
          };
        }
      }
    }

    let attemptPrompt = prompt;
    let lastResult: GeneratedImage | null = null;
    let lastIdentifier = identifier;

    for (let attempt = 0; attempt <= maxTextArtifactRetries; attempt++) {
      const attemptIdentifier = attempt === 0 ? identifier : `${identifier}-textfix${attempt}`;
      lastIdentifier = attemptIdentifier;
      const result = await withTimeout(this.imageService.generateImage(
        attemptPrompt,
        attemptIdentifier,
        {
          ...metadata,
          baseIdentifier: encounterGenOptions?.resumeBaseIdentifier || identifier,
          resolvedIdentifier: attemptIdentifier,
          regeneration: attempt > 0 ? attempt : undefined,
          preferAtlasFirst: !!encounterGenOptions?.preferAtlasFirst && attempt === 0,
        },
        referenceImages
      ), PIPELINE_TIMEOUTS.imageGeneration, `encounterImage(${attemptIdentifier})`);
      lastResult = result;

      if (!result.imageUrl) continue;
      const qa = await this.validateEncounterImage(result, `${qaIdentifier}:attempt-${attempt + 1}`, attemptPrompt, metadata, true);
      if (qa.passed) {
        return {
          result,
          artifactStatus: attempt === 0 ? 'accepted_clean' : 'accepted_after_retry',
          attempts: attempt + 1,
          resolvedIdentifier: attemptIdentifier,
        };
      }

      if (attempt < maxTextArtifactRetries) {
        attemptPrompt = this.strengthenPromptForTextArtifacts(prompt, attempt);
      }
    }

    if (!lastResult) {
      throw new Error(`Encounter image generation failed for ${qaIdentifier}`);
    }

    return {
      result: lastResult,
      artifactStatus: 'accepted_with_artifact',
      attempts: maxTextArtifactRetries + 1,
      resolvedIdentifier: lastIdentifier,
    };
  }

  private makeEncounterVisualSceneDescription(narrativeText: string): string {
    const cleaned = (narrativeText || '').trim();
    if (!cleaned) return 'A high-stakes encounter moment with visible action and reaction.';
    return `${cleaned} Show the exact moment of action and reaction, with clear body language and cause/effect in frame.`;
  }

  /**
   * Normalize arbitrary LLM output into readable narrative text for image prompts.
   * Prevents accidental "[object Object]" leakage when a beat text field is not a string.
   */
  private normalizeNarrativeText(raw: unknown, fallback = ''): string {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed || fallback;
    }
    if (raw && typeof raw === 'object') {
      const asRecord = raw as Record<string, unknown>;
      const candidate =
        (typeof asRecord.text === 'string' && asRecord.text) ||
        (typeof asRecord.narrativeText === 'string' && asRecord.narrativeText) ||
        (typeof asRecord.description === 'string' && asRecord.description) ||
        '';
      if (candidate) return candidate.trim();
      try {
        return JSON.stringify(raw);
      } catch {
        return fallback;
      }
    }
    if (raw === undefined || raw === null) return fallback;
    return String(raw);
  }

  private scrubPromptArtifacts(text: string): string {
    return (text || '')
      .replace(/\[object Object\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private sanitizePromptText(raw: unknown, brief: FullCreativeBrief, fallback = ''): string {
    const normalized = this.normalizeNarrativeText(raw, fallback);
    const resolved = this.resolvePlayerTemplates(normalized, brief);
    return this.scrubPromptArtifacts(resolved);
  }

  private sanitizeImagePrompt(prompt: ImagePrompt, brief: FullCreativeBrief): ImagePrompt {
    const sanitize = (value: unknown) => this.sanitizePromptText(value, brief, '');
    return {
      ...prompt,
      prompt: sanitize(prompt.prompt),
      composition: sanitize(prompt.composition),
      visualNarrative: sanitize(prompt.visualNarrative),
      emotionalCore: sanitize(prompt.emotionalCore),
      keyExpression: sanitize(prompt.keyExpression),
      keyBodyLanguage: sanitize(prompt.keyBodyLanguage),
      keyGesture: sanitize(prompt.keyGesture),
      poseSpec: sanitize(prompt.poseSpec),
    };
  }

  private withSettingAwarePrompt(prompt: ImagePrompt, settingContext?: SceneSettingContext): ImagePrompt {
    if (!settingContext) return prompt;
    const selection = selectStyleAdaptation(prompt.style || this.config.artStyle || undefined, settingContext);
    return {
      ...prompt,
      settingContext,
      settingBranchLabel: selection.branchLabel,
      settingAdaptationNotes: selection.notes,
    };
  }

  private isLlmQuotaFailure(errorLike: unknown): boolean {
    if (isLlmQuotaError(errorLike)) return true;
    const message = errorLike instanceof Error ? errorLike.message : String(errorLike ?? '');
    const lower = message.toLowerCase();
    return (
      lower.includes('exceeded your current quota') ||
      lower.includes('quota exceeded for metric') ||
      lower.includes('generate_requests_per_model_per_day') ||
      lower.includes('limit: 0')
    );
  }

  private toEncounterRunDiagnostics(entries: EncounterImageDiagnostic[]): EncounterImageRunDiagnostic[] {
    return entries.map(entry => ({
      ...entry,
      imageType: entry.imageType,
    }));
  }

  private async runEncounterProviderPreflight(outputDirectory?: string): Promise<void> {
    const preflight = await this.imageService.preflightImageProvider(true);
    if (preflight.ok) {
      this.emit({
        type: 'debug',
        phase: 'encounter_images',
        message: `Encounter provider preflight OK (${preflight.provider}, ${preflight.latencyMs}ms)`,
      });
      return;
    }
    const preflightMsg = `Encounter image provider preflight failed (${preflight.provider}): ${preflight.reason || 'unknown reason'}`;
    const reason = preflight.reason || '';
    const hardFailure = /missing .*key|missing .*token|http 401|http 403|invalid api key|api key is required|provider is placeholder/i.test(reason);
    this.emit({ type: hardFailure ? 'error' : 'warning', phase: 'encounter_images', message: preflightMsg });
    this.imageService.clearEncounterDiagnostics();
    const entry: EncounterImageDiagnostic = {
      timestamp: new Date().toISOString(),
      identifier: 'encounter-provider-preflight',
      provider: preflight.provider,
      imageType: 'encounter-setup',
      status: 'preflight_failed',
      attempts: 1,
      durationMs: preflight.latencyMs,
      promptChars: 0,
      negativeChars: 0,
      refCount: 0,
      errorMessage: preflight.reason || 'preflight failed',
    };
    // Use diagnostics log even on early failure so users can inspect root cause.
    const diagnostics = this.toEncounterRunDiagnostics([entry]);
    if (outputDirectory) {
      await saveEncounterImageDiagnosticsLog(outputDirectory, diagnostics);
    }
    if (hardFailure) {
      throw new PipelineError(preflightMsg, 'encounter_images', {
        agent: 'ImageGenerationService',
        context: { provider: preflight.provider, latencyMs: preflight.latencyMs, reason: preflight.reason, failureKind: 'provider_preflight' },
      });
    }
    console.warn(`[Pipeline] Soft-failing encounter provider preflight and continuing generation: ${reason}`);
  }

  /**
   * Resolve common protagonist template tokens before constructing image prompts.
   * Image generation happens outside runtime text rendering, so these must be concretized.
   */
  private resolvePlayerTemplates(text: string, brief: FullCreativeBrief): string {
    const name = brief.protagonist?.name || 'Protagonist';
    const pronounsRaw = (brief.protagonist?.pronouns || 'he/him').toLowerCase();
    const pronounMap: Record<string, { they: string; them: string; their: string; theirs: string; themselves: string }> = {
      'he/him': { they: 'he', them: 'him', their: 'his', theirs: 'his', themselves: 'himself' },
      'she/her': { they: 'she', them: 'her', their: 'her', theirs: 'hers', themselves: 'herself' },
      'they/them': { they: 'they', them: 'them', their: 'their', theirs: 'theirs', themselves: 'themselves' },
    };
    const pronouns = pronounMap[pronounsRaw] || pronounMap['he/him'];
    return (text || '')
      .replace(/\{\{player\.name\}\}/gi, name)
      .replace(/\{\{player\.they\}\}/gi, pronouns.they)
      .replace(/\{\{player\.them\}\}/gi, pronouns.them)
      .replace(/\{\{player\.their\}\}/gi, pronouns.their)
      .replace(/\{\{player\.theirs\}\}/gi, pronouns.theirs)
      .replace(/\{\{player\.themselves\}\}/gi, pronouns.themselves);
  }

  private inferEncounterCameraAngle(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): 'wide_establishing' | 'medium_action' | 'close_dramatic' | 'low_heroic' | 'high_vulnerability' | 'dutch_chaos' | 'over_shoulder' | 'reaction_shot' {
    const lowered = (text || '').toLowerCase();
    if (phase === 'setup') return 'wide_establishing';
    if (/(strikes?|lunges?|explodes?|impact|collides?)/.test(lowered)) return 'close_dramatic';
    if (/(stagger|retreat|falls?|wounded|defeat|recoil)/.test(lowered)) return 'high_vulnerability';
    if (phase === 'peak') return 'low_heroic';
    if (phase === 'resolution') return 'reaction_shot';
    return 'medium_action';
  }

  private inferEncounterMood(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): 'anticipation' | 'dynamic_action' | 'triumphant' | 'desperate' | 'tense_uncertainty' | 'relief' | 'dread' {
    const lowered = (text || '').toLowerCase();
    if (phase === 'setup') return 'anticipation';
    if (/(victory|wins?|overpower|breakthrough)/.test(lowered)) return 'triumphant';
    if (/(fail|wound|desperate|panic|collapse|overwhelmed)/.test(lowered)) return 'desperate';
    if (phase === 'peak') return 'dynamic_action';
    if (phase === 'resolution') return 'relief';
    return 'tense_uncertainty';
  }

  private buildEncounterVisualContract(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): EncounterVisualContract {
    const cleaned = (text || '').trim();
    const action = cleaned.match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?)\b/i)?.[0];
    const detail = cleaned.match(/\b(key|blade|blood|door|map|weapon|wound|fist|hands?|letter|ring|gun|knife|tear|glance)\b/i)?.[0];
    const shotDescription = phase === 'setup'
      ? 'establishing medium-wide frame with relational spacing'
      : phase === 'peak'
        ? 'tight dramatic frame at the decisive instant'
        : phase === 'resolution'
          ? 'reaction-driven medium close shot with aftermath readable in posture'
          : 'medium shot that keeps bodies, faces, and pressure readable';
    return {
      visualMoment: cleaned || 'A tense encounter moment frozen at the decisive instant.',
      primaryAction: action ? `protagonist ${action}` : `protagonist reacts under ${phase} pressure`,
      emotionalRead: phase === 'peak'
        ? 'faces and posture show maximum strain and commitment'
        : phase === 'resolution'
          ? 'visible aftermath in breathing, gaze, and shoulder release/tension'
          : 'emotion reads through eyes, jaw, and weight shift',
      relationshipDynamic: phase === 'setup'
        ? 'opponents sizing each other up with contested space'
        : 'clear pressure exchange between protagonist and opposition',
      mustShowDetail: detail
        ? `the ${detail} as the decisive visual clue`
        : 'one concrete prop or body cue that proves the outcome',
      keyExpression: phase === 'resolution'
        ? 'aftermath visible in the eyes and mouth'
        : phase === 'peak'
          ? 'strain, focus, and emotional commitment readable at a glance'
          : 'emotion clear in the face before the next move lands',
      keyGesture: action ? `hands and body clearly readable during "${action}"` : 'one decisive hand or body gesture carries the scene',
      keyBodyLanguage: phase === 'setup'
        ? 'stance and spacing define the power balance'
        : 'posture and weight shift show who is pressing and who is yielding',
      shotDescription,
      emotionalCore: phase === 'resolution' ? 'aftermath and cost' : phase === 'peak' ? 'decision under pressure' : 'rising interpersonal tension',
      visualNarrative: cleaned || 'The image should clearly communicate the encounter turn without needing caption text.',
      includeExpressionRefs: phase !== 'setup',
    };
  }

  private shouldUseExpressionReferencesForEncounter(
    encounter: Pick<EncounterStructure, 'encounterType' | 'encounterStyle'>,
    visualContract?: EncounterVisualContract
  ): boolean {
    if (visualContract?.includeExpressionRefs) return true;
    const type = (encounter.encounterType || '').toLowerCase();
    const style = (encounter.encounterStyle || '').toLowerCase();
    return ['social', 'romantic', 'dramatic', 'negotiation', 'investigation', 'mixed'].includes(type)
      || ['social', 'romantic', 'dramatic', 'mystery'].includes(style);
  }

  /**
   * Get character ID(s) for a speaker name
   */
  private getCharacterIdBySpeaker(speakerName: string, characterBible: CharacterBible): string[] {
    const char = characterBible.characters.find(
      c => c.name.toLowerCase() === speakerName.toLowerCase() ||
           c.id.toLowerCase() === speakerName.toLowerCase()
    );
    return char ? [char.id] : [];
  }

  /**
   * Analyze which characters are relevant to a specific beat and classify their visual role.
   * 
   * Returns:
   * - foreground: Characters who are the visual focus (speaking, performing action, being addressed)
   * - background: Characters present in the scene but not the focus of this beat
   * - sceneCharacterNames: Map of character ID → name for the prompt
   */
  private analyzeBeatCharacters(
    beatText: string,
    beatSpeaker: string | undefined,
    sceneCharacterIds: string[],
    characterBible: CharacterBible,
    protagonistId: string
  ): { foreground: string[]; background: string[]; foregroundNames: string[]; backgroundNames: string[] } {
    const foregroundIds = new Set<string>();
    const textLower = beatText.toLowerCase();

    // 1. Speaker is always foreground
    if (beatSpeaker) {
      const speakerChar = characterBible.characters.find(
        c => c.name.toLowerCase() === beatSpeaker.toLowerCase() || c.id.toLowerCase() === beatSpeaker.toLowerCase()
      );
      if (speakerChar) foregroundIds.add(speakerChar.id);
    }

    // 2. Scan beat text for character names — mentioned characters are foreground
    for (const charId of sceneCharacterIds) {
      const char = characterBible.characters.find(c => c.id === charId);
      if (!char) continue;
      
      const nameLower = char.name.toLowerCase();
      // Check for name mention (word boundary aware)
      // Also check for common name fragments (e.g., "Tyrell" matches "Eldon Tyrell")
      const nameWords = nameLower.split(/\s+/);
      const isMentioned = textLower.includes(nameLower) || 
        nameWords.some(word => word.length > 2 && textLower.includes(word));
      
      if (isMentioned) {
        foregroundIds.add(char.id);
      }
    }

    // 3. Check for second-person address ("you") — protagonist is foreground
    if (textLower.includes('you ') || textLower.includes('your ') || textLower.startsWith('you')) {
      foregroundIds.add(protagonistId);
    }

    // 4. If no one is explicitly foreground, protagonist is the default focus
    if (foregroundIds.size === 0) {
      foregroundIds.add(protagonistId);
    }

    // 5. All other scene characters are background
    const foreground = Array.from(foregroundIds);
    const background = sceneCharacterIds.filter(id => !foregroundIds.has(id));

    // Map IDs to names
    const getName = (id: string) => characterBible.characters.find(c => c.id === id)?.name || id;
    
    return {
      foreground,
      background,
      foregroundNames: foreground.map(getName),
      backgroundNames: background.map(getName),
    };
  }

  /**
   * Determine whether a beat is a pure establishing/atmospheric shot with no character action.
   * Used as a fallback when SceneWriter did not set an explicit shotType.
   * Returns true when the beat text describes environment/atmosphere without a character performing
   * a specific action — no speaker, no action verbs, protagonist only in foreground via "you/your".
   */
  private isEstablishingBeat(
    beatText: string,
    speaker: string | undefined,
    _primaryAction: string | undefined,
    beatCharContext: { foreground: string[]; foregroundNames: string[] }
  ): boolean {
    // A speaker means dialogue — definitely a character beat
    if (speaker) return false;

    const lowered = beatText.toLowerCase();

    // Strong action verbs signal a character beat
    const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?\s+forward|stumbles?|lunges?|pushes?|pulls?|raises?|strikes?|dodges?|fires?|shoots?|charges?|slams?|throws?|catches?|turns?\s+to|walks?|runs?|confronts?|advances?)\b/.test(lowered);
    if (hasActionVerb) return false;

    // Character dialogue markers (attributions)
    const hasDialogue = /["'"][^"']{3,}["'"]/g.test(beatText);
    if (hasDialogue) return false;

    // The protagonist only got into foreground because of "you/your" second-person address
    // (i.e., foreground has exactly one character and it's the protagonist)
    // If there are named NPCs in the foreground it's a character beat
    if (beatCharContext.foregroundNames.length > 1) return false;

    // Atmospheric environment keywords
    const hasAtmosphericEnv = /\b(rain|neon|window|street|city|sky|horizon|corridor|room|space|building|apartment|hall|fog|darkness|shadow|landscape|alley|crowd|distance|ceiling|floor|light|wall|door)\b/.test(lowered);

    // Passive/observational description — no action being performed by the viewpoint character
    const isPassiveDescription = !/\b(you\s+(turn|step|move|walk|run|reach|grab|look\s+at|face|stand\s+up|sit\s+down|rise|approach|back\s+away|push|pull|draw|aim|strike|throw|fire|shout|cry|say|ask|reply))\b/.test(lowered);

    return hasAtmosphericEnv && isPassiveDescription;
  }

  /**
   * Gather enriched reference images for characters to pass to image generation.
   * Uses the cached reference sheets from ImageAgentTeam.
   * Returns enriched metadata (character name, view type, visual anchors) so
   * provider adapters can build optimal labels for each image.
   */
  /**
   * Build compact visual identity descriptions for characters present in a shot/beat.
   * These go into the image prompt text so Gemini never contradicts hair color, build, etc.
   */

  /**
   * Recursively wire encounter images into a choice tree.
   * Matches the composite key scheme from generateEncounterTreeImages.
   * Completeness is enforced by encounterSlotManifest + retries; this wiring
   * applies URLs onto the encounter object for the story payload.
   */
  private wireEncounterTreeImages(
    choices: Array<{ id: string; outcomes?: Record<string, any> }>,
    beatId: string,
    pathPrefix: string,
    setupImages: Map<string, string>,
    outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>,
    parentSituationImage?: string,
  ): { setupCount: number; outcomeCount: number } {
    let setupCount = 0;
    let outcomeCount = 0;

    for (const choice of choices) {
      if (!choice.outcomes) continue;
      const choiceKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
      const outcomeUrls = outcomeImages.get(choiceKey);

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        const outcome = choice.outcomes[tier];
        if (!outcome) continue;

        if (outcomeUrls?.[tier]) {
          outcome.outcomeImage = outcomeUrls[tier];
          outcomeCount++;
        } else if (!outcome.outcomeImage && parentSituationImage) {
          outcome.outcomeImage = parentSituationImage;
        }

        if (outcome.nextSituation) {
          const situationKey = encounterSituationKey(beatId, choiceKey, tier);
          const legacySituationKey = legacyEncounterSituationKey(choiceKey, tier);
          const sitImage = setupImages.get(situationKey) || setupImages.get(legacySituationKey);
          if (sitImage) {
            outcome.nextSituation.situationImage = sitImage;
            setupCount++;
          }

          if (outcome.nextSituation.choices && outcome.nextSituation.choices.length > 0) {
            const nestedPrefix = `${choiceKey}::${tier}`;
            const nested = this.wireEncounterTreeImages(
              outcome.nextSituation.choices,
              beatId,
              nestedPrefix,
              setupImages,
              outcomeImages,
              outcome.nextSituation.situationImage || parentSituationImage,
            );
            setupCount += nested.setupCount;
            outcomeCount += nested.outcomeCount;
          }
        }
      }
    }

    return { setupCount, outcomeCount };
  }

  /**
   * Retry pass: walk the encounter choice tree and retry generation for any
   * outcome or situation image still missing from the maps after the initial pass.
   * Uses simplified prompts but preserves reference images for character identity.
   */
  private async retryMissingEncounterTreeImages(
    choices: Array<{ id: string; text?: string; outcomes?: Record<string, any> }>,
    pathPrefix: string,
    sceneId: string,
    encounterId: string,
    beatId: string,
    context: {
      referenceImages: ReferenceImage[];
      characterIds: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      brief: FullCreativeBrief;
      encounter: EncounterStructure;
      settingContext?: SceneSettingContext;
    },
    maps: {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    },
    counters: { imagesGenerated: number; imagesAttempted: number; globalIndex: number; total: number },
    encounterPolicy: EncounterProviderPolicy,
    resumeSet: Set<string>,
    markResumeDone: (baseId: string) => Promise<void>,
    onEncounterSlotFailure: (err: unknown) => Promise<void>,
    depth: number = 0,
  ): Promise<{ retried: number; recovered: number }> {
    let retried = 0;
    let recovered = 0;
    if (depth > ENCOUNTER_TREE_MAX_DEPTH) return { retried, recovered };

    const { referenceImages, characterIds, characterNames, characterDescriptions, brief, encounter, settingContext } = context;
    const scopedSceneId = this.getEpisodeScopedSceneId(brief, sceneId);
    const hasRefs = referenceImages.length > 0;

    for (const choice of choices) {
      if (!choice.outcomes) continue;
      const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
      const existingOutcomes = maps.outcomeImages.get(choiceMapKey) || {};

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        await this.checkCancellation();
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData) continue;
        if (existingOutcomes[tier]) continue;

        retried++;
        const retryOutcomeId = encounterOutcomeRetryIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        const outcomeBaseId = encounterOutcomeIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        const narrativeText = this.resolvePlayerTemplates(
          this.normalizeNarrativeText(outcomeData.narrativeText, `${tier} outcome`),
          brief,
        );

        const moodMap = { success: 'triumphant' as const, complicated: 'tense_uncertainty' as const, failure: 'desperate' as const };
        const simpleCinematic = {
          sceneDescription: narrativeText || `${encounter.encounterType || 'dramatic'} encounter - ${tier} outcome`,
          focusSubject: 'protagonist',
          secondaryElements: [] as string[],
          cameraAngle: 'medium_action' as const,
          shotType: 'consequence' as const,
          mood: moodMap[tier],
          lightingDirection: tier === 'success' ? 'warm front lighting' : tier === 'failure' ? 'harsh side lighting' : 'neutral fill',
          colorPalette: tier === 'success' ? 'warm tones' : tier === 'failure' ? 'cold desaturated' : 'muted mixed',
          characterStates: [
            { characterId: brief.protagonist.id || 'protagonist', pose: 'center frame', expression: 'determined', position: 'center' },
          ],
        };

        try {
          console.log(`[Pipeline] RETRY: Generating ${tier} image for ${choiceMapKey} (simplified prompt, ${hasRefs ? referenceImages.length + ' refs' : 'no refs'})`);
          const retryPrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId,
            choiceId: choiceMapKey,
            outcomeTier: tier,
            cinematicDescription: simpleCinematic,
            encounterPhase: tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising',
            visualContract: outcomeData.visualContract || this.buildEncounterVisualContract(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'),
            genre: brief.story.genre,
            artStyle: this.config.artStyle,
            settingContext,
          });

          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            retryPrompt,
            retryOutcomeId,
            { sceneId: scopedSceneId, beatId, choiceId: choiceMapKey, type: 'encounter-outcome', tier, characters: characterIds, characterNames, characterDescriptions },
            hasRefs ? referenceImages : undefined,
            `retry:${tier}:${beatId}:${choiceMapKey}`,
            1,
            {
              preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: outcomeBaseId,
              resumeAlternateBaseIdentifiers: [retryOutcomeId],
            },
          );

          if (generated.result.imageUrl) {
            const current = maps.outcomeImages.get(choiceMapKey) || {};
            current[tier] = generated.result.imageUrl;
            maps.outcomeImages.set(choiceMapKey, current);
            counters.imagesGenerated++;
            counters.globalIndex++;
            recovered++;
            encounterPolicy.onSlotSuccess();
            await markResumeDone(outcomeBaseId);
            console.log(`[Pipeline] RETRY SUCCESS: ${tier} image for ${choiceMapKey} recovered`);
          } else {
            console.warn(`[Pipeline] RETRY FAILED: ${tier} image for ${choiceMapKey} returned no URL`);
            await onEncounterSlotFailure(new Error('no_image_url'));
          }
        } catch (retryErr) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`[Pipeline] RETRY FAILED: ${tier} image for ${choiceMapKey}: ${msg}`);
          if (retryErr instanceof PipelineError) throw retryErr;
          await onEncounterSlotFailure(retryErr);
        }

        await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
      }

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData?.nextSituation) continue;
        const nextSituation = outcomeData.nextSituation;
        if (!nextSituation.choices || nextSituation.choices.length === 0) continue;

        const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
        const legacySituationKey = legacyEncounterSituationKey(choiceMapKey, tier);
        if (!maps.setupImages.has(situationKey) && !maps.setupImages.has(legacySituationKey)) {
          retried++;
          const sitRetryId = encounterSituationRetryIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const sitBaseId = encounterSituationIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const legacySitRetryId = legacyEncounterSituationRetryIdentifier(scopedSceneId, choiceMapKey, tier);
          const legacySitBaseId = legacyEncounterSituationIdentifier(scopedSceneId, choiceMapKey, tier);
          const sitText = this.resolvePlayerTemplates(
            this.normalizeNarrativeText(nextSituation.setupText, `Next situation after ${tier}`),
            brief,
          );

          try {
            console.log(`[Pipeline] RETRY: Generating situation image for ${situationKey} (${hasRefs ? referenceImages.length + ' refs' : 'no refs'})`);
            const sitPrompt = this.encounterImageAgent.cinematicDescriptionToPrompt({
              encounterId,
              beatId,
              cinematicDescription: {
                sceneDescription: sitText || `Continuation of ${encounter.encounterType || 'dramatic'} encounter`,
                focusSubject: 'protagonist',
                secondaryElements: [],
                cameraAngle: 'medium_action' as const,
                shotType: 'tension_hold' as const,
                mood: 'tense_uncertainty' as const,
                lightingDirection: 'dramatic side lighting',
                colorPalette: 'contextual to genre',
                characterStates: [
                  { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
                ],
              },
              encounterPhase: 'setup',
              visualContract: nextSituation.visualContract || this.buildEncounterVisualContract(sitText, 'setup'),
              genre: brief.story.genre,
              artStyle: this.config.artStyle,
              settingContext,
            });

            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              sitPrompt,
              sitRetryId,
              { sceneId: scopedSceneId, beatId, type: 'encounter-setup', characters: characterIds, characterNames, characterDescriptions },
              hasRefs ? referenceImages : undefined,
              `retry:situation:${choiceMapKey}::${tier}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: sitBaseId,
                resumeAlternateBaseIdentifiers: [sitRetryId, legacySitRetryId, legacySitBaseId],
              },
            );

            if (generated.result.imageUrl) {
              maps.setupImages.set(situationKey, generated.result.imageUrl);
              maps.setupImages.set(legacySituationKey, generated.result.imageUrl);
              counters.imagesGenerated++;
              counters.globalIndex++;
              recovered++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(sitBaseId);
              console.log(`[Pipeline] RETRY SUCCESS: Situation image for ${situationKey} recovered`);
            } else {
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.error(`[Pipeline] RETRY FAILED: Situation image for ${situationKey}: ${msg}`);
            if (retryErr instanceof PipelineError) throw retryErr;
            await onEncounterSlotFailure(retryErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }

        const nestedPrefix = `${choiceMapKey}::${tier}`;
        const nestedResult = await this.retryMissingEncounterTreeImages(
          nextSituation.choices,
          nestedPrefix,
          sceneId,
          encounterId,
          beatId,
          context,
          maps,
          counters,
          encounterPolicy,
          resumeSet,
          markResumeDone,
          onEncounterSlotFailure,
          depth + 1,
        );
        retried += nestedResult.retried;
        recovered += nestedResult.recovered;
      }
    }

    return { retried, recovered };
  }

  private buildCharacterDescriptions(
    characterIds: string[],
    characterBible: CharacterBible
  ): CharacterAppearanceDescription[] {
    const descs: CharacterAppearanceDescription[] = [];
    for (const charId of characterIds) {
      const c = characterBible.characters.find(ch => ch.id === charId);
      if (!c) continue;

      // Silhouette hooks come from the visual design system and are the canonical
      // visual identity. physicalDescription is LLM-generated from source material
      // and may contradict the visual design (e.g. wrong hair color). When both
      // exist, silhouette hooks take precedence as the primary description.
      const silhouette = this.imageAgentTeam.getCharacterSilhouetteProfile(c.id);
      const hasSilhouette = silhouette?.silhouetteHooks && silhouette.silhouetteHooks.length > 0;
      const consistencyInfo = this.imageAgentTeam.getCharacterConsistencyInfo(c.id);

      const parts: string[] = [];
      if (hasSilhouette) {
        parts.push(silhouette!.silhouetteHooks!.join(', '));
      } else if (c.physicalDescription) {
        parts.push(c.physicalDescription);
      }
      if (c.distinctiveFeatures && c.distinctiveFeatures.length > 0) {
        parts.push(`Distinctive features: ${c.distinctiveFeatures.join(', ')}`);
      }
      if (c.typicalAttire) parts.push(`Attire: ${c.typicalAttire}`);

      // Build a structured canonicalAppearance by extracting semantic slots
      // from the free-form description sources. Each slot becomes its own
      // labeled line in the identity block, which dramatically reduces the
      // LLM's tendency to drop or paraphrase critical attributes (hair color,
      // eye color, distinguishing marks).
      const sources: string[] = [
        c.physicalDescription || '',
        ...(silhouette?.silhouetteHooks || []),
        ...(consistencyInfo?.visualAnchors || []),
      ].filter(Boolean);
      const canonicalAppearance = this.extractCanonicalAppearance(
        sources,
        c.distinctiveFeatures,
        c.typicalAttire,
      );

      if (parts.length > 0 || canonicalAppearance) {
        descs.push({
          name: c.name,
          appearance: parts.join('. '),
          canonicalAppearance,
        });
      }
    }
    return descs;
  }

  /**
   * Extract structured identity slots (hair, eyes, skin, build, height, face)
   * from free-form character description text. Each slot scans the merged
   * source text for phrases that match the slot's keyword set and captures the
   * surrounding words as the slot value.
   *
   * The extractor is deliberately conservative — it returns undefined for any
   * slot it can't confidently populate, leaving the fallback appearance prose
   * to cover the gap. distinctiveFeatures and typicalAttire are passed through
   * directly since they are already structured.
   */
  private extractCanonicalAppearance(
    sources: string[],
    distinctiveFeatures: string[] | undefined,
    typicalAttire: string | undefined,
  ): CanonicalAppearance | undefined {
    const text = sources.join('. ');
    if (!text && (!distinctiveFeatures || distinctiveFeatures.length === 0) && !typicalAttire) {
      return undefined;
    }

    const splitPhrases = (raw: string): string[] =>
      raw
        .split(/[.,;]|\s-\s|\s—\s/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    const phrases = splitPhrases(text);

    const findPhrase = (keywords: RegExp): string | undefined => {
      for (const p of phrases) {
        if (keywords.test(p)) return p;
      }
      return undefined;
    };

    const ca: CanonicalAppearance = {};

    const hairPhrase = findPhrase(/\b(hair|hairstyle|braid|ponytail|locks|mane|curls|dreadlocks)\b/i);
    if (hairPhrase) ca.hair = hairPhrase;

    const eyesPhrase = findPhrase(/\b(eyes|eye|iris|gaze)\b/i);
    if (eyesPhrase) ca.eyes = eyesPhrase;

    const skinPhrase = findPhrase(/\b(skin|complexion|tan|pale|sunburn(?:t|ed)?|freckl(?:e|ed|es))\b/i);
    if (skinPhrase) ca.skinTone = skinPhrase;

    const buildPhrase = findPhrase(/\b(build|physique|stature|frame|muscled|slender|broad|lean|stocky|wiry|sinewy)\b/i);
    if (buildPhrase) ca.build = buildPhrase;

    const heightPhrase = findPhrase(/\b(tall|short|height|petite|towering|diminutive)\b/i);
    if (heightPhrase) ca.height = heightPhrase;

    const facePhrase = findPhrase(/\b(face|jaw|jawline|cheekbones?|nose|chin|brow|forehead)\b/i);
    if (facePhrase) ca.face = facePhrase;

    if (distinctiveFeatures && distinctiveFeatures.length > 0) {
      ca.distinguishingMarks = distinctiveFeatures.slice(0, 6);
    }
    if (typicalAttire) {
      ca.defaultAttire = typicalAttire;
    }

    const hasAny = Object.values(ca).some((v) =>
      Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.length > 0
    );
    return hasAny ? ca : undefined;
  }

  private gatherCharacterReferenceImages(
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ): Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }> {
    const MAX_TOTAL_REFS = 12;
    const references: Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }> = [];
    
    const gemSettings = this.imageService.getGeminiSettings();
    const mjSettings = this.imageService.getMidjourneySettings();
    const maxPerChar = gemSettings.maxRefImagesPerCharacter || mjSettings.maxRefImagesPerCharacter || 2;
    // Dual-artifact routing: always request the individual views here. The
    // composite sheet is added separately below with a canonical
    // `composite-sheet` role so the per-provider filter can route it
    // correctly (Midjourney --cref, Gemini style-anchor).
    const preferIndividualViews = true;
    
    for (const charId of characterIds) {
      if (references.length >= MAX_TOTAL_REFS) break;
      const remaining = MAX_TOTAL_REFS - references.length;
      const charRefs = this.imageAgentTeam.getCharacterReferenceImages(
        charId,
        options?.includeExpressions === true,
        Math.min(maxPerChar, remaining),
        undefined,
        preferIndividualViews
      );
      
      const consistencyInfo = this.imageAgentTeam.getCharacterConsistencyInfo(charId);
      const visualAnchors = consistencyInfo?.visualAnchors;
      
      const charEntry = characterBible.characters.find(c => c.id === charId);
      const characterName = charEntry?.name || charId;
      
      for (const ref of charRefs) {
        const nameParts = ref.name.split('-');
        const viewType = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'front';

        // Canonical role tagging so the per-provider filter can route by
        // artifact shape. `character-reference-face` keeps the face-crop
        // elevated in rolePriority; expression views keep the 'expression'
        // token so rolePriority routes them correctly.
        let role: string;
        if (viewType === 'face') {
          role = 'character-reference-face';
        } else if (ref.name.includes('expression')) {
          role = `character-reference-expression-${viewType}`;
        } else {
          role = 'character-reference';
        }

        references.push({
          data: ref.data,
          mimeType: ref.mimeType,
          role,
          characterName,
          viewType,
          visualAnchors,
        });
      }

      // Emit the composite model sheet as a separate artifact with its own
      // canonical role. Downstream provider filters will either drop it
      // (Gemini/Atlas — promoted to style anchor instead) or surface it
      // as Midjourney `--cref`. Always tag it so the filter can find it.
      if (references.length < MAX_TOTAL_REFS) {
        const composite = this.imageAgentTeam.getCompositeReferenceImage(charId);
        if (composite) {
          references.push({
            data: composite.data,
            mimeType: composite.mimeType,
            role: 'composite-sheet',
            characterName,
            viewType: 'composite',
            visualAnchors,
          });
        }
      }

      if (consistencyInfo) {
        this.emit({ type: 'debug', phase: 'images', message: `Using ${charRefs.length} ref image(s) for ${characterName}: ${consistencyInfo.visualAnchors.join(', ')}` });
      }
    }
    
    // Include location master shot if available and within budget
    if (locationId && references.length < MAX_TOTAL_REFS) {
      const masterShot = this.locationMasterShots.get(locationId);
      if (masterShot) {
        references.push({
          data: masterShot.data,
          mimeType: masterShot.mimeType,
          role: 'location-master-shot',
          characterName: '',
          viewType: 'location',
        });
      }
    }
    
    const family = options?.family;
    if (!family) {
      return references;
    }

    // D3: derive per-character weights from their bible importance. Weights
    // are multiplied against the profile's maxPerCharacter so major characters
    // get more ref-pack slots than supporting/minor ones.
    const characterWeights: Record<string, number> = {};
    for (const charId of characterIds) {
      const entry = characterBible.characters.find((c) => c.id === charId);
      if (!entry) continue;
      const name = entry.name || charId;
      const importance = (entry.importance || '').toLowerCase();
      if (entry.role?.toLowerCase() === 'protagonist' || importance === 'major') {
        characterWeights[name] = 1.5;
      } else if (importance === 'supporting') {
        characterWeights[name] = 1.0;
      } else if (importance === 'minor') {
        characterWeights[name] = 0.75;
      }
    }

    return buildReferencePack(
      options.slotId || `${family}:${characterIds.join(',')}`,
      family,
      references,
      { characterWeights },
    ).references;
  }

  /**
   * Gather body vocabularies for characters to pass to StoryboardAgent
   * Enables character-specific pose consistency
   */
  private gatherCharacterBodyVocabularies(
    characterIds: string[],
    characterBible: CharacterBible
  ): Array<{
    characterId: string;
    characterName: string;
    basePosture: string;
    gestureStyle: string;
    characteristicPoses: string[];
    statusBehavior: string;
    emotionalTells: string;
  }> {
    const vocabularies: Array<{
      characterId: string;
      characterName: string;
      basePosture: string;
      gestureStyle: string;
      characteristicPoses: string[];
      statusBehavior: string;
      emotionalTells: string;
    }> = [];

    for (const charId of characterIds) {
      // Look up the body vocabulary from collected visual planning
      const charRef = this.collectedVisualPlanning.characterReferences.get(charId);
      
      if (charRef?.bodyVocabulary) {
        const bv = charRef.bodyVocabulary;
        // Extract descriptions from the structured objects
        const basePostureDesc = typeof bv.basePosture === 'object' && bv.basePosture?.description 
          ? bv.basePosture.description 
          : (typeof bv.basePosture === 'string' ? bv.basePosture : 'neutral standing');
        const gestureStyleDesc = typeof bv.gestureStyle === 'object' && bv.gestureStyle?.description
          ? bv.gestureStyle.description
          : (typeof bv.gestureStyle === 'string' ? bv.gestureStyle : 'moderate gestures');
        
        // Extract signature poses as simple descriptions
        const signaturePoses = bv.signaturePoses?.map((p: { poseDescription?: string; situation?: string }) => 
          p.poseDescription || p.situation || ''
        ).filter(Boolean) || [];
        
        // Build status behavior from statusDefaults
        const statusDefaults = bv.statusDefaults;
        const statusBehavior = statusDefaults 
          ? `with superiors: ${statusDefaults.withSuperiors || 'respectful'}, with equals: ${statusDefaults.withEquals || 'collaborative'}, with subordinates: ${statusDefaults.withSubordinates || 'supportive'}`
          : 'adapts to social context';
        
        // Combine stress and comfort tells
        const stressTells = bv.stressTells || [];
        const comfortTells = bv.comfortTells || [];
        const emotionalTells = [
          stressTells.length > 0 ? `stress: ${stressTells.slice(0, 2).join(', ')}` : '',
          comfortTells.length > 0 ? `comfort: ${comfortTells.slice(0, 2).join(', ')}` : ''
        ].filter(Boolean).join('; ') || 'shows emotion through face and body language';
        
        vocabularies.push({
          characterId: charId,
          characterName: charRef.characterName,
          basePosture: basePostureDesc,
          gestureStyle: gestureStyleDesc,
          characteristicPoses: signaturePoses.slice(0, 3), // Limit to top 3
          statusBehavior,
          emotionalTells
        });
      } else {
        // Fallback: Try to get character info from bible and create minimal vocabulary
        const charProfile = characterBible.characters?.find((c: { id: string }) => c.id === charId);
        
        if (charProfile) {
          // Create a basic vocabulary based on traits and overview
          const personalityText = [
            ...(charProfile.traits || []),
            charProfile.overview || ''
          ].join(' ');
          vocabularies.push({
            characterId: charId,
            characterName: charProfile.name,
            basePosture: this.inferBasePostureFromPersonality(personalityText),
            gestureStyle: this.inferGestureStyleFromPersonality(personalityText),
            characteristicPoses: [],
            statusBehavior: 'adapts to social context',
            emotionalTells: 'shows emotion through face and body language'
          });
        }
      }
    }

    return vocabularies;
  }

  /**
   * Infer base posture from personality description
   */
  private inferBasePostureFromPersonality(personality: string): string {
    const lower = (personality || '').toLowerCase();
    if (lower.includes('confident') || lower.includes('bold') || lower.includes('brash')) {
      return 'upright, open chest, chin slightly raised, expansive';
    }
    if (lower.includes('shy') || lower.includes('reserved') || lower.includes('anxious')) {
      return 'slightly hunched, arms close to body, compact';
    }
    if (lower.includes('regal') || lower.includes('noble') || lower.includes('proud')) {
      return 'perfectly upright, formal, controlled movements';
    }
    if (lower.includes('relaxed') || lower.includes('laid-back') || lower.includes('casual')) {
      return 'loose, weight on one leg, relaxed shoulders';
    }
    return 'natural, comfortable standing posture';
  }

  /**
   * Infer gesture style from personality description
   */
  private inferGestureStyleFromPersonality(personality: string): string {
    const lower = (personality || '').toLowerCase();
    if (lower.includes('expressive') || lower.includes('dramatic') || lower.includes('theatrical')) {
      return 'large, sweeping gestures, uses whole arm';
    }
    if (lower.includes('reserved') || lower.includes('controlled') || lower.includes('formal')) {
      return 'minimal, precise gestures, hands often clasped or still';
    }
    if (lower.includes('nervous') || lower.includes('anxious') || lower.includes('fidgety')) {
      return 'small, quick gestures, self-touching, fidgeting';
    }
    return 'natural, moderate hand gestures when speaking';
  }

  private summarizeEpisode(episode: Episode): string {
    return `${episode.title}: ${episode.synopsis}`;
  }

  /**
   * Shape the unresolved callback hooks for SceneWriter/ChoiceAuthor prompts.
   * Returns `undefined` when there are no hooks, so the prompt section is
   * skipped cleanly. See Plan 1 (docs/PLAN_DELAYED_CONSEQUENCES.md).
   */
  private getUnresolvedCallbacksForPrompt(episodeNumber: number | undefined): Array<{
    id: string;
    sourceEpisode: number;
    summary: string;
    flags: string[];
  }> | undefined {
    if (!episodeNumber || episodeNumber <= 1) return undefined;
    const hooks = this.callbackLedger.unresolvedFor(episodeNumber);
    if (hooks.length === 0) return undefined;
    return hooks.map((hook) => ({
      id: hook.id,
      sourceEpisode: hook.sourceEpisode,
      summary: hook.summary,
      flags: hook.flags,
    }));
  }

  /**
   * Harvest callback state from a just-generated episode: seed new hooks
   * from `memorableMoment` choice fields, and record payoffs for any
   * TextVariants that reference an existing hook id.
   */
  private harvestEpisodeCallbacks(params: {
    episodeNumber: number;
    sceneContents: Array<{ sceneId: string; beats: Array<{ id?: string; textVariants?: Array<{ callbackHookId?: string }>; choices?: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] } }> }> }>;
    choiceSets: Array<{ sceneId?: string; beatId?: string; choices: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] }; consequences?: unknown[] }> }>;
  }): { newHooks: number; payoffs: number } {
    let newHooks = 0;
    let payoffs = 0;

    for (const choiceSet of params.choiceSets) {
      const sceneId = choiceSet.sceneId || '';
      for (const choice of choiceSet.choices || []) {
        if (choice.memorableMoment?.id) {
          const added = this.callbackLedger.recordChoice({
            choice: choice as unknown as Choice,
            episode: params.episodeNumber,
            sceneId,
          });
          if (added) newHooks += 1;
        }
      }
    }

    for (const scene of params.sceneContents) {
      for (const beat of scene.beats || []) {
        if (beat.choices) {
          for (const choice of beat.choices) {
            if (choice.memorableMoment?.id) {
              const added = this.callbackLedger.recordChoice({
                choice: choice as unknown as Choice,
                episode: params.episodeNumber,
                sceneId: scene.sceneId,
              });
              if (added) newHooks += 1;
            }
          }
        }
        if (beat.textVariants) {
          const matched = this.callbackLedger.recordPayoffsFromVariants(beat.textVariants);
          payoffs += matched.length;
        }
      }
    }

    return { newHooks, payoffs };
  }

  /**
   * Synthesize specific action directions when primaryAction is missing or generic.
   * Analyzes beat text to extract physical manifestations of the story moment.
   */
  private synthesizeActionFromBeat(beatText: string, emotionalRead: string, characterNames: string[]): {
    synthesizedAction: string;
    synthesizedGesture: string;
    synthesizedBodyLanguage: string;
  } {
    const text = (beatText || '').toLowerCase();
    const charName = characterNames.length > 0 ? characterNames[0] : 'Character';
    const secondChar = characterNames.length > 1 ? characterNames[1] : '';

    // Check for dialogue patterns - derive gesture from speaking
    const isDialogue = text.includes('"') || text.includes('says') || text.includes('speaks') ||
                       text.includes('tells') || text.includes('asks') || text.includes('replies');

    // Check for emotional patterns
    const isAngry = /\b(angry|furious|rage|seething|snaps?|shouts?|yells?)\b/.test(text);
    const isSad = /\b(sad|tears?|crying|weeping|grief|mourning|heartbroken)\b/.test(text);
    const isFearful = /\b(fear|afraid|terrified|scared|trembl|shaking)\b/.test(text);
    const isLoving = /\b(love|tender|gentle|embrace|caress|soft)\b/.test(text);
    const isShocked = /\b(shock|gasp|surprise|stun|disbelief|realiz)\b/.test(text);
    const isThreatening = /\b(threat|menac|intimi|warn|danger|loom)\b/.test(text);
    const isDefensive = /\b(defend|protect|shield|guard|back away|retreat)\b/.test(text);
    const isConfronting = /\b(confront|accus|demand|challeng|face)\b/.test(text);

    // Check for action verbs
    const hasMovement = /\b(walks?|steps?|moves?|runs?|rushes?|approaches?|enters?|leaves?)\b/.test(text);
    const hasTurning = /\b(turns?|spins?|whirls?|faces?|looks? away)\b/.test(text);
    const hasReaching = /\b(reaches?|grabs?|takes?|holds?|touches?|grips?)\b/.test(text);
    const hasPushing = /\b(pushes?|shoves?|pulls?|drags?)\b/.test(text);

    let synthesizedAction = '';
    let synthesizedGesture = '';
    let synthesizedBodyLanguage = '';

    // Synthesize based on detected patterns
    if (isAngry) {
      synthesizedAction = `${charName} confronts with visible tension — jaw set, shoulders squared`;
      synthesizedGesture = 'Hands clenched into fists or gesturing sharply, finger pointing or palm-out stop gesture';
      synthesizedBodyLanguage = `Weight forward aggressively, chin down, chest expanded, body angled toward ${secondChar || 'target'}`;
    } else if (isFearful) {
      synthesizedAction = `${charName} recoils or shrinks back — protective posture`;
      synthesizedGesture = 'Hands raised defensively near chest, palms out, or arms wrapped around self';
      synthesizedBodyLanguage = 'Weight on back foot, shoulders hunched, body angled away, ready to flee';
    } else if (isSad) {
      synthesizedAction = `${charName} shows visible grief — head bowed, shoulders dropped`;
      synthesizedGesture = 'Hand covering mouth, pressing against chest, or wiping at face';
      synthesizedBodyLanguage = 'Weight collapsed inward, spine curved, gaze downward';
    } else if (isShocked) {
      synthesizedAction = `${charName} freezes mid-motion in visible shock — eyes wide, body rigid`;
      synthesizedGesture = 'Hand flying to mouth or chest, fingers spread in surprise';
      synthesizedBodyLanguage = 'Weight suddenly shifted back, body frozen mid-action, spine straightened with tension';
    } else if (isLoving) {
      synthesizedAction = `${charName} leans toward ${secondChar || 'other'} with tender vulnerability`;
      synthesizedGesture = 'Hand reaching out gently, fingertips grazing or about to touch';
      synthesizedBodyLanguage = 'Weight forward, shoulders soft and open, head tilted with care';
    } else if (isThreatening) {
      synthesizedAction = `${charName} looms or advances with menacing intent`;
      synthesizedGesture = 'Hands open but tense at sides, or one hand raised in warning';
      synthesizedBodyLanguage = 'Weight forward, expanded posture, chin lowered, eyes fixed and intense';
    } else if (isDefensive) {
      synthesizedAction = `${charName} backs away or shields themselves`;
      synthesizedGesture = 'Arms crossed or raised protectively, hands between self and threat';
      synthesizedBodyLanguage = 'Weight shifting backward, shoulders rotating away, creating distance';
    } else if (isConfronting) {
      synthesizedAction = `${charName} faces ${secondChar || 'other'} directly with challenging stance`;
      synthesizedGesture = 'Hands on hips, or gesturing emphatically, pointing or palm-up demanding';
      synthesizedBodyLanguage = 'Weight centered but leaning forward, squared shoulders, direct eye contact';
    } else if (isDialogue) {
      synthesizedAction = `${charName} speaks with emotional weight — body reflects words`;
      synthesizedGesture = 'Hands gesturing to emphasize points, or fidgeting with nearby object';
      synthesizedBodyLanguage = emotionalRead
        ? `Body showing: ${emotionalRead}. Weight shifted, posture reflecting emotional state`
        : 'Natural conversational stance with weight on one foot, hands active';
    } else if (hasMovement) {
      synthesizedAction = `${charName} in motion — mid-stride or transitioning between positions`;
      synthesizedGesture = 'Arms swinging naturally or reaching toward destination';
      synthesizedBodyLanguage = 'Weight clearly distributed in motion, one foot leading, body angled in direction of travel';
    } else if (hasTurning) {
      synthesizedAction = `${charName} turns or pivots — caught in moment of change`;
      synthesizedGesture = 'Arms adjusting balance, or hand trailing behind the turn';
      synthesizedBodyLanguage = 'Weight shifting mid-rotation, shoulders and hips at different angles, torso twisted';
    } else if (hasReaching) {
      synthesizedAction = `${charName} reaches out — arm extended toward goal`;
      synthesizedGesture = 'Fingers spread or closing around target, other hand bracing or balancing';
      synthesizedBodyLanguage = 'Weight shifted toward reach, body stretched, clear intention in posture';
    } else if (hasPushing) {
      synthesizedAction = `${charName} exerts force — body engaged in push or pull`;
      synthesizedGesture = 'Hands pressed against surface or gripping firmly';
      synthesizedBodyLanguage = 'Weight committed to the action, legs braced, core engaged';
    } else {
      // Default fallback - still better than nothing
      synthesizedAction = `${charName} caught in a moment of dramatic tension — body reveals inner state`;
      synthesizedGesture = 'Hands engaged in meaningful activity — gripping, gesturing, or pressing against something';
      synthesizedBodyLanguage = `Weight shifted to one side, asymmetric stance, ${emotionalRead ? `body showing: ${emotionalRead}` : 'posture reflecting emotional intensity'}`;
    }

    return { synthesizedAction, synthesizedGesture, synthesizedBodyLanguage };
  }

  /**
   * Validate a generated image and return guidance for regeneration if needed.
   * Uses vision-based analysis to check for stiff poses, neutral expressions, etc.
   */
  private async validateAndRegenerateImage(
    prompt: ImagePrompt,
    identifier: string,
    metadata: { sceneId: string; beatId: string; type: string; characters: string[]; characterNames: string[]; characterDescriptions: string[]; includeExpressionRefs?: boolean },
    referenceImages: Array<{ data: string; mimeType: string }> | undefined,
    maxAttempts: number = 2
  ): Promise<{ imageUrl?: string; imageData?: string; mimeType?: string }> {
    const MAX_REGENERATION_ATTEMPTS = maxAttempts;
    const gemSettings = this.imageService.getGeminiSettings();
    const usePreview = gemSettings.usePreviewForValidation && this.imageService.isNB2OrProModel();

    for (let attempt = 0; attempt < MAX_REGENERATION_ATTEMPTS; attempt++) {
      try {
        // On retry attempts with preview validation: generate at 512px first to
        // validate the strengthened prompt before committing to full resolution
        if (attempt > 0 && usePreview) {
          console.log(`[Pipeline] Preview validation: generating 512px preview for ${metadata.beatId} (attempt ${attempt + 1})`);
          const currentSettings = { ...this.imageService.getGeminiSettings() };
          this.imageService.updateGeminiSettings({ ...currentSettings, sceneResolution: '512px' });
          try {
            const previewResult = await this.imageService.generateImage(
              prompt, `${identifier}_preview_${attempt}`, metadata, referenceImages
            );
            if (!previewResult.imageData || !previewResult.mimeType) {
              console.warn(`[Pipeline] Preview generation failed for ${metadata.beatId}, proceeding to full resolution`);
            } else {
              console.log(`[Pipeline] Preview generated for ${metadata.beatId}, proceeding to full resolution`);
            }
          } finally {
            this.imageService.updateGeminiSettings(currentSettings);
          }
        }

        const result = await this.imageService.generateImage(
          prompt,
          identifier,
          metadata,
          referenceImages
        );

        if (!result.imageUrl || !result.imageData || !result.mimeType) {
          return result;
        }

        if (attempt === 0 && MAX_REGENERATION_ATTEMPTS === 1) {
          return result;
        }

        if (attempt > 0 || MAX_REGENERATION_ATTEMPTS > 1) {
          if (attempt === 0) {
            console.log(`[Pipeline] Image generated for ${metadata.beatId}, skipping validation on first pass`);
            return result;
          }

          console.log(`[Pipeline] Regenerated image for ${metadata.beatId} (attempt ${attempt + 1}/${MAX_REGENERATION_ATTEMPTS})`);
          return result;
        }

        return result;
      } catch (err) {
        console.warn(`[Pipeline] Image generation attempt ${attempt + 1} failed:`, err);
        if (attempt === MAX_REGENERATION_ATTEMPTS - 1) {
          throw err;
        }
        prompt = this.strengthenPromptForRegeneration(prompt, attempt);
      }
    }

    return {};
  }

  /**
   * Strengthen a prompt for regeneration after a failed validation or generation
   */
  private strengthenPromptForRegeneration(prompt: ImagePrompt, attemptNumber: number): ImagePrompt {
    const strengthened = { ...prompt };

    // Add increasingly aggressive anti-stiffness directives
    const strengtheningSuffix = attemptNumber === 0
      ? ' Show dramatic action with asymmetric body language.'
      : ' CRITICAL: This MUST show dynamic movement. Weight shifted, body twisted, hands active. No symmetrical poses, no neutral expressions, no static tableaux.';

    if (strengthened.visualNarrative) {
      strengthened.visualNarrative += strengtheningSuffix;
    }

    // Strengthen body language directive
    if (strengthened.keyBodyLanguage) {
      strengthened.keyBodyLanguage += ' Body must be visibly mid-action, not standing still. Weight clearly on one foot, spine curved or twisted, shoulders asymmetric.';
    } else {
      strengthened.keyBodyLanguage = 'Dynamic body language required: weight shifted to one foot, spine showing curve or twist, shoulders at different heights, body angled. Never neutral standing pose.';
    }

    // Strengthen gesture directive
    if (strengthened.keyGesture) {
      strengthened.keyGesture += ' Hands must be doing something specific — gripping, reaching, pressing, gesturing — never hanging at sides.';
    } else {
      strengthened.keyGesture = 'Hands actively engaged: gripping an object, pressing against a surface, gesturing emphatically, or touching face/body with purpose. Never hanging loosely at sides.';
    }

    // Strengthen expression directive
    if (!strengthened.keyExpression) {
      strengthened.keyExpression = 'Clear emotional expression required. Use specific facial anatomy: furrowed brow, narrowed eyes, clenched jaw, pressed lips, flared nostrils, or their opposites for positive emotions. Never neutral or blank.';
    }

    // Add stronger negatives
    strengthened.negativePrompt = (strengthened.negativePrompt || '') +
      ', stiff pose, symmetrical stance, neutral expression, arms at sides, standing straight, evenly distributed weight, mirrored poses, static tableau, portrait composition, both characters facing camera';

    console.log(`[Pipeline] Strengthened prompt for regeneration attempt ${attemptNumber + 2}`);
    return strengthened;
  }

  /**
   * Check if a primaryAction is too generic to be useful
   */
  private isGenericAction(action: string): boolean {
    if (!action || action.trim().length === 0) return true;
    const genericPatterns = /^(standing|looking|together|sitting|waiting|being|having|feeling|thinking|watching|seeing)(\s|$)/i;
    const veryShort = action.trim().split(/\s+/).length <= 2 && !action.includes(',');
    return genericPatterns.test(action.trim()) || (veryShort && !/\b(grabs?|reaches?|recoils?|pushes?|pulls?|strikes?|dodges?|embraces?|confronts?|lunges?|stumbles?|runs?)\b/i.test(action));
  }

  // ============================================
  // STORY-TO-IMAGE DATA MAPPING HELPERS
  // ============================================

  /**
   * Generate a color script for the episode to ensure visual arc consistency
   */
  private async generateEpisodeColorScript(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[]
  ): Promise<ColorScript | undefined> {
    this.emit({ type: 'agent_start', agent: 'ColorScriptAgent', message: 'Generating episode color script...' });

    try {
      // Build story beat inputs from scene contents
      const beats: StoryBeatInput[] = [];
      let globalBeatIndex = 0;
      
      for (const scene of sceneContents) {
        const sceneIsClimactic = scene.keyMoments.some(km => 
          km.toLowerCase().includes('climax') || km.toLowerCase().includes('confrontation')
        );
        const sceneIsResolution = (Array.isArray(scene.keyMoments) ? scene.keyMoments : []).some(km => 
          km.toLowerCase().includes('resolution') || km.toLowerCase().includes('conclusion')
        );
        const sceneIsSafeHub = (Array.isArray(scene.moodProgression) ? scene.moodProgression : []).some(m => 
          m.toLowerCase().includes('calm') || m.toLowerCase().includes('safe')
        );
        
        for (let i = 0; i < scene.beats.length; i++) {
          const beat = scene.beats[i];
          const emotion = this.mapSpeakerMoodToEmotion(beat.speakerMood);
          const intensity = this.inferIntensity(beat.speakerMood, beat.text);
          
          beats.push({
            beatId: beat.id,
            beatName: `${scene.sceneName} - Beat ${i + 1}`,
            sequenceOrder: globalBeatIndex,
            narrativeDescription: beat.text.substring(0, TEXT_LIMITS.mediumPreviewLength),
            emotionalNote: `${emotion} (${intensity} intensity)`,
            isClimactic: sceneIsClimactic && i === scene.beats.length - 1, // Last beat of climactic scene
            isResolution: sceneIsResolution,
            isSafeHub: sceneIsSafeHub,
            branchType: scene.branchType || 'neutral' // Use scene's branch type for visual differentiation
          });
          globalBeatIndex++;
        }
      }

      const colorScriptRequest: ColorScriptRequest = {
        storyId: brief.story.title,
        storyTitle: brief.story.title,
        episodeId: generateEpisodeId(brief.episode.number, brief.episode.title),
        episodeTitle: brief.episode.title,
        genre: brief.story.genre,
        tone: brief.story.tone,
        beats
      };

      const result = await withTimeout(
        this.imageAgentTeam.generateColorScript(colorScriptRequest),
        PIPELINE_TIMEOUTS.colorScript, 'ColorScript'
      );
      
      if (result.success && result.data) {
        this.emit({
          type: 'agent_complete',
          agent: 'ColorScriptAgent',
          message: `Color script generated: ${result.data.beats?.length || 0} beats mapped`,
          data: { beatCount: result.data.beats?.length || 0 }
        });
        return result.data;
      }
      
      console.warn('[Pipeline] Failed to generate color script:', result.error);
      return undefined;
    } catch (err) {
      console.warn('[Pipeline] Color script generation failed:', err);
      return undefined;
    }
  }

  /**
   * Generate a dedicated episode style bible before scene renders begin.
   * This becomes the primary style anchor, replacing the old
   * "first successful scene decides the style" behavior whenever possible.
   */
  private async generateEpisodeStyleBible(
    brief: FullCreativeBrief,
    colorScript: ColorScript,
    characterBible: CharacterBible
  ): Promise<boolean> {
    this.emit({ type: 'agent_start', agent: 'ColorScriptAgent', message: 'Generating episode style bible...' });

    try {
      // Composite style string carries the full ArtStyleProfile DNA instead
      // of just the short label, so downstream prompt assembly already sees
      // "romance novel. Rendering: …. Color: …." rather than a bare name
      // that the model's priors can misinterpret.
      const profileStyle =
        composeCanonicalStyleString(this.config.imageGen?.artStyleProfile) ||
        this.config.artStyle ||
        undefined;

      const titleSlug = idSlugify(brief.story.title);
      const preapproved = this.config.imageGen?.preapprovedStyleAnchors;

      // === Arc color strip ===
      let stripImage: GeneratedImage | undefined;
      if (preapproved?.arcStrip) {
        stripImage = await this.hydratePreapprovedAnchor(preapproved.arcStrip);
        if (preapproved.arcStrip.imagePath) {
          this._styleAnchorPaths.arcStrip = preapproved.arcStrip.imagePath;
        }
        this.emit({
          type: 'info',
          phase: 'images',
          message: 'Style bible arc strip: using UI-preapproved anchor (skipping in-pipeline generation).',
        });
      } else {
        const thumbsResult = await withTimeout(
          this.imageAgentTeam.generateColorScriptThumbnails(colorScript),
          PIPELINE_TIMEOUTS.colorScript,
          'ColorScriptThumbnails'
        );

        if (!thumbsResult.success || !thumbsResult.data) {
          this.emit({ type: 'warning', phase: 'images', message: `Style bible prompt generation failed: ${thumbsResult.error || 'unknown error'}` });
          return false;
        }

        const built = buildArcStripAnchorPrompt({
          style: profileStyle,
          storyTitle: brief.story.title,
          stripPrompt: thumbsResult.data.stripPrompt,
        });
        stripImage = await withTimeout(
          this.imageService.generateImage(
            built.prompt,
            anchorIdentifier(titleSlug, built.role),
            { type: 'master' },
          ),
          PIPELINE_TIMEOUTS.imageGeneration,
          'EpisodeStyleBibleStrip'
        );
        if (stripImage?.imagePath) {
          this._styleAnchorPaths.arcStrip = stripImage.imagePath;
        }
      }

      // === Character anchor ===
      const protagonistRefImages = this.gatherCharacterReferenceImages([brief.protagonist.id], characterBible);
      const protagonistName = characterBible.characters.find(c => c.id === brief.protagonist.id)?.name || brief.protagonist.name;
      const colorTerms = colorScript.colorDictionary.slice(0, 3).map(entry => entry.color);

      let anchorImage: GeneratedImage;
      if (preapproved?.character) {
        anchorImage = await this.hydratePreapprovedAnchor(preapproved.character);
        if (preapproved.character.imagePath) {
          this._styleAnchorPaths.character = preapproved.character.imagePath;
        }
        this.emit({
          type: 'info',
          phase: 'images',
          message: 'Style bible character anchor: using UI-preapproved anchor (skipping in-pipeline generation).',
        });
      } else {
        const built = buildCharacterAnchorPrompt({
          style: profileStyle,
          protagonistName,
          colorTerms,
        });
        anchorImage = await withTimeout(
          this.imageService.generateImage(
            built.prompt,
            anchorIdentifier(titleSlug, built.role),
            {
              type: 'master',
              characters: [brief.protagonist.id],
              characterNames: [protagonistName],
              characterDescriptions: this.buildCharacterDescriptions([brief.protagonist.id], characterBible),
            },
            protagonistRefImages.length > 0 ? protagonistRefImages : undefined,
          ),
          PIPELINE_TIMEOUTS.imageGeneration,
          'EpisodeStyleBibleCharacterAnchor'
        );
        if (anchorImage?.imagePath) {
          this._styleAnchorPaths.character = anchorImage.imagePath;
        }
      }

      // === Environment anchor (optional) ===
      // Gated behind EXPO_PUBLIC_STYLE_BIBLE_RICH for in-pipeline generation.
      // A UI-preapproved environment anchor always wins regardless of the flag.
      const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
      const richSamplesEnabled =
        env.EXPO_PUBLIC_STYLE_BIBLE_RICH === 'true' || env.EXPO_PUBLIC_STYLE_BIBLE_RICH === '1';
      let environmentAnchorImage: GeneratedImage | undefined;
      if (preapproved?.environment) {
        try {
          environmentAnchorImage = await this.hydratePreapprovedAnchor(preapproved.environment);
          if (preapproved.environment.imagePath) {
            this._styleAnchorPaths.environment = preapproved.environment.imagePath;
          }
          this.emit({
            type: 'info',
            phase: 'images',
            message: 'Style bible environment anchor: using UI-preapproved anchor (skipping in-pipeline generation).',
          });
        } catch (envErr) {
          this.emit({
            type: 'warning',
            phase: 'images',
            message: `Preapproved environment anchor hydration failed (non-fatal): ${envErr instanceof Error ? envErr.message : String(envErr)}`,
          });
        }
      } else if (richSamplesEnabled) {
        try {
          const primaryLocation = brief.world.keyLocations[0];
          const built = buildEnvironmentAnchorPrompt({
            style: profileStyle,
            storyTitle: brief.story.title,
            locationName: primaryLocation?.name,
            toneTerms: colorScript.colorDictionary.slice(0, 2).map(e => e.color),
          });
          environmentAnchorImage = await withTimeout(
            this.imageService.generateImage(
              built.prompt,
              anchorIdentifier(titleSlug, built.role),
              { type: 'master' as const },
            ),
            PIPELINE_TIMEOUTS.imageGeneration,
            'EpisodeStyleBibleEnvironmentAnchor'
          );
          if (environmentAnchorImage?.imagePath) {
            this._styleAnchorPaths.environment = environmentAnchorImage.imagePath;
          }
        } catch (envErr) {
          this.emit({
            type: 'warning',
            phase: 'images',
            message: `C3 rich style bible: environment anchor failed (non-fatal): ${envErr instanceof Error ? envErr.message : String(envErr)}`,
          });
        }
      }

      const preferredAnchor = (anchorImage?.imageData && anchorImage?.mimeType)
        ? anchorImage
        : (stripImage?.imageData && stripImage?.mimeType ? stripImage : undefined);

      if (!preferredAnchor?.imageData || !preferredAnchor?.mimeType) {
        this.emit({ type: 'warning', phase: 'images', message: 'Episode style bible did not produce a reusable image anchor. Falling back to first scene anchor.' });
        return false;
      }

      this.imageService.setGeminiStyleReference(preferredAnchor.imageData, preferredAnchor.mimeType);
      this.emit({
        type: 'agent_complete',
        agent: 'ColorScriptAgent',
        message: 'Episode style bible ready and stored as the primary style anchor.',
        data: {
          stripGenerated: !!stripImage?.imageUrl,
          characterAnchorGenerated: !!anchorImage?.imageUrl,
          environmentAnchorGenerated: !!environmentAnchorImage?.imageUrl,
          richSamplesEnabled,
          preapprovedAnchorsUsed: {
            character: !!preapproved?.character,
            arcStrip: !!preapproved?.arcStrip,
            environment: !!preapproved?.environment,
          },
        }
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'warning', phase: 'images', message: `Episode style bible generation failed: ${message}` });
      return false;
    }
  }

  /**
   * Lazily construct (or return) the `LoraTrainingAgent` for this run.
   * Returns `undefined` when the active image provider does not support LoRA
   * inference (non-SD) or when the subsystem is disabled — callers should
   * treat `undefined` as "skip LoRA training transparently".
   *
   * The registry is rooted under the current run's output directory
   * (`<outputDirectory>/loras/`) so trained artifacts are co-located with
   * the rest of the generation outputs and can be pruned together.
   */
  private getOrCreateLoraTrainingAgent(
    storyId: string,
    outputDirectory?: string,
  ): LoraTrainingAgent | undefined {
    const settings = this.config.imageGen?.loraTraining;
    if (!settings || !settings.enabled) return undefined;
    const provider = (this.config.imageGen?.provider || 'nano-banana') as import('../config').ImageProvider;
    if (!providerSupportsLoraTraining(provider)) return undefined;
    if (this._loraTrainingAgent) return this._loraTrainingAgent;

    // Pick a registry root. Prefer `<outputDirectory>/loras/` when we have
    // one; fall back to a workspace-relative `generated-stories/<storyId>/loras`
    // directory so callers that never passed outputDirectory still get a
    // stable path (the registry auto-creates it on first write).
    const registryRoot = outputDirectory
      ? (outputDirectory.endsWith('/') ? `${outputDirectory}loras` : `${outputDirectory}/loras`)
      : `generated-stories/${storyId}/loras`;

    let io;
    try {
      io = createNodeLoraRegistryIO();
    } catch {
      // Non-Node environments (native RN) can't train LoRAs today — surface
      // this once as a warning and disable the agent for the run.
      if (!this._loraTrainingBanner) {
        this._loraTrainingBanner = true;
        this.emit({
          type: 'warning',
          phase: 'images',
          message: 'LoRA training enabled but filesystem access is unavailable in this runtime — skipping training.',
        });
      }
      return undefined;
    }

    const registry = new LoraRegistry(storyId, registryRoot, io);
    const adapter = createLoraTrainerAdapter({
      backend: settings.backend,
      kohya: {
        proxyBaseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      },
    });
    const agent = new LoraTrainingAgent({
      storyId,
      provider,
      settings,
      adapter,
      registry,
      onProgress: (event) => {
        if (event.type === 'start') {
          this.emit({ type: 'agent_start', agent: 'LoraTrainingAgent', message: `Training ${event.kind} LoRA for ${event.name}…` });
        } else if (event.type === 'complete') {
          this.emit({ type: 'agent_complete', agent: 'LoraTrainingAgent', message: `Trained ${event.kind} LoRA ${event.record.name}.` });
        } else if (event.type === 'skip') {
          this.emit({ type: 'debug', phase: 'images', message: `LoRA skip (${event.kind}/${event.name}): ${event.reason}` });
        } else if (event.type === 'fail') {
          this.emit({ type: 'warning', phase: 'images', message: `LoRA training failed (${event.kind}/${event.name}): ${event.reason}` });
        }
      },
    });
    this._loraTrainingAgent = agent;
    this._loraRegistry = registry;
    return agent;
  }

  /**
   * Trigger character + style LoRA training once the reference sheets and
   * style-bible anchors exist. Safe to call multiple times per run — the
   * registry's fingerprint-keyed cache short-circuits anything that was
   * already trained.
   *
   * Newly registered artifacts are merged back into
   * `StableDiffusionSettings.styleLoras` / `.characterLoraByName` via
   * `imageService.updateStableDiffusionSettings` so the existing
   * `buildSDPrompt` path emits `<lora:...>` tags on subsequent scene
   * generation with no additional surgery.
   */
  private async runLoraTrainingIfEligible(
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    outputDirectory?: string,
  ): Promise<void> {
    const storyId = idSlugify(brief.story.title) || 'story';
    const agent = this.getOrCreateLoraTrainingAgent(storyId, outputDirectory);
    if (!agent || !agent.shouldRun()) return;

    if (!this._loraTrainingBanner) {
      this._loraTrainingBanner = true;
      this.emit({
        type: 'info',
        phase: 'images',
        message: `LoRA training enabled (backend=${agent.settings.backend}); checking candidates…`,
      });
    }

    // Load any artifacts persisted by previous runs of the same story.
    try {
      await this._loraRegistry?.load();
    } catch (err) {
      this.emit({
        type: 'debug',
        phase: 'images',
        message: `LoRA registry load non-fatal: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Build character candidates from the cached reference sheets.
    const seen = new Set<string>();
    const characters: CharacterTrainingCandidate[] = [];
    for (const char of characterBible.characters) {
      if (seen.has(char.id)) continue;
      seen.add(char.id);
      const sheet = this.imageAgentTeam.getReferenceSheet(char.id);
      if (!sheet) continue;
      const references: { viewKey: string; imagePath?: string }[] = [];
      for (const [viewKey, image] of sheet.generatedImages.entries()) {
        if (image?.imagePath) {
          references.push({ viewKey, imagePath: image.imagePath });
        }
      }
      if (references.length === 0) continue;
      const identityFingerprint = sheet.identityFingerprint || computeCharacterIdentityFingerprint(char);
      characters.push({
        character: {
          id: char.id,
          name: char.name,
          role: char.role,
          tier: (char.importance || '').toLowerCase(),
          physicalDescription: char.physicalDescription,
          distinctiveFeatures: char.distinctiveFeatures,
          typicalAttire: char.typicalAttire,
        },
        identityFingerprint,
        references,
      });
    }

    // Build the style candidate from the current anchor paths. We
    // fingerprint on the paths themselves (stable across rerenders if the
    // anchors haven't been regenerated) — a future improvement is to hash
    // the file bytes directly. `anchorHashes` is intentionally simple here
    // and stays compatible with `computeStyleLoraFingerprint`.
    const profile = this.config.imageGen?.artStyleProfile;
    let style: StyleTrainingCandidate | undefined;
    if (profile) {
      const anchors: { role: string; imagePath?: string }[] = [];
      if (this._styleAnchorPaths.character) anchors.push({ role: 'character', imagePath: this._styleAnchorPaths.character });
      if (this._styleAnchorPaths.arcStrip) anchors.push({ role: 'arcStrip', imagePath: this._styleAnchorPaths.arcStrip });
      if (this._styleAnchorPaths.environment) anchors.push({ role: 'environment', imagePath: this._styleAnchorPaths.environment });
      if (anchors.length > 0) {
        style = {
          profile,
          anchors,
          anchorHashes: anchors.map((a) => a.imagePath || a.role),
          episodeCount: this.totalEpisodes,
        };
      }
    }

    if (characters.length === 0 && !style) {
      this.emit({ type: 'debug', phase: 'images', message: 'LoRA training: no eligible candidates this run.' });
      return;
    }

    // Drop any previously-trained artifacts whose fingerprint no longer
    // matches the current characters/style. Mirrors
    // `invalidateStaleReferenceSheets` on the character-sheet side.
    try {
      const removed = await agent.invalidateStaleLoras(characters, style);
      if (removed.length > 0) {
        this.emit({
          type: 'debug',
          phase: 'images',
          message: `LoRA registry: invalidated ${removed.length} stale record(s): ${removed.map((r) => r.name).join(', ')}`,
        });
      }
    } catch (invalidateErr) {
      this.emit({
        type: 'debug',
        phase: 'images',
        message: `LoRA invalidate pass threw (non-fatal): ${invalidateErr instanceof Error ? invalidateErr.message : String(invalidateErr)}`,
      });
    }

    const report = await agent.trainAll(characters, style);
    if (!report.ran) return;

    // Merge the registry back into SD settings so subsequent scene image
    // prompts emit `<lora:...>` tags automatically.
    const existing = this.imageService.getStableDiffusionSettings();
    const merged = agent.mergeSettings(existing);
    this.imageService.updateStableDiffusionSettings(merged);
    this.emit({
      type: 'debug',
      phase: 'images',
      message: `LoRA training report: ${report.entries
        .map((e) => `${e.kind}/${e.name}=${e.outcome}`)
        .join(', ')}`,
    });
  }

  /**
   * Turn a PreapprovedAnchor (inline base64 or on-disk path) into a
   * `GeneratedImage` shape compatible with the rest of the style-bible
   * bookkeeping — specifically the later `setGeminiStyleReference` call
   * which needs `imageData` + `mimeType`.
   */
  private async hydratePreapprovedAnchor(
    anchor: PreapprovedAnchor,
  ): Promise<GeneratedImage> {
    if (!anchor) {
      throw new Error('hydratePreapprovedAnchor called with empty anchor');
    }
    if (anchor.data && anchor.mimeType) {
      return {
        prompt: { prompt: '' } as ImagePrompt,
        imagePath: anchor.imagePath,
        imageUrl: undefined,
        imageData: anchor.data,
        mimeType: anchor.mimeType,
        metadata: { format: 'preapproved-anchor' },
      };
    }
    if (anchor.imagePath) {
      try {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(anchor.imagePath);
        const b64 = buffer.toString('base64');
        const lower = anchor.imagePath.toLowerCase();
        const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
        return {
          prompt: { prompt: '' } as ImagePrompt,
          imagePath: anchor.imagePath,
          imageUrl: undefined,
          imageData: b64,
          mimeType,
          metadata: { format: 'preapproved-anchor' },
        };
      } catch (err) {
        throw new Error(
          `Failed to read preapproved anchor from disk (${anchor.imagePath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new Error('Preapproved anchor has neither inline data nor an imagePath');
  }

  /**
   * A3 (narrow): optionally prefetch scene-opening beat images in parallel
   * before the main scene loop runs. This overlaps opening-beat latency
   * across scenes while keeping D10's per-scene continuity invariant
   * intact — mid-scene beats (which depend on the previous beat as a
   * continuity reference) remain strictly sequential inside the main loop.
   *
   * Gated on `EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS=true`; defaults off.
   * Runs fully *before* the main loop begins mutating
   * `_geminiPreviousScene`, so the prefetch's generateImage calls see the
   * singleton in a clean null state (which is what a scene-opener expects
   * — D10 clears the previous-scene ref at every scene boundary).
   *
   * Skipped entirely for panel-mode stories (panelMode !== 'single'):
   * panel beats render multiple sub-images per beat, which the prefetch
   * doesn't cover. Also skipped per-scene for openers already resumed
   * from disk or the asset registry.
   *
   * Populates `this._openingBeatPrefetch`, a map keyed by beat identifier.
   * The main loop checks this map at beat 0 of each scene and, when a
   * prefetched result is present, short-circuits the inline generateImage
   * call and feeds the prefetched image into the normal post-generation
   * bookkeeping (beatImages, sceneImages, assetRegistry, beatResume,
   * styleReferenceStored, lastGeneratedImage).
   */
  private async prefetchSceneOpeningBeats(
    sceneContents: SceneContent[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    colorScript: ColorScript | undefined,
    worldBible: WorldBible,
    outputDirectory?: string,
  ): Promise<void> {
    this._openingBeatPrefetch.clear();

    const panelMode: PanelMode = this.config.imageGen?.panelMode || 'single';
    if (panelMode !== 'single') {
      this.emit({
        type: 'debug',
        phase: 'images',
        message: `A3-narrow prefetch skipped: panelMode="${panelMode}" (prefetch only supports single-image mode).`,
      });
      return;
    }

    type PrefetchItem = {
      identifier: string;
      sceneId: string;
      scopedSceneId: string;
      beatId: string;
      work: Promise<GeneratedImage>;
    };
    const items: PrefetchItem[] = [];
    const imageStrategy = this.config.imageGen?.strategy || 'selective';

    for (const scene of sceneContents) {
      try {
        const scopedSceneId = this.getEpisodeScopedSceneId(brief, scene.sceneId);

        if (!Array.isArray(scene.moodProgression)) scene.moodProgression = [];
        if (!Array.isArray(scene.keyMoments)) scene.keyMoments = [];

        const beatsToIllustrate = imageStrategy === 'all-beats'
          ? scene.beats
          : scene.beats.filter((b, idx) => {
              const isStartingBeat = b.id === scene.startingBeatId || idx === 0;
              const isChoicePoint = b.isChoicePoint === true;
              const isLastBeat = idx === scene.beats.length - 1;
              const isClimaxBeat = (b as { isClimaxBeat?: boolean }).isClimaxBeat === true;
              const isKeyStoryBeat = (b as { isKeyStoryBeat?: boolean }).isKeyStoryBeat === true;
              const isChoicePayoff = (b as { isChoicePayoff?: boolean }).isChoicePayoff === true;
              const isIntervalBeat = idx % 3 === 0;
              return isStartingBeat || isChoicePoint || isLastBeat || isClimaxBeat || isKeyStoryBeat || isChoicePayoff || isIntervalBeat;
            });
        if (beatsToIllustrate.length === 0) continue;

        const openerBeat = beatsToIllustrate[0];
        const beatId = openerBeat.id;
        const rawIdentifier = `beat-${scopedSceneId}-${beatId}`;
        // Mirror the sanitization the service performs so our map key matches
        // exactly what the main loop will eventually look up.
        const identifier = rawIdentifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');

        if (outputDirectory) {
          const sceneSlug = idSlugify(scene.sceneId);
          const beatResumeLoaded = loadBeatResumeStateSync(outputDirectory, sceneSlug);
          const beatResumeSet = new Set<string>(beatResumeLoaded?.completedIdentifiers ?? []);
          if (beatResumeSet.has(identifier) || beatResumeSet.has(rawIdentifier)) continue;
        }

        const resumeSlotId = `story-beat:${scopedSceneId}::${beatId}`;
        const existingRecord = this.assetRegistry.getResolvedAsset(resumeSlotId);
        if (existingRecord?.latestUrl) continue;

        const sceneCharacterIds = this.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id);
        const locationInfo = getLocationInfoForScene(scene, worldBible);
        const sceneLocationId = locationInfo?.locationId;
        const sceneContext = this.extractSceneContext(scene, 0, sceneContents.length, worldBible);

        const beatCharContext = this.analyzeBeatCharacters(
          openerBeat.text,
          openerBeat.speaker,
          sceneCharacterIds,
          characterBible,
          brief.protagonist.id,
        );
        const explicitShotType = (openerBeat as { shotType?: 'establishing' | 'character' | 'action' }).shotType;
        const isEstablishing = explicitShotType === 'establishing'
          || (!explicitShotType && this.isEstablishingBeat(openerBeat.text, openerBeat.speaker, openerBeat.primaryAction, beatCharContext));
        const resolvedShotType: 'establishing' | 'character' | 'action' = explicitShotType
          || (isEstablishing ? 'establishing' : 'character');

        const sceneColorMood = (colorScript as unknown as { scenes?: Array<Record<string, unknown>> })?.scenes
          ?.find((cs) => (cs as { sceneId?: string; sceneName?: string }).sceneId === scene.sceneId
            || (cs as { sceneId?: string; sceneName?: string }).sceneName === scene.sceneName) as Record<string, unknown> | undefined;
        const colorMoodHints = sceneColorMood ? {
          palette: (sceneColorMood.palette || sceneColorMood.colorPalette) as string | undefined,
          lighting: (sceneColorMood.lighting || sceneColorMood.lightingMood) as string | undefined,
          temperature: sceneColorMood.temperature as string | undefined,
        } : undefined;

        const sceneMood = scene.moodProgression.length > 0
          ? scene.moodProgression[0]
          : (sceneContext.isClimactic ? 'intense' : 'dramatic');

        const scenePromptCtx: import('../images/beatPromptBuilder').ScenePromptContext = {
          sceneId: scene.sceneId,
          sceneName: scene.sceneName,
          genre: brief.story.genre,
          tone: brief.story.tone,
          mood: sceneMood,
          settingContext: scene.settingContext,
          artStyle: this.config.artStyle,
          colorMood: colorMoodHints,
          styleProfile: this.config.imageGen?.artStyleProfile,
        };

        const beatColorEntry = (colorScript as unknown as { beats?: Array<Record<string, unknown>> })?.beats
          ?.find((b) => (b as { beatId?: string }).beatId === beatId) as Record<string, unknown> | undefined;
        let beatColorOverride: import('../images/beatPromptBuilder').BeatPromptInput['colorMoodOverride'] | undefined;
        if (beatColorEntry) {
          const hues: string[] = Array.isArray(beatColorEntry.dominantHues) ? beatColorEntry.dominantHues as string[] : [];
          const palette = hues.length > 0 ? hues.join(' and ') : undefined;
          const temperature = typeof beatColorEntry.lightTemp === 'string' ? beatColorEntry.lightTemp : undefined;
          beatColorOverride = {
            palette,
            lighting: typeof beatColorEntry.lightDirection === 'string'
              ? `${beatColorEntry.lightDirection} light`
              : undefined,
            temperature,
            // Beat 0 has no previous beat — no transition note.
            transitionNote: undefined,
          };
        }

        let shotCharacterIds: string[];
        if (isEstablishing) {
          shotCharacterIds = [];
        } else {
          shotCharacterIds = openerBeat.characters && openerBeat.characters.length > 0
            ? [...openerBeat.characters]
            : [...sceneCharacterIds];
          if (!shotCharacterIds.includes(brief.protagonist.id)) {
            shotCharacterIds = [brief.protagonist.id, ...shotCharacterIds];
          }
        }
        const shotCharacterNames = shotCharacterIds
          .map(id => characterBible.characters.find(c => c.id === id)?.name)
          .filter(Boolean) as string[];

        const beatPromptInput: import('../images/beatPromptBuilder').BeatPromptInput = {
          beatId,
          beatText: openerBeat.text,
          beatIndex: 0,
          totalBeats: beatsToIllustrate.length,
          visualMoment: this.sanitizePromptText(openerBeat.visualMoment || '', brief, ''),
          primaryAction: isEstablishing ? '' : this.sanitizePromptText(openerBeat.primaryAction || '', brief, ''),
          emotionalRead: isEstablishing ? '' : this.sanitizePromptText(openerBeat.emotionalRead || '', brief, ''),
          relationshipDynamic: isEstablishing ? '' : this.sanitizePromptText(openerBeat.relationshipDynamic || '', brief, ''),
          mustShowDetail: this.sanitizePromptText(openerBeat.mustShowDetail || '', brief, ''),
          shotType: resolvedShotType,
          isClimaxBeat: openerBeat.isClimaxBeat,
          isKeyStoryBeat: openerBeat.isKeyStoryBeat,
          isChoicePayoff: (openerBeat as { isChoicePayoff?: boolean }).isChoicePayoff,
          choiceContext: this.sanitizePromptText((openerBeat as { choiceContext?: string }).choiceContext || '', brief, ''),
          incomingChoiceContext: this.sanitizePromptText(scene.incomingChoiceContext || '', brief, ''),
          isBranchPayoff: !!scene.incomingChoiceContext,
          foregroundCharacterNames: isEstablishing ? [] : (openerBeat.foregroundCharacters || shotCharacterNames),
          backgroundCharacterNames: isEstablishing ? [] : openerBeat.backgroundCharacters,
          colorMoodOverride: beatColorOverride,
        };

        let imagePrompt = buildBeatImagePrompt(beatPromptInput, scenePromptCtx);
        imagePrompt = this.sanitizeImagePrompt(imagePrompt, brief);

        const includeExpressionRefs = !!(openerBeat.isClimaxBeat || openerBeat.isKeyStoryBeat);
        const referenceImages = this.gatherCharacterReferenceImages(
          shotCharacterIds,
          characterBible,
          sceneLocationId,
          {
            includeExpressions: includeExpressionRefs,
            family: 'story-beat',
            slotId: resumeSlotId,
          },
        );

        const work = withTimeout(
          this.imageService.generateImage(
            imagePrompt,
            identifier,
            {
              sceneId: scopedSceneId,
              beatId,
              type: 'scene' as const,
              characters: shotCharacterIds,
              characterNames: shotCharacterNames,
              characterDescriptions: this.buildCharacterDescriptions(shotCharacterIds, characterBible),
            },
            referenceImages.length > 0 ? referenceImages : undefined,
          ),
          PIPELINE_TIMEOUTS.imageGeneration,
          `prefetchOpener(${scopedSceneId}:${beatId})`,
        );

        items.push({ identifier, sceneId: scene.sceneId, scopedSceneId, beatId, work });
      } catch (perSceneErr) {
        this.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch: setup failed for scene "${scene.sceneId}" (non-fatal): ${perSceneErr instanceof Error ? perSceneErr.message : String(perSceneErr)}`,
        });
      }
    }

    if (items.length === 0) {
      this.emit({
        type: 'debug',
        phase: 'images',
        message: `A3-narrow prefetch: no eligible scene-opening beats to prefetch.`,
      });
      return;
    }

    this.emit({
      type: 'agent_start',
      agent: 'ImageService',
      message: `A3-narrow: prefetching ${items.length} scene-opening beats in parallel`,
    });

    const settled = await Promise.allSettled(items.map(i => i.work));

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = settled[i];
      if (result.status === 'fulfilled' && (result.value.imageUrl || result.value.imagePath)) {
        this._openingBeatPrefetch.set(item.identifier, result.value);
        successCount++;
      } else {
        failCount++;
        const reason = result.status === 'rejected'
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : 'prefetch returned no image';
        this.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch missed for ${item.identifier} (will regenerate inline): ${reason}`,
        });
      }
    }

    this.emit({
      type: 'agent_complete',
      agent: 'ImageService',
      message: `A3-narrow prefetch complete: ${successCount}/${items.length} succeeded (${failCount} fell back to inline)`,
      data: { prefetchSize: items.length, successCount, failCount },
    });
  }

  /**
   * Map speakerMood string to emotion category
   */
  private mapSpeakerMoodToEmotion(speakerMood?: string): 'hopeful' | 'tense' | 'melancholy' | 'triumphant' | 'eerie' | 'neutral' {
    if (!speakerMood) return 'neutral';
    
    const mood = speakerMood.toLowerCase();
    
    if (mood.includes('happy') || mood.includes('joy') || mood.includes('excit') || mood.includes('hope')) return 'hopeful';
    if (mood.includes('tense') || mood.includes('anxious') || mood.includes('nervous') || mood.includes('fear') || mood.includes('worry')) return 'tense';
    if (mood.includes('sad') || mood.includes('grief') || mood.includes('mourn') || mood.includes('melan')) return 'melancholy';
    if (mood.includes('triumph') || mood.includes('victory') || mood.includes('proud') || mood.includes('confident')) return 'triumphant';
    if (mood.includes('eerie') || mood.includes('creep') || mood.includes('unnerv') || mood.includes('dread')) return 'eerie';
    if (mood.includes('angry') || mood.includes('rage') || mood.includes('frust')) return 'tense'; // Map anger to tense
    
    return 'neutral';
  }

  /**
   * Infer emotional intensity from mood and text
   */
  private inferIntensity(speakerMood?: string, text?: string): 'low' | 'medium' | 'high' {
    const mood = (speakerMood || '').toLowerCase();
    const content = (text || '').toLowerCase();
    
    // High intensity indicators
    if (mood.includes('rage') || mood.includes('terror') || mood.includes('ecsta') || mood.includes('grief')) return 'high';
    const exclamationMatches = content.match(/!/g);
    if (content.includes('!') && exclamationMatches && exclamationMatches.length >= 2) return 'high';
    if (content.includes('scream') || content.includes('shout') || content.includes('explod')) return 'high';
    
    // Low intensity indicators
    if (mood.includes('calm') || mood.includes('peace') || mood.includes('serene') || mood.includes('quiet')) return 'low';
    if (mood.includes('bored') || mood.includes('tired') || mood.includes('sleepy')) return 'low';
    
    return 'medium';
  }

  /**
   * Infer emotional valence from mood and text
   */
  private inferValence(speakerMood?: string, text?: string): 'positive' | 'negative' | 'ambiguous' {
    const mood = (speakerMood || '').toLowerCase();
    
    // Positive
    if (mood.includes('happy') || mood.includes('joy') || mood.includes('hope') || mood.includes('love') ||
        mood.includes('excit') || mood.includes('proud') || mood.includes('triumph') || mood.includes('relief')) {
      return 'positive';
    }
    
    // Negative
    if (mood.includes('sad') || mood.includes('grief') || mood.includes('fear') || mood.includes('anger') ||
        mood.includes('rage') || mood.includes('despair') || mood.includes('terror') || mood.includes('disgust')) {
      return 'negative';
    }
    
    // Ambiguous/mixed
    return 'ambiguous';
  }

  /**
   * Extract scene context for visual generation
   */
  private extractSceneContext(
    scene: SceneContent,
    sceneIndex: number,
    totalScenes: number,
    worldBible: WorldBible
  ): {
    isClimactic: boolean;
    isResolution: boolean;
    isFlashback: boolean;
    isNightmare: boolean;
    isSafeHubScene: boolean;
    branchType: 'dark' | 'hopeful' | 'neutral';
    timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  } {
    const sceneName = (scene.sceneName || '').toLowerCase();
    const keyMoments = (Array.isArray(scene.keyMoments) ? scene.keyMoments : []).join(' ').toLowerCase();
    const moodProg = (Array.isArray(scene.moodProgression) ? scene.moodProgression : []).join(' ').toLowerCase();
    
    // Determine if climactic (near end, contains confrontation/climax keywords)
    const isNearEnd = sceneIndex >= totalScenes - 2;
    const hasClimaxKeywords = keyMoments.includes('climax') || keyMoments.includes('confrontation') || 
                              keyMoments.includes('showdown') || keyMoments.includes('final');
    const isClimactic = isNearEnd && hasClimaxKeywords;
    
    // Resolution (last scene, contains resolution keywords)
    const isResolution = sceneIndex === totalScenes - 1 && 
                         (keyMoments.includes('resolution') || keyMoments.includes('aftermath') || keyMoments.includes('conclude'));
    
    // Flashback/nightmare detection
    const isFlashback = sceneName.includes('flashback') || sceneName.includes('memory') || keyMoments.includes('past');
    const isNightmare = sceneName.includes('nightmare') || sceneName.includes('dream') || keyMoments.includes('nightmare');
    
    // Safe hub (calm base scenes)
    const isSafeHubScene = moodProg.includes('calm') || moodProg.includes('safe') || 
                           sceneName.includes('base') || sceneName.includes('home') || sceneName.includes('haven');
    
    // Branch type inference (would normally come from player state)
    let branchType: 'dark' | 'hopeful' | 'neutral' = 'neutral';
    if (moodProg.includes('dark') || moodProg.includes('despair') || moodProg.includes('corrupt')) {
      branchType = 'dark';
    } else if (moodProg.includes('hope') || moodProg.includes('redemption') || moodProg.includes('light')) {
      branchType = 'hopeful';
    }
    
    // Time of day inference
    let timeOfDay: 'dawn' | 'day' | 'dusk' | 'night' | undefined;
    if (sceneName.includes('dawn') || sceneName.includes('morning') || keyMoments.includes('sunrise')) {
      timeOfDay = 'dawn';
    } else if (sceneName.includes('night') || sceneName.includes('midnight') || keyMoments.includes('dark')) {
      timeOfDay = 'night';
    } else if (sceneName.includes('dusk') || sceneName.includes('sunset') || sceneName.includes('evening')) {
      timeOfDay = 'dusk';
    } else if (sceneName.includes('day') || sceneName.includes('noon') || sceneName.includes('afternoon')) {
      timeOfDay = 'day';
    }
    
    return { isClimactic, isResolution, isFlashback, isNightmare, isSafeHubScene, branchType, timeOfDay };
  }

  /**
   * Map choice sets to choice positions for visual planning
   */
  private mapChoicePositions(
    choiceSets: ChoiceSet[],
    scene: SceneContent
  ): Array<{
    beatId: string;
    choiceType: 'binary' | 'multiple' | 'timed';
    options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
  }> {
    const positions: Array<{
      beatId: string;
      choiceType: 'binary' | 'multiple' | 'timed';
      options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
    }> = [];
    
    for (const choiceSet of choiceSets) {
      // Only include choices that belong to beats in this scene
      const belongsToScene = scene.beats.some(b => b.id === choiceSet.beatId);
      if (!belongsToScene) continue;
      
      const choiceCount = choiceSet.choices.length;
      const choiceType: 'binary' | 'multiple' | 'timed' = choiceCount === 2 ? 'binary' : 'multiple';
      
      positions.push({
        beatId: choiceSet.beatId,
        choiceType,
        options: choiceSet.choices.map(c => ({
          type: this.inferChoiceType(c.text),
          label: c.text.substring(0, TEXT_LIMITS.shortPreviewLength)
        }))
      });
    }
    
    return positions;
  }

  /**
   * Infer choice type from text
   */
  private inferChoiceType(choiceText: string): 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other' {
    const text = choiceText.toLowerCase();
    
    if (text.includes('trust') || text.includes('believe') || text.includes('faith')) return 'trust';
    if (text.includes('suspic') || text.includes('doubt') || text.includes('question')) return 'suspicion';
    if (text.includes('attack') || text.includes('fight') || text.includes('confront')) return 'action';
    if (text.includes('wait') || text.includes('careful') || text.includes('cautious')) return 'caution';
    if (text.includes('help') || text.includes('kind') || text.includes('compassion')) return 'kindness';
    if (text.includes('cruel') || text.includes('harsh') || text.includes('punish')) return 'cruelty';
    
    return 'other';
  }

  /**
   * Get location info from world bible for a scene
   */
  private resolveWorldLocationForScene(
    sceneBlueprint: Pick<SceneBlueprint, 'location' | 'name' | 'description'>,
    worldBible: WorldBible
  ) {
    const authoredLocation = (sceneBlueprint.location || '').trim().toLowerCase();
    if (authoredLocation) {
      const exactIdMatch = worldBible.locations.find((loc) => loc.id.toLowerCase() === authoredLocation);
      if (exactIdMatch) return exactIdMatch;
      const exactNameMatch = worldBible.locations.find((loc) => loc.name.toLowerCase() === authoredLocation);
      if (exactNameMatch) return exactNameMatch;
      const partialNameMatch = worldBible.locations.find((loc) => loc.name.toLowerCase().includes(authoredLocation) || authoredLocation.includes(loc.name.toLowerCase()));
      if (partialNameMatch) return partialNameMatch;
    }

    const sceneText = `${sceneBlueprint.name} ${sceneBlueprint.description || ''}`.toLowerCase();
    const heuristicMatch = worldBible.locations.find((loc) => {
      const locName = loc.name.toLowerCase();
      return sceneText.includes(locName) || locName.includes(sceneText.split(' ')[0] || '');
    });
    return heuristicMatch || worldBible.locations[0];
  }

  private assembleEpisode(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounters?: Map<string, EncounterStructure>,
    encounterImageResults?: {
      encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>;
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
    videoResults?: Map<string, string>
  ): Episode {
    const contentMap = new Map(sceneContents.map(sc => [sc.sceneId, sc]));
    const choiceMap = new Map(choiceSets.map(cs => [cs.sceneId ? `${cs.sceneId}::${cs.beatId}` : cs.beatId, cs]));
    const beatImages = imageResults?.beatImages || new Map<string, string>();
    const sceneImages = imageResults?.sceneImages || new Map<string, string>();
    const beatVideos = videoResults || new Map<string, string>();
    const encounterImages = encounterImageResults?.encounterImages || new Map();
    const storyletImages = encounterImageResults?.storyletImages || new Map<string, Map<string, Map<string, string>>>();

    const scenes: Scene[] = [];
    const assemblyWarnings: string[] = [];
    
    for (const sb of blueprint.scenes) {
      let content = contentMap.get(sb.id);
      if (!content) {
        console.error(`[Pipeline] Missing content for scene ${sb.id} — inserting placeholder`);
        this.emit({ type: 'error', phase: 'assembly', message: `Missing content for scene ${sb.id} — inserting placeholder` });
        assemblyWarnings.push(`Missing content for scene ${sb.id}`);
        content = {
          sceneId: sb.id,
          sceneName: sb.name,
          beats: [{ id: `${sb.id}-missing-beat`, text: '[Scene content was not generated]', nextBeatId: undefined }],
          startingBeatId: `${sb.id}-missing-beat`,
          moodProgression: [sb.mood],
          charactersInvolved: sb.npcsPresent,
          keyMoments: [sb.description],
          continuityNotes: ['Content generation did not produce this scene'],
        } as SceneContent;
      }

      // Check if this scene has an encounter (wrapped in try/catch for resilience)
      const encounterStructure = encounters?.get(sb.id);
      const sceneEncounterImages = encounterImages.get(sb.id);
      let encounter: ReturnType<typeof convertEncounterStructureToEncounter> | undefined;
      
      try {
        encounter = encounterStructure 
          ? convertEncounterStructureToEncounter(encounterStructure, sb)
          : undefined;
      } catch (convError) {
        const convMsg = convError instanceof Error ? convError.message : String(convError);
        console.error(`[Pipeline] Failed to convert encounter for scene ${sb.id} (non-fatal): ${convMsg}`);
        assemblyWarnings.push(`Encounter conversion failed for ${sb.id}: ${convMsg}`);
        encounter = undefined; // Continue without the encounter
      }
      
      // Map encounter images to the encounter structure (including recursive nextSituation trees)
      if (encounter && sceneEncounterImages) {
        let epMappedSetup = 0;
        let epMappedOutcome = 0;
        encounter.phases.forEach(phase => {
          phase.beats.forEach(beat => {
            const isEncounterBeat = 'setupText' in beat;
            
            const setupImage = sceneEncounterImages.setupImages.get(beat.id);
            if (setupImage && isEncounterBeat) {
              (beat as TypeEncounterBeat).situationImage = setupImage;
              epMappedSetup++;
            }
            
            if (isEncounterBeat) {
              const encounterBeat = beat as TypeEncounterBeat;
              if (encounterBeat.choices) {
                const treeResult = this.wireEncounterTreeImages(
                  encounterBeat.choices,
                  encounterBeat.id,
                  '',
                  sceneEncounterImages.setupImages,
                  sceneEncounterImages.outcomeImages,
                  encounterBeat.situationImage,
                );
                epMappedSetup += treeResult.setupCount;
                epMappedOutcome += treeResult.outcomeCount;
              }
            }
          });
        });
        console.log(`[Pipeline] assembleEpisode: Encounter image mapping for ${sb.id}: ${epMappedSetup} setup, ${epMappedOutcome} outcome images`);
      } else if (encounter && !sceneEncounterImages) {
        console.warn(`[Pipeline] assembleEpisode: Scene ${sb.id} has encounter but NO encounter images were generated`);
      }

      // Wire storylet aftermath images into each storylet beat's image field.
      if (encounter) {
        const sceneStoryletImages = storyletImages.get(sb.id);
        if (sceneStoryletImages && encounter.storylets) {
          const outcomes: Array<[string, TypeGeneratedStorylet | undefined]> = [
            ['victory', encounter.storylets.victory],
            ['partialVictory', encounter.storylets.partialVictory],
            ['defeat', encounter.storylets.defeat],
            ['escape', encounter.storylets.escape],
          ];
          for (const [outcomeName, storylet] of outcomes) {
            if (!storylet) continue;
            const beatImageMap = sceneStoryletImages.get(outcomeName);
            if (beatImageMap) {
              storylet.beats.forEach(beat => {
                const url = beatImageMap.get(beat.id);
                if (url) beat.image = url;
              });
            }
          }
        }
      }

      // Determine if this is a bottleneck scene
      const isBottleneck = blueprint.bottleneckScenes?.includes(sb.id) || sb.purpose === 'bottleneck';
      
      // Determine if this is a convergence point (multiple scenes lead to it)
      const incomingScenes = blueprint.scenes.filter(s => s.leadsTo?.includes(sb.id));
      const isConvergencePoint = incomingScenes.length > 1;

      scenes.push({
        id: sb.id,
        name: sb.name,
        startingBeatId: content.startingBeatId,
        backgroundImage: sceneImages.get(this.getEpisodeScopedSceneId(brief, sb.id)),
        beats: content.beats.map(gb => ({
          id: gb.id,
          text: gb.text,
          speaker: gb.speaker,
          speakerMood: gb.speakerMood,
          nextBeatId: gb.nextBeatId,
          image: beatImages.get(this.getEpisodeScopedBeatKey(brief, sb.id, gb.id)),
          video: beatVideos.get(this.getEpisodeScopedBeatKey(brief, sb.id, gb.id)),
          choices: gb.isChoicePoint ? choiceMap.get(`${sb.id}::${gb.id}`)?.choices.map(c => ({
            id: c.id,
            text: c.text,
            nextSceneId: c.nextSceneId,
            nextBeatId: c.nextBeatId,
            consequences: normalizeConsequences(c.consequences),
            consequenceDomain: c.consequenceDomain,
            reminderPlan: c.reminderPlan,
            feedbackCue: c.feedbackCue,
          })) : undefined
        })),
        encounter,
        // Branch navigation metadata
        leadsTo: sb.leadsTo,
        isBottleneck,
        isConvergencePoint,
      });
    }

    if (assemblyWarnings.length > 0) {
      console.warn(`[Pipeline] Episode assembly completed with ${assemblyWarnings.length} warning(s): ${assemblyWarnings.join('; ')}`);
    }

    // Post-assembly encounter verification: the final episode must contain encounters
    // when the blueprint flagged scenes as encounters.
    const blueprintEncounterSceneIds = blueprint.scenes.filter(s => s.isEncounter).map(s => s.id);
    const assembledEncounterSceneIds = scenes.filter(s => s.encounter).map(s => s.id);
    if (blueprintEncounterSceneIds.length > 0 && assembledEncounterSceneIds.length === 0) {
      console.error(
        `[Pipeline] ENCOUNTER VERIFICATION FAILED: Blueprint expected encounters in [${blueprintEncounterSceneIds.join(', ')}] ` +
        `but assembled episode has zero encounters. This means encounters were silently lost during generation or assembly.`
      );
      this.emit({
        type: 'error',
        phase: 'assembly',
        message: `Episode assembly lost all encounters! Blueprint expected ${blueprintEncounterSceneIds.length} encounter scene(s) but 0 made it to final output.`,
      });
    } else if (blueprintEncounterSceneIds.length > assembledEncounterSceneIds.length) {
      const missing = blueprintEncounterSceneIds.filter(id => !assembledEncounterSceneIds.includes(id));
      console.warn(
        `[Pipeline] Encounter verification: ${missing.length} encounter scene(s) lost during assembly: [${missing.join(', ')}]`
      );
      this.emit({
        type: 'warning',
        phase: 'assembly',
        message: `${missing.length} encounter scene(s) lost during assembly: ${missing.join(', ')}`,
      });
    }

    // Use first scene's background as episode cover
    const episodeCover = scenes.length > 0 ? sceneImages.get(this.getEpisodeScopedSceneId(brief, scenes[0].id)) || '' : '';

    return {
      id: generateEpisodeId(brief.episode.number, brief.episode.title),
      number: brief.episode.number,
      title: brief.episode.title,
      synopsis: brief.episode.synopsis,
      scenes,
      startingSceneId: blueprint.startingSceneId,
      coverImage: episodeCover
    };
  }

  /**
   * Build the priorStateContext for EncounterArchitect by parsing the
   * encounter scene's encounterSetupContext directives and supplementing
   * with all suggestedFlags from the blueprint and relationships for the
   * NPCs involved in the encounter.
   *
   * @param flagsAlreadySet - Flags that prior scenes have already set via
   *   consequences. Used to annotate each flag so the EncounterArchitect
   *   knows which flags are safe to use in choice `conditions` vs. which
   *   are only set by later scenes (and thus only usable in text variants).
   */
  private buildEncounterPriorStateContext(
    encounterScene: SceneBlueprint,
    blueprint: EpisodeBlueprint,
    npcsInvolved: Array<{ id: string; name: string }>,
    flagsAlreadySet?: ReadonlySet<string>
  ): EncounterArchitectInput['priorStateContext'] {
    const relevantFlags: Array<{ name: string; description: string; alreadySet?: boolean }> = [];
    const relevantRelationships: Array<{
      npcId: string; npcName: string;
      dimension: 'trust' | 'affection' | 'respect' | 'fear';
      operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
      threshold: number; description: string;
      authored?: boolean;
    }> = [];
    const significantChoices: string[] = [];

    // Parse encounterSetupContext directives authored by the StoryArchitect.
    // Format: "flag:<name> — <description>" or "relationship:<id>.<dim> <op> <n> — <description>"
    if (encounterScene.encounterSetupContext?.length) {
      for (const directive of encounterScene.encounterSetupContext) {
        if (directive.startsWith('flag:')) {
          const rest = directive.slice('flag:'.length);
          const dashIdx = rest.indexOf(' — ');
          const flagName = dashIdx !== -1 ? rest.slice(0, dashIdx).trim() : rest.trim();
          const flagDesc = dashIdx !== -1 ? rest.slice(dashIdx + 3).trim() : directive;
          relevantFlags.push({
            name: flagName,
            description: flagDesc,
            alreadySet: flagsAlreadySet?.has(flagName) ?? false,
          });
        } else if (directive.startsWith('relationship:')) {
          // e.g. "relationship:hindley.trust < -20 — description"
          const rest = directive.slice('relationship:'.length);
          const dashIdx = rest.indexOf(' — ');
          const expr = dashIdx !== -1 ? rest.slice(0, dashIdx).trim() : rest.trim();
          const desc = dashIdx !== -1 ? rest.slice(dashIdx + 3).trim() : directive;
          // Parse "npcId.dimension operator threshold"
          const match = expr.match(/^([^.]+)\.(\w+)\s*([<>=!]+)\s*(-?\d+)/);
          if (match) {
            const [, npcId, dimension, operator, thresholdStr] = match;
            const npc = npcsInvolved.find(n => n.id === npcId);
            const dims = ['trust', 'affection', 'respect', 'fear'] as const;
            const dim = dims.find(d => d === dimension);
            if (dim) {
              relevantRelationships.push({
                npcId,
                npcName: npc?.name || npcId,
                dimension: dim,
                operator: operator as '==' | '!=' | '>' | '<' | '>=' | '<=',
                threshold: parseInt(thresholdStr, 10),
                description: desc,
                authored: true,
              });
            }
          }
        }
        // Any directive not matching flag:/relationship: becomes a significant choice hint
        else {
          significantChoices.push(directive);
        }
      }
    }

    // Always include all blueprint-level suggestedFlags as potential payoff context
    // (the StoryArchitect defines these as flags the episode tracks).
    for (const flag of blueprint.suggestedFlags || []) {
      if (!relevantFlags.some(f => f.name === flag.name)) {
        relevantFlags.push({
          name: flag.name,
          description: flag.description,
          alreadySet: flagsAlreadySet?.has(flag.name) ?? false,
        });
      }
    }

    // Only synthesize default relationship thresholds when the blueprint provided none at all.
    // This keeps relationship payoffs feeling authored instead of boilerplate.
    const RELATIONSHIP_DIMS = ['trust', 'affection', 'respect', 'fear'] as const;
    if (relevantRelationships.length === 0) {
      for (const npc of npcsInvolved) {
        for (const dim of RELATIONSHIP_DIMS) {
          const maxVal = this.incrementalValidator?.getRelationshipUpperBound(npc.id, dim) ?? 0;
          relevantRelationships.push({
            npcId: npc.id,
            npcName: npc.name,
            dimension: dim,
            operator: '>=',
            threshold: dim === 'fear' ? 40 : 20, // Sensible defaults
            description: `${npc.name}'s ${dim} level — consider authoring a variant when this value is high enough to matter`,
            authored: false,
            currentMaxValue: maxVal,
          });
        }
      }
    } else {
      // Annotate authored relationships with current achievable values
      for (const rel of relevantRelationships) {
        if (rel.currentMaxValue === undefined) {
          rel.currentMaxValue = this.incrementalValidator?.getRelationshipUpperBound(rel.npcId, rel.dimension) ?? 0;
        }
      }
    }

    if (!relevantFlags.length && !relevantRelationships.length && !significantChoices.length) {
      return undefined;
    }

    return { relevantFlags, relevantRelationships, significantChoices };
  }

  /**
   * Deterministic post-assembly scan: walk every scene in order, accumulate
   * flags from setFlag consequences, and verify that every flag-type condition
   * on choices (narrative and encounter) only references flags already in the
   * accumulated set.  Returns human-readable issue strings.
   */
  private runFlagChronologyScan(story: Story): string[] {
    const issues: string[] = [];
    const accumulatedFlags = new Set<string>();

    // Relationship upper-bound tracking: initial values + sum of positive changes
    const relBaselines = new Map<string, number>(); // "npcId:dim" -> initial value
    const relGains = new Map<string, number>();     // "npcId:dim" -> accumulated positive changes

    // Initialize relationship baselines from story NPCs
    for (const npc of story.npcs || []) {
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const key = `${npc.id}:${dim}`;
        relBaselines.set(key, (npc as any).initialRelationship?.[dim] ?? 0);
      }
    }

    const getRelUpperBound = (npcId: string, dim: string): number => {
      const key = `${npcId}:${dim}`;
      return (relBaselines.get(key) ?? 0) + (relGains.get(key) ?? 0);
    };

    const isComparisonUnreachable = (upperBound: number, operator: string, threshold: number): boolean => {
      switch (operator) {
        case '>':  return upperBound <= threshold;
        case '>=': return upperBound < threshold;
        case '==': return upperBound < threshold;
        default:   return false;
      }
    };

    // Collect flags from initialState
    if (story.initialState?.flags) {
      for (const [k, v] of Object.entries(story.initialState.flags)) {
        if (v) accumulatedFlags.add(k);
      }
    }

    const collectConsequences = (consequences?: Consequence[]) => {
      if (!consequences) return;
      for (const c of consequences) {
        if (c.type === 'setFlag' && (c as any).flag) {
          accumulatedFlags.add((c as any).flag);
        }
        const rel = c as any;
        if ((rel.type === 'relationship' || rel.type === 'changeRelationship') &&
            (rel.characterId || rel.npcId) && rel.dimension && typeof rel.change === 'number' && rel.change > 0) {
          const key = `${rel.characterId || rel.npcId}:${rel.dimension}`;
          relGains.set(key, (relGains.get(key) ?? 0) + rel.change);
        }
      }
    };

    const checkExpr = (expr: any, location: string) => {
      if (!expr || typeof expr !== 'object') return;
      const type = expr.type as string | undefined;
      if (type === 'flag') {
        const flag = expr.flag as string;
        if (flag && !accumulatedFlags.has(flag)) {
          issues.push(
            `Forward-reference: "${flag}" used in condition at ${location} but not set by any prior scene`
          );
        }
      } else if (type === 'relationship') {
        const npcId = expr.npcId as string;
        const dim = expr.dimension as string;
        const op = expr.operator as string;
        const val = expr.value as number;
        if (npcId && dim && op && typeof val === 'number') {
          const ub = getRelUpperBound(npcId, dim);
          if (isComparisonUnreachable(ub, op, val)) {
            issues.push(
              `Unreachable relationship condition: "${npcId}.${dim} ${op} ${val}" at ${location} (max achievable: ${ub})`
            );
          }
        }
      } else if (type === 'and' || type === 'or') {
        if (Array.isArray(expr.conditions)) {
          for (const child of expr.conditions) checkExpr(child, location);
        }
      } else if (type === 'not') {
        if (expr.condition) checkExpr(expr.condition, location);
      } else if (!type) {
        const keys = Object.keys(expr);
        if (keys.length === 1 && typeof expr[keys[0]] === 'boolean') {
          if (!accumulatedFlags.has(keys[0])) {
            issues.push(
              `Forward-reference: "${keys[0]}" used in condition at ${location} but not set by any prior scene`
            );
          }
        }
      }
    };

    const walkEncounterChoiceOutcomes = (outcomes: any, loc: string) => {
      if (!outcomes) return;
      for (const tier of ['success', 'complicated', 'failure']) {
        const outcome = outcomes[tier];
        if (!outcome) continue;
        collectConsequences(outcome.consequences);
        if (outcome.nextSituation?.choices) {
          for (const c of outcome.nextSituation.choices) {
            if (c.conditions) checkExpr(c.conditions, `${loc}:${c.id}`);
            if (c.statBonus?.condition) checkExpr(c.statBonus.condition, `${loc}:${c.id}:statBonus`);
            walkEncounterChoiceOutcomes(c.outcomes, `${loc}:${c.id}`);
          }
        }
      }
    };

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        // 1. Check narrative beat choice conditions
        for (const beat of scene.beats || []) {
          if (beat.choices) {
            for (const choice of beat.choices) {
              if (choice.conditions) {
                checkExpr(choice.conditions, `${scene.id}:${beat.id}:${choice.id}`);
              }
            }
          }
        }

        // 2. Check encounter choice conditions
        if (scene.encounter?.phases) {
          for (const phase of scene.encounter.phases) {
            for (const beat of phase.beats || []) {
              const encBeat = beat as any;
              if (encBeat.choices) {
                for (const choice of encBeat.choices) {
                  const loc = `encounter:${scene.id}:${encBeat.id}:${choice.id}`;
                  if (choice.conditions) checkExpr(choice.conditions, loc);
                  if (choice.statBonus?.condition) checkExpr(choice.statBonus.condition, `${loc}:statBonus`);
                  walkEncounterChoiceOutcomes(choice.outcomes, loc);
                }
              }
            }
          }
        }

        // 3. Accumulate flags from narrative choices (consequences)
        for (const beat of scene.beats || []) {
          if (beat.choices) {
            for (const choice of beat.choices) {
              collectConsequences(choice.consequences);
              if (choice.delayedConsequences) {
                for (const dc of choice.delayedConsequences) {
                  collectConsequences(dc.consequence ? [dc.consequence] : undefined);
                }
              }
            }
          }
        }

        // 4. Accumulate flags from encounter choice outcomes
        if (scene.encounter?.phases) {
          for (const phase of scene.encounter.phases) {
            for (const beat of phase.beats || []) {
              const encBeat = beat as any;
              if (encBeat.choices) {
                for (const choice of encBeat.choices) {
                  walkEncounterChoiceOutcomes(choice.outcomes, `${scene.id}:${encBeat.id}:${choice.id}`);
                }
              }
            }
          }
          // Encounter overall outcomes
          if (scene.encounter.outcomes) {
            for (const key of Object.keys(scene.encounter.outcomes)) {
              const outcome = (scene.encounter.outcomes as any)[key];
              collectConsequences(outcome?.consequences);
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * Walk all encounter choice outcomes and track any setFlag consequences
   * so that subsequent scenes see them in the incremental validator.
   */
  private trackEncounterFlagConsequences(encounter: EncounterStructure): void {
    if (!this.incrementalValidator) return;

    const trackConsequence = (c: any) => {
      if (c?.type === 'setFlag' && c.flag) {
        this.incrementalValidator!.trackFlagSet(c.flag);
      }
      if ((c?.type === 'relationship' || c?.type === 'changeRelationship') && (c.characterId || c.npcId) && c.dimension && typeof c.change === 'number') {
        this.incrementalValidator!.trackRelationshipChange(c.characterId || c.npcId, c.dimension, c.change);
      }
    };

    const walkOutcomes = (outcomes: Record<string, any> | undefined) => {
      if (!outcomes) return;
      for (const tier of ['success', 'complicated', 'failure']) {
        const outcome = outcomes[tier];
        if (!outcome) continue;
        if (Array.isArray(outcome.consequences)) {
          for (const c of outcome.consequences) trackConsequence(c);
        }
        if (outcome.nextSituation?.choices) {
          for (const choice of outcome.nextSituation.choices) {
            walkOutcomes(choice.outcomes);
          }
        }
      }
    };

    for (const beat of encounter.beats) {
      if (!beat.choices) continue;
      for (const choice of beat.choices) {
        walkOutcomes(choice.outcomes);
        if (Array.isArray(choice.consequences)) {
          for (const c of choice.consequences) trackConsequence(c);
        }
      }
    }

    // Track flags from storylet outcomes
    if (encounter.storylets) {
      for (const key of Object.keys(encounter.storylets)) {
        const storylet = (encounter.storylets as Record<string, any>)[key];
        if (storylet?.beats) {
          for (const beat of storylet.beats) {
            if (beat.choices) {
              for (const choice of beat.choices) {
                walkOutcomes(choice.outcomes);
              }
            }
          }
        }
      }
    }
  }

  private bindGeneratedAudioToStory(story: Story, audioResults: Array<{ beatId: string; audioUrl?: string }>): number {
    const audioByBeatId = new Map<string, string>();
    for (const result of audioResults) {
      if (result?.beatId && result?.audioUrl) {
        audioByBeatId.set(result.beatId, result.audioUrl);
      }
    }
    if (audioByBeatId.size === 0) return 0;

    let mapped = 0;
    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        for (const beat of scene.beats || []) {
          const audioUrl = audioByBeatId.get(beat.id);
          if (audioUrl) {
            beat.audio = audioUrl;
            mapped++;
          }
        }

        const encounterAny = scene.encounter as any;
        if (encounterAny?.phases) {
          for (const phase of encounterAny.phases) {
            for (const beat of phase?.beats || []) {
              const audioUrl = audioByBeatId.get(beat.id);
              if (audioUrl) {
                beat.audio = audioUrl;
                mapped++;
              }
            }
          }
        }
        if (encounterAny?.beats) {
          for (const beat of encounterAny.beats) {
            const audioUrl = audioByBeatId.get(beat.id);
            if (audioUrl) {
              beat.audio = audioUrl;
              mapped++;
            }
          }
        }
      }
    }
    return mapped;
  }

  /**
   * Bind generated video URLs to beats in the assembled story.
   * Uses the same composite key pattern as images (sceneId::beatId).
   */
  private bindGeneratedVideoToStory(story: Story, videoResults: Map<string, string>): number {
    if (!videoResults || videoResults.size === 0) return 0;

    let mapped = 0;
    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        for (const beat of scene.beats || []) {
          const videoUrl = videoResults.get(`${scene.id}::${beat.id}`);
          if (videoUrl) {
            beat.video = videoUrl;
            mapped++;
          }
        }
      }
    }
    return mapped;
  }

  /**
   * Build enriched NPC descriptions for ChoiceAuthor with voice and physical details.
   */
  private buildChoiceAuthorNpcs(
    npcIds: string[],
    characterBible: CharacterBible
  ): Array<{ id: string; name: string; pronouns: 'he/him' | 'she/her' | 'they/them'; description: string; voiceNotes?: string; physicalDescription?: string }> {
    return npcIds.map(npcId => {
      const profile = characterBible.characters.find(c => c.id === npcId);
      return {
        id: npcId,
        name: profile?.name || npcId,
        pronouns: (profile?.pronouns || 'he/him') as 'he/him' | 'she/her' | 'they/them',
        description: profile?.overview || '',
        voiceNotes: profile?.voiceProfile?.writingGuidance,
        physicalDescription: profile?.physicalDescription,
      };
    });
  }

  /**
   * Build a compact world brief for agents that need broader world context.
   * Keeps token cost low by summarizing rather than dumping full bible.
   */
  private buildCompactWorldContext(worldBible: WorldBible, locationDescription?: string): string {
    const parts: string[] = [];
    if (locationDescription) parts.push(locationDescription);
    if (worldBible.worldRules.length > 0) {
      parts.push(`World rules: ${worldBible.worldRules.slice(0, 5).join('. ')}`);
    }
    if (worldBible.tensions.length > 0) {
      parts.push(`Tensions: ${worldBible.tensions.slice(0, 3).join('. ')}`);
    }
    if (worldBible.factions && worldBible.factions.length > 0) {
      parts.push(`Factions: ${worldBible.factions.slice(0, 4).map(f => f.name + (f.overview ? ` (${f.overview.substring(0, 60)})` : '')).join('; ')}`);
    }
    if (worldBible.customs && worldBible.customs.length > 0) {
      parts.push(`Customs: ${worldBible.customs.slice(0, 3).join('. ')}`);
    }
    return parts.join('\n');
  }

  /**
   * Infer branch type from scene blueprint context
   * Used for visual differentiation (lighting, color, mood)
   */
  private inferBranchType(
    sceneBlueprint: SceneBlueprint,
    blueprint: EpisodeBlueprint
  ): 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' {
    // Check mood keywords
    const moodLower = sceneBlueprint.mood.toLowerCase();
    
    // Dark indicators
    if (moodLower.includes('dark') || moodLower.includes('grim') || 
        moodLower.includes('ominous') || moodLower.includes('dread') ||
        moodLower.includes('desperate') || moodLower.includes('bleak')) {
      return 'dark';
    }
    
    // Hopeful indicators
    if (moodLower.includes('hopeful') || moodLower.includes('bright') ||
        moodLower.includes('warm') || moodLower.includes('optimistic') ||
        moodLower.includes('triumphant') || moodLower.includes('joyful')) {
      return 'hopeful';
    }
    
    // Tragic indicators
    if (moodLower.includes('tragic') || moodLower.includes('mournful') ||
        moodLower.includes('grief') || moodLower.includes('loss') ||
        moodLower.includes('funeral') || moodLower.includes('death')) {
      return 'tragic';
    }
    
    // Redemption indicators
    if (moodLower.includes('redemption') || moodLower.includes('forgiveness') ||
        moodLower.includes('reconciliation') || moodLower.includes('second chance') ||
        moodLower.includes('healing')) {
      return 'redemption';
    }
    
    // Check scene purpose for additional context
    if (sceneBlueprint.purpose === 'bottleneck') {
      // Bottlenecks tend to be more intense/darker
      if (moodLower.includes('tense') || moodLower.includes('conflict')) {
        return 'dark';
      }
    }
    
    // Check if this is on a branch path (not a bottleneck)
    // Non-bottleneck scenes after choices might have stronger tonal variation
    const isOnBranch = sceneBlueprint.purpose === 'branch' || 
      (!blueprint.bottleneckScenes?.includes(sceneBlueprint.id) && 
       blueprint.scenes.some(s => s.leadsTo?.includes(sceneBlueprint.id) && s.choicePoint));
    
    if (isOnBranch) {
      // Branch scenes should have more distinct tones
      // Default to slightly darker for tension
      if (moodLower.includes('tense') || moodLower.includes('suspense')) {
        return 'dark';
      }
    }
    
    return 'neutral';
  }

  /**
   * Filter source analysis to only include content needed for selected episodes
   */
  private filterAnalysisForEpisodeRange(
    analysis: SourceMaterialAnalysis,
    episodeRange: { start: number; end: number; specific?: number[] },
    episodesToGenerate?: number[]
  ): SourceMaterialAnalysis {
    // Determine which episodes to include
    const specificEpisodes = episodesToGenerate || episodeRange.specific;
    
    // Get the episode outlines for the selected episodes (specific list or range)
    const selectedEpisodes = specificEpisodes
      ? analysis.episodeBreakdown.filter(ep => specificEpisodes.includes(ep.episodeNumber))
      : analysis.episodeBreakdown.filter(
          ep => ep.episodeNumber >= episodeRange.start && ep.episodeNumber <= episodeRange.end
        );

    // Collect all unique location references mentioned in selected episodes
    const neededLocationRefs = new Set<string>();
    for (const episode of selectedEpisodes) {
      const episodeLocs = episode.locations || [];
      for (const locRef of episodeLocs) {
        neededLocationRefs.add(locRef.toLowerCase());
      }
    }

    // Also include locations from the starting location of episode 1 if generating from start
    if (episodeRange.start === 1 && analysis.keyLocations.length > 0) {
      // Always include the first location as it's likely the starting point
      neededLocationRefs.add(analysis.keyLocations[0].id.toLowerCase());
      neededLocationRefs.add(analysis.keyLocations[0].name.toLowerCase());
    }

    // Filter locations - match by ID or by name (fuzzy matching)
    const filteredLocations = analysis.keyLocations.filter(loc => {
      const locIdLower = loc.id.toLowerCase();
      const locNameLower = loc.name.toLowerCase();

      // Direct match by ID or name
      if (neededLocationRefs.has(locIdLower) || neededLocationRefs.has(locNameLower)) {
        return true;
      }

      // Partial match - check if any reference contains or is contained in location name
      for (const ref of neededLocationRefs) {
        if (locNameLower.includes(ref) || ref.includes(locNameLower)) {
          return true;
        }
      }

      return false;
    });

    // If no locations were matched (perhaps location IDs don't match), include first few
    // based on selected episode count
    const locationsToUse = filteredLocations.length > 0
      ? filteredLocations
      : analysis.keyLocations.slice(0, Math.min(selectedEpisodes.length + 1, analysis.keyLocations.length));

    this.emit({ type: 'debug', phase: 'filtering', message: `Episode locations needed: ${Array.from(neededLocationRefs).join(', ')}` });
    this.emit({ type: 'debug', phase: 'filtering', message: `Filtered locations: ${locationsToUse.map(l => l.id).join(', ')}` });

    // Collect all unique character references mentioned in selected episodes
    const neededCharacterRefs = new Set<string>();
    for (const episode of selectedEpisodes) {
      const mainChars = episode.mainCharacters || [];
      const supportChars = episode.supportingCharacters || [];
      for (const charRef of [...mainChars, ...supportChars]) {
        neededCharacterRefs.add(charRef.toLowerCase());
      }
    }

    // Filter characters - match by name (with fuzzy matching) or always include core
    const filteredCharacters = analysis.majorCharacters.filter(char => {
      const charNameLower = char.name.toLowerCase();

      // Always include core characters - they're central to the story
      if (char.importance === 'core') {
        return true;
      }

      // Direct match by name
      if (neededCharacterRefs.has(charNameLower)) {
        return true;
      }

      // Partial match - check if any reference contains or is contained in character name
      for (const ref of neededCharacterRefs) {
        // Check both directions - "Rose" matches "Rose the Healer" and vice versa
        const refParts = ref.split(/\s+/);
        const nameParts = charNameLower.split(/\s+/);

        // Match if first name matches or full name contains reference
        if (refParts.some(part => nameParts.includes(part)) ||
            charNameLower.includes(ref) ||
            ref.includes(charNameLower)) {
          return true;
        }
      }

      return false;
    });

    // If no characters were matched, include all core/supporting ones
    const charactersToUse = filteredCharacters.length > 0
      ? filteredCharacters
      : analysis.majorCharacters.filter(c => c.importance === 'core' || c.importance === 'supporting');

    this.emit({ type: 'debug', phase: 'filtering', message: `Episode characters needed: ${Array.from(neededCharacterRefs).join(', ')}` });
    this.emit({ type: 'debug', phase: 'filtering', message: `Filtered characters: ${charactersToUse.map(c => c.name).join(', ')}` });

    return {
      ...analysis,
      keyLocations: locationsToUse,
      majorCharacters: charactersToUse,
      totalEstimatedEpisodes: selectedEpisodes.length,
      episodeBreakdown: selectedEpisodes,
    };
  }

  /**
   * Convert collected visual planning data to the format expected by the output writer
   */
  private getCollectedVisualPlanningForSave(): VisualPlanningOutputs | undefined {
    // Only return if we have any visual planning data
    if (
      !this.collectedVisualPlanning.colorScript &&
      this.collectedVisualPlanning.characterReferences.size === 0 &&
      this.collectedVisualPlanning.visualPlans.length === 0
    ) {
      return undefined;
    }

    // Convert character references Map to array
    const characterReferences: CharacterVisualReference[] = Array.from(
      this.collectedVisualPlanning.characterReferences.values()
    );

    return {
      colorScript: this.collectedVisualPlanning.colorScript,
      characterReferences,
      visualPlans: this.collectedVisualPlanning.visualPlans
    };
  }

  /**
   * Reset collected visual planning data for a new generation run
   */
  private resetCollectedVisualPlanning(): void {
    this.collectedVisualPlanning = {
      colorScript: undefined,
      characterReferences: new Map(),
      visualPlans: []
    };
  }

  // ── Memory persistence (Claude memory tool) ───────────────────────

  private get memoryEnabled(): boolean {
    return !!this.config.memory?.enabled && this.config.agents.storyArchitect.provider === 'anthropic';
  }

  private getMemoryStoreInstance(): MemoryStore {
    if (this.config.memory?.directory) {
      return new NodeMemoryStore(this.config.memory.directory);
    }
    return getMemoryStore();
  }

  /**
   * Write pipeline self-optimization data after a generation run.
   * Appends a timestamped entry with QA score, failures, and timing.
   */
  async writeGenerationMemory(opts: {
    success: boolean;
    qaScore?: number;
    qaPassed?: boolean;
    bestPracticesScore?: number;
    duration: number;
    artStyle?: string;
    failedAgents?: string[];
    timeoutAgents?: string[];
    error?: string;
    episodeTitle?: string;
  }): Promise<void> {
    if (!this.memoryEnabled || !this.config.memory?.pipelineOptimization) return;
    try {
      const store = this.getMemoryStoreInstance();
      const ts = new Date().toISOString();
      const entry = [
        `\n## ${ts} — ${opts.episodeTitle || 'Generation'}`,
        `- Result: ${opts.success ? 'SUCCESS' : 'FAILED'}`,
        opts.qaScore != null ? `- QA Score: ${opts.qaScore}/100 (${opts.qaPassed ? 'passed' : 'needs revision'})` : null,
        opts.bestPracticesScore != null ? `- Best Practices Score: ${opts.bestPracticesScore}/100` : null,
        `- Duration: ${Math.round(opts.duration / 1000)}s`,
        opts.artStyle ? `- Art Style: ${opts.artStyle}` : null,
        opts.failedAgents?.length ? `- Failed Agents: ${opts.failedAgents.join(', ')}` : null,
        opts.timeoutAgents?.length ? `- Timeout Agents: ${opts.timeoutAgents.join(', ')}` : null,
        opts.error ? `- Error: ${opts.error.substring(0, 200)}` : null,
      ].filter(Boolean).join('\n');

      const path = '/memories/pipeline/generation-log.md';
      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({ command: 'create', path, file_text: `# Pipeline Generation Log\n\nAutomated log of generation results for self-optimization.\n${entry}\n` });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote generation log entry (QA: ${opts.qaScore ?? 'n/a'})`);
    } catch (err) {
      console.warn('[Pipeline] Memory: failed to write generation log:', err);
    }
  }

  /**
   * Write detailed QA learnings that can guide future generations.
   * Extracts recurring patterns from voice, continuity, and stakes reports.
   */
  async writeQALearnings(qaReport: {
    continuity?: { issues: Array<{ description: string; severity: string; suggestedFix?: string }> };
    voice?: { characterScores: Array<{ characterName: string; score: number; weaknesses: string[] }>; recommendations: string[] };
    stakes?: { choiceSetAnalysis: Array<{ stakesScore: number; analysis: string; improvements: string[] }> };
    overallScore: number;
    criticalIssues: string[];
  }, episodeTitle?: string): Promise<void> {
    if (!this.memoryEnabled || !this.config.memory?.pipelineOptimization) return;
    try {
      const store = this.getMemoryStoreInstance();
      const ts = new Date().toISOString();
      const lines: string[] = [`\n## ${ts} — ${episodeTitle || 'Generation'} (QA: ${qaReport.overallScore}/100)`];

      if (qaReport.voice?.characterScores) {
        const weakVoices = qaReport.voice.characterScores.filter(c => c.score < 70 && c.weaknesses.length > 0);
        if (weakVoices.length > 0) {
          lines.push('### Voice Issues');
          for (const v of weakVoices) {
            lines.push(`- ${v.characterName} (${v.score}/100): ${v.weaknesses.slice(0, 3).join('; ')}`);
          }
        }
        if (qaReport.voice.recommendations.length > 0) {
          lines.push(`- Recommendations: ${qaReport.voice.recommendations.slice(0, 3).join('; ')}`);
        }
      }

      if (qaReport.continuity?.issues) {
        const errors = qaReport.continuity.issues.filter(i => i.severity === 'error');
        if (errors.length > 0) {
          lines.push('### Continuity Errors');
          for (const e of errors.slice(0, 5)) {
            lines.push(`- ${e.description}${e.suggestedFix ? ` → ${e.suggestedFix}` : ''}`);
          }
        }
      }

      if (qaReport.stakes?.choiceSetAnalysis) {
        const weakStakes = qaReport.stakes.choiceSetAnalysis.filter(cs => cs.stakesScore < 50);
        if (weakStakes.length > 0) {
          lines.push('### Weak Stakes');
          for (const s of weakStakes.slice(0, 3)) {
            lines.push(`- Score ${s.stakesScore}: ${s.analysis.substring(0, 120)}`);
            if (s.improvements.length > 0) {
              lines.push(`  Fix: ${s.improvements.slice(0, 2).join('; ')}`);
            }
          }
        }
      }

      if (qaReport.criticalIssues.length > 0) {
        lines.push('### Critical Issues');
        for (const ci of qaReport.criticalIssues.slice(0, 5)) {
          lines.push(`- ${ci}`);
        }
      }

      if (lines.length <= 1) return;

      const entry = lines.join('\n');
      const path = '/memories/pipeline/qa-learnings.md';
      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({
          command: 'create',
          path,
          file_text: `# QA Learnings\n\nRecurring quality patterns extracted from generation QA reports.\nThese learnings are injected into agent prompts to prevent repeat issues.\n${entry}\n`,
        });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote QA learnings (${lines.length - 1} pattern(s))`);
    } catch (err) {
      console.warn('[Pipeline] Memory: failed to write QA learnings:', err);
    }
  }

  /**
   * Write character knowledge after a character reference sheet is generated.
   * Stores vision analysis results, physical traits, and whether ref images matched.
   */
  async writeCharacterMemory(opts: {
    characterName: string;
    characterId: string;
    visionAnalysisSucceeded: boolean;
    physicalTraits: Record<string, any>;
    hadUserReferenceImages: boolean;
    userRefCount: number;
    generationSucceeded: boolean;
    artStyle?: string;
  }): Promise<void> {
    if (!this.memoryEnabled || !this.config.memory?.characterKnowledge) return;
    try {
      const store = this.getMemoryStoreInstance();
      const safeName = opts.characterName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `/memories/characters/${safeName}.md`;
      const ts = new Date().toISOString();

      const traits = opts.physicalTraits;
      const traitLines = Object.entries(traits)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => `  - ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');

      const entry = [
        `\n## ${ts}`,
        `- Character: ${opts.characterName} (${opts.characterId})`,
        `- User Reference Images: ${opts.hadUserReferenceImages ? `yes (${opts.userRefCount})` : 'none'}`,
        `- Vision Analysis: ${opts.visionAnalysisSucceeded ? 'succeeded' : 'FAILED'}`,
        `- Generation: ${opts.generationSucceeded ? 'succeeded' : 'failed'}`,
        opts.artStyle ? `- Art Style: ${opts.artStyle}` : null,
        `- Physical Traits Used:\n${traitLines || '  (none)'}`,
      ].filter(Boolean).join('\n');

      const existing = await store.execute({ command: 'view', path });
      if (existing.includes('does not exist')) {
        await store.execute({
          command: 'create',
          path,
          file_text: `# Character Knowledge: ${opts.characterName}\n\nPersisted across generations for improved reference matching.\n${entry}\n`,
        });
      } else {
        await store.execute({ command: 'insert', path, insert_line: 999999, insert_text: entry + '\n' });
      }
      console.log(`[Pipeline] Memory: wrote character knowledge for ${opts.characterName}`);
    } catch (err) {
      console.warn(`[Pipeline] Memory: failed to write character knowledge for ${opts.characterName}:`, err);
    }
  }

  /**
   * Read character knowledge from memory for a given character.
   * Returns the memory content or null if none exists.
   */
  async readCharacterMemory(characterName: string): Promise<string | null> {
    if (!this.memoryEnabled || !this.config.memory?.characterKnowledge) return null;
    try {
      const store = this.getMemoryStoreInstance();
      const safeName = characterName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `/memories/characters/${safeName}.md`;
      const result = await store.execute({ command: 'view', path });
      if (result.includes('does not exist')) return null;
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Read pipeline optimization memories.
   * Returns the generation log content or null if none exists.
   */
  async readPipelineMemory(): Promise<string | null> {
    if (!this.memoryEnabled || !this.config.memory?.pipelineOptimization) return null;
    try {
      const store = this.getMemoryStoreInstance();
      const parts: string[] = [];

      const genLog = await store.execute({ command: 'view', path: '/memories/pipeline/generation-log.md' });
      if (!genLog.includes('does not exist')) {
        parts.push(genLog);
      }

      const qaLearnings = await store.execute({ command: 'view', path: '/memories/pipeline/qa-learnings.md' });
      if (!qaLearnings.includes('does not exist')) {
        parts.push(qaLearnings);
      }

      return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
    } catch {
      return null;
    }
  }

  /**
   * Run ONLY the video generation phase against an already-generated story.
   * Reconstructs the data structures the video pipeline needs from the story JSON
   * and the original generation artifacts (brief, world bible) on disk.
   */
  async runVideoOnly(story: Story): Promise<{ videosGenerated: number; story: Story }> {
    const outputDir = story.outputDir;
    if (!outputDir) throw new Error('Story has no outputDir — cannot locate generation artifacts');

    this.jobId = this.externallyAssignedJobId || `vidonly-${Date.now()}`;
    this.externallyAssignedJobId = null;

    await this.checkCancellation();
    this.emit({ type: 'phase_start', phase: 'video_generation', message: 'Loading story artifacts for video-only generation...' });

    const baseUrl = `${PROXY_CONFIG.getProxyUrl()}/`;

    const fetchJson = async <T>(filename: string): Promise<T> => {
      const url = `${baseUrl}${outputDir}${filename}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load ${filename}: HTTP ${resp.status}`);
      return resp.json() as Promise<T>;
    };

    const brief = await fetchJson<FullCreativeBrief>('00-input-brief.json');
    const worldBible = await fetchJson<WorldBible>('01-world-bible.json');

    const beatImages = new Map<string, string>();
    const sceneImages = new Map<string, string>();
    const sceneContents: SceneContent[] = [];

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        if (scene.encounter) continue;

        const beats: GeneratedBeat[] = (scene.beats || []).map(beat => {
          if (beat.image) {
            beatImages.set(`${scene.id}::${beat.id}`, beat.image);
          }
          return {
            id: beat.id,
            text: beat.text || '',
            speaker: beat.speaker,
            speakerMood: beat.speakerMood,
            nextBeatId: beat.nextBeatId,
            isChoicePoint: !!(beat.choices && beat.choices.length > 0),
            visualMoment: (beat as any).visualMoment,
            primaryAction: (beat as any).primaryAction,
            emotionalRead: (beat as any).emotionalRead,
            shotType: (beat as any).shotType,
          };
        });

        if (scene.backgroundImage) {
          sceneImages.set(scene.id, scene.backgroundImage);
        }

        sceneContents.push({
          sceneId: scene.id,
          sceneName: scene.name || scene.id,
          beats,
          startingBeatId: scene.startingBeatId || beats[0]?.id || '',
          moodProgression: (scene as any).moodProgression || [],
          charactersInvolved: (scene as any).charactersPresent || [],
          keyMoments: [],
          continuityNotes: [],
        });
      }
    }

    if (beatImages.size === 0) {
      throw new Error('No beat images found in story — video generation requires existing images');
    }

    this.emit({
      type: 'agent_start',
      phase: 'video_generation',
      message: `Found ${beatImages.size} beat images across ${sceneContents.length} scenes. Starting video generation...`,
    });

    const videosDir = `${outputDir}videos/`;
    this.videoService.setOutputDirectory(videosDir);

    const videoRunResult = await this.runVideoGeneration(
      sceneContents,
      { beatImages, sceneImages },
      brief,
      worldBible
    );
    const videoResults = videoRunResult.videoResults;

    const videosGenerated = this.bindGeneratedVideoToStory(story, videoResults);
    await saveVideoDiagnosticsLog(outputDir, videoRunResult.diagnostics);

    this.emit({
      type: 'phase_complete',
      phase: 'video_generation',
      message: `Video-only generation complete: ${videosGenerated} clips generated`,
    });

    const storyJsonUrl = PROXY_CONFIG.writeFile;
    const storyFilePath = `${outputDir}08-final-story.json`;
    await fetch(storyJsonUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: storyFilePath,
        content: JSON.stringify(story, null, 2),
        isBase64: false,
      }),
    });

    console.log(`[Pipeline] Video-only run complete: ${videosGenerated} videos for "${story.title}"`);
    return { videosGenerated, story };
  }
}
