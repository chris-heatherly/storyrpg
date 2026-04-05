/**
 * Unified Visual Storytelling Validator
 * 
 * Combines transition continuity validation with Eisner's visual narrative principles.
 * Validates both the content of each image AND the flow between images.
 */

import { AgentConfig } from '../config';
import { IMAGE_VALIDATION_DEFAULTS } from '../../../constants/validation';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import {
  VisualStorytellingSpec,
  TransitionType,
  TransitionSpec,
  ClaritySpec,
  CompositionFlowSpec,
  EnvironmentSpec,
  PacingSpec,
  MotifPresence,
  ChoiceTelegraph,
  RhythmRole,
  // Camera types
  CameraSpec,
  ShotType,
  CameraHeight,
  CameraTilt,
  CompositionType,
  CameraPOV,
  CameraSide,
  CameraChange,
  // Texture types
  TextureSpec,
  TextureDensity,
  TextureScale,
  TextureContrast,
  TextureFocus,
  SurfaceRoughness,
  // Spatial types
  SpatialSpec,
  PerspectiveType,
  DepthLayers,
  StagingPattern,
  CharacterDistance,
  CharacterOrientation,
  // Silhouette & Impact types
  BeatSilhouetteSpec,
  ImpactSpec,
  ImpactTarget,
  DetailPriority,
  // Rules
  TRANSITION_RULES,
  COMPOSITION_FLOW_RULES,
  CLARITY_RULES,
  ENVIRONMENT_RULES,
  SILENT_STORYTELLING_RULES,
  SHOT_TYPE_GUIDE,
  CAMERA_HEIGHT_GUIDE,
  AXIS_CONTINUITY_RULES,
  CAMERA_CHANGE_RULES,
  TEXTURE_RULES,
  MATERIAL_TEXTURE_GUIDE,
  PERSPECTIVE_TYPE_GUIDE,
  STAGING_PATTERN_GUIDE,
  SPATIAL_CONSISTENCY_RULES,
  SILHOUETTE_POSE_RULES,
  IMPACT_COMPOSITION_RULES,
  // Helpers
  validateAdvancement,
  getDefaultContinuity,
  suggestShotType,
  suggestCameraHeight,
  shouldCrossLine,
  validateTextureSpec as validateTextureSpecStructure,
  generateTexturePrompt,
  validateSpatialSpec as validateSpatialSpecStructure,
  checkSpatialConsistency,
  suggestPerspectiveType,
  suggestStagingPattern,
  suggestCharacterDistance,
  validateBeatSilhouetteSpec as validateSilhouetteStructure,
  validateImpactSpec as validateImpactStructure,
  generateSilhouettePrompt,
  generateImpactPrompt
} from './VisualStorytellingSystem';

// ============================================
// VALIDATION RESULT INTERFACES
// ============================================

/**
 * Thumbnail test - can focal point be read at small size
 */
export interface ThumbnailTestResult {
  focalCharacterReadable: boolean;
  mainGestureReadable: boolean;
  emotionalToneClear: boolean;
  hasSingleFocalPoint: boolean;
  issues: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Eye flow validation
 */
export interface EyeFlowValidation {
  followsReadingConvention: boolean;
  entryPointCorrect: boolean;
  exitPointCorrect: boolean;
  flowElementsEffective: boolean;
  leadsToUIIfNeeded: boolean;
  observedFlowDescription: string;
  issues: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Silent storytelling test
 */
export interface SilentStorytellingTest {
  emotionalToneClear: boolean;
  relationshipDynamicClear: boolean;
  situationDirectionClear: boolean;
  unclearElements?: string[];
  passesTest: boolean;
}

/**
 * Transition continuity validation (between images)
 */
export interface TransitionContinuityValidation {
  transitionType: TransitionType;
  
  // Continuity checks
  cameraPreservedIfRequired: boolean;
  environmentPreservedIfRequired: boolean;
  characterPositionPreservedIfRequired: boolean;
  lightingPreservedIfRequired: boolean;
  palettePreservedIfRequired: boolean;
  
  // Thread check for scene_to_scene/non_sequitur
  continuityThreadPresent: boolean;
  observedThread?: string;
  
  // Overall
  issues: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Environment validation
 */
export interface EnvironmentValidation {
  personalityMatch: boolean;
  observedPersonality: string;
  expectedPersonality: string;
  characterRelationMatch: boolean;
  observedRelation: string;
  stateConsistent: boolean;
  issues: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Motif validation
 */
export interface MotifValidation {
  motifId: string;
  motifName: string;
  isPresent: boolean;
  stageCorrect: boolean;
  observedTreatment: string;
  expectedTreatment: string;
  prominenceCorrect: boolean;
  issues: string[];
  passesTest: boolean;
}

/**
 * Choice telegraph validation
 */
export interface ChoiceTelegraphValidation {
  hintsAppropriate: boolean;
  observedHints: string[];
  pacingSlowed: boolean;
  leadsToUI: boolean;
  consequenceSignalClear: boolean;
  observedDirection: 'positive' | 'negative' | 'ambiguous' | 'unclear';
  issues: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Story advancement check
 */
export interface AdvancementValidation {
  advances: boolean;
  advancementType: string;
  reason: string;
  isRedundant: boolean;
}

/**
 * Camera validation
 */
export interface CameraValidation {
  // Shot type appropriateness
  shotTypeAppropriate: boolean;
  observedShotType: ShotType;
  expectedShotType?: ShotType;
  shotTypeIssue?: string;
  
  // Camera angle appropriateness
  heightAppropriate: boolean;
  observedHeight: CameraHeight;
  expectedHeight?: CameraHeight;
  heightIssue?: string;
  
  // 180° rule
  axisContinuityMaintained: boolean;
  observedSide?: CameraSide;
  expectedSide?: CameraSide;
  lineCrossJustified: boolean;
  axisContinuityIssue?: string;
  
  // Overall
  issues: string[];
  warnings: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Shot variety check (across sequence)
 */
export interface ShotVarietyCheck {
  shotTypeCounts: Record<ShotType, number>;
  overusedTypes: ShotType[];
  underusedTypes: ShotType[];
  closeupOveruse: boolean; // Common mistake
  mediumShotPercentage: number;
  isVarietyGood: boolean;
  suggestions: string[];
}

/**
 * Texture validation
 */
export interface TextureValidation {
  // Silhouette clarity
  silhouettesProtected: boolean;
  silhouetteIssue?: string;
  
  // Focal point protection
  facesAndHandsProtected: boolean;
  focalPointIssue?: string;
  
  // Hierarchy check
  hierarchyCorrect: boolean; // Background > foreground texture density
  hierarchyIssue?: string;
  
  // Mood alignment
  textureMoodAligned: boolean;
  observedMood: string;
  expectedMood?: string;
  moodIssue?: string;
  
  // Form alignment
  textureFollowsForm: boolean;
  formIssue?: string;
  
  // Overall
  issues: string[];
  warnings: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Silhouette validation
 */
export interface SilhouetteValidation {
  // Black fill test
  charactersIdentifiable: boolean;
  actionReadable: boolean;
  limbsDistinct: boolean;
  
  // Negative space
  hasAdequateNegativeSpace: boolean;
  negativeSpaceIssues: string[];
  
  // Merging check
  avoidsMerging: boolean;
  mergingIssues: string[];
  
  // Hooks visible
  silhouetteHooksVisible: boolean;
  missingHooks: string[];
  
  // Group separation
  charactersSeparated: boolean;
  separationIssue?: string;
  
  // Overall
  issues: string[];
  warnings: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Impact/punch composition validation
 */
export interface ImpactValidation {
  // Punch dominance
  punchIsDominantShape: boolean;
  dominanceIssue?: string;
  
  // Foreshortening
  foreshorteningApplied: boolean;
  foreshorteningIssue?: string;
  
  // Leading lines
  leadingLinesPresent: boolean;
  leadingLinesIssue?: string;
  
  // Detail simplification
  detailSimplifiedAtImpact: boolean;
  detailIssue?: string;
  
  // Eye direction
  eyeDirectedToImpact: boolean;
  eyeFlowIssue?: string;
  
