/**
 * Visual Narrative System (Eisner-Inspired)
 * 
 * Implements principles from Will Eisner's sequential art theory:
 * - Every image advances the story
 * - Composition controls eye flow and reading
 * - Rhythm and pacing through change magnitude
 * - Visual motifs create thematic unity
 * - Environment participates in storytelling
 * - Clarity and economy - show only what serves the beat
 */

// ============================================
// RHYTHM AND PACING
// ============================================

/**
 * Rhythm role - what function does this beat serve in the sequence?
 */
export type RhythmRole = 
  | 'breather'    // Pause, emotional processing, low density
  | 'build'       // Tension increasing, moderate changes
  | 'spike'       // Peak moment, high impact, big changes
  | 'resolution'  // Aftermath, release, settling
  | 'transition'; // Moving between scenes/states

/**
 * How much visual change from the previous beat?
 */
export type ChangeMagnitude = 
  | 'micro'       // Almost nothing changed (moment-to-moment)
  | 'small'       // Minor pose/expression shift
  | 'moderate'    // Noticeable camera/composition change
  | 'large'       // Significant scene element changes
  | 'total';      // Complete scene/location change

/**
 * How visually dense/busy is the frame?
 */
export type InformationDensity = 
  | 'minimal'     // Very sparse, focus on single element
  | 'sparse'      // Simple composition, clear negative space
  | 'balanced'    // Standard amount of visual information
  | 'busy'        // Multiple elements competing for attention
  | 'dense';      // Very detailed, requires scanning

export interface RhythmSpec {
  role: RhythmRole;
  changeMagnitude: ChangeMagnitude;
  informationDensity: InformationDensity;
  
  // Timing feel
  timeFeel: 'stretched' | 'normal' | 'compressed'; // How time feels in this beat
  
  // For choice-adjacent beats
  isPreChoice?: boolean;  // Beat immediately before player choice
  isPostChoice?: boolean; // Beat immediately after choice consequence
}

export const RHYTHM_RULES = `
## RHYTHM AND PACING (Eisner Principles)

### RHYTHM ROLES
- **breather**: Pause for emotional processing. Use SPARSE frames, MICRO changes, minimal text.
- **build**: Tension increasing. Use MODERATE changes, balanced density, deliberate camera shifts.
- **spike**: Peak moment (revelation, confrontation, choice). Use LARGE changes, can be BUSY, strong contrast.
- **resolution**: Aftermath. Return to SPARSE, SMALL changes, let characters process.
- **transition**: Moving between scenes. Use scene_to_scene transitions, establish new context quickly.

### CHANGE MAGNITUDE RULES
- **Around major choices**: SLOW DOWN with micro/small changes in 2-3 beats before
- **After consequences**: Use 1-2 "silent" beats with small changes for processing
- **Action sequences**: Large changes between beats, compressed time feel
- **Emotional beats**: Micro to small changes, stretched time feel

### INFORMATION DENSITY RULES
- **Breather/Resolution**: SPARSE - simple backgrounds, focus on character acting
- **Build**: BALANCED - include relevant context but don't overwhelm
- **Spike**: Can be BUSY for chaos, or MINIMAL for stark dramatic impact
- **Never**: Use DENSE for emotional character beats (clutters the acting)
`;

// ============================================
// COMPOSITION FLOW (Eye Direction)
// ============================================

/**
 * Where the viewer's eye enters and exits the composition
 */
export type CompositionEntry = 'top_left' | 'top_center' | 'left' | 'center' | 'custom';
export type CompositionExit = 'bottom_right' | 'right' | 'center' | 'to_ui' | 'custom';

export interface CompositionFlowSpec {
  // Eye flow
  entryPoint: CompositionEntry;
  exitPoint: CompositionExit;
  
  // What leads the eye through the frame
  flowElements: Array<'character_gaze' | 'gesture_direction' | 'light_direction' | 'leading_lines' | 'color_path'>;
  
  // Primary visual path description
  flowDescription: string; // e.g., "Eye enters on character A's face, follows gaze to character B, exits toward choice buttons"
  
  // UI integration (for interactive elements)
  leadsToUI?: boolean; // Should composition direct toward UI/choice buttons?
  uiPlacement?: 'bottom' | 'right' | 'bottom_right'; // Where UI will be
}

