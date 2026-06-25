import type { StructuredJsonSchema } from '../agents/BaseAgent';
import { canonicalTintVocabulary } from '../utils/tintVocabulary';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

const shortString = (maxLength: number) => ({ type: 'string', maxLength }) as const;

const stringMap = {
  type: 'object',
  additionalProperties: false,
  properties: {
    athletics: { type: 'number' },
    stealth: { type: 'number' },
    perception: { type: 'number' },
    persuasion: { type: 'number' },
    intimidation: { type: 'number' },
    deception: { type: 'number' },
    investigation: { type: 'number' },
    survival: { type: 'number' },
  },
} as const;

const stakes = {
  type: 'object',
  additionalProperties: false,
  required: ['want', 'cost', 'identity'],
  properties: {
    want: shortString(180),
    cost: shortString(180),
    identity: shortString(180),
  },
} as const;

const outcomeTexts = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'partial', 'failure'],
  properties: {
    success: shortString(220),
    partial: shortString(220),
    failure: shortString(220),
  },
} as const;

export interface ChoiceSetSchemaOptions {
  choiceType?: string;
  branching?: boolean;
  optionCount?: number;
}

export function buildChoiceSetJsonSchema(options: ChoiceSetSchemaOptions = {}): StructuredJsonSchema {
  const normalizedChoiceType = String(options.choiceType || '').toLowerCase();
  const isMeaningfulChoice = ['relationship', 'strategic', 'dilemma'].includes(normalizedChoiceType);
  const isDilemma = normalizedChoiceType === 'dilemma';
  const isBranching = Boolean(options.branching);
  const rawOptionCount = Number.isInteger(options.optionCount) && (options.optionCount ?? 0) > 0
    ? options.optionCount
    : undefined;
  const optionCount = rawOptionCount
    ? Math.max(3, Math.min(4, rawOptionCount))
    : undefined;
  const requiredChoiceFields = [
    'id',
    'text',
    'choiceType',
    'choiceIntent',
    'impactFactors',
    'consequenceTier',
    'stakesAnnotation',
    'consequences',
    'outcomeTexts',
    ...(!isBranching ? ['reactionText', 'tintFlag'] : []),
    ...(isBranching ? ['nextSceneId'] : []),
    ...(isMeaningfulChoice ? ['statCheck', 'residueHints'] : []),
    ...(isDilemma ? ['moralContract'] : []),
  ];

  return {
    name: 'choice_set',
    description: 'Compact playable choice set for a single choice-point beat.',
    maxOutputTokens: 16384,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['beatId', 'choiceType', 'choices', 'overallStakes', 'designNotes'],
      properties: {
        beatId: { type: 'string' },
        sceneId: { type: 'string' },
        choiceType: { type: 'string' },
        choices: {
          type: 'array',
          ...(optionCount ? { minItems: optionCount, maxItems: optionCount } : {}),
          items: {
            type: 'object',
            additionalProperties: false,
            required: requiredChoiceFields,
            properties: {
              id: shortString(80),
              text: shortString(120),
              choiceType: shortString(40),
              choiceIntent: shortString(80),
              consequenceTier: shortString(40),
              nextSceneId: shortString(120),
              stakes,
              stakesAnnotation: stakes,
              outcomeTexts,
              reactionText: shortString(220),
              tintFlag: { type: 'string', enum: [...canonicalTintVocabulary()] },
              consequences: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['type', 'flag', 'value'],
                  properties: {
                    type: shortString(40),
                    flag: shortString(120),
                    name: shortString(120),
                    target: shortString(120),
                    value: { type: 'boolean' },
                    score: shortString(80),
                    skill: shortString(80),
                    attribute: shortString(80),
                    npcId: shortString(120),
                    dimension: shortString(80),
                    tag: shortString(80),
                    itemId: shortString(120),
                    change: { type: 'number' },
                    quantity: { type: 'number' },
                    description: shortString(180),
                  },
                },
              },
              conditions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    type: shortString(40),
                    flag: shortString(120),
                    score: shortString(80),
                    value: shortString(80),
                  },
                },
              },
              statCheck: {
                type: 'object',
                additionalProperties: true,
                required: isMeaningfulChoice ? ['skillWeights', 'difficulty'] : undefined,
                properties: {
                  skillWeights: stringMap,
                  difficulty: { type: 'number' },
                  modifiers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        id: shortString(80),
                        delta: { type: 'number' },
                        reason: shortString(160),
                        hint: shortString(160),
                      },
                    },
                  },
                },
              },
              moralContract: {
                type: 'object',
                additionalProperties: false,
                required: ['valueA', 'valueB', 'unavoidableCost', 'benefits', 'harms', 'uncertainty'],
                properties: {
                  valueA: shortString(160),
                  valueB: shortString(160),
                  unavoidableCost: shortString(220),
                  benefits: stringArray,
                  harms: stringArray,
                  uncertainty: shortString(200),
                },
              },
              residueHints: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'description'],
                  properties: {
                    kind: shortString(80),
                    description: shortString(220),
                    targetNpcId: shortString(120),
                  },
                },
              },
              memorableMoment: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'summary'],
                properties: {
                  id: shortString(80),
                  summary: shortString(180),
                  flags: stringArray,
                },
              },
              impactFactors: stringArray,
            },
          },
        },
        overallStakes: stakes,
        designNotes: shortString(120),
      },
    },
  };
}
