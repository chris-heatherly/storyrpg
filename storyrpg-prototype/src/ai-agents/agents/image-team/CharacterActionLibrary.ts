/**
 * Character Action Library
 *
 * Stores character-specific movement patterns based on personality.
 * Each character has a consistent "body vocabulary" that informs
 * how they express emotions through physical action.
 *
 * A warrior shifts weight differently than a scholar.
 * A confident character expands while a nervous one contracts.
 */

// ============================================
// CORE TYPES
// ============================================

export type BasePosture = 'confident' | 'guarded' | 'nervous' | 'relaxed' | 'regal' | 'predatory' | 'weary';
export type GestureStyle = 'expansive' | 'contained' | 'fidgety' | 'deliberate' | 'theatrical' | 'minimal';
export type WeightDistribution = 'forward-leaning' | 'back-on-heels' | 'balanced' | 'ready-to-move' | 'planted';
export type TensionLevel = 'high' | 'medium' | 'low' | 'coiled';

export interface CharacterMovementProfile {
  characterId: string;
  characterName: string;

  // Baseline physical presence
  basePosture: BasePosture;
  gestureStyle: GestureStyle;
  weightDistribution: WeightDistribution;
  defaultTension: TensionLevel;

  // Signature movements this character uses
  signatureMoves: string[];  // e.g., "runs hand through hair when stressed"

  // How they occupy space
  spaceOccupation: 'dominant' | 'neutral' | 'minimizing';

  // Emotion-specific overrides
  emotionOverrides: {
    [emotion: string]: {
      postureShift: string;
      gestureChange: string;
      weightChange: string;
      signatureMove?: string;
    }
  };
}

// ============================================
// POSTURE DESCRIPTIONS BY TYPE
// ============================================

export const POSTURE_DESCRIPTIONS: Record<BasePosture, string> = {
  confident: 'upright spine, open chest, chin level, shoulders back and relaxed, expansive stance',
  guarded: 'arms closer to body, shoulders slightly hunched, chin tucked, weight ready to shift',
  nervous: 'hunched shoulders, arms close or self-touching, weight shifting, fidgeting energy',
  relaxed: 'loose limbs, weight on one leg, easy shoulders, casual stance',
  regal: 'perfectly upright, controlled movements, minimal but precise gestures, elevated chin',
  predatory: 'coiled energy, weight forward, shoulders down, focused intensity, ready to strike',
  weary: 'drooping shoulders, spine curved, heavy limbs, lowered head, exhausted energy'
};

export const GESTURE_DESCRIPTIONS: Record<GestureStyle, string> = {
  expansive: 'large, sweeping arm movements, uses whole body to emphasize points, takes up space',
  contained: 'minimal hand movements, gestures close to body, controlled and precise',
  fidgety: 'constant small movements, touches face/hair/clothes, shifts weight, restless energy',
  deliberate: 'each gesture intentional and meaningful, pauses between movements, considered',
  theatrical: 'dramatic flourishes, exaggerated expressions, performs for audience',
  minimal: 'almost no hand movement, lets face do the work, still body'
};

export const WEIGHT_DESCRIPTIONS: Record<WeightDistribution, string> = {
  'forward-leaning': 'weight on balls of feet, body inclined toward focus of attention, ready to engage',
  'back-on-heels': 'weight settled back, creating distance, observing rather than engaging',
  'balanced': 'weight evenly distributed, stable and grounded, neutral position',
  'ready-to-move': 'weight shifted for quick movement, one foot slightly forward, athletic stance',
  'planted': 'weight sunk into ground, immovable presence, refusing to yield space'
};

// ============================================
// EMOTION-BASED MODIFICATIONS
// ============================================

