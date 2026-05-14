/**
 * Encounter Image Agent
 * 
 * Specializes in creating visual sequences for high-stakes encounters (combat, social confrontations, discoveries).
 * ENHANCED: Now uses the full visual storytelling system including:
 * - Impact composition (for action climaxes)
 * - Silhouette specs (for combat readability)
 * - Camera specs (for dynamic action sequences)
 * - Texture and lighting guidance
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { ImagePrompt, EncounterSequenceRequest } from '../ImageGenerator';
import { 
  CORE_VISUAL_PRINCIPLE, 
  MOBILE_COMPOSITION_FRAMEWORK, 
  SEQUENCE_VARIETY_RULES,
  VISUAL_BEAT_MAPPING
} from '../../prompts';
import {
  // Types
  CameraSpec,
  ShotType,
  CameraHeight,
  BeatSilhouetteSpec,
  ImpactSpec,
  ImpactTarget,
  DetailPriority,
  TextureSpec,
  // Rules
  SHOT_TYPE_GUIDE,
  CAMERA_HEIGHT_GUIDE,
  SILHOUETTE_POSE_RULES,
  IMPACT_COMPOSITION_RULES,
  // Helpers
  suggestBeatSilhouetteSpec,
  suggestImpactSpec,
  generateSilhouettePrompt,
  generateImpactPrompt,
  buildDefaultCameraSpec,
  suggestTextureSpec,
  buildDefaultTextureSpec,
  generateTexturePrompt
} from './VisualStorytellingSystem';
import {
  CinematicImageDescription,
  EncounterCost,
  EncounterOutcome,
  EncounterVisualContract,
  EncounterVisualState,
  CinematicCameraAngle,
  CinematicMood
} from '../../../types';
import { selectStyleAdaptation, type SceneSettingContext } from '../../utils/styleAdaptation';

export interface EncounterSequencePlan {
  encounterId: string;
  situationShot: ImagePrompt;
  outcomeSequence: ImagePrompt[];
  timing: number[]; // Time in seconds for each image
}

/**
 * Input for generating a cinematic encounter image from EncounterArchitect output
 */
export interface CinematicEncounterImageInput {
  encounterId: string;
  beatId: string;
  choiceId?: string;
  outcomeTier?: 'success' | 'complicated' | 'failure';
  encounterPhase?: 'setup' | 'rising' | 'peak' | 'resolution';
  previousOutcomeTier?: 'success' | 'complicated' | 'failure';
  cinematicDescription: CinematicImageDescription;
  visualContract?: EncounterVisualContract;
  cost?: EncounterCost;
  outcomeType?: EncounterOutcome;
  visualState?: EncounterVisualState;
  genre: string;
  artStyle?: string;
  characterReferences?: Array<{ characterId: string; referenceUrl: string }>;
  settingContext?: SceneSettingContext;
}

/**
 * Result of generating cinematic encounter images
 */
export interface CinematicEncounterImageResult {
  beatId: string;
  choiceId?: string;
  outcomeTier?: 'success' | 'complicated' | 'failure';
  imagePrompt: ImagePrompt;
  imageUrl?: string; // Filled after generation
}

/**
 * Enhanced encounter shot with visual storytelling specs
 */
export interface EncounterShotSpec {
  frameIndex: number;
  frameRole: 'setup' | 'escalation' | 'impact' | 'consequence';
  camera: CameraSpec;
  silhouette: BeatSilhouetteSpec;
  impact?: ImpactSpec;
  texture: TextureSpec;
}

/**
 * Encounter type for specialized handling
 */
export type EncounterType =
  | 'combat'
  | 'social'
  | 'romantic'
  | 'dramatic'
  | 'exploration'
  | 'puzzle'
  | 'investigation'
  | 'chase'
  | 'stealth'
  | 'mixed';

export class EncounterImageAgent extends BaseAgent {
  private artStyle?: string;

