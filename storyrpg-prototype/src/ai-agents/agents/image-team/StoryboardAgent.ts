import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { SceneContent } from '../SceneWriter';
import { 
  CORE_VISUAL_PRINCIPLE, 
  MOBILE_COMPOSITION_FRAMEWORK, 
  SHOT_TYPE_SYSTEM, 
  CAMERA_ANGLE_SYSTEM, 
  WALLY_WOOD_PANELS, 
  SEQUENCE_VARIETY_RULES,
  VISUAL_BEAT_MAPPING,
  POSE_LINE_OF_ACTION,
  POSE_TILT_RHYTHM_TWIST,
  POSE_ASYMMETRY_RULES,
  POSE_VOCABULARY,
  POSE_DIVERSITY_CHECKLIST,
  STORY_BEAT_DEFINITION,
  COMPOSITION_STORYTELLING,
  LIGHTING_MOOD_VOCABULARY,
  TRANSITION_TYPES,
  TRANSITION_SELECTION_RULES,
  TRANSITION_CONTINUITY_RULES
} from '../../prompts';
import { 
  EXPRESSION_PACING_RULES,
  EXPRESSION_LANDMARKS,
  findExpressionForEmotion,
  getEmotionalDistance,
  isExtremeExpression,
  suggestTransitionPath,
  ExpressionName
} from './CharacterReferenceSheetAgent';
import { selectStyleAdaptation, type SceneSettingContext } from '../../utils/styleAdaptation';

// Panel transition types (McCloud-inspired)
export type TransitionType = 
  | 'moment_to_moment'    // Micro-progression: tiny changes, time barely moves
  | 'action_to_action'    // Keyframe motion: same subject through action sequence
  | 'subject_to_subject'  // Same moment, different focus/subject
  | 'scene_to_scene'      // Time/space jump
  | 'aspect_to_aspect'    // Mood wandering: different details of same place/time
  | 'non_sequitur';       // Surreal/symbolic jump

// Transition specification between shots
export interface TransitionSpecification {
  type: TransitionType;
  closureLoad: 'very_low' | 'moderate' | 'high' | 'very_high';
  // What must stay the same
  preserveCamera: boolean;
  preserveEnvironment: boolean;
  preserveCharacterPosition: boolean;
  preserveLighting: boolean;
  preservePalette: boolean;
  // What changes
  changeDescription: string;
  // Continuity thread (for scene_to_scene and non_sequitur)
  continuityThread?: string;
}

// Pose specification for tracking diversity
export interface PoseSpecification {
  lineOfAction: 'S-curve' | 'C-curve' | 'diagonal' | 'coiled';
  weightDistribution: 'left' | 'right' | 'centered' | 'forward' | 'backward' | 'off-balance';
  armPosition: 'gesture-high' | 'gesture-mid' | 'gesture-low' | 'crossed' | 'at-sides' | 'reaching' | 'defensive' | 'relaxed';
  torsoTwist: 'twisted-left' | 'twisted-right' | 'square' | 'leaning';
  emotionalQuality: 'expanded' | 'contracted' | 'neutral' | 'dynamic';
}

// Lighting specification
export interface LightingSpecification {
  direction: 'front' | 'side' | 'back' | 'rim' | 'top' | 'under';
  quality: 'soft' | 'hard' | 'dappled' | 'dramatic';
  temperature: 'warm' | 'cool' | 'mixed' | 'neutral';
  contrast: 'high' | 'medium' | 'low';
}

// ============================================
// BODY LANGUAGE AS PRIMARY STORYTELLING
// ============================================

// Intent specification - what the character WANTS in this moment
export type CharacterIntent = 
  | 'convince' | 'reassure' | 'comfort' | 'encourage' | 'celebrate'
  | 'hide_emotion' | 'conceal' | 'deceive' | 'manipulate'
  | 'threaten' | 'intimidate' | 'dominate' | 'challenge' | 'confront'
  | 'withdraw' | 'retreat' | 'protect_self' | 'avoid' | 'escape'
  | 'plead' | 'beg' | 'apologize' | 'confess' | 'surrender'
  | 'observe' | 'assess' | 'wait' | 'consider' | 'process'
  | 'connect' | 'reach_out' | 'include' | 'welcome' | 'embrace'
  | 'reject' | 'dismiss' | 'exclude' | 'push_away' | 'betray';

// Status/relationship dynamics
export type StatusLevel = 'dominant' | 'equal' | 'submissive';
export type RelationalStance = 'open' | 'guarded' | 'closed';
export type SpatialRelation = 'approaching' | 'neutral' | 'withdrawing';

// Full body language specification
export interface BodyLanguageSpec {
  // Core posture
  spine: 'upright' | 'curved_forward' | 'leaning_back' | 'twisted' | 'hunched' | 'rigid';
  shoulderState: 'open_relaxed' | 'open_tense' | 'hunched_forward' | 'raised_tense' | 'dropped_defeated';
  chestDirection: 'open_forward' | 'closed_inward' | 'turned_away' | 'puffed_up';
  
  // Weight and stance
  weightDistribution: 'forward' | 'back' | 'centered' | 'shifted_left' | 'shifted_right' | 'unstable';
  stanceWidth: 'wide_confident' | 'normal' | 'narrow_insecure' | 'off_balance';
  feetDirection: 'toward_target' | 'away_from_target' | 'angled_exit' | 'planted_firm';
  
  // Head and neck
  headPosition: 'chin_up' | 'chin_down' | 'tilted_curious' | 'turned_away' | 'ducked_protective';
  neckTension: 'relaxed' | 'tense' | 'craned_forward' | 'pulled_back';
  gazeDirection: 'direct_contact' | 'averted' | 'downcast' | 'upward' | 'sidelong';
  
  // Arms and hands (CRITICAL for emotion)
  armPosition: 'open_wide' | 'gesturing' | 'crossed' | 'at_sides_relaxed' | 'hands_on_hips' | 'behind_back' | 'protective_front' | 'reaching_out';
  handState: 'open_palms' | 'fists_clenched' | 'fidgeting' | 'self_contact' | 'gripping_object' | 'hidden' | 'gesturing_emphatic';
  gestureSize: 'expansive' | 'moderate' | 'small_contained' | 'none';
  
  // Spatial relationship (for multi-character shots)
  spatialDistance?: 'intimate' | 'personal' | 'social' | 'public' | 'distant';
  bodyOrientation?: 'facing_directly' | 'angled_toward' | 'parallel' | 'angled_away' | 'back_turned';
}

// Silhouette goal for visual clarity
export interface SilhouetteGoal {
  overallShape: string;  // e.g., "small, inward-curved figure"
  keyFeatures: string[]; // e.g., ["arm up near head", "clear head separation"]
  emotionalRead: string; // What emotion should read even as thumbnail
}

// Complete acting specification for a character in a beat
export interface CharacterActingSpec {
  characterName: string;
  characterId?: string;
  
  // INTENT - What does this character WANT in this moment?
  intent: CharacterIntent;
  intentDescription?: string; // e.g., "downplay trauma while secretly worried"
  
  // EMOTIONAL STATE - Primary + secondary emotions
  primaryEmotion: string;
  secondaryEmotion?: string;
  emotionalMask?: string; // What they're SHOWING vs what they FEEL
  expressionName?: string; // Mapped to expression reference
  intensity: 'subtle' | 'moderate' | 'intense';
  
  // EXPRESSION LANDMARKS (face)
  eyebrows?: string;
  eyelids?: string;
  mouth?: string;
  
  // STATUS & RELATIONSHIP
  status: StatusLevel;
  relationalStance: RelationalStance;
  spatialRelation: SpatialRelation;
  relationshipToOthers?: string; // e.g., "CARES_FOR but DOES_NOT_WANT_TO_BURDEN"
  
  // FULL BODY LANGUAGE
  bodyLanguage: BodyLanguageSpec;
  
  // SILHOUETTE GOAL
  silhouetteGoal?: SilhouetteGoal;
  
  // Why this character is acting this way
  reason?: string;
}

// Legacy interface for backward compatibility
export interface CharacterEmotion {
  characterName: string;
  characterId?: string;
  emotion: string;
  expressionName?: string;
  intensity: 'subtle' | 'moderate' | 'intense';
  eyebrows?: string;
  eyelids?: string;
  mouth?: string;
  reason?: string;
  // NEW: Full acting spec (optional, for enhanced mode)
  actingSpec?: CharacterActingSpec;
}

// ============================================
// LIGHTING & COLOR IMPORTS
// ============================================
// Import from LightingColorSystem for mood-driven lighting
import type {
  MoodSpec,
  LightingSpec,
  ColorSpec,
  EmotionCore,
  EmotionIntensity,
  EmotionValence,
  ColorScript,
  ColorScriptBeat
} from './LightingColorSystem';

// Re-export for convenience
export type { MoodSpec, LightingSpec, ColorSpec, EmotionCore, EmotionIntensity, EmotionValence };

// ============================================
// UNIFIED VISUAL STORYTELLING IMPORTS
// ============================================
import type {
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
  // Composition (within image)
  ClaritySpec,
  CompositionFlowSpec,
  CompositionEntry,
  CompositionExit,
  InformationDensity,
  EnvironmentPersonality,
  EnvironmentSpec,
  // Sequence (between images)
  // TransitionType - defined locally in this file
  TransitionSpec,
  ClosureLoad,
  ContinuityRules,
  RhythmRole,
  ChangeMagnitude,
  PacingSpec,
  // Story integration
  VisualMotif,
  MotifPresence,
  MotifLibrary,
  ChoiceTelegraph,
  // Complete spec
  VisualStorytellingSpec
} from './VisualStorytellingSystem';
import {
  TRANSITION_RULES,
  RHYTHM_ROLE_GUIDANCE,
  COMPOSITION_FLOW_RULES,
  CLARITY_RULES,
  ENVIRONMENT_RULES,
  CHOICE_PROXIMITY_RULES,
  SHOT_TYPE_GUIDE,
  CAMERA_HEIGHT_GUIDE,
  AXIS_CONTINUITY_RULES,
  CAMERA_CHANGE_RULES,
  CONVERSATIONAL_SHOT_PATTERNS,
  TEXTURE_RULES,
  MATERIAL_TEXTURE_GUIDE,
  PERSPECTIVE_TYPE_GUIDE,
  STAGING_PATTERN_GUIDE,
  SPATIAL_CONSISTENCY_RULES,
  SILHOUETTE_POSE_RULES,
  IMPACT_COMPOSITION_RULES,
  getDefaultContinuity,
  getSuggestedPacing,
  getMagnitudeFromTransition,
  suggestRhythmRole,
  suggestTransitionType,
  suggestEnvironmentPersonality,
  validateAdvancement,
  buildPacingSpec,
  suggestShotType,
  suggestCameraHeight,
  shouldCrossLine,
  buildDefaultCameraSpec,
  suggestTextureSpec,
  buildDefaultTextureSpec,
  generateTexturePrompt,
  suggestPerspectiveType,
  suggestStagingPattern,
  suggestCharacterDistance,
  suggestSpatialSpec,
  buildDefaultSpatialSpec,
  generateSpatialPrompt,
  suggestBeatSilhouetteSpec,
  suggestImpactSpec,
  generateSilhouettePrompt,
  generateImpactPrompt
} from './VisualStorytellingSystem';

