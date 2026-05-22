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
});