  constructor(config: AgentConfig, artStyle?: string) {
    super('Encounter Image Agent', config);
    this.artStyle = artStyle;
  }

  /**
   * Convert CinematicImageDescription to ImagePrompt
   * This is the core method for generating encounter visuals from EncounterArchitect output
   */
  cinematicDescriptionToPrompt(input: CinematicEncounterImageInput): ImagePrompt {
    const desc = input.cinematicDescription;
    const settingSelection = selectStyleAdaptation(input.artStyle || this.artStyle, input.settingContext);
    
    // Map cinematic camera angles to shot descriptions
    const cameraAngleMap: Record<CinematicCameraAngle, string> = {
      'wide_establishing': 'wide shot establishing the scene',
      'medium_action': 'medium shot capturing the action',
      'close_dramatic': 'dramatic close-up on the subject',
      'low_heroic': 'low angle heroic shot looking up',
      'high_vulnerability': 'high angle shot looking down',
      'dutch_chaos': 'dutch angle tilted shot for instability',
      'over_shoulder': 'over-the-shoulder shot',
      'reaction_shot': 'close-up reaction shot',
    };
    
    // Map cinematic moods to atmosphere descriptions
    const moodMap: Record<CinematicMood, string> = {
      'anticipation': 'tense anticipation, holding breath',
      'dynamic_action': 'explosive action, motion and energy',
      'triumphant': 'victorious, powerful, dominant',
      'desperate': 'struggling, on the back foot, danger',
      'tense_uncertainty': 'uncertain outcome, both parties straining',
      'relief': 'weight lifted, danger passed',
      'dread': 'looming threat, ominous presence',
    };
    
    // Build character descriptions (defensive: LLM may omit characterStates)
    const characterDescs = (desc.characterStates || []).map(cs => {
      return `${cs.characterId}: ${cs.pose}, ${cs.expression}, positioned ${cs.position}`;
    }).join('. ');

    const contract = input.visualContract;
    const contractLines = contract ? [
      contract.visualMoment ? `Story moment (locked): ${contract.visualMoment}` : '',
      contract.primaryAction ? `Primary action (locked): ${contract.primaryAction}` : '',
      contract.emotionalRead ? `Emotional read (locked): ${contract.emotionalRead}` : '',
      contract.relationshipDynamic ? `Relationship dynamic (locked): ${contract.relationshipDynamic}` : '',
      contract.visibleCost ? `Visible cost (locked): ${contract.visibleCost}` : '',
      contract.mustShowDetail ? `Must-show detail: ${contract.mustShowDetail}` : '',
      contract.keyExpression ? `Expression continuity: ${contract.keyExpression}` : '',
      contract.keyGesture ? `Gesture continuity: ${contract.keyGesture}` : '',
      contract.keyBodyLanguage ? `Body-language continuity: ${contract.keyBodyLanguage}` : '',
      contract.visualNarrative ? `Panel narrative: ${contract.visualNarrative}` : '',
    ].filter(Boolean).join('. ') : '';
    const costLines = input.cost ? [
      input.outcomeType === 'partialVictory' ? 'Partial victory rule: the objective is visibly achieved, but the price must be equally readable in the same frame.' : '',
      `Cost domain: ${input.cost.domain}`,
      `Cost severity: ${input.cost.severity}`,
      `Who pays: ${input.cost.whoPays}`,
      `Immediate price: ${input.cost.immediateEffect}`,
      `Visible complication: ${input.cost.visibleComplication}`,
      input.cost.lingeringEffect ? `Lingering effect: ${input.cost.lingeringEffect}` : '',
    ].filter(Boolean).join('. ') : '';
    
    // Build the prompt
    const promptParts: string[] = [
      // Camera and composition
      cameraAngleMap[desc.cameraAngle] || 'medium shot',
      desc.shotType === 'impact' ? 'capturing the moment of impact' : '',
      
      // Scene description
      desc.sceneDescription,
      contractLines,
      costLines,
      input.encounterPhase ? `Encounter phase: ${input.encounterPhase}` : '',
      input.previousOutcomeTier ? `Previous outcome continuity: ${input.previousOutcomeTier}` : '',
      
      // Subject focus
      `Focus on ${desc.focusSubject}`,
      
      // Character states
      characterDescs,
      
      // Secondary elements
      (desc.secondaryElements || []).length > 0 
        ? `with ${(desc.secondaryElements || []).join(', ')} in frame`
        : '',
      
      // Lighting and color
      desc.lightingDirection,
      desc.colorPalette,
      settingSelection.notes.join('. '),
      
      // Mood
      moodMap[desc.mood] || 'dramatic atmosphere',
      
      // Environmental changes
      desc.environmentChanges && desc.environmentChanges.length > 0
        ? `Environment shows: ${desc.environmentChanges.join(', ')}`
        : '',
      
      // Action lines
      desc.actionLines || '',
      
      // Art style
      input.artStyle || this.artStyle || '',
      input.outcomeType === 'partialVictory'
        ? 'Do not stage this as a clean triumph. Show success and sacrifice simultaneously through expression, posture, props, or relationship distance.'
        : '',
      // Explicit anti-generic directive
      'Show this as one readable storyboard panel in the same ongoing encounter, not an isolated poster or static setup portrait.',
      'Preserve continuity of characters, location, props, emotional distance, injuries or costs, cover/disguise/evidence, and lighting from the surrounding panels.',
    ];

    promptParts.push('Maintain the specified art style consistently.');

    // Clean up and join
    const prompt = promptParts
      .filter(p => p && p.trim().length > 0)
      .join('. ')
      .replace(/\.\./g, '.')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Build negative prompt based on outcome and style family
    let negativePrompt = 'triptych, diptych, collage, montage, picture-in-picture, inset panel, overlaid cutout, split-screen, comic panels, image within image, composite image, floating portrait, text overlay, caption text, title text, speech bubbles, watermarks, signatures, blurry, low quality';
    if (input.outcomeTier === 'failure') {
      negativePrompt += ', triumphant pose, victorious expression';
    } else if (input.outcomeTier === 'success') {
      negativePrompt += ', defeated pose, pain expression, stumbling';
    }
    if (input.outcomeType === 'partialVictory') {
      negativePrompt += ', clean celebration, victory pose, trophy shot, cheerful reunion, pristine unscarred aftermath, unambiguous triumph';
    }
    
    return {
      id: `${input.beatId}-${input.choiceId || 'setup'}-${input.outcomeTier || 'base'}`,
      prompt,
      negativePrompt,
      aspectRatio: '9:19.5',
      style: input.artStyle || this.artStyle,
      settingAdaptationNotes: settingSelection.notes,
      settingBranchLabel: settingSelection.branchLabel,
      settingContext: input.settingContext,
      composition: contract?.shotDescription || cameraAngleMap[desc.cameraAngle] || 'encounter image',
      cameraAngle: cameraAngleMap[desc.cameraAngle] || desc.cameraAngle,
      keyExpression: contract?.keyExpression,
      keyGesture: contract?.keyGesture,
      keyBodyLanguage: contract?.keyBodyLanguage,
      shotDescription: contract?.shotDescription,
      emotionalCore: contract?.emotionalCore || contract?.emotionalRead,
      visualNarrative: contract?.visualNarrative || contract?.visualMoment || desc.sceneDescription,
      isEncounterImage: true,
    };
  }

