import { describe, expect, it } from 'vitest';

import { buildSourceMaterialFidelitySection, SceneWriter } from './SceneWriter';
import { buildSceneContentJsonSchema } from '../schemas/sceneContentSchema';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';

function createWriter(): SceneWriter {
  return new SceneWriter({
    provider: 'anthropic',
    model: 'test-model',
    apiKey: 'test-key',
    maxTokens: 1024,
    temperature: 0,
  });
}

describe('SceneWriter structural guards', () => {
  it('does not invent neutral pronouns in deterministic visual subtext cues', () => {
    const writer = createWriter();

    const cue = (writer as any).deriveVisualSubtextCue(
      'Mika feels fear because the truth is visible.',
      'Mika hesitates.',
      'Mika Drăgan',
    );
    const turn = (writer as any).deriveVisibleTurn(
      'Mika notices the decisive clue.',
      'Mika steps back.',
      'Mika Drăgan',
    );

    expect(cue).toContain("Mika Drăgan's hands tighten");
    expect(cue).not.toMatch(/\btheir\b/i);
    expect(turn).toContain("Mika Drăgan's posture");
    expect(turn).not.toMatch(/\btheir\b/i);
  });

  it('requires consumed beat and text variant fields in the provider schema', () => {
    const schema = buildSceneContentJsonSchema(6).schema as any;
    const beatSchema = schema.properties.beats.items;
    const variantSchema = beatSchema.properties.textVariants.items;

    expect(beatSchema.required).toContain('isChoicePoint');
    expect(variantSchema.required).toEqual(expect.arrayContaining(['condition', 'text']));
  });

  it('reports malformed text variants instead of accepting boilerplate fields', () => {
    const writer = createWriter();
    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'The Choice',
        startingBeatId: 'beat-1',
        beats: [
          {
            id: 'beat-1',
            text: 'You watch the club lights pulse against the wet street.',
            isChoicePoint: true,
            textVariants: [{ text: '' }],
          },
        ],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'The Choice',
          choicePoint: { type: 'relationship' },
        },
        targetBeatCount: 1,
      },
    );

    expect(issues.some((issue: string) => issue.includes('MALFORMED TEXT VARIANT'))).toBe(true);
  });

  it('reports empty text variant conditions as malformed boilerplate', () => {
    const writer = createWriter();
    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-blog',
        sceneName: 'The Post',
        startingBeatId: 'beat-1',
        beats: [
          {
            id: 'beat-1',
            text: 'You watch the blog counter jump again.',
            isChoicePoint: false,
            textVariants: [
              {
                condition: {},
                text: 'You watch the blog counter jump again.',
                callbackHookId: 'kylie_sees_viral_post',
              },
            ],
          },
        ],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-blog',
          name: 'The Post',
        },
        targetBeatCount: 1,
      },
    );

    expect(issues.some((issue: string) => issue.includes('MALFORMED TEXT VARIANT'))).toBe(true);
  });

  it('normalizes underfilled scene-length choice scenes to the validator minimum', () => {
    const writer = createWriter();
    const input = {
      sceneBlueprint: {
        id: 's1-3',
        name: 'The Park Warning',
        description: 'Kylie realizes the path through the park is not as empty as it looked.',
        narrativeFunction: 'Aftermath that resettles stakes; serves the hook beat.',
        keyBeats: [
          'The lamps flicker out behind Kylie.',
          'Forward pressure: the next scene remembers what she misses.',
        ],
        choicePoint: {
          type: 'dilemma',
          description: 'Decide how to handle park scene 3.',
        },
        npcsPresent: [],
      },
      protagonistInfo: { name: 'Kylie' },
      targetBeatCount: 6,
    };
    const content = {
      sceneId: 's1-3',
      sceneName: 'The Park Warning',
      startingBeatId: 'beat-1',
      beats: [
        { id: 'beat-1', text: 'You step under the last working lamp.', nextBeatId: 'beat-2' },
        { id: 'beat-2', text: 'The path ahead narrows into fog.', nextBeatId: 'beat-3' },
        { id: 'beat-3', text: 'Something watches from the trees.', isChoicePoint: true },
      ],
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    };

    const normalized = (writer as any).normalizeContent(content, input);
    expect(normalized.beats).toHaveLength(6);
    expect(normalized.beats[5].isChoicePoint).toBe(true);
    expect(normalized.beats.map((beat: any) => beat.id)).toEqual([
      'beat-1',
      'beat-2',
      'beat-3',
      'beat-4',
      'beat-5',
      'beat-6',
    ]);
    expect(JSON.stringify(normalized.beats)).not.toMatch(/Decide how to handle|Forward pressure|serves the hook beat/i);

    const issues = (writer as any).collectIssues(normalized, input);
    expect(issues.join('\n')).not.toContain('SCENE-LENGTH UNDERFILL');
  });

  it('terminates deterministic choice-scene expansion when source lead-ins are unsafe or duplicate', () => {
    const writer = createWriter();
    const input = {
      sceneBlueprint: {
        id: 's1-6',
        name: 'Release Scene',
        description: 'Forward pressure: route into the next episode.',
        narrativeFunction: 'This serves the resolution beat.',
        keyBeats: [
          'Forward pressure: route into the next episode.',
          'Forward pressure: route into the next episode.',
        ],
        choicePoint: {
          type: 'strategic',
          description: 'scene 6 decision register',
        },
        npcsPresent: [],
      },
      protagonistInfo: { name: 'Kylie' },
      targetBeatCount: 6,
    };
    const content = {
      sceneId: 's1-6',
      sceneName: 'Release Scene',
      startingBeatId: 'beat-1',
      beats: [
        { id: 'beat-1', text: 'You hold the card while the apartment goes quiet.', isChoicePoint: true },
      ],
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    };

    const normalized = (writer as any).normalizeContent(content, input);
    expect(normalized.beats).toHaveLength(6);
    expect(normalized.beats[5].isChoicePoint).toBe(true);
    expect(JSON.stringify(normalized.beats)).not.toMatch(/Forward pressure|serves the resolution beat|decision register/i);
  });

  it('compacts short over-fragmented beat prose before hard cap validation', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-fragments',
      sceneName: 'Fragmented Beat',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'Stela smiles. Kylie freezes. Mika laughs. The quartz warms. The bell rings. Victor looks over.',
          visualMoment: 'Kylie freezes as Stela smiles across the counter.',
          primaryAction: 'freezes beside the counter',
          emotionalRead: 'startled and exposed',
          relationshipDynamic: 'Stela has the information advantage',
          mustShowDetail: 'the quartz warming in Kylie\'s palm',
          intensityTier: 'supporting',
          isChoicePoint: false,
        },
      ],
      moodProgression: ['uneasy'],
      charactersInvolved: ['kylie', 'stela'],
      keyMoments: ['The quartz reacts'],
      continuityNotes: [],
    });

    const text = normalized.beats[0].text;
    const sentenceCount = (text.match(/[.!?]+/g) || []).length;
    expect(sentenceCount).toBeLessThanOrEqual(4);
    const issues = (writer as any).collectIssues(normalized, {
      sceneBlueprint: { id: 'scene-fragments', name: 'Fragmented Beat' },
      targetBeatCount: 1,
    });
    expect(issues.some((issue: string) => issue.includes('BEATS EXCEED CAP'))).toBe(false);
  });

  it('counts ellipses as one sentence boundary for beat cap validation', () => {
    const writer = createWriter();
    const issues = (writer as any).collectIssues({
      sceneId: 'scene-ellipsis',
      sceneName: 'Ellipsis Beat',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'You wait... Victor smiles. The room goes quiet.',
          visualMoment: 'Victor smiles as the room goes quiet.',
          primaryAction: 'waits under pressure',
          emotionalRead: 'uneasy',
          relationshipDynamic: 'Victor controls the room',
          mustShowDetail: 'the room going quiet',
          isChoicePoint: false,
        },
      ],
      moodProgression: ['uneasy'],
      charactersInvolved: ['Kylie', 'Victor'],
      keyMoments: ['The room goes quiet'],
      continuityNotes: [],
    }, {
      sceneBlueprint: { id: 'scene-ellipsis', name: 'Ellipsis Beat' },
      targetBeatCount: 1,
    });

    expect(issues.some((issue: string) => issue.includes('BEATS EXCEED CAP'))).toBe(false);
  });

  it('drops unknown callbackHookIds that were not provided by the deterministic hook list', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-blog',
        sceneName: 'The Post',
        startingBeatId: 'beat-1',
        beats: [
          {
            id: 'beat-1',
            text: 'You watch the blog counter jump again.',
            isChoicePoint: false,
            textVariants: [
              {
                condition: { type: 'flag', flag: 'blog_went_viral', value: true },
                text: 'The number makes the apartment feel watched.',
                callbackHookId: 'kylie_sees_viral_post',
              },
              {
                condition: { type: 'flag', flag: 'accepted_keycard', value: true },
                text: 'The key card is still cold in your pocket.',
                callbackHookId: 'flag:accepted_keycard',
              },
            ],
          },
        ],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: { id: 'scene-blog', name: 'The Post' },
        unresolvedCallbacks: [
          { id: 'flag:accepted_keycard', sourceEpisode: 1, summary: 'You accepted the key card.', flags: ['accepted_keycard'] },
        ],
      },
    );

    const variants = normalized.beats[0].textVariants;
    expect(variants[0].callbackHookId).toBeUndefined();
    expect(variants[1].callbackHookId).toBe('flag:accepted_keycard');
  });

  it('drops boilerplate conditionless textVariants during normalization', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-blog',
        sceneName: 'The Post',
        startingBeatId: 'beat-1',
        beats: [
          {
            id: 'beat-1',
            text: 'You watch the blog counter jump again.',
            isChoicePoint: false,
            textVariants: [
              {
                condition: {},
                text: 'You watch the blog counter jump again.',
              },
            ],
          },
        ],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      { sceneBlueprint: { id: 'scene-blog', name: 'The Post' } },
    );

    expect(normalized.beats[0].textVariants).toEqual([]);
  });

  it('wires callback textVariants to deterministic hook flags when the model omits the condition', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-blog',
        sceneName: 'The Post',
        startingBeatId: 'beat-1',
        beats: [
          {
            id: 'beat-1',
            text: 'You watch the blog counter jump again.',
            isChoicePoint: false,
            textVariants: [
              {
                text: 'The key card is still cold in your pocket.',
                callbackHookId: 'flag:accepted_keycard',
              },
            ],
          },
        ],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: { id: 'scene-blog', name: 'The Post' },
        unresolvedCallbacks: [
          { id: 'flag:accepted_keycard', sourceEpisode: 1, summary: 'You accepted the key card.', flags: ['accepted_keycard'] },
        ],
      },
    );

    expect(normalized.beats[0].textVariants[0].condition).toEqual({
      type: 'flag',
      flag: 'accepted_keycard',
      value: true,
    });
  });

  it('rejects a revision that still contains malformed text variants', async () => {
    class StillMalformedSceneWriter extends SceneWriter {
      calls = 0;

      protected async callLLM(): Promise<string> {
        this.calls += 1;
        return JSON.stringify({
          sceneId: 'scene-blog',
          sceneName: 'The Post',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You watch the blog counter jump again.',
              visualMoment: 'Kylie studies the glowing blog counter.',
              primaryAction: 'studies the counter',
              emotionalRead: 'uneasy attention',
              relationshipDynamic: 'Kylie is alone with the consequence of publishing',
              mustShowDetail: 'the glowing blog counter on the laptop',
              intensityTier: 'dominant',
              isChoicePoint: false,
              textVariants: [
                {
                  condition: { type: 'flag' },
                  text: 'You watch the blog counter jump again.',
                  callbackHookId: 'kylie_sees_viral_post',
                },
              ],
            },
          ],
          moodProgression: ['uneasy'],
          charactersInvolved: ['kylie'],
          keyMoments: ['The blog counter jumps'],
          continuityNotes: [],
        });
      }
    }

    const writer = new StillMalformedSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-blog',
        name: 'The Post',
        description: 'Kylie realizes the blog has gone viral.',
        location: 'apartment',
        mood: 'uneasy',
        purpose: 'setup',
        narrativeFunction: 'Turns publication into exposure.',
        dramaticQuestion: 'What did publishing cost her?',
        wantVsNeed: 'Be seen vs stay safe',
        conflictEngine: 'The post gives Kylie agency and exposes her.',
        npcsPresent: [],
        keyBeats: ['Kylie sees the blog counter'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'paranormal romance',
        tone: 'dangerous and intimate',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Kylie',
        pronouns: 'she/her',
        description: 'An American food writer starting over.',
      },
      npcs: [],
      targetBeatCount: 1,
      dialogueHeavy: false,
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('SceneWriter revision still has');
    expect(result.error).toContain('hard issue');
    expect(result.error).toContain('MALFORMED TEXT VARIANT');
    expect(writer.calls).toBe(2);
  });

  it('rejects an oversized revision before parsing or regex-heavy validation', async () => {
    class OversizedRevisionSceneWriter extends SceneWriter {
      calls = 0;

      protected async callLLM(): Promise<string> {
        this.calls += 1;
        if (this.calls === 1) {
          return JSON.stringify({
            sceneId: 'scene-blog',
            sceneName: 'The Post',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'You watch the blog counter jump again.',
                visualMoment: 'Kylie studies the glowing blog counter.',
                primaryAction: 'studies the counter',
                emotionalRead: 'uneasy attention',
                relationshipDynamic: 'Kylie is alone with the consequence of publishing',
                mustShowDetail: 'the glowing blog counter on the laptop',
                intensityTier: 'dominant',
                isChoicePoint: false,
                textVariants: [{ condition: {}, text: 'You watch the blog counter jump again.' }],
              },
            ],
            moodProgression: ['uneasy'],
            charactersInvolved: ['kylie'],
            keyMoments: ['The blog counter jumps'],
            continuityNotes: [],
          });
        }

        return JSON.stringify({
          sceneId: 'scene-blog',
          sceneName: 'The Post',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You watch the blog counter jump again.',
              visualMoment: 'Kylie studies the glowing blog counter.',
              primaryAction: 'studies the counter',
              emotionalRead: 'uneasy attention',
              relationshipDynamic: 'Kylie is alone with the consequence of publishing',
              mustShowDetail: 'the glowing blog counter on the laptop',
              intensityTier: 'dominant',
              isChoicePoint: false,
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'blog_went_viral', value: true },
                  text: 'The number makes the apartment feel watched.',
                },
              ],
              oversized: 'x'.repeat(15000),
            },
          ],
          moodProgression: ['uneasy'],
          charactersInvolved: ['kylie'],
          keyMoments: ['The blog counter jumps'],
          continuityNotes: [],
        });
      }
    }

    const writer = new OversizedRevisionSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-blog',
        name: 'The Post',
        description: 'Kylie realizes the blog has gone viral.',
        location: 'apartment',
        mood: 'uneasy',
        purpose: 'setup',
        narrativeFunction: 'Turns publication into exposure.',
        dramaticQuestion: 'What did publishing cost her?',
        wantVsNeed: 'Be seen vs stay safe',
        conflictEngine: 'The post gives Kylie agency and exposes her.',
        npcsPresent: [],
        keyBeats: ['Kylie sees the blog counter'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'paranormal romance',
        tone: 'dangerous and intimate',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Kylie',
        pronouns: 'she/her',
        description: 'An American food writer starting over.',
      },
      npcs: [],
      targetBeatCount: 1,
      dialogueHeavy: false,
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('SceneWriter revision exceeded raw processing budget');
    expect(writer.calls).toBe(2);
  });

  it('reports overlong beat text before expensive scene validators run', () => {
    const writer = createWriter();
    const content = (writer as any).boundOverlongContentForProcessing({
      sceneId: 'scene-long',
      sceneName: 'The Overwritten Beat',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: `You face the room. ${'Every detail repeats past the useful point. '.repeat(180)}`,
          isChoicePoint: true,
        },
      ],
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    const issues = (writer as any).collectIssues(
      content,
      {
        sceneBlueprint: {
          id: 'scene-long',
          name: 'The Overwritten Beat',
          choicePoint: { type: 'identity' },
        },
        targetBeatCount: 1,
      },
    );

    expect(issues.some((issue: string) => issue.includes('OVERLONG BEAT TEXT'))).toBe(true);
    expect(content.beats[0].text).toContain('Generation note');
    expect(content.beats[0].text.length).toBeLessThan(3800);
  });

  it('rejects oversized first-pass scene JSON before local parse and validation work', async () => {
    class OversizedFirstPassSceneWriter extends SceneWriter {
      protected async callLLM(): Promise<string> {
        return JSON.stringify({
          sceneId: 'scene-heavy',
          sceneName: 'The Heavy Scene',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You stop at the threshold as the room turns toward you.',
              visualMoment: 'Kylie stops at the threshold.',
              primaryAction: 'stops at the threshold',
              emotionalRead: 'wary focus',
              relationshipDynamic: 'Kylie faces a room that has already judged her',
              mustShowDetail: 'the open threshold',
              intensityTier: 'dominant',
              isChoicePoint: true,
              oversized: 'x'.repeat(18000),
            },
          ],
          moodProgression: ['tense'],
          charactersInvolved: ['kylie'],
          keyMoments: ['The room turns toward Kylie'],
          continuityNotes: [],
        });
      }
    }

    const writer = new OversizedFirstPassSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-heavy',
        name: 'The Heavy Scene',
        description: 'Kylie reaches a dangerous threshold.',
        location: 'club',
        mood: 'tense',
        purpose: 'choice',
        narrativeFunction: 'Forces Kylie to decide how visible she will be.',
        dramaticQuestion: 'Does Kylie step into danger?',
        wantVsNeed: 'Safety vs agency',
        conflictEngine: 'The room sees her before she is ready.',
        npcsPresent: [],
        choicePoint: {
          type: 'identity',
          description: 'Kylie must decide whether to step into the room.',
          stakes: {
            want: 'stay unseen',
            cost: 'the room controls the story if she hesitates',
            identity: 'observer versus participant',
          },
        },
        keyBeats: ['Kylie reaches the threshold'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'paranormal romance',
        tone: 'dangerous and intimate',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Kylie',
        pronouns: 'she/her',
        description: 'An American food writer starting over.',
      },
      npcs: [],
      targetBeatCount: 1,
      dialogueHeavy: false,
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('SceneWriter response exceeded raw processing budget');
  });

  it('revises overlong scene output with a compact original-content prompt', async () => {
    const overlongText = `You step under the rooftop sign. ${'The same pressure keeps expanding without adding new playable information. '.repeat(80)}`;

    class OverlongSceneWriter extends SceneWriter {
      calls = 0;
      revisionPrompt = '';

      protected async callLLM(messages: Array<{ content: string }>): Promise<string> {
        this.calls += 1;
        if (this.calls === 1) {
          return JSON.stringify({
            sceneId: 'scene-rooftop',
            sceneName: 'Rooftop Pressure',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: overlongText,
                shotType: 'character',
                visualMoment: 'Lena stops beneath the rooftop sign.',
                primaryAction: 'stops beneath the sign',
                emotionalRead: 'watchful and unsettled',
                relationshipDynamic: 'the empty rooftop gives Lena no one to hide behind',
                mustShowDetail: 'the rooftop sign flickering above Lena',
                isChoicePoint: false,
              },
            ],
            moodProgression: ['uneasy'],
            charactersInvolved: ['lena'],
            keyMoments: ['Lena reaches the rooftop'],
            continuityNotes: [],
          });
        }

        this.revisionPrompt = messages[0].content;
        return JSON.stringify({
          sceneId: 'scene-rooftop',
          sceneName: 'Rooftop Pressure',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You stop beneath the rooftop sign as its broken red letters blink across your hands, turning the invitation into a warning.',
              shotType: 'character',
              visualMoment: 'Lena stops beneath the flickering rooftop sign.',
              primaryAction: 'stops and studies the sign',
              emotionalRead: 'watchful and unsettled',
              relationshipDynamic: 'the empty rooftop leaves Lena exposed',
              mustShowDetail: 'broken red letters blinking across Lena\'s hands',
              isChoicePoint: false,
            },
          ],
          moodProgression: ['uneasy'],
          charactersInvolved: ['lena'],
          keyMoments: ['Lena reaches the rooftop warning'],
          continuityNotes: [],
        });
      }
    }

    const writer = new OverlongSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-rooftop',
        name: 'Rooftop Pressure',
        description: 'Lena follows the rooftop invitation and realizes it feels like a warning.',
        location: 'rooftop',
        mood: 'uneasy',
        purpose: 'setup',
        narrativeFunction: 'Turns flirtation into danger.',
        dramaticQuestion: 'Is the invitation romantic or predatory?',
        wantVsNeed: 'Be wanted vs stay alert',
        conflictEngine: 'The invitation promises intimacy while the place signals threat.',
        npcsPresent: [],
        keyBeats: ['Lena reaches the rooftop sign'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'paranormal romance',
        tone: 'dangerous and intimate',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Lena',
        pronouns: 'she/her',
        description: 'An American food writer starting over.',
      },
      npcs: [],
      targetBeatCount: 1,
      dialogueHeavy: false,
    } as any);

    expect(result.success).toBe(true);
    expect(writer.calls).toBe(2);
    expect(writer.revisionPrompt).toContain('OVERLONG BEAT TEXT');
    expect(writer.revisionPrompt.length).toBeLessThan(14000);
    expect(writer.revisionPrompt).toContain('Generation note');
    expect(result.data?.beats[0].text).not.toContain('Generation note');
    expect((result.data?.beats[0] as any).__sceneWriterOriginalTextCharCount).toBeUndefined();
  });

  const preEncounterInput = {
    sceneBlueprint: {
      id: 'scene-3b',
      name: 'Underground Club Scene',
      description: 'Carmen takes Lena to the deeper supernatural nightlife scene.',
      location: 'loc-underground-club',
      mood: 'intoxicating',
      purpose: 'branch',
      narrativeFunction: 'Introduces Mika and the more dangerous edge of Bucharest nightlife.',
      dramaticQuestion: 'Who in this room knows Lena before she knows them?',
      wantVsNeed: 'Belong in the city vs understand its danger',
      conflictEngine: 'Mika knows more about Lena than Lena knows about Mika.',
      npcsPresent: ['char-mika'],
      keyBeats: [
        'Mika approaches with knowing eyes',
        'Mika offers cryptic advice about being careful who you trust',
      ],
      leadsTo: ['scene-4'],
    },
    storyContext: {
      title: 'Bite Me',
      genre: 'paranormal romance',
      tone: 'sumptuous and dangerous',
      worldContext: 'Modern Bucharest nightlife.',
    },
    protagonistInfo: {
      name: 'Lena',
      pronouns: 'she/her',
      description: 'An American food writer starting over.',
    },
    npcs: [],
    targetBeatCount: 5,
    dialogueHeavy: true,
    nextSceneContext: {
      id: 'scene-4',
      name: 'The Attack in Cismigiu Park',
      location: 'loc-cismigiu-park',
      description: 'Walking home alone through the foggy park, Lena is stalked and attacked.',
      isEncounter: true,
      encounterType: 'combat',
      encounterDescription: 'Lena must survive a supernatural predator in the foggy park.',
      encounterBeatPlan: ['Fog rolls in as Lena takes a shortcut through the dark park'],
    },
  } as any;

  it('rejects a pre-encounter scene that ends without a handoff beat', async () => {
    class BadHandoffSceneWriter extends SceneWriter {
      protected async callLLM(): Promise<string> {
        return JSON.stringify({
          sceneId: 'scene-3b',
          sceneName: 'Underground Club Scene',
          description: 'Mika introduces herself.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'A platinum-haired woman smiles through the crimson light.',
              nextBeatId: 'beat-2',
              visualMoment: 'Mika approaches Lena.',
              primaryAction: 'approaches',
              emotionalRead: 'calculated warmth',
              relationshipDynamic: 'Mika holds the information advantage',
              mustShowDetail: 'bracelets catching the light',
            },
            {
              id: 'beat-2',
              text: '"You have your grandmother\'s eyes," she says, extending a manicured hand. "I am Mika."',
              visualMoment: 'Mika extends her hand.',
              primaryAction: 'offers a greeting',
              emotionalRead: 'Lena is startled',
              relationshipDynamic: 'Mika controls the exchange',
              mustShowDetail: 'the extended hand',
            },
          ],
          moodProgression: ['intoxicating'],
          charactersInvolved: ['char-mika'],
          keyMoments: ['Mika reveals she knows Lena'],
          continuityNotes: [],
        });
      }
    }

    const writer = new BadHandoffSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute(preEncounterInput);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pre-encounter handoff missing');
  });

  it('accepts a pre-encounter scene whose final beat bridges into the encounter', async () => {
    class GoodHandoffSceneWriter extends SceneWriter {
      protected async callLLM(): Promise<string> {
        return JSON.stringify({
          sceneId: 'scene-3b',
          sceneName: 'Underground Club Scene',
          description: 'Mika introduces herself.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'A platinum-haired woman smiles through the crimson light.',
              nextBeatId: 'beat-2',
              visualMoment: 'Mika approaches Lena.',
              primaryAction: 'approaches',
              emotionalRead: 'calculated warmth',
              relationshipDynamic: 'Mika holds the information advantage',
              mustShowDetail: 'bracelets catching the light',
            },
            {
              id: 'beat-2',
              text: '"Be careful who you trust," Mika warns as Carmen leads you back outside into the Bucharest night.',
              visualMoment: 'Mika warns Lena near the club exit.',
              primaryAction: 'warns Lena',
              emotionalRead: 'Lena is unsettled',
              relationshipDynamic: 'Mika releases Lena with a warning',
              mustShowDetail: 'the club door opening to the night street',
            },
          ],
          moodProgression: ['intoxicating', 'uneasy'],
          charactersInvolved: ['char-mika'],
          keyMoments: ['Mika warns Lena'],
          continuityNotes: [],
        });
      }
    }

    const writer = new GoodHandoffSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute(preEncounterInput);

    expect(result.success).toBe(true);
    expect(result.data?.beats.at(-1)?.text).toContain('warns');
  });

  it('repairs malformed JSON once before failing the scene', async () => {
    class RepairableSceneWriter extends SceneWriter {
      calls = 0;

      protected async callLLM(): Promise<string> {
        this.calls += 1;
        if (this.calls === 1) {
          return '```json\n{"sceneId":"scene-2a","sceneName":"Bold Entrance","beats":[{"id":"beat-1","text":"You step into the club';
        }
        return JSON.stringify({
          sceneId: 'scene-2a',
          sceneName: 'Bold Entrance',
          description: 'Lena enters the club and draws attention.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You step into Vâlcescu Club before the velvet rope has stopped swaying, and every nearby conversation tilts toward you.',
              shotType: 'character',
              visualMoment: 'Lena enters the club with the rope still moving behind her.',
              primaryAction: 'steps confidently into the club',
              emotionalRead: 'confident but watchful',
              relationshipDynamic: 'attention shifts toward Lena',
              mustShowDetail: 'the moving velvet rope behind Lena',
            },
          ],
          moodProgression: ['electric'],
          charactersInvolved: ['lena'],
          keyMoments: ['Lena enters with confidence'],
          continuityNotes: [],
        });
      }
    }

    const writer = new RepairableSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-2a',
        name: 'Bold Entrance',
        description: 'Lena enters Vâlcescu Club with confidence.',
        location: 'club',
        mood: 'electric',
        purpose: 'branch',
        narrativeFunction: 'Shows Lena choosing boldness.',
        dramaticQuestion: 'Will boldness draw the right attention?',
        wantVsNeed: 'Be seen vs stay safe',
        conflictEngine: 'The club notices her before she knows who is watching.',
        npcsPresent: [],
        keyBeats: ['Lena enters boldly'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'romance',
        tone: 'darkly playful',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Lena',
        pronouns: 'she/her',
        description: 'An American starting over.',
      },
      npcs: [],
      targetBeatCount: 3,
      dialogueHeavy: false,
    } as any, 1);

    expect(result.success).toBe(true);
    expect(result.data?.sceneId).toBe('scene-2a');
    expect(result.data?.beats?.[0]?.text).toContain('You step into');
    expect(writer.calls).toBe(2);
  });

  it('includes adapted scene-craft guidance and StoryRPG-shaped few-shot example', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const prompt = (writer as any).getAgentSpecificPrompt();
    expect(prompt).toContain('scene takeaways');
    expect(prompt).toContain('Do not use film/camera direction terms in player-facing prose');
    expect(prompt).not.toMatch(/restrained\s+interiority/);
    expect(prompt).not.toContain('internal monologue');
    expect(prompt).toContain('Example: StoryRPG SceneWriter Beat Scale');
    expect(prompt).toContain('Prefer turns over topics');
    expect(prompt).toContain('leverage, trust, evidence');
    expect(prompt).toContain('Vivid means vivid story intent');
    expect(prompt).toContain('The scene keyMoment should be the beat where those takeaways become felt, proven, revealed, or changed');
    expect(prompt).toContain('Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context');
    expect(prompt).toContain('Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors');
    expect(prompt).toContain('Visual metadata should describe what must be understood, not impose a conflicting style');
    expect(prompt).toContain('Do not directly describe characters\' thoughts and feelings');
    expect(prompt).toContain('externalize inner life');
    expect(prompt).toContain('## Fight, Weapon, And Physical Action Scenes');
    expect(prompt).toContain('specific strikes, maneuvers');
    expect(prompt).toContain('destructive effects');
    expect(prompt).toContain('wounds, or damage');
    expect(prompt).toContain('## Conflict Damage');
    expect(prompt).toContain('## Prose And Dialogue Craft');
    expect(prompt).toContain('Use sensory detail selectively and purposefully');
    expect(prompt).toContain('Do not force all five senses into every beat');
    expect(prompt).toContain('Respect the active source style, genre, tone, user instructions, and style guide');
    expect(prompt).toContain('Use precise, concrete, genre-appropriate language');
    expect(prompt).toContain('not ornate prose or conflicting art direction');
    expect(prompt).toContain('Make description dynamic');
    expect(prompt).toContain('spare, natural, character-specific, pressure-aware, and subtextual');
    expect(prompt).toContain('Vary sentence rhythm with scene pressure');
    expect(prompt).toContain('Avoid repetition');
  });

  it('includes scene-specific target guidance for takeaways, clarity, and style-safe visual metadata', () => {
    const writer = createWriter();
    const prompt = (writer as any).buildPrompt(preEncounterInput);

    expect(prompt).toContain('The scene keyMoment should be the beat where sceneTakeaways become felt, proven, revealed, or changed');
    expect(prompt).toContain('Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence');
    expect(prompt).toContain('fill them naturally with local detail');
    expect(prompt).toContain('Vivid means vivid story intent');
    expect(prompt).toContain('unless they come from the active style contract');
    expect(prompt).toContain('The final beat of each scene should land a pointed resolution or consequence');
    expect(prompt).toContain('Never write a static meeting where characters only discuss information');
    expect(prompt).toContain('In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm');
    expect(prompt).toContain('Every meaningful conflict should damage someone or something');
    expect(prompt).toContain('Use selective sensory detail to establish place, mood, danger, intimacy, texture, or consequence');
    expect(prompt).toContain('Respect active source style, genre, tone, user instructions, and style guide');
    expect(prompt).toContain('Make description carry pressure, movement, mood, threat, desire, or consequence');
    expect(prompt).toContain('Reveal inner life through action, speech, silence, bodily response, facial expression, object handling, proximity, risk, and choice behavior');
    expect(prompt).toContain('Avoid repeated plot events, dialogue, scene shapes, and descriptive phrasing unless intentional callback/payoff');
  });

  it('tells pre-encounter scenes to build toward, not spend, the encounter event', () => {
    const writer = createWriter();
    const prompt = (writer as any).buildPrompt({
      ...preEncounterInput,
      episodeEncounterContext: {
        encounterType: 'romantic',
        encounterDescription: 'The rooftop gaze turns into a foggy park attack and rescue.',
        encounterDifficulty: 'moderate',
        encounterBuildup: 'Foreshadow the park danger without staging it.',
      },
    });

    expect(prompt).toContain('Do NOT depict the encounter');
    expect(prompt).toContain('leave the event itself for the encounter scene');
  });

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

  it('promotes a turn beat to dominant when the writer returns no dominant beat', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-peakless',
      sceneName: 'The Quiet Corridor',
      beats: [
        { id: 'b1', text: 'She walks the long corridor, counting the doors.', nextBeatId: 'b2', intensityTier: 'rest' },
        { id: 'b2', text: 'A figure steps from the shadows and blocks her path.', nextBeatId: 'b3', intensityTier: 'supporting', isKeyStoryBeat: true },
        { id: 'b3', text: 'She decides whether to run or hold her ground.', intensityTier: 'supporting', isChoicePoint: true },
      ],
      startingBeatId: 'b1',
      moodProgression: ['tense'],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    const dominants = normalized.beats.filter((b: any) => b.intensityTier === 'dominant');
    expect(dominants).toHaveLength(1);
    // The key-story beat is the turn, so it gets promoted (not the rest beat).
    expect(dominants[0].id).toBe('b2');
  });

  it('leaves an existing dominant beat untouched', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-has-peak',
      sceneName: 'The Reveal',
      beats: [
        { id: 'b1', text: 'The room is silent before the announcement lands.', nextBeatId: 'b2', intensityTier: 'rest' },
        { id: 'b2', text: 'The truth detonates across the table.', intensityTier: 'dominant', isChoicePoint: true },
      ],
      startingBeatId: 'b1',
      moodProgression: ['tense'],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    const dominants = normalized.beats.filter((b: any) => b.intensityTier === 'dominant');
    expect(dominants.map((b: any) => b.id)).toEqual(['b2']);
  });

  it('canonicalizes a bare textVariant callbackHookId to its planted flag: hook id', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-7',
        sceneName: 'The Reckoning',
        beats: [
          {
            id: 'beat-1',
            text: 'The corridor still smells of smoke.',
            textVariants: [
              {
                // The bug (bite-me-g14): agent copies the condition flag NAME into
                // callbackHookId instead of the planted `flag:`-prefixed hook id.
                condition: { type: 'flag', flag: 'treatment_seed_ep1_3', value: true },
                text: 'The key card you palmed back then still opens the door.',
                callbackHookId: 'treatment_seed_ep1_3',
              },
              {
                // An already-canonical id must pass through untouched.
                condition: { type: 'flag', flag: 'protected_brightwell', value: true },
                text: 'Brightwell meets your eye, remembering.',
                callbackHookId: 'flag:protected_brightwell',
              },
            ],
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: { id: 'scene-7', name: 'The Reckoning' },
        unresolvedCallbacks: [
          { id: 'flag:treatment_seed_ep1_3', sourceEpisode: 1, summary: 'You palmed the key card.', flags: ['treatment_seed_ep1_3'] },
          { id: 'flag:protected_brightwell', sourceEpisode: 1, summary: 'You shielded Brightwell.', flags: ['protected_brightwell'] },
        ],
      }
    );

    const variants = normalized.beats[0].textVariants;
    expect(variants[0].callbackHookId).toBe('flag:treatment_seed_ep1_3');
    expect(variants[1].callbackHookId).toBe('flag:protected_brightwell');
  });

  it('drops a structural-flag callbackHookId (branch-axis mislabel) but keeps condition.flag', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-1',
        sceneName: 'The Sachet',
        beats: [
          {
            id: 'beat-1',
            text: 'Stela slides the sachet into your palm.',
            textVariants: [
              {
                // The bug (bite-me-g14 2026-06-11): branch-reconvergence residue gated
                // on a real seed flag was ALSO tagged with a callbackHookId pointing at
                // a `treatment_branch_` axis flag — which the ledger never plants, so the
                // dangling-payoff gate aborted the Season Canon seal.
                condition: { type: 'flag', flag: 'treatment_seed_ep1_1', value: true },
                text: "Stela's fingers brush the quartz at your hip when she slides the sachet into your palm.",
                callbackHookId: 'treatment_branch_mika_s_crossroad_read_gently_vs_read_cruelly',
              },
            ],
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      { sceneBlueprint: { id: 'scene-1', name: 'The Sachet' } }
    );

    const variant = normalized.beats[0].textVariants[0];
    expect(variant.callbackHookId).toBeUndefined();
    // The legitimate branch-residue gating is preserved.
    expect(variant.condition.flag).toBe('treatment_seed_ep1_1');
  });

  it('drops an encounter-outcome callbackHookId mislabel but keeps the outcome gating (bite-me-g13 2026-06-12)', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 's1-5',
        sceneName: 'Morning After',
        beats: [
          {
            id: 'beat-1',
            text: 'Morning light through the kitchen window.',
            textVariants: [
              {
                // The bug (bite-me-g13 2026-06-12T18-45): correct reconvergence
                // residue gated on the encounter outcome flag, but the flag name
                // was ALSO copied into callbackHookId — the ledger never plants
                // encounter_* state flags, so Season Canon aborted on a dangling payoff.
                condition: { type: 'flag', flag: 'encounter_treatment-enc-1-1_partialVictory', value: true },
                text: 'Your scarf still smells of wet grass; a bruise blooms at your wrist.',
                callbackHookId: 'encounter_treatment-enc-1-1_partialVictory',
              },
            ],
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      { sceneBlueprint: { id: 's1-5', name: 'Morning After' } }
    );

    const variant = normalized.beats[0].textVariants[0];
    expect(variant.callbackHookId).toBeUndefined();
    expect(variant.condition.flag).toBe('encounter_treatment-enc-1-1_partialVictory');
  });

  it('normalizes optional sceneTakeaways and transitionIn metadata', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'A Clean Exit',
      beats: [],
      startingBeatId: '',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
      sceneTakeaways: 'Mara learns the safe route was sold.',
      transitionIn: 42,
    });

    expect(normalized.sceneTakeaways).toEqual(['Mara learns the safe route was sold.']);
    expect(normalized.transitionIn).toBe('42');
  });

  it('strips agent-facing pressure notes from player-facing beat text and prompts', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Ambush at the Gate',
        description: 'The escort is hit from both sides.',
        location: 'road',
        mood: 'urgent',
        purpose: 'branch',
        narrativeFunction: 'Force Aethavyr to choose who receives protection first.',
        dramaticQuestion: 'Who does Aethavyr protect first?',
        wantVsNeed: 'Duty versus earned loyalty',
        conflictEngine: 'Arrows split the formation.',
        npcsPresent: ['brightwell', 'lysandra'],
        keyBeats: [
          'Pressure: Lord Brightwell stumbles under the first volley.',
          'Choice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty. COST: leave one exposed. IDENTITY: who counts first?',
          'Forward pressure: The exposed person remembers who Aethavyr chose.',
        ],
        leadsTo: [],
      },
      storyContext: {
        title: 'Test Story',
        genre: 'fantasy',
        tone: 'urgent',
        worldContext: 'A roadside ambush.',
      },
      protagonistInfo: {
        name: 'Aethavyr',
        pronouns: 'they/them',
        description: 'A sworn protector.',
      },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('- Lord Brightwell stumbles under the first volley.');
    expect(prompt).not.toContain('Choice pressure:');
    expect(prompt).not.toContain('Forward pressure:');

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Ambush at the Gate',
      beats: [{
        id: 'beat-1',
        text: 'Aethavyr hears the first arrow hit the carriage.\n\nChoice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty.',
      }],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    }, input);

    expect(normalized.beats[0].text).not.toContain('Choice pressure:');
    expect(normalized.beats[0].text).toContain('Aethavyr hears the first arrow hit the carriage.');
  });

  it('injects the required-beats checklist into the prompt when the blueprint carries requiredBeats (treatment-sourced)', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-2-3',
        name: 'The Battlement Leap',
        description: 'Darian storms the wall; Aethavyr is tested.',
        location: 'fort wall',
        mood: 'tense',
        purpose: 'bottleneck',
        narrativeFunction: 'Dramatize the authored Ep2 naming/leap turn.',
        dramaticQuestion: 'Does Aethavyr act?',
        wantVsNeed: 'Instinct versus self-doubt',
        conflictEngine: 'Darian breaches the battlement.',
        npcsPresent: [],
        keyBeats: ['The wall is breached.'],
        leadsTo: [],
        signatureMoment: 'Lysandra names him Aethavyr after the leap.',
        requiredBeats: [
          { id: 's2-3-rb1', sourceTurn: 'turn A', mustDepict: 'Darian assaults the battlement.', tier: 'authored' },
          { id: 's2-3-rb2', sourceTurn: 'turn B', mustDepict: 'Aethavyr makes an instinctive rescue leap.', tier: 'authored' },
        ],
      },
      storyContext: { title: 'Endsong', genre: 'fantasy', tone: 'epic', worldContext: 'A besieged fort.' },
      protagonistInfo: { name: 'Aethavyr', pronouns: 'they/them', description: 'A nascent dragon.' },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('REQUIRED BEATS — depict each, in order');
    expect(prompt).toContain('1. [authored] Darian assaults the battlement.');
    expect(prompt).toContain('2. [authored] Aethavyr makes an instinctive rescue leap.');
    expect(prompt).toContain('Signature moment (MUST be depicted, never inverted):');
    expect(prompt).toContain('Lysandra names him Aethavyr after the leap.');
    // Ordering preserved in the rendered prompt.
    expect(prompt.indexOf('Darian assaults')).toBeLessThan(prompt.indexOf('instinctive rescue leap'));
  });

  it('injects narrative mechanic pressure contracts into the prompt without exposing them as player-facing mechanics', () => {
    const writer = createWriter();
    const input = {
      sceneBlueprint: {
        id: 's1-1',
        name: 'Club Door',
        description: 'Mika tests Kylie at the door.',
        location: 'Vâlcescu Club',
        mood: 'charged',
        purpose: 'transition',
        narrativeFunction: 'The key card becomes access leverage.',
        dramaticQuestion: 'What does accepting the card cost?',
        wantVsNeed: 'Kylie wants inside but needs to understand the obligation.',
        conflictEngine: 'Mika offers access as a test.',
        npcsPresent: ['mika'],
        keyBeats: ['Mika offers the side-door card.'],
        leadsTo: ['s1-2'],
        mechanicPressure: [{
          id: 's1-1-pressure-keycard',
          source: 'treatment',
          domain: 'item',
          mechanicRef: { itemId: 'key-card' },
          function: 'plant',
          storyPressure: 'The key card creates access leverage and obligation.',
          evidenceRequired: ['show Mika testing Kylie'],
          visibleResidue: ['the card remains visible as access and obligation'],
          allowedPayoffs: ['side entrance access'],
          blockedPayoffs: ['instant friendship'],
        }],
      },
      storyContext: { title: 'Bite Me', genre: 'urban fantasy', tone: 'sensual', worldContext: 'Bucharest nightlife.' },
      protagonistInfo: { name: 'Kylie', pronouns: 'she/her', description: 'New in the city.' },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('Narrative Mechanic Pressure Contracts');
    expect(prompt).toContain('The key card creates access leverage and obligation.');
    expect(prompt).toContain('Do not state flags, scores, thresholds, or contract labels.');
    expect(prompt).toContain('access, leverage, memory, suspicion');
  });

  it('forbids a competing terminal cliffhanger object when a cliffhanger plan is supplied', () => {
    const writer = createWriter();
    const input = {
      sceneBlueprint: {
        id: 's3-6', name: 'An Uninvited Gift', description: 'The walk home.', location: 'apartment',
        mood: 'unease', purpose: 'release', narrativeFunction: 'Close the weekend.',
        dramaticQuestion: 'Who is courting her honestly?', wantVsNeed: 'safety vs desire',
        conflictEngine: 'Two suitors.', npcsPresent: [], keyBeats: [], leadsTo: [],
      },
      storyContext: { title: 'Bite Me', genre: 'romance', tone: 'noir', worldContext: 'Bucharest.' },
      protagonistInfo: { name: 'Kylie', pronouns: 'she/her', description: 'A food writer.' },
      npcs: [], targetBeatCount: 4, dialogueHeavy: false,
      cliffhangerPlan: {
        style: 'serialized_tv', mappedStructuralRole: 'rising', type: 'mystery', intensity: 'high',
        hook: 'A hand-knit scarf on her doormat, a note: "Thought you\'d be cold. — R."',
        setup: 'Radu was seeded all episode.', resolvedEpisodeTension: 'She felt lucky.',
        newOpenQuestion: 'Which man is honest?', emotionalCharge: 'lucky tilting to unease',
        nextEpisodePressure: 'The mountain weekend.',
      },
    } as any;
    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('single closing image');
    expect(prompt).toMatch(/do NOT invent a SECOND, competing terminal object/i);
  });

  it('renders the HOLD-THESE-LINES invariant block when the blueprint carries invariants', () => {
    const writer = createWriter();
    const base = {
      sceneBlueprint: {
        id: 's2-6', name: 'The Debrief', description: 'Morning after.', location: 'apartment',
        mood: 'warm', purpose: 'release', narrativeFunction: 'Close ep2.', dramaticQuestion: 'How brave?',
        wantVsNeed: 'voice vs adoration', conflictEngine: 'Two suitors.', npcsPresent: [], keyBeats: [], leadsTo: [],
      },
      storyContext: { title: 'Bite Me', genre: 'romance', tone: 'noir', worldContext: 'Bucharest.' },
      protagonistInfo: { name: 'Kylie', pronouns: 'she/her', description: 'A food writer.' },
      npcs: [], targetBeatCount: 4, dialogueHeavy: false,
    } as any;
    const withInv = (writer as any).buildPrompt({ ...base, sceneBlueprint: { ...base.sceneBlueprint, invariants: ['does not go home with him'] } });
    expect(withInv).toContain('HOLD THESE LINES');
    expect(withInv).toContain('The protagonist does not go home with him.');
    // No invariants → the block is absent (and adds no stray content).
    const without = (writer as any).buildPrompt(base);
    expect(without).not.toContain('HOLD THESE LINES');
  });

  it('leaves the prompt unchanged (no required-beats checklist) for from-scratch scenes', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-1',
        name: 'A Quiet Morning',
        description: 'Nothing authored here.',
        location: 'village',
        mood: 'calm',
        purpose: 'transition',
        narrativeFunction: 'Establish the village.',
        dramaticQuestion: 'What is normal?',
        wantVsNeed: 'Comfort versus restlessness',
        conflictEngine: 'Routine.',
        npcsPresent: [],
        keyBeats: ['The day begins.'],
        leadsTo: [],
      },
      storyContext: { title: 'Test', genre: 'fantasy', tone: 'calm', worldContext: 'A village.' },
      protagonistInfo: { name: 'Ren', pronouns: 'they/them', description: 'A farmhand.' },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).not.toContain('REQUIRED BEATS');
    expect(prompt).not.toContain('Signature moment (MUST be depicted');
  });

  it('flags unresolved schema variables in player-facing beat text', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Placeholder Leak',
        beats: [{ id: 'beat-1', text: '{Protagonist} reaches the tower.' }],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Placeholder Leak',
          description: 'A bad placeholder leaks into prose.',
          location: 'tower',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Will it leak?',
          wantVsNeed: 'Fix vs fail',
          conflictEngine: 'The prompt.',
          npcsPresent: [],
          keyBeats: [],
          leadsTo: [],
        },
        targetBeatCount: 1,
      },
    );

    expect(issues.join('\n')).toContain('SCHEMA PLACEHOLDER LEAK');
  });

  it('adds POV clarity feedback when the opening beat does not anchor the player character', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Unanchored Opening',
        beats: [{ id: 'beat-1', text: 'Mara waits beside the black gate while fog closes over the road.' }],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: ['mara'],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Unanchored Opening',
          description: 'The player arrives at the gate.',
          location: 'gate',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Who is here?',
          wantVsNeed: 'Clarity vs drift',
          conflictEngine: 'A foggy opening.',
          npcsPresent: ['mara'],
          keyBeats: [],
          leadsTo: [],
        },
        protagonistInfo: {
          name: 'Alex',
          pronouns: 'they/them',
          description: 'The player character.',
        },
        npcs: [{
          id: 'mara',
          name: 'Mara',
          pronouns: 'she/her',
          description: 'A wary ally.',
          voiceNotes: '',
        }],
        targetBeatCount: 1,
      },
    );

    expect(issues.join('\n')).toContain('POV CLARITY');
  });

  it('adds fiction-first turn audit feedback for repeated topic beats', () => {
    const writer = createWriter();
    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Topic Chain',
        beats: [
          {
            id: 'beat-1',
            text: 'Mara explains the old rule while Alex listens.',
            shotType: 'character',
            primaryAction: 'Mara explains the old rule',
          },
          {
            id: 'beat-2',
            text: 'Alex observes the room and thinks about what it means.',
            shotType: 'character',
            primaryAction: 'Alex observes the room',
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Topic Chain',
          description: 'Two people discuss a charm.',
          location: 'cafe',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Will it turn?',
          wantVsNeed: 'Know vs admit',
          conflictEngine: 'Evasion.',
          npcsPresent: [],
          keyBeats: [],
          leadsTo: [],
        },
        targetBeatCount: 2,
      },
    );

    expect(issues.join('\n')).toContain('FICTION-FIRST TURN TOPIC_RUN');
  });
});

