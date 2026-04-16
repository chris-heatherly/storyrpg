/**
 * Character Reference Sheet Agent
 * 
 * Generates comprehensive character reference sheets with multiple views
 * and expressions for visual consistency across all story images.
 * 
 * Outputs:
 * - POSE SHEET: Front, three-quarter, profile, back views (full body)
 * - EXPRESSION SHEET: 25 essential expressions (face close-ups, separate from poses)
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { ImagePrompt } from '../ImageGenerator';
// NOTE: We intentionally do NOT import CORE_VISUAL_PRINCIPLE or BODY_LANGUAGE_VOCABULARY
// from the storytelling system. Those principles tell the LLM "every image is a story beat,
// not a portrait" and forbid "character standing center-frame" — the exact things a reference
// sheet NEEDS. Reference sheets must be isolated from scene-oriented storytelling principles.
import { 
  MOBILE_COMPOSITION_FRAMEWORK,
} from '../../prompts';

// ============================================
// 25 ESSENTIAL EXPRESSIONS
// ============================================

export type ExpressionName = 
  // Core emotions (7)
  | 'neutral'      // Baseline/resting face
  | 'happy'        // Genuine joy
  | 'sad'          // Melancholy or disappointment
  | 'angry'        // Standard frustration
  | 'surprised'    // Wide eyes, high brows
  | 'scared'       // Fear or anxiety
  | 'disgusted'    // The "yuck" face
  // Secondary emotions (8)
  | 'pleased'      // Contentment or smug satisfaction
  | 'bored'        // Disinterest or apathy
  | 'tired'        // Exhaustion or sleepiness
  | 'arrogant'     // Confidence or looking down on others
  | 'irritated'    // Annoyance or "done with this"
  | 'confused'     // Puzzlement or skepticism
  | 'flirty'       // Soft eyes, slight blush
  | 'fierce'       // Determination or "battle mode"
  // Extreme emotions (5)
  | 'rage'         // Extreme, violent anger
  | 'terror'       // Extreme, paralyzing fear
  | 'grief'        // Deep sobbing or mourning
  | 'pain'         // Physical or sharp emotional sting
  | 'hollow'       // Emotional numbness or shock
  // Character expressions (5)
  | 'silly'        // Goofing off/breaking character
  | 'nauseous'     // Sickness or physical revulsion
  | 'drunk'        // Disorientation or intoxication
  | 'sarcastic'    // Eye roll or cynical smirk
  | 'pouty';       // Childish sulking

// Expression with metadata for generation
export interface ExpressionDefinition {
  name: ExpressionName;
  category: 'core' | 'secondary' | 'extreme' | 'character';
  description: string;
  // === THE 3 KEY EXPRESSION LANDMARKS ===
  eyebrows: string;          // Dictates the ATTITUDE of the emotion
  eyelids: string;           // Dictates the INTENSITY (wide/narrow)
  mouth: string;             // Dictates the FLAVOR (open=loud, closed=internal)
  // Supporting details
  facialFeatures: string;    // Other facial muscle descriptions
  microExpressions: string;  // Subtle details to include
  eyeDescription: string;    // Full eye description (includes eyelids + gaze)
  mouthDescription: string;  // Full mouth description
  bodyLanguageHint?: string; // Optional body language if visible
}

// ============================================
// EXPRESSION PACING & TRANSITION RULES
// ============================================

export const EXPRESSION_PACING_RULES = `
## EXPRESSION PACING RULES (CRITICAL FOR EMOTIONAL IMPACT)

### 1. RESERVE EXTREME EXPRESSIONS
Extreme expressions (rage, terror, grief, pain, hollow) MUST be used sparingly:
- Deploy ONLY at genuine narrative peaks
- Maximum 1-2 extreme expressions per scene
- Repeated extreme expressions DESENSITIZE readers and lose impact
- If a scene has multiple "climax" moments, vary the type of extreme

**Extreme expressions to track**: rage, terror, grief, pain, hollow

### 2. GRADUAL EMOTIONAL TRANSITIONS
Characters should progress through emotions believably:
- NO jarring jumps between polar opposite emotions (happy → grief)
- Show intermediate states between emotional beats
- Allow 1-2 transition beats for major emotional shifts

**Emotional Distance Rules**:
- ADJACENT emotions (1 step): happy ↔ pleased, sad ↔ tired, angry ↔ irritated
- MODERATE distance (2-3 steps): happy → neutral → sad (needs transition)
- EXTREME distance (4+ steps): happy → grief (REQUIRES intermediate beats)

### 3. EMOTIONAL TRANSITION PATHS
When transitioning between distant emotions, use these paths:

**Positive → Negative**:
- happy → pleased → neutral → confused → sad
- happy → surprised → scared → terror (shock path)
- pleased → neutral → irritated → angry → rage

**Negative → Positive**:
- sad → tired → neutral → pleased → happy
- angry → irritated → neutral → pleased
- scared → confused → neutral → happy

**Within Negative**:
- sad → hollow → grief (deepening)
- angry → fierce → rage (intensifying)
- scared → terror (escalating)

### 4. PACING VIOLATIONS TO FLAG
- More than 2 extreme expressions in a single scene
- Direct jump from positive to extreme negative (or vice versa)
- Same extreme expression used consecutively
- Character emotional state changes too rapidly without story justification
`;

// Emotional distance matrix for transition validation
export const EMOTION_DISTANCE_MAP: Record<ExpressionName, Record<ExpressionName, number>> = {
  // Distances from each emotion to others (1=adjacent, 5=extreme opposite)
  'neutral': { 'neutral': 0, 'happy': 2, 'sad': 2, 'angry': 2, 'surprised': 2, 'scared': 2, 'disgusted': 2, 'pleased': 1, 'bored': 1, 'tired': 1, 'arrogant': 2, 'irritated': 1, 'confused': 1, 'flirty': 2, 'fierce': 2, 'rage': 4, 'terror': 4, 'grief': 4, 'pain': 3, 'hollow': 3, 'silly': 2, 'nauseous': 2, 'drunk': 2, 'sarcastic': 1, 'pouty': 2 },
  'happy': { 'neutral': 2, 'happy': 0, 'sad': 4, 'angry': 4, 'surprised': 2, 'scared': 4, 'disgusted': 4, 'pleased': 1, 'bored': 3, 'tired': 3, 'arrogant': 2, 'irritated': 3, 'confused': 2, 'flirty': 1, 'fierce': 3, 'rage': 5, 'terror': 5, 'grief': 5, 'pain': 4, 'hollow': 5, 'silly': 1, 'nauseous': 4, 'drunk': 2, 'sarcastic': 3, 'pouty': 3 },
  'sad': { 'neutral': 2, 'happy': 4, 'sad': 0, 'angry': 3, 'surprised': 3, 'scared': 2, 'disgusted': 3, 'pleased': 4, 'bored': 2, 'tired': 1, 'arrogant': 4, 'irritated': 2, 'confused': 2, 'flirty': 4, 'fierce': 3, 'rage': 3, 'terror': 3, 'grief': 1, 'pain': 1, 'hollow': 1, 'silly': 4, 'nauseous': 2, 'drunk': 3, 'sarcastic': 3, 'pouty': 1 },
  'angry': { 'neutral': 2, 'happy': 4, 'sad': 3, 'angry': 0, 'surprised': 2, 'scared': 3, 'disgusted': 2, 'pleased': 4, 'bored': 3, 'tired': 3, 'arrogant': 2, 'irritated': 1, 'confused': 2, 'flirty': 4, 'fierce': 1, 'rage': 1, 'terror': 3, 'grief': 3, 'pain': 2, 'hollow': 3, 'silly': 4, 'nauseous': 3, 'drunk': 3, 'sarcastic': 2, 'pouty': 2 },
  'surprised': { 'neutral': 2, 'happy': 2, 'sad': 3, 'angry': 2, 'surprised': 0, 'scared': 1, 'disgusted': 2, 'pleased': 2, 'bored': 4, 'tired': 4, 'arrogant': 3, 'irritated': 2, 'confused': 1, 'flirty': 2, 'fierce': 2, 'rage': 3, 'terror': 1, 'grief': 3, 'pain': 2, 'hollow': 3, 'silly': 2, 'nauseous': 2, 'drunk': 2, 'sarcastic': 3, 'pouty': 3 },
  'scared': { 'neutral': 2, 'happy': 4, 'sad': 2, 'angry': 3, 'surprised': 1, 'scared': 0, 'disgusted': 2, 'pleased': 4, 'bored': 4, 'tired': 3, 'arrogant': 4, 'irritated': 2, 'confused': 1, 'flirty': 4, 'fierce': 2, 'rage': 3, 'terror': 1, 'grief': 2, 'pain': 1, 'hollow': 2, 'silly': 4, 'nauseous': 2, 'drunk': 3, 'sarcastic': 4, 'pouty': 3 },
  'disgusted': { 'neutral': 2, 'happy': 4, 'sad': 3, 'angry': 2, 'surprised': 2, 'scared': 2, 'disgusted': 0, 'pleased': 4, 'bored': 2, 'tired': 2, 'arrogant': 2, 'irritated': 1, 'confused': 2, 'flirty': 4, 'fierce': 2, 'rage': 2, 'terror': 3, 'grief': 3, 'pain': 2, 'hollow': 3, 'silly': 4, 'nauseous': 1, 'drunk': 3, 'sarcastic': 2, 'pouty': 2 },
  'pleased': { 'neutral': 1, 'happy': 1, 'sad': 4, 'angry': 4, 'surprised': 2, 'scared': 4, 'disgusted': 4, 'pleased': 0, 'bored': 2, 'tired': 2, 'arrogant': 1, 'irritated': 3, 'confused': 2, 'flirty': 1, 'fierce': 3, 'rage': 5, 'terror': 5, 'grief': 5, 'pain': 4, 'hollow': 4, 'silly': 2, 'nauseous': 4, 'drunk': 2, 'sarcastic': 2, 'pouty': 3 },
  'bored': { 'neutral': 1, 'happy': 3, 'sad': 2, 'angry': 3, 'surprised': 4, 'scared': 4, 'disgusted': 2, 'pleased': 2, 'bored': 0, 'tired': 1, 'arrogant': 2, 'irritated': 1, 'confused': 2, 'flirty': 3, 'fierce': 4, 'rage': 4, 'terror': 5, 'grief': 3, 'pain': 3, 'hollow': 2, 'silly': 3, 'nauseous': 2, 'drunk': 2, 'sarcastic': 1, 'pouty': 2 },
  'tired': { 'neutral': 1, 'happy': 3, 'sad': 1, 'angry': 3, 'surprised': 4, 'scared': 3, 'disgusted': 2, 'pleased': 2, 'bored': 1, 'tired': 0, 'arrogant': 3, 'irritated': 2, 'confused': 2, 'flirty': 3, 'fierce': 4, 'rage': 4, 'terror': 4, 'grief': 2, 'pain': 2, 'hollow': 1, 'silly': 3, 'nauseous': 1, 'drunk': 1, 'sarcastic': 2, 'pouty': 2 },
  'arrogant': { 'neutral': 2, 'happy': 2, 'sad': 4, 'angry': 2, 'surprised': 3, 'scared': 4, 'disgusted': 2, 'pleased': 1, 'bored': 2, 'tired': 3, 'arrogant': 0, 'irritated': 2, 'confused': 3, 'flirty': 2, 'fierce': 2, 'rage': 3, 'terror': 5, 'grief': 5, 'pain': 4, 'hollow': 4, 'silly': 3, 'nauseous': 4, 'drunk': 3, 'sarcastic': 1, 'pouty': 3 },
  'irritated': { 'neutral': 1, 'happy': 3, 'sad': 2, 'angry': 1, 'surprised': 2, 'scared': 2, 'disgusted': 1, 'pleased': 3, 'bored': 1, 'tired': 2, 'arrogant': 2, 'irritated': 0, 'confused': 2, 'flirty': 4, 'fierce': 2, 'rage': 2, 'terror': 3, 'grief': 3, 'pain': 2, 'hollow': 3, 'silly': 4, 'nauseous': 2, 'drunk': 3, 'sarcastic': 1, 'pouty': 1 },
  'confused': { 'neutral': 1, 'happy': 2, 'sad': 2, 'angry': 2, 'surprised': 1, 'scared': 1, 'disgusted': 2, 'pleased': 2, 'bored': 2, 'tired': 2, 'arrogant': 3, 'irritated': 2, 'confused': 0, 'flirty': 3, 'fierce': 3, 'rage': 4, 'terror': 2, 'grief': 3, 'pain': 2, 'hollow': 2, 'silly': 2, 'nauseous': 2, 'drunk': 1, 'sarcastic': 2, 'pouty': 2 },
  'flirty': { 'neutral': 2, 'happy': 1, 'sad': 4, 'angry': 4, 'surprised': 2, 'scared': 4, 'disgusted': 4, 'pleased': 1, 'bored': 3, 'tired': 3, 'arrogant': 2, 'irritated': 4, 'confused': 3, 'flirty': 0, 'fierce': 4, 'rage': 5, 'terror': 5, 'grief': 5, 'pain': 4, 'hollow': 5, 'silly': 2, 'nauseous': 5, 'drunk': 2, 'sarcastic': 3, 'pouty': 3 },
  'fierce': { 'neutral': 2, 'happy': 3, 'sad': 3, 'angry': 1, 'surprised': 2, 'scared': 2, 'disgusted': 2, 'pleased': 3, 'bored': 4, 'tired': 4, 'arrogant': 2, 'irritated': 2, 'confused': 3, 'flirty': 4, 'fierce': 0, 'rage': 1, 'terror': 3, 'grief': 3, 'pain': 2, 'hollow': 3, 'silly': 4, 'nauseous': 3, 'drunk': 4, 'sarcastic': 3, 'pouty': 3 },
  'rage': { 'neutral': 4, 'happy': 5, 'sad': 3, 'angry': 1, 'surprised': 3, 'scared': 3, 'disgusted': 2, 'pleased': 5, 'bored': 4, 'tired': 4, 'arrogant': 3, 'irritated': 2, 'confused': 4, 'flirty': 5, 'fierce': 1, 'rage': 0, 'terror': 3, 'grief': 2, 'pain': 2, 'hollow': 3, 'silly': 5, 'nauseous': 3, 'drunk': 4, 'sarcastic': 4, 'pouty': 3 },
  'terror': { 'neutral': 4, 'happy': 5, 'sad': 3, 'angry': 3, 'surprised': 1, 'scared': 1, 'disgusted': 3, 'pleased': 5, 'bored': 5, 'tired': 4, 'arrogant': 5, 'irritated': 3, 'confused': 2, 'flirty': 5, 'fierce': 3, 'rage': 3, 'terror': 0, 'grief': 2, 'pain': 1, 'hollow': 2, 'silly': 5, 'nauseous': 2, 'drunk': 4, 'sarcastic': 5, 'pouty': 4 },
  'grief': { 'neutral': 4, 'happy': 5, 'sad': 1, 'angry': 3, 'surprised': 3, 'scared': 2, 'disgusted': 3, 'pleased': 5, 'bored': 3, 'tired': 2, 'arrogant': 5, 'irritated': 3, 'confused': 3, 'flirty': 5, 'fierce': 3, 'rage': 2, 'terror': 2, 'grief': 0, 'pain': 1, 'hollow': 1, 'silly': 5, 'nauseous': 2, 'drunk': 3, 'sarcastic': 4, 'pouty': 2 },
  'pain': { 'neutral': 3, 'happy': 4, 'sad': 1, 'angry': 2, 'surprised': 2, 'scared': 1, 'disgusted': 2, 'pleased': 4, 'bored': 3, 'tired': 2, 'arrogant': 4, 'irritated': 2, 'confused': 2, 'flirty': 4, 'fierce': 2, 'rage': 2, 'terror': 1, 'grief': 1, 'pain': 0, 'hollow': 1, 'silly': 4, 'nauseous': 1, 'drunk': 3, 'sarcastic': 4, 'pouty': 2 },
  'hollow': { 'neutral': 3, 'happy': 5, 'sad': 1, 'angry': 3, 'surprised': 3, 'scared': 2, 'disgusted': 3, 'pleased': 4, 'bored': 2, 'tired': 1, 'arrogant': 4, 'irritated': 3, 'confused': 2, 'flirty': 5, 'fierce': 3, 'rage': 3, 'terror': 2, 'grief': 1, 'pain': 1, 'hollow': 0, 'silly': 5, 'nauseous': 2, 'drunk': 2, 'sarcastic': 4, 'pouty': 3 },
  'silly': { 'neutral': 2, 'happy': 1, 'sad': 4, 'angry': 4, 'surprised': 2, 'scared': 4, 'disgusted': 4, 'pleased': 2, 'bored': 3, 'tired': 3, 'arrogant': 3, 'irritated': 4, 'confused': 2, 'flirty': 2, 'fierce': 4, 'rage': 5, 'terror': 5, 'grief': 5, 'pain': 4, 'hollow': 5, 'silly': 0, 'nauseous': 3, 'drunk': 1, 'sarcastic': 2, 'pouty': 2 },
  'nauseous': { 'neutral': 2, 'happy': 4, 'sad': 2, 'angry': 3, 'surprised': 2, 'scared': 2, 'disgusted': 1, 'pleased': 4, 'bored': 2, 'tired': 1, 'arrogant': 4, 'irritated': 2, 'confused': 2, 'flirty': 5, 'fierce': 3, 'rage': 3, 'terror': 2, 'grief': 2, 'pain': 1, 'hollow': 2, 'silly': 3, 'nauseous': 0, 'drunk': 1, 'sarcastic': 3, 'pouty': 2 },
  'drunk': { 'neutral': 2, 'happy': 2, 'sad': 3, 'angry': 3, 'surprised': 2, 'scared': 3, 'disgusted': 3, 'pleased': 2, 'bored': 2, 'tired': 1, 'arrogant': 3, 'irritated': 3, 'confused': 1, 'flirty': 2, 'fierce': 4, 'rage': 4, 'terror': 4, 'grief': 3, 'pain': 3, 'hollow': 2, 'silly': 1, 'nauseous': 1, 'drunk': 0, 'sarcastic': 2, 'pouty': 2 },
  'sarcastic': { 'neutral': 1, 'happy': 3, 'sad': 3, 'angry': 2, 'surprised': 3, 'scared': 4, 'disgusted': 2, 'pleased': 2, 'bored': 1, 'tired': 2, 'arrogant': 1, 'irritated': 1, 'confused': 2, 'flirty': 3, 'fierce': 3, 'rage': 4, 'terror': 5, 'grief': 4, 'pain': 4, 'hollow': 4, 'silly': 2, 'nauseous': 3, 'drunk': 2, 'sarcastic': 0, 'pouty': 2 },
  'pouty': { 'neutral': 2, 'happy': 3, 'sad': 1, 'angry': 2, 'surprised': 3, 'scared': 3, 'disgusted': 2, 'pleased': 3, 'bored': 2, 'tired': 2, 'arrogant': 3, 'irritated': 1, 'confused': 2, 'flirty': 3, 'fierce': 3, 'rage': 3, 'terror': 4, 'grief': 2, 'pain': 2, 'hollow': 3, 'silly': 2, 'nauseous': 2, 'drunk': 2, 'sarcastic': 2, 'pouty': 0 }
};

// Extreme expressions that should be used sparingly
export const EXTREME_EXPRESSIONS: ExpressionName[] = ['rage', 'terror', 'grief', 'pain', 'hollow'];

// Helper to get emotional distance between two expressions
export function getEmotionalDistance(from: ExpressionName, to: ExpressionName): number {
  return EMOTION_DISTANCE_MAP[from]?.[to] ?? 3;
}

// Helper to check if an expression is extreme
export function isExtremeExpression(expression: ExpressionName): boolean {
  return EXTREME_EXPRESSIONS.includes(expression);
}

// Helper to suggest intermediate expressions for a transition
export function suggestTransitionPath(from: ExpressionName, to: ExpressionName): ExpressionName[] {
  const distance = getEmotionalDistance(from, to);
  if (distance <= 2) return []; // Direct transition OK
  
  // Common transition paths
  const transitionPaths: Record<string, ExpressionName[]> = {
    'happy->sad': ['pleased', 'neutral'],
    'happy->angry': ['surprised', 'irritated'],
    'happy->scared': ['surprised'],
    'happy->grief': ['surprised', 'sad'],
    'happy->rage': ['surprised', 'angry'],
    'happy->terror': ['surprised', 'scared'],
    'sad->happy': ['neutral', 'pleased'],
    'sad->angry': ['irritated'],
    'angry->happy': ['irritated', 'neutral', 'pleased'],
    'angry->sad': ['irritated', 'tired'],
    'scared->happy': ['surprised', 'neutral', 'pleased'],
    'pleased->grief': ['neutral', 'sad'],
    'neutral->rage': ['irritated', 'angry'],
    'neutral->terror': ['confused', 'scared'],
  };
  
  const key = `${from}->${to}`;
  return transitionPaths[key] || ['neutral'];
}

// ============================================
// BODY LANGUAGE AS PRIMARY STORYTELLING
// ============================================

export const BODY_LANGUAGE_PRINCIPLES = `
## BODY LANGUAGE AS PRIMARY STORYTELLING CHANNEL

Every image is a "performance still" where POSE carries intention, emotion, and relationship.
No text, no speech bubbles - the BODY tells the story.

### CORE RULE: NO NEUTRAL POSES
**BANNED**: Arms at sides, straight spine, standing like a mannequin.
Every frame MUST include at least ONE of:
- Lean (forward/back/side)
- Arm/hand action
- Weight shift
- Head tilt / neck angle

### THE BODY-FACE AGREEMENT RULE
Face and body must AGREE (or consciously disagree for subtext):
- Smile + open relaxed shoulders → genuine warmth
- Smile + hunched tense shoulders → nervous, fake
- Frown + slumped torso → sadness
- Frown + forward lean + clenched fists → anger/determination

### HANDS SELL THE REAL EMOTION
- Hidden hands (pockets, behind back) → concealment, secrecy
- Fidgeting, self-contact → anxiety, insecurity
- Open palms outward → openness, pleading
- Pointing, jabbing → assertiveness, aggression
- Arms folded, fingers digging in → defensive, self-protective
`;

export const STATUS_BODY_LANGUAGE = `
## STATUS THROUGH BODY LANGUAGE

### HIGH STATUS / DOMINANCE
- Upright spine, open chest
- Chin up, direct gaze
- Expanded space occupation
- Weight forward, planted
- Slow, deliberate gestures
- Hands: on hips, steepled, or open commanding gestures

### LOW STATUS / SUBMISSION
- Curved spine, shoulders forward
- Chin tucked, gaze averted or upward (seeking approval)
- Minimal space occupation
- Weight back, ready to retreat
- Quick, small gestures
- Hands: fidgeting, self-contact, protective in front

### EQUAL STATUS
- Mirrored postures (both open or both guarded)
- Eye level matching
- Balanced space sharing
- Neither advancing nor retreating
`;

export const APPROACH_AVOIDANCE_LANGUAGE = `
## APPROACH VS AVOIDANCE BODY LANGUAGE

### APPROACH (Connection, Engagement)
- Torso leaning toward target
- Weight toward front foot
- Open chest facing other person
- Reaching gestures
- Feet pointed toward target
- Reduced physical distance

### AVOIDANCE (Withdrawal, Protection)
- Lean away from target
- Weight back on rear foot
- Chest turned away or closed
- Arms closer to body, protective
- Feet angled toward exit
- Increased physical distance
- One shoulder forward as barrier
`;

export const SILHOUETTE_RULES = `
## SILHOUETTE CLARITY (HARD CONSTRAINT)

Every image MUST read emotionally even as a thumbnail/silhouette.

### SILHOUETTE REQUIREMENTS
- Head clearly separated from torso (no head buried in shoulders unless intentional)
- Hands visible and separated from body (not lost behind)
- Limbs staggered, NOT parallel
- Clear overall shape that reads the emotion

### SILHOUETTE GOALS BY EMOTION
- Fear/Withdrawal: small, contracted, curled inward
- Anger/Aggression: expanded, forward-leaning, pointed gestures
- Sadness/Defeat: slumped, collapsed, rounded
- Confidence/Power: tall, wide stance, expanded chest
- Connection: open toward other, reaching
- Conflict: two figures squared off, one leaning in

### SILHOUETTE TEST
If you removed all detail and just saw the black shape, 
would the emotional beat still be clear?
`;

// Character Body Vocabulary - per-character pose profile
export interface CharacterBodyVocabulary {
  characterId: string;
  characterName: string;
  
  // Base posture (their "default" way of standing/sitting)
  basePosture: {
    spine: 'upright' | 'slightly_hunched' | 'rigid' | 'relaxed_slouch' | 'military_straight';
    shoulders: 'open_confident' | 'slightly_forward' | 'hunched_protective' | 'squared_tense';
    chestDefault: 'open' | 'neutral' | 'slightly_closed';
    stanceWidth: 'wide' | 'normal' | 'narrow';
    description: string; // e.g., "expansive, forward-leaning, open chest"
  };
  
  // Gesture style (how they move their hands)
  gestureStyle: {
    size: 'expansive_big' | 'moderate' | 'small_precise' | 'minimal';
    frequency: 'constant' | 'frequent' | 'occasional' | 'rare';
    type: 'sweeping' | 'pointing' | 'illustrative' | 'contained' | 'self_contact';
    description: string; // e.g., "big sweeping arm gestures"
  };
  
  // Characteristic poses (signature looks)
  signaturePoses: Array<{
    situation: string; // e.g., "confident", "thinking", "angry"
    poseDescription: string;
    keyElements: string[];
  }>;
  
  // Status defaults (how they naturally relate to others)
  statusDefaults: {
    withSuperiors: 'respectful' | 'challenging' | 'submissive' | 'defiant';
    withEquals: 'collaborative' | 'competitive' | 'distant' | 'warm';
    withSubordinates: 'supportive' | 'commanding' | 'dismissive' | 'nurturing';
  };
  
  // Stress/comfort tells (how they show internal state)
  stressTells: string[]; // e.g., ["rubs back of neck", "clenches jaw", "crosses arms tighter"]
  comfortTells: string[]; // e.g., ["hands in pockets relaxed", "weight on one hip", "easy smile"]
  
  // Object interactions (do they hold things?)
  objectInteraction: {
    typicalObjects: string[]; // e.g., ["coffee mug", "tablet", "weapon"]
    holdingStyle: string; // e.g., "clutches objects to chest when nervous"
  };
}

// ============================================
// CHARACTER SILHOUETTE PROFILE
// ============================================

/**
 * Shape language - conveys personality through overall silhouette
 */