// Re-export unified types
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
  ClaritySpec,
  CompositionFlowSpec,
  CompositionEntry,
  CompositionExit,
  InformationDensity,
  EnvironmentPersonality,
  EnvironmentSpec,
  // Pacing
  TransitionType,
  TransitionSpec,
  ClosureLoad,
  ContinuityRules,
  RhythmRole,
  ChangeMagnitude,
  PacingSpec,
  // Story
  VisualMotif,
  MotifPresence,
  MotifLibrary,
  ChoiceTelegraph,
  VisualStorytellingSpec
};

export interface VisualPlan {
  sceneId: string;
  rhythmPattern: 'Standard' | 'Tension Build' | 'Intimate Exchange' | 'Action Sequence';
  shots: Array<{
    id: string;
    beatId: string; // The ID of the beat this shot illustrates
    description: string;
    
    // Story beat definition - full acting specification
    storyBeat: {
      action: string;           // What is happening
      emotion: string;          // OVERALL mood of the beat
      relationship?: string;    // Relationship dynamic if applicable
      
      // Per-character acting specs (the FULL body language treatment)
      characterActing?: CharacterActingSpec[];
      
      // Legacy: Per-character emotions (simpler, for backward compatibility)
      characterEmotions?: CharacterEmotion[];
      
      // Scene-level spatial composition
      spatialComposition?: {
        characterDistances: 'close_intimate' | 'normal_conversational' | 'distant_separated' | 'confrontational';
        emotionalDistance: 'connected' | 'neutral' | 'alienated';
        powerDynamic?: 'balanced' | 'one_dominant' | 'shifting';
      };
    };
    
    type: 'situation' | 'action' | 'reaction' | 'outcome';
    shotType: 'ELS' | 'LS' | 'MLS' | 'MS' | 'MCU' | 'CU' | 'ECU';
    cameraAngle: 'Eye-level' | 'Low' | 'High' | 'Dutch' | 'Bird\'s eye' | 'Worm\'s eye';
    horizontalAngle: 'Front-on' | 'Three-quarter' | 'Profile' | 'Over-the-shoulder';
    wallyWoodPanel: string; // The specific panel type/number used
    
    // Pose specification
    pose: PoseSpecification;
    poseDescription: string; // Human-readable pose description for prompt
    
    // Lighting specification
    lighting: LightingSpecification;
    lightingDescription: string; // Human-readable lighting for prompt
    
    // TRANSITION TO NEXT SHOT (NEW)
    transitionToNext?: TransitionSpecification;
    
    characters?: string[];
    mood: string;
    composition: string;
    focalPoint: string; // Where viewer should look first
    depthLayers: string; // Foreground/midground/background description
    
    // Set by diversity-check pipeline after image generation — lets FullStoryPipeline
    // reuse the pre-generated image rather than calling the API a second time.
    generatedImageUrl?: string;
    generatedImageData?: string;
    generatedImageMimeType?: string;
    
    // Continuity from previous shot
    continuityFromPrevious?: {
      transitionType: TransitionType;
      whatPreserved: string[]; // List of preserved elements
      whatChanged: string;     // Description of what changed
    };
    
    // LIGHTING & COLOR MOOD SPEC (NEW)
    moodSpec?: {
      // Core emotional parameters
      emotion: EmotionCore;
      intensity: EmotionIntensity;
      valence: EmotionValence;
      
      // Derived lighting
      lighting: {
        direction: 'top' | 'side_left' | 'side_right' | 'back' | 'under' | 'front' | 'ambient';
        quality: 'soft' | 'semi_soft' | 'semi_hard' | 'hard';
        keyLightTemp: 'warm' | 'neutral' | 'cool';
        fillLightTemp: 'warm' | 'neutral' | 'cool';
        contrastLevel: 'low' | 'medium' | 'high' | 'extreme';
        narrativeReason: string;
      };
      
      // Derived color
      color: {
        primaryHues: string[];
        accentHue?: string;
        saturation: 'muted' | 'normal' | 'vivid';
        valueKey: 'high_key' | 'mid_key' | 'low_key';
        povFilter: 'none' | 'nostalgic_sepia' | 'trauma_cyan' | 'hopeful_warm' | 'paranoid_green' | 'dreamlike_purple' | 'rage_red' | 'grief_blue' | 'toxic_yellow_green';
        narrativeReason: string;
      };
      
      // Comparison to previous beat
      comparedToPrevious?: {
        isCalmerOrMoreIntense: 'calmer' | 'same' | 'more_intense';
        isWarmerOrColder: 'warmer' | 'same' | 'colder';
        isSaferOrMoreDangerous: 'safer' | 'same' | 'more_dangerous';
      };
    };
    
    // Full prompt-ready lighting/color description
    lightingColorPrompt?: string;
    
    // ============================================
    // UNIFIED VISUAL STORYTELLING SPEC
    // ============================================
    
    // Complete visual storytelling specification
    visualStorytelling?: {
      // CAMERA (how we frame this image)
      camera: CameraSpec;
      
      // SPATIAL (perspective and staging)
      spatial: SpatialSpec;
      
      // TEXTURE (surface treatment)
      texture: TextureSpec;
      
      // COMPOSITION (within this image)
      clarity: ClaritySpec;
      compositionFlow: CompositionFlowSpec;
      environment?: EnvironmentSpec;
      
      // PACING (this image's role + transition to next)
      pacing: PacingSpec;
      
      // STORY INTEGRATION
      motifsPresent?: MotifPresence[];
      choiceTelegraph?: ChoiceTelegraph;
      
      // CONTINUITY FROM PREVIOUS
      continuityFromPrevious?: {
        transitionType: TransitionType;
        whatPreserved: string[];
        whatChanged: string;
        cameraSidePreserved: boolean;
        lineCrossed: boolean;
        perspectivePreserved: boolean;
        horizonPreserved: boolean;
      };
    };
  }>;
  
  // Diversity tracking
  diversityCheck: {
    lineOfActionVariety: boolean;
    weightVariety: boolean;
    angleVariety: boolean;
    poseRepetition: string[];
  };
  
  // Transition rhythm analysis (NEW)
  transitionAnalysis: {
    transitionSequence: TransitionType[]; // Sequence of transitions used
    rhythmDescription: string;            // Description of the visual rhythm
    closureLoadProgression: string;       // How closure load changes through scene
  };
}

export interface StoryboardRequest {
  sceneId: string;
  sceneName: string;
  sceneDescription: string;
  beats: Array<{
    id: string;
    text: string;
    isClimaxBeat?: boolean;
    isKeyStoryBeat?: boolean;
    characters?: string[];
    // Per-beat character classification (CRITICAL for visual composition)
    // foregroundCharacters: Characters who are the visual focus — speaking, acting, being addressed
    foregroundCharacters?: string[];
    // backgroundCharacters: Characters present in scene but not the focus of this beat
    backgroundCharacters?: string[];
    // Optional emotional hints from story layer
    emotionHint?: EmotionCore;
    intensityHint?: EmotionIntensity;
    valenceHint?: EmotionValence;
    // Authored visual contract from SceneWriter (source of truth)
    visualMoment?: string;
    primaryAction?: string;
    emotionalRead?: string;
    relationshipDynamic?: string;
    mustShowDetail?: string;
  }>;
  genre: string;
  tone: string;
  mood: string;
  
  // Optional color script for arc consistency
  colorScript?: ColorScript;
  
  // Scene context for lighting/color decisions
  sceneContext?: {
    isClimactic?: boolean;
    isResolution?: boolean;
    isFlashback?: boolean;
    isNightmare?: boolean;
    isSafeHubScene?: boolean;
    branchType?: 'dark' | 'hopeful' | 'neutral';
    timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
    weather?: 'clear' | 'overcast' | 'stormy' | 'foggy';
    settingContext?: SceneSettingContext;
  };
  
  // CACHE: scene-level images already generated by FullStoryPipeline
  // When set, FullStoryPipeline skips re-generation for these beats
  preGeneratedBeatImages?: Map<string, string>; // beatId -> imageUrl

  // Choice positions (which beats precede player choices)
  choicePositions?: {
    beatId: string;
    choiceType: 'binary' | 'multiple' | 'timed';
    options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
  }[];

  // The player choice that led to this scene (for branch scenes).
  // When present, the FIRST beat's image must visually pay off this choice.
  incomingChoiceContext?: string;
  
  // Visual motifs to track in this scene
  availableMotifs?: Array<{
    id: string;
    name: string;
    visualDescription: string;
    currentStage: string;
    triggerConditions: string[];
  }>;
  
  // Environment context
  locationInfo?: {
    locationId: string;
    locationName: string;
    basePersonality: EnvironmentPersonality;
    description: string;
    isThreshold?: boolean;
  };
  
  // Character body vocabularies (for pose consistency)
  characterBodyVocabularies?: Array<{
    characterId: string;
    characterName: string;
    basePosture: string;        // e.g., "expansive, forward-leaning, open chest"
    gestureStyle: string;       // e.g., "big sweeping arm gestures"
    characteristicPoses: string[]; // e.g., ["hands on hips", "pointing"]
    statusBehavior: string;     // How they show status
    emotionalTells: string;     // How they show emotion in body
  }>;
  
  // Character visual descriptions (for illustration prompts)
  // CRITICAL: Without these, the illustrator cannot depict characters accurately
  characterDescriptions?: Array<{
    id: string;
    name: string;
    pronouns?: string;
    gender?: string;
    height?: string;
    build?: string;
    physicalDescription: string;
    distinctiveFeatures: string[];
    typicalAttire: string;
    role: string;
    // Silhouette profile data for visual recognizability
    silhouetteHooks?: string[];     // 2-3 distinctive traits visible in outline
    shapeLanguage?: string;         // round, angular, blocky, mixed
    contrastNotes?: string;         // how character reads against backgrounds
  }>;

