import type { StructuredJsonSchema } from '../agents/BaseAgent';

/** Minimal SeasonPlanner MutablePlanData schema for provider structured output (R1.7). */
export function buildSeasonPlanJsonSchema(input?: { compact?: boolean }): StructuredJsonSchema {
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
        arcs: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        episodeEncounters: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        crossEpisodeBranches: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        episodeEndingRoutes: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
      },
    },
  };
}
