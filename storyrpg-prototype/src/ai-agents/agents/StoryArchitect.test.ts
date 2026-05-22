import { describe, it, expect } from 'vitest';
import { StoryArchitect, type StoryArchitectInput } from './StoryArchitect';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeInput(overrides?: Partial<StoryArchitectInput>): StoryArchitectInput {
  return {
    storyTitle: 'Test Story',
    genre: 'Drama',
    synopsis: 'A test story about choices.',
    tone: 'Tense',
    episodeNumber: 1,
    episodeTitle: 'The Beginning',
    episodeSynopsis: 'Everything starts here.',
    protagonistDescription: 'Alex, a determined explorer.',
    availableNPCs: [],
    worldContext: 'A world of mystery.',
    currentLocation: 'The city center',
    targetSceneCount: 6,
    majorChoiceCount: 3,
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// buildSeasonPlanDirectivesSection
// -----------------------------------------------------------------------

describe('StoryArchitect.buildSeasonPlanDirectivesSection', () => {
  const architect = new StoryArchitect(config);

  it('returns empty string when no directives', () => {
    const input = makeInput();
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toBe('');
  });

  it('returns empty string when seasonPlanDirectives is undefined', () => {
    const input = makeInput({ seasonPlanDirectives: undefined });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toBe('');
  });

  it('includes GROWTH PLAN section when growthContext is present', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['persuasion', 'athletics'],
          developmentScene: 'Training in the courtyard',
          mentorshipOpportunity: null,
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('GROWTH PLAN FOR THIS EPISODE');
    expect(result).toContain('persuasion, athletics');
    expect(result).toContain('Training in the courtyard');
  });

  it('includes mentorship details when mentorshipOpportunity is provided', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['persuasion'],
          developmentScene: 'Study session',
          mentorshipOpportunity: {
            npcId: 'marcus',
            npcName: 'Marcus',
            requiredRelationship: { dimension: 'respect', threshold: 60 },
            attribute: 'courage',
            narrativeHook: 'Marcus offers to train you',
          },
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('Marcus can teach courage');
    expect(result).toContain('respect >= 60');
    expect(result).toContain('Marcus offers to train you');
    expect(result).toContain('MENTORSHIP SCENE');
  });

  it('omits mentorship line and mentorship scene guidance when mentorshipOpportunity is null', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['stealth'],
          developmentScene: 'Shadow practice',
          mentorshipOpportunity: null,
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('No mentorship opportunity this episode');
    expect(result).not.toContain('MENTORSHIP SCENE');
  });

  it('includes difficulty tier and development scene instructions', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        difficultyTier: 'hard',
        growthContext: {
          focusSkills: ['athletics'],
          developmentScene: 'Obstacle course',
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('hard');
    expect(result).toContain('DEVELOPMENT SCENES');
    expect(result).toContain('fiction-first fail-forward path');
    expect(result).toContain('skills, attributes');
    expect(result).toContain('Do not frame this as grinding');
  });

  it('includes authored treatment guidance as concrete choice and path directives', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          episodePromise: 'Can Kylie trust the friend who keeps saving her?',
          toneRegister: 'Rom-com banter curdling into betrayal.',
          majorChoicePressures: ['Help Mika, cut her off, or ask for time.'],
          alternativePaths: ['Helping Mika opens the Witness ending and leaves warmth after reconvergence.'],
          consequenceSeeds: ['The black rose in the apartment.'],
          authoredCliffhanger: 'Radu admits he tried to be there the first night.',
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);

    expect(result).toContain('Authored Treatment Guidance');
    expect(result).toContain('Can Kylie trust');
    expect(result).toContain('Help Mika');
    expect(result).toContain('Witness ending');
    expect(result).toContain('black rose');
    expect(result).toContain('Radu admits');
    expect(result).toContain('concrete scene choicePoint');
  });

  it('includes adapted story-craft guidance without requiring combat-only pressure', () => {
    const input = makeInput();
    const result = (architect as any).buildPrompt(input);

    expect(result).toContain('Pressure, not mandatory combat');
    expect(result).toContain('romantic vulnerability');
    expect(result).toContain('Plans go wrong');
    expect(result).toContain('Do not require every conversation to become an argument');
    expect(result).toContain('Turn ladder, not topic list');
    expect(result).toContain('evidence changes hands');
    expect(result).toContain('encounterSetupContext');
    expect(result).toContain('Sequence intent, not random panels');
    expect(result).toContain('REQUIRED-BY-PROCESS');
    expect(result).toContain('"sequenceIntent"');
    expect(result).toContain('visualThread');
  });

  it('unwraps DynamoDB-style typed JSON wrappers before blueprint normalization', () => {
    const architect = new StoryArchitect(config);
    const unwrapped = (architect as any).unwrapDynamoTypedJson({
      episodeId: { S: 'episode-1' },
      title: { S: 'Silver Dawn' },
      scenes: {
        L: [
          {
            M: {
              id: { S: 'scene-1' },
              keyBeats: { L: [{ S: 'Aethavyr reaches the caravan.' }] },
              isEncounter: { BOOL: true },
              encounterDifficulty: { S: 'hard' },
            },
          },
        ],
      },
      suggestedScores: { L: [{ M: { name: { S: 'trust' }, description: { S: 'Caravan trust' } } }] },
    });

    expect(unwrapped).toEqual({
      episodeId: 'episode-1',
      title: 'Silver Dawn',
      scenes: [{
        id: 'scene-1',
        keyBeats: ['Aethavyr reaches the caravan.'],
        isEncounter: true,
        encounterDifficulty: 'hard',
      }],
      suggestedScores: [{ name: 'trust', description: 'Caravan trust' }],
    });
  });
});

