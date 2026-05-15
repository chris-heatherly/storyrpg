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

export interface VisualContinuityHint {
  shotType?: string;
  cameraAngle?: string;
  focalCharacterId?: string;
  blocking?: string;
  proximity?: string;
  motifOrProp?: string;
  previousBeatId?: string;
  transitionIntent?: string;
  panelMode?: 'single' | 'special-beats' | 'all-beats';
}

export type VisualStagingPattern =
  | 'single'
  | 'two-shot'
  | 'ots-speaker'
  | 'ots-listener'
  | 'triangle'
  | 'ensemble'
  | 'environment'
  | 'insert'
  | 'solo-reaction'
  | 'environmental-aftermath';

export interface VisualCast {
  sceneCharacterIds: string[];
  activeCharacterIds: string[];
  foregroundCharacterIds: string[];
  backgroundCharacterIds: string[];
  offscreenCharacterIds: string[];
  speakerCharacterId?: string;
  addressedCharacterIds: string[];
  listenerCharacterIds: string[];
  observerCharacterIds: string[];
  payoffRelevantCharacterIds: string[];
  castReason: string;
}

export interface BeatCoveragePlan {
  stagingPattern: VisualStagingPattern;
  shotDistance: 'ELS' | 'LS' | 'MLS' | 'MS' | 'MCU' | 'CU' | 'ECU';
  cameraAngle: string;
  cameraSide: string;
  focalCharacterIds: string[];
  requiredVisibleCharacterIds: string[];
  optionalVisibleCharacterIds: string[];
  offscreenCharacterIds: string[];
  relationshipBlocking: string;
  coverageReason: string;
  visualContinuity?: BeatVisualContinuity;
}

export type BeatVisualContinuityMode =
  | 'fresh_composition'
  | 'preserve_scene_axis'
  | 'locked_micro_progression';

export type BeatVisualContinuityElement =
  | 'camera'
  | 'blocking'
  | 'lighting'
  | 'environment'
  | 'character_position';

export interface BeatVisualContinuity {
  /**
   * Default: fresh_composition. The image pipeline should vary camera,
   * blocking, focal point, and body arrangement unless a beat explicitly
   * requests a locked micro-progression.
   */
  mode: BeatVisualContinuityMode;
  reason?: string;
  preserve?: BeatVisualContinuityElement[];
  /**
   * Required for locked_micro_progression. Describes the one visible change
   * allowed while camera/blocking are preserved.
   */
  changeOnly?: string;
}

export interface BeatDramaticIntent {
  /** What each visible character wants in this beat, keyed by character id/name when known. */
  characterObjectives?: Record<string, string>;
  /** What blocks the objective from being easy in this exact moment. */
  obstacle?: string;
  /** Who has leverage/control before the visible turn. */
  statusBefore?: string;
  /** Who has leverage/control after the visible turn. */
  statusAfter?: string;
  /** The real emotional or tactical meaning beneath the surface action/topic. */
  subtext?: string;
  /** The concrete change a viewer can understand without captions. */
  visibleTurn?: string;
  /** The prop, gesture, distance, posture, reaction, or environmental clue that reveals subtext. */
  visualSubtextCue?: string;
}

export interface NarrativeSequenceIntent {
  /** What this multi-beat sequence is trying to accomplish in story terms. */
  objective?: string;
  /** The concrete visible activity that carries the sequence. */
  activity?: string;
  /** What resists, blocks, or complicates the objective. */
  obstacle?: string;
  /** Visible/emotional/mechanical state at the start of the sequence. */
  startState?: string;
  /** The moment the sequence bends or changes direction. */
  turningPoint?: string;
  /** What has changed by the end of the sequence. */
  endState?: string;
  /** Recurring prop, distance, blocking, wound, clue, gesture, or motif tying panels together. */
  visualThread?: string;
  /** Optional fiction-first hook: trust, leverage, clue, danger, resource, reputation, identity, callback, encounter clock, etc. */
  mechanicThread?: string;
  /** Optional grouping id when a scene has multiple visual sequences. */
  sequenceId?: string;
  /** Beat's role inside the visual sequence when attached at beat level. */
  beatRole?: 'setup' | 'pressure' | 'escalation' | 'turn' | 'consequence' | 'handoff' | 'aftermath';
}

// A beat is a unit of content within a scene
export interface Beat {
  id: string;

  text: string;

  textVariants?: TextVariant[];
  callbackHookIds?: string[];

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
  visualContinuity?: VisualContinuityHint;
  visualCast?: VisualCast;
  coveragePlan?: BeatCoveragePlan;
  dramaticIntent?: BeatDramaticIntent;
  sequenceIntent?: NarrativeSequenceIntent;

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
