import type { StructuredJsonSchema } from '../agents/BaseAgent';

/** Minimal SeasonPlanner MutablePlanData schema for provider structured output (R1.7). */
export function buildSeasonPlanJsonSchema(input?: { compact?: boolean }): StructuredJsonSchema {
  return {
    name: input?.compact ? 'season_plan_compact' : 'season_plan_mutable',
    description: 'Season planning fields: arcs, episode encounters, cross-episode branches, ending routes.',
    maxOutputTokens: input?.compact ? 8192 : 16384,
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