  // Optional persisted state for resume/idempotency in worker jobs.
  chunkedCheckpoint?: {
    contractHash?: string;
    expandedPlans?: VisualPlan[];
  };
}

export interface VisualContract {
  styleAnchor: string;
  characterAnchors: Record<string, string[]>;
  requiredPayoffs: Array<{
    beatId: string;
    immediateChoicePayoff: boolean;
    consequenceBeat: boolean;
    mustShowDetail?: string;
  }>;
  cameraRules: {
    avoidOverDutch: boolean;
    maintainContinuityBias: boolean;
  };
}

export interface StoryboardChunkedResult {
  plan: VisualPlan;
  contract: VisualContract;
  contractHash: string;
  passTelemetry: {
    plannedChunks: number;
    expandedChunks: number;
    repairedShots: number;
    auditFailures: number;
  };
}

export class StoryboardAgent extends BaseAgent {
  private artStyle?: string;
  private readonly chunkSize = 4;

  constructor(config: AgentConfig, artStyle?: string) {
    super('Storyboard Agent', config);
    this.artStyle = artStyle;
    // Rebuild system prompt now that artStyle is set — buildSystemPrompt() in super()
    // runs before artStyle is assigned, so the style instruction in getAgentSpecificPrompt() was always undefined.
    this.systemPrompt = this.buildSystemPrompt();
    // Send system prompt so the MANDATORY art style block reaches the LLM that plans shots.
    // Without this the storyboard planner has no awareness of what style it is composing for.
    this.includeSystemPrompt = true;
  }

  private buildVisualContract(input: StoryboardRequest): VisualContract {
    const characterAnchors: Record<string, string[]> = {};
    for (const c of input.characterDescriptions || []) {
      characterAnchors[c.name] = [
        ...(c.silhouetteHooks || []),
        ...(c.distinctiveFeatures || []).slice(0, 2),
      ];
    }

    const requiredPayoffs = input.beats.map((b, idx) => ({
      beatId: b.id,
      immediateChoicePayoff: Boolean(idx === 0 && input.incomingChoiceContext),
      consequenceBeat: Boolean(idx === 1 && input.incomingChoiceContext),
      mustShowDetail: b.mustShowDetail,
    }));

    return {
      styleAnchor: this.artStyle || 'default-style-lock',
      characterAnchors,
      requiredPayoffs,
      cameraRules: {
        avoidOverDutch: true,
        maintainContinuityBias: true,
      },
    };
  }

  private hashContract(contract: VisualContract): string {
    const payload = JSON.stringify(contract);
    let h = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      h ^= payload.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return `vc-${(h >>> 0).toString(16)}`;
  }

  private chunkBeats(input: StoryboardRequest): StoryboardRequest[] {
    const chunks: StoryboardRequest[] = [];
    for (let i = 0; i < input.beats.length; i += this.chunkSize) {
      const beats = input.beats.slice(i, i + this.chunkSize);
      chunks.push({ ...input, beats });
    }
    return chunks;
  }

  private async callLLMForPass(passName: string, prompt: string, retries: number, includeSystemPrompt = true): Promise<string> {
    const originalName = this.name;
    const originalIncludeSystemPrompt = this.includeSystemPrompt;
    this.name = `Storyboard Agent ${passName}`;
    this.includeSystemPrompt = includeSystemPrompt;
    try {
      return await this.callLLM([{ role: 'user', content: prompt }], retries);
    } finally {
      this.name = originalName;
      this.includeSystemPrompt = originalIncludeSystemPrompt;
    }
  }

  private buildCompactContractReference(contract: VisualContract, contractHash: string): string {
    const styleAnchor = contract.styleAnchor || 'default-style-lock';
    const characterAnchors = Object.entries(contract.characterAnchors || {})
      .slice(0, 12)
      .map(([name, anchors]) => `- ${name}: ${(anchors || []).slice(0, 3).join(', ') || 'none'}`)
      .join('\n');
    const payoffs = (contract.requiredPayoffs || [])
      .slice(0, 16)
      .map((p) => `- ${p.beatId}: immediate=${p.immediateChoicePayoff ? 'yes' : 'no'}, consequence=${p.consequenceBeat ? 'yes' : 'no'}, detail=${p.mustShowDetail || 'none'}`)
      .join('\n');
    return [
      `ContractHash:${contractHash}`,
      `StyleAnchor:${styleAnchor}`,
      'CharacterAnchors:',
      characterAnchors || '- none',
      'RequiredPayoffs:',
      payoffs || '- none',
      `CameraRules: avoidOverDutch=${contract.cameraRules?.avoidOverDutch ? 'yes' : 'no'}, maintainContinuityBias=${contract.cameraRules?.maintainContinuityBias ? 'yes' : 'no'}`,
    ].join('\n');
  }

  private buildLeanExpandPrompt(
    input: StoryboardRequest,
    chunk: StoryboardRequest,
    contractRef: string,
    chunkSkeletons: Array<{ id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }>
  ): string {
    const settingSelection = selectStyleAdaptation(this.artStyle, input.sceneContext?.settingContext);
    const beats = chunk.beats.map((b, i) => {
      const fg = b.foregroundCharacters?.length ? `; fg=[${b.foregroundCharacters.join(', ')}]` : '';
      const bg = b.backgroundCharacters?.length ? `; bg=[${b.backgroundCharacters.join(', ')}]` : '';
      const lock = (b.visualMoment || b.primaryAction || b.emotionalRead || b.relationshipDynamic || b.mustShowDetail)
        ? `; lock={visualMoment:${b.visualMoment || 'derive'}, primaryAction:${b.primaryAction || 'derive'}, emotionalRead:${b.emotionalRead || 'derive'}, relationshipDynamic:${b.relationshipDynamic || 'derive'}, mustShowDetail:${b.mustShowDetail || 'derive'}}`
        : '';
      return `${i + 1}. ${b.id}: ${b.text}${fg}${bg}${lock}`;
    }).join('\n');

    const skeletons = chunkSkeletons.map((s) =>
      `- beat:${s.beatId}; id:${s.id}; type:${s.type}; shotType:${s.shotType}; cameraAngle:${s.cameraAngle}; transitionHint:${s.transitionHint}`
    ).join('\n');

    return `You are expanding storyboard shots for one chunk.
${contractRef}
Scene:${input.sceneName}
Genre:${input.genre}; Tone:${input.tone}; Mood:${input.mood}
IncomingChoice:${input.incomingChoiceContext || 'none'}
SettingBranch:${settingSelection.branchLabel}
SettingSummary:${input.sceneContext?.settingContext?.summary || 'none'}
SettingNotes:${settingSelection.notes.join(' | ') || 'none'}

ChunkBeats:
${beats}

SkeletonHints:
${skeletons || '- none'}

Hard requirements:
- Keep character appearance/style consistent with StyleAnchor and CharacterAnchors.
- Beat 1 must visually pay off IncomingChoice when IncomingChoice is present.
- Beat 2 should show immediate consequence of Beat 1 action when IncomingChoice is present.
- Preserve each beat lock fields; do not paraphrase away locked details.
- Use character names, never generic "a man/a woman".
- At least one shot per beat in this chunk.

Return ONLY JSON matching VisualPlan shape:
{
  "sceneId": "...",
  "rhythmPattern": "Standard|Tension Build|Intimate Exchange|Action Sequence",
  "shots": [ ... ],
  "diversityCheck": { "lineOfActionVariety": true, "weightVariety": true, "angleVariety": true, "poseRepetition": [] },
  "transitionAnalysis": { "transitionSequence": [], "rhythmDescription": "...", "closureLoadProgression": "..." }
}`;
  }

  async planShotSkeletons(input: StoryboardRequest, contractHash: string): Promise<Array<{ id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }>> {
    const chunks = this.chunkBeats(input);
    const skeletons: Array<{ id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }> = [];
    for (const chunk of chunks) {
      const beatLines = chunk.beats.map((b, idx) => `${idx + 1}. ${b.id}: ${b.text}`).join('\n');
      const prompt = `Plan compact storyboard skeletons.\nContractHash:${contractHash}\nReturn JSON: {"shots":[{"id":"...","beatId":"...","type":"...","shotType":"...","cameraAngle":"...","transitionHint":"..."}]}\nBeats:\n${beatLines}`;
      const response = await this.callLLMForPass('PlanPass', prompt, 3, false);
      const parsed = this.parseJSON<{ shots: Array<{ id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }> }>(response);
      for (const s of parsed.shots || []) {
        skeletons.push({
          id: s.id || s.beatId,
          beatId: s.beatId,
          type: s.type || 'action',
          shotType: s.shotType || 'MS',
          cameraAngle: s.cameraAngle || 'Eye-level',
          transitionHint: s.transitionHint || 'subject_to_subject',
        });
      }
    }
    return skeletons;
  }

  async expandSceneShots(
    input: StoryboardRequest,
    chunk: StoryboardRequest,
    contractHash: string,
    contractRef: string,
    chunkSkeletons: Array<{ id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }>
  ): Promise<VisualPlan> {
    const prompt = this.buildLeanExpandPrompt(input, chunk, contractRef, chunkSkeletons);
    const response = await this.callLLMForPass('ExpandPass', prompt, 5, false);
    const plan = this.parseJSON<VisualPlan>(response);
    plan.sceneId = input.sceneId;
    this.enforceAuthoredBeatFidelity(plan, { ...input, beats: chunk.beats });
    for (const shot of plan.shots || []) {
      (shot as any).contractHash = contractHash;
    }
    return plan;
  }

