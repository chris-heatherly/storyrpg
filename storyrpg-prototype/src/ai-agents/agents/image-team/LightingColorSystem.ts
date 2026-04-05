/**
 * Lighting and Color Story System
 * 
 * Lighting and color are STORY SYSTEMS, not just style.
 * Every image encodes where we are in the emotional arc.
 */

// ============================================
// LIGHTING TYPES
// ============================================

export type LightDirection = 'top' | 'side_left' | 'side_right' | 'back' | 'under' | 'front' | 'ambient';
export type LightQuality = 'soft' | 'semi_soft' | 'semi_hard' | 'hard';
export type LightTemperature = 'warm' | 'neutral' | 'cool';
export type ContrastLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface LightingSpec {
  // Primary light direction
  direction: LightDirection;
  directionDescription?: string; // e.g., "dramatic side lighting from left"
  
  // Light quality (shadow sharpness)
  quality: LightQuality;
  
  // Color temperature
  keyLightTemp: LightTemperature;
  fillLightTemp: LightTemperature;
  
  // Contrast
  contrastLevel: ContrastLevel;
  
  // Special lighting effects
  effects?: Array<'rim_light' | 'god_rays' | 'lens_flare' | 'volumetric' | 'practical_lights'>;
  
  // Narrative reason
  narrativeReason: string; // Why this lighting for this beat
}

// ============================================
// COLOR TYPES
// ============================================

export type PaletteSaturation = 'muted' | 'normal' | 'vivid';
export type ValueKey = 'high_key' | 'mid_key' | 'low_key';

// Named color associations (story-specific meanings)
export interface ColorMeaning {
  color: string;
  meaning: string;
  usage: string;
}

// POV filter for emotional perspective
export type POVFilter = 
  | 'none'
  | 'nostalgic_sepia'
  | 'trauma_cyan'
  | 'hopeful_warm'
  | 'paranoid_green'
  | 'dreamlike_purple'
  | 'rage_red'
  | 'grief_blue'
  | 'toxic_yellow_green';

export interface ColorSpec {
  // Primary and secondary hues
  primaryHues: string[]; // e.g., ["deep blue", "amber"]
  accentHue?: string; // For highlights/focus points
  
  // Saturation and value
  saturation: PaletteSaturation;
  valueKey: ValueKey;
  
  // POV filter (emotional lens)
  povFilter: POVFilter;
  povDescription?: string; // e.g., "subtle warm filter suggesting hope"
  
  // Narrative reason
  narrativeReason: string;
}

// ============================================
// COMPLETE MOOD SPECIFICATION
// ============================================

export type EmotionCore = 
  | 'hopeful' | 'triumphant' | 'joyful' | 'peaceful' | 'romantic' | 'nostalgic'
  | 'tense' | 'anxious' | 'fearful' | 'dread' | 'paranoid'
  | 'sad' | 'grief' | 'melancholy' | 'lonely' | 'defeated'
  | 'angry' | 'furious' | 'bitter' | 'resentful'
  | 'mysterious' | 'eerie' | 'uncanny' | 'otherworldly'
  | 'neutral' | 'contemplative' | 'curious';

export type EmotionIntensity = 'low' | 'medium' | 'high' | 'peak';
export type EmotionValence = 'positive' | 'negative' | 'ambiguous' | 'mixed_positive' | 'mixed_negative';

export interface MoodSpec {
  // Core emotional parameters
  emotion: EmotionCore;
  intensity: EmotionIntensity;
  valence: EmotionValence;
  
  // Derived lighting
  lighting: LightingSpec;
  
  // Derived color
  color: ColorSpec;
  
  // Comparison to previous beat
  comparedToPrevious?: {
    isCalmerOrMoreIntense: 'calmer' | 'same' | 'more_intense';
    isWarmerOrColder: 'warmer' | 'same' | 'colder';
    isSaferOrMoreDangerous: 'safer' | 'same' | 'more_dangerous';
  };
}

// ============================================
// COLOR SCRIPT (ARC-LEVEL)
// ============================================

export interface ColorScriptBeat {
  beatId: string;
  beatName: string;
  sequenceOrder: number;
  
  // Mood
  emotion: EmotionCore;
  intensity: EmotionIntensity;
  valence: EmotionValence;
  