export type ShapeLanguage = 
  | 'round'     // Friendly, safe, approachable, comic
  | 'angular'   // Aggressive, dangerous, unstable, dynamic
  | 'blocky'    // Rigid, stoic, strong, immovable
  | 'mixed';    // Complex personality, combination

/**
 * Character silhouette profile - defines recognizable outline
 * Created once per character, referenced in all beat specs
 */
export interface CharacterSilhouetteProfile {
  characterId: string;
  characterName: string;
  
  // Shape language reflects personality
  shapeLanguage: ShapeLanguage;
  shapeLanguageNotes: string;  // "angular spikes suggest danger, but rounded face softens"
  
  // 2-3 distinctive traits recognizable in black fill
  silhouetteHooks: string[];   // ["huge gauntlet", "asymmetric horned hair", "flowing cape"]
  
  // Which side is different (helps orientation)
  asymmetryNotes: string[];    // ["larger left shoulder pad", "weapon always on right hip"]
  
  // Signature color/pattern for quick recognition
  colorGraphicHook?: string;   // "pink stripe on arm", "glowing chest emblem"
  
  // Signature prop outline
  propSilhouette?: string;     // "curved blade with distinctive crossguard"
  
  // Large-medium-small shape hierarchy
  shapeHierarchy: {
    largeShapes: string[];     // Main body masses
    mediumDetails: string[];   // Secondary features
    smallAccents: string[];    // Fine details (not too many!)
  };
  
  // How this character contrasts against typical backgrounds
  contrastNotes: string;       // "dark character needs light BG, or rim lighting"
}

/**
 * Silhouette design rules
 */
export const SILHOUETTE_DESIGN_RULES = `
## CHARACTER SILHOUETTE DESIGN (Black Fill Test)

### CORE PRINCIPLE
If you fill the character solid black, viewers should still:
- Identify WHO this character is
- See their POSE and ACTION
- Know which DIRECTION they're facing

### SHAPE LANGUAGE → PERSONALITY
- **ROUND/SOFT**: Friendly, safe, approachable, comic
- **ANGULAR/SPIKY**: Aggressive, dangerous, unstable
- **BLOCKY/STRAIGHT**: Rigid, stoic, strong, reliable
- **MIXED**: Complex personality, use dominant + accent shapes

### 2-3 SILHOUETTE HOOKS
Each major character needs 2-3 distinctive traits visible in outline:
- Unique hair shape (horns, spikes, distinctive cut)
- Signature prop (weapon shape, backpack, staff)
- Costume element (cape, shoulder pads, long coat)
- Body proportion (very tall/short, broad shoulders, thin limbs)

### ASYMMETRY FOR ORIENTATION
Avoid perfectly symmetrical designs:
- One shoulder different (pad, sleeve, strap)
- Weapon/prop on one side
- Asymmetric hair or accessory
This helps viewers know which way character is facing even in silhouette.

### SHAPE HIERARCHY
Build from BIG to small:
- Large shapes: main body masses (torso, head, limbs)
- Medium details: costume features, accessories
- Small accents: just a few! (buttons, small emblems)
Too many small details = muddy silhouette

### CONTRAST AGAINST BACKGROUND
Plan how character reads against typical scene backgrounds:
- Dark character → needs light backgrounds or rim lighting
- Light character → works on dark backgrounds
- Consider value separation in silhouette design
`;

// Complete character reference now includes body vocabulary AND silhouette profile
export interface CharacterFullReference {
  poseSheet: CharacterReferenceSheet;
  expressionSheet: CharacterExpressionSheet;
  bodyVocabulary: CharacterBodyVocabulary;
  silhouetteProfile: CharacterSilhouetteProfile;
}

// The 3 key landmarks that define expression readability
export const EXPRESSION_LANDMARKS = `
## THE 3 KEY EXPRESSION LANDMARKS (CRITICAL FOR READABILITY)

To make expressions "read" well, focus on these three primary areas:

### 1. EYEBROWS (Dictates ATTITUDE)
- Raised high = surprise, fear, concern
- Furrowed/lowered = anger, focus, determination
- Raised inner corners = sadness, worry, pleading
- One raised = skepticism, confusion, flirtation
- Relaxed = neutral, calm, content

### 2. EYELIDS (Dictates INTENSITY)
- Wide open = surprise, fear, terror, alertness
- Narrowed/squinted = focus, suspicion, anger, smugness
- Half-lidded = tired, bored, seductive, arrogant
- Squeezed shut = pain, grief, laughter
- Normal = neutral, calm

### 3. MOUTH (Dictates FLAVOR)
- Open wide = loud emotions (screaming, laughing, shock)
- Closed/pressed = internal emotions (quiet anger, determination, holding back)
- Corners up = positive (happy, pleased, smug)
- Corners down = negative (sad, disgusted, disappointed)
- Asymmetric = complex emotions (smirk, skepticism, mixed feelings)

**PROMPT RULE**: Every expression prompt MUST explicitly describe all three landmarks.
`;

