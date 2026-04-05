/**
 * Unified Visual Storytelling System
 * 
 * Combines McCloud's transition theory with Eisner's sequential art principles
 * and cinematic camera language for a complete image-per-beat interactive 
 * storytelling system.
 * 
 * KEY CLARIFICATION: Each beat is ONE full-bleed edge-to-edge image.
 * "Transitions" refer to how story flows from one image to the next,
 * not panels within a single image.
 */

// ============================================
// CAMERA SYSTEM
// ============================================

/**
 * Shot type - what the camera shows and why
 */
export type ShotType = 
  | 'establish'        // Extreme wide - location, scale, world state
  | 'wide'             // Full bodies + environment - action, positioning
  | 'medium'           // Waist up - dialogue, gestures, relationships (WORKHORSE)
  | 'closeup'          // Face/shoulders - emotion, micro-expressions
  | 'extreme_closeup'; // Detail - symbolic emphasis, crucial objects

/**
 * Camera height - psychological positioning
 */
export type CameraHeight = 
  | 'high'   // Looking down - vulnerability, scrutiny, loss of power
  | 'eye'    // Level - neutral, balanced, ordinary
  | 'low';   // Looking up - power, imposing, heroic OR threatening

/**
 * Camera tilt - stability vs unease
 */
export type CameraTilt = 
  | 'straight'      // Normal horizon - stable
  | 'dutch_light'   // Slight tilt - subtle unease
  | 'dutch_strong'; // Strong tilt - disorientation, horror, psychological break

/**
 * Composition type - how many subjects, how arranged
 */
export type CompositionType = 
  | 'single'     // One character focus
  | 'two_shot'   // Two characters, relatively equal
  | 'group'      // Multiple characters
  | 'empty';     // No characters - environment/object focus

/**
 * Point of view - whose perspective
 */
export type CameraPOV = 
  | 'neutral'      // Third-person objective
  | 'player_ots'   // Over player character's shoulder
  | 'npc_ots'      // Over NPC's shoulder
  | 'subjective';  // Player character's literal view

/**
 * Camera side relative to scene axis (180° rule)
 */
export type CameraSide = 'left_of_axis' | 'right_of_axis';

/**
 * Camera change aggressiveness between beats
 */
export type CameraChange = 
  | 'static'      // Minimal change - calm, sustained tension
  | 'moderate'    // Normal variety
  | 'aggressive'; // Rapid changes - action, urgency

/**
 * Complete camera specification for a shot
 */
export interface CameraSpec {
  // What we see
  shotType: ShotType;
  compositionType: CompositionType;
  pov: CameraPOV;
  
  // Psychological angle
  height: CameraHeight;
  tilt: CameraTilt;
  
  // Spatial continuity (180° rule)
  side: CameraSide;
  lineCross: boolean; // TRUE = intentionally crossing the line this beat
  lineCrossReason?: string; // Why we're crossing (power shift, revelation, etc.)
  
  // Change from previous
  changeLevel: CameraChange;
}

/**
 * Shot type guidance - what each shot is for
 */
export const SHOT_TYPE_GUIDE: Record<ShotType, {
  shows: string;
  function: string;
  useFor: string[];
  bestPractices: string[];
}> = {
  'establish': {
    shows: 'Location, environment, scale; characters small or absent',
    function: 'Orient player to where we are and world state',
    useFor: [
      'First image of new location',
      'Scene/branch changes',
      'Big time skips',
      'Showing world consequences (city thriving vs ruined)'
    ],
    bestPractices: [
      'One clear focal point (landmark, building)',
      'Keep characters small - story is about world, not micro-emotion',
      'Tie into branch visual logic (lighting/color differences)'
    ]
  },
  'wide': {
    shows: 'Characters plus environment; full bodies with surrounding space',
    function: 'Show spatial relationships, physical stakes, action',
    useFor: [
      'Action beats',
      'Tactical decisions',
      'Group dynamics',
      'Choices where position matters (who you stand with)'
    ],
    bestPractices: [
      'Clear silhouettes for each character',
      'Use spacing to encode alliances and conflicts',
      'Show escape routes, traps, tactical elements'
    ]
  },
  'medium': {
    shows: 'Waist up; faces + body language + some background',
    function: 'Dialogue, negotiations, relationship beats - YOUR WORKHORSE',
    useFor: [
      'Most conversational beats',
      'Choices about what you say/how you respond',
      'Showing changing dynamics'
    ],
    bestPractices: [
      'This is your DEFAULT - don\'t overuse closeups',
      'Arrange characters in narrative order (left→right: ally→player→antagonist)',
      'Let gestures and posture carry subtext'
    ]
  },
  'closeup': {
    shows: 'Face, shoulders; sometimes hands or important object',
    function: 'Intensify emotion, show micro-expressions, critical moments',
    useFor: [
      'Before or after big choices',
      'Critical reveals, confessions, betrayals',
      'Moments requiring emotional intensity'
    ],
    bestPractices: [
      'USE SPARINGLY so they stay special',
      'Support with body language in adjacent wider shots',
      'Reserve for peak emotional moments'
    ]
  },
  'extreme_closeup': {
    shows: 'Single detail - eyes, trembling hand, object, message',
    function: 'Symbolic emphasis - THIS is the crucial thing right now',
    useFor: [
      'Inserts before actions (knife before "stab or spare")',
      'Punctuating climaxes or turning points',
      'Thematic objects (ring, cracked visor, blinking light)'
    ],
    bestPractices: [
      'Generally 0-1 per important scene - more dilutes impact',
      'Use consistent visual language for recurring motifs',
      'Strong lighting/composition required'
    ]
  }
};

/**
 * Camera angle guidance - psychological effects
 */
export const CAMERA_HEIGHT_GUIDE: Record<CameraHeight, {
  effect: string;
  useFor: string[];
  branchUse: string;
}> = {
  'high': {
    effect: 'Subject appears smaller, weaker, vulnerable, scrutinized',
    useFor: [
      'Character loss of power',
      'Guilt, fear moments',
      'Overwatch perspectives (surveillance, gods-eye)',
      'After defeat or failure'
    ],
    branchUse: 'In "bad" routes, show player character from high angles more when they lose agency'
  },
  'eye': {
    effect: 'Neutral - "we are on the same level"',
    useFor: [
      'Ordinary conversations',
      'Balanced relationships',
      'When you don\'t want to bias perception'
    ],
    branchUse: 'Default for neutral paths; increase in "redemption" routes'
  },
  'low': {
    effect: 'Subject appears powerful, imposing, heroic - OR threatening',
    useFor: [
      'Villain introductions',
      'Ally "level-up" moments',
      'Big speeches, commands',
      'Moments of awe or intimidation'
    ],
    branchUse: 'In power-corrupts path, show player character from low angles as they become more monstrous'
  }
};

/**
 * 180° rule guidance
 */
export const AXIS_CONTINUITY_RULES = `
## 180° RULE (Spatial Continuity)

### Core Concept
Imagine an invisible line through the main axis of interaction (between two characters, 
or between character and object/goal).

**All shots in a sequence should keep the camera on ONE SIDE of this line.**

This keeps left/right relationships consistent:
- Character A stays on the left
- Character B stays on the right
- If you switch sides, they appear to "swap places" → CONFUSING

### Why It Matters
In image-per-beat stories, unexplained left/right flips:
- Make it hard to track who is where
- Break emotional continuity (especially dialogues and fights)
- Disrupt player orientation

### When to INTENTIONALLY Cross the Line
Signal a major shift:
- **Power inversion**: The underdog suddenly gains control
- **Realization/reveal**: Character "sees the world differently"
- **Crossing a boundary**: Through a door, into another dimension, new reality

### If You Cross the Line
- Tag the beat as LINE_CROSS = TRUE with reason
- Use a beat that visually clarifies the new position
- Consider a wide shot showing the new spatial arrangement
`;

/**
 * Camera change guidance
 */
export const CAMERA_CHANGE_RULES = `
## CAMERA CHANGE (Static vs Dynamic)

"Camera movement" in image-per-beat = how shot size and angle CHANGE between beats.

### STATIC (Small/No Change)
**Effect**: Stillness, calm, or sustained tension
**When**: 
- Conversational sequences - drama is in expressions/body
- Pre-choice tension - hold shot, only acting changes
**How**: Keep shot size/angle constant across 2-4 beats

### MODERATE (Normal Variety)
**Effect**: Natural flow, engaging without overwhelming
**When**: Most standard sequences
**How**: Gradual shot size progressions, logical angle shifts

### AGGRESSIVE (Frequent/Big Changes)
**Effect**: Energy, urgency, visual variety
**When**:
- Action sequences, chases
- Rapid-fire decisions
- Emotional spirals
**How**: Jump wide→medium→closeup; aggressive angle changes

### Design Principle
Let CONTENT lead camera movement. Narrative/emotional content matters more than 
movement alone, but movement AMPLIFIES involvement when used correctly.
`;

/**
 * Conversational shot patterns for dialogue sequences
 */
