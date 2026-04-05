import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { ImagePrompt } from '../ImageGenerator';
import { 
  VISUAL_STORYTELLING_PROMPT,
  POSE_PRINCIPLES_COMPACT,
  PROMPT_ASSEMBLY_PATTERN,
  TRANSITION_CONTINUITY_RULES,
  TRANSITION_PROMPT_TEMPLATES
} from '../../prompts';
import { PoseSpecification, LightingSpecification, TransitionSpecification, TransitionType, CharacterEmotion } from './StoryboardAgent';
import { selectStyleAdaptation, type SceneSettingContext } from '../../utils/styleAdaptation';

export interface IllustrationRequest {
  shotDescription: string;
  beatText?: string; // Original beat text for context
  type: string;
  shotType?: string;
  sceneContext: {
    name: string;
    description: string;
    genre: string;
    tone: string;
    mood: string;
    settingContext?: SceneSettingContext;
  };
  characters?: Array<{
    name: string;
    description: string;
    role: string;
    height?: string;
    build?: string;
  }>;
  compositionNotes?: string;
  cameraAngle?: string;
  horizontalAngle?: string;
  wallyWoodPanel?: string;
  artStyle?: string;
  
  // Full pose specification from StoryboardAgent
  storyBeat?: {
    action: string;
    emotion: string;
    relationship?: string;
    // Per-character emotions (characters may feel differently!)
    characterEmotions?: CharacterEmotion[];
    isClimaxBeat?: boolean;
    isKeyStoryBeat?: boolean;
  };
  // SceneWriter-authored visual contract that should survive downstream stages
  authoredVisualContract?: {
    visualMoment?: string;
    primaryAction?: string;
    emotionalRead?: string;
    relationshipDynamic?: string;
    mustShowDetail?: string;
  };
  visualContractHash?: string;
  // The player choice that led to this beat (only for first beat of branch scenes)
  choicePayoffContext?: string;
  pose?: PoseSpecification;
  poseDescription?: string;
  lighting?: LightingSpecification;
  lightingDescription?: string;
  focalPoint?: string;
  depthLayers?: string;
  
  // TRANSITION CONTINUITY
  continuityFromPrevious?: {
    transitionType: TransitionType;
    whatPreserved: string[];
    whatChanged: string;
  };
  // Reference to previous shot's visual elements for continuity enforcement
  previousShotReference?: {
    cameraAngle?: string;
    shotType?: string;
    environment?: string;
    lighting?: string;
    palette?: string;
    characterPosition?: string;
  };
  
  // VISUAL STORYTELLING SYSTEM (Full specs from StoryboardAgent)
  moodSpec?: {
    emotion: string;
    intensity: 'low' | 'medium' | 'high' | 'peak';
    valence: 'positive' | 'negative' | 'ambiguous' | 'mixed_positive' | 'mixed_negative';
    lighting: {
      direction: string;
      quality: string;
      keyLightTemp: string;
      fillLightTemp?: string;
      contrastLevel: string;
      narrativeReason?: string;
    };
    color?: {
      dominantHue: string;
      saturation: string;
      palette: string[];
    };
  };
  lightingColorPrompt?: string; // Pre-built lighting/color prompt fragment
  visualStorytelling?: {
    camera?: {
      shotType?: string;
      compositionType?: string;
      pov?: string;
      height?: string;
      tilt?: string;
      side?: string;
      changeLevel?: string;
    };
    spatial?: {
      perspectiveForce?: string;
      spaceUsage?: string;
      characterScale?: string;
      environmentPressure?: string;
    };
    texture?: {
      overall?: string;
      focusAreas?: string;
      backgroundAreas?: string;
      moodAlignment?: string;
    };
    clarity?: {
      thumbnailTest?: string;
      focalPoints?: number;
      silhouetteReads?: boolean;
      negativeSpace?: string;
    };
    impact?: {
      punch?: string;
      foreshorten?: boolean;
      leadingLines?: string;
      detailLevel?: string;
    };
    silhouette?: {
      poseGoal?: string;
      negativeSpaceFocus?: string[];
      hooksToEmphasize?: string[];
      avoidMerging?: string[];
    };
  };

  // BEAT CONTEXT WINDOW — enables capturing the *moment* between beats
  /** Summary of what just happened (e.g. "Marcus just discovered the letter") */
  previousBeatSummary?: string;
  /** Summary of what will happen next (e.g. "He will confront Elena about it") */
  nextBeatSummary?: string;

  // SEQUENTIAL VISUAL CONTEXT — tracks previous beat's visual state for continuity
  previousBeatVisualContext?: BeatVisualContext;
}

/**
 * Tracks the visual state of the previous beat for continuity.
 * Ensures images feel like sequential frames, not isolated portraits.
 */
export interface BeatVisualContext {
  /** Per-character positions from the previous beat */
  characterPositions: {
    [characterName: string]: {
      facing: 'left' | 'right' | 'camera' | 'away';
      stance: string;  // "weight on left foot, leaning forward"
      emotionalState: string;  // "tense, guarded"
      lastAction: string;  // "just stepped back"
    }
  };

  /** Overall spatial arrangement from previous beat */
  spatialArrangement: string;  // "2 meters apart, facing each other, Elena by the window"

  /** Camera position from previous beat */
  previousCamera?: {
    angle: string;
    shotType: string;
    side: string;  // which side of the action was camera on
  };

