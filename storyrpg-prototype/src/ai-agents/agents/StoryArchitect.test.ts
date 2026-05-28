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

  it('includes scene-splitting guidance without adding a new schema layer', () => {
    const input = makeInput();
    const result = (architect as any).buildPrompt(input);

    expect(result).toContain('## Scene Splitting');
    expect(result).toContain('meaningful change in location, time, character dynamics, objective, obstacle, or dramatic tension');
    expect(result).toContain('Do not create a new scene for tiny tonal shifts');
    expect(result).toContain('keyBeats that describe major turns, not topics');
    expect(result).toContain('handoff into the next scene or encounter');
    expect(result).toContain('## Scene Content Purpose');
    expect(result).toContain('Every scene must have a purpose the player can feel');
    expect(result).toContain('## Scene Arc');
    expect(result).toContain('Each scene should build toward its keyMoment');
    expect(result).toContain('## Conflict And Action Planning');
    expect(result).toContain('damage may be emotional, social, relational');
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
  it('repairs authored branchlet and seed residue into blueprint memory fields before validation', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          alternativePaths: ['Reading the messages leaves Kylie more bruised in sceneEp 2; blocking leaves her brittle.'],
          consequenceSeeds: ['The grandmother gold chain and the Dating After Dusk draft.'],
          consequenceResidue: 'The draft file remains open on the kitchen table.',
        },
      },
    });
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Arrival',
      synopsis: 'Kylie arrives in Bucharest.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      scenes: [{
        id: 'scene-1',
        name: 'Apartment',
        description: 'Kylie opens the laptop.',
        location: 'apartment',
        mood: 'quiet',
        purpose: 'bottleneck',
        dramaticQuestion: '',
        wantVsNeed: '',
        conflictEngine: '',
        npcsPresent: [],
        narrativeFunction: 'Opening agency.',
        keyBeats: ['Kylie names the draft.'],
        leadsTo: [],
        choicePoint: {
          type: 'expression',
          stakes: { want: 'Start over', cost: 'Admit the wound', identity: 'Known or invisible' },
          description: 'Choose how Kylie faces the blank draft.',
          optionHints: ['Open the laptop.', 'Wait.'],
          consequenceDomain: 'identity',
          reminderPlan: { immediate: 'The room changes temperature.', shortTerm: 'The next scene remembers her tone.' },
        },
      }],
    };

    (architect as any).repairTreatmentResidue(blueprint, input);
    const issues = (architect as any).collectTreatmentFidelityIssues(blueprint, input);

    expect(issues.join('\n')).not.toContain('visible residue');
    expect(blueprint.narrativePromises.map((promise: any) => promise.description).join('\n')).toContain('Reading the messages');
    expect(blueprint.scenes[0].choicePoint.expectedResidue).toEqual(expect.arrayContaining([
      expect.stringContaining('gold chain'),
    ]));
  });

  it('repairs treatment theme pressure and sceneEpisode forward pressure into validator-visible fields', () => {
    const architect = new StoryArchitect(config, { episodeStructureMode: 'sceneEpisodes', allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      episodeNumber: 3,
      episodeTitle: 'The Bookshop',
      seasonPlanDirectives: {
        treatmentGuidance: {
          dramaticQuestion: 'Will Kylie accept that Stela sees more than Kylie wants seen?',
          themePressure: 'First real pressure on being known instead of merely adored.',
          liePressure: 'Kylie believes being unknown means she does not exist.',
          entryGoal: 'Find the bookshop and get material for the blog.',
          obstacle: 'Stela knows too much without being told.',
          forcedChoice: 'Accept the rose quartz or keep the friendship aesthetic and shallow.',
          exitShift: 'Kylie leaves with protection she is not ready to believe in.',
          stakesLayers: ['Existential (unknown to Kylie), relational.'],
          aPressure: 'The blog needs a story.',
          bPressure: 'Stela offers unsettling friendship.',
          cSeed: 'The rose quartz becomes a future ward.',
          informationMovement: 'Plant Stela knowledge and the quartz.',
          consequenceResidue: 'The rose quartz is now in Kylie bag.',
          visualAnchor: 'A rose quartz on a velvet counter.',
          nextEpisodeCausality: 'Because Mika texts her at 3pm: *Iubita, bring the bookshop girl Friday.*',
          endingPressure: 'Because Mika texts her at 3pm: *Iubita, bring the bookshop girl Friday.*',
          alternativePaths: ['Accepting the quartz leaves protection; refusing it leaves the apartment vulnerable.'],
        },
      },
    });
    const blueprint: any = {
      episodeId: 'episode-3',
      title: 'The Bookshop',
      synopsis: 'Kylie meets Stela.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      dramaticAudit: {
        episodeQuestion: 'Will Kylie trust the strange bookshop girl?',
        themePressure: 'TBD',
        themeAngle: 'TBD',
        openingPromise: {
          hook: 'TBD',
          episodePromise: '',
          activePressure: 'none',
        },
        episodePressureLanes: {
          aPlot: {
            externalPressure: '',
            climaxIntersection: 'TBD',
          },
        },
        personalStake: 'Kylie identity, trust, reputation, and future safety are at risk.',
        stakesLayers: {
          material: 'The blog and quartz protection can be lost.',
          relational: 'Stela trust changes.',
          identity: 'Kylie must choose whether being known matters.',
          existential: 'Existential danger unknown to Kylie.',
        },
        majorTurns: [{
          id: 'turn-1',
          description: 'Kylie enters the bookshop and Stela sees too much.',
          driver: 'protagonist',
          protagonistInfluence: 'Kylie chooses whether to stay.',
        }],
        informationPlan: [{
          item: 'Stela knows more than she should.',
          knownBy: ['Kylie', 'Stela'] as any,
          revealTiming: 'During the scene.',
          payoff: 'The quartz matters later.',
        }],
      },
      scenes: [{
        id: 'scene-1',
        name: 'Bookshop',
        description: 'Kylie enters Lumina Books.',
        location: 'bookshop',
        mood: 'curious',
        purpose: 'bottleneck',
        dramaticQuestion: 'Will Kylie accept Stela help?',
        wantVsNeed: 'Material for the blog vs being known.',
        conflictEngine: 'Stela sees through her.',
        npcsPresent: ['stela'],
        narrativeFunction: 'Kylie encounters unsettling friendship.',
        keyBeats: ['Kylie steps inside.', 'Risk narrows when Stela names what Kylie has not said.', 'The choice reveals a cost and changes future protection.'],
        leadsTo: [],
        stakesLayers: {
          material: 'The blog and quartz protection can be lost.',
          relational: 'Stela trust changes.',
          identity: 'Kylie must choose whether being known matters.',
          existential: 'Existential danger unknown to Kylie.',
        },
        choicePoint: {
          type: 'dilemma',
          stakes: { want: 'Stay independent', cost: 'Reject help', identity: 'Known or merely adored' },
          description: 'Accept the quartz or refuse it.',
          optionHints: ['Accept it.', 'Refuse it.'],
          consequenceDomain: 'identity',
          stakesLayers: {
            material: 'The quartz can protect or be refused.',
            relational: 'Stela trust changes.',
            identity: 'Kylie chooses whether being known matters.',
            existential: 'Existential danger unknown to Kylie.',
          },
          reminderPlan: { immediate: 'Stela notices the response.', shortTerm: 'The apartment feels different later.' },
        },
      }],
    };

    (architect as any).repairTreatmentDramaticAudit(blueprint, input);
    (architect as any).repairTreatmentForwardPressure(blueprint, input.seasonPlanDirectives?.treatmentGuidance);
    (architect as any).repairTreatmentResidue(blueprint, input);

    const dramaticIssues = (architect as any).collectDramaticStructureIssues(blueprint, input, false);
    const treatmentIssues = (architect as any).collectTreatmentFidelityIssues(blueprint, input);

    expect(dramaticIssues.join('\n')).not.toContain('dramaticAudit.themePressure is missing');
    expect((architect as any).collectThemePressureIssues(blueprint, false).join('\n')).not.toContain('themeAngle is missing');
    expect((architect as any).collectEpisodePressureIssues(blueprint, input, false).join('\n')).not.toContain('openingPromise is incomplete');
    expect(blueprint.dramaticAudit.openingPromise.hook).toContain('Find the bookshop');
    expect(blueprint.dramaticAudit.openingPromise.episodePromise).toContain('Will Kylie accept');
    expect(blueprint.dramaticAudit.informationPlan[0].knownBy).toEqual(['protagonist', 'ally']);
    expect(treatmentIssues.join('\n')).not.toContain('authored ending pressure');
    expect(blueprint.dramaticAudit.themePressure).toContain('known');
    expect(blueprint.dramaticAudit.themeAngle).toContain('known');
    expect(blueprint.dramaticAudit.stakesLayers.existential).toBeUndefined();
    expect(blueprint.scenes[0].stakesLayers.existential).toBeUndefined();
    expect(blueprint.scenes[0].choicePoint.stakesLayers.existential).toBeUndefined();
    expect(blueprint.scenes[0].keyBeats[0]).toContain('Pressure:');
    expect(blueprint.scenes[0].keyBeats.join('\n')).toContain('Because Mika texts');
  });

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

  it('repairs authored treatment choice pressure into a concrete choicePoint before validation', () => {
    const architect = new StoryArchitect(config, { episodeStructureMode: 'sceneEpisodes', allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        treatmentGuidance: {
          majorChoicePressures: [
            'Open the laptop, or wait.',
            'Block Daniel, archive his messages, or read them.',
          ],
          themePressure: 'Kylie tests whether attention is intimacy or surveillance.',
          liePressure: 'Kylie risks becoming the woman who confuses being watched with being wanted.',
          consequenceResidue: 'The laptop choice changes what Kylie thinks she is allowed to know.',
        },
      },
    });
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Arrival',
      synopsis: 'Kylie arrives in Bucharest.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      dramaticAudit: {
        episodeQuestion: 'Will Kylie open the laptop?',
        themePressure: 'Kylie tests whether attention is intimacy or surveillance.',
        personalStake: 'Survival.',
        stakesLayers: { material: 'The laptop.', relational: 'Daniel.', identity: 'Curiosity.' },
        majorTurns: [{ id: 'turn-1', description: 'Arrival', turnType: 'choice', driver: 'player_choice' }],
        informationPlan: [{ item: 'Daniel messages', knownBy: ['player'], revealTiming: 'now', payoff: 'choice' }],
      },
      scenes: [
        {
          id: 'scene-1',
          name: 'The Blank Page',
          description: 'Kylie sits with the laptop.',
          location: 'apartment',
          mood: 'uneasy',
          purpose: 'bottleneck',
          dramaticQuestion: 'Will Kylie look?',
          wantVsNeed: 'Know versus protect herself.',
          conflictEngine: 'Daniel keeps pulling at her attention.',
          dramaticStructure: {
            question: 'Will Kylie look?',
            turn: 'The laptop becomes a demand.',
            pressurePeak: 'The messages wait.',
            changedState: 'She must decide.',
          },
          personalStake: 'Survival.',
          stakesLayers: { material: 'The laptop.', relational: 'Daniel.', identity: 'Curiosity.' },
          npcsPresent: [],
          narrativeFunction: 'Opening pressure.',
          keyBeats: ['The laptop waits.', 'Daniel messages again.'],
          leadsTo: [],
          choicePoint: {
            type: 'expression',
            stakes: { want: 'React to the laptop', cost: 'Tone changes', identity: 'Posture' },
            description: 'Choose how Kylie feels.',
            optionHints: ['Calm.', 'Angry.'],
            consequenceDomain: 'identity',
          },
        },
      ],
    };

    (architect as any).repairTreatmentDramaticAudit(blueprint, input);
    (architect as any).repairTreatmentMajorChoicePressure(blueprint, input);

    expect(blueprint.scenes[0].choicePoint.type).toBe('dilemma');
    expect(blueprint.scenes[0].choicePoint.description).toContain('Open the laptop');
    expect(blueprint.scenes[0].choicePoint.optionHints).toEqual(['Open the laptop', 'wait.']);
    expect(blueprint.scenes[0].choicePoint.expectedResidue.join('\n')).toContain('laptop choice');
    expect(blueprint.dramaticAudit.personalStake).toContain('woman who confuses');
    expect(blueprint.dramaticAudit.themeChoicePressure).toContain('Player/protagonist choice');
    expect((architect as any).collectTreatmentFidelityIssues(blueprint, input).join('\n')).not.toContain('major choice pressure');
    expect((architect as any).collectDramaticStructureIssues(blueprint, input, false).join('\n')).not.toContain('personalStake is missing or abstract');
  });

  it('repairs incomplete information plan rows before dramatic validation', () => {
    const architect = new StoryArchitect(config, { episodeStructureMode: 'sceneEpisodes', allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      episodeNumber: 5,
      episodeTitle: 'Cismigiu',
      seasonPlanDirectives: {
        treatmentGuidance: {
          informationMovement: 'Victor knows Kylie by name before she introduces herself.',
          cSeed: 'The black roses will prove he knows where she lives.',
          endingPressure: 'Because at 4am Kylie cannot sleep and the draft file is open.',
          themePressure: 'Kylie must decide whether rescue is care or possession.',
          liePressure: 'Being chosen feels like proof she exists.',
        },
      },
    });
    const blueprint: any = {
      episodeId: 'episode-5',
      title: 'Cismigiu',
      synopsis: 'Kylie is attacked and rescued.',
      arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
      themes: [],
      startingSceneId: 'scene-1',
      bottleneckScenes: ['scene-1'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      dramaticAudit: {
        episodeQuestion: 'Will Kylie survive the walk home?',
        themePressure: 'Kylie must decide whether rescue is care or possession.',
        personalStake: 'Her safety and trust are at risk.',
        stakesLayers: { material: 'The walk home.', relational: 'Victor.', identity: 'Independence.' },
        majorTurns: [{ id: 'turn-1', description: 'The rescue', driver: 'player_choice', protagonistInfluence: 'Kylie chooses how to respond.' }],
        informationPlan: [
          { item: 'Victor knows her name.', knownBy: ['player'], revealTiming: 'At the rescue.', payoff: 'The rescue becomes unsettling.' },
          { item: '', knownBy: [], revealTiming: '', payoff: '' },
        ],
      },
      scenes: [{
        id: 'scene-1',
        name: 'The Shadow in the Fog',
        description: 'Kylie faces the attack.',
        location: 'park',
        mood: 'danger',
        purpose: 'bottleneck',
        dramaticQuestion: 'Can she survive?',
        wantVsNeed: 'Safety versus agency.',
        conflictEngine: 'A shadow attacks her.',
        dramaticStructure: {
          question: 'Can she survive?',
          turn: 'Victor appears.',
          pressurePeak: 'The shadow marks her.',
          changedState: 'She owes Victor attention.',
        },
        personalStake: 'Her safety and trust are at risk.',
        stakesLayers: { material: 'The route home.', relational: 'Victor.', identity: 'Independence.' },
        npcsPresent: [],
        narrativeFunction: 'Attack and rescue.',
        keyBeats: ['The route home turns dangerous.', 'Victor knows her name.'],
        leadsTo: [],
        choicePoint: {
          type: 'dilemma',
          stakes: { want: 'Survive', cost: 'Owe Victor', identity: 'Agency' },
          description: 'Scream, run, freeze, or fight.',
          optionHints: ['Scream', 'run', 'freeze', 'fight'],
          consequenceDomain: 'danger',
          reminderPlan: { immediate: 'The response changes the rescue.', shortTerm: 'The bruise or debt carries forward.' },
        },
      }],
    };

    (architect as any).repairTreatmentDramaticAudit(blueprint, input);
    (architect as any).ensureDramaticAuditMinimums(blueprint, input);

    expect(blueprint.dramaticAudit.informationPlan[1]).toMatchObject({
      item: 'The black roses will prove he knows where she lives.',
      knownBy: ['player', 'protagonist'],
      revealTiming: 'During this episode.',
      payoff: 'Because at 4am Kylie cannot sleep and the draft file is open.',
    });
    expect((architect as any).collectDramaticStructureIssues(blueprint, input, false).join('\n')).not.toContain('Information plan item is incomplete');
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

describe('StoryArchitect transition repair', () => {
  it('adds therefore/but transitionOut metadata for every leadsTo edge', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'The Hunt',
      synopsis: 'A three-scene pursuit.',
      scenes: [
        {
          id: 'scene-1',
          name: 'Storm Shelter',
          description: 'Alex takes shelter as signs gather.',
          location: 'barn',
          mood: 'tense',
          purpose: 'bottleneck',
          dramaticQuestion: 'Will Alex recognize the danger?',
          wantVsNeed: 'Stay hidden vs understand the threat.',
          conflictEngine: 'The storm hides the first sign of pursuit.',
          dramaticStructure: {
            question: 'Will Alex recognize the danger?',
            turn: 'The storm reveals a hunter sign.',
            pressurePeak: 'The hidden mark proves Alex has been tracked.',
            changedState: 'Alex leaves knowing the shelter is not safe.',
          },
          personalStake: 'Alex safety and freedom are at risk.',
          npcsPresent: [],
          narrativeFunction: 'Buildup to the hunt.',
          keyBeats: ['The hidden mark proves Alex has been tracked.'],
          leadsTo: ['scene-2', 'scene-3'],
          transitionOut: [{
            toSceneId: 'scene-2',
            connector: 'therefore',
            causalLink: '',
            pressureChange: '',
          }],
          residue: [{ type: 'information', description: 'Alex knows the shelter is compromised.' }],
        },
        {
          id: 'scene-2',
          name: 'Signs of the Hunt',
          description: 'Alex follows the signs into the woods.',
          location: 'woods',
          mood: 'danger',
          purpose: 'branch',
          dramaticQuestion: 'Can Alex read the signs before the hunter arrives?',
          wantVsNeed: 'Find a safe path vs confront the pattern.',
          conflictEngine: 'The signs point in two directions.',
          personalStake: 'Alex could lose the only safe route.',
          npcsPresent: [],
          narrativeFunction: 'Turns fear into pursuit logic.',
          keyBeats: ['The signs split the route.'],
          leadsTo: ['scene-3'],
          residue: [{ type: 'information', description: 'The route choice changes what Alex knows.' }],
        },
        {
          id: 'scene-3',
          name: 'Hunter Arrives',
          description: 'The hunter steps from the rain.',
          location: 'clearing',
          mood: 'danger',
          purpose: 'bottleneck',
          dramaticQuestion: 'Will Alex survive the confrontation?',
          wantVsNeed: 'Escape vs stand their ground.',
          conflictEngine: 'The hunter closes the distance.',
          personalStake: 'Alex body and freedom are at risk.',
          npcsPresent: ['hunter'],
          narrativeFunction: 'The pursuit becomes confrontation.',
          keyBeats: ['The hunter arrives.'],
          leadsTo: [],
          transitionOut: [],
          residue: [{ type: 'cost', description: 'The confrontation leaves a mark.' }],
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

    (architect as any).repairSceneTransitions(blueprint);

    expect(blueprint.scenes[0].transitionOut).toHaveLength(2);
    expect(blueprint.scenes[0].transitionOut[0]).toMatchObject({
      toSceneId: 'scene-2',
      connector: 'therefore',
    });
    expect(blueprint.scenes[0].transitionOut[0].causalLink).toContain('Storm Shelter changes the situation');
    expect(blueprint.scenes[0].transitionOut[0].pressureChange).toContain('escalates into');
    expect(blueprint.scenes[0].transitionOut[1]).toMatchObject({
      toSceneId: 'scene-3',
      connector: 'but',
    });
    expect(blueprint.scenes[1].transitionOut[0]).toMatchObject({
      toSceneId: 'scene-3',
      connector: 'therefore',
    });
    expect((architect as any).collectDramaticStructureIssues(blueprint, makeInput(), false).join('\n')).not.toContain('without transitionOut metadata');
  });

  it('repairs pressure-only scenes with an irreversible reaction for scene turn validation', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Signs',
      synopsis: 'A warning becomes action.',
      scenes: [
        {
          id: 'scene-1',
          name: 'Shelter',
          description: 'Alex enters shelter from the storm.',
          location: 'barn',
          mood: 'tense',
          purpose: 'bottleneck',
          dramaticQuestion: 'Will Alex get clear of the storm?',
          wantVsNeed: 'Hide from the storm vs notice the pattern.',
          conflictEngine: 'The storm cuts off the road.',
          dramaticStructure: {
            question: 'Will Alex get clear of the storm?',
            turn: 'The road floods.',
            pressurePeak: 'The road floods behind Alex.',
            changedState: 'Alex is trapped inside the shelter.',
          },
          personalStake: 'Alex safety and route home are at risk.',
          npcsPresent: [],
          narrativeFunction: 'Opening pressure.',
          keyBeats: ['The road floods behind Alex.'],
          leadsTo: ['scene-2'],
          transitionOut: [],
          residue: [{ type: 'cost', description: 'The road home is gone.' }],
          choicePoint: {
            type: 'dilemma',
            stakes: { want: 'leave safely', cost: 'risk the storm', identity: 'careful or bold' },
            description: 'Choose whether to stay or run.',
            optionHints: ['Stay', 'Run'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'Alex moves differently after the choice.', shortTerm: 'The storm choice echoes later.' },
          },
        },
        {
          id: 'scene-2',
          name: 'Signs of Danger',
          description: 'Alex finds warning signs in the rafters.',
          location: 'barn',
          mood: 'dread',
          purpose: 'transition',
          dramaticQuestion: 'Will Alex understand what is hunting them?',
          wantVsNeed: 'Stay hidden vs read the warning.',
          conflictEngine: 'The signs suggest the storm is not natural.',
          dramaticStructure: {
            question: 'Will Alex understand what is hunting them?',
            turn: 'A mark appears in the rafters.',
            pressurePeak: 'The old warning sign points toward the woods.',
            changedState: 'Alex knows the shelter is part of the hunt.',
          },
          personalStake: 'Alex safety and freedom are at risk.',
          npcsPresent: [],
          narrativeFunction: 'Turns atmosphere into threat.',
          keyBeats: ['The old warning sign points toward the woods.'],
          leadsTo: ['scene-3'],
          transitionOut: [],
          residue: [{ type: 'information', description: 'The signs expose the hunt.' }],
        },
        {
          id: 'scene-3',
          name: 'The Woods',
          description: 'The hunt moves outside.',
          location: 'woods',
          mood: 'danger',
          purpose: 'bottleneck',
          dramaticQuestion: 'Can Alex survive the hunter?',
          wantVsNeed: 'Escape vs confront the danger.',
          conflictEngine: 'The hunter closes in.',
          dramaticStructure: {
            question: 'Can Alex survive the hunter?',
            turn: 'The hunter steps into view.',
            pressurePeak: 'The hunter blocks the only path.',
            changedState: 'Alex has no clean escape.',
          },
          personalStake: 'Alex life and freedom are at risk.',
          npcsPresent: ['hunter'],
          narrativeFunction: 'Confrontation.',
          keyBeats: ['The hunter blocks the only path.', 'Alex must confront the hunter.'],
          leadsTo: [],
          transitionOut: [],
          residue: [{ type: 'cost', description: 'The confrontation leaves Alex marked.' }],
          choicePoint: {
            type: 'dilemma',
            stakes: { want: 'survive', cost: 'lose safety', identity: 'prey or fighter' },
            description: 'Choose whether to run, bargain, or fight.',
            optionHints: ['Run', 'Bargain', 'Fight'],
            consequenceDomain: 'identity',
            reminderPlan: { immediate: 'The hunter responds.', shortTerm: 'The confrontation changes Alex.' },
          },
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

    (architect as any).repairSceneTransitions(blueprint);
    (architect as any).repairSceneTurnContracts(blueprint);

    expect(blueprint.scenes[1].keyBeats.join('\n')).toContain('irreversible reaction');
    expect(blueprint.scenes[1].residue[1]).toMatchObject({ type: 'danger' });
    expect((architect as any).collectSceneTurnContractIssues(blueprint, false).join('\n')).not.toContain('lacks a forced decision or irreversible reaction');
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
    blueprint.dramaticAudit = {
      episodeQuestion: 'Will Alex step into the city trouble?',
      episodeQuestionSetup: 'The station opening poses whether Alex can stay safe by remaining uninvolved.',
      episodeQuestionAnswer: 'The confrontation answers that public involvement changes Alex reputation and future access.',
      themeQuestion: 'What do you owe strangers when safety depends on staying uninvolved?',
      themePressure: 'The episode tests whether safety is worth refusing help.',
      themeAngle: 'Safety is tested as public detachment when a stranger needs help.',
      themeChoicePressure: 'The player chooses whether Alex protects themself, helps the stranger, or pays reputation cost to become involved.',
      openingPromise: {
        hook: 'Alex enters a city already watching newcomers.',
        episodePromise: 'A stranger will force Alex to choose safety or public involvement.',
        activePressure: 'City witnesses are already measuring whether Alex can be trusted.',
        optionalStakes: 'Alex future access and reputation are at risk.',
      },
      episodePressureLanes: {
        aPlot: {
          externalPressure: 'Alex must navigate the city trouble without losing future access.',
          climaxIntersection: 'The confrontation tests whether Alex public standing survives the stranger choice.',
        },
        bPlot: {
          mode: 'scene',
          relationshipOrIdentityPressure: 'The stranger and city witnesses force Alex to define whether safety means detachment.',
          offscreenNpcMotivation: 'The stranger has already risked asking for help because no local witness will act.',
          protagonistVisibleSignals: [
            'The stranger blocks Alex path.',
            'The city witnesses wait to see whether Alex helps.',
          ],
          scenesOrEpisodes: ['scene-2', 'scene-3'],
          climaxIntersection: 'The stranger choice shapes who will stand with Alex during the confrontation.',
        },
        cPlot: {
          function: 'future_seed',
          seed: 'The city keeps informal accounts of who helps newcomers.',
          visiblePlant: 'A witness marks Alex response before vanishing into the crowd.',
          payoffPlan: 'The witness account can return as future access or suspicion.',
          targetPayoff: 'later_episode',
        },
      },
      episodeEndStateDelta: 'Alex leaves with altered public reputation, changed city access, and clearer identity pressure.',
      nextEpisodePressure: 'The witness account can reopen city access or suspicion in the next episode.',
      personalStake: 'Alex reputation and future access in the city are at risk.',
      stakesLayers: {
        material: 'Alex future access in the city can close.',
        relational: 'The stranger and city witnesses decide whether Alex can be trusted.',
        identity: 'Alex becomes either detached or publicly involved.',
      },
      majorTurns: [
        {
          id: 'turn-1',
          description: 'Alex arrives and notices the city watching.',
          turnType: 'revelation',
          driver: 'protagonist',
          protagonistInfluence: 'Alex chooses how visibly to enter the station.',
          closesQuestion: 'Alex cannot enter anonymously.',
          opensQuestion: 'The city will judge what Alex does next.',
          memorableImageOrLine: 'Every face at the station turns before Alex speaks.',
        },
        {
          id: 'turn-2',
          description: 'Alex decides whether to help the stranger.',
          turnType: 'choice',
          driver: 'player_choice',
          protagonistInfluence: 'The player response creates the branch pressure.',
          closesQuestion: 'Alex safety is no longer passive.',
          opensQuestion: 'The response will decide who stands with Alex later.',
          memorableImageOrLine: 'The stranger reaches out while the city watches.',
        },
        {
          id: 'turn-3',
          description: 'The confrontation tests Alex public standing.',
          turnType: 'payoff',
          driver: 'protagonist',
          protagonistInfluence: 'Alex earlier choice shapes who will stand with them.',
          closesQuestion: 'Alex public standing is tested by the earlier choice.',
          opensQuestion: 'The city will remember what Alex became.',
          memorableImageOrLine: 'The crowd parts differently depending on what Alex risked.',
        },
      ],
      informationPlan: [
        {
          item: 'The city watches newcomers.',
          knownBy: ['player', 'protagonist'],
          revealTiming: 'Opening arrival.',
          payoff: 'The pressure returns in the confrontation.',
        },
      ],
    };
    blueprint.scenes.forEach((scene: any, index: number) => {
      scene.dramaticStructure = {
        question: scene.dramaticQuestion || `Scene ${index + 1} question`,
        turn: scene.keyBeats?.[0] || 'The scene turns.',
        pressurePeak: scene.keyBeats?.[1] || scene.keyBeats?.[0] || 'The cost becomes visible.',
        changedState: `${scene.name} leaves Alex with changed leverage.`,
      };
      scene.personalStake = 'Alex reputation and future access in the city are at risk.';
      scene.themePressure = 'The scene turns safety into a choice with reputation cost and identity pressure.';
      scene.stakesLayers = {
        material: 'Alex future access in the city can change.',
        relational: 'The city witnesses decide whether Alex can be trusted.',
        identity: 'Alex public identity is being formed.',
      };
      scene.transitionOut = (scene.leadsTo || []).map((toSceneId: string) => ({
        toSceneId,
        connector: 'therefore',
        causalLink: `${toSceneId} follows from ${scene.id} because Alex has changed leverage.`,
        pressureChange: 'The pressure becomes harder to ignore.',
      }));
      scene.residue = [{
        type: 'reputation',
        description: `${scene.name} changes how the city reads Alex.`,
      }];
      if (scene.choicePoint) {
        scene.choicePoint.stakesLayers = {
          relational: 'The stranger and city witnesses read Alex response.',
          identity: 'Alex chooses whether to become involved.',
        };
        scene.choicePoint.themeAnswer = 'Alex answers the safety question by choosing detachment, help, or public involvement.';
      }
    });
    blueprint.scenes[0].keyBeats = [
      'Alex chooses to enter the station visibly despite the city watching.',
      'PEAK: Alex commits to crossing the threshold and accepts the reputation cost.',
    ];
    blueprint.scenes[0].dramaticStructure.pressurePeak = 'Alex commits to crossing the threshold and accepts the reputation cost.';
    blueprint.scenes[1].leadsTo = ['scene-3', 'scene-4'];
    blueprint.scenes[1].transitionOut = blueprint.scenes[1].leadsTo.map((toSceneId: string) => ({
      toSceneId,
      connector: toSceneId === 'scene-4' ? 'but' : 'therefore',
      causalLink: `${toSceneId} follows from Alex response to the stranger.`,
      pressureChange: 'The choice changes Alex public leverage.',
    }));
    blueprint.scenes[1].keyBeats = [
      'The stranger asks for help and risks Alex anonymity.',
      'PEAK: Alex choice shifts public leverage and city trust.',
    ];
    blueprint.scenes[1].dramaticStructure.turn = 'The stranger asks for help and risks Alex anonymity.';
    blueprint.scenes[1].dramaticStructure.pressurePeak = 'Alex choice shifts public leverage and city trust.';
    blueprint.scenes[1].choicePoint.branches = true;
    blueprint.scenes[2].leadsTo = ['scene-4'];
    blueprint.scenes[2].transitionOut = [{
      toSceneId: 'scene-4',
      connector: 'therefore',
      causalLink: 'The confrontation forces Alex to carry the aftermath.',
      pressureChange: 'Public risk becomes personal consequence.',
    }];
    blueprint.scenes.push({
      ...blueprint.scenes[1],
      id: 'scene-4',
      name: 'Aftermath Choice',
      description: 'Alex chooses how to carry the aftermath.',
      location: 'street',
      purpose: 'transition',
      themePressure: 'The aftermath makes Alex carry the identity cost of choosing involvement.',
      keyBeats: [
        'The aftermath narrows Alex options in the city.',
        'PEAK: Alex must carry the reputation cost into the next episode.',
      ],
      dramaticStructure: {
        question: 'How will Alex carry the aftermath?',
        turn: 'The city response narrows Alex options.',
        pressurePeak: 'Alex must carry the reputation cost into the next episode.',
        changedState: 'Alex leaves with a clearer public identity.',
      },
      leadsTo: [],
      transitionOut: [],
      residue: [{
        type: 'identity',
        description: 'Alex leaves with a clearer public identity.',
      }],
    });

    expect(() => (architect as any).validateBlueprint(blueprint, makeInput({ episodeNumber: 2 }))).not.toThrow();
  });
});
