import type { SceneSettingContext } from '../utils/styleAdaptation';

/** Reference image purposes recognized by the Stable Diffusion adapter. */
export type SDReferencePurpose =
  | 'ip-adapter'
  | 'controlnet-depth'
  | 'controlnet-canny'
  | 'reference-only'
  | 'img2img-init'
  | 'inpaint-mask';

/** A single LoRA applied to an SD prompt. */
export interface ImagePromptLora {
  name: string;
  weight: number;
}

/** A ControlNet unit configured on an SD prompt. */
export interface ImagePromptControlNet {
  module: string;
  model: string;
  /** Reference role/purpose used to find the source image in the ref pack. */
  imageRole: string;
  weight?: number;
  controlMode?: string;
}

/** IP-Adapter configuration for character identity anchoring. */
export interface ImagePromptIpAdapter {
  model: string;
  imageRole: string;
  weight?: number;
}

export interface SceneImageRequest {
  sceneId: string;
  sceneName: string;
  description: string;
  location?: {
    id: string;
    name: string;
    description: string;
  };
  mood: string;
  genre: string;
  tone: string;
}

export interface BeatImageRequest {
  beatId: string;
  beatText: string;
  sceneContext: {
    name: string;
    location?: string;
    mood: string;
  };
  characters?: Array<{
    name: string;
    description: string;
  }>;
  genre: string;
  tone: string;
}

export interface CoverImageRequest {
  title: string;
  synopsis: string;
  genre: string;
  tone: string;
  keyElements?: string[];
}

export interface EncounterSequenceRequest {
  encounterId: string;
  beatId: string;
  outcome: 'situation' | 'full_success' | 'complicated_success' | 'interesting_failure';
  sceneContext: {
    name: string;
    description: string;
    location?: string;
    mood: string;
  };
  shotDescription: string;
  characters: Array<{
    name: string;
    description: string;
    role: string;
  }>;
  genre: string;
  tone: string;
}

export interface CharacterMasterRequest {
  characterId: string;
  name: string;
  description: string;
  role: string;
  genre: string;
  tone: string;
}

export interface LocationMasterRequest {
  locationId: string;
  name: string;
  description: string;
  type: string;
  genre: string;
  tone: string;
}

export interface ImagePrompt {
  id?: string;
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  composition?: string;
  cameraAngle?: string;
  referenceCharIds?: string[];
  referenceLocationId?: string;
  styleContract?: {
    source: 'user-visual' | 'approved-anchor' | 'raw-season-style' | 'default';
    text: string;
  };
  characterIdentity?: string[];
  appearanceState?: string;
  sceneAction?: string;
  compositionContract?: string;
  negativeContract?: string;
  promptContract?: {
    sanitizedTerms?: string[];
    deterministicRules?: string[];
    referencePrecedence?: string;
    stylePrecedence?: string;
    /** Which prompt-construction mode produced this prompt (deterministic | llm). */
    sourcePromptMode?: string;
  };
  keyExpression?: string;
  keyGesture?: string;
  keyBodyLanguage?: string;
  shotDescription?: string;
  emotionalCore?: string;
  visualNarrative?: string;
  visibleTurn?: string;
  visualSubtextCue?: string;
  statusShift?: string;
  settingAdaptationNotes?: string[];
  settingBranchLabel?: string;
  settingContext?: SceneSettingContext;
  isEncounterImage?: boolean;
  poseSpec?: string;
  beatType?: string;
  seed?: number;
  loras?: ImagePromptLora[];
  controlNet?: ImagePromptControlNet[];
  ipAdapter?: ImagePromptIpAdapter;
  denoisingStrength?: number;
  sampler?: string;
  steps?: number;
  cfgScale?: number;
  width?: number;
  height?: number;
}

export interface GeneratedImage {
  prompt: ImagePrompt;
  imagePath?: string;
  imageUrl?: string;
  imageData?: string;
  mimeType?: string;
  provider?: string;
  model?: string;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    provider?: string;
    model?: string;
    attempts?: number;
    providerAttemptCount?: number;
    effectivePromptChars?: number;
    effectiveNegativeChars?: number;
    effectiveRefCount?: number;
    providerFailureKind?: string;
    candidateCount?: number;
    hasCandidates?: boolean;
    finishReason?: string;
    blockReason?: string;
    responseExcerpt?: string;
    chatMode?: boolean;
    chatTurns?: number;
    editMode?: boolean;
    /** Set when an image artifact was rehydrated from disk on resume. */
    hydratedFromDisk?: boolean;
  };
}

export interface ImageGenerationResult {
  sceneImages: Map<string, GeneratedImage>;
  beatImages: Map<string, GeneratedImage>;
  episodeCover?: GeneratedImage;
  storyCover?: GeneratedImage;
  errors?: Array<{ target: string; error: string }>;
}