describe('StoryArchitect treatment fidelity validation', () => {
  it('surfaces treatment drift as structural retry feedback before SceneWriter', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          majorChoicePressures: ['Accept Mika’s key card and Stela’s rose quartz, or keep both new friends at arm’s length.'],
          alternativePaths: ['Accepting the quartz lets Stela ward the apartment; refusing it leaves the apartment vulnerable.'],
          consequenceSeeds: ['The rose quartz, Mika’s key card, black roses, and Stela’s dream about herbs.'],
          encounterAnchors: ['Rooftop bar light; Cismigiu park dark; shadow attack staged like a meet-cute gone wrong.'],
          authoredCliffhanger: 'Stela texts that she had a horrible dream and is coming over with herbs.',
        },
        plannedEncounters: [{
          id: 'treatment-enc-1-1',
          type: 'dramatic',
          description: 'Rooftop bar light; Cismigiu park dark; shadow attack staged like a meet-cute gone wrong.',
          difficulty: 'moderate',
          npcsInvolved: ['Kylie', 'Victor'],
          stakes: 'The city hunts back.',
          relevantSkills: ['resolve'],
          isBranchPoint: true,
        }],
      },
    });
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Dating After Dusk',
      synopsis: 'Kylie meets friends on a rooftop and Victor saves her.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1', 'scene-3'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      scenes: [
        {
          id: 'scene-1',
          name: 'Rooftop',
          description: 'Kylie meets Mika and Stela.',
          location: 'roof',
          mood: 'bright',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Introductions.',
          keyBeats: ['Victor watches.'],
          leadsTo: ['scene-2'],
          choicePoint: {
            type: 'dilemma',
            stakes: { want: 'Go home', cost: 'Risk safety', identity: 'Independence' },
            description: 'Accept Mika’s driver or walk home alone.',
            optionHints: ['Take the driver.', 'Walk alone.'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'She chooses a route.', shortTerm: 'The city watches.' },
          },
        },
        {
          id: 'scene-2',
          name: 'Attack',
          description: 'Three men attack Kylie until Victor arrives.',
          location: 'park',
          mood: 'danger',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Victor rescue.',
          keyBeats: ['Victor reveals inhuman eyes.'],
          leadsTo: ['scene-3'],
          isEncounter: true,
          encounterType: 'combat',
          encounterDescription: 'Three men attack Kylie.',
          encounterStakes: 'Survival.',
          encounterRequiredNpcIds: ['Victor'],
          encounterRelevantSkills: ['resolve'],
          encounterBeatPlan: ['Attack', 'Rescue', 'Aftermath'],
          encounterDifficulty: 'moderate',
          encounterBuildup: 'Walking home alone leaves Kylie vulnerable.',
        },
        {
          id: 'scene-3',
          name: 'Blog Post',
          description: 'Kylie writes about Mr. Midnight.',
          location: 'apartment',
          mood: 'eerie',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Victor hook.',
          keyBeats: ['Victor’s eyes haunt her.'],
          leadsTo: [],
          choicePoint: {
            type: 'expression',
            stakes: { want: 'Name the mystery', cost: 'Invite attention', identity: 'Public voice' },
            description: 'Choose the blog tone.',
            optionHints: ['Witty.', 'Dark.'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'The post changes tone.', shortTerm: 'Readers react.' },
          },
        },
      ],
    };

    const issues = (architect as any).collectStructuralIssues(blueprint, input);

    expect(issues.join('\n')).toContain('[TreatmentFidelity]');
    expect(issues.join('\n')).toContain('major choice pressure');
  });
});

