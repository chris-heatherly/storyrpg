import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = (maxItems: number) => ({
  type: 'array',
  maxItems,
  items: { type: 'string' },
});

export function buildBranchAnnotationJsonSchema(input: {
  pathCount: number;
  reconvergenceCount: number;
}): StructuredJsonSchema {
  const pathCount = Math.max(0, Math.floor(input.pathCount || 0));
  const reconvergenceCount = Math.max(0, Math.floor(input.reconvergenceCount || 0));

  return {
    name: 'branch_annotations',
    description: 'Bounded annotations for a deterministic branch skeleton.',
    // Bounded arrays (pathCount/reconvergenceCount items) — the default cap is
    // adequate; declared so the budget is explicit, not inherited.
    maxOutputTokens: 8192,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['pathAnnotations', 'reconvergenceAnnotations', 'recommendations'],
      properties: {
        pathAnnotations: {
          type: 'array',
          maxItems: pathCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name', 'description', 'narrativeTheme'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              narrativeTheme: { type: 'string' },
            },
          },
        },
        reconvergenceAnnotations: {
          type: 'array',
          maxItems: reconvergenceCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['sceneId', 'narrativeAcknowledgment', 'stateReconciliation'],
            properties: {
              sceneId: { type: 'string' },
              narrativeAcknowledgment: { type: 'string' },
              stateReconciliation: {
                type: 'array',
                maxItems: 4,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['stateVariable', 'possibleValues', 'howToHandle'],
                  properties: {
                    stateVariable: { type: 'string' },
                    possibleValues: stringArray(4),
                    howToHandle: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        recommendations: stringArray(4),
      },
    },
  };
}