// The complete 25 expressions library with 3 key landmarks
export const EXPRESSION_LIBRARY: ExpressionDefinition[] = [
  // === CORE EMOTIONS (7) - Always generate for any character ===
  {
    name: 'neutral',
    category: 'core',
    description: 'Baseline resting face - calm, relaxed, no strong emotion',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RELAXED - natural position, neither raised nor furrowed',
    eyelids: 'NORMAL - natural openness, comfortable',
    mouth: 'CLOSED RELAXED - lips gently together or slightly parted, no tension',
    // Supporting details
    facialFeatures: 'relaxed facial muscles, natural resting position',
    microExpressions: 'slight natural asymmetry, comfortable breathing',
    eyeDescription: 'eyes at natural openness, relaxed gaze, pupils normal',
    mouthDescription: 'lips gently closed or slightly parted, no tension'
  },
  {
    name: 'happy',
    category: 'core',
    description: 'Genuine joy - authentic smile reaching the eyes',
    // THE 3 KEY LANDMARKS
    eyebrows: 'SLIGHTLY RAISED - lifted by cheek muscles, relaxed arch',
    eyelids: 'NARROWED BY CHEEKS - squinted by genuine smile, crow\'s feet',
    mouth: 'OPEN CORNERS UP - genuine smile showing teeth, lifted corners',
    // Supporting details
    facialFeatures: 'raised cheeks, crow\'s feet wrinkles, lifted brow',
    microExpressions: 'Duchenne smile markers, slight head tilt, warmth',
    eyeDescription: 'eyes crinkled at corners, bright and sparkling, narrowed by cheeks',
    mouthDescription: 'genuine smile showing teeth, lifted corners, relaxed jaw'
  },
  {
    name: 'sad',
    category: 'core',
    description: 'Melancholy or disappointment - downturned features',
    // THE 3 KEY LANDMARKS
    eyebrows: 'INNER CORNERS RAISED - the "sad brow" shape, angled up in middle',
    eyelids: 'HEAVY - drooping, slightly lowered, may be watery',
    mouth: 'CLOSED CORNERS DOWN - downturned corners, may quiver',
    // Supporting details
    facialFeatures: 'inner eyebrows raised, lowered gaze, slack muscles',
    microExpressions: 'subtle trembling, distant look, vulnerable',
    eyeDescription: 'eyes slightly watery or glossy, downcast, heavy lids',
    mouthDescription: 'corners turned down, lower lip may protrude slightly'
  },
  {
    name: 'angry',
    category: 'core',
    description: 'Standard frustration - controlled but clear displeasure',
    // THE 3 KEY LANDMARKS
    eyebrows: 'FURROWED/LOWERED - drawn together and down, vertical crease',
    eyelids: 'NARROWED - tense, intense squint, focused glare',
    mouth: 'CLOSED TIGHT - pressed thin, jaw clenched, or slight sneer',
    // Supporting details
    facialFeatures: 'furrowed brow, tensed jaw, flared nostrils',
    microExpressions: 'visible tension, controlled breathing, set jaw',
    eyeDescription: 'narrowed eyes, intense direct stare, lowered brows',
    mouthDescription: 'lips pressed thin or slightly bared teeth, tightened'
  },
  {
    name: 'surprised',
    category: 'core',
    description: 'Sudden unexpected realization - wide open features',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RAISED HIGH - both eyebrows up, forehead wrinkled',
    eyelids: 'WIDE OPEN - maximum openness, whites visible above iris',
    mouth: 'OPEN - dropped jaw, O-shape, gasp',
    // Supporting details
    facialFeatures: 'raised eyebrows high, stretched face, open expression',
    microExpressions: 'frozen moment, caught off guard, instant reaction',
    eyeDescription: 'eyes wide open, raised brows, visible whites, dilated pupils',
    mouthDescription: 'mouth dropped open, jaw slack, O-shape or gasp'
  },
  {
    name: 'scared',
    category: 'core',
    description: 'Fear or anxiety - tense and alert',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RAISED AND DRAWN TOGETHER - up but pinched in middle, worry lines',
    eyelids: 'WIDE OPEN - tense, alert, showing whites',
    mouth: 'OPEN PULLED BACK - lips pulled back and parted, tense',
    // Supporting details
    facialFeatures: 'raised and drawn together brows, tense forehead',
    microExpressions: 'slight tremor, pale complexion, alert tension',
    eyeDescription: 'wide eyes with raised brows, darting or fixed stare, white visible',
    mouthDescription: 'lips parted and pulled back, teeth may be clenched'
  },
  {
    name: 'disgusted',
    category: 'core',
    description: 'The "yuck" face - visceral revulsion',
    // THE 3 KEY LANDMARKS
    eyebrows: 'LOWERED/FURROWED - bunched down, wrinkling nose bridge',
    eyelids: 'NARROWED/SQUINTED - partially closed, looking away',
    mouth: 'UPPER LIP RAISED - "sneer" shape, corners down, showing upper teeth',
    // Supporting details
    facialFeatures: 'wrinkled nose, raised upper lip, narrowed eyes',
    microExpressions: 'recoiling, aversion, turning away impulse',
    eyeDescription: 'squinted or partially closed, looking away or down',
    mouthDescription: 'upper lip raised showing teeth, corners pulled down, tongue may retreat'
  },
  
  // === SECONDARY EMOTIONS (8) - Generate for main characters ===
  {
    name: 'pleased',
    category: 'secondary',
    description: 'Contentment or smug satisfaction - quiet self-assured comfort',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RELAXED or SLIGHTLY RAISED - knowing, comfortable',
    eyelids: 'HALF-LIDDED - relaxed, confident, self-satisfied squint',
    mouth: 'CLOSED CORNERS UP - slight closed-lip smile, may be asymmetric smirk',
    // Supporting details
    facialFeatures: 'relaxed with slight lift, knowing expression',
    microExpressions: 'self-satisfied, comfortable, confident',
    eyeDescription: 'half-lidded, knowing look, relaxed but alert',
    mouthDescription: 'slight closed-lip smile, one corner may lift higher (smirk)'
  },
  {
    name: 'bored',
    category: 'secondary',
    description: 'Disinterest or apathy - emotionally flat, unengaged',
    // THE 3 KEY LANDMARKS
    eyebrows: 'FLAT/SLIGHTLY LOWERED - no engagement, heavy',
    eyelids: 'HEAVY/DROOPING - half-lidded, unfocused, looking away',
    mouth: 'SLACK NEUTRAL - no effort, possibly slight frown or yawn',
    // Supporting details
    facialFeatures: 'slack expression, heavy features, no engagement',
    microExpressions: 'sighing, eye-wandering, mentally elsewhere',
    eyeDescription: 'heavy-lidded, unfocused gaze, looking away or glazed',
    mouthDescription: 'slack, possibly slight frown, may be yawning'
  },
  {
    name: 'tired',
    category: 'secondary',
    description: 'Exhaustion or sleepiness - drained energy',
    // THE 3 KEY LANDMARKS
    eyebrows: 'DROOPING - low energy, no lift, may have worry lines',
    eyelids: 'HEAVY DROOPING - struggling to stay open, fluttering',
    mouth: 'SLACK/YAWNING - jaw loose, may be yawning, dry lips',
    // Supporting details
    facialFeatures: 'drooping features, dark circles, pallor',
    microExpressions: 'slow blinks, fighting sleep, low energy',
    eyeDescription: 'heavy drooping lids, red or unfocused, struggling to stay open',
    mouthDescription: 'slack jaw, may be yawning or sighing, dry lips'
  },
  {
    name: 'arrogant',
    category: 'secondary',
    description: 'Confidence or looking down on others - superior air',
    // THE 3 KEY LANDMARKS
    eyebrows: 'ONE RAISED or BOTH SLIGHTLY UP - skeptical, judging, superior',
    eyelids: 'HALF-LIDDED - looking down nose, appraising, dismissive',
    mouth: 'CLOSED SLIGHT SNEER - pursed or one corner up, superior',
    // Supporting details
    facialFeatures: 'raised chin, tilted head back, one raised eyebrow',
    microExpressions: 'dismissive, self-important, judging',
    eyeDescription: 'looking down nose, half-lidded, appraising coldly',
    mouthDescription: 'slight sneer or closed superior smile, pursed'
  },
  {
    name: 'irritated',
    category: 'secondary',
    description: 'Annoyance or "done with this" - contained frustration',
    // THE 3 KEY LANDMARKS
    eyebrows: 'SLIGHTLY FURROWED - tension crease, lowered',
    eyelids: 'NARROWED - annoyed squint, may be rolling',
    mouth: 'CLOSED TIGHT - pursed, jaw tight, slight grimace',
    // Supporting details
    facialFeatures: 'slightly furrowed brow, tightened features',
    microExpressions: 'impatience, eye-rolling tendency, sighing',
    eyeDescription: 'narrowed with visible annoyance, may glance away or roll',
    mouthDescription: 'pursed lips, jaw tight, slight grimace'
  },
  {
    name: 'confused',
    category: 'secondary',
    description: 'Puzzlement or skepticism - trying to understand',
    // THE 3 KEY LANDMARKS
    eyebrows: 'ONE RAISED - asymmetric, questioning, skeptical',
    eyelids: 'ASYMMETRIC - one more open, searching, uncertain',
    mouth: 'SLIGHTLY OPEN ASYMMETRIC - twisted to one side, uncertain',
    // Supporting details
    facialFeatures: 'one eyebrow raised, tilted head, furrowed brow',
    microExpressions: 'searching, questioning, processing',
    eyeDescription: 'one eye slightly more open, searching look, unfocused while thinking',
    mouthDescription: 'slightly open, may be twisted to one side, uncertain'
  },
  {
    name: 'flirty',
    category: 'secondary',
    description: 'Romantic interest - soft eyes, inviting warmth',
    // THE 3 KEY LANDMARKS
    eyebrows: 'SLIGHTLY RAISED - soft arch, inviting, playful',
    eyelids: 'HALF-LIDDED - soft, bedroom eyes, lingering gaze',
    mouth: 'SLIGHTLY PARTED SMILE - inviting, gentle, soft lips',
    // Supporting details
    facialFeatures: 'relaxed, warm, slightly flushed cheeks, tilted head',
    microExpressions: 'subtle blush, inviting, playful',
    eyeDescription: 'soft, partially lidded, lingering eye contact, sparkle',
    mouthDescription: 'gentle smile, lips slightly parted, inviting'
  },
  {
    name: 'fierce',
    category: 'secondary',
    description: 'Determination or battle mode - focused intensity',
    // THE 3 KEY LANDMARKS
    eyebrows: 'LOWERED/FURROWED - determined, focused, aggressive',
    eyelids: 'NARROWED WITH INTENSITY - burning focus, locked on target',
    mouth: 'CLOSED FIRM - jaw clenched, lips pressed, teeth may be bared',
    // Supporting details
    facialFeatures: 'set jaw, focused features, squared shoulders',
    microExpressions: 'steely resolve, unwavering, battle-ready',
    eyeDescription: 'intense focused stare, narrowed with purpose, burning',
    mouthDescription: 'lips pressed firm, jaw clenched, teeth may be bared'
  },
  
  // === EXTREME EMOTIONS (5) - Generate for dramatic moments ===
  {
    name: 'rage',
    category: 'extreme',
    description: 'Extreme violent anger - loss of control',
    // THE 3 KEY LANDMARKS
    eyebrows: 'DEEPLY FURROWED - extreme V-shape, veins showing',
    eyelids: 'WIDE WITH FURY - bulging, bloodshot, intense glare',
    mouth: 'OPEN SNARLING - teeth bared, shouting, roaring',
    // Supporting details
    facialFeatures: 'deeply furrowed brow, flared nostrils, veins visible',
    microExpressions: 'trembling with fury, barely contained explosion',
    eyeDescription: 'wide with fury, bloodshot, bulging, intense glare',
    mouthDescription: 'snarling, teeth bared, shouting or growling'
  },
  {
    name: 'terror',
    category: 'extreme',
    description: 'Extreme paralyzing fear - frozen in horror',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RAISED EXTREMELY HIGH - maximum surprise/fear position',
    eyelids: 'EXTREMELY WIDE - whites visible all around, frozen',
    mouth: 'OPEN IN SCREAM or CLAMPED - silent scream or jaw locked',
    // Supporting details
    facialFeatures: 'all features pulled back, pale, frozen',
    microExpressions: 'trembling, shallow breath, fight/flight paralysis',
    eyeDescription: 'extremely wide, whites visible all around, fixed on threat',
    mouthDescription: 'open in silent scream or clamped shut, pale lips'
  },
  {
    name: 'grief',
    category: 'extreme',
    description: 'Deep sobbing or mourning - overwhelming loss',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RAISED INNER CORNERS EXTREME - "tragedy mask" shape',
    eyelids: 'SQUEEZED SHUT or WIDE WITH TEARS - crying, streaming tears',
    mouth: 'OPEN WAILING or TREMBLING - twisted in cry, quivering',
    // Supporting details
    facialFeatures: 'contorted in pain, tear tracks, red and blotchy',
    microExpressions: 'heaving sobs, shaking, broken',
    eyeDescription: 'squeezed shut with tears, or staring blankly through tears',
    mouthDescription: 'open in wail or twisted in silent cry, trembling'
  },
  {
    name: 'pain',
    category: 'extreme',
    description: 'Physical or sharp emotional sting - immediate hurt',
    // THE 3 KEY LANDMARKS
    eyebrows: 'FURROWED AND RAISED CENTER - wincing, tension',
    eyelids: 'SQUEEZED SHUT or WIDE WITH SHOCK - flinching',
    mouth: 'GRIMACING - teeth clenched, lips pulled back, crying out',
    // Supporting details
    facialFeatures: 'wincing, tensed all over, grimacing',
    microExpressions: 'flinching, breath caught, sharp intake',
    eyeDescription: 'squeezed shut or wide with shock, watering',
    mouthDescription: 'grimacing, teeth clenched or crying out'
  },
  {
    name: 'hollow',
    category: 'extreme',
    description: 'Emotional numbness or shock - empty thousand-yard stare',
    // THE 3 KEY LANDMARKS
    eyebrows: 'COMPLETELY FLAT - no engagement, slack',
    eyelids: 'NORMAL BUT EMPTY - unblinking, vacant, unfocused',
    mouth: 'SLACK OPEN - slightly parted, no expression, lifeless',
    // Supporting details
    facialFeatures: 'completely slack, no muscle engagement, vacant',
    microExpressions: 'dissociated, absent, shell-shocked',
    eyeDescription: 'unfocused thousand-yard stare, empty, unblinking',
    mouthDescription: 'slack, slightly open, no expression'
  },
  
  // === CHARACTER EXPRESSIONS (5) - Generate for personality moments ===
  {
    name: 'silly',
    category: 'character',
    description: 'Goofing off, breaking character - playful absurdity',
    // THE 3 KEY LANDMARKS
    eyebrows: 'EXAGGERATED - way up, way down, or asymmetric',
    eyelids: 'CROSSED or EXTREMELY WIDE - comic exaggeration',
    mouth: 'TONGUE OUT or STRETCHED - goofy grin, blowing raspberry',
    // Supporting details
    facialFeatures: 'exaggerated features, tongue out, crossed eyes possible',
    microExpressions: 'playful energy, deliberately ridiculous',
    eyeDescription: 'crossed, rolling, or extremely wide in comic way',
    mouthDescription: 'tongue out, stretched wide, or silly grin'
  },
  {
    name: 'nauseous',
    category: 'character',
    description: 'Sickness or physical revulsion - about to be ill',
    // THE 3 KEY LANDMARKS
    eyebrows: 'FURROWED - discomfort, fighting urge',
    eyelids: 'SQUINTING/UNFOCUSED - trying to hold it together',
    mouth: 'PRESSED TIGHT - holding back, swallowing, green tinge',
    // Supporting details
    facialFeatures: 'green-tinged pallor, clammy, holding back',
    microExpressions: 'swallowing hard, gulping, fighting it',
    eyeDescription: 'unfocused, looking for escape, squinting',
    mouthDescription: 'pressed tight, may have hand near mouth, swallowing'
  },
  {
    name: 'drunk',
    category: 'character',
    description: 'Disorientation or intoxication - loss of control',
    // THE 3 KEY LANDMARKS
    eyebrows: 'RELAXED/DROOPY - loose, uncoordinated',
    eyelids: 'HALF-LIDDED/UNFOCUSED - glazed, possibly crossed',
    mouth: 'LOOSE SMILE - slack, goofy grin, possibly drooling',
    // Supporting details
    facialFeatures: 'flushed cheeks, slack muscles, uncoordinated',
    microExpressions: 'swaying, unfocused, loose',
    eyeDescription: 'unfocused, half-lidded, possibly crossed, glazed',
    mouthDescription: 'loose smile, slack, possibly drooling'
  },
  {
    name: 'sarcastic',
    category: 'character',
    description: 'Eye roll or cynical smirk - dry wit',
    // THE 3 KEY LANDMARKS
    eyebrows: 'ONE RAISED - skeptical, "really?" attitude',
    eyelids: 'ROLLING or NARROWED - looking up/away, one narrowed',
    mouth: 'ASYMMETRIC SMIRK - one corner up, closed, knowing',
    // Supporting details
    facialFeatures: 'asymmetric expression, one raised brow, slight sneer',
    microExpressions: 'eye-rolling, "really?" energy, dry',
    eyeDescription: 'rolling or looking up/away, one narrowed skeptically',
    mouthDescription: 'one corner up in smirk, closed, knowing'
  },
  {
    name: 'pouty',
    category: 'character',
    description: 'Childish sulking - petulant displeasure',
    // THE 3 KEY LANDMARKS
    eyebrows: 'FURROWED/DOWN - stubborn, refusing',
    eyelids: 'NARROWED/LOOKING AWAY - refusing eye contact',
    mouth: 'EXAGGERATED POUT - lower lip out, corners down',
    // Supporting details
    facialFeatures: 'furrowed brow, puffed cheeks, jutting chin',
    microExpressions: 'stubborn, refusing to engage, huffy',
    eyeDescription: 'looking away or down, refusing eye contact, narrowed',
    mouthDescription: 'exaggerated pout, lower lip out, corners down'
  }
];

// Expression tier presets
export const EXPRESSION_TIERS = {
  minimal: ['neutral', 'happy', 'sad', 'angry'] as ExpressionName[],
  core: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'scared', 'disgusted'] as ExpressionName[],
  standard: [
    'neutral', 'happy', 'sad', 'angry', 'surprised', 'scared', 'disgusted',
    'pleased', 'irritated', 'confused', 'fierce'
  ] as ExpressionName[],
  extended: [
    'neutral', 'happy', 'sad', 'angry', 'surprised', 'scared', 'disgusted',
    'pleased', 'bored', 'tired', 'arrogant', 'irritated', 'confused', 'flirty', 'fierce',
    'rage', 'grief', 'pain', 'hollow'
  ] as ExpressionName[],
  full: EXPRESSION_LIBRARY.map(e => e.name) as ExpressionName[]
};

// ============================================
// EMOTION-TO-EXPRESSION MAPPING
// ============================================

/**
 * Maps story beat emotions (from StoryboardAgent) to expression references
 * Use this to find the best expression reference for a given story beat
 */
