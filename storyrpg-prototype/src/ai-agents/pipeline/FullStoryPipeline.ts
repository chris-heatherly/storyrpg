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
import {
  StoryArchitect,
  EpisodeBlueprint,
  SceneBlueprint,
  EPISODE_BLUEPRINT_SCENE_OWNERSHIP_VERSION,
} from '../agents/StoryArchitect';
import { SceneWriter, SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceAuthor, ChoiceSet } from '../agents/ChoiceAuthor';
import { QARunner, QAReport, ContinuityChecker } from '../agents/QAAgents';
import { SemanticRealizationJudge } from '../agents/SemanticRealizationJudge';
import {
  collectKnownSemanticLocations,
  semanticContractEventSeeds,
  semanticContractPremiseSeeds,
  validateAuthoredEventSemanticIR,
} from './semanticContractIr';
import { stableHash } from './artifacts/store';
import { aggregateProseCraftReports, aggregateResponsivenessReports } from '../agents/QualityJudges';
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
import { type SceneSettingContext } from '../utils/styleAdaptation';
import { normalizeChoiceSetStatChecks } from '../utils/statCheckNormalization';
import {
  type SceneVisualStoryboardPlan,
  type VisualStoryboardPacket,
} from '../images/visualStoryboardPlanning';
import { 
  Story, Episode, Scene, Beat, Choice, NPCTier, RelationshipDimension, Consequence,
  Encounter, EncounterOutcome, EncounterType, EncounterClock, EncounterPhase,
  EncounterChoice as TypeEncounterChoice, EncounterChoiceOutcome as TypeEncounterChoiceOutcome,
  EnvironmentalElement, NPCEncounterState, EscalationTrigger, InformationVisibility, 
  PixarStakes, CinematicImageDescription, EncounterVisualContract
} from '../../types';
import { PipelineEvent, PipelineEventHandler } from './events';
import {
  computeFailureFingerprint,
  shouldRefuseIdenticalResume,
  type FailureFingerprintRecord,
} from './failureFingerprint';
import {
  buildFoundationCacheIdentity,
  defaultFoundationCacheDir,
  readFoundationArtifact,
  writeFoundationArtifact,
} from './foundationArtifactCache';
import { resetStoryLexiconFromEnv } from '../config/storyLexicon';
import { enforceEpisodePlanCraftGates } from './episodePlanCraftGates';
import { auditStoryVisualContractPersistence as auditStoryVisualContractPersistenceImpl } from './visualContractPersistenceAudit';
import { commitEpisodeGenerationAfterLock, emitEpisodeGenerationStart, episodeFailureMetadataFromError, handleEpisodeGenerationFailure, type EpisodeGenerationResult } from './episodeGenerationEvents';