describe('SceneWriter dramatic intent visual contracts', () => {
  it.each([
    [
      'dialogue',
      {
        id: 'beat-dialogue',
        text: 'Mrs. Constantinou reports what she witnessed, clutching her shopping bag as Daphne listens.',
        primaryAction: 'Mrs. Constantinou reports what she witnessed',
      },
    ],
    [
      'investigation',
      {
        id: 'beat-investigation',
        text: 'Daphne studies the phone photo, noticing the flowers blooming from the asphalt behind Alex.',
        primaryAction: 'Daphne notices the evidence',
      },
    ],
    [
      'romance',
      {
        id: 'beat-romance',
        text: 'Alex deflects with practiced charm, brushing Daphne\'s knuckles while avoiding the question.',
        primaryAction: 'Alex deflects with practiced charm',
      },
    ],
    [
      'action',
      {
        id: 'beat-action',
        text: 'Daphne reaches across the counter and pulls the cracked charm into the light.',
      },
    ],
    [
      'quiet interiority',
      {
        id: 'beat-quiet',
        text: 'Yiayia Eleni observes the situation, her hands stilling in the flour as the room goes quiet.',
        primaryAction: 'Yiayia Eleni observes the situation',
        intensityTier: 'rest' as const,
      },
    ],
    [
      'comedy',
      {
        id: 'beat-comedy',
        text: 'Alex smiles too brightly and checks his phone upside down, trying to pretend nothing strange happened.',
        primaryAction: 'Alex smiles',
      },
    ],
  ])('strengthens %s beats with visible dramatic intent', (_kind, beat) => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Dramatic Intent',
      beats: [{ shotType: 'character', ...beat }],
      startingBeatId: beat.id,
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    const strengthened = normalized.beats[0];
    expect(strengthened.dramaticIntent?.visibleTurn).toBeTruthy();
    expect(strengthened.dramaticIntent?.visualSubtextCue).toBeTruthy();
    expect(strengthened.dramaticIntent?.obstacle).toBeTruthy();
    expect(strengthened.sequenceIntent?.objective).toBeTruthy();
    expect(strengthened.sequenceIntent?.visualThread).toBeTruthy();
    expect(strengthened.sequenceIntent?.beatRole).toBeTruthy();
    expect(strengthened.coveragePlan?.shotDistance).toBeTruthy();
    expect(strengthened.coveragePlan?.cameraAngle).toBeTruthy();
    expect(strengthened.coveragePlan?.coverageReason).toContain(strengthened.sequenceIntent?.beatRole);
    expect(strengthened.primaryAction).not.toMatch(/reports what she witnessed|observes the situation|deflects with practiced charm|^Alex smiles$/i);
    expect(strengthened.primaryAction).not.toContain('takes a decisive physical action');
    expect(strengthened.visualMoment).toContain(strengthened.dramaticIntent.visibleTurn.split(' ')[0]);
  });

  it('does not replace already concrete physical actions', () => {
    const writer = createWriter();
    const beat = {
      id: 'beat-concrete',
      text: 'Daphne reaches across the counter and pulls the cracked charm into the light.',
      shotType: 'action' as const,
      primaryAction: 'Daphne reaches across the counter',
    };

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Concrete Action',
      beats: [beat],
      startingBeatId: beat.id,
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    expect(normalized.beats[0].primaryAction).toBe('Daphne reaches across the counter');
    expect(normalized.beats[0].dramaticIntent?.visibleTurn).toBeTruthy();
    expect(normalized.sequenceIntent?.objective).toBeTruthy();
    expect(normalized.beats[0].sequenceIntent?.turningPoint).toBeTruthy();
  });

  it('derives a quiet rest sequence as recalibration instead of random stillness', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-rest',
      sceneName: 'Aftermath',
      beats: [
        {
          id: 'beat-rest',
          text: 'Mara sits alone after the argument, turning the ring in her fingers until her breathing steadies.',
          shotType: 'character' as const,
          intensityTier: 'rest' as const,
        },
      ],
      startingBeatId: 'beat-rest',
      moodProgression: [],
      charactersInvolved: ['Mara'],
      keyMoments: [],
      continuityNotes: [],
    });

    expect(normalized.sequenceIntent?.activity).toMatch(/quiet recovery|visible exchange|recovery/i);
    expect(normalized.beats[0].sequenceIntent?.beatRole).toBe('aftermath');
    expect(normalized.beats[0].sequenceIntent?.visualThread).toBeTruthy();
    expect(normalized.beats[0].coveragePlan?.stagingPattern).toBeTruthy();
  });
});