describe('StoryArchitect scene-graph branch repair', () => {
  it('adds a small reconvergent branch when the model only made linear choices', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Dating After Dusk',
      synopsis: 'Kylie starts over.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      scenes: [
        {
          id: 'scene-1',
          name: 'Apartment',
          description: 'Kylie chooses how much help to accept.',
          location: 'apartment',
          mood: 'warm',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Opening agency.',
          keyBeats: [],
          leadsTo: ['scene-2'],
          choicePoint: {
            type: 'dilemma',
            stakes: { want: 'Stay independent', cost: 'Refuse help', identity: 'Trust after heartbreak' },
            description: 'Accept help or keep distance.',
            optionHints: ['Accept help.', 'Keep distance.'],
            consequenceDomain: 'relationship',
            reminderPlan: { immediate: 'Friends react.', shortTerm: 'The next scene carries the tone.' },
          },
        },
        {
          id: 'scene-2',
          name: 'Bookshop',
          description: 'Stela offers quartz.',
          location: 'bookshop',
          mood: 'curious',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Setup.',
          keyBeats: [],
          leadsTo: ['scene-3'],
        },
        {
          id: 'scene-3',
          name: 'Rooftop',
          description: 'Kylie meets Victor.',
          location: 'rooftop',
          mood: 'glittering',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Escalation.',
          keyBeats: [],
          leadsTo: [],
        },
      ],
    };

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    expect(blueprint.scenes[0].purpose).toBe('branch');
    expect(blueprint.scenes[0].choicePoint.branches).toBe(true);
    expect(blueprint.scenes[0].choicePoint.type).toBe('dilemma');
    expect(new Set(blueprint.scenes[0].leadsTo).size).toBe(2);
    expect(blueprint.scenes[0].leadsTo).toEqual(['scene-2', 'scene-3']);
  });
});