  /**
   * Generate prompts for all outcomes of a choice
   */
  generateChoiceOutcomePrompts(
    encounterId: string,
    beatId: string,
    choiceId: string,
    outcomes: {
      success?: CinematicImageDescription;
      complicated?: CinematicImageDescription;
      failure?: CinematicImageDescription;
    },
    visualState?: EncounterVisualState,
    genre: string = 'fantasy',
    artStyle?: string
  ): { success?: ImagePrompt; complicated?: ImagePrompt; failure?: ImagePrompt } {
    const result: { success?: ImagePrompt; complicated?: ImagePrompt; failure?: ImagePrompt } = {};
    
    if (outcomes.success) {
      result.success = this.cinematicDescriptionToPrompt({
        encounterId,
        beatId,
        choiceId,
        outcomeTier: 'success',
        cinematicDescription: outcomes.success,
        visualState,
        genre,
        artStyle: artStyle || this.artStyle,
      });
    }
    
    if (outcomes.complicated) {
      result.complicated = this.cinematicDescriptionToPrompt({
        encounterId,
        beatId,
        choiceId,
        outcomeTier: 'complicated',
        cinematicDescription: outcomes.complicated,
        visualState,
        genre,
        artStyle: artStyle || this.artStyle,
      });
    }
    
    if (outcomes.failure) {
      result.failure = this.cinematicDescriptionToPrompt({
        encounterId,
        beatId,
        choiceId,
        outcomeTier: 'failure',
        cinematicDescription: outcomes.failure,
        visualState,
        genre,
        artStyle: artStyle || this.artStyle,
      });
    }
    
    return result;
  }

