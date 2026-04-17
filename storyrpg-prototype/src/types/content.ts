// ========================================
// CONTENT TYPES (Beat, TextVariant, Video)
// ========================================

import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';
import type { Choice } from './choice';

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
}

// A beat is a unit of content within a scene
export interface Beat {
  id: string;

  text: string;

  textVariants?: TextVariant[];

  conditions?: ConditionExpression;

  speaker?: string;
  speakerMood?: string;

  image?: string;
  panelImages?: string[];
  audio?: string;
  video?: string;

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
}