describe('StoryArchitect planned encounter repair', () => {
  function makePlannedEncounterInput(): StoryArchitectInput {
    return makeInput({
      seasonPlanDirectives: {
        plannedEncounters: [{
          id: 'enc-1-1',
          type: 'social',
          description: 'Confrontation with mysterious attacker in Cismigiu Park while Andrei watches from shadows',
          difficulty: 'hard',
          npcsInvolved: ['mysterious_attacker', 'andrei'],
          stakes: 'Lena must decide whether she fights, flees, or freezes when faced with a supernatural predator.',
          relevantSkills: ['resolve', 'empathy'],
          encounterBuildup: 'The prior scenes establish Andrei as a watcher and the park as a place of threat.',
          encounterSetupContext: ['flag:noticed_andrei — Andrei reacts if Lena clocks him before the attack'],
          isBranchPoint: true,
        }],
      },
    });
  }

  it('binds a matching unbound encounter scene even when the model chose the wrong encounter type', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Night Teeth',
      synopsis: 'Lena is tested.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      scenes: [
        {
          id: 'scene-1',
          name: 'Club Exit',
          description: 'Lena leaves the club with Andrei watching.',
          location: 'club',
          mood: 'uneasy',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['andrei'],
          narrativeFunction: 'Moves Lena toward the park.',
          keyBeats: ['Andrei watches Lena from a distance.'],
          leadsTo: ['scene-2'],
        },
        {
          id: 'scene-2',
          name: 'The Park Attack',
          description: 'A mysterious attacker corners Lena in Cismigiu Park.',
          location: 'park',
          mood: 'terrifying',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mysterious_attacker'],
          narrativeFunction: 'The supernatural predator tests Lena.',
          keyBeats: ['Lena must decide whether to fight, flee, or freeze.'],
          leadsTo: ['scene-3'],
          isEncounter: true,
          encounterType: 'exploration',
          encounterDescription: 'A park confrontation with the mysterious attacker.',
          encounterDifficulty: 'hard',
        },
        {
          id: 'scene-3',
          name: 'Aftermath',
          description: 'The consequences settle.',
          location: 'park',
          mood: 'shaken',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['andrei'],
          narrativeFunction: 'Aftermath.',
          keyBeats: ['Andrei steps from the shadows.'],
          leadsTo: [],
        },
      ],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1', 'scene-3'],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).repairPlannedEncounterCoverage(blueprint, makePlannedEncounterInput());

    expect(blueprint.scenes[1]).toMatchObject({
      isEncounter: true,
      plannedEncounterId: 'enc-1-1',
      encounterType: 'social',
      encounterStakes: expect.stringContaining('Lena must decide'),
    });
    expect(blueprint.scenes[1].encounterRequiredNpcIds).toEqual(expect.arrayContaining(['mysterious_attacker', 'andrei']));
    expect(blueprint.scenes[1].encounterRelevantSkills).toEqual(expect.arrayContaining(['resolve', 'empathy']));
    expect(blueprint.scenes[1].encounterBeatPlan.length).toBeGreaterThanOrEqual(3);
    expect(blueprint.bottleneckScenes).toContain('scene-2');
  });

  it('upgrades the strongest scene when the model omitted an encounter scene entirely', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Night Teeth',
      synopsis: 'Lena is tested.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      scenes: [
        {
          id: 'scene-1',
          name: 'Bold Entrance',
          description: 'Lena enters the club.',
          location: 'club',
          mood: 'charged',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: [],
          narrativeFunction: 'Introduces Lena.',
          keyBeats: ['Lena enters with confidence.'],
          leadsTo: ['scene-2'],
        },
        {
          id: 'scene-2',
          name: 'Cismigiu Park Confrontation',
          description: 'The mysterious attacker confronts Lena in Cismigiu Park while Andrei watches.',
          location: 'park',
          mood: 'dangerous',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mysterious_attacker'],
          narrativeFunction: 'Tests Lena under supernatural pressure.',
          keyBeats: ['Andrei watches from the shadows.', 'Lena faces the predator.'],
          leadsTo: ['scene-3'],
        },
        {
          id: 'scene-3',
          name: 'Aftermath',
          description: 'Lena processes what happened.',
          location: 'street',
          mood: 'haunted',
          purpose: 'transition',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['andrei'],
          narrativeFunction: 'Aftermath.',
          keyBeats: ['Andrei reveals he saw everything.'],
          leadsTo: [],
        },
      ],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1'],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).repairPlannedEncounterCoverage(blueprint, makePlannedEncounterInput());

    expect(blueprint.scenes[1].isEncounter).toBe(true);
    expect(blueprint.scenes[1].plannedEncounterId).toBe('enc-1-1');
    expect(blueprint.scenes[1].encounterType).toBe('social');
    expect(blueprint.scenes[1].encounterDescription).toContain('Confrontation with mysterious attacker');
    expect(blueprint.scenes[1].encounterSetupContext).toEqual(expect.arrayContaining([
      'flag:noticed_andrei — Andrei reacts if Lena clocks him before the attack',
    ]));
  });
});