  async auditStoryboard(input: StoryboardRequest, plan: VisualPlan, contract: VisualContract, contractHash: string): Promise<{ failedShotIds: string[]; issues: string[] }> {
    const failedShotIds: string[] = [];
    const issues: string[] = [];
    const byBeat = new Map(input.beats.map(b => [b.id, b]));
    for (const shot of plan.shots || []) {
      const beat = byBeat.get(shot.beatId);
      if (!beat) continue;
      const contractId = (shot as any).contractHash;
      if (contractId && contractId !== contractHash) {
        failedShotIds.push(shot.id);
        issues.push(`Contract hash mismatch for ${shot.id}`);
      }
      const desc = String(shot.description || '').toLowerCase();
      if (beat.mustShowDetail && !desc.includes(beat.mustShowDetail.toLowerCase().slice(0, 18))) {
        failedShotIds.push(shot.id);
        issues.push(`mustShowDetail missing on ${shot.id}`);
      }
      if (beat.id === input.beats[0]?.id && input.incomingChoiceContext && !desc.includes(input.incomingChoiceContext.toLowerCase().slice(0, 18))) {
        failedShotIds.push(shot.id);
        issues.push(`choice payoff drift on ${shot.id}`);
      }
      for (const name of Object.keys(contract.characterAnchors)) {
        if ((shot.characters || []).includes(name)) {
          const anchorNeeded = contract.characterAnchors[name][0];
          if (anchorNeeded && !desc.includes(anchorNeeded.toLowerCase().slice(0, 12))) {
            failedShotIds.push(shot.id);
            issues.push(`character anchor drift (${name}) on ${shot.id}`);
          }
        }
      }
    }
    return { failedShotIds: [...new Set(failedShotIds)], issues };
  }

  async repairShots(
    input: StoryboardRequest,
    plan: VisualPlan,
    failedShotIds: string[],
    contractHash: string,
    contractRef: string,
    skeletonsByBeat: Map<string, { id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string }>
  ): Promise<VisualPlan> {
    if (failedShotIds.length === 0) return plan;
    const beatIds = new Set((plan.shots || []).filter(s => failedShotIds.includes(s.id)).map(s => s.beatId));
    const repairInput: StoryboardRequest = {
      ...input,
      beats: input.beats.filter(b => beatIds.has(b.id)),
    };
    const repairSkeletons = repairInput.beats
      .map((b) => skeletonsByBeat.get(b.id))
      .filter((s): s is { id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string } => Boolean(s));
    const repairPlan = await this.expandSceneShots(input, repairInput, contractHash, contractRef, repairSkeletons);
    const repairedByBeat = new Map((repairPlan.shots || []).map(s => [s.beatId, s]));
    const mergedShots = (plan.shots || []).map((s) => {
      if (!failedShotIds.includes(s.id)) return s;
      const replacement = repairedByBeat.get(s.beatId);
      if (!replacement) return s;
      (replacement as any).contractHash = contractHash;
      return replacement;
    });
    return { ...plan, shots: mergedShots };
  }