import {
  type GenerationPlan,
  applyEventToPlan,
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
import { plannedChoiceTypesByScene, plannedConsequenceTiersByScene } from './plannedSceneBudgets';
import { type SeasonSkillPlan } from './seasonSkillPlan';
import {
  findResumedEpisodeInvalidationReasons,
  loadResumedEpisodeDiagnostics,
  partitionResumableEpisodes,
  type EpisodeCompletionLockEvidence,
} from './episodeCheckpoints';
import { runEpisodeLoopOnGraph, runFoundationOnGraph } from './episodeRunGraph';
import { resolveEpisodeParallelism } from './episodeScheduling';
import { lockGeneratedEpisodeArtifact, validateEpisodeOutputBoundary } from './episodeLocking';
import type { ArtifactValidationSummary } from './artifacts';
import { repairWeakCliffhangerBeforeImages as repairWeakCliffhangerBeforeImagesImpl } from './cliffhangerRepair';
import { captureEncounterTelemetry as captureEncounterTelemetryInto } from './encounterTelemetryCollect';

import { reconcileBriefStoryMetadata } from './briefStoryMetadata';
import {
  filterAnalysisForEpisodeRange,
  refreshAnalysisFromTreatmentDocument,
  refreshBriefSeasonPlanFromAnalysis,
} from './treatmentRefresh';
import { rebuildTreatmentSeasonScenePlan } from './seasonScenePlanBuilder';
import { episodePlanResumeCompatibility } from './episodePlanResumeCompatibility';
import { assertSelectedEpisodeEventPlansExecutable, validateCanonicalEpisodeBlueprintProjection } from './narrativeContractCompiler';
import { isSceneFirstPlanningEnabled } from '../config/sceneFirstPlanning';
import { SeasonCanon } from './seasonCanon';
import { renderSourceCanonPrompt } from '../utils/sourceCanonPrompt';
import { createRunState, type PipelineRunState } from './runState';
import { sealAndPersistEpisode } from './seasonSealOrchestration';
import { validateSeasonCompletion } from '../validators/promiseLedgerValidators';
import { SceneOwnershipPreflightValidator } from '../validators/SceneOwnershipPreflightValidator';
import { runPlanTimeFidelityChecks, runFidelityValidators, type FidelityFinding } from '../validators/runFidelityValidators';
import {
  buildEpisodeSceneLockReport,
  mergeArtifactValidationSummaries,
  sceneLockArtifactName,
} from './sceneLocks';
import type { ValidationPhaseBaseline } from '../validators/validationPhaseBaseline';
import { FinalStoryContractValidator } from '../validators/FinalStoryContractValidator';
import {
  buildChoiceAuthorNpcs,
  buildCompactWorldContext,
  buildEncounterPriorStateContext,
  deriveStoryVerbsForBrief,
  inferBranchType,
} from './contextAssembly';
import { applySpinePlantMap, deriveSpinePlantMap } from './spinePlantMap';
import { extractEpisodeKnowledge, collectReferencedFlags, episodeProseCorpus } from './knowledgeExtraction';
import { applySceneConstructionProfilesToScenes } from '../utils/sceneConstructionProfile';
import { attachSceneEventOwnershipProfiles, overlayBlueprintSceneEventOwnership } from '../utils/sceneEventOwnership';
import { finalizeEpisodeSceneOwnership } from '../utils/episodeSceneOwnership';
import { normalizeRelationshipPacingStages } from '../utils/relationshipPacingStagePolicy';
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
import { RunArtifactPhase, type RunArtifactRuntime } from './phases/RunArtifactPhase';
import { persistEpisodePlanningArtifacts, persistPlanningArtifacts } from './planningArtifactPersistence';
import { VideoPhase, bindGeneratedVideoToStory } from './phases/VideoPhase';
import { MasterImagePhase } from './phases/MasterImagePhase';
import { SceneImagePhase, type SceneImagePhaseDeps } from './phases/SceneImagePhase';
import { EncounterImagePhase } from './phases/EncounterImagePhase';
import { CoverArtPhase } from './phases/CoverArtPhase';
import { ImageSupport } from './imageSupport';
import {
  PipelineMemory,
  renderPipelineMemoryPacket,
  slugifyMemoryKey,
  type AgentMemoryRequest,
  type AgentMemoryRole,
  type PipelineMemoryPacket,
  type ValidatorEvidenceBundle,
} from './pipelineMemory';
import { AgentMemoryContextBuilder } from './agentMemoryContextBuilder';
import { ValidatorEvidenceService } from './validatorEvidenceService';
import { ArtifactMemoryService } from './artifactMemoryService';
import { ArtifactContextResolver } from './artifactContextResolver';
import { FactMemoryService } from './factMemoryService';
import { recallValidatorMemory } from './validatorMemory';
import { memoryTelemetry, type MemoryRunSummary } from './memoryTelemetry';
import type { PipelineMemoryArtifactKind, PipelineMemoryFactKind, WritePipelineArtifactInput } from './artifactMemoryTypes';
import { RunLedger } from './runLedger';
import { DraftImageEntry } from './draftImageEntry';
import { DraftImageGeneration, type DraftImageGenerationDeps } from './draftImageGeneration';
import { SceneGraphValidation, type SceneGraphValidationDeps } from './sceneGraphValidation';
import { SceneCriticContinuity, type SceneCriticContinuityDeps, type ContinuityRepairOptions } from './sceneCriticContinuity';
import { FinalContract, type FinalContractDeps } from './finalContract';
import { Assembly } from './assembly';
import { QAPhase, type QAPhaseDeps } from './phases/QAPhase';
import { QuickValidationPhase, type QuickValidationPhaseDeps } from './phases/QuickValidationPhase';
import { ContentGenerationPhase, type ContentGenerationPhaseDeps, type ContentGenerationResult } from './phases/ContentGenerationPhase';
import { AssemblyPhase } from './phases/AssemblyPhase';
import { bindStoryMediaAssets, rethrowAsImagePhaseFailure } from './mediaBinding';
import { EpisodeArchitecturePhase, type EpisodeArchitecturePhaseDeps } from './phases/EpisodeArchitecturePhase';
import { buildEpisodeDraftCheckpoint, readEpisodeDraftCheckpoint } from './episodeDraftCheckpoint';
import { BranchAnalysisPhase, type BranchAnalysisPhaseDeps } from './phases/BranchAnalysisPhase';
import { CharacterDesignPhase, type CharacterDesignPhaseDeps } from './phases/CharacterDesignPhase';
import { NPCDepthValidationPhase } from './phases/NPCDepthValidationPhase';
import { QualityCouncilRunner } from '../quality-council/QualityCouncilRunner';
import {
  createOutputDirectory,
  ensureDirectory,
  savePipelineOutputs,
  savePipelineErrorLog,
  saveLlmLedgerSidecar,
  saveFinalStoryContractFailure,
  saveFinalContractRepairRound,
  savePartialStory,
  appendFailedRunLedger,
  saveEarlyDiagnostic,
  saveAudioDiagnosticsLog,
  saveEncounterImageDiagnosticsLog,
  saveVideoDiagnosticsLog,
  loadEarlyDiagnosticSync,
  saveBeatResumeState,
  writeFinalStoryPackage,
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
import { implementEpisodeResidueObligations } from './residueObligations';
import { collectEpisodeSetFlags, registerSeedObligations, registerThreadObligations } from './obligationSeeding';
import { validateObligationLedger } from '../validators/ObligationLedgerValidator';
import { assembleStoryAssetsFromRegistry } from '../images/storyAssetAssembler';
import { StoryboardV2Pipeline, type StoryboardV2Result } from '../images/storyboard-v2/StoryboardV2Pipeline';
import { runPlaywrightQA, runPlaywrightQAMultiPath, type PlaywrightQAResult } from '../validators/playwrightQARunner';
import { remediateImageIssues, resaveFinalStory } from '../validators/qaRemediation';
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
  type FinalStoryContractReport,
  TreatmentFidelityValidator,
  type SceneGraphBranchValidationResult,
  runNarrativeDiagnostics,
  type NarrativeDiagnosticsReport,
  ArcPressureArchitectureValidator,
} from '../validators';
import type { PhaseValidationResult } from '../validators/PhaseValidator';
import { PLAN_GATE_FLAGS } from '../remediation/planGatePolicy';
import { stabilizeByHysteresis } from '../remediation/judgeStabilizer';

import { RemediationBudget, createRemediationBudget, shouldAttemptRemediation } from '../remediation/RemediationBudget';
import { type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { buildGateShadowRecord, buildValidatorPromotionRecord, type GateShadowRecord } from '../remediation/gateShadowLedger';
import { isGateEnabled, resolveGateConfigHash } from '../remediation/gateDefaults';
import { setRealizationPovContext } from '../remediation/realizationEvaluator';
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
} from './choiceAssembly';
import {
  buildBranchFallbackChoiceSet as buildBranchFallbackChoiceSetImpl,
  createFallbackChoiceSet as createFallbackChoiceSetImpl,
  ensureBlueprintFidelityText as ensureBlueprintFidelityTextImpl,
  sanitizeReaderFacingSceneName as sanitizeReaderFacingSceneNameImpl,
  sanitizeSceneContentForReader as sanitizeSceneContentForReaderImpl,
} from './readerTextFallbacks';
import {
  extractSceneContext as extractSceneContextImpl,
  inferIntensity as inferIntensityImpl,
  inferValence as inferValenceImpl,
  mapChoicePositions as mapChoicePositionsImpl,
  mapSpeakerMoodToEmotion as mapSpeakerMoodToEmotionImpl,
  resolveWorldLocationForScene as resolveWorldLocationForSceneImpl,
} from './sceneMediaSignals';
import { ensureChoiceBridgeBeats as ensureChoiceBridgeBeatsImpl } from './choiceBridgeBeats';
import { ProgressTelemetryTracker } from './progressTelemetry';
import { CastingReferences } from './castingReferences';
import { ImageResumeHydration, type ResumeReferencePreflightReport } from './imageResumeHydration';
import { ImagePromptSupport } from './imagePromptSupport';
import {
  analyzeBeatCharacters as analyzeBeatCharactersImpl,
  extractCanonicalAppearance as extractCanonicalAppearanceImpl,
  getCharacterIdsInScene as getCharacterIdsInSceneImpl,
  inferBasePostureFromPersonality as inferBasePostureFromPersonalityImpl,
  inferGestureStyleFromPersonality as inferGestureStyleFromPersonalityImpl,
  isEstablishingBeat as isEstablishingBeatImpl,
  normalizeCharacterIds as normalizeCharacterIdsImpl,
  resolveCharacterId as resolveCharacterIdImpl,
  resolveCharacterIdWithBrief as resolveCharacterIdWithBriefImpl,
  resolveProtagonistCharacterId as resolveProtagonistCharacterIdImpl,
} from './imageCasting';

// Re-export types for consumers
export type { OutputManifest } from '../utils/pipelineOutputWriter';
export type { PipelineEvent } from './events';

// PipelineError moved to ./errors (pure move) so pipeline/phases/* can use it
// without importing this monolith. Re-exported here for existing consumers.
import { PipelineError } from './errors';
import { assertCanonicalPlanAttached } from './generationPreflight';
export { PipelineError };

// Full creative brief for complete story generation
export interface FullCreativeBrief {
  /** Immutable source/plan revision contract verified before any generation call. */
  generationManifest?: import('./generationPreflight').GenerationManifest;
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
    role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral' | 'wildcard';
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
  failure?: import('./episodeGenerationEvents').EpisodeFailureMetadata;
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

type EpisodeImageResults = {
  beatImages: Map<string, string>;
  sceneImages: Map<string, string>;
};

type EpisodeEncounterImageResults = {
  encounterImages: Map<string, {
    setupImages: Map<string, string>;
    outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
  }>;
  storyletImages: Map<string, Map<string, Map<string, string>>>;
  storyletFailures?: string[];
};

type AuthoredEpisodeArtifacts = {
  episode: Episode;
  episodeBrief: FullCreativeBrief;
  blueprint: EpisodeBlueprint;
  branchAnalysis?: BranchAnalysis | null;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
  validationExecutionRecords?: import('../../types/validation').ValidatorExecutionRecord[];
};

type GeneratedEpisodeFromOutlineResult = Partial<AuthoredEpisodeArtifacts> & {
  result: EpisodeGenerationResult;
  qaReport?: QAReport;
  bestPracticesReport?: ComprehensiveValidationReport;
};

type EpisodeMediaResult = {
  episode: Episode;
  storyletFailures?: string[];
  encounterImageDiagnostics?: EncounterImageRunDiagnostic[];
};

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

  /** Output directory for the in-flight run (worker log finalization, resume). */
  getCurrentOutputDirectory(): string | undefined {
    return this._currentOutputDirectory;
  }
  private sceneWriter: SceneWriter;
  private choiceAuthor: ChoiceAuthor;
  private qaRunner: QARunner;
  private semanticRealizationJudge: SemanticRealizationJudge;
  private sourceMaterialAnalyzer: SourceMaterialAnalyzer;
  private branchManager: BranchManager;
  private sceneCritic?: SceneCritic;
  private qualityCouncil?: QualityCouncilRunner;
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
  private cachedPipelineMemory: PipelineMemoryPacket | null = null;
  private _agentMemoryContextBuilder?: AgentMemoryContextBuilder;
  private _validatorEvidenceService?: ValidatorEvidenceService;
  private _artifactMemoryService?: ArtifactMemoryService;
  private _artifactContextResolver?: ArtifactContextResolver;
  private _factMemoryService?: FactMemoryService;
  private planTimeFidelityFindings: FidelityFinding[] = [];
  private planTimeFidelityBaseline?: ValidationPhaseBaseline;

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
  private progressTelemetryTracker = new ProgressTelemetryTracker({
    pipelineStartedAtMs: () => this.pipelineStartedAtMs,
    generationPlan: () => this.generationPlan,
  });
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
  private sourceCanonPromptBlock?: string;
  private get priorEpisodeSnapshot(): EpisodeStateSnapshot | undefined { return this.runState.season.priorEpisodeSnapshot; }
  private set priorEpisodeSnapshot(v: EpisodeStateSnapshot | undefined) { this.runState.season.priorEpisodeSnapshot = v; }
  /**
   * E1: the season-level choice-type plan, allocated ONCE across the season's moments
   * (35/30/20/15 is a SEASON budget, not per-episode). Built in runEpisodeArchitecture
   * from the season plan; each episode draws its type slice via episodeTypeCounts.
   */
  private get seasonChoicePlan(): SeasonChoicePlan | undefined { return this.runState.season.choicePlan; }
  private set seasonChoicePlan(v: SeasonChoicePlan | undefined) { this.runState.season.choicePlan = v; }
  private get plannedChoiceTypesByScene(): Record<string, string> | undefined { return this.runState.season.choiceTypesByScene; }
  private set plannedChoiceTypesByScene(v: Record<string, string> | undefined) { this.runState.season.choiceTypesByScene = v; }
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
    const sourceBlock = this.sourceCanonPromptBlock;
    const blocks = [sourceBlock, block].filter((candidate) => candidate && candidate.trim());
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
  }
  private completedPhases = new Set<string>();
  private invalidatedResumeEpisodes = new Set<number>();
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
    BaseAgent.setLlmSemanticFailureObserver((failure) => {
      this.telemetry.observeSemanticFailure(failure.agentName, failure.provider, failure.category);
    });
    // WS5 truncation shadow counter: every lossy truncation recovery (landmine
    // L4 — content silently dropped from a "successful" parse) is ledgered per
    // agent in 09-llm-ledger.json and surfaced as a run warning. This shadow
    // data decides whether retry-on-truncation is worth building.
    BaseAgent.setTruncationObserver((t) => {
      this.telemetry.observeTruncation(t.agentName, t.provider);
      this.emit({
        type: 'warning',
        phase: 'llm_truncation',
        message: `${t.agentName} response was truncated and rejected — retry/regeneration required (L4).`,
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
    this.semanticRealizationJudge = new SemanticRealizationJudge(
      this.config.agents.qaRunner || this.config.agents.storyArchitect,
    );
    // maxTokens 32000 (was 16384): the structure-analysis JSON for rich multi-episode treatments was hitting the 16384 cap mid-string (truncated → unparseable).
    const sourceMaterialConfig = { ...this.config.agents.storyArchitect, maxTokens: 32000 };
    this.sourceMaterialAnalyzer = new SourceMaterialAnalyzer(sourceMaterialConfig);
    // BranchManager only annotates a deterministic skeleton now, so it rides the
    // cheaper branch/QA-tier model when configured; falls back to planningConfig.
    this.branchManager = new BranchManager(this.config.agents.branchManager ?? planningConfig);
    if (this.config.sceneCritic?.enabled) {
      this.sceneCritic = new SceneCritic(this.config.agents.sceneWriter);
    }
    if (this.config.qualityCouncil?.enabled) {
      this.resetQualityCouncil();
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
    this.audioService = new AudioGenerationService({
      provider: this.config.narration?.provider || 'elevenlabs',
      apiKey: this.config.narration?.elevenLabsApiKey,
      geminiApiKey: this.config.narration?.geminiApiKey || this.config.imageGen?.geminiApiKey || this.config.imageGen?.apiKey,
      geminiModel: this.config.narration?.geminiModel,
      voiceId: this.config.narration?.voiceId,
      voiceCastingEnabled: this.config.narration?.voiceCastingEnabled,
      performanceTagsEnabled: this.config.narration?.performanceTagsEnabled,
    });

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
      choiceSets?: ChoiceSet[];
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

  private async enforceFinalStoryContract(input: {
    story: Story;
    brief: FullCreativeBrief;
    requestedEpisodeNumbers?: number[];
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    phase: string;
    validationScope?: import('../validators/runFidelityValidators').FidelityValidationScope;
  }): Promise<FinalStoryContractReport | undefined> {
    const evidence = await this.recallValidatorEvidence(
      'FinalStoryContractValidator',
      input.phase || 'final-contract',
      input.brief,
      { artifactKinds: ['story-json', 'qa-report', 'final-contract'], artifactIds: input.brief.story.title ? [input.brief.story.title] : undefined },
    );
    const report = await this.finalContract().enforceFinalStoryContract(input);
    if (report) {
      report.memoryEvidence = [
        this.validatorEvidenceService().summarize(evidence, evidence.corroborationRequired ? 'corroborated-evidence' : 'advisory-memory'),
      ];
      await this.writeArtifactMemory({
        artifactKind: 'final-contract',
        storyId: input.brief.story.title,
        episodeNumber: input.brief.episode?.number,
        lifecycle: input.phase || 'final-contract',
        validator: 'FinalStoryContractValidator',
        payload: report,
        projection: {
          title: `${input.brief.story.title} final contract`,
          summary: `Final contract ${report.passed ? 'passed' : 'failed'} with ${report.blockingIssues.length} blocking issue(s) and ${report.warnings.length} warning(s).`,
          metrics: {
            passed: report.passed,
            blockingIssueCount: report.blockingIssues.length,
            warningCount: report.warnings.length,
          },
        },
      });
    }
    return report;
  }

  private enforceEpisodeIncrementalContractWithTimeout(
    episodeNumber: number,
    input: Parameters<FullStoryPipeline['enforceFinalStoryContract']>[0],
    timeoutMs = PIPELINE_TIMEOUTS.finalContractRepair,
  ): Promise<FinalStoryContractReport | undefined> {
    return withTimeout(
      this.enforceFinalStoryContract(input),
      timeoutMs,
      `FinalStoryContractRepair(incremental_contract_ep_${episodeNumber})`,
      () => {
        this.emit({
          type: 'warning',
          phase: `incremental_contract_ep_${episodeNumber}`,
          message: `Episode ${episodeNumber} contract repair exceeded ${Math.round(timeoutMs / 60_000)} minute(s); failing the job so it can be resumed safely.`,
        });
      },
    );
  }

  private createFallbackChoiceSet(
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat
  ): ChoiceSet {
    return createFallbackChoiceSetImpl(sceneBlueprint, choiceBeat);
  }

  private buildBranchFallbackChoiceSet(
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat | undefined,
  ): ChoiceSet | undefined {
    return buildBranchFallbackChoiceSetImpl(sceneBlueprint, choiceBeat);
  }

  private sanitizeSceneContentForReader(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
    sanitizeSceneContentForReaderImpl(sceneBlueprint, content);
  }

  private sanitizeReaderFacingSceneName(name: string | undefined, fallback = 'the next scene'): string {
    return sanitizeReaderFacingSceneNameImpl(name, fallback);
  }

  private ensureBlueprintFidelityText(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
    ensureBlueprintFidelityTextImpl(sceneBlueprint, content);
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
    const generatedById = new Map(sceneContents.map((scene) => [scene.sceneId, scene]));
    const generatedIds = new Set(generatedById.keys());
    for (const scene of blueprint.scenes) {
      if (!generatedIds.has(scene.id)) {
        throw new PipelineError(
          `Invariant violation: missing generated scene for blueprint scene "${scene.id}"`,
          'content_generation'
        );
      }
      const generatedScene = generatedById.get(scene.id);
      // Encounter scenes carry their reader-facing prose in the encounter's
      // own phase beats (asserted by the encounter-content gate above), not in
      // scene-level beats — the old scaffold "bridge" beat that satisfied this
      // check pasted treatment text as prose (bite-me 2026-07-03).
      const isEncounterScene = Boolean(scene.isEncounter && scene.encounterType);
      if (!isEncounterScene && this.sceneBlueprintRequiresReaderProse(scene) && !this.sceneContentHasReaderProse(generatedScene)) {
        throw new PipelineError(
          `Invariant violation: scene "${scene.id}" owns reader-facing obligations but generated no prose beats`,
          'content_generation',
          {
            context: {
              sceneId: scene.id,
              sceneName: scene.name,
              ownedEvents: scene.sceneEventOwnership?.ownedEvents?.map((event) => event.cue) ?? [],
              isEncounter: scene.isEncounter,
              encounterType: scene.encounterType,
            },
          }
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

  private sceneBlueprintRequiresReaderProse(scene: SceneBlueprint): boolean {
    if (String(scene.turnContract?.centralTurn || scene.turnContract?.turnEvent || '').trim()) return true;
    if ((scene.sceneEventOwnership?.ownedEvents ?? []).length > 0) return true;
    if ((scene.storyCircleBeatContracts ?? []).length > 0) return true;
    if ((scene.authoredTreatmentFields ?? []).length > 0) return true;
    if (String(scene.signatureMoment || '').trim()) return true;
    if (scene.isEncounter || scene.encounterType || String(scene.encounterDescription || '').trim()) return true;
    if ((scene.npcsPresent ?? []).length > 0) return true;
    if ((scene.requiredBeats ?? []).some((beat) =>
      beat.tier === 'authored'
      || beat.tier === 'signature'
      || beat.tier === 'coldopen'
      || String(beat.mustDepict || beat.sourceTurn || '').trim()
    )) {
      return true;
    }
    return Boolean((scene.sceneConstructionProfile?.obligations ?? []).some((obligation) =>
      obligation.slot === 'primary_turn' || obligation.slot === 'must_stage'
    ));
  }

  private sceneContentHasReaderProse(scene: SceneContent | undefined): boolean {
    return Boolean(scene?.beats?.some((beat) =>
      String(beat.text || beat.content || '').replace(/\s+/g, ' ').trim().length > 0
    ));
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
    const telemetry = event.telemetry || this.progressTelemetryTracker.buildProgressTelemetry(event);
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
    if (stepId === 'output_directory' && resumeCheckpoint?.outputs?.[stepId]) {
      return resumeCheckpoint.outputs[stepId] as T;
    }
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

  private finalizeEpisodeBlueprintSceneOwnershipForPipeline(params: {
    blueprint: EpisodeBlueprint;
    episodeNumber: number;
    source: 'pipeline_resume';
    storyCircleRole?: EpisodeBlueprint['storyCircleRole'];
  }): { issues: string[]; wasStale: boolean; drainedRequiredBeatIds: string[] } {
    const { blueprint, episodeNumber, source, storyCircleRole } = params;
    const wasStale = blueprint.sceneOwnershipStamp?.version !== EPISODE_BLUEPRINT_SCENE_OWNERSHIP_VERSION;
    finalizeEpisodeSceneOwnership(blueprint.scenes as never, {
      episodeNumber,
      storyCircleRole: storyCircleRole ?? blueprint.storyCircleRole,
    });
    normalizeRelationshipPacingStages(blueprint.scenes as never);
    const construction = applySceneConstructionProfilesToScenes(blueprint.scenes, { episodeNumber });
    const sceneConstructionIssues = construction.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    const eventOwnershipIssues = blueprint.episodeEventPlan
      ? validateCanonicalEpisodeBlueprintProjection(blueprint.episodeEventPlan, blueprint.scenes, episodeNumber)
        .map((issue) => issue.message)
      : attachSceneEventOwnershipProfiles(blueprint.scenes, { episodeNumber })
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message);
    const preflightIssues = new SceneOwnershipPreflightValidator().validate({
      episodeNumber,
      storyCircleRole: storyCircleRole ?? blueprint.storyCircleRole,
      episodeEventPlan: blueprint.episodeEventPlan,
      scenes: blueprint.scenes,
    }).issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    const issues = [...sceneConstructionIssues, ...eventOwnershipIssues, ...preflightIssues];
    const drainedRequiredBeatIds = construction.applications.flatMap((application) => application.drainedRequiredBeatIds);
    blueprint.sceneOwnershipStamp = {
      version: EPISODE_BLUEPRINT_SCENE_OWNERSHIP_VERSION,
      finalizedAt: new Date().toISOString(),
      source,
      issues,
      drainedRequiredBeatIds,
    };
    for (const scene of blueprint.scenes ?? []) {
      const budget = scene.sceneConstructionProfile?.capacity.beatBudget;
      if (budget?.recommended) {
        scene.recommendedBeatCount = Math.max(scene.recommendedBeatCount ?? 0, budget.recommended);
      }
    }
    return { issues, wasStale, drainedRequiredBeatIds };
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
    return true;
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

  private _imageResumeHydration?: ImageResumeHydration;

  /**
   * Memoized image-resume hydration service (asset-registry load/reset,
   * on-disk artifact discovery, reference-sheet/style-anchor hydration,
   * resume reference preflight) — see pipeline/imageResumeHydration.ts.
   * The asset registry gets a live setter because resume REPLACES it.
   */
  private imageResumeHydration(): ImageResumeHydration {
    if (!this._imageResumeHydration) {
      this._imageResumeHydration = new ImageResumeHydration({
        imageService: () => this.imageService,
        imageAgentTeam: () => this.imageAgentTeam,
        assetRegistry: () => this.assetRegistry,
        setAssetRegistry: (registry) => { this.assetRegistry = registry; },
        activeImageResumeOutputDirectory: () => this._activeImageResumeOutputDirectory,
        styleAnchorPaths: () => this._styleAnchorPaths,
        checkCancellation: () => this.checkCancellation(),
        generateCharacterReferenceSheet: (char, brief) =>
          this.generateCharacterReferenceSheet(char, brief as FullCreativeBrief),
        emit: (event) => this.emit(event),
      });
    }
    return this._imageResumeHydration;
  }

  private resetAssetRegistry(storyId?: string, persistPath?: string): void {
    this.imageResumeHydration().resetAssetRegistry(storyId, persistPath);
  }

  private loadAssetRegistryForImageResume(storyId: string, outputDirectory: string): void {
    this.imageResumeHydration().loadAssetRegistryForImageResume(storyId, outputDirectory);
  }

  private servedUrlForGeneratedImagePath(imagePath: string): string {
    return this.imageResumeHydration().servedUrlForGeneratedImagePath(imagePath);
  }

  private async readImageArtifact(imagePath: string): Promise<GeneratedImage | undefined> {
    return this.imageResumeHydration().readImageArtifact(imagePath);
  }

  private async findExistingImageArtifact(imagesDir: string, baseIdentifier: string): Promise<GeneratedImage | undefined> {
    return this.imageResumeHydration().findExistingImageArtifact(imagesDir, baseIdentifier);
  }

  private async hydrateReferenceSheetsFromExistingImages(
    outputDirectory: string,
    characterBible: CharacterBible,
  ): Promise<number> {
    return this.imageResumeHydration().hydrateReferenceSheetsFromExistingImages(outputDirectory, characterBible);
  }

  private async hydrateReferenceSheetFromDisk(char: CharacterProfile, imagesDir?: string): Promise<boolean> {
    return this.imageResumeHydration().hydrateReferenceSheetFromDisk(char, imagesDir);
  }

  private async hydrateStyleAnchorsFromExistingImages(outputDirectory: string, storyTitle: string): Promise<number> {
    return this.imageResumeHydration().hydrateStyleAnchorsFromExistingImages(outputDirectory, storyTitle);
  }

  private async markSlotFromExistingArtifact(slot: ImageSlot, imagesDir: string): Promise<boolean> {
    return this.imageResumeHydration().markSlotFromExistingArtifact(slot, imagesDir);
  }

  private collectPlannedReferenceCharacterIdsForResume(
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
  ): string[] {
    return this.imageResumeHydration().collectPlannedReferenceCharacterIdsForResume(story, characterBible, encounters);
  }

  private async preflightResumeReferenceSheets(
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
  ): Promise<ResumeReferencePreflightReport> {
    return this.imageResumeHydration().preflightResumeReferenceSheets(outputDirectory, story, characterBible, encounters, brief);
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
    const visualContractPersistence = this.auditStoryVisualContractPersistence(finalStory);

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
      memorySummary: this.getMemorySummaryForLedger(),
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

  private auditStoryVisualContractPersistence(story: Story) {
    return auditStoryVisualContractPersistenceImpl(story);
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
  /**
   * Arm the run-scoped protagonist POV context for realization scoring
   * (realizationEvaluator). Second-person prose never names the protagonist,
   * so realization token-overlap must know the name to exclude it — otherwise
   * "ProtagonistName does X" moments are systematically scored as missing and
   * the scene guard pastes planning text into player prose (bite-me
   * 2026-07-04 "Kylie Marinescu arrives in Bucharest." leak).
   */
  private armRealizationPovContext(brief: FullCreativeBrief): void {
    const aliases = [
      brief.protagonist?.name,
      ...((brief.protagonist as { aliases?: string[] })?.aliases ?? []),
    ].filter((alias): alias is string => Boolean(alias && alias.trim()));
    setRealizationPovContext(aliases.length > 0 ? { protagonistAliases: aliases } : null);
  }

  async generate(
    brief: FullCreativeBrief,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> }
  ): Promise<FullPipelineResult> {
    // Input validation
    this.validateBrief(brief);
    resetStoryLexiconFromEnv();
    this.armRealizationPovContext(brief);

    // R1.5: refuse identical-failure resume loops without repair patches.
    const priorFingerprint = (resumeCheckpoint?.outputs?.failure_fingerprint
      ?? this.getResumeOutput<FailureFingerprintRecord>(resumeCheckpoint, 'failure_fingerprint')) as FailureFingerprintRecord | undefined;
    const hasRepairPatches = Boolean(
      resumeCheckpoint?.outputs?.payload_patch
      || resumeCheckpoint?.outputs?.outputs_patch
      || (Array.isArray((resumeCheckpoint as { resumeContext?: { changedInputs?: unknown[] } } | undefined)?.resumeContext?.changedInputs)
        && ((resumeCheckpoint as { resumeContext?: { changedInputs?: unknown[] } }).resumeContext!.changedInputs!.length > 0)),
    );
    if (shouldRefuseIdenticalResume({ record: priorFingerprint, hasRepairPatches })) {
      throw new PipelineError(
        `[DeterministicResumeLoop] Refusing resume of identical failure fingerprint ${priorFingerprint!.fingerprint} without repair patches.`,
        'resume',
        {
          context: {
            failureKind: 'deterministic_resume_loop',
            failureFingerprint: priorFingerprint!.fingerprint,
            resumeCount: priorFingerprint!.resumeCount,
          },
          failure: {
            code: 'deterministic_resume_loop',
            ownerStage: 'packaging',
            retryClass: 'none',
            issueCodes: ['deterministic_resume_loop'],
            repairTarget: priorFingerprint!.fingerprint,
          },
        },
      );
    }
    if (priorFingerprint?.fingerprint && resumeCheckpoint?.outputs) {
      resumeCheckpoint.outputs.failure_fingerprint = {
        ...priorFingerprint,
        resumeCount: (priorFingerprint.resumeCount ?? 0) + 1,
        recordedAt: new Date().toISOString(),
      } satisfies FailureFingerprintRecord;
    }

    this.events = [];
    this.checkpoints = [];
    this.telemetry = new PipelineTelemetry();
    this._totalTokensUsed = 0;
    this.pipelineStartedAtMs = Date.now();
    this.progressTelemetryTracker.reset();
    this.completedPhases = new Set<string>();
    this.invalidatedResumeEpisodes = new Set<number>();
    this.dependencySchedulerStats = {
      hasCycle: false,
      waveCount: 0,
      fallbackToSerial: false,
    };
    this.sceneValidationResults = [];
    this.allSceneValidationResults = [];
    this.allEncounterTelemetry = [];
    this.resetQualityCouncil();
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
      memoryTelemetry.reset();
      this.cachedPipelineMemory = await this.recallPipelineMemory();
      if (this.cachedPipelineMemory) {
        this.emit({
          type: 'debug',
          phase: 'initialization',
          message: `Loaded pipeline memory (${this.cachedPipelineMemory.sourceSnippets.length} snippet(s) from ${this.cachedPipelineMemory.datasetNames.join(', ') || 'configured provider'})`,
          data: {
            datasetNames: this.cachedPipelineMemory.datasetNames,
            queryLog: this.cachedPipelineMemory.queryLog,
            warnings: this.cachedPipelineMemory.warnings,
          },
        });
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
      await this.writeArtifactMemory({
        artifactKind: 'world-bible',
        storyId: brief.story.title,
        episodeNumber: brief.episode.number,
        lifecycle: 'world-building',
        agentRole: 'WorldBuilder',
        payload: worldBible,
        projection: {
          title: `${brief.story.title} world bible`,
          summary: `World bible with ${worldBible.locations?.length || 0} location(s), ${worldBible.factions?.length || 0} faction(s), and ${worldBible.worldRules?.length || 0} world rule(s).`,
          metrics: {
            locationCount: worldBible.locations?.length || 0,
            factionCount: worldBible.factions?.length || 0,
            worldRuleCount: worldBible.worldRules?.length || 0,
          },
        },
      });

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
      await this.writeArtifactMemory({
        artifactKind: 'character-bible',
        storyId: brief.story.title,
        episodeNumber: brief.episode.number,
        lifecycle: 'character-design',
        agentRole: 'CharacterDesigner',
        characterIds: characterBible.characters?.map((character) => character.id) || [],
        payload: characterBible,
        projection: {
          title: `${brief.story.title} character bible`,
          summary: `Character bible with ${characterBible.characters?.length || 0} character profile(s).`,
          metrics: {
            characterCount: characterBible.characters?.length || 0,
          },
        },
      });

      // === PHASE 3: EPISODE ARCHITECTURE ===
      await this.checkCancellation();
      this.emit({ type: 'phase_start', phase: 'architecture', message: 'Phase 3: Creating episode blueprint' });
      this.requirePhases('episode_architecture', ['world_building', 'character_design']);
      const resumedEpisodeBlueprint = this.getResumeOutput<EpisodeBlueprint>(resumeCheckpoint, 'episode_blueprint');
      let acceptedResumedEpisodeBlueprint = false;
      let episodeBlueprint: EpisodeBlueprint | undefined = resumedEpisodeBlueprint;
      if (episodeBlueprint) {
        const resumeCompatibility = episodePlanResumeCompatibility(
          episodeBlueprint.episodeEventPlan,
          brief.seasonPlan?.scenePlan?.episodeEventPlans?.[brief.episode.number],
        );
        if (!resumeCompatibility.compatible) {
          this.invalidatedResumeEpisodes.add(brief.episode.number);
          this.emit({
            type: 'warning',
            phase: 'architecture',
            message: `Invalidated resumed episode blueprint for Episode ${brief.episode.number}: ${resumeCompatibility.reason}.`,
          });
          episodeBlueprint = undefined;
        }
      }
      if (episodeBlueprint) {
        const finalization = this.finalizeEpisodeBlueprintSceneOwnershipForPipeline({
          blueprint: episodeBlueprint,
          episodeNumber: brief.episode.number,
          source: 'pipeline_resume',
          storyCircleRole: episodeBlueprint.storyCircleRole,
        });
        if (finalization.wasStale) {
          this.emit({
            type: 'debug',
            phase: 'architecture',
            message: `Normalized stale resumed episode blueprint ownership (${finalization.drainedRequiredBeatIds.length} required beat(s) drained).`,
          });
        }
        if (finalization.issues.length > 0) {
          this.invalidatedResumeEpisodes.add(brief.episode.number);
          this.emit({
            type: 'warning',
            phase: 'architecture',
            message: `Invalidated resumed episode blueprint for Episode ${brief.episode.number}: ${finalization.issues.slice(0, 4).join(' | ')}`,
          });
          episodeBlueprint = undefined;
        } else {
          acceptedResumedEpisodeBlueprint = true;
        }
      }
      episodeBlueprint = episodeBlueprint
        ?? await this.measurePhase('episode_architecture', () => this.runEpisodeArchitecture(brief, worldBible, characterBible));
      this.markPhaseComplete('episode_architecture');
      if (acceptedResumedEpisodeBlueprint) {
        this.emit({ type: 'debug', phase: 'architecture', message: 'Resumed from durable episode blueprint checkpoint' });
      } else {
        this.addCheckpoint('Episode Blueprint', episodeBlueprint, true);
      }

      // Phase validation with retry loop for episode architecture
      if (this.phaseValidator.isEnabled() && !acceptedResumedEpisodeBlueprint) {
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
      await this.writeArtifactMemory({
        artifactKind: 'episode-blueprint',
        storyId: brief.story.title,
        episodeNumber: brief.episode.number,
        lifecycle: 'episode-architecture',
        agentRole: 'StoryArchitect',
        payload: episodeBlueprint,
        projection: {
          title: `${brief.story.title} episode ${brief.episode.number} blueprint`,
          summary: `Episode blueprint with ${episodeBlueprint.scenes?.length || 0} scene(s), ${episodeBlueprint.scenes?.filter((scene) => scene.choicePoint).length || 0} choice point(s), and ${episodeBlueprint.scenes?.filter((scene) => scene.isEncounter).length || 0} encounter scene(s).`,
          metrics: {
            sceneCount: episodeBlueprint.scenes?.length || 0,
            choicePointCount: episodeBlueprint.scenes?.filter((scene) => scene.choicePoint).length || 0,
            encounterSceneCount: episodeBlueprint.scenes?.filter((scene) => scene.isEncounter).length || 0,
          },
        },
      });
      await this.qualityCouncil?.runPlan({
        brief,
        sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
        seasonPlan: brief.seasonPlan,
        episodeBlueprint,
        notes: 'Single-episode checkpoint after episode architecture and before content generation.',
      });

      // === PHASE 3.5: BRANCH ANALYSIS ===
      this.emit({ type: 'phase_start', phase: 'branch_analysis', message: 'Phase 3.5: Analyzing branch structure' });
      this.requirePhases('branch_analysis', ['episode_architecture']);
      // Capture a definitely-assigned const for the closure: episodeBlueprint is a
      // `let` reassigned by the SceneConstructionGate architecture retry below, which
      // invalidates TS narrowing inside callbacks.
      const architectureBlueprint = episodeBlueprint;
      const branchAnalysis = await this.measurePhase('branch_analysis', () => this.runBranchAnalysis(brief, architectureBlueprint));
      this.markPhaseComplete('branch_analysis');
      if (branchAnalysis) {
        this.addCheckpoint('Branch Analysis', branchAnalysis, false);
        await this.writeArtifactMemory({
          artifactKind: 'branch-analysis',
          storyId: brief.story.title,
          episodeNumber: brief.episode.number,
          lifecycle: 'branch-analysis',
          agentRole: 'BranchManager',
          payload: branchAnalysis,
          projection: {
            title: `${brief.story.title} episode ${brief.episode.number} branch analysis`,
            summary: `Branch analysis with ${branchAnalysis.branchPaths?.length || 0} path(s), ${branchAnalysis.reconvergencePoints?.length || 0} reconvergence point(s), and ${branchAnalysis.recommendations?.length || 0} recommendation(s).`,
            metrics: {
              branchPathCount: branchAnalysis.branchPaths?.length || 0,
              reconvergencePointCount: branchAnalysis.reconvergencePoints?.length || 0,
              recommendationCount: branchAnalysis.recommendations?.length || 0,
            },
          },
        });
        
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
      const draftBlueprintFingerprint = episodeBlueprint.scenes.map((scene) => scene.id).join('|');
      const resumedSceneContent = readEpisodeDraftCheckpoint(
        this.getResumeOutput<unknown>(resumeCheckpoint, 'scene_content'),
        { episodeNumber: brief.episode.number, blueprintId: draftBlueprintFingerprint },
      );
      let contentGenerationResult: ContentGenerationResult;
      if (resumedSceneContent) {
        contentGenerationResult = {
          sceneContents: resumedSceneContent.sceneContents || [],
          choiceSets: resumedSceneContent.choiceSets || [],
          encounters: new Map<string, EncounterStructure>(resumedSceneContent.encounters || []),
          validationExecutionRecords: [],
        };
      } else {
        const contentOutcome = await this.runContentGenerationWithArchitectureRetry({
          brief,
          worldBible,
          characterBible,
          blueprint: episodeBlueprint,
          branchAnalysis: branchAnalysis || undefined,
          phaseLabel: 'content_generation',
          onArchitectureRetry: async (retryBlueprint) => {
            this.addCheckpoint('Episode Blueprint', retryBlueprint, true);
          },
        });
        episodeBlueprint = contentOutcome.blueprint;
        contentGenerationResult = contentOutcome.content;
      }
      const { sceneContents } = contentGenerationResult;
      ({ choiceSets, encounters } = contentGenerationResult);
      this.markPhaseComplete('content_generation');
      // Mark this single episode complete in the structure plan (covers the
      // resume path, where setSceneBeats never ran for the cached scenes).
      if (this.generationPlan) {
        markEpisode(this.generationPlan, brief.episode.number, 'complete');
        this.emitPlanUpdate('Episode content complete');
      }
      await this.qualityCouncil?.runChoice({
        brief,
        seasonPlan: brief.seasonPlan,
        episodeBlueprint,
        sceneContents,
        choiceSets,
        notes: 'Single-episode checkpoint after ChoiceAuthor and before quick validation.',
      });
      if (resumedSceneContent) {
        this.emit({ type: 'debug', phase: 'content', message: 'Resumed from durable scene content checkpoint' });
	      } else {
	        this.addCheckpoint(
	          'Scene Content',
	          buildEpisodeDraftCheckpoint({
	            episodeNumber: brief.episode.number,
	            blueprintId: draftBlueprintFingerprint,
	            sceneContents,
	            choiceSets,
	            encounters,
	          }),
	          true
	        );
	      }
	      this.writePipelineMemoryRecord({
	        kind: 'artifact',
	        dataset: `${this.config.memory?.runDatasetPrefix || 'storyrpg-run'}-${idSlugify(brief.story.title)}`,
	        title: `Episode ${brief.episode.number} content generation summary`,
	        text: [
	          `Episode: ${brief.episode.number} - ${brief.episode.title}`,
	          `Scenes authored: ${sceneContents.length}`,
	          `Choice sets authored: ${choiceSets.length}`,
	          `Encounters authored: ${encounters.size}`,
	          this.seasonThreadLedger.threads.length > 0 ? `Thread ledger entries: ${this.seasonThreadLedger.threads.length}` : null,
	          this.episodeTwistPlans.has(brief.episode.number) ? 'Twist plan: present' : null,
	          this.episodeArcTargets.has(brief.episode.number) ? 'Character arc targets: present' : null,
	        ].filter(Boolean).join('\n'),
	        metadata: {
	          episodeNumber: brief.episode.number,
          sceneIds: sceneContents.map((scene) => scene.sceneId),
	          choiceBeatIds: choiceSets.map((choiceSet) => choiceSet.beatId),
	          encounterIds: Array.from(encounters.keys()),
	          threadLedger: this.seasonThreadLedger.threads.length > 0 ? this.seasonThreadLedger : undefined,
	          twistPlan: this.episodeTwistPlans.get(brief.episode.number),
	          arcTargets: this.episodeArcTargets.get(brief.episode.number),
	        },
	        nodeSet: ['content-generation', 'agent-output', `episode-${brief.episode.number}`],
	      }).catch(() => {});
	      await Promise.all([
	        ...sceneContents.map((scene) => this.writeArtifactMemory({
	          artifactKind: 'scene-content' as const,
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          sceneId: scene.sceneId,
	          lifecycle: 'scene-authoring',
	          agentRole: 'SceneWriter',
	          characterIds: scene.charactersInvolved || [],
	          payload: scene,
	          projection: {
	            title: `${brief.story.title} ${scene.sceneName || scene.sceneId}`,
	            summary: `Scene content ${scene.sceneId} with ${scene.beats?.length || 0} beat(s).`,
	            metrics: { beatCount: scene.beats?.length || 0 },
	          },
	        })),
	        ...choiceSets.map((choiceSet) => this.writeArtifactMemory({
	          artifactKind: 'choice-set' as const,
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          sceneId: choiceSet.sceneId,
	          lifecycle: 'choice-authoring',
	          agentRole: 'ChoiceAuthor',
	          payload: choiceSet,
	          projection: {
	            title: `${brief.story.title} choice set ${choiceSet.beatId}`,
	            summary: `Choice set for beat ${choiceSet.beatId} with ${choiceSet.choices?.length || 0} choice(s).`,
	            metrics: { choiceCount: choiceSet.choices?.length || 0 },
	          },
	        })),
	        ...Array.from(encounters.entries()).map(([sceneId, encounter]) => this.writeArtifactMemory({
	          artifactKind: 'encounter-structure' as const,
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          sceneId,
	          lifecycle: 'encounter-authoring',
	          agentRole: 'EncounterArchitect',
	          payload: encounter,
	          projection: {
	            title: `${brief.story.title} encounter ${sceneId}`,
	            summary: `Encounter structure for scene ${sceneId}.`,
	            metrics: {},
	          },
	        })),
	        this.seasonThreadLedger.threads.length > 0 ? this.writeArtifactMemory({
	          artifactKind: 'thread-ledger',
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          lifecycle: 'thread-planning',
	          agentRole: 'ThreadPlanner',
	          payload: this.seasonThreadLedger,
	          projection: {
	            title: `${brief.story.title} thread ledger`,
	            summary: `Season thread ledger with ${this.seasonThreadLedger.threads.length} thread(s).`,
	            metrics: { threadCount: this.seasonThreadLedger.threads.length },
	          },
	        }) : Promise.resolve(),
	        this.episodeTwistPlans.has(brief.episode.number) ? this.writeArtifactMemory({
	          artifactKind: 'twist-plan',
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          lifecycle: 'twist-planning',
	          agentRole: 'TwistArchitect',
	          payload: this.episodeTwistPlans.get(brief.episode.number),
	          projection: {
	            title: `${brief.story.title} episode ${brief.episode.number} twist plan`,
	            summary: `Twist plan adopted for episode ${brief.episode.number}.`,
	            metrics: {},
	          },
	        }) : Promise.resolve(),
	        this.episodeArcTargets.has(brief.episode.number) ? this.writeArtifactMemory({
	          artifactKind: 'arc-targets',
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          lifecycle: 'character-arc-planning',
	          agentRole: 'CharacterArcTracker',
	          payload: this.episodeArcTargets.get(brief.episode.number),
	          projection: {
	            title: `${brief.story.title} episode ${brief.episode.number} arc targets`,
	            summary: `Character arc targets adopted for episode ${brief.episode.number}.`,
	            metrics: {},
	          },
	        }) : Promise.resolve(),
	      ]);

	      // === PHASE 4.5: QUICK VALIDATION ===
      // Extracted to phases/QuickValidationPhase.ts (pure move): the fast
      // validator gate, incremental POV/voice escalation, targeted repair
      // (ChoiceAuthor + scoped SceneWriter rewrites), one re-validation, and
      // the blocking ValidationError. Repairs mutate sceneContents/choiceSets
      // in place via the shared array refs.
	      const quickMemoryEvidence = await this.recallValidatorEvidence(
	        'IntegratedBestPracticesValidator',
	        'quick-validation',
	        brief,
	        { artifactKinds: ['scene-content', 'choice-set', 'encounter-structure'] },
	      );
	      const quickValidation = await this.quickValidationPhase().run(
	        { brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, encounters },
	        {
	          config: this.config,
	          emit: this.emit.bind(this),
	          addCheckpoint: this.addCheckpoint.bind(this),
	        }
	      );
	      if (quickValidation) {
	        quickValidation.memoryEvidence = [
	          this.validatorEvidenceService().summarize(quickMemoryEvidence, 'advisory-memory'),
	        ];
	        await this.writeArtifactMemory({
	          artifactKind: 'quick-validation-report',
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          lifecycle: 'quick-validation',
	          validator: 'IntegratedBestPracticesValidator',
	          payload: quickValidation,
	          projection: {
	            title: `${brief.story.title} episode ${brief.episode.number} quick validation`,
	            summary: `Quick validation ${quickValidation.canProceed ? 'passed' : 'failed'} with ${quickValidation.blockingIssues.length} blocking issue(s) and ${quickValidation.warningCount} warning(s).`,
	            metrics: {
	              canProceed: quickValidation.canProceed,
	              blockingIssueCount: quickValidation.blockingIssues.length,
	              warningCount: quickValidation.warningCount,
	            },
	          },
	        });
	        this.writeValidatorMemory({
	          validator: 'IntegratedBestPracticesValidator',
	          lifecycle: 'quick-validation',
	          stage: 'quick_validation',
	          severity: quickValidation.blockingIssues.length > 0 ? 'blocking' : quickValidation.warningCount > 0 ? 'warning' : 'pass',
	          outcome: quickValidation.canProceed ? 'passed' : 'failed',
	          storyId: brief.story.title,
	          repairRoute: 'quick-validation-repair',
	          findings: {
	            blockingIssues: quickValidation.blockingIssues.slice(0, 20),
	            warningCount: quickValidation.warningCount,
	            executionRecords: quickValidation.executionRecords,
	            memoryEvidence: quickValidation.memoryEvidence,
	          },
	        }).catch(() => {});
	      }
      await this.flushPipelineMemory(brief.story.title, 'episode');

      // === PHASE 5: QUALITY ASSURANCE ===
      await this.checkCancellation();
      let finalStoryContractReport: FinalStoryContractReport | undefined;

      // QA phase extracted to phases/QAPhase.ts (pure move): QARunner + best
      // practices in parallel, the choice-distribution checkpoint, the
      // QA-driven targeted repair loop, and the threshold warning. Repairs
	      // mutate sceneContents/choiceSets in place via the shared array refs.
	      const qaMemoryEvidence = await this.recallValidatorEvidence(
	        'IntegratedBestPracticesValidator',
	        'full-qa',
	        brief,
	        { artifactKinds: ['scene-content', 'choice-set', 'encounter-structure', 'qa-report'] },
	      );
	      const { qaReport, bestPracticesReport } = await this.qaPhase().run(
	        { brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, encounters },
	        {
	          config: this.config,
	          emit: this.emit.bind(this),
	          addCheckpoint: this.addCheckpoint.bind(this),
	        }
	      );
	      if (bestPracticesReport) {
	        bestPracticesReport.memoryEvidence = [
	          this.validatorEvidenceService().summarize(qaMemoryEvidence, 'advisory-memory'),
	        ];
	        await this.writeArtifactMemory({
	          artifactKind: 'qa-report',
	          storyId: brief.story.title,
	          episodeNumber: brief.episode.number,
	          lifecycle: 'full-qa',
	          validator: 'IntegratedBestPracticesValidator',
	          payload: bestPracticesReport,
	          projection: {
	            title: `${brief.story.title} episode ${brief.episode.number} QA report`,
	            summary: `QA report score ${bestPracticesReport.overallScore}; ${bestPracticesReport.blockingIssues.length} blocking issue(s), ${bestPracticesReport.warnings.length} warning(s), ${bestPracticesReport.suggestions.length} suggestion(s).`,
	            metrics: {
	              overallPassed: bestPracticesReport.overallPassed,
	              overallScore: bestPracticesReport.overallScore,
	              blockingIssueCount: bestPracticesReport.blockingIssues.length,
	              warningCount: bestPracticesReport.warnings.length,
	              suggestionCount: bestPracticesReport.suggestions.length,
	            },
	          },
	        });
	        this.writeValidatorMemory({
	          validator: 'IntegratedBestPracticesValidator',
	          lifecycle: 'full-qa',
	          stage: 'qa',
	          severity: bestPracticesReport.blockingIssues.length > 0 ? 'blocking' : bestPracticesReport.warnings.length > 0 ? 'warning' : 'pass',
	          outcome: bestPracticesReport.overallPassed ? 'passed' : 'failed',
	          storyId: brief.story.title,
	          repairRoute: 'qa-repair',
	          findings: {
	            overallScore: bestPracticesReport.overallScore,
	            blockingIssues: bestPracticesReport.blockingIssues.slice(0, 20),
	            warnings: bestPracticesReport.warnings.slice(0, 20),
	            suggestions: bestPracticesReport.suggestions.slice(0, 10),
	            executionRecords: bestPracticesReport.executionRecords,
	            memoryEvidence: bestPracticesReport.memoryEvidence,
	          },
	        }).catch(() => {});
	      }
      await this.flushPipelineMemory(brief.story.title, 'qa');

      await this.repairWeakCliffhangerBeforeImages(
        brief,
        worldBible,
        characterBible,
        episodeBlueprint,
        sceneContents,
        choiceSets,
        encounters,
      );

      // === PHASE 5.5: RUN SETUP (output directory, asset registry, branch repair) ===
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
        const artifactRuntime = await new RunArtifactPhase({
          createOutputDirectory,
          ensureDirectory,
          save: saveEarlyDiagnostic,
          load: loadEarlyDiagnosticSync,
        }).run(
          { storyTitle: brief.story.title, resumeOutputDirectory: resumedOutputDir },
          {
            config: this.config,
            emit: this.emit.bind(this),
            addCheckpoint: this.addCheckpoint.bind(this),
          },
        );
        outputDirectory = artifactRuntime.outputDirectory;
        const savedStoryPackage = loadEarlyDiagnosticSync<{ generator?: Record<string, unknown>; story?: Story } | Story>(outputDirectory, 'story.json');
        this.hydrateSeasonImageStyleFromStoryPackage(savedStoryPackage);
        this.applyActiveImageStyleToRuntime();
        this.resetAssetRegistry(idSlugify(brief.story.title));
        await this.recordArcPressureShadowSafe(brief.seasonPlan, idSlugify(brief.story.title));
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
          choiceSets,
          residueRepair: { sceneContents, reassemble: () => this.assembleEpisode(brief, worldBible, characterBible, episodeBlueprint, sceneContents, choiceSets, undefined, encounters, undefined, videoResults) },
        });
      } catch (setupError) {
        await rethrowAsImagePhaseFailure(setupError, {
          isLlmQuotaFailure: (err) => this.isLlmQuotaFailure(err),
          emit: this.emit.bind(this),
          outputDirectory,
        });
      }

      // === PHASE 6: TEXT ASSEMBLY (contract-first: runs BEFORE media spend) ===
      // Extracted to phases/AssemblyPhase.ts: assembly + registry asset merge,
      // structural/craft auto-fix, template resolution, and the deterministic
      // flag-chronology/quote-recall scans (which escalate onto qaReport in
      // place). The media completeness pass (image gate, asset HTTP checks,
      // imagesStatus stamp) runs after media generation + binding below.
      story = await this.assemblyPhase().runTextAssembly(
        {
          brief, worldBible, characterBible, episodeBlueprint, sceneContents,
          choiceSets, encounters, outputDirectory, qaReport,
        },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );
      await this.writeArtifactMemory({
        artifactKind: 'story-json',
        storyId: brief.story.title,
        episodeNumber: brief.episode.number,
        lifecycle: 'assembly',
        payload: story,
        projection: {
          title: `${story.title || brief.story.title} story JSON`,
          summary: `Assembled story JSON with ${story.episodes?.length || 0} episode(s).`,
          metrics: {
            episodeCount: story.episodes?.length || 0,
            npcCount: story.npcs?.length || 0,
          },
        },
      });

      // B2 / R0.10: snapshot before final gates so single-episode aborts still
      // leave a diagnostic/resume artifact (multi-episode already snapshots later).
      if (outputDirectory) {
        await savePartialStory(outputDirectory, story);
      }

      finalStoryContractReport = await this.enforceFinalStoryContract({
        story,
        brief,
        requestedEpisodeNumbers: [brief.episode.number],
        qaReport,
        bestPracticesReport,
        phase: 'final_story_contract',
        validationScope: {
          mode: 'generated-slice',
          requestedEpisodeNumbers: [brief.episode.number],
          generatedEpisodeNumbers: story.episodes?.map((episode) => episode.number).filter((n): n is number => typeof n === 'number') ?? [brief.episode.number],
          generatedThroughEpisode: brief.episode.number,
        },
      });
      await this.qualityCouncil?.runRoutePlaytest({
        brief,
        story,
        episodeBlueprint,
        choiceSets,
        finalStoryContractReport,
        notes: 'Single-episode route playtest after final story contract validation.',
      });
      await this.qualityCouncil?.runFinal({
        brief,
        story,
        qaReport,
        bestPracticesReport,
        finalStoryContractReport,
        notes: 'Single-episode final council audit before saving.',
      });
      this.enforceQualityCouncilStrictMode('quality_council_final');

      // === PHASE 6.5: IMAGE GENERATION (single-episode mode; after the text contract passed) ===
      await this.checkCancellation();
      try {
        // Set image service output directory to story's images folder
        if (this.config.imageGen?.enabled) {
          this.requirePhases('images', ['content_generation']);
          await this.getScopedAgentMemoryContext('ImageAgentTeam', 'image-generation', brief, {
            artifactKinds: ['style-bible', 'character-bible', 'scene-content', 'image-diagnostics'],
            characterIds: characterBible.characters.map((character) => character.id),
          });
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
          await this.agentMemoryContextBuilder().writeOutcome({
            role: 'ImageAgentTeam',
            lifecycle: 'image-generation',
            storyId: brief.story.title,
            episodeNumber: brief.episode?.number,
            artifactKinds: ['image-diagnostics'],
            outcome: 'completed',
            summary: `Image generation completed with ${imageResults?.beatImages?.size || 0} beat image(s), ${imageResults?.sceneImages?.size || 0} scene image(s), and ${encounterImageDiagnostics.length} encounter diagnostic record(s).`,
            payload: {
              beatImageCount: imageResults?.beatImages?.size || 0,
              sceneImageCount: imageResults?.sceneImages?.size || 0,
              encounterDiagnosticCount: encounterImageDiagnostics.length,
            },
          });
          await this.writeArtifactMemory({
            artifactKind: 'image-diagnostics',
            storyId: brief.story.title,
            episodeNumber: brief.episode?.number,
            lifecycle: 'image-generation',
            agentRole: 'ImageAgentTeam',
            payload: {
              beatImageCount: imageResults?.beatImages?.size || 0,
              sceneImageCount: imageResults?.sceneImages?.size || 0,
              encounterDiagnosticCount: encounterImageDiagnostics.length,
              encounterImageDiagnostics,
            },
            projection: {
              title: `${brief.story.title} episode ${brief.episode.number} image diagnostics`,
              summary: `Image diagnostics with ${imageResults?.beatImages?.size || 0} beat image(s), ${imageResults?.sceneImages?.size || 0} scene image(s), and ${encounterImageDiagnostics.length} encounter diagnostic record(s).`,
              metrics: {
                beatImageCount: imageResults?.beatImages?.size || 0,
                sceneImageCount: imageResults?.sceneImages?.size || 0,
                encounterDiagnosticCount: encounterImageDiagnostics.length,
              },
            },
          });
          this.markPhaseComplete('images');
        }

        this.seedAssetRegistryFromResults(brief, sceneContents, encounters, imageResults, encounterImageResults);
        await saveEarlyDiagnostic(outputDirectory as string, '08-registry-state.json', this.assetRegistry.toSnapshot());
      } catch (imgError) {
        // Fail fast on provider quota exhaustion to avoid silently degraded outputs.
        await rethrowAsImagePhaseFailure(imgError, {
          isLlmQuotaFailure: (err) => this.isLlmQuotaFailure(err),
          emit: this.emit.bind(this),
          outputDirectory,
        });
      }

      // === PHASE 5.7: VIDEO GENERATION (optional) ===
      await this.checkCancellation();
      if (this.config.videoGen?.enabled && imageResults?.beatImages && imageResults.beatImages.size > 0) {
        this.requirePhases('video_generation', ['images']);
        this.emit({ type: 'phase_start', phase: 'video_generation', message: 'Phase 5.7: Generating video animations from still images...' });
        await this.getScopedAgentMemoryContext('VideoDirectorAgent', 'video-generation', brief, {
          artifactKinds: ['scene-content', 'image-results', 'video-diagnostics'],
        });
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
          await this.agentMemoryContextBuilder().writeOutcome({
            role: 'VideoDirectorAgent',
            lifecycle: 'video-generation',
            storyId: brief.story.title,
            episodeNumber: brief.episode?.number,
            artifactKinds: ['video-diagnostics'],
            outcome: 'completed',
            summary: `Video generation completed with ${videoResults?.size || 0} clip(s).`,
            payload: { videoCount: videoResults?.size || 0, diagnostics: videoDiagnostics },
          });
          await this.writeArtifactMemory({
            artifactKind: 'video-diagnostics',
            storyId: brief.story.title,
            episodeNumber: brief.episode?.number,
            lifecycle: 'video-generation',
            agentRole: 'VideoDirectorAgent',
            payload: { videoCount: videoResults?.size || 0, diagnostics: videoDiagnostics },
            projection: {
              title: `${brief.story.title} episode ${brief.episode.number} video diagnostics`,
              summary: `Video diagnostics with ${videoResults?.size || 0} generated clip(s) and ${videoDiagnostics.length} diagnostic record(s).`,
              metrics: {
                videoCount: videoResults?.size || 0,
                diagnosticCount: videoDiagnostics.length,
              },
            },
          });

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

      // === MEDIA BINDING + COMPLETENESS (post-media pass) ===
      // Bind the just-generated media into the contract-passed story WITHOUT
      // re-assembling from sceneContents (which would discard the contract's
      // in-place repairs), then run the media completeness gate, asset HTTP
      // verification, and imagesStatus stamp (phases/AssemblyPhase.ts).
      story = bindStoryMediaAssets(story, {
        assetRegistry: this.assetRegistry,
        storyCoverUrl,
        applyCoverToEpisodes: true,
        videoResults,
        imageAgentTeam: this.imageAgentTeam,
      });
      story = await this.assemblyPhase().runMediaCompleteness(
        story,
        { outputDirectory },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        }
      );

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
              qualityCouncilReport: this.qualityCouncil?.getReport(),
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
      // gate condition, events, diagnostics, and the story.json package rewrite
      // all live there now.
      await this.getScopedAgentMemoryContext('AudioGenerationService', 'audio-generation', brief, {
        artifactKinds: ['story-json', 'character-bible', 'audio-diagnostics'],
        characterIds: characterBible.characters.map((character) => character.id),
      });
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
      await this.agentMemoryContextBuilder().writeOutcome({
        role: 'AudioGenerationService',
        lifecycle: 'audio-generation',
        storyId: brief.story.title,
        episodeNumber: brief.episode?.number,
        artifactKinds: ['audio-diagnostics'],
        outcome: 'completed',
        summary: `Audio phase completed with ${audioDiagnostics.length} diagnostic record(s).`,
        payload: { diagnosticCount: audioDiagnostics.length, diagnostics: audioDiagnostics },
      });
      await this.writeArtifactMemory({
        artifactKind: 'audio-diagnostics',
        storyId: brief.story.title,
        episodeNumber: brief.episode?.number,
        lifecycle: 'audio-generation',
        agentRole: 'AudioGenerationService',
        payload: { diagnosticCount: audioDiagnostics.length, diagnostics: audioDiagnostics },
        projection: {
          title: `${brief.story.title} episode ${brief.episode.number} audio diagnostics`,
          summary: `Audio diagnostics with ${audioDiagnostics.length} diagnostic record(s).`,
          metrics: { diagnosticCount: audioDiagnostics.length },
        },
      });

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

      // R0.10: never discard assembled work on abort — even if final gates never ran.
      if (outputDirectory && story) {
        try {
          await savePartialStory(outputDirectory, story);
        } catch (partialErr) {
          this.emit({
            type: 'warning',
            phase: 'save',
            message: `Failed to write partial-story.json on abort: ${partialErr instanceof Error ? partialErr.message : String(partialErr)}`,
          });
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
    const agentConfig = this.config.agents.storyArchitect;
    const identity = buildFoundationCacheIdentity({
      kind: 'world_bible',
      brief,
      provider: agentConfig.provider,
      model: agentConfig.model,
    });
    const cacheDir = defaultFoundationCacheDir();
    const cached = readFoundationArtifact<WorldBible>(cacheDir, identity);
    if (cached) {
      this.emit({ type: 'debug', phase: 'world', message: 'Hydrated world bible from foundation artifact cache' });
      return cached;
    }
    const memoryContext = await this.getScopedAgentMemoryContext('WorldBuilder', 'world-building', brief, {
      artifactKinds: ['source-analysis', 'season-plan'],
    });
    const worldBible = await new WorldBuildingPhase(this.worldBuilder).run(
      {
        story: brief.story,
        userPrompt: brief.userPrompt,
        world: brief.world,
        startingLocationId: brief.episode.startingLocation,
        rawDocument: brief.rawDocument,
        memoryContext: memoryContext || undefined,
        locationIntroductions: brief.seasonPlan?.locationIntroductions,
        debug: this.config.debug,
      },
      {
        config: this.config,
        emit: this.emit.bind(this),
        addCheckpoint: this.addCheckpoint.bind(this),
      }
    );
    writeFoundationArtifact(cacheDir, identity, worldBible);
    return worldBible;
  }

  // Extracted to phases/CharacterDesignPhase.ts (pure move). Thin delegating
  // wrapper keeps all three call sites (initial design, PhaseValidator retry,
  // the NPC-depth Karpathy retry) unchanged; cachedPipelineMemory is
  // accessor-backed.
  private async runCharacterDesign(
    brief: FullCreativeBrief,
    worldBible: WorldBible
  ): Promise<CharacterBible> {
    const agentConfig = this.config.agents.storyArchitect;
    const identity = buildFoundationCacheIdentity({
      kind: 'character_bible',
      brief,
      provider: agentConfig.provider,
      model: agentConfig.model,
    });
    const cacheDir = defaultFoundationCacheDir();
    const cached = readFoundationArtifact<CharacterBible>(cacheDir, identity);
    if (cached) {
      this.emit({ type: 'debug', phase: 'characters', message: 'Hydrated character bible from foundation artifact cache' });
      return cached;
    }
    const memoryContext = await this.getScopedAgentMemoryContext('CharacterDesigner', 'character-design', brief, {
      artifactKinds: ['source-analysis', 'world-bible'],
      characterIds: [brief.protagonist.id, ...brief.npcs.map((npc) => npc.id)],
    });
    const deps = { characterDesigner: this.characterDesigner } satisfies Partial<CharacterDesignPhaseDeps> as unknown as CharacterDesignPhaseDeps;
    Object.defineProperties(deps, {
      cachedPipelineMemory: { get: () => memoryContext || this.renderedPipelineMemory },
    });
    const characterBible = await new CharacterDesignPhase(deps).run(brief, worldBible, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
    writeFoundationArtifact(cacheDir, identity, characterBible);
    return characterBible;
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
    const memoryContext = await this.getScopedAgentMemoryContext('StoryArchitect', 'episode-architecture', brief, {
      artifactKinds: ['source-analysis', 'season-plan', 'world-bible', 'character-bible'],
      characterIds: characterBible.characters.map((character) => character.id),
    });
    const deps = {
      storyArchitect: this.storyArchitect,
      emitPlanUpdate: this.emitPlanUpdate.bind(this),
      getTargetBeatCountForScene: this.getTargetBeatCountForScene.bind(this),
      recordGateShadowSafe: this.recordGateShadowSafe.bind(this),
    } satisfies Partial<EpisodeArchitecturePhaseDeps> as unknown as EpisodeArchitecturePhaseDeps;
    Object.defineProperties(deps, {
      cachedPipelineMemory: { get: () => memoryContext || this.renderedPipelineMemory },
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
    if (sceneBlueprint.recommendedBeatCount) {
      return clampTargetBeatCount(sceneBlueprint.recommendedBeatCount, cap);
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
    const memoryContext = await this.getScopedAgentMemoryContext('BranchManager', 'branch-analysis', brief, {
      artifactKinds: ['episode-blueprint', 'branch-analysis'],
      recallMode: 'facts-first',
    });
    const deps = { branchManager: this.branchManager } satisfies Partial<BranchAnalysisPhaseDeps> as unknown as BranchAnalysisPhaseDeps;
    Object.defineProperties(deps, {
      branchShadowDiffs: { get: () => this.branchShadowDiffs },
      memoryContext: { get: () => memoryContext },
    });
    const result = await new BranchAnalysisPhase(deps).run(brief, blueprint, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    });
    if (result) {
      await this.agentMemoryContextBuilder().writeOutcome({
        role: 'BranchManager',
        lifecycle: 'branch-analysis',
        storyId: brief.story.title,
        episodeNumber: brief.episode?.number,
        artifactIds: ['branch-analysis'],
        outcome: 'adopted',
        summary: 'Branch analysis adopted by the generation pipeline.',
        payload: result,
      });
    }
    return result;
  }

  /** Re-run architecture once after a SceneConstructionGate abort; a second
   * abort still fails fast. GATE_SCENE_CONSTRUCTION_ARCH_RETRY=0 disables it. */
  private async runContentGenerationWithArchitectureRetry(params: {
    brief: FullCreativeBrief;
    worldBible: WorldBible;
    characterBible: CharacterBible;
    blueprint: EpisodeBlueprint;
    branchAnalysis?: BranchAnalysis;
    outputDirectory?: string;
    episodeNumber?: number;
    phaseLabel: string;
    onArchitectureRetry?: (blueprint: EpisodeBlueprint, branchAnalysis: BranchAnalysis | undefined) => Promise<void>;
  }): Promise<{
    content: ContentGenerationResult;
    blueprint: EpisodeBlueprint;
    branchAnalysis?: BranchAnalysis;
  }> {
    const { brief, worldBible, characterBible, outputDirectory, episodeNumber, phaseLabel } = params;
    try {
      const content = await this.measurePhase(phaseLabel, () => this.runContentGeneration(
        brief, worldBible, characterBible, params.blueprint, params.branchAnalysis, outputDirectory, episodeNumber,
      ));
      return { content, blueprint: params.blueprint, branchAnalysis: params.branchAnalysis };
    } catch (error) {
      const isGateAbort = error instanceof PipelineError && error.code === 'scene_construction_conflict';
      if (!isGateAbort || !isGateEnabled('GATE_SCENE_CONSTRUCTION_ARCH_RETRY')) throw error;
      this.emit({
        type: 'regeneration_triggered',
        phase: 'architecture',
        message: `SceneConstructionGate blocked content generation; re-running episode architecture once before aborting: ${(error as Error).message.slice(0, 400)}`,
      });
      const blueprint = await this.measurePhase(
        `${phaseLabel}_architecture_retry`,
        () => this.runEpisodeArchitecture(brief, worldBible, characterBible),
      );
      const branchAnalysis = (await this.measurePhase(
        `${phaseLabel}_branch_analysis_retry`,
        () => this.runBranchAnalysis(brief, blueprint),
      )) || undefined;
      await params.onArchitectureRetry?.(blueprint, branchAnalysis);
      const content = await this.measurePhase(`${phaseLabel}_retry`, () => this.runContentGeneration(
        brief, worldBible, characterBible, blueprint, branchAnalysis, outputDirectory, episodeNumber,
      ));
      return { content, blueprint, branchAnalysis };
    }
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
  ): Promise<ContentGenerationResult> {
    const deps = {
      sceneWriter: this.sceneWriter,
      choiceAuthor: this.choiceAuthor,
      encounterArchitect: this.encounterArchitect,
      semanticRealizationJudge: this.semanticRealizationJudge,
      getThreadPlanner: () => this.getThreadPlanner(),
      getTwistArchitect: () => this.getTwistArchitect(),
      getCharacterArcTracker: () => this.getCharacterArcTracker(),
      getAgentMemoryContext: this.getAgentMemoryContext.bind(this),
      writeAgentOutcome: this.agentMemoryContextBuilder().writeOutcome.bind(this.agentMemoryContextBuilder()),
      assertSceneDependencyInvariants: this.assertSceneDependencyInvariants.bind(this),
      buildBranchFallbackChoiceSet: this.buildBranchFallbackChoiceSet.bind(this),
      buildDeterministicChoiceSet: (sceneBlueprint, choiceBeat) =>
        choiceBeat ? this.createFallbackChoiceSet(sceneBlueprint, choiceBeat) : undefined,
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
      canLoadResumeUnit: (resumeEpisodeNumber, unitId) => {
        if (typeof resumeEpisodeNumber !== 'number') return true;
        if (!this.invalidatedResumeEpisodes.has(resumeEpisodeNumber)) return true;
        this.emit({
          type: 'debug',
          phase: 'resume',
          message: `Skipped stale resume unit ${unitId} for invalidated episode ${resumeEpisodeNumber}.`,
        });
        return false;
      },
      loadResumeUnit: this.loadResumeUnit.bind(this),
      recordRemediationSafe: this.recordRemediationSafe.bind(this),
      recordSceneValidationResult: this.recordSceneValidationResult.bind(this),
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
      cachedPipelineMemory: { get: () => this.renderedPipelineMemory },
      callbackLedger: { get: () => this.callbackLedger },
      dependencySchedulerStats: { get: () => this.dependencySchedulerStats },
      episodeTwistPlans: { get: () => this.episodeTwistPlans },
      episodeArcTargets: { get: () => this.episodeArcTargets },
      generationPlan: { get: () => this.generationPlan },
      remediationBudget: { get: () => this.remediationBudget },
      seasonChoicePlan: { get: () => this.seasonChoicePlan },
      plannedChoiceTypesByScene: {
        get: () => this.plannedChoiceTypesByScene,
        set: (value) => { this.plannedChoiceTypesByScene = value; },
      },
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
    blueprint: EpisodeBlueprint,
    encounters?: Map<string, EncounterStructure>,
  ): Promise<QAReport> {
    return this.qaPhase().runQualityAssurance(brief, sceneContents, choiceSets, characterBible, blueprint, {
      config: this.config,
      emit: this.emit.bind(this),
      addCheckpoint: this.addCheckpoint.bind(this),
    }, encounters);
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
      getAgentMemoryContext: this.getAgentMemoryContext.bind(this),
    } satisfies Partial<QAPhaseDeps> as unknown as QAPhaseDeps;
    // Accessor-backed run-scoped state: reads on the phase side always see
    // the pipeline's current values.
    Object.defineProperties(deps, {
      incrementalValidator: { get: () => this.incrementalValidator },
      sceneValidationResults: { get: () => this.sceneValidationResults },
      cachedPipelineMemory: { get: () => this.renderedPipelineMemory },
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
      getAgentMemoryContext: this.getAgentMemoryContext.bind(this),
    } satisfies Partial<QuickValidationPhaseDeps> as unknown as QuickValidationPhaseDeps;
    // Accessor-backed run-scoped state: reads on the phase side always see
    // the pipeline's current values.
    Object.defineProperties(deps, {
      sceneValidationResults: { get: () => this.sceneValidationResults },
      cachedPipelineMemory: { get: () => this.renderedPipelineMemory },
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
    options?: ContinuityRepairOptions,
  ): Promise<void> {
    return this.sceneCriticContinuity().repairContinuityFindings(
      story, sceneContents, characterBible, qaReport, outputDirectory, blueprint, options,
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
      const doesNotKnow: string[] = [];
      for (const other of characters) {
        if (other.id === c.id) continue;
        // Character-bible relationships describe season potential, not proof
        // that the relationship is already known on page. Treating every
        // relationship as initial knowledge makes a scheduled visual plant
        // (for example, a stranger seen at a distance) impossible knowledge.
        // The continuity checker should derive actual introductions from the
        // ordered scene prose instead.
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
      // Structured presence constraints (species daylight rules etc.) so
      // final-contract validators can check character presence against a
      // scene's time-of-day without re-reading the character bible.
      species: c.species,
      timeOfDayConstraints: c.timeOfDayConstraints,
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

  private enforceQualityCouncilStrictMode(phase: string): void {
    const blockingFindings = this.qualityCouncil?.getStrictBlockingFindings() || [];
    if (blockingFindings.length === 0) return;
    const summary = blockingFindings
      .map((finding) => `[${finding.validatorMapping}] ${finding.evidence[0] || finding.category}`)
      .join('; ');
    throw new PipelineError(
      `Quality Council strict mode blocked the run: ${summary}`,
      phase,
      { context: { blockingFindings } },
    );
  }

  private resetQualityCouncil(): void {
    this.qualityCouncil = this.config.qualityCouncil?.enabled
      ? new QualityCouncilRunner({
          config: this.config,
          emit: this.emit.bind(this),
        })
      : undefined;
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

    const memoryContext = await this.getAgentMemoryContext({
      agentRole: 'SourceMaterialAnalyzer',
      lifecycle: 'source-analysis',
      storyId: title,
      treatmentId: title,
      artifactKinds: ['source-analysis'],
    });
    const result = await withTimeoutAbort((signal) => this.sourceMaterialAnalyzer.execute({
      sourceText: sourceText || '',
      title,
      preferences,
      userPrompt,
      memoryContext: memoryContext || undefined,
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
    await this.writeArtifactMemory({
      artifactKind: 'source-analysis',
      storyId: title || analysis.sourceTitle || 'untitled-source',
      lifecycle: 'source-analysis',
      agentRole: 'SourceMaterialAnalyzer',
      sourceFingerprint: analysis.sourceTitle,
      payload: analysis,
      projection: {
        title: `${analysis.sourceTitle || title || 'Source'} analysis`,
        summary: `Source analysis for ${analysis.totalEstimatedEpisodes} episode(s), ${analysis.episodeBreakdown?.length || 0} outline(s), confidence ${analysis.confidenceScore}.`,
        metrics: {
          totalEstimatedEpisodes: analysis.totalEstimatedEpisodes,
          episodeOutlineCount: analysis.episodeBreakdown?.length || 0,
          confidenceScore: analysis.confidenceScore,
        },
      },
    });

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
    this.armRealizationPovContext(baseBrief);
    BaseAgent.resetBillingQuotaState(); // WS1b: stale quota latch must not poison a resumed run
    analysis = this.refreshAnalysisFromTreatmentDocument(analysis, baseBrief.rawDocument);
    baseBrief = this.refreshBriefSeasonPlanFromAnalysis(baseBrief, analysis);
    if (baseBrief.seasonPlan && isSceneFirstPlanningEnabled()) {
      baseBrief = {
        ...baseBrief,
        seasonPlan: rebuildTreatmentSeasonScenePlan(baseBrief.seasonPlan),
      };
    }
    const semanticScenePlan = baseBrief.seasonPlan?.scenePlan;
    const semanticGraph = semanticScenePlan?.narrativeContractGraph;
    const hasDepictionEvents = semanticGraph?.events
      .some((event) => event.realizationMode === 'depiction');
    if (hasDepictionEvents && !semanticScenePlan?.semanticEventIr) {
      throw new PipelineError(
        'Season plan has depiction events but no persisted semantic contract IR. Re-run story analysis so the SemanticContractCompiler can compile source-grounded claims before episode generation.',
        'season_planning',
        {
          agent: 'SemanticContractCompiler',
          failure: {
            code: 'season_graph_invalid',
            ownerStage: 'season_plan',
            retryClass: 'none',
            issueCodes: ['semantic_contract_ir_missing'],
            repairTarget: 'season-plan',
          },
          context: {
            graphSourceHash: semanticScenePlan?.narrativeContractGraph?.sourceHash,
            compilerVersion: semanticScenePlan?.narrativeContractGraph?.compilerVersion,
          },
        },
      );
    }
    if (hasDepictionEvents && semanticScenePlan?.semanticEventIr && semanticGraph) {
      const knownLocations = collectKnownSemanticLocations(
        semanticGraph.knownLocationNames ?? [],
        baseBrief.world?.keyLocations?.map((location) => location.name) ?? [],
        semanticScenePlan.scenes.flatMap((scene) => scene.locations ?? []),
      );
      const semanticValidation = validateAuthoredEventSemanticIR(
        semanticScenePlan.semanticEventIr,
        semanticContractEventSeeds(semanticGraph),
        knownLocations,
        semanticContractPremiseSeeds(semanticGraph),
      );
      const graphIrMatches = stableHash(semanticGraph.semanticEventIr) === stableHash(semanticScenePlan.semanticEventIr);
      if (!semanticValidation.passed || !graphIrMatches) {
        throw new PipelineError(
          `Season plan semantic contract IR failed preflight: ${[
            ...semanticValidation.issues,
            ...(!graphIrMatches ? ['Scene-plan IR does not match the graph-embedded IR.'] : []),
          ].join(' | ')}`,
          'season_planning',
          {
            agent: 'SemanticContractCompiler',
            failure: {
              code: 'season_graph_invalid',
              ownerStage: 'season_plan',
              retryClass: 'none',
              issueCodes: ['semantic_contract_ir_invalid'],
              repairTarget: 'season-plan',
            },
            context: { graphSourceHash: semanticGraph.sourceHash, semanticValidation },
          },
        );
      }
    }
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

    // A treatment-sourced multi-episode run without a season plan silently
    // degrades everywhere downstream: plan-time fidelity checks skip (no
    // baseline for the regression net), no season-plan artifact persists,
    // StoryArchitect invents a scene graph instead of elaborating planned
    // scenes, and the §4 final contract then fail-closes on season-promise
    // plan-use AFTER the full generation spend (bite-me 2026-07-04: 4
    // "not consumed into concrete plan artifacts" blockers at the ep1 seal).
    // Direct callers that bypass the service preflight still fail closed here.
    assertCanonicalPlanAttached(baseBrief, analysis);

    // WS1 (contracts upstream): the two plan-checkable §4 fidelity gates
    // (authored episode conformance, Story Circle anchor conformance) run HERE,
    // before any generation is spent. A deterministic plan-vs-treatment
    // mismatch previously survived to the season-final contract and killed the
    // run after the full generation spend. Warnings surface; errors fail fast.
    // The season-final dispatch stays as a regression net for mid-run drift.
    this.planTimeFidelityFindings = [];
    this.planTimeFidelityBaseline = undefined;
    {
      const planTimeRequestedEpisodes = episodeRange.specific?.length
        ? [...new Set(episodeRange.specific)]
        : Array.from({ length: Math.max(0, episodeRange.end - episodeRange.start + 1) }, (_, idx) => episodeRange.start + idx);
      const isFullSeasonPlanTimeScope = analysis.totalEstimatedEpisodes > 0
        && planTimeRequestedEpisodes.length >= analysis.totalEstimatedEpisodes
        && Array.from({ length: analysis.totalEstimatedEpisodes }, (_, idx) => idx + 1)
          .every((episodeNumber) => planTimeRequestedEpisodes.includes(episodeNumber));
      const planFidelityEvidence = await this.recallValidatorEvidence(
        'runPlanTimeFidelityChecks',
        'plan-fidelity',
        baseBrief,
        { artifactKinds: ['source-analysis', 'season-plan'] },
      );
      const planFidelity = runPlanTimeFidelityChecks({
        seasonPlan: baseBrief.seasonPlan,
        sourceAnalysis: baseBrief.multiEpisode?.sourceAnalysis ?? analysis,
        scope: {
          mode: isFullSeasonPlanTimeScope ? 'full-season' : 'generated-slice',
          requestedEpisodeNumbers: planTimeRequestedEpisodes,
        },
      });
	      this.planTimeFidelityFindings = planFidelity.findings;
	      this.planTimeFidelityBaseline = planFidelity.baseline;
	      if (planFidelity.findings.length > 0 || planFidelity.blockingErrors.length > 0) {
	        this.writeValidatorMemory({
	          validator: 'runPlanTimeFidelityChecks',
	          lifecycle: 'plan-fidelity',
	          stage: 'plan_fidelity',
	          severity: planFidelity.blockingErrors.length > 0 ? 'blocking' : 'warning',
	          outcome: planFidelity.blockingErrors.length > 0 ? 'failed' : 'passed_with_warnings',
	          storyId: baseBrief.story.title,
	          repairRoute: 'plan-time',
	          findings: {
	            requestedEpisodeNumbers: planTimeRequestedEpisodes,
	            findings: planFidelity.findings,
	            blockingErrors: planFidelity.blockingErrors,
	            baseline: planFidelity.baseline,
	            memoryEvidence: [
	              this.validatorEvidenceService().summarize(planFidelityEvidence, 'advisory-memory'),
	            ],
	          },
	        }).catch(() => {});
	      }
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
    this._totalTokensUsed = 0;
    this.pipelineStartedAtMs = Date.now();
    this.progressTelemetryTracker.reset();
    this.completedPhases = new Set<string>();
    this.dependencySchedulerStats = {
      hasCycle: false,
      waveCount: 0,
      fallbackToSerial: false,
    };
    this.sceneValidationResults = [];
    this.allSceneValidationResults = [];
    this.allEncounterTelemetry = [];
    this.resetQualityCouncil();
    this.resetRemediationBudget(); // S3: fresh per-run remediation cap + counters
    this.seasonCanon = new SeasonCanon({ storyId: idSlugify(baseBrief.story.title) });
    this.sourceCanonPromptBlock = renderSourceCanonPrompt(analysis.sourceCanon);
    this.priorEpisodeSnapshot = undefined;
    const startTime = Date.now();

    // Determine which episodes to generate
    const episodesToGenerate = episodeRange.specific || 
      Array.from({ length: episodeRange.end - episodeRange.start + 1 }, (_, i) => episodeRange.start + i);
    if (baseBrief.seasonPlan?.scenePlan) assertSelectedEpisodeEventPlansExecutable(baseBrief.seasonPlan.scenePlan, episodesToGenerate);
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
    const estimatedScenesPerEpisode = this.config.generation?.maxScenesPerEpisode || this.config.generation?.targetSceneCount || 6;
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
          'Re-run source analysis or check the treatment episode headings.'
        );
      }
      await this.qualityCouncil?.runPlan({
        brief: baseBrief,
        sourceAnalysis: baseBrief.multiEpisode?.sourceAnalysis ?? filteredAnalysis,
        seasonPlan: baseBrief.seasonPlan,
        notes: 'Multi-episode checkpoint after plan-time fidelity checks and requested-episode filtering.',
      });

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
      const artifactRuntime = await new RunArtifactPhase({
        createOutputDirectory,
        ensureDirectory,
        save: saveEarlyDiagnostic,
        load: loadEarlyDiagnosticSync,
      }).run(
        { storyTitle: baseBrief.story.title, resumeOutputDirectory: resumedOutputDir },
        {
          config: this.config,
          emit: this.emit.bind(this),
          addCheckpoint: this.addCheckpoint.bind(this),
        },
      );
      const outputDirectory = artifactRuntime.outputDirectory;
      this._currentOutputDirectory = outputDirectory; // F4: visible to the terminal catch

      const planningArtifactRefs = await persistPlanningArtifacts({
        artifactRuntime,
        sourceAnalysis: filteredAnalysis,
        seasonPlan: baseBrief.seasonPlan,
        emit: this.emit.bind(this),
      });
      artifactRuntime.setGlobalUpstreamRefs(planningArtifactRefs);

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
      await this.recordArcPressureShadowSafe(baseBrief.seasonPlan, idSlugify(baseBrief.story.title));
      
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

      // 3. Author each episode (using specific list or range). Visual and
      // optional media agents run only after story authoring + QA complete.
      const episodes: Episode[] = [];
      const authoredEpisodeArtifacts: AuthoredEpisodeArtifacts[] = [];
      const episodeResults: EpisodeGenerationResult[] = [];
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
      const parallelism = resolveEpisodeParallelism({
        episodeParallelismEnabled: this.config.generation?.episodeParallelismEnabled,
        dependencyMode,
        seasonCanonEnabled: this.seasonCanonOn,
      });
      const parallelEnabled = parallelism.enabled;
      if (parallelism.disabledReason === 'season_canon_enabled') {
        this.emit({
          type: 'warning',
          phase: 'episode_parallelism',
          message:
            'Episode parallelism disabled for this run because Season Canon is enabled. Canonical episodes must lock in dependency order so downstream prompts read sealed upstream facts.',
        });
      }
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
      const resumablePartition = partitionResumableEpisodes(
        episodeSpecs,
        <T,>(name: string) => loadEarlyDiagnosticSync<T>(outputDirectory, name),
      );
      const pendingEpisodeSpecs = [...resumablePartition.pending];
      const resumedEpisodes = resumablePartition.resumed;
      for (const { spec, episode, watermark } of resumedEpisodes) {
        const resumedDiagnostics = loadResumedEpisodeDiagnostics<QAReport, ComprehensiveValidationReport>(
          spec.episodeNumber,
          <T,>(name: string) => loadEarlyDiagnosticSync<T>(outputDirectory, name),
        );
        const invalidationReasons = findResumedEpisodeInvalidationReasons({
          episode,
          qaReport: resumedDiagnostics.qaReport,
          bestPracticesReport: resumedDiagnostics.bestPracticesReport,
          incrementalContract: resumedDiagnostics.incrementalContract,
          requireQaReport: baseBrief.options?.runQA !== false,
          requireBestPracticesReport: this.config.validation.enabled === true,
        });
        if (invalidationReasons.length > 0) {
          pendingEpisodeSpecs.push(spec);
          this.invalidatedResumeEpisodes.add(spec.episodeNumber);
          this.emit({
            type: 'warning',
            phase: `episode_${spec.episodeNumber}`,
            message: `Invalidated resumed episode ${spec.episodeNumber} checkpoint (${invalidationReasons.join(', ')}) — regenerating instead of reusing stale content.`,
          });
          continue;
        }
        episodes.push(episode);
        episodeResults.push({ episodeNumber: spec.episodeNumber, title: spec.outline.title, success: true });
        if (resumedDiagnostics.qaReport) episodeQAReports.push(resumedDiagnostics.qaReport);
        if (resumedDiagnostics.bestPracticesReport) episodeBPReports.push(resumedDiagnostics.bestPracticesReport);
        completedEpisodeCount += 1;
        if (this.generationPlan) markEpisode(this.generationPlan, spec.episodeNumber, 'complete');
        this.emit({
          type: 'debug',
          phase: `episode_${spec.episodeNumber}`,
          message: `Resumed episode ${spec.episodeNumber} from completion watermark (${watermark.sceneCount} scenes) — skipping regeneration${resumedDiagnostics.qaReport ? ' with QA diagnostics' : ''}${resumedDiagnostics.bestPracticesReport ? ' and validation diagnostics' : ''}`,
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
              const episodePlanningRefs = await persistEpisodePlanningArtifacts({
                artifactRuntime,
                episodeNumber: spec.episodeNumber,
                blueprint: generatedEpisode.blueprint,
                branchAnalysis: generatedEpisode.branchAnalysis,
                sceneContents: generatedEpisode.sceneContents,
                choiceSets: generatedEpisode.choiceSets,
                encounters: generatedEpisode.encounters,
                emit: this.emit.bind(this),
              });
              artifactRuntime.setEpisodeUpstreamRefs(spec.episodeNumber, episodePlanningRefs);
              await this.lockGeneratedEpisode({
                episodeNumber: spec.episodeNumber,
                title: spec.outline.title,
                episode: generatedEpisode.episode,
                blueprint: generatedEpisode.blueprint,
                episodeBrief: generatedEpisode.episodeBrief,
                baseBrief,
                analysis,
                characterBible,
                qaReport: generatedEpisode.qaReport,
                bestPracticesReport: generatedEpisode.bestPracticesReport,
                validationExecutionRecords: generatedEpisode.validationExecutionRecords,
                outputDirectory,
                artifactRuntime,
                writeWatermark: true,
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
          if (
            result.episode &&
            result.episodeBrief &&
            result.blueprint &&
            result.sceneContents &&
            result.choiceSets &&
            result.encounters
          ) {
            authoredEpisodeArtifacts.push({
              episode: result.episode,
              episodeBrief: result.episodeBrief,
              blueprint: result.blueprint,
              branchAnalysis: result.branchAnalysis,
              sceneContents: result.sceneContents,
              choiceSets: result.choiceSets,
              encounters: result.encounters,
              validationExecutionRecords: result.validationExecutionRecords,
            });
          }
          episodeResults.push(result.result);
          if (result.qaReport) episodeQAReports.push(result.qaReport);
          if (result.bestPracticesReport) episodeBPReports.push(result.bestPracticesReport);
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
          try {
            await this.checkCancellation();
            this.currentEpisode = spec.idx + 1;
            const episodeProgress = Math.round((spec.idx / this.totalEpisodes) * 80) + 10;
            await this.updateJobProgress(`episode_${i}`, episodeProgress);
            emitEpisodeGenerationStart(this.emit.bind(this), i, spec.outline.title);
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
            const authoredArtifact = (generated.episode && generated.episodeBrief && generated.blueprint && generated.sceneContents && generated.choiceSets && generated.encounters)
              ? {
                episode: generated.episode,
                episodeBrief: generated.episodeBrief,
                blueprint: generated.blueprint,
                branchAnalysis: generated.branchAnalysis,
                sceneContents: generated.sceneContents,
                choiceSets: generated.choiceSets,
                encounters: generated.encounters,
                validationExecutionRecords: generated.validationExecutionRecords,
              }
              : undefined;
            await commitEpisodeGenerationAfterLock({
              episode: generated.episode,
              result: generated.result,
              artifact: authoredArtifact,
              qaReport: generated.qaReport,
              bestPracticesReport: generated.bestPracticesReport,
              episodes,
              results: episodeResults,
              artifacts: authoredEpisodeArtifacts,
              qaReports: episodeQAReports,
              bestPracticesReports: episodeBPReports,
              // WS1a: publish only after content + canon seal both succeed, so
              // final assembly and resume never see an episode that failed its
              // incremental contract.
              lockEpisode: async () => {
                const episodePlanningRefs = await persistEpisodePlanningArtifacts({
                  artifactRuntime,
                  episodeNumber: i,
                  blueprint: generated.blueprint,
                  branchAnalysis: generated.branchAnalysis,
                  sceneContents: generated.sceneContents,
                  choiceSets: generated.choiceSets,
                  encounters: generated.encounters,
                  emit: this.emit.bind(this),
                });
                artifactRuntime.setEpisodeUpstreamRefs(i, episodePlanningRefs);
                await this.lockGeneratedEpisode({
                  episodeNumber: i,
                  title: spec.outline.title,
                  episode: generated.episode!,
                  blueprint: generated.blueprint,
                  episodeBrief: generated.episodeBrief,
                  baseBrief,
                  analysis,
                  characterBible,
                  qaReport: generated.qaReport,
                  bestPracticesReport: generated.bestPracticesReport,
                  validationExecutionRecords: generated.validationExecutionRecords,
                  outputDirectory,
                  artifactRuntime,
                  writeWatermark: opts.writeWatermark,
                });
              },
            });
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

            return generated.episode ?? null;
          } catch (error) {
            return handleEpisodeGenerationFailure({ error, episodeNumber: i, title: spec.outline.title, strict: this.config.validation.mode === 'strict', results: episodeResults, emit: this.emit.bind(this) });
          }
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
        const minScore = Math.min(...episodeQAReports.map(r => r.overallScore));
        const allEpisodesPassedQA = episodeQAReports.every(r => r.passesQA);
        const aggregateScore = allEpisodesPassedQA ? avgScore : minScore;
        // A4 (bite-me-g16): the continuity field previously took the LAST episode only, so
        // earlier episodes' continuity issues (e.g. ep3's timeline inversion when ep3 was
        // not last) were dropped before the final-story contract ever saw them. Accumulate
        // continuity issues across ALL episodes and report the worst (min) score, so nothing
        // is silently lost. Voice/stakes keep representative (last) summaries.
        const allContinuityIssues = episodeQAReports.flatMap(r => r.continuity?.issues ?? []);
        const sevCount = (sev: string) => allContinuityIssues.filter(x => (x as { severity?: string }).severity === sev).length;
        const mergedContinuity = {
          overallScore: Math.min(...episodeQAReports.map(r => r.continuity?.overallScore ?? 100)),
          issueCount: { errors: sevCount('error'), warnings: sevCount('warning'), suggestions: sevCount('suggestion') },
          issues: allContinuityIssues,
          passedChecks: [],
          recommendations: Array.from(new Set(episodeQAReports.flatMap(r => r.continuity?.recommendations ?? []))),
        } as QAReport['continuity'];
        // Judge reports (QualityScore v4) must survive aggregation or the
        // prose_craft / responsiveness grades never reach final scoring on
        // multi-episode runs; weakest concept grade wins across episodes.
        const aggregatedProseCraft = aggregateProseCraftReports(episodeQAReports.map(r => r.proseCraft));
        const aggregatedResponsiveness = aggregateResponsivenessReports(episodeQAReports.map(r => r.responsiveness));
        aggregatedQAReport = {
          continuity: mergedContinuity,
          voice: episodeQAReports[episodeQAReports.length - 1].voice,
          stakes: episodeQAReports[episodeQAReports.length - 1].stakes,
          overallScore: aggregateScore,
          passesQA: allEpisodesPassedQA,
          criticalIssues: episodeQAReports.flatMap(r => r.criticalIssues),
          summary: `Aggregated QA across ${episodeQAReports.length} episode(s): score ${aggregateScore}/100 (avg ${avgScore}/100, weakest ${minScore}/100)`,
          ...(aggregatedProseCraft ? { proseCraft: aggregatedProseCraft } : {}),
          ...(aggregatedResponsiveness ? { responsiveness: aggregatedResponsiveness } : {}),
        };
        this.addCheckpoint('Aggregated QA Report', aggregatedQAReport, !aggregatedQAReport.passesQA);
        await saveEarlyDiagnostic(outputDirectory, '06-qa-report.json', aggregatedQAReport);
      }

      if (episodeBPReports.length > 0) {
        const avgBPScore = Math.round(episodeBPReports.reduce((sum, r) => sum + r.overallScore, 0) / episodeBPReports.length);
        aggregatedBPReport = {
          overallPassed: episodeBPReports.every(r => r.overallPassed),
          overallScore: avgBPScore,
          qualityScore: avgBPScore,
          blockingIssues: episodeBPReports.flatMap(r => r.blockingIssues),
          warnings: episodeBPReports.flatMap(r => r.warnings),
          suggestions: episodeBPReports.flatMap(r => r.suggestions),
          metrics: episodeBPReports[episodeBPReports.length - 1].metrics,
          timestamp: new Date(),
          duration: episodeBPReports.reduce((sum, r) => sum + r.duration, 0),
        };
        this.addCheckpoint('Aggregated Best Practices Report', aggregatedBPReport, !aggregatedBPReport.overallPassed);
        await saveEarlyDiagnostic(outputDirectory, '06b-best-practices-report.json', aggregatedBPReport);
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
              details: r.failure ? { ...r.failure } : undefined,
            }))
          );
          // F4: early-return path — record the failed run in the quality ledger.
          const earlyFail = episodeResults.find((r) => !r.success)?.failure;
          await appendFailedRunLedger(outputDirectory, episodeResults.filter(r => !r.success).length, {
            blocked: true,
            failureKind: earlyFail?.phase ?? 'episode_generation',
            failureCode: earlyFail?.code,
            failureOwnerStage: earlyFail?.ownerStage,
            retryClass: earlyFail?.retryClass,
            repairTarget: earlyFail?.repairTarget,
            topBlockingValidator: earlyFail?.issueCodes?.[0],
            gateConfigHash: resolveGateConfigHash(),
            durationMs: Date.now() - startTime,
            llmLedger: this.telemetry.getLlmLedger(),
            remediationSummary: this.getRemediationSummary(),
            memorySummary: this.getMemorySummaryForLedger(),
          });
          await saveLlmLedgerSidecar(outputDirectory, this.telemetry.getLlmLedger());
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
          failure: episodeResults.find((result) => result.failure)?.failure,
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
              details: result.failure ? { ...result.failure } : undefined,
            }))
          );
          // F4: this episode-failure path returns early (never reaches the
          // terminal catch), so record the failed run in the quality ledger here.
          const epFail = failedEpisodeResults.find((result) => result.failure)?.failure;
          await appendFailedRunLedger(outputDirectory, failedEpisodeResults.length, {
            blocked: true,
            failureKind: epFail?.phase ?? 'episode_generation',
            failureCode: epFail?.code,
            failureOwnerStage: epFail?.ownerStage,
            retryClass: epFail?.retryClass,
            repairTarget: epFail?.repairTarget,
            topBlockingValidator: epFail?.issueCodes?.[0],
            gateConfigHash: resolveGateConfigHash(),
            durationMs: Date.now() - startTime,
            llmLedger: this.telemetry.getLlmLedger(),
            remediationSummary: this.getRemediationSummary(),
            memorySummary: this.getMemorySummaryForLedger(),
          });
          // P3: persist per-call usage telemetry on this early-return failure path.
          await saveLlmLedgerSidecar(outputDirectory, this.telemetry.getLlmLedger());
        } catch (_logErr) { /* non-fatal */ }

        return {
          success: false,
          checkpoints: this.checkpoints,
          events: this.events,
          error: failMsg,
          failure: failedEpisodeResults.find((result) => result.failure)?.failure,
          duration: Date.now() - startTime,
          outputDirectory,
        };
      }

      this.emit({
        type: 'phase_complete',
        phase: 'story_authoring',
        message: `Story authoring complete for ${episodes.length} episode(s).`,
      });

      // 5. Assemble the season TEXT story (contract-first: the treatment
      // fidelity + final story contract gates run on it BEFORE any image/
      // media spend; media is generated and bound afterwards).
      const storyCoverImage =
        episodes.length > 0 && episodes[0].coverImage ? episodes[0].coverImage as unknown as string : '';

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
      finalStoryContractReport = await this.enforceFinalStoryContract({
        story,
        brief: baseBrief,
        requestedEpisodeNumbers: episodesToGenerate,
        qaReport: aggregatedQAReport,
        bestPracticesReport: aggregatedBPReport,
        phase: 'final_story_contract',
        validationScope: {
          mode: story.episodes.length >= analysis.totalEstimatedEpisodes ? 'full-season' : 'generated-slice',
          requestedEpisodeNumbers: episodesToGenerate,
          generatedEpisodeNumbers: story.episodes.map((episode) => episode.number).filter((n): n is number => typeof n === 'number'),
          generatedThroughEpisode: Math.max(0, ...story.episodes.map((episode) => episode.number).filter((n): n is number => typeof n === 'number')),
        },
      });
      await this.qualityCouncil?.runRoutePlaytest({
        brief: baseBrief,
        sourceAnalysis: filteredAnalysis,
        seasonPlan: baseBrief.seasonPlan,
        story,
        finalStoryContractReport,
        notes: 'Multi-episode route playtest after final story contract validation.',
      });
      await this.qualityCouncil?.runFinal({
        brief: baseBrief,
        sourceAnalysis: filteredAnalysis,
        seasonPlan: baseBrief.seasonPlan,
        story,
        qaReport: aggregatedQAReport,
        bestPracticesReport: aggregatedBPReport,
        finalStoryContractReport,
        notes: 'Multi-episode final council audit before saving.',
      });
      this.enforceQualityCouncilStrictMode('quality_council_final');

      // 6. Generate media (after the season text contract passed) and bind it
      // into the contract-passed story via the asset registry — NOT by
      // re-assembling episodes, which would discard the contract's in-place
      // text repairs.
      if (this.config.imageGen?.enabled) {
        await this.checkCancellation();
        this.emit({
          type: 'phase_start',
          phase: 'post_story_media',
          message: 'Story agents complete; starting image and optional media agents...',
        });
        this.emit({ type: 'phase_start', phase: 'master_images', message: 'Generating master reference visuals...' });
        await this.imageWorkerQueue.run(() =>
          this.measurePhase('multi_master_image_generation', () => this.runMasterImageGeneration(characterBible, worldBible, baseBrief))
        );

        const mediaArtifacts = [...authoredEpisodeArtifacts].sort((a, b) => (a.episode.number || 0) - (b.episode.number || 0));
        for (const authored of mediaArtifacts) {
          await this.checkCancellation();
          const mediaResult = await this.generateMediaForAuthoredEpisode({
            ...authored,
            worldBible,
            characterBible,
            outputDirectory,
          });
          if (mediaResult.encounterImageDiagnostics?.length) {
            allEncounterImageDiagnostics.push(...mediaResult.encounterImageDiagnostics);
          }
          if (mediaResult.storyletFailures?.length) {
            allStoryletFailures.push(...mediaResult.storyletFailures);
            const failMsg = mediaResult.storyletFailures.join('; ');
            console.warn(`[Pipeline] Episode ${mediaResult.episode.number}: Storylet image gaps (non-fatal, continuing): ${failMsg}`);
            this.emit({ type: 'warning', phase: `images_ep_${mediaResult.episode.number}`, message: `Storylet image gaps (continuing): ${failMsg}` });
          }
        }
        this.emit({
          type: 'phase_complete',
          phase: 'post_story_media',
          message: `Image/media pass complete for ${mediaArtifacts.length} newly authored episode(s).`,
        });
      }

      // Cover art, then overlay every registry-tracked asset + covers +
      // NPC portraits onto the contract-passed story (late binding).
      let multiCoverUrl: string | undefined;
      if (this.config.imageGen?.enabled) {
        multiCoverUrl = await this.generateStoryCoverArt(baseBrief, characterBible, worldBible, outputDirectory);
      }
      story = bindStoryMediaAssets(story, {
        assetRegistry: this.assetRegistry,
        storyCoverUrl: multiCoverUrl,
        imageAgentTeam: this.imageAgentTeam,
      });
      if (this.config.generation?.assetGenerationMode === 'story-only') {
        story.imagesStatus = 'pending';
        await this.saveDraftImageManifest(outputDirectory, story);
      } else if (this.config.imageGen?.enabled) {
        story.imagesStatus = this.buildImageManifestFromStory(story).imagesStatus;
      }

      this.addCheckpoint('Final Story', story, false);
      await this.saveResumeUnit(
        outputDirectory,
        'final_story_package',
        'checkpoints/final-story-before-save.json',
        story,
      );

      // 7. Save results (using outputDirectory created earlier)
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
        qualityCouncilReport: this.qualityCouncil?.getReport(),
        encounterImageDiagnostics: allEncounterImageDiagnostics,
        remediationSummary: this.getRemediationSummary(),
      memorySummary: this.getMemorySummaryForLedger(),
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
          const failure = episodeFailureMetadataFromError(error);
          const failureFingerprint = failure
            ? computeFailureFingerprint({
                code: failure.code,
                ownerStage: failure.ownerStage,
                repairTarget: failure.repairTarget,
                issueCodes: failure.issueCodes,
                phase: failure.phase,
                message: errorMessage,
              })
            : computeFailureFingerprint({ phase: 'pipeline_abort', message: errorMessage });
          this.addCheckpoint('failure_fingerprint', {
            fingerprint: failureFingerprint,
            resumeCount: 0,
            recordedAt: new Date().toISOString(),
          } satisfies FailureFingerprintRecord, false);
          await saveEarlyDiagnostic(this._currentOutputDirectory, 'failure-fingerprint.json', {
            fingerprint: failureFingerprint,
            failure,
            message: errorMessage,
            recordedAt: new Date().toISOString(),
          });
          const details: Record<string, unknown> | undefined = failure
            ? { ...failure, failureFingerprint }
            : error instanceof ValidationError && error.issues?.length ? { issues: error.issues, failureFingerprint } : { failureFingerprint };
          await savePipelineErrorLog(this._currentOutputDirectory, [{
            timestamp: new Date().toISOString(),
            phase: 'pipeline_abort',
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            ...(details ? { details } : {}),
          }]);
          // P3: a FAILED run must persist its per-call usage telemetry too —
          // the truncation-abort class is diagnosed from token evidence, and
          // the ledger previously only shipped with successful runs.
          await saveLlmLedgerSidecar(this._currentOutputDirectory, this.telemetry.getLlmLedger());
          // B3a: record the failure kind for cross-run triage. PipelineError carries
          // the phase (failureKind) + agent/validator (validatorId).
          await appendFailedRunLedger(this._currentOutputDirectory, 1, {
            blocked: true,
            failureKind: error instanceof PipelineError ? error.phase : (error instanceof Error ? error.name : 'unknown'),
            failureCode: error instanceof PipelineError ? error.code : undefined,
            failureOwnerStage: error instanceof PipelineError ? error.ownerStage : undefined,
            retryClass: error instanceof PipelineError ? error.retryClass : undefined,
            repairTarget: error instanceof PipelineError ? error.repairTarget : undefined,
            topBlockingValidator: error instanceof PipelineError
              ? (error.agent || error.issueCodes[0])
              : undefined,
            gateConfigHash: resolveGateConfigHash(),
            validatorId: error instanceof PipelineError ? error.agent : undefined,
            durationMs: Date.now() - startTime,
            llmLedger: this.telemetry.getLlmLedger(),
            remediationSummary: this.getRemediationSummary(),
            memorySummary: this.getMemorySummaryForLedger(),
          });
        }
      }

      return {
        success: false,
        checkpoints: this.checkpoints,
        events: this.events,
        error: errorMessage,
        failure: (() => {
          const base = episodeFailureMetadataFromError(error);
          if (!base) return undefined;
          const fingerprint = computeFailureFingerprint({
            code: base.code,
            ownerStage: base.ownerStage,
            repairTarget: base.repairTarget,
            issueCodes: base.issueCodes,
            phase: base.phase,
            message: errorMessage,
          });
          return {
            ...base,
            context: {
              ...(base.context ?? {}),
              failureFingerprint: fingerprint,
              failureKind: error instanceof PipelineError && error.code === 'deterministic_resume_loop'
                ? 'deterministic_resume_loop'
                : base.context?.failureKind,
            },
          };
        })(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * The episode lock boundary: an episode becomes resumable only after its
   * runtime contract passes, then its facts are sealed into canon, then the
   * completion watermark is written. Keeping this order prevents failed
   * episode-local repairs from polluting downstream canon.
   */
  private async lockGeneratedEpisode(params: {
    episodeNumber: number;
    title: string;
    episode: Episode;
    blueprint?: EpisodeBlueprint;
    episodeBrief?: FullCreativeBrief;
    baseBrief: FullCreativeBrief;
    analysis: SourceMaterialAnalysis;
    characterBible: CharacterBible;
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    validationExecutionRecords?: import('../../types/validation').ValidatorExecutionRecord[];
    outputDirectory: string;
    artifactRuntime: RunArtifactRuntime;
    writeWatermark: boolean;
  }): Promise<EpisodeCompletionLockEvidence> {
    const {
      episodeNumber,
      title,
      episode,
      blueprint,
      episodeBrief,
      baseBrief,
      analysis,
      characterBible,
      qaReport,
      bestPracticesReport,
      validationExecutionRecords,
      outputDirectory,
      artifactRuntime,
      writeWatermark,
    } = params;
    let runtimeLockEvidence: EpisodeCompletionLockEvidence = {};
    return lockGeneratedEpisodeArtifact({
      episodeNumber,
      title,
      episode,
      hasEpisodeBrief: Boolean(episodeBrief),
      writeWatermark,
      validateRuntimeContract: async () => {
        const outputBoundaryIssues = validateEpisodeOutputBoundary(episode);
        if (outputBoundaryIssues.length > 0) {
          throw new PipelineError(
            `Episode ${episodeNumber} output boundary failed`,
            `episode_${episodeNumber}_output_boundary`,
            {
              failure: {
                code: 'output_boundary_invalid',
                ownerStage: 'packaging',
                retryClass: 'none',
                issueCodes: ['episode_output_boundary_invalid'],
                repairTarget: `episode:${episodeNumber}`,
              },
              context: { episodeNumber, outputBoundaryIssues },
            },
          );
        }
        const sceneLockReport = buildEpisodeSceneLockReport({
          episodeNumber,
          episode,
          blueprintScenes: blueprint?.scenes,
          validationResults: this.allSceneValidationResults.length > 0
            ? this.allSceneValidationResults
            : this.sceneValidationResults,
        });
        const sceneLockArtifact = sceneLockArtifactName(episodeNumber);
        await artifactRuntime.save(sceneLockArtifact, sceneLockReport);
        runtimeLockEvidence = {
          sceneLocksPassed: sceneLockReport.passed,
          sceneLockArtifact,
        };
        if (sceneLockReport.deferredFindingCount > 0) {
          this.emit({
            type: 'warning',
            phase: 'assembly',
            message: `Episode ${episodeNumber} scene locks: deferred ${sceneLockReport.deferredFindingCount} craft finding(s) from scene-time validation to the final contract repair loop.`,
          });
        }
        if (!sceneLockReport.passed) {
          const detail = sceneLockReport.validation.issues
            .filter((issue) => issue.severity === 'error')
            .slice(0, 5)
            .map((issue) => issue.message)
            .join('; ');
          throw new Error(`Episode ${episodeNumber} cannot be locked: scene validation locks failed. ${detail}`);
        }

        const episodeValidation = await this.validateEpisodeIncrementally({
          episodeNumber,
          episode,
          episodeBrief: episodeBrief!,
          episodeBlueprint: blueprint,
          characterBible,
          qaReport,
          bestPracticesReport,
          outputDirectory,
        });
        return mergeArtifactValidationSummaries(`runtime_contract_ep_${episodeNumber}`, [
          sceneLockReport.validation,
          episodeValidation,
        ]);
      },
      sealCanon: async () => ({
        ...runtimeLockEvidence,
        ...(await this.sealGeneratedEpisodeForCanon({
          episodeNumber,
          episode,
          baseBrief,
          analysis,
          characterBible,
          outputDirectory,
        }) ?? {}),
      }),
      writeCompletion: (lock, validation) => artifactRuntime.writeEpisodeCompletion({
        episode,
        episodeNumber,
        title,
        lock,
        validation,
        executionRecords: [
          ...(validationExecutionRecords ?? []),
          ...(bestPracticesReport?.executionRecords ?? []),
        ],
      }).then(() => undefined),
    });
  }

  /**
   * Seal a freshly-authored episode into Season Canon and return the durable
   * sidecars that make the completion watermark auditable. This is the canon
   * half of episode locking; the runtime-contract half lives in
   * validateEpisodeIncrementally and the caller writes the watermark only after
   * both steps complete.
   */
  private async sealGeneratedEpisodeForCanon(params: {
    episodeNumber: number;
    episode: Episode;
    baseBrief: FullCreativeBrief;
    analysis: SourceMaterialAnalysis;
    characterBible: CharacterBible;
    outputDirectory: string;
  }): Promise<EpisodeCompletionLockEvidence | undefined> {
    const { episodeNumber: i, episode, baseBrief, analysis, characterBible, outputDirectory } = params;
    if (!this.seasonCanonOn) {
      return { canonSealed: false };
    }

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
      this.emit({
        type: 'debug',
        phase: `season_canon_ep_${i}`,
        message: `Spine plant map: ${spineResult.applied} applied, ${spineResult.unmatched.length} not yet planted.`,
      });
    }

    // B2: extract prose knowledge + claims so the canon holds who-knows-what
    // (not just flags+capability) and the canon-consistency gate runs over real
    // claims. Deterministic seed from the QA character-knowledge bundle + the
    // flags this episode gates on.
    const episodeKnowledge = extractEpisodeKnowledge({
      episodeNumber: i,
      protagonistId: 'protagonist',
      characterKnowledge: this.buildContinuityCharacterKnowledge(characterBible),
      referencedFlags: collectReferencedFlags(episode as any),
      sceneText: episodeProseCorpus(episode as any),
    });
    const seasonLengthForArc = analysis.totalEstimatedEpisodes || this.totalEpisodes;
    const arcAndRelationship = this.extractArcAndRelationshipDeltas(
      characterBible,
      i,
      seasonLengthForArc,
    );
    const seal = await sealAndPersistEpisode({
      episode: episode as any,
      episodeNumber: i,
      seasonLength: seasonLengthForArc,
      ledger: this.callbackLedger,
      canon: this.seasonCanon,
      priorSnapshot: this.priorEpisodeSnapshot,
      claims: episodeKnowledge.claims,
      // Seal capability facts (who-can-do-what) + extracted knowledge/worldFacts
      // so downstream prompts inherit a richer canon. Plus per-episode character
      // arc state + relationship dimensions so the canon tracks the actual
      // episode endpoint instead of only the original plan.
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
    const blockingIssues = seal.evaluation.issues.filter((x) => x.severity === 'error');
    if (this.seasonCanonBlockingOn && blockingIssues.length > 0) {
      throw new Error(`Season Canon gate failed for episode ${i}: ${blockingIssues.map((x) => x.message).join('; ')}`);
    }

    return {
      canonSealed: true,
      seasonCanonArtifact: 'season-canon.json',
      seasonLedgerArtifact: 'season-ledger.json',
      episodeStateSnapshotArtifact: 'episode-state-snapshot.json',
    };
  }

  /**
   * WS-A (bite-me-g16): run the final-story contract validators on a SINGLE freshly
   * generated episode, so POV / treatment-fidelity / flag / pronoun / conformance defects
   * surface as each episode is produced — not only after the whole season is assembled.
   * Episode-level contract: run the same final-story contract validators on a SINGLE
   * freshly generated episode, repair blocking findings while the episode artifact is
   * still mutable, and only allow completion when blockers are gone. Writes
   * `episode-<n>-incremental-contract.json` for diagnostics before the season package
   * bundling step.
   */
  private async validateEpisodeIncrementally(params: {
    episodeNumber: number;
    episode: Episode;
    episodeBrief: FullCreativeBrief;
    episodeBlueprint?: EpisodeBlueprint;
    characterBible: CharacterBible;
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    outputDirectory: string;
  }): Promise<ArtifactValidationSummary> {
    const { episodeNumber: i, episode, episodeBrief, episodeBlueprint, characterBible, qaReport, bestPracticesReport, outputDirectory } = params;
    try {
      const validationBrief = {
        ...episodeBrief,
        // Resumed season-plan artifacts are recursively frozen. Incremental
        // validation overlays blueprint ownership and may repair projections,
        // so give it a mutable brief.
        seasonPlan: episodeBrief.seasonPlan
          ? JSON.parse(JSON.stringify(episodeBrief.seasonPlan))
          : episodeBrief.seasonPlan,
      } as FullCreativeBrief;
      const protagonistId = episodeBrief.protagonist?.id;
      const npcs = (characterBible.characters || [])
        .filter((c: CharacterProfile) => c.id !== protagonistId)
        .map((c: CharacterProfile) => ({ id: c.id, name: c.name, pronouns: (c as { pronouns?: string }).pronouns }));
      // Rehydrated episode artifacts are recursively frozen. Final-contract
      // validators include deterministic prose repairs, so validate a mutable
      // working episode and publish those repairs back only when the caller's
      // episode shell is mutable.
      const workingEpisode = JSON.parse(JSON.stringify(episode)) as Episode;
      const oneEpisodeStory = {
        id: (episodeBrief.story as { id?: string })?.id || 'incremental',
        title: episodeBrief.story?.title || '',
        genre: episodeBrief.story?.genre || '',
        synopsis: '',
        coverImage: '',
        initialState: { attributes: {}, skills: Object.fromEntries(DEFAULT_SKILLS.map(s => [s.name, 10])), tags: [], inventory: [] },
        npcs,
        episodes: [workingEpisode],
      } as unknown as Story;

      // Keep episode-level diagnostics aligned with the final package contract:
      // outcome flags/variants are part of the episode seal, not post-season surgery.
      await this.authorEncounterOutcomeVariants(oneEpisodeStory);

      if (episodeBlueprint && validationBrief.seasonPlan?.scenePlan?.scenes?.length) {
        const synced = overlayBlueprintSceneEventOwnership(
          validationBrief.seasonPlan.scenePlan.scenes,
          episodeBlueprint.scenes,
          i,
        );
        if (synced > 0) {
          this.emit({
            type: 'debug',
            phase: `incremental_contract_ep_${i}`,
            message: `Synced sceneEventOwnership from episode blueprint onto ${synced} season-plan scene(s) before incremental contract.`,
          });
        }
      }

      const fidelity = runFidelityValidators({
        story: oneEpisodeStory,
        seasonPlan: validationBrief.seasonPlan,
        sourceAnalysis: validationBrief.multiEpisode?.sourceAnalysis,
        planTimeBaseline: this.planTimeFidelityBaseline,
        scope: {
          mode: 'episode-incremental',
          requestedEpisodeNumbers: [i],
          generatedEpisodeNumbers: [i],
          generatedThroughEpisode: i,
        },
      });
      const plannedChoiceTypes = this.plannedChoiceTypesByScene && Object.keys(this.plannedChoiceTypesByScene).length > 0
        ? this.plannedChoiceTypesByScene
        : plannedChoiceTypesByScene(validationBrief.seasonPlan);
      const plannedConsequenceTiers = plannedConsequenceTiersByScene(validationBrief.seasonPlan);

      let report = await new FinalStoryContractValidator().validate({
        story: oneEpisodeStory,
        protagonist: episodeBrief.protagonist
          ? { name: episodeBrief.protagonist.name, pronouns: episodeBrief.protagonist.pronouns }
          : undefined,
        requestedEpisodeNumbers: [i],
        sourceSeasonPlan: validationBrief.seasonPlan,
        incrementalValidationResults: this.allSceneValidationResults.length > 0 ? this.allSceneValidationResults : this.sceneValidationResults,
        qaReport,
        bestPracticesReport,
        validSkills: Object.keys(oneEpisodeStory.initialState?.skills || {}),
        mode: this.config.validation?.mode,
        fidelityFindings: fidelity.fidelityFindings,
        planTimeFidelityFindings: this.planTimeFidelityFindings,
        treatmentSourced: fidelity.treatmentSourced,
        callbackLedger: this.callbackLedger.serialize(),
        seasonResiduePlan: validationBrief.seasonPlan?.residuePlan,
        seasonChoicePlan: this.seasonChoicePlan,
        plannedChoiceTypesByScene: plannedChoiceTypes,
        plannedConsequenceTiersByScene: plannedConsequenceTiers,
        seasonSkillPlan: this.seasonSkillPlan,
      });
      let repairedByEpisodeContract = false;

      if (!report.passed || report.blockingIssues.length > 0) {
        this.emit({
          type: 'debug',
          phase: `incremental_contract_ep_${i}`,
          message: `Episode ${i} contract has ${report.blockingIssues.length} blocker(s); attempting episode-local repair before completion.`,
          data: { blockingIssues: report.blockingIssues.slice(0, 5) },
        });
        const repairedReport = await this.enforceEpisodeIncrementalContractWithTimeout(i, {
          story: oneEpisodeStory,
          brief: validationBrief,
          requestedEpisodeNumbers: [i],
          qaReport,
          bestPracticesReport,
          phase: `incremental_contract_ep_${i}`,
          validationScope: {
            mode: 'episode-incremental',
            requestedEpisodeNumbers: [i],
            generatedEpisodeNumbers: [i],
            generatedThroughEpisode: i,
          },
        });
        if (repairedReport) {
          report = repairedReport;
          repairedByEpisodeContract = true;
        }
      }

      const byType: Record<string, number> = {};
      for (const issue of [...report.blockingIssues, ...report.warnings]) {
        byType[issue.type] = (byType[issue.type] ?? 0) + 1;
      }
      await saveEarlyDiagnostic(outputDirectory, `episode-${i}-incremental-contract.json`, {
        generatedAt: new Date().toISOString(),
        episodeNumber: i,
        advisory: false,
        repairedByEpisodeContract,
        passed: report.passed,
        blockingCount: report.blockingIssues.length,
        warningCount: report.warnings.length,
        byType,
        blockingIssues: report.blockingIssues,
        warnings: report.warnings,
      }).catch(() => undefined);

      // Stable, fixture-independent event message (counts/types live in the diagnostic
      // file, not the event stream, so the progress-contract golden stays deterministic).
      const total = report.blockingIssues.length + report.warnings.length;
      if (total > 0) {
        console.info(`[Pipeline] Episode ${i} incremental contract: ${total} issue(s) — ${Object.entries(byType).map(([t, n]) => `${t}:${n}`).join(', ')}`);
      }
      this.emit({
        type: 'debug',
        phase: `incremental_contract_ep_${i}`,
        message: `Episode ${i} incremental contract validated (${report.passed ? 'passed' : 'failed'}).`,
      });
      if (!report.passed || report.blockingIssues.length > 0) {
        throw new Error(
          `Episode ${i} incremental contract failed with ${report.blockingIssues.length} blocking issue(s): ` +
          report.blockingIssues.slice(0, 3).map(issue => issue.message).join('; '),
        );
      }
      if (!Object.isFrozen(episodeBrief)) {
        episodeBrief.seasonPlan = validationBrief.seasonPlan;
      }
      if (!Object.isFrozen(episode)) {
        Object.assign(episode as unknown as Record<string, unknown>, workingEpisode);
      }
      return this.toArtifactValidationSummary(`incremental_contract_ep_${i}`, report);
    } catch (err) {
      this.emit({
        type: 'error',
        phase: `incremental_contract_ep_${i}`,
        message: `Incremental contract validation for Episode ${i} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  private toArtifactValidationSummary(
    gate: string,
    report: Pick<FinalStoryContractReport, 'passed' | 'blockingIssues' | 'warnings'>,
  ): ArtifactValidationSummary {
    return {
      passed: report.passed && report.blockingIssues.length === 0,
      gate,
      issues: [
        ...report.blockingIssues.map((issue) => ({
          validator: issue.validator || 'FinalStoryContractValidator',
          severity: 'error' as const,
          message: issue.message,
          code: issue.type,
          path: [
            issue.episodeNumber != null ? `episode:${issue.episodeNumber}` : undefined,
            issue.sceneId ? `scene:${issue.sceneId}` : undefined,
            issue.beatId ? `beat:${issue.beatId}` : undefined,
          ].filter(Boolean).join('/'),
        })),
        ...report.warnings.map((issue) => ({
          validator: issue.validator || 'FinalStoryContractValidator',
          severity: 'warning' as const,
          message: issue.message,
          code: issue.type,
          path: [
            issue.episodeNumber != null ? `episode:${issue.episodeNumber}` : undefined,
            issue.sceneId ? `scene:${issue.sceneId}` : undefined,
            issue.beatId ? `beat:${issue.beatId}` : undefined,
          ].filter(Boolean).join('/'),
        })),
      ],
    };
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
  }): Promise<GeneratedEpisodeFromOutlineResult> {
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
      let canHydrateEpisodeResume = !this.invalidatedResumeEpisodes.has(i);
      const resumedBlueprint = canHydrateEpisodeResume
        ? this.loadResumeUnit<EpisodeBlueprint>(
          outputDirectory,
          `episode_blueprint:episode-${i}`,
          blueprintPath,
        )
        : undefined;
      let blueprint = resumedBlueprint;
      if (blueprint) {
        const resumeCompatibility = episodePlanResumeCompatibility(
          blueprint.episodeEventPlan,
          episodeBrief.seasonPlan?.scenePlan?.episodeEventPlans?.[i],
        );
        if (!resumeCompatibility.compatible) {
          canHydrateEpisodeResume = false;
          this.invalidatedResumeEpisodes.add(i);
          this.emit({
            type: 'warning',
            phase: 'resume',
            message: `Invalidated resumed episode ${i} blueprint: ${resumeCompatibility.reason}.`,
          });
          blueprint = undefined;
        }
      }
      if (blueprint) {
        const finalization = this.finalizeEpisodeBlueprintSceneOwnershipForPipeline({
          blueprint,
          episodeNumber: i,
          source: 'pipeline_resume',
          storyCircleRole: blueprint.storyCircleRole
            ?? episodeBrief.seasonPlan?.episodes.find((episode) => episode.episodeNumber === i)?.storyCircleRole,
        });
        if (finalization.wasStale) {
          this.emit({
            type: 'debug',
            phase: 'resume',
            message: `Normalized stale resumed episode ${i} blueprint ownership (${finalization.drainedRequiredBeatIds.length} required beat(s) drained).`,
          });
        }
        if (finalization.issues.length > 0) {
          canHydrateEpisodeResume = false;
          this.invalidatedResumeEpisodes.add(i);
          this.emit({
            type: 'warning',
            phase: 'resume',
            message: `Invalidated resumed episode ${i} blueprint after ownership preflight: ${finalization.issues.slice(0, 4).join(' | ')}`,
          });
          blueprint = undefined;
        }
      }
      blueprint = blueprint
        || await this.measurePhase(`episode_${i}_architecture`, () => this.runEpisodeArchitecture(episodeBrief, worldBible, characterBible));
      await this.saveResumeUnit(outputDirectory, `episode_blueprint:episode-${i}`, blueprintPath, blueprint);
      await saveEarlyDiagnostic(outputDirectory, `episode-${i}-blueprint.json`, blueprint);
      const branchPath = this.episodeCheckpointFile(i, 'branch-analysis');
      // Capture a definitely-assigned const for the closure: `blueprint` is a `let`
      // reassigned by the SceneConstructionGate architecture retry below, which
      // invalidates TS narrowing inside callbacks.
      const architectureBlueprint = blueprint;
      const branchAnalysis = (canHydrateEpisodeResume
        ? this.loadResumeUnit<BranchAnalysis | null>(
          outputDirectory,
          `branch_analysis:episode-${i}`,
          branchPath,
        )
        : undefined)
        ?? await this.measurePhase(`episode_${i}_branch_analysis`, () => this.runBranchAnalysis(episodeBrief, architectureBlueprint));
      await this.saveResumeUnit(outputDirectory, `branch_analysis:episode-${i}`, branchPath, branchAnalysis);
      const contentOutcome = await this.runContentGenerationWithArchitectureRetry({
        brief: episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        branchAnalysis: branchAnalysis || undefined,
        outputDirectory,
        episodeNumber: i,
        phaseLabel: `episode_${i}_content`,
        onArchitectureRetry: async (retryBlueprint, retryBranchAnalysis) => {
          await this.saveResumeUnit(outputDirectory, `episode_blueprint:episode-${i}`, blueprintPath, retryBlueprint);
          await saveEarlyDiagnostic(outputDirectory, `episode-${i}-blueprint.json`, retryBlueprint);
          await this.saveResumeUnit(outputDirectory, `branch_analysis:episode-${i}`, branchPath, retryBranchAnalysis ?? null);
        },
      });
      blueprint = contentOutcome.blueprint;
      const { sceneContents, choiceSets, encounters, validationExecutionRecords } = contentOutcome.content;
      await this.qualityCouncil?.runChoice({
        brief: episodeBrief,
        sourceAnalysis: episodeBrief.multiEpisode?.sourceAnalysis,
        seasonPlan: episodeBrief.seasonPlan,
        episodeBlueprint: blueprint,
        sceneContents,
        choiceSets,
        notes: `Multi-episode checkpoint after ChoiceAuthor for episode ${i}.`,
      });

      let callbackNewHooks = 0;
      let authoredCallbackPayoffs = 0;

      // Plan 1: Harvest delayed-consequence callbacks from this episode's
      // choices (seed new hooks) and textVariants (record payoffs). Planned
      // residue runs next and gets first claim on due choice-memory debt before
      // generic fallback callbacks fill remaining unresolved hooks.
      try {
        const { newHooks, payoffs } = this.harvestEpisodeCallbacks({
          episodeNumber: i,
          sceneContents: sceneContents as unknown as Parameters<typeof this.harvestEpisodeCallbacks>[0]['sceneContents'],
          choiceSets: choiceSets as unknown as Parameters<typeof this.harvestEpisodeCallbacks>[0]['choiceSets'],
        });
        callbackNewHooks = newHooks;
        authoredCallbackPayoffs = payoffs;
      } catch (ledgerErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_callbacks`,
          message: `CallbackLedger harvest failed (non-fatal): ${ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)}`,
        });
      }

      const residueContract = implementEpisodeResidueObligations({
        episodeNumber: i,
        sceneContents,
        choiceSets,
        blueprint,
        seasonResiduePlan: episodeBrief.seasonPlan?.residuePlan,
        callbackLedger: this.callbackLedger,
        importedCallbackLedger: this.callbackLedger.serialize(),
        generatedThroughEpisode: this.totalEpisodes,
      });
      if (
        residueContract.autoInjected.length > 0 ||
        residueContract.missingIncoming.length > 0 ||
        residueContract.missingOutgoing.length > 0 ||
        residueContract.unplannedConsequentialFlags.length > 0
      ) {
        this.emit({
          type: residueContract.missingIncoming.length || residueContract.missingOutgoing.length || residueContract.unplannedConsequentialFlags.length ? 'warning' : 'debug',
          phase: `episode_${i}_residue_contract`,
          message:
            `Residue contract: ${residueContract.createdOutgoing.length}/${residueContract.plannedOutgoing.length} outgoing created, ` +
            `${residueContract.paidIncoming.length}/${residueContract.dueIncoming.length} due paid, ` +
            `${residueContract.autoInjected.length} auto-injected, ${residueContract.unplannedConsequentialFlags.length} unplanned flag(s).`,
        });
      }
      // Audit item 2, P2.3: threads + treatment seeds join the unified
      // obligation ledger as kinds, so every setup->payoff promise has ONE
      // tracked status. Non-fatal: the authored plans stay authoritative for
      // their own validators until the P2.5 flip.
      try {
        const threadSeeding = registerThreadObligations(this.callbackLedger, this.seasonThreadLedger, i);
        const seedSeeding = registerSeedObligations(
          this.callbackLedger,
          (blueprint?.scenes ?? []) as Parameters<typeof registerSeedObligations>[1],
          collectEpisodeSetFlags(choiceSets as unknown as Parameters<typeof collectEpisodeSetFlags>[0]),
          i,
        );
        if (threadSeeding.threadsRegistered > 0 || seedSeeding.seedsRegistered > 0) {
          this.emit({
            type: 'debug',
            phase: `episode_${i}_obligations`,
            message:
              `Obligation ledger: ${threadSeeding.threadsRegistered} thread(s) registered (${threadSeeding.threadPayoffsCredited} paid), ` +
              `${seedSeeding.seedsRegistered} seed(s) registered (${seedSeeding.seedPayoffsCredited} paid).`,
          });
        }
      } catch (obligationErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_obligations`,
          message: `Obligation seeding failed (non-fatal): ${obligationErr instanceof Error ? obligationErr.message : String(obligationErr)}`,
        });
      }

      // P2.4/P2.5 shadow: the unified per-kind obligation check runs as a
      // diagnostic only — the legacy validators stay authoritative for gating
      // until the live-run-gated flip. Findings land in the run dir for
      // shadow comparison.
      try {
        const obligationReport = validateObligationLedger(this.callbackLedger, {
          episodeNumber: i,
          generatedThroughEpisode: this.totalEpisodes,
        });
        await saveEarlyDiagnostic(outputDirectory, `episode-${i}-obligation-ledger.json`, obligationReport);
        if (obligationReport.findings.length > 0) {
          this.emit({
            type: 'debug',
            phase: `episode_${i}_obligation_shadow`,
            message:
              `Obligation shadow: ${obligationReport.findings.length} unpaid due obligation(s) ` +
              `(${obligationReport.paid} paid, ${obligationReport.open} open, ${obligationReport.abandoned} abandoned of ${obligationReport.totalObligations}).`,
          });
        }
      } catch (shadowErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_obligation_shadow`,
          message: `Obligation shadow validation failed (non-fatal): ${shadowErr instanceof Error ? shadowErr.message : String(shadowErr)}`,
        });
      }

      await saveEarlyDiagnostic(outputDirectory, `episode-${i}-residue-contract.json`, residueContract);
      await saveEarlyDiagnostic(outputDirectory, '10-residue-ledger.json', {
        episodeNumber: i,
        residueContract,
        callbackLedger: this.callbackLedger.serialize(),
      });

      try {
        // Deterministically realize planted-but-uncollected callbacks after
        // planned residue has had the first opportunity to pay its assigned
        // obligations. This prevents a generic callback line from double-paying
        // the same hook before the residue contract can attach source-specific
        // prose and evidence.
        const { injected } = this.injectFallbackCallbacks({
          episodeNumber: i,
          sceneContents: sceneContents as unknown as InjectFallbackCallbacksParams['sceneContents'],
          choiceSets: choiceSets as unknown as InjectFallbackCallbacksParams['choiceSets'],
        });
        if (callbackNewHooks > 0 || authoredCallbackPayoffs > 0 || injected > 0) {
          this.emit({
            type: 'debug',
            phase: `episode_${i}_callbacks`,
            message: `Callback ledger: +${callbackNewHooks} new hook(s), +${authoredCallbackPayoffs} authored payoff(s), +${injected} auto-realized this episode; ${this.callbackLedger.size()} total`,
          });
        }
        await saveEarlyDiagnostic(outputDirectory, '09-callback-ledger.json', this.callbackLedger.serialize());
      } catch (ledgerErr) {
        this.emit({
          type: 'warning',
          phase: `episode_${i}_callbacks`,
          message: `CallbackLedger fallback injection failed (non-fatal): ${ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)}`,
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
        choiceSets,
        residueRepair: { sceneContents, reassemble: () => this.assembleEpisode(episodeBrief, worldBible, characterBible, blueprint, sceneContents, choiceSets, undefined, encounters, undefined) },
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
          // ChoiceAuthor stores choices in the phase-level choiceSets; beat-level choices
          // are attached later during episode assembly, so sceneContents alone can report
          // a false "authored 0 choices" warning after a successful content pass.
          choicePlannedSceneIds: (blueprint.scenes ?? []).filter((s) => !s.isEncounter && s.choicePoint).map((s) => s.id),
          choiceAuthoredSceneIds: choiceSets.filter((cs) => (cs.choices ?? []).length > 0).map((cs) => cs.sceneId).filter(Boolean) as string[],
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

      // Bucket D: plan-time craft gates (extracted — episodePlanCraftGates.ts).
      if (narrativeDiagnosticsReport) {
        await enforceEpisodePlanCraftGates({
          episodeNumber: i,
          narrativeDiagnosticsReport,
          callbackLedger: this.callbackLedger,
          sceneContents,
          characterBible,
          remediationBudget: this.remediationBudget,
          recordPlanGateShadow: this.recordPlanGateShadow.bind(this),
          recordRemediationSafe: this.recordRemediationSafe.bind(this),
          recordGateShadowSafe: this.recordGateShadowSafe.bind(this),
        });
      }

      const episode = this.assembleEpisode(
        episodeBrief,
        worldBible,
        characterBible,
        blueprint,
        sceneContents,
        choiceSets,
        undefined,
        encounters,
        undefined
      );

      // Story-only assembly is the hard boundary: media agents run after all
      // story agents and episode QA finish for the requested season slice.

      // Per-episode QA pass (mirrors Phase 5 from single-episode generate())
      let qaReport: QAReport | undefined;
      let bestPracticesReport: ComprehensiveValidationReport | undefined;
      if (episodeBrief.options?.runQA !== false) {
        try {
          this.emit({ type: 'phase_start', phase: `qa_ep_${i}`, message: `Running QA for Episode ${i}...` });
          normalizeChoiceSetStatChecks(choiceSets);
          const validationInput = this.prepareValidationInput(sceneContents, choiceSets, characterBible, encounters, blueprint);
          const [qaResult, bpResult] = await this.measurePhase(`episode_${i}_qa`, () => Promise.all([
            this.runQualityAssurance(episodeBrief, sceneContents, choiceSets, characterBible, blueprint, encounters),
            this.config.validation.enabled
              ? this.integratedValidator.runFullValidation(validationInput)
              : Promise.resolve(undefined),
          ]));
          qaReport = qaResult;
          bestPracticesReport = bpResult;
          await saveEarlyDiagnostic(outputDirectory, `episode-${i}-qa-report.json`, qaReport);
          if (bestPracticesReport) {
            await saveEarlyDiagnostic(outputDirectory, `episode-${i}-best-practices-report.json`, bestPracticesReport);
          }
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
          const treatmentSourcedContinuityBlocks = Boolean(
            episodeBrief.multiEpisode?.sourceAnalysis || episodeBrief.rawDocument?.trim(),
          );
          await this.repairContinuityFindings(
            { episodes: [episode] } as unknown as Story,
            sceneContents, characterBible, qaReport, outputDirectory, blueprint,
            {
              plannedScenes: episodeBrief.seasonPlan?.scenePlan?.scenes,
              ...(treatmentSourcedContinuityBlocks
                ? { forceRevalidation: true, revalidationReason: 'treatment-sourced continuity findings escalate at final contract' }
                : {}),
            },
          );
          await saveEarlyDiagnostic(outputDirectory, `episode-${i}-qa-report.json`, qaReport);
          await saveEarlyDiagnostic(outputDirectory, `episode-${i}-qa-report.post-repair.json`, qaReport);
          this.emit({
            type: 'phase_complete',
            phase: `qa_ep_${i}_post_repair`,
            message: `Episode ${i} QA Post-Repair Score: ${qaReport.overallScore}/100 - ${qaReport.passesQA ? 'PASSED' : 'NEEDS REVISION'}`,
          });
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
        episodeBrief,
        blueprint,
        branchAnalysis,
        sceneContents,
        choiceSets,
        encounters,
        validationExecutionRecords,
        result: { episodeNumber: i, title: episodeOutline.title, success: true },
        qaReport,
        bestPracticesReport,
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
        const architectureDiagnostics = epError instanceof PipelineError
          ? epError.context?.diagnostics
          : undefined;
        if (architectureDiagnostics) {
          await saveEarlyDiagnostic(outputDirectory, `episode-${i}-architecture-failure-diagnostics.json`, architectureDiagnostics);
        }
        await savePipelineErrorLog(outputDirectory, [{
          timestamp: new Date().toISOString(),
          phase: `episode_${i}`,
          message: msg,
          stack,
          episodeNumber: i,
          // P3: persist the structured failure context (quarantined units,
          // encounter attempt summaries, phase errors) — the top-line message
          // alone was not enough to diagnose the 2026-07-06 truncation abort.
          ...(epError instanceof PipelineError && epError.context ? { details: epError.context } : {}),
        }]);
      } catch {
        // Keep the episode failure as the primary signal.
      }

      if (this.isFailFastEnabled() || this.config.validation.mode === 'strict') {
        throw epError;
      }
      return {
        result: {
          episodeNumber: i,
          title: episodeOutline.title,
          success: false,
          error: msg,
        },
      };
    }
  }

  private async generateMediaForAuthoredEpisode(params: AuthoredEpisodeArtifacts & {
    worldBible: WorldBible;
    characterBible: CharacterBible;
    outputDirectory: string;
  }): Promise<EpisodeMediaResult> {
    const {
      episode,
      episodeBrief,
      blueprint,
      sceneContents,
      choiceSets,
      encounters,
      worldBible,
      characterBible,
      outputDirectory,
    } = params;
    const i = episode.number ?? episodeBrief.episode.number ?? 0;
    let imageResults: EpisodeImageResults | undefined;
    let encounterImageResults: EpisodeEncounterImageResults | undefined;
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
          // A10: warm up color script in parallel with the episode image phase.
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

    const episodeWithMedia = this.assembleEpisode(
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

    return {
      episode: episodeWithMedia ?? episode,
      storyletFailures: encounterImageResults?.storyletFailures,
      encounterImageDiagnostics,
    };
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
    return this.imagePromptSupport().getEffectiveImagePromptMode();
  }

  private getEffectiveImageQaMode(): 'off' | 'fast' | 'full' {
    return this.imagePromptSupport().getEffectiveImageQaMode();
  }

  private getEffectiveImagePlanningMode(): 'text' | 'visual-storyboard' {
    return this.imagePromptSupport().getEffectiveImagePlanningMode();
  }

  private getStoryboardMaxPanelsPerSheet(): number {
    return this.imagePromptSupport().getStoryboardMaxPanelsPerSheet();
  }

  private async saveSceneVisualPlanningDiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    payload: Record<string, unknown>,
    options?: { suffix?: string },
  ): Promise<void> {
    return this.imagePromptSupport().saveSceneVisualPlanningDiagnostic(outputDirectory, scopedSceneId, payload, options);
  }

  private buildBeatSceneStoryboardPlan(params: {
    sceneId: string;
    scopedSceneId: string;
    sceneName: string;
    sceneDescription?: string;
    beats: Array<{ id: string; text?: string }>;
    visualPlan?: VisualPlan;
  }): SceneVisualStoryboardPlan {
    return this.imagePromptSupport().buildBeatSceneStoryboardPlan(params);
  }

  private wrapLlmImagePromptWithContracts(
    prompt: ImagePrompt,
    input: import('../images/beatPromptBuilder').BeatPromptInput,
    sceneContext: import('../images/beatPromptBuilder').ScenePromptContext,
    characterNames: string[],
    promptMode: string,
    brief: FullCreativeBrief,
  ): ImagePrompt {
    return this.imagePromptSupport().wrapLlmImagePromptWithContracts(prompt, input, sceneContext, characterNames, promptMode, brief);
  }

  private applyVisualContinuityAffordance(
    prompt: ImagePrompt,
    coveragePlan?: import('../../types/content').BeatCoveragePlan,
  ): ImagePrompt {
    return this.imagePromptSupport().applyVisualContinuityAffordance(prompt, coveragePlan);
  }

  private promptMentionsDisallowedCharacters(
    prompt: ImagePrompt,
    allowedCharacterNames: string[],
    allSceneCharacterNames: string[],
  ): string[] {
    return this.imagePromptSupport().promptMentionsDisallowedCharacters(prompt, allowedCharacterNames, allSceneCharacterNames);
  }

  private promptMissingRequiredCharacters(
    prompt: ImagePrompt,
    requiredCharacterNames: string[],
  ): string[] {
    return this.imagePromptSupport().promptMissingRequiredCharacters(prompt, requiredCharacterNames);
  }

  private shouldRunHeroVisualQA(
    beat: any,
    beatIndex: number,
    totalBeats: number,
    qaMode: 'off' | 'fast' | 'full',
  ): boolean {
    return this.imagePromptSupport().shouldRunHeroVisualQA(beat, beatIndex, totalBeats, qaMode);
  }

  private async saveSceneVisualQADiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    report: unknown,
  ): Promise<void> {
    return this.imagePromptSupport().saveSceneVisualQADiagnostic(outputDirectory, scopedSceneId, report);
  }

  private serializeVisualQAReport(report: any): Record<string, unknown> {
    return this.imagePromptSupport().serializeVisualQAReport(report);
  }

  private async saveBeatVisualQADiagnostic(
    outputDirectory: string | undefined,
    identifier: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.imagePromptSupport().saveBeatVisualQADiagnostic(outputDirectory, identifier, payload);
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

  private getCharacterIdsInScene(scene: SceneContent, characterBible: CharacterBible, protagonistId?: string): string[] {
    return getCharacterIdsInSceneImpl(scene, characterBible, protagonistId);
  }

  private resolveCharacterId(idOrName: string, characterBible: CharacterBible): string | null {
    return resolveCharacterIdImpl(idOrName, characterBible);
  }

  private resolveProtagonistCharacterId(characterBible: CharacterBible, brief: FullCreativeBrief): string | null {
    return resolveProtagonistCharacterIdImpl(characterBible, brief);
  }

  private resolveCharacterIdWithBrief(idOrName: string, characterBible: CharacterBible, brief: FullCreativeBrief): string | null {
    return resolveCharacterIdWithBriefImpl(idOrName, characterBible, brief);
  }

  private normalizeCharacterIds(ids: string[] | undefined, characterBible: CharacterBible): string[] {
    return normalizeCharacterIdsImpl(ids, characterBible);
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

  private _imagePromptSupport?: ImagePromptSupport;

  /**
   * Memoized image-prompt support service (sanitization, render contracts,
   * QA gating/diagnostics, regeneration strengthening) — see
   * pipeline/imagePromptSupport.ts. Config and image state are read lazily.
   */
  private imagePromptSupport(): ImagePromptSupport {
    if (!this._imagePromptSupport) {
      this._imagePromptSupport = new ImagePromptSupport({
        config: () => this.config,
        imageService: () => this.imageService,
        uploadedStyleReferenceImages: () => this._uploadedStyleReferenceImages,
        emit: (event) => this.emit(event),
      });
    }
    return this._imagePromptSupport;
  }

  private normalizeNarrativeText(raw: unknown, fallback = ''): string {
    return this.imagePromptSupport().normalizeNarrativeText(raw, fallback);
  }

  private scrubPromptArtifacts(text: string): string {
    return this.imagePromptSupport().scrubPromptArtifacts(text);
  }

  private sanitizePromptText(raw: unknown, brief: FullCreativeBrief, fallback = ''): string {
    return this.imagePromptSupport().sanitizePromptText(raw, brief, fallback);
  }

  private resolveGeneratedStoryPlayerTemplates(story: Story, brief: FullCreativeBrief): Story {
    return this.imagePromptSupport().resolveGeneratedStoryPlayerTemplates(story, brief);
  }

  private sanitizeImagePrompt(prompt: ImagePrompt, brief: FullCreativeBrief): ImagePrompt {
    return this.imagePromptSupport().sanitizeImagePrompt(prompt, brief);
  }

  private applyThirdPersonRenderContract(
    prompt: ImagePrompt,
    storyboardShot?: VisualStoryboardPacket['shots'][number],
    options?: { isEnvironmentShot?: boolean },
  ): ImagePrompt {
    return this.imagePromptSupport().applyThirdPersonRenderContract(prompt, storyboardShot, options);
  }

  private createSlotReferencePack(slotId: string, references: unknown[] | undefined): SlotReferencePack | undefined {
    return this.imagePromptSupport().createSlotReferencePack(slotId, references);
  }

  private withSettingAwarePrompt(prompt: ImagePrompt, settingContext?: SceneSettingContext): ImagePrompt {
    return this.imagePromptSupport().withSettingAwarePrompt(prompt, settingContext);
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

  private resolvePlayerTemplates(text: string, brief: FullCreativeBrief): string {
    return this.imagePromptSupport().resolvePlayerTemplates(text, brief);
  }

  private analyzeBeatCharacters(
    beatText: string,
    beatSpeaker: string | undefined,
    sceneCharacterIds: string[],
    characterBible: CharacterBible,
    protagonistId: string
  ): { foreground: string[]; background: string[]; foregroundNames: string[]; backgroundNames: string[] } {
    return analyzeBeatCharactersImpl(beatText, beatSpeaker, sceneCharacterIds, characterBible, protagonistId);
  }

  private isEstablishingBeat(
    beatText: string,
    speaker: string | undefined,
    _primaryAction: string | undefined,
    beatCharContext: { foreground: string[]; foregroundNames: string[] }
  ): boolean {
    return isEstablishingBeatImpl(beatText, speaker, _primaryAction, beatCharContext);
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
    return this.castingReferences().buildCharacterDescriptions(characterIds, characterBible);
  }

  private _castingReferences?: CastingReferences;

  /**
   * Memoized casting-references service (appearance descriptions, reference
   * packs, body vocabularies) — see pipeline/castingReferences.ts. Run-scoped
   * image state is read lazily so resume/reset flows stay visible.
   */
  private castingReferences(): CastingReferences {
    if (!this._castingReferences) {
      this._castingReferences = new CastingReferences({
        imageService: () => this.imageService,
        imageAgentTeam: () => this.imageAgentTeam,
        characterReferences: () => this.collectedVisualPlanning.characterReferences,
        locationMasterShots: () => this.locationMasterShots,
        styleAnchorPaths: () => this._styleAnchorPaths,
        uploadedStyleReferenceImages: () => this._uploadedStyleReferenceImages,
        shouldAttachCompositeCharacterRefs: () => this.shouldAttachCompositeCharacterRefs(),
        emit: (event) => this.emit(event),
      });
    }
    return this._castingReferences;
  }

  private extractCanonicalAppearance(
    sources: string[],
    distinctiveFeatures: string[] | undefined,
    typicalAttire: string | undefined,
  ): CanonicalAppearance | undefined {
    return extractCanonicalAppearanceImpl(sources, distinctiveFeatures, typicalAttire);
  }

  private gatherCharacterReferenceImages(
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ): Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }> {
    return this.castingReferences().gatherCharacterReferenceImages(characterIds, characterBible, locationId, options);
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
    return this.castingReferences().gatherCharacterBodyVocabularies(characterIds, characterBible);
  }

  private inferBasePostureFromPersonality(personality: string): string {
    return inferBasePostureFromPersonalityImpl(personality);
  }

  private inferGestureStyleFromPersonality(personality: string): string {
    return inferGestureStyleFromPersonalityImpl(personality);
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


  private async validateAndRegenerateImage(
    prompt: ImagePrompt,
    identifier: string,
    metadata: { sceneId: string; beatId: string; type: string; characters: string[]; characterNames: string[]; characterDescriptions: string[]; includeExpressionRefs?: boolean },
    referenceImages: Array<{ data: string; mimeType: string }> | undefined,
    maxAttempts: number = 2
  ): Promise<{ imageUrl?: string; imageData?: string; mimeType?: string }> {
    return this.imagePromptSupport().validateAndRegenerateImage(prompt, identifier, metadata, referenceImages, maxAttempts);
  }

  private strengthenPromptForRegeneration(prompt: ImagePrompt, attemptNumber: number): ImagePrompt {
    return this.imagePromptSupport().strengthenPromptForRegeneration(prompt, attemptNumber);
  }

  private isGenericAction(action: string): boolean {
    return this.imagePromptSupport().isGenericAction(action);
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
   * keys and encounter-tree image wiring are bound.
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
	        writeValidatorMemory: this.writeValidatorMemory.bind(this),
	        saveFailedContractArtifacts: async (story, report) => {
          const rawOutputDirectory = this._currentOutputDirectory || story.outputDir;
          if (!rawOutputDirectory) return;
          const outputDirectory = rawOutputDirectory.endsWith('/') ? rawOutputDirectory : `${rawOutputDirectory}/`;
          await saveFinalStoryContractFailure(outputDirectory, story, report);
        },
        saveRepairRoundSnapshot: async (snapshot, story, report) => {
          const rawOutputDirectory = this._currentOutputDirectory || story.outputDir;
          if (!rawOutputDirectory) return;
          await saveFinalContractRepairRound(rawOutputDirectory, snapshot, story, report);
        },
        disambiguateProtagonistPronouns: this.disambiguateProtagonistPronouns.bind(this),
        authorEncounterOutcomeVariants: this.authorEncounterOutcomeVariants.bind(this),
        relationshipDimensionsForNpc: this.relationshipDimensionsForNpc.bind(this),
      } satisfies Partial<FinalContractDeps> as unknown as FinalContractDeps;
      Object.defineProperties(deps, {
        allSceneValidationResults: { get: () => this.allSceneValidationResults },
        sceneValidationResults: { get: () => this.sceneValidationResults },
        seasonChoicePlan: { get: () => this.seasonChoicePlan },
        plannedChoiceTypesByScene: { get: () => this.plannedChoiceTypesByScene },
        seasonSkillPlan: { get: () => this.seasonSkillPlan },
        callbackLedger: { get: () => this.callbackLedger },
        allEncounterTelemetry: { get: () => this.allEncounterTelemetry },
        remediationBudget: { get: () => this.remediationBudget },
        planTimeFidelityFindings: { get: () => this.planTimeFidelityFindings },
        planTimeFidelityBaseline: { get: () => this.planTimeFidelityBaseline },
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
        getAgentMemoryContext: this.getAgentMemoryContext.bind(this),
        getUnresolvedCallbacksForPrompt: this.getUnresolvedCallbacksForPrompt.bind(this),
        resolveWorldLocationForScene: this.resolveWorldLocationForScene.bind(this),
      } satisfies Partial<SceneGraphValidationDeps> as unknown as SceneGraphValidationDeps;
      // sceneCritic may be constructed after this accessor first runs, and
      // cachedPipelineMemory is set once memory loads — read both lazily.
      Object.defineProperties(deps, {
        sceneCritic: { get: () => this.sceneCritic ?? null },
        cachedPipelineMemory: { get: () => this.renderedPipelineMemory },
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

  private mapSpeakerMoodToEmotion(speakerMood?: string): 'hopeful' | 'tense' | 'melancholy' | 'triumphant' | 'eerie' | 'neutral' {
    return mapSpeakerMoodToEmotionImpl(speakerMood);
  }

  private inferIntensity(speakerMood?: string, text?: string): 'low' | 'medium' | 'high' {
    return inferIntensityImpl(speakerMood, text);
  }

  private inferValence(speakerMood?: string, text?: string): 'positive' | 'negative' | 'ambiguous' {
    return inferValenceImpl(speakerMood, text);
  }

  private extractSceneContext(
    scene: SceneContent,
    sceneIndex: number,
    totalScenes: number,
    worldBible: WorldBible
  ): ReturnType<typeof extractSceneContextImpl> {
    return extractSceneContextImpl(scene, sceneIndex, totalScenes, worldBible);
  }

  private mapChoicePositions(
    choiceSets: ChoiceSet[],
    scene: SceneContent
  ): ReturnType<typeof mapChoicePositionsImpl> {
    return mapChoicePositionsImpl(choiceSets, scene);
  }

  private resolveWorldLocationForScene(
    sceneBlueprint: Pick<SceneBlueprint, 'location' | 'name' | 'description'>,
    worldBible: WorldBible
  ) {
    return resolveWorldLocationForSceneImpl(sceneBlueprint, worldBible);
  }

  private ensureChoiceBridgeBeats(
    blueprint: EpisodeBlueprint,
    sceneBlueprint: SceneBlueprint,
    content: SceneContent,
    choiceMap: Map<string, ChoiceSet>,
  ): void {
    ensureChoiceBridgeBeatsImpl(blueprint, sceneBlueprint, content, choiceMap);
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
   * The ceiling defaults to config.remediationBudgetTotal (default 48) so
   * runaway owner-stage / final-contract repair loops cannot burn unbounded spend.
   */
  private resetRemediationBudget(): void {
    this.remediationBudget = createRemediationBudget(this.config.generation?.remediationBudgetTotal ?? 48);
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

  private async recordArcPressureShadowSafe(seasonPlan: SeasonPlan | undefined, storyId?: string): Promise<void> {
    if (!seasonPlan) return;
    const result = new ArcPressureArchitectureValidator().validate(seasonPlan, {
      treatmentSourced: (seasonPlan.arcPressureContracts ?? []).some((contract) => contract.source === 'treatment'),
      arcPressureContracts: seasonPlan.arcPressureContracts,
    });
    const blockingCount = result.issues.filter((issue) => issue.severity === 'error').length;
    await this.recordGateShadowSafe(buildValidatorPromotionRecord({
      gate: PLAN_GATE_FLAGS.arcPressure,
      validator: 'ArcPressureArchitectureValidator',
      scope: 'season',
      placement: 'plan',
      enabled: isGateEnabled(PLAN_GATE_FLAGS.arcPressure),
      blockingCount,
      repairAttempted: true,
      repairSucceeded: blockingCount === 0,
      residualBlockingCount: blockingCount,
      storyId,
      issues: result.issues,
      details:
        `arcs=${seasonPlan.arcs?.length ?? 0}; contracts=${seasonPlan.arcPressureContracts?.length ?? 0}; ` +
        `metrics=${JSON.stringify(result.metrics)}`,
    }));
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
      this._pipelineMemory = new PipelineMemory({
        config: this.config,
        getRecallDeps: () => ({
          artifactMemory: this._artifactMemoryService,
          factMemory: this._factMemoryService,
        }),
      });
    }
    return this._pipelineMemory;
  }

  getMemoryTelemetrySummary(): MemoryRunSummary {
    const summary = memoryTelemetry.getSummary();
    return {
      ...summary,
      errors: summary.errors.slice(0, 20),
    };
  }

  private getMemorySummaryForLedger(): {
    recallCount: number;
    writeCount: number;
    emptyRecallCount: number;
    recallFailureCount: number;
    writeFailureCount: number;
    cognifyFailureCount: number;
    circuitOpenSkipCount: number;
    providerEmptyRecallCount: number;
    filterFallbackCount: number;
    breakerOpenCount: number;
    totalResultCount: number;
    totalLatencyMs: number;
    errorCount: number;
  } {
    const summary = this.getMemoryTelemetrySummary();
    return {
      recallCount: summary.recallCount,
      writeCount: summary.writeCount,
      emptyRecallCount: summary.emptyRecallCount,
      recallFailureCount: summary.recallFailureCount,
      writeFailureCount: summary.writeFailureCount,
      cognifyFailureCount: summary.cognifyFailureCount,
      circuitOpenSkipCount: summary.circuitOpenSkipCount,
      providerEmptyRecallCount: summary.providerEmptyRecallCount,
      filterFallbackCount: summary.filterFallbackCount,
      breakerOpenCount: summary.breakerOpenCount,
      totalResultCount: summary.totalResultCount,
      totalLatencyMs: summary.totalLatencyMs,
      errorCount: summary.errors.length,
    };
  }

  private memoryFlushTargets(): string[] {
    // Cognee's graph extraction takes a database writer lock. Flush after QA by
    // default so scene-authoring recalls do not contend with cognify work.
    const raw = process.env.STORYRPG_MEMORY_FLUSH_AT || 'qa';
    return raw.split(',').map((part: string) => part.trim()).filter(Boolean);
  }

  private async flushPipelineMemory(storyId: string, lifecycle: 'episode' | 'qa' | 'run'): Promise<void> {
    if (!this.memoryFlushTargets().includes(lifecycle)) return;
    await this.factMemoryService().flush();
    await this.pipelineMemory().cognifyDatasets([
      `storyrpg-run-${slugifyMemoryKey(storyId)}`,
      this.config.memory?.validatorDataset || 'storyrpg-validator-history',
    ], { background: true });
  }

  private get renderedPipelineMemory(): string | null {
    return renderPipelineMemoryPacket(this.cachedPipelineMemory, this.config.memory?.maxPromptChars);
  }

  private agentMemoryContextBuilder(): AgentMemoryContextBuilder {
    if (!this._agentMemoryContextBuilder) {
      this._agentMemoryContextBuilder = new AgentMemoryContextBuilder(this.pipelineMemory());
    }
    return this._agentMemoryContextBuilder;
  }

  private validatorEvidenceService(): ValidatorEvidenceService {
    if (!this._validatorEvidenceService) {
      this._validatorEvidenceService = new ValidatorEvidenceService(this.pipelineMemory());
    }
    return this._validatorEvidenceService;
  }

  private artifactMemoryService(): ArtifactMemoryService {
    if (!this._artifactMemoryService) {
      this._artifactMemoryService = new ArtifactMemoryService(this.pipelineMemory());
    }
    return this._artifactMemoryService;
  }

  private factMemoryService(): FactMemoryService {
    if (!this._factMemoryService) {
      this._factMemoryService = new FactMemoryService(this.pipelineMemory());
    }
    return this._factMemoryService;
  }

  private artifactContextResolver(): ArtifactContextResolver {
    if (!this._artifactContextResolver) {
      this._artifactContextResolver = new ArtifactContextResolver({
        memory: this.pipelineMemory(),
        artifactMemory: this.artifactMemoryService(),
      });
    }
    return this._artifactContextResolver;
  }

  private async getAgentMemoryContext(request: AgentMemoryRequest): Promise<string | null> {
    // One orchestrator resolves exact artifacts, current typed facts, then
    // semantic historical context. Running the legacy agent-memory and artifact
    // paths in parallel doubled Cognee queries and blurred source authority.
    const artifactPack = await this.artifactContextResolver().resolveForAgent({
      agentRole: request.agentRole,
      lifecycle: request.lifecycle,
      storyId: request.storyId,
      episodeNumber: request.episodeNumber,
      sceneId: request.sceneId,
      characterIds: request.characterIds,
      artifactKinds: request.artifactKinds,
      artifactIds: request.artifactIds,
      factKinds: request.factKinds,
      factIds: request.factIds,
      sourceFingerprint: request.sourceFingerprint || request.treatmentId,
      recallMode: request.recallMode || 'facts-first',
      topK: request.topK,
      maxPromptChars: request.maxPromptChars,
    });
    return artifactPack.renderedPromptBlock;
  }

  private async getScopedAgentMemoryContext(
    agentRole: AgentMemoryRole,
    lifecycle: string,
    brief: FullCreativeBrief,
    extra: Partial<AgentMemoryRequest> = {},
  ): Promise<string | null> {
    return this.getAgentMemoryContext({
      agentRole,
      lifecycle,
      storyId: brief.story.title,
      episodeNumber: brief.episode?.number,
      treatmentId: brief.multiEpisode?.sourceAnalysis?.sourceTitle,
      ...extra,
    });
  }

  private async recallValidatorEvidence(
    validator: string,
    lifecycle: string,
    briefOrStoryId?: FullCreativeBrief | string,
    extra: Partial<Parameters<ValidatorEvidenceService['recall']>[0]> = {},
  ): Promise<ValidatorEvidenceBundle> {
    const brief = typeof briefOrStoryId === 'string' ? undefined : briefOrStoryId;
    const mergedExtra = typeof briefOrStoryId === 'string'
      ? { ...extra, storyId: briefOrStoryId }
      : extra;
    return recallValidatorMemory(
      this.validatorEvidenceService(),
      validator,
      lifecycle,
      brief,
      mergedExtra,
    );
  }

  private async writeArtifactMemory<T>(input: WritePipelineArtifactInput<T>): Promise<void> {
    await this.artifactMemoryService().writeArtifact(input).then((envelope) =>
      this.factMemoryService().writeFactsForArtifact(envelope),
    ).catch((err) => {
      if (this.config.debug) {
        console.warn(`[Pipeline] Artifact memory write failed for ${input.artifactKind}:`, err);
      }
    });
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

  async recallPipelineMemory(): Promise<PipelineMemoryPacket | null> {
    return this.pipelineMemory().recallPacket();
  }

  async writeValidatorMemory(opts: Parameters<PipelineMemory['writeValidatorMemory']>[0]): Promise<void> {
    return this.pipelineMemory().writeValidatorMemory(opts);
  }

  async writePipelineMemoryRecord(opts: Parameters<PipelineMemory['writeRecord']>[0]): Promise<void> {
    return this.pipelineMemory().writeRecord(opts);
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

    await writeFinalStoryPackage(outputDir, story, {
      generator: { pipeline: 'FullStoryPipeline.video-only' },
    });

    console.log(`[Pipeline] Video-only run complete: ${videosGenerated} videos for "${story.title}"${options.targetEpisodeNumber != null ? ` episode ${options.targetEpisodeNumber}` : ''}`);
    return { videosGenerated, story };
  }
}
