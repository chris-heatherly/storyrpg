import type { StructuredJsonSchema } from '../agents/BaseAgent';

const shortString = () => ({ type: 'string' }) as const;

const stringArraySchema = () => ({
  type: 'array',
  items: shortString(),
}) as const;

const locationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sceneId', 'beatId'],
  properties: {
    sceneId: shortString(),
    beatId: shortString(),
  },
} as const;

const severitySchema = { type: 'string', enum: ['error', 'warning', 'suggestion'] } as const;

export function buildVoiceReportJsonSchema(): StructuredJsonSchema {
  return {
    name: 'voice_report',
    description: 'Compact character voice QA report.',
    maxOutputTokens: 4096,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'characterScores', 'issues', 'distinctionScore', 'recommendations'],
      properties: {
        overallScore: { type: 'number' },
        characterScores: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['characterId', 'characterName', 'score', 'strengths', 'weaknesses'],
            properties: {
              characterId: shortString(),
              characterName: shortString(),
              score: { type: 'number' },
              strengths: stringArraySchema(),
              weaknesses: stringArraySchema(),
            },
          },
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['severity', 'characterId', 'characterName', 'location', 'dialogueLine', 'issue', 'suggestion'],
            properties: {
              severity: severitySchema,
              characterId: shortString(),
              characterName: shortString(),
              location: locationSchema,
              dialogueLine: shortString(),
              issue: shortString(),
              suggestion: shortString(),
              exampleCorrection: shortString(),
            },
          },
        },
        distinctionScore: { type: 'number' },
        recommendations: stringArraySchema(),
      },
    },
  };
}

export function buildStakesReportJsonSchema(): StructuredJsonSchema {
  return {
    name: 'stakes_report',
    description: 'Compact choice stakes QA report.',
    maxOutputTokens: 2048,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'choiceSetAnalysis', 'metrics', 'issues', 'strengths', 'recommendations'],
      properties: {
        overallScore: { type: 'number' },
        choiceSetAnalysis: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['beatId', 'type', 'stakesScore', 'wantClarity', 'costWeight', 'identityResonance', 'analysis', 'improvements'],
            properties: {
              beatId: shortString(),
              type: shortString(),
              stakesScore: { type: 'number' },
              wantClarity: { type: 'number' },
              costWeight: { type: 'number' },
              identityResonance: { type: 'number' },
              analysis: shortString(),
              improvements: stringArraySchema(),
            },
          },
        },
        metrics: {
          type: 'object',
          additionalProperties: false,
          required: ['averageStakesScore', 'falseChoiceCount', 'dilemmaQuality', 'varietyScore'],
          properties: {
            averageStakesScore: { type: 'number' },
            falseChoiceCount: { type: 'number' },
            dilemmaQuality: { type: 'number' },
            varietyScore: { type: 'number' },
          },
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['severity', 'choiceSetId', 'issue', 'suggestion'],
            properties: {
              severity: severitySchema,
              choiceSetId: shortString(),
              issue: shortString(),
              affectedChoices: stringArraySchema(),
              suggestion: shortString(),
            },
          },
        },
        strengths: stringArraySchema(),
        recommendations: stringArraySchema(),
      },
    },
  };
}