  async executeChunked(input: StoryboardRequest): Promise<AgentResponse<StoryboardChunkedResult>> {
    const contract = this.buildVisualContract(input);
    const contractHash = input.chunkedCheckpoint?.contractHash || this.hashContract(contract);
    const contractRef = this.buildCompactContractReference(contract, contractHash);
    try {
      const chunks = this.chunkBeats(input);
      const skeletons = await this.planShotSkeletons(input, contractHash);
      const skeletonsByBeat = new Map(skeletons.map((s) => [s.beatId, s]));
      const existingExpanded = input.chunkedCheckpoint?.expandedPlans || [];
      const expanded: VisualPlan[] = [...existingExpanded];
      for (let i = existingExpanded.length; i < chunks.length; i++) {
        const chunkSkeletons = chunks[i].beats
          .map((b) => skeletonsByBeat.get(b.id))
          .filter((s): s is { id: string; beatId: string; type: string; shotType: string; cameraAngle: string; transitionHint: string } => Boolean(s));
        expanded.push(await this.expandSceneShots(input, chunks[i], contractHash, contractRef, chunkSkeletons));
      }
      const mergedShots = expanded.flatMap(p => p.shots || []);
      const plan: VisualPlan = {
        sceneId: input.sceneId,
        rhythmPattern: expanded[0]?.rhythmPattern || 'Standard',
        shots: mergedShots,
        diversityCheck: expanded[0]?.diversityCheck || {
          lineOfActionVariety: true,
          weightVariety: true,
          angleVariety: true,
          poseRepetition: [],
        },
        transitionAnalysis: expanded[0]?.transitionAnalysis || {
          transitionSequence: [],
          rhythmDescription: 'Chunked storyboard',
          closureLoadProgression: 'n/a',
        },
      } as VisualPlan;

      const audit = await this.auditStoryboard(input, plan, contract, contractHash);
      const repaired = await this.repairShots(input, plan, audit.failedShotIds, contractHash, contractRef, skeletonsByBeat);
      return {
        success: true,
        data: {
          plan: repaired,
          contract,
          contractHash,
          passTelemetry: {
            plannedChunks: chunks.length,
            expandedChunks: chunks.length,
            repairedShots: audit.failedShotIds.length,
            auditFailures: audit.issues.length,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async execute(input: StoryboardRequest): Promise<AgentResponse<VisualPlan>> {
    let prompt = '';
    let promptBuildError = '';
    try {
      prompt = this.buildStoryboardPrompt(input);
    } catch (buildErr) {
      promptBuildError = buildErr instanceof Error ? buildErr.message : String(buildErr);
      console.error(`[StoryboardAgent] PROMPT BUILD FAILED for scene "${input.sceneName}" (${input.sceneId}): ${promptBuildError}`);
      this._writeDiagnostic(input.sceneId, 'PROMPT_BUILD_ERROR', promptBuildError, 0);
      return { success: false, error: `Prompt build failed: ${promptBuildError}` };
    }

    console.log(`[StoryboardAgent] Executing storyboard for scene "${input.sceneName}" (${input.sceneId}) with ${input.beats.length} beats. Prompt length: ${prompt.length} chars`);

    try {
      // 5 retries (6 total attempts): 1s+2s+4s+8s+16s+30s = ~61s total wait on sustained 500 outage
      const response = await this.callLLMForPass('ExpandPass', prompt, 5, true);
      console.log(`[StoryboardAgent] LLM response received for "${input.sceneName}". Length: ${response.length} chars. First 300: ${response.substring(0, 300)}`);
      console.log(`[StoryboardAgent] LLM response LAST 200 chars: ${response.substring(Math.max(0, response.length - 200))}`);
      const plan = this.parseJSON<VisualPlan>(response);
      
      // CRITICAL: Ensure sceneId and sceneName are set from the request
      // The LLM may not include these in its response
      plan.sceneId = input.sceneId;
      plan.sceneName = input.sceneName;
      this.enforceAuthoredBeatFidelity(plan, input);
      
      const shotCount = plan.shots?.length ?? 0;
      console.log(`[StoryboardAgent] Parsed plan for "${input.sceneName}": ${shotCount} shots. shots is ${plan.shots === undefined ? 'undefined' : plan.shots === null ? 'null' : `array(${plan.shots.length})`}`);
      
      // Guard: empty shots array means the LLM failed to generate a visual plan.
      // This happens when the response is truncated or the LLM misunderstands the prompt.
      // Treat it as a failure so the diagnostic write fires and fallback path handles it cleanly.
      if (shotCount === 0) {
        const emptyMsg = `Storyboard returned 0 shots for ${input.beats.length} beats. The LLM response may have been truncated or misunderstood the prompt. Response length: ${response.length} chars.`;
        console.error(`[StoryboardAgent] EMPTY SHOTS for scene "${input.sceneName}" (${input.sceneId}): ${emptyMsg}`);
        this._writeDiagnostic(input.sceneId, 'EMPTY_SHOTS', emptyMsg, prompt.length, `Response start: ${response.substring(0, 500)}\n\nResponse end: ${response.substring(Math.max(0, response.length - 500))}`);
        return { success: false, error: emptyMsg };
      }
      
      console.log(`[StoryboardAgent] SUCCESS for "${input.sceneName}": ${shotCount} shots planned`);
      return { success: true, data: plan, rawResponse: response };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack || '') : '';
      console.error(`[StoryboardAgent] FAILED for scene "${input.sceneName}" (${input.sceneId}): ${errMsg}`);
      console.error(`[StoryboardAgent] Stack: ${stack}`);
      console.error(`[StoryboardAgent] Prompt length was: ${prompt.length} chars, beats: ${input.beats.length}`);
      this._writeDiagnostic(input.sceneId, 'LLM_CALL_ERROR', errMsg, prompt.length, stack);
      return { success: false, error: errMsg };
    }
  }

  /** Writes a diagnostic JSON file to disk via the proxy so errors persist beyond browser session. */
  private _writeDiagnostic(sceneId: string, errorType: string, message: string, promptLength: number, stack?: string): void {
    if (typeof fetch === 'undefined') return;
    const payload = {
      timestamp: new Date().toISOString(),
      sceneId,
      errorType,
      message,
      promptLength,
      stack: stack || '',
    };
    const filePath = `generated-stories/_storyboard_diagnostics/${sceneId}_${Date.now()}.json`;
    fetch('http://localhost:3001/write-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, content: JSON.stringify(payload, null, 2) }),
    }).catch(() => {/* silent — diagnostic write is best-effort */});
  }

  protected getAgentSpecificPrompt(): string {
    const styleInstruction = this.artStyle 
      ? `\n### MANDATORY Art Style\nAll planned shots MUST be compatible with this art style: ${this.artStyle}\n`
      : '';

    return `
## Your Role: Storyboard Agent

You are a master of visual storytelling and cinematography, influenced by Wally Wood's 22 Panels and Scott McCloud's panel transitions. Your job is to translate a narrative scene into a sequence of compelling visual shots with DIVERSE poses AND appropriate TRANSITIONS between shots.
${styleInstruction}

${CORE_VISUAL_PRINCIPLE}
${STORY_BEAT_DEFINITION}
${MOBILE_COMPOSITION_FRAMEWORK}
${SHOT_TYPE_SYSTEM}
${CAMERA_ANGLE_SYSTEM}
${WALLY_WOOD_PANELS}

## POSE SPECIFICATION (CRITICAL - PREVENTS MONOTONY)
${POSE_LINE_OF_ACTION}
${POSE_TILT_RHYTHM_TWIST}
${POSE_ASYMMETRY_RULES}
${POSE_VOCABULARY}

## PANEL TRANSITIONS (CRITICAL - CONTROLS VISUAL STORYTELLING RHYTHM)
${TRANSITION_TYPES}
${TRANSITION_SELECTION_RULES}
${TRANSITION_CONTINUITY_RULES}

## COMPOSITION & LIGHTING
${COMPOSITION_STORYTELLING}
${LIGHTING_MOOD_VOCABULARY}

## DIVERSITY RULES (MANDATORY)
${SEQUENCE_VARIETY_RULES}
${POSE_DIVERSITY_CHECKLIST}

**CRITICAL REQUIREMENTS**:
1. NO two consecutive shots may have the same lineOfAction
2. NO two consecutive shots may have the same weightDistribution
3. NO three consecutive shots may have the same cameraAngle
4. EVERY shot must specify its TRANSITION TO THE NEXT shot
5. Transition type determines what visual elements MUST be preserved vs changed

${VISUAL_BEAT_MAPPING}

## Output Format
Return a JSON object:
{
  "sceneId": "string",
  "rhythmPattern": "Standard | Tension Build | Intimate Exchange | Action Sequence",
  "shots": [
    {
      "id": "shot-id",
      "beatId": "The ID of the beat this shot illustrates",
      "storyBeat": {
        "action": "What is physically happening",
        "emotion": "The OVERALL mood/emotion of the beat",
        "relationship": "The relationship dynamic if applicable",
        "characterEmotions": [
          {
            "characterName": "Character A",
            "emotion": "Their specific emotion (may differ from others!)",
            "intensity": "subtle | moderate | intense",
            "eyebrows": "RAISED/FURROWED/FLAT/etc (attitude)",
            "eyelids": "WIDE/NARROWED/HALF-LIDDED/etc (intensity)",
            "mouth": "OPEN/CLOSED/CORNERS UP/etc (flavor)",
            "reason": "Why they feel this way in this moment"
          }
        ]
      },
      "description": "Visual description naming ALL characters by their actual names (NEVER 'a man', 'a woman', 'two people', 'the figure') with Line of Action and body language for each",
      "type": "situation | action | reaction | outcome",
      "shotType": "ELS | LS | MLS | MS | MCU | CU | ECU",
      "cameraAngle": "Eye-level | Low | High | Dutch | Bird's eye | Worm's eye",
      "horizontalAngle": "Front-on | Three-quarter | Profile | Over-the-shoulder",
      "wallyWoodPanel": "Specify one of the 22 panel types",
      "pose": {
        "lineOfAction": "S-curve | C-curve | diagonal | coiled",
        "weightDistribution": "left | right | centered | forward | backward | off-balance",
        "armPosition": "gesture-high | gesture-mid | gesture-low | crossed | at-sides | reaching | defensive | relaxed",
        "torsoTwist": "twisted-left | twisted-right | square | leaning",
        "emotionalQuality": "expanded | contracted | neutral | dynamic"
      },
      "poseDescription": "Full pose description for prompt",
      "lighting": {
        "direction": "front | side | back | rim | top | under",
        "quality": "soft | hard | dappled | dramatic",
        "temperature": "warm | cool | mixed | neutral",
        "contrast": "high | medium | low"
      },
      "lightingDescription": "Full lighting description for prompt",
      "transitionToNext": {
        "type": "moment_to_moment | action_to_action | subject_to_subject | scene_to_scene | aspect_to_aspect | non_sequitur",
        "closureLoad": "very_low | moderate | high | very_high",
        "preserveCamera": true/false,
        "preserveEnvironment": true/false,
        "preserveCharacterPosition": true/false,
        "preserveLighting": true/false,
        "preservePalette": true/false,
        "changeDescription": "What specifically changes in the next shot",
        "continuityThread": "For scene_to_scene/non_sequitur: what visual element links them"
      },
      "continuityFromPrevious": {
        "transitionType": "The transition type that LED to this shot",
        "whatPreserved": ["List of visual elements preserved from previous shot"],
        "whatChanged": "Description of what changed from previous shot"
      },
      "composition": "Rule of thirds placement with specific focal point",
      "focalPoint": "Where the viewer's eye should go first",
      "depthLayers": "Describe foreground, midground, background elements",
      "mood": "string",
      "moodSpec": {
        "emotion": "hopeful|tense|sad|angry|mysterious|etc (from story beat)",
        "intensity": "low|medium|high|peak",
        "valence": "positive|negative|ambiguous|mixed_positive|mixed_negative",
        "lighting": {
          "direction": "top|side_left|side_right|back|under|front|ambient",
          "quality": "soft|semi_soft|semi_hard|hard",
          "keyLightTemp": "warm|neutral|cool",
          "fillLightTemp": "warm|neutral|cool",
          "contrastLevel": "low|medium|high|extreme",
          "narrativeReason": "Why this lighting for this beat"
        },
        "color": {
          "primaryHues": ["hue1", "hue2"],
          "saturation": "muted|normal|vivid",
          "valueKey": "high_key|mid_key|low_key",
          "povFilter": "none|nostalgic_sepia|trauma_cyan|hopeful_warm|etc",
          "narrativeReason": "Why this palette for this beat"
        },
        "comparedToPrevious": {
          "isCalmerOrMoreIntense": "calmer|same|more_intense",
          "isWarmerOrColder": "warmer|same|colder",
          "isSaferOrMoreDangerous": "safer|same|more_dangerous"
        }
      },
      "lightingColorPrompt": "Full lighting/color prompt fragment for image generation",
      
      "visualStorytelling": {
        "camera": {
          "shotType": "establish|wide|medium|closeup|extreme_closeup (medium is DEFAULT)",
          "compositionType": "single|two_shot|group|empty",
          "pov": "neutral|player_ots|npc_ots|subjective",
          "height": "high|eye|low (use to encode power)",
          "tilt": "straight|dutch_light|dutch_strong (dutch is RARE)",
          "side": "left_of_axis|right_of_axis (MAINTAIN within scene)",
          "lineCross": false,
          "lineCrossReason": "REQUIRED if lineCross is true (power shift, revelation, etc.)",
          "changeLevel": "static|moderate|aggressive"
        },
        "spatial": {
          "perspectiveType": "one_point|two_point|three_point|implied (two_point is DEFAULT)",
          "vanishingPointPlacement": "behind_subject|offset|centered",
          "depthLayers": 2 or 3,
          "foregroundElement": "doorframe, railing, shoulder, etc. (helps depth)",
          "midgroundContent": "main characters and action (REQUIRED)",
          "backgroundContent": "environment context",
          "stagingPattern": "linear|triangle|cluster|isolated|scattered|diagonal",
          "characterDistance": "intimate|neutral|distant",
          "characterOrientation": "facing_each_other|facing_away|facing_same_direction|mixed",
          "maintainPerspectiveFromPrevious": true,
          "maintainHorizonFromPrevious": true,
          "perspectiveChangeReason": "REQUIRED if changing perspective within scene"
        },
        "silhouette": {
          "poseGoal": "Description of how pose should read as black fill",
          "negativeSpaceFocus": ["between arms and body", "between characters if group"],
          "hooksToEmphasize": ["character hooks from reference - cape, weapon, hair, etc."],
          "avoidMerging": ["arm with torso", "weapon with body", "characters with each other"],
          "maintainCharacterSeparation": true/false (true for groups)
        },
        "impact": {
          "punchAction": "The key gesture/action of this beat (REQUIRED for action/climax)",
          "punchOwner": "Character performing the action",
          "punchTarget": "character|camera|object|environment",
          "targetDetail": "Specific target if applicable",
          "foreshorten": true/false (true for action/climax),
          "impactFocus": "What is largest/clearest shape in frame",
          "leadingLines": ["character gazes", "environmental lines", "light beams"],
          "detailPriority": "low_at_impact|uniform|high_at_impact (low_at_impact for action)",
          "compositionNotes": "Optional extra composition guidance"
        },
        "texture": {
          "focus": "minimal|characters|environment|both",
          "shapeAlignment": "follow_form (DEFAULT, almost never flat_pattern)",
          "foregroundDensity": "minimal|low|medium|high (low is DEFAULT)",
          "foregroundRoughness": "smooth|low|medium|high|rough",
          "backgroundDensity": "minimal|low|medium|high (medium is DEFAULT)",
          "backgroundRoughness": "smooth|low|medium|high|rough (tie to MOOD)",
          "scale": "coarse|normal|fine",
          "contrast": "soft|normal|strong",
          "protectFacesAndHands": true,
          "protectSilhouettes": true,
          "wearNotes": "optional - visible scratches, chipped paint, etc.",
          "materialNotes": "optional - paper-like grain, patina, etc."
        },
        "clarity": {
          "focalEvent": "The ONE thing happening",
          "focalEmotion": "The ONE feeling we want",
          "essentialContext": ["only what MUST be visible"],
          "thumbnailRead": "What should read at tiny size"
        },
        "compositionFlow": {
          "entryPoint": "top_left|left|center",
          "exitPoint": "bottom_right|to_ui|right",
          "flowElements": ["character_gaze", "gesture_direction", "light_direction"],
          "flowDescription": "How eye moves through the frame",
          "leadsToUI": true/false
        },
        "environment": {
          "basePersonality": "neutral|oppressive|protective|expansive|decaying|thriving|liminal",
          "currentPersonality": "same or modified by branch",
          "characteristics": {
            "dominantLines": "vertical|horizontal|diagonal|organic",
            "spaceFeeling": "cramped|balanced|open|vast",
            "stateOfRepair": "pristine|maintained|worn|damaged|ruined"
          },
          "characterRelation": "dwarfs|frames|matches|elevates",
          "narrativeFunction": "What story role environment plays"
        },
        "pacing": {
          "rhythmRole": "breather|build|spike|resolution|transition",
          "changeMagnitude": "micro|small|moderate|large|total",
          "informationDensity": "minimal|sparse|balanced|busy|dense",
          "timeFeel": "stretched|normal|compressed",
          "transitionToNext": {
            "type": "moment_to_moment|action_to_action|subject_to_subject|scene_to_scene|aspect_to_aspect|non_sequitur",
            "closureLoad": "very_low|moderate|high|very_high",
            "continuity": {
              "preserveCamera": true/false,
              "preserveEnvironment": true/false,
              "preserveCharacterPosition": true/false,
              "preserveLighting": true/false,
              "preservePalette": true/false
            },
            "changeDescription": "What specifically changes",
            "continuityThread": "For scene_to_scene: what connects them"
          }
        },
        "motifsPresent": [
          {
            "motifId": "motif-id",
            "currentStage": "early|mid|late_good|late_bad",
            "placement": "foreground|background|framing",
            "prominence": "subtle|noticeable|dominant"
          }
        ],
        "choiceTelegraph": {
          "isPreChoice": false,
          "isPostChoice": false,
          "choiceProximityTreatment": {
            "slowDown": true,
            "simplify": true,
            "focusOnActing": true,
            "leadToUI": true
          }
        },
        "continuityFromPrevious": {
          "transitionType": "the transition type that LED to this shot",
          "whatPreserved": ["list of preserved elements"],
          "whatChanged": "what changed",
          "cameraSidePreserved": true/false,
          "lineCrossed": false,
          "perspectivePreserved": true/false,
          "horizonPreserved": true/false
        }
      }
    }
  ],
  "diversityCheck": {
    "lineOfActionVariety": true/false,
    "weightVariety": true/false,
    "angleVariety": true/false,
    "poseRepetition": ["any patterns that repeated"]
  },
  "transitionAnalysis": {
    "transitionSequence": ["moment_to_moment", "action_to_action", ...],
    "rhythmDescription": "Description of visual rhythm: e.g., 'Tension build with slow micro-transitions culminating in action'",
    "closureLoadProgression": "e.g., 'Low → Low → Moderate → High' showing how closure demands increase"
  }
}
`;
  }

  private buildStoryboardPrompt(request: StoryboardRequest): string {
    const settingSelection = selectStyleAdaptation(this.artStyle, request.sceneContext?.settingContext);
    const beatsInfo = request.beats.map((b, i) => {
      // If we have a color script, look up the mood spec for this beat
      const colorScriptBeat = request.colorScript?.beats?.find(csb => csb.beatId === b.id);
      const moodHint = colorScriptBeat 
        ? `\n    - PRE-PLANNED LIGHTING: direction=${colorScriptBeat.lighting?.direction || 'side'}, quality=${colorScriptBeat.lighting?.quality || 'soft'}, temp=${colorScriptBeat.lighting?.keyLightTemp || 'neutral'}, contrast=${colorScriptBeat.lighting?.contrastLevel || 'medium'}`
        : '';
      const colorHint = colorScriptBeat
        ? `\n    - PRE-PLANNED COLOR: palette=[${colorScriptBeat.color?.dominantHues?.join(', ') || 'contextual'}], saturation=${colorScriptBeat.color?.saturation || 'normal'}, valueKey=${colorScriptBeat.color?.valueKey || 'mid_key'}`
        : '';
      // Per-beat character staging (CRITICAL for correct visual composition)
      const fgChars = b.foregroundCharacters && b.foregroundCharacters.length > 0
        ? `\n    - FOREGROUND (visual focus): ${b.foregroundCharacters.join(', ')}`
        : '';
      const bgChars = b.backgroundCharacters && b.backgroundCharacters.length > 0
        ? `\n    - BACKGROUND (present but not focus): ${b.backgroundCharacters.join(', ')}`
        : '';
      const visualContract = (b.visualMoment || b.primaryAction || b.emotionalRead || b.relationshipDynamic || b.mustShowDetail)
        ? `\n    - VISUAL MOMENT (LOCKED): ${b.visualMoment || 'derive from beat text'}\n    - PRIMARY ACTION (LOCKED): ${b.primaryAction || 'derive from beat text'}\n    - EMOTIONAL READ (LOCKED): ${b.emotionalRead || 'derive from beat text'}\n    - RELATIONSHIP DYNAMIC (LOCKED): ${b.relationshipDynamic || 'derive from beat text'}\n    - MUST SHOW DETAIL (LOCKED): ${b.mustShowDetail || 'derive from beat text'}`
        : '';
      const peakTag = (b as { isClimaxBeat?: boolean; isKeyStoryBeat?: boolean }).isClimaxBeat ? ' [CLIMAX]' : (b as { isKeyStoryBeat?: boolean }).isKeyStoryBeat ? ' [KEY STORY]' : '';
      return `- Beat ${b.id} (#${i + 1})${peakTag}: ${b.text}${fgChars}${bgChars}${visualContract}${moodHint}${colorHint}`;
    }).join('\n');

    // Build character body vocabulary section
    const bodyVocabSection = request.characterBodyVocabularies && request.characterBodyVocabularies.length > 0
      ? `
## CHARACTER BODY VOCABULARIES (CRITICAL - Enforce character-specific poses)
Each character has a unique body language profile. When they appear, their poses MUST reflect their personality:

${request.characterBodyVocabularies.map(cv => `### ${cv.characterName}
- **Base Posture**: ${cv.basePosture}
- **Gesture Style**: ${cv.gestureStyle}
- **Characteristic Poses**: ${cv.characteristicPoses.join(', ')}
- **Status Behavior**: ${cv.statusBehavior}
- **Emotional Tells**: ${cv.emotionalTells}

**RULE**: When ${cv.characterName} appears, their pose MUST include elements from their vocabulary above!`).join('\n\n')}

`
      : '';

    // Build character descriptions section (CRITICAL — was previously defined but never injected into prompt!)
    // Build relative height chart for multi-character consistency
    const heightOrder = ['diminutive', 'petite', 'short', 'average height', 'tall', 'very tall', 'towering', 'imposing', 'massive', 'giant'];
    const charsWithHeight = (request.characterDescriptions || []).filter(cd => cd.height);
    const relativeHeightSection = charsWithHeight.length >= 2
      ? `
### RELATIVE HEIGHT CHART (MUST be consistently enforced)
When these characters appear together, their relative heights MUST be visually accurate:
${charsWithHeight
  .sort((a, b) => {
    const ai = heightOrder.indexOf((a.height || '').toLowerCase());
    const bi = heightOrder.indexOf((b.height || '').toLowerCase());
    return (bi === -1 ? 5 : bi) - (ai === -1 ? 5 : ai);
  })
  .map(cd => `- **${cd.name}**: ${cd.height}${cd.build ? ` / ${cd.build} build` : ''}`)
  .join('\n')}

RULE: Height differences are REAL physical differences, not camera tricks. If a "towering" character stands next to an average-height character, the towering character's head should be visibly higher. Enforce this consistently across ALL shots where these characters appear together.
`
      : '';

    const characterDescSection = request.characterDescriptions && request.characterDescriptions.length > 0
      ? `
## CHARACTERS IN THIS SCENE (CRITICAL — Only these characters should appear)
These are the ONLY characters that exist in this scene. Do NOT invent additional characters.
Each beat below specifies which characters are FOREGROUND (visual focus) vs BACKGROUND (present but not the focus).

${request.characterDescriptions.map(cd => {
  const genderLine = cd.gender ? `- **Gender**: ${cd.gender}` : '';
  const heightLine = cd.height ? `- **Height**: ${cd.height}` : '';
  const buildLine = cd.build ? `- **Build**: ${cd.build}` : '';
  const lines = [
    `### ${cd.name} (${cd.role})`,
    ...(genderLine ? [genderLine] : []),
    ...(heightLine ? [heightLine] : []),
    ...(buildLine ? [buildLine] : []),
    `- **Physical**: ${cd.physicalDescription}`,
    `- **Distinctive Features**: ${cd.distinctiveFeatures.join(', ') || 'none specified'}`,
    `- **Typical Attire**: ${cd.typicalAttire || 'contextual'}`,
  ];
  if (cd.silhouetteHooks && cd.silhouetteHooks.length > 0) {
    lines.push(`- **Silhouette Hooks** (MUST be visible): ${cd.silhouetteHooks.join(', ')}`);
  }
  if (cd.shapeLanguage) {
    lines.push(`- **Shape Language**: ${cd.shapeLanguage} (guides overall character feel)`);
  }
  if (cd.contrastNotes) {
    lines.push(`- **Contrast**: ${cd.contrastNotes}`);
  }
  return lines.join('\n');
}).join('\n\n')}
${relativeHeightSection}
**CHARACTER STAGING RULES**:
1. FOREGROUND characters are the visual focus — they should be prominent, detailed, in sharp focus
2. BACKGROUND characters are present but NOT the focus — they can be partially visible, softer focus, at the edges of frame, or seen over a foreground character's shoulder
3. Characters NOT listed for a beat should NOT appear in that beat's shot
4. A character being "in the scene" does NOT mean they must be visible in every shot — only when the beat calls for them
5. Close-up and medium shots should typically show ONLY foreground characters
6. Wide/establishing shots may show both foreground and background characters

**CHARACTER APPEARANCE CONSISTENCY (CRITICAL)**:
- ALWAYS use the EXACT physical descriptions listed above. NEVER invent or change hair color, eye color, body type, or distinctive features.
- In prompt, visualNarrative, keyGesture, and keyBodyLanguage fields, describe characters using their canonical physical attributes (e.g. if a character has "blonde hair", write "blonde hair", NOT "dark hair").
- If unsure of a detail, reference the character's Physical description above — it is the source of truth.

`
      : '';

    // Build color script enforcement section
    const colorScriptSection = request.colorScript && request.colorScript.beats?.length > 0
      ? `
## COLOR SCRIPT (MANDATORY - Use pre-planned lighting/color for visual arc consistency)
A color script has been pre-planned for this scene. For each beat, you MUST use the specified lighting and color settings rather than inventing new ones. The color script ensures visual arc consistency across the episode.

**Color Script Overview**:
- Episode mood arc: ${request.colorScript.emotionalArc || 'dynamic'}
- Branch type: ${request.colorScript.branchType || 'neutral'}

`
      : '';

    // Build motif enforcement section
    const motifSection = request.availableMotifs && request.availableMotifs.length > 0
      ? `
## VISUAL MOTIFS (TRACK AND INCLUDE)
The following visual motifs should appear throughout this scene. Include them deliberately to create visual continuity and thematic resonance:

${request.availableMotifs.map(m => `- **${m.name}**: ${m.visualDescription}
  - Current stage: ${m.currentStage}
  - Include this motif in at least 1-2 shots, evolving its presence based on narrative progression`).join('\n')}

**MOTIF RULES**:
1. At least ONE motif should appear in each scene
2. Motifs can be in foreground, background, or as framing elements
3. Track motif progression: early shots = subtle, later shots = more prominent
4. For scene_to_scene transitions, the MOTIF is often the continuity thread

`
      : '';

    const settingSection = request.sceneContext?.settingContext
      ? `
## SETTING-AWARE STYLE ADAPTATION (MANDATORY)
The scene has a resolved setting profile. Keep the same overall style identity while adapting only environment, material language, wardrobe emphasis, and atmosphere.
- **Selected Branch**: ${settingSelection.branchLabel}
- **Resolved Setting**: ${request.sceneContext.settingContext.summary}
${settingSelection.notes.map(note => `- ${note}`).join('\n')}

`
      : '';

    return `
Create a visual plan (storyboard) for the following scene with DIVERSE poses and INTENTIONAL TRANSITIONS.

## Scene Information
- **Scene**: ${request.sceneName}
- **Description**: ${request.sceneDescription}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}
- **Mood**: ${request.mood}
${request.incomingChoiceContext ? `
## CHOICE PAYOFF (CRITICAL — applies to the FIRST beat of this scene)
This scene is entered because the player chose: "${request.incomingChoiceContext}"
The FIRST beat's shot MUST visually depict the immediate consequence of this choice. The player made a specific decision and the opening image must show that decision playing out — the exact physical action, body language, and emotional consequence the player expects to see. Do NOT use a generic establishing shot for Beat 1; instead show the choice's payoff in action.
` : ''}${settingSection}${characterDescSection}${bodyVocabSection}${colorScriptSection}${motifSection}
## Beats to Illustrate
${beatsInfo}