describe('StoryArchitect opening agency requirements', () => {
  function makeOpeningChoiceBlueprint(): any {
    return {
      episodeId: 'episode-1',
      title: 'Opening',
      synopsis: 'The season begins.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      scenes: [
        {
          id: 'scene-1',
          name: 'Arrival',
          description: 'Alex arrives.',
          location: 'station',
          mood: 'curious',
          purpose: 'bottleneck',
          dramaticQuestion: 'How does Alex enter this world?',
          wantVsNeed: 'Safety vs discovery',
          conflictEngine: 'The city watches newcomers.',
          npcsPresent: [],
          narrativeFunction: 'Starts the season.',
          keyBeats: ['Alex crosses the threshold.'],
          leadsTo: ['scene-2'],
        },
        {
          id: 'scene-2',
          name: 'First Pressure',
          description: 'Someone asks for help.',
          location: 'street',
          mood: 'tense',
          purpose: 'branch',
          dramaticQuestion: 'Will Alex get involved?',
          wantVsNeed: 'Stay unnoticed vs act',
          conflictEngine: 'A stranger needs help.',
          npcsPresent: [],
          narrativeFunction: 'Offers early agency.',
          keyBeats: ['A stranger blocks the path.'],
          leadsTo: ['scene-3'],
          choicePoint: {
            type: 'relationship',
            branches: false,
            stakes: { want: 'Stay safe', cost: 'Risk attention', identity: 'Detached observer or participant' },
            description: 'How does Alex respond?',
            optionHints: ['Help', 'Refuse'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'Reflect the tone immediately.', shortTerm: 'Echo the response later.' },
          },
        },
        {
          id: 'scene-3',
          name: 'Confrontation',
          description: 'Alex is tested.',
          location: 'alley',
          mood: 'dangerous',
          purpose: 'bottleneck',
          dramaticQuestion: 'Can Alex stand firm?',
          wantVsNeed: 'Escape vs commit',
          conflictEngine: 'A threat closes in.',
          npcsPresent: [],
          narrativeFunction: 'Central encounter.',
          keyBeats: ['The threat appears.', 'Alex commits.', 'The cost lands.'],
          leadsTo: [],
          isEncounter: true,
          encounterType: 'social',
          encounterStyle: 'dramatic',
          encounterDescription: 'Alex must face a public accusation.',
          encounterStakes: 'Alex risks their reputation.',
          encounterRequiredNpcIds: ['accuser'],
          encounterRelevantSkills: ['resolve', 'empathy'],
          encounterBeatPlan: ['The accusation lands.', 'The crowd turns.', 'Alex chooses a response.'],
          encounterDifficulty: 'moderate',
          encounterBuildup: 'Earlier scenes establish why public trust matters.',
        },
      ],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1', 'scene-3'],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };
  }

  it('auto-adds a choicePoint to the first scene of episode 1 even when scene 2 already has agency', () => {
    const architect = new StoryArchitect({
      ...config,
      generation: { requireSceneGraphBranching: false },
    } as any);
    const blueprint = makeOpeningChoiceBlueprint();

    (architect as any).repairChoiceDensity(blueprint, makeInput({ episodeNumber: 1 }));

    expect(blueprint.scenes[0].choicePoint).toMatchObject({
      type: 'expression',
      consequenceDomain: 'identity',
    });
  });

  it('allows later episodes to use a brief opening scene when the second scene has a choice', () => {
    const architect = new StoryArchitect({
      ...config,
      generation: { requireSceneGraphBranching: false },
    } as any);
    const blueprint = makeOpeningChoiceBlueprint();
    blueprint.episodeId = 'episode-2';
    blueprint.scenes[1].leadsTo = ['scene-3', 'scene-4'];
    blueprint.scenes[1].choicePoint.branches = true;
    blueprint.scenes[2].leadsTo = ['scene-4'];
    blueprint.scenes.push({
      ...blueprint.scenes[1],
      id: 'scene-4',
      name: 'Aftermath Choice',
      description: 'Alex chooses how to carry the aftermath.',
      location: 'street',
      purpose: 'transition',
      leadsTo: [],
    });

    expect(() => (architect as any).validateBlueprint(blueprint, makeInput({ episodeNumber: 2 }))).not.toThrow();
  });
});