export const COMPOSITION_FLOW_RULES = `
## COMPOSITION FLOW (Eisner's Reading Convention)

### EYE FLOW PRINCIPLES
In Western reading convention, the eye naturally flows LEFT→RIGHT, TOP→BOTTOM.
Use this to control what players see FIRST and where attention ends.

### ENTRY POINTS
- **top_left**: Default entry. Place most important character/element here.
- **left**: Good for horizontal scenes, character introductions.
- **center**: Use for symmetrical, confrontational, or iconic shots.

### EXIT POINTS  
- **bottom_right**: Natural reading exit. Good for "continue" feeling.
- **to_ui**: Deliberately lead eye toward choice buttons/interactive elements.
- **right**: Leads forward in time, good for action sequences.

### FLOW ELEMENTS
Use these to create visual paths:
- **character_gaze**: Characters look toward next important element
- **gesture_direction**: Pointing, reaching guides the eye
- **light_direction**: Bright areas pull attention, shadows recede
- **leading_lines**: Environmental lines (roads, architecture) point toward focus
- **color_path**: Accent colors create breadcrumb trail through frame

### UI INTEGRATION RULE
For choice beats: Composition should lead eye TOWARD the choice UI, not away from it.
Avoid strong visual elements that compete with or distract from choice buttons.
`;

// ============================================
// CLARITY AND ECONOMY
// ============================================

export interface ClaritySpec {
  // The ONE thing happening in this image
  focalEvent: string; // e.g., "Character A reveals the betrayal"
  
  // The ONE feeling we want the player to have
  focalEmotion: string; // e.g., "shock and heartbreak"
  
  // Only elements REQUIRED for this beat to be legible
  essentialContext: string[]; // e.g., ["Character A's face", "the stolen item in their hand", "Character B in background"]
  
  // What should be simplified or removed
  simplifiedElements?: string[]; // e.g., ["background crowd", "detailed architecture"]
  
  // Thumbnail test description
  thumbnailRead: string; // What should be readable even at tiny size
}

export const CLARITY_RULES = `
## CLARITY AND ECONOMY (Eisner Principles)

### ONE BEAT, ONE IDEA
Each image should have:
- **1 focal event**: What is VISUALLY happening?
- **1 focal emotion**: What should player FEEL?
- **1-2 supporting details**: Only what's needed for context

### ESSENTIAL CONTEXT ONLY
Before generating, ask: "What MUST be visible for this beat to make sense?"
Everything else should be simplified or removed.

### THUMBNAIL TEST (Critical QA)
If you shrink the image to thumbnail size:
- Can you identify the focal character?
- Can you read the main gesture/pose?
- Is the emotional tone clear?

If NO to any: simplify, increase contrast on focal point, reduce competing details.

### ECONOMY RULES
- NO random props that don't serve the current beat
- NO complex backgrounds for emotional close-ups
- NO foreground clutter blocking focal characters
- SIMPLIFY anything that isn't the point of this beat
`;

// ============================================
// VISUAL MOTIFS
// ============================================

/**
 * A recurring visual element that carries thematic meaning
 */
export interface VisualMotif {
  id: string;
  name: string;
  
  // What it is
  type: 'object' | 'shape' | 'color' | 'lighting_setup' | 'framing' | 'environment_element';
  visualDescription: string; // e.g., "A doorway, lit from beyond"
  
  // What it means
  thematicMeaning: string; // e.g., "Opportunity, threshold, choice"
  
  // How it evolves
  evolutionStages: Array<{
    stage: string; // e.g., "early", "mid", "late_good", "late_bad"
    treatment: string; // e.g., "Bright light beyond, character centered" vs "Blocked, harsh backlight"
    emotionalTone: string;
  }>;
  
  // When to use
  triggerConditions: string[]; // e.g., ["major choice", "character_X scenes", "trust_theme"]
}

/**
 * Story-level motif collection
 */
export interface MotifLibrary {
  storyId: string;
  
  // Core motifs (always tracked)
  coreMotifs: VisualMotif[];
  
  // Character-specific motifs (appear with specific characters)
  characterMotifs: Map<string, VisualMotif[]>;
  
  // Theme-specific motifs
  themeMotifs: Map<string, VisualMotif[]>; // e.g., "trust" → [motifs]
  
  // Branch-affected motifs (treatment changes based on path)
  branchSensitiveMotifs: string[]; // IDs of motifs whose treatment depends on branch
}

/**
 * Motif usage in a specific beat
 */
