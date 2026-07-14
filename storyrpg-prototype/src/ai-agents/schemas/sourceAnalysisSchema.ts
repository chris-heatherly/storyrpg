import type { StructuredJsonSchema } from '../agents/BaseAgent';

/** Focused schema for one episode outline in the source-analysis fan-out. */
export function buildSingleEpisodeBreakdownJsonSchema(): StructuredJsonSchema {
  return {
    name: 'source_analysis_single_episode',
    description: 'One source-analysis episode outline bound to an explicit episode slot.',
    maxOutputTokens: 8192,
    outputBudget: {
      visibleTokens: 2300,
      reasoningProfile: 'minimal',
      safetyTokens: 256,
      totalCeiling: 8192,
    },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'episodeNumber',
        'title',
        'synopsis',
        'sourceChapters',
        'plotPoints',
        'mainCharacters',
        'locations',
        'narrativeArc',
        'storyCircleRole',
      ],
      properties: {
        episodeNumber: { type: 'integer', minimum: 1 },
        title: { type: 'string', minLength: 1 },
        synopsis: { type: 'string', minLength: 1 },
        sourceChapters: { type: 'string' },
        plotPoints: { type: 'array', items: { type: 'string' } },
        mainCharacters: { type: 'array', items: { type: 'string' } },
        locations: { type: 'array', items: { type: 'string' } },
        narrativeArc: {
          type: 'object',
          additionalProperties: false,
          required: ['setup', 'conflict', 'resolution'],
          properties: {
            setup: { type: 'string', minLength: 1 },
            conflict: { type: 'string', minLength: 1 },
            resolution: { type: 'string', minLength: 1 },
          },
        },
        storyCircleRole: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['beat', 'roleKind', 'source'],
            properties: {
              beat: {
                type: 'string',
                enum: ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change'],
              },
              roleKind: { type: 'string', enum: ['primary', 'expansion'] },
              source: { type: 'string', enum: ['llm', 'treatment'] },
            },
          },
        },
      },
    },
  };
}