export const EMOTION_BODY_MAP: Record<string, {
  postureShift: string;
  gestureChange: string;
  weightChange: string;
  facialNotes: string;
}> = {
  anger: {
    postureShift: 'shoulders square, chest expands, spine rigid, chin lowers',
    gestureChange: 'hands clench, gestures become sharp and cutting, fingers point',
    weightChange: 'weight shifts forward aggressively, ready to strike or advance',
    facialNotes: 'jaw clenches, nostrils flare, brow furrows, eyes narrow'
  },
  fear: {
    postureShift: 'shoulders hunch, body contracts, chin tucks, makes self smaller',
    gestureChange: 'hands rise protectively, arms cross chest, palms out to ward off',
    weightChange: 'weight shifts to back foot, body angled for escape',
    facialNotes: 'eyes widen, pupils dilate, mouth opens slightly, face pales'
  },
  sadness: {
    postureShift: 'shoulders droop, spine curves, head bows, body collapses inward',
    gestureChange: 'hands touch face, wrap around self, movements become slow',
    weightChange: 'weight sinks down, body heavy, rooted in grief',
    facialNotes: 'eyes glisten, corners of mouth drop, face softens, gaze falls'
  },
  joy: {
    postureShift: 'spine straightens, chest opens, chin lifts, body expands',
    gestureChange: 'hands open, gestures become larger, reaching outward',
    weightChange: 'weight rises, body light, might bounce or sway',
    facialNotes: 'genuine smile reaches eyes, crow\'s feet appear, face brightens'
  },
  shock: {
    postureShift: 'body freezes mid-motion, spine snaps straight, muscles lock',
    gestureChange: 'hands fly to mouth or chest, freeze mid-air, fingers spread',
    weightChange: 'weight shifts abruptly back, body rocks on heels',
    facialNotes: 'eyes fly wide, mouth drops open, face goes slack then tense'
  },
  determination: {
    postureShift: 'shoulders set, spine straightens with purpose, chin levels',
    gestureChange: 'hands ball into fists or press flat, movements become decisive',
    weightChange: 'weight settles firmly, grounded and immovable',
    facialNotes: 'jaw sets, eyes focus, brow lowers with concentration'
  },
  tenderness: {
    postureShift: 'body softens, leans toward other, shoulders open vulnerably',
    gestureChange: 'hands reach gently, fingertips lead, movements slow and careful',
    weightChange: 'weight shifts toward object of tenderness, closing distance',
    facialNotes: 'eyes soften, slight smile, face relaxes, gaze intimate'
  },
  suspicion: {
    postureShift: 'body angles slightly away, shoulders rotate, creates barrier',
    gestureChange: 'arms cross or hands clasp, gestures become small and guarded',
    weightChange: 'weight shifts back, ready to retreat or reposition',
    facialNotes: 'eyes narrow, one eyebrow raises, lips press together'
  },
  defiance: {
    postureShift: 'chin lifts, chest expands, spine straightens with challenge',
    gestureChange: 'hands on hips, or arms crossed high on chest, stance widens',
    weightChange: 'weight plants firmly, refuses to give ground',
    facialNotes: 'jaw juts forward, eyes lock and hold, nostrils may flare'
  },
  shame: {
    postureShift: 'shoulders curl inward, head drops, body tries to disappear',
    gestureChange: 'hands hide face, cover body, avoid drawing attention',
    weightChange: 'weight sinks, body wants to collapse or flee',
    facialNotes: 'eyes drop, can\'t hold gaze, face flushes, jaw tightens'
  }
};

// ============================================
// CHARACTER PROFILE LIBRARY
// ============================================

/**
 * Creates a movement profile for a character based on their personality description
 */