describe('buildSourceMaterialFidelitySection', () => {
  it('includes the new writing style guide in scene-writing context', () => {
    const section = buildSourceMaterialFidelitySection({
      writingStyleGuide: {
        source: 'explicit_prompt',
        summary: 'Spare noir prose.',
        narrativeVoice: 'Dry, watchful, close to the protagonist.',
        sentenceRhythm: 'Short lines with occasional hard pivots.',
        diction: 'Plain words, street-level metaphors.',
        dialogueStyle: 'Clipped and evasive.',
        povAndDistance: 'Close third person.',
        imageryAndSensoryFocus: 'Rain, neon, stale coffee.',
        pacing: 'Fast through action, slower on suspicion.',
        doList: ['Use concrete noir detail.'],
        avoidList: ['Avoid purple prose.'],
        evidence: ['Write in spare noir prose.'],
      },
      directLanguageFragments: {
        dialogue: ['Everyone owes someone.'],
        prose: ['Rain turned the harbor lights into bruises.'],
        terminology: ['dockside'],
      },
    } as SourceMaterialAnalysis);

    expect(section).toContain('Writing Style Guide (explicit_prompt)');
    expect(section).toContain('Spare noir prose.');
    expect(section).toContain('Everyone owes someone.');
    expect(section).toContain('dockside');
  });

  it('handles legacy flat direct-language fragments without crashing', () => {
    const section = buildSourceMaterialFidelitySection({
      directLanguageFragments: [
        { text: 'The old road remembered every footstep.', context: 'prose' },
        { text: 'Stay behind me.', context: 'dialogue', speaker: 'Ari' },
      ],
    } as SourceMaterialAnalysis);

    expect(section).toContain('The old road remembered every footstep.');
    expect(section).toContain('Stay behind me.');
  });
});
