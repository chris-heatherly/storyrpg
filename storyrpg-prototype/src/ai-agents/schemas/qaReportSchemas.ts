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

const judgeIssueSchema = (conceptIds: readonly string[]) => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'conceptId', 'description'],
    properties: {
      severity: severitySchema,
      conceptId: { type: 'string', enum: [...conceptIds] },
      location: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sceneId: shortString(),
          beatId: shortString(),
        },
      },
      description: shortString(),
      suggestion: shortString(),
    },
  },
}) as const;

const judgeConceptScoreSchema = (conceptIds: readonly string[]) => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['conceptId', 'score', 'evidence'],
    properties: {
      conceptId: { type: 'string', enum: [...conceptIds] },
      score: { type: 'number' },
      evidence: shortString(),
    },
  },
}) as const;

const PROSE_CRAFT_CONCEPT_IDS = [
  'sentence_craft',
  'specificity_show_dont_tell',
  'filler_density',
  'rhythm_pacing',
  'dialogue_naturalness',
  'voice_style_consistency',
  'tone_lens_fidelity',
] as const;

export function buildProseCraftReportJsonSchema(): StructuredJsonSchema {
  return {
    name: 'prose_craft_report',
    description: 'Graded prose-craft judgment over sampled scene prose.',
    // 3072 truncated live (bite-me 2026-07-03T19-38-17: 3062/3072 tokens,
    // finishReason=MAX_TOKENS, judge report ABSENT → prose_craft scored 0 and
    // the run capped at 89): six concept evidences + per-scene issues over 7
    // samples need headroom. Ceiling, not a charge.
    maxOutputTokens: 6144,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'conceptScores', 'issues', 'recommendations'],
      properties: {
        overallScore: { type: 'number' },
        conceptScores: judgeConceptScoreSchema(PROSE_CRAFT_CONCEPT_IDS),
        issues: judgeIssueSchema(PROSE_CRAFT_CONCEPT_IDS),
        recommendations: stringArraySchema(),
      },
    },
  };
}

const RESPONSIVENESS_CONCEPT_IDS = [
  'choice_reflected_in_prose',
  'npc_reacts_to_player_choice',
] as const;

export function buildResponsivenessReportJsonSchema(): StructuredJsonSchema {
  return {
    name: 'responsiveness_report',
    description: 'Route-pair divergence judgment: do choices change the prose and NPC behavior?',
    maxOutputTokens: 3072,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'conceptScores', 'probeVerdicts', 'issues', 'recommendations'],
      properties: {
        overallScore: { type: 'number' },
        conceptScores: judgeConceptScoreSchema(RESPONSIVENESS_CONCEPT_IDS),
        probeVerdicts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['probeId', 'verdict', 'npcReaction', 'notes'],
            properties: {
              probeId: shortString(),
              verdict: { type: 'string', enum: ['divergent', 'cosmetic', 'unclear'] },
              npcReaction: { type: 'string', enum: ['reactive', 'static', 'no_npcs'] },
              notes: shortString(),
            },
          },
        },
        issues: judgeIssueSchema(RESPONSIVENESS_CONCEPT_IDS),
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