export function inferMovementProfile(
  characterId: string,
  characterName: string,
  personality: string,
  role: string
): CharacterMovementProfile {
  const lower = (personality + ' ' + role).toLowerCase();

  // Infer base posture
  let basePosture: BasePosture = 'relaxed';
  if (lower.includes('confident') || lower.includes('bold') || lower.includes('leader')) {
    basePosture = 'confident';
  } else if (lower.includes('shy') || lower.includes('anxious') || lower.includes('nervous')) {
    basePosture = 'nervous';
  } else if (lower.includes('regal') || lower.includes('noble') || lower.includes('royal')) {
    basePosture = 'regal';
  } else if (lower.includes('warrior') || lower.includes('predator') || lower.includes('hunter')) {
    basePosture = 'predatory';
  } else if (lower.includes('guard') || lower.includes('wary') || lower.includes('suspicious')) {
    basePosture = 'guarded';
  } else if (lower.includes('tired') || lower.includes('weary') || lower.includes('exhausted')) {
    basePosture = 'weary';
  }

  // Infer gesture style
  let gestureStyle: GestureStyle = 'deliberate';
  if (lower.includes('expressive') || lower.includes('dramatic') || lower.includes('passionate')) {
    gestureStyle = 'expansive';
  } else if (lower.includes('reserved') || lower.includes('controlled') || lower.includes('stoic')) {
    gestureStyle = 'contained';
  } else if (lower.includes('nervous') || lower.includes('anxious') || lower.includes('jittery')) {
    gestureStyle = 'fidgety';
  } else if (lower.includes('theatrical') || lower.includes('flamboyant') || lower.includes('performer')) {
    gestureStyle = 'theatrical';
  } else if (lower.includes('quiet') || lower.includes('subtle') || lower.includes('understated')) {
    gestureStyle = 'minimal';
  }

  // Infer weight distribution
  let weightDistribution: WeightDistribution = 'balanced';
  if (lower.includes('aggressive') || lower.includes('eager') || lower.includes('forward')) {
    weightDistribution = 'forward-leaning';
  } else if (lower.includes('cautious') || lower.includes('observant') || lower.includes('distant')) {
    weightDistribution = 'back-on-heels';
  } else if (lower.includes('athletic') || lower.includes('fighter') || lower.includes('warrior')) {
    weightDistribution = 'ready-to-move';
  } else if (lower.includes('stubborn') || lower.includes('immovable') || lower.includes('grounded')) {
    weightDistribution = 'planted';
  }

  // Infer default tension
  let defaultTension: TensionLevel = 'medium';
  if (lower.includes('tense') || lower.includes('coiled') || lower.includes('ready')) {
    defaultTension = 'coiled';
  } else if (lower.includes('relaxed') || lower.includes('calm') || lower.includes('peaceful')) {
    defaultTension = 'low';
  } else if (lower.includes('stressed') || lower.includes('anxious') || lower.includes('on edge')) {
    defaultTension = 'high';
  }

  // Infer space occupation
  let spaceOccupation: 'dominant' | 'neutral' | 'minimizing' = 'neutral';
  if (lower.includes('dominant') || lower.includes('leader') || lower.includes('commander') ||
      lower.includes('confident') || lower.includes('bold')) {
    spaceOccupation = 'dominant';
  } else if (lower.includes('shy') || lower.includes('timid') || lower.includes('invisible') ||
             lower.includes('overlooked')) {
    spaceOccupation = 'minimizing';
  }

  // Build signature moves based on character type
  const signatureMoves: string[] = [];
  if (lower.includes('scholarly') || lower.includes('intellectual')) {
    signatureMoves.push('adjusts glasses', 'strokes chin thoughtfully', 'fingers tap together');
  }
  if (lower.includes('warrior') || lower.includes('soldier')) {
    signatureMoves.push('hand rests on weapon', 'shifts into ready stance', 'squares shoulders');
  }
  if (lower.includes('nervous') || lower.includes('anxious')) {
    signatureMoves.push('touches hair', 'wrings hands', 'looks for exits');
  }
  if (lower.includes('confident') || lower.includes('cocky')) {
    signatureMoves.push('crosses arms with smirk', 'tilts head with amusement', 'takes up space casually');
  }
  if (lower.includes('aristocratic') || lower.includes('noble')) {
    signatureMoves.push('lifts chin', 'examines nails', 'looks down nose');
  }

  return {
    characterId,
    characterName,
    basePosture,
    gestureStyle,
    weightDistribution,
    defaultTension,
    signatureMoves,
    spaceOccupation,
    emotionOverrides: {}
  };
}

/**
 * Get body language description for a character experiencing an emotion
 */