export const EMOTION_TO_EXPRESSION_MAP: Record<string, ExpressionName[]> = {
  // Positive emotions
  'joy': ['happy', 'pleased'],
  'happiness': ['happy', 'pleased'],
  'delight': ['happy', 'surprised'],
  'excitement': ['happy', 'surprised', 'fierce'],
  'love': ['flirty', 'happy', 'pleased'],
  'affection': ['flirty', 'happy', 'pleased'],
  'contentment': ['pleased', 'neutral'],
  'satisfaction': ['pleased', 'arrogant'],
  'pride': ['arrogant', 'pleased', 'fierce'],
  'hope': ['happy', 'pleased'],
  'relief': ['pleased', 'tired', 'happy'],
  'amusement': ['happy', 'silly', 'pleased'],
  
  // Negative emotions
  'sadness': ['sad', 'grief', 'hollow'],
  'sorrow': ['sad', 'grief'],
  'grief': ['grief', 'hollow', 'pain'],
  'despair': ['grief', 'hollow', 'sad'],
  'loneliness': ['sad', 'hollow', 'tired'],
  'disappointment': ['sad', 'irritated'],
  'regret': ['sad', 'pain', 'hollow'],
  
  // Anger spectrum
  'anger': ['angry', 'rage', 'irritated'],
  'frustration': ['irritated', 'angry'],
  'annoyance': ['irritated', 'bored'],
  'fury': ['rage', 'angry', 'fierce'],
  'rage': ['rage', 'angry'],
  'hatred': ['rage', 'disgusted', 'angry'],
  'resentment': ['angry', 'irritated', 'sarcastic'],
  
  // Fear spectrum
  'fear': ['scared', 'terror'],
  'anxiety': ['scared', 'confused'],
  'terror': ['terror', 'scared'],
  'dread': ['scared', 'hollow'],
  'nervousness': ['scared', 'confused'],
  'panic': ['terror', 'scared'],
  
  // Surprise spectrum
  'surprise': ['surprised', 'confused'],
  'shock': ['surprised', 'terror', 'hollow'],
  'amazement': ['surprised', 'happy'],
  'disbelief': ['surprised', 'confused'],
  
  // Other emotions
  'confusion': ['confused', 'irritated'],
  'curiosity': ['confused', 'pleased'],
  'suspicion': ['confused', 'irritated', 'arrogant'],
  'disgust': ['disgusted', 'nauseous'],
  'contempt': ['arrogant', 'disgusted', 'sarcastic'],
  'boredom': ['bored', 'tired'],
  'exhaustion': ['tired', 'hollow'],
  'determination': ['fierce', 'angry'],
  'resolve': ['fierce', 'neutral'],
  'defiance': ['fierce', 'angry', 'arrogant'],
  'guilt': ['sad', 'pain', 'hollow'],
  'shame': ['sad', 'pain', 'pouty'],
  'embarrassment': ['surprised', 'pouty', 'flirty'],
  'jealousy': ['angry', 'sad', 'irritated'],
  'envy': ['irritated', 'sad', 'angry'],
  'betrayal': ['surprised', 'angry', 'pain'],
  'hurt': ['pain', 'sad', 'hollow'],
  'pain': ['pain', 'grief'],
  'numbness': ['hollow', 'tired', 'neutral'],
  'longing': ['sad', 'flirty', 'pain'],
  'nostalgia': ['sad', 'pleased', 'pain'],
  
  // Combat/action emotions
  'battle-ready': ['fierce', 'angry'],
  'aggressive': ['fierce', 'rage', 'angry'],
  'defensive': ['scared', 'angry', 'fierce'],
  'victorious': ['happy', 'arrogant', 'pleased'],
  'defeated': ['sad', 'hollow', 'tired'],
  
  // Social emotions
  'flirtatious': ['flirty', 'pleased', 'happy'],
  'romantic': ['flirty', 'happy'],
  'seductive': ['flirty', 'arrogant', 'pleased'],
  'shy': ['confused', 'sad', 'neutral'],
  'confident': ['arrogant', 'pleased', 'fierce'],
  'smug': ['arrogant', 'pleased', 'sarcastic'],
  'sarcastic': ['sarcastic', 'irritated', 'arrogant'],
  'playful': ['silly', 'happy', 'flirty'],
  'mischievous': ['pleased', 'silly', 'sarcastic'],
  'sulky': ['pouty', 'sad', 'irritated'],
  
  // Catch-all
  'neutral': ['neutral'],
  'calm': ['neutral', 'pleased'],
  'composed': ['neutral', 'arrogant']
};

/**
 * Find the best expression reference for a given story emotion
 */
export function findExpressionForEmotion(emotion: string): ExpressionName {
  const normalized = emotion.toLowerCase().trim();
  
  // Direct match
  if (EMOTION_TO_EXPRESSION_MAP[normalized]) {
    return EMOTION_TO_EXPRESSION_MAP[normalized][0];
  }
  
  // Partial match
  for (const [key, expressions] of Object.entries(EMOTION_TO_EXPRESSION_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return expressions[0];
    }
  }
  
  // Default to neutral
  return 'neutral';
}

/**
 * Get all possible expressions for a story emotion (ranked by relevance)
 */
export function findExpressionsForEmotion(emotion: string): ExpressionName[] {
  const normalized = emotion.toLowerCase().trim();
  
  // Direct match
  if (EMOTION_TO_EXPRESSION_MAP[normalized]) {
    return EMOTION_TO_EXPRESSION_MAP[normalized];
  }
  
  // Partial match
  for (const [key, expressions] of Object.entries(EMOTION_TO_EXPRESSION_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return expressions;
    }
  }
  
  // Default to neutral
  return ['neutral'];
}

// Request to generate a character reference sheet
export interface CharacterReferenceSheetRequest {
  characterId: string;
  name: string;
  pronouns?: 'he/him' | 'she/her' | 'they/them';
  description: string;
  role: string; // protagonist, antagonist, ally, etc.
  physicalTraits: {
    age?: string;
    height?: string;
    build?: string;
    hairColor?: string;
    hairStyle?: string;
    eyeColor?: string;
    skinTone?: string;
    distinguishingFeatures?: string[];
  };
  clothing?: {
    primary: string;
    accessories?: string[];
    colorPalette?: string[];
  };
  personality?: string; // For expression AND body language guidance
  backgroundTraits?: string; // e.g., "military training", "nervous academic", "street fighter"
  genre: string;
  tone: string;
  artStyle?: string;
  // Pose sheet options
  includePoseSheet?: boolean; // Default: true
  // Expression sheet options (SEPARATE from poses)
  includeExpressions?: boolean; // Default: true for major characters
  expressionTier?: 'minimal' | 'core' | 'standard' | 'extended' | 'full'; // Default: 'standard'
  customExpressions?: ExpressionName[]; // Override tier with specific list
  // Silhouette profile options
  includeSilhouetteProfile?: boolean; // Default: true - generates full silhouette design
  // Body vocabulary options (NEW)
  includeBodyVocabulary?: boolean; // Default: true for major characters
  // User-provided reference image for this character (e.g., a photo, sketch, or concept art)
  // Used as a visual guide when generating reference sheets in the story's art style
  userReferenceImage?: { data: string; mimeType: string };
  // Multiple user-provided reference images for better consistency
  userReferenceImages?: Array<{ data: string; mimeType: string }>;
  // Prior character knowledge from memory (past generation results, trait insights)
  priorKnowledge?: string;
}

// Individual view within a reference sheet
export interface ReferenceView {
  viewType:
    | 'front' | 'three-quarter' | 'profile' | 'back' | 'expression'
    // ACTION POSE VIEWS — capture character-specific body language
    | 'combat-stance'        // Ready for physical conflict
    | 'emotional-distress'   // Grief, fear, or anguish
    | 'intimate-reach'       // Tender, vulnerable reaching toward another
    | 'defensive-recoil'     // Backing away, protecting self
    | 'aggressive-advance';  // Moving toward with intent to confront
  viewName?: string; // Display name for the view
  expressionName?: ExpressionName; // For expression views - the actual expression (e.g., 'happy', 'angry')
  expressionCategory?: 'core' | 'secondary' | 'extreme' | 'character';
  prompt: ImagePrompt;
  purpose: string; // What this view is used for in consistency checking
}

// Action pose definitions for reference generation
export const ACTION_POSE_DEFINITIONS: Record<string, {
  name: string;
  description: string;
  bodyLanguage: string;
  gestureNotes: string;
  weightDistribution: string;
  emotionalContext: string;
}> = {
  'combat-stance': {
    name: 'Combat Stance',
    description: 'Ready for physical conflict — tense, coiled, prepared',
    bodyLanguage: 'Weight forward on balls of feet, knees bent, shoulders squared, chin tucked',
    gestureNotes: 'Hands raised defensively or offensively, fingers spread or fists formed',
    weightDistribution: 'Ready to move in any direction, balanced but dynamic',
    emotionalContext: 'Determination, aggression, or defensive alertness'
  },
  'emotional-distress': {
    name: 'Emotional Distress',
    description: 'Grief, fear, or anguish made physical — collapsed, protective',
    bodyLanguage: 'Shoulders hunched, spine curved inward, head bowed or thrown back',
    gestureNotes: 'Hands to face, chest, or wrapped around self; gripping for support',
    weightDistribution: 'Sinking, unstable, needing support',
    emotionalContext: 'Grief, fear, shame, despair, or overwhelming emotion'
  },
  'intimate-reach': {
    name: 'Intimate Reach',
    description: 'Tender vulnerability — reaching toward another with care',
    bodyLanguage: 'Open posture, slight lean forward, shoulders soft, head tilted with care',
    gestureNotes: 'One hand reaching gently, fingertips leading, other hand at side or touching own heart',
    weightDistribution: 'Leaning toward subject of affection, weight shifting forward',
    emotionalContext: 'Love, tenderness, longing, care, forgiveness'
  },
  'defensive-recoil': {
    name: 'Defensive Recoil',
    description: 'Backing away from threat — protective, creating distance',
    bodyLanguage: 'Weight on back foot, shoulders turned away, chin tucked, spine curved back',
    gestureNotes: 'Hands raised palm-out to ward off, or crossed protectively over chest',
    weightDistribution: 'Back on heels, ready to flee, creating maximum distance',
    emotionalContext: 'Fear, distrust, shock, self-protection'
  },
  'aggressive-advance': {
    name: 'Aggressive Advance',
    description: 'Moving toward with confrontational intent — dominant, closing distance',
    bodyLanguage: 'Weight forward, shoulders squared and expanded, chin lowered, eyes locked',
    gestureNotes: 'Finger pointing, fist clenched, or hands on hips; gestures are emphatic and sharp',
    weightDistribution: 'Forward momentum, advancing, taking space',
    emotionalContext: 'Anger, accusation, confrontation, dominance'
  }
};

// Complete reference sheet output (poses only)
export interface CharacterReferenceSheet {
  characterId: string;
  characterName: string;
  views: ReferenceView[]; // Pose views only
  visualAnchors: string[]; // Key visual traits to check for consistency
  colorPalette: string[]; // Dominant colors for the character
  silhouetteNotes: string; // Legacy: basic silhouette description
  silhouetteProfile?: CharacterSilhouetteProfile; // Full silhouette design profile
  consistencyChecklist: string[]; // Things to verify in every shot
}

// Expression sheet output (separate from poses)
export interface CharacterExpressionSheet {
  characterId: string;
  characterName: string;
  expressionTier: string;
  expressions: ReferenceView[]; // All expression views
  expressionNotes: string; // How this character specifically shows emotion
  personalityInfluence: string; // How personality affects expressions
}

export class CharacterReferenceSheetAgent extends BaseAgent {
  private artStyle?: string;

  constructor(config: AgentConfig, artStyle?: string) {
    super('Character Reference Sheet Agent', config);
    this.artStyle = artStyle;
  }

  private genderLabel(pronouns?: string): string {
    if (!pronouns) return '';
    if (pronouns.startsWith('he')) return 'male';
    if (pronouns.startsWith('she')) return 'female';
    return 'non-binary / androgynous';
  }

  private genderPromptLine(pronouns?: string): string {
    if (!pronouns) return '';
    return `- **Gender / Pronouns**: ${this.genderLabel(pronouns)} (${pronouns})`;
  }

  /**
   * Normalize LLM response to handle snake_case vs camelCase and alternative field names
   */
  private normalizeReferenceSheet(raw: Record<string, unknown>, input: CharacterReferenceSheetRequest): CharacterReferenceSheet | null {
    // Helper to get value from either snake_case or camelCase key
    const get = <T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
      for (const key of keys) {
        if (obj[key] !== undefined) return obj[key] as T;
      }
      return undefined;
    };

    // Log what we got for debugging
    console.log('[CharacterReferenceSheetAgent] Normalizing pose sheet. Raw keys:', Object.keys(raw));

    // Try to find views array under various possible names
    const viewKeys = ['views', 'pose_views', 'poseViews', 'reference_views', 'referenceViews', 'character_views', 'characterViews', 'poses', 'pose_sheet', 'poseSheet', 'mainViews', 'main_views', 'referenceSheet', 'reference_sheet'];
    let views = get<unknown[]>(raw, ...viewKeys);
    
    // If views not found at top level, check if there's a nested structure
    if (!views || !Array.isArray(views)) {
      // Check for nested reference_sheet or pose_sheet object
      const nestedKeys = ['reference_sheet', 'referenceSheet', 'pose_sheet', 'poseSheet', 'character_reference', 'characterReference', 'character', 'sheet'];
      for (const nKey of nestedKeys) {
        const nestedSheet = raw[nKey] as Record<string, unknown>;
        if (nestedSheet && typeof nestedSheet === 'object') {
          console.log(`[CharacterReferenceSheetAgent] Checking nested structure: ${nKey}`);
          views = get<unknown[]>(nestedSheet, ...viewKeys);
          if (views && Array.isArray(views)) break;
        }
      }
    }
    
    // Handle case where mainViews/views is an OBJECT with named views instead of an array
    // e.g., { front: {...}, three_quarter: {...}, profile: {...} }
    if (!views || !Array.isArray(views)) {
      for (const vKey of viewKeys) {
        const viewsObj = raw[vKey] as Record<string, unknown>;
        if (viewsObj && typeof viewsObj === 'object' && !Array.isArray(viewsObj)) {
          console.log(`[CharacterReferenceSheetAgent] Found ${vKey} as object, converting to array...`);
          views = Object.entries(viewsObj).map(([key, value]) => {
            const v = value as Record<string, unknown>;
            return {
              viewType: key,
              viewName: v.viewName || v.view_name || v.name || key,
              purpose: v.purpose || v.description || '',
              prompt: v.prompt || v.image_prompt || v.imagePrompt || v
            };
          });
          if (views.length > 0) break;
        }
      }
    }
    
