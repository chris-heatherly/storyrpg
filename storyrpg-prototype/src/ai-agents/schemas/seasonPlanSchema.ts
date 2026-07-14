import type { StructuredJsonSchema } from '../agents/BaseAgent';

interface SeasonPlanSchemaInput {
  compact?: boolean;
  expectedArcCount?: number;
  expectedEpisodeCount?: number;
}

const episodeRangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['start', 'end'],
  properties: {
    start: { type: 'integer', minimum: 1 },
    end: { type: 'integer', minimum: 1 },
  },
};

const arcEnrichmentSchema = {
  type: 'object',
  additionalProperties: true,
  required: [
    'id',
    'name',
    'description',
    'episodeRange',
    'arcQuestion',
    'seasonQuestionRelation',
    'identityPressureFacet',
    'midpointRecontextualization',
    'lateArcCrisis',
    'finaleAnswer',
    'handoffPressure',
    'episodeTurnouts',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    episodeRange: episodeRangeSchema,
    arcQuestion: { type: 'string', minLength: 1 },
    seasonQuestionRelation: { type: 'string', minLength: 1 },
    identityPressureFacet: { type: 'string', minLength: 1 },
    midpointRecontextualization: {
      type: 'object',
      additionalProperties: false,
      required: ['episodeNumber', 'questionBefore', 'questionAfter', 'description'],
      properties: {
        episodeNumber: { type: 'integer', minimum: 1 },
        questionBefore: { type: 'string', minLength: 1 },
        questionAfter: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
      },
    },
    lateArcCrisis: {
      type: 'object',
      additionalProperties: false,
      required: ['episodeNumber', 'apparentFailure', 'irreversibleCost', 'description'],
      properties: {
        episodeNumber: { type: 'integer', minimum: 1 },
        apparentFailure: { type: 'string', minLength: 1 },
        irreversibleCost: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
      },
    },
    finaleAnswer: { type: 'string', minLength: 1 },
    handoffPressure: { type: 'string' },
    episodeTurnouts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: true,
        required: [
          'episodeNumber',
          'turnType',
          'description',
          'leavesProtagonistWith',
          'whyThisCannotMoveLater',
        ],
        properties: {
          episodeNumber: { type: 'integer', minimum: 1 },
          turnType: {
            type: 'string',
            enum: ['setup', 'escalation', 'reversal', 'revelation', 'cost', 'choice', 'recontextualization', 'crisis', 'finale', 'handoff'],
          },
          description: { type: 'string', minLength: 1 },
          leavesProtagonistWith: { type: 'string', minLength: 1 },
          whyThisCannotMoveLater: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const encounterSchema = {
  type: 'object',
  additionalProperties: true,
  required: [
    'id',
    'type',
    'description',
    'difficulty',
    'npcsInvolved',
    'stakes',
    'storyCircleTarget',
    'storyCircleTargetRationale',
    'encounterBuildup',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    difficulty: { type: 'string', enum: ['easy', 'moderate', 'hard', 'extreme'] },
    npcsInvolved: { type: 'array', items: { type: 'string' } },
    stakes: { type: 'string', minLength: 1 },
    storyCircleTarget: { type: 'string', enum: ['go', 'search', 'find', 'take'] },
    storyCircleTargetRationale: { type: 'string', minLength: 1 },
    encounterBuildup: { type: 'string', minLength: 1 },
  },
};

const episodeEncounterPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['episodeNumber', 'encounters'],
  properties: {
    episodeNumber: { type: 'integer', minimum: 1 },
    encounters: { type: 'array', minItems: 1, items: encounterSchema },
  },
};

const episodeEndingRoutePlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['episodeNumber', 'routes'],
  properties: {
    episodeNumber: { type: 'integer', minimum: 1 },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['endingId', 'role', 'description'],
        properties: {
          endingId: { type: 'string', minLength: 1 },
          role: { type: 'string', enum: ['opens', 'reinforces', 'threatens', 'locks'] },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

function boundedArray(items: Record<string, unknown>, expectedCount?: number): Record<string, unknown> {
  return {
    type: 'array',
    items,
    ...(Number.isFinite(expectedCount) && (expectedCount ?? 0) > 0
      ? { minItems: expectedCount, maxItems: expectedCount }
      : {}),
  };
}

/** Provider draft schema. Episode-indexed collections use arrays with explicit IDs. */
export function buildSeasonPlanJsonSchema(input?: SeasonPlanSchemaInput): StructuredJsonSchema {
  return {
    name: input?.compact ? 'season_plan_compact' : 'season_plan_mutable',
    description: 'Season planning fields: arcs, episode encounters, cross-episode branches, ending routes.',
    maxOutputTokens: 32768,
    outputBudget: input?.compact
      ? {
          visibleTokens: 14000,
          reasoningProfile: 'minimal',
          safetyTokens: 512,
          totalCeiling: 32768,
        }
      : {
          visibleTokens: 22000,
          reasoningProfile: 'standard',
          safetyTokens: 512,
          totalCeiling: 32768,
        },
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['arcs', 'episodeEncounters', 'crossEpisodeBranches', 'episodeEndingRoutes'],
      properties: {
        arcs: boundedArray(arcEnrichmentSchema, input?.expectedArcCount),
        episodeEncounters: boundedArray(episodeEncounterPlanSchema, input?.expectedEpisodeCount),
        crossEpisodeBranches: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        episodeEndingRoutes: boundedArray(episodeEndingRoutePlanSchema, input?.expectedEpisodeCount),
      },
    },
  };
}

export function buildSeasonArcEnrichmentJsonSchema(expectedArcCount = 1): StructuredJsonSchema {
  return {
    name: 'season_arc_enrichment_repair',
    description: 'Keyed enrichments for canonical authored season arcs.',
    maxOutputTokens: 16384,
    outputBudget: {
      visibleTokens: 12000,
      reasoningProfile: 'minimal',
      safetyTokens: 512,
      totalCeiling: 16384,
    },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['arcs'],
      properties: {
        arcs: boundedArray(arcEnrichmentSchema, expectedArcCount),
      },
    },
  };
}

export function buildSeasonEpisodeUnitRepairJsonSchema(
  expectedEncounterPlanCount = 1,
  expectedEndingRoutePlanCount = 0,
): StructuredJsonSchema {
  return {
    name: 'season_episode_unit_repair',
    description: 'Missing per-episode encounter and ending-route planning units.',
    maxOutputTokens: 16384,
    outputBudget: {
      visibleTokens: 12000,
      reasoningProfile: 'minimal',
      safetyTokens: 512,
      totalCeiling: 16384,
    },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['episodeEncounters', 'episodeEndingRoutes'],
      properties: {
        episodeEncounters: boundedArray(episodeEncounterPlanSchema, expectedEncounterPlanCount),
        episodeEndingRoutes: boundedArray(episodeEndingRoutePlanSchema, expectedEndingRoutePlanCount),
      },
    },
  };
}