  /**
   * Generate all image prompts for a branching tree encounter
   * 
   * This traverses the tree structure and generates:
   * 1. Setup images for each situation (including initial beat and embedded nextSituations)
   * 2. Outcome images for each choice showing THE ACTION RESULT
   * 
   * Returns a flat list of prompts with unique IDs for mapping back to the tree
   */
  generateTreeEncounterPrompts(
    encounterId: string,
    initialBeat: {
      id: string;
      setupText: string;
      cinematicSetup?: CinematicImageDescription;
      choices: Array<{
        id: string;
        text: string;
        outcomes: {
          success: TreeOutcome;
          complicated: TreeOutcome;
          failure: TreeOutcome;
        };
      }>;
    },
    genre: string,
    artStyle?: string,
    maxDepth: number = 3
  ): { setupPrompts: ImagePrompt[]; outcomePrompts: ImagePrompt[] } {
    const setupPrompts: ImagePrompt[] = [];
    const outcomePrompts: ImagePrompt[] = [];
    
    // Helper to traverse the tree recursively
    const traverseTree = (
      situation: {
        id: string;
        setupText: string;
        cinematicSetup?: CinematicImageDescription;
        choices: Array<{
          id: string;
          text: string;
          outcomes: {
            success: TreeOutcome;
            complicated: TreeOutcome;
            failure: TreeOutcome;
          };
        }>;
      },
      depth: number,
      pathPrefix: string
    ) => {
      if (depth > maxDepth) return;
      
      // Generate setup image for this situation
      if (situation.cinematicSetup) {
        const setupPrompt = this.cinematicDescriptionToPrompt({
          encounterId,
          beatId: situation.id,
          cinematicDescription: situation.cinematicSetup,
          genre,
          artStyle: artStyle || this.artStyle,
        });
        setupPrompt.id = `${pathPrefix}-setup`;
        setupPrompts.push(setupPrompt);
      }
      
      // Generate outcome images for each choice
      for (const choice of situation.choices) {
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) continue;
          
          // Generate THE ACTION RESULT image
          if (outcome.cinematicDescription) {
            const outcomePrompt = this.cinematicDescriptionToPrompt({
              encounterId,
              beatId: situation.id,
              choiceId: choice.id,
              outcomeTier: tier,
              cinematicDescription: outcome.cinematicDescription,
              genre,
              artStyle: artStyle || this.artStyle,
            });
            outcomePrompt.id = `${pathPrefix}-${choice.id}-${tier}-outcome`;
            outcomePrompts.push(outcomePrompt);
          }
          
          // Recurse into nextSituation if present and not terminal
          if (outcome.nextSituation && !outcome.isTerminal) {
            const nextSituation = {
              id: `${situation.id}-${choice.id}-${tier}`,
              setupText: outcome.nextSituation.setupText,
              cinematicSetup: outcome.nextSituation.cinematicSetup,
              choices: outcome.nextSituation.choices || [],
            };
            traverseTree(nextSituation, depth + 1, `${pathPrefix}-${choice.id}-${tier}`);
          }
        }
      }
    };
    
    // Start traversal from initial beat
    traverseTree(
      {
        id: initialBeat.id,
        setupText: initialBeat.setupText,
        cinematicSetup: initialBeat.cinematicSetup,
        choices: initialBeat.choices,
      },
      0,
      `${encounterId}-${initialBeat.id}`
    );
    
    console.log(`[EncounterImageAgent] Generated ${setupPrompts.length} setup prompts, ${outcomePrompts.length} outcome prompts for tree encounter`);
    
    return { setupPrompts, outcomePrompts };
  }

  async execute(input: EncounterSequenceRequest): Promise<AgentResponse<ImagePrompt[]>> {
    const prompt = this.buildEncounterSequencePrompt(input);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const prompts = this.parseJSON<ImagePrompt[]>(response);
      
      prompts.forEach(p => {
        if (!p.aspectRatio) p.aspectRatio = '9:19.5';
      });

      return { success: true, data: prompts, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generate encounter shot specs for the sequence
   */
  generateEncounterShotSpecs(
    encounterType: EncounterType,
    frameCount: number,
    characterCount: number,
    hasWeapons: boolean = false
  ): EncounterShotSpec[] {
    const specs: EncounterShotSpec[] = [];
    
    for (let i = 0; i < frameCount; i++) {
      const frameRole = this.getFrameRole(i, frameCount);
      const isImpactFrame = frameRole === 'impact';
      const isClimax = i === frameCount - 2 || frameRole === 'impact'; // Second to last or impact
      
      // Camera spec based on frame role
      const camera = this.getCameraForFrameRole(frameRole, encounterType, characterCount);
      
      // Silhouette spec - action needs clear readability
      const silhouette = suggestBeatSilhouetteSpec({
        characterCount,
        hasWeapons,
        hasFlowingCostume: false, // Could be passed in
        isActionBeat: encounterType === 'combat' || encounterType === 'chase',
        characterHooks: [] // Would come from character references
      });
      
      // Impact spec for climactic moments
      let impact: ImpactSpec | undefined;
      if (isImpactFrame || isClimax) {
        impact = suggestImpactSpec({
          beatType: 'action',
          isClimax: isImpactFrame,
          focalGesture: this.getFocalGestureForEncounter(encounterType, frameRole),
          focalCharacter: 'protagonist'
        });
      }
      
      // Texture - action scenes need clarity
      const texture = suggestTextureSpec({
        isActionSequence: encounterType === 'combat' || encounterType === 'chase',
        sceneTone: encounterType === 'combat' ? 'tense' : 'calm'
      });
      
      specs.push({
        frameIndex: i,
        frameRole,
        camera,
        silhouette,
        impact,
        texture
      });
    }
    
    return specs;
  }

  /**
   * Get frame role based on position in sequence
   */
  private getFrameRole(index: number, total: number): 'setup' | 'escalation' | 'impact' | 'consequence' {
    if (total === 1) return 'setup';
    
    const position = index / (total - 1);
    
    if (index === 0) return 'setup';
    if (position < 0.5) return 'escalation';
    if (position < 0.8) return 'impact';
    return 'consequence';
  }

  /**
   * Get camera spec for frame role
   */
  private getCameraForFrameRole(
    frameRole: 'setup' | 'escalation' | 'impact' | 'consequence',
    encounterType: EncounterType,
    characterCount: number
  ): CameraSpec {
    const isAction = encounterType === 'combat' || encounterType === 'chase';
    const isIntimate = encounterType === 'social' || encounterType === 'romantic' || encounterType === 'dramatic';
    const isDiscovery = encounterType === 'exploration' || encounterType === 'puzzle' || encounterType === 'investigation';
    
    let shotType: ShotType;
    let height: CameraHeight;
    let foreshorten = false;
    
    switch (frameRole) {
      case 'setup':
        shotType = characterCount > 2 ? 'wide' : (isIntimate ? 'closeup' : 'medium');
        height = 'eye';
        break;
      case 'escalation':
        shotType = isDiscovery ? 'closeup' : 'medium';
        height = isAction ? 'low' : isIntimate ? 'eye' : 'high';
        break;
      case 'impact':
        shotType = 'closeup';
        height = isAction ? 'low' : isIntimate ? 'eye' : 'high';
        foreshorten = isAction;
        break;
      case 'consequence':
        shotType = isAction ? 'medium' : 'closeup';
        height = isDiscovery ? 'high' : 'eye';
        break;
    }
    
    return {
      shotType,
      compositionType: characterCount === 1 ? 'single' : (characterCount === 2 ? 'two_shot' : 'group'),
      pov: 'neutral',
      height,
      tilt: frameRole === 'impact' && isAction ? 'dutch_light' : 'straight',
      side: 'left_of_axis',
      lineCross: false,
      changeLevel: (frameRole === 'impact' && isAction ? 'aggressive' : isIntimate ? 'subtle' : 'moderate') as 'static' | 'moderate' | 'aggressive'
    };
  }

  /**
   * Get focal gesture for encounter type and frame role
   */
  private getFocalGestureForEncounter(encounterType: EncounterType, frameRole: string): string {
    if (frameRole !== 'impact') return '';
    
    switch (encounterType) {
      case 'combat':
        return 'striking blow, weapon swing, or powerful punch';
      case 'chase':
        return 'desperate leap, reaching grab, or narrow escape';
      case 'social':
        return 'confrontational point, pleading reach, or dismissive turn';
      case 'romantic':
        return 'hesitant touch, aching reach, or vulnerable stillness';
      case 'dramatic':
        return 'accusatory point, stunned recoil, or devastating reveal gesture';
      case 'exploration':
        return 'careful reach toward the unknown, lantern raise, or threshold pause';
      case 'puzzle':
      case 'investigation':
        return 'shocked realization, reaching for evidence, or revealing gesture';
      case 'stealth':
        return 'tense freeze, silent takedown, or narrow concealment';
      case 'mixed':
        return 'a readable turning-point gesture that clarifies the changing stakes';
      default:
        return 'key action moment';
    }
  }

  protected getAgentSpecificPrompt(): string {
    const styleInstruction = this.artStyle 
      ? `\n### MANDATORY Art Style\nAll images MUST strictly follow this art style: ${this.artStyle}\n`
      : '';

    return `
## Your Role: Encounter Image Agent

You specialize in creating visual sequences for high-stakes encounters. These sequences are mini-stories of action and consequence with MAXIMUM VISUAL IMPACT.

${CORE_VISUAL_PRINCIPLE}

## VISUAL STORYTELLING SYSTEMS

### CAMERA LANGUAGE FOR ACTION
${SHOT_TYPE_GUIDE}

${CAMERA_HEIGHT_GUIDE}

**ENCOUNTER CAMERA PROGRESSION**:
- **Setup**: Wide/Medium shot, eye level - establish all parties and space
- **Escalation**: Medium shot, LOW ANGLE - build tension, make characters imposing
- **Impact**: Close-up, LOW ANGLE + DUTCH TILT - maximum dynamism
- **Consequence**: Medium/Close-up, eye level - show aftermath, reactions

### SILHOUETTE FOR ACTION READABILITY
${SILHOUETTE_POSE_RULES}

**ENCOUNTER SILHOUETTE RULES**:
- Arms MUST be separated from body (no tucked elbows in combat)
- Weapons MUST be distinct from body silhouette
- In group shots, characters MUST NOT merge into single mass
- Action poses need clear LINE OF ACTION through the body

### IMPACT COMPOSITION (CRITICAL FOR ACTION)
${IMPACT_COMPOSITION_RULES}

**ENCOUNTER IMPACT RULES**:
- The STRIKE/ACTION is the LARGEST, CLEAREST shape in frame
- FORESHORTEN limbs toward camera for "coming at you" energy
- Leading lines (debris, motion, other gazes) point TO the impact
- SIMPLIFY background at impact point - clarity over detail

## Encounter Visual Mappings
- **Combat Beats**:
  - Opening: Wide establishing shot, showing all parties and terrain, clear silhouettes
  - Escalation: Medium shots with LOW ANGLES, increasing tension, weight on front foot
  - Impact: Close-ups at moment of strike, FORESHORTENED toward camera, dutch tilt
  - Consequence: Reaction shots, aftermath staging, show changed power dynamic
  
- **Social Beats**:
  - Initial: Two-shot establishing relationship distance, body language shows status
  - Development: Alternating singles, moving closer, intensifying eye contact
  - Peak: Close-ups for emotional climax, expression landmarks clear
  - Resolution: Two-shot showing changed dynamic, body language shift
  
- **Discovery Beats**:
  - Setup: Medium shot showing investigation, character leaning toward mystery
  - Clue: Extreme close-up on discovered detail, maximum clarity
  - Realization: Close-up on character processing, expression progression
  - Implication: Pull back to show context, environmental storytelling

- **Chase Beats**:
  - Opening: Wide shot showing distance between parties, environment hazards
  - Pursuit: Medium shots with aggressive camera angles, speed lines implied
  - Crisis: Close-up on near-miss or obstacle, foreshortened danger
  - Resolution: Result of chase - escape, capture, or standoff

${SEQUENCE_VARIETY_RULES}
${VISUAL_BEAT_MAPPING}
${MOBILE_COMPOSITION_FRAMEWORK}
${styleInstruction}

## Output Format
Return a JSON array of ImagePrompt objects with these requirements:

1. **Camera Progression**: Setup (wide/medium) → Escalation (medium, low angle) → Impact (close, low, dutch) → Consequence (pull back)
2. **Silhouette Clarity**: Every pose must pass the "black fill test" - identifiable as silhouette
3. **Impact Dominance**: In action frames, the key gesture is the LARGEST, CLEAREST element
4. **Foreshortening**: Use for strikes/actions toward camera
5. **Negative Space**: Arms separated from body, weapons distinct, characters separated
6. **Leading Lines**: Environment and composition guide eye to focal action

Each prompt object should include:
- "prompt": Detailed visual description with camera angle, silhouette goals, and impact focus
- "negativePrompt": "text, words, signatures, watermarks, static pose, arms at sides, flat staging, merged silhouettes"
- "aspectRatio": "9:19.5"
`;
  }

  private buildEncounterSequencePrompt(request: EncounterSequenceRequest): string {
    const charactersInfo = request.characters.map(c => `- ${c.name} (${c.role}): ${c.description}`).join('\n');
    const frameCount = request.outcome === 'situation' ? 1 : 4; // GDD says 3-4 images
    
    // Determine encounter type from context
    const encounterType = this.inferEncounterType(request);
    
    // Generate shot specs
    const shotSpecs = this.generateEncounterShotSpecs(
      encounterType,
      frameCount,
      request.characters.length,
      request.shotDescription.toLowerCase().includes('weapon') || 
      request.shotDescription.toLowerCase().includes('sword') ||
      request.shotDescription.toLowerCase().includes('gun')
    );
    
    // Build detailed spec guidance
    const specGuidance = shotSpecs.map((spec, i) => {
      const silhouettePrompt = generateSilhouettePrompt(spec.silhouette);
      const impactPrompt = spec.impact ? generateImpactPrompt(spec.impact) : '';
      const texturePrompt = generateTexturePrompt(spec.texture);
      
      return `
### Frame ${i + 1} (${spec.frameRole.toUpperCase()})
**Camera**: ${spec.camera.shotType} shot, ${spec.camera.height} angle${spec.camera.tilt !== 'straight' ? `, ${spec.camera.tilt}` : ''}
**Silhouette**: ${silhouettePrompt}
${impactPrompt ? `**Impact**: ${impactPrompt}` : ''}
**Texture**: ${texturePrompt}
`;
    }).join('\n');

    return `
Create a series of ${frameCount} image prompts for an encounter **${request.outcome}**.

## Encounter Context
- **Encounter Type**: ${encounterType.toUpperCase()}
- **Outcome Type**: ${request.outcome}
- **Scene**: ${request.sceneContext.name}
- **Location**: ${request.sceneContext.location || 'Unknown'}
- **Mood**: ${request.sceneContext.mood}
- **Action/Shot Description**: ${request.shotDescription}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Characters Involved
${charactersInfo}

## VISUAL SPECS PER FRAME
${specGuidance}

## CRITICAL Requirements
1. Create ${frameCount} distinct but visually consistent image prompts following the specs above.
2. Each frame MUST use the specified camera angle and shot type.
3. Silhouettes MUST be clear - arms away from body, weapons distinct.
4. Impact frames MUST have the action as the LARGEST, CLEAREST element.
5. Use FORESHORTENING for actions directed toward camera.
6. Frame transitions should feel like a flowing sequence, not disconnected stills.
${this.artStyle ? `7. STRICTLY follow the art style: ${this.artStyle}` : ''}

Return a JSON array of ${frameCount} ImagePrompt objects.
`;
  }

  /**
   * Infer encounter type from request
   */
  private inferEncounterType(request: EncounterSequenceRequest): EncounterType {
    const desc = (request.shotDescription + ' ' + request.sceneContext.mood).toLowerCase();
    
    if (desc.includes('fight') || desc.includes('combat') || desc.includes('attack') || 
        desc.includes('battle') || desc.includes('strike') || desc.includes('weapon')) {
      return 'combat';
    }
    if (desc.includes('chase') || desc.includes('pursuit') || desc.includes('flee') || desc.includes('run')) {
      return 'chase';
    }
    if (desc.includes('stealth') || desc.includes('sneak') || desc.includes('hide') || desc.includes('infiltrate')) {
      return 'stealth';
    }
    if (desc.includes('discover') || desc.includes('find') || desc.includes('reveal') || desc.includes('investigate')) {
      return 'investigation';
    }
    if (desc.includes('love') || desc.includes('kiss') || desc.includes('confess') || desc.includes('tender') || desc.includes('romance')) {
      return 'romantic';
    }
    if (desc.includes('dramatic') || desc.includes('grief') || desc.includes('argument') || desc.includes('betrayal') || desc.includes('interrogate')) {
      return 'dramatic';
    }
    if (desc.includes('explore') || desc.includes('ruin') || desc.includes('wilderness') || desc.includes('journey')) {
      return 'exploration';
    }
    if (desc.includes('puzzle') || desc.includes('riddle') || desc.includes('decode') || desc.includes('mechanism')) {
      return 'puzzle';
    }
    if (desc.includes('confront') || desc.includes('negotiate') || desc.includes('persuade') || desc.includes('argue')) {
      return 'social';
    }
    
    // Default based on outcome
    if (request.outcome === 'full_success' || request.outcome === 'interesting_failure') {
      return 'combat';
    }
    
    return 'mixed';
  }
}

// Helper type for tree traversal (matches the generated structure)
interface TreeOutcome {
  tier: 'success' | 'complicated' | 'failure';
  narrativeText: string;
  cinematicDescription?: CinematicImageDescription;
  isTerminal?: boolean;
  nextSituation?: {
    setupText: string;
    cinematicSetup?: CinematicImageDescription;
    choices?: Array<{
      id: string;
      text: string;
      outcomes: {
        success: TreeOutcome;
        complicated: TreeOutcome;
        failure: TreeOutcome;
      };
    }>;
  };
}
