import type { StructuredJsonSchema } from '../agents/BaseAgent';

/** Minimal invent-mode EpisodeBlueprint schema for provider structured output (R1.7). */
export function buildEpisodeBlueprintJsonSchema(input: {
  targetSceneCount: number;
  compact?: boolean;
}): StructuredJsonSchema {
  const sceneCount = Math.max(3, Math.min(input.targetSceneCount || 6, 12));
  const maxDesc = input.compact ? 180 : 480;
  return {
    name: input.compact ? 'episode_blueprint_compact' : 'episode_blueprint',
    description: 'Complete episode blueprint with connected scene graph.',
    maxOutputTokens: input.compact ? 8192 : 16384,
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['episodeId', 'title', 'synopsis', 'startingSceneId', 'scenes'],
      properties: {
        episodeId: { type: 'string' },
        title: { type: 'string' },
        synopsis: { type: 'string', maxLength: maxDesc },
        startingSceneId: { type: 'string' },
        scenes: {
          type: 'array',
          minItems: 3,
          maxItems: sceneCount,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['id', 'name', 'description', 'location', 'mood', 'purpose', 'leadsTo'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string', maxLength: maxDesc },
              location: { type: 'string' },
              mood: { type: 'string' },
              purpose: { type: 'string' },
              leadsTo: { type: 'array', items: { type: 'string' } },
              choicePoint: { type: 'object', additionalProperties: true },
              isEncounter: { type: 'boolean' },
              encounterDescription: { type: 'string' },
              encounterDifficulty: { type: 'string' },
              encounterBuildup: { type: 'string' },
              encounterStakes: { type: 'string' },
              encounterRelevantSkills: { type: 'array', items: { type: 'string' } },
              encounterBeatPlan: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
  };
}
