import type { ImageType, ReferenceImage } from '../services/imageGenerationService';

export type ImageSlotFamily =
  | 'story-scene'
  | 'story-beat'
  | 'story-beat-panel'
  | 'encounter-setup'
  | 'encounter-outcome'
  | 'encounter-situation'
  | 'storylet-aftermath'
  | 'cover'
  | 'master'
  | 'expression';

export type ImageSlotStatus =
  | 'planned'
  | 'rendering'
  | 'succeeded'
  | 'failed_transient'
  | 'failed_permanent'
  | 'aborted';

export type ImageRetryStage =
  | 'primary'
  | 'retry'
  | 'aggressive_retry'
  | 'fallback_provider'
  | 'resume';

export interface ImageSlot {
  slotId: string;
  family: ImageSlotFamily;
  imageType: ImageType;
  sceneId?: string;
  scopedSceneId?: string;
  beatId?: string;
  episodeId?: string;
  phaseId?: string;
  outcomeName?: string;
  outcomeTier?: 'success' | 'complicated' | 'failure';
  choiceMapKey?: string;
  situationKey?: string;
  storyFieldPath: string;
  baseIdentifier: string;
  required: boolean;
  qualityTier: 'critical' | 'standard' | 'supplemental';
  coverageKey: string;
  continuitySourceSlotId?: string;
  metadata?: Record<string, unknown>;
}

export interface SlotReferencePack {
  slotId: string;
  totalCount: number;
  references: ReferenceImage[];
  summary: Array<{
    role: string;
    characterName?: string;
    viewType?: string;
  }>;
}

export interface RenderAttemptRecord {
  attemptNumber: number;
  startedAt: string;
  completedAt?: string;
  provider?: string;
  model?: string;
  retryStage?: ImageRetryStage;
  status: 'started' | 'succeeded' | 'failed';
  errorClass?: 'transient' | 'permanent' | 'text_instead_of_image';
  errorMessage?: string;
  providerFailureKind?: string;
  effectivePromptChars?: number;
  effectiveNegativeChars?: number;
  effectiveRefCount?: number;
  referenceRoles?: string[];
  imageUrl?: string;
  imagePath?: string;
}

export interface AssetRecord {
  slot: ImageSlot;
  status: ImageSlotStatus;
  latestUrl?: string;
  latestPath?: string;
  provider?: string;
  model?: string;
  failureReason?: string;
  providerFailureKind?: string;
  promptId?: string;
  promptSummary?: {
    promptChars: number;
    negativeChars: number;
    hasStyle: boolean;
    hasComposition: boolean;
  };
  referencePack?: SlotReferencePack;
  attempts: RenderAttemptRecord[];
  updatedAt: string;
}

export interface AssetRegistrySnapshot {
  version: 1;
  storyId?: string;
  generatedAt: string;
  records: AssetRecord[];
}
