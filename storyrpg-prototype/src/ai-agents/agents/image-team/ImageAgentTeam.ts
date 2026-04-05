import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { 
  ImagePrompt, 
  SceneImageRequest, 
  BeatImageRequest, 
  CoverImageRequest, 
  EncounterSequenceRequest,
  CharacterMasterRequest,
  LocationMasterRequest,
  GeneratedImage
} from '../ImageGenerator';
import { StoryboardAgent, StoryboardRequest, VisualPlan } from './StoryboardAgent';
import { VisualIllustratorAgent, IllustrationRequest } from './VisualIllustratorAgent';
import { EncounterImageAgent } from './EncounterImageAgent';
import { ConsistencyScorerAgent, ConsistencyRequest, ConsistencyScore } from './ConsistencyScorerAgent';
import { CompositionValidatorAgent, CompositionRequest } from './CompositionValidatorAgent';
import { 
  CharacterReferenceSheetAgent, 
  CharacterReferenceSheetRequest, 
  CharacterReferenceSheet,
  ReferenceView 
} from './CharacterReferenceSheetAgent';
import { 
  PoseDiversityValidator, 
  DiversityValidationRequest, 
  DiversityReport,
  ShotMetadata 
} from './PoseDiversityValidator';
import {
  TransitionValidator,
  TransitionValidationRequest,
  TransitionValidationReport
} from './TransitionValidator';
import {
  ExpressionValidator,
  ExpressionValidationRequest,
  ExpressionValidationReport
} from './ExpressionValidator';
import {
  BodyLanguageValidator,
  BodyLanguageValidationRequest,
  BodyLanguageValidationReport
} from './BodyLanguageValidator';
import {
  ColorScriptAgent,
  ColorScriptRequest,
  StoryBeatInput
} from './ColorScriptAgent';
import {
  LightingColorValidator,
  LightingColorValidationRequest,
  LightingColorValidationReport
} from './LightingColorValidator';
import { extractReferenceFaceCrop } from '../../utils/imageResizer';
import {
  MoodSpec,
  ColorScript,
  ColorScriptBeat,
  LightingSpec,
  ColorSpec,
  generateMoodSpec,
  generateLightingColorPrompt,
  validateMoodForBeat
} from './LightingColorSystem';
import {
  VisualStorytellingValidator,
  VisualStorytellingValidationRequest,
  VisualStorytellingValidationReport,
  SequenceValidationRequest,
  SequenceValidationReport
} from './VisualStorytellingValidator';
import type {
  VisualStorytellingSpec,
  ClaritySpec,
  CompositionFlowSpec,
  EnvironmentSpec,
  PacingSpec,
  TransitionType,
  TransitionSpec,
  RhythmRole,
  ChangeMagnitude,
  InformationDensity,
  MotifPresence,
  MotifLibrary,
  VisualMotif,
  ChoiceTelegraph
} from './VisualStorytellingSystem';
import {
  suggestRhythmRole,
  suggestTransitionType,
  suggestEnvironmentPersonality,
  validateAdvancement,
  buildPacingSpec,
  getDefaultContinuity,
  getSuggestedPacing,
  TRANSITION_RULES,
  RHYTHM_ROLE_GUIDANCE,
  // Camera helpers
  suggestShotType,
  suggestCameraHeight,
  shouldCrossLine,
  buildDefaultCameraSpec,
  // Texture helpers
  suggestTextureSpec,
  buildDefaultTextureSpec,
  generateTexturePrompt,
  // Spatial helpers
  suggestPerspectiveType,
  suggestStagingPattern,
  suggestCharacterDistance,
  suggestSpatialSpec,
  buildDefaultSpatialSpec,
  generateSpatialPrompt
} from './VisualStorytellingSystem';
import { CORE_VISUAL_PRINCIPLE, MOBILE_COMPOSITION_FRAMEWORK, FORBIDDEN_DEFAULTS } from '../../prompts';
import { DIVERSITY_STORY_STRONG_THRESHOLD } from '../../../constants/validation';

// Re-export reference sheet types for consumers
export type { 
  CharacterReferenceSheet, 
  CharacterReferenceSheetRequest, 
  ReferenceView,
  CharacterExpressionSheet,
  ExpressionName,
  ExpressionDefinition
} from './CharacterReferenceSheetAgent';
export {
  EXPRESSION_LIBRARY,
  EXPRESSION_TIERS,
  EMOTION_TO_EXPRESSION_MAP,
  findExpressionForEmotion,
  findExpressionsForEmotion,
  ACTION_POSE_DEFINITIONS
} from './CharacterReferenceSheetAgent';

// Re-export drama extraction types
export type {
  DramaExtraction,
  DramaExtractionRequest,
  CharacterPhysicalManifestation
} from './DramaExtractionAgent';
export { DramaExtractionAgent } from './DramaExtractionAgent';

// Re-export cinematic beat analyzer
export {
  analyzeBeatCinematically,
  detectBeatType,
  getBodyLanguageForBeatType,
  getCameraForBeatType
} from './CinematicBeatAnalyzer';
export type { BeatType, CinematicAnalysis } from './CinematicBeatAnalyzer';

// Re-export character action library
export {
  inferMovementProfile,
  getCharacterBodyLanguage,
  getSuggestedAsymmetry,
  POSTURE_DESCRIPTIONS,
  GESTURE_DESCRIPTIONS,
  WEIGHT_DESCRIPTIONS,
  EMOTION_BODY_MAP
} from './CharacterActionLibrary';
export type {
  CharacterMovementProfile,
  BasePosture,
  GestureStyle,
  WeightDistribution,
  TensionLevel
} from './CharacterActionLibrary';

// Re-export sequential context types
export type { BeatVisualContext } from './VisualIllustratorAgent';
// Re-export pose diversity types
export type { DiversityReport, DiversityValidationRequest, ShotMetadata } from './PoseDiversityValidator';
// Re-export transition types
export type { TransitionValidationReport, TransitionValidationRequest } from './TransitionValidator';
export type { TransitionType, TransitionSpecification, CharacterEmotion, VisualPlan } from './StoryboardAgent';
// Re-export expression validation types
export type { 
  ExpressionValidationReport, 
  ExpressionValidationRequest, 
  CharacterExpressionValidation,
  ExpressionPacingReport,
  ExpressionPacingRequest,
  EmotionalTransition,
  ExtremeExpressionUsage
} from './ExpressionValidator';
// Re-export expression pacing helpers
export { 
  EXPRESSION_PACING_RULES, 
  EXTREME_EXPRESSIONS,
  getEmotionalDistance,
  isExtremeExpression,
  suggestTransitionPath
} from './CharacterReferenceSheetAgent';
// Re-export body language types
export type {
  BodyLanguageValidationReport,
  BodyLanguageValidationRequest,
  CharacterBodyValidation,
  BodyLanguageStructuralCheck
} from './BodyLanguageValidator';
export type {
  CharacterBodyVocabulary,
  CharacterFullReference,
  CharacterSilhouetteProfile,
  ShapeLanguage
} from './CharacterReferenceSheetAgent';
export type {
  CharacterActingSpec,
  BodyLanguageSpec,
  SilhouetteGoal,
  CharacterIntent,
  StatusLevel,
  RelationalStance,
  SpatialRelation
} from './StoryboardAgent';
// Re-export body language principles
export {
  BODY_LANGUAGE_PRINCIPLES,
  STATUS_BODY_LANGUAGE,
  APPROACH_AVOIDANCE_LANGUAGE,
  SILHOUETTE_RULES,
  SILHOUETTE_DESIGN_RULES
} from './CharacterReferenceSheetAgent';
// Re-export lighting/color types
export type {
  MoodSpec,
  ColorScript,
  ColorScriptBeat,
  LightingSpec,
  ColorSpec
} from './LightingColorSystem';
// LightingColorValidationReport and LightingColorValidationRequest come from LightingColorValidator
export type { LightingColorValidationReport, LightingColorValidationRequest } from './LightingColorValidator';
export type { ColorScriptRequest, StoryBeatInput } from './ColorScriptAgent';
// Re-export lighting/color helpers
export {
  generateMoodSpec,
  generateLightingColorPrompt,
  validateMoodForBeat,
  EMOTION_TO_LIGHTING,
  EMOTION_TO_COLOR,
  LIGHTING_DIRECTION_GUIDE,
  COLOR_TEMPERATURE_GUIDE
} from './LightingColorSystem';
// Re-export unified visual storytelling types
export type {
  // Camera
  ShotType,
  CameraHeight,
  CameraTilt,
  CompositionType,
  CameraPOV,
  CameraSide,
  CameraChange,
  CameraSpec,
  // Spatial
  PerspectiveType,
  DepthLayers,
  StagingPattern,
  CharacterDistance,
  CharacterOrientation,
  SpatialSpec,
  // Silhouette & Impact
  BeatSilhouetteSpec,
  ImpactSpec,
  ImpactTarget,
  DetailPriority,
  // Texture
  TextureDensity,
  TextureScale,
  TextureContrast,
  TextureShapeAlignment,
  TextureFocus,
  SurfaceRoughness,
  TextureSpec,
  // Composition
  VisualStorytellingSpec,
  ClaritySpec,
  CompositionFlowSpec,
  EnvironmentSpec,
  EnvironmentPersonality,
  // Pacing
  PacingSpec,
  // TransitionType - already exported from StoryboardAgent
  TransitionSpec,
  RhythmRole,
  ChangeMagnitude,
  InformationDensity,
  // Story
  MotifPresence,
  VisualMotif,
  MotifLibrary,
  ChoiceTelegraph
} from './VisualStorytellingSystem';
export type {
  VisualStorytellingValidationReport,
  VisualStorytellingValidationRequest,
  SequenceValidationReport,
  CameraValidation,
  ShotVarietyCheck,
  TextureValidation,
  SpatialValidation,
  SilhouetteValidation,
  ImpactValidation
} from './VisualStorytellingValidator';
// Re-export unified helpers
export {
  // Rhythm/transition
  suggestRhythmRole,
  suggestTransitionType,
  suggestEnvironmentPersonality,
  validateAdvancement,
  buildPacingSpec,
  getDefaultContinuity,
  getSuggestedPacing,
  // Camera
  suggestShotType,
  suggestCameraHeight,
  shouldCrossLine,
  buildDefaultCameraSpec,
  // Spatial
  suggestPerspectiveType,
  suggestStagingPattern,
  suggestCharacterDistance,
  suggestSpatialSpec,
  buildDefaultSpatialSpec,
  generateSpatialPrompt,
  validateSpatialSpec,
  checkSpatialConsistency,
  // Silhouette & Impact
  suggestBeatSilhouetteSpec,
  suggestImpactSpec,
  generateSilhouettePrompt,
  generateImpactPrompt,
  validateBeatSilhouetteSpec,
  validateImpactSpec,
  // Texture
  suggestTextureSpec,
  buildDefaultTextureSpec,
  generateTexturePrompt,
  validateTextureSpec,
  // Rules
  TRANSITION_RULES,
  RHYTHM_ROLE_GUIDANCE,
  CLARITY_RULES,
  COMPOSITION_FLOW_RULES,
  ENVIRONMENT_RULES,
  CHOICE_PROXIMITY_RULES,
  SHOT_TYPE_GUIDE,
  CAMERA_HEIGHT_GUIDE,
  AXIS_CONTINUITY_RULES,
  CAMERA_CHANGE_RULES,
  PERSPECTIVE_TYPE_GUIDE,
  STAGING_PATTERN_GUIDE,
  SPATIAL_CONSISTENCY_RULES,
  BRANCH_SPATIAL_MAP,
  SILHOUETTE_POSE_RULES,
  IMPACT_COMPOSITION_RULES,
  TEXTURE_RULES,
  MATERIAL_TEXTURE_GUIDE,
  TEXTURE_MOOD_MAP,
  BRANCH_TEXTURE_MAP
} from './VisualStorytellingSystem';

// Storage for generated reference sheets (character ID -> sheet with generated images)
export interface GeneratedReferenceSheet extends CharacterReferenceSheet {
  generatedImages: Map<string, GeneratedImage>; // viewType (or viewType-expressionName) -> image
}

// Storage for generated expression sheets (character ID -> sheet with generated expression images)
export interface GeneratedExpressionSheet {
  characterId: string;
  characterName: string;
  expressionTier: string;
  expressions: Array<{
    expressionName: string;
    prompt: ImagePrompt;
    generatedImage?: GeneratedImage;
  }>;
  expressionNotes: string;
  personalityInfluence: string;
  generatedImages: Map<string, GeneratedImage>; // expressionName -> image
}

export class ImageAgentTeam extends BaseAgent {
  private storyboardAgent: StoryboardAgent;
  private illustratorAgent: VisualIllustratorAgent;
  private encounterAgent: EncounterImageAgent;
  private consistencyScorer: ConsistencyScorerAgent;
  private compositionValidator: CompositionValidatorAgent;
  private referenceSheetAgent: CharacterReferenceSheetAgent;
  private poseDiversityValidator: PoseDiversityValidator;
  private transitionValidator: TransitionValidator;
  private expressionValidator: ExpressionValidator;
  private bodyLanguageValidator: BodyLanguageValidator;
  private colorScriptAgent: ColorScriptAgent;
  private lightingColorValidator: LightingColorValidator;
  private visualStorytellingValidator: VisualStorytellingValidator;
  private artStyle?: string;
  
  // Cache of character body vocabularies
  private characterBodyVocabularies: Map<string, import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary> = new Map();
  
  // Cache of character silhouette profiles
  private characterSilhouetteProfiles: Map<string, import('./CharacterReferenceSheetAgent').CharacterSilhouetteProfile> = new Map();
  
  // Cache of color scripts
  private colorScripts: Map<string, ColorScript> = new Map();
  
  // Cache of visual motifs
  private motifLibraries: Map<string, MotifLibrary> = new Map();

  // Cache of generated reference sheets for consistency checking
  private characterReferenceSheets: Map<string, GeneratedReferenceSheet> = new Map();
  
  // Cache of generated expression sheets for expression reference
  private characterExpressionSheets: Map<string, GeneratedExpressionSheet> = new Map();
  
  // Cache of last shot from previous scene for scene-to-scene transitions
  private lastSceneShot?: {
    sceneId: string;
    shotId: string;
    description: string;
    environment: string;
    lighting: string;
    palette: string;
    characters: string[];
  };

  constructor(config: AgentConfig, artStyle?: string) {
    super('Image Agent Team', config);
    this.artStyle = artStyle;
    
    // Initialize the team
    // StoryboardAgent needs the full model output budget — Sonnet 4.6 supports 64K output tokens.
    // A scene with 16 beats at ~2K tokens/shot = ~32K tokens; verbose responses can exceed 32K.
    // Setting to 64000 (model limit) eliminates premature truncation that produced shots: [].
    const storyboardConfig = { ...config, maxTokens: 64000 };
    this.storyboardAgent = new StoryboardAgent(storyboardConfig, artStyle);
    this.illustratorAgent = new VisualIllustratorAgent(config, artStyle);
    this.encounterAgent = new EncounterImageAgent(config, artStyle);
    this.consistencyScorer = new ConsistencyScorerAgent(config);
    this.compositionValidator = new CompositionValidatorAgent(config);
    this.referenceSheetAgent = new CharacterReferenceSheetAgent(config, artStyle);
    this.poseDiversityValidator = new PoseDiversityValidator(config);
    this.transitionValidator = new TransitionValidator(config);
    this.expressionValidator = new ExpressionValidator(config);
    this.bodyLanguageValidator = new BodyLanguageValidator(config);
    this.colorScriptAgent = new ColorScriptAgent(config);
    this.lightingColorValidator = new LightingColorValidator(config);
    this.visualStorytellingValidator = new VisualStorytellingValidator(config);
  }

