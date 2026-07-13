import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

export function buildSceneContentJsonSchema(maxBeats: number): StructuredJsonSchema {
  return {
    name: 'scene_content',
    description: 'Complete playable scene content with prose beats and visual contract fields.',
    // SceneWriter is the heaviest structured output; the config default is 16384
    // (config.ts A/B evidence: 8192 truncates mid-JSON on both providers). Without
    // this cap, structuredMaxTokens() clamps the call back to the 8192 default.
    maxOutputTokens: 16384,
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
        realizedEventIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Canonical event IDs assigned to this scene and realized in its prose. Never invent IDs.',
        },
        claimedEventIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Canonical event IDs the model claims its prose realizes. Claims remain subject to prose validation.',
        },
        eventEvidence: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['eventId', 'evidence'],
            properties: {
              eventId: { type: 'string' },
              taskId: { type: 'string' },
              atomId: { type: 'string' },
              beatIds: { type: 'array', items: { type: 'string' }, maxItems: 6 },
              evidence: { type: 'string' },
            },
          },
        },
      },
    },
  };
}