export function getCharacterBodyLanguage(
  profile: CharacterMovementProfile,
  emotion: string
): {
  posture: string;
  gesture: string;
  weight: string;
  hands: string;
  face: string;
} {
  // Get base descriptions
  const basePosture = POSTURE_DESCRIPTIONS[profile.basePosture];
  const baseGesture = GESTURE_DESCRIPTIONS[profile.gestureStyle];
  const baseWeight = WEIGHT_DESCRIPTIONS[profile.weightDistribution];

  // Get emotion-specific modifications
  const emotionMod = EMOTION_BODY_MAP[emotion.toLowerCase()];
  const characterOverride = profile.emotionOverrides[emotion.toLowerCase()];

  if (emotionMod) {
    return {
      posture: characterOverride?.postureShift || emotionMod.postureShift,
      gesture: characterOverride?.gestureChange || emotionMod.gestureChange,
      weight: characterOverride?.weightChange || emotionMod.weightChange,
      hands: emotionMod.gestureChange,
      face: emotionMod.facialNotes
    };
  }

  // Fallback to base descriptions modified by default tension
  const tensionNote = profile.defaultTension === 'high' ? 'with visible tension' :
                      profile.defaultTension === 'coiled' ? 'coiled energy ready to release' :
                      profile.defaultTension === 'low' ? 'at ease' : '';

  return {
    posture: `${basePosture}${tensionNote ? ', ' + tensionNote : ''}`,
    gesture: baseGesture,
    weight: baseWeight,
    hands: profile.gestureStyle === 'fidgety' ? 'restless, touching or moving' :
           profile.gestureStyle === 'contained' ? 'controlled, close to body' : 'natural, matching emotional state',
    face: 'expression matches emotional state with character\'s typical intensity'
  };
}

/**
 * Get asymmetric body language suggestions for two characters in a scene
 */
export function getSuggestedAsymmetry(
  character1: CharacterMovementProfile,
  emotion1: string,
  character2: CharacterMovementProfile,
  emotion2: string
): {
  description: string;
  character1Direction: string;
  character2Direction: string;
} {
  const body1 = getCharacterBodyLanguage(character1, emotion1);
  const body2 = getCharacterBodyLanguage(character2, emotion2);

  // Determine relative power/space occupation
  const c1Dominant = character1.spaceOccupation === 'dominant';
  const c2Dominant = character2.spaceOccupation === 'dominant';

  // Generate asymmetry description
  let description = '';
  let c1Dir = '';
  let c2Dir = '';

  if (c1Dominant && !c2Dominant) {
    description = `${character1.characterName} expands and takes space while ${character2.characterName} contracts`;
    c1Dir = 'advancing, weight forward, expanded posture';
    c2Dir = 'retreating slightly, weight back, contained posture';
  } else if (c2Dominant && !c1Dominant) {
    description = `${character2.characterName} dominates the space while ${character1.characterName} yields`;
    c1Dir = 'yielding, weight back, defensive posture';
    c2Dir = 'advancing, weight forward, commanding posture';
  } else {
    // Both similar status - differentiate by emotion
    const hotEmotions = ['anger', 'passion', 'determination', 'defiance'];
    const coldEmotions = ['fear', 'shame', 'sadness', 'suspicion'];

    const e1Hot = hotEmotions.includes(emotion1.toLowerCase());
    const e2Hot = hotEmotions.includes(emotion2.toLowerCase());

    if (e1Hot && !e2Hot) {
      description = `${character1.characterName} burns hot while ${character2.characterName} freezes`;
      c1Dir = 'aggressive, forward, expanded';
      c2Dir = 'withdrawn, protective, contracted';
    } else if (e2Hot && !e1Hot) {
      description = `${character2.characterName} burns hot while ${character1.characterName} freezes`;
      c1Dir = 'withdrawn, protective, contracted';
      c2Dir = 'aggressive, forward, expanded';
    } else {
      description = `Both characters hold their ground in tension, creating static electricity between them`;
      c1Dir = 'planted, ready, contained energy';
      c2Dir = 'planted, ready, contained energy building';
    }
  }

  return {
    description,
    character1Direction: c1Dir,
    character2Direction: c2Dir
  };
}
