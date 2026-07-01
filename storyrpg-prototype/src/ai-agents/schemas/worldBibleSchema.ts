import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

const sensoryDetails = {
  type: 'object',
  additionalProperties: true,
  required: ['sights', 'sounds', 'smells', 'textures', 'atmosphere'],
  properties: {
    sights: stringArray,
    sounds: stringArray,
    smells: stringArray,
    textures: stringArray,
    atmosphere: { type: 'string' },
  },
} as const;

const location = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'name', 'type', 'overview', 'fullDescription', 'sensoryDetails', 'secrets', 'dangers', 'opportunities', 'connectedLocations'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    overview: { type: 'string' },
    fullDescription: { type: 'string' },
    sensoryDetails,
    secrets: stringArray,
    dangers: stringArray,
    opportunities: stringArray,
    connectedLocations: stringArray,
    dominantFaction: { type: 'string' },
    timeOfDayVariations: { type: 'object', additionalProperties: true },
    weatherVariations: { type: 'object', additionalProperties: true },
  },
} as const;

const faction = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'name', 'type', 'overview', 'goals', 'methods', 'values', 'leaderDescription', 'memberProfile', 'hierarchy', 'allies', 'enemies', 'neutralRelations', 'territories', 'symbols', 'recognition'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    overview: { type: 'string' },
    goals: stringArray,
    methods: stringArray,
    values: stringArray,
    leaderDescription: { type: 'string' },
    memberProfile: { type: 'string' },
    hierarchy: { type: 'string' },
    allies: stringArray,
    enemies: stringArray,
    neutralRelations: stringArray,
    howToJoin: { type: 'string' },
    benefits: stringArray,
    obligations: stringArray,
    territories: stringArray,
    symbols: stringArray,
    recognition: { type: 'string' },
  },
} as const;

export function buildWorldBibleJsonSchema(): StructuredJsonSchema {
  return {
    name: 'world_bible',
    description: 'World bible for generated story settings.',
    // WorldBuilder runs on the planning tier (config forces maxTokens 32000 because
    // the default is too small and truncates mid-JSON). Match that here so the
    // structured call isn't clamped back to the 8192 default by structuredMaxTokens().
    maxOutputTokens: 32000,
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['worldRules', 'taboos', 'majorEvents', 'locations', 'factions', 'customs', 'beliefs', 'tensions', 'doNotForget'],
      properties: {
        worldRules: stringArray,
        taboos: stringArray,
        majorEvents: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['name', 'description', 'yearsAgo', 'impact'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              yearsAgo: { type: 'string' },
              impact: { type: 'string' },
            },
          },
        },
        locations: {
          type: 'array',
          items: location,
        },
        factions: {
          type: 'array',
          items: faction,
        },
        customs: stringArray,
        beliefs: stringArray,
        tensions: stringArray,
        doNotForget: stringArray,
      },
    },
  };
}

export function buildWorldLocationsJsonSchema(): StructuredJsonSchema {
  return {
    name: 'world_locations',
    description: 'Missing world-bible locations.',
    // Runs on the planning tier alongside the full world bible; keep the same cap
    // so the structured call isn't clamped to the 8192 default.
    maxOutputTokens: 32000,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['locations'],
      properties: {
        locations: {
          type: 'array',
          items: location,
        },
      },
    },
  };
}