export interface MotifPresence {
  motifId: string;
  currentStage: string; // Which evolution stage
  placement: string; // Where in frame: "foreground", "background", "framing element"
  prominence: 'subtle' | 'noticeable' | 'dominant';
  treatmentNotes?: string; // Specific instructions for this instance
}

export const MOTIF_RULES = `
## VISUAL MOTIFS (Eisner's Leitmotifs)

### WHAT ARE VISUAL MOTIFS?
Recurring visual elements that carry thematic meaning and evolve with the story.
Like musical leitmotifs, they create unity and deepen meaning through repetition.

### TYPES OF MOTIFS
- **object**: A specific prop (a locket, a weapon, a book)
- **shape**: Recurring shape language (circles for safety, angles for danger)
- **color**: Accent color tied to theme/faction (gold for hope, teal for mystery)
- **lighting_setup**: Specific lighting that recurs (backlit doorway, spotlight)
- **framing**: Compositional device (bars/frames for entrapment, open sky for freedom)
- **environment_element**: Architectural/natural element (doorways, windows, paths)

### EVOLUTION RULES
Motifs should EVOLVE based on story state:
- **Early**: Introduced neutrally or positively
- **Mid**: Meaning becomes clearer, may shift
- **Late (good path)**: Positive treatment, resolution
- **Late (bad path)**: Corrupted, inverted, or destroyed

### USAGE RULES
- Don't overuse: 1-2 motifs per beat maximum
- Vary prominence: Sometimes subtle background, sometimes dominant
- Track consistency: Same motif should be recognizable across appearances
- Branch sensitivity: Some motifs should look different on different paths
`;

// ============================================
// ENVIRONMENT AS CHARACTER
// ============================================

/**
 * How the environment participates in storytelling
 */
export type EnvironmentPersonality = 
  | 'neutral'     // Standard backdrop, doesn't comment on story
  | 'oppressive'  // Looms over characters, claustrophobic, threatening
  | 'protective'  // Shelters characters, warm, enclosed safely
  | 'expansive'   // Opens up, freedom, possibility
  | 'decaying'    // Shows corruption, entropy, consequences
  | 'thriving'    // Shows life, growth, positive change
  | 'liminal'     // Threshold space, between states
  | 'hostile'     // Actively dangerous, harsh
  | 'sacred'      // Special, significant, heightened;

/**
 * How environment reflects story state
 */
export interface EnvironmentSpec {
  // Base personality of this location
  basePersonality: EnvironmentPersonality;
  
  // Current personality (may differ from base based on branch)
  currentPersonality: EnvironmentPersonality;
  
  // Specific visual characteristics
  characteristics: {
    dominantLines: 'vertical' | 'horizontal' | 'diagonal' | 'organic' | 'mixed';
    spaceFeeling: 'cramped' | 'balanced' | 'open' | 'vast';
    lightQuality: 'natural' | 'artificial' | 'mixed' | 'absent';
    stateOfRepair: 'pristine' | 'maintained' | 'worn' | 'damaged' | 'ruined';
  };
  
  // How it frames characters
  characterRelation: 'dwarfs' | 'frames' | 'matches' | 'elevates';
  
  // Branch-based modifications
  branchModifications?: {
    branchType: 'dark' | 'hopeful' | 'neutral';
    personalityShift: EnvironmentPersonality;
    visualChanges: string[]; // e.g., ["more shadows", "broken lights", "graffiti"]
  }[];
  
  // Narrative role
  narrativeFunction: string; // e.g., "Represents the character's mental state"
}

export const ENVIRONMENT_RULES = `
## ENVIRONMENT AS CHARACTER (Eisner Principles)

### ENVIRONMENT PARTICIPATES IN STORY
The setting isn't just backdrop—it comments on, reflects, and influences the narrative.
Eisner used urban spaces to loom over or shelter characters depending on the beat.

### PERSONALITY TYPES
- **oppressive**: Verticals, tight framing, overhead structures, low light → dread
- **protective**: Enclosed warmth, soft light, organic shapes → safety
- **expansive**: Open horizontals, visible sky, depth → possibility
- **decaying**: Damage, debris, broken elements → corruption/consequence
- **thriving**: Growth, repairs, life → positive change
- **liminal**: Doorways, corridors, thresholds → between states

### VISUAL VOCABULARY
- **Dominant lines**: Verticals = authority/oppression; Horizontals = calm/stability; Diagonals = tension/dynamism
- **Space**: Cramped = pressure; Open = freedom
- **State of repair**: Pristine = control; Ruined = chaos/consequence

### CHARACTER-ENVIRONMENT RELATION
- **Dwarfs**: Environment much larger, character small → vulnerability, insignificance
- **Frames**: Environment creates natural frame → focus, importance
- **Matches**: Environment at human scale → normalcy, comfort
- **Elevates**: Character above environment → power, transcendence

### BRANCH SENSITIVITY
Same location should look DIFFERENT based on story path:
- **Corrupt path**: More decay, harsh lighting, broken elements
- **Reform path**: Signs of life, repairs, warmer lighting
- **Neutral**: Unchanged from base state
`;

