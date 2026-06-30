import { describe, expect, it } from 'vitest';
import { compileStoryboardScenePacket } from './storyboardCompiler';

const characterBible: any = {
  characters: [
    {
      id: 'hero',
      name: 'Mara',
      physicalDescription: 'short silver hair, brown skin, storm-gray cloak',
      typicalAttire: 'travel-worn cloak and brass clasp',
      distinctiveFeatures: ['scar through left eyebrow'],
    },
    {
      id: 'rival',
      name: 'Ilya',
      physicalDescription: 'tall, narrow face, black braid',
      typicalAttire: 'formal blue coat',
      distinctiveFeatures: ['opal signet ring'],
    },
  ],
};

describe('compileStoryboardScenePacket', () => {
  it('passes scene and beat sequence intent into storyboard panel slots', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-seq',
      protagonistId: 'hero',
      protagonistName: 'Mara',
      characterBible,
      scene: {
        sceneId: 'scene-seq',
        sceneName: 'The Walk',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        sequenceIntent: {
          objective: 'Mara reaches the store while hiding the letter.',
          activity: 'walking to the store under social pressure',
          obstacle: 'Ilya notices she is guarding the letter.',
          startState: 'Mara has the letter hidden.',
          turningPoint: 'The letter almost slips into view.',
          endState: 'Ilya knows she is hiding something.',
          visualThread: 'the folded letter in Mara’s hand',
        },
        beats: [
          {
            id: 'b1',
            text: 'Mara walks toward the store with the letter hidden in her fist.',
            speaker: 'Mara',
            primaryAction: 'Mara hides the letter while walking',
          },
        ],
      } as any,
    });

    expect(packet.sequenceIntent?.objective).toContain('reaches the store');
    expect(packet.panels[0].sequenceIntent?.visualThread).toContain('folded letter');
  });

  it('canonicalizes p1 and named beat text to CharacterBible ids', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-1',
      protagonistId: 'p1',
      protagonistName: 'Daphne Papadopoulos',
      characterBible: {
        characters: [
          {
            id: 'char-daphne-papadopoulos',
            name: 'Daphne Papadopoulos',
            physicalDescription: 'curly dark hair, expressive face',
          },
          {
            id: 'char-eros-alex-kiriakis',
            name: 'Alex Kiriakis',
            physicalDescription: 'warm brown eyes, mythic charm',
          },
        ],
      } as any,
      scene: {
        sceneId: 'scene-1',
        sceneName: 'Cafe',
        startingBeatId: 'b1',
        charactersInvolved: ['p1'],
        beats: [
          {
            id: 'b1',
            text: 'Alex studies {{player.their}} face while Daphne waits for his answer.',
            speaker: 'Alex',
            primaryAction: 'Alex leans toward Daphne',
          },
        ],
      } as any,
    });

    expect(packet.characters.map((character) => character.id)).toEqual(expect.arrayContaining([
      'char-daphne-papadopoulos',
      'char-eros-alex-kiriakis',
    ]));
    expect(packet.panels[0].visibleCharacterIds).toEqual(expect.arrayContaining([
      'char-daphne-papadopoulos',
      'char-eros-alex-kiriakis',
    ]));
    expect(packet.panels[0].unresolvedCharacterIds).toBeUndefined();
    expect(packet.panels[0].characterAliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ input: 'Alex', canonicalId: 'char-eros-alex-kiriakis' }),
    ]));
  });

  it('resolves slash names and nicknames to one canonical character id without confusing shared names', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-1',
      protagonistId: 'p1',
      protagonistName: 'Daphne Papadopoulos',
      characterBible: {
        characters: [
          {
            id: 'char-daphne-papadopoulos',
            name: 'Daphne Papadopoulos',
            aliases: ['Daph'],
            physicalDescription: 'curly dark hair, expressive face',
          },
          {
            id: 'char-erosalex-kiriakis',
            name: 'Eros/Alex Kiriakis',
            aliases: ['Alex', 'Eros'],
            physicalDescription: 'warm brown eyes, mythic charm',
          },
          {
            id: 'char-alexandra-stone',
            name: 'Alexandra Stone',
            aliases: ['Alex'],
            physicalDescription: 'short blonde hair, severe black suit',
          },
        ],
      } as any,
      scene: {
        sceneId: 'scene-1',
        sceneName: 'Courtyard',
        startingBeatId: 'b1',
        charactersInvolved: ['p1', 'char-erosalex-kiriakis'],
        beats: [
          {
            id: 'b1',
            text: 'Eros Kiriakis steps between Daphne and the shouting guests.',
            speaker: 'Alex Kiriakis',
            primaryAction: 'Alex Kiriakis shields Daphne with one hand raised',
          },
        ],
      } as any,
    });

    expect(packet.panels[0].visibleCharacterIds).toEqual(expect.arrayContaining([
      'char-daphne-papadopoulos',
      'char-erosalex-kiriakis',
    ]));
    expect(packet.panels[0].visibleCharacterIds).not.toContain('char-alexandra-stone');
    expect(packet.panels[0].characterAliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ input: 'Alex Kiriakis', canonicalId: 'char-erosalex-kiriakis' }),
    ]));
  });

  it('does not detect short names across adjacent words after compacting punctuation', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-2a',
      protagonistId: 'char-daphne-papadopoulos',
      protagonistName: 'Daphne Papadopoulos',
      characterBible: {
        characters: [
          {
            id: 'char-daphne-papadopoulos',
            name: 'Daphne Papadopoulos',
            physicalDescription: 'expressive dark eyes',
          },
          {
            id: 'char-erosalex-kiriakis',
            name: 'Eros/Alex Kiriakis',
            aliases: ['Alex', 'Eros'],
            physicalDescription: 'storm-dark eyes',
          },
          {
            id: 'char-hera',
            name: 'Hera',
            physicalDescription: 'regal bearing',
          },
        ],
      } as any,
      scene: {
        sceneId: 'scene-2a',
        sceneName: 'Direct Confrontation',
        startingBeatId: 'beat-8',
        beats: [
          {
            id: 'beat-8',
            text: "Something shifts behind Alex's eyes-like watching storm clouds gather.",
            speaker: 'Alex',
            visualMoment: "Alex's expression transforms from evasive to intensely serious",
            emotionalRead: 'Alex turns serious while Daphne freezes in shock',
          },
        ],
      } as any,
    });

    expect(packet.panels[0].visibleCharacterIds).toEqual(expect.arrayContaining([
      'char-erosalex-kiriakis',
      'char-daphne-papadopoulos',
    ]));
    expect(packet.panels[0].visibleCharacterIds).not.toContain('char-hera');
  });

  it('creates regular beat panels with visible character ids', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-1',
      protagonistId: 'hero',
      characterBible,
      scene: {
        sceneId: 'scene-1',
        sceneName: 'The Bridge',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'rival'],
        settingContext: { description: 'A rain-slick bridge' },
        moodProgression: ['tense'],
        keyMoments: [],
        continuityNotes: [],
        beats: [
          { id: 'b1', text: 'Mara steps toward Ilya.', speaker: 'Mara' },
        ],
      } as any,
    });

    expect(packet.panels).toHaveLength(1);
    expect(packet.panels[0].family).toBe('story-beat');
    expect(packet.panels[0].visibleCharacterIds).toEqual(['hero', 'rival']);
  });

  it('allows generic background extras without unresolved character warnings', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-4',
      protagonistId: 'hero',
      characterBible,
      scene: {
        sceneId: 'scene-4',
        sceneName: 'The Street',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [
          {
            id: 'b1',
            text: 'A Pedestrian dodges the return sign while Mara reaches for the curb.',
            speaker: 'Mara',
            visibleCharacterIds: ['Pedestrian'],
          },
        ],
      } as any,
    });

    expect(packet.panels[0].visibleCharacterIds).toEqual(['hero']);
    expect(packet.panels[0].unresolvedCharacterIds).toBeUndefined();
    expect(packet.panels[0].characterResolutionWarnings).toBeUndefined();
    expect(packet.diagnostics?.unresolvedCharacterIds).toEqual([]);
  });

  it('does not pass unmentioned scene-cast NPCs or anonymous doormen into prompt characters', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-3',
      protagonistId: 'char-kylie-marinescu',
      protagonistName: 'Kylie Marinescu',
      characterBible: {
        characters: [
          {
            id: 'char-kylie-marinescu',
            name: 'Kylie Marinescu',
            physicalDescription: 'blonde woman in tortoiseshell glasses',
          },
          {
            id: 'char-mika-drgan',
            name: 'Mika Drăgan',
            physicalDescription: 'platinum bob, cat-eye sunglasses',
          },
          {
            id: 'char-victor-vlcescu',
            name: 'Victor Vâlcescu',
            physicalDescription: 'tall aristocratic man in a dark suit',
          },
        ],
      } as any,
      scene: {
        sceneId: 'scene-3',
        sceneName: 'Vâlcescu Club Door',
        startingBeatId: 'b1',
        charactersInvolved: ['char-kylie-marinescu', 'char-mika-drgan', 'char-victor-vlcescu'],
        beats: [
          {
            id: 'b1',
            text: "You stand before Vâlcescu Club's velvet rope while the anonymous doorman looks over your dress.",
            visibleCharacterIds: ['doorman'],
          },
          {
            id: 'b2',
            text: 'A woman with a platinum bob appears beside you and studies the door.',
          },
        ],
      } as any,
    });

    expect(packet.characters.map((character) => character.id)).toEqual(['char-kylie-marinescu']);
    expect(packet.panels[0].visibleCharacterIds).toEqual(['char-kylie-marinescu']);
    expect(packet.panels[0].unresolvedCharacterIds).toBeUndefined();
    expect(packet.panels[0].characterResolutionWarnings).toBeUndefined();
    expect(packet.panels[1].visibleCharacterIds).toEqual(['char-kylie-marinescu']);
  });

  it('includes encounter setup, outcome, situation, and storylet panels', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-2',
      protagonistId: 'hero',
      characterBible,
      scene: {
        sceneId: 'scene-2',
        sceneName: 'The Duel',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'rival'],
        beats: [],
      } as any,
      encounter: {
        sceneId: 'scene-2',
        encounterType: 'duel',
        startingBeatId: 'e1',
        beats: [{
          id: 'e1',
          phase: 'setup',
          name: 'Blades Out',
          description: 'The duel begins.',
          setupText: 'Ilya draws steel while Mara lowers her stance.',
          choices: [{
            id: 'strike',
            text: 'Strike first',
            approach: 'bold',
            outcomes: {
              success: { tier: 'success', narrativeText: 'Mara disarms Ilya.', goalTicks: 1, threatTicks: 0 },
              complicated: {
                tier: 'complicated',
                narrativeText: 'Mara wins ground, but Ilya cuts the bridge rope.',
                goalTicks: 1,
                threatTicks: 1,
                nextSituation: { setupText: 'The bridge tilts beneath Mara.', choices: [] },
              },
              failure: { tier: 'failure', narrativeText: 'Ilya drives Mara back.', goalTicks: 0, threatTicks: 1 },
            },
          }],
        }],
        storylets: {
          victory: {
            id: 'victory',
            name: 'Aftermath',
            triggerOutcome: 'victory',
            tone: 'relieved',
            narrativeFunction: 'resolve duel',
            startingBeatId: 's1',
            consequences: [],
            beats: [{ id: 's1', text: 'Mara pockets Ilya’s opal signet ring.' }],
          },
          defeat: {
            id: 'defeat',
            name: 'Defeat',
            triggerOutcome: 'defeat',
            tone: 'somber',
            narrativeFunction: 'loss',
            startingBeatId: 'd1',
            consequences: [],
            beats: [],
          },
        },
      } as any,
    });

    expect(packet.panels.map((panel) => panel.family)).toEqual(expect.arrayContaining([
      'encounter-setup',
      'encounter-outcome',
      'encounter-situation',
      'storylet-aftermath',
    ]));
    expect(packet.panels.filter((panel) => panel.family === 'encounter-outcome')).toHaveLength(3);
  });

  it('includes every current encounter phase choice path with visual contract direction', () => {
    const packet = compileStoryboardScenePacket({
      scopedSceneId: 'episode-1-scene-3',
      protagonistId: 'hero',
      characterBible,
      scene: {
        sceneId: 'scene-3',
        sceneName: 'The Heist',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'rival'],
        beats: [],
      } as any,
      encounter: {
        npcStates: [{ npcId: 'rival' }],
        phases: [{
          beats: [{
            id: 'phase-beat-1',
            name: 'Vault Pressure',
            setupText: 'Mara and Ilya face each other beside the vault.',
            storyboardRole: 'exchange',
            visualContract: {
              visualMoment: 'hands moving over the vault lock while tempers flare',
              primaryAction: 'Mara blocks Ilya from grabbing the key',
              emotionalRead: 'furious mistrust',
              relationshipDynamic: 'alliance cracking under pressure',
            },
            choices: [{
              id: 'rush',
              text: 'Rush the vault',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Mara beats Ilya to the lock.' },
                complicated: {
                  tier: 'complicated',
                  narrativeText: 'The vault opens, but Ilya trips the alarm.',
                  visualContract: { visibleCost: 'red alarm light across Mara’s face' },
                  nextSituation: {
                    setupText: 'Sirens rise while Mara and Ilya argue over the exit.',
                    choices: [{
                      id: 'split',
                      text: 'Split up',
                      outcomes: {
                        success: { tier: 'success', narrativeText: 'Mara vanishes through smoke.' },
                      },
                    }],
                  },
                },
                failure: { tier: 'failure', narrativeText: 'Ilya shoves Mara away from the vault.' },
              },
            }],
          }],
        }],
        storylets: {},
      } as any,
    });

    expect(packet.panels.map((panel) => panel.family)).toEqual(expect.arrayContaining([
      'encounter-setup',
      'encounter-outcome',
      'encounter-situation',
    ]));
    expect(packet.panels.filter((panel) => panel.family === 'encounter-outcome')).toHaveLength(4);
    const setup = packet.panels.find((panel) => panel.family === 'encounter-setup');
    expect(setup?.visualMoment).toContain('vault lock');
    expect(setup?.storyboardRole).toBe('exchange');
    const complicated = packet.panels.find((panel) => panel.outcomeTier === 'complicated' && panel.family === 'encounter-outcome');
    expect(complicated?.visibleCost).toContain('red alarm light');
  });
});