    // AGGRESSIVE FALLBACK: Search ALL keys for any array that looks like views
    if (!views || !Array.isArray(views) || views.length === 0) {
      console.log('[CharacterReferenceSheetAgent] Trying aggressive search for view-like arrays...');
      for (const [key, value] of Object.entries(raw)) {
        if (Array.isArray(value) && value.length > 0) {
          // Check if this looks like a views array (items have prompt-related fields)
          const firstItem = value[0] as Record<string, unknown>;
          if (firstItem && typeof firstItem === 'object') {
            const hasPromptFields = firstItem.prompt || firstItem.positive || firstItem.image_prompt || 
                                    firstItem.positivePrompt || firstItem.positive_prompt;
            const hasViewFields = firstItem.viewType || firstItem.view_type || firstItem.type || firstItem.angle;
            if (hasPromptFields || hasViewFields) {
              console.log(`[CharacterReferenceSheetAgent] Found potential views array at key: ${key}`);
              views = value;
              break;
            }
          }
        }
        // Also check for object values that could be view containers
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const objValue = value as Record<string, unknown>;
          // Check if this object has keys that look like view types
          const viewTypeKeys = ['front', 'profile', 'side', 'back', 'three_quarter', 'threeQuarter', '3/4', 'neutral'];
          const hasViewTypeKeys = Object.keys(objValue).some(k => 
            viewTypeKeys.some(vtk => k.toLowerCase().includes(vtk))
          );
          if (hasViewTypeKeys) {
            console.log(`[CharacterReferenceSheetAgent] Found view-like object at key: ${key}, converting...`);
            views = Object.entries(objValue).map(([vKey, vValue]) => {
              const v = vValue as Record<string, unknown>;
              return {
                viewType: vKey,
                viewName: v.viewName || v.view_name || v.name || vKey,
                purpose: v.purpose || v.description || '',
                prompt: v.prompt || v.image_prompt || v.imagePrompt || v
              };
            });
            if (views.length > 0) break;
          }
        }
      }
    }
    
    if (!views || !Array.isArray(views) || views.length === 0) {
      console.error('[CharacterReferenceSheetAgent] FAILED to find views. Available keys:', Object.keys(raw));
      console.error('[CharacterReferenceSheetAgent] Raw data:', JSON.stringify(raw, null, 2).slice(0, 1500));
      return null;
    }
    
    console.log(`[CharacterReferenceSheetAgent] Found ${views.length} views to normalize`);

    // Normalize each view
    const normalizedViews: ReferenceView[] = views.map((v: Record<string, unknown>) => {
      const viewType = get<string>(v, 'viewType', 'view_type', 'type') || 'front';
      const viewName = get<string>(v, 'viewName', 'view_name', 'name') || viewType;
      const purpose = get<string>(v, 'purpose', 'description') || '';
      
      // Handle prompt - could be nested object or flat
      // Map to ImagePrompt fields: prompt (not positive), negativePrompt (not negative)
      let prompt: ImagePrompt;
      const rawPrompt = get<Record<string, unknown>>(v, 'prompt', 'image_prompt', 'imagePrompt');
      
      if (rawPrompt && typeof rawPrompt === 'object') {
        prompt = {
          prompt: get<string>(rawPrompt, 'prompt', 'positive', 'positivePrompt', 'positive_prompt', 'text') || '',
          negativePrompt: get<string>(rawPrompt, 'negativePrompt', 'negative_prompt', 'negative') || '',
          style: get<string>(rawPrompt, 'style', 'artStyle', 'art_style') || this.artStyle,
          aspectRatio: get<string>(rawPrompt, 'aspectRatio', 'aspect_ratio') || '1:1'
        };
      } else {
        prompt = {
          prompt: get<string>(v, 'prompt', 'positive', 'positivePrompt', 'positive_prompt', 'prompt_text') || '',
          negativePrompt: get<string>(v, 'negativePrompt', 'negative_prompt', 'negative') || '',
          style: get<string>(v, 'style', 'artStyle', 'art_style') || this.artStyle,
          aspectRatio: '1:1'
        };
      }

      return { viewType: viewType as ReferenceView['viewType'], viewName, purpose, prompt };
    });

    // Build normalized sheet
    const sheet: CharacterReferenceSheet = {
      characterId: get<string>(raw, 'characterId', 'character_id') || input.characterId,
      characterName: get<string>(raw, 'characterName', 'character_name', 'name') || input.name,
      views: normalizedViews,
      visualAnchors: get<string[]>(raw, 'visualAnchors', 'visual_anchors') || [],
      colorPalette: this.normalizeColorPalette(get(raw, 'colorPalette', 'color_palette')),
      silhouetteNotes: get<string>(raw, 'silhouetteNotes', 'silhouette_notes', 'silhouette') || '',
      consistencyChecklist: get<string[]>(raw, 'consistencyChecklist', 'consistency_checklist', 'checklist') || []
    };

    return sheet;
  }

  /**
   * Normalize color palette which might be an array of strings, an object, or something else
   */
  private normalizeColorPalette(palette: unknown): string[] {
    if (!palette) return [];
    if (Array.isArray(palette)) return palette.map(c => String(c));
    if (typeof palette === 'object') {
      // Could be an object like { primary: '#fff', secondary: '#000' }
      return Object.values(palette as Record<string, unknown>).map(c => String(c));
    }
    return [];
  }

  /**
   * Normalize expression sheet response
   */
  private normalizeExpressionSheet(raw: Record<string, unknown>, input: CharacterReferenceSheetRequest): CharacterExpressionSheet | null {
    const get = <T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
      for (const key of keys) {
        if (obj[key] !== undefined) return obj[key] as T;
      }
      return undefined;
    };

    const expressions = get<unknown[]>(raw, 'expressions', 'expression_views', 'expressionViews');
    
    if (!expressions || !Array.isArray(expressions) || expressions.length === 0) {
      console.warn('[CharacterReferenceSheetAgent] Could not find expressions array. Available keys:', Object.keys(raw));
      return null;
    }

    const normalizedExpressions: ReferenceView[] = expressions.map((e: Record<string, unknown>) => {
      // Extract the expression name - this is the KEY field (e.g., 'happy', 'angry', 'neutral')
      const expressionName = get<string>(e, 'expressionName', 'expression_name', 'name', 'expression', 'emotion') || 'neutral';
      const expressionCategory = get<string>(e, 'expressionCategory', 'expression_category', 'category') || 'core';
      const viewType = 'expression' as const; // Always 'expression' for expression sheets
      const viewName = get<string>(e, 'viewName', 'view_name') || `${expressionName} expression`;
      const purpose = get<string>(e, 'purpose', 'description') || `Reference for ${expressionName} emotion`;
      
      let prompt: ImagePrompt;
      const rawPrompt = get<Record<string, unknown>>(e, 'prompt', 'image_prompt', 'imagePrompt');
      
      if (rawPrompt && typeof rawPrompt === 'object') {
        prompt = {
          prompt: get<string>(rawPrompt, 'prompt', 'positive', 'positivePrompt', 'positive_prompt', 'text') || '',
          negativePrompt: get<string>(rawPrompt, 'negativePrompt', 'negative_prompt', 'negative', 'negativePrompt') || '',
          style: get<string>(rawPrompt, 'style', 'artStyle', 'art_style') || this.artStyle,
          aspectRatio: get<string>(rawPrompt, 'aspectRatio', 'aspect_ratio') || '1:1'
        };
      } else {
        prompt = {
          prompt: get<string>(e, 'prompt', 'positive', 'positivePrompt', 'positive_prompt', 'prompt_text') || '',
          negativePrompt: get<string>(e, 'negativePrompt', 'negative_prompt', 'negative') || '',
          style: get<string>(e, 'style', 'artStyle', 'art_style') || this.artStyle,
          aspectRatio: '1:1'
        };
      }
      
      // Inject deterministic physical identity into the prompt so the LLM's
      // vague descriptions (e.g. "elegant woman") don't cause Gemini to drift
      // on hair color, eye color, or other critical visual anchors.
      if (prompt.prompt) {
        const identityParts: string[] = [];
        const t = input.physicalTraits;
        if (t.hairColor) identityParts.push(`${t.hairColor} hair`);
        if (t.hairStyle) identityParts.push(`styled in ${t.hairStyle}`);
        if (t.eyeColor) identityParts.push(`${t.eyeColor} eyes`);
        if (t.skinTone) identityParts.push(`${t.skinTone} skin`);
        if (t.build) identityParts.push(`${t.build} build`);
        if (t.distinguishingFeatures?.length) identityParts.push(...t.distinguishingFeatures);

        if (identityParts.length > 0) {
          const identityAnchor = identityParts.join(', ');
          const namePattern = new RegExp(`(${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}),?\\s*`, 'i');
          if (namePattern.test(prompt.prompt)) {
            prompt.prompt = prompt.prompt.replace(namePattern, `${input.name}, ${identityAnchor}, `);
          } else {
            const artStyleMatch = prompt.prompt.match(/^([^,]+,\s*)/);
            if (artStyleMatch) {
              prompt.prompt = artStyleMatch[1] + `${input.name}, ${identityAnchor}, ` + prompt.prompt.slice(artStyleMatch[0].length);
            } else {
              prompt.prompt = `${input.name}, ${identityAnchor}, ${prompt.prompt}`;
            }
          }
          console.log(`[CharacterReferenceSheetAgent] Injected identity anchor for ${expressionName}: "${identityAnchor}"`);
        }
      }

      // Strip clothing/costume descriptions that cause fabric artifacts in
      // face close-ups (e.g. "high-collared dark velvet doublet" renders
      // collar fabric bleeding into the face).
      if (prompt.prompt) {
        const before = prompt.prompt;
        prompt.prompt = prompt.prompt
          .replace(/,?\s*(?:wearing\s+)?(?:a\s+)?(?:high[- ]collared|low[- ]cut|open[- ]collared)[\w\s-]*(?:doublet|coat|gown|dress|robe|cloak|tunic|jacket|vest|armor|armour|shirt|blouse|corset|bodice)\b[^,]*/gi, '')
          .replace(/,?\s*(?:wearing\s+)?(?:a\s+)?(?:[\w-]+\s+){0,3}(?:doublet|coat|gown|dress|robe|cloak|tunic|jacket|vest|armor|armour|shirt|blouse|corset|bodice|cravat|scarf|necklace|pendant|brooch|collar)\b[^,]*/gi, '')
          .replace(/,\s*,/g, ',')
          .replace(/,\s*$/g, '')
          .trim();
        if (before !== prompt.prompt) {
          console.log(`[CharacterReferenceSheetAgent] Stripped clothing from ${expressionName} expression prompt`);
        }
      }

      console.log(`[CharacterReferenceSheetAgent] Normalized expression: ${expressionName}, prompt length: ${prompt.prompt?.length || 0}`);

      return { 
        viewType, 
        viewName, 
        expressionName: expressionName as ExpressionName, 
        expressionCategory: expressionCategory as ReferenceView['expressionCategory'],
        purpose, 
        prompt 
      };
    });

    return {
      characterId: get<string>(raw, 'characterId', 'character_id') || input.characterId,
      characterName: get<string>(raw, 'characterName', 'character_name', 'name') || input.name,
      expressionTier: get<string>(raw, 'expressionTier', 'expression_tier', 'tier') || input.expressionTier || 'standard',
      expressions: normalizedExpressions,
      expressionNotes: get<string>(raw, 'expressionNotes', 'expression_notes', 'notes') || '',
      personalityInfluence: get<string>(raw, 'personalityInfluence', 'personality_influence', 'personality') || ''
    };
  }

  /**
   * Generate a POSE reference sheet (full body views)
   */
  async execute(input: CharacterReferenceSheetRequest): Promise<AgentResponse<CharacterReferenceSheet>> {
    const prompt = this.buildReferenceSheetPrompt(input);
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CharacterReferenceSheetAgent] Generating pose sheet for ${input.name} (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        const response = await this.callLLM([{ role: 'user', content: prompt }]);
        let rawParsed: Record<string, unknown>;
        
        try {
          rawParsed = this.parseJSON<Record<string, unknown>>(response);
        } catch (parseError) {
          console.warn(`[CharacterReferenceSheetAgent] JSON parse failed on attempt ${attempt + 1}:`, parseError);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: `Failed to parse JSON after ${maxRetries + 1} attempts`,
            rawResponse: response 
          };
        }
        
        // Normalize the response to handle snake_case vs camelCase
        const sheet = this.normalizeReferenceSheet(rawParsed, input);
        
        if (!sheet) {
          console.warn(`[CharacterReferenceSheetAgent] Normalization failed on attempt ${attempt + 1}. Raw keys:`, 
            Object.keys(rawParsed));
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: 'Invalid response from LLM: could not find views array after retries.',
            rawResponse: response 
          };
        }
        
        // Validate we have at least one view with a valid prompt
        if (sheet.views.length === 0) {
          console.warn(`[CharacterReferenceSheetAgent] Empty views array on attempt ${attempt + 1}`);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: 'Invalid response from LLM: views array is empty.',
            rawResponse: response 
          };
        }

        console.log(`[CharacterReferenceSheetAgent] Successfully generated pose sheet with ${sheet.views.length} views`);
        return { success: true, data: sheet, rawResponse: response };
        
      } catch (error) {
        console.error(`[CharacterReferenceSheetAgent] Error on attempt ${attempt + 1}:`, error);
        if (attempt < maxRetries) continue;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    return { success: false, error: 'Failed to generate pose sheet after all retries' };
  }

  /**
   * Generate an EXPRESSION sheet (face close-ups) - SEPARATE from poses
   */
  async generateExpressionSheet(
    input: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<CharacterExpressionSheet>> {
    // Determine which expressions to generate
    const expressionsToGenerate = input.customExpressions 
      || EXPRESSION_TIERS[input.expressionTier || 'standard'];
    
    console.log(`[CharacterReferenceSheetAgent] Generating expression sheet with ${expressionsToGenerate.length} expressions for ${input.name}`);

    const prompt = this.buildExpressionSheetPrompt(input, expressionsToGenerate);
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callLLM([{ role: 'user', content: prompt }]);
        let rawParsed: Record<string, unknown>;
        
        try {
          rawParsed = this.parseJSON<Record<string, unknown>>(response);
        } catch (parseError) {
          console.warn(`[CharacterReferenceSheetAgent] Expression sheet JSON parse failed on attempt ${attempt + 1}:`, parseError);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: `Failed to parse expression sheet JSON after ${maxRetries + 1} attempts`,
            rawResponse: response 
          };
        }
        
        // Normalize the response to handle snake_case vs camelCase
        const sheet = this.normalizeExpressionSheet(rawParsed, input);
        
        if (!sheet) {
          console.warn(`[CharacterReferenceSheetAgent] Expression sheet normalization failed on attempt ${attempt + 1}. Raw keys:`, 
            Object.keys(rawParsed));
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: 'Invalid response from LLM: could not find expressions array after retries.',
            rawResponse: response 
          };
        }

        console.log(`[CharacterReferenceSheetAgent] Successfully generated expression sheet with ${sheet.expressions.length} expressions`);
        return { success: true, data: sheet, rawResponse: response };
        
      } catch (error) {
        console.error(`[CharacterReferenceSheetAgent] Expression sheet error on attempt ${attempt + 1}:`, error);
        if (attempt < maxRetries) continue;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    return { success: false, error: 'Failed to generate expression sheet after all retries' };
  }

  /**
   * Generate a single expression prompt (for iterative generation with reference)
   */
  async generateSingleExpression(
    request: CharacterReferenceSheetRequest,
    expressionName: ExpressionName,
    referenceImage?: { data: string; mimeType: string }
  ): Promise<AgentResponse<ImagePrompt>> {
    const expression = EXPRESSION_LIBRARY.find(e => e.name === expressionName);
    if (!expression) {
      return { success: false, error: `Unknown expression: ${expressionName}` };
    }

    const prompt = this.buildSingleExpressionPrompt(request, expression, referenceImage);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      
      if (!imagePrompt.aspectRatio) {
        imagePrompt.aspectRatio = '1:1';
      }

      return { success: true, data: imagePrompt, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get the expression definitions for a given tier
   */
  getExpressionsForTier(tier: 'minimal' | 'core' | 'standard' | 'extended' | 'full'): ExpressionDefinition[] {
    const names = EXPRESSION_TIERS[tier];
    return names.map(name => EXPRESSION_LIBRARY.find(e => e.name === name)!).filter(Boolean);
  }

  /**
   * Get a specific expression definition
   */
  getExpressionDefinition(name: ExpressionName): ExpressionDefinition | undefined {
    return EXPRESSION_LIBRARY.find(e => e.name === name);
  }

  /**
   * Generate ACTION POSE reference sheets for the character.
   * These capture character-specific body language for different dramatic situations.
   */
  async generateActionPoseSheet(
    input: CharacterReferenceSheetRequest,
    posesToGenerate?: Array<keyof typeof ACTION_POSE_DEFINITIONS>
  ): Promise<AgentResponse<{ characterId: string; characterName: string; actionPoses: ReferenceView[] }>> {
    const poses = posesToGenerate || ['combat-stance', 'emotional-distress', 'intimate-reach', 'defensive-recoil', 'aggressive-advance'];

    console.log(`[CharacterReferenceSheetAgent] Generating ${poses.length} action poses for: ${input.name}`);

    const actionPoses: ReferenceView[] = [];

    for (const poseType of poses) {
      const poseDefinition = ACTION_POSE_DEFINITIONS[poseType];
      if (!poseDefinition) continue;

      const prompt = this.buildActionPosePrompt(input, poseType, poseDefinition);

      try {
        const response = await this.callLLM([{ role: 'user', content: prompt }]);
        const imagePrompt = this.parseJSON<ImagePrompt>(response);

        if (!imagePrompt.aspectRatio) {
          imagePrompt.aspectRatio = '9:16'; // Taller aspect for full body poses
        }

        actionPoses.push({
          viewType: poseType as ReferenceView['viewType'],
          viewName: poseDefinition.name,
          prompt: imagePrompt,
          purpose: `Action reference for ${poseDefinition.emotionalContext}`
        });

        console.log(`[CharacterReferenceSheetAgent] Generated ${poseType} pose for ${input.name}`);
      } catch (error) {
        console.warn(`[CharacterReferenceSheetAgent] Failed to generate ${poseType} pose for ${input.name}:`, error);
      }
    }

    return {
      success: true,
      data: {
        characterId: input.characterId,
        characterName: input.name,
        actionPoses
      }
    };
  }

  /**
   * Build prompt for generating a single action pose reference
   */
  private buildActionPosePrompt(
    input: CharacterReferenceSheetRequest,
    poseType: string,
    poseDefinition: typeof ACTION_POSE_DEFINITIONS[string]
  ): string {
    const physicalDescription = [
      input.physicalTraits?.bodyType,
      input.physicalTraits?.hairColor && `${input.physicalTraits.hairColor} hair`,
      input.physicalTraits?.eyeColor && `${input.physicalTraits.eyeColor} eyes`,
      input.physicalTraits?.skinTone && `${input.physicalTraits.skinTone} skin`,
      input.physicalTraits?.distinctiveFeatures?.join(', ')
    ].filter(Boolean).join(', ');

    const clothingDescription = input.clothing
      ? `${input.clothing.style || ''} ${input.clothing.primaryColors?.join('/') || ''} ${input.clothing.signatureItems?.join(', ') || ''}`.trim()
      : '';

    return `
Generate an image prompt for a character ACTION POSE reference sheet.

## CHARACTER
- **Name**: ${input.name}
- **Role**: ${input.role}
- **Physical**: ${physicalDescription || input.description}
- **Clothing**: ${clothingDescription || 'Character-appropriate attire'}
- **Personality**: ${input.personality || 'Not specified'}

## ACTION POSE: ${poseDefinition.name.toUpperCase()}
${poseDefinition.description}

### Body Language Requirements
${poseDefinition.bodyLanguage}

### Gesture/Hand Notes
${poseDefinition.gestureNotes}

### Weight Distribution
${poseDefinition.weightDistribution}

### Emotional Context
This pose captures: ${poseDefinition.emotionalContext}

## ART STYLE
${this.artStyle || 'Dramatic cinematic story art'}

## OUTPUT REQUIREMENTS
Generate a prompt for a FULL-BODY character pose that:
1. Shows the character in this specific action pose
2. Captures the emotional context through body language
3. Has clear weight distribution and dynamic energy
4. Could be used as reference for illustrating this character in similar situations
5. Has a neutral background (solid color or simple gradient) to focus on the pose

Return JSON:
{
  "prompt": "Complete prompt describing character in this specific action pose",
  "negativePrompt": "stiff pose, neutral stance, arms at sides, centered weight, symmetrical pose, T-pose, mannequin",
  "style": "${this.artStyle || 'dramatic cinematic story art'}",
  "aspectRatio": "9:16",
  "composition": "Full body pose, character centered, simple background",
  "keyBodyLanguage": "Specific body mechanics for this pose",
  "keyGesture": "What hands are doing",
  "emotionalCore": "${poseDefinition.emotionalContext}"
}
`;
  }

  /**
   * Generate a SILHOUETTE PROFILE for the character
   * Defines their visual identity for black-fill readability
   */
  async generateSilhouetteProfile(
    input: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<CharacterSilhouetteProfile>> {
    console.log(`[CharacterReferenceSheetAgent] Generating silhouette profile for: ${input.name}`);

    const prompt = this.buildSilhouetteProfilePrompt(input);
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callLLM([{ role: 'user', content: prompt }]);
        let rawParsed: Record<string, unknown>;
        
        try {
          rawParsed = this.parseJSON<Record<string, unknown>>(response);
        } catch (parseError) {
          console.warn(`[CharacterReferenceSheetAgent] Silhouette profile JSON parse failed on attempt ${attempt + 1}:`, parseError);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: `Failed to parse silhouette profile JSON after ${maxRetries + 1} attempts`,
            rawResponse: response 
          };
        }
        
        // Validate parsed response
        if (!rawParsed || typeof rawParsed !== 'object') {
          console.warn(`[CharacterReferenceSheetAgent] Invalid silhouette profile response on attempt ${attempt + 1}`);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: 'Invalid response from LLM: not a valid object.',
            rawResponse: response 
          };
        }
        
        // Normalize the response (handle snake_case vs camelCase)
        const profile = this.normalizeSilhouetteProfile(rawParsed, input);

        console.log(`[CharacterReferenceSheetAgent] Successfully generated silhouette profile for ${input.name}`);
        return { success: true, data: profile, rawResponse: response };
        
      } catch (error) {
        console.error(`[CharacterReferenceSheetAgent] Silhouette profile error on attempt ${attempt + 1}:`, error);
        if (attempt < maxRetries) continue;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    return { success: false, error: 'Failed to generate silhouette profile after all retries' };
  }

  /**
   * Normalize silhouette profile response (handle snake_case vs camelCase)
   */
  private normalizeSilhouetteProfile(raw: Record<string, unknown>, input: CharacterReferenceSheetRequest): CharacterSilhouetteProfile {
    const get = <T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
      for (const key of keys) {
        if (obj[key] !== undefined) return obj[key] as T;
      }
      return undefined;
    };

    // Normalize shape hierarchy
    const rawHierarchy = get<Record<string, unknown>>(raw, 'shapeHierarchy', 'shape_hierarchy');
    const shapeHierarchy = rawHierarchy ? {
      largeShapes: get<string[]>(rawHierarchy, 'largeShapes', 'large_shapes') || [],
      mediumDetails: get<string[]>(rawHierarchy, 'mediumDetails', 'medium_details') || [],
      smallAccents: get<string[]>(rawHierarchy, 'smallAccents', 'small_accents') || []
    } : { largeShapes: [], mediumDetails: [], smallAccents: [] };

    return {
      characterId: input.characterId,
      characterName: input.name,
      shapeLanguage: get<string>(raw, 'shapeLanguage', 'shape_language') || 'balanced',
      silhouetteHooks: get<string[]>(raw, 'silhouetteHooks', 'silhouette_hooks', 'hooks') || [],
      asymmetryNotes: get<string[]>(raw, 'asymmetryNotes', 'asymmetry_notes', 'asymmetry') || [],
      shapeHierarchy,
      contrastNotes: get<string>(raw, 'contrastNotes', 'contrast_notes', 'contrast') || ''
    };
  }

  /**
   * Build prompt for silhouette profile generation
   */
  private buildSilhouetteProfilePrompt(request: CharacterReferenceSheetRequest): string {
    return `
## Task: Generate Character Silhouette Profile

Create a comprehensive silhouette design profile for this character that ensures they are instantly recognizable even when filled solid black.

${SILHOUETTE_DESIGN_RULES}

## CHARACTER DETAILS

**Name**: ${request.name}
${request.pronouns ? `**Gender / Pronouns**: ${this.genderLabel(request.pronouns)} (${request.pronouns})` : ''}
**Role**: ${request.role}
**Description**: ${request.description}
**Personality**: ${request.personality || 'Not specified'}
**Background**: ${request.backgroundTraits || 'Not specified'}

**Physical Traits**:
- Age: ${request.physicalTraits.age || 'Not specified'}
- Height: ${request.physicalTraits.height || 'Not specified'}
- Build: ${request.physicalTraits.build || 'Not specified'}
- Hair: ${request.physicalTraits.hairColor || ''} ${request.physicalTraits.hairStyle || ''}
- Distinguishing features: ${request.physicalTraits.distinguishingFeatures?.join(', ') || 'None specified'}

**Clothing**:
- Primary: ${request.clothing?.primary || 'Not specified'}
- Accessories: ${request.clothing?.accessories?.join(', ') || 'None'}
- Colors: ${request.clothing?.colorPalette?.join(', ') || 'Not specified'}

**Genre**: ${request.genre}
**Tone**: ${request.tone}

## ANALYSIS REQUIRED

Based on the character's personality and role, determine:

1. **SHAPE LANGUAGE**: What overall shape language reflects their personality?
   - Round → friendly, approachable
   - Angular → dangerous, aggressive
   - Blocky → stoic, reliable
   - Mixed → complex personality

2. **SILHOUETTE HOOKS** (2-3 distinctive traits):
   What makes this character recognizable in pure black silhouette?
   - Hair shape? Weapon? Cape? Unique accessory?
   - These should be visible at thumbnail size

3. **ASYMMETRY** (for orientation):
   What's different on left vs right side?
   - Helps viewers know which way character faces

4. **SHAPE HIERARCHY**:
   - Large shapes (main body masses)
   - Medium details (costume features)
   - Small accents (keep these minimal!)

5. **CONTRAST NOTES**:
   How should this character contrast against typical backgrounds?

## OUTPUT FORMAT

Return a JSON CharacterSilhouetteProfile:

{
  "characterId": "${request.characterId}",
  "characterName": "${request.name}",
  "shapeLanguage": "round|angular|blocky|mixed",
  "shapeLanguageNotes": "explanation of shape language choice based on personality",
  "silhouetteHooks": ["hook1", "hook2", "hook3 if needed"],
  "asymmetryNotes": ["left side detail", "right side detail"],
  "colorGraphicHook": "signature color or pattern for quick recognition",
  "propSilhouette": "signature weapon/item outline description if applicable",
  "shapeHierarchy": {
    "largeShapes": ["main body mass descriptions"],
    "mediumDetails": ["secondary feature descriptions"],
    "smallAccents": ["just a few small details"]
  },
  "contrastNotes": "how character should contrast against backgrounds"
}
`;
  }

  /**
   * Derive shape language from personality traits
   */
  static deriveShapeLanguage(personality: string, role: string): ShapeLanguage {
    const lowerPersonality = (personality || '').toLowerCase();
    const lowerRole = (role || '').toLowerCase();
    
    // Angular indicators
    const angularKeywords = ['aggressive', 'dangerous', 'villain', 'antagonist', 'fierce', 'sharp', 'menacing', 'threatening'];
    if (angularKeywords.some(k => lowerPersonality.includes(k) || lowerRole.includes(k))) {
      return 'angular';
    }
    
    // Round indicators
    const roundKeywords = ['friendly', 'kind', 'gentle', 'comic', 'approachable', 'warm', 'nurturing', 'soft'];
    if (roundKeywords.some(k => lowerPersonality.includes(k) || lowerRole.includes(k))) {
      return 'round';
    }
    
    // Blocky indicators
    const blockyKeywords = ['stoic', 'rigid', 'military', 'strong', 'immovable', 'reliable', 'serious', 'stern'];
    if (blockyKeywords.some(k => lowerPersonality.includes(k) || lowerRole.includes(k))) {
      return 'blocky';
    }
    
    // Default to mixed for complex characters
    return 'mixed';
  }

  /**
   * Validate a silhouette profile
   */
  static validateSilhouetteProfile(profile: CharacterSilhouetteProfile): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Must have 2-3 silhouette hooks
    if (!profile.silhouetteHooks || profile.silhouetteHooks.length < 2) {
      issues.push('Need at least 2 silhouette hooks for recognition');
    }
    if (profile.silhouetteHooks && profile.silhouetteHooks.length > 4) {
      warnings.push('Too many silhouette hooks (>4) may clutter the design');
    }

    // Must have asymmetry notes
    if (!profile.asymmetryNotes || profile.asymmetryNotes.length === 0) {
      warnings.push('No asymmetry notes - character may be hard to orient');
    }

    // Shape hierarchy check
    if (!profile.shapeHierarchy) {
      issues.push('Missing shape hierarchy');
    } else {
      if (!profile.shapeHierarchy.largeShapes || profile.shapeHierarchy.largeShapes.length === 0) {
        issues.push('No large shapes defined');
      }
      if (profile.shapeHierarchy.smallAccents && profile.shapeHierarchy.smallAccents.length > 5) {
        warnings.push('Too many small accents may muddy the silhouette');
      }
    }

    // Contrast notes
    if (!profile.contrastNotes) {
      warnings.push('No contrast notes - consider how character reads against backgrounds');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  protected getAgentSpecificPrompt(): string {
    const styleInstruction = this.artStyle 
      ? `\n### MANDATORY Art Style\nAll reference images MUST strictly follow this art style: ${this.artStyle}\nThis is NON-NEGOTIABLE. Every prompt must incorporate the style's specific techniques, color treatments, and visual markers.\n`
      : '';

    return `
## Your Role: Character Reference Sheet Agent

You create comprehensive character reference sheets that serve as the canonical visual source for all subsequent images of a character. Your output ensures perfect visual consistency throughout the story.

${styleInstruction}

## CORE PRINCIPLE: REFERENCE SHEETS ARE MODEL SHEETS, NOT STORY ILLUSTRATIONS.
Reference sheet images must be CLEAN, NEUTRAL studio portraits for visual identity anchoring.
They are NOT story beats, NOT dramatic illustrations, NOT narrative scenes.

EVERY reference sheet view MUST have:
- Plain solid-color background (gray, white, or neutral) — NO environments, NO scenery
- Neutral or simple standing pose — NO action poses, NO dramatic gestures
- Even, flat studio lighting — NO dramatic lighting, NO mood lighting
- Character filling the frame — full body or 3/4 body clearly visible
- NO props, NO other characters, NO narrative context
- This is a CHARACTER MODEL SHEET for visual consistency reference

## Reference Sheet Philosophy

A good character reference sheet captures:
1. **Identity Anchors** - The 3-5 visual elements that make this character instantly recognizable
2. **Pose Vocabulary** - How this character carries themselves (posture, gesture tendencies)
3. **Color DNA** - The specific palette that "belongs" to this character
4. **Silhouette Signature** - What makes them recognizable even as a shadow

## View Requirements

### Front View (Neutral)
- Character standing in relaxed neutral pose
- Full body or 3/4 body visible
- Clear view of face, hair, and clothing details
- Even, studio-style lighting to show true colors
- NO dramatic angles - straight-on for reference accuracy

### Three-Quarter View (Primary)
- Character in characteristic pose reflecting their personality
- Shows depth and dimensionality
- This is the "hero shot" - the most iconic representation
- Slight dynamic energy appropriate to character

### Profile View (Side View)
- ENTIRE BODY rotated 90 degrees so the character faces left or right — only ONE shoulder visible, body perpendicular to camera
- This is NOT a head turn — the torso, hips, and legs must ALL face sideways
- Clean side view at the SAME SCALE and framing as front view (full body, head to toe)
- Fully detailed and colored — NOT a silhouette, NOT a shadow, NOT an outline
- Shows profile elements (nose shape, jawline from side, hair from the side, posture, silhouette)
- Essential for maintaining consistency in side angles

### Expression Views (if requested)
- Head/shoulder close-ups showing emotional range
- Same lighting as front view for color consistency
- Expressions: typically happy, sad, angry, surprised
- Captures how THIS character specifically shows emotion

## Visual Anchors

Identify and emphasize:
- **Hair anchors**: Specific style, color, any unique elements (streak, accessory)
- **Face anchors**: Eye color, distinctive features (scar, freckles, glasses)
- **Clothing anchors**: Signature garment, consistent accessories
- **Posture anchors**: How they stand, characteristic gestures

## POSTURE & STANCE (Reference Sheet Context)
For reference sheets, posture should reveal CHARACTER, not STORY:
- How does this character naturally stand? (upright/slouched, weight distribution)
- What is their default hand position? (pockets, clasped, at sides, fidgeting)
- Do they have a characteristic lean or tilt?
- What distinguishes their silhouette from other characters?
These subtle posture cues should be visible in the reference views without introducing dramatic action or narrative context.

## Output Format

Return a JSON object:
{
  "characterId": "string",
  "characterName": "string",
  "views": [
    {
      "viewType": "front | three-quarter | profile | expression",
      "expressionName": "happy | sad | angry | surprised (only for expression type)",
      "prompt": {
        "prompt": "Detailed image generation prompt",
        "negativePrompt": "Things to avoid",
        "style": "Style notes",
        "aspectRatio": "1:1",
        "composition": "Composition notes"
      },
      "purpose": "What this view validates in consistency checks"
    }
  ],
  "visualAnchors": ["List of 3-5 key visual identifiers"],
  "colorPalette": ["#hex1", "#hex2", "color name descriptions"],
  "silhouetteNotes": "What makes their silhouette distinctive",
  "consistencyChecklist": ["Specific things to verify in every shot of this character"]
}
`;
  }

  private buildReferenceSheetPrompt(request: CharacterReferenceSheetRequest): string {
    const physicalDesc = this.buildPhysicalDescription(request.physicalTraits);
    const clothingDesc = request.clothing 
      ? `\n**Clothing**: ${request.clothing.primary}${request.clothing.accessories?.length ? ` with ${request.clothing.accessories.join(', ')}` : ''}${request.clothing.colorPalette?.length ? `. Color palette: ${request.clothing.colorPalette.join(', ')}` : ''}`
      : '';
    
    const expressionSection = request.includeExpressions !== false
      ? `\n\n## Expression Requirements\nGenerate ${request.expressionCount || 4} expression views showing the character's emotional range. Consider their personality (${request.personality || 'not specified'}) when depicting how they express emotions.`
      : '\n\n## Expression Requirements\nExpressions not requested for this character.';

    return `
Create a comprehensive character reference sheet for the following character:

## Character Information
- **Name**: ${request.name}
${this.genderPromptLine(request.pronouns)}
- **ID**: ${request.characterId}
- **Role**: ${request.role}
- **Description**: ${request.description}

## Physical Traits
${physicalDesc}
${clothingDesc}

## Story Context
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}
${request.artStyle ? `- **Art Style**: ${request.artStyle}` : ''}
${expressionSection}

## CRITICAL REQUIREMENTS FOR CHARACTER REFERENCE SHEETS
${request.priorKnowledge ? `
### 📝 PRIOR CHARACTER KNOWLEDGE (from previous generations)
${request.priorKnowledge}
Use the above insights to improve consistency (e.g., traits that worked well, issues to avoid).
` : ''}
${request.userReferenceImages?.length ? `
### ⚠️ USER REFERENCE IMAGES PROVIDED
The user has provided reference photos for this character. When building each view prompt:
- Do NOT include specific facial feature descriptions (face shape, eye color, nose shape, skin tone, hair color)
- Instead use the phrase "matching the provided reference photo" where facial features would go
- DO include: gender, clothing/outfit, pose, framing, and composition details
- The image generator will receive the reference photos separately and will use them for the face
` : ''}
### MANDATORY ELEMENTS FOR ALL PROMPTS:
1. **PLAIN BACKGROUND**: Every prompt MUST specify "plain solid color background", "neutral gray background", or "simple studio background". NO environments, NO scenery, NO props.
2. **CHARACTER FILLS THE FRAME**: The character must be the main focus, filling 70-80% of the image. NOT tiny in the distance.
3. **FULL BODY VISIBLE**: Show complete character from head to feet (or head to mid-thigh for 3/4 shots).
4. **CONSISTENT LIGHTING**: Use soft, even studio lighting for all views.
${this.artStyle ? `5. **ART STYLE**: Every positive prompt MUST start with the art style: "${this.artStyle}"` : '5. **ART STYLE**: Include any specified art style at the START of each positive prompt.'}
${request.pronouns ? `6. **GENDER**: The character is **${this.genderLabel(request.pronouns)}**. Every prompt MUST include the word "${this.genderLabel(request.pronouns)}" explicitly near the beginning of the description to ensure the image model renders the correct gender consistently. Do NOT rely on the character name alone.` : ''}

### VIEW SPECIFICATIONS:
- **FRONT**: Facing camera directly, neutral pose, arms slightly away from body, feet shoulder-width apart
- **THREE-QUARTER**: 45-degree angle, slight pose showing personality, weight on one leg
- **PROFILE**: Entire body rotated 90 degrees facing left or right, only one shoulder visible, body perpendicular to camera. NOT just a head turn — torso hips and legs all face sideways. Clean side profile fully detailed and colored, SAME SCALE as front view (full body head to toe), NOT a silhouette, NOT a bust/close-up

### WHAT TO AVOID (Include in negative prompts):
- Background elements, environments, scenery, landscapes
- Props, furniture, other characters
- Cropped limbs, cut-off body parts
- Tiny/distant character, character too small in frame
- Multiple characters, crowd scenes
- Text, watermarks, signatures
${request.pronouns?.startsWith('he') ? '- female, feminine, breasts, woman' : ''}${request.pronouns?.startsWith('she') ? '- male, masculine, beard, stubble' : ''}

## REQUIRED JSON FORMAT (Return ONLY valid JSON, no markdown):

{
  "characterId": "${request.characterId}",
  "characterName": "${request.name}",
  "views": [
    {
      "viewType": "front",
      "viewName": "Front View",
      "purpose": "Establish baseline appearance",
      "prompt": {
        "prompt": "${this.artStyle ? `Art style: ${this.artStyle}. ` : ''}[full character description], front view, facing camera, neutral standing pose, full body visible head to toe, character fills frame, plain solid gray background, soft studio lighting, centered composition${this.artStyle ? `. Rendered in the art style specified above — do not substitute a generic illustrated or graphic-novel look.` : ', reference sheet style'}",
        "negativePrompt": "background, environment, scenery, props, furniture, cropped, cut off, tiny character, distant, multiple people, text, watermark${this.artStyle ? ', generic illustrated style, default comic-book style, default graphic-novel style' : ''}",
        "aspectRatio": "1:1"
      }
    },
    {
      "viewType": "three_quarter",
      "viewName": "Three-Quarter View", 
      "purpose": "Show dimensional form and characteristic pose",
      "prompt": {
        "prompt": "${this.artStyle ? `Art style: ${this.artStyle}. ` : ''}[full character description], three-quarter view, 45 degree angle, characteristic pose, full body visible, character fills frame, plain solid gray background, soft studio lighting${this.artStyle ? `. Rendered in the art style specified above — do not substitute a generic illustrated or graphic-novel look.` : ', reference sheet style'}",
        "negativePrompt": "background, environment, scenery, props, furniture, cropped, cut off, tiny character, distant, multiple people, text, watermark${this.artStyle ? ', generic illustrated style, default comic-book style, default graphic-novel style' : ''}",
        "aspectRatio": "1:1"
      }
    },
    {
      "viewType": "profile",
      "viewName": "Profile View",
      "purpose": "Establish side profile and side details at same scale as other views",
      "prompt": {
        "prompt": "${this.artStyle ? `Art style: ${this.artStyle}. ` : ''}[full character description], side profile view, entire body rotated 90 degrees facing left, body perpendicular to camera, only one shoulder visible, torso hips and legs all facing sideways, clean side profile fully detailed and colored, full body visible head to toe, same scale as front view, character fills frame, plain solid gray background, soft studio lighting${this.artStyle ? `. Rendered in the art style specified above — do not substitute a generic illustrated or graphic-novel look.` : ', reference sheet style'}",
        "negativePrompt": "background, environment, scenery, props, furniture, cropped, cut off, tiny character, distant, multiple people, text, watermark, front-facing body, body facing camera, both shoulders visible, silhouette, shadow figure, black shape, featureless outline, close-up, bust shot, head shot, portrait crop${this.artStyle ? ', generic illustrated style, default comic-book style, default graphic-novel style' : ''}",
        "aspectRatio": "1:1"
      }
    }
  ],
  "visualAnchors": ["distinctive feature 1", "distinctive feature 2", "distinctive feature 3"],
  "colorPalette": ["#hexcolor1", "#hexcolor2", "#hexcolor3"],
  "silhouetteNotes": "Description of what makes their silhouette recognizable",
  "consistencyChecklist": ["check item 1", "check item 2", "check item 3"]
}

CRITICAL: 
- The "views" array MUST contain exactly 3 view objects with viewType "front", "three_quarter", and "profile".
- Each "prompt" field MUST include: plain background, full body, character fills frame.
${this.artStyle
  ? `- Each "prompt" field MUST lead with "Art style: ${this.artStyle}" and MUST NOT include the phrase "reference sheet style" (which biases the model toward a default illustrated/graphic-novel aesthetic).`
  : '- Each "prompt" field MUST include "reference sheet style".'}
- Replace [full character description] with the actual detailed character appearance.
`;
  }

  private buildPhysicalDescription(traits: CharacterReferenceSheetRequest['physicalTraits']): string {
    const parts: string[] = [];
    
    if (traits.age) parts.push(`Age: ${traits.age}`);
    if (traits.height) parts.push(`Height: ${traits.height}`);
    if (traits.build) parts.push(`Build: ${traits.build}`);
    if (traits.hairColor) parts.push(`Hair color: ${traits.hairColor}`);
    if (traits.hairStyle) parts.push(`Hair style: ${traits.hairStyle}`);
    if (traits.eyeColor) parts.push(`Eye color: ${traits.eyeColor}`);
    if (traits.skinTone) parts.push(`Skin tone: ${traits.skinTone}`);
    if (traits.distinguishingFeatures?.length) {
      parts.push(`Distinguishing features: ${traits.distinguishingFeatures.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('\n') : 'No specific physical traits provided - infer from description.';
  }

  /**
   * Generate a single view prompt for iterative generation
   * (Used when generating views one at a time with reference images)
   */
  async generateSingleViewPrompt(
    request: CharacterReferenceSheetRequest,
    viewType: ReferenceView['viewType'],
    expressionName?: string,
    existingViews?: Array<{ viewType: string; imageData: string; mimeType: string }>
  ): Promise<AgentResponse<ImagePrompt>> {
    const prompt = this.buildSingleViewPrompt(request, viewType, expressionName, existingViews);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      
      if (!imagePrompt.aspectRatio) {
        imagePrompt.aspectRatio = '1:1';
      }

      return { success: true, data: imagePrompt, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildSingleViewPrompt(
    request: CharacterReferenceSheetRequest,
    viewType: ReferenceView['viewType'],
    expressionName?: string,
    existingViews?: Array<{ viewType: string; imageData: string; mimeType: string }>
  ): string {
    const viewDescriptions: Record<string, string> = {
      'front': 'Front view facing camera, neutral standing pose, full body head to toe visible, character fills 70% of frame',
      'three-quarter': 'Three-quarter view at 45 degrees, characteristic pose, full body visible, character fills frame',
      'profile': 'Side profile view with entire body rotated 90 degrees facing left, body perpendicular to camera, only one shoulder visible, torso hips and legs all facing sideways, clean side profile fully detailed and colored, full body visible head to toe at same scale as front view, character fills frame',
      'back': 'Back view showing hair and clothing from behind, full body visible',
      'expression': `Head and shoulders portrait, ${expressionName} expression, face fills 60% of frame`
    };

    const referenceNote = existingViews && existingViews.length > 0
      ? `\n\n## CRITICAL: Existing Reference Views\nYou MUST maintain PERFECT consistency with the ${existingViews.length} existing view(s) already generated. The character's face, hair, clothing, and colors must match EXACTLY.`
      : '';

    return `
Generate an image prompt for a single reference sheet view.

## Character
- **Name**: ${request.name}
${this.genderPromptLine(request.pronouns)}
- **Description**: ${request.description}
- **Role**: ${request.role}

## View to Generate
- **View Type**: ${viewType}
${expressionName ? `- **Expression**: ${expressionName}` : ''}
- **View Description**: ${viewDescriptions[viewType]}

## CRITICAL REQUIREMENTS
1. **PLAIN BACKGROUND**: MUST be "plain solid gray background" - NO environment, NO scenery
2. **CHARACTER FILLS FRAME**: Character must fill 70-80% of image - NOT tiny, NOT distant
3. **FULL BODY VISIBLE** (for pose views): Complete character from head to toe
4. **SOFT STUDIO LIGHTING**: Even, neutral lighting
${this.artStyle ? `5. **ART STYLE**: MUST include "${this.artStyle}" at START of prompt` : ''}
${request.pronouns ? `6. **GENDER**: The character is **${this.genderLabel(request.pronouns)}**. MUST include "${this.genderLabel(request.pronouns)}" explicitly in the prompt text to ensure the image model renders the correct gender presentation. Do NOT rely solely on name or description.` : ''}

## What to AVOID (for negative prompt)
- background, environment, scenery, setting, landscape
- tiny character, distant, cropped limbs
- multiple people, props, furniture
- text, watermark
${request.pronouns?.startsWith('he') ? '- female, feminine, breasts, woman' : ''}${request.pronouns?.startsWith('she') ? '- male, masculine, beard, stubble' : ''}

## Context
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}
${referenceNote}

Return JSON with format:
{
  "prompt": "${this.artStyle ? `Art style: ${this.artStyle}. ` : ''}[detailed character description], ${viewDescriptions[viewType]}, plain solid gray background, soft studio lighting${this.artStyle ? '. Rendered in the art style specified above — do not substitute a generic illustrated or graphic-novel look.' : ', reference sheet style'}",
  "negativePrompt": "background, environment, scenery, tiny character, distant, cropped, multiple people, text, watermark${this.artStyle ? ', generic illustrated style, default comic-book style, default graphic-novel style' : ''}",
  "aspectRatio": "1:1"
}
`;
  }

  // ==========================================
  // EXPRESSION SHEET METHODS
  // ==========================================

  /**
   * Build the prompt for generating a complete expression sheet
   */
  private buildExpressionSheetPrompt(
    request: CharacterReferenceSheetRequest,
    expressions: ExpressionName[]
  ): string {
    const physicalDesc = this.buildPhysicalDescription(request.physicalTraits);
    const faceVisibilityRule = this.buildExpressionFaceVisibilityRule(request);
    const faceObstructionNegative = this.buildExpressionFaceObstructionNegative(request);
    
    // Build expression requirements with full definitions and 3 KEY LANDMARKS
    const expressionDetails = expressions.map(name => {
      const def = EXPRESSION_LIBRARY.find(e => e.name === name);
      if (!def) return `- ${name}: (no definition)`;
      return `
### ${name.toUpperCase()} (${def.category})
- **Description**: ${def.description}
**THE 3 KEY LANDMARKS (CRITICAL)**:
- **EYEBROWS** (attitude): ${def.eyebrows}
- **EYELIDS** (intensity): ${def.eyelids}
- **MOUTH** (flavor): ${def.mouth}
Supporting details:
- Eyes: ${def.eyeDescription}
- Mouth: ${def.mouthDescription}
- Other features: ${def.facialFeatures}`;
    }).join('\n');

    const personalityInfluence = request.personality
      ? `

## PERSONALITY INFLUENCE ON EXPRESSIONS
This character's personality is: "${request.personality}"

Consider how this affects their expressions:
- How do they smile? (Broad and open? Subtle and reserved? Crooked?)
- How do they show anger? (Explosive? Cold? Simmering?)
- Do they hide emotions or wear them openly?
- Any characteristic facial quirks or tendencies?`
      : '';

    return `
Create a CHARACTER EXPRESSION SHEET (face close-ups only, NO full body).

## Character Information
- **Name**: ${request.name}
${this.genderPromptLine(request.pronouns)}
- **ID**: ${request.characterId}
- **Role**: ${request.role}
- **Description**: ${request.description}

## Physical Traits (for face consistency)
${physicalDesc}
${personalityInfluence}

## FRAMING REQUIREMENTS (CRITICAL)
- ALL expressions are HEAD CLOSE-UPS or HEAD + SHOULDERS maximum
- Same consistent camera angle for all expressions (front-facing or slight 3/4)
- Even, studio-style lighting to show true colors and details
- Clean background (solid color or simple gradient)
- FOCUS IS ON THE FACE - expressions must be clearly readable

${EXPRESSION_LANDMARKS}

## PROMPT STRUCTURE FOR EACH EXPRESSION
Every expression prompt MUST explicitly describe:
1. EYEBROWS: position and shape (raised/furrowed/asymmetric)
2. EYELIDS: openness level (wide/normal/narrowed/half-lidded/squeezed)
3. MOUTH: shape and state (open/closed, corners up/down, showing teeth or not)

## Expressions to Generate (${expressions.length} total)
${expressionDetails}

## Story Context
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}
${this.artStyle ? `- **Art Style**: ${this.artStyle} (MANDATORY for all expressions)` : ''}

## CRITICAL REQUIREMENTS FOR EXPRESSION SHEETS

### MANDATORY ELEMENTS FOR ALL EXPRESSION PROMPTS:
1. **PLAIN BACKGROUND**: Every prompt MUST specify "plain solid gray background" or "neutral studio background". NO environments.
2. **FACE FILLS THE FRAME**: Head and shoulders ONLY. Face must be 60-70% of the image. NOT full body, NOT tiny face.
3. **CONSISTENT LIGHTING**: Soft, even studio lighting for all expressions - same setup.
4. **CONSISTENT ANGLE**: Front-facing or slight 3/4 angle - same for all expressions.
5. **FACE VISIBILITY**: ${faceVisibilityRule}
${this.artStyle ? `6. **ART STYLE**: Every prompt MUST start with: "${this.artStyle}"` : '6. **ART STYLE**: Include specified art style at START of each prompt.'}

### WHAT EACH PROMPT MUST INCLUDE:
- Art style (if specified)
- "head and shoulders portrait" or "face close-up"
- "plain solid gray background" or "neutral background"
- Character's FACIAL distinctive features ONLY (hair color, hair style, eye color, skin tone, facial scars, facial hair)
- THE 3 KEY LANDMARKS (eyebrows, eyelids, mouth) explicitly described
- "soft studio lighting"
- "expression reference sheet"

### WHAT MUST NOT APPEAR IN EXPRESSION PROMPTS:
- NO clothing descriptions (no collars, no doublets, no armor, no scarves, no cravats, no necklines)
- NO accessories below the chin (necklaces, pendants, brooches)
- High collars and neckwear cause fabric to bleed into the face in close-ups — NEVER mention them
- Costume/outfit details belong ONLY in pose reference sheets, NOT in expression close-ups

### WHAT TO AVOID (Include in negative prompts):
- full body, wide shot, distant, tiny face
- background, environment, scenery, setting
- multiple people, other characters
- text, watermark, signature
- clothing details, collar, fabric near face
- ${faceObstructionNegative}

## Output Format
Return a JSON CharacterExpressionSheet object.

CRITICAL: Each expression MUST have a UNIQUE prompt with:
1. The expression NAME explicitly stated (e.g., "happy expression", "angry expression")
2. The SPECIFIC eyebrow, eyelid, and mouth details from the expression definition above
3. Each prompt must be DIFFERENT - they cannot all be the same!

Example structure showing how prompts MUST differ:
{
  "characterId": "${request.characterId}",
  "characterName": "${request.name}",
  "expressionTier": "${request.expressionTier || 'standard'}",
  "expressions": [
    {
      "expressionName": "neutral",
      "expressionCategory": "core",
      "prompt": {
        "prompt": "${this.artStyle ? `${this.artStyle}, ` : ''}head and shoulders portrait, [character features], NEUTRAL expression, eyebrows relaxed in natural position, eyelids normal comfortable openness, mouth closed relaxed lips gently together, plain solid gray background, soft studio lighting, face fills frame",
        "negativePrompt": "full body, wide shot, distant, tiny face, background, environment, smiling, frowning, text, watermark, ${faceObstructionNegative}",
        "aspectRatio": "1:1"
      },
      "purpose": "Baseline reference for calm scenes"
    },
    {
      "expressionName": "happy",
      "expressionCategory": "core",
      "prompt": {
        "prompt": "${this.artStyle ? `${this.artStyle}, ` : ''}head and shoulders portrait, [character features], HAPPY expression, eyebrows slightly raised relaxed, eyelids slightly narrowed from cheeks pushing up, mouth wide smile with corners pulled up showing teeth, plain solid gray background, soft studio lighting, face fills frame",
        "negativePrompt": "full body, wide shot, distant, tiny face, background, environment, frowning, neutral, sad, text, watermark, ${faceObstructionNegative}",
        "aspectRatio": "1:1"
      },
      "purpose": "Joyful moments and victories"
    },
    {
      "expressionName": "angry",
      "expressionCategory": "core",
      "prompt": {
        "prompt": "${this.artStyle ? `${this.artStyle}, ` : ''}head and shoulders portrait, [character features], ANGRY expression, eyebrows sharply furrowed pulled down and together, eyelids tensed narrowed glaring, mouth tight lips pressed thin or snarl showing teeth, plain solid gray background, soft studio lighting, face fills frame",
        "negativePrompt": "full body, wide shot, distant, tiny face, background, environment, smiling, happy, calm, text, watermark, ${faceObstructionNegative}",
        "aspectRatio": "1:1"
      },
      "purpose": "Conflict and confrontation scenes"
    }
  ],
  "expressionNotes": "Notes on how this character specifically shows emotions",
  "personalityInfluence": "How their personality affects their expressions"
}

CRITICAL RULES:
1. "expressionName" MUST be the exact expression name (neutral, happy, sad, angry, etc.)
2. Each "prompt" MUST explicitly name the expression (e.g., "HAPPY expression", "ANGRY expression")
3. Each prompt MUST include the SPECIFIC eyebrow/eyelid/mouth details from the expression definitions above
4. NO TWO PROMPTS CAN BE IDENTICAL - each expression has unique facial details!
`;
  }

  private expressionExplicitlyAllowsFaceCovering(request: CharacterReferenceSheetRequest): boolean {
    const descriptionText = [
      request.description,
      request.clothing?.primary,
      ...(request.clothing?.accessories || []),
      ...(request.physicalTraits?.distinguishingFeatures || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /\b(veil|veiled|face veil|bridal veil|niqab|burqa|mask|masked|face covering|covered face|scarf covering face|cloth covering face)\b/.test(descriptionText);
  }

  private buildExpressionFaceVisibilityRule(request: CharacterReferenceSheetRequest): string {
    return this.expressionExplicitlyAllowsFaceCovering(request)
      ? 'Keep the expression readable. A face covering is allowed only because it is explicitly part of this character design, but the eyes/brows and emotional read must remain clear.'
      : 'The full face must remain unobstructed. No veil, no fabric, no hair, no jewelry, and no props crossing the eyes, nose, or mouth.';
  }

  private buildExpressionFaceObstructionNegative(request: CharacterReferenceSheetRequest): string {
    return this.expressionExplicitlyAllowsFaceCovering(request)
      ? 'face fully hidden, eyes obscured, unreadable expression'
      : 'veil, face covering, fabric over face, fabric over nose, fabric over mouth, drapery across face, scarf covering face, obscured nose, obscured mouth, hidden face';
  }

  /**
   * Build prompt for a single expression (for iterative generation with reference)
   */
  private buildSingleExpressionPrompt(
    request: CharacterReferenceSheetRequest,
    expression: ExpressionDefinition,
    referenceImage?: { data: string; mimeType: string }
  ): string {
    const faceVisibilityRule = this.buildExpressionFaceVisibilityRule(request);
    const faceObstructionNegative = this.buildExpressionFaceObstructionNegative(request);
    const referenceNote = referenceImage
      ? `

## CRITICAL: Reference Image Provided
A reference image of this character's face is provided. You MUST maintain PERFECT consistency:
- Same face shape, same eye shape, same nose, same lip shape
- Same hair style and color
- Same skin tone and any distinguishing features
- Only the EXPRESSION changes - not the identity`
      : '';

    const personalityNote = request.personality
      ? `\n**Personality consideration**: "${request.personality}" - consider how this affects their ${expression.name} expression`
      : '';

    return `
Generate an image prompt for a single EXPRESSION close-up.

## Character
- **Name**: ${request.name}
${this.genderPromptLine(request.pronouns)}
- **Description**: ${request.description}
${personalityNote}

## Expression to Generate: ${expression.name.toUpperCase()}
- **Category**: ${expression.category}
- **Description**: ${expression.description}

## THE 3 KEY LANDMARKS (MUST BE IN PROMPT)
These are CRITICAL for expression readability:
1. **EYEBROWS** (attitude): ${expression.eyebrows}
2. **EYELIDS** (intensity): ${expression.eyelids}
3. **MOUTH** (flavor): ${expression.mouth}

Supporting Details:
- Eyes: ${expression.eyeDescription}
- Mouth: ${expression.mouthDescription}
- Other features: ${expression.facialFeatures}

## CRITICAL FRAMING REQUIREMENTS
- **HEAD AND SHOULDERS ONLY** - NO full body, NO wide shots
- **FACE FILLS 60-70% OF FRAME** - NOT tiny, NOT distant
- **PLAIN SOLID GRAY BACKGROUND** - NO environment, NO scenery
- **SOFT STUDIO LIGHTING** - Even, consistent lighting
- **FRONT-FACING OR SLIGHT 3/4 ANGLE** - Same angle as other expressions
- **FACE VISIBILITY** - ${faceVisibilityRule}
${referenceNote}

## Context
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}
${this.artStyle ? `- **Art Style**: ${this.artStyle} (MANDATORY)` : ''}

## Output
Return a JSON ImagePrompt object where the prompt EXPLICITLY includes:
1. Art style (if specified): ${this.artStyle || 'not specified'}
2. "head and shoulders portrait" or "face close-up"
3. "plain solid gray background"
4. Eyebrow position: "${expression.eyebrows}"
5. Eyelid state: "${expression.eyelids}"
6. Mouth shape: "${expression.mouth}"
7. "face fills frame", "soft studio lighting"

{
  "prompt": "${this.artStyle ? `${this.artStyle}, ` : ''}head and shoulders portrait, [character description], ${expression.name} expression, eyebrows ${expression.eyebrows}, eyelids ${expression.eyelids}, mouth ${expression.mouth}, plain solid gray background, soft studio lighting, face fills frame, expression reference sheet",
  "negativePrompt": "full body, wide shot, distant, tiny face, background, environment, scenery, multiple people, text, watermark, ${faceObstructionNegative}, ${this.getOppositeExpressions(expression.name)}",
  "aspectRatio": "1:1"
}
`;
  }

  /**
   * Get expressions that should NOT appear (for negative prompt)
   */
  private getOppositeExpressions(expression: ExpressionName): string {
    const opposites: Record<ExpressionName, string[]> = {
      'neutral': ['smiling', 'frowning', 'emotional'],
      'happy': ['sad', 'angry', 'frowning', 'crying'],
      'sad': ['happy', 'smiling', 'joyful', 'laughing'],
      'angry': ['happy', 'peaceful', 'calm', 'smiling'],
      'surprised': ['bored', 'tired', 'calm', 'neutral'],
      'scared': ['confident', 'brave', 'relaxed', 'happy'],
      'disgusted': ['pleased', 'hungry', 'interested', 'happy'],
      'pleased': ['disgusted', 'angry', 'sad', 'frustrated'],
      'bored': ['excited', 'interested', 'engaged', 'alert'],
      'tired': ['energetic', 'alert', 'awake', 'lively'],
      'arrogant': ['humble', 'meek', 'shy', 'uncertain'],
      'irritated': ['patient', 'calm', 'happy', 'relaxed'],
      'confused': ['certain', 'confident', 'knowing', 'clear'],
      'flirty': ['disgusted', 'angry', 'cold', 'distant'],
      'fierce': ['gentle', 'soft', 'meek', 'scared'],
      'rage': ['calm', 'peaceful', 'happy', 'gentle'],
      'terror': ['brave', 'confident', 'calm', 'relaxed'],
      'grief': ['happy', 'joyful', 'cheerful', 'laughing'],
      'pain': ['comfortable', 'relaxed', 'peaceful', 'happy'],
      'hollow': ['emotional', 'expressive', 'engaged', 'present'],
      'silly': ['serious', 'dignified', 'formal', 'stern'],
      'nauseous': ['hungry', 'healthy', 'comfortable', 'well'],
      'drunk': ['sober', 'alert', 'focused', 'sharp'],
      'sarcastic': ['sincere', 'genuine', 'earnest', 'naive'],
      'pouty': ['cheerful', 'mature', 'accepting', 'happy']
    };
    
    return opposites[expression]?.join(', ') || 'wrong expression';
  }

  // ==========================================
  // CHARACTER BODY VOCABULARY GENERATION
  // ==========================================

  /**
   * Generate a character's body vocabulary - their unique way of moving and expressing
   */
  async generateBodyVocabulary(
    request: CharacterReferenceSheetRequest
  ): Promise<AgentResponse<CharacterBodyVocabulary>> {
    console.log(`[CharacterReferenceSheetAgent] Generating body vocabulary for: ${request.name}`);

    const prompt = this.buildBodyVocabularyPrompt(request);
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callLLM([{ role: 'user', content: prompt }]);
        let rawParsed: Record<string, unknown>;
        
        try {
          rawParsed = this.parseJSON<Record<string, unknown>>(response);
        } catch (parseError) {
          console.warn(`[CharacterReferenceSheetAgent] Body vocabulary JSON parse failed on attempt ${attempt + 1}:`, parseError);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: `Failed to parse body vocabulary JSON after ${maxRetries + 1} attempts`,
            rawResponse: response 
          };
        }
        
        // Validate parsed response
        if (!rawParsed || typeof rawParsed !== 'object') {
          console.warn(`[CharacterReferenceSheetAgent] Invalid body vocabulary response on attempt ${attempt + 1}`);
          if (attempt < maxRetries) continue;
          return { 
            success: false, 
            error: 'Invalid response from LLM: not a valid object.',
            rawResponse: response 
          };
        }
        
        // Normalize the response (handle snake_case vs camelCase)
        const vocabulary = this.normalizeBodyVocabulary(rawParsed, request);

        console.log(`[CharacterReferenceSheetAgent] Successfully generated body vocabulary for ${request.name}`);
        return { success: true, data: vocabulary, rawResponse: response };
        
      } catch (error) {
        console.error(`[CharacterReferenceSheetAgent] Body vocabulary error on attempt ${attempt + 1}:`, error);
        if (attempt < maxRetries) continue;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    return { success: false, error: 'Failed to generate body vocabulary after all retries' };
  }

  /**
   * Normalize body vocabulary response (handle snake_case vs camelCase)
   */
  private normalizeBodyVocabulary(raw: Record<string, unknown>, request: CharacterReferenceSheetRequest): CharacterBodyVocabulary {
    const get = <T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
      for (const key of keys) {
        if (obj[key] !== undefined) return obj[key] as T;
      }
      return undefined;
    };

    // Normalize status expressions
    const rawStatus = get<Record<string, unknown>>(raw, 'statusExpressions', 'status_expressions', 'status');
    const statusExpressions = rawStatus ? {
      high: get<string>(rawStatus, 'high', 'high_status') || '',
      low: get<string>(rawStatus, 'low', 'low_status') || ''
    } : { high: '', low: '' };

    // Normalize approach/avoidance
    const rawApproach = get<Record<string, unknown>>(raw, 'approachAvoidance', 'approach_avoidance');
    const approachAvoidance = rawApproach ? {
      approach: get<string>(rawApproach, 'approach') || '',
      avoidance: get<string>(rawApproach, 'avoidance', 'avoid') || ''
    } : { approach: '', avoidance: '' };

    return {
      characterId: request.characterId,
      characterName: request.name,
      basePosture: get<string>(raw, 'basePosture', 'base_posture', 'posture') || 'neutral',
      gestureStyle: get<string>(raw, 'gestureStyle', 'gesture_style', 'gestures') || 'subtle',
      commonGestures: get<string[]>(raw, 'commonGestures', 'common_gestures') || [],
      statusExpressions,
      approachAvoidance,
      idleStance: get<string>(raw, 'idleStance', 'idle_stance', 'idle') || '',
      notes: get<string>(raw, 'notes', 'additional_notes') || ''
    };
  }

  private buildBodyVocabularyPrompt(request: CharacterReferenceSheetRequest): string {
    return `
Create a CHARACTER BODY VOCABULARY for use in visual storytelling. This defines how this character uniquely moves, stands, and expresses themselves through body language.

${BODY_LANGUAGE_PRINCIPLES}

${STATUS_BODY_LANGUAGE}

${APPROACH_AVOIDANCE_LANGUAGE}

## Character Information
- **Name**: ${request.name}
${this.genderPromptLine(request.pronouns)}
- **ID**: ${request.characterId}
- **Role**: ${request.role}
- **Description**: ${request.description}
- **Personality**: ${request.personality || 'Not specified'}
- **Background/Training**: ${request.backgroundTraits || 'Not specified'}
- **Build**: ${request.physicalTraits.build || 'Average'}

## Instructions

Based on this character's personality, role, and background, define their unique body vocabulary.

Consider:
- How does their background affect posture? (military = rigid, street = loose, academic = hunched)
- What's their default confidence level?
- How do they use space? (take up room vs minimize presence)
- What are their nervous habits? Their comfort tells?
- How do they gesture when talking?
- What objects might they interact with?

## Return Format

Return a JSON CharacterBodyVocabulary object:
{
  "characterId": "${request.characterId}",
  "characterName": "${request.name}",
  "basePosture": {
    "spine": "upright | slightly_hunched | rigid | relaxed_slouch | military_straight",
    "shoulders": "open_confident | slightly_forward | hunched_protective | squared_tense",
    "chestDefault": "open | neutral | slightly_closed",
    "stanceWidth": "wide | normal | narrow",
    "description": "Brief description of their default standing posture"
  },
  "gestureStyle": {
    "size": "expansive_big | moderate | small_precise | minimal",
    "frequency": "constant | frequent | occasional | rare",
    "type": "sweeping | pointing | illustrative | contained | self_contact",
    "description": "Brief description of their gesture style"
  },
  "signaturePoses": [
    {
      "situation": "e.g., confident, thinking, angry, nervous",
      "poseDescription": "Full description of the pose",
      "keyElements": ["spine position", "arm position", "head angle", etc.]
    }
  ],
  "statusDefaults": {
    "withSuperiors": "respectful | challenging | submissive | defiant",
    "withEquals": "collaborative | competitive | distant | warm",
    "withSubordinates": "supportive | commanding | dismissive | nurturing"
  },
  "stressTells": ["list of nervous/stress behaviors"],
  "comfortTells": ["list of relaxed/comfortable behaviors"],
  "objectInteraction": {
    "typicalObjects": ["objects they might hold"],
    "holdingStyle": "How they interact with objects"
  }
}

Create AT LEAST 4 signature poses covering: confident, uncertain/nervous, angry/intense, and contemplative/sad states.
`;
  }

  /**
   * Generate acting direction for a character in a specific beat
   */
  async generateActingDirection(
    character: CharacterReferenceSheetRequest,
    bodyVocabulary: CharacterBodyVocabulary,
    beatContext: {
      intent: string;
      primaryEmotion: string;
      secondaryEmotion?: string;
      relationshipContext: string;
      statusInScene: 'dominant' | 'equal' | 'submissive';
    }
  ): Promise<AgentResponse<{
    bodyLanguageDescription: string;
    silhouetteGoal: string;
    promptFragment: string;
  }>> {
    const prompt = `
Generate ACTING DIRECTION for a character in a specific story beat.

## Character Body Vocabulary
${JSON.stringify(bodyVocabulary, null, 2)}

## Beat Context
- **Intent**: ${beatContext.intent}
- **Primary Emotion**: ${beatContext.primaryEmotion}
- **Secondary Emotion**: ${beatContext.secondaryEmotion || 'none'}
- **Relationship Context**: ${beatContext.relationshipContext}
- **Status in Scene**: ${beatContext.statusInScene}

## Instructions
Combine the character's established body vocabulary with this beat's emotional requirements.
- Stay true to their signature way of moving
- Adapt their base posture to the emotional state
- Use their characteristic stress or comfort tells as appropriate
- Create a clear silhouette goal

Return JSON:
{
  "bodyLanguageDescription": "Full description of how they should be posed, including spine, shoulders, arms, hands, head, weight distribution",
  "silhouetteGoal": "What the silhouette should read as emotionally",
  "promptFragment": "A prompt fragment to append to image generation: 'character with [detailed pose description]'"
}
`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const direction = this.parseJSON<{
        bodyLanguageDescription: string;
        silhouetteGoal: string;
        promptFragment: string;
      }>(response);
      
      return { success: true, data: direction, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
