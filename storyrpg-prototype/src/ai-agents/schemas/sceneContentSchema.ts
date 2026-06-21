import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

export function buildSceneContentJsonSchema(maxBeats: number): StructuredJsonSchema {
  return {
    name: 'scene_content',
    description: 'Complete playable scene content with prose beats and visual contract fields.',
    schema: {
      type: 'object',
      additionalProperties: true,
      required: [
        'sceneId',
        'sceneName',
        'startingBeatId',
        'beats',
        'charactersInvolved',
      ],
      properties: {
        sceneId: { type: 'string', description: 'Must equal the scene blueprint id.' },
        sceneName: { type: 'string', description: 'Display name for the scene.' },
        locationId: { type: 'string' },
        startingBeatId: { type: 'string', description: 'ID of the first beat in beats.' },
        beats: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: [
              'id',
              'text',
              'visualMoment',
              'primaryAction',
              'emotionalRead',
              'relationshipDynamic',
              'mustShowDetail',
              'intensityTier',
              'isChoicePoint',
            ],
            properties: {
              id: { type: 'string' },
              text: { type: 'string', description: 'Player-facing prose for this beat.' },
              nextBeatId: { type: 'string' },
              nextSceneId: { type: 'string' },
              speaker: { type: 'string' },
              speakerMood: { type: 'string' },
              isChoicePoint: { type: 'boolean' },
              isChoiceBridge: { type: 'boolean' },
              shotType: { type: 'string', enum: ['establishing', 'character', 'action'] },
              intensityTier: { type: 'string', enum: ['dominant', 'supporting', 'rest'] },
              visualMoment: { type: 'string' },
              primaryAction: { type: 'string' },
              emotionalRead: { type: 'string' },
              relationshipDynamic: { type: 'string' },
              mustShowDetail: { type: 'string' },
              callbackHookIds: {
                type: 'array',
                maxItems: 4,
                items: { type: 'string' },
              },
              textVariants: {
                type: 'array',
                maxItems: 4,
                items: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['condition', 'text'],
                  properties: {
                    condition: {
                      type: 'object',
                      additionalProperties: true,
                    },
                    text: { type: 'string' },
                    priority: { type: 'number' },
                    sourceChoiceId: { type: 'string' },
                    reminderTag: { type: 'string' },
                    callbackHookId: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        moodProgression: stringArray,
        charactersInvolved: stringArray,
        keyMoments: stringArray,
        sceneTakeaways: stringArray,
        transitionIn: { type: 'string' },
        continuityNotes: stringArray,
      },
    },
  };
}
