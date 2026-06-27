import { describe, expect, it } from 'vitest';
import type { EpisodeBlueprint, StoryArchitectInput } from '../agents/StoryArchitect';
import type { Story } from '../../types';
import { TreatmentFidelityValidator } from './TreatmentFidelityValidator';

const treatmentGuidance = {
  episodePromise: 'Can Kylie start over in Bucharest without losing herself?',
  toneRegister: '95% SatC, 5% horror swerve.',
  encounterAnchors: ['Rooftop bar light; Cismigiu park dark; shadow attack staged like a meet-cute gone wrong.'],
  encounterBuildup: 'The rooftop gives her confidence before the park turns predatory.',
  majorChoicePressures: [
    'Accept Mika’s key card and Stela’s rose quartz, or keep both new friends at arm’s length.',
  ],
  alternativePaths: [
    'Accepting the quartz lets Stela ward the apartment; refusing it leaves the apartment vulnerable after reconvergence.',
  ],
  consequenceSeeds: [
    'The rose quartz, Mika’s key card, the black roses, and Stela’s dream about herbs.',
  ],
  authoredCliffhanger: 'Stela texts that she had a horrible dream and is coming over with herbs.',
};

const plannedEncounters: NonNullable<NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters']> = [{
  id: 'treatment-enc-1-1',
  type: 'dramatic',
  description: treatmentGuidance.encounterAnchors[0],
  difficulty: 'easy',
  npcsInvolved: ['Kylie', 'Victor'],
  stakes: 'Kylie learns the city can hunt back.',
  relevantSkills: ['resolve', 'perception'],
  isBranchPoint: true,
}];

function baseBlueprint(overrides: Partial<EpisodeBlueprint> = {}): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    number: 1,
    title: 'Dating After Dusk',
    synopsis: 'Kylie starts over in Bucharest.',
    arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
    themes: [],
    startingSceneId: 'scene-1',
    bottleneckScenes: ['scene-1', 'scene-3'],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
    scenes: [],
    ...overrides,
  };
}