// ============================================
// CHOICE TELEGRAPHING
// ============================================

/**
 * How images hint at upcoming choices or branch consequences
 */
export interface ChoiceTelegraph {
  // Is this beat near a choice?
  isPreChoice: boolean;
  isPostChoice: boolean;
  
  // For pre-choice beats: subtle visual hints about options
  optionHints?: Array<{
    optionType: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty';
    visualHint: string; // e.g., "warmer light on trusting character's face"
  }>;
  
  // For post-choice beats: visual confirmation of consequence direction
  consequenceSignal?: {
    direction: 'positive' | 'negative' | 'ambiguous';
    visualSignal: string; // e.g., "environment shifts warmer, character relaxes"
  };
  
  // Visual treatment near choices
  choiceProximityTreatment?: {
    slowDown: boolean; // Reduce change magnitude
    simplify: boolean; // Reduce information density
    focusOnActing: boolean; // Emphasize character faces/body language
    leadToUI: boolean; // Composition directs toward choice buttons
  };
}

export const CHOICE_TELEGRAPH_RULES = `
## CHOICE TELEGRAPHING (Branching Narrative)

### PRE-CHOICE BEATS
Before player makes a choice, images should:
- **Slow down**: Micro/small change magnitude
- **Simplify**: Sparse to balanced density, not busy
- **Focus on acting**: Character faces and body language carry stakes
- **Lead to UI**: Composition naturally flows toward choice buttons

### VISUAL HINTS (Subtle)
Without being heavy-handed, images can hint at choice stakes:
- **Trust vs Suspicion**: Trustworthy = more lit face, open posture; Suspicious = more shadow, barriers
- **Action vs Caution**: Action = forward lean, dynamic pose; Caution = withdrawn, protected
- **Kindness vs Cruelty**: Kindness = warm light, soft; Cruelty = harsh contrast, angular

### POST-CHOICE BEATS
After a choice resolves, show consequences visually:
- **Positive consequence**: Environment brightens/warms, characters relax, open space
- **Negative consequence**: Environment darkens/cools, characters tense, compressed space
- **Ambiguous**: Mixed signals, uncertainty in composition

### TELEGRAPHING RULES
1. Never SPOIL the outcome—just create atmosphere appropriate to stakes
2. Player should FEEL the weight of choice before seeing options
3. After choice, visual shift should CONFIRM they've entered a new state
`;

// ============================================
// REDUNDANCY AND ADVANCEMENT CHECK
// ============================================

export type AdvancementType = 
  | 'time'        // Time has passed
  | 'focus'       // Same moment, different focus/subject
  | 'space'       // Location change
  | 'aspect'      // Same moment, mood/atmosphere shift
  | 'revelation'  // New information revealed
  | 'reaction'    // Character response to prior beat
  | 'consequence' // Result of action
  | 'none';       // REDUNDANT - flag for removal/rework

export interface AdvancementCheck {
  advancementType: AdvancementType;
  whatAdvanced: string; // Description of what moved forward
  isRedundant: boolean; // If 'none', this is true
  redundancyReason?: string; // Why this beat doesn't advance story
}

export const ADVANCEMENT_RULES = `
## REDUNDANCY CHECK (Every Beat Must Advance)

### EISNER PRINCIPLE
Every panel must either advance time, shift focus, or shift scene.
If it doesn't, it's probably redundant.

### VALID ADVANCEMENT TYPES
- **time**: Time has passed between this and previous beat
- **focus**: Same moment, but camera/attention shifts to new subject
- **space**: Location has changed
- **aspect**: Same moment, but mood/atmosphere shifts (aspect_to_aspect)
- **revelation**: New information is now visible
- **reaction**: Character responding to what happened in previous beat
- **consequence**: Result of an action from previous beat(s)

### REDUNDANCY FLAGS
A beat is REDUNDANT if:
- Same characters in same poses with no change
- No new information, emotion, or action
- Could be removed without losing story progression

### QA CHECK
For each beat, ask: "What does this image tell/show that the previous one didn't?"
If no good answer → flag for revision or removal.
`;