  // Overall
  issues: string[];
  warnings: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Spatial/perspective validation
 */
export interface SpatialValidation {
  // Perspective
  perspectiveTypeCorrect: boolean;
  observedPerspective: PerspectiveType;
  expectedPerspective?: PerspectiveType;
  perspectiveIssue?: string;
  
  // Depth layers
  hasAdequateDepth: boolean;
  observedDepthLayers: number;
  expectedDepthLayers?: DepthLayers;
  depthIssue?: string;
  
  // Staging
  stagingPatternCorrect: boolean;
  observedStaging: string;
  expectedStaging?: StagingPattern;
  stagingIssue?: string;
  
  // Character distance
  characterDistanceCorrect: boolean;
  observedDistance: string;
  expectedDistance?: CharacterDistance;
  distanceIssue?: string;
  
  // Vanishing point coherence
  vanishingPointsCoherent: boolean;
  geometryIssue?: string;
  
  // Horizon line
  horizonConsistent: boolean;
  horizonIssue?: string;
  
  // Flat staging check
  avoidsFlatStaging: boolean;
  flatStagingIssue?: string;
  
  // Overall
  issues: string[];
  warnings: string[];
  passesTest: boolean;
  score: number;
}

/**
 * Complete validation report
 */
export interface VisualStorytellingValidationReport {
  imageId: string;
  beatId?: string;
  
  // CAMERA VALIDATION
  cameraValidation?: CameraValidation;
  
  // SPATIAL VALIDATION
  spatialValidation?: SpatialValidation;
  
  // SILHOUETTE VALIDATION
  silhouetteValidation?: SilhouetteValidation;
  
  // IMPACT VALIDATION (for action/climax beats)
  impactValidation?: ImpactValidation;
  
  // TEXTURE VALIDATION
  textureValidation?: TextureValidation;
  
  // COMPOSITION VALIDATIONS (within image)
  thumbnailTest: ThumbnailTestResult;
  eyeFlowValidation: EyeFlowValidation;
  silentStorytellingTest: SilentStorytellingTest;
  environmentValidation?: EnvironmentValidation;
  motifValidations?: MotifValidation[];
  choiceTelegraphValidation?: ChoiceTelegraphValidation;
  
  // SEQUENCE VALIDATIONS (between images)
  transitionValidation?: TransitionContinuityValidation;
  advancementValidation: AdvancementValidation;
  
  // OVERALL
  overallScore: number;
  isAcceptable: boolean;
  
  criticalIssues: string[];
  warnings: string[];
  suggestions: string[];
  
  needsRegeneration: boolean;
  regenerationGuidance?: string;
}

/**
 * Validation request
 */
export interface VisualStorytellingValidationRequest {
  imageId: string;
  imageData: string;
  mimeType: string;
  
  // Specifications
  beatId?: string;
  spec?: Partial<VisualStorytellingSpec>;
  
  // For transition validation (requires previous image)
  previousImageData?: string;
  previousMimeType?: string;
  previousSpec?: Partial<VisualStorytellingSpec>;
  
  // For advancement check
  currentBeat?: { action: string; emotion: string };
  previousBeat?: { action: string; emotion: string };
  
  // Story context
  storyContext?: {
    characterEmotions?: Array<{ characterName: string; emotion: string }>;
    relationshipDynamic?: string;
    bodyLanguageDescribed?: boolean;
    lightingMoodAligned?: boolean;
  };
}

/**
 * Sequence validation request (multiple images at once)
 */
export interface SequenceValidationRequest {
  images: Array<{
    imageId: string;
    imageData: string;
    mimeType: string;
    spec: Partial<VisualStorytellingSpec>;
    beat: { action: string; emotion: string };
  }>;
  /** At climax/key beats, ECU cap is relaxed */
  isNarrativePeak?: boolean;
}

export interface SequenceValidationReport {
  imageReports: VisualStorytellingValidationReport[];
  
  // Sequence-level checks
  rhythmFlow: {
    description: string;
    isEffective: boolean;
    issues: string[];
  };
  transitionChain: {
    types: TransitionType[];
    flowDescription: string;
    issues: string[];
  };
  
  // Camera sequence checks
  shotVariety: ShotVarietyCheck;
  axisContinuity: {
    lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }>;
    unjustifiedCrosses: number;
    issues: string[];
  };
  
  redundantBeats: string[]; // IDs of beats that don't advance
  
  overallScore: number;
  isAcceptable: boolean;
  shotsToRegenerate: string[];
}

export class VisualStorytellingValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Visual Storytelling Validator', config);
  }

  /**
   * Validate a single image
   */
  async execute(input: VisualStorytellingValidationRequest): Promise<AgentResponse<VisualStorytellingValidationReport>> {
    console.log(`[VisualStorytellingValidator] Validating image ${input.imageId}`);

    // Build vision prompt
    const imageContent: any[] = [
      { type: 'text', text: this.buildVisionAnalysisPrompt(input) },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mimeType,
          data: input.imageData
        }
      }
    ];

    // Add previous image if validating transition
    if (input.previousImageData && input.previousMimeType && input.spec?.pacing?.transitionToNext) {
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.previousMimeType,
          data: input.previousImageData
        }
      });
    }

    const messages: AgentMessage[] = [{ role: 'user', content: imageContent }];

    try {
      const response = await this.callLLM(messages);
      const report = this.parseJSON<VisualStorytellingValidationReport>(response);
      
      report.imageId = input.imageId;
      report.beatId = input.beatId;
      
      // Run structural advancement check
      if (input.currentBeat) {
        const advancement = validateAdvancement(
          input.currentBeat,
          input.previousBeat,
          input.previousSpec?.pacing?.transitionToNext?.type
        );
        report.advancementValidation = {
          ...advancement,
          isRedundant: !advancement.advances
        };
        
        if (!advancement.advances) {
          report.criticalIssues.push('Beat appears redundant - does not advance story');
        }
      }
      
      // Determine regeneration need
      report.needsRegeneration = report.criticalIssues.length > 0 || report.overallScore < 60;
      
      if (report.needsRegeneration) {
        report.regenerationGuidance = this.buildRegenerationGuidance(report);
      }

      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Validate a sequence of images
   */
  async validateSequence(input: SequenceValidationRequest): Promise<AgentResponse<SequenceValidationReport>> {
    console.log(`[VisualStorytellingValidator] Validating sequence of ${input.images.length} images`);

    const imageReports: VisualStorytellingValidationReport[] = [];
    const redundantBeats: string[] = [];
    const transitionTypes: TransitionType[] = [];
    const shotsToRegenerate: string[] = [];

    // Validate each image
    for (let i = 0; i < input.images.length; i++) {
      const current = input.images[i];
      const previous = i > 0 ? input.images[i - 1] : undefined;

      const result = await this.execute({
        imageId: current.imageId,
        imageData: current.imageData,
        mimeType: current.mimeType,
        beatId: current.spec.beatId,
        spec: current.spec,
        previousImageData: previous?.imageData,
        previousMimeType: previous?.mimeType,
        previousSpec: previous?.spec,
        currentBeat: current.beat,
        previousBeat: previous?.beat
      });

      if (result.success && result.data) {
        imageReports.push(result.data);
        
        if (result.data.advancementValidation?.isRedundant) {
          redundantBeats.push(current.imageId);
        }
        
        if (result.data.needsRegeneration) {
          shotsToRegenerate.push(current.imageId);
        }
        
        if (previous?.spec.pacing?.transitionToNext?.type) {
          transitionTypes.push(previous.spec.pacing.transitionToNext.type);
        }
      }
    }

    // Analyze rhythm flow
    const rhythmRoles = input.images.map(img => img.spec.pacing?.rhythmRole).filter(Boolean) as RhythmRole[];
    const rhythmFlow = this.analyzeRhythmFlow(rhythmRoles);

    // Analyze transition chain
    const transitionChain = this.analyzeTransitionChain(transitionTypes);

    // Analyze shot variety (pass isNarrativePeak for relaxed ECU cap at climax)
    const shotTypes = input.images.map(img => img.spec.camera?.shotType).filter(Boolean) as ShotType[];
    const shotVariety = this.analyzeShotVariety(shotTypes, input.isNarrativePeak);

    // Analyze axis continuity
    const fullSpecs = input.images.map(img => img.spec).filter(
      (spec): spec is VisualStorytellingSpec => spec.beatId !== undefined
    );
    const axisContinuity = this.analyzeSequenceAxisContinuity(fullSpecs);

    // Calculate overall score
    const avgScore = imageReports.length > 0
      ? Math.round(imageReports.reduce((sum, r) => sum + r.overallScore, 0) / imageReports.length)
      : 0;

    return {
      success: true,
      data: {
        imageReports,
        rhythmFlow,
        transitionChain,
        shotVariety,
        axisContinuity,
        redundantBeats,
        overallScore: avgScore,
        isAcceptable: avgScore >= 70 && shotsToRegenerate.length === 0,
        shotsToRegenerate
      }
    };
  }

  /**
   * Analyze axis continuity across a sequence
   */
  private analyzeSequenceAxisContinuity(specs: VisualStorytellingSpec[]): {
    lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }>;
    unjustifiedCrosses: number;
    issues: string[];
  } {
    const lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }> = [];
    const issues: string[] = [];

