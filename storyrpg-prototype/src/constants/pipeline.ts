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

// Timing constants for rate limiting and delays.
// A2: `rateLimitDelayMs` is intentionally 0. Previously every post-success
// beat image paused this many ms "just in case", but the per-provider
// throttle (`services/providerThrottle.ts`) already enforces the right gap
// BEFORE each request. Paying the delay after a successful call just added
// latency without improving success rate. Kept as an exported constant so
// the ten FullStoryPipeline.ts call sites don't need to be rewritten — they
// just sleep(0) and fall through.
export const TIMING_DEFAULTS = {
  rateLimitDelayMs: 0,
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

// Skill definitions: each skill is a weighted blend of core attributes.
// attributeWeights must sum to 1.0 for each skill.
import type { SkillDefinition, PlayerAttributes } from '../types';

export const SKILL_DEFINITIONS: Record<string, SkillDefinition> = {
  athletics:     { name: 'athletics',     description: 'Physical prowess and endurance',
                   attributeWeights: { courage: 0.5, resolve: 0.3, resourcefulness: 0.2 } },
  stealth:       { name: 'stealth',       description: 'Moving undetected',
                   attributeWeights: { wit: 0.4, resourcefulness: 0.4, courage: 0.2 } },
  perception:    { name: 'perception',    description: 'Noticing details and danger',
                   attributeWeights: { wit: 0.5, empathy: 0.3, resolve: 0.2 } },
  persuasion:    { name: 'persuasion',    description: 'Convincing others',
                   attributeWeights: { charm: 0.5, empathy: 0.3, wit: 0.2 } },
  intimidation:  { name: 'intimidation',  description: 'Coercing through fear',
                   attributeWeights: { courage: 0.5, resolve: 0.3, charm: 0.2 } },
  deception:     { name: 'deception',     description: 'Misleading others',
                   attributeWeights: { charm: 0.4, wit: 0.4, resourcefulness: 0.2 } },
  investigation: { name: 'investigation', description: 'Finding clues and solving puzzles',
                   attributeWeights: { wit: 0.5, resolve: 0.3, empathy: 0.2 } },
  survival:      { name: 'survival',      description: 'Enduring harsh conditions',
                   attributeWeights: { resourcefulness: 0.5, resolve: 0.3, courage: 0.2 } },
};

function dominantAttribute(def: SkillDefinition): string {
  let best = '';
  let bestWeight = 0;
  for (const [attr, w] of Object.entries(def.attributeWeights)) {
    if ((w ?? 0) > bestWeight) { bestWeight = w ?? 0; best = attr; }
  }
  return best;
}

export const ATTRIBUTE_TO_SKILL: Record<keyof PlayerAttributes, string> = {
  charm: 'persuasion',
  wit: 'perception',
  courage: 'athletics',
  empathy: 'perception',
  resolve: 'survival',
  resourcefulness: 'stealth',
};

// Backward-compat shim for EncounterArchitect and other consumers
export const DEFAULT_SKILLS = Object.values(SKILL_DEFINITIONS).map(s => ({
  name: s.name,
  attribute: dominantAttribute(s),
  description: s.description,
}));

// Progress calculation constants
export const PROGRESS_CALCULATION = {
  analysisPhasePercent: 10,
  generationPhasePercent: 80,
  finalizationPhasePercent: 10,
};