// ============================================
// SILENT STORYTELLING TEST
// ============================================

export interface SilentStorytellingTest {
  // Could player understand these WITHOUT any text?
  emotionalToneClear: boolean;
  relationshipDynamicClear: boolean;
  situationDirectionClear: boolean; // Getting better or worse?
  
  // What might be unclear without text
  unclearElements?: string[];
  
  // Recommendations if test fails
  recommendations?: string[];
  
  // Overall pass/fail
  passesTest: boolean;
}

export const SILENT_STORYTELLING_RULES = `
## SILENT STORYTELLING TEST (Eisner Principles)

### THE TEST
If all UI text were removed, could the player still understand:
1. **Emotional tone**: What characters are feeling?
2. **Relationship dynamic**: How characters relate to each other?
3. **Direction**: Is the situation getting better or worse?

### WHY THIS MATTERS
Eisner used silent sequences to heighten drama and slow time.
For us, images should do heavy lifting so text can be minimal.

### HIGH-IMPACT BEATS
For major emotional/dramatic beats, consider:
- Minimal or no on-screen text
- Let the image do the heavy lifting
- Choice options can be short since image conveys stakes

### QA CHECK
Run this test especially for:
- Climactic moments
- Emotional reveals
- Relationship turning points
- Post-choice consequence beats

If emotional tone is UNCLEAR from image alone → flag for revision.
`;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Determine appropriate rhythm spec based on beat context
 */
export function suggestRhythmSpec(context: {
  isPreChoice?: boolean;
  isPostChoice?: boolean;
  isClimactic?: boolean;
  isResolution?: boolean;
  isActionSequence?: boolean;
  emotionalIntensity: 'low' | 'medium' | 'high' | 'peak';
}): Partial<RhythmSpec> {
  // Pre-choice: slow down
  if (context.isPreChoice) {
    return {
      role: 'build',
      changeMagnitude: 'micro',
      informationDensity: 'sparse',
      timeFeel: 'stretched',
      isPreChoice: true
    };
  }
  
  // Post-choice: resolution/processing
  if (context.isPostChoice) {
    return {
      role: 'resolution',
      changeMagnitude: 'small',
      informationDensity: 'sparse',
      timeFeel: 'normal',
      isPostChoice: true
    };
  }
  
  // Climactic: spike
  if (context.isClimactic) {
    return {
      role: 'spike',
      changeMagnitude: 'large',
      informationDensity: context.emotionalIntensity === 'peak' ? 'minimal' : 'balanced',
      timeFeel: context.emotionalIntensity === 'peak' ? 'stretched' : 'normal'
    };
  }
  
  // Resolution
  if (context.isResolution) {
    return {
      role: 'resolution',
      changeMagnitude: 'small',
      informationDensity: 'sparse',
      timeFeel: 'normal'
    };
  }
  
  // Action sequence
  if (context.isActionSequence) {
    return {
      role: 'build',
      changeMagnitude: 'large',
      informationDensity: 'balanced',
      timeFeel: 'compressed'
    };
  }
  
  // Default based on intensity
  return {
    role: context.emotionalIntensity === 'high' ? 'build' : 'breather',
    changeMagnitude: context.emotionalIntensity === 'high' ? 'moderate' : 'small',
    informationDensity: 'balanced',
    timeFeel: 'normal'
  };
}

/**
 * Check if a beat advances the story
 */
