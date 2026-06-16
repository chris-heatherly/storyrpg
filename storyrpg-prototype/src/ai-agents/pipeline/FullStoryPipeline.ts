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

import { PipelineConfig, loadConfig, defaultValidationConfig, clampTargetBeatCount, MAX_BEATS_PER_SCENE, type MemoryConfig, type PreapprovedAnchor } from '../config';
import { AudioGenerationService } from '../services/audioGenerationService';
import { generateEpisodeId, slugify as idSlugify } from '../utils/idUtils';
import { isUnsafeCallbackProse } from '../constants/metaProse';


import { 
  SCENE_DEFAULTS, 
  TIMING_DEFAULTS, 
  CHARACTER_DEFAULTS,
  DEFAULT_SKILLS,
  CONCURRENCY_DEFAULTS,
} from '../../constants/pipeline';
import { TEXT_LIMITS } from '../../constants/validation';
import { WorldBuilder, WorldBible } from '../agents/WorldBuilder';
import { CharacterDesigner, CharacterBible, CharacterProfile } from '../agents/CharacterDesigner';
import { StoryArchitect, EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { SceneWriter, SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceAuthor, ChoiceSet } from '../agents/ChoiceAuthor';
import { QARunner, QAReport, ContinuityChecker } from '../agents/QAAgents';
import { SourceMaterialAnalyzer, SourceMaterialInput } from '../agents/SourceMaterialAnalyzer';
import { SeasonPlan } from '../../types/seasonPlan';
import type { CharacterFashionStyle } from '../../types/sourceAnalysis';

// Types CrossEpisodeBranch, ConsequenceChain, PlannedEncounter used transitively via SeasonPlan
import { BranchManager, BranchAnalysis, BranchPath } from '../agents/BranchManager';
import { SceneCritic } from '../agents/SceneCritic';
import { PronounDisambiguator } from '../agents/PronounDisambiguator';
import { canonicalizeProtagonistPronouns, otherGenderNamesFromStory, applyPronounDisambiguations } from '../utils/protagonistPronounResolver';
import { OutcomeVariantAuthor } from '../agents/OutcomeVariantAuthor';
import { seedEncounterOutcomeFlags, findEncounterOutcomeDesyncs, firstProseBeatId, applyOutcomeVariants, normalizeEncounterOutcomeFlags } from '../utils/encounterOutcomeFlags';
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
import { ImagePrompt } from '../images/imageTypes';
import {
  ImageGenerationService,
  ReferenceImage,
  type EncounterImageDiagnostic,
  type CanonicalAppearance,
  type CharacterAppearanceDescription,
} from '../services/imageGenerationService';
import type { GeneratedImage } from '../images/imageTypes';
import { VideoDirectorAgent, VideoDirectionRequest } from '../agents/image-team/VideoDirectorAgent';
import { VideoGenerationService } from '../services/videoGenerationService';
import { selectStyleAdaptation, resolveSceneSettingContext, type SceneSettingContext } from '../utils/styleAdaptation';
import { buildFashionStyleSummary } from '../images/characterFashionStyle';
import { resolvePlayerTemplatesInObject } from '../utils/playerTemplateResolver';
import { applyPromptContract, sanitizeStyleContaminationText } from '../images/imagePromptContracts';
import {
  attachStoryboardPlanToVisualPlan,
  buildSceneVisualStoryboardPlan,
  chunkStoryboardBeats,
  normalizeImagePlanningMode,
  validateVisualStoryboardPacket,
  visualPlanSlotsFromBeats,
  visualPlanSlotsFromEncounterManifest,
  visualPlanSlotsFromStoryletManifest,
  type ImagePlanningMode,
  type SceneVisualStoryboardPlan,
  type StoryboardReferenceSummary,
  type VisualStoryboardPacket,
} from '../images/visualStoryboardPlanning';
import { 
  Story, Episode, Scene, Beat, Choice, NPCTier, RelationshipDimension, Consequence,
  Encounter, EncounterOutcome, EncounterType, EncounterClock, EncounterPhase,
  EncounterChoice as TypeEncounterChoice, EncounterChoiceOutcome as TypeEncounterChoiceOutcome,
  EnvironmentalElement, NPCEncounterState, EscalationTrigger, InformationVisibility, 
  PixarStakes, CinematicImageDescription, EncounterVisualContract
} from '../../types';
import { PipelineEvent, PipelineEventHandler, PipelineProgressTelemetry } from './events';
import {
  type GenerationPlan,
  applyEventToPlan,
  computeOverallProgress,
  initPlan,
  setSceneBeats,
  markEpisode,
  snapshotPlan,
} from './generationPlan';

import {
  episodeTypeCounts,
  spineEntriesFromChoicePlan,
  type SeasonChoicePlan,
} from './seasonChoicePlan';
import { type SeasonSkillPlan } from './seasonSkillPlan';
import { writeEpisodeCompletion, partitionResumableEpisodes } from './episodeCheckpoints';
import { runEpisodeLoopOnGraph, runFoundationOnGraph } from './episodeRunGraph';
import { repairWeakCliffhangerBeforeImages as repairWeakCliffhangerBeforeImagesImpl } from './cliffhangerRepair';
import { captureEncounterTelemetry as captureEncounterTelemetryInto } from './encounterTelemetryCollect';

import { reconcileBriefStoryMetadata } from './briefStoryMetadata';
import {
  filterAnalysisForEpisodeRange,
  refreshAnalysisFromTreatmentDocument,
  refreshBriefSeasonPlanFromAnalysis,
} from './treatmentRefresh';
import { SeasonCanon } from './seasonCanon';
import { createRunState, type PipelineRunState } from './runState';
import { sealAndPersistEpisode } from './seasonSealOrchestration';
import { validateSeasonCompletion } from '../validators/promiseLedgerValidators';
import { runPlanTimeFidelityChecks } from '../validators/runFidelityValidators';
import {
  buildChoiceAuthorNpcs,
  buildCompactWorldContext,
  buildEncounterPriorStateContext,
  deriveStoryVerbsForBrief,
  inferBranchType,
} from './contextAssembly';
import { applySpinePlantMap, deriveSpinePlantMap } from './spinePlantMap';
import { extractEpisodeKnowledge, collectReferencedFlags, episodeProseCorpus } from './knowledgeExtraction';

import { runEpisodeChargeMaterializationForSeason } from './episodeChargeMaterialization';

import { ThreadPlanner } from '../agents/ThreadPlanner';
import { TwistArchitect, type TwistPlan } from '../agents/TwistArchitect';
import { CharacterArcTracker, type CharacterArcTargets } from '../agents/CharacterArcTracker';
import { simulateEpisodeArcDeltas } from './characterArcPlanning';
import type { ThreadLedger } from '../../types/narrativeThread';
import { buildSceneTimelineLabels } from './sceneNumbering';
import { characterCapabilityWorldFacts } from './characterCanonFacts';
import type { EpisodeStateSnapshot } from './episodeStateSnapshot';
import { SavingPhase } from './phases/SavingPhase';
import { WorldBuildingPhase } from './phases/WorldBuildingPhase';
import { AudioPhase } from './phases/AudioPhase';
import { BrowserQAPhase } from './phases/BrowserQAPhase';
import { VideoPhase, bindGeneratedVideoToStory } from './phases/VideoPhase';
import { MasterImagePhase } from './phases/MasterImagePhase';
import { SceneImagePhase, type SceneImagePhaseDeps } from './phases/SceneImagePhase';
import { EncounterImagePhase } from './phases/EncounterImagePhase';
import { CoverArtPhase } from './phases/CoverArtPhase';
import { ImageSupport } from './imageSupport';
import { PipelineMemory } from './pipelineMemory';
import { RunLedger } from './runLedger';
import { DraftImageEntry } from './draftImageEntry';
import { DraftImageGeneration, type DraftImageGenerationDeps } from './draftImageGeneration';
import { SceneGraphValidation, type SceneGraphValidationDeps } from './sceneGraphValidation';
import { SceneCriticContinuity, type SceneCriticContinuityDeps } from './sceneCriticContinuity';
import { FinalContract, type FinalContractDeps } from './finalContract';
import { Assembly } from './assembly';
import { QAPhase, type QAPhaseDeps } from './phases/QAPhase';
import { QuickValidationPhase, type QuickValidationPhaseDeps } from './phases/QuickValidationPhase';
import { ContentGenerationPhase, type ContentGenerationPhaseDeps } from './phases/ContentGenerationPhase';
import { AssemblyPhase } from './phases/AssemblyPhase';
import { EpisodeArchitecturePhase, type EpisodeArchitecturePhaseDeps } from './phases/EpisodeArchitecturePhase';
import { BranchAnalysisPhase, type BranchAnalysisPhaseDeps } from './phases/BranchAnalysisPhase';
import { CharacterDesignPhase, type CharacterDesignPhaseDeps } from './phases/CharacterDesignPhase';
import { NPCDepthValidationPhase } from './phases/NPCDepthValidationPhase';
import {
  createOutputDirectory,
  ensureDirectory,
  savePipelineOutputs,
  savePipelineErrorLog,
  savePartialStory,
  appendFailedRunLedger,
  saveEarlyDiagnostic,
  saveAudioDiagnosticsLog,
  saveEncounterImageDiagnosticsLog,
  saveVideoDiagnosticsLog,
  loadEarlyDiagnosticSync,
  saveBeatResumeState,
  BeatResumeStateV1,
  updateOutputManifest,
  OutputManifest,
} from '../utils/pipelineOutputWriter';
import {
  buildEncounterSlotManifest,
  collectMissingSlotsFromManifest,
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
import {
  getUnresolvedCallbacksForPrompt as getUnresolvedCallbacksForPromptImpl,
  harvestEpisodeCallbacks as harvestEpisodeCallbacksImpl,
  injectFallbackCallbacks as injectFallbackCallbacksImpl,
  type UnresolvedCallbackForPrompt,
  type HarvestEpisodeCallbacksParams,
  type InjectFallbackCallbacksParams,
} from './callbackOrchestration';
import { assembleStoryAssetsFromRegistry } from '../images/storyAssetAssembler';
import { StoryboardV2Pipeline, type StoryboardV2Result } from '../images/storyboard-v2/StoryboardV2Pipeline';
import { runPlaywrightQA, runPlaywrightQAMultiPath, type PlaywrightQAResult } from '../validators/playwrightQARunner';
import { remediateImageIssues, resaveFinalStory } from '../validators/qaRemediation';
import { buildReferencePack } from '../images/referencePackBuilder';
import {
  anchorIdentifier,
} from '../images/anchorPrompts';
import { buildVerbatimProfile, composeCanonicalStyleString } from '../images/artStyleProfile';
import { getReferenceStrategy } from '../images/referenceStrategy';
import { buildStoryImageSlotManifest } from '../images/storyImageSlotManifest';
import type { ImageSlot, ImageSlotFamily, SlotReferencePack } from '../images/slotTypes';
import { planShotSequence, type ShotPlan, type PanelMode } from '../images/shotSequencePlanner';
import {
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
  CliffhangerValidator,
  NPCDepthValidator,
  IncrementalValidationRunner,
  SceneValidationResult,
  IncrementalValidationConfig,
  PhaseValidator,
  StructuralValidator,
  ChoiceDistributionValidator,
  SceneGraphBranchValidator,
  DuplicateEstablishingBeatValidator,
  TreatmentSeedOnPageValidator,
  EndingReachabilityValidator,
  MicroEpisodeStructureValidator,
  MicroEpisodeSeasonValidator,
  type FinalStoryContractReport,
  TreatmentFidelityValidator,
  type SceneGraphBranchValidationResult,
  runNarrativeDiagnostics,
  type NarrativeDiagnosticsReport,
  ChoiceDensityValidator,
  ConsequenceBudgetValidator,
  PropIntroductionValidator,
} from '../validators';
import type { PhaseValidationResult } from '../validators/PhaseValidator';
import { PLAN_GATE_FLAGS, shouldGate } from '../remediation/planGatePolicy';
import { CallbackCoverageValidator } from '../validators/CallbackCoverageValidator';
import { buildPropIntroductionInput } from '../remediation/propIntroductionGate';
import { stabilizeByHysteresis } from '../remediation/judgeStabilizer';

import { RemediationBudget, createRemediationBudget, shouldAttemptRemediation } from '../remediation/RemediationBudget';
import { type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { buildGateShadowRecord, type GateShadowRecord } from '../remediation/gateShadowLedger';
import { isGateEnabled, isShadowLoggingEnabled } from '../remediation/gateDefaults';
import { repairAndRevalidatePropIntroduction } from '../remediation/repairs/propIntroductionRepair';
import {
  ComprehensiveValidationReport,
  QuickValidationResult,
  ValidationIssue,
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
  isJobCancelled,
  updateJob,
  completeJob,
  failJob,
  generateJobId,
  JobCancelledError,
} from '../utils/jobTracker';
import { BaseAgent, isLlmQuotaError } from '../agents/BaseAgent';
import { withTimeout, withTimeoutAbort, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import { LocalWorkerQueue, mapWithConcurrency } from '../utils/concurrency';

import { PipelineTelemetry, buildLlmCallObserver } from '../utils/pipelineTelemetry';
import { analyzeBranchTopology } from '../utils/branchTopology';
import { getEncounterBeats } from '../utils/encounterImageCoverage';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';
import { PROXY_CONFIG } from '../../config/endpoints';
import {
  createCharacterBriefFromAnalysis,
  createEpisodeOptions,
  createWorldBriefFromAnalysis,
  getLocationInfoForScene,
} from './planningHelpers';
import { mergeSeasonEpisodes } from './seasonStoryMerge';
import {
  normalizeConsequences,
  routeFallbackChoicesAcrossTargets,
} from './choiceAssembly';

// Re-export types for consumers
export type { OutputManifest } from '../utils/pipelineOutputWriter';
export type { PipelineEvent } from './events';

// PipelineError moved to ./errors (pure move) so pipeline/phases/* can use it
// without importing this monolith. Re-exported here for existing consumers.
import { PipelineError } from './errors';
export { PipelineError };

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
    fashionStyle?: CharacterFashionStyle;
  };

  npcs: Array<{
    id: string;
    name: string;
    role: 'antagonist' | 'ally' | 'neutral' | 'wildcard';
    description: string;
    importance: 'major' | 'supporting' | 'minor';
    relationshipToProtagonist?: string;
    fashionStyle?: CharacterFashionStyle;
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
      episodeStructureMode?: 'standard' | 'sceneEpisodes';
      sceneEpisodeEncounterCadence?: number;
      sceneEpisodeBranchMinEpisodes?: number;
      sceneEpisodeBranchMaxEpisodes?: number;
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
  requiresApproval?: boolean;
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
  // Advisory (non-fatal) validation warnings accumulated across episodes when
  // the architect ships a blueprint despite craft/fidelity issues (B1). Fed
  /**
   * R1 refactor: segmented run state (season narrative / episode scratch /
   * run accumulators) — see pipeline/runState.ts. The legacy field names
   * below remain as thin delegating accessors so existing references (and the
   * clusters' Object.defineProperties live-read getters) work unchanged while
   * call sites migrate to explicit state.
   */
  private readonly runState: PipelineRunState = createRunState();

  // into the run's quality record so the issues stay visible.
  private get architectAdvisoryWarnings(): string[] { return this.runState.run.architectAdvisoryWarnings; }
  private set architectAdvisoryWarnings(v: string[]) { this.runState.run.architectAdvisoryWarnings = v; }
  // C4: running total of LLM tokens (input + output) across the whole run, used
  // to enforce config.generation.tokenBudgetPerStory in checkCancellation.
  private _totalTokensUsed = 0;
  // F4: last-known run output dir, so the terminal catch (which is outside the
  // try scope that declares outputDirectory) can still write the error log +
  // a 'failed' quality-ledger row on abort.
  private _currentOutputDirectory?: string;
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
  private sceneGraphBranchValidator: SceneGraphBranchValidator = new SceneGraphBranchValidator();
  private duplicateEstablishingBeatValidator: DuplicateEstablishingBeatValidator = new DuplicateEstablishingBeatValidator();
  private treatmentSeedOnPageValidator: TreatmentSeedOnPageValidator = new TreatmentSeedOnPageValidator();
  private endingReachabilityValidator: EndingReachabilityValidator = new EndingReachabilityValidator();
  private microEpisodeStructureValidator: MicroEpisodeStructureValidator = new MicroEpisodeStructureValidator();
  private microEpisodeSeasonValidator: MicroEpisodeSeasonValidator = new MicroEpisodeSeasonValidator();
  
  // Incremental validation (per-scene during content generation)
  private incrementalValidator: IncrementalValidationRunner | null = null;
  private get sceneValidationResults(): SceneValidationResult[] { return this.runState.episode.sceneValidationResults; }
  private set sceneValidationResults(v: SceneValidationResult[]) { this.runState.episode.sceneValidationResults = v; }
  private get allSceneValidationResults(): SceneValidationResult[] { return this.runState.run.allSceneValidationResults; }
  private set allSceneValidationResults(v: SceneValidationResult[]) { this.runState.run.allSceneValidationResults = v; }

  // Per-encounter telemetry (I2). `encounterTelemetry` is reset per episode; season-
  // final consumers read `allEncounterTelemetry`. See encounterTelemetryCollect.ts.
  private get encounterTelemetry(): EncounterTelemetry[] { return this.runState.episode.encounterTelemetry; }
  private set encounterTelemetry(v: EncounterTelemetry[]) { this.runState.episode.encounterTelemetry = v; }
  private get allEncounterTelemetry(): EncounterTelemetry[] { return this.runState.run.allEncounterTelemetry; }
  private set allEncounterTelemetry(v: EncounterTelemetry[]) { this.runState.run.allEncounterTelemetry = v; }

  // S3: per-run remediation budget — a hard cap on total corrective re-work
  // (scene/encounter/choice regeneration). Created per run/episode with a HIGH
  // ceiling (config.remediationBudgetTotal, default 1000) so default behavior is
  // unchanged; when exhausted, seams degrade gracefully instead of blocking.
  private remediationBudget: RemediationBudget | null = null;
  // Per-run remediation counters, summarized into the quality ledger row.

  // Shadow-mode diffs between the LLM `BranchManager` and the deterministic
  // `analyzeBranchTopology` pass. Populated only when
  // `config.generation.branchShadowModeEnabled` is true; persisted as a
  // sidecar via pipelineOutputWriter so D4 (BranchManager gating) can be
  // decided from data rather than intuition (I5 instrumentation).
  private get branchShadowDiffs(): Array<{
    episodeId: string;
    diff: import('../utils/branchShadowDiff').BranchShadowDiff;
  }> { return this.runState.run.branchShadowDiffs; }
  private set branchShadowDiffs(v: Array<{
    episodeId: string;
    diff: import('../utils/branchShadowDiff').BranchShadowDiff;
  }>) { this.runState.run.branchShadowDiffs = v; }

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
   * session resumes can re-prime `setSeasonStyleReference` without
   * rebuilding the style bible from scratch.
   */
  private _styleAnchorPaths: {
    character?: string;
    arcStrip?: string;
    environment?: string;
  } = {};
  private _uploadedStyleReferenceImages: ReferenceImage[] = [];
  private _generatedStyleReferencesAllowed = true;
  private _activeImageResumeOutputDirectory?: string;

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
  /**
   * Structure-driven progress plan (episodes -> scenes -> beats). Built up as
   * the pipeline discovers structure and used to drive the headline % and the
   * generator's progress tree. Null until seeded at the start of a run; stays
   * null for analysis-only runs (no episode generation).
   */
  private generationPlan: GenerationPlan | null = null;
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
  private get callbackLedger(): CallbackLedger { return this.runState.season.callbackLedger; }
  private set callbackLedger(v: CallbackLedger) { this.runState.season.callbackLedger = v; }
  // Thread/Twist planning (default-off, STORYRPG_THREAD_TWIST_PLANNING): run-level
  // NarrativeThread ledger accumulated across episodes (mirrors callbackLedger) +
  // each episode's TwistPlan, consumed by SceneWriter inputs and narrative
  // diagnostics. Stays empty when the flag is off, so consumers see undefined.
  private get seasonThreadLedger(): ThreadLedger { return this.runState.season.threadLedger; }
  private set seasonThreadLedger(v: ThreadLedger) { this.runState.season.threadLedger = v; }
  private get episodeTwistPlans(): Map<number, TwistPlan> { return this.runState.season.episodeTwistPlans; }
  private set episodeTwistPlans(v: Map<number, TwistPlan>) { this.runState.season.episodeTwistPlans = v; }
  private get episodeArcTargets(): Map<number, CharacterArcTargets> { return this.runState.season.episodeArcTargets; }
  private set episodeArcTargets(v: Map<number, CharacterArcTargets>) { this.runState.season.episodeArcTargets = v; }
  // Lazily constructed so a flag-off run never instantiates the agents.
  private _threadPlanner?: ThreadPlanner;
  private _twistArchitect?: TwistArchitect;
  private getThreadPlanner(): ThreadPlanner {
    if (!this._threadPlanner) this._threadPlanner = new ThreadPlanner(this.config.agents.storyArchitect);
    return this._threadPlanner;
  }
  private getTwistArchitect(): TwistArchitect {
    if (!this._twistArchitect) this._twistArchitect = new TwistArchitect(this.config.agents.storyArchitect);
    return this._twistArchitect;
  }
  private _characterArcTracker?: CharacterArcTracker;
  private getCharacterArcTracker(): CharacterArcTracker {
    if (!this._characterArcTracker) this._characterArcTracker = new CharacterArcTracker(this.config.agents.storyArchitect);
    return this._characterArcTracker;
  }
  // Season Canon (P4): durable frozen facts + the snapshot carried forward across
  // sequentially-generated episodes.
  private get seasonCanon(): SeasonCanon { return this.runState.season.canon; }
  private set seasonCanon(v: SeasonCanon) { this.runState.season.canon = v; }
  private get priorEpisodeSnapshot(): EpisodeStateSnapshot | undefined { return this.runState.season.priorEpisodeSnapshot; }
  private set priorEpisodeSnapshot(v: EpisodeStateSnapshot | undefined) { this.runState.season.priorEpisodeSnapshot = v; }
  /**
   * E1: the season-level choice-type plan, allocated ONCE across the season's moments
   * (35/30/20/15 is a SEASON budget, not per-episode). Built in runEpisodeArchitecture
   * from the season plan; each episode draws its type slice via episodeTypeCounts.
   */
  private get seasonChoicePlan(): SeasonChoicePlan | undefined { return this.runState.season.choicePlan; }
  private set seasonChoicePlan(v: SeasonChoicePlan | undefined) { this.runState.season.choicePlan = v; }
  private get seasonSkillPlan(): SeasonSkillPlan | undefined { return this.runState.season.skillPlan; }
  private set seasonSkillPlan(v: SeasonSkillPlan | undefined) { this.runState.season.skillPlan = v; }
  /**
   * Season Canon is ON by default (opt-out, not opt-in): it activates unless the
   * config EXPLICITLY sets seasonCanonEnabled === false. The flag is built client-
   * side (GeneratorScreen -> buildPipelineConfig) and may be absent/undefined when an
   * older generator bundle posts the job; treating undefined as ON makes "on for all
   * generations" hold regardless of the client bundle. Disable with seasonCanonEnabled:false.
   */
  private get seasonCanonOn(): boolean {
    return this.config.generation?.seasonCanonEnabled !== false;
  }

  /**
   * D2: Season Canon gate ENFORCEMENT. On by default (opt-out) now that B1/B2 are
   * validated against a clean regen (the promise/canon gates ran with real claims and
   * produced 0 false-positives). When on, a promise-due/dangling/plant-validity/
   * impossible-knowledge ERROR hard-fails the offending episode (regenerate it) rather
   * than shipping the incoherence. Disable with seasonCanonBlocking: false.
   */
  private get seasonCanonBlockingOn(): boolean {
    return this.seasonCanonOn && this.config.generation?.seasonCanonBlocking !== false;
  }

  /**
   * B1: the sealed canon rendered as the read-only "ESTABLISHED CANON — do not
   * contradict" block for SceneWriter/ChoiceAuthor prompts (the read-back path).
   * Returns undefined when canon is off or empty so the prompt section is skipped.
   */
  private establishedCanonForPrompt(episodeNumber?: number): string | undefined {
    if (!this.seasonCanonOn) return undefined;
    const block = this.seasonCanon.canonForPrompt(episodeNumber);
    return block && block.trim() ? block : undefined;
  }
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
    // The observer forwards every provider call — INCLUDING its `usage` field —
    // into telemetry so the LLM ledger (09-llm-ledger.json) can total tokens.
    // C4: the onUsage callback accumulates total tokens so checkCancellation can
    // enforce a per-story ceiling and abort runaway retry fan-out. See
    // buildLlmCallObserver for why dropping `usage` here blinds cost tracking.
    BaseAgent.setLlmCallObserver(
      buildLlmCallObserver(
        // Getter, not a snapshot: telemetry is reassigned between runs while the
        // observer is registered only once here.
        () => this.telemetry,
        (totalTokens) => {
          this._totalTokensUsed += totalTokens;
        },
      ),
    );
    // WS5 truncation shadow counter: every lossy truncation recovery (landmine
    // L4 — content silently dropped from a "successful" parse) is ledgered per
    // agent in 09-llm-ledger.json and surfaced as a run warning. This shadow
    // data decides whether retry-on-truncation is worth building.
    BaseAgent.setTruncationObserver((t) => {
      this.telemetry.observeTruncation(t.agentName, t.provider);
      this.emit({
        type: 'warning',
        phase: 'llm_truncation',
        message: `${t.agentName} response was truncated and lossy-recovered — output may be missing trailing content (L4).`,
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

    // Initialize all agents.
    // The planning agents emit large structured JSON (world bible, character
    // bible, the full episode blueprint, branch analysis). The default maxTokens
    // is too small for complex/climax episodes and truncates the response
    // mid-JSON (observed: episode-3 blueprint, "Unterminated string in JSON at
    // position 31479"). Force ample headroom regardless of config source (F8).
    const planningConfig = {
      ...this.config.agents.storyArchitect,
      maxTokens: Math.max(this.config.agents.storyArchitect.maxTokens ?? 0, 32000),
    };
    this.worldBuilder = new WorldBuilder(planningConfig);
    this.characterDesigner = new CharacterDesigner(planningConfig);
    this.storyArchitect = new StoryArchitect(planningConfig, this.config.generation);
    this.sceneWriter = new SceneWriter(this.config.agents.sceneWriter, this.config.generation);
    this.choiceAuthor = new ChoiceAuthor(this.config.agents.choiceAuthor, this.config.generation);
    // C2/C3: QA grader uses its own config when provided (cheaper / decorrelated
    // from the author model); falls back to storyArchitect config otherwise.
    this.qaRunner = new QARunner(this.config.agents.qaRunner || this.config.agents.storyArchitect);
    // maxTokens 32000 (was 16384): the structure-analysis JSON for rich multi-episode treatments was hitting the 16384 cap mid-string (truncated → unparseable).
    const sourceMaterialConfig = { ...this.config.agents.storyArchitect, maxTokens: 32000 };
    this.sourceMaterialAnalyzer = new SourceMaterialAnalyzer(sourceMaterialConfig);
    // BranchManager only annotates a deterministic skeleton now, so it rides the
    // cheaper branch/QA-tier model when configured; falls back to planningConfig.
    this.branchManager = new BranchManager(this.config.agents.branchManager ?? planningConfig);
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
      styleReferenceStrength: this.config.imageGen?.styleReferenceStrength,
      failurePolicy: this.getFailurePolicy(),
    });
    // C4: install the structured art-style profile (if any) so prompt
    // strengthening can operate bidirectionally on style-inappropriate /
    // style-positive vocabulary rather than applying only cinematic defaults.
    if (this.config.imageGen?.artStyleProfile) {
      this.imageService.setArtStyleProfile(this.config.imageGen.artStyleProfile);
    } else if (this.config.artStyle?.trim()) {
      this.config.imageGen = this.config.imageGen || {};
      this.config.imageGen.artStyleProfile = buildVerbatimProfile(this.config.artStyle);
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

  private validateSceneGraphBranching(
    episode: Episode,
    blueprint: EpisodeBlueprint,
    context: {
      phase: string;
      outputDirectory?: string;
      artifactName?: string;
      residueRepair?: { sceneContents: SceneContent[]; reassemble: () => Episode };
    }
  ): Promise<SceneGraphBranchValidationResult> {
    return this.sceneGraphValidation().validateSceneGraphBranching(episode, blueprint, context);
  }

  /**
   * W1 regen route for the protagonist-pronoun gate. Runs the deterministic resolver
   * to surface the AMBIGUOUS residue (sentences naming the protagonist and a
   * wrong-gender NPC), hands those sentences to {@link PronounDisambiguator} for a
   * minimal rewrite, and applies the rewrites back into the story in place. After this
   * the contract's own resolver re-scan finds only genuinely-unresolvable residue, so
   * GATE_PROTAGONIST_PRONOUN can block on real defects instead of every shared-pronoun
   * sentence. No-op (and zero LLM cost) when the gate is off or there is no residue.
   */
  private async disambiguateProtagonistPronouns(story: Story, brief: FullCreativeBrief): Promise<void> {
    if (!isGateEnabled('GATE_PROTAGONIST_PRONOUN')) return;
    const pronouns = brief.protagonist?.pronouns;
    const name = brief.protagonist?.name;
    if (!pronouns || !name) return;

    const names = [name, ...((brief.protagonist as { aliases?: string[] })?.aliases ?? [])].filter(Boolean) as string[];
    const otherGenderNames = otherGenderNamesFromStory(story, pronouns);
    // First pass is read-only here: it reports the ambiguous residue (the safe cases
    // are repaired again, idempotently, by the contract's own resolver run later).
    const scan = canonicalizeProtagonistPronouns(story, { names, pronouns }, otherGenderNames);
    const sentences = [...new Set(scan.ambiguous.map((a) => a.sentence.trim()).filter(Boolean))];
    if (sentences.length === 0) return;

    try {
      const agent = new PronounDisambiguator(this.config.agents.sceneWriter);
      const res = await withTimeout(
        agent.execute({ sentences, protagonistName: name, protagonistPronouns: pronouns, otherGenderNames }),
        PIPELINE_TIMEOUTS.llmAgent,
        'PronounDisambiguator',
      );
      const rewrites = new Map((res.data?.rewrites ?? []).map((r) => [r.original, r.rewritten]));
      const applied = rewrites.size > 0 ? applyPronounDisambiguations(story, rewrites) : 0;
      this.emit({
        type: 'debug',
        phase: 'pronoun_disambiguation',
        message: `Protagonist pronoun disambiguation: ${sentences.length} ambiguous sentence(s), ${rewrites.size} rewritten, ${applied} field replacement(s).`,
      });
    } catch (err) {
      // Degrade: keep the residue; the gate will block on it (never silently passes).
      this.emit({
        type: 'warning',
        phase: 'pronoun_disambiguation',
        message: `Pronoun disambiguation failed (keeping residue): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * W4 regen route for the encounter-outcome-variant gate. Seeds the outcome flags,
   * finds reconvergence scenes whose opening prose ignores the outcome, and authors a
   * per-outcome opening variant (via {@link OutcomeVariantAuthor}) gated on the
   * matching `encounter_<id>_<outcome>` flag. After this the contract's own desync
   * detector finds only reconvergences the author could not cover, so
   * GATE_ENCOUNTER_OUTCOME_VARIANT blocks on real residue. No-op (zero LLM cost) when
   * the gate is off or there are no desyncs.
   */
  private async authorEncounterOutcomeVariants(story: Story): Promise<void> {
    if (!isGateEnabled('GATE_ENCOUNTER_OUTCOME_VARIANT')) return;
    normalizeEncounterOutcomeFlags(story); // G12: unify flag spellings so setters match consumers
    seedEncounterOutcomeFlags(story); // idempotent: ensure the flags the variants gate on exist
    const desyncs = findEncounterOutcomeDesyncs(story).slice(0, 8); // bound the regen work
    if (desyncs.length === 0) return;

    const sceneById = new Map<string, Scene>();
    for (const ep of story.episodes || []) for (const s of ep.scenes || []) sceneById.set(s.id, s);

    let authored = 0;
    try {
      const agent = new OutcomeVariantAuthor(this.config.agents.sceneWriter);
      for (const desync of desyncs) {
        const encounterScene = sceneById.get(desync.encounterSceneId);
        const enc = encounterScene?.encounter;
        const reconScene = sceneById.get(desync.reconvergenceSceneId);
        if (!enc?.outcomes || !reconScene) continue;
        const beatId = firstProseBeatId(reconScene);
        if (!beatId) continue;
        const openingBeatText = (reconScene.beats || []).find((b) => b.id === beatId)?.text ?? '';
        const outcomes = desync.outcomes
          .map((k) => ({ outcome: k, outcomeText: (enc.outcomes as Record<string, { outcomeText?: string }>)[k]?.outcomeText ?? '' }))
          .filter((o) => o.outcomeText);
        if (outcomes.length < 2) continue;

        const res = await withTimeout(
          agent.execute({
            reconvergenceSceneId: desync.reconvergenceSceneId,
            openingBeatText,
            encounterId: desync.encounterId,
            encounterName: enc.name ?? desync.encounterId,
            outcomes,
          }),
          PIPELINE_TIMEOUTS.llmAgent,
          `OutcomeVariantAuthor(${desync.reconvergenceSceneId})`,
        );
        const variants = res.data?.variants ?? [];
        if (variants.length > 0) {
          authored += applyOutcomeVariants(story, desync.reconvergenceSceneId, beatId, desync.encounterId, variants);
        }
      }
      this.emit({
        type: 'debug',
        phase: 'encounter_outcome_variants',
        message: `Encounter outcome variants: ${desyncs.length} desync(s), ${authored} variant(s) authored.`,
      });
    } catch (err) {
      this.emit({
        type: 'warning',
        phase: 'encounter_outcome_variants',
        message: `Outcome-variant authoring failed (keeping desync): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private enforceFinalStoryContract(input: {
    story: Story;
    brief: FullCreativeBrief;
    requestedEpisodeNumbers?: number[];
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    phase: string;
  }): Promise<FinalStoryContractReport | undefined> {
    return this.finalContract().enforceFinalStoryContract(input);
  }

  private validateMicroEpisodeStructure(
    episode: Episode,
    context: {
      phase: string;
    }
  ): void {
    if (this.config.generation?.episodeStructureMode !== 'sceneEpisodes') return;

    const result = this.microEpisodeStructureValidator.validateEpisode(episode, {
      minScenes: this.config.generation.sceneEpisodeMinScenes || 1,
      maxScenes: this.config.generation.sceneEpisodeMaxScenes || 1,
      normalMinBeats: this.config.generation.sceneEpisodeNormalMinBeats || 6,
      normalMaxBeats: this.config.generation.sceneEpisodeNormalMaxBeats || 10,
      encounterMaxBeats: this.config.generation.sceneEpisodeEncounterMaxBeats || 15,
    });

    this.emit({
      type: result.valid ? 'checkpoint' : 'warning',
      phase: context.phase,
      message: `MicroEpisodeStructureValidator: ${result.summary}`,
      data: result,
    });

    if (!result.valid) {
      const errors = result.issues.filter(issue => issue.severity === 'error');
      this.throwIfFailFast(
        `Micro-episode structure validation failed: ${errors.map(issue => issue.message).join(' ')}`,
        context.phase,
        {
          context: {
            microEpisodeMetrics: result.metrics,
            microEpisodeIssues: result.issues,
            failureKind: 'micro_episode_structure',
          },
        }
      );
    }
  }

  private validateMicroEpisodeSeason(story: Story, context: { phase: string }): void {
    if (this.config.generation?.episodeStructureMode !== 'sceneEpisodes') return;

    const result = this.microEpisodeSeasonValidator.validateStory(story, {
      encounterCadence: this.config.generation.sceneEpisodeEncounterCadence || 6,
      branchMinEpisodes: this.config.generation.sceneEpisodeBranchMinEpisodes || 1,
      branchMaxEpisodes: this.config.generation.sceneEpisodeBranchMaxEpisodes || 2,
    });

    this.emit({
      type: result.valid ? 'checkpoint' : 'warning',
      phase: context.phase,
      message: `MicroEpisodeSeasonValidator: ${result.summary}`,
      data: result,
    });

    // Wave-0 shadow: firing data for the Wave-2 "micro-episode → hard gate" decision.
    if (isShadowLoggingEnabled()) {
      void this.recordGateShadowSafe(buildGateShadowRecord({
        gate: 'GATE_MICRO_EPISODE_SEASON', validator: 'MicroEpisodeSeasonValidator', scope: 'season',
        enabled: false, blockingCount: result.issues.filter((i) => i.severity === 'error').length,
        storyId: story.id, issues: result.issues.map((i) => ({ severity: i.severity, message: i.message })),
      }));
    }

    if (!result.valid) {
      const errors = result.issues.filter(issue => issue.severity === 'error');
      this.throwIfFailFast(
        `Micro-episode season validation failed: ${errors.map(issue => issue.message).join(' ')}`,
        context.phase,
        {
          context: {
            microEpisodeSeasonMetrics: result.metrics,
            microEpisodeSeasonIssues: result.issues,
            failureKind: 'micro_episode_season',
          },
        }
      );
    }
  }

  private compactSceneEpisodeBeatOverflow(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure> | undefined,
    context: { phase: string }
  ): void {
    if (this.config.generation?.episodeStructureMode !== 'sceneEpisodes') return;

    const maxBeats = this.config.generation.sceneEpisodeNormalMaxBeats || 10;
    const minBeats = this.config.generation.sceneEpisodeNormalMinBeats || 6;
    const protectedChoiceBeatIds = new Set(
      choiceSets
        .map((choiceSet) => choiceSet.beatId)
        .filter(Boolean)
    );

    for (const content of sceneContents) {
      if (!content?.beats?.length) continue;
      if (encounters?.has(content.sceneId)) continue;
      if (content.beats.length <= maxBeats) continue;

      const originalCount = content.beats.length;
      while (content.beats.length > maxBeats) {
        const removeIndex = this.findSceneEpisodeOverflowBeatIndex(content.beats, protectedChoiceBeatIds);
        if (removeIndex < 0) break;
        const [removed] = content.beats.splice(removeIndex, 1);
        const mergeTarget = content.beats[Math.max(0, removeIndex - 1)];
        if (mergeTarget && removed) {
          mergeTarget.text = [mergeTarget.text, removed.text].filter(Boolean).join('\n\n');
          if (!mergeTarget.visualMoment && removed.visualMoment) mergeTarget.visualMoment = removed.visualMoment;
          if (!mergeTarget.primaryAction && removed.primaryAction) mergeTarget.primaryAction = removed.primaryAction;
          if (!mergeTarget.emotionalRead && removed.emotionalRead) mergeTarget.emotionalRead = removed.emotionalRead;
          if (removed.nextSceneId && !mergeTarget.nextSceneId) mergeTarget.nextSceneId = removed.nextSceneId;
          if (removed.callbackHookIds?.length) {
            mergeTarget.callbackHookIds = [...new Set([...(mergeTarget.callbackHookIds || []), ...removed.callbackHookIds])];
          }
        }
      }

      this.relinkSceneEpisodeBeats(content);
      if (content.beats.length >= minBeats && content.beats.length < originalCount) {
        this.emit({
          type: 'debug',
          phase: context.phase,
          message: `Compacted sceneEpisode ${content.sceneId} from ${originalCount} to ${content.beats.length} beats before micro-episode validation.`,
        });
      }
    }
  }

  private findSceneEpisodeOverflowBeatIndex(beats: GeneratedBeat[], protectedChoiceBeatIds: Set<string>): number {
    const protectedIndexes = new Set<number>([0, beats.length - 1]);
    beats.forEach((beat, index) => {
      if (beat.isChoicePoint || protectedChoiceBeatIds.has(beat.id)) {
        protectedIndexes.add(index);
      }
    });

    for (let index = beats.length - 2; index >= 1; index--) {
      if (!protectedIndexes.has(index)) return index;
    }
    return -1;
  }

  private relinkSceneEpisodeBeats(content: SceneContent): void {
    content.beats.forEach((beat, index) => {
      const next = content.beats[index + 1];
      beat.nextBeatId = next?.id;
      if (!next) delete beat.nextBeatId;
    });
    if (!content.beats.some((beat) => beat.id === content.startingBeatId)) {
      content.startingBeatId = content.beats[0]?.id || content.startingBeatId;
    }
  }

  private repairSceneEpisodePlayableContract(
    sceneBlueprint: SceneBlueprint,
    content: SceneContent,
    choiceSets: ChoiceSet[],
    context: { phase: string }
  ): boolean {
    if (this.config.generation?.episodeStructureMode !== 'sceneEpisodes') return false;
    if (sceneBlueprint.isEncounter || (content as SceneContent & { encounter?: unknown })?.encounter) return false;

    content.beats = Array.isArray(content.beats) ? content.beats : [];
    let repaired = false;

    if (content.beats.length === 0) {
      content.beats.push(this.createSceneEpisodeSyntheticBeat(
        sceneBlueprint,
        'beat-1',
        sceneBlueprint.description || sceneBlueprint.dramaticQuestion || 'The scene pressure arrives.',
        true,
      ));
      content.startingBeatId = 'beat-1';
      repaired = true;
    }

    let choiceBeat = content.beats.find((beat) => beat.isChoicePoint);
    if (!choiceBeat) {
      choiceBeat = content.beats[content.beats.length - 1];
      if (choiceBeat) {
        choiceBeat.isChoicePoint = true;
        repaired = true;
      }
    }

    const minBeats = this.config.generation.sceneEpisodeNormalMinBeats || 6;
    const maxBeats = this.config.generation.sceneEpisodeNormalMaxBeats || 10;
    const targetFloor = Math.min(minBeats, maxBeats);
    while (content.beats.length < targetFloor) {
      const insertIndex = choiceBeat ? Math.max(0, content.beats.indexOf(choiceBeat)) : content.beats.length;
      const beatId = this.nextSceneEpisodeSyntheticBeatId(content);
      content.beats.splice(insertIndex, 0, this.createSceneEpisodeSyntheticBeat(
        sceneBlueprint,
        beatId,
        this.buildSceneEpisodeSyntheticBeatText(sceneBlueprint, content.beats.length, targetFloor),
        insertIndex === 0,
      ));
      repaired = true;
    }

    if (choiceBeat && !content.beats.includes(choiceBeat)) {
      choiceBeat = content.beats[content.beats.length - 1];
      if (choiceBeat) choiceBeat.isChoicePoint = true;
    }

    this.relinkSceneEpisodeBeats(content);

    const activeChoiceBeat = content.beats.find((beat) => beat.isChoicePoint) || content.beats[content.beats.length - 1];
    if (activeChoiceBeat) {
      activeChoiceBeat.isChoicePoint = true;
      const existingChoiceSet = choiceSets.find((choiceSet) =>
        choiceSet.sceneId === sceneBlueprint.id && choiceSet.beatId === activeChoiceBeat.id
      );
      if (!existingChoiceSet) {
        choiceSets.push(this.createFallbackSceneEpisodeChoiceSet(sceneBlueprint, activeChoiceBeat));
        repaired = true;
      }
    }

    if (!content.startingBeatId && content.beats[0]) {
      content.startingBeatId = content.beats[0].id;
      repaired = true;
    }

    if (repaired) {
      this.emit({
        type: 'debug',
        phase: context.phase,
        message: `Repaired sceneEpisode playable contract for ${sceneBlueprint.id}: ${content.beats.length} beat(s), ${choiceSets.filter(cs => cs.sceneId === sceneBlueprint.id).length} choice set(s).`,
      });
    }

    return repaired;
  }

  private createSceneEpisodeSyntheticBeat(
    sceneBlueprint: SceneBlueprint,
    id: string,
    text: string,
    isOpening = false
  ): GeneratedBeat {
    const cleanText = this.ensureSentence(text || sceneBlueprint.description || 'The pressure changes shape.');
    return {
      id,
      text: cleanText,
      isChoicePoint: false,
      visualMoment: cleanText,
      primaryAction: cleanText,
      emotionalRead: isOpening
        ? 'the protagonist enters with visible intent'
        : 'the protagonist absorbs the pressure and chooses what it means',
      relationshipDynamic: sceneBlueprint.npcsPresent?.length
        ? 'the power dynamic tightens between the protagonist and the people present'
        : 'the protagonist is pressed by the situation itself',
      mustShowDetail: sceneBlueprint.location || sceneBlueprint.name,
      intensityTier: isOpening ? 'rest' : 'supporting',
      sequenceIntent: {
        objective: sceneBlueprint.dramaticQuestion || 'Keep the sceneEpisode pressure moving toward a choice.',
        activity: sceneBlueprint.choicePoint?.description || sceneBlueprint.conflictEngine || 'pressure, reaction, and decision',
        obstacle: sceneBlueprint.conflictEngine || sceneBlueprint.choicePoint?.stakes?.cost || 'the situation resists a clean answer',
        startState: sceneBlueprint.personalStake || sceneBlueprint.description || 'The scene begins under pressure.',
        endState: sceneBlueprint.choicePoint?.description || 'The next beat leaves a clearer choice.',
        beatRole: isOpening ? 'setup' : 'escalation',
        mechanicThread: sceneBlueprint.choicePoint?.consequenceDomain || sceneBlueprint.purpose || 'sceneEpisode',
      },
    } as GeneratedBeat;
  }

  private buildSceneEpisodeSyntheticBeatText(
    sceneBlueprint: SceneBlueprint,
    currentBeatCount: number,
    targetFloor: number
  ): string {
    const authoredBeats = (sceneBlueprint.keyBeats || [])
      .map((beat) => String(beat || '').trim())
      .filter(Boolean)
      .filter((beat) => !/^choice pressure:/i.test(beat));
    const authored = authoredBeats[currentBeatCount % Math.max(1, authoredBeats.length)];
    if (authored) return authored;

    const choicePressure = sceneBlueprint.choicePoint?.description;
    const dramaticQuestion = sceneBlueprint.dramaticQuestion || sceneBlueprint.dramaticStructure?.question;
    const pressurePeak = sceneBlueprint.dramaticStructure?.pressurePeak || sceneBlueprint.choicePoint?.stakes?.cost;
    const exitShift = this.stripAgentFacingFidelityText(
      sceneBlueprint.dramaticStructure?.changedState || sceneBlueprint.narrativeFunction || '',
      sceneBlueprint.description || sceneBlueprint.name || 'The choice leaves residue.'
    );
    const fallbackCycle = [
      dramaticQuestion ? `The scene presses its question: ${dramaticQuestion}` : '',
      pressurePeak ? `The cost becomes harder to ignore: ${pressurePeak}` : '',
      choicePressure ? `The decision narrows: ${choicePressure}` : '',
      exitShift ? `The moment leaves residue: ${exitShift}` : '',
    ].filter(Boolean);
    return fallbackCycle[currentBeatCount % Math.max(1, fallbackCycle.length)]
      || `The scene holds one more turn before the choice can land (${currentBeatCount + 1}/${targetFloor}).`;
  }

  private nextSceneEpisodeSyntheticBeatId(content: SceneContent): string {
    const ids = new Set(content.beats.map((beat) => beat.id));
    let index = content.beats.length + 1;
    while (ids.has(`beat-${index}`) || ids.has(`beat-synth-${index}`)) index++;
    return ids.has(`beat-${index}`) ? `beat-synth-${index}` : `beat-${index}`;
  }

  private createFallbackSceneEpisodeChoiceSet(
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat
  ): ChoiceSet {
    const choicePoint = sceneBlueprint.choicePoint;
    const optionHints = (choicePoint?.optionHints || [])
      .map((hint) => String(hint || '').trim())
      .filter(Boolean);
    const options = (optionHints.length >= 2 ? optionHints : [
      choicePoint?.description || 'Act on the pressure now.',
      choicePoint?.stakes?.cost ? `Hold back and pay the cost: ${choicePoint.stakes.cost}` : 'Hold back and read the danger.',
    ]).slice(0, 5);
    const stakes = choicePoint?.stakes || {
      want: sceneBlueprint.dramaticQuestion || sceneBlueprint.description || 'change the situation',
      cost: sceneBlueprint.conflictEngine || 'accept the visible cost',
      identity: sceneBlueprint.wantVsNeed || 'decide who this pressure is making the protagonist become',
    };
    const choiceType = choicePoint?.type || 'dilemma';

    return {
      beatId: choiceBeat.id,
      sceneId: sceneBlueprint.id,
      choiceType,
      overallStakes: stakes,
      overallStakesLayers: choicePoint?.stakesLayers || sceneBlueprint.stakesLayers,
      designNotes: 'Deterministic sceneEpisode fallback: preserves authored choice pressure when ChoiceAuthor does not produce a usable choice set.',
      choices: options.map((text, index) => ({
        id: `${choiceBeat.id}-fallback-choice-${index + 1}`,
        text: this.ensureSentence(text),
        choiceType,
        stakes,
        stakesLayers: choicePoint?.stakesLayers || sceneBlueprint.stakesLayers,
        stakesAnnotation: stakes,
        consequenceDomain: choicePoint?.consequenceDomain || 'identity',
        consequences: [],
        reminderPlan: choicePoint?.reminderPlan || {
          immediate: sceneBlueprint.choicePoint?.description || 'The decision changes the tone of the scene.',
          shortTerm: this.stripAgentFacingFidelityText(
            sceneBlueprint.narrativeFunction || '',
            'The residue carries into the next sceneEpisode.'
          ),
        },
        feedbackCue: {
          echoSummary: `You chose: ${this.ensureSentence(text)}`,
          progressSummary: this.stripAgentFacingFidelityText(
            choicePoint?.reminderPlan?.immediate || sceneBlueprint.narrativeFunction || '',
            'The choice leaves visible residue.'
          ),
        },
        expectedResidue: choicePoint?.expectedResidue,
      })),
    } as ChoiceSet;
  }

  private ensureSentence(text: string): string {
    const trimmed = String(text || '').trim();
    if (!trimmed) return 'The pressure changes shape.';
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }

  /**
   * Last-resort fallback for a choiceless BRANCH POINT. Reuses the deterministic
   * choice-set builder, then routes ≥1 choice to EACH distinct `leadsTo` target so the
   * planned branch is structurally realized (satisfying GATE_BRANCH_FANOUT) instead of
   * hard-aborting the episode when ChoiceAuthor fails. Returns undefined for non-branch
   * scenes (leadsTo < 2 distinct), where a choiceless scene is survivable on its own.
   */
  private buildBranchFallbackChoiceSet(
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat | undefined,
  ): ChoiceSet | undefined {
    if (!choiceBeat) return undefined;
    const targets = [...new Set((sceneBlueprint.leadsTo || []).filter(Boolean))];
    if (targets.length < 2) return undefined; // only branch points need this net

    const base = this.createFallbackSceneEpisodeChoiceSet(sceneBlueprint, choiceBeat);
    // Pad to cover every target and route round-robin so each leadsTo target is reached.
    const choices = routeFallbackChoicesAcrossTargets(base.choices, targets, choiceBeat.id);
    return {
      ...base,
      choices,
      designNotes:
        `${base.designNotes} Routed across leadsTo targets [${targets.join(', ')}] to preserve the ` +
        'planned branch after ChoiceAuthor failed for this branch point.',
    };
  }

  private stripAgentFacingFidelityText(text: string, fallback: string): string {
    const cleaned = String(text || '')
      .split(/\n{2,}|\r?\n/)
      .map((part) => part.trim())
      .filter((part) => part && !/^(?:pressure|choice pressure|forward pressure):/i.test(part))
      .join('\n\n')
      .trim();
    return cleaned || this.ensureSentence(fallback || 'The story pressure changes what can happen next.');
  }

  private sanitizeSceneContentForReader(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
    if (!Array.isArray(content.beats)) return;
    for (const beat of content.beats) {
      const sceneFallback = sceneBlueprint.description || sceneBlueprint.dramaticQuestion || sceneBlueprint.name || 'The story pressure changes.';
      beat.text = this.stripAgentFacingFidelityText(
        beat.text,
        sceneFallback
      );
      beat.visualMoment = this.stripAgentFacingFidelityText(
        beat.visualMoment || beat.text,
        beat.text || sceneFallback
      );
      beat.primaryAction = this.stripAgentFacingFidelityText(
        beat.primaryAction || beat.text,
        beat.text || sceneFallback
      );
      beat.emotionalRead = this.stripAgentFacingFidelityText(
        beat.emotionalRead || '',
        'The protagonist absorbs the consequence.'
      );
      beat.relationshipDynamic = this.stripAgentFacingFidelityText(
        beat.relationshipDynamic || '',
        sceneBlueprint.npcsPresent?.length
          ? 'The relationship pressure changes.'
          : 'The situation pressure changes.'
      );
    }
  }

  private sanitizeReaderFacingSceneName(name: string | undefined, fallback = 'the next scene'): string {
    const cleaned = String(name || fallback)
      .replace(/\s*\((?:[^)]*\b(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b[^)]*)\)\s*/gi, ' ')
      .replace(/\s*\[(?:[^\]]*\b(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b[^\]]*)\]\s*/gi, ' ')
      .replace(/\s+-\s*(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b.*$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallback;
  }

  private cleanChoiceBridgeFragment(value: string | undefined): string {
    return this.sanitizeReaderFacingSceneName(value || '', '')
      .replace(/\bThe decision carries you\b.*$/i, '')
      .replace(/\bone concrete step at a time\b\.?/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ensureBlueprintFidelityText(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
    const importantBeats = (sceneBlueprint.keyBeats || [])
      .map((beat) => (beat || '').trim())
      .filter((beat) => /^(?:pressure|choice pressure|forward pressure):/i.test(beat));
    if (importantBeats.length === 0) return;

    content.continuityNotes = Array.isArray(content.continuityNotes) ? content.continuityNotes : [];
    for (const importantBeat of importantBeats) {
      const note = `Agent-facing fidelity pressure preserved outside reader prose: ${importantBeat}`;
      if (!content.continuityNotes.includes(note)) {
        content.continuityNotes.push(note);
      }
    }

    if (!content.startingBeatId && content.beats?.[0]) {
      content.startingBeatId = content.beats[0].id;
    }
  }

  private repairSceneGraphBranchingChoices(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure>,
    context: { phase: string }
  ): Promise<boolean> {
    return this.sceneGraphValidation().repairSceneGraphBranchingChoices(
      brief, worldBible, characterBible, blueprint, sceneContents, choiceSets, encounters, context,
    );
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
    if (this.generationPlan) {
      // Fully unit-weighted: once a structure plan exists it is the authoritative
      // source for the headline %. The legacy phase ramp below is only used for
      // analysis-only runs (no plan) and very early single-episode emits.
      overallProgress = computeOverallProgress(this.generationPlan);
    } else if (phaseProgress !== undefined) {
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

  /**
   * Emit a snapshot of the current structure plan so the generator UI can render
   * the episode -> scene -> beat tree. Rides the existing `event.data` channel;
   * `overallProgress` is recomputed from the plan inside buildProgressTelemetry.
   */
  private emitPlanUpdate(message: string): void {
    if (!this.generationPlan) return;
    this.emit({
      type: 'debug',
      phase: 'content',
      message,
      data: { generationPlan: snapshotPlan(this.generationPlan) },
    });
  }

  private emit(event: Omit<PipelineEvent, 'timestamp'>): void {
    if (this.generationPlan) applyEventToPlan(this.generationPlan, event);
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

  private addCheckpoint(phase: string, data: unknown, requiresApproval?: boolean): void {
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

  private recordSceneValidationResult(result: SceneValidationResult): void {
    const matchesSameScene = (candidate: SceneValidationResult) =>
      candidate.sceneId === result.sceneId
      && (candidate.episodeNumber === result.episodeNumber || candidate.episodeNumber === undefined || result.episodeNumber === undefined);

    const localIdx = this.sceneValidationResults.findIndex(matchesSameScene);
    if (localIdx >= 0) {
      this.sceneValidationResults[localIdx] = result;
    } else {
      this.sceneValidationResults.push(result);
    }

    for (let idx = this.allSceneValidationResults.length - 1; idx >= 0; idx--) {
      if (matchesSameScene(this.allSceneValidationResults[idx])) {
        this.allSceneValidationResults[idx] = result;
        return;
      }
    }
    this.allSceneValidationResults.push(result);
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

  private episodeCheckpointFile(episodeNumber: number, kind: string, id?: string): string {
    const safeKind = String(kind || 'artifact').replace(/[^a-z0-9._-]+/gi, '-');
    const safeId = id ? String(id).replace(/[^a-z0-9._-]+/gi, '-') : undefined;
    return `checkpoints/episode-${episodeNumber}/${safeId ? `${safeKind}-${safeId}` : safeKind}.json`;
  }

  private async saveResumeUnit<T>(
    outputDirectory: string | undefined,
    unitId: string,
    artifactPath: string,
    data: T,
  ): Promise<void> {
    if (!outputDirectory) return;
    await saveEarlyDiagnostic(outputDirectory, artifactPath, data);
    const manifestPath = 'checkpoints/checkpoint-manifest.json';
    const manifest = loadEarlyDiagnosticSync<{
      version: 1;
      generatedAt: string;
      updatedAt: string;
      units: Record<string, { status: 'completed'; artifactPath: string; updatedAt: string }>;
    }>(outputDirectory, manifestPath) || {
      version: 1 as const,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      units: {},
    };
    manifest.updatedAt = new Date().toISOString();
    manifest.units[unitId] = {
      status: 'completed',
      artifactPath,
      updatedAt: manifest.updatedAt,
    };
    await saveEarlyDiagnostic(outputDirectory, manifestPath, manifest);
  }

  private loadResumeUnit<T>(
    outputDirectory: string | undefined,
    unitId: string,
    artifactPath: string,
  ): T | undefined {
    if (!outputDirectory) return undefined;
    const data = loadEarlyDiagnosticSync<T>(outputDirectory, artifactPath);
    if (data) {
      this.emit({
        type: 'debug',
        phase: 'resume',
        message: `Resumed ${unitId} from ${artifactPath}`,
      });
      return data;
    }
    return undefined;
  }

  private loadContinuationStory(
    outputDirectory: string | undefined,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> },
  ): Story | undefined {
    const checkpointStory = this.getResumeOutput<Story>(resumeCheckpoint, 'final_story_package');
    if (checkpointStory?.episodes?.length) return checkpointStory;

    const savedStory = this.loadResumeUnit<Story>(
      outputDirectory,
      'final_story_package',
      'checkpoints/final-story-before-save.json',
    );
    if (savedStory?.episodes?.length) return savedStory;

    const storyPackage = loadEarlyDiagnosticSync<{ story?: Story } | Story>(outputDirectory as string, 'story.json');
    if (storyPackage && 'story' in storyPackage && storyPackage.story?.episodes?.length) {
      return storyPackage.story;
    }
    if (storyPackage && 'episodes' in storyPackage && Array.isArray(storyPackage.episodes)) {
      return storyPackage as Story;
    }
    return undefined;
  }

  private buildStoryGeneratorMetadata(): Record<string, unknown> {
    const styleAnchors = (this._styleAnchorPaths.character || this._styleAnchorPaths.arcStrip || this._styleAnchorPaths.environment)
      ? {
          character: this._styleAnchorPaths.character ? { imagePath: this._styleAnchorPaths.character } : undefined,
          arcStrip: this._styleAnchorPaths.arcStrip ? { imagePath: this._styleAnchorPaths.arcStrip } : undefined,
          environment: this._styleAnchorPaths.environment ? { imagePath: this._styleAnchorPaths.environment } : undefined,
        }
      : undefined;
    return {
      pipeline: 'FullStoryPipeline',
      artStyle: this.config.artStyle,
      canonicalArtStyle: this.config.imageGen?.gemini?.canonicalArtStyle || this.config.artStyle,
      artStyleProfile: this.config.imageGen?.artStyleProfile,
      styleAnchors,
      imageProvider: this.config.imageGen?.provider,
    };
  }

  private hydrateSeasonImageStyleFromStoryPackage(storyPackage?: { generator?: Record<string, unknown>; story?: Story } | Story | null): void {
    if (!storyPackage || typeof storyPackage !== 'object') return;
    const generator = 'generator' in storyPackage && storyPackage.generator && typeof storyPackage.generator === 'object'
      ? storyPackage.generator
      : undefined;
    const story = 'story' in storyPackage && storyPackage.story
      ? storyPackage.story
      : ('episodes' in storyPackage ? storyPackage as Story : undefined);
    this.hydrateSeasonImageStyleFromGenerator(generator, story);
  }

  private hydrateSeasonImageStyleFromGenerator(generator?: Record<string, unknown>, story?: Story): void {
    const savedArtStyle = typeof generator?.artStyle === 'string' ? generator.artStyle.trim() : '';
    const savedCanonicalStyle = typeof generator?.canonicalArtStyle === 'string' ? generator.canonicalArtStyle.trim() : '';
    const savedProfile = (generator?.artStyleProfile || story?.artStyleProfile) as any;
    const profileStyle = savedProfile ? composeCanonicalStyleString(savedProfile) : '';
    const hasSavedStyle = !!(savedArtStyle || savedCanonicalStyle || profileStyle);
    if (!hasSavedStyle && !generator?.styleAnchors && !story?.styleAnchors) return;

    if (!this.config.imageGen) this.config.imageGen = {};
    if (!this.config.imageGen.gemini) this.config.imageGen.gemini = {};

    const effectiveStyle = savedArtStyle || savedCanonicalStyle || profileStyle;
    if (effectiveStyle) {
      this.config.artStyle = effectiveStyle;
      this.config.imageGen.gemini.canonicalArtStyle = savedCanonicalStyle || effectiveStyle;
    }
    if (savedProfile) {
      this.config.imageGen.artStyleProfile = savedProfile;
    }

    const savedAnchors = (generator?.styleAnchors || story?.styleAnchors) as Story['styleAnchors'] | undefined;
    const preapprovedStyleAnchors = savedAnchors
      ? {
          character: savedAnchors.character?.imagePath ? { imagePath: savedAnchors.character.imagePath } : undefined,
          arcStrip: savedAnchors.arcStrip?.imagePath ? { imagePath: savedAnchors.arcStrip.imagePath } : undefined,
          environment: savedAnchors.environment?.imagePath ? { imagePath: savedAnchors.environment.imagePath } : undefined,
        }
      : undefined;
    const hasSavedAnchor = !!(
      preapprovedStyleAnchors?.character ||
      preapprovedStyleAnchors?.arcStrip ||
      preapprovedStyleAnchors?.environment
    );

    if (hasSavedStyle || hasSavedAnchor) {
      this.config.imageGen.preapprovedStyleAnchors = hasSavedAnchor ? preapprovedStyleAnchors : undefined;
      this.config.imageGen.uploadedStyleReferences = undefined;
    }
    if (preapprovedStyleAnchors?.character?.imagePath) this._styleAnchorPaths.character = preapprovedStyleAnchors.character.imagePath;
    if (preapprovedStyleAnchors?.arcStrip?.imagePath) this._styleAnchorPaths.arcStrip = preapprovedStyleAnchors.arcStrip.imagePath;
    if (preapprovedStyleAnchors?.environment?.imagePath) this._styleAnchorPaths.environment = preapprovedStyleAnchors.environment.imagePath;

    if (hasSavedStyle) {
      this.emit({
        type: 'info',
        phase: 'images',
        message: 'Loaded authoritative season-level image style from saved story package.',
      });
    }
  }

  private applyActiveImageStyleToRuntime(): void {
    const artStyle = this.config.artStyle;
    this.encounterImageAgent = new EncounterImageAgent(this.config.agents.storyArchitect, artStyle);
    this.imageAgentTeam = new ImageAgentTeam(
      this.config.agents.imagePlanner || this.config.agents.storyArchitect,
      artStyle
    );
    this.imageAgentTeam.setIdentityGateConfig({
      identityScoreThreshold: this.config.imageGen?.identityScoreThreshold,
      maxIdentityRegenerations: this.config.imageGen?.maxIdentityRegenerations,
      resetIdentityBudget: true,
    });
    this.videoDirectorAgent = new VideoDirectorAgent(
      this.config.agents.videoDirector || this.config.agents.storyArchitect,
      artStyle
    );

    if (!this.config.imageGen) this.config.imageGen = {};
    if (!this.config.imageGen.gemini) this.config.imageGen.gemini = {};
    const canonicalArtStyle = this.config.imageGen.gemini.canonicalArtStyle || artStyle;
    if (canonicalArtStyle) {
      this.config.imageGen.gemini.canonicalArtStyle = canonicalArtStyle;
      this.imageService.updateGeminiSettings({
        ...this.imageService.getGeminiSettings(),
        ...(this.config.imageGen.gemini || {}),
        canonicalArtStyle,
      });
    }
    if (this.config.imageGen.artStyleProfile) {
      this.imageService.setArtStyleProfile(this.config.imageGen.artStyleProfile);
    } else if (artStyle?.trim()) {
      this.config.imageGen.artStyleProfile = buildVerbatimProfile(artStyle);
      this.imageService.setArtStyleProfile(this.config.imageGen.artStyleProfile);
    }
  }

  private getEpisodeScopedSceneId(brief: FullCreativeBrief, sceneId: string): string {
    const episodeNumber = typeof brief.episode?.number === 'number' ? brief.episode.number : 0;
    return `episode-${episodeNumber}-${sceneId}`;
  }

  private getEpisodeScopedBeatKey(brief: FullCreativeBrief, sceneId: string, beatId: string): string {
    return `${this.getEpisodeScopedSceneId(brief, sceneId)}::${beatId}`;
  }

  private useStoryboardV2ImagePipeline(): boolean {
    return this.config.imageGen?.pipelineMode !== 'legacy';
  }

  private shouldAttachCompositeCharacterRefs(): boolean {
    return getReferenceStrategy(this.config.imageGen?.provider).sceneRefs === 'composite-anchor';
  }

  private async runStoryboardV2ImageGeneration(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    encounters: Map<string, EncounterStructure>,
    outputDirectory?: string,
  ): Promise<{
    imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> };
    encounterImageResults: {
      encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>;
      storyletImages: Map<string, Map<string, Map<string, string>>>;
      storyletFailures?: string[];
    };
    diagnostics?: StoryboardV2Result['diagnostics'];
  }> {
    const storyboard = new StoryboardV2Pipeline({
      config: this.config,
      assetRegistry: this.assetRegistry,
      outputDirectory,
      emit: (event) => this.emit(event as any),
      onImageJobEvent: (event) => this.imageService.emitExternalEvent(event),
    });
    const result = await storyboard.generateEpisode({
      brief,
      sceneContents,
      choiceSets,
      characterBible,
      encounters,
    });
    const imageCompleteness = result.diagnostics?.imageCompleteness;
    const requiredSlotFailures = result.diagnostics?.requiredSlotFailures || [];
    if (imageCompleteness && !imageCompleteness.complete) {
      throw new PipelineError(
        `Storyboard v2 image generation incomplete: ${imageCompleteness.missingRequiredSlotCount} required image slot(s) were not bound.`,
        'images',
        {
          context: {
            failureKind: 'image_completeness',
            stepId: 'storyboard_v2_required_slots',
            resumeFromStepId: 'missing_or_failed_image_slots',
            outputDirectory,
            imageCompleteness,
            requiredSlotFailures,
          },
        }
      );
    }
    return {
      imageResults: {
        beatImages: result.beatImages,
        sceneImages: result.sceneImages,
      },
      encounterImageResults: result.encounterImageResults,
      diagnostics: result.diagnostics,
    };
  }

  private resetAssetRegistry(storyId?: string, persistPath?: string): void {
    this.assetRegistry = new AssetRegistry(storyId, undefined, persistPath);
  }

  private loadAssetRegistryForImageResume(storyId: string, outputDirectory: string): void {
    const normalizedOutputDir = outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`;
    const primaryPath = `${normalizedOutputDir}asset-registry.jsonl`;
    const legacyPath = `${normalizedOutputDir}08-asset-registry.jsonl`;
    this.assetRegistry = AssetRegistry.fromJSONL(primaryPath, storyId);

    const legacyRegistry = AssetRegistry.fromJSONL(legacyPath, storyId);
    for (const record of legacyRegistry.values()) {
      if (record.status !== 'succeeded' || !record.latestUrl) continue;
      if (this.assetRegistry.getResolvedAsset(record.slot.slotId)) continue;
      this.assetRegistry.planSlot(record.slot);
      this.assetRegistry.markSuccess(record.slot.slotId, {
        prompt: { prompt: `image-resume imported legacy registry record ${record.slot.slotId}` },
        imageUrl: record.latestUrl,
        imagePath: record.latestPath || record.latestUrl,
        provider: record.provider,
        model: record.model,
      });
    }
  }

  private servedUrlForGeneratedImagePath(imagePath: string): string {
    const gsIndex = imagePath.indexOf('generated-stories/');
    if (gsIndex >= 0) return `http://localhost:3001/${imagePath.slice(gsIndex)}`;
    return imagePath;
  }

  private async readImageArtifact(imagePath: string): Promise<GeneratedImage | undefined> {
    if (!imagePath || /\.(txt)$/i.test(imagePath)) return undefined;
    try {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(imagePath);
      const lower = imagePath.toLowerCase();
      const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
      return {
        prompt: { prompt: `image-resume hydrated existing file ${imagePath}` },
        imagePath,
        imageUrl: this.servedUrlForGeneratedImagePath(imagePath),
        imageData: buffer.toString('base64'),
        mimeType,
        metadata: { hydratedFromDisk: true },
      };
    } catch {
      return undefined;
    }
  }

  private async findExistingImageArtifact(imagesDir: string, baseIdentifier: string): Promise<GeneratedImage | undefined> {
    const exact = this.imageService.findExistingGeneratedImage(baseIdentifier);
    if (exact?.imagePath) {
      const hydrated = await this.readImageArtifact(exact.imagePath);
      return {
        ...(hydrated || { prompt: { prompt: `image-resume reused ${baseIdentifier}` } }),
        imagePath: exact.imagePath,
        imageUrl: exact.imageUrl || hydrated?.imageUrl || this.servedUrlForGeneratedImagePath(exact.imagePath),
      } as GeneratedImage;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const files = await fs.readdir(imagesDir);
      const candidates: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];
      const imageExt = /\.(png|jpg|jpeg|webp)$/i;
      for (const name of files) {
        if (!imageExt.test(name)) continue;
        if (!name.startsWith(`${baseIdentifier}-`)) continue;
        if (!/-(qa-retry|retry|textfix|repair|recovery|fallback)/i.test(name)) continue;
        const fullPath = path.join(imagesDir, name);
        const stat = await fs.stat(fullPath);
        candidates.push({ name, fullPath, mtimeMs: stat.mtimeMs });
      }
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0] ? this.readImageArtifact(candidates[0].fullPath) : undefined;
    } catch {
      return undefined;
    }
  }

  private async hydrateReferenceSheetsFromExistingImages(
    outputDirectory: string,
    characterBible: CharacterBible,
  ): Promise<number> {
    const imagesDir = `${outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`}images/`;
    let hydrated = 0;
    for (const char of characterBible.characters || []) {
      if (this.imageAgentTeam.hasReferenceSheet(char.id)) continue;
      if (await this.hydrateReferenceSheetFromDisk(char, imagesDir)) hydrated += 1;
    }
    return hydrated;
  }

  private referenceIdentifierBasesForCharacter(char: CharacterProfile): string[] {
    const candidates = [
      char.id,
      idSlugify(char.id),
      idSlugify(char.name),
      char.id.replace(/^character[-_]/i, 'char-'),
      char.id.replace(/^char[-_]/i, 'char-'),
      `char-${idSlugify(char.name)}`,
    ];
    return Array.from(new Set(candidates.filter(Boolean).map((value) => `ref_${value}`)));
  }

  private async hydrateReferenceSheetFromDisk(char: CharacterProfile, imagesDir?: string): Promise<boolean> {
    if (this.imageAgentTeam.hasReferenceSheet(char.id)) return true;
    const resolvedImagesDir = imagesDir
      || (this._activeImageResumeOutputDirectory
        ? `${this._activeImageResumeOutputDirectory.endsWith('/') ? this._activeImageResumeOutputDirectory : `${this._activeImageResumeOutputDirectory}/`}images/`
        : undefined);
    if (!resolvedImagesDir) return false;

    const views: Array<{ viewType: string; imageData: string; mimeType: string; imageUrl?: string; imagePath?: string }> = [];
    const bases = this.referenceIdentifierBasesForCharacter(char);
    for (const viewType of ['face', 'front', 'three-quarter', 'profile', 'composite']) {
      for (const base of bases) {
        const image = await this.findExistingImageArtifact(resolvedImagesDir, `${base}_${viewType}`);
        if (!image?.imageData || !image.mimeType) continue;
        views.push({
          viewType,
          imageData: image.imageData,
          mimeType: image.mimeType,
          imageUrl: image.imageUrl,
          imagePath: image.imagePath,
        });
        break;
      }
    }
    if (views.length === 0) return false;

    const identityFingerprint = computeCharacterIdentityFingerprint(char);
    const didHydrate = this.imageAgentTeam.hydrateReferenceSheetFromExistingImages({
      characterId: char.id,
      characterName: char.name,
      images: views,
      visualAnchors: [
        char.physicalDescription,
        ...(char.distinctiveFeatures || []),
        char.typicalAttire,
      ].filter(Boolean) as string[],
      identityFingerprint,
    });
    if (didHydrate) {
      this.imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, identityFingerprint);
      this.emit({
        type: 'debug',
        phase: 'reference_sheet',
        message: `Resume scan hydrated existing reference for ${char.name} (${views.map((view) => view.viewType).join(', ')}); skipping reference regeneration.`,
      });
    }
    return didHydrate;
  }

  private async hydrateStyleAnchorsFromExistingImages(outputDirectory: string, storyTitle: string): Promise<number> {
    const imagesDir = `${outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`}images/`;
    const titleSlug = idSlugify(storyTitle || 'story');
    let hydrated = 0;
    const characterAnchor = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'character-anchor'));
    if (characterAnchor?.imageData && characterAnchor.mimeType) {
      this._styleAnchorPaths.character = characterAnchor.imagePath;
      this.imageService.setSeasonStyleReference(characterAnchor.imageData, characterAnchor.mimeType);
      hydrated += 1;
    }
    const arcStrip = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'arc-strip'));
    if (arcStrip?.imagePath) {
      this._styleAnchorPaths.arcStrip = arcStrip.imagePath;
      hydrated += 1;
    }
    const environment = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'environment-anchor'));
    if (environment?.imagePath) {
      this._styleAnchorPaths.environment = environment.imagePath;
      hydrated += 1;
    }
    return hydrated;
  }

  private async markSlotFromExistingArtifact(slot: ImageSlot, imagesDir: string): Promise<boolean> {
    this.assetRegistry.planSlot(slot);
    if (this.assetRegistry.getResolvedAsset(slot.slotId)?.latestUrl) return true;

    if (slot.continuitySourceSlotId) {
      const source = this.assetRegistry.getResolvedAsset(slot.continuitySourceSlotId);
      if (source?.latestUrl) {
        this.assetRegistry.markSuccess(slot.slotId, {
          prompt: { prompt: `image-resume linked continuity source ${slot.continuitySourceSlotId}` },
          imageUrl: source.latestUrl,
          imagePath: source.latestPath || source.latestUrl,
          provider: source.provider,
          model: source.model,
        });
        return true;
      }
    }

    const artifact = await this.findExistingImageArtifact(imagesDir, slot.baseIdentifier);
    if (!artifact?.imageUrl) return false;
    this.assetRegistry.markSuccess(slot.slotId, artifact);
    return true;
  }

  private collectPlannedReferenceCharacterIdsForResume(
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
  ): string[] {
    const planned = new Set<string>();
    const addRaw = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw.trim()) return;
      const resolved = this.resolveCharacterId(raw, characterBible);
      if (resolved) planned.add(resolved);
    };
    const addMany = (raw: unknown) => {
      if (Array.isArray(raw)) {
        raw.forEach((item) => {
          if (typeof item === 'string') addRaw(item);
          else if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            addRaw(record.id);
            addRaw(record.characterId);
            addRaw(record.npcId);
            addRaw(record.name);
          }
        });
      } else {
        addRaw(raw);
      }
    };
    const addVisualCast = (visualCast: unknown) => {
      if (!visualCast || typeof visualCast !== 'object') return;
      const record = visualCast as Record<string, unknown>;
      [
        'sceneCharacterIds',
        'activeCharacterIds',
        'foregroundCharacterIds',
        'backgroundCharacterIds',
        'speakerCharacterId',
        'addressedCharacterIds',
        'listenerCharacterIds',
        'observerCharacterIds',
        'payoffRelevantCharacterIds',
        'requiredVisibleCharacterIds',
        'focalCharacterIds',
      ].forEach((key) => addMany(record[key]));
    };
    const scanReferenceKeys = (value: unknown, parentKey = '', depth = 0) => {
      if (!value || depth > 8) return;
      if (Array.isArray(value)) {
        value.forEach((item) => scanReferenceKeys(item, parentKey, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        const lower = key.toLowerCase();
        const isCharacterKey =
          lower.includes('characterid') ||
          lower.includes('characterids') ||
          lower.includes('npcid') ||
          lower.includes('npcids') ||
          lower === 'speaker' ||
          lower === 'speakercharacterid' ||
          lower.includes('participant') ||
          lower.includes('observer') ||
          lower.includes('listener') ||
          lower.includes('addressed') ||
          lower.includes('payoffrelevant') ||
          lower.includes('requiredvisible') ||
          lower.includes('foregroundcharacter') ||
          lower.includes('backgroundcharacter') ||
          lower.includes('activecharacter') ||
          lower.includes('focalcharacter');
        if (isCharacterKey) addMany(child);
        if (lower === 'visualcast' || lower === 'coverageplan') addVisualCast(child);
        scanReferenceKeys(child, lower || parentKey, depth + 1);
      }
    };

    for (const char of characterBible.characters || []) {
      if (char.importance === 'core' || char.importance === 'major' || char.id === characterBible.protagonist?.id) {
        planned.add(char.id);
      }
    }

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const sceneRecord = scene as unknown as Record<string, unknown>;
        addMany(sceneRecord.charactersInvolved);
        addMany(sceneRecord.characterIds);
        addMany(sceneRecord.characters);
        addMany(sceneRecord.npcIds);
        addVisualCast(sceneRecord.visualCast);
        scanReferenceKeys(sceneRecord.encounter, 'encounter');
        for (const beat of scene.beats || []) {
          const beatRecord = beat as unknown as Record<string, unknown>;
          addMany(beatRecord.characters);
          addMany(beatRecord.characterIds);
          addMany(beatRecord.npcIds);
          addRaw(beatRecord.speaker);
          addRaw(beatRecord.speakerCharacterId);
          addVisualCast(beatRecord.visualCast);
          addVisualCast(beatRecord.coveragePlan);
        }
        for (const choice of (scene as Scene & { choices?: unknown[] }).choices || []) {
          scanReferenceKeys(choice, 'choice');
        }
      }
    }

    for (const encounter of encounters || []) {
      scanReferenceKeys(encounter, 'encounter');
    }

    return [...planned];
  }

  private async preflightResumeReferenceSheets(
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
  ): Promise<{
    plannedReferenceCharacterIds: string[];
    alreadyAvailableReferenceCharacterIds: string[];
    hydratedReferenceCharacterIds: string[];
    generatedReferenceCharacterIds: string[];
    missingReferenceCharacterIds: string[];
  }> {
    const plannedReferenceCharacterIds = this.collectPlannedReferenceCharacterIdsForResume(story, characterBible, encounters);
    const alreadyAvailableReferenceCharacterIds: string[] = [];
    const hydratedReferenceCharacterIds: string[] = [];
    const generatedReferenceCharacterIds: string[] = [];
    const missingReferenceCharacterIds: string[] = [];

    this.emit({
      type: 'debug',
      phase: 'reference_sheet',
      message: `Resume reference preflight checking ${plannedReferenceCharacterIds.length} planned visible/encounter character(s).`,
      data: { plannedReferenceCharacterIds },
    });

    for (const id of plannedReferenceCharacterIds) {
      await this.checkCancellation();
      const char = characterBible.characters.find((candidate) => candidate.id === id);
      if (!char) continue;
      if (this.imageAgentTeam.hasReferenceSheet(id)) {
        alreadyAvailableReferenceCharacterIds.push(id);
        continue;
      }
      const hydrated = await this.hydrateReferenceSheetFromDisk(char);
      if (hydrated || this.imageAgentTeam.hasReferenceSheet(id)) {
        hydratedReferenceCharacterIds.push(id);
        continue;
      }

      this.emit({
        type: 'warning',
        phase: 'reference_sheet',
        message: `Resume reference preflight missing ${char.name}; generating reference before story images continue.`,
        data: { characterId: id, characterName: char.name },
      });
      await this.generateCharacterReferenceSheet(char, brief);
      const fingerprint = computeCharacterIdentityFingerprint(char);
      this.imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, fingerprint);
      if (this.imageAgentTeam.hasReferenceSheet(id)) {
        generatedReferenceCharacterIds.push(id);
      } else {
        missingReferenceCharacterIds.push(id);
      }
    }

    await saveEarlyDiagnostic(outputDirectory, 'image-reference-preflight.json', {
      generatedAt: new Date().toISOString(),
      plannedReferenceCharacterIds,
      alreadyAvailableReferenceCharacterIds,
      hydratedReferenceCharacterIds,
      generatedReferenceCharacterIds,
      missingReferenceCharacterIds,
      plannedReferenceCharacters: plannedReferenceCharacterIds.map((id) => {
        const char = characterBible.characters.find((candidate) => candidate.id === id);
        return { id, name: char?.name };
      }),
    });

    this.emit({
      type: 'debug',
      phase: 'reference_sheet',
      message: `Resume reference preflight complete: ${alreadyAvailableReferenceCharacterIds.length + hydratedReferenceCharacterIds.length} available, ${generatedReferenceCharacterIds.length} generated, ${missingReferenceCharacterIds.length} missing.`,
      data: {
        plannedReferenceCharacterIds,
        alreadyAvailableReferenceCharacterIds,
        hydratedReferenceCharacterIds,
        generatedReferenceCharacterIds,
        missingReferenceCharacterIds,
      },
    });

    return {
      plannedReferenceCharacterIds,
      alreadyAvailableReferenceCharacterIds,
      hydratedReferenceCharacterIds,
      generatedReferenceCharacterIds,
      missingReferenceCharacterIds,
    };
  }

  private async scanExistingImagesForResume(
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
    options: { targetEpisodeNumber?: number } = {},
  ): Promise<{
    totalSlots: number;
    resolvedSlotsBefore: number;
    resolvedSlotsAfter: number;
    hydratedReferenceSheets: number;
    plannedReferenceCharacterIds: string[];
    generatedReferenceCharacterIds: string[];
    missingReferenceCharacterIds: string[];
    missingSlotIds: string[];
    completedEncounterBaseIdentifiersByScene: Record<string, string[]>;
  }> {
    return this.draftImageEntry().scanExistingImagesForResume(outputDirectory, story, characterBible, encounters, brief, options);
  }

  private buildImageManifestFromStory(story: Story): ReturnType<DraftImageEntry['buildImageManifestFromStory']> {
    return this.draftImageEntry().buildImageManifestFromStory(story);
  }

  private async saveDraftImageManifest(outputDirectory: string | undefined, story: Story): Promise<void> {
    if (!outputDirectory) return;
    await saveEarlyDiagnostic(outputDirectory, 'image-manifest.json', this.buildImageManifestFromStory(story));
  }

  private enforceFinalTreatmentFidelity(params: {
    story: Story;
    analysis?: SourceMaterialAnalysis;
    expectedEpisodeCount?: number;
    sourceEpisodeCount?: number;
    isCompleteSeason?: boolean;
    sourceText?: string;
  }): void {
    const result = new TreatmentFidelityValidator().validateFinalStory(params);
    if (result.valid) return;

    const issues: ValidationIssue[] = result.issues.map((message) => ({
      category: 'treatment_fidelity',
      level: 'error',
      message,
      location: {},
      suggestion: 'Preserve the treatment anchor in the generated story, or regenerate the affected episode before saving final output.',
    }));
    this.emit({
      type: 'error',
      phase: 'treatment_fidelity',
      message: `Final story treatment fidelity failed with ${issues.length} error(s): ${issues[0]?.message || 'unknown treatment fidelity issue'}`,
      data: issues,
    });
    throw new ValidationError('Final story treatment fidelity failed', issues);
  }

  private async finalizeImageRunFromRegistry(
    outputDirectory: string,
    story: Story,
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    choiceSets: ChoiceSet[],
    encounters: EncounterStructure[],
    encounterImageDiagnostics: EncounterImageRunDiagnostic[] = [],
    terminalReason: 'cancelled' | 'failed' | 'completed' = 'completed',
    startTime = Date.now(),
  ): Promise<Story> {
    const finalStory = this.resolveGeneratedStoryPlayerTemplates(
      assembleStoryAssetsFromRegistry(story, this.assetRegistry),
      brief,
    );
    finalStory.outputDir = outputDirectory;
    const imageIntegrity = await this.repairBoundImageReferences(finalStory, outputDirectory);
    const manifest = this.buildImageManifestFromStory(finalStory);
    finalStory.imagesStatus = imageIntegrity.unresolved.length > 0
      ? 'failed'
      : manifest.imagesStatus;
    if (terminalReason === 'cancelled' && finalStory.imagesStatus === 'pending') {
      finalStory.imagesStatus = 'partial';
    }
    this.validateMicroEpisodeSeason(finalStory, { phase: 'micro_episode_season_final_validation' });
    const visualContractPersistence = this.auditStoryVisualContractPersistence(finalStory);

    await saveEarlyDiagnostic(outputDirectory, '08-final-story.json', finalStory);
    await saveEarlyDiagnostic(outputDirectory, '08-registry-state.json', this.assetRegistry.toSnapshot());
    await saveEarlyDiagnostic(outputDirectory, 'image-integrity-report.json', imageIntegrity);
    await saveEarlyDiagnostic(outputDirectory, 'visual-contract-persistence-report.json', visualContractPersistence);
    await this.saveDraftImageManifest(outputDirectory, finalStory);

    await savePipelineOutputs(outputDirectory, {
      brief,
      worldBible,
      characterBible,
      choiceSets,
      encounters,
      finalStory,
      generator: this.buildStoryGeneratorMetadata(),
      visualPlanning: this.getCollectedVisualPlanningForSave(),
      encounterImageDiagnostics,
      llmLedger: this.telemetry.getLlmLedger() ?? undefined,
      remediationSummary: this.getRemediationSummary(),
    }, Date.now() - startTime);

    this.emit({
      type: terminalReason === 'completed' ? 'debug' : 'warning',
      phase: 'images',
      message: `Finalized ${terminalReason} image run from AssetRegistry with imagesStatus=${finalStory.imagesStatus}.`,
      data: {
        imagesStatus: finalStory.imagesStatus,
        registryRecords: this.assetRegistry.values().length,
        unresolvedImageReferences: imageIntegrity.unresolved.length,
      },
    });
    return finalStory;
  }

  private async repairBoundImageReferences(story: Story, outputDirectory: string): Promise<{
    generatedAt: string;
    checked: number;
    repaired: Array<{ path: string; from: string; to: string }>;
    unresolved: Array<{ path: string; value: string; filePath: string }>;
  }> {
    return this.draftImageEntry().repairBoundImageReferences(story, outputDirectory);
  }

  private sceneContentFromStoryScene(scene: Scene): SceneContent {
    return {
      sceneId: scene.id,
      sceneName: scene.name,
      beats: (scene.beats || []) as unknown as GeneratedBeat[],
      startingBeatId: scene.startingBeatId || scene.beats?.[0]?.id || '',
      moodProgression: [],
      charactersInvolved: scene.charactersInvolved || [],
      keyMoments: [],
      continuityNotes: [],
      sequenceIntent: scene.sequenceIntent,
      sceneVisualSequencePlan: scene.sceneVisualSequencePlan,
      branchType: scene.branchType,
      isBottleneck: scene.isBottleneck,
      isConvergencePoint: scene.isConvergencePoint,
    };
  }

  private auditStoryVisualContractPersistence(story: Story): {
    passed: boolean;
    sceneCount: number;
    scenesWithSequencePlan: number;
    nonEstablishingBeatCount: number;
    nonEstablishingBeatsWithCoveragePlan: number;
    missingScenePlanIds: string[];
    missingCoverageBeatIds: string[];
  } {
    const report = {
      passed: true,
      sceneCount: 0,
      scenesWithSequencePlan: 0,
      nonEstablishingBeatCount: 0,
      nonEstablishingBeatsWithCoveragePlan: 0,
      missingScenePlanIds: [] as string[],
      missingCoverageBeatIds: [] as string[],
    };

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        report.sceneCount += 1;
        if (scene.sceneVisualSequencePlan) {
          report.scenesWithSequencePlan += 1;
        } else if ((scene.beats || []).length > 1) {
          report.missingScenePlanIds.push(scene.id);
        }

        for (const beat of scene.beats || []) {
          const isEstablishingBeat = (beat as Beat & { shotType?: string }).shotType === 'establishing'
            || beat.coveragePlan?.stagingPattern === 'environment';
          if (isEstablishingBeat) continue;
          report.nonEstablishingBeatCount += 1;
          if (beat.coveragePlan) {
            report.nonEstablishingBeatsWithCoveragePlan += 1;
          } else {
            report.missingCoverageBeatIds.push(`${scene.id}::${beat.id}`);
          }
        }
      }
    }

    report.passed = report.missingScenePlanIds.length === 0 && report.missingCoverageBeatIds.length === 0;
    return report;
  }

  async generateImagesForDraft(
    outputDirectory: string,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> },
    options: { targetEpisodeNumber?: number } = {},
  ): Promise<FullPipelineResult> {
    return this.draftImageGeneration().generateImagesForDraft(outputDirectory, resumeCheckpoint, options);
  }

  async generateTargetedBeatImagesForDraft(
    outputDirectory: string,
    targetSlots: Array<{ episodeNumber: number; sceneId: string; beatId: string }>,
    options: {
      skipEncounterImages?: boolean;
      skipCover?: boolean;
      skipCharacterRefs?: boolean;
      skipVisualContractValidation?: boolean;
    } = {},
  ): Promise<FullPipelineResult> {
    return this.draftImageGeneration().generateTargetedBeatImagesForDraft(outputDirectory, targetSlots, options);
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
    // WS1b: a billing-exhausted provider account fails every later call, so a
    // latched quota error pauses the run at the next checkpoint regardless of
    // failure policy — completed episodes survive (watermarks) and the worker
    // maps this failureKind to a resumable 'paused' job, not a discarded fail.
    const quotaMessage = BaseAgent.billingQuotaExhausted();
    if (quotaMessage) {
      throw new PipelineError(
        `Provider credit/quota exhausted — pausing run (resume after top-up): ${quotaMessage}`,
        'provider_quota',
        { context: { failureKind: 'provider-quota', resumePatchableInputs: ['settings'] } },
      );
    }
    // C4: per-story token ceiling. Abort fast if a runaway retry loop blows the
    // budget. Disabled unless config.generation.tokenBudgetPerStory is set.
    const budget = this.config.generation?.tokenBudgetPerStory;
    if (budget && budget > 0 && this._totalTokensUsed > budget) {
      throw new Error(
        `Token budget exceeded: used ${this._totalTokensUsed} tokens > budget ${budget}. ` +
          `Aborting to prevent runaway cost. Raise generation.tokenBudgetPerStory to allow more.`,
      );
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
    this.sceneValidationResults = [];
    this.allSceneValidationResults = [];
    this.allEncounterTelemetry = [];
    this.resetRemediationBudget(); // S3: fresh per-run remediation cap + counters
    this.resetCollectedVisualPlanning(); // Reset visual planning collection for new run
    BaseAgent.resetBillingQuotaState(); // WS1b: stale quota latch must not poison a resumed run
    const startTime = Date.now();

    // Register this generation job for tracking
    this.jobId = this.externallyAssignedJobId || generateJobId();
    this.externallyAssignedJobId = null;
    this.totalEpisodes = 1;
    this.currentEpisode = 1;
    // Seed the structure plan up front so the headline % is driven by real
    // work units (episodes -> scenes -> beats) from the start. Scenes/beats
    // fill in once StoryArchitect / SceneWriter run for this episode.
    this.generationPlan = initPlan({
      totalEpisodes: 1,
      episodes: [{
        number: brief.episode.number,
        title: brief.episode.title,
        expectedSceneCount:
          this.config.generation?.maxScenesPerEpisode ||
          this.config.generation?.targetSceneCount ||
          brief.options?.targetSceneCount ||
          6,
      }],
    });
    this.emitPlanUpdate('Generation plan: 1 episode');
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

    // Hoisted above the try so the catch block can reference late-phase
    // state. Under @ts-nocheck these lived inside the try, so the
    // JobCancelledError handler hit a ReferenceError before it could
    // finalize the image registry — a latent bug flushed by typing this file.
    let worldBible!: WorldBible;
    let characterBible!: CharacterBible;
    let story!: Story;
    let choiceSets!: ChoiceSet[];
    let encounters!: Map<string, EncounterStructure>;
    let outputDirectory: string | undefined;

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
      worldBible = resumedWorldBible
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
      characterBible = resumedCharacterBible
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
      // Extracted to phases/NPCDepthValidationPhase.ts (pure move): the cast
      // depth gate + the Karpathy character-design retry (adopts via
      // Object.assign onto the shared characterBible) + strict-mode abort /
      // advisory checkpoint on the residue.
      await new NPCDepthValidationPhase({
        npcDepthValidator: this.npcDepthValidator,
        rerunCharacterDesign: (repairedBrief, wb) =>
          this.measurePhase('character_design_retry', () => this.runCharacterDesign(repairedBrief, wb)),
      }).run(brief, worldBible, characterBible, {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      });

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
      const { sceneContents } = contentGenerationResult;
      ({ choiceSets, encounters } = contentGenerationResult);
      this.markPhaseComplete('content_generation');
      // Mark this single episode complete in the structure plan (covers the
      // resume path, where setSceneBeats never ran for the cached scenes).
      if (this.generationPlan) {
        markEpisode(this.generationPlan, brief.episode.number, 'complete');
        this.emitPlanUpdate('Episode content complete');
      }
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
      // Extracted to phases/QuickValidationPhase.ts (pure move): the fast
      // validator gate, incremental POV/voice escalation, targeted repair
      // (ChoiceAuthor + scoped SceneWriter rewrites), one re-validation, and
      // the blocking ValidationError. Repairs mutate sceneContents/choiceSets
      // in place via the shared array refs.
      const quickValidation = await this.quickValidationPhase().run(
        { brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, encounters },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );

      // === PHASE 5: QUALITY ASSURANCE ===
      await this.checkCancellation();
      let finalStoryContractReport: FinalStoryContractReport | undefined;

      // QA phase extracted to phases/QAPhase.ts (pure move): QARunner + best
      // practices in parallel, the choice-distribution checkpoint, the
      // QA-driven targeted repair loop, and the threshold warning. Repairs
      // mutate sceneContents/choiceSets in place via the shared array refs.
      const { qaReport, bestPracticesReport } = await this.qaPhase().run(
        { brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, encounters },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );

      await this.repairWeakCliffhangerBeforeImages(
        brief,
        worldBible,
        characterBible,
        episodeBlueprint,
        sceneContents,
        choiceSets,
        encounters,
      );

      // === PHASE 5.5: IMAGE GENERATION (single-episode mode) ===
      await this.checkCancellation();
      // Create output directory EARLY so images are saved to the right location
      // (outputDirectory itself is hoisted above the try for the catch block)
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
        const savedStoryPackage = loadEarlyDiagnosticSync<{ generator?: Record<string, unknown>; story?: Story } | Story>(outputDirectory, 'story.json');
        this.hydrateSeasonImageStyleFromStoryPackage(savedStoryPackage);
        this.applyActiveImageStyleToRuntime();
        this.resetAssetRegistry(idSlugify(brief.story.title));
        await saveEarlyDiagnostic(outputDirectory, `episode-${brief.episode.number}-blueprint.json`, episodeBlueprint);

        // Phase 6 (Plan Part 9 + Part 10): episode-time charge-materialization gate.
        // All logic lives in episodeChargeMaterialization (monolith ratchet). Default-off:
        // no-op unless CONVERGENCE_LEDGER is on; only throws under GATE_CHARGE_MATERIALIZATION.
        await runEpisodeChargeMaterializationForSeason(
          brief.seasonPlan,
          brief.episode.number,
          choiceSets,
          (ledger) =>
            saveEarlyDiagnostic(outputDirectory as string, `episode-${brief.episode.number}-charge-materialization.json`, ledger),
        );

        await this.repairSceneGraphBranchingChoices(
          brief,
          worldBible,
          characterBible,
          episodeBlueprint,
          sceneContents,
          choiceSets,
          encounters,
          { phase: 'branch_repair' }
        );

        const branchValidationEpisode = this.assembleEpisode(
          brief,
          worldBible,
          characterBible,
          episodeBlueprint,
          sceneContents,
          choiceSets,
          undefined,
          encounters,
          undefined,
          videoResults
        );
        await this.validateSceneGraphBranching(branchValidationEpisode, episodeBlueprint, {
          phase: 'branch_validation',
          outputDirectory,
          artifactName: `episode-${brief.episode.number}-branch-metrics.json`,
          residueRepair: { sceneContents, reassemble: () => this.assembleEpisode(brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, undefined, encounters, undefined, videoResults) },
        });
        this.validateMicroEpisodeStructure(branchValidationEpisode, {
          phase: 'micro_episode_validation',
        });

        // Set image service output directory to story's images folder
        if (this.config.imageGen?.enabled) {
          this.requirePhases('images', ['content_generation']);
          if (this.useStoryboardV2ImagePipeline()) {
            const storyboardResult = await this.imageWorkerQueue.run(() =>
              this.measurePhase(
                'storyboard_v2_image_generation',
                () => this.runStoryboardV2ImageGeneration(sceneContents, choiceSets, brief, characterBible, encounters, outputDirectory),
              )
            );
            imageResults = storyboardResult.imageResults;
            encounterImageResults = storyboardResult.encounterImageResults;
          } else {
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
        storyCoverUrl = await this.generateStoryCoverArt(brief, characterBible, worldBible, outputDirectory);
      }

      // === PHASE 6: ASSEMBLY ===
      // Extracted to phases/AssemblyPhase.ts (pure move): assembly + registry
      // asset merge, structural/craft auto-fix, template resolution, the
      // completeness gate (registry coverage + missing-image walk), asset
      // HTTP verification, and the deterministic flag-chronology/quote-recall
      // scans (which escalate onto qaReport in place).
      story = await this.assemblyPhase().run(
        {
          brief, worldBible, characterBible, episodeBlueprint, sceneContents,
          choiceSets, encounters, imageResults, encounterImageResults,
          storyCoverUrl, videoResults, outputDirectory, qaReport,
        },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );

      finalStoryContractReport = await this.enforceFinalStoryContract({
        story,
        brief,
        requestedEpisodeNumbers: [brief.episode.number],
        qaReport,
        bestPracticesReport,
        phase: 'final_story_contract',
      });

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
                this.allSceneValidationResults.length > 0 ? this.allSceneValidationResults : undefined,
              encounterTelemetry:
                this.encounterTelemetry.length > 0 ? this.encounterTelemetry : undefined,
              llmLedger: this.telemetry.getLlmLedger() ?? undefined,
              branchShadowDiffs:
                this.branchShadowDiffs.length > 0 ? this.branchShadowDiffs : undefined,
              bestPracticesReport,
              finalStoryContractReport,
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
            emit: this.emit.bind(this),
            addCheckpoint: this.addCheckpoint.bind(this),
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

      // Audio pre-generation extracted to phases/AudioPhase.ts (pure move);
      // gate condition, events, diagnostics, and the 08-final-story rewrite
      // all live there now.
      await new AudioPhase({
        audioService: this.audioService,
        audioWorkerQueue: this.audioWorkerQueue,
        requirePhases: this.requirePhases.bind(this),
        markPhaseComplete: this.markPhaseComplete.bind(this),
        measurePhase: this.measurePhase.bind(this),
        checkCancellation: () => this.checkCancellation(),
      }).run(
        { story, characterBible, outputDirectory, audioDiagnostics },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );

      // Browser QA extracted to phases/BrowserQAPhase.ts (pure move). The
      // phase may replace `story` (assets reassembled during remediation).
      if (story && outputDirectory && this.config.validation?.playwrightQA !== false) {
        story = await new BrowserQAPhase({
          imageService: this.imageService,
          assetRegistry: this.assetRegistry,
        }).run(
          { story, storyTitle: brief.story.title || '', outputDirectory },
          {
            config: this.config,
            emit: this.emit.bind(this),
            addCheckpoint: this.addCheckpoint.bind(this),
          }
        );
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
        if (outputDirectory && story && brief && worldBible && characterBible) {
          await this.finalizeImageRunFromRegistry(
            outputDirectory,
            story,
            brief,
            worldBible,
            characterBible,
            choiceSets || [],
            Array.from(encounters?.values?.() || []),
            [],
            'cancelled',
            startTime,
          ).catch((finalizeErr) => {
            this.emit({
              type: 'warning',
              phase: 'images',
              message: `Failed to finalize cancelled pipeline from registry: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`,
            });
          });
        }
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

  // Extracted to phases/WorldBuildingPhase.ts (pure move). This thin wrapper
  // keeps all three call sites (single-episode, world retry, multi-episode)
  // unchanged while the body lives in the typed phase module.
  private async runWorldBuilding(brief: FullCreativeBrief): Promise<WorldBible> {
    return new WorldBuildingPhase(this.worldBuilder).run(
      {
        story: brief.story,
        userPrompt: brief.userPrompt,
        world: brief.world,
        startingLocationId: brief.episode.startingLocation,
        rawDocument: brief.rawDocument,
        memoryContext: this.cachedPipelineMemory || undefined,
        locationIntroductions: brief.seasonPlan?.locationIntroductions,
        debug: this.config.debug,
      },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  // Extracted to phases/CharacterDesignPhase.ts (pure move). Thin delegating
  // wrapper keeps all three call sites (initial design, PhaseValidator retry,
  // the NPC-depth Karpathy retry) unchanged; cachedPipelineMemory is
  // accessor-backed.
  private async runCharacterDesign(
    brief: FullCreativeBrief,
    worldBible: WorldBible
  ): Promise<CharacterBible> {
    const deps = { characterDesigner: this.characterDesigner } satisfies Partial<CharacterDesignPhaseDeps> as unknown as CharacterDesignPhaseDeps;
    Object.defineProperties(deps, {
      cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
    });
    return new CharacterDesignPhase(deps).run(brief, worldBible, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
  }

  // Extracted to phases/EpisodeArchitecturePhase.ts (pure move). Thin
  // delegating wrapper keeps both call sites (initial + PhaseValidator retry)
  // unchanged; seasonChoicePlan (written by the phase), generationPlan,
  // architectAdvisoryWarnings, and cachedPipelineMemory are accessor-backed.
  private async runEpisodeArchitecture(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible
  ): Promise<EpisodeBlueprint> {
    const deps = {
      storyArchitect: this.storyArchitect,
      emitPlanUpdate: this.emitPlanUpdate.bind(this),
      getTargetBeatCountForScene: this.getTargetBeatCountForScene.bind(this),
    } satisfies Partial<EpisodeArchitecturePhaseDeps> as unknown as EpisodeArchitecturePhaseDeps;
    Object.defineProperties(deps, {
      cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
      generationPlan: { get: () => this.generationPlan },
      architectAdvisoryWarnings: { get: () => this.architectAdvisoryWarnings },
      seasonChoicePlan: {
        get: () => this.seasonChoicePlan,
        set: (value) => { this.seasonChoicePlan = value; },
      },
    });
    return new EpisodeArchitecturePhase(deps).run(brief, worldBible, characterBible, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
  }

  private getTargetBeatCountForScene(sceneBlueprint: SceneBlueprint): number {
    // LEVER B3: clamp the computed target to a hard ceiling (default 10) so an
    // outlier blueprint can't produce a pathologically large single scene call.
    const cap = this.config.generation?.maxBeatsPerScene || MAX_BEATS_PER_SCENE;
    if (this.config.generation?.episodeStructureMode === 'sceneEpisodes' && !sceneBlueprint.isEncounter) {
      return clampTargetBeatCount(this.config.generation.sceneEpisodeNormalTargetBeats || 8, cap);
    }
    return clampTargetBeatCount(sceneBlueprint.purpose === 'bottleneck'
      ? (this.config.generation?.bottleneckBeatCount || SCENE_DEFAULTS.bottleneckBeatCount)
      : (this.config.generation?.standardBeatCount || SCENE_DEFAULTS.standardBeatCount), cap);
  }

  /**
   * Run BranchManager to analyze and validate branch structure
   */
  // Extracted to phases/BranchAnalysisPhase.ts (pure move). Thin delegating
  // wrapper; branchShadowDiffs is accessor-backed run-scoped state.
  private async runBranchAnalysis(
    brief: FullCreativeBrief,
    blueprint: EpisodeBlueprint
  ): Promise<BranchAnalysis | null> {
    const deps = { branchManager: this.branchManager } satisfies Partial<BranchAnalysisPhaseDeps> as unknown as BranchAnalysisPhaseDeps;
    Object.defineProperties(deps, {
      branchShadowDiffs: { get: () => this.branchShadowDiffs },
    });
    return new BranchAnalysisPhase(deps).run(brief, blueprint, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
  }

  // Extracted to phases/ContentGenerationPhase.ts (pure move). Thin delegating
  // wrapper covering both call sites (generate() and the multi-episode
  // generateEpisodeFromOutline). Run-scoped state is accessor-backed; the four
  // fields the phase ASSIGNS (incrementalValidator, sceneValidationResults,
  // seasonSkillPlan, encounterTelemetry) are wired with setters.
  private async runContentGeneration(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    branchAnalysis?: BranchAnalysis,
    outputDirectory?: string,
    episodeNumber?: number
  ): Promise<{ sceneContents: SceneContent[]; choiceSets: ChoiceSet[]; encounters: Map<string, EncounterStructure> }> {
    const deps = {
      sceneWriter: this.sceneWriter,
      choiceAuthor: this.choiceAuthor,
      encounterArchitect: this.encounterArchitect,
      getThreadPlanner: () => this.getThreadPlanner(),
      getTwistArchitect: () => this.getTwistArchitect(),
      getCharacterArcTracker: () => this.getCharacterArcTracker(),
      assertSceneDependencyInvariants: this.assertSceneDependencyInvariants.bind(this),
      buildBranchFallbackChoiceSet: this.buildBranchFallbackChoiceSet.bind(this),
      buildDeterministicChoiceSet: (sceneBlueprint, choiceBeat) =>
        choiceBeat ? this.createFallbackSceneEpisodeChoiceSet(sceneBlueprint, choiceBeat) : undefined,
      buildChoiceAuthorNpcs: this.buildChoiceAuthorNpcs.bind(this),
      buildCompactWorldContext: this.buildCompactWorldContext.bind(this),
      buildEncounterPriorStateContext: this.buildEncounterPriorStateContext.bind(this),
      captureEncounterTelemetry: this.captureEncounterTelemetry.bind(this),
      checkCancellation: () => this.checkCancellation(),
      deriveStoryVerbsForBrief: this.deriveStoryVerbsForBrief.bind(this),
      emitPhaseProgress: this.emitPhaseProgress.bind(this),
      emitPlanUpdate: this.emitPlanUpdate.bind(this),
      episodeCheckpointFile: this.episodeCheckpointFile.bind(this),
      establishedCanonForPrompt: this.establishedCanonForPrompt.bind(this),
      getPhase4DefaultCollisions: this.getPhase4DefaultCollisions.bind(this),
      getTargetBeatCountForScene: this.getTargetBeatCountForScene.bind(this),
      getUnresolvedCallbacksForPrompt: this.getUnresolvedCallbacksForPrompt.bind(this),
      inferBranchType: this.inferBranchType.bind(this),
      isEpisodeFinalScene: this.isEpisodeFinalScene.bind(this),
      loadResumeUnit: this.loadResumeUnit.bind(this),
      recordRemediationSafe: this.recordRemediationSafe.bind(this),
      recordSceneValidationResult: this.recordSceneValidationResult.bind(this),
      repairSceneEpisodePlayableContract: this.repairSceneEpisodePlayableContract.bind(this),
      resolveWorldLocationForScene: this.resolveWorldLocationForScene.bind(this),
      runSceneCriticPass: this.runSceneCriticPass.bind(this),
      sanitizeReaderFacingSceneName: this.sanitizeReaderFacingSceneName.bind(this),
      saveResumeUnit: this.saveResumeUnit.bind(this),
      throwIfFailFast: this.throwIfFailFast.bind(this),
      trackEncounterFlagConsequences: this.trackEncounterFlagConsequences.bind(this),
    } satisfies Partial<ContentGenerationPhaseDeps> as unknown as ContentGenerationPhaseDeps;
    Object.defineProperties(deps, {
      incrementalValidator: {
        get: () => this.incrementalValidator,
        set: (value) => { this.incrementalValidator = value; },
      },
      sceneValidationResults: {
        get: () => this.sceneValidationResults,
        set: (value) => { this.sceneValidationResults = value; },
      },
      seasonSkillPlan: {
        get: () => this.seasonSkillPlan,
        set: (value) => { this.seasonSkillPlan = value; },
      },
      encounterTelemetry: {
        get: () => this.encounterTelemetry,
        set: (value) => { this.encounterTelemetry = value; },
      },
      cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
      callbackLedger: { get: () => this.callbackLedger },
      dependencySchedulerStats: { get: () => this.dependencySchedulerStats },
      episodeTwistPlans: { get: () => this.episodeTwistPlans },
      episodeArcTargets: { get: () => this.episodeArcTargets },
      generationPlan: { get: () => this.generationPlan },
      remediationBudget: { get: () => this.remediationBudget },
      seasonChoicePlan: { get: () => this.seasonChoicePlan },
      seasonThreadLedger: { get: () => this.seasonThreadLedger },
    });
    return new ContentGenerationPhase(deps).run(
      brief,
      worldBible,
      characterBible,
      blueprint,
      branchAnalysis,
      outputDirectory,
      episodeNumber,
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  /**
   * Optional SceneCritic rewrite pass (Phase 9.2). Re-authors the *text* of
   * beats in a small number of scenes to improve subtext / reversals /
   * show-don't-tell. Non-destructive — merges rewritten beats back into the
   * existing SceneContent objects, preserving structural fields.
   */
  private runSceneCriticPass(
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
  ): Promise<void> {
    return this.sceneCriticContinuity().runSceneCriticPass(sceneContents, characterBible);
  }

  // Extracted to phases/QAPhase.ts (pure move): the QARunner full-QA pass
  // with incremental-validation skip stubs. Thin delegating wrapper keeps the
  // per-episode QA pass in the multi-episode loop unchanged.
  private async runQualityAssurance(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint
  ): Promise<QAReport> {
    return this.qaPhase().runQualityAssurance(brief, sceneContents, choiceSets, characterBible, blueprint, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
  }

  private qaPhase(): QAPhase {
    const deps = {
      qaRunner: this.qaRunner,
      integratedValidator: this.integratedValidator,
      distributionValidator: this.distributionValidator,
      sceneWriter: this.sceneWriter,
      choiceAuthor: this.choiceAuthor,
      requirePhases: this.requirePhases.bind(this),
      markPhaseComplete: this.markPhaseComplete.bind(this),
      measurePhase: this.measurePhase.bind(this),
      emitPhaseProgress: this.emitPhaseProgress.bind(this),
      prepareValidationInput: this.prepareValidationInput.bind(this),
      buildContinuityCharacterKnowledge: this.buildContinuityCharacterKnowledge.bind(this),
      buildContinuityTimeline: this.buildContinuityTimeline.bind(this),
      buildCompactWorldContext: this.buildCompactWorldContext.bind(this),
      getTargetBeatCountForScene: this.getTargetBeatCountForScene.bind(this),
      buildChoiceAuthorNpcs: this.buildChoiceAuthorNpcs.bind(this),
      deriveStoryVerbsForBrief: this.deriveStoryVerbsForBrief.bind(this),
    } satisfies Partial<QAPhaseDeps> as unknown as QAPhaseDeps;
    // Accessor-backed run-scoped state: reads on the phase side always see
    // the pipeline's current values.
    Object.defineProperties(deps, {
      incrementalValidator: { get: () => this.incrementalValidator },
      sceneValidationResults: { get: () => this.sceneValidationResults },
      cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
    });
    return new QAPhase(deps);
  }

  private quickValidationPhase(): QuickValidationPhase {
    const deps = {
      integratedValidator: this.integratedValidator,
      sceneWriter: this.sceneWriter,
      choiceAuthor: this.choiceAuthor,
      prepareValidationInput: this.prepareValidationInput.bind(this),
      buildCompactWorldContext: this.buildCompactWorldContext.bind(this),
      getTargetBeatCountForScene: this.getTargetBeatCountForScene.bind(this),
      buildChoiceAuthorNpcs: this.buildChoiceAuthorNpcs.bind(this),
      deriveStoryVerbsForBrief: this.deriveStoryVerbsForBrief.bind(this),
    } satisfies Partial<QuickValidationPhaseDeps> as unknown as QuickValidationPhaseDeps;
    // Accessor-backed run-scoped state: reads on the phase side always see
    // the pipeline's current values.
    Object.defineProperties(deps, {
      sceneValidationResults: { get: () => this.sceneValidationResults },
      cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
    });
    return new QuickValidationPhase(deps);
  }

  // Extracted to phases/AssemblyPhase.ts (pure move, one documented
  // deviation: the completeness walk's encounter-validation branch
  // referenced out-of-scope variables — a latent ReferenceError — and was
  // dropped; see the NOTE in AssemblyPhase). assembleStory stays here with
  // its other callers (multi-episode loop, branch validation) and is
  // injected as a closure.
  private assemblyPhase(): AssemblyPhase {
    return new AssemblyPhase({
      assetRegistry: this.assetRegistry,
      assembleStory: this.assembleStory.bind(this),
      recordRemediationSafe: this.recordRemediationSafe.bind(this),
      resolveGeneratedStoryPlayerTemplates: this.resolveGeneratedStoryPlayerTemplates.bind(this),
      runFlagChronologyScan: this.runFlagChronologyScan.bind(this),
      saveDraftImageManifest: this.saveDraftImageManifest.bind(this),
      buildImageManifestFromStory: this.buildImageManifestFromStory.bind(this),
    });
  }

  /**
   * Phase B (Season Canon): targeted, advisory continuity repair. For scenes the
   * ContinuityChecker flagged with a character-consistency contradiction
   * (state_conflict / impossible_knowledge / contradiction), re-author the flagged
   * beats via SceneCritic — grounded in the capability canon — and merge the
   * rewritten PROSE back into the already-assembled story (ids/nav/choices
   * untouched). Bounded + advisory: never blocks; keeps the original on any failure.
   */
  private repairContinuityFindings(
    story: Story,
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
    qaReport: QAReport,
    outputDirectory: string,
    blueprint?: EpisodeBlueprint,
  ): Promise<void> {
    return this.sceneCriticContinuity().repairContinuityFindings(
      story, sceneContents, characterBible, qaReport, outputDirectory, blueprint,
    );
  }

  /**
   * Pull an `EncounterTelemetry` payload out of an EncounterArchitect
   * response's metadata (if present) and append it to the run-level
   * telemetry collector. Silently ignores responses that predate the
   * telemetry contract.
   */
  private captureEncounterTelemetry(
    metadata: Record<string, unknown> | undefined,
    sceneId?: string
  ): void {
    captureEncounterTelemetryInto(
      { perEpisode: this.encounterTelemetry, season: this.allEncounterTelemetry },
      metadata,
      sceneId
    );
  }

  /** Outcome slots that shipped identical default fallback prose (advisory). */
  private getPhase4DefaultCollisions(metadata: Record<string, unknown> | undefined): string[] {
    const raw = metadata?.encounterTelemetry as EncounterTelemetry | undefined;
    return Array.isArray(raw?.phase4DefaultCollisions) ? raw.phase4DefaultCollisions : [];
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

    // Branch-aware numbering: mutually-exclusive alternatives (scene-3a/scene-3b)
    // share a display number so the timeline doesn't read them as sequential.
    const timelineLabels = buildSceneTimelineLabels(scenes.map((s) => s.id));
    return scenes.map((s, idx) => {
      const label = s.name || s.id;
      const details = [s.narrativeFunction, s.mood].filter(Boolean).join(' / ');
      return {
        event: details ? `${label} (${details})` : label,
        when: `${timelineLabels[idx].label} (${s.id})`,
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
    return this.assembly().assembleStory(
      brief, worldBible, characterBible, blueprint, sceneContents, choiceSets, encounters,
      imageResults, encounterImageResults, storyCoverUrl, videoResults,
    );
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
      initialRelationship: this.ensureRelationshipStats(c.initialStats, tier),
      relationshipDimensions: this.relationshipDimensionsForNpc(c.initialStats, tier),
      tier,
      want: c.want,
      fear: c.fear,
      flaw: c.flaw,
      voiceProfile: voiceSlice,
      secrets,
      arc,
    };
  }

  private relationshipDimensionsForNpc(
    initialStats: CharacterBible['characters'][number]['initialStats'] | undefined,
    tier?: 'core' | 'supporting' | 'background',
  ): RelationshipDimension[] {
    const dimensions = new Set<RelationshipDimension>();
    if (initialStats) {
      if (initialStats.trust !== undefined) dimensions.add('trust');
      if (initialStats.affection !== undefined) dimensions.add('affection');
      if (initialStats.respect !== undefined) dimensions.add('respect');
      if (initialStats.fear !== undefined) dimensions.add('fear');
    }
    if (tier === 'core') {
      dimensions.add('trust');
      dimensions.add('affection');
      dimensions.add('respect');
      dimensions.add('fear');
    }
    return Array.from(dimensions);
  }

  private ensureRelationshipStats(
    initialStats: CharacterBible['characters'][number]['initialStats'] | undefined,
    tier?: 'core' | 'supporting' | 'background',
  ) {
    if (tier !== 'core') return initialStats;
    return {
      trust: initialStats?.trust ?? 0,
      affection: initialStats?.affection ?? 0,
      respect: initialStats?.respect ?? 0,
      fear: initialStats?.fear ?? 0,
    };
  }

  /**
   * Deterministically derive the per-episode character-arc and relationship deltas to
   * seal into the Season Canon. Without this the canon's `characters[]` / `relationships[]`
   * arrays were always empty (only flag-knowledge + worldFacts were sealed), so
   * later-episode prompts inherited no character-state or relationship continuity.
   *
   * No new LLM call: arc phase is derived from the episode's position in the season and
   * the bible's want→need framing; relationship dimensions come from the core NPCs'
   * tracked stats (`relationshipDimensionsForNpc` / `ensureRelationshipStats`). The
   * protagonist id is the literal 'protagonist' to match the flag-knowledge sealed by
   * extractCanonDeltasFromEpisode.
   */
  private extractArcAndRelationshipDeltas(
    characterBible: CharacterBible,
    episodeNumber: number,
    seasonLength: number,
  ): { arcStates: Array<{ characterId: string; state: string }>; relationships: Array<{ a: string; b: string; dimension: string; value: number }> } {
    const phases = ['establishment', 'test', 'turning_point', 'commitment', 'resolution'] as const;
    const ratio = seasonLength > 1 ? (episodeNumber - 1) / (seasonLength - 1) : 0;
    const phase =
      ratio < 0.2 ? phases[0]
      : ratio < 0.45 ? phases[1]
      : ratio < 0.6 ? phases[2]
      : ratio < 0.85 ? phases[3]
      : phases[4];

    const arcStates: Array<{ characterId: string; state: string }> = [];
    const relationships: Array<{ a: string; b: string; dimension: string; value: number }> = [];
    const protagonistCanonId = 'protagonist';

    const truncate = (text: string | undefined, max = 120): string =>
      (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

    for (const c of characterBible.characters) {
      const isProtagonist = c.role === 'protagonist';
      if (isProtagonist) {
        const want = truncate(c.want, 90);
        const need = truncate((c as { need?: string }).need, 90);
        const headline = need ? `want: ${want} → need: ${need}` : `want: ${want}`;
        arcStates.push({ characterId: protagonistCanonId, state: `${phase} — ${headline}` });
        continue;
      }
      if (c.tier !== 'core') continue;

      // Arc state for a core NPC: phase + their relationship-to-protagonist framing.
      const relToProtag = (c.relationships ?? []).find(
        (r) => r.targetId === characterBible.characters.find((x) => x.role === 'protagonist')?.id,
      );
      const relType = truncate(relToProtag?.relationshipType, 80);
      arcStates.push({
        characterId: c.id,
        state: relType ? `${phase} — ${relType}` : phase,
      });

      // Relationship dimensions (protagonist ↔ NPC). Values come from the NPC's tracked
      // stats; neutral (0) when the bible has not seeded them, which still records that
      // the relationship is canon and tracked.
      const stats = this.ensureRelationshipStats(c.initialStats, c.tier);
      for (const dimension of this.relationshipDimensionsForNpc(stats, c.tier)) {
        const value = (stats as Record<string, number | undefined>)?.[dimension] ?? 0;
        relationships.push({ a: protagonistCanonId, b: c.id, dimension, value });
      }
    }

    return { arcStates, relationships };
  }

  private prepareValidationInput(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>,
    blueprint?: EpisodeBlueprint
  ) {
    return this.finalContract().prepareValidationInput(sceneContents, choiceSets, characterBible, encounters, blueprint);
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

    const result = await withTimeoutAbort((signal) => this.sourceMaterialAnalyzer.execute({
      sourceText: sourceText || '',
      title,
      preferences,
      userPrompt,
    }, { signal }), PIPELINE_TIMEOUTS.sourceAnalysis, 'SourceMaterialAnalyzer.execute');

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
        writingStyleGuide: analysis.writingStyleGuide
          ? {
              source: analysis.writingStyleGuide.source,
              summary: analysis.writingStyleGuide.summary,
            }
          : undefined,
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
    BaseAgent.resetBillingQuotaState(); // WS1b: stale quota latch must not poison a resumed run
    analysis = this.refreshAnalysisFromTreatmentDocument(analysis, baseBrief.rawDocument);
    baseBrief = this.refreshBriefSeasonPlanFromAnalysis(baseBrief, analysis);
    baseBrief = this.reconcileBriefStoryMetadataFromPlan(baseBrief, analysis);
    // Arm treatmentSourced: the final-contract fidelity path reads the treatment
    // analysis from `brief.multiEpisode.sourceAnalysis`, but nothing ever populated it
    // (so `treatmentSourced` resolved false and the §4 gates never enforced). Stitch the
    // live, treatment-detected analysis back onto the brief. Gated default-OFF until the
    // remaining §4 validators are partial-season-safe (see GATE_TREATMENT_SOURCED_ARM).
    if (isGateEnabled('GATE_TREATMENT_SOURCED_ARM')) {
      baseBrief = {
        ...baseBrief,
        multiEpisode: { ...(baseBrief.multiEpisode || {}), sourceAnalysis: analysis },
      };
    }

    if (!analysis || !analysis.episodeBreakdown || analysis.episodeBreakdown.length === 0) {
      throw new Error('Invalid source analysis: no episode breakdown provided');
    }

    // WS1 (contracts upstream): the two plan-checkable §4 fidelity gates
    // (authored episode conformance, seven-point anchor conformance) run HERE,
    // before any generation is spent. A deterministic plan-vs-treatment
    // mismatch previously survived to the season-final contract and killed the
    // run after the full generation spend. Warnings surface; errors fail fast.
    // The season-final dispatch stays as a regression net for mid-run drift.
    {
      const planFidelity = runPlanTimeFidelityChecks({
        seasonPlan: baseBrief.seasonPlan,
        sourceAnalysis: baseBrief.multiEpisode?.sourceAnalysis ?? analysis,
      });
      for (const f of planFidelity.findings) {
        if (f.severity !== 'error') {
          this.emit({ type: 'warning', phase: 'plan_fidelity', message: `[${f.validator}] ${f.message}` });
        }
      }
      if (planFidelity.blockingErrors.length > 0) {
        const summary = planFidelity.blockingErrors
          .map((f) => `[${f.validator}] ${f.message}`)
          .join('; ');
        throw new PipelineError(
          `Plan-time treatment-fidelity check failed before generation: ${summary}`,
          'plan_fidelity',
          { context: { blockingErrors: planFidelity.blockingErrors } },
        );
      }
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
    this.sceneValidationResults = [];
    this.allSceneValidationResults = [];
    this.allEncounterTelemetry = [];
    this.resetRemediationBudget(); // S3: fresh per-run remediation cap + counters
    this.seasonCanon = new SeasonCanon({ storyId: idSlugify(baseBrief.story.title) });
    this.priorEpisodeSnapshot = undefined;
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

    // Seed the structure plan before world/character/image work so the headline
    // % is driven by real work units from the start. Episode titles and scene
    // counts fill in once the per-episode outlines and architect run.
    const estimatedScenesPerEpisode = this.config.generation?.episodeStructureMode === 'sceneEpisodes'
      ? (this.config.generation?.sceneEpisodeMaxScenes || 1)
      : (this.config.generation?.maxScenesPerEpisode || this.config.generation?.targetSceneCount || 6);
    this.generationPlan = initPlan({
      totalEpisodes: this.totalEpisodes,
      episodes: episodesToGenerate.map((number) => ({ number, expectedSceneCount: estimatedScenesPerEpisode })),
    });
    this.emitPlanUpdate(`Generation plan: ${this.totalEpisodes} episode(s)`);

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
      const missingOutlines = episodesToGenerate.filter((episodeNumber) =>
        !filteredAnalysis.episodeBreakdown.some((episode) => episode.episodeNumber === episodeNumber)
      );
      if (missingOutlines.length > 0) {
        throw new Error(
          `Requested episode(s) ${missingOutlines.join(', ')} are missing from source analysis after treatment parsing. ` +
          'Re-run source analysis or check the treatment sceneEpisode headings.'
        );
      }

      // Adoption flag (A2/A5): run the foundation phases and the sequential
      // episode loop on the run-graph runner. Default OFF; golden-parity
      // tested both ways (FullStoryPipeline.runGraphParity.season.test.ts).
      const runGraphEnabled =
        this.config.generation?.runGraphEpisodeLoop === true || process.env.STORYRPG_RUN_GRAPH === '1';

      // 2. Build foundation (World & Characters)
      this.emit({ type: 'phase_start', phase: 'foundation', message: 'Building story foundation...' });
      this.emitPhaseProgress('foundation', 0, 2, 'foundation:steps', 'Preparing shared story foundation...');

      const worldBrief = createWorldBriefFromAnalysis(baseBrief, filteredAnalysis);
      const characterBrief = createCharacterBriefFromAnalysis(baseBrief, filteredAnalysis);
      const resumedWorldBible = this.getResumeOutput<any>(resumeCheckpoint, 'world_bible');
      const resumedCharacterBible = this.getResumeOutput<any>(resumeCheckpoint, 'character_bible');
      let worldBible: any;
      let characterBible: any;
      if (runGraphEnabled) {
        // A5: same builds, declared as a two-step graph chain with the resume
        // payload seeded as artifacts (resume-by-construction replaces the
        // ternaries below; hooks keep emit/checkpoint order byte-identical).
        ({ worldBible, characterBible } = await runFoundationOnGraph<any, any>({
          resumedWorldBible,
          resumedCharacterBible,
          buildWorldBible: () => this.measurePhase('multi_world_building', () => this.runWorldBuilding(worldBrief)),
          buildCharacterBible: (world) => this.measurePhase('multi_character_design', () =>
            this.runCharacterDesign(characterBrief, world)),
          onWorldBuilt: (world) => this.addCheckpoint('World Bible', world, false),
          onCharactersBuilt: (characters) => this.addCheckpoint('Character Bible', characters, false),
          onWorldResumed: () =>
            this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared world foundation from checkpoint' }),
          onCharactersResumed: () =>
            this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared character foundation from checkpoint' }),
          afterWorld: () => this.emitPhaseProgress('foundation', 1, 2, 'foundation:steps', 'World foundation complete'),
          afterCharacters: () =>
            this.emitPhaseProgress('foundation', 2, 2, 'foundation:steps', 'Character foundation complete'),
          emitDebug: (message) => this.emit({ type: 'debug', phase: 'run_graph', message }),
        }));
      } else {
        worldBible = resumedWorldBible
          ? resumedWorldBible
          : await this.measurePhase('multi_world_building', () => this.runWorldBuilding(worldBrief));
        if (resumedWorldBible) {
          this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared world foundation from checkpoint' });
        } else {
          this.addCheckpoint('World Bible', worldBible, false);
        }
        this.emitPhaseProgress('foundation', 1, 2, 'foundation:steps', 'World foundation complete');

        const characterBrief = createCharacterBriefFromAnalysis(baseBrief, filteredAnalysis);
        characterBible = resumedCharacterBible
          ? resumedCharacterBible
          : await this.measurePhase('multi_character_design', () => this.runCharacterDesign(characterBrief, worldBible));
        if (resumedCharacterBible) {
          this.emit({ type: 'debug', phase: 'foundation', message: 'Resumed shared character foundation from checkpoint' });
        } else {
          this.addCheckpoint('Character Bible', characterBible, false);
        }
        this.emitPhaseProgress('foundation', 2, 2, 'foundation:steps', 'Character foundation complete');
      }

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
      this._currentOutputDirectory = outputDirectory; // F4: visible to the terminal catch
      this.addCheckpoint('Output Directory', { outputDirectory }, false);

      // Season Canon (P4) resume: rehydrate sealed canon + ledger from disk so a
      // later partial run skips re-sealing already-sealed episodes and reads prior
      // facts. Best-effort — absent/corrupt artifacts just start fresh.
      if (this.seasonCanonOn) {
        const savedCanon = loadEarlyDiagnosticSync<any>(outputDirectory, 'season-canon.json');
        if (savedCanon) { try { this.seasonCanon = SeasonCanon.deserialize(savedCanon); } catch { /* start fresh */ } }
        const savedLedger = loadEarlyDiagnosticSync<any>(outputDirectory, 'season-ledger.json');
        if (savedLedger) { try { this.callbackLedger = CallbackLedger.deserialize(savedLedger); } catch { /* start fresh */ } }
        this.priorEpisodeSnapshot = loadEarlyDiagnosticSync<EpisodeStateSnapshot>(outputDirectory, 'episode-state-snapshot.json') ?? undefined;
      }

      const savedStoryPackage = loadEarlyDiagnosticSync<{ generator?: Record<string, unknown>; story?: Story } | Story>(outputDirectory, 'story.json');
      this.hydrateSeasonImageStyleFromStoryPackage(savedStoryPackage);
      this.applyActiveImageStyleToRuntime();
      
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
      // Enrich the seeded plan with real episode titles + scene estimates now
      // that the per-episode outlines are known.
      if (this.generationPlan) {
        for (const spec of episodeSpecs) {
          const node = this.generationPlan.episodes.find((e) => e.number === spec.episodeNumber);
          if (!node) continue;
          node.title = spec.outline.title;
          if (typeof spec.outline.estimatedSceneCount === 'number' && spec.outline.estimatedSceneCount > 0) {
            node.expectedSceneCount = spec.outline.estimatedSceneCount;
          }
        }
        this.emitPlanUpdate('Episode outlines ready');
      }

      // WS1a episode-granularity resume: episodes that already fully assembled
      // in this output directory (valid watermark + assembled artifact) are
      // rehydrated instead of regenerated.
      const { pending: pendingEpisodeSpecs, resumed: resumedEpisodes } = partitionResumableEpisodes(
        episodeSpecs,
        <T,>(name: string) => loadEarlyDiagnosticSync<T>(outputDirectory, name),
      );
      for (const { spec, episode, watermark } of resumedEpisodes) {
        episodes.push(episode);
        episodeResults.push({ episodeNumber: spec.episodeNumber, title: spec.outline.title, success: true });
        completedEpisodeCount += 1;
        if (this.generationPlan) markEpisode(this.generationPlan, spec.episodeNumber, 'complete');
        this.emit({
          type: 'debug',
          phase: `episode_${spec.episodeNumber}`,
          message: `Resumed episode ${spec.episodeNumber} from completion watermark (${watermark.sceneCount} scenes) — skipping regeneration`,
        });
      }
      if (completedEpisodeCount > 0) {
        this.emitPlanUpdate(`${completedEpisodeCount} episode(s) resumed from checkpoints`);
      }
      this.emitPhaseProgress('content', completedEpisodeCount, totalEpisodeProgressItems, 'episodes', 'Preparing episode generation queue...');

      if (parallelEnabled) {
        this.emit({
          type: 'phase_start',
          phase: 'episode_parallelism',
          message: `Parallel episode mode enabled with concurrency=${maxParallelEpisodes}`,
        });
        const queue = new LocalWorkerQueue(maxParallelEpisodes);
        const processed = await mapWithConcurrency(
          pendingEpisodeSpecs,
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
            if (this.generationPlan) markEpisode(this.generationPlan, spec.episodeNumber, 'active');
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
            if (generatedEpisode.episode) {
              await writeEpisodeCompletion({
                episode: generatedEpisode.episode,
                episodeNumber: spec.episodeNumber,
                title: spec.outline.title,
                save: (name, data) => saveEarlyDiagnostic(outputDirectory, name, data),
              });
            }
            completedEpisodeCount += 1;
            if (this.generationPlan) {
              markEpisode(this.generationPlan, spec.episodeNumber, 'complete');
              this.emitPlanUpdate(`Episode ${spec.episodeNumber} complete`);
            }
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
        // Sequential episode generation. The per-episode body is ONE closure
        // shared by both execution paths below: the legacy for-loop, and the
        // run-graph chain (adoption A2) that journals each episode as an
        // artifact (resume/surgical-invalidation semantics owned by the
        // runner). Same body either way — golden-parity tested.
        const processPendingEpisode = async (
          spec: (typeof pendingEpisodeSpecs)[number],
          opts: { writeWatermark: boolean },
        ): Promise<Episode | null> => {
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
          if (this.generationPlan) markEpisode(this.generationPlan, i, 'active');
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
          // Season Canon (P4): seal the validated episode into durable canon + ledger
          // and carry state forward. Gate issues advisory unless seasonCanonBlocking.
          if (this.seasonCanonOn && generated.episode) {
            // Phase G: pin each promise's explicit payoffEpisode from the season spine
            // (derived from seasonFlags) so the promise-due gate has real targets.
            // E1: also pin the later-payoff choice moments (a "pays off later" choice IS a
            // promise with an explicit payoffEpisode) so the same gate enforces them.
            const spineEntries = [
              ...deriveSpinePlantMap(baseBrief.seasonPlan).entries,
              ...spineEntriesFromChoicePlan(this.seasonChoicePlan),
            ];
            const spineResult = applySpinePlantMap(this.callbackLedger, { entries: spineEntries });
            if (spineResult.unmatched.length > 0) {
              this.emit({ type: 'debug', phase: `season_canon_ep_${i}`, message: `Spine plant map: ${spineResult.applied} applied, ${spineResult.unmatched.length} not yet planted.` });
            }
            // B2: extract prose knowledge + claims so the canon holds who-knows-what
            // (not just flags+capability) and the canon-consistency gate runs over real
            // claims (it was a no-op). Deterministic seed from the QA character-knowledge
            // bundle + the flags this episode gates on.
            const episodeKnowledge = extractEpisodeKnowledge({
              episodeNumber: i,
              protagonistId: 'protagonist', // matches the flag-knowledge sealed by extractCanonDeltasFromEpisode
              characterKnowledge: this.buildContinuityCharacterKnowledge(characterBible),
              referencedFlags: collectReferencedFlags(generated.episode as any),
              sceneText: episodeProseCorpus(generated.episode as any), // WS7: readership counts → monotonic canon facts
            });
            const seasonLengthForArc = analysis.totalEstimatedEpisodes || this.totalEpisodes;
            const arcAndRelationship = this.extractArcAndRelationshipDeltas(
              characterBible,
              i,
              seasonLengthForArc,
            );
            const seal = await sealAndPersistEpisode({
              episode: generated.episode as any,
              episodeNumber: i,
              seasonLength: seasonLengthForArc,
              ledger: this.callbackLedger,
              canon: this.seasonCanon,
              priorSnapshot: this.priorEpisodeSnapshot,
              claims: episodeKnowledge.claims,
              // Seal capability facts (who-can-do-what) + extracted knowledge/worldFacts
              // so downstream prompts inherit a richer canon (Season Canon, Phase B/B2).
              // Plus per-episode character arc state + relationship dimensions so the
              // canon's characters[]/relationships[] are populated (were always empty).
              extraDeltas: {
                worldFacts: [
                  ...characterCapabilityWorldFacts(characterBible.characters),
                  ...(episodeKnowledge.deltas.worldFacts ?? []),
                ],
                knowledge: episodeKnowledge.deltas.knowledge,
                arcStates: arcAndRelationship.arcStates,
                relationships: arcAndRelationship.relationships,
              },
              save: (name, data) => saveEarlyDiagnostic(outputDirectory, name, data),
            });
            this.priorEpisodeSnapshot = seal.snapshot;
            for (const issue of seal.evaluation.issues) {
              this.emit({ type: 'warning', phase: `season_canon_ep_${i}`, message: `[advisory] ${issue.message}` });
            }
            // Phase G.4: when blocking is enabled, an unmet promise/canon ERROR at its
            // due episode hard-fails the run (default off until a regen validates).
            const blockingIssues = seal.evaluation.issues.filter((x) => x.severity === 'error');
            if (this.seasonCanonBlockingOn && blockingIssues.length > 0) {
              throw new Error(`Season Canon gate failed for episode ${i}: ${blockingIssues.map((x) => x.message).join('; ')}`);
            }
          }
          // WS1a: watermark only after content + canon seal both succeeded, so
          // a resume never rehydrates an episode that failed its season gate.
          // (In run-graph mode the artifact store writes the same watermark
          // when the step's output persists — same files, same ordering.)
          if (opts.writeWatermark && generated.episode) {
            await writeEpisodeCompletion({
              episode: generated.episode,
              episodeNumber: i,
              title: spec.outline.title,
              save: (name, data) => saveEarlyDiagnostic(outputDirectory, name, data),
            });
          }
          completedEpisodeCount += 1;
          if (this.generationPlan) {
            markEpisode(this.generationPlan, i, 'complete');
            this.emitPlanUpdate(`Episode ${i} complete`);
          }
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
          return generated.episode ?? null;
        };

        if (runGraphEnabled) {
          // Adoption A2: same body, scheduled/journaled by the run-graph
          // runner — see pipeline/episodeRunGraph.ts for the semantics.
          await runEpisodeLoopOnGraph({
            specs: pendingEpisodeSpecs,
            strict: this.config.validation.mode === 'strict',
            io: {
              save: (name, data) => saveEarlyDiagnostic(outputDirectory, name, data),
              load: <T,>(name: string) => loadEarlyDiagnosticSync<T>(outputDirectory, name),
            },
            processEpisode: (spec) => processPendingEpisode(spec, { writeWatermark: false }),
            emitDebug: (message) => this.emit({ type: 'debug', phase: 'run_graph', message }),
          });
        } else {
          for (const spec of pendingEpisodeSpecs) {
            await processPendingEpisode(spec, { writeWatermark: true });
          }
        }
      }
      episodes.sort((a, b) => (a.number || 0) - (b.number || 0));
      episodeResults.sort((a, b) => a.episodeNumber - b.episodeNumber);
      this.assertEpisodeOrderingInvariants(episodes, episodeResults);

      // Season Canon (P5): when the whole season has been sealed, run the
      // completion gate — every promise must be paid or abandoned. Advisory.
      if (this.seasonCanonOn &&
          this.seasonCanon.sealedEpisodeNumbers().length >= (analysis.totalEstimatedEpisodes || this.totalEpisodes)) {
        for (const issue of validateSeasonCompletion(this.callbackLedger)) {
          this.emit({ type: 'warning', phase: 'season_canon_completion', message: `[advisory] ${issue.message}` });
        }
      }

      // Aggregate per-episode QA reports into a single summary
      let aggregatedQAReport: QAReport | undefined;
      let aggregatedBPReport: ComprehensiveValidationReport | undefined;
      let finalStoryContractReport: FinalStoryContractReport | undefined;

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
          // F4: early-return path — record the failed run in the quality ledger.
          await appendFailedRunLedger(outputDirectory, episodeResults.filter(r => !r.success).length);
        } catch (_logErr) { /* non-fatal */ }
        
        // Still save partial results (world bible, character bible) for debugging
        const visualPlanningOutputs = this.getCollectedVisualPlanningForSave();
        const partialSave = savePipelineOutputs(outputDirectory, {
          brief: baseBrief,
          worldBible,
          characterBible,
          generator: this.buildStoryGeneratorMetadata(),
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

      const failedEpisodeResults = episodeResults.filter(result => !result.success);
      if (failedEpisodeResults.length > 0) {
        const failedErrors = failedEpisodeResults
          .map(result => `Episode ${result.episodeNumber}: ${result.error || 'Unknown error'}`)
          .join('; ');
        const failMsg = `${failedEpisodeResults.length} of ${episodeResults.length} episode(s) failed to generate: ${failedErrors}`;
        console.error(`[Pipeline] ❌ ${failMsg}`);

        if (this.jobId) {
          await failJob(this.jobId, failMsg);
        }

        this.emit({ type: 'error', phase: 'episode_generation', message: failMsg });

        try {
          await savePipelineErrorLog(outputDirectory,
            failedEpisodeResults.map(result => ({
              timestamp: new Date().toISOString(),
              phase: `episode_${result.episodeNumber}`,
              message: result.error || 'Unknown error',
              episodeNumber: result.episodeNumber,
            }))
          );
          // F4: this episode-failure path returns early (never reaches the
          // terminal catch), so record the failed run in the quality ledger here.
          await appendFailedRunLedger(outputDirectory, failedEpisodeResults.length);
        } catch (_logErr) { /* non-fatal */ }

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
        multiCoverUrl = await this.generateStoryCoverArt(baseBrief, characterBible, worldBible, outputDirectory);
      }

      const storyCoverImage = multiCoverUrl
        || (episodes.length > 0 && episodes[0].coverImage ? episodes[0].coverImage as unknown as string : '');
        
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
          .filter((c: CharacterProfile) => c.id !== baseBrief.protagonist.id)
          .map((c: CharacterProfile) => {
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
      const continuationStory = this.loadContinuationStory(outputDirectory, resumeCheckpoint);
      if (continuationStory?.episodes?.length) {
        const mergeResult = mergeSeasonEpisodes(continuationStory, story);
        story = assembleStoryAssetsFromRegistry(mergeResult.story, this.assetRegistry);
        this.emit({
          type: 'debug',
          phase: 'season_continuation',
          message: `Merged ${mergeResult.appendedEpisodeNumbers.length} new episode(s) into existing season (${story.episodes.length} total).`,
          data: {
            appendedEpisodeNumbers: mergeResult.appendedEpisodeNumbers,
            replacedEpisodeNumbers: mergeResult.replacedEpisodeNumbers,
          },
        });
      }
      if (this.config.generation?.assetGenerationMode === 'story-only') {
        story.imagesStatus = 'pending';
        await this.saveDraftImageManifest(outputDirectory, story);
      } else if (this.config.imageGen?.enabled) {
        story.imagesStatus = this.buildImageManifestFromStory(story).imagesStatus;
      }

      // STRUCTURAL AUTO-FIX (parity with the single-episode path, which runs
      // this before its contract): repair navigation/structure issues on the
      // merged season — including dangling choice nextBeatId references — so the
      // final contract doesn't abort on defects that are mechanically fixable.
      try {
        const autoFixResult = new StructuralValidator().autoFix(story);
        story = autoFixResult.story;
        if (autoFixResult.fixedCount > 0) {
          this.emit({
            type: 'debug',
            phase: 'final_story',
            message: `StructuralValidator.autoFix applied ${autoFixResult.fixedCount} repair(s) to the merged season`,
            data: { fixes: autoFixResult.fixes.slice(0, 20) },
          });
        }
      } catch (autoFixError) {
        this.emit({
          type: 'warning',
          phase: 'final_story',
          message: `StructuralValidator.autoFix failed (non-fatal): ${(autoFixError as Error).message}`,
        });
      }

      // B2: never discard generated work. Snapshot the assembled story BEFORE
      // the final gates (treatment fidelity, story contract) that can throw, so
      // completed episodes survive a late abort as partial-story.json.
      await savePartialStory(outputDirectory, story);

      this.enforceFinalTreatmentFidelity({
        story,
        analysis: filteredAnalysis,
        expectedEpisodeCount: episodesToGenerate.length,
        sourceEpisodeCount: analysis.totalEstimatedEpisodes,
        isCompleteSeason: story.episodes.length >= analysis.totalEstimatedEpisodes,
        sourceText: baseBrief.rawDocument,
      });
      this.validateMicroEpisodeSeason(story, { phase: 'micro_episode_season_final_validation' });

      finalStoryContractReport = await this.enforceFinalStoryContract({
        story,
        brief: baseBrief,
        requestedEpisodeNumbers: episodesToGenerate,
        qaReport: aggregatedQAReport,
        bestPracticesReport: aggregatedBPReport,
        phase: 'final_story_contract',
      });

      this.addCheckpoint('Final Story', story, false);
      await this.saveResumeUnit(
        outputDirectory,
        'final_story_package',
        'checkpoints/final-story-before-save.json',
        story,
      );

      // 6. Save results (using outputDirectory created earlier)
      // Prepare visual planning outputs for saving
      const visualPlanningOutputs = this.getCollectedVisualPlanningForSave();
      
      const multiEpSave = savePipelineOutputs(outputDirectory, {
        brief: baseBrief,
        worldBible,
        characterBible,
        finalStory: story,
        generator: this.buildStoryGeneratorMetadata(),
        visualPlanning: visualPlanningOutputs,
        qaReport: aggregatedQAReport,
        incrementalValidationResults: this.allSceneValidationResults.length > 0
          ? this.allSceneValidationResults
          : undefined,
        // allEncounterTelemetry is the season superset (per-episode buffer is reset).
        encounterTelemetry: this.allEncounterTelemetry.length > 0 ? this.allEncounterTelemetry : undefined,
        llmLedger: this.telemetry.getLlmLedger() ?? undefined,
        branchShadowDiffs: this.branchShadowDiffs.length > 0
          ? this.branchShadowDiffs
          : undefined,
        bestPracticesReport: aggregatedBPReport,
        finalStoryContractReport,
        encounterImageDiagnostics: allEncounterImageDiagnostics,
        remediationSummary: this.getRemediationSummary(),
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
        // F4: record the failure to disk + the quality ledger. The catch is
        // outside the try that declares outputDirectory, so use the field.
        if (this._currentOutputDirectory) {
          // Preserve the structured failure context so the run is inspectable
          // on disk and the generator can be fixed — not just the top-line
          // message. PipelineError carries .context (e.g. the final story
          // contract's blocking issues); ValidationError carries .issues (e.g.
          // the specific treatment-fidelity anchors that drifted).
          let details: Record<string, unknown> | undefined;
          if (error instanceof PipelineError && error.context) {
            details = error.context;
          } else if (error instanceof ValidationError && error.issues?.length) {
            details = { issues: error.issues };
          }
          await savePipelineErrorLog(this._currentOutputDirectory, [{
            timestamp: new Date().toISOString(),
            phase: 'pipeline_abort',
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            ...(details ? { details } : {}),
          }]);
          // B3a: record the failure kind for cross-run triage. PipelineError carries
          // the phase (failureKind) + agent/validator (validatorId).
          await appendFailedRunLedger(this._currentOutputDirectory, 1, {
            blocked: true,
            failureKind: error instanceof PipelineError ? error.phase : (error instanceof Error ? error.name : 'unknown'),
            validatorId: error instanceof PipelineError ? error.agent : undefined,
          });
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

      const blueprintPath = this.episodeCheckpointFile(i, 'blueprint');
      const blueprint = this.loadResumeUnit<EpisodeBlueprint>(
        outputDirectory,
        `episode_blueprint:episode-${i}`,
        blueprintPath,
      ) || await this.measurePhase(`episode_${i}_architecture`, () => this.runEpisodeArchitecture(episodeBrief, worldBible, characterBible));
      await this.saveResumeUnit(outputDirectory, `episode_blueprint:episode-${i}`, blueprintPath, blueprint);
      await saveEarlyDiagnostic(outputDirectory, `episode-${i}-blueprint.json`, blueprint);
      const branchPath = this.episodeCheckpointFile(i, 'branch-analysis');
      const branchAnalysis = this.loadResumeUnit<BranchAnalysis | null>(
        outputDirectory,
        `branch_analysis:episode-${i}`,
        branchPath,
      ) ?? await this.measurePhase(`episode_${i}_branch_analysis`, () => this.runBranchAnalysis(episodeBrief, blueprint));
      await this.saveResumeUnit(outputDirectory, `branch_analysis:episode-${i}`, branchPath, branchAnalysis);
      const { sceneContents, choiceSets, encounters } = await this.measurePhase(
        `episode_${i}_content`,
        () => this.runContentGeneration(
          episodeBrief,
          worldBible,
          characterBible,
          blueprint,
          branchAnalysis || undefined,
          outputDirectory,
          i
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
        // Deterministically realize planted-but-uncollected callbacks: append a
        // flag-gated TextVariant (sourced from the choice's reminderPlan) to a downstream
        // beat for each in-window hook the LLM left unreferenced. Mutates sceneContents,
        // which assembly + validation both read afterward, so the payoff lands in the
        // shipped story AND lifts the callback-coverage metric. See callbackOrchestration.
        const { injected } = this.injectFallbackCallbacks({
          episodeNumber: i,
          sceneContents: sceneContents as unknown as InjectFallbackCallbacksParams['sceneContents'],
          choiceSets: choiceSets as unknown as InjectFallbackCallbacksParams['choiceSets'],
        });
        if (newHooks > 0 || payoffs > 0 || injected > 0) {
          this.emit({
            type: 'debug',
            phase: `episode_${i}_callbacks`,
            message: `Callback ledger: +${newHooks} new hook(s), +${payoffs} authored payoff(s), +${injected} auto-realized this episode; ${this.callbackLedger.size()} total`,
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

      await this.repairWeakCliffhangerBeforeImages(
        episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        sceneContents,
        choiceSets,
        encounters,
      );

      await this.repairSceneGraphBranchingChoices(
        episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        sceneContents,
        choiceSets,
        encounters,
        { phase: `episode_${i}_branch_repair` }
      );
      this.compactSceneEpisodeBeatOverflow(sceneContents, choiceSets, encounters, {
        phase: `episode_${i}_micro_episode_compaction`,
      });

      const branchValidationEpisode = this.assembleEpisode(
        episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        sceneContents,
        choiceSets,
        undefined,
        encounters,
        undefined,
      );
      await this.validateSceneGraphBranching(branchValidationEpisode, blueprint, {
        phase: `episode_${i}_branch_validation`,
        outputDirectory,
        artifactName: `episode-${i}-branch-metrics.json`,
        residueRepair: { sceneContents, reassemble: () => this.assembleEpisode(episodeBrief, worldBible, characterBible, blueprint, sceneContents, choiceSets, undefined, encounters, undefined) },
      });
      this.validateMicroEpisodeStructure(branchValidationEpisode, {
        phase: `episode_${i}_micro_episode_validation`,
      });

      // Narrative diagnostics (SetupPayoff / Twist / ArcDelta / Divergence / Callback /
      // FailureMode + E5 intensity / #26C prop-intro / D4 choice-coverage). RELOCATED here
      // — BEFORE image generation — because the image-gen block below can short-circuit the
      // rest of this method, which silently dropped ALL narrative diagnostics (and
      // 08-registry-state) in EVERY multi-episode run, going back months: the branch-metrics
      // write just above lands, but nothing after the image block did. This point is
      // guaranteed reached, and `branchValidationEpisode` is a full assembled episode (sans
      // images — all the divergence check needs). The unconditional marker confirms reach.
      this.emit({ type: 'debug', phase: `episode_${i}_narrative_diagnostics`, message: 'Narrative diagnostics: reached (pre-image-gen).' });
      let narrativeDiagnosticsReport: NarrativeDiagnosticsReport | undefined;
      try {
        const narrativeDiagnostics = runNarrativeDiagnostics({
          episodeNumber: i,
          totalEpisodes: baseBrief.seasonPlan?.episodes?.length ?? i,
          sceneContents,
          episode: branchValidationEpisode,
          // Thread/Twist planning (default-off): hand SetupPayoff/TwistQuality the
          // REAL ThreadPlanner ledger + this episode's TwistPlan when the flag
          // populated them. Undefined otherwise — the historical derived/absent
          // behavior is unchanged.
          threadLedger: this.seasonThreadLedger.threads.length > 0 ? this.seasonThreadLedger : undefined,
          twistPlan: this.episodeTwistPlans.get(i),
          // Character-arc tracking (default-off): hand ArcDelta the REAL
          // CharacterArcTracker targets plus deterministic best-effort observed
          // deltas simulated from the authored choice sets. Undefined otherwise —
          // the historical skipped behavior is unchanged.
          arcTargets: this.episodeArcTargets.get(i),
          ...(() => {
            if (!this.episodeArcTargets.get(i)) return {};
            const simulated = simulateEpisodeArcDeltas(choiceSets);
            if (!simulated) return {};
            return {
              startIdentity: {},
              endIdentity: simulated.endIdentity,
              relationshipDeltas: simulated.relationshipDeltas,
            };
          })(),
          callbackLedger: this.callbackLedger.serialize(),
          // #26C: declared cast (ids AND display names — charactersInvolved mixes both forms).
          knownEntityIds: (characterBible.characters ?? []).flatMap((c) => [c.id, c.name]).filter(Boolean),
          // D4: planned (blueprint) choice scenes vs scenes that actually authored a choice.
          choicePlannedSceneIds: (blueprint.scenes ?? []).filter((s) => !s.isEncounter && s.choicePoint).map((s) => s.id),
          choiceAuthoredSceneIds: sceneContents.filter((sc) => (sc.beats ?? []).some((b) => ((b as GeneratedBeat & { choices?: unknown[] }).choices?.length ?? 0) > 0)).map((sc) => sc.sceneId),
        });
        narrativeDiagnosticsReport = narrativeDiagnostics;
        await saveEarlyDiagnostic(outputDirectory, `episode-${i}-narrative-diagnostics.json`, narrativeDiagnostics);
        const activeChecks = narrativeDiagnostics.checks
          .map((check) => `${check.name}:${check.status}${typeof check.score === 'number' ? `(${check.score})` : ''}`)
          .join(', ');
        this.emit({
          type: narrativeDiagnostics.overallStatus === 'passed' ? 'debug' : 'warning',
          phase: `episode_${i}_narrative_diagnostics`,
          message: `Narrative diagnostics ${narrativeDiagnostics.overallStatus}: ${activeChecks}`,
          data: narrativeDiagnostics,
        });
      } catch (diagErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_narrative_diagnostics`,
          message: `Narrative diagnostics failed (non-fatal): ${diagErr instanceof Error ? diagErr.message : String(diagErr)}`,
        });
      }

      // Bucket D: plan-time craft gates (opt-in, default OFF). The validators ran
      // advisory inside runNarrativeDiagnostics above (report unchanged); these only
      // HARD-BLOCK on error-severity findings when the per-rule flag is set. The gate
      // checks run OUTSIDE the diagnostics try/catch so a real gate failure propagates
      // as a PipelineError instead of being swallowed as a non-fatal warning. With the
      // flags unset, shouldGate returns gate:false → behavior is unchanged.
      // NOTE(de-@ts-nocheck): this block previously referenced out-of-scope
      // `brief`/`story` copied from generate(). The `brief` ReferenceError
      // killed runNarrativeDiagnostics above as a "non-fatal" warning, which
      // left narrativeDiagnosticsReport undefined and silently skipped every
      // plan-time gate in multi-episode runs. Fixed to baseBrief; the gate
      // shadow records pass storyId: undefined (no Story exists in this
      // scope — the season story is assembled later by the driver).
      if (narrativeDiagnosticsReport) {
        const isEnabled = isGateEnabled;
        const shadow = isShadowLoggingEnabled();
        // SHADOW-ONLY in the season path: before the scope fix above, these
        // gates could never fire here, so their default-ON promotion was
        // validated exclusively against single-episode shadow data (the
        // season fixture trips ConsequenceBudget immediately). Validation +
        // shadow records run with the real flags; blocking stays disabled
        // until a fresh multi-episode shadow pass proves the profile clean.
        const seasonGateEnforcement = () => false;
        const checkIssues = (name: NarrativeDiagnosticsReport['checks'][number]['name']) =>
          narrativeDiagnosticsReport.checks.find((c) => c.name === name)?.issues ?? [];

        const setupPayoffGate = shouldGate(PLAN_GATE_FLAGS.setupPayoff, checkIssues('setup_payoff'), seasonGateEnforcement);
        await this.recordPlanGateShadow(PLAN_GATE_FLAGS.setupPayoff, 'SetupPayoffValidator', setupPayoffGate.blockingCount, checkIssues('setup_payoff'), undefined);
        if (setupPayoffGate.gate) {
          const errs = checkIssues('setup_payoff').filter((iss) => iss.severity === 'error');
          // S3: record the hard block before throwing (best-effort).
          await this.recordRemediationSafe({
            rule: 'setup_payoff_gate', scope: 'episode', attempted: 1,
            succeeded: false, degraded: false, blocked: true, attempts: 1,
            storyId: undefined, details: `Setup/payoff gate blocked episode ${i}: ${setupPayoffGate.blockingCount} issue(s)`,
          });
          throw new PipelineError(
            `[SetupPayoffGate] Setup/payoff failed the blocking gate (${setupPayoffGate.blockingCount} issue(s)): ` +
              errs.map((iss) => iss.message).join('; ') +
              '. Unset GATE_SETUP_PAYOFF to downgrade to advisory.',
            `episode_${i}_setup_payoff_gate`,
            { context: { episode: i, blockingCount: setupPayoffGate.blockingCount } },
          );
        }

        // CallbackCoverage strict seam: the advisory diagnostics run emits only
        // warning/suggestion levels, so the gate would never fire on the report
        // issues. When the rollout flag is on, re-run the validator in STRICT
        // mode (a pure, deterministic, idempotent re-evaluation of the same
        // serialized ledger + episode) so a genuine coverage failure surfaces as
        // an 'error' that shouldGate can block on. The diagnostics report itself
        // stays advisory/unchanged — only the gate sees the strict issues. With
        // the flag OFF this branch is skipped and the historical report issues
        // are used, so default behavior is byte-for-byte unchanged.
        let callbackGateIssues: Array<{ severity: string; message?: string }> = checkIssues('callback_coverage');
        // Run the strict re-eval when the gate is on OR when shadow logging wants
        // the would-gate data. Pure/deterministic/idempotent — no LLM.
        if (isEnabled(PLAN_GATE_FLAGS.callbackCoverage) || shadow) {
          const strictResult = new CallbackCoverageValidator().validate(
            {
              ledger: this.callbackLedger.serialize(),
              currentEpisode: i,
              totalEpisodes: baseBrief.seasonPlan?.episodes?.length ?? i,
            },
            { strict: true },
          );
          callbackGateIssues = strictResult.issues.map((iss) => ({ severity: iss.level, message: iss.message }));
        }
        const callbackGate = shouldGate(PLAN_GATE_FLAGS.callbackCoverage, callbackGateIssues, seasonGateEnforcement);
        await this.recordPlanGateShadow(PLAN_GATE_FLAGS.callbackCoverage, 'CallbackCoverageValidator', callbackGate.blockingCount, callbackGateIssues, undefined);
        if (callbackGate.gate) {
          const errs = callbackGateIssues.filter((iss) => iss.severity === 'error');
          // S3: record the hard block before throwing (best-effort).
          await this.recordRemediationSafe({
            rule: 'callback_coverage_gate', scope: 'episode', attempted: 1,
            succeeded: false, degraded: false, blocked: true, attempts: 1,
            storyId: undefined, details: `Callback coverage gate blocked episode ${i}: ${callbackGate.blockingCount} issue(s)`,
          });
          throw new PipelineError(
            `[CallbackCoverageGate] Callback coverage failed the blocking gate (${callbackGate.blockingCount} issue(s)): ` +
              errs.map((iss) => iss.message).join('; ') +
              '. Unset GATE_CALLBACK_COVERAGE to downgrade to advisory.',
            `episode_${i}_callback_coverage_gate`,
            { context: { episode: i, blockingCount: callbackGate.blockingCount } },
          );
        }

        // ChoiceDensity gate (default OFF; GATE_CHOICE_DENSITY=1). The validator
        // emits 'error' only for the "zero choices" case; all genuine structural
        // (D4) and timing-cap violations are warning-level by default, so the
        // gate would never fire on them. When the flag is on we re-run the
        // validator in STRICT mode (a pure, deterministic re-eval of the same
        // beats/scenes) so those violations surface as 'error' for shouldGate.
        // With the flag OFF this branch is skipped entirely → behavior unchanged.
        if (isEnabled(PLAN_GATE_FLAGS.choiceDensity) || shadow) {
          const densityResult = await new ChoiceDensityValidator().validate(
            {
              beats: sceneContents.flatMap((sc) =>
                (sc.beats ?? []).map((b) => ({
                  id: b.id,
                  text: b.text ?? b.content ?? '',
                  isChoicePoint: ((b as GeneratedBeat & { choices?: unknown[] }).choices?.length ?? 0) > 0 || b.isChoicePoint,
                })),
              ),
              scenes: sceneContents.map((sc) => ({
                id: sc.sceneId,
                beats: (sc.beats ?? []).map((b) => ({
                  id: b.id,
                  text: b.text ?? b.content ?? '',
                  isChoicePoint: ((b as GeneratedBeat & { choices?: unknown[] }).choices?.length ?? 0) > 0 || b.isChoicePoint,
                })),
              })),
            },
            { strict: true },
          );
          const densityIssues = densityResult.issues.map((iss) => ({ severity: iss.level, message: iss.message }));
          const densityGate = shouldGate(PLAN_GATE_FLAGS.choiceDensity, densityIssues, seasonGateEnforcement);
          await this.recordPlanGateShadow(PLAN_GATE_FLAGS.choiceDensity, 'ChoiceDensityValidator', densityGate.blockingCount, densityIssues, undefined);
          if (densityGate.gate) {
            const errs = densityIssues.filter((iss) => iss.severity === 'error');
            await this.recordRemediationSafe({
              rule: 'choice_density_gate', scope: 'episode', attempted: 1,
              succeeded: false, degraded: false, blocked: true, attempts: 1,
              storyId: undefined, details: `Choice density gate blocked episode ${i}: ${densityGate.blockingCount} issue(s)`,
            });
            throw new PipelineError(
              `[ChoiceDensityGate] Choice density failed the blocking gate (${densityGate.blockingCount} issue(s)): ` +
                errs.map((iss) => iss.message).join('; ') +
                '. Unset GATE_CHOICE_DENSITY to downgrade to advisory.',
              `episode_${i}_choice_density_gate`,
              { context: { episode: i, blockingCount: densityGate.blockingCount } },
            );
          }
        }

        // ConsequenceBudget gate (default OFF; GATE_CONSEQUENCE_BUDGET=1). The
        // validator is advisory-only by default (suggestions/warnings); its
        // strictMode promotes extreme-deviation warnings to 'error'. We pass the
        // flag through explicitly so the gate sees those errors and shouldGate
        // can block. Choices carry their set's choiceType (it is per-set, not
        // per-choice). With the flag OFF this branch is skipped → behavior
        // unchanged.
        if (isEnabled(PLAN_GATE_FLAGS.consequenceBudget) || shadow) {
          const budgetResult = await new ConsequenceBudgetValidator().validate(
            {
              choices: choiceSets.flatMap((cs) =>
                (cs.choices ?? []).map((c) => ({
                  id: c.id,
                  choiceType: cs.choiceType,
                  consequences: c.consequences ?? [],
                })),
              ),
            },
            { strictMode: true },
          );
          const budgetIssues = budgetResult.issues.map((iss) => ({ severity: iss.level, message: iss.message }));
          const budgetGate = shouldGate(PLAN_GATE_FLAGS.consequenceBudget, budgetIssues, seasonGateEnforcement);
          await this.recordPlanGateShadow(PLAN_GATE_FLAGS.consequenceBudget, 'ConsequenceBudgetValidator', budgetGate.blockingCount, budgetIssues, undefined);
          if (budgetGate.gate) {
            const errs = budgetIssues.filter((iss) => iss.severity === 'error');
            await this.recordRemediationSafe({
              rule: 'consequence_budget_gate', scope: 'episode', attempted: 1,
              succeeded: false, degraded: false, blocked: true, attempts: 1,
              storyId: undefined, details: `Consequence budget gate blocked episode ${i}: ${budgetGate.blockingCount} issue(s)`,
            });
            throw new PipelineError(
              `[ConsequenceBudgetGate] Consequence budget failed the blocking gate (${budgetGate.blockingCount} issue(s)): ` +
                errs.map((iss) => iss.message).join('; ') +
                '. Unset GATE_CONSEQUENCE_BUDGET to downgrade to advisory.',
              `episode_${i}_consequence_budget_gate`,
              { context: { episode: i, blockingCount: budgetGate.blockingCount } },
            );
          }
        }

        // PropIntroduction gate (default OFF; GATE_PROP_INTRODUCTION=1). PARTIAL
        // gate (see propIntroductionGate.ts SCOPE NOTE): the deterministic
        // episode-level subset. Known entities = declared cast (ids + display
        // names) folded with every scene's declared introductions; references
        // come from each scene's charactersInvolved (the only per-scene entity
        // signal available at this seam — props are not yet a tracked field, so
        // unresolved-prop detection is deferred to a future SceneContent
        // .referencedEntityIds/.introducesEntityIds population). The validator
        // emits only warning-level issues today, so the gate fires only if it
        // begins emitting 'error' (shouldGate counts error-severity); with the
        // flag OFF this branch is skipped → behavior unchanged.
        if (isEnabled(PLAN_GATE_FLAGS.propIntroduction) || shadow) {
          const propInput = buildPropIntroductionInput(
            (characterBible.characters ?? []).flatMap((c) => [c.id, c.name]),
            sceneContents.map((sc) => ({
              sceneId: sc.sceneId,
              sceneName: sc.sceneName,
              referencedEntityIds: sc.charactersInvolved ?? [],
            })),
          );
          // strict: this block only runs when GATE_PROP_INTRODUCTION is set, so escalate
          // unresolved references to error-severity here so the gate can actually fire.
          const propResult = new PropIntroductionValidator().validate(propInput, { strict: true });
          const propIssues = propResult.issues.map((iss) => ({ severity: iss.severity, message: iss.message }));
          const propGate = shouldGate(PLAN_GATE_FLAGS.propIntroduction, propIssues, seasonGateEnforcement);
          await this.recordPlanGateShadow(PLAN_GATE_FLAGS.propIntroduction, 'PropIntroductionValidator', propGate.blockingCount, propIssues, undefined);
          if (propGate.gate) {
            // Wave 4 repair loop: resolve raw label->canonical-id references (the
            // witness-bug class) and re-validate before aborting. Genuinely-unknown
            // references are NOT rewritten, so a real dangling reference still blocks.
            const propRoster = (characterBible.characters ?? []).map((c) => ({ id: c.id, name: c.name }));
            const propRepairScenes = sceneContents
              .filter((sc) => Array.isArray(sc.charactersInvolved))
              .map((sc) => ({ sceneId: sc.sceneId, sceneName: sc.sceneName, referencedEntityIds: sc.charactersInvolved as string[] }));
            const propRepair = await repairAndRevalidatePropIntroduction(propRepairScenes, propRoster, {
              canSpend: () => shouldAttemptRemediation(this.remediationBudget),
            });
            for (const rec of propRepair.records) await this.recordRemediationSafe(rec);
            if (!propRepair.passed) {
              const errs = propIssues.filter((iss) => iss.severity === 'error');
              await this.recordRemediationSafe({
                rule: 'prop_introduction_gate', scope: 'episode', attempted: 1,
                succeeded: false, degraded: false, blocked: true, attempts: 1,
                storyId: undefined, details: `Prop introduction gate blocked episode ${i}: ${propGate.blockingCount} issue(s)`,
              });
              throw new PipelineError(
                `[PropIntroductionGate] Prop introduction failed the blocking gate (${propGate.blockingCount} unresolved reference(s)): ` +
                  errs.map((iss) => iss.message).join('; ') +
                  '. Unset GATE_PROP_INTRODUCTION to downgrade to advisory.',
                `episode_${i}_prop_introduction_gate`,
                { context: { episode: i, blockingCount: propGate.blockingCount } },
              );
            }
          }
        }
      }

      let imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> } | undefined;
      let encounterImageResults: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages: Map<string, Map<string, Map<string, string>>>; storyletFailures?: string[] } | undefined;
      let encounterImageDiagnostics: EncounterImageRunDiagnostic[] = [];
      if (this.config.imageGen?.enabled) {
        this.emit({ type: 'phase_start', phase: `images_ep_${i}`, message: `Generating visuals for Episode ${i}...` });
        try {
          if (this.useStoryboardV2ImagePipeline()) {
            const storyboardResult = await this.imageWorkerQueue.run(() =>
              this.measurePhase(
                `episode_${i}_storyboard_v2_images`,
                () => this.runStoryboardV2ImageGeneration(sceneContents, choiceSets, episodeBrief, characterBible, encounters, outputDirectory),
              )
            );
            imageResults = storyboardResult.imageResults;
            encounterImageResults = storyboardResult.encounterImageResults;
          } else {
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
          }
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

        if (!this.useStoryboardV2ImagePipeline() && encounters.size > 0) {
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
      this.validateMicroEpisodeStructure(episode, {
        phase: `episode_${i}_micro_episode_final_validation`,
      });

      // (Narrative diagnostics moved earlier — see the pre-image-gen block above. They used
      // to run here, after image generation, where an image-gen short-circuit silently
      // dropped them in every multi-episode run.)

      // Per-episode QA pass (mirrors Phase 5 from single-episode generate())
      let qaReport: QAReport | undefined;
      let bestPracticesReport: ComprehensiveValidationReport | undefined;
      if (episodeBrief.options?.runQA !== false) {
        try {
          this.emit({ type: 'phase_start', phase: `qa_ep_${i}`, message: `Running QA for Episode ${i}...` });
          const validationInput = this.prepareValidationInput(sceneContents, choiceSets, characterBible, encounters, blueprint);
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

      // A1: targeted, advisory continuity repair — in its OWN try so a QA-phase throw
      // (e.g. Gemini continuity-parse fragility) can no longer skip it. Runs whenever a
      // qaReport was produced, even if QA later threw.
      this.emit({ type: 'debug', phase: `continuity_repair_ep_${i}`, message: `Continuity repair gate: seasonCanonOn=${this.seasonCanonOn} hasQaReport=${!!qaReport}` });
      if (this.seasonCanonOn && qaReport) {
        try {
          // NOTE(de-@ts-nocheck): this call previously referenced an
          // out-of-scope `story` (a ReferenceError swallowed by this catch),
          // so multi-episode continuity repair never actually ran. The merge
          // walks story.episodes[].scenes[], so the assembled episode is
          // wrapped as a one-episode story; beat rewrites mutate `episode`
          // in place and flow into the season story downstream.
          await this.repairContinuityFindings({ episodes: [episode] } as unknown as Story, sceneContents, characterBible, qaReport, outputDirectory, blueprint);
        } catch (repairErr) {
          this.emit({ type: 'warning', phase: `continuity_repair_ep_${i}`, message: `Continuity repair failed (non-fatal): ${repairErr instanceof Error ? repairErr.message : String(repairErr)}` });
        }
      } else {
        // Reveal why the artifact never appears: write a skip diagnostic.
        await saveEarlyDiagnostic(outputDirectory, 'continuity-repair.json', {
          generatedAt: new Date().toISOString(),
          skipped: true,
          reason: !this.seasonCanonOn ? 'seasonCanon off' : 'no qaReport at repair site',
        }).catch(() => undefined);
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

  // Extracted to phases/MasterImagePhase.ts (pure move). Thin wrappers keep
  // all call sites unchanged: runMasterImageGeneration (single-episode +
  // multi-episode) and generateCharacterReferenceSheet (the
  // hydrate-or-generate resume paths). Run-scoped accumulators
  // (locationMasterShots, collected character references) are shared with
  // the phase by reference.
  private masterImagePhase(): MasterImagePhase {
    return new MasterImagePhase({
      imageAgentTeam: this.imageAgentTeam,
      imageService: this.imageService,
      checkCancellation: () => this.checkCancellation(),
      emitPhaseProgress: this.emitPhaseProgress.bind(this),
      hydrateReferenceSheetFromDisk: this.hydrateReferenceSheetFromDisk.bind(this),
      readCharacterMemory: this.readCharacterMemory.bind(this),
      writeCharacterMemory: this.writeCharacterMemory.bind(this),
      shouldAttachCompositeCharacterRefs: () => this.shouldAttachCompositeCharacterRefs(),
      locationMasterShots: this.locationMasterShots,
      characterReferences: this.collectedVisualPlanning.characterReferences,
    });
  }

  private async runMasterImageGeneration(
    characterBible: CharacterBible,
    worldBible: WorldBible,
    brief: FullCreativeBrief
  ): Promise<void> {
    return this.masterImagePhase().run(
      { characterBible, worldBible, brief },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  private async generateCharacterReferenceSheet(
    char: CharacterProfile,
    brief: FullCreativeBrief,
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedReferenceSheet | null> {
    return this.masterImagePhase().generateCharacterReferenceSheet(
      char,
      brief,
      userReferenceImages,
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
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
  private getEffectiveImagePromptMode(): 'deterministic' | 'llm' {
    return this.config.imageGen?.qa?.promptMode || 'llm';
  }

  private getEffectiveImageQaMode(): 'off' | 'fast' | 'full' {
    return this.config.imageGen?.qa?.qaMode || 'full';
  }

  private getEffectiveImagePlanningMode(): 'text' | 'visual-storyboard' {
    return normalizeImagePlanningMode(this.config.imageGen?.imagePlanningMode);
  }

  private getStoryboardMaxPanelsPerSheet(): number {
    const configured = this.config.imageGen?.storyboardV2?.maxPanelsPerSheet;
    if (!Number.isFinite(configured) || !configured) return 6;
    return Math.max(1, Math.min(12, Math.floor(configured)));
  }

  private async saveSceneVisualPlanningDiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    payload: Record<string, unknown>,
    options?: { suffix?: string },
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      const suffix = options?.suffix ? `.${options.suffix}` : '';
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${scopedSceneId}.visual-planning${suffix}.json`, {
        generatedAt: new Date().toISOString(),
        scopedSceneId,
        ...payload,
      });
    } catch (error) {
      this.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save visual planning diagnostic for ${scopedSceneId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private buildBeatSceneStoryboardPlan(params: {
    sceneId: string;
    scopedSceneId: string;
    sceneName: string;
    sceneDescription?: string;
    beats: Array<{ id: string; text?: string }>;
    visualPlan?: VisualPlan;
  }): SceneVisualStoryboardPlan {
    return buildSceneVisualStoryboardPlan({
      sceneId: params.sceneId,
      scopedSceneId: params.scopedSceneId,
      sceneName: params.sceneName,
      sceneDescription: params.sceneDescription,
      slots: visualPlanSlotsFromBeats(params.scopedSceneId, params.beats),
      panelCap: this.getStoryboardMaxPanelsPerSheet(),
      branchAware: false,
      continuityBible: (params.visualPlan as any)?.continuityBible,
      sequenceGrammar: (params.visualPlan as any)?.sequenceGrammar,
    });
  }

  private wrapLlmImagePromptWithContracts(
    prompt: ImagePrompt,
    input: import('../images/beatPromptBuilder').BeatPromptInput,
    sceneContext: import('../images/beatPromptBuilder').ScenePromptContext,
    characterNames: string[],
    promptMode: string,
    brief: FullCreativeBrief,
  ): ImagePrompt {
    const action = [
      input.visualMoment,
      input.primaryAction,
      input.emotionalRead,
      input.relationshipDynamic,
      input.mustShowDetail,
    ].filter(Boolean).join(' ');
    const contracted = applyPromptContract({
      ...prompt,
      style: sceneContext.artStyle || prompt.style,
      promptContract: {
        ...(prompt.promptContract || {}),
        sourcePromptMode: promptMode,
      },
    }, {
      style: sceneContext.artStyle || prompt.style || '',
      styleSource: this._uploadedStyleReferenceImages.length > 0 ? 'user-visual' : 'raw-season-style',
      mode: 'story-beat',
      characterIdentity: characterNames,
      appearanceState: input.characterVisualStates
        ? Object.entries(input.characterVisualStates).map(([name, state]) => `${name}: ${JSON.stringify(state)}`).join('; ')
        : undefined,
      sceneAction: action,
      composition: prompt.composition,
      negativeContract: prompt.negativePrompt,
      hasVisualStyleRef: this._uploadedStyleReferenceImages.length > 0,
      hasVisualCharacterRef: false,
    });
    return this.sanitizeImagePrompt(
      this.applyVisualContinuityAffordance(contracted, input.coveragePlan),
      brief,
    );
  }

  private applyVisualContinuityAffordance(
    prompt: ImagePrompt,
    coveragePlan?: import('../../types/content').BeatCoveragePlan,
  ): ImagePrompt {
    const continuity = coveragePlan?.visualContinuity;
    const mode = continuity?.mode || 'fresh_composition';
    const result: ImagePrompt = { ...prompt };

    if (mode === 'locked_micro_progression' && continuity?.changeOnly) {
      const preserve = continuity.preserve?.length
        ? continuity.preserve.join(', ')
        : 'camera, blocking, lighting, environment, character position';
      const directive = `VISUAL CONTINUITY AFFORDANCE: locked micro-progression. Preserve ${preserve}; ONLY visible change: ${continuity.changeOnly}. ${continuity.reason || ''}`.trim();
      result.prompt = [result.prompt, directive].filter(Boolean).join(' ');
      result.composition = [result.composition, directive].filter(Boolean).join(' ');
      return result;
    }

    const scrubLockedContinuity = (value: string | undefined): string | undefined => {
      if (!value) return value;
      return value
        .replace(/\bIDENTICAL camera angle\b/gi, 'motivated camera angle')
        .replace(/\bIDENTICAL environment\b/gi, 'recognizable environment continuity')
        .replace(/\bIDENTICAL lighting\b/gi, 'compatible lighting continuity')
        .replace(/\bSAME character position\b/gi, 'fresh character position')
        .replace(/\bsame angle, same environment, same character position\b/gi, 'fresh angle and blocking within the same story setting')
        .replace(/\bCamera angle MUST BE IDENTICAL:?\s*[^.!?\n]*/gi, 'Camera angle should change when it improves the beat')
        .replace(/\bCharacter position MUST BE IDENTICAL[^.!?\n]*/gi, 'Character position should be freshly blocked for this beat');
    };

    const directive = mode === 'preserve_scene_axis'
      ? 'VISUAL CONTINUITY AFFORDANCE: preserve the broad scene axis and spatial readability, but use fresh camera distance, focal point, pose, and blocking for this beat.'
      : 'VISUAL CONTINUITY AFFORDANCE: fresh composition is required. Do not repeat previous camera angle, character positions, blocking, or focal point; references and prior panels are continuity aids only.';
    result.prompt = [scrubLockedContinuity(result.prompt), directive].filter(Boolean).join(' ');
    result.composition = [scrubLockedContinuity(result.composition), directive].filter(Boolean).join(' ');
    result.shotDescription = scrubLockedContinuity(result.shotDescription);
    result.poseSpec = scrubLockedContinuity(result.poseSpec);
    result.negativePrompt = [
      result.negativePrompt,
      'repeated staging from previous image, same character positions as previous image, locked-off camera without explicit micro-progression',
    ].filter(Boolean).join(', ');
    return result;
  }

  private promptMentionsDisallowedCharacters(
    prompt: ImagePrompt,
    allowedCharacterNames: string[],
    allSceneCharacterNames: string[],
  ): string[] {
    const allowed = new Set(allowedCharacterNames.map(name => name.toLowerCase()));
    const text = [
      prompt.prompt,
      prompt.composition,
      prompt.visualNarrative,
      prompt.keyExpression,
      prompt.keyBodyLanguage,
      prompt.poseSpec,
    ].filter(Boolean).join('\n').toLowerCase();
    return allSceneCharacterNames
      .filter(name => !allowed.has(name.toLowerCase()))
      .filter(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
      });
  }

  private promptMissingRequiredCharacters(
    prompt: ImagePrompt,
    requiredCharacterNames: string[],
  ): string[] {
    const text = [
      prompt.prompt,
      prompt.composition,
      prompt.visualNarrative,
      prompt.keyExpression,
      prompt.keyBodyLanguage,
      prompt.poseSpec,
    ].filter(Boolean).join('\n').toLowerCase();
    return requiredCharacterNames.filter(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    });
  }

  private shouldRunHeroVisualQA(
    beat: any,
    beatIndex: number,
    totalBeats: number,
    qaMode: 'off' | 'fast' | 'full',
  ): boolean {
    if (qaMode === 'off') return false;
    if (qaMode === 'full') {
      return beatIndex === 0 ||
        beatIndex === totalBeats - 1 ||
        beat.isClimaxBeat === true ||
        beat.isKeyStoryBeat === true ||
        beat.isChoicePoint === true ||
        beat.isChoicePayoff === true;
    }
    return beat.isClimaxBeat === true || beat.isKeyStoryBeat === true || beat.isChoicePayoff === true;
  }

  private async saveSceneVisualQADiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    report: unknown,
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${scopedSceneId}.visual-qa.json`, {
        generatedAt: new Date().toISOString(),
        scopedSceneId,
        report,
      });
    } catch (error) {
      this.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save visual QA diagnostic for ${scopedSceneId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private serializeVisualQAReport(report: any): Record<string, unknown> {
    const mapToObject = (value: unknown) => value instanceof Map ? Object.fromEntries(value.entries()) : value;
    return {
      ...report,
      expressionReports: mapToObject(report?.expressionReports),
      bodyLanguageReports: mapToObject(report?.bodyLanguageReports),
      lightingColorReports: mapToObject(report?.lightingColorReports),
      visualStorytellingReports: mapToObject(report?.visualStorytellingReports),
    };
  }

  private async saveBeatVisualQADiagnostic(
    outputDirectory: string | undefined,
    identifier: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${identifier}.visual-qa.json`, {
        generatedAt: new Date().toISOString(),
        identifier,
        ...payload,
      });
    } catch (error) {
      this.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save beat visual QA diagnostic for ${identifier}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Extracted to phases/SceneImagePhase.ts (pure move, one documented
  // deviation: the phase binds the previously-undeclared `imagesDir` in the
  // disk-artifact beat-resume check — see the NOTE in SceneImagePhase). The
  // thin wrapper keeps all three call sites (single-episode generate,
  // multi-episode loop, image-resume) unchanged. Run-scoped mutable image
  // state (_generatedStyleReferencesAllowed, _preWarmedColorScriptPromise,
  // _uploadedStyleReferenceImages) is exposed via accessor properties so
  // writes on either side stay visible to both; _openingBeatPrefetch and
  // collectedVisualPlanning are shared by reference.
  private sceneImagePhase(): SceneImagePhase {
    const deps = {
      imageAgentTeam: this.imageAgentTeam,
      imageService: this.imageService,
      assetRegistry: this.assetRegistry,
      collectedVisualPlanning: this.collectedVisualPlanning,
      checkCancellation: () => this.checkCancellation(),
      _openingBeatPrefetch: this._openingBeatPrefetch,
      analyzeBeatCharacters: this.analyzeBeatCharacters.bind(this),
      applyThirdPersonRenderContract: this.applyThirdPersonRenderContract.bind(this),
      buildBeatSceneStoryboardPlan: this.buildBeatSceneStoryboardPlan.bind(this),
      buildCharacterDescriptions: this.buildCharacterDescriptions.bind(this),
      createSlotReferencePack: this.createSlotReferencePack.bind(this),
      ensureCharacterReferencesForVisibleCharacters: this.ensureCharacterReferencesForVisibleCharacters.bind(this),
      extractSceneContext: this.extractSceneContext.bind(this),
      findExistingImageArtifact: this.findExistingImageArtifact.bind(this),
      gatherCharacterBodyVocabularies: this.gatherCharacterBodyVocabularies.bind(this),
      gatherCharacterReferenceImages: this.gatherCharacterReferenceImages.bind(this),
      generateEpisodeColorScript: this.generateEpisodeColorScript.bind(this),
      generateEpisodeStyleBible: this.generateEpisodeStyleBible.bind(this),
      generateImageWithDefectRetries: this.generateImageWithDefectRetries.bind(this),
      getCharacterIdsInScene: this.getCharacterIdsInScene.bind(this),
      getEffectiveImagePlanningMode: () => this.getEffectiveImagePlanningMode(),
      getEffectiveImagePromptMode: () => this.getEffectiveImagePromptMode(),
      getEffectiveImageQaMode: () => this.getEffectiveImageQaMode(),
      getEpisodeScopedBeatKey: this.getEpisodeScopedBeatKey.bind(this),
      getEpisodeScopedSceneId: this.getEpisodeScopedSceneId.bind(this),
      getStoryboardMaxPanelsPerSheet: () => this.getStoryboardMaxPanelsPerSheet(),
      inferIntensity: this.inferIntensity.bind(this),
      inferValence: this.inferValence.bind(this),
      isEstablishingBeat: this.isEstablishingBeat.bind(this),
      isLlmQuotaFailure: this.isLlmQuotaFailure.bind(this),
      mapChoicePositions: this.mapChoicePositions.bind(this),
      mapSpeakerMoodToEmotion: this.mapSpeakerMoodToEmotion.bind(this),
      prefetchSceneOpeningBeats: this.prefetchSceneOpeningBeats.bind(this),
      promptMentionsDisallowedCharacters: this.promptMentionsDisallowedCharacters.bind(this),
      promptMissingRequiredCharacters: this.promptMissingRequiredCharacters.bind(this),
      reconcileOrphanedBeatImages: this.reconcileOrphanedBeatImages.bind(this),
      runLoraTrainingIfEligible: this.runLoraTrainingIfEligible.bind(this),
      sanitizeImagePrompt: this.sanitizeImagePrompt.bind(this),
      sanitizePromptText: this.sanitizePromptText.bind(this),
      saveBeatVisualQADiagnostic: this.saveBeatVisualQADiagnostic.bind(this),
      saveSceneVisualPlanningDiagnostic: this.saveSceneVisualPlanningDiagnostic.bind(this),
      saveSceneVisualQADiagnostic: this.saveSceneVisualQADiagnostic.bind(this),
      serializeVisualQAReport: this.serializeVisualQAReport.bind(this),
      shouldRunHeroVisualQA: this.shouldRunHeroVisualQA.bind(this),
      throwIfFailFast: this.throwIfFailFast.bind(this),
      withSettingAwarePrompt: this.withSettingAwarePrompt.bind(this),
      wrapLlmImagePromptWithContracts: this.wrapLlmImagePromptWithContracts.bind(this),
    } satisfies Partial<SceneImagePhaseDeps> as unknown as SceneImagePhaseDeps;
    // Accessor-backed mutable state: arrow getters/setters capture the
    // pipeline instance lexically, so reads/writes on either side of the
    // phase boundary stay visible to both.
    Object.defineProperties(deps, {
      _generatedStyleReferencesAllowed: {
        get: () => this._generatedStyleReferencesAllowed,
        set: (value) => { this._generatedStyleReferencesAllowed = value; },
      },
      _preWarmedColorScriptPromise: {
        get: () => this._preWarmedColorScriptPromise,
        set: (value) => { this._preWarmedColorScriptPromise = value; },
      },
      _uploadedStyleReferenceImages: {
        get: () => this._uploadedStyleReferenceImages,
      },
    });
    return new SceneImagePhase(deps);
  }

  private async runEpisodeImageGeneration(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    outputDirectory?: string,
    options?: { skipColorScriptAndStyleBible?: boolean; missingSlotIds?: string[] },
  ): Promise<{ beatImages: Map<string, string>; sceneImages: Map<string, string> }> {
    return this.sceneImagePhase().run(
      { sceneContents, choiceSets, brief, worldBible, characterBible, outputDirectory, options },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  /**
   * Run video generation for beats that have images.
   * Uses VideoDirectorAgent to generate animation instructions, then VideoGenerationService
   * to produce animated clips from still images via Veo.
   */
  // Extracted to phases/VideoPhase.ts (pure move). Thin wrapper keeps both
  // call sites (generate() video phase, runVideoOnly) unchanged.
  private async runVideoGeneration(
    sceneContents: SceneContent[],
    imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    brief: FullCreativeBrief,
    _worldBible: WorldBible
  ): Promise<{ videoResults: Map<string, string>; diagnostics: VideoGenerationDiagnostic[] }> {
    return new VideoPhase({
      videoService: this.videoService,
      videoDirectorAgent: this.videoDirectorAgent,
      checkCancellation: () => this.checkCancellation(),
      scopedSceneId: (sceneId) => this.getEpisodeScopedSceneId(brief, sceneId),
      scopedBeatKey: (sceneId, beatId) => this.getEpisodeScopedBeatKey(brief, sceneId, beatId),
    }).run(
      { sceneContents, imageResults, story: { genre: brief.story.genre, tone: brief.story.tone } },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  private async generateStoryCoverArt(
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    worldBible: WorldBible,
    outputDirectory?: string
  ): Promise<string | undefined> {
    return new CoverArtPhase({
      imageService: this.imageService,
      imageAgentTeam: this.imageAgentTeam,
      uploadedStyleReferenceImages: () => this._uploadedStyleReferenceImages,
      resolveProtagonistCharacterId: this.resolveProtagonistCharacterId.bind(this),
      resolveCharacterIdWithBrief: this.resolveCharacterIdWithBrief.bind(this),
      shouldAttachCompositeCharacterRefs: this.shouldAttachCompositeCharacterRefs.bind(this),
      generateImageWithDefectRetries: this.generateImageWithDefectRetries.bind(this),
      buildCharacterDescriptions: this.buildCharacterDescriptions.bind(this),
    }).run({ brief, characterBible, worldBible, outputDirectory }, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
  }

  private encounterImagePhase(): EncounterImagePhase {
    return new EncounterImagePhase({
      imageService: this.imageService,
      encounterImageAgent: this.encounterImageAgent,
      imageAgentTeam: this.imageAgentTeam,
      collectedVisualPlanning: this.collectedVisualPlanning,
      checkCancellation: () => this.checkCancellation(),
      buildCharacterDescriptions: this.buildCharacterDescriptions.bind(this),
      ensureCharacterReferencesForVisibleCharacters: this.ensureCharacterReferencesForVisibleCharacters.bind(this),
      gatherCharacterReferenceImages: this.gatherCharacterReferenceImages.bind(this),
      getEffectiveImagePlanningMode: () => this.getEffectiveImagePlanningMode(),
      getEffectiveImagePromptMode: () => this.getEffectiveImagePromptMode(),
      getEffectiveImageQaMode: () => this.getEffectiveImageQaMode(),
      getEpisodeScopedSceneId: this.getEpisodeScopedSceneId.bind(this),
      getStoryboardMaxPanelsPerSheet: () => this.getStoryboardMaxPanelsPerSheet(),
      isLlmQuotaFailure: this.isLlmQuotaFailure.bind(this),
      normalizeNarrativeText: this.normalizeNarrativeText.bind(this),
      resolvePlayerTemplates: this.resolvePlayerTemplates.bind(this),
      sanitizeImagePrompt: this.sanitizeImagePrompt.bind(this),
      saveSceneVisualPlanningDiagnostic: this.saveSceneVisualPlanningDiagnostic.bind(this),
      scrubPromptArtifacts: this.scrubPromptArtifacts.bind(this),
    });
  }

  /**
   * Generate images for encounter beats and outcomes
   * Creates setup images and outcome-specific images (success/complicated/failure) for each choice
   */
  // Extracted to phases/EncounterImagePhase.ts (pure move). Thin wrapper keeps
  // all three call sites (regenerate-images resume, runEpisodeForStoryBundle,
  // generate()) unchanged. wireEncounterTreeImages and the provider preflight
  // stay in the monolith with their callers.
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
    return this.encounterImagePhase().run(
      { encounters, characterBible, brief, outputDirectory },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
  }

  /**
   * Get character IDs present in a scene based on speakers and mentions
   */
  private getCharacterIdsInScene(scene: SceneContent, characterBible: CharacterBible, protagonistId?: string): string[] {
    const characterIds = new Set<string>();
    
    // ALWAYS include the protagonist — they are in every scene even if not explicitly named.
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
        const name = c.name.trim();
        if (!name) continue;
        const [firstName] = name.split(/\s+/).map(t => t.trim()).filter(Boolean);
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedFirstName = firstName?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mentioned = new RegExp(`\\b${escapedName}\\b`, 'i').test(text)
          || Boolean(firstName && firstName.length > 2 && escapedFirstName && new RegExp(`\\b${escapedFirstName}\\b`, 'i').test(text));
        if (mentioned) characterIds.add(c.id);
      }
    }
    
    return Array.from(characterIds);
  }

  private resolveCharacterId(idOrName: string, characterBible: CharacterBible): string | null {
    const raw = String(idOrName || '').trim();
    if (!raw) return null;
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/^char[-_]/, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const rawNorm = normalize(raw);
    const direct = characterBible.characters.find((c) => c.id === raw || c.name === raw);
    if (direct) return direct.id;
    const fuzzy = characterBible.characters.find((c) =>
      normalize(c.id) === rawNorm ||
      normalize(c.name) === rawNorm ||
      normalize(c.name).includes(rawNorm) ||
      rawNorm.includes(normalize(c.name))
    );
    return fuzzy?.id || null;
  }

  private resolveProtagonistCharacterId(characterBible: CharacterBible, brief: FullCreativeBrief): string | null {
    const byRole = characterBible.characters.find((c: any) =>
      /\b(protagonist|main character|player character)\b/i.test(String(c.role || c.archetype || ''))
    );
    if (byRole?.id) return byRole.id;

    const briefName = String(brief.protagonist?.name || '').trim();
    if (briefName && !/^hero$/i.test(briefName)) {
      const byBriefName = this.resolveCharacterId(briefName, characterBible);
      if (byBriefName) return byBriefName;
    }

    const briefId = String(brief.protagonist?.id || '').trim();
    if (briefId && !/^p(?:rotagonist)?[-_ ]?1$/i.test(briefId) && !/^hero$/i.test(briefId)) {
      const byBriefId = this.resolveCharacterId(briefId, characterBible);
      if (byBriefId) return byBriefId;
    }

    return characterBible.characters[0]?.id || null;
  }

  private resolveCharacterIdWithBrief(idOrName: string, characterBible: CharacterBible, brief: FullCreativeBrief): string | null {
    const raw = String(idOrName || '').trim();
    if (!raw) return null;
    if (/^p(?:rotagonist)?[-_ ]?1$/i.test(raw) || /^player$/i.test(raw) || /^hero$/i.test(raw)) {
      return this.resolveProtagonistCharacterId(characterBible, brief)
        || this.resolveCharacterId(brief.protagonist?.name || brief.protagonist?.id || raw, characterBible);
    }
    return this.resolveCharacterId(raw, characterBible);
  }

  private normalizeCharacterIds(ids: string[] | undefined, characterBible: CharacterBible): string[] {
    const normalized = new Set<string>();
    for (const value of ids || []) {
      const resolved = this.resolveCharacterId(value, characterBible);
      if (resolved) normalized.add(resolved);
    }
    return [...normalized];
  }

  private async ensureCharacterReferencesForVisibleCharacters(
    ids: string[] | undefined,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    contextLabel: string,
  ): Promise<string[]> {
    const attemptedLookup = [...(ids || [])];
    const characterIds = Array.from(new Set(
      attemptedLookup
        .map((id) => this.resolveCharacterIdWithBrief(id, characterBible, brief))
        .filter((id): id is string => Boolean(id))
    ));
    if (
      characterIds.length === 0 ||
      this.config.imageGen?.requireCharacterRefsForVisibleCharacters === false ||
      this.config.imageGen?.enabled === false
    ) {
      return characterIds;
    }

    const missing = characterIds.filter((id) => !this.imageAgentTeam.hasReferenceSheet(id));
    if (missing.length > 0) {
      for (const id of missing) {
        const char = characterBible.characters.find((c) => c.id === id);
        if (char) await this.hydrateReferenceSheetFromDisk(char);
      }
    }
    const stillMissing = characterIds.filter((id) => !this.imageAgentTeam.hasReferenceSheet(id));
    if (stillMissing.length === 0) return characterIds;

    this.emit({
      type: 'warning',
      phase: 'images',
      message: `Character continuity refs missing for ${contextLabel}: ${stillMissing
        .map((id) => characterBible.characters.find((c) => c.id === id)?.name || id)
        .join(', ')}. Generating references before story images continue. Lookup inputs: ${attemptedLookup.join(', ') || 'none'}.`,
      data: { contextLabel, attemptedLookup, resolvedCharacterIds: characterIds, missing: stillMissing },
    });

    for (const id of stillMissing) {
      const char = characterBible.characters.find((c) => c.id === id);
      if (!char) continue;
      await this.generateCharacterReferenceSheet(char, brief);
      const fingerprint = computeCharacterIdentityFingerprint(char);
      this.imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, fingerprint);
      if (!this.imageAgentTeam.hasReferenceSheet(char.id)) {
        const msg = `Character continuity refs still missing for ${char.name} after reference generation (${contextLabel}).`;
        this.emit({ type: 'error', phase: 'images', message: msg });
        if (this.config.imageGen?.allowTextOnlyCharacterImages !== true) {
          throw new PipelineError(msg, 'images', {
            agent: 'ImageAgentTeam',
            context: { characterId: char.id, characterName: char.name, contextLabel, failureKind: 'missing_character_reference' },
          });
        }
      }
    }

    return characterIds;
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

  private resolveGeneratedStoryPlayerTemplates(story: Story, brief: FullCreativeBrief): Story {
    const resolution = resolvePlayerTemplatesInObject(story, {
      name: brief.protagonist.name,
      pronouns: brief.protagonist.pronouns,
    });
    if (resolution.replacements > 0) {
      this.emit({
        type: 'warning',
        phase: 'assembly',
        message: `Resolved ${resolution.replacements} protagonist template token(s) before saving story output.`,
      });
      console.warn(`[Pipeline] Resolved ${resolution.replacements} protagonist template token(s) before saving story output.`);
    }
    return resolution.value;
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

  private applyThirdPersonRenderContract(
    prompt: ImagePrompt,
    storyboardShot?: VisualStoryboardPacket['shots'][number],
    options?: { isEnvironmentShot?: boolean },
  ): ImagePrompt {
    const thirdPersonContract = 'CAMERA POV CONTRACT: Render this as a third-person observer shot outside every character. Never use first-person/player-eye POV, disembodied hands, "your hand" framing, or a camera inside the protagonist body.';
    const environmentStyleContract = options?.isEnvironmentShot
      ? 'ENVIRONMENT STYLE LOCK: Render all backgrounds and architecture as stylized cartoon/graphic environment design matching the character finish: simplified designed shapes, clean illustrated edges, curated flat/cel color, non-photographic lighting, no real-estate photo look, no architectural visualization, no HDR interior realism, no live-action location still.'
      : '';
    const storyboardContract = storyboardShot ? [
      'VISUAL STORYBOARD PACKET:',
      `Sequence role: ${storyboardShot.sequenceRole}.`,
      `Shot: ${storyboardShot.shotSize}, ${storyboardShot.cameraAngle}, ${storyboardShot.cameraHeight} height, ${storyboardShot.cameraSide} side.`,
      `POV mode: ${storyboardShot.thirdPersonPov}.`,
      `Required visible cast: ${(storyboardShot.requiredVisibleCharacterIds || []).join(', ') || 'none'}.`,
      `Optional/background cast: ${(storyboardShot.optionalBackgroundCharacterIds || []).join(', ') || 'none'}.`,
      `Explicitly offscreen: ${(storyboardShot.offscreenCharacterIds || []).join(', ') || 'none'}.`,
      `Shot action: ${storyboardShot.promptFields?.action || ''}`,
      storyboardShot.promptFields?.emotionalRead ? `Emotional read: ${storyboardShot.promptFields.emotionalRead}` : '',
      storyboardShot.promptFields?.keyDetail ? `Key detail: ${storyboardShot.promptFields.keyDetail}` : '',
      storyboardShot.continuityFrom ? `Continuity from previous shot: ${storyboardShot.continuityFrom}` : '',
      `Dramatic reason: ${storyboardShot.dramaticReason || 'story beat progression'}.`,
    ].filter(Boolean).join(' ') : '';
    const environmentNegatives = options?.isEnvironmentShot
      ? 'environment style drift, unapproved location renderer, background finish that contradicts the style contract'
      : '';
    const negativeAdditions = ['first-person POV, player-eye view, POV hands, disembodied hands, your hand, your hands, selfie angle, style drift, unapproved renderer', environmentNegatives].filter(Boolean).join(', ');
    return {
      ...prompt,
      prompt: [prompt.prompt, thirdPersonContract, environmentStyleContract, storyboardContract].filter(Boolean).join('\n\n'),
      composition: [prompt.composition, thirdPersonContract, environmentStyleContract].filter(Boolean).join(' '),
      negativePrompt: [prompt.negativePrompt, negativeAdditions].filter(Boolean).join(', '),
    };
  }

  private createSlotReferencePack(slotId: string, references: unknown[] | undefined): SlotReferencePack | undefined {
    const refs = Array.isArray(references) ? references.filter(Boolean) as any[] : [];
    if (refs.length === 0) return undefined;
    return {
      slotId,
      totalCount: refs.length,
      references: refs,
      summary: refs.map((ref) => ({
        role: ref.role || 'reference',
        characterName: ref.characterName,
        viewType: ref.viewType,
      })),
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
    return resolvePlayerTemplatesInObject(text || '', {
      name: brief.protagonist?.name || 'Protagonist',
      pronouns: brief.protagonist?.pronouns || 'they/them',
    }).value;
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

  private buildCharacterDescriptions(
    characterIds: string[],
    characterBible: CharacterBible
  ): CharacterAppearanceDescription[] {
    const descs: CharacterAppearanceDescription[] = [];
    for (const charId of this.normalizeCharacterIds(characterIds, characterBible)) {
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
      if (consistencyInfo?.visualAnchors?.length) {
        parts.push(consistencyInfo.visualAnchors.map(anchor => sanitizeStyleContaminationText(anchor).text).join(', '));
      } else if (hasSilhouette) {
        parts.push(silhouette!.silhouetteHooks!.map(hook => sanitizeStyleContaminationText(hook).text).join(', '));
      } else if (c.physicalDescription) {
        parts.push(sanitizeStyleContaminationText(c.physicalDescription).text);
      }
      if (c.distinctiveFeatures && c.distinctiveFeatures.length > 0) {
        parts.push(`Distinctive features: ${c.distinctiveFeatures.map(feature => sanitizeStyleContaminationText(feature).text).join(', ')}`);
      }
      if (c.typicalAttire) parts.push(`Attire: ${sanitizeStyleContaminationText(c.typicalAttire).text}`);
      const fashionSummary = buildFashionStyleSummary(c.fashionStyle);
      if (fashionSummary) parts.push(`Fashion details: ${sanitizeStyleContaminationText(fashionSummary).text}`);

      // Build a structured canonicalAppearance by extracting semantic slots
      // from the free-form description sources. Each slot becomes its own
      // labeled line in the identity block, which dramatically reduces the
      // LLM's tendency to drop or paraphrase critical attributes (hair color,
      // eye color, distinguishing marks).
      const sources: string[] = [
        ...(consistencyInfo?.visualAnchors || []),
        ...(silhouette?.silhouetteHooks || []),
        c.physicalDescription || '',
      ].filter(Boolean);
      const canonicalAppearance = this.extractCanonicalAppearance(
        sources,
        c.distinctiveFeatures,
        [c.typicalAttire, fashionSummary].filter(Boolean).join('; ') || undefined,
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
    
    const normalizedCharacterIds = this.normalizeCharacterIds(characterIds, characterBible);

    for (const charId of normalizedCharacterIds) {
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

      // Emit the composite model sheet only for providers that explicitly use
      // it as the scene identity anchor. In particular, GPT Image 2 should not
      // receive or even collect cached multi-view/composite sheets.
      if (this.shouldAttachCompositeCharacterRefs() && references.length < MAX_TOTAL_REFS) {
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

    const styleAnchorPaths = [
      { role: 'style-anchor-character', imagePath: this._styleAnchorPaths.character },
      { role: 'style-anchor-arc-strip', imagePath: this._styleAnchorPaths.arcStrip },
      { role: 'style-anchor-environment', imagePath: this._styleAnchorPaths.environment },
    ].filter((entry) => !!entry.imagePath);
    for (const anchor of styleAnchorPaths) {
      if (references.length >= MAX_TOTAL_REFS) break;
      try {
        const fs = require('fs');
        if (!fs.existsSync(anchor.imagePath)) continue;
        const ext = String(anchor.imagePath).split('.').pop()?.toLowerCase();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        references.push({
          data: fs.readFileSync(anchor.imagePath).toString('base64'),
          mimeType,
          role: anchor.role,
          characterName: '',
          viewType: 'style',
        });
      } catch { /* style anchors are helpful but non-fatal */ }
    }

    for (const styleRef of this._uploadedStyleReferenceImages) {
      if (references.length >= MAX_TOTAL_REFS) break;
      references.push(styleRef as any);
    }
    
    const family = options?.family;
    if (!family) {
      return references;
    }

    // D3: derive per-character weights from their bible importance. Weights
    // are multiplied against the profile's maxPerCharacter so major characters
    // get more ref-pack slots than supporting/minor ones.
    const characterWeights: Record<string, number> = {};
    for (const charId of normalizedCharacterIds) {
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
    ).references as unknown as Awaited<ReturnType<FullStoryPipeline['gatherCharacterReferenceImages']>>;
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
   * skipped cleanly.
   */
  private getUnresolvedCallbacksForPrompt(
    episodeNumber: number | undefined,
  ): UnresolvedCallbackForPrompt[] | undefined {
    return getUnresolvedCallbacksForPromptImpl(this.callbackLedger, episodeNumber);
  }

  /**
   * Harvest callback state from a just-generated episode: seed new hooks
   * from `memorableMoment` choice fields, and record payoffs for any
   * TextVariants that reference an existing hook id.
   */
  private harvestEpisodeCallbacks(
    params: HarvestEpisodeCallbacksParams,
  ): { newHooks: number; payoffs: number } {
    return harvestEpisodeCallbacksImpl(this.callbackLedger, params);
  }

  private injectFallbackCallbacks(
    params: InjectFallbackCallbacksParams,
  ): { injected: number } {
    return injectFallbackCallbacksImpl(this.callbackLedger, params);
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
              prompt, `${identifier}_preview_${attempt}`, metadata as unknown as Parameters<ImageGenerationService['generateImage']>[2], referenceImages as unknown as Parameters<ImageGenerationService['generateImage']>[3]
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
          metadata as unknown as Parameters<ImageGenerationService['generateImage']>[2],
          referenceImages as unknown as Parameters<ImageGenerationService['generateImage']>[3]
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

  private _imageSupport?: ImageSupport;

  /**
   * Memoized image-support cluster (defect-retry rendering, style-bible
   * anchors, LoRA training, opening-beat prefetch) — see pipeline/imageSupport.ts.
   * Run-scoped state stays on this instance and is shared by reference.
   */
  private imageSupport(): ImageSupport {
    if (!this._imageSupport) {
      this._imageSupport = new ImageSupport({
        config: this.config,
        emit: this.emit.bind(this),
        imageService: this.imageService,
        imageAgentTeam: this.imageAgentTeam,
        assetRegistry: this.assetRegistry,
        totalEpisodes: () => this.totalEpisodes,
        styleAnchorPaths: this._styleAnchorPaths,
        openingBeatPrefetch: this._openingBeatPrefetch,
        setUploadedStyleReferenceImages: (refs) => { this._uploadedStyleReferenceImages = refs; },
        setGeneratedStyleReferencesAllowed: (allowed) => { this._generatedStyleReferencesAllowed = allowed; },
        resolveProtagonistCharacterId: this.resolveProtagonistCharacterId.bind(this),
        resolveCharacterIdWithBrief: this.resolveCharacterIdWithBrief.bind(this),
        gatherCharacterReferenceImages: this.gatherCharacterReferenceImages.bind(this),
        buildCharacterDescriptions: this.buildCharacterDescriptions.bind(this),
        ensureCharacterReferencesForVisibleCharacters: this.ensureCharacterReferencesForVisibleCharacters.bind(this),
        getCharacterIdsInScene: this.getCharacterIdsInScene.bind(this),
        extractSceneContext: this.extractSceneContext.bind(this),
        analyzeBeatCharacters: this.analyzeBeatCharacters.bind(this),
        isEstablishingBeat: this.isEstablishingBeat.bind(this),
        sanitizePromptText: this.sanitizePromptText.bind(this),
        sanitizeImagePrompt: this.sanitizeImagePrompt.bind(this),
        getEpisodeScopedSceneId: this.getEpisodeScopedSceneId.bind(this),
      });
    }
    return this._imageSupport;
  }

  private _assembly?: Assembly;

  /**
   * Memoized story/episode assembly cluster — see pipeline/assembly.ts. The
   * run-scoped style anchor paths are shared by reference; all other helpers
   * (fidelity text, choice-bridge beats, reader sanitization, episode-scoped
   * keys, encounter-tree image wiring, micro-episode validations) are bound.
   */
  private assembly(): Assembly {
    if (!this._assembly) {
      this._assembly = new Assembly({
        config: this.config,
        emit: this.emit.bind(this),
        throwIfFailFast: this.throwIfFailFast.bind(this),
        imageAgentTeam: this.imageAgentTeam,
        styleAnchorPaths: this._styleAnchorPaths,
        buildPersistedNpc: this.buildPersistedNpc.bind(this),
        ensureBlueprintFidelityText: this.ensureBlueprintFidelityText.bind(this),
        ensureChoiceBridgeBeats: this.ensureChoiceBridgeBeats.bind(this),
        getEpisodeScopedBeatKey: this.getEpisodeScopedBeatKey.bind(this),
        getEpisodeScopedSceneId: this.getEpisodeScopedSceneId.bind(this),
        sanitizeReaderFacingSceneName: this.sanitizeReaderFacingSceneName.bind(this),
        sanitizeSceneContentForReader: this.sanitizeSceneContentForReader.bind(this),
        validateMicroEpisodeSeason: this.validateMicroEpisodeSeason.bind(this),
        validateMicroEpisodeStructure: this.validateMicroEpisodeStructure.bind(this),
        wireEncounterTreeImages: this.wireEncounterTreeImages.bind(this),
      });
    }
    return this._assembly;
  }

  private _finalContract?: FinalContract;

  /**
   * Memoized final-contract cluster (enforceFinalStoryContract,
   * prepareValidationInput, runFlagChronologyScan) — see
   * pipeline/finalContract.ts. Run-scoped accumulators (scene-validation
   * results, season plans, encounter telemetry, remediation budget) are read
   * lazily via Object.defineProperties so the contract sees current values.
   */
  private finalContract(): FinalContract {
    if (!this._finalContract) {
      const deps = {
        config: this.config,
        emit: this.emit.bind(this),
        recordRemediationSafe: this.recordRemediationSafe.bind(this),
        recordFinalContractShadow: this.recordFinalContractShadow.bind(this),
        disambiguateProtagonistPronouns: this.disambiguateProtagonistPronouns.bind(this),
        authorEncounterOutcomeVariants: this.authorEncounterOutcomeVariants.bind(this),
        relationshipDimensionsForNpc: this.relationshipDimensionsForNpc.bind(this),
      } satisfies Partial<FinalContractDeps> as unknown as FinalContractDeps;
      Object.defineProperties(deps, {
        allSceneValidationResults: { get: () => this.allSceneValidationResults },
        sceneValidationResults: { get: () => this.sceneValidationResults },
        seasonChoicePlan: { get: () => this.seasonChoicePlan },
        seasonSkillPlan: { get: () => this.seasonSkillPlan },
        allEncounterTelemetry: { get: () => this.allEncounterTelemetry },
        remediationBudget: { get: () => this.remediationBudget },
        sceneCritic: { get: () => this.sceneCritic ?? null },
      });
      this._finalContract = new FinalContract(deps);
    }
    return this._finalContract;
  }

  private _sceneCriticContinuity?: SceneCriticContinuity;

  /**
   * Memoized SceneCritic rewrite + continuity-repair cluster — see
   * pipeline/sceneCriticContinuity.ts. sceneCritic is read lazily (it may be
   * constructed after this accessor first runs).
   */
  private sceneCriticContinuity(): SceneCriticContinuity {
    if (!this._sceneCriticContinuity) {
      const deps = {
        config: this.config,
        emit: this.emit.bind(this),
        buildContinuityCharacterKnowledge: this.buildContinuityCharacterKnowledge.bind(this),
        buildContinuityTimeline: this.buildContinuityTimeline.bind(this),
      } satisfies Partial<SceneCriticContinuityDeps> as unknown as SceneCriticContinuityDeps;
      Object.defineProperties(deps, {
        sceneCritic: { get: () => this.sceneCritic ?? null },
      });
      this._sceneCriticContinuity = new SceneCriticContinuity(deps);
    }
    return this._sceneCriticContinuity;
  }

  private _sceneGraphValidation?: SceneGraphValidation;

  /**
   * Memoized scene-graph branching validation + repair cluster — see
   * pipeline/sceneGraphValidation.ts. Validator/agent instances and run-scoped
   * reads are injected so config/telemetry stay shared with the run.
   */
  private sceneGraphValidation(): SceneGraphValidation {
    if (!this._sceneGraphValidation) {
      const deps = {
        config: this.config,
        emit: this.emit.bind(this),
        recordGateShadowSafe: this.recordGateShadowSafe.bind(this),
        throwIfFailFast: this.throwIfFailFast.bind(this),
        sceneGraphBranchValidator: this.sceneGraphBranchValidator,
        duplicateEstablishingBeatValidator: this.duplicateEstablishingBeatValidator,
        treatmentSeedOnPageValidator: this.treatmentSeedOnPageValidator,
        endingReachabilityValidator: this.endingReachabilityValidator,
        choiceAuthor: this.choiceAuthor,
        assembleEpisode: this.assembleEpisode.bind(this),
        buildChoiceAuthorNpcs: this.buildChoiceAuthorNpcs.bind(this),
        buildCompactWorldContext: this.buildCompactWorldContext.bind(this),
        deriveStoryVerbsForBrief: this.deriveStoryVerbsForBrief.bind(this),
        getUnresolvedCallbacksForPrompt: this.getUnresolvedCallbacksForPrompt.bind(this),
        resolveWorldLocationForScene: this.resolveWorldLocationForScene.bind(this),
      } satisfies Partial<SceneGraphValidationDeps> as unknown as SceneGraphValidationDeps;
      // sceneCritic may be constructed after this accessor first runs, and
      // cachedPipelineMemory is set once memory loads — read both lazily.
      Object.defineProperties(deps, {
        sceneCritic: { get: () => this.sceneCritic ?? null },
        cachedPipelineMemory: { get: () => this.cachedPipelineMemory },
      });
      this._sceneGraphValidation = new SceneGraphValidation(deps);
    }
    return this._sceneGraphValidation;
  }

  private _draftImageEntry?: DraftImageEntry;

  /**
   * Memoized draft-image entry helpers (resume scan, manifest builder, bound-
   * reference repair) — see pipeline/draftImageEntry.ts. Deterministic; the
   * image-resume internals it leans on stay on this instance.
   */
  private draftImageEntry(): DraftImageEntry {
    if (!this._draftImageEntry) {
      this._draftImageEntry = new DraftImageEntry({
        config: this.config,
        assetRegistry: this.assetRegistry,
        setActiveImageResumeOutputDirectory: (dir) => { this._activeImageResumeOutputDirectory = dir; },
        loadAssetRegistryForImageResume: this.loadAssetRegistryForImageResume.bind(this),
        hydrateReferenceSheetsFromExistingImages: this.hydrateReferenceSheetsFromExistingImages.bind(this),
        preflightResumeReferenceSheets: this.preflightResumeReferenceSheets.bind(this),
        hydrateStyleAnchorsFromExistingImages: this.hydrateStyleAnchorsFromExistingImages.bind(this),
        sceneContentFromStoryScene: this.sceneContentFromStoryScene.bind(this),
        createEncounterRegistrySlot: this.createEncounterRegistrySlot.bind(this),
        markSlotFromExistingArtifact: this.markSlotFromExistingArtifact.bind(this),
      });
    }
    return this._draftImageEntry;
  }

  private _draftImageGeneration?: DraftImageGeneration;

  /**
   * Memoized draft-image generation cluster (generateImagesForDraft,
   * generateTargetedBeatImagesForDraft) — see pipeline/draftImageGeneration.ts.
   * Run-scoped state (config, services, asset registry) is read lazily via
   * Object.defineProperties; the fields these entry points reset (events,
   * checkpoints, telemetry, pipelineStartedAtMs, completedPhases) carry live
   * setters so the cluster writes back to the run.
   */
  private draftImageGeneration(): DraftImageGeneration {
    if (!this._draftImageGeneration) {
      const deps = {
        emit: this.emit.bind(this),
        resetCollectedVisualPlanning: this.resetCollectedVisualPlanning.bind(this),
        hydrateSeasonImageStyleFromStoryPackage: this.hydrateSeasonImageStyleFromStoryPackage.bind(this),
        applyActiveImageStyleToRuntime: this.applyActiveImageStyleToRuntime.bind(this),
        loadContinuationStory: this.loadContinuationStory.bind(this),
        saveDraftImageManifest: this.saveDraftImageManifest.bind(this),
        scanExistingImagesForResume: this.scanExistingImagesForResume.bind(this),
        checkCancellation: this.checkCancellation.bind(this),
        sceneContentFromStoryScene: this.sceneContentFromStoryScene.bind(this),
        useStoryboardV2ImagePipeline: this.useStoryboardV2ImagePipeline.bind(this),
        measurePhase: this.measurePhase.bind(this),
        runStoryboardV2ImageGeneration: this.runStoryboardV2ImageGeneration.bind(this),
        runEpisodeImageGeneration: this.runEpisodeImageGeneration.bind(this),
        runEncounterProviderPreflight: this.runEncounterProviderPreflight.bind(this),
        generateEncounterImages: this.generateEncounterImages.bind(this),
        toEncounterRunDiagnostics: this.toEncounterRunDiagnostics.bind(this),
        seedAssetRegistryFromResults: this.seedAssetRegistryFromResults.bind(this),
        generateStoryCoverArt: this.generateStoryCoverArt.bind(this),
        resolveGeneratedStoryPlayerTemplates: this.resolveGeneratedStoryPlayerTemplates.bind(this),
        auditStoryVisualContractPersistence: this.auditStoryVisualContractPersistence.bind(this),
        repairBoundImageReferences: this.repairBoundImageReferences.bind(this),
        buildImageManifestFromStory: this.buildImageManifestFromStory.bind(this),
        validateMicroEpisodeSeason: this.validateMicroEpisodeSeason.bind(this),
        getCollectedVisualPlanningForSave: this.getCollectedVisualPlanningForSave.bind(this),
        buildStoryGeneratorMetadata: this.buildStoryGeneratorMetadata.bind(this),
        getRemediationSummary: this.getRemediationSummary.bind(this),
        finalizeImageRunFromRegistry: this.finalizeImageRunFromRegistry.bind(this),
        servedUrlForGeneratedImagePath: this.servedUrlForGeneratedImagePath.bind(this),
      } satisfies Partial<DraftImageGenerationDeps> as unknown as DraftImageGenerationDeps;
      Object.defineProperties(deps, {
        config: { get: () => this.config },
        imageService: { get: () => this.imageService },
        imageWorkerQueue: { get: () => this.imageWorkerQueue },
        assetRegistry: { get: () => this.assetRegistry },
        events: { get: () => this.events, set: (value: PipelineEvent[]) => { this.events = value; } },
        checkpoints: { get: () => this.checkpoints, set: (value: CheckpointData[]) => { this.checkpoints = value; } },
        telemetry: { get: () => this.telemetry, set: (value: PipelineTelemetry) => { this.telemetry = value; } },
        pipelineStartedAtMs: { get: () => this.pipelineStartedAtMs, set: (value: number) => { this.pipelineStartedAtMs = value; } },
        completedPhases: { get: () => this.completedPhases, set: (value: Set<string>) => { this.completedPhases = value; } },
      });
      this._draftImageGeneration = new DraftImageGeneration(deps);
    }
    return this._draftImageGeneration;
  }

  private async generateEpisodeStyleBible(
    brief: FullCreativeBrief,
    colorScript: ColorScript,
    characterBible: CharacterBible,
    outputDirectory?: string
  ): Promise<boolean> {
    return this.imageSupport().generateEpisodeStyleBible(brief, colorScript, characterBible, outputDirectory);
  }

  private async generateImageWithDefectRetries(
    prompt: ImagePrompt,
    identifier: string,
    metadata: any,
    referenceImages: any[] | undefined,
    label: string,
    outputDirectory?: string,
    renderImage?: (activePrompt: ImagePrompt, attemptIdentifier: string, attemptMetadata: any, attemptReferences: any[] | undefined) => Promise<GeneratedImage>,
  ): Promise<GeneratedImage> {
    return this.imageSupport().generateImageWithDefectRetries(prompt, identifier, metadata, referenceImages, label, outputDirectory, renderImage);
  }

  private async runLoraTrainingIfEligible(
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    outputDirectory?: string,
  ): Promise<void> {
    return this.imageSupport().runLoraTrainingIfEligible(brief, characterBible, outputDirectory);
  }

  private async prefetchSceneOpeningBeats(
    sceneContents: SceneContent[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    colorScript: ColorScript | undefined,
    worldBible: WorldBible,
    outputDirectory?: string,
  ): Promise<void> {
    return this.imageSupport().prefetchSceneOpeningBeats(sceneContents, brief, characterBible, colorScript, worldBible, outputDirectory);
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

  private ensureChoiceBridgeBeats(
    blueprint: EpisodeBlueprint,
    sceneBlueprint: SceneBlueprint,
    content: SceneContent,
    choiceMap: Map<string, ChoiceSet>,
  ): void {
    for (const beat of content.beats || []) {
      if (!beat.isChoicePoint) continue;
      const choiceSet = choiceMap.get(`${sceneBlueprint.id}::${beat.id}`) || choiceMap.get(beat.id);
      if (!choiceSet) continue;

      for (const choice of choiceSet.choices || []) {
        const targetSceneId = choice.nextSceneId;
        if (!targetSceneId) continue;

        const targetScene = blueprint.scenes.find(scene => scene.id === targetSceneId);
        const bridgeId = `${beat.id}-bridge-${String(choice.id || 'choice')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'choice'}`;

        const readerTargetName = this.sanitizeReaderFacingSceneName(targetScene?.name || targetSceneId, targetSceneId);
        const routeContext = {
          sourceSceneId: sceneBlueprint.id,
          sourceBeatId: beat.id,
          sourceChoiceId: choice.id,
          choiceSummary: choice.feedbackCue?.echoSummary || choice.text,
          originalTargetSceneId: targetSceneId,
          originalTargetBeatId: choice.nextBeatId,
          transitionIntent: `Bridge from "${this.sanitizeReaderFacingSceneName(sceneBlueprint.name)}" to "${readerTargetName}" without teleporting the player.`,
          bridgePurpose: 'choice_transition',
        };

        choice.routeContext = routeContext;
        choice.nextBeatId = bridgeId;
        delete choice.nextSceneId;

        const existingBridge = content.beats.find(candidate => candidate.id === bridgeId);
        if (existingBridge) {
          existingBridge.nextSceneId = targetSceneId;
          existingBridge.nextBeatId = routeContext.originalTargetBeatId;
          existingBridge.isChoiceBridge = true;
          existingBridge.routeContext = routeContext;
          continue;
        }

        const bridgeText = this.buildChoiceBridgeBeatText(choice);
        content.beats.push({
          id: bridgeId,
          text: bridgeText,
          nextSceneId: targetSceneId,
          nextBeatId: routeContext.originalTargetBeatId,
          isChoiceBridge: true,
          routeContext,
          visualMoment: bridgeText,
          primaryAction: bridgeText,
          emotionalRead: 'the chosen decision visibly turns into motion',
          relationshipDynamic: 'the protagonist carries the consequence forward before the next scene begins',
          mustShowDetail: targetScene?.location
            ? `a concrete transition toward ${targetScene.location}`
            : 'a concrete transition from decision into action',
          intensityTier: 'supporting',
          sequenceIntent: {
            objective: 'Carry the player choice into the next story state without a location or relationship jump.',
            activity: 'decision, movement, and arrival',
            obstacle: 'the story must earn the next scene before it begins',
            startState: choice.feedbackCue?.echoSummary || choice.text,
            endState: targetScene ? `The route is ready to enter ${readerTargetName}.` : 'The next scene is earned.',
            beatRole: 'handoff',
            mechanicThread: choice.consequenceDomain || choice.choiceIntent,
          },
        } as GeneratedBeat);
      }
    }
  }

  private buildChoiceBridgeBeatText(choice: ChoiceSet['choices'][number]): string {
    const rawImmediate = this.cleanChoiceBridgeFragment(choice.feedbackCue?.progressSummary || choice.reminderPlan?.immediate);
    // The lead fragment is sourced from planning fields; reject any meta/design-note
    // register ("In the next scene…", raw flag ids) rather than leak it to readers.
    const immediate = rawImmediate && !isUnsafeCallbackProse(rawImmediate) ? rawImmediate : '';
    // Prefer the authored in-fiction fragment ALONE. The generic line was previously
    // APPENDED to every bridge, producing robotic structural closers ("The path forward
    // is set.") on top of real prose (gen-5 audit) — it is now a last-resort fallback.
    const lead = immediate || this.genericBridgeDestination(choice.id);
    const trimmed = lead.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }

  /**
   * Deterministic generic in-fiction line for a choice bridge with no authored
   * fragment. In-world register (no "path/threshold/forward is set" scaffolding, no
   * scene names); rotation keyed on the choice id avoids identical consecutive lines.
   */
  private genericBridgeDestination(choiceId: string | undefined): string {
    const options = [
      'What comes next is already in motion.',
      'There is no stepping back from here.',
      'The decision settles into your chest and stays there.',
      'The choice changes the air around you.',
    ];
    const key = String(choiceId || '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return options[hash % options.length];
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
    return this.assembly().assembleEpisode(
      brief, worldBible, characterBible, blueprint, sceneContents, choiceSets,
      imageResults, encounters, encounterImageResults, videoResults,
    );
  }

  private async repairWeakCliffhangerBeforeImages(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters?: Map<string, EncounterStructure>,
  ): Promise<void> {
    return repairWeakCliffhangerBeforeImagesImpl(
      {
        sceneWriterConfig: this.config.agents.sceneWriter,
        emit: (event) => this.emit(event),
        recordRemediationSafe: (record) => this.recordRemediationSafe(record),
        assembleEpisode: this.assembleEpisode.bind(this),
      },
      brief, worldBible, characterBible, blueprint, sceneContents, choiceSets, encounters,
    );
  }

  private isEpisodeFinalScene(scene: SceneBlueprint, blueprint: EpisodeBlueprint): boolean {
    const terminalScenes = (blueprint.scenes || []).filter(s => !s.leadsTo || s.leadsTo.length === 0);
    if (terminalScenes.length > 0) {
      return terminalScenes.some(s => s.id === scene.id);
    }
    return (blueprint.scenes || [])[blueprint.scenes.length - 1]?.id === scene.id;
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
    return buildEncounterPriorStateContext(
      encounterScene,
      blueprint,
      npcsInvolved,
      flagsAlreadySet,
      this.incrementalValidator
        ? (npcId, dimension) => this.incrementalValidator!.getRelationshipUpperBound(npcId, dimension)
        : undefined,
    );
  }

  /**
   * Deterministic post-assembly scan: walk every scene in order, accumulate
   * flags from setFlag consequences, and verify that every flag-type condition
   * on choices (narrative and encounter) only references flags already in the
   * accumulated set.  Returns human-readable issue strings.
   */
  private runFlagChronologyScan(story: Story): string[] {
    return this.finalContract().runFlagChronologyScan(story);
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

  private buildChoiceAuthorNpcs(
    npcIds: string[],
    characterBible: CharacterBible
  ): Array<{ id: string; name: string; pronouns: 'he/him' | 'she/her' | 'they/them'; description: string; voiceNotes?: string; physicalDescription?: string }> {
    return buildChoiceAuthorNpcs(npcIds, characterBible);
  }

  private deriveStoryVerbsForBrief(brief: FullCreativeBrief, worldBible?: WorldBible) {
    return deriveStoryVerbsForBrief(brief, worldBible);
  }

  private buildCompactWorldContext(worldBible: WorldBible, locationDescription?: string): string {
    return buildCompactWorldContext(worldBible, locationDescription);
  }

  private inferBranchType(
    sceneBlueprint: SceneBlueprint,
    blueprint: EpisodeBlueprint
  ): 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' {
    return inferBranchType(sceneBlueprint, blueprint);
  }

  /**
   * Filter source analysis to only include content needed for selected episodes
   */
  private filterAnalysisForEpisodeRange(
    analysis: SourceMaterialAnalysis,
    episodeRange: { start: number; end: number; specific?: number[] },
    episodesToGenerate?: number[]
  ): SourceMaterialAnalysis {
    return filterAnalysisForEpisodeRange(analysis, episodeRange, episodesToGenerate, this.emit.bind(this));
  }

  private refreshAnalysisFromTreatmentDocument(
    analysis: SourceMaterialAnalysis,
    sourceText?: string
  ): SourceMaterialAnalysis {
    return refreshAnalysisFromTreatmentDocument(analysis, sourceText, this.emit.bind(this));
  }

  private refreshBriefSeasonPlanFromAnalysis(
    baseBrief: FullCreativeBrief,
    analysis: SourceMaterialAnalysis
  ): FullCreativeBrief {
    return refreshBriefSeasonPlanFromAnalysis(baseBrief, analysis, this.emit.bind(this));
  }

  /**
   * Reconcile the brief's top-level story metadata (genre / tone / synopsis /
   * themes) with the canonical season plan. Thin wrapper over the pure
   * {@link reconcileBriefStoryMetadata} helper (extracted to keep this monolith
   * from growing); see that module for the rationale.
   */
  private reconcileBriefStoryMetadataFromPlan(
    baseBrief: FullCreativeBrief,
    analysis: SourceMaterialAnalysis
  ): FullCreativeBrief {
    const result = reconcileBriefStoryMetadata(baseBrief, analysis);
    if (result.changed) {
      this.emit({
        type: 'debug',
        phase: 'season_plan_refresh',
        message: `Reconciled brief story metadata from season plan (genre="${result.genre}").`,
      });
    }
    return result.brief;
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

  // ── S3: remediation budget + ledger plumbing ──────────────────────

  /**
   * (Re)create the per-run remediation budget and zero the per-run counters.
   * Called at each run entry point alongside the other per-run state resets.
   * The ceiling defaults HIGH (config.remediationBudgetTotal, default 1000) so
   * existing always-on scene/encounter/choice regeneration is never constrained.
   */
  private resetRemediationBudget(): void {
    this.remediationBudget = createRemediationBudget(this.config.generation?.remediationBudgetTotal ?? 1000);
    this.runLedger().resetCounters();
  }

  private _runLedger?: RunLedger;

  /** Cross-run quality-ledger plumbing — see pipeline/runLedger.ts. */
  private runLedger(): RunLedger {
    if (!this._runLedger) {
      this._runLedger = new RunLedger({
        currentOutputDirectory: () => this._currentOutputDirectory,
        serializeCallbackLedger: () => this.callbackLedger?.serialize?.(),
      });
    }
    return this._runLedger;
  }

  /** S3: per-run remediation counters for the success quality-ledger row. */
  private getRemediationSummary(): { attempted: number; succeeded: number; degraded: number } {
    return this.runLedger().getRemediationSummary();
  }

  private async recordRemediationSafe(
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ): Promise<void> {
    return this.runLedger().recordRemediationSafe(record);
  }

  private async recordGateShadowSafe(
    record: Omit<GateShadowRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ): Promise<void> {
    return this.runLedger().recordGateShadowSafe(record);
  }

  private async recordFinalContractShadow(
    input: { story: Story; brief: FullCreativeBrief },
    treatmentSourced: boolean,
    designNoteLeaks: number,
  ): Promise<void> {
    return this.runLedger().recordFinalContractShadow(input, treatmentSourced, designNoteLeaks);
  }

  private async recordPlanGateShadow(
    gate: string, validator: string, blockingCount: number,
    issues: Array<{ severity: string; message?: string }>, storyId?: string,
  ): Promise<void> {
    return this.runLedger().recordPlanGateShadow(gate, validator, blockingCount, issues, storyId);
  }

  // ── Memory persistence (Claude memory tool) — see pipeline/pipelineMemory.ts ──

  private _pipelineMemory?: PipelineMemory;

  private pipelineMemory(): PipelineMemory {
    if (!this._pipelineMemory) {
      this._pipelineMemory = new PipelineMemory({ config: this.config });
    }
    return this._pipelineMemory;
  }

  async writeGenerationMemory(opts: Parameters<PipelineMemory['writeGenerationMemory']>[0]): Promise<void> {
    return this.pipelineMemory().writeGenerationMemory(opts);
  }

  async writeQALearnings(
    qaReport: Parameters<PipelineMemory['writeQALearnings']>[0],
    episodeTitle?: string,
  ): Promise<void> {
    return this.pipelineMemory().writeQALearnings(qaReport, episodeTitle);
  }

  async writeCharacterMemory(opts: Parameters<PipelineMemory['writeCharacterMemory']>[0]): Promise<void> {
    return this.pipelineMemory().writeCharacterMemory(opts);
  }

  async readCharacterMemory(characterName: string): Promise<string | null> {
    return this.pipelineMemory().readCharacterMemory(characterName);
  }

  async readPipelineMemory(): Promise<string | null> {
    return this.pipelineMemory().readPipelineMemory();
  }

  /**
   * Run ONLY the video generation phase against an already-generated story.
   * Reconstructs the data structures the video pipeline needs from the story JSON
   * and the original generation artifacts (brief, world bible) on disk.
   */
  async runVideoOnly(story: Story, options: { targetEpisodeNumber?: number } = {}): Promise<{ videosGenerated: number; story: Story }> {
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

    const targetEpisodes = (story.episodes || []).filter((episode) => (
      options.targetEpisodeNumber == null || episode.number === options.targetEpisodeNumber
    ));
    if (options.targetEpisodeNumber != null && targetEpisodes.length === 0) {
      throw new Error(`Episode ${options.targetEpisodeNumber} was not found in story — cannot generate video`);
    }

    for (const episode of targetEpisodes) {
      for (const scene of episode.scenes || []) {
        if (scene.encounter) continue;

        const beats: GeneratedBeat[] = (scene.beats || []).map(beat => {
          if (beat.image) {
            beatImages.set(`episode-${episode.number}-${scene.id}::${beat.id}`, beat.image as unknown as string);
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
            relationshipDynamic: (beat as any).relationshipDynamic,
            mustShowDetail: (beat as any).mustShowDetail,
            shotType: (beat as any).shotType,
            visualCast: (beat as any).visualCast,
            coveragePlan: (beat as any).coveragePlan,
            dramaticIntent: (beat as any).dramaticIntent,
            sequenceIntent: (beat as any).sequenceIntent || (scene as any).sequenceIntent,
          };
        });

        if (scene.backgroundImage) {
          sceneImages.set(scene.id, scene.backgroundImage as unknown as string);
        }

        sceneContents.push({
          sceneId: scene.id,
          sceneName: scene.name || scene.id,
          beats,
          startingBeatId: scene.startingBeatId || beats[0]?.id || '',
          moodProgression: (scene as any).moodProgression || [],
          charactersInvolved: (scene as any).charactersInvolved || (scene as any).charactersPresent || [],
          keyMoments: [],
          continuityNotes: [],
          sequenceIntent: (scene as any).sequenceIntent,
        });
      }
    }

    if (beatImages.size === 0) {
      throw new Error(options.targetEpisodeNumber != null
        ? `No beat images found for episode ${options.targetEpisodeNumber} — video generation requires existing images`
        : 'No beat images found in story — video generation requires existing images');
    }

    this.emit({
      type: 'agent_start',
      phase: 'video_generation',
      message: `Found ${beatImages.size} beat images across ${sceneContents.length} scenes${options.targetEpisodeNumber != null ? ` for episode ${options.targetEpisodeNumber}` : ''}. Starting video generation...`,
    });

    const videosDir = `${outputDir}videos/`;
    this.videoService.setOutputDirectory(videosDir);

    const videoRunResult = await this.runVideoGeneration(
      sceneContents,
      { beatImages, sceneImages },
      {
        ...brief,
        episode: options.targetEpisodeNumber != null && targetEpisodes[0]
          ? ({
              ...(brief.episode || {}),
              number: targetEpisodes[0].number,
              title: targetEpisodes[0].title,
              synopsis: targetEpisodes[0].synopsis,
            } as FullCreativeBrief['episode'])
          : brief.episode,
      },
      worldBible
    );
    const videoResults = videoRunResult.videoResults;

    const videosGenerated = bindGeneratedVideoToStory(story, videoResults, options);
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

    console.log(`[Pipeline] Video-only run complete: ${videosGenerated} videos for "${story.title}"${options.targetEpisodeNumber != null ? ` episode ${options.targetEpisodeNumber}` : ''}`);
    return { videosGenerated, story };
  }
}