export const CONVERSATIONAL_SHOT_PATTERNS = `
## CONVERSATIONAL SHOT PATTERNS (For Dialogue Sequences)

### OVER-THE-SHOULDER (OTS)
**Setup**: Camera behind one character's shoulder, showing the other character's face
**Effect**: Creates connection between viewer and focal character while showing listener's presence
**POV**: Use 'player_ots' (behind player, facing NPC) or 'npc_ots' (behind NPC, facing player)

**When to Use**:
- Dialogue exchanges - alternating OTS shots
- Building intimacy or confrontation
- Showing spatial relationship between speakers

**180° Rule**: 
- In OTS pattern, ALWAYS stay on same side of the conversation axis
- If Character A is OTS left, when cutting to Character B OTS, B should be on the right

### SHOT-REVERSE-SHOT PATTERN
**Definition**: Alternating between two characters in a conversation
**Typical Flow**: 
1. Medium or closeup of Character A speaking
2. Medium or closeup of Character B reacting/responding
3. Back to Character A, etc.

**Camera Positioning**:
- Both shots should be on the SAME SIDE of the 180° line
- Use matching shot sizes for balanced power
- Use mismatched sizes for power imbalance (dominant character in tighter shot)

**Implementation in Beats**:
- Beat 1: subject_to_subject transition, pov='player_ots' or 'neutral', side='left_of_axis'
- Beat 2: subject_to_subject transition, pov='npc_ots' or 'neutral', side='left_of_axis' (SAME SIDE)
- Continue pattern...

### TWO-SHOT
**Setup**: Both characters visible in same frame
**Effect**: Shows their spatial relationship directly
**When to Use**:
- Establishing conversation geography
- Moments of shared emotion/reaction
- Showing body language interplay

**Shot Sizes for Two-Shot**:
- Wide two-shot: Full bodies, shows environment
- Medium two-shot: Waist up, focus on interaction
- Tight two-shot: Shoulders up, intimate

### GROUP CONVERSATION
**Pattern for 3+ characters**:
- Use triangle staging: speaker, responder, observer
- Establish with wide shot showing all positions
- Use subject_to_subject transitions to cycle between participants
- Return to wider shot periodically to re-establish geography
`;

/**
 * Shot type suggestions based on beat context
 */
export function suggestShotType(context: {
  isNewLocation?: boolean;
  isActionBeat?: boolean;
  isDialogue?: boolean;
  isEmotionalPeak?: boolean;
  isSymbolicMoment?: boolean;
  hasMultipleCharacters?: boolean;
  previousShotType?: ShotType;
}): ShotType {
  // New location → establish
  if (context.isNewLocation) return 'establish';
  
  // Symbolic moment → extreme closeup
  if (context.isSymbolicMoment) return 'extreme_closeup';
  
  // Emotional peak → closeup (but not if previous was also closeup)
  if (context.isEmotionalPeak && context.previousShotType !== 'closeup') {
    return 'closeup';
  }
  
  // Action with multiple characters → wide
  if (context.isActionBeat && context.hasMultipleCharacters) return 'wide';
  
  // Dialogue → medium (the workhorse)
  if (context.isDialogue) return 'medium';
  
  // Default to medium
  return 'medium';
}

/**
 * Camera height suggestion based on power dynamics
 */
export function suggestCameraHeight(context: {
  subjectPowerLevel: 'weak' | 'neutral' | 'powerful';
  isThreateningMoment?: boolean;
  isVulnerableMoment?: boolean;
  isHeroicMoment?: boolean;
}): CameraHeight {
  if (context.isVulnerableMoment || context.subjectPowerLevel === 'weak') {
    return 'high';
  }
  if (context.isHeroicMoment || context.isThreateningMoment || context.subjectPowerLevel === 'powerful') {
    return 'low';
  }
  return 'eye';
}

/**
 * Check if line cross is appropriate
 */
export function shouldCrossLine(context: {
  isPowerInversion?: boolean;
  isMajorRevelation?: boolean;
  isCrossingBoundary?: boolean;
  isPreviousLineCross?: boolean;
}): { shouldCross: boolean; reason?: string } {
  // Never cross twice in a row
  if (context.isPreviousLineCross) {
    return { shouldCross: false };
  }
  
  if (context.isPowerInversion) {
    return { shouldCross: true, reason: 'Power dynamics inverted' };
  }
  if (context.isMajorRevelation) {
    return { shouldCross: true, reason: 'Major revelation - world seen differently' };
  }
  if (context.isCrossingBoundary) {
    return { shouldCross: true, reason: 'Crossing literal/symbolic boundary' };
  }
  
  return { shouldCross: false };
}

/**
 * Build default camera spec
 */
export function buildDefaultCameraSpec(
  shotType: ShotType = 'medium',
  height: CameraHeight = 'eye',
  previousSide?: CameraSide
): CameraSpec {
  return {
    shotType,
    compositionType: 'single',
    pov: 'neutral',
    height,
    tilt: 'straight',
    side: previousSide || 'left_of_axis',
    lineCross: false,
    changeLevel: 'moderate'
  };
}

// ============================================
// TEXTURE SYSTEM
// ============================================

/**
 * Texture density - overall amount of visible texture detail
 */
export type TextureDensity = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Texture scale - size of texture features relative to objects
 */
export type TextureScale = 'coarse' | 'normal' | 'fine';

/**
 * Texture contrast - how much light/dark variation texture adds
 */
export type TextureContrast = 'soft' | 'normal' | 'strong';

/**
 * Texture shape alignment - whether texture follows form or is flat
 */
export type TextureShapeAlignment = 'follow_form' | 'flat_pattern';

/**
 * Texture focus - where texture carries most visual interest
 */
export type TextureFocus = 'minimal' | 'characters' | 'environment' | 'both';

/**
 * Surface roughness - material quality from smooth to rough
 */
export type SurfaceRoughness = 'smooth' | 'low' | 'medium' | 'high' | 'rough';

/**
 * Complete texture specification for a shot
 */
export interface TextureSpec {
  // Global settings
  focus: TextureFocus;
  shapeAlignment: TextureShapeAlignment;
  
  // Foreground (characters, key props)
  foregroundDensity: TextureDensity;
  foregroundRoughness: SurfaceRoughness;
  
  // Environment/background
  backgroundDensity: TextureDensity;
  backgroundRoughness: SurfaceRoughness;
  
  // Scale & contrast
  scale: TextureScale;
  contrast: TextureContrast;
  
  // Protection zones (defaults to true)
  protectFacesAndHands: boolean;
  protectSilhouettes: boolean;
  
  // Special notes for prompt generation
  materialNotes?: string;
  wearNotes?: string;
}

/**
 * Texture rules - core principles
 */
export const TEXTURE_RULES = `
## TEXTURE PRINCIPLES

### 1. READABILITY FIRST
- Texture must NOT obscure silhouettes, facial acting, or critical props
- If texture competes with the focal point, it's TOO STRONG there
- At game/phone scale, readability beats detail

### 2. TEXTURE FOLLOWS FORM
- Surface marks should wrap around 3D volume
- "Stickered-on" flat patterns break believability
- Texture supports sense of shape and depth

### 3. TEXTURE SUPPORTS MOOD
- Rough/broken/noisy → tension, grit, chaos
- Smooth/blended/soft → calm, safety, intimacy
- This is a PACING tool - more texture = more visual energy

### 4. HIERARCHY OF TEXTURE
- **Focal areas (face, hands, key props)**: MINIMAL texture
- **Foreground/main subjects**: Medium detail, shows material but doesn't overpower
- **Secondary elements**: Softer, simpler
- **Background**: Very simplified, large-scale only

### 5. PROTECT SILHOUETTES
- Avoid heavy/noisy texture on character outer contours
- Keep edges cleaner so shapes read quickly
- Grit/grain stays INSIDE shapes, not on edges
`;

/**
 * Material behavior guidance
 */
export const MATERIAL_TEXTURE_GUIDE = `
## MATERIAL BEHAVIOR

### HARD SURFACES (metal, stone, plastic, glass)
- Sharper transitions between light/dark
- More defined highlights, crisper micro-detail
- Wear follows usage patterns: edges, moving parts, contact points

### SOFT SURFACES (fabric, skin, foliage)
- Gradual transitions, patterns follow folding/stretching/curvature
- Few hard edges
- Structure in folds, pores, leaf veins

### ROUGHNESS → MOOD
- **Smooth/low-roughness**: Clean, tech, sterility, idealized, emotional simplicity
- **Rough/high-roughness**: Decay, chaos, tension, age, grounded realism

### BRANCH MAPPING
- Dark/corrupt path → Increase env roughness, more wear, chipped surfaces
- Hopeful path → Smoother surfaces, less noise, cleaner materials
- Safe hub → Minimal texture, smooth, welcoming
`;

/**
 * Texture derivation from mood/context
 */
export const TEXTURE_MOOD_MAP: Record<string, Partial<TextureSpec>> = {
  'chaotic': {
    backgroundRoughness: 'high',
    backgroundDensity: 'high',
    contrast: 'strong',
    foregroundDensity: 'medium' // Cap to preserve acting
  },
  'tense': {
    backgroundRoughness: 'medium',
    backgroundDensity: 'medium',
    contrast: 'normal'
  },
  'calm': {
    backgroundRoughness: 'low',
    backgroundDensity: 'low',
    foregroundDensity: 'minimal',
    contrast: 'soft'
  },
  'safe': {
    backgroundRoughness: 'smooth',
    backgroundDensity: 'minimal',
    foregroundDensity: 'minimal',
    contrast: 'soft'
  },
  'gritty': {
    backgroundRoughness: 'rough',
    backgroundDensity: 'high',
    contrast: 'strong',
    wearNotes: 'visible scratches, chipped paint, cracks'
  },
  'clean': {
    backgroundRoughness: 'smooth',
    backgroundDensity: 'minimal',
    foregroundRoughness: 'smooth',
    contrast: 'soft'
  },
  'nostalgic': {
    backgroundRoughness: 'low',
    backgroundDensity: 'low',
    contrast: 'soft',
    materialNotes: 'subtle paper-like grain, faded edges, patina'
  },
  'horror': {
    backgroundRoughness: 'high',
    backgroundDensity: 'high',
    contrast: 'strong',
    wearNotes: 'decay, organic growth, disturbing textures'
  }
};