export function checkAdvancement(
  currentBeat: { action: string; emotion: string; characters?: string[] },
  previousBeat?: { action: string; emotion: string; characters?: string[] },
  transitionType?: string
): AdvancementCheck {
  // No previous beat = always advances
  if (!previousBeat) {
    return {
      advancementType: 'time',
      whatAdvanced: 'First beat of sequence',
      isRedundant: false
    };
  }
  
  // Check transition type for clues
  if (transitionType) {
    if (transitionType === 'scene_to_scene') {
      return { advancementType: 'space', whatAdvanced: 'Location/time changed', isRedundant: false };
    }
    if (transitionType === 'subject_to_subject') {
      return { advancementType: 'focus', whatAdvanced: 'Focus shifted to different subject', isRedundant: false };
    }
    if (transitionType === 'aspect_to_aspect') {
      return { advancementType: 'aspect', whatAdvanced: 'Mood/atmosphere shifted', isRedundant: false };
    }
    if (transitionType === 'action_to_action') {
      return { advancementType: 'time', whatAdvanced: 'Action progressed', isRedundant: false };
    }
    if (transitionType === 'moment_to_moment') {
      // Moment to moment is valid but needs something to change
      if (currentBeat.emotion !== previousBeat.emotion) {
        return { advancementType: 'reaction', whatAdvanced: 'Emotional state changed', isRedundant: false };
      }
    }
  }
  
  // Check for changes
  if (currentBeat.action !== previousBeat.action) {
    return { advancementType: 'time', whatAdvanced: `Action changed: ${currentBeat.action}`, isRedundant: false };
  }
  if (currentBeat.emotion !== previousBeat.emotion) {
    return { advancementType: 'reaction', whatAdvanced: `Emotion shifted: ${currentBeat.emotion}`, isRedundant: false };
  }
  
  // Potentially redundant
  return {
    advancementType: 'none',
    whatAdvanced: '',
    isRedundant: true,
    redundancyReason: 'No change in action, emotion, or focus from previous beat'
  };
}

/**
 * Run silent storytelling test based on beat specification
 */
export function runSilentStorytellingTest(beatSpec: {
  focalEmotion?: string;
  characterEmotions?: Array<{ characterName: string; emotion: string }>;
  bodyLanguageDescribed?: boolean;
  lightingMoodAligned?: boolean;
  relationshipDynamic?: string;
}): SilentStorytellingTest {
  const unclearElements: string[] = [];
  const recommendations: string[] = [];
  
  // Check emotional tone clarity
  let emotionalToneClear = false;
  if (beatSpec.focalEmotion && beatSpec.characterEmotions && beatSpec.characterEmotions.length > 0) {
    if (beatSpec.bodyLanguageDescribed && beatSpec.lightingMoodAligned) {
      emotionalToneClear = true;
    } else {
      if (!beatSpec.bodyLanguageDescribed) {
        unclearElements.push('Character body language not fully specified');
        recommendations.push('Add detailed body language/pose specification');
      }
      if (!beatSpec.lightingMoodAligned) {
        unclearElements.push('Lighting may not match emotional tone');
        recommendations.push('Align lighting with focal emotion');
      }
    }
  } else {
    unclearElements.push('Focal emotion or character emotions not defined');
    recommendations.push('Define focal emotion and per-character emotions');
  }
  
  // Check relationship dynamic clarity
  const relationshipDynamicClear = !!beatSpec.relationshipDynamic;
  if (!relationshipDynamicClear) {
    unclearElements.push('Relationship dynamic not specified');
    recommendations.push('Define how characters relate spatially and emotionally');
  }
  
  // Situation direction is harder to assess structurally
  // Assume it passes if emotion and body language are clear
  const situationDirectionClear = emotionalToneClear;
  
  return {
    emotionalToneClear,
    relationshipDynamicClear,
    situationDirectionClear,
    unclearElements: unclearElements.length > 0 ? unclearElements : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    passesTest: emotionalToneClear && relationshipDynamicClear && situationDirectionClear
  };
}

/**
 * Suggest environment personality based on story context
 */
export function suggestEnvironmentPersonality(context: {
  branchType?: 'dark' | 'hopeful' | 'neutral';
  sceneType?: 'safe_hub' | 'conflict' | 'exploration' | 'climax' | 'resolution';
  emotionalTone?: string;
  isThreshold?: boolean; // Doorway, corridor, between places
}): EnvironmentPersonality {
  // Threshold spaces
  if (context.isThreshold) {
    return 'liminal';
  }
  
  // Branch-based
  if (context.branchType === 'dark') {
    return context.sceneType === 'climax' ? 'hostile' : 'decaying';
  }
  if (context.branchType === 'hopeful') {
    return context.sceneType === 'resolution' ? 'thriving' : 'protective';
  }
  
  // Scene type based
  switch (context.sceneType) {
    case 'safe_hub': return 'protective';
    case 'conflict': return 'oppressive';
    case 'exploration': return 'expansive';
    case 'climax': return 'hostile';
    case 'resolution': return 'neutral';
    default: return 'neutral';
  }
}