    for (const spec of specs) {
      if (spec.camera?.lineCross) {
        const justified = !!spec.camera.lineCrossReason;
        lineCrosses.push({
          beatId: spec.beatId,
          reason: spec.camera.lineCrossReason,
          justified
        });
        if (!justified) {
          issues.push(`Beat ${spec.beatId}: Line crossed without justification`);
        }
      }
    }

    return {
      lineCrosses,
      unjustifiedCrosses: lineCrosses.filter(c => !c.justified).length,
      issues
    };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Visual Storytelling Validator

You validate images against unified visual storytelling principles combining:
- Cinematic camera language (shot types, angles, 180° rule)
- Texture and surface treatment
- McCloud's transition theory (how images flow from one to the next)
- Eisner's sequential art principles (composition, clarity, environment)

IMPORTANT: Each beat is ONE full-bleed edge-to-edge image, NOT panels.
"Transitions" refer to how story flows from one image to the next.

## CAMERA SYSTEM

### SHOT TYPES
- **establish**: Extreme wide - location/scale, characters tiny. Use for: new locations, world state.
- **wide**: Full bodies + environment. Use for: action, spatial relationships, group dynamics.
- **medium**: Waist up - THE WORKHORSE. Use for: dialogue, most conversations.
- **closeup**: Face/shoulders - emotion intensity. Use SPARINGLY for peak moments.
- **extreme_closeup**: Single detail - symbolic emphasis. Max 0-1 per scene.

### CAMERA HEIGHT (Power Dynamics)
- **high** (looking down): Vulnerability, loss of power, scrutiny
- **eye** (level): Neutral, balanced relationships
- **low** (looking up): Power, imposing, heroic OR threatening

### DUTCH TILT
- **straight**: Normal, stable
- **dutch_light/strong**: Unease, disorientation - USE VERY SPARINGLY

${AXIS_CONTINUITY_RULES}

## PERSPECTIVE & SPATIAL SYSTEM

### PERSPECTIVE TYPES
- **one_point**: Single VP - corridors, confrontations, formal/stable
- **two_point**: Two horizon VPs - naturalistic, MOST COMMON (default)
- **three_point**: Two horizon + vertical VP - epic scale, vertigo (USE SPARINGLY)
- **implied**: Loose atmospheric - dreams, abstract moments

### DEPTH LAYERS (Always need at least 2)
- **Foreground**: Frames scene (doorframe, shoulder, railing)
- **Midground**: Main characters and action
- **Background**: Environment context

### STAGING PATTERNS
- **linear**: Face-to-face confrontation
- **triangle**: 3-point group dynamics
- **cluster**: Grouped close (intimacy, unity)
- **isolated**: Character alone in space
- **diagonal**: Depth-emphasizing arrangement

### CHARACTER DISTANCE
- **intimate**: Close spacing = alliance, complicity
- **neutral**: Normal conversational
- **distant**: Far apart = conflict, emotional distance

${SPATIAL_CONSISTENCY_RULES}

${SILHOUETTE_POSE_RULES}

${IMPACT_COMPOSITION_RULES}

${TEXTURE_RULES}

## TEXTURE VALIDATION CHECKS

### 1. SILHOUETTE PROTECTION
- Character edges should be CLEAN, not obscured by heavy texture
- If silhouette is hard to read, texture is TOO STRONG on edges

### 2. FOCAL POINT PROTECTION
- Faces and hands should have MINIMAL texture
- Expression and gesture must dominate, not surface noise

### 3. HIERARCHY CHECK
- Background should have MORE texture than foreground
- Focal areas should have LESS texture than secondary areas

### 4. MOOD ALIGNMENT
- Gritty scenes → rough, worn textures
- Calm/safe scenes → smooth, clean surfaces
- Texture mood should match story mood

### 5. FORM ALIGNMENT
- Texture should WRAP AROUND 3D forms
- No "stickered-on" flat patterns that ignore curvature

${CLARITY_RULES}

${COMPOSITION_FLOW_RULES}

${ENVIRONMENT_RULES}

${SILENT_STORYTELLING_RULES}

## TRANSITION CONTINUITY RULES
When validating transitions between images:
- **moment_to_moment**: Camera, environment, position, lighting ALL preserved. Only micro-changes.
- **action_to_action**: Environment, lighting preserved. Position/pose changes.
- **subject_to_subject**: Environment, lighting, time preserved. Camera shifts focus.
- **scene_to_scene**: Nothing necessarily preserved. Look for continuity THREAD (character, motif).
- **aspect_to_aspect**: Environment, time preserved. Focus wanders to different detail.
- **non_sequitur**: Only symbolic connection. One motif or theme threads through.
`;
  }

  private buildVisionAnalysisPrompt(input: VisualStorytellingValidationRequest): string {
    const spec = input.spec || {};
    
    const cameraSection = spec.camera ? `
## EXPECTED CAMERA
- **Shot Type**: ${spec.camera.shotType} (${SHOT_TYPE_GUIDE[spec.camera.shotType]?.shows || ''})
- **Composition**: ${spec.camera.compositionType}
- **POV**: ${spec.camera.pov}
- **Height**: ${spec.camera.height} (${CAMERA_HEIGHT_GUIDE[spec.camera.height]?.effect || ''})
- **Tilt**: ${spec.camera.tilt}
- **Side of Axis**: ${spec.camera.side}
- **Line Cross**: ${spec.camera.lineCross ? `YES - ${spec.camera.lineCrossReason}` : 'NO'}
` : '';

    const claritySection = spec.clarity ? `
## CLARITY SPECIFICATION
- **Focal Event**: ${spec.clarity.focalEvent}
- **Focal Emotion**: ${spec.clarity.focalEmotion}
- **Essential Context**: ${spec.clarity.essentialContext?.join(', ') || 'not specified'}
- **Should Read at Thumbnail**: ${spec.clarity.thumbnailRead || 'not specified'}
` : '';

    const compositionSection = spec.compositionFlow ? `
## EXPECTED COMPOSITION FLOW
- **Entry Point**: ${spec.compositionFlow.entryPoint}
- **Exit Point**: ${spec.compositionFlow.exitPoint}
- **Flow Elements**: ${spec.compositionFlow.flowElements?.join(', ') || 'not specified'}
- **Should Lead to UI**: ${spec.compositionFlow.leadsToUI || false}
` : '';

    const environmentSection = spec.environment ? `
## EXPECTED ENVIRONMENT
- **Personality**: ${spec.environment.currentPersonality}
- **Character Relation**: ${spec.environment.characterRelation}
- **Narrative Function**: ${spec.environment.narrativeFunction || 'not specified'}
` : '';

    const spatialSection = spec.spatial ? `
## EXPECTED SPATIAL/PERSPECTIVE
- **Perspective Type**: ${spec.spatial.perspectiveType}
- **Depth Layers**: ${spec.spatial.depthLayers}
- **Staging Pattern**: ${spec.spatial.stagingPattern}
${spec.spatial.characterDistance ? `- **Character Distance**: ${spec.spatial.characterDistance}` : ''}
${spec.spatial.foregroundElement ? `- **Foreground Element**: ${spec.spatial.foregroundElement}` : ''}
- **Midground Content**: ${spec.spatial.midgroundContent}
${spec.spatial.backgroundContent ? `- **Background Content**: ${spec.spatial.backgroundContent}` : ''}
- **Maintain Perspective from Previous**: ${spec.spatial.maintainPerspectiveFromPrevious}
` : '';

    const silhouetteSection = spec.silhouette ? `
## EXPECTED SILHOUETTE
- **Pose Goal**: ${spec.silhouette.poseGoal}
- **Negative Space Focus**: ${spec.silhouette.negativeSpaceFocus?.join(', ') || 'not specified'}
- **Hooks to Emphasize**: ${spec.silhouette.hooksToEmphasize?.join(', ') || 'not specified'}
- **Avoid Merging**: ${spec.silhouette.avoidMerging?.join(', ') || 'not specified'}
- **Maintain Character Separation**: ${spec.silhouette.maintainCharacterSeparation || false}
` : '';

    const impactSection = spec.impact ? `
## EXPECTED IMPACT COMPOSITION
- **Punch Action**: ${spec.impact.punchAction}
- **Punch Owner**: ${spec.impact.punchOwner}
- **Punch Target**: ${spec.impact.punchTarget} ${spec.impact.targetDetail ? `(${spec.impact.targetDetail})` : ''}
- **Foreshorten**: ${spec.impact.foreshorten}
- **Impact Focus**: ${spec.impact.impactFocus}
- **Leading Lines**: ${spec.impact.leadingLines?.join(', ') || 'not specified'}
- **Detail Priority**: ${spec.impact.detailPriority}
` : '';

    const textureSection = spec.texture ? `
## EXPECTED TEXTURE
- **Focus**: ${spec.texture.focus}
- **Foreground Density**: ${spec.texture.foregroundDensity}
- **Background Density**: ${spec.texture.backgroundDensity}
- **Background Roughness**: ${spec.texture.backgroundRoughness}
- **Contrast**: ${spec.texture.contrast}
- **Protect Faces/Hands**: ${spec.texture.protectFacesAndHands}
- **Protect Silhouettes**: ${spec.texture.protectSilhouettes}
${spec.texture.wearNotes ? `- **Wear Notes**: ${spec.texture.wearNotes}` : ''}
${spec.texture.materialNotes ? `- **Material Notes**: ${spec.texture.materialNotes}` : ''}
` : '';

    const transitionSection = spec.pacing?.transitionToNext ? `
## TRANSITION VALIDATION (Compare to previous image)
- **Transition Type**: ${spec.pacing.transitionToNext.type}
- **Expected Continuity**: ${JSON.stringify(spec.pacing.transitionToNext.continuity)}
- **What Should Change**: ${spec.pacing.transitionToNext.changeDescription || 'not specified'}
${spec.pacing.transitionToNext.continuityThread ? `- **Continuity Thread**: ${spec.pacing.transitionToNext.continuityThread}` : ''}

A SECOND image is provided showing the PREVIOUS beat. Compare them for continuity.
` : '';

    const choiceSection = spec.choiceTelegraph ? `
## CHOICE TELEGRAPH
- **Is Pre-Choice**: ${spec.choiceTelegraph.isPreChoice}
- **Is Post-Choice**: ${spec.choiceTelegraph.isPostChoice}
${spec.choiceTelegraph.choiceProximityTreatment ? '- **Expected**: Simplified composition, leads to UI area' : ''}
` : '';

    const motifsSection = spec.motifsPresent && spec.motifsPresent.length > 0 ? `
## EXPECTED MOTIFS
${spec.motifsPresent.map(m => `- **${m.motifId}**: ${m.prominence} prominence in ${m.placement}`).join('\n')}
` : '';

    return `
Analyze this image for VISUAL STORYTELLING effectiveness.

${cameraSection}
${spatialSection}
${silhouetteSection}
${impactSection}
${textureSection}
${claritySection}
${compositionSection}
${environmentSection}
${transitionSection}
${choiceSection}
${motifsSection}

## ANALYSIS INSTRUCTIONS

### 1. CAMERA ANALYSIS
- What shot type is this? (establish/wide/medium/closeup/extreme_closeup)
- What is the camera height? (high/eye/low)
- Is there any dutch tilt?
- How many subjects? (single/two_shot/group)
- What side of the scene axis is the camera on?

### 2. SPATIAL/PERSPECTIVE ANALYSIS
- What perspective type? (one_point/two_point/three_point/implied)
- Are vanishing points coherent? (no warped geometry)
- How many depth layers visible? (foreground/midground/background)
- What staging pattern? (linear/triangle/cluster/isolated/diagonal)
- What is the character spacing? (intimate/neutral/distant)
- Is the staging flat? (characters lined up perpendicular to camera = BAD)

### 3. SILHOUETTE ANALYSIS (Black Fill Test)
- If filled solid black, can you identify WHO is who?
- Can you see the ACTION/pose clearly?
- Are LIMBS distinct from body? (not merged)
- Is there adequate NEGATIVE SPACE (gaps between arms/body, between characters)?
- Are character HOOKS visible (distinctive traits like cape, weapon, hair shape)?
- In group shots, are characters SEPARATED (not merged into single mass)?

${spec.impact ? `### 4. IMPACT COMPOSITION ANALYSIS
- Is the PUNCH (focal gesture) the largest/clearest shape?
- Is the action FORESHORTENED toward camera (if specified)?
- Do LEADING LINES point to the impact?
- Is detail SIMPLIFIED near the impact point?
- Does the eye naturally flow TO the impact?
` : ''}

### ${spec.impact ? '5' : '4'}. TEXTURE ANALYSIS
- Are character silhouettes clean and readable? (not obscured by texture)
- Are faces and hands relatively texture-free? (expression/gesture readable)
- Is there proper texture hierarchy? (background more textured than focal areas)
- Does texture follow 3D form? (not flat/stickered-on)
- Does texture mood match scene mood? (gritty vs smooth)

### ${spec.impact ? '6' : '5'}. THUMBNAIL TEST
- Can you identify the focal character at thumbnail size?
- Is the main gesture/pose readable?
- Is the emotional tone obvious?
- Is there ONE clear focal point?

### 5. EYE FLOW
- Where does your eye enter the image?
- What path does it follow?
- Where does it exit?
- Are there distractors?

### 6. SILENT STORYTELLING
- Is emotional tone clear without text?
- Is relationship dynamic visible?
- Can you tell if things are getting better or worse?

${spec.pacing?.transitionToNext ? `
### 7. TRANSITION CONTINUITY (vs previous image)
For ${spec.pacing.transitionToNext.type} transition:
- Check each continuity rule (camera, environment, position, lighting, palette)
- For scene_to_scene/non_sequitur: Is there a connecting thread?
- Check 180° rule: Is camera on same side of axis as previous?
- Check perspective/horizon consistency
` : ''}

${spec.environment ? `
### 8. ENVIRONMENT
- Does environment feel like "${spec.environment.currentPersonality}"?
- Does it ${spec.environment.characterRelation} the characters?
` : ''}

## RETURN FORMAT

Return a JSON VisualStorytellingValidationReport:
{
  "imageId": "${input.imageId}",
  ${spec.camera ? `"cameraValidation": {
    "shotTypeAppropriate": true/false,
    "observedShotType": "establish|wide|medium|closeup|extreme_closeup",
    "expectedShotType": "${spec.camera.shotType}",
    "shotTypeIssue": "issue if any",
    "heightAppropriate": true/false,
    "observedHeight": "high|eye|low",
    "expectedHeight": "${spec.camera.height}",
    "heightIssue": "issue if any",
    "axisContinuityMaintained": true/false,
    "observedSide": "left_of_axis|right_of_axis",
    "expectedSide": "${spec.camera.side}",
    "lineCrossJustified": ${spec.camera.lineCross},
    "axisContinuityIssue": "issue if any",
    "issues": [],
    "warnings": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.spatial ? `"spatialValidation": {
    "perspectiveTypeCorrect": true/false,
    "observedPerspective": "one_point|two_point|three_point|implied",
    "expectedPerspective": "${spec.spatial.perspectiveType}",
    "perspectiveIssue": "issue if wrong perspective type",
    "hasAdequateDepth": true/false,
    "observedDepthLayers": 2 or 3,
    "expectedDepthLayers": ${spec.spatial.depthLayers},
    "depthIssue": "issue if not enough depth",
    "stagingPatternCorrect": true/false,
    "observedStaging": "observed pattern description",
    "expectedStaging": "${spec.spatial.stagingPattern}",
    "stagingIssue": "issue if staging wrong",
    "characterDistanceCorrect": true/false,
    "observedDistance": "intimate|neutral|distant",
    "expectedDistance": "${spec.spatial.characterDistance || 'not specified'}",
    "distanceIssue": "issue if distance wrong",
    "vanishingPointsCoherent": true/false,
    "geometryIssue": "issue if warped/inconsistent VPs",
    "horizonConsistent": true/false,
    "horizonIssue": "issue if horizon jumps",
    "avoidsFlatStaging": true/false,
    "flatStagingIssue": "issue if everyone lined up perpendicular to camera",
    "issues": [],
    "warnings": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.silhouette ? `"silhouetteValidation": {
    "charactersIdentifiable": true/false,
    "actionReadable": true/false,
    "limbsDistinct": true/false,
    "hasAdequateNegativeSpace": true/false,
    "negativeSpaceIssues": ["list any merging issues"],
    "avoidsMerging": true/false,
    "mergingIssues": ["list what is incorrectly merged"],
    "silhouetteHooksVisible": true/false,
    "missingHooks": ["list hooks that should be visible but aren't"],
    "charactersSeparated": true/false,
    "separationIssue": "issue if characters merge in group",
    "issues": [],
    "warnings": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.impact ? `"impactValidation": {
    "punchIsDominantShape": true/false,
    "dominanceIssue": "issue if punch isn't the clearest/largest shape",
    "foreshorteningApplied": ${spec.impact.foreshorten},
    "foreshorteningIssue": "issue if foreshortening not applied when expected",
    "leadingLinesPresent": true/false,
    "leadingLinesIssue": "issue if eye isn't led to impact",
    "detailSimplifiedAtImpact": true/false,
    "detailIssue": "issue if too much detail near impact",
    "eyeDirectedToImpact": true/false,
    "eyeFlowIssue": "issue if eye doesn't naturally go to impact",
    "issues": [],
    "warnings": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.texture ? `"textureValidation": {
    "silhouettesProtected": true/false,
    "silhouetteIssue": "issue if edges are unclear",
    "facesAndHandsProtected": true/false,
    "focalPointIssue": "issue if faces/hands over-textured",
    "hierarchyCorrect": true/false,
    "hierarchyIssue": "issue if foreground more textured than background",
    "textureMoodAligned": true/false,
    "observedMood": "gritty|smooth|worn|clean|etc",
    "expectedMood": "based on spec",
    "moodIssue": "issue if texture mood wrong",
    "textureFollowsForm": true/false,
    "formIssue": "issue if texture looks flat/stickered",
    "issues": [],
    "warnings": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  "thumbnailTest": {
    "focalCharacterReadable": true/false,
    "mainGestureReadable": true/false,
    "emotionalToneClear": true/false,
    "hasSingleFocalPoint": true/false,
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },
  "eyeFlowValidation": {
    "followsReadingConvention": true/false,
    "entryPointCorrect": true/false,
    "exitPointCorrect": true/false,
    "flowElementsEffective": true/false,
    "leadsToUIIfNeeded": true/false,
    "observedFlowDescription": "how eye moves",
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },
  "silentStorytellingTest": {
    "emotionalToneClear": true/false,
    "relationshipDynamicClear": true/false,
    "situationDirectionClear": true/false,
    "unclearElements": [],
    "passesTest": true/false
  },
  ${spec.pacing?.transitionToNext ? `"transitionValidation": {
    "transitionType": "${spec.pacing.transitionToNext.type}",
    "cameraPreservedIfRequired": true/false,
    "environmentPreservedIfRequired": true/false,
    "characterPositionPreservedIfRequired": true/false,
    "lightingPreservedIfRequired": true/false,
    "palettePreservedIfRequired": true/false,
    "continuityThreadPresent": true/false,
    "observedThread": "what thread you observe",
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.environment ? `"environmentValidation": {
    "personalityMatch": true/false,
    "observedPersonality": "what you perceive",
    "expectedPersonality": "${spec.environment.currentPersonality}",
    "characterRelationMatch": true/false,
    "observedRelation": "what you perceive",
    "stateConsistent": true/false,
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${spec.choiceTelegraph ? `"choiceTelegraphValidation": {
    "hintsAppropriate": true/false,
    "observedHints": [],
    "pacingSlowed": true/false,
    "leadsToUI": true/false,
    "consequenceSignalClear": true/false,
    "observedDirection": "positive|negative|ambiguous|unclear",
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  "advancementValidation": {
    "advances": true/false,
    "advancementType": "type",
    "reason": "why it advances or doesn't",
    "isRedundant": false
  },
  "overallScore": 0-100,
  "isAcceptable": true/false,
  "criticalIssues": [],
  "warnings": [],
  "suggestions": [],
  "needsRegeneration": true/false
}
`;
  }

  private buildRegenerationGuidance(report: VisualStorytellingValidationReport): string {
    const guidance: string[] = [];

    // Thumbnail test
    if (!report.thumbnailTest.passesTest) {
      if (!report.thumbnailTest.focalCharacterReadable) {
        guidance.push('Increase focal character contrast/size');
      }
      if (!report.thumbnailTest.hasSingleFocalPoint) {
        guidance.push('Simplify to single clear focal point');
      }
    }

    // Eye flow
    if (!report.eyeFlowValidation.passesTest) {
      guidance.push(`Fix eye flow: ${report.eyeFlowValidation.issues.join(', ')}`);
    }

    // Transition
    if (report.transitionValidation && !report.transitionValidation.passesTest) {
      guidance.push(`Fix transition continuity: ${report.transitionValidation.issues.join(', ')}`);
    }

    // Environment
    if (report.environmentValidation && !report.environmentValidation.passesTest) {
      guidance.push(`Adjust environment to feel "${report.environmentValidation.expectedPersonality}"`);
    }

    // Redundancy
    if (report.advancementValidation?.isRedundant) {
      guidance.push('Add visual change to advance story');
    }

    return guidance.join('. ') || 'Regenerate with clearer visual storytelling';
  }

  private analyzeRhythmFlow(rhythmRoles: RhythmRole[]): {
    description: string;
    isEffective: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    
    // Check for variety
    const uniqueRoles = new Set(rhythmRoles);
    if (uniqueRoles.size === 1 && rhythmRoles.length > 3) {
      issues.push('Monotonous rhythm - all beats have same role');
    }
    
    // Check for appropriate build to spike
    const hasSpike = rhythmRoles.includes('spike');
    const hasBuild = rhythmRoles.includes('build');
    if (hasSpike && !hasBuild) {
      issues.push('Spike without build - consider adding tension build');
    }
    
    // Check for resolution after spike
    const spikeIndex = rhythmRoles.lastIndexOf('spike');
    if (spikeIndex >= 0 && spikeIndex === rhythmRoles.length - 1) {
      issues.push('Sequence ends on spike - consider adding resolution');
    }
    
    const description = `Rhythm pattern: ${rhythmRoles.join(' → ')}`;
    
    return {
      description,
      isEffective: issues.length === 0,
      issues
    };
  }

  private analyzeTransitionChain(transitions: TransitionType[]): {
    types: TransitionType[];
    flowDescription: string;
    issues: string[];
  } {
    const issues: string[] = [];
    
    // Check for variety
    const counts: Record<string, number> = {};
    for (const t of transitions) {
      counts[t] = (counts[t] || 0) + 1;
    }
    
    // Flag if same transition used too many times consecutively
    for (let i = 0; i < transitions.length - 2; i++) {
      if (transitions[i] === transitions[i + 1] && transitions[i + 1] === transitions[i + 2]) {
        issues.push(`Three consecutive ${transitions[i]} transitions - consider variety`);
        break;
      }
    }
    
    // Flag if non_sequitur overused
    if (counts['non_sequitur'] > 1) {
      issues.push('Multiple non_sequitur transitions may confuse viewer');
    }
    
    const flowDescription = transitions.length > 0 
      ? `Transitions: ${transitions.join(' → ')}`
      : 'No transitions specified';
    
    return {
      types: transitions,
      flowDescription,
      issues
    };
  }

  // ==========================================
  // STRUCTURAL VALIDATION (No Image Needed)
  // ==========================================

  /**
   * Validate spec structure before generation
   */
  validateSpecStructure(spec: Partial<VisualStorytellingSpec>): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Clarity
    if (!spec.clarity) {
      issues.push('Missing clarity spec');
    } else {
      if (!spec.clarity.focalEvent) issues.push('Missing focalEvent');
      if (!spec.clarity.focalEmotion) issues.push('Missing focalEmotion');
      if (!spec.clarity.thumbnailRead) warnings.push('Missing thumbnailRead');
    }

    // Composition
    if (!spec.compositionFlow) {
      warnings.push('Missing composition flow spec');
    }

    // Pacing
    if (spec.pacing) {
      // Check for pre-choice appropriateness
      if (spec.choiceTelegraph?.isPreChoice) {
        if (spec.pacing.informationDensity === 'busy' || spec.pacing.informationDensity === 'dense') {
          issues.push('Pre-choice beat should not be busy/dense');
        }
        if (spec.pacing.changeMagnitude === 'large' || spec.pacing.changeMagnitude === 'total') {
          warnings.push('Pre-choice beat should have smaller change magnitude');
        }
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  /**
   * Check transition appropriateness
   */
  validateTransitionChoice(
    transitionType: TransitionType,
    context: {
      isPreChoice?: boolean;
      isEndOfScene?: boolean;
      isActionSequence?: boolean;
    }
  ): { isAppropriate: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Pre-choice should use slow transitions
    if (context.isPreChoice && transitionType !== 'moment_to_moment' && transitionType !== 'aspect_to_aspect') {
      suggestions.push('Pre-choice beats work best with moment_to_moment or aspect_to_aspect transitions');
    }

    // End of scene should use scene_to_scene
    if (context.isEndOfScene && transitionType !== 'scene_to_scene') {
      suggestions.push('End of scene typically uses scene_to_scene transition');
    }

    // Action sequence should use action_to_action
    if (context.isActionSequence && transitionType !== 'action_to_action') {
      suggestions.push('Action sequences work best with action_to_action transitions');
    }

    return {
      isAppropriate: suggestions.length === 0,
      suggestions
    };
  }

  // ==========================================
  // CAMERA VALIDATION METHODS
  // ==========================================

  /**
   * Validate camera spec structure before generation
   */
  validateCameraSpec(camera: CameraSpec, context?: {
    isNewLocation?: boolean;
    isDialogue?: boolean;
    isActionBeat?: boolean;
    isEmotionalPeak?: boolean;
    subjectPowerLevel?: 'weak' | 'neutral' | 'powerful';
  }): { isValid: boolean; issues: string[]; suggestions: string[] } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check shot type appropriateness
    if (context?.isNewLocation && camera.shotType !== 'establish') {
      suggestions.push('New locations typically start with establish shot');
    }
    if (context?.isDialogue && camera.shotType === 'establish') {
      issues.push('Establish shot inappropriate for dialogue');
    }
    if (camera.shotType === 'extreme_closeup' && !context?.isEmotionalPeak) {
      suggestions.push('Extreme closeup usually reserved for peak symbolic moments');
    }

    // Check height vs power
    if (context?.subjectPowerLevel === 'weak' && camera.height === 'low') {
      suggestions.push('Low angle suggests power - consider high angle for weak/vulnerable subject');
    }
    if (context?.subjectPowerLevel === 'powerful' && camera.height === 'high') {
      suggestions.push('High angle diminishes power - consider low angle for powerful subject');
    }

    // Dutch tilt warnings
    if (camera.tilt === 'dutch_strong') {
      suggestions.push('Strong dutch tilt should be very rare - consider dutch_light or straight');
    }

    // Line cross must have reason
    if (camera.lineCross && !camera.lineCrossReason) {
      issues.push('Line cross specified but no reason given');
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions
    };
  }

  /**
   * Check shot type appropriateness for beat type
   */
  validateShotTypeForBeat(
    shotType: ShotType,
    beatType: 'action' | 'dialogue' | 'emotional' | 'establish' | 'symbolic'
  ): { isAppropriate: boolean; suggestion?: string } {
    const appropriateMappings: Record<string, ShotType[]> = {
      'action': ['wide', 'medium'],
      'dialogue': ['medium', 'closeup'],
      'emotional': ['closeup', 'medium'],
      'establish': ['establish', 'wide'],
      'symbolic': ['extreme_closeup', 'closeup']
    };

    const appropriate = appropriateMappings[beatType] || ['medium'];
    if (!appropriate.includes(shotType)) {
      return {
        isAppropriate: false,
        suggestion: `${beatType} beats typically use ${appropriate.join(' or ')}, not ${shotType}`
      };
    }
    return { isAppropriate: true };
  }

  /**
   * Analyze shot variety across a sequence
   * @param isNarrativePeak - At climax/key beats, ECU cap is relaxed per IMAGE_VALIDATION_DEFAULTS
   */
  analyzeShotVariety(shotTypes: ShotType[], isNarrativePeak?: boolean): ShotVarietyCheck {
    const counts: Record<ShotType, number> = {
      'establish': 0,
      'wide': 0,
      'medium': 0,
      'closeup': 0,
      'extreme_closeup': 0
    };

    for (const shot of shotTypes) {
      counts[shot]++;
    }

    const total = shotTypes.length;
    const suggestions: string[] = [];
    const overusedTypes: ShotType[] = [];
    const underusedTypes: ShotType[] = [];

    // Medium should be most common (40-60%)
    const mediumPct = total > 0 ? counts['medium'] / total : 0;
    if (mediumPct < 0.3 && total > 0) {
      suggestions.push('Medium shots underused - should be your workhorse (40-60%)');
      underusedTypes.push('medium');
    }

    // Closeup overuse check (common mistake)
    const closeupPct = total > 0 ? (counts['closeup'] + counts['extreme_closeup']) / total : 0;
    const closeupOveruse = closeupPct > 0.4;
    if (closeupOveruse) {
      suggestions.push('Too many closeups (>40%) - they lose impact. Use more medium shots.');
      overusedTypes.push('closeup');
    }

    // Extreme closeup cap: relaxed at narrative peaks
    const maxECU = isNarrativePeak ? IMAGE_VALIDATION_DEFAULTS.maxECUPerSceneAtPeak : IMAGE_VALIDATION_DEFAULTS.maxECUPerSceneStandard;
    if (counts['extreme_closeup'] > maxECU) {
      suggestions.push(`Too many extreme closeups - max ${maxECU} per scene${isNarrativePeak ? ' (at peaks)' : ''}`);
      overusedTypes.push('extreme_closeup');
    }

    return {
      shotTypeCounts: counts,
      overusedTypes,
      underusedTypes,
      closeupOveruse,
      mediumShotPercentage: Math.round(mediumPct * 100),
      isVarietyGood: overusedTypes.length === 0 && suggestions.length <= 1,
      suggestions
    };
  }

  /**
   * Check 180° rule across sequence
   */
  analyzeAxisContinuity(
    shots: Array<{ 
      beatId: string; 
      side: CameraSide; 
      lineCross: boolean; 
      lineCrossReason?: string;
      isSceneChange?: boolean;
    }>
  ): {
    lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }>;
    unjustifiedCrosses: number;
    issues: string[];
  } {
    const lineCrosses: Array<{ beatId: string; reason?: string; justified: boolean }> = [];
    const issues: string[] = [];
    let unjustifiedCrosses = 0;

    for (let i = 1; i < shots.length; i++) {
      const current = shots[i];
      const previous = shots[i - 1];

      // Scene changes reset the axis - no continuity needed
      if (current.isSceneChange) continue;

      // Check if sides differ
      if (current.side !== previous.side) {
        const justified = current.lineCross && !!current.lineCrossReason;
        lineCrosses.push({
          beatId: current.beatId,
          reason: current.lineCrossReason,
          justified
        });

        if (!justified) {
          unjustifiedCrosses++;
          issues.push(`Beat ${current.beatId}: Camera crossed 180° line without justification`);
        }
      }
    }

    return { lineCrosses, unjustifiedCrosses, issues };
  }

  // ==========================================
  // TEXTURE VALIDATION METHODS
  // ==========================================

  /**
   * Validate texture spec structure before generation
   */
  validateTextureSpec(texture: TextureSpec, context?: {
    mood?: string;
    branchType?: 'dark' | 'hopeful' | 'neutral';
    focalPriority?: 'acting' | 'environment' | 'prop';
  }): { isValid: boolean; issues: string[]; suggestions: string[] } {
    const result = validateTextureSpecStructure(texture);
    const suggestions = [...result.warnings];

    // Context-specific suggestions
    if (context?.focalPriority === 'acting' && texture.foregroundDensity !== 'minimal' && texture.foregroundDensity !== 'low') {
      suggestions.push('Acting-focused beat should have minimal/low foreground texture');
    }

    if (context?.branchType === 'dark' && texture.backgroundRoughness === 'smooth') {
      suggestions.push('Dark branch typically has rougher environment textures');
    }

    if (context?.branchType === 'hopeful' && texture.backgroundRoughness === 'rough') {
      suggestions.push('Hopeful branch typically has smoother surfaces');
    }

    return {
      isValid: result.isValid,
      issues: result.issues,
      suggestions
    };
  }

  /**
   * Check texture appropriateness for scene type
   */
  validateTextureForScene(
    texture: TextureSpec,
    sceneType: 'action' | 'dialogue' | 'emotional' | 'establish' | 'safe_hub'
  ): { isAppropriate: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Safe hub should be minimal texture
    if (sceneType === 'safe_hub') {
      if (texture.backgroundDensity === 'high' || texture.backgroundRoughness === 'rough') {
        suggestions.push('Safe hub scenes should have minimal, smooth textures');
      }
    }

    // Emotional scenes should protect acting
    if (sceneType === 'emotional') {
      if (texture.foregroundDensity !== 'minimal' && texture.foregroundDensity !== 'low') {
        suggestions.push('Emotional scenes need minimal foreground texture for expression clarity');
      }
    }

    // Action scenes need coarser texture that reads in motion
    if (sceneType === 'action') {
      if (texture.scale === 'fine') {
        suggestions.push('Action scenes work better with coarser texture that reads during movement');
      }
    }

    // Establish shots can have more environment texture
    if (sceneType === 'establish') {
      if (texture.focus === 'characters') {
        suggestions.push('Establish shots typically focus texture on environment, not characters');
      }
    }

    return {
      isAppropriate: suggestions.length === 0,
      suggestions
    };
  }

  /**
   * Check texture hierarchy (background should have more than foreground)
   */
  validateTextureHierarchy(texture: TextureSpec): {
    isCorrect: boolean;
    issue?: string;
  } {
    const densityOrder = ['minimal', 'low', 'medium', 'high'];
    const fgIndex = densityOrder.indexOf(texture.foregroundDensity);
    const bgIndex = densityOrder.indexOf(texture.backgroundDensity);

    if (fgIndex > bgIndex) {
      return {
        isCorrect: false,
        issue: `Foreground texture (${texture.foregroundDensity}) is denser than background (${texture.backgroundDensity}) - hierarchy inverted`
      };
    }

    return { isCorrect: true };
  }

  /**
   * Check texture mood alignment
   */
  validateTextureMoodAlignment(
    texture: TextureSpec,
    expectedMood: 'gritty' | 'clean' | 'chaotic' | 'calm' | 'nostalgic' | 'safe'
  ): { isAligned: boolean; issue?: string } {
    const moodExpectations: Record<string, { minRoughness: SurfaceRoughness; maxDensity?: TextureDensity }> = {
      'gritty': { minRoughness: 'high' },
      'chaotic': { minRoughness: 'medium' },
      'clean': { minRoughness: 'smooth', maxDensity: 'low' },
      'calm': { minRoughness: 'low', maxDensity: 'medium' },
      'nostalgic': { minRoughness: 'low' },
      'safe': { minRoughness: 'smooth', maxDensity: 'low' }
    };

    const roughnessOrder: SurfaceRoughness[] = ['smooth', 'low', 'medium', 'high', 'rough'];
    const densityOrder: TextureDensity[] = ['minimal', 'low', 'medium', 'high'];

    const expectation = moodExpectations[expectedMood];
    if (!expectation) return { isAligned: true };

    const actualRoughnessIndex = roughnessOrder.indexOf(texture.backgroundRoughness);
    const expectedMinRoughnessIndex = roughnessOrder.indexOf(expectation.minRoughness);

    // For gritty/chaotic, roughness should be AT LEAST the minimum
    if (expectedMood === 'gritty' || expectedMood === 'chaotic') {
      if (actualRoughnessIndex < expectedMinRoughnessIndex) {
        return {
          isAligned: false,
          issue: `${expectedMood} mood expects rougher textures (at least ${expectation.minRoughness}), got ${texture.backgroundRoughness}`
        };
      }
    }

    // For clean/calm/safe, roughness should be AT MOST the minimum
    if (expectedMood === 'clean' || expectedMood === 'calm' || expectedMood === 'safe') {
      if (actualRoughnessIndex > expectedMinRoughnessIndex) {
        return {
          isAligned: false,
          issue: `${expectedMood} mood expects smoother textures (at most ${expectation.minRoughness}), got ${texture.backgroundRoughness}`
        };
      }
    }

    // Check density cap if specified
    if (expectation.maxDensity) {
      const actualDensityIndex = densityOrder.indexOf(texture.backgroundDensity);
      const maxDensityIndex = densityOrder.indexOf(expectation.maxDensity);
      if (actualDensityIndex > maxDensityIndex) {
        return {
          isAligned: false,
          issue: `${expectedMood} mood expects lower texture density (at most ${expectation.maxDensity}), got ${texture.backgroundDensity}`
        };
      }
    }

    return { isAligned: true };
  }

  // ==========================================
  // SPATIAL VALIDATION METHODS
  // ==========================================

  /**
   * Validate spatial spec structure before generation
   */
  validateSpatialSpec(spatial: SpatialSpec, context?: {
    environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale';
    characterCount?: number;
    isConfrontation?: boolean;
  }): { isValid: boolean; issues: string[]; suggestions: string[] } {
    const result = validateSpatialSpecStructure(spatial);
    const suggestions = [...result.warnings];

    // Context-specific suggestions
    if (context?.environmentType === 'corridor' && spatial.perspectiveType !== 'one_point') {
      suggestions.push('Corridors typically use one-point perspective');
    }

    if (context?.isConfrontation && spatial.stagingPattern !== 'linear') {
      suggestions.push('Confrontations typically use linear staging');
    }

    if (context?.characterCount === 3 && spatial.stagingPattern !== 'triangle') {
      suggestions.push('Three characters work well with triangle staging');
    }

    if (spatial.perspectiveType === 'three_point' && context?.environmentType !== 'epic_scale') {
      suggestions.push('Three-point perspective is usually reserved for epic scale moments');
    }

    return {
      isValid: result.isValid,
      issues: result.issues,
      suggestions
    };
  }

  /**
   * Check perspective appropriateness for scene type
   */
  validatePerspectiveForScene(
    perspectiveType: PerspectiveType,
    sceneType: 'corridor' | 'room' | 'exterior' | 'epic' | 'abstract' | 'confrontation'
  ): { isAppropriate: boolean; suggestion?: string } {
    const appropriateMappings: Record<string, PerspectiveType[]> = {
      'corridor': ['one_point', 'two_point'],
      'room': ['two_point', 'one_point'],
      'exterior': ['two_point', 'three_point'],
      'epic': ['three_point', 'two_point'],
      'abstract': ['implied'],
      'confrontation': ['one_point', 'two_point']
    };

    const appropriate = appropriateMappings[sceneType] || ['two_point'];
    if (!appropriate.includes(perspectiveType)) {
      return {
        isAppropriate: false,
        suggestion: `${sceneType} scenes typically use ${appropriate.join(' or ')}, not ${perspectiveType}`
      };
    }
    return { isAppropriate: true };
  }

  /**
   * Check staging pattern for character count and dynamics
   */
  validateStagingPattern(
    staging: StagingPattern,
    characterCount: number,
    dynamic: 'confrontation' | 'discussion' | 'intimate' | 'chaos' | 'solo'
  ): { isAppropriate: boolean; suggestion?: string } {
    // Solo must be isolated
    if (dynamic === 'solo' && staging !== 'isolated') {
      return {
        isAppropriate: false,
        suggestion: 'Solo scenes should use isolated staging'
      };
    }

    // Confrontation should be linear
    if (dynamic === 'confrontation' && characterCount === 2 && staging !== 'linear') {
      return {
        isAppropriate: false,
        suggestion: 'Two-person confrontations work best with linear staging'
      };
    }

    // Discussion with 3 people should be triangle
    if (dynamic === 'discussion' && characterCount === 3 && staging !== 'triangle') {
      return {
        isAppropriate: false,
        suggestion: 'Three-person discussions work best with triangle staging'
      };
    }

    // Chaos should be scattered
    if (dynamic === 'chaos' && staging !== 'scattered') {
      return {
        isAppropriate: false,
        suggestion: 'Chaotic scenes work best with scattered staging'
      };
    }

    // Intimate should be cluster
    if (dynamic === 'intimate' && staging !== 'cluster' && staging !== 'diagonal') {
      return {
        isAppropriate: false,
        suggestion: 'Intimate scenes work best with cluster or close diagonal staging'
      };
    }

    return { isAppropriate: true };
  }

  /**
   * Check character distance matches relationship
   */
  validateCharacterDistance(
    distance: CharacterDistance,
    relationship: 'allies' | 'enemies' | 'strangers' | 'lovers' | 'neutral'
  ): { isAppropriate: boolean; suggestion?: string } {
    const distanceExpectations: Record<string, CharacterDistance[]> = {
      'allies': ['intimate', 'neutral'],
      'enemies': ['distant', 'neutral'],
      'strangers': ['distant', 'neutral'],
      'lovers': ['intimate'],
      'neutral': ['neutral', 'distant']
    };

    const expected = distanceExpectations[relationship] || ['neutral'];
    if (!expected.includes(distance)) {
      return {
        isAppropriate: false,
        suggestion: `${relationship} typically have ${expected.join(' or ')} spacing, not ${distance}`
      };
    }
    return { isAppropriate: true };
  }

  /**
   * Check for flat staging (characters all on same plane perpendicular to camera)
   */
  checkFlatStaging(spatial: SpatialSpec): { isFlatStaging: boolean; suggestion?: string } {
    // Linear staging with one_point perspective is at risk of flat staging
    if (spatial.stagingPattern === 'linear' && spatial.perspectiveType === 'one_point') {
      return {
        isFlatStaging: true,
        suggestion: 'Linear staging with one-point perspective risks flat staging - offset characters in depth or use 2-point'
      };
    }

    // Cluster can be flat if not careful
    if (spatial.stagingPattern === 'cluster' && spatial.depthLayers < 3) {
      return {
        isFlatStaging: true,
        suggestion: 'Cluster staging with only 2 depth layers may appear flat - add foreground/background elements'
      };
    }

    return { isFlatStaging: false };
  }

  /**
   * Check spatial consistency between beats
   */
  validateSpatialConsistency(
    current: SpatialSpec,
    previous: SpatialSpec,
    isSameScene: boolean
  ): { isConsistent: boolean; issues: string[] } {
    return checkSpatialConsistency(current, previous, isSameScene);
  }

  // ==========================================
  // SILHOUETTE VALIDATION METHODS
  // ==========================================

  /**
   * Validate silhouette spec structure before generation
   */
  validateSilhouetteSpec(silhouette: BeatSilhouetteSpec): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const result = validateSilhouetteStructure(silhouette);
    return {
      isValid: result.isValid,
      issues: result.issues,
      suggestions: result.warnings
    };
  }

  /**
   * Check if silhouette spec is appropriate for scene type
   */
  validateSilhouetteForScene(
    silhouette: BeatSilhouetteSpec,
    sceneType: 'action' | 'dialogue' | 'emotional' | 'group',
    characterCount: number
  ): { isAppropriate: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Group scenes need character separation
    if ((sceneType === 'group' || characterCount > 2) && !silhouette.maintainCharacterSeparation) {
      suggestions.push('Group scenes should have maintainCharacterSeparation = true');
    }

    // Action scenes need dynamic poses
    if (sceneType === 'action' && !silhouette.poseGoal.toLowerCase().includes('dynamic')) {
      suggestions.push('Action scenes should have dynamic pose goals');
    }

    // Check negative space for action
    if (sceneType === 'action' && silhouette.negativeSpaceFocus.length < 2) {
      suggestions.push('Action scenes benefit from more negative space focus areas');
    }

    return {
      isAppropriate: suggestions.length === 0,
      suggestions
    };
  }

  /**
   * Check for potential silhouette merging issues based on spec
   */
  checkPotentialMerging(
    silhouette: BeatSilhouetteSpec,
    hasWeapons: boolean,
    hasFlowingCostume: boolean
  ): { hasPotentialIssues: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Weapons need explicit avoidance
    if (hasWeapons && !silhouette.avoidMerging.some(a => a.toLowerCase().includes('weapon'))) {
      warnings.push('Weapons present but no weapon-body merging avoidance specified');
    }

    // Flowing costumes are usually hooks
    if (hasFlowingCostume && !silhouette.hooksToEmphasize.some(h => 
      h.toLowerCase().includes('cape') || 
      h.toLowerCase().includes('coat') || 
      h.toLowerCase().includes('flow')
    )) {
      warnings.push('Flowing costume present but not listed as a hook to emphasize');
    }

    return {
      hasPotentialIssues: warnings.length > 0,
      warnings
    };
  }

  // ==========================================
  // IMPACT VALIDATION METHODS
  // ==========================================

  /**
   * Validate impact spec structure before generation
   */
  validateImpactSpec(impact: ImpactSpec): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const result = validateImpactStructure(impact);
    return {
      isValid: result.isValid,
      issues: result.issues,
      suggestions: result.warnings
    };
  }

  /**
   * Check if impact spec is appropriate for beat type
   */
  validateImpactForBeat(
    impact: ImpactSpec,
    beatType: 'action' | 'emotional' | 'reveal' | 'dialogue' | 'climax'
  ): { isAppropriate: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Action and climax should foreshorten
    if ((beatType === 'action' || beatType === 'climax') && !impact.foreshorten) {
      suggestions.push(`${beatType} beats usually benefit from foreshortening`);
    }

    // Climax needs strong impact
    if (beatType === 'climax') {
      if (impact.detailPriority !== 'low_at_impact') {
        suggestions.push('Climax beats should have low detail at impact for maximum clarity');
      }
      if (!impact.leadingLines || impact.leadingLines.length < 2) {
        suggestions.push('Climax beats should have multiple leading lines to impact');
      }
    }

    // Dialogue shouldn't have strong impact spec usually
    if (beatType === 'dialogue' && impact.foreshorten) {
      suggestions.push('Dialogue beats rarely need foreshortening unless confrontational');
    }

    return {
      isAppropriate: suggestions.length === 0,
      suggestions
    };
  }

  /**
   * Check if impact and camera are aligned
   */
  validateImpactCameraAlignment(
    impact: ImpactSpec,
    camera: CameraSpec
  ): { isAligned: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Foreshortening needs appropriate shot type
    if (impact.foreshorten) {
      if (camera.shotType === 'establish' || camera.shotType === 'wide') {
        suggestions.push('Foreshortening is harder to achieve in establish/wide shots - consider medium or closeup');
      }
    }

    // Impact toward camera needs camera facing it
    if (impact.punchTarget === 'camera' && camera.pov === 'npc_ots') {
      suggestions.push('Impact toward camera may not work well with NPC over-the-shoulder POV');
    }

    // Low angle can enhance power of impact
    if (impact.foreshorten && camera.height === 'high') {
      suggestions.push('High angle may diminish impact power - consider eye or low angle');
    }

    return {
      isAligned: suggestions.length === 0,
      suggestions
    };
  }
}