/**
 * Branch type texture modifiers
 */
export const BRANCH_TEXTURE_MAP: Record<string, Partial<TextureSpec>> = {
  'dark': {
    backgroundRoughness: 'high',
    backgroundDensity: 'high',
    wearNotes: 'visible wear, decay, damage accumulating'
  },
  'hopeful': {
    backgroundRoughness: 'low',
    foregroundRoughness: 'smooth',
    backgroundDensity: 'low',
    wearNotes: 'signs of repair, cleaner surfaces'
  },
  'neutral': {
    backgroundRoughness: 'medium',
    backgroundDensity: 'medium'
  }
};

/**
 * Suggest texture spec based on context
 */
export function suggestTextureSpec(context: {
  mood?: string;
  branchType?: 'dark' | 'hopeful' | 'neutral';
  sceneTone?: 'chaotic' | 'tense' | 'calm' | 'safe';
  focalPriority?: 'acting' | 'environment' | 'prop';
  emotionalIntensity?: 'low' | 'medium' | 'high' | 'peak';
  isSafeHub?: boolean;
  isActionSequence?: boolean;
}): TextureSpec {
  // Start with defaults
  const spec: TextureSpec = {
    focus: 'both',
    shapeAlignment: 'follow_form',
    foregroundDensity: 'low',
    foregroundRoughness: 'low',
    backgroundDensity: 'medium',
    backgroundRoughness: 'medium',
    scale: 'normal',
    contrast: 'normal',
    protectFacesAndHands: true,
    protectSilhouettes: true
  };

  // Apply mood overrides
  if (context.mood && TEXTURE_MOOD_MAP[context.mood]) {
    Object.assign(spec, TEXTURE_MOOD_MAP[context.mood]);
  }

  // Apply scene tone
  if (context.sceneTone && TEXTURE_MOOD_MAP[context.sceneTone]) {
    Object.assign(spec, TEXTURE_MOOD_MAP[context.sceneTone]);
  }

  // Apply branch type
  if (context.branchType && BRANCH_TEXTURE_MAP[context.branchType]) {
    Object.assign(spec, BRANCH_TEXTURE_MAP[context.branchType]);
  }

  // Safe hub override
  if (context.isSafeHub) {
    spec.backgroundRoughness = 'smooth';
    spec.backgroundDensity = 'minimal';
    spec.foregroundDensity = 'minimal';
    spec.contrast = 'soft';
  }

  // Focal priority adjustments
  if (context.focalPriority === 'acting') {
    spec.focus = 'environment'; // Texture on env, not characters
    spec.foregroundDensity = 'minimal';
    spec.foregroundRoughness = 'smooth';
  } else if (context.focalPriority === 'environment') {
    spec.focus = 'environment';
  }

  // High emotional intensity = simplify texture to let acting dominate
  if (context.emotionalIntensity === 'high' || context.emotionalIntensity === 'peak') {
    spec.foregroundDensity = 'minimal';
    spec.contrast = 'soft';
  }

  // Action sequence = moderate texture, don't obscure movement
  if (context.isActionSequence) {
    spec.foregroundDensity = 'low';
    spec.scale = 'coarse'; // Larger texture reads better in motion
  }

  return spec;
}

/**
 * Build default texture spec
 */
export function buildDefaultTextureSpec(): TextureSpec {
  return {
    focus: 'both',
    shapeAlignment: 'follow_form',
    foregroundDensity: 'low',
    foregroundRoughness: 'low',
    backgroundDensity: 'medium',
    backgroundRoughness: 'medium',
    scale: 'normal',
    contrast: 'normal',
    protectFacesAndHands: true,
    protectSilhouettes: true
  };
}

/**
 * Generate texture prompt fragment
 */
export function generateTexturePrompt(spec: TextureSpec): string {
  const parts: string[] = [];

  // Shape alignment
  if (spec.shapeAlignment === 'follow_form') {
    parts.push('texture follows form and wraps around 3D volumes');
  }

  // Protection
  if (spec.protectSilhouettes) {
    parts.push('clear readable silhouettes with clean edges');
  }
  if (spec.protectFacesAndHands) {
    parts.push('minimal texture on faces and hands for expression clarity');
  }

  // Character/foreground texture
  const fgDesc = {
    'minimal': 'very subtle texture on characters',
    'low': 'light texture on characters showing material but not overpowering',
    'medium': 'moderate character texture',
    'high': 'detailed character texture'
  }[spec.foregroundDensity];
  parts.push(fgDesc);

  // Environment/background texture
  const bgRoughDesc = {
    'smooth': 'smooth clean environment surfaces',
    'low': 'subtle environment texture',
    'medium': 'moderate environment texture and surface detail',
    'high': 'detailed rough environment textures',
    'rough': 'heavy worn rough textures on environment'
  }[spec.backgroundRoughness];
  parts.push(bgRoughDesc);

  // Contrast
  if (spec.contrast === 'soft') {
    parts.push('soft low-contrast texture transitions');
  } else if (spec.contrast === 'strong') {
    parts.push('strong texture contrast for visual impact');
  }

  // Scale
  if (spec.scale === 'coarse') {
    parts.push('coarse large-scale texture features');
  } else if (spec.scale === 'fine') {
    parts.push('fine detailed texture');
  }

  // Special notes
  if (spec.wearNotes) {
    parts.push(spec.wearNotes);
  }
  if (spec.materialNotes) {
    parts.push(spec.materialNotes);
  }

  return parts.join('; ');
}

/**
 * Validate texture spec structure
 */