describe('TreatmentFidelityValidator', () => {
  it('flags the Bite Me final-story drift observed in the audit', () => {
    const story = {
      id: 'bite-me-redux',
      title: 'Bite Me Redux',
      genre: 'Paranormal Romance',
      synopsis: 'Kylie starts over in Bucharest and blogs about Victor as Mr. Midnight.',
      coverImage: '',
      initialState: { attributes: {} as any, skills: {}, tags: [], inventory: [] },
      npcs: [
        { id: 'victor', name: 'Victor Vâlcescu', description: 'Mr. Midnight', role: 'antagonist' },
        { id: 'radu', name: 'Radu Stoian', description: 'The Mountain', role: 'ally' },
        { id: 'mika', name: 'Mika Drăgan', description: 'Friend', role: 'ally' },
        { id: 'stela', name: 'Stela Pavel', description: 'Friend', role: 'ally' },
      ],
      episodes: [{
        id: 'episode-1',
        number: 1,
        title: 'Dating After Dusk',
        synopsis: 'Kylie posts the blog after the park attack.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [{
          id: 'scene-1',
          name: 'The Blog',
          startingBeatId: 'beat-1',
          beats: [{
            id: 'beat-1',
            text: 'Kylie thinks about Todd and watches the blog jump to 84,127 reads after the park.',
          }],
        }],
      }],
    } satisfies Story;

    const result = new TreatmentFidelityValidator().validateFinalStory({
      story,
      expectedEpisodeCount: 8,
      sourceText: [
        'Daniel Hayes called off the engagement.',
        'Her niece Sadie has a photo on the writing desk.',
        'Lumina Books is Stela’s bookshop.',
        'The post does 80,000 reads in a week.',
        'The blog readership reaches 130,000.',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('expected 8');
    expect(result.issues.join('\n')).toContain('Daniel Hayes');
    expect(result.issues.join('\n')).toContain('Sadie');
    expect(result.issues.join('\n')).toContain('Lumina Books');
    expect(result.issues.join('\n')).toContain('80,000');
    expect(result.issues.join('\n')).toContain('130,000');
  });

  it('does not require treatment ending targets while generating a partial season slice', () => {
    const story = {
      id: 'endsong',
      title: 'Endsong',
      genre: 'Romantasy',
      synopsis: 'Aethavyr and Lysandra begin a dangerous journey.',
      coverImage: '',
      initialState: { attributes: {} as any, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [
        {
          id: 'episode-1',
          number: 1,
          title: 'Dawn in Silvermist Valley',
          synopsis: 'The escort is ambushed.',
          coverImage: '',
          startingSceneId: 'scene-1',
          scenes: [{ id: 'scene-1', name: 'Ambush', startingBeatId: 'beat-1', beats: [{ id: 'beat-1', text: 'Aethavyr protects Lysandra in the pass.' }] }],
        },
        {
          id: 'episode-2',
          number: 2,
          title: 'The Hidden Chamber',
          synopsis: 'The ruins reveal an older truth.',
          coverImage: '',
          startingSceneId: 'scene-1',
          scenes: [{ id: 'scene-1', name: 'Ruins', startingBeatId: 'beat-1', beats: [{ id: 'beat-1', text: 'Ancient murals show humans and Lyri el standing together.' }] }],
        },
      ],
    } satisfies Story;

    const result = new TreatmentFidelityValidator().validateFinalStory({
      story,
      expectedEpisodeCount: 2,
      sourceEpisodeCount: 8,
      isCompleteSeason: false,
      analysis: {
        sourceFormat: 'story_treatment',
        totalEstimatedEpisodes: 2,
        majorCharacters: [],
        keyLocations: [],
        adaptationGuidance: { elementsToPreserve: [] },
        episodeBreakdown: [{
          episodeNumber: 2,
          title: 'The Hidden Chamber',
          summary: '',
          mainCharacters: [],
          supportingCharacters: [],
          locations: [],
          keyEvents: [],
          emotionalArc: '',
          playerChoices: [],
          structuralRole: ['plotTurn1'],
          treatmentGuidance: {
            resolutionAftermath: 'The final EndSong is resolved in the Temple of Eternal Twilight.',
          },
        }],
        resolvedEndings: [{
          id: 'ending-twilight',
          name: 'The Twilight Accord',
          summary: 'Aethavyr and Lysandra unite light and shadow at the end of the season.',
          emotionalRegister: 'radiant',
          themePayoff: 'Synthesis over purity.',
          stateDrivers: [],
          targetConditions: [],
          sourceConfidence: 'explicit',
        }],
      } as any,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('does not require future whole-treatment source anchors for a partial episode slice', () => {
    const story = {
      id: 'bite-me',
      title: 'Bite Me',
      genre: 'Paranormal Romance',
      synopsis: 'Kylie begins the Bucharest season.',
      coverImage: '',
      initialState: { attributes: {} as any, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: Array.from({ length: 6 }, (_, index) => ({
        id: `episode-${index + 1}`,
        number: index + 1,
        title: `Episode ${index + 1}`,
        synopsis: 'A pressure-bearing episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [{
          id: 'scene-1',
          name: 'Bucharest Pressure',
          startingBeatId: 'beat-1',
          beats: [{ id: 'beat-1', text: 'Kylie makes a choice that changes the next episode.' }],
        }],
      })),
    } satisfies Story;

    const result = new TreatmentFidelityValidator().validateFinalStory({
      story,
      expectedEpisodeCount: 6,
      sourceEpisodeCount: 27,
      isCompleteSeason: false,
      analysis: {
        sourceFormat: 'story_treatment',
        totalEstimatedEpisodes: 27,
        majorCharacters: [],
        keyLocations: [],
        adaptationGuidance: {
          elementsToPreserve: ['Friend group dynamics and betrayals that pay off after episode 20'],
        },
        episodeBreakdown: [],
      } as any,
      sourceText: [
        'Future episodes include Club Nocturne, Daniel Hayes, Sadie, The Mountain, and Cișmigiu.',
        'The blog readership later reaches 80K, 310K, 470K, 130K, 180K, 240K, 260K, 280K, and 800K.',
      ].join('\n'),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('counts runtime encounter prose and fuzzy major-location matches in final story fidelity', () => {
    const story = {
      id: 'bite-me',
      title: 'Bite Me',
      genre: 'Paranormal Romance',
      synopsis: 'Kylie begins again in Bucharest.',
      coverImage: '',
      initialState: { attributes: {} as any, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'episode-1',
        number: 1,
        title: 'Arrival',
        synopsis: "Kylie arrives at her grandmother's Lipscani apartment.",
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [{
          id: 'scene-1',
          name: 'The Apartment',
          startingBeatId: 'beat-1',
          beats: [{
            id: 'beat-1',
            text: 'The phone keeps buzzing at the kitchen table.',
          }],
          encounter: {
            phases: [{
              beats: [{
                id: 'enc-beat-1',
                setupText: 'Choice pressure: (1) Open the laptop, or wait. (2) Block Daniel, archive his messages, or read them.',
                choices: [],
              }],
            }],
            storylets: {
              victory: {
                beats: [{
                  id: 'storylet-1',
                  text: 'Forward pressure: Because Kylie is in Bucharest with a draft file and no material. She needs a story. She goes out.',
                }],
              },
            },
          } as any,
        }],
      }],
    } satisfies Story;

    const result = new TreatmentFidelityValidator().validateFinalStory({
      story,
      expectedEpisodeCount: 1,
      sourceEpisodeCount: 27,
      isCompleteSeason: false,
      analysis: {
        sourceFormat: 'story_treatment',
        totalEstimatedEpisodes: 27,
        majorCharacters: [],
        keyLocations: [{
          id: 'loc-kylie',
          name: "Kylie's Lipscani apartment",
          description: '',
          importance: 'major',
          firstAppearance: 1,
        }],
        adaptationGuidance: { elementsToPreserve: [] },
        episodeBreakdown: [{
          episodeNumber: 1,
          title: 'Arrival',
          synopsis: '',
          sourceChapters: [],
          sourceSummary: '',
          plotPoints: [],
          mainCharacters: [],
          supportingCharacters: [],
          locations: [],
          estimatedSceneCount: 1,
          estimatedChoiceCount: 1,
          narrativeFunction: { setup: '', conflict: '', resolution: '' },
          treatmentGuidance: {
            authoredTitle: 'Arrival',
            majorChoicePressures: ['(1) Open the laptop, or wait. (2) Block Daniel, archive his messages, or read them.'],
            authoredCliffhanger: 'Because Kylie is in Bucharest with a draft file and no material. She needs a story. She goes out.',
          },
        }],
      } as any,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('matches an authored major choice pressure that appears only in inflected forms', () => {
    // Regression: the episode manifests "Answer Radu honestly or deflect" but
    // only via inflected words (answered / honesty / deflecting). Exact-token
    // matching false-negatived this faithful episode and blocked the gate.
    const story = {
      id: 'bite-me',
      title: 'Bite Me',
      genre: 'Paranormal Romance',
      synopsis: 'Kylie on the mountain.',
      coverImage: '',
      initialState: { attributes: {} as any, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'episode-4',
        number: 4,
        title: 'The Mountain',
        synopsis: 'Kylie confronts Radu.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [{
          id: 'scene-1',
          name: 'The Confrontation',
          startingBeatId: 'beat-1',
          beats: [{
            id: 'beat-1',
            text: 'Kylie answered Radu plainly, weighing honesty against deflecting his question.',
          }],
        }],
      }],
    } satisfies Story;

    const result = new TreatmentFidelityValidator().validateFinalStory({
      story,
      expectedEpisodeCount: 1,
      isCompleteSeason: false,
      analysis: {
        sourceFormat: 'story_treatment',
        totalEstimatedEpisodes: 4,
        majorCharacters: [],
        keyLocations: [],
        adaptationGuidance: { elementsToPreserve: [] },
        episodeBreakdown: [{
          episodeNumber: 4,
          title: 'The Mountain',
          synopsis: '',
          sourceChapters: [],
          sourceSummary: '',
          plotPoints: [],
          mainCharacters: [],
          supportingCharacters: [],
          locations: [],
          estimatedSceneCount: 1,
          estimatedChoiceCount: 1,
          narrativeFunction: { setup: '', conflict: '', resolution: '' },
          treatmentGuidance: {
            majorChoicePressures: ['Answer Radu honestly or deflect.'],
          },
        }],
      } as any,
    });

    expect(result.issues.join('\n')).not.toContain('major choice pressure');
  });

  it('fails the Bite Me drift pattern before SceneWriter can spend it into prose', () => {
    const blueprint = baseBlueprint({
      synopsis: 'Kylie meets new friends at a rooftop bar, walks home alone, is attacked by three men, and sees Victor reveal inhuman eyes.',
      scenes: [
        {
          id: 'scene-1',
          name: 'Rooftop Introductions',
          description: 'Kylie meets Mika and Stela at the rooftop bar.',
          location: 'rooftop',
          mood: 'sparkling',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['Mika', 'Stela'],
          narrativeFunction: 'Set up the night out.',
          keyBeats: ['Victor watches from across the room.'],
          leadsTo: ['scene-2'],
          choicePoint: {
            type: 'dilemma',
            branches: true,
            stakes: { want: 'Go home safely', cost: 'Lose independence', identity: 'Newly single independence' },
            description: 'Accept Mika’s driver or walk home alone.',
            optionHints: ['Accept the driver.', 'Walk home alone.'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'Kylie feels watched.', shortTerm: 'The route home changes.' },
          },
        },
        {
          id: 'scene-2',
          name: 'The Attack',
          description: 'Three men attack Kylie in Cismigiu Gardens until Victor arrives.',
          location: 'park',
          mood: 'violent',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['Victor'],
          narrativeFunction: 'Combat encounter and rescue.',
          keyBeats: ['Victor saves her and his eyes look inhuman.'],
          leadsTo: ['scene-3'],
          isEncounter: true,
          encounterType: 'combat',
          encounterDescription: 'Kylie is attacked by three men.',
          encounterStakes: 'Survival.',
          encounterRequiredNpcIds: ['Victor'],
          encounterRelevantSkills: ['resolve'],
          encounterBeatPlan: ['Attack', 'Rescue', 'Aftermath'],
          encounterDifficulty: 'moderate',
          encounterBuildup: 'The route home makes her vulnerable.',
        },
        {
          id: 'scene-3',
          name: 'Mr. Midnight',
          description: 'Kylie posts about Mr. Midnight and sees Victor’s predatory gaze in memory.',
          location: 'apartment',
          mood: 'charged',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Blog launch and Victor hook.',
          keyBeats: ['The post goes viral.', 'Victor’s eyes haunt her.'],
          leadsTo: [],
        },
      ],
    });

    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance,
      plannedEncounters,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('major choice pressure');
    expect(result.issues.join('\n')).toContain('visible residue');
  });

  it('passes when the blueprint preserves authored choice, encounter, residue, and cliffhanger', () => {
    const blueprint = baseBlueprint({
      suggestedFlags: [
        { name: 'accepted_stela_quartz', description: 'Stela can ward the apartment because Kylie accepted the rose quartz.' },
      ],
      narrativePromises: [
        { description: 'Mika’s key card changes who can reach Kylie after reconvergence.', setupScene: 'scene-1', importance: 'major' },
      ],
      scenes: [
        {
          id: 'scene-1',
          name: 'Bookshop Adoption',
          description: 'Stela offers rose quartz while Mika presses a key card into Kylie’s hand.',
          location: 'bookshop',
          mood: 'warm',
          purpose: 'branch',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['Mika', 'Stela'],
          narrativeFunction: 'Kylie chooses how much help to accept from new friends.',
          keyBeats: ['Stela explains the quartz.', 'Mika offers the key card.'],
          leadsTo: ['scene-2'],
          choicePoint: {
            type: 'dilemma',
            branches: true,
            stakes: { want: 'Stay independent', cost: 'Refusing help leaves her vulnerable', identity: 'Trust after heartbreak' },
            description: 'Accept Mika’s key card and Stela’s rose quartz, or keep both new friends at arm’s length.',
            optionHints: ['Accept the quartz and key card.', 'Refuse both gifts politely.'],
            consequenceDomain: 'relationship',
            reminderPlan: {
              immediate: 'Mika and Stela visibly adjust to Kylie’s boundary.',
              shortTerm: 'The apartment warding and who can enter later depend on this.',
            },
            expectedResidue: ['Rose quartz warding or vulnerability remains visible after reconvergence.'],
          },
        },
        {
          id: 'scene-2',
          name: 'Cismigiu Shadow',
          description: 'The rooftop glow curdles into Cismigiu park darkness when a shadow attack turns the night predatory.',
          location: 'park',
          mood: 'horror swerve',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['Victor'],
          narrativeFunction: 'The meet-cute shape becomes dangerous.',
          keyBeats: ['The park darkens.', 'The shadow attack breaks the romantic spell.', 'Victor intervenes.'],
          leadsTo: ['scene-3'],
          isEncounter: true,
          plannedEncounterId: 'treatment-enc-1-1',
          encounterType: 'dramatic',
          encounterDescription: 'Rooftop bar light; Cismigiu park dark; shadow attack staged like a meet-cute gone wrong.',
          encounterStakes: 'Kylie learns the city can hunt back.',
          encounterRequiredNpcIds: ['Victor'],
          encounterRelevantSkills: ['resolve', 'perception'],
          encounterBeatPlan: ['Light drains from the night.', 'The shadow attack corners Kylie.', 'Victor rescues her too neatly.'],
          encounterDifficulty: 'moderate',
          encounterBuildup: 'The rooftop gives her confidence before the park turns predatory.',
        },
        {
          id: 'scene-3',
          name: 'Black Roses',
          description: 'The blog spikes, black roses wait at the door, and Stela texts that she had a horrible dream.',
          location: 'apartment',
          mood: 'eerie',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['Stela'],
          narrativeFunction: 'Land the authored cliffhanger: Stela is coming over with herbs after a horrible dream.',
          keyBeats: ['The black roses make the viral post feel watched.', 'Stela texts that she had a horrible dream and is coming over with herbs.'],
          leadsTo: [],
        },
      ],
    });

    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance,
      plannedEncounters,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts paraphrased treatment choice pressure when WANT/COST/IDENTITY are represented in the choicePoint', () => {
    const pressureGuidance = {
      majorChoicePressures: [
        '- When the ambush hits, does Aethavyr protect Lord Brightwell (the figurehead) or Lysandra (the unexpected combatant)? — WANT: do your duty. COST: leave one of them exposed. IDENTITY: who counts as worth protecting first?',
      ],
    };
    const blueprint = baseBlueprint({
      scenes: [{
        id: 'scene-1',
        name: 'Ambush at the Gate',
        description: 'The escort is hit from both sides.',
        location: 'road',
        mood: 'urgent',
        purpose: 'branch',
        dramaticQuestion: '',
        wantVsNeed: '',
        conflictEngine: '',
        npcsPresent: ['Lord Brightwell', 'Lysandra'],
        narrativeFunction: 'Force Aethavyr to choose who receives protection first.',
        keyBeats: ['Lord Brightwell stumbles under the first volley.', 'Lysandra draws steel and is nearly cut off.'],
        leadsTo: [],
        choicePoint: {
          type: 'dilemma',
          branches: true,
          stakes: {
            want: 'Fulfill the oath and protect Lord Brightwell.',
            cost: 'Whichever person Aethavyr does not cover is left exposed.',
            identity: 'Aethavyr decides whether official duty or earned courage counts first.',
          },
          description: 'Choose whether to shield Lord Brightwell as the figurehead or break formation to save Lysandra in the ambush.',
          optionHints: ['Hold the line around Brightwell.', 'Dive toward Lysandra before the second strike lands.'],
          consequenceDomain: 'identity',
        },
      }],
    });

    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance: pressureGuidance,
    });

    expect(result.issues.join('\n')).not.toContain('major choice pressure');
  });

  it('warns when refreshed treatment turns, central conflict, and aftermath are not represented', () => {
    const refreshedGuidance = {
      episodePromise: 'Mara takes the lighthouse job.',
      episodeTurns: [
        'Mara arrives at the emptied lighthouse with her sister scarf.',
        'The lantern speaks in her sister voice.',
      ],
      encounterAnchors: ['The first night watch traps Mara between the harbor and the lantern voice.'],
      encounterCentralConflict: 'Mara must decide whether the voice is a miracle worth protecting or a trap wearing her grief.',
      encounterAftermath: 'The tide steals Jonas key.',
      endingPressure: 'At dawn, the lighthouse shadow points inland.',
      majorChoicePressures: ['Tell the town what happened, or hide the voice.'],
    };
    const blueprint = baseBlueprint({
      title: 'The Lantern Job',
      synopsis: 'Mara starts work.',
      scenes: [{
        id: 'scene-1',
        name: 'Arrival',
        description: 'Mara cleans the keeper room.',
        location: 'lighthouse',
        mood: 'eerie',
        purpose: 'bottleneck',
        dramaticQuestion: '',
        wantVsNeed: '',
        conflictEngine: '',
        npcsPresent: [],
        narrativeFunction: 'Mara starts work.',
        keyBeats: ['Mara unlocks a door.'],
        leadsTo: [],
      }],
    });

    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance: refreshedGuidance,
      plannedEncounters: [{
        id: 'treatment-enc-1-1',
        type: 'dramatic',
        description: refreshedGuidance.encounterAnchors[0],
        difficulty: 'easy',
        npcsInvolved: ['Mara'],
        stakes: 'The voice tests Mara grief.',
        relevantSkills: ['resolve'],
        isBranchPoint: false,
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toContain('episode turn');
    expect(result.issues.join('\n')).toContain('central conflict');
    expect(result.issues.join('\n')).toContain('aftermath/consequence');
    expect(result.issues.join('\n')).toContain('ending pressure');
  });
});