  // Visual summary
  dominantHues: string[];
  saturation: PaletteSaturation;
  valueKey: ValueKey;
  lightDirection: LightDirection;
  lightTemp: LightTemperature;
  
  // Thumbnail color (for color script visualization)
  thumbnailColors: {
    background: string; // hex
    foreground: string; // hex
    accent: string; // hex
  };
  
  // Notes
  narrativeNote: string; // What's happening emotionally
}

export interface ColorScript {
  storyId: string;
  episodeId?: string;
  chapterId?: string;
  
  // Story-specific color meanings
  colorDictionary: ColorMeaning[];
  
  // The color script beats
  beats: ColorScriptBeat[];
  
  // Arc-level patterns
  overallArc: {
    startingMood: string;
    midpointMood: string;
    climaxMood: string;
    resolutionMood: string;
  };
  
  // Branch variations
  branchVariations?: {
    branchId: string;
    branchType: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
    paletteShift: string; // How palette differs from main
    saturationAdjust: 'decrease' | 'same' | 'increase';
    temperatureShift: 'cooler' | 'same' | 'warmer';
  }[];
}

// ============================================
// AUTOMATIC MOOD → LIGHTING/COLOR MAPPINGS
// ============================================

export const EMOTION_TO_LIGHTING: Record<EmotionCore, Partial<LightingSpec>> = {
  // Positive emotions
  'hopeful': { direction: 'side_left', quality: 'semi_soft', keyLightTemp: 'warm', contrastLevel: 'medium' },
  'triumphant': { direction: 'back', quality: 'semi_hard', keyLightTemp: 'warm', contrastLevel: 'high' },
  'joyful': { direction: 'top', quality: 'soft', keyLightTemp: 'warm', contrastLevel: 'low' },
  'peaceful': { direction: 'top', quality: 'soft', keyLightTemp: 'warm', contrastLevel: 'low' },
  'romantic': { direction: 'side_left', quality: 'soft', keyLightTemp: 'warm', contrastLevel: 'medium' },
  'nostalgic': { direction: 'side_right', quality: 'soft', keyLightTemp: 'warm', contrastLevel: 'low' },
  
  // Tense emotions
  'tense': { direction: 'side_left', quality: 'hard', keyLightTemp: 'neutral', contrastLevel: 'high' },
  'anxious': { direction: 'side_right', quality: 'semi_hard', keyLightTemp: 'cool', contrastLevel: 'medium' },
  'fearful': { direction: 'back', quality: 'hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  'dread': { direction: 'under', quality: 'hard', keyLightTemp: 'cool', contrastLevel: 'extreme' },
  'paranoid': { direction: 'side_left', quality: 'hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  
  // Sad emotions
  'sad': { direction: 'side_right', quality: 'soft', keyLightTemp: 'cool', contrastLevel: 'low' },
  'grief': { direction: 'top', quality: 'soft', keyLightTemp: 'cool', contrastLevel: 'low' },
  'melancholy': { direction: 'side_left', quality: 'soft', keyLightTemp: 'cool', contrastLevel: 'low' },
  'lonely': { direction: 'back', quality: 'semi_soft', keyLightTemp: 'cool', contrastLevel: 'medium' },
  'defeated': { direction: 'top', quality: 'semi_hard', keyLightTemp: 'cool', contrastLevel: 'medium' },
  
  // Angry emotions
  'angry': { direction: 'side_left', quality: 'hard', keyLightTemp: 'warm', contrastLevel: 'high' },
  'furious': { direction: 'under', quality: 'hard', keyLightTemp: 'warm', contrastLevel: 'extreme' },
  'bitter': { direction: 'side_right', quality: 'semi_hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  'resentful': { direction: 'side_left', quality: 'semi_hard', keyLightTemp: 'neutral', contrastLevel: 'medium' },
  
  // Mysterious emotions
  'mysterious': { direction: 'back', quality: 'semi_hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  'eerie': { direction: 'under', quality: 'hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  'uncanny': { direction: 'under', quality: 'semi_hard', keyLightTemp: 'cool', contrastLevel: 'high' },
  'otherworldly': { direction: 'back', quality: 'soft', keyLightTemp: 'cool', contrastLevel: 'medium' },
  
  // Neutral
  'neutral': { direction: 'top', quality: 'semi_soft', keyLightTemp: 'neutral', contrastLevel: 'medium' },
  'contemplative': { direction: 'side_left', quality: 'soft', keyLightTemp: 'neutral', contrastLevel: 'low' },
  'curious': { direction: 'front', quality: 'semi_soft', keyLightTemp: 'neutral', contrastLevel: 'medium' }
};

export const EMOTION_TO_COLOR: Record<EmotionCore, Partial<ColorSpec>> = {
  // Positive emotions
  'hopeful': { primaryHues: ['amber', 'soft blue'], saturation: 'normal', valueKey: 'mid_key', povFilter: 'hopeful_warm' },
  'triumphant': { primaryHues: ['gold', 'warm white'], saturation: 'vivid', valueKey: 'high_key', povFilter: 'none' },
  'joyful': { primaryHues: ['yellow', 'orange'], saturation: 'vivid', valueKey: 'high_key', povFilter: 'none' },
  'peaceful': { primaryHues: ['soft green', 'sky blue'], saturation: 'normal', valueKey: 'high_key', povFilter: 'none' },
  'romantic': { primaryHues: ['soft pink', 'warm orange'], saturation: 'normal', valueKey: 'mid_key', povFilter: 'hopeful_warm' },
  'nostalgic': { primaryHues: ['sepia', 'faded gold'], saturation: 'muted', valueKey: 'mid_key', povFilter: 'nostalgic_sepia' },
  
  // Tense emotions
  'tense': { primaryHues: ['deep blue', 'steel gray'], saturation: 'normal', valueKey: 'low_key', povFilter: 'none' },
  'anxious': { primaryHues: ['sickly yellow', 'gray'], saturation: 'muted', valueKey: 'mid_key', povFilter: 'paranoid_green' },
  'fearful': { primaryHues: ['deep blue', 'black'], saturation: 'muted', valueKey: 'low_key', povFilter: 'trauma_cyan' },
  'dread': { primaryHues: ['blood red', 'black'], saturation: 'vivid', valueKey: 'low_key', povFilter: 'rage_red' },
  'paranoid': { primaryHues: ['toxic green', 'magenta'], saturation: 'vivid', valueKey: 'low_key', povFilter: 'paranoid_green' },
  
  // Sad emotions
  'sad': { primaryHues: ['blue', 'gray'], saturation: 'muted', valueKey: 'mid_key', povFilter: 'grief_blue' },
  'grief': { primaryHues: ['deep blue', 'desaturated purple'], saturation: 'muted', valueKey: 'low_key', povFilter: 'grief_blue' },
  'melancholy': { primaryHues: ['dusty blue', 'faded lavender'], saturation: 'muted', valueKey: 'mid_key', povFilter: 'grief_blue' },
  'lonely': { primaryHues: ['cold blue', 'gray'], saturation: 'muted', valueKey: 'low_key', povFilter: 'trauma_cyan' },
  'defeated': { primaryHues: ['brown', 'gray'], saturation: 'muted', valueKey: 'low_key', povFilter: 'none' },
  
  // Angry emotions
  'angry': { primaryHues: ['red', 'orange'], saturation: 'vivid', valueKey: 'mid_key', povFilter: 'rage_red' },
  'furious': { primaryHues: ['blood red', 'black'], saturation: 'vivid', valueKey: 'low_key', povFilter: 'rage_red' },
  'bitter': { primaryHues: ['cold gray', 'muted green'], saturation: 'muted', valueKey: 'low_key', povFilter: 'trauma_cyan' },
  'resentful': { primaryHues: ['dark purple', 'rust'], saturation: 'muted', valueKey: 'low_key', povFilter: 'none' },
  
  // Mysterious emotions
  'mysterious': { primaryHues: ['deep purple', 'silver'], saturation: 'normal', valueKey: 'low_key', povFilter: 'dreamlike_purple' },
  'eerie': { primaryHues: ['toxic green', 'black'], saturation: 'vivid', valueKey: 'low_key', povFilter: 'toxic_yellow_green' },
  'uncanny': { primaryHues: ['magenta', 'cyan'], saturation: 'vivid', valueKey: 'mid_key', povFilter: 'paranoid_green' },
  'otherworldly': { primaryHues: ['purple', 'teal'], saturation: 'vivid', valueKey: 'mid_key', povFilter: 'dreamlike_purple' },
  
  // Neutral
  'neutral': { primaryHues: ['natural browns', 'natural greens'], saturation: 'normal', valueKey: 'mid_key', povFilter: 'none' },
  'contemplative': { primaryHues: ['soft blue', 'warm gray'], saturation: 'muted', valueKey: 'mid_key', povFilter: 'none' },
  'curious': { primaryHues: ['bright blue', 'white'], saturation: 'normal', valueKey: 'high_key', povFilter: 'none' }
};

// Intensity modifiers
export const INTENSITY_MODIFIERS: Record<EmotionIntensity, {
  saturationAdjust: number; // -1 to +1
  contrastAdjust: number; // -1 to +1
  valueKeyShift: number; // -1 darker, +1 lighter
}> = {
  'low': { saturationAdjust: -0.3, contrastAdjust: -0.3, valueKeyShift: 0.2 },
  'medium': { saturationAdjust: 0, contrastAdjust: 0, valueKeyShift: 0 },
  'high': { saturationAdjust: 0.3, contrastAdjust: 0.3, valueKeyShift: -0.1 },
  'peak': { saturationAdjust: 0.5, contrastAdjust: 0.5, valueKeyShift: -0.2 }
};

// ============================================
// LIGHTING DIRECTION SEMANTIC RULES
// ============================================

export const LIGHTING_DIRECTION_GUIDE = `
## LIGHTING DIRECTION AS EMOTIONAL SHORTHAND

### TOP LIGHTING (overhead/daylight)
- **Mood**: Neutral, realistic, "day in the world"
- **Use for**: Baseline scenes, normal life, expository beats
- **When**: Low-intensity emotions, not strongly positive/negative

### SIDE LIGHTING (key from left or right)
- **Mood**: Drama, conflict, moral ambiguity, depth
- **Use for**: Confrontations, internal conflict, "crossroads" decisions
- **Visual**: Light-shadow split on faces → player feels there are two sides
- **When**: Important choices, relationship tension, character reveals

### BACKLIGHTING (light behind subject)
- **Mood**: Mystery, tension, awe, isolation
- **Use for**: Reveals, introductions, departures, "you don't know the truth yet"
- **Great for**: Choice beats where player doesn't fully trust the character
- **When**: Arrivals, departures, dramatic reveals, silhouette moments

### UNDER-LIGHTING (light from below)
- **Mood**: Unnatural, eerie, horror, psychological instability
- **Use SPARINGLY**: Nightmares, hallucinations, villain turns, glitch moments
- **When**: Reserve for the darkest path variants of a beat
- **Warning**: Overuse diminishes impact
`;

export const LIGHT_QUALITY_GUIDE = `
## LIGHT QUALITY (Soft vs Hard Shadows)

### SOFT, DIFFUSED LIGHT
- **Mood**: Gentle, romantic, nostalgic, safe, reflective
- **Use for**: Bonding scenes, quiet aftermaths, "home base," bittersweet memories
- **Implementation**: Big light sources (overcast sky, big window), low contrast, soft edges

### HARD, HIGH-CONTRAST LIGHT
- **Mood**: Dramatic, dangerous, urgent, harsh
- **Use for**: Conflict, high-stakes confrontations, action aftermath, arguments
- **Implementation**: Small light sources (spotlights, noon sun, flashlight), sharp shadows
`;

export const COLOR_TEMPERATURE_GUIDE = `
## COLOR TEMPERATURE (Warm vs Cool Light)

### WARM LIGHT (gold, orange, soft red)
- **Mood**: Human, intimate, safe, celebratory, nostalgic
- **Use for**: Hearths, sunsets, interior lamps, friendly bars, hopeful turning points
- **Note**: Can signal dangerous attraction if paired with high contrast

### COOL LIGHT (blue, cyan, greenish)
- **Mood**: Sterile, lonely, eerie, clinical, high-tech, otherworldly
- **Use for**: Hospitals, labs, empty cities at night, alien interiors, "cold shoulders"

### BRANCH SIGNALING
- **Good/connection routes**: More warm key light on faces
- **Isolation/bad routes**: More cool or mixed light (cool overall, small warm accent = "hope at risk")
`;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate complete mood spec from story beat emotional parameters
 */
export function generateMoodSpec(
  emotion: EmotionCore,
  intensity: EmotionIntensity,
  valence: EmotionValence,
  previousMood?: MoodSpec
): MoodSpec {
  // Get base lighting and color from emotion
  const baseLighting = EMOTION_TO_LIGHTING[emotion] || EMOTION_TO_LIGHTING.neutral;
  const baseColor = EMOTION_TO_COLOR[emotion] || EMOTION_TO_COLOR.neutral;
  const intensityMod = INTENSITY_MODIFIERS[intensity];
  
  // Apply intensity modifiers to saturation
  let saturation = baseColor.saturation || 'normal';
  if (intensityMod.saturationAdjust > 0.2) {
    saturation = saturation === 'muted' ? 'normal' : 'vivid';
  } else if (intensityMod.saturationAdjust < -0.2) {
    saturation = saturation === 'vivid' ? 'normal' : 'muted';
  }
  
  // Apply intensity modifiers to contrast
  let contrastLevel = baseLighting.contrastLevel || 'medium';
  if (intensityMod.contrastAdjust > 0.2) {
    contrastLevel = contrastLevel === 'low' ? 'medium' : contrastLevel === 'medium' ? 'high' : 'extreme';
  } else if (intensityMod.contrastAdjust < -0.2) {
    contrastLevel = contrastLevel === 'extreme' ? 'high' : contrastLevel === 'high' ? 'medium' : 'low';
  }
  
  // Build comparison to previous
  let comparedToPrevious: MoodSpec['comparedToPrevious'] | undefined;
  if (previousMood) {
    const prevIntensityNum = { low: 1, medium: 2, high: 3, peak: 4 }[previousMood.intensity];
    const currIntensityNum = { low: 1, medium: 2, high: 3, peak: 4 }[intensity];
    
    comparedToPrevious = {
      isCalmerOrMoreIntense: currIntensityNum < prevIntensityNum ? 'calmer' : 
                            currIntensityNum > prevIntensityNum ? 'more_intense' : 'same',
      isWarmerOrColder: baseLighting.keyLightTemp === 'warm' && previousMood.lighting.keyLightTemp !== 'warm' ? 'warmer' :
                       baseLighting.keyLightTemp === 'cool' && previousMood.lighting.keyLightTemp !== 'cool' ? 'colder' : 'same',
      isSaferOrMoreDangerous: valence === 'positive' && previousMood.valence !== 'positive' ? 'safer' :
                             valence === 'negative' && previousMood.valence !== 'negative' ? 'more_dangerous' : 'same'
    };
  }
  
  return {
    emotion,
    intensity,
    valence,
    lighting: {
      direction: baseLighting.direction || 'top',
      quality: baseLighting.quality || 'semi_soft',
      keyLightTemp: baseLighting.keyLightTemp || 'neutral',
      fillLightTemp: baseLighting.keyLightTemp === 'warm' ? 'cool' : 
                     baseLighting.keyLightTemp === 'cool' ? 'neutral' : 'neutral',
      contrastLevel: contrastLevel as ContrastLevel,
      narrativeReason: `${emotion} mood at ${intensity} intensity with ${valence} valence`
    },
    color: {
      primaryHues: baseColor.primaryHues || ['neutral gray'],
      saturation: saturation as PaletteSaturation,
      valueKey: baseColor.valueKey || 'mid_key',
      povFilter: baseColor.povFilter || 'none',
      narrativeReason: `Color palette for ${emotion} mood`
    },
    comparedToPrevious
  };
}

/**
 * Generate a prompt fragment for lighting and color
 */
export function generateLightingColorPrompt(mood: MoodSpec): string {
  const lightDir = {
    'top': 'overhead natural lighting',
    'side_left': 'dramatic side lighting from the left',
    'side_right': 'dramatic side lighting from the right',
    'back': 'mysterious backlighting',
    'under': 'eerie underlighting',
    'front': 'frontal lighting',
    'ambient': 'soft ambient lighting'
  }[mood.lighting.direction];
  
  const lightQual = {
    'soft': 'soft diffused light with gentle shadows',
    'semi_soft': 'slightly soft lighting with visible but not harsh shadows',
    'semi_hard': 'noticeable shadows with some definition',
    'hard': 'hard dramatic shadows with sharp edges'
  }[mood.lighting.quality];
  
  const keyTemp = mood.lighting.keyLightTemp === 'warm' ? 'warm golden key light' :
                  mood.lighting.keyLightTemp === 'cool' ? 'cool blue key light' : 
                  'neutral key light';
  
  const fillTemp = mood.lighting.fillLightTemp === 'warm' ? 'warm ambient fill' :
                   mood.lighting.fillLightTemp === 'cool' ? 'cooler ambient fill' :
                   'neutral fill';
  
  const contrast = {
    'low': 'low contrast',
    'medium': 'moderate contrast',
    'high': 'high contrast',
    'extreme': 'extreme high contrast'
  }[mood.lighting.contrastLevel];
  
  const palette = mood.color.primaryHues.join(' and ') + ' color palette';
  
  const saturation = {
    'muted': 'muted desaturated colors',
    'normal': 'balanced saturation',
    'vivid': 'vivid saturated colors'
  }[mood.color.saturation];
  
  const valueKey = {
    'high_key': 'bright high-key values',
    'mid_key': 'balanced mid-key values',
    'low_key': 'dark low-key values'
  }[mood.color.valueKey];
  
  const povFilter = mood.color.povFilter !== 'none' ? 
    `, ${mood.color.povFilter.replace(/_/g, ' ')} color grading` : '';
  
  return `${lightDir}, ${lightQual}, ${keyTemp} with ${fillTemp}, ${contrast}; ${palette}, ${saturation}, ${valueKey}${povFilter}`;
}

/**
 * Validate that mood spec is appropriate for beat context
 */
export function validateMoodForBeat(
  mood: MoodSpec,
  beatContext: {
    isClimactic?: boolean;
    isResolution?: boolean;
    isFlashback?: boolean;
    isNightmare?: boolean;
    isSafeHubScene?: boolean;
    branchType?: 'dark' | 'hopeful' | 'neutral';
  }
): { isValid: boolean; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Climactic scenes should have high contrast
  if (beatContext.isClimactic && mood.lighting.contrastLevel === 'low') {
    issues.push('Climactic scene has low contrast - should be high or extreme');
    suggestions.push('Increase contrast for climactic impact');
  }
  
  // Resolution should trend back to softer lighting
  if (beatContext.isResolution && mood.lighting.quality === 'hard' && mood.intensity === 'low') {
    issues.push('Resolution scene has harsh lighting - consider softening');
    suggestions.push('Use softer lighting for emotional resolution');
  }
  
  // Flashbacks should have POV filter
  if (beatContext.isFlashback && mood.color.povFilter === 'none') {
    issues.push('Flashback has no POV filter - should have nostalgic or trauma filter');
    suggestions.push('Add nostalgic_sepia or trauma_cyan filter for flashback');
  }
  
  // Nightmares should use under-lighting or extreme contrast
  if (beatContext.isNightmare && mood.lighting.direction !== 'under' && mood.lighting.contrastLevel !== 'extreme') {
    issues.push('Nightmare scene lacks unsettling lighting');
    suggestions.push('Consider under-lighting or extreme contrast for nightmare');
  }
  
  // Safe hub scenes should be warm and high-key
  if (beatContext.isSafeHubScene && (mood.lighting.keyLightTemp === 'cool' || mood.color.valueKey === 'low_key')) {
    issues.push('Safe hub scene has cold or dark lighting');
    suggestions.push('Use warm lighting and higher key values for safe spaces');
  }
  
  // Dark branch should trend cooler/more muted
  if (beatContext.branchType === 'dark' && mood.lighting.keyLightTemp === 'warm' && mood.color.saturation === 'vivid') {
    suggestions.push('Dark branch could use cooler temperature or more muted colors');
  }
  
  // Hopeful branch should trend warmer
  if (beatContext.branchType === 'hopeful' && mood.lighting.keyLightTemp === 'cool' && mood.valence !== 'negative') {
    suggestions.push('Hopeful branch could use warmer lighting');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    suggestions
  };
}
