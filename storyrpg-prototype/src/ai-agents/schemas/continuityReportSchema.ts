import type { StructuredJsonSchema } from '../agents/BaseAgent';

const locationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sceneId'],
  properties: {
    sceneId: { type: 'string' },
    beatId: { type: 'string' },
    choiceId: { type: 'string' },
  },
} as const;

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['severity', 'type', 'location', 'description', 'suggestedFix'],
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'suggestion'] },
    type: { type: 'string', enum: ['contradiction', 'impossible_knowledge', 'timeline_error', 'state_conflict', 'missing_setup'] },
    location: locationSchema,
    description: { type: 'string' },
    conflictsWith: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
} as const;

const issueCountSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['errors', 'warnings', 'suggestions'],
  properties: {
    errors: { type: 'number' },
    warnings: { type: 'number' },
    suggestions: { type: 'number' },
  },
} as const;

const stringArraySchema = {
  type: 'array',
  items: { type: 'string' },
} as const;

export function buildContinuityReportJsonSchema(): StructuredJsonSchema {
  return {
    name: 'continuity_report',
    description: 'Cross-scene continuity QA report.',
    // QA report with an unbounded issues array — the default cap is adequate
    // for realistic reports; declared so the budget is explicit, not inherited.
    maxOutputTokens: 8192,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'issueCount', 'issues', 'passedChecks', 'recommendations'],
      properties: {
        overallScore: { type: 'number' },
        issueCount: issueCountSchema,
        issues: {
          type: 'array',
          items: issueSchema,
        },
        passedChecks: stringArraySchema,
        recommendations: stringArraySchema,
      },
    },
  };
}
