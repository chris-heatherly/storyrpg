import { describe, expect, it } from 'vitest';

import { StoryboardAgent } from './StoryboardAgent';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0,
};

describe('StoryboardAgent dramatic intent guidance', () => {
  it('includes visible turn, visual subtext, and status shift in storyboard prompts', () => {
    const agent = new StoryboardAgent(config, 'ink wash story art');
    const prompt = (agent as any).buildStoryboardPrompt({
      sceneId: 'scene-1',
      sceneName: 'The Folder',
      sceneDescription: 'Ari reveals evidence during a quiet confrontation.',
      beats: [{
        id: 'beat-1',
        text: 'Ari slides the folder into the light while Mara goes still.',
        visualMoment: 'Ari slides the folder into the light',
        primaryAction: 'Ari slides the folder forward',
        emotionalRead: 'Mara goes still with fear visible in her hands',
        relationshipDynamic: 'Mara starts in control until Ari claims the evidence',
        mustShowDetail: 'the folder between their hands',
        dramaticIntent: {
          statusBefore: 'Mara controls the conversation',
          statusAfter: 'Ari controls the evidence',
          subtext: 'The polite exchange has become an accusation.',
          visibleTurn: 'The folder changes possession and Ari gains leverage.',
          visualSubtextCue: 'Mara releases her coffee cup before answering.',
        },
        sequenceIntent: {
          objective: 'Ari forces Mara to acknowledge the evidence.',
          activity: 'quiet confrontation over a folder',
          obstacle: 'Mara can still dismiss the accusation.',
          startState: 'Mara controls the conversation.',
          turningPoint: 'The folder changes possession.',
          endState: 'Ari holds the leverage.',
          visualThread: 'the folder between their hands',
          beatRole: 'turn',
        },
      }],
      genre: 'Drama',
      tone: 'tense',
      mood: 'quiet confrontation',
      sequenceIntent: {
        objective: 'Ari forces Mara to acknowledge the evidence.',
        activity: 'quiet confrontation over a folder',
        obstacle: 'Mara can still dismiss the accusation.',
        startState: 'Mara controls the conversation.',
        turningPoint: 'The folder changes possession.',
        endState: 'Ari holds the leverage.',
        visualThread: 'the folder between their hands',
      },
      characterDescriptions: [],
    });

    expect(prompt).toContain('VISIBLE TURN (LOCKED): The folder changes possession and Ari gains leverage.');
    expect(prompt).toContain('VISUAL SUBTEXT CUE (LOCKED): Mara releases her coffee cup before answering.');
    expect(prompt).toContain('STATUS SHIFT (LOCKED): Mara controls the conversation -> Ari controls the evidence');
    expect(prompt).toContain('compose around dramaticIntent.visibleTurn and dramaticIntent.visualSubtextCue');
    expect(prompt).toContain('SEQUENCE OBJECTIVE: Ari forces Mara to acknowledge the evidence.');
    expect(prompt).toContain('SEQUENCE VISUAL THREAD: the folder between their hands');
    expect(prompt).toContain('setup -> pressure -> turn -> consequence');
  });
});
