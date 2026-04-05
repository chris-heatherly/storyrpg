/**
 * Validation Constants
 * Thresholds for quality validation
 */

export const PHASE_VALIDATION_DEFAULTS = {
  blockingThreshold: 40,
  warningThreshold: 60,
};

export const CHOICE_DENSITY_DEFAULTS = {
  /** Cap: first choice must appear by this time. Engine has latitude below this. */
  firstChoiceMaxSeconds: 90,
  /** Cap: average gap between choices must not exceed this. Engine has latitude below this. */
  averageGapMaxSeconds: 120,
  minChoiceDensity: 0.4,
  minChoicePercentage: 50, // Minimum % of scenes with choices
};

/** Pose diversity score above which we skip regeneration (story-strong images) */
export const DIVERSITY_STORY_STRONG_THRESHOLD = 65;

/** Image validation: relaxed caps at narrative peaks (mirrors story climax/key beat approach) */
export const IMAGE_VALIDATION_DEFAULTS = {
  maxExtremeExpressionsStandard: 2,
  maxExtremeExpressionsAtPeak: 4,
  maxECUPerSceneStandard: 1,
  maxECUPerSceneAtPeak: 2,
  softenPoseDiversityAtClimax: true,
};

export const PIXAR_VALIDATION_DEFAULTS = {
  scoreThresholds: {
    excellent: 90,
    good: 75,
    acceptable: 60,
    poor: 40,
  },
};

export const NPC_DEPTH_DEFAULTS = {
  minMajorDimensions: 2,
  maxMinorDimensions: 4,
};

export const STAKES_VALIDATION_DEFAULTS = {
  minStakesScore: 60,
  lowScoreThreshold: 40,
  highScoreThreshold: 80,
};

export const QA_DEFAULTS = {
  defaultThreshold: 70,
  minPassScore: 60,
};

// Incremental validation defaults (per-scene validation during content generation)
export const INCREMENTAL_VALIDATION_DEFAULTS = {
  voiceValidation: true,
  stakesValidation: true,
  sensitivityCheck: true,
  continuityCheck: true,
  encounterValidation: true,
  voiceRegenerationThreshold: 50,
  stakesRegenerationThreshold: 60,
  maxRegenerationAttempts: 2,
  targetRating: 'T' as const,
};

// Best-of-N generation for critical scenes
export const BEST_OF_N_DEFAULTS = {
  candidates: 2,
  enabledForBottleneck: true,
  enabledForOpening: true,
  enabledForClimax: true,
};

// Reading speed for timing calculations
export const READING_SPEED = {
  wordsPerMinute: 200,
  wordsPerSecond: 200 / 60, // ~3.33
};

// Text length limits (all are caps—engine may stay under)
export const TEXT_LIMITS = {
  maxChoiceTextLength: 150,
  /** Cap for standard beats. Use sparingly; engine may use fewer words. */
  maxBeatWordCount: 70,
  /** Cap for climax beats only—true narrative peaks. Use max 1-2 per scene. */
  maxClimaxBeatWordCount: 120,
  /** Cap for key story beats (narrative turning points). Max 2 per scene. */
  maxKeyStoryBeatWordCount: 100,
  /** Maximum key story beats allowed per scene (cap on isKeyStoryBeat usage) */
  maxKeyStoryBeatsPerScene: 2,
  errorPreviewLength: 500,
  blueprintPreviewLength: 1000,
  descriptionPreviewLength: 50,
  shortPreviewLength: 30,
  mediumPreviewLength: 200,
};
