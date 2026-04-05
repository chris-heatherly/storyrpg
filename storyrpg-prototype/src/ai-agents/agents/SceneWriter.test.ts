import { describe, expect, it } from 'vitest';

import { SceneWriter } from './SceneWriter';

describe('SceneWriter structural guards', () => {
  it('expands underspecified choice scenes into a stable three-beat structure', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-2',
        sceneName: 'The Law of the Ember',
        beats: [
          {
            id: 'collapsed-beat',
            text: 'The traveler reaches toward the heater vents while Cassandra watches for any sign of defiance.',
            isChoicePoint: true,
          },
        ],
        startingBeatId: 'collapsed-beat',
        moodProgression: ['tense'],
        charactersInvolved: ['char-cassandra-goldmere'],
        keyMoments: ['The traveler reaches for warmth'],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-2',
          name: 'The Law of the Ember',
          description: 'While the caravan clears customs, a freezing traveler reaches for the wagon heat.',
          location: 'ice-gates',
          mood: 'tense',
          purpose: 'branch',
          narrativeFunction: 'Introduces the moral law of Frosthold.',
          dramaticQuestion: 'Will Lyralei uphold the city law or her mother?',
          wantVsNeed: 'Keep social safety vs honor the law',
          conflictEngine: 'Cassandra demands compliance while a desperate stranger pleads for warmth.',
          npcsPresent: ['char-cassandra-goldmere'],
          keyBeats: [
            'A freezing traveler reaches for the heat',
            'Cassandra orders the guards to push them back',
          ],
          leadsTo: ['scene-3'],
          choicePoint: {
            type: 'dilemma',
            description: 'Do you intervene?',
            stakes: {
              want: 'Honor the sacred law',
              cost: 'Defy Cassandra in public',
              identity: 'Merchant obedience versus human decency',
            },
            optionHints: ['Help the traveler', 'Look away'],
          },
        },
        storyContext: {
          title: 'Test Story',
          genre: 'fantasy',
          tone: 'dramatic',
          worldContext: 'A frozen mountain city.',
        },
        protagonistInfo: {
          name: 'Lyralei',
          pronouns: 'she/her',
          description: 'A merchant daughter under pressure.',
        },
        npcs: [],
        targetBeatCount: 5,
        dialogueHeavy: true,
      }
    );

    expect(normalized.beats).toHaveLength(3);
    expect(normalized.startingBeatId).toBe('beat-1');
    expect(normalized.beats.map((beat: any) => beat.id)).toEqual(['beat-1', 'beat-2', 'beat-3']);
    expect(normalized.beats[2].isChoicePoint).toBe(true);
    expect(normalized.beats[0].nextBeatId).toBe('beat-2');
    expect(normalized.beats[1].nextBeatId).toBe('beat-3');
    expect(normalized.beats[2].nextBeatId).toBeUndefined();
  });
});