## CRITICAL REQUIREMENTS

### 1. STORY BEAT DEFINITION (for each shot)
- Define the ACTION (what's happening physically)
- Define the EMOTION (what each character is feeling — they may differ!)
- Define the RELATIONSHIP dynamic between characters (tension, intimacy, conflict, trust, etc.)
- Define WHO is in the shot and what EACH character is doing, feeling, and how they relate to others
- **USE CHARACTER NAMES**: ALWAYS refer to characters by their actual names (e.g., "Catherine", "Heathcliff"). NEVER use generic terms like "a woman", "a man", "two young people", "the figure", "they/them" as the primary identifier. Every character in the description must be named.
- The shot description MUST describe the scene as a depiction of the beat — action + emotion + relationship — NOT as a character portrait
- If beat metadata includes LOCKED visual fields (visualMoment, primaryAction, emotionalRead, relationshipDynamic, mustShowDetail), preserve them exactly and only choose framing/camera around them.

### 1b. PER-CHARACTER EMOTIONS (CRITICAL - Characters don't all feel the same!)
For EACH character visible in the shot, define their INDIVIDUAL emotion:
- **Character A might feel**: happy (they're winning)
- **Character B might feel**: angry (they're losing)
- **Character C might feel**: confused (watching from sidelines)

For each character emotion, specify:
- emotion: what they're feeling
- intensity: subtle/moderate/intense
- THE 3 KEY LANDMARKS:
  - eyebrows: position/shape (determines ATTITUDE)
  - eyelids: openness (determines INTENSITY)
  - mouth: shape (determines FLAVOR)
- reason: WHY they feel this way

**RULE**: Unless the story explicitly calls for everyone feeling the same (group celebration, shared shock), characters should have DIFFERENT emotions appropriate to their perspective!

### 1c. EXPRESSION PACING (CRITICAL FOR EMOTIONAL IMPACT)
${EXPRESSION_PACING_RULES}

**CRITICAL PACING RULES**:
1. **RESERVE EXTREME EXPRESSIONS**: Use rage, terror, grief, pain, hollow SPARINGLY - max 1-2 per scene
2. **GRADUAL TRANSITIONS**: Don't jump from happy → grief. Show intermediate emotions.
3. **TRACK EMOTIONAL ARCS**: Each character should have believable emotional progression

**Emotional Distance Check**:
- Adjacent (OK to jump): happy ↔ pleased, sad ↔ tired, angry ↔ irritated
- Moderate (needs care): happy → neutral → sad
- Extreme (NEEDS INTERMEDIATE): happy → grief, pleased → terror

### 1d. CHARACTER DUPLICATION PREVENTION (CRITICAL)
Each named character must appear EXACTLY ONCE in any given shot. Reference images may show a character from multiple angles — those are for identity matching only, not scene population. NEVER describe the same character appearing in two different positions within one image.

### 1e. MULTI-CHARACTER COMPOSITION (CRITICAL — Prevents single-character monotony)
For EACH beat, count how many characters are involved in the action:
- **1 character**: compositionType = "single", shot type can be any
- **2 characters**: compositionType = "two_shot", shot type should be MS or wider to show both
- **3+ characters**: compositionType = "group", shot type should be MLS or wider to show all

**RULES**:
1. If the beat text mentions 2+ characters talking, fighting, or interacting, ALL of them MUST be in the shot
2. The shot description MUST describe what EACH character is doing, feeling, and how they relate to each other in the frame
3. Describe the spatial and emotional relationship between characters (facing each other, side by side, tension, intimacy, conflict, solidarity)
4. Do NOT default to "single" composition when multiple characters are present — this creates repetitive single-character portraits
5. The BEAT between characters — action, emotion, and relationship — is the subject of the image, not any individual character

### 1f. CHARACTER SCALE & SPATIAL DEPTH (CRITICAL — Enforce real heights, no symbolic distortion)
Character size in the image MUST reflect BOTH their real physical height AND their distance from the camera.

**REAL HEIGHT DIFFERENCES**: If a character is described as "towering" or "tall" and another as "petite" or "short", the taller character MUST appear taller when they are at the same depth. This is a REAL physical difference, not symbolic. Check the RELATIVE HEIGHT CHART above (if provided) and enforce it in every multi-character shot.

**NO SYMBOLIC SIZE DISTORTION**: Do NOT exaggerate or invent size differences to symbolize power or emotion.
- WRONG: Making a normal-height character smaller to show vulnerability
- WRONG: Making a normal-height character bigger to show dominance
- RIGHT: A "towering" character's head reaching above a "petite" character's head — because that's their actual physical difference
- RIGHT: Using low camera angle to make any character appear more imposing (this is camera work, not scale distortion)

**DEPTH-BASED SCALE**: Characters further from the camera appear smaller. This is perspective, not height.
- If you want one character to appear larger in frame, place them CLOSER TO THE CAMERA
- Two characters at similar depth with different heights: the taller one's head is higher, but they are at similar overall scale relative to the camera

**USE THESE FOR POWER DYNAMICS**: Body language (expansive vs. contracted), framing (center vs. edge), lighting (spotlight vs. shadow), camera angle (low = imposing, high = diminished) — NOT unrealistic scale changes.

### 2. PANEL TRANSITIONS (CRITICAL - Controls visual storytelling rhythm)
For EACH shot, you MUST specify the TRANSITION TO THE NEXT shot:

**Transition Types and When to Use**:
- **moment_to_moment**: Time slows. Use for emotional weight, before choices. PRESERVE: camera, environment, position. CHANGE: tiny detail only.
- **action_to_action**: Physical progression. Use for action sequences. PRESERVE: subject, environment. CHANGE: pose/key-frame.
- **subject_to_subject**: Different focus. Use for dialogue, reactions. PRESERVE: time, location, lighting. CHANGE: camera target.
- **scene_to_scene**: Time/space jump. Use after major choices, act breaks. CHANGE: everything. PRESERVE: character or motif thread.
- **aspect_to_aspect**: Mood wandering. Use for atmosphere. PRESERVE: time, palette, mood. CHANGE: focus detail.
- **non_sequitur**: Surreal/symbolic. Use for dreams, visions. CHANGE: everything. PRESERVE: one motif only.

**Transition Planning Rules**:
1. Consider the NEXT beat's content when choosing transition
2. Use moment_to_moment before choices to build weight
3. Use action_to_action for physical consequences
4. Use subject_to_subject to show reactions and relationships
5. Match closure load to emotional intensity

### 3. LIGHTING & COLOR AS STORY SYSTEMS (CRITICAL)
Lighting and color are NOT style choices - they encode WHERE we are in the emotional arc.

**NO GENERIC LIGHTING**: For EACH beat, answer:
- What should the player FEEL when they see this?
- Is this calmer or more intense than the previous beat?
- Is this warmer/safer or colder/more alien than before?

**LIGHTING DIRECTION AS EMOTION**:
- **Top lighting**: Neutral, realistic, "day in the world" - use for baseline/expository beats
- **Side lighting**: Drama, conflict, moral ambiguity - use for confrontations, crossroads decisions
- **Backlighting**: Mystery, tension, awe - use for reveals, departures, "you don't know the whole truth"
- **Under-lighting**: Eerie, horror, unstable - use SPARINGLY for nightmares, villain turns

**LIGHT QUALITY**:
- **Soft**: Gentle, safe, nostalgic - bonding scenes, quiet moments, safe spaces
- **Hard**: Dramatic, dangerous, urgent - conflicts, action, arguments

**COLOR TEMPERATURE**:
- **Warm (gold/orange)**: Human, intimate, safe, hopeful
- **Cool (blue/cyan)**: Sterile, lonely, eerie, clinical

**COLOR PALETTE RULES**:
- **Vivid saturation**: Peak emotion (fury, joy), heightened reality
- **Muted saturation**: Exhaustion, trauma, numbness
- **High-key (bright)**: Comfort, innocence, safety
- **Low-key (dark)**: Danger, secrecy, horror

**ARC THINKING**:
- **Start**: Often neutral/daylight, balanced palette
- **Rising tension**: Cooler, more contrast, more shadows
- **Climax**: Highest contrast, strongest complementary colors
- **Resolution**: Softer light (warm = good ending, cool/desaturated = bad)

For each shot, derive moodSpec from the story beat emotion and include lightingColorPrompt.

### 4. UNIFIED VISUAL STORYTELLING (Camera + McCloud + Eisner)

**KEY CLARIFICATION**: Each beat is ONE full-bleed edge-to-edge image.
"Transitions" refer to how story flows from one image to the next, not panels within an image.

#### CAMERA SYSTEM

**SHOT TYPES** (What we show and why)
- **establish**: Extreme wide - location/scale, characters tiny. Use for: new locations, world state consequences.
- **wide**: Full bodies + environment. Use for: action, spatial relationships, group dynamics.
- **medium**: Waist up - **THE WORKHORSE**. Use for: dialogue, most conversations. THIS IS YOUR DEFAULT.
- **closeup**: Face/shoulders - emotion intensity. **USE SPARINGLY** for peak emotional moments only.
- **extreme_closeup**: Single detail - symbolic emphasis. **MAX 0-1 per scene** - more dilutes impact.

**COMPOSITION TYPE** (CRITICAL — Must match character count in the beat)
- **single**: ONE character in frame. ONLY use when the beat genuinely features one character alone.
- **two_shot**: TWO characters in frame. REQUIRED when 2 characters are interacting in the beat.
- **group**: THREE+ characters in frame. REQUIRED when 3+ characters are present.
- **empty**: No characters — environment/object only. Use for establishing shots or detail shots.

**RULE**: Count the characters mentioned or implied in the beat text. If 2+ characters are present or interacting, compositionType MUST be two_shot or group, NOT single. ALL characters who are part of the action MUST be shown. Use a WIDER shot type if needed to fit everyone.

**CAMERA HEIGHT** (Power dynamics)
- **high** (looking down): Vulnerability, loss of power, scrutiny. Use for: defeated characters, guilt moments.
- **eye** (level): Neutral, balanced relationships. Use for: standard dialogue, unbiased presentation.
- **low** (looking up): Power, imposing, heroic OR threatening. Use for: villain intros, level-up moments.

**DUTCH TILT**
- **straight**: Normal, stable - USE THIS MOST OF THE TIME
- **dutch_light/strong**: Unease, disorientation - VERY SPARINGLY (horror, psychological break)

**180° RULE (Spatial Continuity)**
${AXIS_CONTINUITY_RULES}

${CAMERA_CHANGE_RULES}

${CONVERSATIONAL_SHOT_PATTERNS}

#### PERSPECTIVE & SPATIAL SYSTEM

**PERSPECTIVE TYPES**
- **one_point**: Single VP - corridors, confrontations, formal/stable. Keep VP behind subject for dominance.
- **two_point**: Two horizon VPs - MOST COMMON (default). Natural, cinematic, depth.
- **three_point**: Two horizon + vertical VP - epic scale, vertigo. USE SPARINGLY.
- **implied**: Loose atmospheric - dreams, abstract moments only.

**DEPTH LAYERS (Always need at least 2, ideally 3)**
- **Foreground**: Frames scene (doorframe, railing, shoulder)
- **Midground**: Main characters and action
- **Background**: Environment context
Benefits: Strong depth cue, image feels like world not flat stage.

**STAGING PATTERNS**
- **linear**: Face-to-face (confrontations)
- **triangle**: 3-point group (speaker-responder-observer)
- **cluster**: Grouped close (intimacy, unity)
- **isolated**: Character alone in space
- **diagonal**: Natural depth emphasis
- **scattered**: Chaos, aftermath, tactical

**CHARACTER DISTANCE → RELATIONSHIP**
- **intimate**: Close spacing = alliance, complicity, romance
- **neutral**: Normal conversational distance
- **distant**: Far apart = conflict, emotional distance

**CHARACTER ORIENTATION**
- **facing_each_other**: Engagement
- **facing_away**: Disagreement, withdrawal
- **facing_same_direction**: Shared goal

${SPATIAL_CONSISTENCY_RULES}

#### SILHOUETTE & IMPACT SYSTEM
${SILHOUETTE_POSE_RULES}

${IMPACT_COMPOSITION_RULES}

**SILHOUETTE SPEC PARAMETERS**
- **poseGoal**: What the pose should look like as black fill
- **negativeSpaceFocus**: Where gaps MUST exist (e.g., ["between arms and body", "between characters"])
- **hooksToEmphasize**: Character silhouette hooks to make prominent (from character reference)
- **avoidMerging**: What should NOT overlap (e.g., ["arm with torso", "weapon with body"])
- **maintainCharacterSeparation**: true for group scenes

**IMPACT SPEC PARAMETERS** (for action/climax beats)
- **punchAction**: The key gesture/action of this beat
- **punchOwner**: Who performs the focal action
- **punchTarget**: character | camera | object | environment
- **foreshorten**: true → push limb toward camera for impact
- **impactFocus**: What is the largest/clearest shape
- **leadingLines**: What points TO the impact
- **detailPriority**: low_at_impact (simplify near punch) | uniform | high_at_impact

#### TEXTURE SYSTEM
${TEXTURE_RULES}

${MATERIAL_TEXTURE_GUIDE}

**TEXTURE PARAMETERS**
- **focus**: Where texture carries interest (minimal | characters | environment | both)
- **foregroundDensity**: Character/prop texture (minimal | low | medium | high) - DEFAULT: low
- **backgroundDensity**: Environment texture (minimal | low | medium | high) - DEFAULT: medium
- **foregroundRoughness**: Character surface quality (smooth | low | medium | high | rough)
- **backgroundRoughness**: Environment surface quality - tie to MOOD
- **scale**: Texture feature size (coarse | normal | fine) - use COARSE for action/mobile
- **contrast**: Texture light/dark variation (soft | normal | strong)
- **protectFacesAndHands**: ALWAYS true - expressions must dominate
- **protectSilhouettes**: ALWAYS true - edges must read clearly

**TEXTURE → MOOD MAPPING**
- Gritty/dark path → high background roughness, visible wear, strong contrast
- Calm/safe hub → smooth surfaces, minimal density, soft contrast
- Chaotic → high roughness, high density, strong contrast (but cap foreground!)
- Nostalgic → low roughness, subtle grain, soft contrast, patina notes

${CLARITY_RULES}

${COMPOSITION_FLOW_RULES}

${ENVIRONMENT_RULES}

#### TRANSITION TYPES (Between Images)
- **moment_to_moment**: Time barely moves. Micro-changes. Use before choices. PRESERVE: camera, environment, position, lighting, **axis side**.
- **action_to_action**: Physical progression. Use for action. PRESERVE: environment, lighting, **axis side**. CHANGE: pose.
- **subject_to_subject**: Different focus, same moment. Use for dialogue/reactions. PRESERVE: environment, time, **axis side**.
- **scene_to_scene**: Time/space jump. Use after major choices. **Axis resets** - new scene axis established.
- **aspect_to_aspect**: Mood wandering. Use for atmosphere. PRESERVE: environment, palette, **axis side**.
- **non_sequitur**: Symbolic only. Use for dreams/visions. **Axis N/A** - surreal space.

#### RHYTHM ROLES
- **breather**: Pause, sparse density, micro changes, **static camera**
- **build**: Tension increasing, balanced density, moderate changes, **moderate camera**
- **spike**: Peak moment, can be minimal OR busy, large changes, **aggressive camera ok**
- **resolution**: Aftermath, sparse density, small changes, **static camera**

${CHOICE_PROXIMITY_RULES}

### 5. POSE DIVERSITY (MANDATORY)
**Line of Action Rotation** (NEVER repeat consecutively):
- Shot 1: S-curve → Shot 2: C-curve → Shot 3: diagonal → Shot 4: S-curve...

**Weight Distribution Variety**:
- Alternate: left leg, right leg, forward lean, backward lean, off-balance

**Arm Position Variety**:
- Rotate through: gesture-high, gesture-mid, gesture-low, crossed, reaching, defensive

### 4. TRANSITION CONTINUITY RULES
Based on transition type, you MUST preserve or change specific elements:

**moment_to_moment**: Camera IDENTICAL, Environment IDENTICAL, Position IDENTICAL (minor adjust), Lighting IDENTICAL
**action_to_action**: Camera follows action, Environment IDENTICAL, Character different key pose, Lighting IDENTICAL
**subject_to_subject**: Camera changes focus, Location SAME, Lighting IDENTICAL direction, Time SAME
**scene_to_scene**: Everything can change, but include continuity thread (character, motif, theme)
**aspect_to_aspect**: Time FROZEN, Palette IDENTICAL, Mood CONSISTENT, Focus wanders
**non_sequitur**: Only motif/symbol thread preserved

### 5. FULL SPECIFICATION REQUIRED
For EACH shot provide:
- storyBeat: {action, emotion, relationship}
- pose: {lineOfAction, weightDistribution, armPosition, torsoTwist, emotionalQuality}
- poseDescription: Full text description
- lighting: {direction, quality, temperature, contrast}
- lightingDescription: Full text description
- transitionToNext: {type, closureLoad, preserve flags, changeDescription, continuityThread}
- continuityFromPrevious: {transitionType, whatPreserved, whatChanged}
- focalPoint, depthLayers, composition

### 6. TRANSITION ANALYSIS
After all shots, provide:
- transitionSequence: List of all transitions in order
- rhythmDescription: Describe the visual storytelling rhythm
- closureLoadProgression: How closure demands change through scene

Return a JSON object matching the VisualPlan schema.
`;
  }

  private enforceAuthoredBeatFidelity(plan: VisualPlan, request: StoryboardRequest): void {
    const beatById = new Map(request.beats.map(b => [b.id, b]));
    for (const shot of plan.shots || []) {
      const beat = beatById.get(shot.beatId);
      if (!beat) continue;

      const hasContract = Boolean(
        beat.visualMoment ||
        beat.primaryAction ||
        beat.emotionalRead ||
        beat.relationshipDynamic ||
        beat.mustShowDetail
      );
      if (!hasContract) continue;

      if (!shot.storyBeat) {
        shot.storyBeat = {
          action: beat.primaryAction || '',
          emotion: beat.emotionalRead || '',
          relationship: beat.relationshipDynamic || '',
        };
      }

      if (beat.primaryAction && (!shot.storyBeat.action || this.isAbstractStoryboardField(shot.storyBeat.action))) {
        shot.storyBeat.action = beat.primaryAction;
      }
      if (beat.emotionalRead && (!shot.storyBeat.emotion || this.isAbstractStoryboardField(shot.storyBeat.emotion))) {
        shot.storyBeat.emotion = beat.emotionalRead;
      }
      if (beat.relationshipDynamic && (!shot.storyBeat.relationship || this.isAbstractStoryboardField(shot.storyBeat.relationship))) {
        shot.storyBeat.relationship = beat.relationshipDynamic;
      }

      const mustContain = [beat.visualMoment, beat.mustShowDetail].filter(Boolean) as string[];
      for (const token of mustContain) {
        const desc = shot.description || '';
        if (!desc.toLowerCase().includes(token.toLowerCase().slice(0, 24))) {
          shot.description = `${desc}. ${token}`.trim();
        }
      }

      if (beat.foregroundCharacters && beat.foregroundCharacters.length > 1) {
        const existing = new Set((shot.characters || []).map(c => c.toLowerCase()));
        shot.characters = [...(shot.characters || [])];
        for (const name of beat.foregroundCharacters) {
          if (!existing.has(name.toLowerCase())) {
            shot.characters.push(name);
          }
        }
      }
    }
  }

  private isAbstractStoryboardField(value?: string): boolean {
    if (!value) return true;
    const v = value.toLowerCase();
    return (
      /\btension rises\b/.test(v) ||
      /\bemotion deepens\b/.test(v) ||
      /\bdramatic\b/.test(v) ||
      /\bmood\b/.test(v)
    );
  }
}
