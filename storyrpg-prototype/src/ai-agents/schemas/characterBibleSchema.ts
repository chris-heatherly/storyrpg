import type { StructuredJsonSchema } from '../agents/BaseAgent';

export const CHARACTER_BIBLE_SCHEMA_VERSION = '2';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

export function buildCharacterBibleJsonSchema(_maxCharacters: number): StructuredJsonSchema {
  return {
    name: 'character_bible',
    description: 'Lean character bible contract for the requested cast.',
    // CharacterDesigner runs on the planning tier (config forces maxTokens 32000 to
    // avoid mid-JSON truncation). Match that so structuredMaxTokens() doesn't clamp
    // the structured call back to the 8192 default.
    maxOutputTokens: 32000,
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['characters', 'voiceDistinctions'],
      properties: {
        characters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: [
              'id',
              'name',
              'pronouns',
              'role',
              'importance',
              'overview',
              'want',
              'fear',
              'flaw',
              'physicalDescription',
              'voiceProfile',
            ],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              pronouns: { type: 'string' },
              role: { type: 'string' },
              importance: { type: 'string' },
              tier: { type: 'string' },
              overview: { type: 'string' },
              want: { type: 'string' },
              fear: { type: 'string' },
              flaw: { type: 'string' },
              need: { type: 'string' },
              truth: { type: 'string' },
              wound: { type: 'string' },
              physicalDescription: { type: 'string' },
              typicalAttire: { type: 'string' },
              voiceProfile: {
                type: 'object',
                additionalProperties: true,
                required: ['greetingExamples'],
                properties: {
                  greetingExamples: stringArray,
                  farewellExamples: stringArray,
                  underStressExamples: stringArray,
                  signatureLines: stringArray,
                  verbalTics: stringArray,
                  writingGuidance: { type: 'string' },
                },
              },
              relationships: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    targetId: { type: 'string' },
                    targetName: { type: 'string' },
                    relationshipType: { type: 'string' },
                    currentDynamic: { type: 'string' },
                  },
                },
              },
              arcPotential: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  currentState: { type: 'string' },
                  possibleGrowth: { type: 'string' },
                  possibleFall: { type: 'string' },
                  triggerEvents: stringArray,
                },
              },
              secrets: stringArray,
              description: { type: 'string' },
            },
          },
        },
        relationshipSummary: { type: 'string' },
        keyDynamics: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              characters: stringArray,
              dynamic: { type: 'string' },
              narrativePotential: { type: 'string' },
            },
          },
        },
        ensembleBalance: { type: 'string' },
        voiceDistinctions: { type: 'string' },
        doNotForget: stringArray,
      },
    },
  };
}
