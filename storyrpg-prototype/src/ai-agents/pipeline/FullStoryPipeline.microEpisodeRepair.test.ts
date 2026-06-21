// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { MicroEpisodeStructureValidator } from '../validators/MicroEpisodeStructureValidator';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

describe('FullStoryPipeline sceneEpisode playable contract repair', () => {
  it('pads underfilled normal sceneEpisodes and creates a visible fallback choice set', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);
    pipeline.config = {
      generation: {
        episodeStructureMode: 'sceneEpisodes',
        sceneEpisodeNormalMinBeats: 6,
        sceneEpisodeNormalMaxBeats: 10,
      },
    };
    pipeline.emit = vi.fn();

    const sceneBlueprint = {
      id: 'scene-1',
      name: 'The Attack and Rescue',
      description: 'Kylie is attacked in the park and must choose how to respond.',
      location: 'cismigiu',
      mood: 'danger',
      purpose: 'bottleneck',
      npcsPresent: ['victor'],
      dramaticQuestion: 'Will Kylie survive without surrendering her agency?',
      conflictEngine: 'A shadow pins her before Victor appears.',
      narrativeFunction: 'The rescue leaves debt, fear, and fascination.',
      keyBeats: [
        'Pressure: A shadow detaches itself from the fog.',
        'Victor arrives faster than a human should.',
        'Forward pressure: The black roses arrive in the morning.',
      ],
      choicePoint: {
        type: 'dilemma',
        description: 'Scream, run, freeze, or fight.',
        optionHints: ['Scream', 'Run', 'Freeze', 'Fight'],
        consequenceDomain: 'relationship',
        stakes: {
          want: 'survive the attack',
          cost: 'owe Victor attention',
          identity: 'someone who can still act under terror',
        },
        reminderPlan: {
          immediate: 'Victor clocks how she responded.',
          shortTerm: 'The rescue changes the tone of the courtship.',
        },
      },
    };
    const content = {
      sceneId: 'scene-1',
      sceneName: 'The Attack and Rescue',
      startingBeatId: 'beat-1',
      moodProgression: ['danger'],
      charactersInvolved: ['victor'],
      keyMoments: ['attack', 'rescue'],
      continuityNotes: [],
      beats: [
        { id: 'beat-1', text: 'You cut through the fog.', nextBeatId: 'beat-2' },
        { id: 'beat-2', text: 'The willow branches scrape your coat.', nextBeatId: 'beat-3' },
        { id: 'beat-3', text: 'A shadow moves wrong.', nextBeatId: 'beat-4' },
        { id: 'beat-4', text: 'Cold fingers close around your throat.', isChoicePoint: true },
      ],
    };
    const choiceSets = [];

    const repaired = pipeline.repairSceneEpisodePlayableContract(
      sceneBlueprint,
      content,
      choiceSets,
      { phase: 'test_micro_episode_repair' },
    );

    expect(repaired).toBe(true);
    expect(content.beats).toHaveLength(6);
    expect(content.beats[content.beats.length - 1].isChoicePoint).toBe(true);
    expect(choiceSets).toHaveLength(1);
    expect(choiceSets[0]).toMatchObject({
      sceneId: 'scene-1',
      beatId: 'beat-4',
      choiceType: 'dilemma',
    });
    expect(choiceSets[0].choices.map(choice => choice.text)).toEqual([
      'Scream for help.',
      'Run for the open path.',
      'Freeze and read the danger.',
      'Fight back with everything you have.',
    ]);
    for (const choice of choiceSets[0].choices) {
      expect(choice.consequences).toContainEqual({
        type: 'setFlag',
        flag: choice.tintFlag,
        value: true,
      });
    }

    const choiceSet = choiceSets[0];
    const episode = {
      id: 'episode-5',
      number: 5,
      title: 'Cismigiu',
      synopsis: 'A sceneEpisode fixture.',
      startingSceneId: 'scene-1',
      scenes: [{
        id: 'scene-1',
        name: 'The Attack and Rescue',
        startingBeatId: content.startingBeatId,
        beats: content.beats.map(beat => ({
          id: beat.id,
          text: beat.text,
          nextBeatId: beat.nextBeatId,
          choices: beat.isChoicePoint ? choiceSet.choices : undefined,
        })),
      }],
    };

    const validation = new MicroEpisodeStructureValidator().validateEpisode(episode as any);
    expect(validation.valid).toBe(true);
  });

  it('preserves treatment pressure outside reader prose and strips leaked labels from beats', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);

    const sceneBlueprint = {
      id: 'scene-1',
      name: 'Ambush at the Gate',
      description: 'The escort is hit from both sides.',
      dramaticQuestion: 'Who does Aethavyr protect first?',
      keyBeats: [
        'Pressure: Lord Brightwell stumbles under the first volley.',
        'Choice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty. COST: leave one exposed. IDENTITY: who counts first?',
        'Forward pressure: The exposed person remembers who Aethavyr chose.',
      ],
      npcsPresent: ['brightwell', 'lysandra'],
    };
    const content = {
      sceneId: 'scene-1',
      sceneName: 'Ambush at the Gate',
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
      beats: [{
        id: 'beat-1',
        text: 'Aethavyr sees the first arrow split the carriage rail.\n\nChoice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty.',
        visualMoment: 'Choice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra?',
        primaryAction: 'Forward pressure: The exposed person remembers who Aethavyr chose.',
      }],
    };

    pipeline.ensureBlueprintFidelityText(sceneBlueprint, content);
    pipeline.sanitizeSceneContentForReader(sceneBlueprint, content);

    expect(content.continuityNotes.join('\n')).toContain('Agent-facing fidelity pressure preserved outside reader prose');
    expect(content.continuityNotes.join('\n')).toContain('Choice pressure:');
    expect(content.beats[0].text).toBe('Aethavyr sees the first arrow split the carriage rail.');
    expect(content.beats[0].text).not.toContain('Choice pressure:');
    expect(content.beats[0].visualMoment).toBe('Aethavyr sees the first arrow split the carriage rail.');
    expect(content.beats[0].primaryAction).toBe('Aethavyr sees the first arrow split the carriage rail.');
  });

  it('builds fallback choices with reader-facing text and a real tint surface', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);

    const choiceSet = pipeline.createFallbackSceneEpisodeChoiceSet({
      id: 's1-6',
      name: 'release scene 6',
      dramaticQuestion: 'Can Kylie understand what the warning costs?',
      dramaticPurpose: 'Aftermath that resettles stakes; serves the hook beat.',
      conflictEngine: 'Forward pressure: Stela arrives with herbs.',
      choicePoint: {
        type: 'dilemma',
        description: 'Decide how to handle release scene 6.',
        optionHints: ['Decide how to handle release scene 6.'],
        stakes: {
          want: 'Advance the goal of release scene 6',
          cost: 'Forward pressure: Stela arrives with herbs.',
          identity: 'The choice reveals the protagonist under pressure.',
        },
      },
    }, {
      id: 's1-6-b6',
      text: '"I am coming over with herbs." The line goes dead before you can reply.',
      isChoicePoint: true,
    });

    expect(choiceSet.choices).toHaveLength(3);
    for (const choice of choiceSet.choices) {
      expect(choice.text).not.toMatch(/Decide how to handle|release scene 6|Advance the goal/i);
      expect(choice.consequenceTier).toBe('sceneTint');
      expect(choice.tintFlag).toMatch(/^tint:/);
      expect(choice.consequences).toContainEqual({
        type: 'setFlag',
        flag: choice.tintFlag,
        value: true,
      });
      expect(choice.reactionText).toBeTruthy();
      expect(choice.outcomeTexts?.failure).toMatch(/complication/i);
      expect(choice.residueHints?.[0]?.kind).toBe('immediate_prose_echo');
      expect(choice.stakes.want).not.toMatch(/Advance the goal|serves the hook beat/i);
      expect(choice.stakes.cost).not.toMatch(/Forward pressure/i);
    }
  });

  it('writes choice bridge beats as story prose without internal scene tags', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);

    const bridgeText = pipeline.buildChoiceBridgeBeatText({
      id: 'choice-2',
      text: 'Call for Sylvanor.',
      feedbackCue: {
        echoSummary: 'You chose protocol over intimacy.',
        progressSummary: 'The proper order is maintained, but connection is lost.',
      },
      reminderPlan: {
        immediate: 'The proper order is maintained, but connection is lost.',
        shortTerm: 'Lysandra remembers the distance.',
      },
    });

    // The choice residue (immediate) half is reader-safe and preserved.
    expect(bridgeText).toContain('The proper order is maintained');
    // Destination is GENERIC and in-fiction — the structural scene NAME must never
    // surface (scene names are labels, not prose: "The First Clash waits ahead.").
    expect(bridgeText).not.toContain('Hidden Chamber');
    expect(bridgeText).not.toContain('The hidden chamber opens beneath the storm shelter.');
    expect(bridgeText).not.toContain('You chose');
    expect(bridgeText).not.toContain('The decision carries you');
    expect(bridgeText).not.toContain('one concrete step');
    expect(bridgeText).not.toContain('ENCOUNTER');
    expect(bridgeText).not.toContain('Episode Climax');
  });

  it('prefers authored outcome prose over generic bridge placeholders', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);

    const bridgeText = pipeline.buildChoiceBridgeBeatText({
      id: 'choice-3',
      text: 'Take the key card.',
      outcomeTexts: {
        success: 'Mika beams as the card catches the club light.',
        partial: 'The cool plastic settles into your palm, heavier than a favor should be.',
        failure: 'Your fingers fumble, and Mika catches the card before it falls.',
      },
      feedbackCue: {
        echoSummary: 'You accepted the key card.',
        progressSummary: 'The choice leaves a visible pressure in the next moment.',
      },
      reminderPlan: {
        immediate: 'The choice leaves a visible pressure in the next moment.',
        shortTerm: 'The card matters later.',
      },
    });

    expect(bridgeText).toBe('The cool plastic settles into your palm, heavier than a favor should be.');
    expect(bridgeText).not.toContain('visible pressure');
  });

  it('drops meta/design-note lead fragments and never leaks the scene name', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype);

    const bridgeText = pipeline.buildChoiceBridgeBeatText({
      id: 'choice-9',
      text: 'Pour the cordial.',
      // Planning-register lead — must be rejected, not rendered.
      feedbackCue: { progressSummary: 'In the wall-breach encounter, he remembers.' },
      reminderPlan: { immediate: 'In the next scene, this pays off.', shortTerm: 'x' },
    });

    expect(bridgeText).not.toContain('In the wall-breach encounter');
    expect(bridgeText).not.toContain('In the next scene');
    expect(bridgeText).not.toContain('encounter');
    // With no safe authored fragment, the bridge falls back to a generic in-fiction
    // line ALONE (the generic destination is no longer appended onto real prose —
    // that produced robotic structural closers in gen-5). It must be one of the
    // in-fiction options and carry no structural-scaffolding register.
    const GENERIC_FALLBACKS = [
      'What comes next is already in motion.',
      'There is no stepping back from here.',
      'The decision settles into your chest and stays there.',
      'The choice changes the air around you.',
    ];
    expect(GENERIC_FALLBACKS).toContain(bridgeText);
    expect(bridgeText).not.toMatch(/path forward is set|threshold waits/i);
  });

});