  /** Environmental continuity */
  establishedEnvironment?: {
    keyElements: string[];  // "fireplace on left, window behind Elena"
    lighting: string;       // "warm firelight from left"
    timeOfDay: string;
  };

  /** Type of transition to this beat */
  transitionType: 'continuation' | 'contrast' | 'escalation' | 'release' | 'cut';

  /** Specific continuity notes */
  continuityNotes?: string;  // "Elena was mid-gesture, reaching toward Marcus"
}

export class VisualIllustratorAgent extends BaseAgent {
  private artStyle?: string;

  constructor(config: AgentConfig, artStyle?: string) {
    super('Visual Illustrator Agent', config);
    this.artStyle = artStyle;
    // Rebuild system prompt now that artStyle is set — buildSystemPrompt() called by super()
    // runs before artStyle is assigned, so getAgentSpecificPrompt() would get undefined.
    this.systemPrompt = this.buildSystemPrompt();
    // Send system prompt so the MANDATORY art style block reaches Claude as a system-level instruction
    this.includeSystemPrompt = true;
  }

  async execute(input: IllustrationRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = this.buildIllustrationPrompt(input);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      const anyPrompt = imagePrompt as ImagePrompt & { silentStoryTest?: string };

      // Backward compatibility: some model outputs may still use silentStoryTest.
      if (!imagePrompt.visualNarrative && anyPrompt.silentStoryTest) {
        imagePrompt.visualNarrative = anyPrompt.silentStoryTest;
      }
      
      if (!imagePrompt.aspectRatio) imagePrompt.aspectRatio = '9:19.5';
      if (!imagePrompt.visualNarrative || imagePrompt.visualNarrative.trim().length < 12) {
        console.warn('[VisualIllustratorAgent] visualNarrative is weak/missing; downstream prompt quality may degrade');
      }

      const settingSelection = selectStyleAdaptation(this.artStyle, input.sceneContext.settingContext);
      if (settingSelection.notes.length > 0) {
        imagePrompt.settingAdaptationNotes = settingSelection.notes;
        imagePrompt.settingBranchLabel = settingSelection.branchLabel;
      }
      if (input.sceneContext.settingContext) {
        imagePrompt.settingContext = input.sceneContext.settingContext;
      }
      
      return { success: true, data: imagePrompt, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    const effectiveStyle = this.artStyle || 'dramatic cinematic story art';
    const styleInstruction = this.artStyle 
      ? `\n### MANDATORY Art Style\nAll images MUST strictly follow this art style: **${this.artStyle}**\nThe "style" field in your JSON output MUST contain: "${this.artStyle}"\nEnsure every prompt incorporates specific keywords, artistic techniques, color palettes, and stylistic markers characteristic of this style. THIS IS NOT OPTIONAL.`
      : `\n### Art Style\nUse: **dramatic cinematic story art**\nThe "style" field in your JSON output MUST contain a descriptive art style.`;

    return `
## Your Role: Visual Illustrator Agent

You create image generation prompts for DRAMATIC STORY ART — expressive depictions of CHARACTERS and the ACTION in each story beat.
${styleInstruction}

### IMAGE QUALITY (Always applies, any style)
You are generating prompts for dramatic story art. Every prompt MUST describe:
- **Expressive faces**: Emotions readable at thumbnail size — push the expression so the feeling is unmistakable
- **Strong poses**: Body language that tells the story — the silhouette alone should communicate what is happening
- **Hands with intent**: Clenched for anger, reaching for connection, fidgeting for anxiety, gripping for desperation
- **Visual energy**: Dynamic over static. Even quiet moments should have the energy of restraint and held tension

## GOLDEN RULE: ILLUSTRATE THE STORY BEAT, NOT A PORTRAIT
Every image must answer: "What is HAPPENING in this moment?"
- "Action" means ALL of: physical action (what they're doing), emotion (what they're feeling), and relationship dynamics (the tension, intimacy, conflict, or connection between them)
- The BEAT — action + emotion + relationship — is the subject of the image, not any single character
- All FOREGROUND characters must appear prominently with their INTERACTION visible
- BACKGROUND characters may appear at frame edges, partially visible, or in softer focus — they add context but are NOT the focus
- The viewer should understand the story beat from the image alone, with NO text
- Composition should serve the narrative moment, not showcase a single figure

## ONE BEAT, ONE IMAGE (STRICT)
Each image captures exactly ONE dramatic moment. If the beat contains multiple actions, pick the SINGLE most visually dramatic instant.
- REJECT overloaded beats: "she dodges the blade WHILE realizing the betrayal" → pick ONE: the dodge OR the realization
- The image is a frozen film still of ONE second in time, not a summary of a paragraph
- If you cannot describe what the viewer sees in one sentence, the image tries to do too much

## CHARACTER STAGING (CRITICAL)
Characters are classified as FOREGROUND or BACKGROUND for each shot:
- **FOREGROUND**: These characters ARE the beat. They must be clearly visible, in sharp focus, with detailed expressions and body language. ALL foreground characters must appear.
- **BACKGROUND**: These characters are IN THE SCENE but not the focus of THIS beat. They may be:
  - Partially visible (over-shoulder framing, edge of frame)
  - In softer focus or smaller scale
  - Silhouetted or obscured by environment
  - Simply not shown if the shot type doesn't accommodate them (e.g., close-up)
- A character being "in the scene" does NOT mean they must appear in every shot

## CHARACTER APPEARANCE CONSISTENCY (CRITICAL)
- Each character has a canonical physical description provided below. You MUST use those exact details (hair color, eye color, build, distinctive features, attire) in your prompt output.
- NEVER invent or change a character's physical attributes. If the beat text says "dark hair" but the character description says "blonde hair", use "blonde hair".
- In the "prompt", "visualNarrative", "keyGesture", and "keyBodyLanguage" fields, always describe characters using their canonical appearance from the character descriptions provided.

## MULTI-CHARACTER FOREGROUND (CRITICAL)
When 2+ FOREGROUND characters are listed, you MUST:
- Include ALL foreground characters in the prompt, each described with position, action, emotion, and expression
- Describe their spatial relationship (facing each other, side by side, one behind another, etc.)
- Show the emotional and relational dynamic between them (confrontation, cooperation, tension, intimacy, distrust, solidarity, etc.)
- Body language and expression must convey both what each character feels AND their relationship to each other
- Frame the shot to include all foreground characters — use wider shots if needed
- NEVER reduce a multi-character foreground to a single-character portrait

## CHARACTER SCALE & SPATIAL DEPTH (CRITICAL — Enforce real heights, no symbolic distortion)
Character size in the generated prompt MUST reflect BOTH their real physical height AND their distance from the camera.

**REAL HEIGHT DIFFERENCES**: If a character's description says "towering" or "tall" and another says "petite" or "short", the taller character MUST be described as physically taller in the prompt when they are at similar depth. Include explicit height comparison language like "towering over", "head reaching only to his shoulder", etc.
- When characters have height/build data provided, you MUST mention it in the prompt to ensure the image model renders correct relative sizes.

**NO SYMBOLIC SIZE DISTORTION**: NEVER make one character larger/smaller than another to symbolize power, dominance, or vulnerability.
- To show power dynamics, use: BODY LANGUAGE, CAMERA ANGLE, FRAMING, LIGHTING, POSTURE — NOT unrealistic scale changes.
- If you want genuine scale difference from camera perspective, justify it with DEPTH (foreground vs. background).
- WRONG: "she remains smaller in the composition" (when standing near him at same depth)
- RIGHT: "his expansive arms-wide pose fills the frame while her contracted posture draws inward" (same depth, different body language)
- RIGHT: "towering figure of Vraxxan looming a full head above Lysandra" (real physical height difference)

${POSE_PRINCIPLES_COMPACT}

## PANEL TRANSITION CONTINUITY (CRITICAL)
${TRANSITION_CONTINUITY_RULES}
${TRANSITION_PROMPT_TEMPLATES}

When a transition type is specified, you MUST enforce its continuity rules:
- **moment_to_moment**: Include "IDENTICAL camera angle", "IDENTICAL environment", "SAME position with TINY change in [X]"
- **action_to_action**: Include "SAME setting", "SAME character", "NOW showing [key pose phase]"
- **subject_to_subject**: Include "SAME location", "SAME time", "IDENTICAL lighting", "NOW focused on [different subject]"
- **scene_to_scene**: Include time/space change indicators, but note continuity thread
- **aspect_to_aspect**: Include "SAME frozen moment", "IDENTICAL palette and lighting", "wandering focus to [detail]"
- **non_sequitur**: Include "intentionally jarring", but note repeating motif

${PROMPT_ASSEMBLY_PATTERN}

## PROMPT STRUCTURE
[TRANSITION if applicable] + [CAMERA] + [THE BEAT: action, emotion, relationship] + [VISUAL STYLE: pose, lighting]

## CRITICAL: SINGLE UNIFIED IMAGE — NO COMPOSITES
Every output must be ONE continuous full-bleed image from ONE camera angle. NEVER produce triptychs, diptychs, collages, montages, picture-in-picture, inset panels, overlaid cutouts, floating portraits over scenes, split-screen, or ANY multi-image composition. No internal borders or frames.
The negativePrompt MUST always include: 'triptych, diptych, collage, montage, picture-in-picture, inset panel, overlaid cutout, split-screen, comic panels, image within image, composite image'.

## CRITICAL: NO TEXT IN IMAGES
The negativePrompt MUST always include 'text overlay, caption text, title text, speech bubbles, watermarks, signatures'. The image must contain NO rendered text except text that naturally exists within the scene world (e.g. a shop sign, book title, clothing text, or banner visible to characters). No captions, labels, or annotations.

## CRITICAL: For MOMENT_TO_MOMENT transitions
The prompt MUST emphasize: "same angle, same environment, same character position, ONLY change is [specific micro-detail]"

## CRITICAL: For SUBJECT_TO_SUBJECT transitions  
The prompt MUST include: "same scene, same time, same lighting direction, now the camera focuses on [different subject]"

## CHARACTER DUPLICATION PREVENTION (CRITICAL)
Each named character must appear EXACTLY ONCE in the output image. Reference images may show a character from multiple angles — those are identity references, NOT scene population instructions.
- WRONG: Rendering Aethavyr twice because the reference sheet showed him from front and side
- RIGHT: One Aethavyr in the scene, matching his reference identity
Include "duplicate character, same character appearing twice, cloned figures" in the negativePrompt for ANY scene with character references.

## Output Format
Return a JSON object:
{
  "prompt": "Complete prompt describing the story beat (action, emotion, relationship dynamics). MUST name ALL characters by their actual names — NEVER use generic references like 'a woman', 'a man', 'two people', 'the figure', 'the character'. Transition continuity directives at the START if applicable.",
  "negativePrompt": "triptych, diptych, collage, montage, picture-in-picture, inset panel, overlaid cutout, split-screen, comic panels, image within image, composite image, floating portrait, duplicate character, same character appearing twice, cloned figures, single character alone when multiple should be present, character portrait, missing characters, static pose, standing straight, symmetrical pose, arms at sides, mannequin pose, centered composition, repeated staging from previous image, text overlay, caption text, title text, speech bubbles, watermarks, signatures, [transition-specific negatives]",
  "style": "${effectiveStyle}",
  "aspectRatio": "9:19.5",
  "composition": "Focal point and depth layers — where the ACTION is framed",
  "cameraAngle": "Cinematic angle",
  "poseSpec": "Pose summary for each visible character",
  "transitionEnforcement": "How this prompt enforces continuity from previous shot",
  "keyExpression": "SPECIFIC facial anatomy for EACH foreground character, labeled by name. Example: 'Kira: lips pressed into a thin line, brow furrowed, eyes glistening and averted downward. Marcus: jaw set, nostrils flared, eyes locked on her with narrowed intensity.' NOT 'both look tense'. Use anatomical descriptors: eyebrows (furrowed/raised/knitted), eyes (narrowed/wide/averted/glistening), mouth (tight-lipped/open/snarling/trembling), jaw (clenched/slack/set). Every foreground character gets their own line.",
  "keyGesture": "SPECIFIC hand and arm action for each foreground character — what are their hands DOING to/with each other or objects? When 2+ foreground characters: describe the spatial relationship between their hands/arms. Example: 'her hand on his chest pushing him back, his arms raised palms-out in surrender' NOT 'pushing gesture'. Hands reveal intent and relationship.",
  "keyBodyLanguage": "SPECIFIC body mechanics AND spatial relationship between foreground characters. Example: 'Kira leans away, weight on her back foot, shoulders turned half-away — Marcus crowds forward, weight on front foot, spine angled toward her, closing the gap she is trying to create.' Include: weight distribution, line of action, spatial orientation, and how their bodies relate to each other (closing gap, creating distance, mirroring, opposing).",
  "shotDescription": "Camera in plain language. Example: 'low angle medium shot from three-quarter right' NOT just 'medium shot'.",
  "emotionalCore": "The SINGLE emotional truth of this moment as a CONCRETE OBSERVABLE SCENE using CHARACTER NAMES, not an abstraction. YES: 'Catherine sees the blood on Heathcliff's hands and takes a step back, her trust visibly cracking.' NO: 'tension rises between them' or 'she sees the blood'. Always use actual character names, never generic pronouns alone.",
  "visualNarrative": "THE SILENT STORY using CHARACTER NAMES: In one sentence, describe what is happening using the characters' actual names and their canonical physical descriptions. This sentence will be the CORE of the image generation prompt. YES: 'Catherine Earnshaw recoils in horror from Heathcliff, whose hands are stained red.' NO: 'A woman recoils from a man' or 'two people in conflict'. NEVER use generic references like 'a woman', 'a man', 'two young people', 'the figure'. ALWAYS use the character names provided."
}
`;
  }

  private buildIllustrationPrompt(request: IllustrationRequest): string {
    const characterCount = request.characters?.length || 0;
    const settingSelection = selectStyleAdaptation(this.artStyle, request.sceneContext.settingContext);
    
    // Separate foreground and background characters for proper visual staging
    const fgChars = request.characters?.filter(c => c.role.includes('[FOREGROUND')) || [];
    const bgChars = request.characters?.filter(c => c.role.includes('[BACKGROUND')) || [];
    const unmarkedChars = request.characters?.filter(c => !c.role.includes('[FOREGROUND') && !c.role.includes('[BACKGROUND')) || [];
    
    // All foreground + unmarked characters are the visual focus
    const focusChars = [...fgChars, ...unmarkedChars];
    const hasBgChars = bgChars.length > 0;
    const focusCount = focusChars.length;
    
    let charsInfo = '';
    if (characterCount > 0) {
      const describeChar = (c: NonNullable<typeof request.characters>[number]) => {
        const parts = [c.description];
        if (c.height) parts.push(`Height: ${c.height}`);
        if (c.build) parts.push(`Build: ${c.build}`);
        return parts.join('. ');
      };

      if (focusChars.length > 0) {
        charsInfo += `\n## FOREGROUND CHARACTERS (${focusCount} — visual focus, must be clearly visible and detailed)\n${focusChars.map(c => `- **${c.name}** (${c.role.replace(/\s*\[FOREGROUND[^\]]*\]/, '')}): ${describeChar(c)}`).join('\n')}`;
      }
      if (hasBgChars) {
        charsInfo += `\n\n## BACKGROUND CHARACTERS (${bgChars.length} — present in scene but NOT the focus)\n${bgChars.map(c => `- **${c.name}** (${c.role.replace(/\s*\[BACKGROUND[^\]]*\]/, '')}): ${describeChar(c)}`).join('\n')}`;
        charsInfo += `\n\n**STAGING RULES**: Background characters may be partially visible, at frame edges, over-the-shoulder, or in softer focus. They add context and depth but the camera serves the FOREGROUND action.`;
      }
      if (focusCount >= 2) {
        charsInfo += `\n\n**⚠️ MULTI-CHARACTER FOREGROUND**: This image MUST depict ALL ${focusCount} foreground characters. Show their spatial relationship, body language toward each other, the physical/emotional/relational dynamic between them. The INTERACTION — action, emotion, and relationship — is the subject, NOT a single-character portrait.`;

        // Add relative height note when characters have different heights
        const allChars = request.characters || [];
        const withHeight = allChars.filter(c => c.height);
        if (withHeight.length >= 2) {
          const heightList = withHeight.map(c => `${c.name} (${c.height})`).join(', ');
          charsInfo += `\n\n**⚠️ RELATIVE HEIGHT**: These characters have different physical heights: ${heightList}. The prompt MUST describe their height difference explicitly when they are at similar depth (e.g., "towering over", "reaching only to his shoulder"). This is a real physical trait, not symbolic.`;
        }
      }
    }