  /**
   * Main execute method - orchestrates the team based on input type
   */
  async execute(input: unknown): Promise<AgentResponse<any>> {
    // Determine the type of request and delegate
    if (typeof input === 'object' && input !== null) {
      if ('beats' in input && 'sceneId' in input) {
        return this.generateFullSceneVisuals(input as StoryboardRequest);
      }
      // Fallback to individual methods if needed
    }
    
    return {
      success: false,
      error: 'Invalid input for ImageAgentTeam. Use specific generation methods.'
    };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Image Agent Team Coordinator

You orchestrate a team of specialized agents to produce high-quality, cinematic visuals.

${CORE_VISUAL_PRINCIPLE}

## Your Mission
Eliminate visual monotony and ensure strict character consistency. 

${FORBIDDEN_DEFAULTS}

## STRICTOR CONSISTENCY RULES
- You MUST use the provided Master Reference images for every character mentioned.
- Characters MUST have consistent hair color, eye color, clothing style, and facial features.
- If a character's description mentions a specific artifact (e.g. "silver pendant"), it MUST appear in every shot.

${MOBILE_COMPOSITION_FRAMEWORK}
`;
  }

  private async persistStoryboardPassCheckpoint(
    jobId: string | undefined,
    sceneId: string,
    contractHash: string,
    telemetry: { plannedChunks: number; expandedChunks: number; repairedShots: number; auditFailures: number }
  ): Promise<void> {
    if (!jobId || typeof fetch === 'undefined') return;
    const idempotencyKey = `${jobId}:${sceneId}:storyboard-pass:chunked-v1`;
    const stepPatch = {
      idempotencyKey,
      stepId: `storyboard:${sceneId}`,
      steps: {
        [`storyboard:${sceneId}`]: {
          stepId: `storyboard:${sceneId}`,
          status: 'completed',
          updatedAt: new Date().toISOString(),
          idempotencyKey,
          telemetry,
          contractHash,
        },
      },
      outputs: {
        [`storyboard:${sceneId}`]: {
          telemetry,
          contractHash,
        },
      },
    };
    try {
      const target = jobId.startsWith('worker-')
        ? `http://localhost:3001/worker-jobs/${jobId}/checkpoint`
        : `http://localhost:3001/generation-jobs/${jobId}`;
      const method = jobId.startsWith('worker-') ? 'PATCH' : 'PATCH';
      const body = jobId.startsWith('worker-')
        ? JSON.stringify(stepPatch)
        : JSON.stringify({
          checkpoint: {
            storyboardPass: {
              sceneId,
              contractHash,
              idempotencyKey,
              telemetry,
              completedAt: new Date().toISOString(),
            },
          },
        });
      await fetch(target, { method, headers: { 'Content-Type': 'application/json' }, body });
    } catch {
      // best effort only
    }
  }

  /**
   * Orchestrates the generation of all visuals for a scene
   */
  async generateFullSceneVisuals(request: StoryboardRequest): Promise<AgentResponse<VisualPlan & { prompts: Map<string, ImagePrompt> }>> {
    console.log(`[ImageAgentTeam] Planning visuals for scene: ${request.sceneName}`);
    
    // 1. Storyboard Agent plans the shots
    const planRes = await this.storyboardAgent.executeChunked(request);
    if (!planRes.success || !planRes.data) {
      console.error(`[ImageAgentTeam] Storyboard FAILED for scene "${request.sceneName}" (${request.sceneId}): ${planRes.error}`);
      return { success: false, error: `Storyboard planning failed: ${planRes.error}` };
    }
    console.log(`[ImageAgentTeam] Storyboard succeeded for "${request.sceneName}": ${planRes.data.plan.shots?.length ?? 0} shots (chunked: ${planRes.data.passTelemetry.expandedChunks} chunks)`);
    const plan = planRes.data.plan;
    await this.persistStoryboardPassCheckpoint(
      (request as any).jobId,
      request.sceneId,
      planRes.data.contractHash,
      planRes.data.passTelemetry
    );
    // Ensure shots is always an array — guard against truncated LLM responses
    // that parseJSON successfully parsed but with no shots field
    if (!Array.isArray(plan.shots)) {
      plan.shots = [];
    }

    // Enrich each shot's storyBeat with isClimaxBeat/isKeyStoryBeat from request beats
    for (const shot of plan.shots) {
      const beat = request.beats.find((b: { id: string }) => b.id === shot.beatId);
      if (beat && (beat as { isClimaxBeat?: boolean; isKeyStoryBeat?: boolean }).isClimaxBeat !== undefined) {
        if (!shot.storyBeat) shot.storyBeat = { action: '', emotion: '' };
        (shot.storyBeat as { isClimaxBeat?: boolean; isKeyStoryBeat?: boolean }).isClimaxBeat = (beat as { isClimaxBeat?: boolean }).isClimaxBeat;
        (shot.storyBeat as { isKeyStoryBeat?: boolean }).isKeyStoryBeat = (beat as { isKeyStoryBeat?: boolean }).isKeyStoryBeat;
      }
    }
    
    // CRITICAL: Normalize shot IDs - Always prefer beatId for consistency across the pipeline.
    // Some storyboard plans omit beatId and only return generic ids like "shot-4". When that happens,
    // the pipeline later can't map generated images back onto scene beats and incorrectly falls back to
    // recovery rendering for the whole scene.
    plan.shots.forEach((shot, index) => {
      if (!shot.beatId) {
        const authoredBeatId = request.beats[index]?.id;
        if (authoredBeatId) {
          shot.beatId = authoredBeatId;
        }
      }
      // Always use beatId as the canonical ID when available, regardless of whether shot.id was set.
      shot.id = shot.beatId || shot.id || `shot-${index}`;
    });
    
    const prompts = new Map<string, ImagePrompt>();
    
    // 2. Illustrator Agent generates prompts for each shot with full pose specification
    for (const shot of plan.shots) {
      // Use beatId as the shot identifier (shot.id is often not set by the LLM)
      const shotId = shot.beatId || shot.id || `shot-${plan.shots.indexOf(shot)}`;
      console.log(`[ImageAgentTeam] Illustrating shot: ${shotId} (${shot.type}) - Pose: ${shot.pose?.lineOfAction || 'unspecified'}`);
      
      // Find the corresponding beat text if beatId is provided
      const correspondingBeat = request.beats.find(b => b.id === shot.beatId);
      
      // CRITICAL: Resolve character descriptions for this shot so the illustrator
      // knows WHO to draw and WHAT they look like.
      // Pass per-beat foreground/background classification for visual staging.
      const shotCharacters = this.resolveCharactersForShot(
        shot.characters,
        correspondingBeat?.characters,
        request.characterDescriptions,
        correspondingBeat?.foregroundCharacters,
        correspondingBeat?.backgroundCharacters
      );
      
      // Build beat context window — previous and next beat summaries for dramatic moment framing
      const beatIndex = correspondingBeat ? request.beats.indexOf(correspondingBeat) : -1;
      const previousBeatSummary = beatIndex > 0 ? request.beats[beatIndex - 1]?.text : undefined;
      const nextBeatSummary = beatIndex >= 0 && beatIndex < request.beats.length - 1 ? request.beats[beatIndex + 1]?.text : undefined;

      const illustrationReq: IllustrationRequest = {
        shotDescription: shot.description,
        beatText: correspondingBeat?.text,
        type: shot.type,
        shotType: shot.shotType,
        sceneContext: {
          name: request.sceneName,
          description: request.sceneDescription,
          genre: request.genre,
          tone: request.tone,
          mood: shot.mood,
          settingContext: request.sceneContext?.settingContext,
        },
        characters: shotCharacters,
        compositionNotes: shot.composition,
        cameraAngle: shot.cameraAngle,
        horizontalAngle: shot.horizontalAngle,
        wallyWoodPanel: shot.wallyWoodPanel,
        artStyle: this.artStyle,
        // Pass full pose specification from StoryboardAgent
        storyBeat: shot.storyBeat,
        pose: shot.pose,
        poseDescription: shot.poseDescription,
        lighting: shot.lighting,
        lightingDescription: shot.lightingDescription,
        focalPoint: shot.focalPoint,
        depthLayers: shot.depthLayers,
        // Pass visual storytelling specs from StoryboardAgent
        moodSpec: shot.moodSpec as IllustrationRequest['moodSpec'],
        lightingColorPrompt: shot.lightingColorPrompt,
        visualStorytelling: shot.visualStorytelling as IllustrationRequest['visualStorytelling'],
        authoredVisualContract: correspondingBeat ? {
          visualMoment: (correspondingBeat as any).visualMoment,
          primaryAction: (correspondingBeat as any).primaryAction,
          emotionalRead: (correspondingBeat as any).emotionalRead,
          relationshipDynamic: (correspondingBeat as any).relationshipDynamic,
          mustShowDetail: (correspondingBeat as any).mustShowDetail,
        } : undefined,
        visualContractHash: (shot as any).contractHash,
        // Choice payoff: branch scene first beat OR per-choice payoff beat.
        // For per-choice payoffs, include the choice label in the context so the illustrator
        // knows what action was chosen; the visualMoment (= outcomeTexts.partial) provides
        // the narrative prose that describes the physical action in full sentences.
        choicePayoffContext: (beatIndex === 0 && request.incomingChoiceContext)
          ? request.incomingChoiceContext
          : (correspondingBeat as any)?.isChoicePayoff
            ? [
                (correspondingBeat as any).choiceContext
                  ? `Player chose: "${(correspondingBeat as any).choiceContext}".`
                  : null,
                (correspondingBeat as any).visualMoment || correspondingBeat?.text,
              ].filter(Boolean).join(' ')
            : undefined,
        // Beat context window for dramatic moment framing
        previousBeatSummary,
        nextBeatSummary,
      };
      
      const illRes = await this.illustratorAgent.execute(illustrationReq);
      if (illRes.success && illRes.data) {
        prompts.set(shotId, illRes.data);
      } else {
        console.warn(`[ImageAgentTeam] Failed to illustrate shot ${shotId}: ${illRes.error}`);
      }
    }
    
    return {
      success: true,
      data: {
        ...plan,
        prompts
      }
    };
  }

  /**
   * Generates prompts for an encounter sequence
   */
  async generateEncounterPrompts(request: EncounterSequenceRequest): Promise<AgentResponse<ImagePrompt[]>> {
    console.log(`[ImageAgentTeam] Generating encounter prompts for: ${request.encounterId} (${request.outcome})`);
    return this.encounterAgent.execute(request);
  }

  /**
   * Comprehensive validation: Composition + Consistency
   */
  async validateImage(
    image: { data: string; mimeType: string },
    shotType: string,
    intendedComposition: string,
    characterContext?: { name: string; description: string; references: Array<{ data: string; mimeType: string; name: string }> }
  ): Promise<{ success: boolean; score: number; feedback: string; issues: string[] }> {
    const compRes = await this.compositionValidator.execute({ image, shotType, intendedComposition });
    
    let consistencyRes: AgentResponse<ConsistencyScore> | undefined;
    if (characterContext && characterContext.references.length > 0) {
      consistencyRes = await this.consistencyScorer.execute({
        targetImage: image,
        referenceImages: characterContext.references,
        characterName: characterContext.name,
        characterDescription: characterContext.description
      });
    }
    
    const issues = [...(compRes.data?.ruleViolations || [])];
    if (consistencyRes?.data?.issues) {
      issues.push(...consistencyRes.data.issues);
    }
    
    const score = consistencyRes?.data 
      ? ((compRes.data?.score || 0) + consistencyRes.data.score) / 2 
      : (compRes.data?.score || 0);
      
    const success = (compRes.data?.isValid !== false) && (!consistencyRes || consistencyRes.data?.isConsistent !== false);
    
    return {
      success,
      score,
      feedback: `${compRes.data?.feedback || ''} ${consistencyRes?.data?.feedback || ''}`.trim(),
      issues
    };
  }

  /**
   * Validation: Composition
   */
  async validateComposition(image: { data: string; mimeType: string }, shotType: string, intendedComposition: string) {
    return this.compositionValidator.execute({ image, shotType, intendedComposition });
  }

  /**
   * Validation: Consistency
   */
  async validateConsistency(targetImage: { data: string; mimeType: string }, referenceImages: Array<{ data: string; mimeType: string; name: string }>, characterName: string, characterDescription: string) {
    return this.consistencyScorer.execute({ targetImage, referenceImages, characterName, characterDescription });
  }

  // Helper methods to match the original ImageGenerator interface where needed for transition
  
  async generateSceneImagePrompt(request: SceneImageRequest): Promise<AgentResponse<ImagePrompt>> {
    return this.illustratorAgent.execute({
      shotDescription: request.description,
      type: 'scene',
      sceneContext: {
        name: request.sceneName,
        description: request.description,
        genre: request.genre,
        tone: request.tone,
        mood: request.mood
      },
      artStyle: this.artStyle
    });
  }

  async generateBeatImagePrompt(request: BeatImageRequest): Promise<AgentResponse<ImagePrompt>> {
    return this.illustratorAgent.execute({
      shotDescription: request.beatText,
      type: 'beat',
      sceneContext: {
        name: request.sceneContext.name,
        description: request.beatText,
        genre: request.genre,
        tone: request.tone,
        mood: request.sceneContext.mood
      },
      characters: request.characters?.map(c => ({ name: c.name, description: c.description, role: 'present' })),
      artStyle: this.artStyle
    });
  }

  async generateCoverImagePrompt(request: CoverImageRequest): Promise<AgentResponse<ImagePrompt>> {
    return this.illustratorAgent.execute({
      shotDescription: `${request.title}: ${request.synopsis}`,
      type: 'cover',
      sceneContext: {
        name: request.title,
        description: request.synopsis,
        genre: request.genre,
        tone: request.tone,
        mood: 'iconic'
      },
      artStyle: this.artStyle
    });
  }

  async generateCharacterMasterPrompt(request: CharacterMasterRequest): Promise<AgentResponse<ImagePrompt>> {
    return this.illustratorAgent.execute({
      shotDescription: `Definitive character portrait: ${request.description}`,
      type: 'character_master',
      sceneContext: {
        name: request.name,
        description: request.description,
        genre: request.genre,
        tone: request.tone,
        mood: 'heroic'
      },
      characters: [{ name: request.name, description: request.description, role: request.role }],
      artStyle: this.artStyle
    });
  }

  async generateLocationMasterPrompt(request: LocationMasterRequest): Promise<AgentResponse<ImagePrompt>> {
    return this.illustratorAgent.execute({
      shotDescription: `Definitive environment master shot: ${request.description}`,
      type: 'location_master',
      sceneContext: {
        name: request.name,
        description: request.description,
        genre: request.genre,
        tone: request.tone,
        mood: 'establishing'
      },
      artStyle: this.artStyle
    });
  }

  // ==========================================
  // CHARACTER REFERENCE SHEET METHODS
  // ==========================================

  /**
   * Generate a complete character reference sheet with all views and prompts
   * This is the planning phase - call generateReferenceSheetImages to actually generate images
   */
  async generateCharacterReferenceSheet(request: CharacterReferenceSheetRequest): Promise<AgentResponse<CharacterReferenceSheet>> {
    console.log(`[ImageAgentTeam] Generating reference sheet for: ${request.name}`);
    return this.referenceSheetAgent.execute(request);
  }

  /**
   * Generate a character EXPRESSION sheet (25 essential expressions as face close-ups)
   * This is SEPARATE from the pose reference sheet
   */
  async generateCharacterExpressionSheet(
    request: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<import('./CharacterReferenceSheetAgent').CharacterExpressionSheet>> {
    console.log(`[ImageAgentTeam] Generating expression sheet for: ${request.name} (tier: ${request.expressionTier || 'standard'})`);
    return this.referenceSheetAgent.generateExpressionSheet(request);
  }

  /**
   * Generate both pose sheet and expression sheet for a character
   * Returns both sheets for complete character reference
   */
  async generateCompleteCharacterReference(
    request: CharacterReferenceSheetRequest
  ): Promise<{
    poseSheet?: CharacterReferenceSheet;
    expressionSheet?: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet;
    errors: string[];
  }> {
    console.log(`[ImageAgentTeam] Generating complete reference (pose + expressions) for: ${request.name}`);
    
    const errors: string[] = [];
    let poseSheet: CharacterReferenceSheet | undefined;
    let expressionSheet: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet | undefined;

    // Generate pose sheet
    if (request.includePoseSheet !== false) {
      const poseResult = await this.generateCharacterReferenceSheet(request);
      if (poseResult.success && poseResult.data) {
        poseSheet = poseResult.data;
      } else {
        errors.push(`Pose sheet: ${poseResult.error || 'Unknown error'}`);
      }
    }

    // Generate expression sheet
    if (request.includeExpressions !== false) {
      const exprResult = await this.generateCharacterExpressionSheet(request);
      if (exprResult.success && exprResult.data) {
        expressionSheet = exprResult.data;
      } else {
        errors.push(`Expression sheet: ${exprResult.error || 'Unknown error'}`);
      }
    }

    return { poseSheet, expressionSheet, errors };
  }

  /**
   * Get expression definitions for a tier
   */
  getExpressionDefinitions(tier: 'minimal' | 'core' | 'standard' | 'extended' | 'full') {
    return this.referenceSheetAgent.getExpressionsForTier(tier);
  }

  /**
   * Generate all images for a reference sheet using the image service
   * Stores the results in the internal cache for use in consistency checking
   * 
   * @param sheet The reference sheet with prompts
   * @param imageService The image generation service to use
   * @param onProgress Optional callback for progress updates
   */
  async generateReferenceSheetImages(
    sheet: CharacterReferenceSheet,
    imageService: { generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => Promise<GeneratedImage> },
    onProgress?: (viewType: string, index: number, total: number) => void,
    userReferenceImage?: { data: string; mimeType: string },
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedReferenceSheet> {
    const refCount = userReferenceImages?.length || (userReferenceImage ? 1 : 0);
    console.log(`[ImageAgentTeam] Generating ${sheet.views.length} reference images for: ${sheet.characterName}${refCount > 0 ? ` (with ${refCount} user reference(s))` : ''}`);
    
    const generatedImages = new Map<string, GeneratedImage>();
    const existingViews: Array<{ viewType: string; imageData: string; mimeType: string }> = [];

    for (let i = 0; i < sheet.views.length; i++) {
      const view = sheet.views[i];
      const viewKey = view.viewType === 'expression' && view.expressionName 
        ? `${view.viewType}-${view.expressionName}` 
        : view.viewType;
      
      onProgress?.(viewKey, i + 1, sheet.views.length);
      console.log(`[ImageAgentTeam] Generating view ${i + 1}/${sheet.views.length}: ${viewKey}`);

      // Build reference images: user-provided first, then previously generated views
      const referenceImages: Array<{ data: string; mimeType: string; role: string }> = [];
      
      // User-provided reference images come first — they're the primary visual guide
      if (userReferenceImages && userReferenceImages.length > 0) {
        for (const refImg of userReferenceImages) {
          referenceImages.push({
            data: refImg.data,
            mimeType: refImg.mimeType,
            role: 'user-provided-character-reference'
          });
        }
      } else if (userReferenceImage) {
        referenceImages.push({
          data: userReferenceImage.data,
          mimeType: userReferenceImage.mimeType,
          role: 'user-provided-character-reference'
        });
      }
      
      // Add previously generated views for consistency
      for (const v of existingViews) {
        referenceImages.push({
          data: v.imageData,
          mimeType: v.mimeType,
          role: `reference-${v.viewType}`
        });
      }

      const identifier = `ref_${sheet.characterId}_${viewKey}`;
      const result = await imageService.generateImage(
        view.prompt,
        identifier,
        { type: 'master', characterId: sheet.characterId, viewType: viewKey },
        referenceImages.length > 0 ? referenceImages : undefined
      );

      generatedImages.set(viewKey, result);

      // Add to existing views for subsequent generation (if we have the raw data)
      if (result.imageData && result.mimeType) {
        existingViews.push({
          viewType: viewKey,
          imageData: result.imageData,
          mimeType: result.mimeType
        });
      }

      // Small delay between generations to avoid rate limits
      if (i < sheet.views.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Create the generated reference sheet
    const generatedSheet: GeneratedReferenceSheet = {
      ...sheet,
      generatedImages
    };

    // Cache it for consistency checking
    this.characterReferenceSheets.set(sheet.characterId, generatedSheet);

    console.log(`[ImageAgentTeam] Reference sheet complete for ${sheet.characterName}: ${generatedImages.size} images generated`);
    return generatedSheet;
  }

  /**
   * Generate a SINGLE composite character reference sheet image.
   * Instead of 3 separate images (front, three-quarter, profile), this generates
   * ONE image containing all views side-by-side, giving Gemini a unified spatial
   * reference in a single image. This reduces the number of reference images sent
   * per character from 2-3 to 1, freeing attention budget for the scene prompt.
   * 
   * The composite sheet is stored under the 'composite' key in generatedImages.
   */
  async generateCompositeReferenceSheet(
    sheet: CharacterReferenceSheet,
    imageService: { generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => Promise<GeneratedImage> },
    onProgress?: (status: string, index: number, total: number) => void,
    userReferenceImage?: { data: string; mimeType: string },
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedReferenceSheet> {
    console.log(`[ImageAgentTeam] Generating COMPOSITE reference sheet for: ${sheet.characterName}`);
    onProgress?.('composite', 1, 1);

    // Build the composite prompt from the character's visual description
    const visualAnchors = sheet.visualAnchors?.join(', ') || '';
    const colorPalette = sheet.colorPalette?.join(', ') || '';
    const silhouetteNotes = sheet.silhouetteNotes || '';

    // Extract physical description from the front view prompt (most detailed)
    const frontView = sheet.views.find(v => v.viewType === 'front');
    const characterDescription = frontView?.prompt?.prompt || '';

    const compositePrompt: ImagePrompt = {
      prompt: `Character reference sheet for ${sheet.characterName}. ` +
        `Three views at IDENTICAL scale and framing, each showing full body from head to toe. ` +
        `Left: front view, facing directly at camera, neutral standing pose, full body. ` +
        `Center: three-quarter view, 45-degree angle, slight characteristic pose, full body. ` +
        `Right: side profile view, entire body rotated 90 degrees facing left, body perpendicular to camera, only one shoulder visible, torso hips and legs all facing sideways, full body fully detailed and colored at the same scale as the other two views. ` +
        `${characterDescription} ` +
        `Visual anchors: ${visualAnchors}. ` +
        (colorPalette ? `Color palette: ${colorPalette}. ` : '') +
        `All three views must be rendered in exactly the same art style, at the same scale, with the same level of detail, color saturation, and rendering quality. ` +
        `Every view must show the character fully detailed and colored from head to toe — no silhouettes, no shadows, no placeholders, no close-ups, no bust crops. ` +
        `Plain white or neutral gray background. Even studio lighting. ` +
        `Character model sheet / turnaround reference. NO text labels, NO view names, NO words on the image.`,
      negativePrompt: 'scenery, environment, background scene, action pose, dramatic lighting, props, narrative framing, text, words, letters, labels, view names, annotations, captions, signatures, watermarks, silhouette, shadow figure, black shape, featureless outline, shadowed figure, close-up, bust shot, head shot, cropped body, portrait crop, profile view with front-facing body, head turn only',
      aspectRatio: '16:9',
      composition: 'Three views arranged horizontally, left to right: front, three-quarter, profile. All three at identical scale showing full body.',
    };

    // Build reference images from user-provided images
    const referenceImages: Array<{ data: string; mimeType: string; role: string }> = [];
    if (userReferenceImages && userReferenceImages.length > 0) {
      for (const refImg of userReferenceImages) {
        referenceImages.push({
          data: refImg.data,
          mimeType: refImg.mimeType,
          role: 'user-provided-character-reference'
        });
      }
    } else if (userReferenceImage) {
      referenceImages.push({
        data: userReferenceImage.data,
        mimeType: userReferenceImage.mimeType,
        role: 'user-provided-character-reference'
      });
    }

    const identifier = `ref_${sheet.characterId}_composite`;
    const result = await imageService.generateImage(
      compositePrompt,
      identifier,
      { type: 'master', characterId: sheet.characterId, viewType: 'composite' },
      referenceImages.length > 0 ? referenceImages : undefined
    );

    // Store the composite image under all view keys so getCharacterReferenceImages works
    const generatedImages = new Map<string, GeneratedImage>();
    generatedImages.set('composite', result);
    // Also store under 'front' so priority-based lookups still find something
    generatedImages.set('front', result);

    const generatedSheet: GeneratedReferenceSheet = {
      ...sheet,
      generatedImages
    };

    this.characterReferenceSheets.set(sheet.characterId, generatedSheet);
    console.log(`[ImageAgentTeam] Composite reference sheet complete for ${sheet.characterName}`);
    return generatedSheet;
  }

  /**
   * Generate individual view images for NB2 character consistency.
   * Instead of a single composite grid, generates separate images for front, three-quarter,
   * and profile views. NB2 supports up to 4 character reference images, so passing clean
   * individual views gives the model much better identity signal than a composite grid.
   */
  async generateIndividualViewImages(
    sheet: CharacterReferenceSheet,
    imageService: { generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => Promise<GeneratedImage> },
    onProgress?: (status: string, index: number, total: number) => void,
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedReferenceSheet> {
    const viewTypes = ['front', 'three-quarter', 'profile'] as const;
    const viewsToGenerate = sheet.views.filter(v =>
      viewTypes.includes(v.viewType as typeof viewTypes[number])
    );

    if (viewsToGenerate.length === 0) {
      console.warn(`[ImageAgentTeam] No standard views found in sheet for ${sheet.characterName} — falling back to composite`);
      return this.generateCompositeReferenceSheet(sheet, imageService, onProgress, undefined, userReferenceImages);
    }

    console.log(`[ImageAgentTeam] Generating ${viewsToGenerate.length} individual view images for: ${sheet.characterName}`);

    const referenceImages: Array<{ data: string; mimeType: string; role: string }> = [];
    if (userReferenceImages && userReferenceImages.length > 0) {
      for (const refImg of userReferenceImages) {
        referenceImages.push({ data: refImg.data, mimeType: refImg.mimeType, role: 'user-provided-character-reference' });
      }
    }

    const generatedImages = new Map<string, GeneratedImage>();
    let previousViewImage: { data: string; mimeType: string } | undefined;

    for (let i = 0; i < viewsToGenerate.length; i++) {
      const view = viewsToGenerate[i];
      onProgress?.(view.viewType, i + 1, viewsToGenerate.length);

      const viewPrompt: ImagePrompt = {
        ...view.prompt,
        prompt: `Single character reference image: ${view.prompt.prompt} ` +
          `Plain white background. Even studio lighting. Full body, head to toe. ` +
          `NO text, NO labels, NO annotations. Character model sheet view.`,
        negativePrompt: [
          view.prompt.negativePrompt || '',
          'scenery, environment, background scene, action pose, dramatic lighting, props, text, words, labels, annotations',
          'multiple characters, multiple views, grid, collage, triptych'
        ].filter(Boolean).join(', '),
        aspectRatio: '3:4',
      };

      const viewRefs = [...referenceImages];
      if (previousViewImage) {
        viewRefs.push({ data: previousViewImage.data, mimeType: previousViewImage.mimeType, role: 'previous-view-consistency' });
      }

      const identifier = `ref_${sheet.characterId}_${view.viewType}`;
      const result = await imageService.generateImage(
        viewPrompt,
        identifier,
        { type: 'master', characterId: sheet.characterId, viewType: view.viewType },
        viewRefs.length > 0 ? viewRefs : undefined
      );

      generatedImages.set(view.viewType, result);

      if (result.imageData && result.mimeType) {
        previousViewImage = { data: result.imageData, mimeType: result.mimeType };
      }

      console.log(`[ImageAgentTeam] Individual view '${view.viewType}' complete for ${sheet.characterName}`);
    }

    const generatedSheet: GeneratedReferenceSheet = {
      ...sheet,
      generatedImages
    };

    this.characterReferenceSheets.set(sheet.characterId, generatedSheet);
    console.log(`[ImageAgentTeam] Individual view reference sheet complete for ${sheet.characterName} (${generatedImages.size} views)`);
    return generatedSheet;
  }

  /**
   * Generate all images for an expression sheet using the image service
   * Creates face close-up images for each expression
   * 
   * @param sheet The expression sheet with prompts
   * @param imageService The image generation service to use
   * @param poseSheetImages Optional pose sheet images to use as reference for consistency
   * @param onProgress Optional callback for progress updates
   */
  async generateExpressionSheetImages(
    sheet: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet,
    imageService: { generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => Promise<GeneratedImage> },
    poseSheetImages?: Array<{ data: string; mimeType: string; name: string }>,
    onProgress?: (expressionName: string, index: number, total: number) => void,
    userReferenceImage?: { data: string; mimeType: string },
    userReferenceImages?: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedExpressionSheet> {
    const refCount = userReferenceImages?.length || (userReferenceImage ? 1 : 0);
    console.log(`[ImageAgentTeam] Generating ${sheet.expressions.length} expression images for: ${sheet.characterName}${refCount > 0 ? ` (with ${refCount} user reference(s))` : ''}`);
    
    const generatedImages = new Map<string, GeneratedImage>();
    const expressions: GeneratedExpressionSheet['expressions'] = [];
    
    // Build reference images: user-provided first, then derived face crops,
    // then a limited full-body canonical ref for costume/palette support.
    const referenceImages: Array<{ data: string; mimeType: string; role: string }> = [];
    
    // User-provided reference images come first
    if (userReferenceImages && userReferenceImages.length > 0) {
      for (const refImg of userReferenceImages) {
        referenceImages.push({
          data: refImg.data,
          mimeType: refImg.mimeType,
          role: 'user-provided-character-reference'
        });
      }
    } else if (userReferenceImage) {
      referenceImages.push({
        data: userReferenceImage.data,
        mimeType: userReferenceImage.mimeType,
        role: 'user-provided-character-reference'
      });
    }
    
    if (poseSheetImages && poseSheetImages.length > 0) {
      const preferredOrder = ['front', 'three-quarter', 'profile'];
      const sortedPoseRefs = [...poseSheetImages].sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.name);
        const bIndex = preferredOrder.indexOf(b.name);
        return (aIndex === -1 ? preferredOrder.length : aIndex) - (bIndex === -1 ? preferredOrder.length : bIndex);
      });

      const faceAnchorSources = sortedPoseRefs.slice(0, 2);
      for (const img of faceAnchorSources) {
        const cropped = await extractReferenceFaceCrop(img.data, img.mimeType, {
          mode: img.name === 'front' || img.name === 'three-quarter' || img.name === 'profile'
            ? img.name
            : 'generic',
        });
        referenceImages.push({
          data: cropped.data,
          mimeType: cropped.mimeType,
          role: `character-reference-face-${img.name}`,
        });
      }

      const secondaryCanonical = sortedPoseRefs.find((img) => img.name === 'front') || sortedPoseRefs[0];
      if (secondaryCanonical) {
        referenceImages.push({
          data: secondaryCanonical.data,
          mimeType: secondaryCanonical.mimeType,
          role: `character-reference-${secondaryCanonical.name}`,
        });
      }
    }

    for (let i = 0; i < sheet.expressions.length; i++) {
      const exprView = sheet.expressions[i];
      // Use expressionName field (the actual emotion like 'happy', 'angry'), fallback to viewName or index
      const expressionName = exprView.expressionName || exprView.viewName || `expression-${i}`;
      
      onProgress?.(expressionName, i + 1, sheet.expressions.length);
      console.log(`[ImageAgentTeam] Generating expression ${i + 1}/${sheet.expressions.length}: ${expressionName}`);
      console.log(`[ImageAgentTeam] Expression prompt preview: ${exprView.prompt?.prompt?.substring(0, 100)}...`);

      const identifier = `expr_${sheet.characterId}_${expressionName}`;
      
      try {
        const result = await imageService.generateImage(
          exprView.prompt,
          identifier,
          { 
            type: 'expression', 
            characterId: sheet.characterId, 
            expressionName,
            characterName: sheet.characterName
          },
          referenceImages.length > 0 ? referenceImages : undefined
        );

        generatedImages.set(expressionName, result);
        expressions.push({
          expressionName,
          prompt: exprView.prompt,
          generatedImage: result
        });

        // Do not chain generated expression outputs back into later prompts.
        // If an early expression drifts into a scene, feeding it forward contaminates
        // the rest of the expression sheet. User refs + canonical pose refs are enough.
      } catch (error) {
        console.error(`[ImageAgentTeam] Failed to generate expression ${expressionName}:`, error);
        expressions.push({
          expressionName,
          prompt: exprView.prompt,
          generatedImage: undefined
        });
      }

      // Small delay between generations to avoid rate limits
      if (i < sheet.expressions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Create the generated expression sheet
    const generatedSheet: GeneratedExpressionSheet = {
      characterId: sheet.characterId,
      characterName: sheet.characterName,
      expressionTier: sheet.expressionTier,
      expressions,
      expressionNotes: sheet.expressionNotes,
      personalityInfluence: sheet.personalityInfluence,
      generatedImages
    };

    // Cache it for expression reference
    this.characterExpressionSheets.set(sheet.characterId, generatedSheet);

    console.log(`[ImageAgentTeam] Expression sheet complete for ${sheet.characterName}: ${generatedImages.size} images generated`);
    return generatedSheet;
  }

  /**
   * Get a cached generated expression sheet
   */
  getGeneratedExpressionSheet(characterId: string): GeneratedExpressionSheet | undefined {
    return this.characterExpressionSheets.get(characterId);
  }

  /**
   * Get reference images for a character (for use in consistency checking or reference-based generation)
   * Returns the best available references, limited to avoid --oref dilution.
   * 
   * @param characterId - Character ID
   * @param includeExpressions - Whether to include expression sheet images
   * @param maxImages - Max number of reference images to return (default 3, use 1-2 for scene generation)
   * @param preferredAngle - Optional: prefer a specific angle for scene generation ('front', 'three-quarter', 'profile')
   */
  getCharacterReferenceImages(
    characterId: string, 
    includeExpressions: boolean = false,
    maxImages: number = 3,
    preferredAngle?: string,
    preferIndividualViews: boolean = false
  ): Array<{ data: string; mimeType: string; name: string }> {
    const sheet = this.characterReferenceSheets.get(characterId);
    if (!sheet) {
      console.warn(`[ImageAgentTeam] No reference sheet found for character: ${characterId}`);
      return [];
    }

    const references: Array<{ data: string; mimeType: string; name: string }> = [];
    const appendExpressionRefs = () => {
      if (!includeExpressions || references.length >= maxImages) return;
      const generatedExpressionSheet = this.characterExpressionSheets.get(characterId);
      if (generatedExpressionSheet?.generatedImages?.size) {
        for (const [expressionName, image] of generatedExpressionSheet.generatedImages.entries()) {
          if (references.length >= maxImages) break;
          if (image.imageData && image.mimeType) {
            references.push({
              data: image.imageData,
              mimeType: image.mimeType,
              name: `${generatedExpressionSheet.characterName}-expression-${expressionName}`
            });
          }
        }
      }
    };

    // NB2 path: prefer individual views for cleaner identity signal per image
    if (preferIndividualViews) {
      let priorityViews = ['front', 'three-quarter', 'profile'];
      if (preferredAngle && priorityViews.includes(preferredAngle)) {
        priorityViews = [preferredAngle, ...priorityViews.filter(v => v !== preferredAngle)];
      }
      for (const viewType of priorityViews) {
        if (references.length >= maxImages) break;
        const image = sheet.generatedImages.get(viewType);
        if (image?.imageData && image?.mimeType) {
          references.push({
            data: image.imageData,
            mimeType: image.mimeType,
            name: `${sheet.characterName}-${viewType}`
          });
        }
      }
      // If individual views were found, add expressions and return
      if (references.length > 0) {
        appendExpressionRefs();
        return references;
      }
      // Fall through to composite if no individual views exist
    }

    // Composite path: single image with all views (default for older models)
    const compositeImage = sheet.generatedImages.get('composite');
    if (compositeImage?.imageData && compositeImage?.mimeType) {
      references.push({
        data: compositeImage.imageData,
        mimeType: compositeImage.mimeType,
        name: `${sheet.characterName}-composite`
      });
      if (includeExpressions) {
        appendExpressionRefs();
      }
      return references;
    }

    // Fallback: individual views (legacy path)
    let priorityViews = ['front', 'three-quarter', 'profile'];
    if (preferredAngle && priorityViews.includes(preferredAngle)) {
      priorityViews = [preferredAngle, ...priorityViews.filter(v => v !== preferredAngle)];
    }
    
    for (const viewType of priorityViews) {
      if (references.length >= maxImages) break;
      const image = sheet.generatedImages.get(viewType);
      if (image?.imageData && image?.mimeType) {
        references.push({
          data: image.imageData,
          mimeType: image.mimeType,
          name: `${sheet.characterName}-${viewType}`
        });
      }
    }

    appendExpressionRefs();

    return references;
  }

  /**
   * Get the visual anchors and consistency checklist for a character
   * Useful for prompt enhancement and validation
   */
  getCharacterConsistencyInfo(characterId: string): { visualAnchors: string[]; checklist: string[]; colorPalette: string[] } | null {
    const sheet = this.characterReferenceSheets.get(characterId);
    if (!sheet) return null;

    return {
      visualAnchors: sheet.visualAnchors,
      checklist: sheet.consistencyChecklist,
      colorPalette: sheet.colorPalette
    };
  }

  /**
   * Check if a character has a reference sheet generated
   */
  hasReferenceSheet(characterId: string): boolean {
    return this.characterReferenceSheets.has(characterId);
  }

  /**
   * Get the full reference sheet for a character
   */
  getReferenceSheet(characterId: string): GeneratedReferenceSheet | undefined {
    return this.characterReferenceSheets.get(characterId);
  }

  /**
   * Clear cached reference sheets (useful for regeneration)
   */
  clearReferenceSheets(): void {
    this.characterReferenceSheets.clear();
  }

  /**
   * Validate a generated image against character reference sheets
   * Automatically uses cached reference images
   */
  async validateImageConsistency(
    targetImage: { data: string; mimeType: string },
    characterIds: string[],
    primaryCharacterId?: string
  ): Promise<{ overallScore: number; characterScores: Map<string, ConsistencyScore>; feedback: string[] }> {
    const characterScores = new Map<string, ConsistencyScore>();
    const feedback: string[] = [];
    let totalScore = 0;
    let scoreCount = 0;

    // Validate against each character's reference sheet
    for (const charId of characterIds) {
      const references = this.getCharacterReferenceImages(charId, false);
      if (references.length === 0) {
        feedback.push(`No reference images available for character ${charId}`);
        continue;
      }

      const sheet = this.characterReferenceSheets.get(charId);
      const charName = sheet?.characterName || charId;
      const charDesc = sheet?.visualAnchors.join(', ') || '';

      const result = await this.consistencyScorer.execute({
        targetImage,
        referenceImages: references,
        characterName: charName,
        characterDescription: charDesc
      });

      if (result.success && result.data) {
        characterScores.set(charId, result.data);
        totalScore += result.data.score;
        scoreCount++;

        if (!result.data.isConsistent) {
          feedback.push(`${charName}: ${result.data.feedback}`);
          feedback.push(...result.data.issues.map(i => `  - ${i}`));
        }
      }
    }

    const overallScore = scoreCount > 0 ? totalScore / scoreCount : 0;

    return {
      overallScore,
      characterScores,
      feedback
    };
  }

  // ==========================================
  // POSE DIVERSITY VALIDATION METHODS
  // ==========================================

  /**
   * Validate pose diversity across a sequence of shots
   * Use this after generating a scene's visuals to check for monotony
   */
  async validatePoseDiversity(
    plan: VisualPlan,
    generatedImages?: Map<string, GeneratedImage>,
    strictMode?: boolean
  ): Promise<AgentResponse<DiversityReport>> {
    console.log(`[ImageAgentTeam] Validating pose diversity for ${plan.shots.length} shots`);

    // Build shot metadata from the plan
    const shots: ShotMetadata[] = plan.shots.map((shot, index) => {
      // Use consistent key pattern: beatId || id || fallback
      const shotKey = shot.beatId || shot.id || `shot-${index}`;
      const generatedImage = generatedImages?.get(shotKey);
      
      return {
        shotId: shotKey,
        beatId: shot.beatId,
        shotType: shot.shotType,
        cameraAngle: shot.cameraAngle,
        horizontalAngle: shot.horizontalAngle,
        pose: shot.pose,
        poseDescription: shot.poseDescription,
        // Include image data if available for vision analysis
        imageData: generatedImage?.imageData,
        imageMimeType: generatedImage?.mimeType
      };
    });

    const request: DiversityValidationRequest = {
      shots,
      strictMode: strictMode ?? false,
      includeVisionAnalysis: generatedImages !== undefined && generatedImages.size > 0
    };

    return this.poseDiversityValidator.execute(request);
  }

  /**
   * Generate scene visuals with automatic pose diversity validation and regeneration
   * This is the recommended method for production use
   */
  async generateSceneVisualsWithDiversityCheck(
    request: StoryboardRequest,
    imageService: { generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => Promise<GeneratedImage> },
    maxRegenerationAttempts: number = 2
  ): Promise<AgentResponse<VisualPlan & { prompts: Map<string, ImagePrompt>; diversityReport: DiversityReport; fullQAReport?: Awaited<ReturnType<ImageAgentTeam['runFullVisualQA']>> }>> {
    console.log(`[ImageAgentTeam] Generating scene visuals with diversity validation for: ${request.sceneName}`);

    // Step 1: Generate initial visuals — outer retry loop guards against transient Anthropic 500 outages.
    // Each attempt already retries internally (StoryboardAgent uses 5 retries / 6 attempts = ~61s).
    // This outer loop adds 1 more full scene-level attempt (20s gap) before declaring failure.
    // Kept tight because the whole call is wrapped in PIPELINE_TIMEOUTS.storyboard (10-15min).
    const SCENE_RETRY_ATTEMPTS = 2;
    const SCENE_RETRY_DELAY_MS = 20_000;
    let initialResult: Awaited<ReturnType<typeof this.generateFullSceneVisuals>> | null = null;
    for (let sceneAttempt = 1; sceneAttempt <= SCENE_RETRY_ATTEMPTS; sceneAttempt++) {
      initialResult = await this.generateFullSceneVisuals(request);
      if (initialResult.success && initialResult.data) break;
      if (sceneAttempt < SCENE_RETRY_ATTEMPTS) {
        console.warn(`[ImageAgentTeam] Scene "${request.sceneName}" storyboard failed (attempt ${sceneAttempt}/${SCENE_RETRY_ATTEMPTS}): ${initialResult.error}. Waiting ${SCENE_RETRY_DELAY_MS / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, SCENE_RETRY_DELAY_MS));
      }
    }
    if (!initialResult || !initialResult.success || !initialResult.data) {
      return { success: false, error: initialResult?.error };
    }

    let plan = initialResult.data;
    let prompts = plan.prompts;
    const generatedImages = new Map<string, GeneratedImage>();
    const contractMetrics = this.computeContractFidelityMetrics(request, plan, prompts);
    console.log(
      `[ImageAgentTeam] Contract fidelity (${request.sceneId}): storyboard ${contractMetrics.storyboardAligned}/${contractMetrics.totalContractBeats}, prompts ${contractMetrics.promptAligned}/${contractMetrics.totalContractBeats}, weak prompts ${contractMetrics.weakPrompts}`
    );

    // Step 2: Generate images for each shot.
    // IMPORTANT: Use beat-* identifiers (matching FullStoryPipeline's naming) so the
    // ImageGenerationService's file-existence cache fires on the second call and avoids
    // redundant API calls. Pass sceneId+beatId so the prompt-hash cache also matches.
    for (let i = 0; i < plan.shots.length; i++) {
      const shot = plan.shots[i];
      // Use beatId as key since shot.id is often not set by LLM
      const shotKey = shot.beatId || shot.id || `shot-${i}`;
      const prompt = prompts.get(shotKey);
      if (prompt) {
        const identifier = `beat-${request.sceneId}-${shotKey}`;
        const includeExpressionRefs = !!(
          shot.storyBeat?.isClimaxBeat ||
          shot.storyBeat?.isKeyStoryBeat ||
          shot.storyBeat?.characterEmotions?.some((emotion: any) => emotion.intensity === 'high' || emotion.intensity === 'peak')
        );
        const result = await imageService.generateImage(prompt, identifier, {
          sceneId: request.sceneId,
          beatId: shotKey,
          type: 'scene',
          includeExpressionRefs,
        });
        generatedImages.set(shotKey, result);
        // Annotate shot so FullStoryPipeline can reuse the URL directly
        if (result.imageUrl) shot.generatedImageUrl = result.imageUrl;
        if (result.imageData && result.mimeType) {
          shot.generatedImageData = result.imageData;
          shot.generatedImageMimeType = result.mimeType;
        }
      }
    }

    // Step 3: Validate pose diversity
    let diversityResult = await this.validatePoseDiversity(plan, generatedImages, true);
    if (!diversityResult.success || !diversityResult.data) {
      return { 
        success: true, 
        data: { 
          ...plan, 
          diversityReport: {
            isAcceptable: true,
            overallScore: 100,
            totalShots: plan.shots.length,
            issueCount: 0,
            issues: [],
            shotsToRegenerate: [],
            regenerationGuidance: new Map(),
            summary: 'Diversity validation failed, proceeding with original images'
          }
        }
      };
    }

    let diversityReport = diversityResult.data;

    // Regeneration safeguard: skip when story-strong (poses serve narrative well) or climax with decent score
    const isClimaxScene = request.beats?.some((b: { isClimaxBeat?: boolean }) => b.isClimaxBeat) ?? false;
    const skipRegeneration =
      diversityReport.overallScore >= DIVERSITY_STORY_STRONG_THRESHOLD ||
      (isClimaxScene && diversityReport.overallScore >= 60);
    if (skipRegeneration && !diversityReport.isAcceptable) {
      console.log(`[ImageAgentTeam] Skipping diversity regeneration: score ${diversityReport.overallScore}${isClimaxScene ? ' (climax scene)' : ' (story-strong)'}`);
      diversityReport = { ...diversityReport, isAcceptable: true, shotsToRegenerate: [] };
    }

    // Step 4: Regenerate problematic shots if needed
    const MAX_REGEN_SHOTS_PER_ROUND = 5;
    const REGEN_TIME_BUDGET_MS = 3 * 60 * 1000; // 3 minutes
    const regenStartTime = Date.now();
    let attempt = 0;
    while (!diversityReport.isAcceptable && attempt < maxRegenerationAttempts) {
      if (Date.now() - regenStartTime > REGEN_TIME_BUDGET_MS) {
        console.warn(`[ImageAgentTeam] Regeneration time budget exhausted (${Math.round((Date.now() - regenStartTime) / 1000)}s). Accepting current quality.`);
        diversityReport = { ...diversityReport, isAcceptable: true };
        break;
      }

      attempt++;

      // Only regenerate shots involved in error-severity issues (skip warning-only)
      const errorShotIds = new Set<string>();
      for (const issue of diversityReport.issues) {
        if (issue.severity === 'error') {
          issue.shotIds.forEach(id => errorShotIds.add(id));
        }
      }
      const eligibleShots = diversityReport.shotsToRegenerate.filter(id => errorShotIds.has(id));

      if (eligibleShots.length === 0) {
        console.log(`[ImageAgentTeam] No error-severity shots to regenerate (${diversityReport.shotsToRegenerate.length} warning-only). Accepting current quality.`);
        diversityReport = { ...diversityReport, isAcceptable: true };
        break;
      }

      const roundShots = eligibleShots.slice(0, MAX_REGEN_SHOTS_PER_ROUND);
      console.log(`[ImageAgentTeam] Regeneration attempt ${attempt}/${maxRegenerationAttempts}: ${roundShots.length} of ${diversityReport.shotsToRegenerate.length} shots (errors only, capped at ${MAX_REGEN_SHOTS_PER_ROUND})`);

      // Regenerate each flagged shot with guidance
      for (const shotId of roundShots) {
        const guidance = diversityReport.regenerationGuidance.get(shotId);
        const shot = plan.shots.find(s => s.id === shotId);
        
        if (shot && guidance) {
          console.log(`[ImageAgentTeam] Regenerating shot ${shotId} with guidance: ${guidance.substring(0, 100)}...`);
          
          // Create a modified request for just this shot with the guidance
          const modifiedShot = { ...shot };
          modifiedShot.description = `${shot.description}. REGENERATION GUIDANCE: ${guidance}`;
          
          // Resolve characters for the re-illustration (with foreground/background awareness)
          const correspondingBeat = request.beats.find(b => b.id === shot.beatId);
          const regenCharacters = this.resolveCharactersForShot(
            shot.characters,
            correspondingBeat?.characters,
            request.characterDescriptions,
            correspondingBeat?.foregroundCharacters,
            correspondingBeat?.backgroundCharacters
          );
          
          // Re-illustrate this shot
          const reIllustrationReq = {
            shotDescription: modifiedShot.description,
            type: shot.type,
            shotType: shot.shotType,
            sceneContext: {
              name: request.sceneName,
              description: request.sceneDescription,
              genre: request.genre,
              tone: request.tone,
              mood: shot.mood
            },
            characters: regenCharacters,
            cameraAngle: shot.cameraAngle,
            horizontalAngle: shot.horizontalAngle,
            wallyWoodPanel: shot.wallyWoodPanel,
            artStyle: this.artStyle,
            storyBeat: shot.storyBeat,
            // Request DIFFERENT pose than what was flagged
            poseDescription: guidance,
            focalPoint: shot.focalPoint,
            depthLayers: shot.depthLayers
          };

          const newPromptResult = await this.illustratorAgent.execute(reIllustrationReq);
          if (newPromptResult.success && newPromptResult.data) {
            prompts.set(shotId, newPromptResult.data);
            
            // Generate new image — use beat-* naming so FullStoryPipeline file-cache can find it.
            // The regen suffix prevents overwriting the original; FullStoryPipeline looks for
            // the base beat-* identifier first (via getExistingImageFile) so the original is used
            // unless we explicitly point it to the regen via shot.generatedImageUrl.
            const identifier = `beat-${request.sceneId}-${shotId}-regen${attempt}`;
            const result = await imageService.generateImage(newPromptResult.data, identifier, {
              sceneId: request.sceneId,
              beatId: shotId,
              type: 'scene',
              regeneration: attempt,
              includeExpressionRefs: true,
            });
            generatedImages.set(shotId, result);
            // Update the shot's generatedImageUrl to the winning regen image
            if (result.imageUrl || (result.imageData && result.mimeType)) {
              const shotToUpdate = plan.shots.find(s => (s.beatId || s.id) === shotId);
              if (shotToUpdate) {
                if (result.imageUrl) shotToUpdate.generatedImageUrl = result.imageUrl;
                if (result.imageData && result.mimeType) {
                  shotToUpdate.generatedImageData = result.imageData;
                  shotToUpdate.generatedImageMimeType = result.mimeType;
                }
              }
            }

            // Sync shot metadata to match the regeneration guidance so
            // re-validation doesn't re-flag the same structural issues.
            const shotTypeMatch = guidance.match(/Change shot type to (\w+)/);
            if (shotTypeMatch) shot.shotType = shotTypeMatch[1];
            const angleMatch = guidance.match(/Change camera angle to ([^\n]+)/);
            if (angleMatch) shot.cameraAngle = angleMatch[1].trim();
            const focalMatch = guidance.match(/Move focal point to ([^\n]+)/);
            if (focalMatch) shot.focalPoint = focalMatch[1].trim();
          }
        }
      }

      // Re-validate
      diversityResult = await this.validatePoseDiversity(plan, generatedImages, true);
      if (diversityResult.success && diversityResult.data) {
        diversityReport = diversityResult.data;
      }
    }

    if (!diversityReport.isAcceptable) {
      console.warn(`[ImageAgentTeam] Could not achieve acceptable diversity after ${maxRegenerationAttempts} attempts. Score: ${diversityReport.overallScore}`);
    }

    // Step 5: Run full visual QA (expression, composition, visual storytelling validators)
    // This runs all validators but doesn't trigger regeneration - just reports issues
    let fullQAReport: Awaited<ReturnType<typeof this.runFullVisualQA>> | undefined;
    try {
      const isNarrativePeak = request.beats?.some((b: { isClimaxBeat?: boolean; isKeyStoryBeat?: boolean }) => b.isClimaxBeat || b.isKeyStoryBeat) ?? false;
      fullQAReport = await this.runFullVisualQA(
        plan,
        generatedImages,
        undefined, // sceneType - could be derived from request
        isNarrativePeak,
        undefined, // colorScript
        {
          isClimactic: request.mood === 'intense' || request.mood === 'dramatic',
          branchType: (request as any).branchType || 'neutral',
        }
      );
      
      if (!fullQAReport.isAcceptable) {
        console.warn(`[ImageAgentTeam] Full QA found issues (score: ${fullQAReport.overallScore}): ${fullQAReport.issues.slice(0, 3).join('; ')}`);

        const MAX_QA_REGEN_SHOTS_PER_ROUND = 4;
        let qaAttempt = 0;
        while (
          fullQAReport &&
          !fullQAReport.isAcceptable &&
          fullQAReport.shotsToRegenerate.length > 0 &&
          qaAttempt < maxRegenerationAttempts
        ) {
          qaAttempt++;
          const qaShots = fullQAReport.shotsToRegenerate.slice(0, MAX_QA_REGEN_SHOTS_PER_ROUND);
          console.log(`[ImageAgentTeam] Full QA regeneration attempt ${qaAttempt}/${maxRegenerationAttempts}: ${qaShots.join(', ')}`);

          for (const shotId of qaShots) {
            const shotIndex = plan.shots.findIndex(s => (s.id || s.beatId) === shotId);
            if (shotIndex === -1) continue;
            const shot = plan.shots[shotIndex];
            const image = generatedImages.get(shotId);
            const guidance = await this.buildFullQAGuidanceForShot(fullQAReport, shot, image);
            if (!guidance) continue;

            const correspondingBeat = request.beats.find(b => b.id === shot.beatId);
            const regenCharacters = this.resolveCharactersForShot(
              shot.characters,
              correspondingBeat?.characters,
              request.characterDescriptions,
              correspondingBeat?.foregroundCharacters,
              correspondingBeat?.backgroundCharacters
            );

            const reIllustrationReq = {
              shotDescription: `${shot.description}. FULL QA REGENERATION GUIDANCE: ${guidance}`,
              type: shot.type,
              shotType: shot.shotType,
              sceneContext: {
                name: request.sceneName,
                description: request.sceneDescription,
                genre: request.genre,
                tone: request.tone,
                mood: shot.mood
              },
              characters: regenCharacters,
              cameraAngle: shot.cameraAngle,
              horizontalAngle: shot.horizontalAngle,
              wallyWoodPanel: shot.wallyWoodPanel,
              artStyle: this.artStyle,
              storyBeat: shot.storyBeat,
              authoredVisualContract: shot.authoredVisualContract,
              poseDescription: guidance,
              focalPoint: shot.focalPoint,
              depthLayers: shot.depthLayers,
              continuityFromPrevious: shot.continuityFromPrevious,
              previousShotReference: shot.previousShotReference,
              visualStorytelling: shot.visualStorytelling,
              moodSpec: shot.moodSpec,
              lightingColorPrompt: shot.lightingColorPrompt,
            };

            const newPromptResult = await this.illustratorAgent.execute(reIllustrationReq);
            if (!newPromptResult.success || !newPromptResult.data) continue;

            const shotKey = shot.beatId || shot.id || `shot-${shotIndex}`;
            prompts.set(shotKey, newPromptResult.data);
            const identifier = `beat-${request.sceneId}-${shotKey}-qaregen${qaAttempt}`;
            const result = await imageService.generateImage(
              newPromptResult.data,
              identifier,
              { sceneId: request.sceneId, beatId: shotKey, type: 'scene', regeneration: qaAttempt, includeExpressionRefs: true }
            );

            generatedImages.set(shotKey, result);
            if (result.imageUrl) shot.generatedImageUrl = result.imageUrl;
            if (result.imageData && result.mimeType) {
              shot.generatedImageData = result.imageData;
              shot.generatedImageMimeType = result.mimeType;
            }
          }

          fullQAReport = await this.runFullVisualQA(
            plan,
            generatedImages,
            undefined,
            isNarrativePeak,
            undefined,
            {
              isClimactic: request.mood === 'intense' || request.mood === 'dramatic',
              branchType: (request as any).branchType || 'neutral',
            }
          );
        }
      }
    } catch (qaErr) {
      console.warn('[ImageAgentTeam] Full QA validation failed:', qaErr);
    }

    return {
      success: true,
      data: {
        ...plan,
        prompts,
        diversityReport,
        fullQAReport // Include full QA results for logging/debugging
      }
    };
  }

  /**
   * Quick check for pose diversity issues in a visual plan (before generating images)
   * Use this for fast validation without vision analysis
   */
  async quickDiversityCheck(plan: VisualPlan): Promise<{ isAcceptable: boolean; issues: string[] }> {
    const result = await this.poseDiversityValidator.execute({
      shots: plan.shots.map(s => ({
        shotId: s.id,
        beatId: s.beatId,
        shotType: s.shotType,
        cameraAngle: s.cameraAngle,
        horizontalAngle: s.horizontalAngle,
        pose: s.pose,
        poseDescription: s.poseDescription
      })),
      strictMode: false,
      includeVisionAnalysis: false
    });

    if (!result.success || !result.data) {
      return { isAcceptable: true, issues: [] };
    }

    return {
      isAcceptable: result.data.isAcceptable,
      issues: result.data.issues.map(i => `[${i.severity}] ${i.description}`)
    };
  }

  // ==========================================
  // PANEL TRANSITION VALIDATION METHODS
  // ==========================================

  /**
   * Validate panel transitions in a visual plan
   * Checks continuity rules are properly enforced based on transition types
   */
  async validateTransitions(
    plan: VisualPlan,
    generatedImages?: Map<string, GeneratedImage>,
    strictMode?: boolean
  ): Promise<AgentResponse<TransitionValidationReport>> {
    console.log(`[ImageAgentTeam] Validating transitions for ${plan.shots.length} shots`);

    // Convert GeneratedImage map to the format expected by TransitionValidator
    const imageData = generatedImages ? new Map<string, { data: string; mimeType: string }>() : undefined;
    if (generatedImages && imageData) {
      for (const [id, img] of generatedImages.entries()) {
        if (img.imageData && img.mimeType) {
          imageData.set(id, { data: img.imageData, mimeType: img.mimeType });
        }
      }
    }

    return this.transitionValidator.execute({
      plan,
      generatedImages: imageData,
      includeVisionAnalysis: imageData !== undefined && imageData.size > 0,
      strictMode
    });
  }

  /**
   * Set the last shot from a scene for scene-to-scene transition continuity
   * Call this after completing a scene's visuals
   */
  setLastSceneShot(
    sceneId: string,
    lastShot: VisualPlan['shots'][0],
    environment: string,
    palette: string
  ): void {
    this.lastSceneShot = {
      sceneId,
      shotId: lastShot.id,
      description: lastShot.description,
      environment,
      lighting: lastShot.lightingDescription || '',
      palette,
      characters: lastShot.characters || []
    };
    console.log(`[ImageAgentTeam] Set last scene shot from ${sceneId} for transition continuity`);
  }

  /**
   * Get the last shot from the previous scene for scene-to-scene transitions
   */
  getLastSceneShot(): typeof this.lastSceneShot {
    return this.lastSceneShot;
  }

  /**
   * Clear the last scene shot (e.g., at episode start)
   */
  clearLastSceneShot(): void {
    this.lastSceneShot = undefined;
  }

  /**
   * Generate the first shot of a new scene with scene-to-scene transition continuity
   * from the previous scene's last shot
   */
  async generateSceneOpeningWithTransition(
    request: StoryboardRequest,
    transitionType: 'scene_to_scene' | 'aspect_to_aspect' | 'non_sequitur' = 'scene_to_scene',
    continuityThread?: string
  ): Promise<AgentResponse<VisualPlan & { prompts: Map<string, ImagePrompt> }>> {
    console.log(`[ImageAgentTeam] Generating scene opening with ${transitionType} transition`);

    // Generate the visual plan
    const planResult = await this.storyboardAgent.executeChunked(request);
    if (!planResult.success || !planResult.data) {
      return { success: false, error: planResult.error };
    }

    const plan = planResult.data.plan;
    
    // CRITICAL: Normalize shot IDs - Always prefer beatId for consistency across the pipeline
    // This ensures prompts Map keys match lookup patterns (which use beatId || id)
    plan.shots.forEach((shot, index) => {
      // Always use beatId as the canonical ID when available, regardless of whether shot.id was set
      shot.id = shot.beatId || shot.id || `shot-${index}`;
    });
    
    const prompts = new Map<string, ImagePrompt>();

    // For the first shot, inject scene-to-scene transition continuity if we have previous scene data
    if (plan.shots.length > 0 && this.lastSceneShot) {
      const firstShot = plan.shots[0];
      
      // Add continuity from previous scene
      firstShot.continuityFromPrevious = {
        transitionType,
        whatPreserved: continuityThread 
          ? [continuityThread]
          : this.lastSceneShot.characters.length > 0 
            ? [`character: ${this.lastSceneShot.characters[0]}`]
            : ['thematic connection'],
        whatChanged: `Scene changed from ${this.lastSceneShot.sceneId} to ${request.sceneId}`
      };

      // Resolve characters for the opening shot (with foreground/background awareness)
      const firstBeat = request.beats.length > 0 ? request.beats[0] : undefined;
      const openingCharacters = this.resolveCharactersForShot(
        firstShot.characters,
        firstBeat?.characters,
        request.characterDescriptions,
        firstBeat?.foregroundCharacters,
        firstBeat?.backgroundCharacters
      );

      // Build beat context for first shot
      const firstBeatIndex = firstBeat ? request.beats.indexOf(firstBeat) : -1;
      const firstNextBeatSummary = firstBeatIndex >= 0 && firstBeatIndex < request.beats.length - 1
        ? request.beats[firstBeatIndex + 1]?.text : undefined;

      // Generate prompt for first shot with transition continuity
      const illustrationReq: IllustrationRequest = {
        shotDescription: firstShot.description,
        beatText: firstBeat?.text,
        type: firstShot.type,
        shotType: firstShot.shotType,
        sceneContext: {
          name: request.sceneName,
          description: request.sceneDescription,
          genre: request.genre,
          tone: request.tone,
          mood: firstShot.mood
        },
        characters: openingCharacters,
        cameraAngle: firstShot.cameraAngle,
        horizontalAngle: firstShot.horizontalAngle,
        wallyWoodPanel: firstShot.wallyWoodPanel,
        artStyle: this.artStyle,
        storyBeat: firstShot.storyBeat,
        pose: firstShot.pose,
        poseDescription: firstShot.poseDescription,
        lighting: firstShot.lighting,
        lightingDescription: firstShot.lightingDescription,
        focalPoint: firstShot.focalPoint,
        depthLayers: firstShot.depthLayers,
        continuityFromPrevious: firstShot.continuityFromPrevious,
        previousShotReference: {
          environment: this.lastSceneShot.environment,
          lighting: this.lastSceneShot.lighting,
          palette: this.lastSceneShot.palette
        },
        authoredVisualContract: firstBeat ? {
          visualMoment: (firstBeat as any).visualMoment,
          primaryAction: (firstBeat as any).primaryAction,
          emotionalRead: (firstBeat as any).emotionalRead,
          relationshipDynamic: (firstBeat as any).relationshipDynamic,
          mustShowDetail: (firstBeat as any).mustShowDetail,
        } : undefined,
        visualContractHash: (firstShot as any).contractHash,
        // First beat of a branch scene carries the choice payoff
        choicePayoffContext: request.incomingChoiceContext,
        // Beat context window — first beat has no previous, only next
        nextBeatSummary: firstNextBeatSummary,
      };

      const promptResult = await this.illustratorAgent.execute(illustrationReq);
      if (promptResult.success && promptResult.data) {
        prompts.set(firstShot.id, promptResult.data);
      }
    }

    // Generate prompts for remaining shots with their within-scene transitions
    for (let i = (this.lastSceneShot ? 1 : 0); i < plan.shots.length; i++) {
      const shot = plan.shots[i];
      const prevShot = i > 0 ? plan.shots[i - 1] : undefined;
      const correspondingBeat = request.beats.find(b => b.id === shot.beatId);

      // CRITICAL: Resolve characters for this shot (was previously missing!)
      const shotCharacters = this.resolveCharactersForShot(
        shot.characters,
        correspondingBeat?.characters,
        request.characterDescriptions,
        correspondingBeat?.foregroundCharacters,
        correspondingBeat?.backgroundCharacters
      );

      // Build beat context window for dramatic moment framing
      const beatIndex = correspondingBeat ? request.beats.indexOf(correspondingBeat) : -1;
      const previousBeatSummary = beatIndex > 0 ? request.beats[beatIndex - 1]?.text : undefined;
      const nextBeatSummary = beatIndex >= 0 && beatIndex < request.beats.length - 1 ? request.beats[beatIndex + 1]?.text : undefined;

      const illustrationReq: IllustrationRequest = {
        shotDescription: shot.description,
        beatText: correspondingBeat?.text,
        type: shot.type,
        shotType: shot.shotType,
        sceneContext: {
          name: request.sceneName,
          description: request.sceneDescription,
          genre: request.genre,
          tone: request.tone,
          mood: shot.mood
        },
        characters: shotCharacters,
        compositionNotes: shot.composition,
        cameraAngle: shot.cameraAngle,
        horizontalAngle: shot.horizontalAngle,
        wallyWoodPanel: shot.wallyWoodPanel,
        artStyle: this.artStyle,
        storyBeat: shot.storyBeat,
        pose: shot.pose,
        poseDescription: shot.poseDescription,
        lighting: shot.lighting,
        lightingDescription: shot.lightingDescription,
        focalPoint: shot.focalPoint,
        depthLayers: shot.depthLayers,
        continuityFromPrevious: shot.continuityFromPrevious,
        previousShotReference: prevShot ? {
          cameraAngle: prevShot.cameraAngle,
          shotType: prevShot.shotType,
          lighting: prevShot.lightingDescription
        } : undefined,
        // Pass visual storytelling specs from StoryboardAgent
        moodSpec: shot.moodSpec as IllustrationRequest['moodSpec'],
        lightingColorPrompt: shot.lightingColorPrompt,
        visualStorytelling: shot.visualStorytelling as IllustrationRequest['visualStorytelling'],
        authoredVisualContract: correspondingBeat ? {
          visualMoment: (correspondingBeat as any).visualMoment,
          primaryAction: (correspondingBeat as any).primaryAction,
          emotionalRead: (correspondingBeat as any).emotionalRead,
          relationshipDynamic: (correspondingBeat as any).relationshipDynamic,
          mustShowDetail: (correspondingBeat as any).mustShowDetail,
        } : undefined,
            visualContractHash: (shot as any).contractHash,
        // Choice payoff: branch scene first beat OR per-choice payoff beat.
        // For per-choice payoffs, include the choice label in the context so the illustrator
        // knows what action was chosen; the visualMoment (= outcomeTexts.partial) provides
        // the narrative prose that describes the physical action in full sentences.
        choicePayoffContext: (beatIndex === 0 && request.incomingChoiceContext)
          ? request.incomingChoiceContext
          : (correspondingBeat as any)?.isChoicePayoff
            ? [
                (correspondingBeat as any).choiceContext
                  ? `Player chose: "${(correspondingBeat as any).choiceContext}".`
                  : null,
                (correspondingBeat as any).visualMoment || correspondingBeat?.text,
              ].filter(Boolean).join(' ')
            : undefined,
        // Beat context window for dramatic moment framing
        previousBeatSummary,
        nextBeatSummary,
      };

      const promptResult = await this.illustratorAgent.execute(illustrationReq);
      if (promptResult.success && promptResult.data) {
        prompts.set(shot.id, promptResult.data);
      }
    }

    return {
      success: true,
      data: {
        ...plan,
        prompts
      }
    };
  }

  private computeContractFidelityMetrics(
    request: StoryboardRequest,
    plan: VisualPlan,
    prompts: Map<string, ImagePrompt>
  ): {
    totalContractBeats: number;
    storyboardAligned: number;
    promptAligned: number;
    weakPrompts: number;
  } {
    const beatById = new Map(request.beats.map(b => [b.id, b]));
    let totalContractBeats = 0;
    let storyboardAligned = 0;
    let promptAligned = 0;
    let weakPrompts = 0;

    for (const shot of plan.shots || []) {
      const beat = beatById.get(shot.beatId);
      if (!beat) continue;

      const hasContract = Boolean(
        (beat as any).visualMoment ||
        (beat as any).primaryAction ||
        (beat as any).emotionalRead ||
        (beat as any).relationshipDynamic ||
        (beat as any).mustShowDetail
      );
      if (!hasContract) continue;
      totalContractBeats++;

      const storyboardText = `${shot.storyBeat?.action || ''} ${shot.storyBeat?.emotion || ''} ${shot.storyBeat?.relationship || ''} ${shot.description || ''}`.toLowerCase();
      const primaryAction = String((beat as any).primaryAction || '').toLowerCase();
      const visualMoment = String((beat as any).visualMoment || '').toLowerCase();
      if ((primaryAction && storyboardText.includes(primaryAction.split(' ').slice(-1)[0])) || (visualMoment && storyboardText.includes(visualMoment.slice(0, 18)))) {
        storyboardAligned++;
      }

      const shotId = shot.beatId || shot.id;
      const prompt = prompts.get(shotId);
      if (prompt) {
        const promptText = `${prompt.prompt || ''} ${prompt.visualNarrative || ''} ${prompt.emotionalCore || ''}`.toLowerCase();
        if ((primaryAction && promptText.includes(primaryAction.split(' ').slice(-1)[0])) || (visualMoment && promptText.includes(visualMoment.slice(0, 18)))) {
          promptAligned++;
        }
        const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?)\b/.test(promptText);
        if (!hasActionVerb || !(prompt.visualNarrative || '').trim()) {
          weakPrompts++;
        }
      } else {
        weakPrompts++;
      }
    }

    return { totalContractBeats, storyboardAligned, promptAligned, weakPrompts };
  }

  // ==========================================
  // EXPRESSION VALIDATION METHODS
  // ==========================================

  /**
   * Validate character expressions in a generated image
   * Checks that each character displays the correct emotion with proper landmarks
   */
  async validateExpressions(
    imageId: string,
    imageData: string,
    mimeType: string,
    characterEmotions: import('./StoryboardAgent').CharacterEmotion[],
    overallMood?: string,
    expectSameExpression?: boolean
  ): Promise<AgentResponse<ExpressionValidationReport>> {
    console.log(`[ImageAgentTeam] Validating expressions for ${characterEmotions.length} characters`);

    return this.expressionValidator.execute({
      imageId,
      imageData,
      mimeType,
      characterEmotions,
      overallMood,
      expectSameExpression,
      strictMode: false
    });
  }

  /**
   * Quick structural check for character emotions (before generation)
   * Ensures per-character emotions are properly specified
   */
  validateEmotionStructure(
    characterEmotions: import('./StoryboardAgent').CharacterEmotion[]
  ): { isValid: boolean; issues: string[] } {
    return this.expressionValidator.validateStructure(characterEmotions);
  }

  /**
   * Validate expression pacing across a visual plan
   * Checks for overuse of extreme expressions and jarring transitions
   */
  validateExpressionPacing(
    plan: VisualPlan,
    sceneType?: 'action' | 'dialogue' | 'emotional' | 'climax',
    isNarrativePeak?: boolean
  ): import('./ExpressionValidator').ExpressionPacingReport {
    // Build shots array from plan
    const shots = plan.shots
      .filter(s => s.storyBeat?.characterEmotions && s.storyBeat.characterEmotions.length > 0)
      .map(s => ({
        shotId: s.id,
        characterEmotions: s.storyBeat!.characterEmotions!
      }));

    if (shots.length === 0) {
      return {
        isAcceptable: true,
        overallScore: 100,
        extremeUsage: { totalExtremeCount: 0, maxAllowed: 2, isOverused: false, usage: [], issues: [] },
        transitions: { jarringTransitions: [], smoothTransitions: 0, totalTransitions: 0, issues: [] },
        characterArcs: new Map(),
        issues: [],
        recommendations: []
      };
    }

    return this.expressionValidator.validateExpressionPacing({
      shots,
      sceneType,
      isNarrativePeak
    });
  }

  /**
   * Check a single emotional transition for a character
   */
  checkEmotionalTransition(
    characterName: string,
    fromEmotion: string,
    toEmotion: string
  ): { isSmooth: boolean; distance: number; suggestion?: string } {
    return this.expressionValidator.checkTransition(characterName, fromEmotion, toEmotion);
  }

  /**
   * Validate expressions across a visual plan
   * Checks each shot's character emotions for proper specification
   */
  validatePlanExpressions(plan: VisualPlan): {
    isValid: boolean;
    shotIssues: Map<string, string[]>;
    summary: string;
  } {
    const shotIssues = new Map<string, string[]>();
    let totalIssues = 0;

    for (const shot of plan.shots) {
      const characterEmotions = shot.storyBeat?.characterEmotions;
      
      if (!characterEmotions || characterEmotions.length === 0) {
        // If there are characters but no emotions specified
        if (shot.characters && shot.characters.length > 0) {
          shotIssues.set(shot.id, [
            `Shot has ${shot.characters.length} characters but no per-character emotions specified`
          ]);
          totalIssues++;
        }
        continue;
      }

      const validation = this.expressionValidator.validateStructure(characterEmotions);
      if (!validation.isValid || validation.issues.length > 0) {
        shotIssues.set(shot.id, validation.issues);
        totalIssues += validation.issues.length;
      }

      // Check for inappropriate uniformity
      if (characterEmotions.length > 1) {
        const emotions = characterEmotions.map(ce => ce.emotion.toLowerCase());
        const uniqueEmotions = new Set(emotions);
        if (uniqueEmotions.size === 1) {
          const issues = shotIssues.get(shot.id) || [];
          issues.push(`All characters have same emotion "${emotions[0]}" - verify this is intentional`);
          shotIssues.set(shot.id, issues);
        }
      }
    }

    return {
      isValid: totalIssues === 0,
      shotIssues,
      summary: totalIssues === 0
        ? 'All character emotions properly specified'
        : `${totalIssues} expression issues found across ${shotIssues.size} shots`
    };
  }

  // ==========================================
  // COLOR SCRIPT & LIGHTING/COLOR METHODS
  // ==========================================

  /**
   * Generate a color script for a story/episode
   * This provides the upfront visual arc reference
   */
  async generateColorScript(request: ColorScriptRequest): Promise<AgentResponse<ColorScript>> {
    console.log(`[ImageAgentTeam] Generating color script for: ${request.storyTitle}`);
    const result = await this.colorScriptAgent.execute(request);
    
    // Cache the color script
    if (result.success && result.data) {
      const key = request.episodeId ? `${request.storyId}-${request.episodeId}` : request.storyId;
      this.colorScripts.set(key, result.data);
    }
    
    return result;
  }

  /**
   * Get cached color script
   */
  getColorScript(storyId: string, episodeId?: string): ColorScript | undefined {
    const key = episodeId ? `${storyId}-${episodeId}` : storyId;
    return this.colorScripts.get(key);
  }

  /**
   * Generate thumbnail prompts for a color script visualization
   */
  async generateColorScriptThumbnails(colorScript: ColorScript): Promise<AgentResponse<{
    thumbnailPrompts: Array<{ beatId: string; prompt: string }>;
    stripPrompt: string;
  }>> {
    return this.colorScriptAgent.generateColorScriptThumbnails(colorScript);
  }

  /**
   * Get mood spec for a beat from color script
   */
  getMoodSpecFromColorScript(
    storyId: string,
    episodeId: string | undefined,
    beatId: string
  ): { mood: MoodSpec | null; beatData: ColorScriptBeat | null } {
    const colorScript = this.getColorScript(storyId, episodeId);
    if (!colorScript) {
      return { mood: null, beatData: null };
    }
    
    const result = this.colorScriptAgent.getMoodSpecForBeat(colorScript, beatId);
    return { mood: result.mood, beatData: result.beatData };
  }

  /**
   * Generate mood spec from story beat parameters
   */
  generateMoodSpecForBeat(
    emotion: import('./LightingColorSystem').EmotionCore,
    intensity: import('./LightingColorSystem').EmotionIntensity,
    valence: import('./LightingColorSystem').EmotionValence,
    previousMood?: MoodSpec
  ): MoodSpec {
    return generateMoodSpec(emotion, intensity, valence, previousMood);
  }

  /**
   * Generate lighting/color prompt fragment from mood spec
   */
  generateLightingColorPromptFragment(mood: MoodSpec): string {
    return generateLightingColorPrompt(mood);
  }

  /**
   * Validate lighting and color in a generated image
   */
  async validateLightingColor(
    imageId: string,
    imageData: string,
    mimeType: string,
    moodSpec: MoodSpec,
    colorScript?: ColorScript,
    beatId?: string,
    beatContext?: {
      isClimactic?: boolean;
      isResolution?: boolean;
      isFlashback?: boolean;
      isNightmare?: boolean;
      isSafeHubScene?: boolean;
      branchType?: 'dark' | 'hopeful' | 'neutral';
    }
  ): Promise<AgentResponse<LightingColorValidationReport>> {
    console.log(`[ImageAgentTeam] Validating lighting/color for image ${imageId}`);

    return this.lightingColorValidator.execute({
      imageId,
      imageData,
      mimeType,
      moodSpec,
      colorScript,
      beatId,
      beatContext
    });
  }

  /**
   * Structural validation of mood spec before generation
   */
  validateMoodSpecStructure(moodSpec: MoodSpec): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    return this.lightingColorValidator.validateMoodSpecStructure(moodSpec);
  }

  /**
   * Check mood spec consistency with color script
   */
  checkMoodVsColorScript(
    moodSpec: MoodSpec,
    colorScript: ColorScript,
    beatId: string
  ): { isConsistent: boolean; discrepancies: string[] } {
    const beat = colorScript.beats.find(b => b.beatId === beatId);
    if (!beat) {
      return { isConsistent: false, discrepancies: ['Beat not found in color script'] };
    }
    return this.lightingColorValidator.checkMoodVsColorScript(moodSpec, beat);
  }

  /**
   * Adjust color script for a specific branch path
   */
  adjustColorScriptForBranch(colorScript: ColorScript, branchId: string): ColorScript {
    return this.colorScriptAgent.adjustForBranch(colorScript, branchId);
  }

  // ==========================================
  // UNIFIED VISUAL STORYTELLING METHODS
  // ==========================================

  /**
   * Register a motif library for a story
   */
  registerMotifLibrary(storyId: string, library: MotifLibrary): void {
    this.motifLibraries.set(storyId, library);
  }

  /**
   * Get motif library for a story
   */
  getMotifLibrary(storyId: string): MotifLibrary | undefined {
    return this.motifLibraries.get(storyId);
  }

  /**
   * Suggest rhythm role based on beat context
   */
  suggestRhythmRole(context: {
    isPreChoice?: boolean;
    isPostChoice?: boolean;
    isClimactic?: boolean;
    isResolution?: boolean;
    isActionSequence?: boolean;
    emotionalIntensity: 'low' | 'medium' | 'high' | 'peak';
  }): RhythmRole {
    return suggestRhythmRole(context);
  }

  /**
   * Suggest transition type based on context
   */
  suggestTransitionType(context: {
    nextBeatIsChoice?: boolean;
    isEndOfScene?: boolean;
    isActionSequence?: boolean;
    isMoodShift?: boolean;
    isReaction?: boolean;
    currentRhythm: RhythmRole;
  }): TransitionType {
    return suggestTransitionType(context);
  }

  /**
   * Build complete pacing spec
   */
  buildPacingSpec(
    rhythmRole: RhythmRole,
    transitionToNext?: TransitionType,
    isPreChoice?: boolean,
    isPostChoice?: boolean
  ): PacingSpec {
    return buildPacingSpec(rhythmRole, transitionToNext, isPreChoice, isPostChoice);
  }

  /**
   * Check if a beat advances the story (redundancy check)
   */
  checkBeatAdvancement(
    currentBeat: { action: string; emotion: string },
    previousBeat?: { action: string; emotion: string },
    transitionType?: TransitionType
  ): { advances: boolean; advancementType: string; reason: string } {
    return validateAdvancement(currentBeat, previousBeat, transitionType);
  }

  /**
   * Suggest environment personality based on context
   */
  suggestEnvironmentPersonality(context: {
    branchType?: 'dark' | 'hopeful' | 'neutral';
    sceneType?: 'safe_hub' | 'conflict' | 'exploration' | 'climax' | 'resolution';
    isThreshold?: boolean;
  }): import('./VisualStorytellingSystem').EnvironmentPersonality {
    return suggestEnvironmentPersonality(context);
  }

  /**
   * Get default continuity rules for a transition type
   */
  getTransitionContinuity(transitionType: TransitionType): import('./VisualStorytellingSystem').ContinuityRules {
    return getDefaultContinuity(transitionType);
  }

  /**
   * Validate visual storytelling in a generated image
   */
  async validateVisualStorytelling(
    imageId: string,
    imageData: string,
    mimeType: string,
    spec?: Partial<VisualStorytellingSpec>,
    previousImageData?: string,
    previousMimeType?: string,
    previousSpec?: Partial<VisualStorytellingSpec>,
    currentBeat?: { action: string; emotion: string },
    previousBeat?: { action: string; emotion: string }
  ): Promise<AgentResponse<VisualStorytellingValidationReport>> {
    console.log(`[ImageAgentTeam] Validating visual storytelling for image ${imageId}`);

    return this.visualStorytellingValidator.execute({
      imageId,
      imageData,
      mimeType,
      spec,
      previousImageData,
      previousMimeType,
      previousSpec,
      currentBeat,
      previousBeat
    });
  }

  /**
   * Validate a sequence of images
   */
  async validateImageSequence(
    images: Array<{
      imageId: string;
      imageData: string;
      mimeType: string;
      spec: Partial<VisualStorytellingSpec>;
      beat: { action: string; emotion: string };
    }>
  ): Promise<AgentResponse<SequenceValidationReport>> {
    console.log(`[ImageAgentTeam] Validating sequence of ${images.length} images`);
    return this.visualStorytellingValidator.validateSequence({ images });
  }

  /**
   * Structural validation of storytelling spec before generation
   */
  validateStorytellingSpec(spec: Partial<VisualStorytellingSpec>): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    return this.visualStorytellingValidator.validateSpecStructure(spec);
  }

  /**
   * Validate transition choice for context
   */
  validateTransitionChoice(
    transitionType: TransitionType,
    context: {
      isPreChoice?: boolean;
      isEndOfScene?: boolean;
      isActionSequence?: boolean;
    }
  ): { isAppropriate: boolean; suggestions: string[] } {
    return this.visualStorytellingValidator.validateTransitionChoice(transitionType, context);
  }

  // ==========================================
  // CAMERA METHODS
  // ==========================================

  /**
   * Suggest shot type based on beat context
   */
  suggestShotType(context: {
    isNewLocation?: boolean;
    isActionBeat?: boolean;
    isDialogue?: boolean;
    isEmotionalPeak?: boolean;
    isSymbolicMoment?: boolean;
    hasMultipleCharacters?: boolean;
    previousShotType?: import('./VisualStorytellingSystem').ShotType;
  }): import('./VisualStorytellingSystem').ShotType {
    return suggestShotType(context);
  }

  /**
   * Suggest camera height based on power dynamics
   */
  suggestCameraHeight(context: {
    subjectPowerLevel: 'weak' | 'neutral' | 'powerful';
    isThreateningMoment?: boolean;
    isVulnerableMoment?: boolean;
    isHeroicMoment?: boolean;
  }): import('./VisualStorytellingSystem').CameraHeight {
    return suggestCameraHeight(context);
  }

  /**
   * Check if line cross is appropriate
   */
  shouldCrossLine(context: {
    isPowerInversion?: boolean;
    isMajorRevelation?: boolean;
    isCrossingBoundary?: boolean;
    isPreviousLineCross?: boolean;
  }): { shouldCross: boolean; reason?: string } {
    return shouldCrossLine(context);
  }

  /**
   * Build default camera spec
   */
  buildDefaultCameraSpec(
    shotType?: import('./VisualStorytellingSystem').ShotType,
    height?: import('./VisualStorytellingSystem').CameraHeight,
    previousSide?: import('./VisualStorytellingSystem').CameraSide
  ): import('./VisualStorytellingSystem').CameraSpec {
    return buildDefaultCameraSpec(shotType, height, previousSide);
  }

  /**
   * Validate camera spec structure
   */
  validateCameraSpec(
    camera: import('./VisualStorytellingSystem').CameraSpec,
    context?: {
      isNewLocation?: boolean;
      isDialogue?: boolean;
      isActionBeat?: boolean;
      isEmotionalPeak?: boolean;
      subjectPowerLevel?: 'weak' | 'neutral' | 'powerful';
    }
  ): { isValid: boolean; issues: string[]; suggestions: string[] } {
    return this.visualStorytellingValidator.validateCameraSpec(camera, context);
  }

  /**
   * Validate shot type for beat type
   */
  validateShotTypeForBeat(
    shotType: import('./VisualStorytellingSystem').ShotType,
    beatType: 'action' | 'dialogue' | 'emotional' | 'establish' | 'symbolic'
  ): { isAppropriate: boolean; suggestion?: string } {
    return this.visualStorytellingValidator.validateShotTypeForBeat(shotType, beatType);
  }

  /**
   * Analyze shot variety across a sequence
   */
  analyzeShotVariety(
    shotTypes: import('./VisualStorytellingSystem').ShotType[]
  ): import('./VisualStorytellingValidator').ShotVarietyCheck {
    return this.visualStorytellingValidator.analyzeShotVariety(shotTypes);
  }

  /**
   * Analyze 180° rule continuity across sequence
   */
  analyzeAxisContinuity(
    shots: Array<{
      beatId: string;
      side: import('./VisualStorytellingSystem').CameraSide;
      lineCross: boolean;
      lineCrossReason?: string;
      isSceneChange?: boolean;
    }>
  ): {
    lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }>;
    unjustifiedCrosses: number;
    issues: string[];
  } {
    return this.visualStorytellingValidator.analyzeAxisContinuity(shots);
  }

  // ==========================================
  // TEXTURE METHODS
  // ==========================================

  /**
   * Suggest texture spec based on context
   */
  suggestTextureSpec(context: {
    mood?: string;
    branchType?: 'dark' | 'hopeful' | 'neutral';
    sceneTone?: 'chaotic' | 'tense' | 'calm' | 'safe';
    focalPriority?: 'acting' | 'environment' | 'prop';
    emotionalIntensity?: 'low' | 'medium' | 'high' | 'peak';
    isSafeHub?: boolean;
    isActionSequence?: boolean;
  }): import('./VisualStorytellingSystem').TextureSpec {
    return suggestTextureSpec(context);
  }

  /**
   * Build default texture spec
   */
  buildDefaultTextureSpec(): import('./VisualStorytellingSystem').TextureSpec {
    return buildDefaultTextureSpec();
  }

  /**
   * Generate texture prompt fragment for image generation
   */
  generateTexturePrompt(spec: import('./VisualStorytellingSystem').TextureSpec): string {
    return generateTexturePrompt(spec);
  }

  /**
   * Validate texture spec structure
   */
  validateTextureSpecStructure(
    texture: import('./VisualStorytellingSystem').TextureSpec,
    context?: {
      mood?: string;
      branchType?: 'dark' | 'hopeful' | 'neutral';
      focalPriority?: 'acting' | 'environment' | 'prop';
    }
  ): { isValid: boolean; issues: string[]; suggestions: string[] } {
    return this.visualStorytellingValidator.validateTextureSpec(texture, context);
  }

  /**
   * Validate texture for scene type
   */
  validateTextureForScene(
    texture: import('./VisualStorytellingSystem').TextureSpec,
    sceneType: 'action' | 'dialogue' | 'emotional' | 'establish' | 'safe_hub'
  ): { isAppropriate: boolean; suggestions: string[] } {
    return this.visualStorytellingValidator.validateTextureForScene(texture, sceneType);
  }

  /**
   * Check texture hierarchy (background should have more than foreground)
   */
  validateTextureHierarchy(
    texture: import('./VisualStorytellingSystem').TextureSpec
  ): { isCorrect: boolean; issue?: string } {
    return this.visualStorytellingValidator.validateTextureHierarchy(texture);
  }

  /**
   * Check texture mood alignment
   */
  validateTextureMoodAlignment(
    texture: import('./VisualStorytellingSystem').TextureSpec,
    expectedMood: 'gritty' | 'clean' | 'chaotic' | 'calm' | 'nostalgic' | 'safe'
  ): { isAligned: boolean; issue?: string } {
    return this.visualStorytellingValidator.validateTextureMoodAlignment(texture, expectedMood);
  }

  // ==========================================
  // SPATIAL METHODS
  // ==========================================

  /**
   * Suggest perspective type based on context
   */
  suggestPerspectiveType(context: {
    environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale' | 'abstract';
    isConfrontation?: boolean;
    isEpicReveal?: boolean;
    isDream?: boolean;
    isVertigo?: boolean;
  }): import('./VisualStorytellingSystem').PerspectiveType {
    return suggestPerspectiveType(context);
  }

  /**
   * Suggest staging pattern based on context
   */
  suggestStagingPattern(context: {
    characterCount: number;
    relationshipDynamic?: 'tense' | 'friendly' | 'neutral' | 'intimate' | 'chaotic';
    isConfrontation?: boolean;
    isGroupDiscussion?: boolean;
    isSoloMoment?: boolean;
  }): import('./VisualStorytellingSystem').StagingPattern {
    return suggestStagingPattern(context);
  }

  /**
   * Suggest character distance based on relationship
   */
  suggestCharacterDistance(context: {
    relationshipType?: 'allies' | 'enemies' | 'strangers' | 'lovers' | 'family';
    emotionalState?: 'warm' | 'cold' | 'neutral' | 'tense';
    isConflict?: boolean;
  }): import('./VisualStorytellingSystem').CharacterDistance {
    return suggestCharacterDistance(context);
  }

  /**
   * Suggest complete spatial spec based on context
   */
  suggestSpatialSpec(context: {
    environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale' | 'abstract';
    characterCount?: number;
    relationshipDynamic?: 'tense' | 'friendly' | 'neutral' | 'intimate' | 'chaotic';
    branchType?: 'power' | 'helpless' | 'paranoia' | 'intimate' | 'neutral';
    isConfrontation?: boolean;
    isEpicReveal?: boolean;
    isDream?: boolean;
    isPreChoice?: boolean;
    showExits?: boolean;
  }): import('./VisualStorytellingSystem').SpatialSpec {
    return suggestSpatialSpec(context);
  }

  /**
   * Build default spatial spec
   */
  buildDefaultSpatialSpec(): import('./VisualStorytellingSystem').SpatialSpec {
    return buildDefaultSpatialSpec();
  }

  /**
   * Generate spatial prompt fragment for image generation
   */
  generateSpatialPrompt(spec: import('./VisualStorytellingSystem').SpatialSpec): string {
    return generateSpatialPrompt(spec);
  }

  /**
   * Validate spatial spec structure
   */
  validateSpatialSpecStructure(
    spatial: import('./VisualStorytellingSystem').SpatialSpec,
    context?: {
      environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale';
      characterCount?: number;
      isConfrontation?: boolean;
    }
  ): { isValid: boolean; issues: string[]; suggestions: string[] } {
    return this.visualStorytellingValidator.validateSpatialSpec(spatial, context);
  }

  /**
   * Validate perspective for scene type
   */
  validatePerspectiveForScene(
    perspectiveType: import('./VisualStorytellingSystem').PerspectiveType,
    sceneType: 'corridor' | 'room' | 'exterior' | 'epic' | 'abstract' | 'confrontation'
  ): { isAppropriate: boolean; suggestion?: string } {
    return this.visualStorytellingValidator.validatePerspectiveForScene(perspectiveType, sceneType);
  }

  /**
   * Validate staging pattern for character count and dynamics
   */
  validateStagingPattern(
    staging: import('./VisualStorytellingSystem').StagingPattern,
    characterCount: number,
    dynamic: 'confrontation' | 'discussion' | 'intimate' | 'chaos' | 'solo'
  ): { isAppropriate: boolean; suggestion?: string } {
    return this.visualStorytellingValidator.validateStagingPattern(staging, characterCount, dynamic);
  }

  /**
   * Validate character distance matches relationship
   */
  validateCharacterDistanceForRelationship(
    distance: import('./VisualStorytellingSystem').CharacterDistance,
    relationship: 'allies' | 'enemies' | 'strangers' | 'lovers' | 'neutral'
  ): { isAppropriate: boolean; suggestion?: string } {
    return this.visualStorytellingValidator.validateCharacterDistance(distance, relationship);
  }

  /**
   * Check for flat staging (characters all on same plane)
   */
  checkFlatStaging(
    spatial: import('./VisualStorytellingSystem').SpatialSpec
  ): { isFlatStaging: boolean; suggestion?: string } {
    return this.visualStorytellingValidator.checkFlatStaging(spatial);
  }

  /**
   * Check spatial consistency between beats
   */
  validateSpatialConsistency(
    current: import('./VisualStorytellingSystem').SpatialSpec,
    previous: import('./VisualStorytellingSystem').SpatialSpec,
    isSameScene: boolean
  ): { isConsistent: boolean; issues: string[] } {
    return this.visualStorytellingValidator.validateSpatialConsistency(current, previous, isSameScene);
  }

  // ==========================================
  // BODY LANGUAGE VALIDATION METHODS
  // ==========================================

  /**
   * Generate a character's body vocabulary - their unique way of moving
   */
  async generateCharacterBodyVocabulary(
    request: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary>> {
    console.log(`[ImageAgentTeam] Generating body vocabulary for: ${request.name}`);
    const result = await this.referenceSheetAgent.generateBodyVocabulary(request);
    
    // Cache the vocabulary
    if (result.success && result.data) {
      this.characterBodyVocabularies.set(request.characterId, result.data);
    }
    
    return result;
  }

  /**
   * Get cached body vocabulary for a character
   */
  getCharacterBodyVocabulary(characterId: string): import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary | undefined {
    return this.characterBodyVocabularies.get(characterId);
  }

  /**
   * Generate complete character reference: pose sheet + expression sheet + body vocabulary
   */
  async generateFullCharacterReference(
    request: CharacterReferenceSheetRequest
  ): Promise<{
    poseSheet?: CharacterReferenceSheet;
    expressionSheet?: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet;
    bodyVocabulary?: import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary;
    errors: string[];
  }> {
    console.log(`[ImageAgentTeam] Generating full reference (pose + expressions + body vocabulary) for: ${request.name}`);
    
    const errors: string[] = [];
    let poseSheet: CharacterReferenceSheet | undefined;
    let expressionSheet: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet | undefined;
    let bodyVocabulary: import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary | undefined;

    // Generate pose sheet
    if (request.includePoseSheet !== false) {
      const poseResult = await this.generateCharacterReferenceSheet(request);
      if (poseResult.success && poseResult.data) {
        poseSheet = poseResult.data;
      } else {
        errors.push(`Pose sheet: ${poseResult.error || 'Unknown error'}`);
      }
    }

    // Generate expression sheet
    if (request.includeExpressions !== false) {
      const exprResult = await this.generateCharacterExpressionSheet(request);
      if (exprResult.success && exprResult.data) {
        expressionSheet = exprResult.data;
      } else {
        errors.push(`Expression sheet: ${exprResult.error || 'Unknown error'}`);
      }
    }

    // Generate body vocabulary
    if (request.includeBodyVocabulary !== false) {
      const vocabResult = await this.generateCharacterBodyVocabulary(request);
      if (vocabResult.success && vocabResult.data) {
        bodyVocabulary = vocabResult.data;
      } else {
        errors.push(`Body vocabulary: ${vocabResult.error || 'Unknown error'}`);
      }
    }

    return { poseSheet, expressionSheet, bodyVocabulary, errors };
  }

  /**
   * Generate COMPLETE character reference including silhouette profile
   * This is the most comprehensive character reference generation
   */
  async generateFullCharacterReferenceWithSilhouette(
    request: CharacterReferenceSheetRequest
  ): Promise<{
    poseSheet?: CharacterReferenceSheet;
    expressionSheet?: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet;
    bodyVocabulary?: import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary;
    silhouetteProfile?: import('./CharacterReferenceSheetAgent').CharacterSilhouetteProfile;
    errors: string[];
  }> {
    console.log(`[ImageAgentTeam] Generating complete reference with silhouette for: ${request.name}`);
    
    const errors: string[] = [];
    let poseSheet: CharacterReferenceSheet | undefined;
    let expressionSheet: import('./CharacterReferenceSheetAgent').CharacterExpressionSheet | undefined;
    let bodyVocabulary: import('./CharacterReferenceSheetAgent').CharacterBodyVocabulary | undefined;
    let silhouetteProfile: import('./CharacterReferenceSheetAgent').CharacterSilhouetteProfile | undefined;

    // Generate pose sheet
    if (request.includePoseSheet !== false) {
      const poseResult = await this.generateCharacterReferenceSheet(request);
      if (poseResult.success && poseResult.data) {
        poseSheet = poseResult.data;
      } else {
        errors.push(`Pose sheet: ${poseResult.error || 'Unknown error'}`);
      }
    }

    // Generate expression sheet
    if (request.includeExpressions !== false) {
      const exprResult = await this.generateCharacterExpressionSheet(request);
      if (exprResult.success && exprResult.data) {
        expressionSheet = exprResult.data;
      } else {
        errors.push(`Expression sheet: ${exprResult.error || 'Unknown error'}`);
      }
    }

    // Generate body vocabulary (for major characters)
    if (request.includeBodyVocabulary !== false) {
      const vocabResult = await this.generateCharacterBodyVocabulary(request);
      if (vocabResult.success && vocabResult.data) {
        bodyVocabulary = vocabResult.data;
      } else {
        errors.push(`Body vocabulary: ${vocabResult.error || 'Unknown error'}`);
      }
    }

    // Generate silhouette profile
    if (request.includeSilhouetteProfile !== false) {
      const silhouetteResult = await this.generateCharacterSilhouetteProfile(request);
      if (silhouetteResult.success && silhouetteResult.data) {
        silhouetteProfile = silhouetteResult.data;
      } else {
        errors.push(`Silhouette profile: ${silhouetteResult.error || 'Unknown error'}`);
      }
    }

    return { poseSheet, expressionSheet, bodyVocabulary, silhouetteProfile, errors };
  }

  /**
   * Generate a character silhouette profile
   */
  async generateCharacterSilhouetteProfile(
    request: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<import('./CharacterReferenceSheetAgent').CharacterSilhouetteProfile>> {
    console.log(`[ImageAgentTeam] Generating silhouette profile for: ${request.name}`);
    const result = await this.referenceSheetAgent.generateSilhouetteProfile(request);
    
    // Cache the profile
    if (result.success && result.data) {
      this.characterSilhouetteProfiles.set(request.characterId, result.data);
    }
    
    return result;
  }

  /**
   * Get cached silhouette profile for a character
   */
  getCharacterSilhouetteProfile(characterId: string): import('./CharacterReferenceSheetAgent').CharacterSilhouetteProfile | undefined {
    return this.characterSilhouetteProfiles.get(characterId);
  }

  private async buildFullQAGuidanceForShot(
    report: {
      expressionReports?: Map<string, ExpressionValidationReport>;
      bodyLanguageReports?: Map<string, BodyLanguageValidationReport>;
      lightingColorReports?: Map<string, LightingColorValidationReport>;
      visualStorytellingReports?: Map<string, VisualStorytellingValidationReport>;
    },
    shot: VisualPlan['shots'][number],
    image?: GeneratedImage
  ): Promise<string | undefined> {
    const shotKey = shot.id || shot.beatId;
    if (!shotKey) return undefined;

    const guidanceParts: string[] = [];
    const expressionReport = report.expressionReports?.get(shotKey);
    const bodyReport = report.bodyLanguageReports?.get(shotKey);
    const lightingReport = report.lightingColorReports?.get(shotKey);
    const storytellingReport = report.visualStorytellingReports?.get(shotKey);

    if (image?.imageData && image?.mimeType) {
      try {
        const compositionResult = await this.validateComposition(
          { data: image.imageData, mimeType: image.mimeType },
          shot.shotType || 'MS',
          shot.composition || shot.description || ''
        );
        if (compositionResult.success && compositionResult.data?.isValid === false) {
          guidanceParts.push(`Fix composition: ${compositionResult.data.feedback}`);
        }
      } catch (err) {
        console.warn('[ImageAgentTeam] Composition guidance generation failed:', err);
      }
    }

    if (expressionReport && !expressionReport.isAcceptable) {
      guidanceParts.push(expressionReport.regenerationGuidance || expressionReport.recommendations.join(' '));
    }
    if (bodyReport && !bodyReport.isAcceptable) {
      guidanceParts.push(bodyReport.regenerationGuidance || bodyReport.recommendations.join(' '));
    }
    if (lightingReport && !lightingReport.isAcceptable) {
      guidanceParts.push(lightingReport.regenerationGuidance || lightingReport.recommendations.join(' '));
    }
    if (storytellingReport && !storytellingReport.isAcceptable) {
      guidanceParts.push(storytellingReport.regenerationGuidance || storytellingReport.suggestions.join(' '));
    }

    const guidance = guidanceParts
      .map(part => (part || '').trim())
      .filter(Boolean)
      .join(' ');

    return guidance || undefined;
  }

  /**
   * Resolve character names/IDs from a shot to full character descriptions for the illustrator.
   * This is CRITICAL — without this, the illustrator has no idea who to draw or what they look like.
   * 
   * Now foreground/background aware:
   * - foreground characters get "FOREGROUND" annotation (visual focus, sharp detail)
   * - background characters get "BACKGROUND" annotation (present but softer/partial)
   */
  private resolveCharactersForShot(
    shotCharacterIds?: string[],
    beatCharacterIds?: string[],
    characterDescriptions?: StoryboardRequest['characterDescriptions'],
    foregroundCharacterNames?: string[],
    backgroundCharacterNames?: string[]
  ): Array<{ name: string; description: string; role: string; height?: string; build?: string }> | undefined {
    if (!characterDescriptions || characterDescriptions.length === 0) return undefined;
    
    const charIds = shotCharacterIds && shotCharacterIds.length > 0 
      ? shotCharacterIds 
      : beatCharacterIds;
    
    const findChar = (idOrName: string) => {
      const byId = characterDescriptions.find(c => c.id === idOrName);
      if (byId) return byId;
      return characterDescriptions.find(c => 
        c.name.toLowerCase() === idOrName.toLowerCase() ||
        c.name.toLowerCase().includes(idOrName.toLowerCase()) ||
        idOrName.toLowerCase().includes(c.name.toLowerCase())
      );
    };
    
    const fgNamesLower = new Set((foregroundCharacterNames || []).map(n => n.toLowerCase()));
    const bgNamesLower = new Set((backgroundCharacterNames || []).map(n => n.toLowerCase()));
    
    const getVisualRole = (charName: string, storyRole: string): string => {
      const nameLower = charName.toLowerCase();
      if (fgNamesLower.has(nameLower) || 
          Array.from(fgNamesLower).some(fg => nameLower.includes(fg) || fg.includes(nameLower))) {
        return `${storyRole} [FOREGROUND — visual focus, sharp detail, prominent in frame]`;
      }
      if (bgNamesLower.has(nameLower) ||
          Array.from(bgNamesLower).some(bg => nameLower.includes(bg) || bg.includes(nameLower))) {
        return `${storyRole} [BACKGROUND — present but not focus, can be partial/softer]`;
      }
      return storyRole;
    };
    
    const buildDescription = (c: NonNullable<ReturnType<typeof findChar>>) => {
      const genderPrefix = c.gender ? `${c.gender}, ` : '';
      return `${genderPrefix}${c.physicalDescription}. Distinctive features: ${c.distinctiveFeatures.join(', ')}. Typically wears: ${c.typicalAttire}`;
    };

    const mapChar = (c: NonNullable<ReturnType<typeof findChar>>) => ({
      name: c.name,
      description: buildDescription(c),
      role: getVisualRole(c.name, c.role),
      height: c.height,
      build: c.build,
    });

    if (!charIds || charIds.length === 0) {
      if (foregroundCharacterNames && foregroundCharacterNames.length > 0) {
        const fgResolved = foregroundCharacterNames
          .map(name => findChar(name))
          .filter(Boolean);
        if (fgResolved.length > 0) {
          return fgResolved.map(c => mapChar(c!));
        }
      }
      const protagonist = characterDescriptions.find(c => c.role === 'protagonist') || characterDescriptions[0];
      if (protagonist) {
        return [mapChar(protagonist)];
      }
      return undefined;
    }
    
    const resolved = charIds.map(findChar).filter(Boolean);
    
    if (resolved.length === 0) return undefined;
    
    return resolved.map(c => mapChar(c!));
  }

  /**
   * Get silhouette hooks for characters (for use in beat-level silhouette specs)
   */
  getCharacterSilhouetteHooks(characterIds: string[]): string[][] {
    return characterIds.map(id => {
      const profile = this.characterSilhouetteProfiles.get(id);
      return profile?.silhouetteHooks || [];
    });
  }

  /**
   * Validate body language in a generated image
   */
  async validateBodyLanguage(
    imageId: string,
    imageData: string,
    mimeType: string,
    characterSpecs: import('./StoryboardAgent').CharacterActingSpec[],
    sceneContext?: {
      expectedPowerDynamic?: 'balanced' | 'one_dominant' | 'shifting';
      expectedEmotionalDistance?: 'close' | 'neutral' | 'distant';
      isConflictScene?: boolean;
    }
  ): Promise<AgentResponse<BodyLanguageValidationReport>> {
    console.log(`[ImageAgentTeam] Validating body language for ${characterSpecs.length} characters`);

    return this.bodyLanguageValidator.execute({
      imageId,
      imageData,
      mimeType,
      characterSpecs,
      bodyVocabularies: this.characterBodyVocabularies,
      sceneContext
    });
  }

  /**
   * Structural validation of acting specs before generation
   */
  validateActingSpecs(
    specs: import('./StoryboardAgent').CharacterActingSpec[]
  ): { isValid: boolean; characterChecks: import('./BodyLanguageValidator').BodyLanguageStructuralCheck[]; issues: string[] } {
    return this.bodyLanguageValidator.validateActingSpecStructure(specs);
  }

  /**
   * Check if a body language spec would result in a neutral/static pose
   */
  checkForNeutralPose(
    bodyLanguage: import('./StoryboardAgent').BodyLanguageSpec
  ): { isNeutral: boolean; reasons: string[] } {
    return this.bodyLanguageValidator.isNeutralPose(bodyLanguage);
  }

  /**
   * Get suggestions to improve a neutral pose
   */
  suggestPoseImprovements(
    bodyLanguage: import('./StoryboardAgent').BodyLanguageSpec,
    intent: string,
    emotion: string
  ): string[] {
    return this.bodyLanguageValidator.suggestPoseImprovements(bodyLanguage, intent, emotion);
  }

  /**
   * Full validation: diversity + transitions + expressions + body language + lighting/color + visual narrative
   */
  async runFullVisualQA(
    plan: VisualPlan,
    generatedImages?: Map<string, GeneratedImage>,
    sceneType?: 'action' | 'dialogue' | 'emotional' | 'climax',
    isNarrativePeak?: boolean,
    colorScript?: ColorScript,
    sceneContext?: {
      isClimactic?: boolean;
      isResolution?: boolean;
      isFlashback?: boolean;
      isNightmare?: boolean;
      isSafeHubScene?: boolean;
      branchType?: 'dark' | 'hopeful' | 'neutral';
    }
  ): Promise<{
    overallScore: number;
    isAcceptable: boolean;
    diversityReport?: DiversityReport;
    transitionReport?: TransitionValidationReport;
    pacingReport?: import('./ExpressionValidator').ExpressionPacingReport;
    expressionReports?: Map<string, ExpressionValidationReport>;
    expressionSummary?: { valid: number; invalid: number; issues: string[] };
    bodyLanguageReports?: Map<string, BodyLanguageValidationReport>;
    bodyLanguageSummary?: { valid: number; invalid: number; neutralPoseViolations: number; issues: string[] };
    lightingColorReports?: Map<string, LightingColorValidationReport>;
    lightingColorSummary?: { valid: number; invalid: number; issues: string[] };
    visualStorytellingReports?: Map<string, VisualStorytellingValidationReport>;
    visualStorytellingSummary?: { 
      valid: number; 
      invalid: number; 
      thumbnailTestFails: number;
      redundantBeats: number;
      transitionIssues: number;
      issues: string[] 
    };
    issues: string[];
    shotsToRegenerate: string[];
  }> {
    const issues: string[] = [];
    const shotsToRegenerate = new Set<string>();

    // 1. Pose diversity check
    const diversityResult = await this.validatePoseDiversity(plan, generatedImages, true);
    const diversityReport = diversityResult.success ? diversityResult.data : undefined;
    
    if (diversityReport && !diversityReport.isAcceptable) {
      issues.push(`Pose diversity: ${diversityReport.summary}`);
      diversityReport.shotsToRegenerate.forEach(id => shotsToRegenerate.add(id));
    }

    // 2. Transition validation
    const transitionResult = await this.validateTransitions(plan, generatedImages, true);
    const transitionReport = transitionResult.success ? transitionResult.data : undefined;
    
    if (transitionReport && !transitionReport.isAcceptable) {
      issues.push(`Transitions: ${transitionReport.summary}`);
      transitionReport.transitionsToFix.forEach(t => {
        shotsToRegenerate.add(t.shotBId);
      });
    }

    // 3. Expression pacing validation (structural - no images needed)
    const pacingReport = this.validateExpressionPacing(plan, sceneType, isNarrativePeak);
    if (!pacingReport.isAcceptable) {
      issues.push(`Expression pacing: ${pacingReport.issues.join('; ')}`);
      for (const jt of pacingReport.transitions.jarringTransitions) {
        shotsToRegenerate.add(jt.toShotId);
      }
    }

    // 4. Acting spec structural validation (before images)
    for (const shot of plan.shots) {
      const actingSpecs = shot.storyBeat?.characterActing;
      if (actingSpecs && actingSpecs.length > 0) {
        const specValidation = this.validateActingSpecs(actingSpecs);
        if (!specValidation.isValid) {
          issues.push(`Shot ${shot.id} acting specs: ${specValidation.issues.join(', ')}`);
        }
      }
    }

    // 5. Expression validation (if images provided)
    const expressionReports = new Map<string, ExpressionValidationReport>();
    const expressionIssues: string[] = [];
    let validExpressions = 0;
    let invalidExpressions = 0;

    // 6. Body language validation (if images provided)
    const bodyLanguageReports = new Map<string, BodyLanguageValidationReport>();
    const bodyLanguageIssues: string[] = [];
    let validBodyLanguage = 0;
    let invalidBodyLanguage = 0;
    let neutralPoseViolations = 0;

    if (generatedImages) {
      for (const shot of plan.shots) {
        const shotKey = shot.id || shot.beatId;
        if (!shotKey) continue;
        const image = generatedImages.get(shotKey);
        if (!image?.imageData || !image?.mimeType) continue;

        // Expression validation
        const characterEmotions = shot.storyBeat?.characterEmotions;
        if (characterEmotions && characterEmotions.length > 0) {
          const expressionResult = await this.validateExpressions(
            shot.id,
            image.imageData,
            image.mimeType,
            characterEmotions,
            shot.storyBeat?.emotion,
            false
          );

          if (expressionResult.success && expressionResult.data) {
            expressionReports.set(shotKey, expressionResult.data);
            
            if (expressionResult.data.isAcceptable) {
              validExpressions++;
            } else {
              invalidExpressions++;
              expressionIssues.push(`Shot ${shot.id}: ${expressionResult.data.issues.join(', ')}`);
              if (expressionResult.data.needsRegeneration) {
                shotsToRegenerate.add(shotKey);
              }
            }
          }
        }

        // Body language validation
        const actingSpecs = shot.storyBeat?.characterActing;
        if (actingSpecs && actingSpecs.length > 0) {
          const bodyResult = await this.validateBodyLanguage(
            shot.id,
            image.imageData,
            image.mimeType,
            actingSpecs,
            shot.storyBeat?.spatialComposition ? {
              expectedPowerDynamic: shot.storyBeat.spatialComposition.powerDynamic,
              expectedEmotionalDistance: shot.storyBeat.spatialComposition.emotionalDistance === 'connected' ? 'close' : 
                                         shot.storyBeat.spatialComposition.emotionalDistance === 'alienated' ? 'distant' : 'neutral'
            } : undefined
          );

          if (bodyResult.success && bodyResult.data) {
            bodyLanguageReports.set(shotKey, bodyResult.data);
            
            if (bodyResult.data.isAcceptable) {
              validBodyLanguage++;
            } else {
              invalidBodyLanguage++;
              bodyLanguageIssues.push(`Shot ${shot.id}: ${bodyResult.data.issues.join(', ')}`);
              
              // Count neutral pose violations
              for (const cv of bodyResult.data.characterValidations) {
                if (cv.neutralPoseCheck.hasNeutralPose) {
                  neutralPoseViolations++;
                }
              }
              
              if (bodyResult.data.needsRegeneration) {
                shotsToRegenerate.add(shotKey);
              }
            }
          }
        }
      }
    }

    // 7. Lighting/Color validation (if images provided and mood specs available)
    const lightingColorReports = new Map<string, LightingColorValidationReport>();
    const lightingColorIssues: string[] = [];
    let validLightingColor = 0;
    let invalidLightingColor = 0;

    if (generatedImages) {
      for (const shot of plan.shots) {
        const shotKey = shot.id || shot.beatId;
        if (!shotKey) continue;
        const image = generatedImages.get(shotKey);
        if (!image?.imageData || !image?.mimeType) continue;

        // Get mood spec from shot or generate from color script
        let moodSpec: MoodSpec | undefined;
        
        if (shot.moodSpec) {
          // Use the mood spec from the shot
          moodSpec = shot.moodSpec as MoodSpec;
        } else if (colorScript) {
          // Try to get from color script
          const result = this.colorScriptAgent.getMoodSpecForBeat(colorScript, shot.beatId);
          moodSpec = result.mood || undefined;
        }

        if (moodSpec) {
          const lightingResult = await this.validateLightingColor(
            shot.id,
            image.imageData,
            image.mimeType,
            moodSpec,
            colorScript,
            shot.beatId,
            sceneContext
          );

          if (lightingResult.success && lightingResult.data) {
            lightingColorReports.set(shotKey, lightingResult.data);
            
            if (lightingResult.data.isAcceptable) {
              validLightingColor++;
            } else {
              invalidLightingColor++;
              lightingColorIssues.push(`Shot ${shot.id}: ${lightingResult.data.issues.join(', ')}`);
              if (lightingResult.data.needsRegeneration) {
                shotsToRegenerate.add(shotKey);
              }
            }
          }
        }
      }
    }

    // 8. Unified visual storytelling validation (McCloud + Eisner)
    const visualStorytellingReports = new Map<string, VisualStorytellingValidationReport>();
    const visualStorytellingIssues: string[] = [];
    let validVisualStorytelling = 0;
    let invalidVisualStorytelling = 0;
    let thumbnailTestFails = 0;
    let redundantBeats = 0;
    let transitionIssues = 0;

    if (generatedImages) {
      for (let i = 0; i < plan.shots.length; i++) {
        const shot = plan.shots[i];
        const previousShot = i > 0 ? plan.shots[i - 1] : undefined;
        const shotKey = shot.id || shot.beatId;
        if (!shotKey) continue;
        const previousShotKey = previousShot ? (previousShot.id || previousShot.beatId) : undefined;
        const image = generatedImages.get(shotKey);
        const previousImage = previousShotKey ? generatedImages.get(previousShotKey) : undefined;
        if (!image?.imageData || !image?.mimeType) continue;

        // Build spec from shot's visualStorytelling field
        const spec: Partial<VisualStorytellingSpec> = shot.visualStorytelling ? {
          beatId: shot.beatId,
          clarity: shot.visualStorytelling.clarity,
          compositionFlow: shot.visualStorytelling.compositionFlow,
          environment: shot.visualStorytelling.environment,
          pacing: shot.visualStorytelling.pacing,
          motifsPresent: shot.visualStorytelling.motifsPresent,
          choiceTelegraph: shot.visualStorytelling.choiceTelegraph
        } : { beatId: shot.beatId };

        const previousSpec: Partial<VisualStorytellingSpec> | undefined = previousShot?.visualStorytelling ? {
          beatId: previousShot.beatId,
          pacing: previousShot.visualStorytelling.pacing
        } : undefined;

        const storyResult = await this.validateVisualStorytelling(
          shot.id,
          image.imageData,
          image.mimeType,
          spec,
          previousImage?.imageData,
          previousImage?.mimeType,
          previousSpec,
          { action: shot.storyBeat?.action || '', emotion: shot.storyBeat?.emotion || '' },
          previousShot ? { action: previousShot.storyBeat?.action || '', emotion: previousShot.storyBeat?.emotion || '' } : undefined
        );

        if (storyResult.success && storyResult.data) {
          visualStorytellingReports.set(shotKey, storyResult.data);
          
          if (storyResult.data.isAcceptable) {
            validVisualStorytelling++;
          } else {
            invalidVisualStorytelling++;
            visualStorytellingIssues.push(`Shot ${shot.id}: ${storyResult.data.criticalIssues.join(', ')}`);
            
            // Track specific failures
            if (!storyResult.data.thumbnailTest.passesTest) {
              thumbnailTestFails++;
            }
            if (storyResult.data.advancementValidation?.isRedundant) {
              redundantBeats++;
            }
            if (storyResult.data.transitionValidation && !storyResult.data.transitionValidation.passesTest) {
              transitionIssues++;
            }
            
            if (storyResult.data.needsRegeneration) {
              shotsToRegenerate.add(shotKey);
            }
          }
        }
      }
    }

    if (invalidExpressions > 0) {
      issues.push(`Expressions: ${invalidExpressions} shots have incorrect character expressions`);
    }
    if (invalidBodyLanguage > 0) {
      issues.push(`Body language: ${invalidBodyLanguage} shots have body language issues`);
    }
    if (neutralPoseViolations > 0) {
      issues.push(`NEUTRAL POSES: ${neutralPoseViolations} characters have banned static poses`);
    }
    if (invalidLightingColor > 0) {
      issues.push(`Lighting/Color: ${invalidLightingColor} shots have incorrect mood lighting or color`);
    }
    if (invalidVisualStorytelling > 0) {
      issues.push(`Visual Storytelling: ${invalidVisualStorytelling} shots have issues`);
    }
    if (thumbnailTestFails > 0) {
      issues.push(`THUMBNAIL TEST: ${thumbnailTestFails} shots fail readability at small size`);
    }
    if (redundantBeats > 0) {
      issues.push(`REDUNDANT BEATS: ${redundantBeats} shots don't advance the story`);
    }
    if (transitionIssues > 0) {
      issues.push(`TRANSITION CONTINUITY: ${transitionIssues} shots have continuity breaks`);
    }

    // Calculate overall score (includes all 7 validations)
    const diversityScore = diversityReport?.overallScore || 100;
    const transitionScore = transitionReport?.overallScore || 100;
    const pacingScore = pacingReport.overallScore;
    const expressionScore = expressionReports.size > 0
      ? Math.round(Array.from(expressionReports.values()).reduce((sum, r) => sum + r.overallScore, 0) / expressionReports.size)
      : 100;
    const bodyLanguageScore = bodyLanguageReports.size > 0
      ? Math.round(Array.from(bodyLanguageReports.values()).reduce((sum, r) => sum + r.overallScore, 0) / bodyLanguageReports.size)
      : 100;
    const lightingColorScore = lightingColorReports.size > 0
      ? Math.round(Array.from(lightingColorReports.values()).reduce((sum, r) => sum + r.overallScore, 0) / lightingColorReports.size)
      : 100;
    const visualStorytellingScore = visualStorytellingReports.size > 0
      ? Math.round(Array.from(visualStorytellingReports.values()).reduce((sum, r) => sum + r.overallScore, 0) / visualStorytellingReports.size)
      : 100;
    
    // Note: transition validation is now part of visual storytelling, so we have 6 main categories
    const overallScore = Math.round((diversityScore + pacingScore + expressionScore + bodyLanguageScore + lightingColorScore + visualStorytellingScore) / 6);
    
    const isAcceptable = overallScore >= 70 && shotsToRegenerate.size === 0;

    return {
      overallScore,
      isAcceptable,
      diversityReport,
      transitionReport,
      pacingReport,
      expressionReports: expressionReports.size > 0 ? expressionReports : undefined,
      expressionSummary: expressionReports.size > 0 ? {
        valid: validExpressions,
        invalid: invalidExpressions,
        issues: expressionIssues
      } : undefined,
      bodyLanguageReports: bodyLanguageReports.size > 0 ? bodyLanguageReports : undefined,
      bodyLanguageSummary: bodyLanguageReports.size > 0 ? {
        valid: validBodyLanguage,
        invalid: invalidBodyLanguage,
        neutralPoseViolations,
        issues: bodyLanguageIssues
      } : undefined,
      lightingColorReports: lightingColorReports.size > 0 ? lightingColorReports : undefined,
      lightingColorSummary: lightingColorReports.size > 0 ? {
        valid: validLightingColor,
        invalid: invalidLightingColor,
        issues: lightingColorIssues
      } : undefined,
      visualStorytellingReports: visualStorytellingReports.size > 0 ? visualStorytellingReports : undefined,
      visualStorytellingSummary: visualStorytellingReports.size > 0 ? {
        valid: validVisualStorytelling,
        invalid: invalidVisualStorytelling,
        thumbnailTestFails,
        redundantBeats,
        transitionIssues,
        issues: visualStorytellingIssues
      } : undefined,
      issues,
      shotsToRegenerate: Array.from(shotsToRegenerate)
    };
  }

  /**
   * Validate a generated image for text artifacts using Gemini vision QA.
   * Returns true if the image passes (no unwanted text detected), false if it should be regenerated.
   * 
   * This is a shared utility that can be called by both episode and encounter image paths.
   */
  async validateImageForTextArtifacts(
    imageData: string,
    mimeType: string,
    imageService: { checkImageForTextArtifacts?: (imageData: string, mimeType: string, allowDiegeticText?: boolean) => Promise<{ hasText: boolean; description?: string }> },
    allowDiegeticText: boolean = false,
    identifier: string = 'unknown'
  ): Promise<{ passed: boolean; description?: string }> {
    if (!imageService.checkImageForTextArtifacts) {
      return { passed: true };
    }

    try {
      const result = await imageService.checkImageForTextArtifacts(imageData, mimeType, allowDiegeticText);
      if (result.hasText) {
        console.warn(`[ImageAgentTeam] Text artifact detected in ${identifier}: ${result.description || 'unknown text'}`);
        return { passed: false, description: result.description };
      }
      return { passed: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ImageAgentTeam] Text artifact validation error for ${identifier}: ${msg} — allowing image`);
      return { passed: true };
    }
  }
}
