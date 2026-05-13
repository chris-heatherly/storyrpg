import { describe, expect, it } from 'vitest';

import { buildSourceMaterialFidelitySection, SceneWriter } from './SceneWriter';
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
    expect(prompt).toMatch(/restrained\s+interiority/);
    expect(prompt).toContain('Example: StoryRPG SceneWriter Beat Scale');
    expect(prompt).toContain('Prefer turns over topics');
    expect(prompt).toContain('leverage, trust, evidence');
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
