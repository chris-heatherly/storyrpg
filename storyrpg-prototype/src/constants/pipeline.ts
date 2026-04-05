/**
 * Pipeline Constants
 * Scene and generation defaults
 */

export const SCENE_DEFAULTS = {
  /** Maximum scenes per episode (cap)—engine may generate fewer if story doesn't need more */
  maxScenesPerEpisode: 6,
  /** @deprecated Use maxScenesPerEpisode */
  targetSceneCount: 6,
  majorChoiceCount: 3,
  minBeatsPerScene: 3,
  /** Cap on beats per scene—engine may generate fewer */
  maxBeatsPerScene: 12,
  /** Cap for standard scenes—engine may use fewer beats */
  standardBeatCount: 8,
  /** Cap for bottleneck scenes—engine may use fewer beats */
  bottleneckBeatCount: 10,
  encounterBeatCount: 3,
};

export const CONCURRENCY_DEFAULTS = {
  maxConcurrentScenes: 3,
  maxConcurrentBeats: 5,
  imageGenerationLimit: 10,
  maxParallelEpisodes: 2,
  maxParallelScenes: 2,
  maxGlobalLlmInFlight: 4,
  maxPerProviderLlmInFlight: 2,
  llmBackoffJitterRatio: 0.15,
};

// Timing constants for rate limiting and delays
export const TIMING_DEFAULTS = {
  rateLimitDelayMs: 1000,
  imagePollingIntervalMs: 2000,
  retryDelayMs: 5000,
  minRequestIntervalMs: 3000,
  voiceCacheTtlMs: 5 * 60 * 1000, // 5 minutes
};

// Retry configuration
export const RETRY_DEFAULTS = {
  maxRetries: 3,
  storyArchitectRetries: 2,
  sceneWriterRetries: 1,
  imageGenerationRetries: 5,
};

// Default attribute values for new characters
export const CHARACTER_DEFAULTS = {
  initialAttributeValue: 50,
  attributes: {
    charm: 50,
    wit: 50,
    courage: 50,
    empathy: 50,
    resolve: 50,
    resourcefulness: 50,
  },
};

// Default skills available for encounters and player state
export const DEFAULT_SKILLS = [
  { name: 'athletics', attribute: 'body', description: 'Physical prowess and endurance' },
  { name: 'stealth', attribute: 'body', description: 'Moving undetected' },
  { name: 'perception', attribute: 'mind', description: 'Noticing details and danger' },
  { name: 'persuasion', attribute: 'social', description: 'Convincing others' },
  { name: 'intimidation', attribute: 'social', description: 'Coercing through fear' },
  { name: 'deception', attribute: 'social', description: 'Misleading others' },
  { name: 'investigation', attribute: 'mind', description: 'Finding clues and solving puzzles' },
  { name: 'survival', attribute: 'body', description: 'Enduring harsh conditions' },
] as const;

// Progress calculation constants
export const PROGRESS_CALCULATION = {
  analysisPhasePercent: 10,
  generationPhasePercent: 80,
  finalizationPhasePercent: 10,
};
