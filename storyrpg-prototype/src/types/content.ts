// ========================================
// CONTENT TYPES (Beat, TextVariant, Video)
// ========================================

import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';
import type { Choice } from './choice';
import type { AssetRef } from '../assets/assetRef';

/**
 * A pointer to an image / audio / video asset used by the runtime.
 *
 * The legacy shape — a raw `string` that could be a relative path,
 * an absolute URL, or a `data:` URL — is still accepted on input
 * because a lot of generated content and test fixtures rely on it.
 * New pipeline output emits `AssetRef` and the resolver in
 * `src/assets/assetResolver.ts` converts either form into a runtime
 * URL at display time.
 */
export type MediaRef = string | AssetRef;

// ========================================
// VIDEO ANIMATION TYPES
// ========================================

export interface VideoAnimationInstruction {
  beatId: string;
  sceneId: string;
  motionDescription: string;
  cameraMotion: string;
  characterAnimation: string;
  environmentAnimation: string;
  pacing: 'slow' | 'medium' | 'fast';
  audioHint?: string;
  composedPrompt: string;
}

// Conditional text variation
export interface TextVariant {
  condition: ConditionExpression;
  text: string;
  sourceChoiceId?: string;
  reminderTag?: string;

  // ID of a CallbackHook in the CallbackLedger that this variant references.
  // When the variant is rendered at runtime, it represents a "payoff" of the
  // hook; generation-side bookkeeping uses this to mark hooks as acknowledged.
  callbackHookId?: string;
}

// A beat is a unit of content within a scene
export interface Beat {
  id: string;

  text: string;

  textVariants?: TextVariant[];

  conditions?: ConditionExpression;

  speaker?: string;
  speakerMood?: string;

  image?: MediaRef;
  panelImages?: MediaRef[];
  audio?: MediaRef;
  video?: MediaRef;

  choices?: Choice[];

  nextBeatId?: string;

  nextSceneId?: string;

  onShow?: Consequence[];

  outcomeSequences?: {
    success?: string[];
    complicated?: string[];
    failure?: string[];
  };

  encounterSequence?: {
    encounterId: string;
    position: 'setup' | 'action' | 'resolution';
    beatIndex: number;
  };

  isClimaxBeat?: boolean;

  isKeyStoryBeat?: boolean;

  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;
  intensityTier?: 'dominant' | 'supporting' | 'rest';

  allowDiegeticText?: boolean;

  // Narrative thread wiring (Phase 5.3) — set by SceneWriter when this beat
  // plants a seed/clue/promise/reveal or pays one off.
  plantsThreadId?: string;
  paysOffThreadId?: string;

  // Twist / structural plot-point marker (Phase 6.2). Consumed by the
  // TwistQualityValidator to verify foreshadow → reveal scheduling.
  plotPointType?: 'setup' | 'payoff' | 'twist' | 'revelation';
  twistKind?: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
}