    // Build TRANSITION CONTINUITY section (only when continuity matters)
    const transitionSection = request.continuityFromPrevious
      ? this.buildTransitionContinuitySection(request)
      : '';

    // Build beat context window for dramatic moment framing
    // Knowing what JUST happened and what WILL happen lets the LLM capture the in-between tension
    const beatContextSection = (request.previousBeatSummary || request.nextBeatSummary)
      ? `
## DRAMATIC MOMENT CONTEXT
${request.previousBeatSummary ? `- **What just happened**: ${request.previousBeatSummary}` : ''}
${request.nextBeatSummary ? `- **What's about to happen**: ${request.nextBeatSummary}` : ''}
- **THIS image captures the EXACT MOMENT between these beats** — show the instant of reaction, the held breath, the frozen tension. NOT a summary of the beat, but the BETWEEN: the second before, during, or just after the key action.`
      : '';

    // Build sequential visual context section for frame-to-frame continuity
    const sequentialContextSection = request.previousBeatVisualContext
      ? this.buildSequentialContextSection(request.previousBeatVisualContext)
      : '';

    // Build story beat section with per-character emotions
    const storyBeatSection = request.storyBeat 
      ? `
## STORY BEAT (What This Image Must Show)
${request.beatText ? `- **Narrative**: "${request.beatText}"` : ''}
- **Action**: ${request.storyBeat.action}
- **Emotion**: ${request.storyBeat.emotion}
${request.storyBeat.relationship ? `- **Relationship**: ${request.storyBeat.relationship}` : ''}
${this.buildCharacterEmotionsSection(request.storyBeat.characterEmotions)}
${beatContextSection}`
      : (request.beatText ? `\n- **Narrative Beat**: "${request.beatText}"${beatContextSection}` : beatContextSection);

    const authoredContractSection = request.authoredVisualContract
      ? `
## AUTHORED VISUAL CONTRACT (DO NOT DRIFT)
- **Visual Moment (LOCKED)**: ${request.authoredVisualContract.visualMoment || 'Not provided'}
- **Primary Action (LOCKED)**: ${request.authoredVisualContract.primaryAction || 'Not provided'}
- **Emotional Read (LOCKED)**: ${request.authoredVisualContract.emotionalRead || 'Not provided'}
- **Relationship Dynamic (LOCKED)**: ${request.authoredVisualContract.relationshipDynamic || 'Not provided'}
- **Must Show Detail (LOCKED)**: ${request.authoredVisualContract.mustShowDetail || 'Not provided'}
- You may choose framing and camera grammar, but the story event above is non-negotiable.`
      : '';

    const choicePayoffSection = request.choicePayoffContext
      ? `
## PLAYER CHOICE PAYOFF (CRITICAL — this image must show what the player chose)
The player selected: "${request.choicePayoffContext}"
Your image prompt MUST depict this specific action playing out. The player expects to SEE the consequence of their choice. Do NOT generalize into a mood shot or atmospheric establishing shot — show the EXACT physical action from the choice.`
      : '';
    const visualContractHashSection = request.visualContractHash
      ? `
## CONTRACT HASH (LOCK)
Contract hash: ${request.visualContractHash}
Treat this as the immutable visual contract identifier. Do not drift from authored details.`
      : '';

    // Brief pose guidance — supports the beat, not a checklist
    const poseGuidance = request.poseDescription
      ? `**Pose**: ${request.poseDescription}`
      : `**Pose**: Dynamic, readable pose that supports the emotion and action — vary staging across the sequence (don't repeat the same pose or setting as previous images).`;

    // CAMERA: Consolidated shot + composition (one compact block)
    const cameraSection = `
- **Shot**: ${request.shotType || 'Medium'} ${request.horizontalAngle || 'three-quarter'}, ${request.cameraAngle || 'eye level'}
- **Focal Point**: ${request.focalPoint || 'Key moment at rule-of-thirds'}
- **Depth**: ${request.depthLayers || 'Foreground, midground, background'}
- **Planned**: ${request.shotDescription}`;

    // VISUAL STYLE: Consolidated lighting + mood + pose (one compact block)
    const lightingDesc = request.lightingColorPrompt || request.lightingDescription
      || (request.lighting ? `${request.lighting.direction}-lighting, ${request.lighting.quality}, ${request.lighting.temperature}` : '')
      || (request.moodSpec?.lighting ? `${request.moodSpec.lighting.direction}, ${request.moodSpec.lighting.keyLightTemp}, ${request.moodSpec.lighting.contrastLevel} contrast` : '')
      || 'Supports the mood';
    const visualStyleSection = `
${poseGuidance}
- **Lighting**: ${lightingDesc}
- **Scene**: ${request.sceneContext.name} — ${request.sceneContext.description}
- **Genre/Tone**: ${request.sceneContext.genre}, ${request.sceneContext.tone}`;

    const settingSection = request.sceneContext.settingContext
      ? `
## SETTING-AWARE STYLE ADAPTATION (MANDATORY)
- **Selected Branch**: ${settingSelection.branchLabel}
- **Resolved Setting**: ${request.sceneContext.settingContext.summary}
${settingSelection.notes.map(note => `- ${note}`).join('\n')}
`
      : '';

    // Art style instruction — placed FIRST so LLM includes it in the generated prompt
    const beatEffectiveStyle = this.artStyle || 'dramatic cinematic story art';
    const artStyleDirective = `**ART STYLE**: ${beatEffectiveStyle}`;

    return `
${artStyleDirective}

**IMAGE QUALITY**: The prompt you generate MUST produce dramatic story art in the specified style. Emphasize:
- Facial expressions that are READABLE at a glance (push the emotion — anger, fear, hope, suspicion should be unmistakable)
- Body language and poses that TELL THE STORY (silhouettes should communicate the action even without faces)
- Hands that reveal intent (clenched, reaching, gesturing, gripping)
- Visual energy — dynamic over static, tension over calm, gesture over neutral

**CRITICAL — MICRO-DIRECTION FIELDS**: In addition to the main prompt, you MUST populate these separate JSON fields with SPECIFIC visual details:
- **keyExpression**: ANATOMICAL face details for EACH foreground character BY NAME. (Kira: furrowed brow, glistening eyes. Marcus: clenched jaw, narrowed stare.) — NOT emotion labels (angry, sad). Every foreground character gets their own expression line.
- **keyGesture**: What are each character's hands DOING to each other or objects? When 2+ foreground: describe the spatial contact/gap between them. (her fingers digging into his wrist, his other hand reaching for the door) — NOT vague (holding something, making a gesture).
- **keyBodyLanguage**: Weight, lean, line of action for each foreground character AND how their bodies relate spatially. (she recoils backward, he crowds forward — the gap between them shrinking) — NOT abstract (defensive posture, tense stance).
- **emotionalCore**: One CONCRETE OBSERVABLE sentence — what we literally SEE, not an abstraction. YES: "She sees the blood on his hands and steps back." NO: "Tension rises between them."
- **visualNarrative**: What would a viewer with NO text understand? One specific sentence. This is the core visual story and must be concrete, not vague.

These fields are injected DIRECTLY into the image model prompt — they are your most powerful tool for visual storytelling.

Create an image generation prompt for this story beat. STORY ART — a dramatic depiction of the MOMENT, NOT a portrait.

Write the prompt as a vivid narrative description — describe what we SEE in this exact frozen moment:
- The moment: What is happening RIGHT NOW? (e.g. "Marcus freezes, letter crumpling in his fist, as Elena's voice calls from the doorway")
- The tension: What emotion/conflict is visible? (e.g. "The space between them — he knows, she doesn't know he knows")
- The visual key: What single detail sells the scene? (e.g. "His white-knuckle grip on the letter, her unsuspecting smile in the background")

---
## 1. THE BEAT (this is the core — lead with it)
${charsInfo}
${storyBeatSection}
${authoredContractSection}${choicePayoffSection}${visualContractHashSection}
${sequentialContextSection}

---
${request.continuityFromPrevious ? `## 2. TRANSITION\n${transitionSection}\n---\n` : ''}
## ${request.continuityFromPrevious ? '3' : '2'}. CAMERA
${cameraSection}

---
## ${request.continuityFromPrevious ? '4' : '3'}. VISUAL STYLE
${visualStyleSection}
${settingSection}

---
## PROMPT ASSEMBLY
Build your prompt in this order:
${request.continuityFromPrevious ? `0. [TRANSITION] Continuity directive first` : ''}
1. [ART STYLE] Use EXACTLY this art style string with no modifications: "${beatEffectiveStyle}"
2. [CAMERA] Shot type, angle
3. [THE BEAT] Action, emotion, relationship — the core. ${focusCount >= 2 ? `ALL ${focusCount} foreground characters, what each is doing/feeling, their dynamic.` : ''}${hasBgChars ? ` Background characters may appear at edges/periphery.` : ''}
4. [VISUAL STYLE] Pose, lighting, composition to serve the beat

## CHECKLIST
□ Art style keywords included in prompt?
□ ONE beat, ONE moment — not a summary of multiple actions?
□ Clear beat (action, emotion, relationship)?
${focusCount >= 2 ? `□ All ${focusCount} foreground characters present and interacting?\n□ keyExpression has a labeled line for EACH foreground character?` : ''}
□ Expressions readable at thumbnail size (pushed, not subtle)?
□ Focal point serves the beat?
□ Not a static portrait?
□ Different staging/pose from previous image in the sequence?
□ keyExpression uses SPECIFIC facial anatomy (brow, eyes, mouth, jaw) — NOT vague emotion words?
□ keyGesture describes spatial contact/gap between characters (when 2+)?
□ keyBodyLanguage describes weight, lean, line of action — NOT just "tense posture"?
□ emotionalCore is a CONCRETE OBSERVABLE scene — NOT an abstraction?
□ visualNarrative is a specific, standalone visual story description?

## DIEGETIC REALISM (CRITICAL)
The genre is **${request.sceneContext.genre}**, tone is **${request.sceneContext.tone}**.

Every visual element you describe MUST be diegetic — it must be something that could actually exist or happen within this story's world:
- If the genre is fantasy/supernatural/sci-fi, magic, glowing effects, and impossible physics ARE diegetic and may be shown.
- If the genre is drama/romance/historical/thriller, there are NO supernatural phenomena. Emotion must be conveyed entirely through human physicality: posture, expression, gesture, spatial relationships.
- NEVER use poetic metaphors that an image model will render literally. These are writing flourishes, NOT visual descriptions:
  BAD: "sparks fly between them", "magnetic pull draws her forward", "souls collide", "the air crackles with tension", "ethereal light surrounds them"
  GOOD: "she grips the doorframe, knuckles white, body leaning toward him despite herself", "she reaches for his hand but stops short, fingers curling back"

For human drama, favor MICRO-DRAMA over theatrical grand gestures:
- A tightened jaw, averted eyes, fidgeting hands, a half-step backward — these are more powerful than exaggerated poses.
- Two characters should have ASYMMETRIC body language reflecting their different internal states, NOT mirrored poses or stiff side-by-side positioning.
- NEVER describe two characters simply "standing together holding hands" — show what their hands are DOING (squeezing, loosening grip, one pulling away, intertwined fingers with white knuckles).

Return JSON: prompt, negativePrompt, style, aspectRatio (9:19.5), composition, cameraAngle, poseSpec, transitionEnforcement, keyExpression, keyGesture, keyBodyLanguage, shotDescription, emotionalCore, visualNarrative.
The "style" field in JSON MUST be EXACTLY "${beatEffectiveStyle}" — copy it verbatim, do NOT add, remove, or rephrase any words.
`;
  }

  /**
   * Build per-character emotions section for the prompt
   * Each character may have a DIFFERENT emotion - don't assume everyone feels the same!
   */
  private buildCharacterEmotionsSection(characterEmotions?: CharacterEmotion[]): string {
    if (!characterEmotions || characterEmotions.length === 0) {
      return '';
    }

    const emotionsList = characterEmotions.map(ce => {
      const landmarks = ce.eyebrows || ce.eyelids || ce.mouth
        ? `
    - EYEBROWS: ${ce.eyebrows || 'not specified'}
    - EYELIDS: ${ce.eyelids || 'not specified'}
    - MOUTH: ${ce.mouth || 'not specified'}`
        : '';

      return `
### ${ce.characterName}
- **Emotion**: ${ce.emotion} (${ce.intensity})${ce.reason ? ` - ${ce.reason}` : ''}${ce.expressionName ? `
- **Expression Reference**: Use "${ce.expressionName}" expression sheet as reference` : ''}
- **THE 3 KEY LANDMARKS (CRITICAL FOR READABILITY)**:${landmarks || '\n    (Infer from emotion)'}`;
    }).join('\n');

    return `

## PER-CHARACTER EMOTIONS (CRITICAL - Each character has their OWN expression!)
${emotionsList}

**IMPORTANT**: The prompt MUST describe each visible character with their SPECIFIC emotion.
Do NOT give everyone the same expression unless explicitly stated!
For each character, describe: eyebrow position, eyelid openness, mouth shape.`;
  }

  /**
   * Build transition continuity section based on transition type
   */
  private buildTransitionContinuitySection(request: IllustrationRequest): string {
    const transition = request.continuityFromPrevious!;
    const prevRef = request.previousShotReference;

    const transitionDirectives: Record<TransitionType, string> = {
      'moment_to_moment': `
## TRANSITION CONTINUITY: MOMENT-TO-MOMENT (Time Barely Moves)
**THIS IS CRITICAL**: This shot is a micro-progression from the previous shot.
${request.storyBeat?.isClimaxBeat ? '**CLIMAX EXCEPTION**: At climax moments, slight camera/lighting shifts for dramatic effect are acceptable.' : ''}
- Camera angle MUST BE IDENTICAL: ${prevRef?.cameraAngle || 'same as previous'}
- Environment MUST BE IDENTICAL: ${prevRef?.environment || 'same as previous'}
- Character position MUST BE IDENTICAL (with tiny adjustment only)
- Lighting MUST BE IDENTICAL: ${prevRef?.lighting || 'same as previous'}
- Color palette MUST BE IDENTICAL: ${prevRef?.palette || 'same as previous'}
- **ONLY CHANGE ALLOWED**: ${transition.whatChanged}

**PROMPT MUST START WITH**: "Same angle, same environment, same character position, ONLY change is [${transition.whatChanged}]"
**PRESERVED ELEMENTS**: ${transition.whatPreserved.join(', ')}`,

      'action_to_action': `
## TRANSITION CONTINUITY: ACTION-TO-ACTION (Keyframe Motion)
This shot shows progression through a physical action sequence.
- Same character as previous
- Same environment/setting: ${prevRef?.environment || 'same as previous'}
- Lighting IDENTICAL: ${prevRef?.lighting || 'same as previous'}
- **CHANGE**: Character is now in DIFFERENT KEY POSE showing: ${transition.whatChanged}

**PROMPT MUST INCLUDE**: "Same setting, same character, NOW showing [${transition.whatChanged}]"
**PRESERVED ELEMENTS**: ${transition.whatPreserved.join(', ')}`,

      'subject_to_subject': `
## TRANSITION CONTINUITY: SUBJECT-TO-SUBJECT (Same Moment, Different Focus)
The camera cuts to a different subject within the SAME moment.
${request.storyBeat?.isClimaxBeat ? '**CLIMAX EXCEPTION**: At climax moments, lighting/mood shifts for dramatic impact are acceptable.' : ''}
- Time is IDENTICAL to previous shot (same frozen moment)
- Location is IDENTICAL: ${prevRef?.environment || 'same as previous'}
- Lighting direction IDENTICAL: ${prevRef?.lighting || 'same as previous'}
- Palette IDENTICAL: ${prevRef?.palette || 'same as previous'}
- **CHANGE**: Camera now focuses on: ${transition.whatChanged}

**PROMPT MUST START WITH**: "Same location, same moment, IDENTICAL lighting, NOW focused on [${transition.whatChanged}]"
**PRESERVED ELEMENTS**: ${transition.whatPreserved.join(', ')}`,

      'scene_to_scene': `
## TRANSITION CONTINUITY: SCENE-TO-SCENE (Time/Space Jump)
This shot jumps to a different time and/or location.
- Environment CHANGES: ${transition.whatChanged}
- Time may have passed
- Character state may show change (clothes, injuries, mood)
- **CONTINUITY THREAD** (what links this to previous): ${transition.whatPreserved.join(', ')}

**PROMPT SHOULD INDICATE**: Time/space change while maintaining continuity thread`,

      'aspect_to_aspect': `
## TRANSITION CONTINUITY: ASPECT-TO-ASPECT (Mood Wandering)
The camera wanders to a different detail while time is FROZEN.
- Time is FROZEN (same moment as previous)
- Location is the SAME general area
- Palette MUST BE IDENTICAL: ${prevRef?.palette || 'same as previous'}
- Lighting mood IDENTICAL: ${prevRef?.lighting || 'same as previous'}
- **CHANGE**: Focus wanders to: ${transition.whatChanged}

**PROMPT MUST START WITH**: "Same frozen moment, IDENTICAL palette and lighting, wandering focus to [${transition.whatChanged}]"
**PRESERVED ELEMENTS**: ${transition.whatPreserved.join(', ')}`,

      'non_sequitur': `
## TRANSITION CONTINUITY: NON-SEQUITUR (Surreal/Symbolic Jump)
This shot is intentionally jarring with no obvious narrative connection.
- Everything CAN change: setting, subject, time, composition
- **ONLY THREAD**: A repeating visual motif connects this to the story: ${transition.whatPreserved.join(', ')}

**PROMPT MUST INCLUDE**: "Intentionally surreal/jarring, BUT repeating motif: [${transition.whatPreserved.join(', ')}]"`
    };

    return transitionDirectives[transition.transitionType] || '';
  }

  /**
   * Build sequential visual context section for frame-to-frame continuity.
   * Ensures images feel like sequential film frames, not isolated portraits.
   */
  private buildSequentialContextSection(context: BeatVisualContext): string {
    const characterPositionLines = Object.entries(context.characterPositions)
      .map(([name, pos]) => `- **${name}**: facing ${pos.facing}, ${pos.stance}. Emotional state: ${pos.emotionalState}. Last action: ${pos.lastAction}`)
      .join('\n');

    const transitionGuidance: Record<BeatVisualContext['transitionType'], string> = {
      continuation: 'This beat CONTINUES the previous action — show the NEXT moment in the same movement arc.',
      contrast: 'This beat CONTRASTS with the previous — show a deliberate shift in energy, mood, or direction.',
      escalation: 'This beat ESCALATES the tension — show increased intensity in body language and spatial pressure.',
      release: 'This beat RELEASES tension — show bodies relaxing, distance changing, pressure dissolving.',
      cut: 'This is a HARD CUT — new composition is acceptable, but maintain character consistency.'
    };

    return `
## SEQUENTIAL CONTEXT (Frame-to-Frame Continuity)
**This image follows directly from the previous beat. Consider visual continuity.**

### Character Positions from Previous Beat
${characterPositionLines}

### Spatial Arrangement
${context.spatialArrangement}

${context.previousCamera ? `### Previous Camera
- Angle: ${context.previousCamera.angle}
- Shot Type: ${context.previousCamera.shotType}
- Side: ${context.previousCamera.side}
` : ''}

${context.establishedEnvironment ? `### Established Environment
- Key elements: ${context.establishedEnvironment.keyElements.join(', ')}
- Lighting: ${context.establishedEnvironment.lighting}
- Time of day: ${context.establishedEnvironment.timeOfDay}
` : ''}

### Transition Type: ${context.transitionType.toUpperCase()}
${transitionGuidance[context.transitionType]}

${context.continuityNotes ? `### Continuity Notes\n${context.continuityNotes}` : ''}

**IMPORTANT**: The viewer should feel these are sequential frames from a film, not isolated images. Characters should appear to have MOVED from their previous positions in a physically plausible way.`;
  }
}