export function validateTextureSpec(spec: TextureSpec): {
  isValid: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Protection should almost always be on
  if (!spec.protectFacesAndHands) {
    warnings.push('protectFacesAndHands is off - faces may be over-textured');
  }
  if (!spec.protectSilhouettes) {
    warnings.push('protectSilhouettes is off - edges may be unclear');
  }

  // Shape alignment should be follow_form by default
  if (spec.shapeAlignment === 'flat_pattern') {
    warnings.push('flat_pattern texture may break believability');
  }

  // Check for conflicting specs
  if (spec.foregroundDensity === 'high' && spec.protectFacesAndHands) {
    warnings.push('High foreground density may conflict with face/hand protection');
  }

  // Background should generally have more texture than foreground
  const densityOrder = ['minimal', 'low', 'medium', 'high'];
  if (densityOrder.indexOf(spec.foregroundDensity) > densityOrder.indexOf(spec.backgroundDensity)) {
    warnings.push('Foreground texture higher than background - unusual hierarchy');
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}

// ============================================
// PERSPECTIVE & SPATIAL ENVIRONMENT SYSTEM
// ============================================

/**
 * Perspective type - how vanishing points are arranged
 */
export type PerspectiveType = 
  | 'one_point'    // Single VP - corridors, confrontations, formal/stable
  | 'two_point'    // Two horizon VPs - naturalistic, most common
  | 'three_point'  // Two horizon + vertical VP - epic scale, vertigo
  | 'implied';     // Loose/atmospheric, no strict geometry

/**
 * Depth layers - how many planes of depth
 */
export type DepthLayers = 2 | 3;

/**
 * Staging pattern - how characters are arranged in space
 */
export type StagingPattern = 
  | 'linear'      // In a line (confrontation, face-off)
  | 'triangle'    // Three points - stable, dynamic group
  | 'cluster'     // Grouped close together
  | 'isolated'    // Single character alone in space
  | 'scattered'   // Multiple spread across space
  | 'diagonal';   // Arranged on a diagonal for depth

/**
 * Character distance - spatial relationship encoding
 */
export type CharacterDistance = 
  | 'intimate'    // Very close - alliance, complicity, romance
  | 'neutral'     // Normal conversational distance
  | 'distant';    // Far apart - conflict, emotional distance

/**
 * Character orientation - how bodies face
 */
export type CharacterOrientation = 
  | 'facing_each_other'  // Engagement
  | 'facing_away'        // Disagreement/withdrawal
  | 'facing_same_direction'  // Shared goal
  | 'mixed';             // Complex dynamics

/**
 * Complete spatial specification
 */
export interface SpatialSpec {
  // Perspective
  perspectiveType: PerspectiveType;
  vanishingPointPlacement?: 'behind_subject' | 'offset' | 'centered';
  
  // Depth
  depthLayers: DepthLayers;
  foregroundElement?: string;   // "doorframe", "railing", "shoulder"
  midgroundContent: string;     // Main action/characters
  backgroundContent?: string;   // Environment context
  
  // Staging
  stagingPattern: StagingPattern;
  characterDistance?: CharacterDistance;
  characterOrientation?: CharacterOrientation;
  
  // Consistency
  maintainPerspectiveFromPrevious: boolean;
  maintainHorizonFromPrevious: boolean;
  perspectiveChangeReason?: string;
  
  // Choice visibility (for pre-choice beats)
  showExits?: boolean;
  showCover?: boolean;
  spatialChoicesVisible?: string[];
}

/**
 * Perspective type guidance
 */
export const PERSPECTIVE_TYPE_GUIDE: Record<PerspectiveType, {
  description: string;
  emotionalUse: string;
  bestFor: string[];
  avoid: string[];
}> = {
  'one_point': {
    description: 'Single vanishing point on horizon - lines converge to center',
    emotionalUse: 'Stable, formal, orderly; can feel locked-in or confrontational',
    bestFor: [
      'Corridors, long halls, throne rooms',
      'Direct confrontations (subject centered)',
      'Decision beats with authority/choice "ahead"',
      'Hubs and established safe spaces'
    ],
    avoid: ['Overuse - makes scenes feel like flat stage sets']
  },
  'two_point': {
    description: 'Two vanishing points on horizon - most naturalistic',
    emotionalUse: 'Balanced dynamism, cinematic, realistic depth',
    bestFor: [
      'City streets, interiors with corners',
      'Dialogue scenes needing depth',
      'Action where position matters',
      'Most standard scenes (DEFAULT)'
    ],
    avoid: ['Drifting VPs to different vertical levels']
  },
  'three_point': {
    description: 'Two horizon VPs + vertical VP - tall tilt or deep drop',
    emotionalUse: 'Unease, vertigo, epic scale, insignificance',
    bestFor: [
      'Large structures (mechs, towers, megacities)',
      'Edge moments (rooftops, cliffs, shafts)',
      'Psychological instability',
      'Awe-inspiring reveals'
    ],
    avoid: ['Overuse - loses impact; only for special moments']
  },
  'implied': {
    description: 'Loose atmospheric perspective, no strict geometry',
    emotionalUse: 'Dreamlike, abstract, emotional rather than spatial',
    bestFor: [
      'Dreams, visions, memories',
      'Highly emotional/abstract moments',
      'Stylized or surreal sequences'
    ],
    avoid: ['When spatial clarity is important']
  }
};

/**
 * Staging pattern guidance
 */
export const STAGING_PATTERN_GUIDE: Record<StagingPattern, {
  description: string;
  useFor: string[];
  depthAdvantage: string;
}> = {
  'linear': {
    description: 'Characters arranged in a line, often facing each other',
    useFor: ['Confrontations', 'Face-offs', 'Formal meetings', 'Standoffs'],
    depthAdvantage: 'Use offset angles to add depth to linear arrangements'
  },
  'triangle': {
    description: 'Three positions forming a triangle - classic film blocking',
    useFor: ['Group conversations', 'Three-way dynamics', 'Speaker-responder-observer'],
    depthAdvantage: 'Natural depth with one point closer to camera'
  },
  'cluster': {
    description: 'Characters grouped close together',
    useFor: ['Team huddles', 'Intimacy', 'Shared secrets', 'Unity moments'],
    depthAdvantage: 'Compact but can layer foreground/background elements'
  },
  'isolated': {
    description: 'Single character alone in space',
    useFor: ['Loneliness', 'Vulnerability', 'Contemplation', 'Power (dominating space)'],
    depthAdvantage: 'Environment becomes more prominent in depth layers'
  },
  'scattered': {
    description: 'Multiple characters spread across the space',
    useFor: ['Chaos', 'Aftermath', 'Search scenes', 'Tactical situations'],
    depthAdvantage: 'Natural multiple depth planes'
  },
  'diagonal': {
    description: 'Characters arranged on a diagonal line into depth',
    useFor: ['Walking together', 'Pursuit', 'Natural depth emphasis'],
    depthAdvantage: 'Maximizes depth perception'
  }
};

/**
 * Spatial rules for consistency
 */
export const SPATIAL_CONSISTENCY_RULES = `
## SPATIAL CONSISTENCY RULES

### PERSPECTIVE CONSISTENCY
- Same scene = same perspective TYPE
- Don't jump between 1-point and 3-point randomly
- Only change perspective for deliberate effect (reveal, shift in power)

### HORIZON LINE STABILITY
- Camera height should remain stable within a scene
- Random horizon jumps break spatial understanding
- Only shift horizon for intentional emotional effect

### DEPTH LAYERS REQUIRED
- Always aim for at least 2 depth layers
- 3 layers (FG/MG/BG) creates strongest sense of space
- Foreground elements frame and add depth
- Background provides context

### NO FLAT STAGING
- Don't line everyone up perpendicular to camera
- Offset characters in depth
- Use 2-point perspective for naturalistic scenes
- Use foreground objects or OTS framing

### VANISHING POINT COHERENCE
- Parallel lines must converge to same point
- Inconsistent VPs = "warped" or "melting" geometry
- Track scene perspective type for consistency
`;

/**
 * Branch-specific spatial logic
 */
export const BRANCH_SPATIAL_MAP: Record<string, Partial<SpatialSpec>> = {
  'power': {
    // Player gaining power - low horizon, closer staging
    vanishingPointPlacement: 'behind_subject',
    stagingPattern: 'linear',
    characterDistance: 'neutral'
  },
  'helpless': {
    // Player losing agency - high angles, isolated, big empty spaces
    stagingPattern: 'isolated',
    characterDistance: 'distant'
  },
  'paranoia': {
    // Conspiracy/paranoia - 3-point, looming architecture
    perspectiveType: 'three_point',
    stagingPattern: 'scattered'
  },
  'intimate': {
    // Close relationships - cluster staging, intimate distance
    stagingPattern: 'cluster',
    characterDistance: 'intimate'
  }
};

/**
 * Suggest perspective type based on context
 */
export function suggestPerspectiveType(context: {
  environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale' | 'abstract';
  isConfrontation?: boolean;
  isEpicReveal?: boolean;
  isDream?: boolean;
  isVertigo?: boolean;
}): PerspectiveType {
  if (context.isDream) return 'implied';
  if (context.isEpicReveal || context.isVertigo) return 'three_point';
  if (context.isConfrontation || context.environmentType === 'corridor') return 'one_point';
  if (context.environmentType === 'epic_scale') return 'three_point';
  if (context.environmentType === 'abstract') return 'implied';
  
  // Default to two_point for most naturalistic scenes
  return 'two_point';
}

/**
 * Suggest staging pattern based on context
 */
export function suggestStagingPattern(context: {
  characterCount: number;
  relationshipDynamic?: 'tense' | 'friendly' | 'neutral' | 'intimate' | 'chaotic';
  isConfrontation?: boolean;
  isGroupDiscussion?: boolean;
  isSoloMoment?: boolean;
}): StagingPattern {
  if (context.isSoloMoment || context.characterCount === 1) return 'isolated';
  if (context.isConfrontation && context.characterCount === 2) return 'linear';
  if (context.isGroupDiscussion && context.characterCount === 3) return 'triangle';
  if (context.relationshipDynamic === 'chaotic') return 'scattered';
  if (context.relationshipDynamic === 'intimate') return 'cluster';
  if (context.characterCount >= 4) return 'scattered';
  if (context.characterCount === 3) return 'triangle';
  
  return 'diagonal'; // Good default for 2 characters
}

/**
 * Suggest character distance based on relationship
 */
export function suggestCharacterDistance(context: {
  relationshipType?: 'allies' | 'enemies' | 'strangers' | 'lovers' | 'family';
  emotionalState?: 'warm' | 'cold' | 'neutral' | 'tense';
  isConflict?: boolean;
}): CharacterDistance {
  if (context.isConflict || context.emotionalState === 'cold') return 'distant';
  if (context.relationshipType === 'lovers' || context.relationshipType === 'family') return 'intimate';
  if (context.emotionalState === 'warm' || context.relationshipType === 'allies') return 'intimate';
  if (context.relationshipType === 'enemies' || context.relationshipType === 'strangers') return 'distant';
  
  return 'neutral';
}

/**
 * Suggest complete spatial spec based on context
 */
export function suggestSpatialSpec(context: {
  environmentType?: 'corridor' | 'room' | 'exterior' | 'city' | 'epic_scale' | 'abstract';
  characterCount?: number;
  relationshipDynamic?: 'tense' | 'friendly' | 'neutral' | 'intimate' | 'chaotic';
  branchType?: 'power' | 'helpless' | 'paranoia' | 'intimate' | 'neutral';
  isConfrontation?: boolean;
  isEpicReveal?: boolean;
  isDream?: boolean;
  isPreChoice?: boolean;
  showExits?: boolean;
}): SpatialSpec {
  const perspectiveType = suggestPerspectiveType(context);
  const stagingPattern = suggestStagingPattern({
    characterCount: context.characterCount || 1,
    relationshipDynamic: context.relationshipDynamic,
    isConfrontation: context.isConfrontation,
    isSoloMoment: context.characterCount === 1
  });
  const characterDistance = suggestCharacterDistance({
    emotionalState: context.relationshipDynamic === 'tense' ? 'tense' : 
                    context.relationshipDynamic === 'intimate' ? 'warm' : 'neutral'
  });

  const spec: SpatialSpec = {
    perspectiveType,
    depthLayers: 3,
    midgroundContent: 'main characters and action',
    stagingPattern,
    characterDistance,
    maintainPerspectiveFromPrevious: true,
    maintainHorizonFromPrevious: true
  };

  // Apply branch overrides
  if (context.branchType && BRANCH_SPATIAL_MAP[context.branchType]) {
    Object.assign(spec, BRANCH_SPATIAL_MAP[context.branchType]);
  }

  // Pre-choice visibility
  if (context.isPreChoice) {
    spec.showExits = context.showExits;
  }

  return spec;
}

/**
 * Build default spatial spec
 */
export function buildDefaultSpatialSpec(): SpatialSpec {
  return {
    perspectiveType: 'two_point',
    depthLayers: 3,
    midgroundContent: 'main subject',
    stagingPattern: 'diagonal',
    maintainPerspectiveFromPrevious: true,
    maintainHorizonFromPrevious: true
  };
}

/**
 * Generate spatial prompt fragment
 */
export function generateSpatialPrompt(spec: SpatialSpec): string {
  const parts: string[] = [];

  // Perspective
  const perspectiveDesc = {
    'one_point': 'one-point perspective with central vanishing point',
    'two_point': 'naturalistic two-point perspective with angled planes',
    'three_point': 'dramatic three-point perspective with vertical convergence',
    'implied': 'atmospheric perspective with loose spatial geometry'
  }[spec.perspectiveType];
  parts.push(perspectiveDesc);

  // Vanishing point placement
  if (spec.vanishingPointPlacement === 'behind_subject') {
    parts.push('vanishing point behind main subject for dominance');
  }

  // Depth layers
  if (spec.depthLayers === 3) {
    parts.push('clear foreground-midground-background depth layers');
    if (spec.foregroundElement) {
      parts.push(`foreground element: ${spec.foregroundElement}`);
    }
    if (spec.backgroundContent) {
      parts.push(`background showing: ${spec.backgroundContent}`);
    }
  } else {
    parts.push('distinct depth layers');
  }

  // Staging
  const stagingDesc = {
    'linear': 'characters staged in confrontational line',
    'triangle': 'triangle blocking for dynamic group composition',
    'cluster': 'characters clustered close together',
    'isolated': 'character isolated in space',
    'scattered': 'characters spread across the scene',
    'diagonal': 'diagonal staging for natural depth'
  }[spec.stagingPattern];
  parts.push(stagingDesc);

  // Character distance
  if (spec.characterDistance) {
    const distDesc = {
      'intimate': 'intimate close spacing between characters',
      'neutral': 'natural conversational distance',
      'distant': 'significant space between characters showing distance'
    }[spec.characterDistance];
    parts.push(distDesc);
  }

  // Orientation
  if (spec.characterOrientation) {
    const orientDesc = {
      'facing_each_other': 'characters turned toward each other in engagement',
      'facing_away': 'one character turned away showing disagreement',
      'facing_same_direction': 'characters facing same direction with shared focus',
      'mixed': 'mixed orientations showing complex dynamics'
    }[spec.characterOrientation];
    parts.push(orientDesc);
  }

  return parts.join('; ');
}

/**
 * Validate spatial spec structure
 */
export function validateSpatialSpec(spec: SpatialSpec): {
  isValid: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Must have midground content
  if (!spec.midgroundContent) {
    issues.push('Missing midgroundContent - what is the main subject?');
  }

  // 3-point perspective should be rare
  if (spec.perspectiveType === 'three_point') {
    warnings.push('Three-point perspective should be used sparingly for impact');
  }

  // Implied perspective needs reason
  if (spec.perspectiveType === 'implied' && !spec.perspectiveChangeReason) {
    warnings.push('Implied perspective unusual - consider adding reason');
  }

  // Check depth layer completeness
  if (spec.depthLayers === 3 && !spec.foregroundElement && !spec.backgroundContent) {
    warnings.push('3 depth layers specified but FG/BG elements not defined');
  }

  // Isolated staging with intimate distance is contradictory
  if (spec.stagingPattern === 'isolated' && spec.characterDistance === 'intimate') {
    issues.push('Isolated staging cannot have intimate character distance');
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Check spatial consistency between beats
 */
export function checkSpatialConsistency(
  current: SpatialSpec,
  previous: SpatialSpec,
  isSameScene: boolean
): { isConsistent: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!isSameScene) {
    return { isConsistent: true, issues: [] };
  }

  // Perspective should be consistent within scene
  if (current.perspectiveType !== previous.perspectiveType && 
      current.maintainPerspectiveFromPrevious && 
      !current.perspectiveChangeReason) {
    issues.push(`Perspective changed from ${previous.perspectiveType} to ${current.perspectiveType} without reason`);
  }

  return {
    isConsistent: issues.length === 0,
    issues
  };
}

// ============================================
// SILHOUETTE & IMPACT COMPOSITION SYSTEM
// ============================================

/**
 * Beat-level silhouette specification
 * References character silhouette profiles but specifies THIS beat's pose goals
 */
export interface BeatSilhouetteSpec {
  // How the pose should read when filled solid black
  poseGoal: string;  // "clear arm separation from body, head distinct, legs staggered"
  
  // What needs visible gaps (negative space)
  negativeSpaceFocus: string[];  // ["between arms and body", "between characters"]
  
  // Which character silhouette hooks should be prominent this beat
  hooksToEmphasize: string[];  // ["cape flow", "weapon silhouette", "distinctive hair"]
  
  // What should NOT merge in silhouette
  avoidMerging: string[];  // ["arm with torso", "characters with each other", "weapon with body"]
  
  // Group scene separation
  maintainCharacterSeparation: boolean;  // For group scenes, keep silhouettes distinct
}

/**
 * Impact target types
 */
export type ImpactTarget = 'character' | 'camera' | 'object' | 'environment';

/**
 * Detail priority around impact
 */
export type DetailPriority = 'low_at_impact' | 'uniform' | 'high_at_impact';

/**
 * Impact/punch composition specification
 * Defines the focal gesture and how to compose around it
 */
export interface ImpactSpec {
  // The key physical gesture of this beat ("the punch")
  punchAction: string;  // "slams fist on table", "reaches for injured ally", "points accusingly"
  
  // Who performs the focal action
  punchOwner: string;  // Character ID or name
  
  // What the action is directed at
  punchTarget: ImpactTarget;
  targetDetail?: string;  // "CHAR_B", "the door", "the player/camera"
  
  // Should the limb be foreshortened toward camera for impact?
  foreshorten: boolean;
  
  // What is the largest/clearest shape in frame
  impactFocus: string;  // "fist and forearm", "both reaching hands", "pointed finger"
  
  // Environmental/character elements pointing to impact
  leadingLines?: string[];  // ["floor perspective", "debris trail", "other characters' gazes"]
  
  // Detail distribution (simplify near impact for clarity)
  detailPriority: DetailPriority;
  
  // Additional composition notes
  compositionNotes?: string;
}

/**
 * Silhouette composition rules
 */
export const SILHOUETTE_POSE_RULES = `
## BEAT-LEVEL SILHOUETTE RULES

### BLACK FILL TEST (Every Beat)
Each beat's pose should pass the black fill test:
- Fill subjects solid black
- Can you identify who is who?
- Can you see what action is happening?
- Are limbs and props distinct?

### NEGATIVE SPACE REQUIREMENTS
- Arms should NOT rest flush against torso
- Create gaps: elbows out, hands away from hips
- Legs staggered, not perfectly parallel
- In groups, separate character silhouettes

### POSE GOAL
For each beat, define:
- Which limbs need separation
- Which props should be distinct
- How characters relate spatially

### AVOID MERGING
Explicitly list what should NOT overlap:
- Arm with torso (common mistake)
- Weapon with body
- Characters into single blob (unless intentional)
`;

/**
 * Impact composition rules
 */
export const IMPACT_COMPOSITION_RULES = `
## COMPOSE AROUND THE PUNCH

### IDENTIFY THE PUNCH
Every beat has a "punch" - the key action/emotional gesture:
- Physical: strike, grab, throw, slam
- Emotional: reach out, turn away, collapse, embrace
- Reveal: open door, pull curtain, show object

### MAKE THE PUNCH DOMINANT
1. **Largest shape**: Punch gesture = biggest, clearest element
2. **Foreshorten**: Push the limb toward camera for impact
3. **Leading lines**: Environment points TO the punch
4. **Simplify at impact**: Low detail near punch, detail in periphery

### FORESHORTENING TECHNIQUE
- Hand/fist/weapon visibly closer to camera than torso
- Creates "coming at you" energy
- Use for: action climaxes, confrontations, decisive moments

### LEADING LINES
Direct viewer's eye to impact:
- Environment lines (walls, floor, stairs)
- Character gazes
- Motion trails, debris, effects
- Light beams

### DETAIL PRIORITY
- **low_at_impact**: Simplify background near punch for clarity (RECOMMENDED)
- **uniform**: Even detail distribution
- **high_at_impact**: Rare - only for revealing intricate focal object
`;

/**
 * Suggest silhouette spec for a beat
 */
export function suggestBeatSilhouetteSpec(context: {
  characterCount: number;
  hasWeapons?: boolean;
  hasFlowingCostume?: boolean;
  isActionBeat?: boolean;
  characterHooks?: string[][];  // Array of hooks per character
}): BeatSilhouetteSpec {
  const negativeSpaceFocus: string[] = ['between arms and body'];
  const avoidMerging: string[] = ['arm with torso'];
  const hooksToEmphasize: string[] = [];

  // Multiple characters need separation
  if (context.characterCount > 1) {
    negativeSpaceFocus.push('between characters');
    avoidMerging.push('characters merging into single mass');
  }

  // Weapons need to be visible
  if (context.hasWeapons) {
    negativeSpaceFocus.push('between weapon and body');
    avoidMerging.push('weapon overlapping body silhouette');
  }

  // Flowing costume is a hook
  if (context.hasFlowingCostume) {
    hooksToEmphasize.push('cape/coat flow');
  }

  // Gather character hooks
  if (context.characterHooks) {
    for (const hooks of context.characterHooks) {
      if (hooks.length > 0) {
        hooksToEmphasize.push(hooks[0]); // Most important hook per character
      }
    }
  }

  // Action beats need dynamic poses
  const poseGoal = context.isActionBeat
    ? 'dynamic pose with clear limb separation, weight shift visible, action line readable'
    : 'clear silhouette with arms separated from torso, head distinct from shoulders';

  return {
    poseGoal,
    negativeSpaceFocus,
    hooksToEmphasize,
    avoidMerging,
    maintainCharacterSeparation: context.characterCount > 1
  };
}

/**
 * Suggest impact spec for a beat
 */
export function suggestImpactSpec(context: {
  beatType: 'action' | 'emotional' | 'reveal' | 'dialogue' | 'transition';
  focalGesture?: string;
  focalCharacter?: string;
  targetCharacter?: string;
  isClimax?: boolean;
}): ImpactSpec | undefined {
  // Dialogue and transition beats may not have strong impact
  if (context.beatType === 'dialogue' && !context.isClimax) {
    return undefined;
  }
  if (context.beatType === 'transition') {
    return undefined;
  }

  const foreshorten = context.beatType === 'action' || context.isClimax;
  
  let punchAction = context.focalGesture || '';
  let punchTarget: ImpactTarget = 'camera';
  
  if (!punchAction) {
    switch (context.beatType) {
      case 'action':
        punchAction = 'key physical action';
        punchTarget = context.targetCharacter ? 'character' : 'camera';
        break;
      case 'emotional':
        punchAction = 'emotional gesture';
        punchTarget = context.targetCharacter ? 'character' : 'camera';
        break;
      case 'reveal':
        punchAction = 'revealing gesture';
        punchTarget = 'object';
        break;
    }
  }

  return {
    punchAction,
    punchOwner: context.focalCharacter || 'protagonist',
    punchTarget,
    targetDetail: context.targetCharacter,
    foreshorten,
    impactFocus: foreshorten ? 'foreshortened limb toward camera' : 'focal gesture area',
    leadingLines: ['character gazes', 'environmental lines'],
    detailPriority: foreshorten ? 'low_at_impact' : 'uniform'
  };
}

/**
 * Generate silhouette prompt fragment
 */
export function generateSilhouettePrompt(spec: BeatSilhouetteSpec): string {
  const parts: string[] = [];

  parts.push(`silhouette goal: ${spec.poseGoal}`);
  
  if (spec.negativeSpaceFocus.length > 0) {
    parts.push(`clear negative space ${spec.negativeSpaceFocus.join(' and ')}`);
  }
  
  if (spec.hooksToEmphasize.length > 0) {
    parts.push(`emphasize silhouette hooks: ${spec.hooksToEmphasize.join(', ')}`);
  }
  
  if (spec.avoidMerging.length > 0) {
    parts.push(`avoid merging: ${spec.avoidMerging.join(', ')}`);
  }
  
  if (spec.maintainCharacterSeparation) {
    parts.push('distinct character silhouettes, not merged');
  }

  return parts.join('; ');
}

/**
 * Generate impact composition prompt fragment
 */
export function generateImpactPrompt(spec: ImpactSpec): string {
  const parts: string[] = [];

  parts.push(`focal action: ${spec.punchAction}`);
  parts.push(`impact focus: ${spec.impactFocus} is largest/clearest shape`);
  
  if (spec.foreshorten) {
    parts.push('foreshortened toward camera for impact');
  }
  
  if (spec.leadingLines && spec.leadingLines.length > 0) {
    parts.push(`leading lines to impact: ${spec.leadingLines.join(', ')}`);
  }
  
  if (spec.detailPriority === 'low_at_impact') {
    parts.push('simplified background near impact for clarity');
  }
  
  if (spec.compositionNotes) {
    parts.push(spec.compositionNotes);
  }

  return parts.join('; ');
}

/**
 * Validate silhouette spec
 */
export function validateBeatSilhouetteSpec(spec: BeatSilhouetteSpec): {
  isValid: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!spec.poseGoal) {
    issues.push('Missing pose goal');
  }

  if (!spec.negativeSpaceFocus || spec.negativeSpaceFocus.length === 0) {
    warnings.push('No negative space focus defined');
  }

  if (!spec.avoidMerging || spec.avoidMerging.length === 0) {
    warnings.push('No merging avoidance rules defined');
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Validate impact spec
 */
export function validateImpactSpec(spec: ImpactSpec): {
  isValid: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!spec.punchAction) {
    issues.push('Missing punch action');
  }

  if (!spec.punchOwner) {
    issues.push('Missing punch owner');
  }

  if (!spec.impactFocus) {
    issues.push('Missing impact focus');
  }

  if (spec.foreshorten && spec.detailPriority !== 'low_at_impact') {
    warnings.push('Foreshortened impacts usually work better with low detail at impact');
  }

  if (!spec.leadingLines || spec.leadingLines.length === 0) {
    warnings.push('No leading lines defined - composition may lack focus');
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}

// ============================================
// PART 1: BEAT COMPOSITION (Within Each Image)
// ============================================

/**
 * Clarity specification - the ONE idea this image conveys
 */
export interface ClaritySpec {
  // The ONE thing happening in this image
  focalEvent: string;
  
  // The ONE feeling we want the player to have
  focalEmotion: string;
  
  // Only elements REQUIRED for this beat to be legible
  essentialContext: string[];
  
  // What should be simplified or removed
  simplifiedElements?: string[];
  
  // What should be readable even at thumbnail size
  thumbnailRead: string;
}

/**
 * Composition flow - how the viewer's eye moves through the image
 */
export type CompositionEntry = 'top_left' | 'top_center' | 'left' | 'center' | 'custom';
export type CompositionExit = 'bottom_right' | 'right' | 'center' | 'to_ui' | 'custom';

export interface CompositionFlowSpec {
  entryPoint: CompositionEntry;
  exitPoint: CompositionExit;
  flowElements: Array<'character_gaze' | 'gesture_direction' | 'light_direction' | 'leading_lines' | 'color_path'>;
  flowDescription: string;
  leadsToUI?: boolean;
  uiPlacement?: 'bottom' | 'right' | 'bottom_right';
}

/**
 * Information density - how visually busy is the frame
 */
export type InformationDensity = 'minimal' | 'sparse' | 'balanced' | 'busy' | 'dense';

/**
 * Environment personality - how setting participates in storytelling
 */
export type EnvironmentPersonality = 
  | 'neutral'     // Standard backdrop
  | 'oppressive'  // Looms over characters, claustrophobic
  | 'protective'  // Shelters characters, warm, safe
  | 'expansive'   // Opens up, freedom, possibility
  | 'decaying'    // Shows corruption, entropy, consequences
  | 'thriving'    // Shows life, growth, positive change
  | 'liminal'     // Threshold space, between states
  | 'hostile'     // Actively dangerous
  | 'sacred';     // Special, significant, heightened

export interface EnvironmentSpec {
  basePersonality: EnvironmentPersonality;
  currentPersonality: EnvironmentPersonality;
  characteristics: {
    dominantLines: 'vertical' | 'horizontal' | 'diagonal' | 'organic' | 'mixed';
    spaceFeeling: 'cramped' | 'balanced' | 'open' | 'vast';
    lightQuality: 'natural' | 'artificial' | 'mixed' | 'absent';
    stateOfRepair: 'pristine' | 'maintained' | 'worn' | 'damaged' | 'ruined';
  };
  characterRelation: 'dwarfs' | 'frames' | 'matches' | 'elevates';
  branchModifications?: {
    branchType: 'dark' | 'hopeful' | 'neutral';
    personalityShift: EnvironmentPersonality;
    visualChanges: string[];
  }[];
  narrativeFunction: string;
}

// ============================================
// PART 2: SEQUENCE PACING (Between Images)
// ============================================

/**
 * Transition types - what kind of change happens when moving to next image
 * Based on McCloud's panel transitions, adapted for full-bleed images
 */
export type TransitionType = 
  | 'moment_to_moment'    // Time barely moves, micro-expression/gesture change
  | 'action_to_action'    // Same subject, next key-frame of physical action
  | 'subject_to_subject'  // Same moment/scene, camera shifts to different focus
  | 'scene_to_scene'      // Time and/or place jump
  | 'aspect_to_aspect'    // Same scene, wander to different mood/detail
  | 'non_sequitur';       // Symbolic/surreal connection only

/**
 * How much mental "closure" the viewer must supply
 */
export type ClosureLoad = 'very_low' | 'moderate' | 'high' | 'very_high';

/**
 * What the transition preserves vs changes
 */
export interface ContinuityRules {
  preserveCamera: boolean;
  preserveEnvironment: boolean;
  preserveCharacterPosition: boolean;
  preserveLighting: boolean;
  preservePalette: boolean;
  preserveTimeOfDay: boolean;
}

/**
 * Transition specification for moving to the next image
 */
export interface TransitionSpec {
  type: TransitionType;
  closureLoad: ClosureLoad;
  continuity: ContinuityRules;
  changeDescription: string;
  continuityThread?: string; // For scene_to_scene/non_sequitur: what links them
}

/**
 * Rhythm role - what function does this beat serve in the sequence
 */
export type RhythmRole = 
  | 'breather'    // Pause, emotional processing
  | 'build'       // Tension increasing
  | 'spike'       // Peak moment, high impact
  | 'resolution'  // Aftermath, release
  | 'transition'; // Moving between scenes/states

/**
 * Change magnitude - how big a visual jump from previous image
 */
export type ChangeMagnitude = 
  | 'micro'       // Almost nothing changed
  | 'small'       // Minor pose/expression shift
  | 'moderate'    // Noticeable camera/composition change
  | 'large'       // Significant scene element changes
  | 'total';      // Complete scene/location change

/**
 * Complete pacing specification
 */
export interface PacingSpec {
  rhythmRole: RhythmRole;
  changeMagnitude: ChangeMagnitude;
  informationDensity: InformationDensity;
  timeFeel: 'stretched' | 'normal' | 'compressed';
  transitionToNext?: TransitionSpec;
}

// ============================================
// PART 3: STORY INTEGRATION
// ============================================

/**
 * Visual motif - recurring element that carries thematic meaning
 */
export interface VisualMotif {
  id: string;
  name: string;
  type: 'object' | 'shape' | 'color' | 'lighting_setup' | 'framing' | 'environment_element';
  visualDescription: string;
  thematicMeaning: string;
  evolutionStages: Array<{
    stage: string;
    treatment: string;
    emotionalTone: string;
  }>;
  triggerConditions: string[];
}

/**
 * Motif presence in a specific beat
 */
export interface MotifPresence {
  motifId: string;
  currentStage: string;
  placement: 'foreground' | 'background' | 'framing' | 'dominant';
  prominence: 'subtle' | 'noticeable' | 'dominant';
  treatmentNotes?: string;
}

/**
 * Story-level motif collection
 */
export interface MotifLibrary {
  storyId: string;
  coreMotifs: VisualMotif[];
  characterMotifs: Map<string, VisualMotif[]>;
  themeMotifs: Map<string, VisualMotif[]>;
  branchSensitiveMotifs: string[];
}

/**
 * Choice telegraphing - visual hints near player choices
 */
export interface ChoiceTelegraph {
  isPreChoice: boolean;
  isPostChoice: boolean;
  
  optionHints?: Array<{
    optionType: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other';
    visualHint: string;
  }>;
  
  consequenceSignal?: {
    direction: 'positive' | 'negative' | 'ambiguous';
    visualSignal: string;
  };
  
  choiceProximityTreatment?: {
    slowDown: boolean;
    simplify: boolean;
    focusOnActing: boolean;
    leadToUI: boolean;
  };
}

// ============================================
// PART 4: COMPLETE VISUAL STORYTELLING SPEC
// ============================================

/**
 * Complete visual storytelling specification for a single beat
 */
export interface VisualStorytellingSpec {
  // Beat identification
  beatId: string;
  sequencePosition: number;
  
  // CAMERA (how we frame this image)
  camera: CameraSpec;
  
  // SPATIAL (perspective and staging)
  spatial: SpatialSpec;
  
  // SILHOUETTE (pose readability)
  silhouette: BeatSilhouetteSpec;
  
  // IMPACT (focal gesture composition) - optional for non-action beats
  impact?: ImpactSpec;
  
  // TEXTURE (surface treatment)
  texture: TextureSpec;
  
  // COMPOSITION (within this image)
  clarity: ClaritySpec;
  compositionFlow: CompositionFlowSpec;
  environment: EnvironmentSpec;
  
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
    // Camera continuity
    cameraSidePreserved: boolean;
    lineCrossed: boolean;
    // Spatial continuity
    perspectivePreserved: boolean;
    horizonPreserved: boolean;
  };
}

// ============================================
// TRANSITION TYPE RULES
// ============================================

export const TRANSITION_RULES: Record<TransitionType, {
  description: string;
  closureLoad: ClosureLoad;
  defaultContinuity: ContinuityRules;
  useFor: string[];
  avoid: string[];
}> = {
  'moment_to_moment': {
    description: 'Time barely moves. Micro changes in expression, gesture, or detail.',
    closureLoad: 'very_low',
    defaultContinuity: {
      preserveCamera: true,
      preserveEnvironment: true,
      preserveCharacterPosition: true,
      preserveLighting: true,
      preservePalette: true,
      preserveTimeOfDay: true
    },
    useFor: ['building emotional weight', 'before major choices', 'intimate moments', 'reaction beats'],
    avoid: ['action sequences', 'when momentum is needed']
  },
  'action_to_action': {
    description: 'Same subject progresses through physical action. Key-frame to key-frame.',
    closureLoad: 'moderate',
    defaultContinuity: {
      preserveCamera: false,
      preserveEnvironment: true,
      preserveCharacterPosition: false,
      preserveLighting: true,
      preservePalette: true,
      preserveTimeOfDay: true
    },
    useFor: ['action sequences', 'physical consequences', 'movement and activity'],
    avoid: ['dialogue-heavy scenes', 'contemplative moments']
  },
  'subject_to_subject': {
    description: 'Same moment/scene, but camera shifts to different character or element.',
    closureLoad: 'moderate',
    defaultContinuity: {
      preserveCamera: false,
      preserveEnvironment: true,
      preserveCharacterPosition: true,
      preserveLighting: true,
      preservePalette: true,
      preserveTimeOfDay: true
    },
    useFor: ['dialogue exchanges', 'showing reactions', 'revealing relationships', 'establishing connections'],
    avoid: ['when single focus is important']
  },
  'scene_to_scene': {
    description: 'Time and/or location jump. New context established.',
    closureLoad: 'high',
    defaultContinuity: {
      preserveCamera: false,
      preserveEnvironment: false,
      preserveCharacterPosition: false,
      preserveLighting: false,
      preservePalette: false,
      preserveTimeOfDay: false
    },
    useFor: ['after major choices', 'act breaks', 'time skips', 'location changes'],
    avoid: ['mid-conversation', 'during continuous action']
  },
  'aspect_to_aspect': {
    description: 'Same scene, wandering focus. Mood, atmosphere, environmental details.',
    closureLoad: 'moderate',
    defaultContinuity: {
      preserveCamera: false,
      preserveEnvironment: true,
      preserveCharacterPosition: true,
      preserveLighting: true,
      preservePalette: true,
      preserveTimeOfDay: true
    },
    useFor: ['atmosphere building', 'environmental storytelling', 'mood establishment', 'breather moments'],
    avoid: ['when narrative momentum is needed']
  },
  'non_sequitur': {
    description: 'Symbolic or surreal connection. No literal continuity.',
    closureLoad: 'very_high',
    defaultContinuity: {
      preserveCamera: false,
      preserveEnvironment: false,
      preserveCharacterPosition: false,
      preserveLighting: false,
      preservePalette: false,
      preserveTimeOfDay: false
    },
    useFor: ['dreams', 'visions', 'flashbacks', 'symbolic parallels', 'thematic punctuation'],
    avoid: ['normal narrative flow', 'when clarity is needed']
  }
};

// ============================================
// RHYTHM AND PACING RULES
// ============================================

export const RHYTHM_ROLE_GUIDANCE: Record<RhythmRole, {
  description: string;
  suggestedDensity: InformationDensity;
  suggestedMagnitude: ChangeMagnitude;
  suggestedTransitions: TransitionType[];
}> = {
  'breather': {
    description: 'Pause for emotional processing. Let characters and players breathe.',
    suggestedDensity: 'sparse',
    suggestedMagnitude: 'micro',
    suggestedTransitions: ['moment_to_moment', 'aspect_to_aspect']
  },
  'build': {
    description: 'Tension increasing. Moving toward something.',
    suggestedDensity: 'balanced',
    suggestedMagnitude: 'moderate',
    suggestedTransitions: ['action_to_action', 'subject_to_subject']
  },
  'spike': {
    description: 'Peak moment. Maximum impact.',
    suggestedDensity: 'minimal', // or 'busy' for chaos
    suggestedMagnitude: 'large',
    suggestedTransitions: ['action_to_action', 'scene_to_scene']
  },
  'resolution': {
    description: 'Aftermath. Settling, processing consequences.',
    suggestedDensity: 'sparse',
    suggestedMagnitude: 'small',
    suggestedTransitions: ['moment_to_moment', 'aspect_to_aspect']
  },
  'transition': {
    description: 'Moving between scenes or states.',
    suggestedDensity: 'balanced',
    suggestedMagnitude: 'total',
    suggestedTransitions: ['scene_to_scene']
  }
};

export const CHOICE_PROXIMITY_RULES = `
## CHOICE PROXIMITY RULES

### PRE-CHOICE (2-3 beats before player decision)
- **Slow down**: Use moment_to_moment transitions, micro/small changes
- **Simplify**: Sparse to balanced density, not busy
- **Focus on acting**: Character faces and body language carry the stakes
- **Lead to UI**: Composition should flow toward where choices will appear

### POST-CHOICE (1-2 beats after decision)
- **Show consequence direction**: Visual shift confirms they've entered new state
- **Resolution rhythm**: Breather or resolution role
- **Environment can shift**: Reflect the branch taken (warmer/colder, etc.)
`;

// ============================================
// COMPOSITION AND CLARITY RULES
// ============================================

export const COMPOSITION_FLOW_RULES = `
## COMPOSITION FLOW (Eye Direction)

Each beat is ONE full-bleed image. Control where the viewer looks.

### EYE FLOW PRINCIPLES
Western reading convention: eye naturally flows LEFT→RIGHT, TOP→BOTTOM.
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
Use these to create visual paths through the image:
- **character_gaze**: Characters look toward next important element
- **gesture_direction**: Pointing, reaching guides the eye
- **light_direction**: Bright areas pull attention, shadows recede
- **leading_lines**: Environmental lines point toward focus
- **color_path**: Accent colors create breadcrumb trail
`;

export const CLARITY_RULES = `
## CLARITY AND ECONOMY

### ONE BEAT = ONE IDEA
Each image should have:
- **1 focal event**: What is VISUALLY happening?
- **1 focal emotion**: What should player FEEL?
- **1-2 supporting details**: Only what's needed for context

### THUMBNAIL TEST (Critical)
Shrink the image mentally to thumbnail size:
- Can you identify the focal character?
- Can you read the main gesture/pose?
- Is the emotional tone clear?
- Is there ONE clear focal point?

If any answer is NO → simplify, increase contrast on focal point.

### ECONOMY RULES
- NO random props that don't serve the current beat
- NO complex backgrounds for emotional close-ups
- NO foreground clutter blocking focal characters
- SIMPLIFY anything that isn't the point of this beat
`;

export const ENVIRONMENT_RULES = `
## ENVIRONMENT AS CHARACTER

### ENVIRONMENT PARTICIPATES IN STORY
The setting isn't just backdrop—it comments on and reflects the narrative.

### PERSONALITY TYPES
- **oppressive**: Verticals, tight framing, overhead structures → dread
- **protective**: Enclosed warmth, soft light, organic shapes → safety
- **expansive**: Open horizontals, visible sky, depth → possibility
- **decaying**: Damage, debris, broken elements → corruption
- **thriving**: Growth, repairs, life → positive change
- **liminal**: Doorways, corridors, thresholds → between states

### CHARACTER-ENVIRONMENT RELATION
- **dwarfs**: Environment much larger → vulnerability
- **frames**: Environment creates natural frame → focus
- **matches**: Environment at human scale → normalcy
- **elevates**: Character above environment → power

### BRANCH SENSITIVITY
Same location should look DIFFERENT based on story path:
- **Corrupt path**: More decay, harsh lighting, broken elements
- **Reform path**: Signs of life, repairs, warmer lighting
`;

export const SILENT_STORYTELLING_RULES = `
## SILENT STORYTELLING TEST

If all UI text were removed, could the player understand:
1. **Emotional tone**: What characters are feeling?
2. **Relationship dynamic**: How characters relate?
3. **Direction**: Is situation getting better or worse?

For high-impact beats, the image should do the heavy lifting.
`;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get default continuity rules for a transition type
 */
export function getDefaultContinuity(transitionType: TransitionType): ContinuityRules {
  return { ...TRANSITION_RULES[transitionType].defaultContinuity };
}

/**
 * Get suggested pacing for a rhythm role
 */
export function getSuggestedPacing(rhythmRole: RhythmRole): {
  density: InformationDensity;
  magnitude: ChangeMagnitude;
  transitions: TransitionType[];
} {
  const guidance = RHYTHM_ROLE_GUIDANCE[rhythmRole];
  return {
    density: guidance.suggestedDensity,
    magnitude: guidance.suggestedMagnitude,
    transitions: guidance.suggestedTransitions
  };
}

/**
 * Determine change magnitude from transition type
 */
export function getMagnitudeFromTransition(transitionType: TransitionType): ChangeMagnitude {
  const mapping: Record<TransitionType, ChangeMagnitude> = {
    'moment_to_moment': 'micro',
    'action_to_action': 'moderate',
    'subject_to_subject': 'small',
    'scene_to_scene': 'total',
    'aspect_to_aspect': 'small',
    'non_sequitur': 'total'
  };
  return mapping[transitionType];
}

/**
 * Suggest rhythm role based on context
 */
export function suggestRhythmRole(context: {
  isPreChoice?: boolean;
  isPostChoice?: boolean;
  isClimactic?: boolean;
  isResolution?: boolean;
  isActionSequence?: boolean;
  emotionalIntensity: 'low' | 'medium' | 'high' | 'peak';
}): RhythmRole {
  if (context.isPreChoice) return 'build';
  if (context.isPostChoice || context.isResolution) return 'resolution';
  if (context.isClimactic) return 'spike';
  if (context.isActionSequence) return 'build';
  if (context.emotionalIntensity === 'low') return 'breather';
  if (context.emotionalIntensity === 'high' || context.emotionalIntensity === 'peak') return 'build';
  return 'breather';
}

/**
 * Suggest transition type based on context
 */
export function suggestTransitionType(context: {
  nextBeatIsChoice?: boolean;
  isEndOfScene?: boolean;
  isActionSequence?: boolean;
  isMoodShift?: boolean;
  isReaction?: boolean;
  currentRhythm: RhythmRole;
}): TransitionType {
  if (context.nextBeatIsChoice) return 'moment_to_moment'; // Slow before choices
  if (context.isEndOfScene) return 'scene_to_scene';
  if (context.isActionSequence) return 'action_to_action';
  if (context.isMoodShift) return 'aspect_to_aspect';
  if (context.isReaction) return 'subject_to_subject';
  
  // Default based on rhythm
  const suggestions = RHYTHM_ROLE_GUIDANCE[context.currentRhythm].suggestedTransitions;
  return suggestions[0];
}

/**
 * Suggest environment personality based on context
 */
export function suggestEnvironmentPersonality(context: {
  branchType?: 'dark' | 'hopeful' | 'neutral';
  sceneType?: 'safe_hub' | 'conflict' | 'exploration' | 'climax' | 'resolution';
  isThreshold?: boolean;
}): EnvironmentPersonality {
  if (context.isThreshold) return 'liminal';
  
  if (context.branchType === 'dark') {
    return context.sceneType === 'climax' ? 'hostile' : 'decaying';
  }
  if (context.branchType === 'hopeful') {
    return context.sceneType === 'resolution' ? 'thriving' : 'protective';
  }
  
  switch (context.sceneType) {
    case 'safe_hub': return 'protective';
    case 'conflict': return 'oppressive';
    case 'exploration': return 'expansive';
    case 'climax': return 'hostile';
    case 'resolution': return 'neutral';
    default: return 'neutral';
  }
}

/**
 * Validate that a beat advances the story (redundancy check)
 */
export function validateAdvancement(
  currentBeat: { action: string; emotion: string },
  previousBeat?: { action: string; emotion: string },
  transitionType?: TransitionType
): { advances: boolean; advancementType: string; reason: string } {
  // No previous beat = always advances
  if (!previousBeat) {
    return { advances: true, advancementType: 'first_beat', reason: 'First beat of sequence' };
  }
  
  // Transition type determines valid advancement
  if (transitionType) {
    const advancementMap: Record<TransitionType, string> = {
      'moment_to_moment': 'time_micro',
      'action_to_action': 'action',
      'subject_to_subject': 'focus',
      'scene_to_scene': 'scene',
      'aspect_to_aspect': 'aspect',
      'non_sequitur': 'symbolic'
    };
    return { 
      advances: true, 
      advancementType: advancementMap[transitionType],
      reason: `Valid ${transitionType} transition`
    };
  }
  
  // Check for changes
  if (currentBeat.action !== previousBeat.action) {
    return { advances: true, advancementType: 'action', reason: 'Action changed' };
  }
  if (currentBeat.emotion !== previousBeat.emotion) {
    return { advances: true, advancementType: 'emotion', reason: 'Emotional state changed' };
  }
  
  // Potentially redundant
  return { 
    advances: false, 
    advancementType: 'none',
    reason: 'No change in action, emotion, or focus from previous beat'
  };
}

/**
 * Build complete pacing spec for a beat
 */
export function buildPacingSpec(
  rhythmRole: RhythmRole,
  transitionToNext?: TransitionType,
  isPreChoice?: boolean,
  isPostChoice?: boolean
): PacingSpec {
  const suggested = getSuggestedPacing(rhythmRole);
  
  // Override for choice proximity
  let density = suggested.density;
  let magnitude = suggested.magnitude;
  
  if (isPreChoice) {
    density = 'sparse';
    magnitude = 'micro';
  }
  if (isPostChoice) {
    density = 'sparse';
    magnitude = 'small';
  }
  
  const pacing: PacingSpec = {
    rhythmRole,
    changeMagnitude: magnitude,
    informationDensity: density,
    timeFeel: rhythmRole === 'spike' || rhythmRole === 'build' ? 'normal' : 
              rhythmRole === 'breather' ? 'stretched' : 'normal'
  };
  
  if (transitionToNext) {
    pacing.transitionToNext = {
      type: transitionToNext,
      closureLoad: TRANSITION_RULES[transitionToNext].closureLoad,
      continuity: getDefaultContinuity(transitionToNext),
      changeDescription: ''
    };
  }
  
  return pacing;
}
