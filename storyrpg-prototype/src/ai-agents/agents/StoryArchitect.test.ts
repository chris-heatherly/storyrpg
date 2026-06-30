import { describe, it, expect } from 'vitest';
import { StoryArchitect, type StoryArchitectInput } from './StoryArchitect';
import { BlueprintContractHygieneValidator } from '../validators/BlueprintContractHygieneValidator';

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

  it('seeds empty choice-scene optionHints from the treatment menu, leaving authored menus intact', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          majorChoicePressures: [
            'Drink the dark wine fully, sip it and set it down, or refuse it and ask for the white.',
            'Kiss him in the maze, take his hand and hold the line, or step back.',
          ],
          alternativePaths: ['Drinking the dark wine plants a quiet new appetite in later episodes.'],
        },
      },
    });
    const blueprint: any = {
      scenes: [
        { id: 's3-3', isEncounter: false, choicePoint: { type: 'expression', stakes: {}, optionHints: [] } },
        { id: 's3-4', isEncounter: false, choicePoint: { type: 'dilemma', stakes: {}, optionHints: ['Keep your own menu.', 'And a second.'] } },
      ],
    };
    (architect as any).seedChoiceMenusFromTreatment(blueprint, input);

    // First (empty) choice scene gets the first authored menu (drink/sip/refuse).
    expect(blueprint.scenes[0].choicePoint.optionHints.length).toBeGreaterThanOrEqual(2);
    expect(blueprint.scenes[0].choicePoint.optionHints.join(' ')).toMatch(/wine|sip|refuse/i);
    expect(blueprint.scenes[0].choicePoint.expectedResidue.join(' ')).toMatch(/new appetite/i);
    // The scene that already had an authored 2+ menu is left untouched.
    expect(blueprint.scenes[1].choicePoint.optionHints).toEqual(['Keep your own menu.', 'And a second.']);
  });

  it('seedChoiceMenusFromTreatment is a no-op without treatment guidance', () => {
    const input = makeInput({ seasonPlanDirectives: undefined });
    const blueprint: any = { scenes: [{ id: 's1', isEncounter: false, choicePoint: { type: 'expression', stakes: {}, optionHints: [] } }] };
    (architect as any).seedChoiceMenusFromTreatment(blueprint, input);
    expect(blueprint.scenes[0].choicePoint.optionHints).toEqual([]);
  });

  it('keeps treatment-residue fallback reminders out of planning register', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          alternativePaths: [
            'Walking over to Victor at the rooftop forces Mika to invent a reason she warned you off, opening a small Mika lie you can catch in a later episode.',
          ],
        },
      },
    });
    const blueprint: any = {
      startingSceneId: 's1',
      scenes: [{ id: 's1', isEncounter: false, choicePoint: { type: 'dilemma', stakes: {}, optionHints: [] } }],
      narrativePromises: [],
    };

    (architect as any).repairTreatmentResidue(blueprint, input);

    const reminderText = Object.values(blueprint.scenes[0].choicePoint.reminderPlan).join(' ');
    expect(reminderText).not.toMatch(/Show immediate residue|authored path|authored residue|reconvergence|Future scenes should remember|later episode/i);
    expect(reminderText).toContain('Mika');
    expect(reminderText).toContain('Victor');
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

describe('StoryArchitect cold-open Story Circle gate', () => {
  it('fails architecture before content when the cold open has no Story Circle role to fulfill', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const blueprint: any = {
      episodeId: 'episode-1',
      number: 1,
      title: 'Opening',
      synopsis: 'The protagonist enters pressure.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
      episodeCircle: {},
      storyCircleRole: [],
      themes: [],
      scenes: [
        {
          id: 's1-1',
          name: 'Opening',
          description: 'The protagonist reaches the station.',
          location: 'Station',
          mood: 'tense',
          purpose: 'bottleneck',
          dramaticQuestion: 'What happens at the station?',
          wantVsNeed: 'Stay hidden versus ask for help.',
          conflictEngine: 'The desk clerk recognizes the false name.',
          npcsPresent: [],
          narrativeFunction: 'Open the episode pressure.',
          keyBeats: [],
          leadsTo: ['s1-2'],
          choicePoint: {
            type: 'expression',
            stakes: { want: 'Stay hidden.', cost: 'Be noticed.', identity: 'Keep control.' },
            description: 'Choose how to answer the clerk.',
            optionHints: [],
          },
        },
        {
          id: 's1-2',
          name: 'Pressure',
          description: 'Pressure rises.',
          location: 'Station',
          mood: 'tense',
          purpose: 'bottleneck',
          dramaticQuestion: 'Can pressure be managed?',
          wantVsNeed: 'Push through versus listen.',
          conflictEngine: 'The room closes in.',
          npcsPresent: [],
          narrativeFunction: 'Develop pressure.',
          keyBeats: [],
          leadsTo: ['s1-3'],
          choicePoint: {
            type: 'expression',
            stakes: { want: 'Move forward.', cost: 'Lose time.', identity: 'Stay composed.' },
            description: 'Choose how to wait.',
            optionHints: [],
          },
        },
        {
          id: 's1-3',
          name: 'Aftermath',
          description: 'The consequence lands.',
          location: 'Street',
          mood: 'charged',
          purpose: 'bottleneck',
          dramaticQuestion: 'What changed?',
          wantVsNeed: 'Leave safely versus face the truth.',
          conflictEngine: 'The old route is gone.',
          npcsPresent: [],
          narrativeFunction: 'Land the aftermath.',
          keyBeats: [],
          leadsTo: [],
        },
      ],
      startingSceneId: 's1-1',
      bottleneckScenes: ['s1-1', 's1-2', 's1-3'],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    expect(() => (architect as any).validateBlueprint(blueprint, makeInput({ episodeStoryCircleRole: [] })))
      .toThrow(/ColdOpenStoryCircleGate/);
  });
});

describe('StoryArchitect treatment fidelity validation', () => {
  it('flags duplicate staged high-pressure events at blueprint time but allows blog recaps', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const duplicateBlueprint: any = {
      scenes: [
        {
          id: 's1-4',
          name: 'Cișmigiu attack',
          description: 'In Cișmigiu Gardens, a shadow attacks Kylie and Victor rescues her.',
          location: 'Cișmigiu Gardens',
          keyBeats: ['A shadow pins Kylie to a willow until Victor rescues her.'],
        },
        {
          id: 'treatment-enc-1-1',
          name: 'Cișmigiu attack encounter',
          description: 'At 1am in Cișmigiu Gardens, a shadow attacks Kylie and Victor rescues her.',
          location: 'Cișmigiu Gardens',
          keyBeats: ['The shadow attack and Victor rescue are staged again.'],
        },
      ],
    };
    const recapBlueprint: any = {
      scenes: [
        duplicateBlueprint.scenes[0],
        {
          id: 's1-5',
          name: 'Dating After Dusk post',
          description: 'Kylie writes a blog recap of the Cișmigiu attack and Victor rescue.',
          location: "Kylie's Lipscani Apartment",
          keyBeats: ['The blog post retells the attack rather than restaging it.'],
        },
      ],
    };
    const setupToEncounterBlueprint: any = {
      scenes: [
        {
          id: 's1-rooftop-setup',
          name: 'Rooftop setup',
          description: 'The rooftop social pressure builds toward the night encounter.',
          location: 'Rooftop Bar',
          leadsTo: ['treatment-enc-1-1'],
          keyBeats: ['The Dusk Club locks into place before the dangerous walk home.'],
        },
        {
          id: 'treatment-enc-1-1',
          name: 'Cișmigiu attack encounter',
          description: 'At 1am in Cișmigiu Gardens, a shadow attacks Kylie and Victor rescues her.',
          location: 'Cișmigiu Gardens',
          isEncounter: true,
          keyBeats: ['The shadow attack and Victor rescue are staged.'],
        },
      ],
    };

    expect((architect as any).collectBlueprintDuplicateEventIssues(duplicateBlueprint).join('\n')).toContain('restage the same high-pressure event');
    expect((architect as any).collectBlueprintDuplicateEventIssues(recapBlueprint)).toEqual([]);
    expect((architect as any).collectBlueprintDuplicateEventIssues(setupToEncounterBlueprint)).toEqual([]);
  });

  it('does not hard-bind composite seed bundles as one scene-local required beat', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const beat = {
      id: 's1-1-seed8',
      tier: 'seed',
      sourceTurn: "The quartz (the apartment's standing ward); the side-entrance key card; Mika's half-second of stillness; the rougher man at the kitchen entrance; the black roses and cream-stock card delivered impossibly fast; the stray dog in the courtyard, watching; the readership number climbing at episode's end.",
      mustDepict: "The quartz (the apartment's standing ward); the side-entrance key card; Mika's half-second of stillness; the rougher man at the kitchen entrance; the black roses and cream-stock card delivered impossibly fast; the stray dog in the courtyard, watching; the readership number climbing at episode's end.",
    };

    expect((architect as any).isCompositeSeedBundleBeat(beat, `${beat.sourceTurn} ${beat.mustDepict}`)).toBe(true);
  });

  it('splits two-anchor rooftop plus Cișmigiu signature beats before scene writing', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const text = 'Two anchors, light then dark — the rooftop bar at sunset where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.';

    expect((architect as any).isTwoAnchorRooftopEncounterBeat(text)).toBe(true);
  });

  it('rebounds broad cold-open obligations to social and blog scenes before density validation', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const blueprint: any = {
      scenes: [
        {
          id: 's1-arrival-cold-open',
          name: 'Arrival Cold Open',
          description: 'Kylie arrives in Bucharest with two suitcases.',
          location: 'Lipscani',
          narrativeFunction: 'Kylie reaches Bucharest and tries to reinvent herself.',
          signatureMoment: 'At the rooftop bar at sunset, the Dusk Club locks into place and Kylie catches both men watching her.',
          requiredBeats: [
            {
              id: 's1-1-hook1',
              tier: 'you',
              mustDepict: 'Kylie arrives in Bucharest and forms the Dusk Club, seeking reinvention and her own byline.',
              sourceTurn: 'Kylie arrives in Bucharest and forms the Dusk Club, seeking reinvention and her own byline.',
            },
            {
              id: 's1-1-story-circle-you-part-1',
              tier: 'authored',
              mustDepict: '(Ep1): Kylie’s ordinary world is reinvention-as-performance.',
              sourceTurn: '(Ep1): Kylie’s ordinary world is reinvention-as-performance.',
            },
            {
              id: 's1-1-story-circle-you-part-3',
              tier: 'authored',
              mustDepict: 'Opening promise: desire, intimacy, and predation will blur.',
              sourceTurn: 'Opening promise: desire, intimacy, and predation will blur.',
            },
          ],
          authoredTreatmentFields: [
            {
              id: 'field-viral',
              sourceText: 'by 6pm it has 80,000 reads. Kylie arrives in Bucharest, christening the Dusk Club, then writes a post.',
              label: 'final prose',
              targetSceneIds: ['s1-arrival-cold-open'],
            },
          ],
        },
        {
          id: 's1-rooftop-setup',
          name: 'Dusk Club Rooftop',
          description: 'The Dusk Club is christened over negronis at a rooftop bar.',
          location: 'Rooftop Bar',
          requiredBeats: [],
          keyBeats: [],
        },
        {
          id: 's1-blog-aftermath',
          name: 'Blog Aftermath',
          description: 'Kylie writes the first viral Mr. Midnight post.',
          location: 'Lipscani Apartment',
          requiredBeats: [],
          authoredTreatmentFields: [],
        },
      ],
    };

    (architect as any).repairBroadArrivalRequiredBeats(blueprint);
    (architect as any).repairRooftopSetupDensity(blueprint);

    const coldOpen = blueprint.scenes[0];
    const rooftop = blueprint.scenes[1];
    const blog = blueprint.scenes[2];

    expect(coldOpen.signatureMoment ?? '').not.toContain('rooftop bar');
    expect(coldOpen.requiredBeats.map((beat: any) => beat.id)).toEqual(['s1-1-hook1-arrival']);
    expect(rooftop.requiredBeats.map((beat: any) => beat.id)).toContain('s1-1-hook1-dusk-club');
    expect(rooftop.signatureMoment).toContain('rooftop bar');
    expect(blog.requiredBeats.map((beat: any) => beat.id)).toContain('s1-1-hook1-byline');
    expect(blog.authoredTreatmentFields.map((field: any) => field.id)).toContain('field-viral');
    expect(coldOpen.authoredTreatmentFields ?? []).toEqual([]);
  });

  it('does not hard-bind defensive writing strategy to a generic release scene', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const blueprint: any = {
      scenes: [
        {
          id: 's1-arrival-cold-open',
          name: 'Kylie arrives in Bucharest',
          description: 'Kylie arrives and gathers herself.',
          location: 'Lipscani',
          requiredBeats: [{
            id: 's1-1-story-circle-you-part-2',
            tier: 'authored',
            mustDepict: "She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later.",
            sourceTurn: "She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later.",
          }],
        },
        {
          id: 'treatment-enc-1-1',
          name: 'Cișmigiu attack',
          description: 'A shadow attacks in the park.',
          location: 'Cișmigiu Gardens',
          isEncounter: true,
        },
        {
          id: 's1-6',
          name: "Aftermath pressure changes Kylie's footing",
          description: 'release scene 6',
          location: "Kylie's Lipscani Apartment",
          requiredBeats: [],
        },
      ],
    };

    (architect as any).repairBroadArrivalRequiredBeats(blueprint);

    const release = blueprint.scenes[2];
    expect(release.requiredBeats ?? []).toEqual([]);
    expect(blueprint.scenes[0].requiredBeats.map((beat: any) => beat.id)).toEqual([
      's1-1-story-circle-you-part-2-arrival',
    ]);
  });

  it('removes seed and spoiler prompt pollution from rooftop setup while keeping the signature', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const blueprint: any = {
      scenes: [
        {
          id: 's1-rooftop-setup',
          name: 'Rooftop bar at sunset',
          description: 'The rooftop meeting turns the city from possibility into visible romantic and social pressure.',
          location: 'Vâlcescu Club',
          signatureMoment: 'At the rooftop bar at sunset, the Dusk Club locks into place and Kylie catches both men watching her.',
          keyBeats: [
            'Mika\'s half-second of stillness',
            'the black roses and cream-stock card delivered impossibly fast',
            'Mika is a succubus bound to Victor\'s coven by a 57-year contract, acting as his lure and spy.',
            'At the rooftop bar at sunset, the Dusk Club locks into place and Kylie catches both men watching her.',
          ],
          requiredBeats: [
            { id: 'seed-1', tier: 'seed', mustDepict: 'Mika\'s half-second of stillness', sourceTurn: 'Mika\'s half-second of stillness' },
            { id: 'seed-2', tier: 'seed', mustDepict: 'the black roses and cream-stock card delivered impossibly fast', sourceTurn: 'the black roses and cream-stock card delivered impossibly fast' },
            { id: 'seed-3', tier: 'seed', mustDepict: 'Mika is a succubus bound to Victor\'s coven by a 57-year contract, acting as his lure and spy.', sourceTurn: 'Mika is a succubus bound to Victor\'s coven by a 57-year contract, acting as his lure and spy.' },
          ],
        },
      ],
    };

    (architect as any).repairRooftopSetupDensity(blueprint);

    expect(blueprint.scenes[0].keyBeats).toEqual([
      'At the rooftop bar at sunset, the Dusk Club locks into place and Kylie catches both men watching her.',
    ]);
    expect(blueprint.scenes[0].requiredBeats).toEqual([]);
  });

  it('repairs authored branchlet and seed residue into blueprint memory fields before validation', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      seasonPlanDirectives: {
        treatmentGuidance: {
          alternativePaths: ['Reading the messages leaves Kylie more bruised in episode 2; blocking leaves her brittle.'],
          consequenceSeeds: ['The grandmother gold chain and the Dating After Dusk draft.'],
          consequenceResidue: 'The draft file remains open on the kitchen table.',
        },
      },
    });
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Arrival',
      synopsis: 'Kylie arrives in Bucharest.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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

  it('records consequence-seed emitters on a choice-bearing scene even when the origin is an encounter (no choicePoint)', () => {
    // GAP-C: the origin scene the seed is "set on" is preferentially the encounter
    // (the episode hinge), which has NO choicePoint and never reaches ChoiceAuthor.
    // The old guard (`if (originScene.choicePoint)`) silently dropped the seed for
    // such episodes. The fix routes setsTreatmentSeeds to the nearest choice-bearing
    // scene so the deterministic emitter always has a choice to attach the setFlag to.
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({ episodeNumber: 3 });
    const guidance = { consequenceSeeds: ["Darian's poison is set in the well."] } as any;
    const blueprint: any = {
      episodeId: 'episode-3',
      number: 3,
      suggestedFlags: [],
      scenes: [
        {
          id: 's3-1',
          isEncounter: false,
          choicePoint: { type: 'strategic', stakes: {}, description: 'A real decision.', optionHints: [] },
          encounterSetupContext: [],
        },
        // The origin: an encounter (no choicePoint) — preferred by the origin-scene rule.
        { id: 'enc-3-1', isEncounter: true, encounterSetupContext: [] },
      ],
    };

    (architect as any).registerConsequenceSeedEmitters(blueprint, input, guidance);

    const seedFlag = 'treatment_seed_ep3_1';
    // The encounter origin READS the seed via its setup context (precondition position)...
    expect(blueprint.scenes[1].encounterSetupContext.some((d: string) => d.includes(seedFlag))).toBe(true);
    // ...and the choice-bearing scene is recorded to SET it (the guard fix).
    expect(blueprint.scenes[0].choicePoint.setsTreatmentSeeds).toContain(seedFlag);
    // The flag is registered as known on the blueprint.
    expect(blueprint.suggestedFlags.some((f: any) => f.name === seedFlag)).toBe(true);
  });

  it('distributes consequence-seed emitters to the choice scene whose authored content matches each seed', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({ episodeNumber: 1 });
    const guidance = {
      consequenceSeeds: [
        'The quartz Kylie did or did not accept.',
        "The key card to Vâlcescu Club's side entrance.",
        'Mika sees Victor and goes still.',
      ],
    } as any;
    const blueprint: any = {
      episodeId: 'episode-1',
      number: 1,
      suggestedFlags: [],
      scenes: [
        {
          id: 's1-1',
          choicePoint: {
            type: 'relationship',
            stakes: {},
            description: 'At the club door, Mika offers the side-entrance key card.',
            optionHints: ['Accept the key card', 'Leave it with Mika'],
            expectedResidue: [
              'The quartz Kylie did or did not accept.',
              "The key card to Vâlcescu Club's side entrance.",
              'Mika sees Victor and goes still.',
            ],
          },
        },
        {
          id: 's1-2',
          choicePoint: {
            type: 'relationship',
            stakes: {},
            description: 'At the bookshop, Stela presses rose quartz into your hand.',
            optionHints: ['Take the quartz', 'Decline the quartz'],
          },
        },
        {
          id: 's1-3',
          choicePoint: {
            type: 'relationship',
            stakes: {},
            description: 'On the rooftop, Mika notices Victor and freezes.',
            optionHints: ['Follow Mika toward food', 'Walk over to Victor'],
          },
        },
        { id: 'enc-1-1', isEncounter: true, encounterSetupContext: [] },
      ],
    };

    (architect as any).registerConsequenceSeedEmitters(blueprint, input, guidance);

    expect(blueprint.scenes[0].choicePoint.setsTreatmentSeeds).toEqual(['treatment_seed_ep1_2']);
    expect(blueprint.scenes[1].choicePoint.setsTreatmentSeeds).toEqual(['treatment_seed_ep1_1']);
    expect(blueprint.scenes[2].choicePoint.setsTreatmentSeeds).toEqual(['treatment_seed_ep1_3']);
    expect(blueprint.scenes[3].encounterSetupContext).toEqual(expect.arrayContaining([
      expect.stringContaining('treatment_seed_ep1_1'),
      expect.stringContaining('treatment_seed_ep1_2'),
      expect.stringContaining('treatment_seed_ep1_3'),
    ]));
  });

  it('registerBranchAxisEmitters registers ending axes in suggestedFlags and records them on a choice scene', () => {
    // Gen-4 R3: the season's ending-axis flags (treatment_branch_*) surface to the
    // episode via seasonPlanDirectives.flagsToSet but were never SET on-page, so the
    // endings they drive were unreachable. registerBranchAxisEmitters wires them.
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const input = makeInput({
      episodeNumber: 2,
      seasonPlanDirectives: {
        flagsToSet: [
          { flag: 'treatment_branch_essence_spent_vs_hoarded', description: 'Essence ledger axis.' },
          { flag: 'treatment_branch_mercy_vs_vengeance', description: 'Mercy axis.' },
          { flag: 'route_some_route', description: 'Not an ending axis — ignored.' },
          { flag: 'plain_flag', description: 'Not an ending axis — ignored.' },
        ],
      },
    });
    const blueprint: any = {
      episodeId: 'episode-2',
      number: 2,
      suggestedFlags: [],
      scenes: [
        { id: 's2-1', isEncounter: true, encounterSetupContext: [] },
        {
          id: 's2-2',
          choicePoint: { type: 'dilemma', stakes: {}, description: 'A real fork.', optionHints: [], branches: [{}, {}] },
          encounterSetupContext: [],
        },
      ],
    };

    (architect as any).registerBranchAxisEmitters(blueprint, input);

    // Both ending axes registered as known flags; non-axis flags ignored.
    const names = blueprint.suggestedFlags.map((f: any) => f.name);
    expect(names).toContain('treatment_branch_essence_spent_vs_hoarded');
    expect(names).toContain('treatment_branch_mercy_vs_vengeance');
    expect(names).not.toContain('route_some_route');
    expect(names).not.toContain('plain_flag');
    // Recorded on the choice-bearing scene so emitSceneBranchAxes can set them on-page.
    expect(blueprint.scenes[1].choicePoint.setsBranchAxes).toEqual([
      'treatment_branch_essence_spent_vs_hoarded',
      'treatment_branch_mercy_vs_vengeance',
    ]);
  });

  it('repairs treatment theme pressure and forward pressure into validator-visible fields', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
          you: 'TBD',
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
    expect(blueprint.scenes[0].keyBeats.join('\n')).toContain('Because Mika texts');
    expect(JSON.stringify(blueprint.scenes[0])).not.toMatch(/Forward pressure:/i);
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
          narrativeFunction: 'Victor you.',
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
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
          purpose: 'transition',
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
          purpose: 'transition',
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

  // Build an N-scene linear blueprint (each scene leads to the next, last is
  // terminal). `bottleneckIndices` mark scenes whose purpose is 'bottleneck';
  // everything else is a plain 'transition'. No choicePoints by default.
  const linearBlueprint = (count: number, bottleneckIndices: number[] = []): any => ({
    episodeId: 'episode-1',
    title: 'Linear',
    synopsis: '',
    arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
    themes: [],
    startingSceneId: 's1',
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
    scenes: Array.from({ length: count }, (_, i) => ({
      id: `s${i + 1}`,
      name: `Scene ${i + 1}`,
      description: `Scene ${i + 1}.`,
      location: 'somewhere',
      mood: 'neutral',
      purpose: bottleneckIndices.includes(i) ? 'bottleneck' : 'transition',
      dramaticQuestion: '',
      wantVsNeed: '',
      conflictEngine: '',
      npcsPresent: [],
      narrativeFunction: '',
      keyBeats: [],
      leadsTo: i < count - 1 ? [`s${i + 2}`] : [],
    })),
  });

  const validBranchScenes = (blueprint: any) =>
    blueprint.scenes.filter(
      (s: any) =>
        s.choicePoint?.branches &&
        s.choicePoint.type !== 'expression' &&
        new Set(s.leadsTo || []).size >= 2 &&
        !s.isEncounter,
    );

  it('routes the far branch arm to a later reconvergence scene instead of the immediate next two (deeper divergence)', () => {
    const architect = new StoryArchitect(config);
    // 5 linear scenes: enough room for the far arm to skip ahead, but below the
    // 2-branch floor so exactly one branch is synthesized.
    const blueprint = linearBlueprint(5);

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    const branches = validBranchScenes(blueprint);
    expect(branches).toHaveLength(1);
    // Near arm is the immediate next scene; far arm skips ahead (NOT the trivial
    // next-two ['s2','s3']) so the arms diverge before reconverging.
    expect(branches[0].leadsTo).toEqual(['s2', 's4']);
    expect(branches[0].leadsTo).not.toEqual(['s2', 's3']);
    expect(branches[0].choicePoint.reminderPlan).toBeUndefined();
    expect(branches[0].choicePoint.expectedResidue.join(' ')).not.toMatch(/selected route|path the player|route chosen/i);
  });

  it('reconverges the far arm at a downstream bottleneck scene when one exists', () => {
    const architect = new StoryArchitect(config);
    // s4 is a bottleneck — the far arm should target it as the designed merge point.
    const blueprint = linearBlueprint(5, [3]);

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    const branches = validBranchScenes(blueprint);
    expect(branches).toHaveLength(1);
    expect(branches[0].leadsTo).toEqual(['s2', 's4']);
  });

  it('honors an opted-in branch floor of 2 on a big-enough (≥6-scene) episode', () => {
    // The default floor stays 1 (golden-stable); a story opts into richer
    // branching via minSceneGraphBranchesPerEpisode.
    const architect = new StoryArchitect(config, {
      minSceneGraphBranchesPerEpisode: 2,
    } as any);
    const blueprint = linearBlueprint(6);

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    // Two distinct, valid reconvergent branch points are synthesized.
    const branches = validBranchScenes(blueprint);
    expect(branches.length).toBeGreaterThanOrEqual(2);
    // Branch points must be distinct scenes.
    expect(new Set(branches.map((s: any) => s.id)).size).toBe(branches.length);
    // Every branch target stays reachable (no orphaned/unreachable scenes): BFS
    // from the start reaches all scenes.
    const byId = new Map(blueprint.scenes.map((s: any) => [s.id, s]));
    const seen = new Set<string>([blueprint.startingSceneId]);
    const queue = [blueprint.startingSceneId];
    while (queue.length) {
      const cur = byId.get(queue.shift()!) as any;
      for (const next of cur?.leadsTo || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(blueprint.scenes.length);
  });

  it('keeps the floor at 1 (single branch) on a small (3-scene) episode that cannot carry a second', () => {
    const architect = new StoryArchitect(config);
    const blueprint = linearBlueprint(3);

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    // Only one branch is feasible (only s1 sits before the final two scenes).
    expect(validBranchScenes(blueprint)).toHaveLength(1);
  });

  const mandatoryBeat = (id: string) => ({ id: `${id}-rb1`, sourceTurn: 'plot turn', mustDepict: 'plot turn', tier: 'authored' as const });

  it('never routes a synthesized far arm PAST a scene carrying an authored beat (the Victor-OR-Radu fix)', () => {
    const architect = new StoryArchitect(config);
    const blueprint = linearBlueprint(5);
    // s3 (index 2) holds the mandatory plot-turn beat — the far arm must reconverge at
    // or before it, never skip it.
    blueprint.scenes[2].requiredBeats = [mandatoryBeat('s3')];
    const sceneIndex = new Map<string, number>(blueprint.scenes.map((s: any, i: number) => [s.id, i]));
    const id = (architect as any).synthesizeBranchForCandidate(blueprint.scenes, sceneIndex);
    const branch = blueprint.scenes.find((s: any) => s.id === id);
    const targetIdx = (branch?.leadsTo || []).map((t: string) => sceneIndex.get(t) as number);
    expect(Math.max(...targetIdx)).toBeLessThanOrEqual(2); // never lands past s3 (index 2)
  });

  it('prefers a SAFE branch point — branches at the mandatory scene itself rather than skipping it', () => {
    const architect = new StoryArchitect(config);
    const blueprint = linearBlueprint(5);
    // s2 (index 1) is mandatory; the safe branch point is s2 itself (its own beat plays
    // on both arms; its next scene s3 carries no beat to skip).
    blueprint.scenes[1].requiredBeats = [mandatoryBeat('s2')];
    const sceneIndex = new Map<string, number>(blueprint.scenes.map((s: any, i: number) => [s.id, i]));
    const id = (architect as any).synthesizeBranchForCandidate(blueprint.scenes, sceneIndex);
    expect(id).toBe('s2');
  });

  it('never synthesizes a branch that skips a planned encounter scene', () => {
    const architect = new StoryArchitect(config);
    const blueprint = linearBlueprint(5);
    blueprint.scenes[1].id = 'enc-1-1';
    blueprint.scenes[1].name = 'Planned Encounter';
    blueprint.scenes[1].isEncounter = true;
    blueprint.scenes[1].plannedEncounterId = 'enc-1-1';
    blueprint.scenes[0].leadsTo = ['enc-1-1'];
    const sceneIndex = new Map<string, number>(blueprint.scenes.map((s: any, i: number) => [s.id, i]));

    const id = (architect as any).synthesizeBranchForCandidate(blueprint.scenes, sceneIndex);
    const branch = blueprint.scenes.find((s: any) => s.id === id);

    expect(id).toBe('s3');
    expect(branch.leadsTo).not.toContain('enc-1-1');
    expect(blueprint.scenes[0].leadsTo).toEqual(['enc-1-1']);
  });

  it('does not synthesize a skip branch when EVERY content scene carries an authored beat', () => {
    const architect = new StoryArchitect(config);
    const blueprint = linearBlueprint(5);
    // Dense treatment episodes bind authored turns to every content scene, so no
    // skip-safe branch window exists. Do not fabricate a scene-graph fork that
    // bypasses required setup; branch validation handles this as a linear bottleneck.
    blueprint.scenes.forEach((s: any, i: number) => { s.requiredBeats = [mandatoryBeat(`s${i + 1}`)]; });

    (architect as any).repairSceneGraphBranchCoverage(blueprint);

    expect(validBranchScenes(blueprint)).toEqual([]);
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

  it('does not use choice reminderPlan text as transition prose', () => {
    const architect = new StoryArchitect(config);
    const scene: any = {
      id: 's1',
      name: 'Bookshop Door',
      description: 'Kylie decides how much of Mika’s help to accept.',
      location: 'bookshop',
      mood: 'tense',
      purpose: 'branch',
      dramaticQuestion: '',
      wantVsNeed: '',
      conflictEngine: '',
      npcsPresent: [],
      narrativeFunction: '',
      keyBeats: [],
      leadsTo: ['s2'],
      choicePoint: {
        type: 'dilemma',
        branches: false,
        stakes: { want: 'Get inside safely', cost: 'Depend on Mika', identity: 'Trust under pressure' },
        description: 'Choose whether to accept Mika’s key card.',
        optionHints: ['Take the card', 'Refuse it'],
        reminderPlan: {
          immediate: 'In the next room, access, trust, and pressure have already shifted.',
          shortTerm: 'People remember what the protagonist risked.',
        },
      },
    };
    const target: any = {
      id: 's2',
      name: 'Back Room',
      description: 'The bookshop turns private.',
      dramaticQuestion: 'Will Kylie trust the introduction?',
      conflictEngine: '',
    };

    const link = (architect as any).buildTransitionCausalLink(scene, target, 'therefore');

    expect(link).toContain('Choose whether to accept Mika’s key card.');
    expect(link).not.toContain('In the next room, access, trust, and pressure have already shifted.');
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

  it('repairs multi-character choice scenes with a power-dynamic shift for scene turn validation', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Text at the Door',
      synopsis: 'A friend arrives with a warning.',
      scenes: [
        {
          id: 's1-6',
          name: 'Stela Texts',
          description: 'Stela texts that she had a horrible dream and is coming to Kylie.',
          location: 'apartment',
          mood: 'uneasy',
          purpose: 'bottleneck',
          dramaticQuestion: 'Will Kylie let Stela interrupt the glamour?',
          wantVsNeed: 'Protect the sparkling night vs listen to the friend who sees danger.',
          conflictEngine: 'Stela arrives with a warning that cuts against the romance.',
          dramaticStructure: {
            question: 'Will Kylie let Stela interrupt the glamour?',
            turn: 'Stela sends the warning text.',
            pressurePeak: 'Kylie must answer before the mood can settle.',
            changedState: 'Kylie knows Stela is coming over.',
          },
          personalStake: 'Kylie risks losing the fantasy or ignoring a friend.',
          npcsPresent: ['stela'],
          narrativeFunction: 'Cliffhanger handoff into protective friendship pressure.',
          keyBeats: ['Stela texts about the horrible dream.', 'Kylie answers the door.'],
          leadsTo: [],
          transitionOut: [],
          residue: [{ type: 'information', description: 'Stela is coming over with herbs.' }],
          choicePoint: {
            type: 'expression',
            stakes: { want: 'Keep the night sparkling', cost: 'Dismiss Stela', identity: 'romantic or careful' },
            description: 'Choose how openly Kylie receives Stela’s warning.',
            optionHints: ['Laugh it off', 'Ask what she saw'],
            consequenceDomain: 'relationship',
            reminderPlan: { immediate: 'Stela notices the tone.', shortTerm: 'The warning colors the next scene.' },
          },
        },
      ],
      startingSceneId: 's1-6',
      bottleneckScenes: ['s1-6'],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).repairSceneTurnContracts(blueprint);

    expect(blueprint.scenes[0].keyBeats.join('\n')).toContain('power dynamic shifts');
    expect(blueprint.scenes[0].residue[1]).toMatchObject({ type: 'relationship' });
    expect((architect as any).collectSceneTurnContractIssues(blueprint, false).join('\n')).not.toContain('lacks a power-dynamic shift');
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
          storyCircleTarget: 'take',
          storyCircleTargetRationale: 'The park attack demands a cost for Lena entering the supernatural world.',
          storyCircleTargetEvidence: {
            episodeStoryCircleRole: ['take'],
            episodeQuestion: 'Will Lena pay the price of knowing what stalks her?',
            protagonistChange: 'Lena can no longer treat the threat as ordinary danger.',
            cliffhangerHandoff: 'next_need',
          },
          relevantSkills: ['resolve', 'empathy'],
          encounterBuildup: 'The prior scenes establish Andrei as a watcher and the park as a place of threat.',
          encounterSetupContext: ['flag:noticed_andrei — Andrei reacts if Lena clocks him before the attack'],
          isBranchPoint: true,
        }],
      },
    });
  }

  it('uses authored planned encounters instead of generic long-episode minimums', () => {
    const architect = new StoryArchitect(config, { minEncountersLong: 2 } as any);

    expect((architect as any).getMinEncountersForBlueprint(8, makePlannedEncounterInput())).toBe(1);
    expect((architect as any).getMinEncountersForBlueprint(8, makeInput())).toBe(2);
  });

  it('binds a matching unbound encounter scene even when the model chose the wrong encounter type', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Night Teeth',
      synopsis: 'Lena is tested.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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
      encounterStoryCircleTarget: 'take',
      encounterStoryCircleTargetRationale: expect.stringContaining('cost'),
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
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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

  it('does not promote an incompatible authored-turn scene over the real planned encounter', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Dating After Dusk',
      synopsis: 'Kylie arrives in Bucharest and is attacked in the park.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
      scenes: [
        {
          id: 's1-1',
          name: 'Lipscani Arrival',
          description: 'Kylie unpacks in her Lipscani sublet.',
          location: 'Lipscani',
          mood: 'charged',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mika', 'stela'],
          narrativeFunction: 'Introduces the new life.',
          keyBeats: ['Kylie meets Mika and Stela.'],
          requiredBeats: [{ id: 's1-1-rb1', tier: 'authored', mustDepict: 'Kylie unpacks in her Lipscani sublet and meets Mika and Stela.' }],
          leadsTo: ['s1-2'],
        },
        {
          id: 's1-2',
          name: 'Dusk Club Rooftop',
          description: 'The Dusk Club is christened at a rooftop bar where Kylie catches the eyes of two very different men.',
          location: 'Cișmigiu Gardens',
          mood: 'charged',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mika', 'stela'],
          narrativeFunction: 'The social spark before the danger.',
          keyBeats: ['The rooftop gets named the Dusk Club.'],
          requiredBeats: [{
            id: 's1-2-rb1',
            tier: 'authored',
            mustDepict: 'The Dusk Club is christened at a rooftop bar where Kylie catches the eyes of two very different men.',
          }],
          turnContract: {
            turnId: 's1-2-turn',
            source: 'treatment',
            centralTurn: 'The Dusk Club is christened at a rooftop bar where Kylie catches the eyes of two very different men.',
            beforeState: '',
            turnEvent: 'The Dusk Club is christened at a rooftop bar where Kylie catches the eyes of two very different men.',
            afterState: '',
            handoff: '',
          },
          leadsTo: ['s1-3'],
        },
        {
          id: 's1-3',
          name: 'Cișmigiu Park Attack',
          description: 'A mysterious attacker corners Kylie in Cismigiu Park while Andrei watches from shadows.',
          location: 'Cișmigiu Gardens',
          mood: 'terrifying',
          purpose: 'bottleneck',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mysterious_attacker'],
          narrativeFunction: 'The supernatural predator tests Kylie.',
          keyBeats: ['Kylie must decide whether to fight, flee, or freeze.'],
          leadsTo: ['s1-4'],
          isEncounter: true,
          encounterType: 'exploration',
          encounterDescription: 'A park confrontation with the mysterious attacker.',
          encounterDifficulty: 'hard',
        },
        {
          id: 's1-4',
          name: 'Blog Post',
          description: 'Kylie writes her first Mr. Midnight post.',
          location: 'Lipscani',
          mood: 'electric',
          purpose: 'transition',
          dramaticQuestion: '',
          wantVsNeed: '',
          conflictEngine: '',
          npcsPresent: ['mika'],
          narrativeFunction: 'The aftermath becomes public.',
          keyBeats: ['The post goes viral.'],
          leadsTo: [],
        },
      ],
      startingSceneId: 's1-1',
      bottleneckScenes: ['s1-1', 's1-2', 's1-3'],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).repairPlannedEncounterCoverage(blueprint, makePlannedEncounterInput());

    const rooftop = blueprint.scenes.find((scene: any) => scene.id === 's1-2');
    const encounter = blueprint.scenes.find((scene: any) => scene.id === 's1-3');
    expect(rooftop.isEncounter).not.toBe(true);
    expect(rooftop.requiredBeats[0].mustDepict).toContain('Dusk Club');
    expect(encounter).toMatchObject({
      isEncounter: true,
      plannedEncounterId: 'enc-1-1',
      encounterType: 'social',
    });
    expect(blueprint.scenes.map((scene: any) => scene.id)).toEqual(['s1-1', 's1-2', 's1-3', 's1-4']);
  });
});

describe('StoryArchitect opening agency requirements', () => {
  function makeOpeningChoiceBlueprint(): any {
    return {
      episodeId: 'episode-1',
      title: 'Opening',
      synopsis: 'The season begins.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
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

    // F6/F7: a major choice missing consequenceDomain, an incomplete stakes
    // sub-field, or a missing reminderPlan is repaired in place, not rejected.
    const majorScene = blueprint.scenes.find(
      (s: any) => s.choicePoint && (s.choicePoint.branches || s.choicePoint.type === 'dilemma'),
    );
    delete majorScene.choicePoint.consequenceDomain;
    delete majorScene.choicePoint.stakes.identity;
    delete majorScene.choicePoint.reminderPlan;

    expect(() => (architect as any).validateBlueprint(blueprint, makeInput({ episodeNumber: 2 }))).not.toThrow();
    expect(majorScene.choicePoint.consequenceDomain).toBeTruthy();
    expect(majorScene.choicePoint.stakes.identity).toBeTruthy();
    expect(majorScene.choicePoint.reminderPlan?.immediate).toBeTruthy();
    expect(majorScene.choicePoint.reminderPlan?.shortTerm).toBeTruthy();
  });
});

describe('StoryArchitect.classifyBlueprintFailure (validator tiering, B1)', () => {
  it('treats advisory-only failures as degradable (not hard)', () => {
    const c = StoryArchitect.classifyBlueprintFailure(
      '[TreatmentFidelity] Blueprint does not turn any authored major choice pressure into a real choicePoint.',
    );
    expect(c.hasAdvisory).toBe(true);
    expect(c.hasHard).toBe(false);
    expect(c.advisoryOnly).toBe(true);
    expect(c.retryable).toBe(true);
  });

  it('recognizes all five advisory tags', () => {
    for (const tag of ['[TreatmentFidelity]', '[DramaticStructure]', '[ThemePressure]', '[SceneTurnContract]', '[EpisodePressure]']) {
      expect(StoryArchitect.classifyBlueprintFailure(`${tag} something`).advisoryOnly).toBe(true);
    }
  });

  it('keeps structural failures hard (must block)', () => {
    const c = StoryArchitect.classifyBlueprintFailure('Bottleneck scene "s9" references a non-existent scene.');
    expect(c.hasHard).toBe(true);
    expect(c.advisoryOnly).toBe(false);
    expect(c.retryable).toBe(true);
  });

  it('retries over-cap scene counts as hard structural failures', () => {
    const c = StoryArchitect.classifyBlueprintFailure('Blueprint must have no more than 6 scenes');
    expect(c.hasHard).toBe(true);
    expect(c.advisoryOnly).toBe(false);
    expect(c.retryable).toBe(true);
  });

  it('retries duplicate high-pressure event staging as a hard blueprint failure', () => {
    const c = StoryArchitect.classifyBlueprintFailure(
      'Scene "s3-6" appears to restage the same high-pressure event as "s3-1" (cismigiu, victor).',
    );
    expect(c.hasHard).toBe(true);
    expect(c.advisoryOnly).toBe(false);
    expect(c.retryable).toBe(true);
  });

  it('keeps parse failures hard and flagged', () => {
    const c = StoryArchitect.classifyBlueprintFailure('Failed to parse JSON response: Unexpected token');
    expect(c.isParseError).toBe(true);
    expect(c.hasHard).toBe(true);
    expect(c.advisoryOnly).toBe(false);
  });

  it('mixed hard+advisory is NOT advisoryOnly (hard wins, still blocks)', () => {
    const c = StoryArchitect.classifyBlueprintFailure(
      '[DramaticStructure] weak find\nBottleneck scene "s3" references a non-existent scene.',
    );
    expect(c.hasAdvisory).toBe(true);
    expect(c.hasHard).toBe(true);
    expect(c.advisoryOnly).toBe(false);
  });

  it('an unrecognized error is neither retryable nor advisory', () => {
    const c = StoryArchitect.classifyBlueprintFailure('some unexpected runtime error');
    expect(c.retryable).toBe(false);
    expect(c.advisoryOnly).toBe(false);
  });
});

describe('StoryArchitect Story Circle episodeCircle verification (tier 2)', () => {
  const episodeCircle = (overrides: Record<string, string | undefined> = {}) => ({
    you: 'Alex starts in a familiar pressure state.',
    need: 'Alex wants safety but needs agency.',
    go: 'Alex crosses into the dangerous case.',
    search: 'Alex tests new rules under pressure.',
    find: 'Alex gains the answer that changes the problem.',
    take: 'Alex pays a personal price for the answer.',
    return: 'Alex brings the result back to the original pressure field.',
    change: 'Alex acts from a changed self-concept.',
    ...overrides,
  });
  const validScenes = [
    { id: 's1', leadsTo: ['s2'] }, { id: 's2', leadsTo: ['s3'] }, { id: 's3', leadsTo: [] },
  ];
  const blueprint = (circle: Record<string, string | undefined>): any => ({
    episodeCircle: episodeCircle(circle), scenes: validScenes, startingSceneId: 's1', bottleneckScenes: [],
  });

  it('blocks when an episodeCircle beat is left unrealized', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const bp = blueprint({ take: '' });
    expect(() => (architect as any).validateBlueprint(bp, makeInput())).toThrow(/StoryCircleGate.*take/);
  });

  it('passes when every episodeCircle beat is realized', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const bp = blueprint({});
    expect(() => (architect as any).validateBlueprint(bp, makeInput())).not.toThrow(/StoryCircleGate/);
  });

  it('does not block when storyCircleBlocking is off (advisory)', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: false, requireSceneGraphBranching: false });
    const bp = blueprint({ change: '' });
    expect(() => (architect as any).validateBlueprint(bp, makeInput())).not.toThrow(/StoryCircleGate/);
  });

  it('builds fallback episodeCircle text from episode-local arc before season-wide Story Circle text', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const circle = (architect as any).buildEpisodeCircle(makeInput({
      episodeTitle: 'Dating After Dusk',
      episodeSynopsis: 'Kylie arrives in Bucharest and the Mr. Midnight post goes viral.',
      seasonStoryCircle: {
        you: 'Season-wide ordinary world.',
        need: 'Season-wide lack.',
        go: 'Kylie accepts the Equinox weekend at Casa Stelarum.',
        search: 'Kylie experiments at Casa Lupului in a later episode.',
        find: 'The mirror reveal changes the genre in a later episode.',
        take: 'Radu confession cost in a later episode.',
        return: 'Mika betrayal pressure in a later episode.',
        change: 'Hunter Moon final post in the finale.',
      },
    }), {
      you: 'Kylie arrives with two suitcases and her grandmother address.',
      go: 'The staged rescue makes Mr. Midnight public.',
      search: 'The blog comments turn organized and predatory.',
      find: 'Kylie realizes attention is a trap as much as a prize.',
      take: 'Accepting visibility costs privacy.',
      return: 'She writes the post anyway.',
      change: 'The viral post makes her a name.',
    });

    expect(circle.go).toContain('staged rescue');
    expect(circle.search).toContain('blog comments');
    expect(circle.search).not.toContain('Casa Lupului');
    expect(circle.change).toContain('viral post');
    expect(circle.change).not.toContain('Hunter Moon');
  });

  it('does not use future-season MVP treatment beats as Episode 1 local episodeCircle fallbacks', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const circle = (architect as any).buildEpisodeCircle(makeInput({
      episodeNumber: 1,
      episodeTitle: 'Dating After Dusk',
      episodeSynopsis: 'Kylie arrives in Bucharest, survives the Cișmigiu attack, and turns Mr. Midnight into a viral post.',
    }), {
      you: 'Kylie arrives with two suitcases and her grandmother address.',
      go: 'The staged rescue makes Mr. Midnight public.',
      search: 'The slow-burn mountain weekend at Casa Lupului offers an honest alternative.',
      find: "The mirror behind Victor reveals Kylie's lover is a monster.",
      take: "Radu's confession and Carmen hospitalized make the blog war go hot.",
      return: 'On the Hunter Moon, Kylie chooses the Mountain Wife route.',
      change: 'The final post at Casa Stelarum resolves the season.',
    });

    const serialized = JSON.stringify(circle);
    expect(circle.search).toContain('survives the Cișmigiu attack');
    expect(circle.find).toContain('Mr. Midnight');
    expect(serialized).not.toMatch(/Casa Lupului|slow-burn mountain|mirror behind Victor|Radu's confession|Hunter Moon|Casa Stelarum|Mountain Wife/);
  });

  it('re-homes inherited treatment Story Circle contracts to the blueprint scene with matching cues', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const blueprint = {
      episodeId: 'ep1',
      number: 1,
      title: 'Dating After Dusk',
      synopsis: '',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
      scenes: [
        {
          id: 's1-1',
          name: 'Victor walks Kylie home',
          description: 'Victor walks Kylie through Cișmigiu after the attack.',
          narrativeRole: 'setup',
          keyBeats: ['The rescue leaves her shaken.'],
          storyCircleBeatContracts: [
            { id: 'dusk', beat: 'you', sourceText: 'gathers the Dusk Club over too-dark negronis', targetSceneIds: ['s1-1'] },
            { id: 'viral', beat: 'you', sourceText: 'the viral Mr Midnight post changes the aftermath by making her a name', targetSceneIds: ['s1-1'] },
          ],
        },
        {
          id: 's1-blog-aftermath',
          name: 'The post becomes public pressure',
          description: 'The Mr. Midnight blog post goes viral and the readership count climbs.',
          narrativeRole: 'payoff',
          keyBeats: ['The blog post makes Kylie visible.'],
        },
        {
          id: 's1-rooftop-setup',
          name: 'Rooftop bar at sunset',
          description: 'Mika gathers the Dusk Club over too-dark negronis on the Vâlcescu Club rooftop.',
          narrativeRole: 'development',
          keyBeats: ['Dusk Club toast with Mika and Stela.'],
        },
      ],
      startingSceneId: 's1-1',
      bottleneckScenes: [],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).rebindInheritedStoryCircleContracts(blueprint);

    expect(blueprint.scenes[0].storyCircleBeatContracts ?? []).toHaveLength(0);
    expect(blueprint.scenes[1].storyCircleBeatContracts?.map((contract: any) => contract.id)).toContain('viral');
    expect(blueprint.scenes[2].storyCircleBeatContracts?.map((contract: any) => contract.id)).toContain('dusk');
  });

  it('drops inherited Story Circle contracts whose target episode is not this blueprint episode', () => {
    const architect = new StoryArchitect(config, { storyCircleBlocking: true, requireSceneGraphBranching: false });
    const blueprint = {
      episodeId: 'ep1',
      number: 1,
      title: 'Dating After Dusk',
      synopsis: '',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
      scenes: [{
        id: 's1-rooftop-setup',
        name: 'Rooftop bar at sunset',
        description: 'Mika gathers the Dusk Club over too-dark negronis.',
        storyCircleBeatContracts: [{
          id: 'future-search',
          beat: 'search',
          sourceText: 'The slow-burn mountain weekend at Casa Lupului offers an honest alternative.',
          targetEpisodeNumber: 4,
          targetSceneIds: ['s1-rooftop-setup'],
        }],
      }],
      startingSceneId: 's1-rooftop-setup',
      bottleneckScenes: [],
      themes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
    };

    (architect as any).rebindInheritedStoryCircleContracts(blueprint);

    expect(blueprint.scenes[0].storyCircleBeatContracts).toEqual([]);
  });
});

// -----------------------------------------------------------------------
// buildTransitionPressureChange — placeholder cost must not leak (P1a)
// -----------------------------------------------------------------------

describe('StoryArchitect.buildTransitionPressureChange', () => {
  const architect = new StoryArchitect(config);

  it('drops the placeholder cost sentinel instead of leaking it into pressureChange', () => {
    const scene = {
      name: 'The Velvet Booth',
      choicePoint: {
        stakes: {
          want: 'Advance the goal of The Velvet Booth',
          cost: 'Each option forfeits a different advantage.',
          identity: 'The choice reveals the protagonist under pressure.',
        },
      },
      personalStake: 'Kylie risks letting Victor see how much she wants to belong',
    };
    const target = { conflictEngine: 'Whether Victor controls the night' };

    const result = (architect as any).buildTransitionPressureChange(scene, target, 'therefore');

    expect(result).not.toContain('Each option forfeits a different advantage');
    expect(result).toContain('Kylie risks letting Victor see');
    expect(result).toContain('escalates into');
  });

  it('uses a real choice-point cost when one is authored', () => {
    const scene = {
      name: 'Sunday Breakfast',
      choicePoint: {
        stakes: {
          want: 'Know what the photograph means',
          cost: 'Naming what she noticed ends the easy warmth of the morning',
          identity: 'The woman who asks',
        },
      },
    };
    const target = { name: 'The drive home' };

    const result = (architect as any).buildTransitionPressureChange(scene, target, 'but');

    expect(result).toContain('ends the easy warmth of the morning');
    expect(result).toContain('reverses into');
  });
});

// -----------------------------------------------------------------------
// Plan-time blueprint branch-adequacy guard
// -----------------------------------------------------------------------

describe('StoryArchitect blueprint branch-adequacy guard', () => {
  const branchScene = (id: string, leadsTo: string[]) => ({
    id,
    isEncounter: false,
    leadsTo,
    choicePoint: { type: 'strategic', branches: true, stakes: {}, description: 'A fork.', optionHints: [] },
  });
  const linearScene = (id: string, leadsTo: string[]) => ({
    id,
    isEncounter: false,
    leadsTo,
    choicePoint: { type: 'expression', branches: false, stakes: {}, description: 'A beat.', optionHints: [] },
  });

  it('flags an under-sized (2-scene) branching-required blueprint as inadequate', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = { scenes: [linearScene('s1-1', ['enc-1']), { id: 'enc-1', isEncounter: true, leadsTo: [] }] };

    const verdict = (architect as any).assessBlueprintBranchAdequacy(blueprint);

    expect(verdict.adequate).toBe(false);
    expect(verdict.sceneCount).toBe(2);
    expect(verdict.reason).toContain('only 2 scene');
  });

  it('passes a 3-scene blueprint that carries a real branch', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      scenes: [branchScene('s1-1', ['s1-2', 'enc-1']), linearScene('s1-2', ['enc-1']), { id: 'enc-1', isEncounter: true, leadsTo: [] }],
    };

    const verdict = (architect as any).assessBlueprintBranchAdequacy(blueprint);

    expect(verdict.adequate).toBe(true);
    expect(verdict.validBranchCount).toBe(1);
  });

  it('flags a big-enough but branchless blueprint as inadequate', () => {
    const architect = new StoryArchitect(config);
    const blueprint: any = {
      scenes: [linearScene('s1-1', ['s1-2']), linearScene('s1-2', ['s1-3']), linearScene('s1-3', [])],
    };

    const verdict = (architect as any).assessBlueprintBranchAdequacy(blueprint);

    expect(verdict.adequate).toBe(false);
    expect(verdict.validBranchCount).toBe(0);
    expect(verdict.reason).toContain('valid branch scene');
  });

  it('exempts linear-bottleneck episodes (never fires)', () => {
    const architect = new StoryArchitect(config, { allowLinearBottleneckEpisodes: true } as any);
    const blueprint: any = { scenes: [linearScene('s1-1', ['enc-1']), { id: 'enc-1', isEncounter: true, leadsTo: [] }] };

    expect((architect as any).assessBlueprintBranchAdequacy(blueprint).adequate).toBe(true);
  });

  // Elaborate (deterministic, no-LLM) path: the guard fails fast before content gen.
  const plannedStandard = (id: string, order: number, role: string) => ({
    id, episodeNumber: 1, order, kind: 'standard', title: id, dramaticPurpose: `Purpose ${id}`, narrativeRole: role,
  });
  const plannedEncounter = (id: string, order: number) => ({
    id,
    episodeNumber: 1,
    order,
    kind: 'encounter',
    title: id,
    dramaticPurpose: `Victor corners Kylie at the velvet rope and forces the private rescue into public pressure.`,
    narrativeRole: 'turn',
    encounter: {
      type: 'social',
      difficulty: 'moderate',
      relevantSkills: ['perception', 'resolve'],
      isBranchPoint: false,
      description: 'Victor corners Kylie at the velvet rope and tests whether she will treat the rescue as romance or danger.',
      stakes: 'Kylie risks public reputation, private desire, and trust in Mika.',
      centralConflict: 'Victor controls the invitation while Kylie tries to keep her agency.',
    },
  });

  it('elaborate path fails fast with an attributed message on a 2-scene plan', async () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: { plannedScenes: [plannedStandard('s1-1', 0, 'setup'), plannedEncounter('treatment-enc-1-1', 1)] } as any,
    });

    const result = await architect.execute(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('BlueprintAdequacyGate');
    expect(result.error).toContain('Episode 1');
  });

  it('elaborate path succeeds and branches on an adequately-sized (3-scene) plan', async () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        plannedScenes: [
          plannedStandard('s1-1', 0, 'setup'),
          plannedStandard('s1-2', 1, 'development'),
          plannedEncounter('treatment-enc-1-1', 2),
        ],
      } as any,
    });

    const result = await architect.execute(input);

	    expect(result.success).toBe(true);
	    const validBranch = (result.data!.scenes || []).filter(
	      (s: any) => s.choicePoint?.branches && s.choicePoint.type !== 'expression' && new Set(s.leadsTo || []).size >= 2,
	    );
	    expect(validBranch.length).toBeGreaterThanOrEqual(1);
    for (const scene of result.data!.scenes) {
      expect(scene.dramaticStructure?.question).toBeTruthy();
      expect(scene.dramaticStructure?.turn).toBeTruthy();
      expect(scene.dramaticStructure?.changedState).toBeTruthy();
      expect(scene.sequenceIntent?.turningPoint).toBeTruthy();
      expect(scene.residue?.length).toBeGreaterThan(0);
      expect(scene.turnContract?.centralTurn).toBeTruthy();
      expect(scene.turnContract?.centralTurn).not.toMatch(/^(setup|development|release) scene \d+$/i);
      if (scene.leadsTo.length > 0) {
        expect(scene.transitionOut?.[0]?.toSceneId).toBe(scene.leadsTo[0]);
      }
    }
	  });

  it('elaborate path returns advisory warnings through the normal warning channel', async () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        plannedScenes: [
          plannedStandard('s1-1', 0, 'setup'),
          plannedEncounter('treatment-enc-1-1', 1),
          plannedStandard('s1-3', 2, 'release'),
        ],
      } as any,
    });

    const original = (architect as any).collectDramaticStructureIssues.bind(architect);
    (architect as any).collectDramaticStructureIssues = () => ['[DramaticStructure] Scene s1-2 has an advisory-only shape issue.'];
    const result = await architect.execute(input);
    (architect as any).collectDramaticStructureIssues = original;

    expect(result.success).toBe(true);
    expect(result.warnings?.join('\n')).toContain('[DramaticStructure]');
  });

  it('extends the planned-scene cap for bounded prose-only binder split helpers', () => {
    const architect = new StoryArchitect(config);
    const scenes = Array.from({ length: 12 }, (_, index) => ({
      id: `s2-${index + 1}`,
      name: `Scene ${index + 1}`,
      description: `Scene ${index + 1}`,
      location: 'Bucharest',
      mood: 'charged',
      purpose: 'transition',
      dramaticQuestion: `Question ${index + 1}`,
      wantVsNeed: `Want ${index + 1}`,
      conflictEngine: `Conflict ${index + 1}`,
      npcsPresent: [],
      narrativeFunction: `Function ${index + 1}`,
      keyBeats: [`Beat ${index + 1}`],
      leadsTo: index < 11 ? [`s2-${index + 2}`] : [],
      ...(index >= 10 ? {
        planningOrigin: {
          kind: 'binder_split',
          splitKind: index === 10 ? 'friend_debrief' : 'late_night_writing',
          parentSceneId: 's2-5',
          reason: 'Test helper split.',
        },
        plannedHasChoice: false,
      } : {}),
    }));
    const blueprint = {
      episodeId: 'episode-2',
      number: 2,
      title: 'Mr. Midnight',
      synopsis: 'A date becomes public pressure.',
      arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
      episodeCircle: {
        you: 'Kylie wants to keep writing.',
        need: 'She needs to separate being wanted from being known.',
        go: 'The blog pulls her into Victor and Radu pressure.',
        search: 'She tests both numbers and both stories.',
        find: 'The debrief and writing make the pressure legible.',
        take: 'The public version costs privacy.',
        return: 'She returns to the page.',
        change: 'The blog is now leverage.',
      },
      scenes,
      startingSceneId: 's2-1',
      bottleneckScenes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      themes: [],
      narrativePromises: [],
    };
    const input = makeInput({ episodeNumber: 2, targetSceneCount: 10 });

    expect((architect as any).effectiveTargetSceneCount(blueprint, input)).toBe(12);
    expect((architect as any).collectStructuralIssues(blueprint, input)).not.toContain('Blueprint has 12 scenes; maximum is 10');
  });

  it('extends the planned-scene cap for choice-bearing chronological binder splits', () => {
    const architect = new StoryArchitect(config);
    const blueprint = {
      episodeId: 'episode-1',
      title: 'Dating After Dusk',
      startingSceneId: 's1-1',
      bottleneckScenes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      themes: [],
      narrativePromises: [],
      scenes: Array.from({ length: 8 }, (_, index) => ({
        id: index === 2 ? 's1-rooftop-setup' : `s1-${index + 1}`,
        name: index === 2 ? 'Rooftop bar at sunset' : `Scene ${index + 1}`,
        description: `Scene ${index + 1}`,
        location: 'Bucharest',
        mood: 'charged',
        purpose: 'transition',
        dramaticQuestion: `Question ${index + 1}`,
        wantVsNeed: `Want ${index + 1}`,
        conflictEngine: `Conflict ${index + 1}`,
        npcsPresent: [],
        narrativeFunction: `Function ${index + 1}`,
        keyBeats: [`Beat ${index + 1}`],
        leadsTo: index < 7 ? [index === 1 ? 's1-rooftop-setup' : `s1-${index + 2}`] : [],
        ...(index === 2 ? {
          planningOrigin: {
            kind: 'binder_split',
            splitKind: 'mixed_rooftop_setup',
            parentSceneId: 'treatment-enc-1-1',
            reason: 'Split mixed rooftop setup away from the later park encounter.',
          },
          plannedHasChoice: true,
        } : {}),
      })),
    };
    const input = makeInput({ episodeNumber: 1, targetSceneCount: 7 });

    expect((architect as any).effectiveTargetSceneCount(blueprint, input)).toBe(8);
    expect((architect as any).collectStructuralIssues(blueprint, input)).not.toContain('Blueprint has 8 scenes; maximum is 7');
  });

  it('does not extend the planned-scene cap for untagged over-cap scenes', () => {
    const architect = new StoryArchitect(config);
    const blueprint = {
      episodeId: 'episode-2',
      title: 'Mr. Midnight',
      startingSceneId: 's2-1',
      bottleneckScenes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      themes: [],
      narrativePromises: [],
      scenes: Array.from({ length: 11 }, (_, index) => ({
        id: `s2-${index + 1}`,
        name: `Scene ${index + 1}`,
        description: `Scene ${index + 1}`,
        location: 'Bucharest',
        mood: 'charged',
        purpose: 'transition',
        dramaticQuestion: `Question ${index + 1}`,
        wantVsNeed: `Want ${index + 1}`,
        conflictEngine: `Conflict ${index + 1}`,
        npcsPresent: [],
        narrativeFunction: `Function ${index + 1}`,
        keyBeats: [`Beat ${index + 1}`],
        leadsTo: index < 10 ? [`s2-${index + 2}`] : [],
      })),
    };
    const input = makeInput({ episodeNumber: 2, targetSceneCount: 10 });

    expect((architect as any).effectiveTargetSceneCount(blueprint, input)).toBe(10);
    expect((architect as any).collectStructuralIssues(blueprint, input)).toContain('Blueprint has 11 scenes; maximum is 10');
  });

  it('upgrades generic release scenes into concrete changed-state contracts', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      episodeSynopsis: 'The viral post turns private rescue into public romantic pressure.',
      seasonPlanDirectives: {
        plannedScenes: [
          plannedStandard('s1-1', 0, 'setup'),
          {
            ...plannedStandard('s1-6', 1, 'release'),
            title: 'release scene 6',
            dramaticPurpose: 'Let the fallout settle into the next pressure: search pressure.',
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    const release = blueprint.scenes.find((scene: any) => scene.id === 's1-6');

    expect(release.name).not.toBe('release scene 6');
    expect(release.turnContract.centralTurn).not.toContain('Let the fallout settle');
    expect(release.dramaticStructure.changedState).toContain('visible leverage');
    expect(release.sequenceIntent.turningPoint).toBe(release.turnContract.centralTurn);
    expect(release.residue.length).toBeGreaterThan(0);
  });

  it('does not use planned-scene placeholder names in default choice pressure', () => {
    const architect = new StoryArchitect(config);
    const concreteTurn = "At the club door, Mika clocks Kylie's fake confidence and makes her earn the second round.";
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        plannedScenes: [
          {
            ...plannedStandard('s1-5', 0, 'development'),
            title: 'Development scene 5',
            dramaticPurpose: 'Development scene 5.',
            turnContract: {
              centralTurn: concreteTurn,
              turnEvent: concreteTurn,
              pressurePeak: concreteTurn,
            },
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    const choicePoint = blueprint.scenes[0].choicePoint;
    const choiceText = JSON.stringify(choicePoint);

    expect(choiceText).toContain(concreteTurn);
    expect(choiceText).not.toMatch(/Decide how to handle|Development scene 5/i);
  });

  it('keeps autogenerated Bite Me cold-open choice pressure blueprint-hygiene safe', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      storyTitle: 'Bite Me',
      episodeNumber: 1,
      episodeTitle: 'Dating After Dusk',
      episodeSynopsis: 'Kylie arrives in Bucharest and starts Dating After Dusk.',
      seasonPlanDirectives: {
        plannedScenes: [
          {
            ...plannedStandard('s1-arrival-cold-open', 0, 'setup'),
            title: 'Opening arrival',
            dramaticPurpose: 'Kylie arrives in Bucharest, a wounded observer hiding behind her writing, seeking a fresh start after public humiliation.',
            hasChoice: true,
            requiredBeats: [
              {
                id: 's1-arrival-cold-open-story-circle-you-part-2',
                sourceTurn: "two suitcases, her grandmother's address",
                mustDepict: "two suitcases, her grandmother's address",
                tier: 'coldopen',
              },
            ],
            turnContract: {
              turnId: 's1-arrival-cold-open-turn',
              source: 'treatment',
              centralTurn: 'Kylie arrives in Bucharest, a wounded observer hiding behind her writing, seeking a fresh start after public humiliation.',
              beforeState: 'Kylie is outside the city promise.',
              turnEvent: 'Kylie arrives in Bucharest, a wounded observer hiding behind her writing, seeking a fresh start after public humiliation.',
              afterState: 'Kylie is inside the city promise.',
              handoff: 'Hand forward to the first social pressure.',
            },
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    const choicePoint = blueprint.scenes[0].choicePoint;

    expect(choicePoint.description).toBe("The decision turns on two suitcases, her grandmother's address.");
    expect(JSON.stringify(choicePoint)).not.toMatch(/protagonist responds|wounded observer/i);
    expect(new BlueprintContractHygieneValidator().validate(blueprint).blockingIssues).toEqual([]);
  });

  it('repairs synthetic release scene labels before blueprint hygiene validation', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      storyTitle: 'Bite Me',
      episodeNumber: 1,
      episodeTitle: 'Dating After Dusk',
      episodeSynopsis: 'The viral post turns private rescue into public romantic pressure.',
      seasonPlanDirectives: {
        plannedScenes: [
          {
            ...plannedStandard('s1-7', 7, 'release'),
            title: 'release scene 7',
            dramaticPurpose: 'release scene 7',
            hasChoice: false,
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    const serialized = JSON.stringify(blueprint.scenes[0]);

    expect(serialized).not.toMatch(/release scene 7/i);
    expect(new BlueprintContractHygieneValidator().validate(blueprint).blockingIssues).toEqual([]);
  });

  it('does not promote treatment choice menus into scene-turn prose', () => {
    const architect = new StoryArchitect(config);
    const menuText = 'In the park when the shadow appears: scream, run, freeze, or fight — and next morning, what name do you give him: Mr. Midnight (canonical), The Stranger, The Velvet, or The Suit.';
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        plannedScenes: [
          {
            ...plannedStandard('s1-5', 0, 'development'),
            title: 'Cișmigiu Gardens at 1am',
            dramaticPurpose: menuText,
            signatureMoment: menuText,
            requiredBeats: [{ id: 'park-menu', tier: 'authored', sourceTurn: menuText, mustDepict: menuText }],
            turnContract: {
              centralTurn: menuText,
              turnEvent: menuText,
              pressurePeak: menuText,
            },
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    const serialized = JSON.stringify(blueprint.scenes[0]);

    expect(serialized).not.toMatch(/what name do you give him|canonical|scream, run, freeze/i);
    expect(blueprint.scenes[0].choicePoint.description).toContain('Cișmigiu Gardens at 1am');
  });

  it('repairs stale planned-scene locations from explicit required beat settings', () => {
    const architect = new StoryArchitect(config);
    const stale = "Kylie's Lipscani Apartment";
    const scene = (id: string, order: number, mustDepict: string) => ({
      ...plannedStandard(id, order, 'development'),
      locations: [stale],
      requiredBeats: [{ id: `${id}-rb1`, tier: 'authored', sourceTurn: mustDepict, mustDepict }],
    });
    const input = makeInput({
      episodeNumber: 1,
      currentLocation: stale,
      seasonPlanDirectives: {
        plannedScenes: [
          scene('s1-1', 0, 'Mika adopts Kylie at the door of Vâlcescu Club on night two.'),
          scene('s1-2', 1, 'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand.'),
          scene('s1-3', 2, 'Walking home through Cișmigiu Gardens at 1am, a shadow strikes.'),
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].location).toBe('Vâlcescu Club');
    expect(blueprint.scenes[1].location).toBe('Lumina Books');
    expect(blueprint.scenes[2].location).toBe('Cișmigiu Gardens');
  });

  it('does not carry stale late-arc crisis pressure into the wrong planned episode', () => {
    const architect = new StoryArchitect(config);
    const crisisText = 'At the Equinox weekend Victor makes clear that the blog and his privacy cannot both win.';
    const staleContract = {
      id: 'arc-pressure-arc-1-arc_late_crisis-equinox',
      source: 'treatment',
      arcId: 'arc-1',
      arcTitle: 'Champagne',
      fieldName: 'Late-arc crisis / all-is-lost beat',
      sourceText: crisisText,
      contractKind: 'arc_late_crisis',
      requiredRealization: ['season_arc', 'scene_turn', 'mechanic_pressure', 'final_prose'],
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      eventAtoms: ['Equinox weekend'],
      blockingLevel: 'treatment',
    };
    const input = makeInput({
      episodeNumber: 2,
      seasonPlanDirectives: {
        arcPressure: {
          arcId: 'arc-1',
          arcName: 'Champagne',
          lateArcCrisis: {
            episodeNumber: 2,
            apparentFailure: crisisText,
            irreversibleCost: crisisText,
            description: crisisText,
          },
        },
        treatmentGuidance: {
          nextEpisodePressure: 'Episode 3 must open at the Equinox weekend with the country-house invitation, the missing-model question, and Victor privacy pressure.',
        },
        plannedScenes: [{
          ...plannedStandard('s2-1', 0, 'setup'),
          arcPressureContracts: [staleContract],
          requiredBeats: [{
            id: 's2-1-arc-pressure-arc-late-crisis',
            tier: 'authored',
            sourceTurn: crisisText,
            mustDepict: crisisText,
          }],
          mechanicPressure: [{
            id: `${staleContract.id}-pressure`,
            source: 'treatment',
            domain: 'resource',
            mechanicRef: { flag: staleContract.id },
            function: 'complicate',
            storyPressure: crisisText,
            evidenceRequired: ['Equinox weekend'],
            visibleResidue: [],
            allowedPayoffs: [],
            blockedPayoffs: [],
            originatingSceneId: 's2-1',
          }],
        }],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].arcPressureContracts ?? []).toHaveLength(0);
    expect(blueprint.scenes[0].requiredBeats.some((beat: any) => beat.mustDepict === crisisText)).toBe(false);
    expect((blueprint.scenes[0].mechanicPressure ?? []).some((pressure: any) => pressure.storyPressure === crisisText)).toBe(false);
  });

  it('does not carry wrong-episode or broad arc pressure into planned-scene blueprints', () => {
    const architect = new StoryArchitect(config);
    const midpointText = 'The glamorous new life is underneath a funnel, and the rescue was staged.';
    const questionText = 'Can Kylie start over in a city that does not know her ex name?';
    const wrongEpisodeMidpoint = {
      id: 'arc-pressure-arc-1-arc_midpoint_recontextualization-funnel',
      source: 'treatment',
      arcId: 'arc-1',
      arcTitle: 'Champagne',
      fieldName: 'Midpoint recontextualization',
      sourceText: midpointText,
      contractKind: 'arc_midpoint_recontextualization',
      requiredRealization: ['season_arc', 'scene_turn', 'mechanic_pressure', 'final_prose'],
      targetEpisodeNumbers: [3],
      targetSceneIds: ['s3-1'],
      eventAtoms: ['glamorous new life is underneath a funnel'],
      blockingLevel: 'treatment',
    };
    const broadQuestion = {
      id: 'arc-pressure-arc-1-arc_question-start-over',
      source: 'treatment',
      arcId: 'arc-1',
      arcTitle: 'Champagne',
      fieldName: 'Arc dramatic question',
      sourceText: questionText,
      contractKind: 'arc_question',
      requiredRealization: ['season_arc', 'scene_turn', 'final_prose'],
      targetEpisodeNumbers: [1, 2, 3],
      targetSceneIds: ['s2-1'],
      eventAtoms: ['Kylie start over'],
      blockingLevel: 'treatment',
    };
    const input = makeInput({
      episodeNumber: 2,
      seasonPlanDirectives: {
        plannedScenes: [{
          ...plannedStandard('s2-1', 0, 'turn'),
          arcPressureContracts: [wrongEpisodeMidpoint, broadQuestion],
          requiredBeats: [
            {
              id: 's2-1-arc-pressure-arc-find',
              tier: 'authored',
              sourceTurn: midpointText,
              mustDepict: midpointText,
            },
            {
              id: 's2-1-arc-pressure-arc-question',
              tier: 'authored',
              sourceTurn: questionText,
              mustDepict: questionText,
            },
          ],
          mechanicPressure: [{
            id: `${wrongEpisodeMidpoint.id}-pressure`,
            source: 'treatment',
            domain: 'information',
            mechanicRef: { flag: wrongEpisodeMidpoint.id },
            function: 'intensify',
            storyPressure: midpointText,
            evidenceRequired: ['funnel'],
            visibleResidue: [],
            allowedPayoffs: [],
            blockedPayoffs: [],
            originatingSceneId: 's2-1',
          }],
        }],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].arcPressureContracts ?? []).toHaveLength(0);
    expect(blueprint.scenes[0].requiredBeats.some((beat: any) => beat.mustDepict === midpointText)).toBe(false);
    expect(blueprint.scenes[0].requiredBeats.some((beat: any) => beat.mustDepict === questionText)).toBe(false);
    expect((blueprint.scenes[0].mechanicPressure ?? []).some((pressure: any) => pressure.storyPressure === midpointText)).toBe(false);
  });

  it('does not treat a character surname as the matching venue location', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      currentLocation: "Kylie's Lipscani Apartment",
      seasonPlanDirectives: {
        plannedScenes: [{
          ...plannedStandard('s1-threshold', 0, 'release'),
          locations: ["Kylie's Apartment Threshold"],
          requiredBeats: [{
            id: 'threshold-refusal',
            tier: 'authored',
            sourceTurn: "Victor Vâlcescu kisses Kylie's hand, declines to come in, and vanishes at the threshold.",
            mustDepict: "Victor Vâlcescu kisses Kylie's hand, declines to come in, and vanishes at the threshold.",
          }],
        }],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].location).toBe("Kylie's Apartment Threshold");
  });

  it('adds known NPC ids when planned scene required beats name a character', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      availableNPCs: [
        { id: 'char-victor-vlcescu', name: 'Victor Vâlcescu', description: 'A courtly stranger.' },
      ],
      seasonPlanDirectives: {
        plannedScenes: [{
          ...plannedStandard('s1-threshold', 0, 'release'),
          locations: ["Kylie's Apartment Threshold"],
          npcsInvolved: ['Mika Drăgan'],
          requiredBeats: [{
            id: 'threshold-refusal',
            tier: 'authored',
            sourceTurn: "Victor kisses Kylie's hand at the threshold, declines to come in, and vanishes.",
            mustDepict: "Victor kisses Kylie's hand at the threshold, declines to come in, and vanishes.",
          }],
        }],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].npcsPresent).toContain('char-victor-vlcescu');
    expect(blueprint.scenes[0].npcsPresent).toContain('Mika Drăgan');
  });

  it('does not add placeholder choicePoints to planned scenes that explicitly opt out', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({
      episodeNumber: 1,
      seasonPlanDirectives: {
        plannedScenes: [
          plannedStandard('s1-1', 0, 'setup'),
          {
            ...plannedStandard('s1-1-threshold', 1, 'release'),
            hasChoice: false,
            requiredBeats: [
              {
                id: 'threshold-kiss',
                tier: 'authored',
                sourceTurn: "Victor kisses Kylie's hand at the threshold.",
                mustDepict: "Victor kisses Kylie's hand at the threshold.",
              },
            ],
          },
          plannedStandard('s1-2', 2, 'development'),
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes.find((scene: any) => scene.id === 's1-1')?.choicePoint).toBeDefined();
    expect(blueprint.scenes.find((scene: any) => scene.id === 's1-1-threshold')?.choicePoint).toBeUndefined();
  });

  it('honors recommended beat budget for valid dense planned scenes', () => {
    const architect = new StoryArchitect(config);
    const input = makeInput({ episodeNumber: 2 });
    const denseScene: any = {
      id: 's2-4',
      name: 'Road scene',
      description: 'The road scene carries several concrete treatment obligations.',
      location: 'Mountain road',
      requiredBeats: [
        { id: 'rb1', tier: 'authored', mustDepict: 'The cab breaks down on the road.' },
        { id: 'rb2', tier: 'authored', mustDepict: 'The chef fixes the engine.' },
        { id: 'rb3', tier: 'authored', mustDepict: 'The sweater becomes visible.' },
      ],
      authoredTreatmentFields: Array.from({ length: 9 }, (_, index) => ({
        id: `field-${index + 1}`,
        fieldName: 'pressure_lane',
        sourceText: `Soft treatment detail ${index + 1} attached to the road scene.`,
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
      })),
      choicePoint: {
        type: 'strategic',
        description: 'Choose how to handle the road pressure.',
        stakes: {},
        optionHints: [],
      },
      recommendedBeatCount: 10,
    };
    const blueprint: any = {
      scenes: [
        {
          id: 's2-1',
          name: 'Opening scene',
          requiredBeats: [{ id: 'opening-rb', tier: 'authored', mustDepict: 'The episode opens with a local dashboard beat.' }],
        },
        denseScene,
      ],
    };

    expect((architect as any).collectTreatmentDensityIssues(blueprint, input)).toEqual([]);

    denseScene.recommendedBeatCount = undefined;
    expect((architect as any).collectTreatmentDensityIssues(blueprint, input).join('\n')).toContain('Treatment density overload');
  });

  it('repairs stale planned encounter locations from encounter descriptions', () => {
    const architect = new StoryArchitect(config);
    const stale = "Kylie's Lipscani Apartment";
    const input = makeInput({
      episodeNumber: 1,
      currentLocation: stale,
      seasonPlanDirectives: {
        plannedScenes: [
          {
            ...plannedEncounter('enc-1-1', 0),
            locations: [stale],
            dramaticPurpose: 'The two-hour verbal sparring match and seduction with Victor at his VIP table.',
            encounter: {
              type: 'social',
              difficulty: 'moderate',
              relevantSkills: [],
              isBranchPoint: false,
              description: 'The two-hour verbal sparring match and seduction with Victor at his VIP table inside Vâlcescu Club.',
            },
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);

    expect(blueprint.scenes[0].location).toBe('Vâlcescu Club');
  });

  it('localizes broad treatment summaries before planned scenes reach SceneWriter', () => {
    const architect = new StoryArchitect(config);
    const broadEpisodeSummary = 'Kylie lands in Bucharest, forms the Dusk Club, is attacked in the park, rescued by Victor, and writes the viral Mr. Midnight post.';
    const makeScene = (id: string, order: number, localBeat: string, contractText: string, extras: Record<string, unknown> = {}) => ({
      ...plannedStandard(id, order, 'setup'),
      title: id,
      dramaticPurpose: broadEpisodeSummary,
      locations: ['Cișmigiu Gardens'],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
      requiredBeats: [{ id: `${id}-rb1`, tier: 'authored', sourceTurn: localBeat, mustDepict: localBeat }],
      turnContract: {
        turnId: `${id}-turn`,
        source: 'treatment',
        centralTurn: localBeat,
        beforeState: 'Before',
        turnEvent: localBeat,
        afterState: 'After',
        handoff: 'Next',
      },
      authoredTreatmentFields: [{
        id: `${id}-choice`,
        episodeNumber: 1,
        fieldName: 'choice',
        sourceText: contractText,
        contractKind: 'major_choice_pressure',
        requiredRealization: ['choice'],
        targetSceneIds: [id],
        blockingLevel: 'treatment',
      }],
      ...extras,
    });
    const input = makeInput({
      episodeNumber: 1,
      currentLocation: "Kylie's Lipscani Apartment",
      introducesCharacters: [
        { id: 'victor', name: 'Victor Vâlcescu' },
      ],
      seasonPlanDirectives: {
        treatmentGuidance: {
          majorChoicePressures: [
            'Follow Victor into the park or run back to the apartment.',
            'Ask Mika for the key card or bluff past the Vâlcescu door.',
          ],
        },
        plannedScenes: [
          makeScene('s1-1', 0, 'Mika adopts Kylie at the side entrance of Vâlcescu Club and the key card becomes a small act of trust.', 'Ask Mika for the key card or bluff past the Vâlcescu door.'),
          makeScene('s1-2', 1, 'At Lumina Books, Stela presses rose quartz into Kylie\'s palm and warns that Victor wants to be with her.', 'Accept Stela\'s quartz or leave it on the counter.'),
          makeScene('s1-3', 2, 'In Cișmigiu Gardens at 1am, the shadow pins Kylie before Victor intervenes.', 'Freeze under the willow or fight back.', {
            npcsInvolved: ['Victor Vâlcescu'],
          }),
          {
            ...plannedStandard('s1-blog', 2.5, 'development'),
            title: 'blog scene',
            dramaticPurpose: 'She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.',
            locations: ['loc-vâlcescu-club'],
            npcsInvolved: [],
            requiredBeats: [{
              id: 'blog-rb',
              tier: 'authored',
              sourceTurn: 'At 4am, unable to sleep, Kylie launches Dating After Dusk with a post about Mr. Midnight.',
              mustDepict: 'At 4am, unable to sleep, Kylie launches Dating After Dusk with a post about Mr. Midnight.',
            }],
          },
          {
            ...plannedStandard('s1-4', 3, 'release'),
            title: 'release scene',
            dramaticPurpose: 'release scene',
            locations: ['Cișmigiu Gardens'],
            npcsInvolved: [],
            authoredTreatmentFields: [{
              id: 'ending-you',
              episodeNumber: 1,
              fieldName: 'cliffhanger',
              sourceText: 'Kylie scrolling the Mr. Midnight DM pile at 9am — black roses on the counter, the blog ticking past 84,000 — when her phone buzzes: Stela. Are you home, love? I had a horrible dream. I am coming over with herbs.',
              contractKind: 'cliffhanger_hook',
              requiredRealization: ['episode_ending'],
              targetSceneIds: ['s1-4'],
              blockingLevel: 'treatment',
            }],
          },
        ],
      } as any,
    });

    const blueprint = (architect as any).buildBlueprintFromPlannedScenes(input);
    (architect as any).ensureCharacterIntroductionBeats(blueprint, input);
    (architect as any).repairTreatmentMajorChoicePressure(blueprint, input);
    (architect as any).seedChoiceMenusFromTreatment(blueprint, input);

    expect(blueprint.scenes[0].description).toContain('Vâlcescu Club');
    expect(blueprint.scenes[0].description).not.toContain('attacked in the park');
    expect(blueprint.scenes[0].narrativeFunction).not.toContain('viral');
    expect(blueprint.scenes[0].location).toBe('Vâlcescu Club');
    expect(blueprint.scenes[0].choicePoint.optionHints.join(' ')).toContain('key card');
    expect(blueprint.scenes[0].choicePoint.optionHints.join(' ')).not.toContain('park');
    expect(blueprint.scenes[0].keyBeats.join(' ')).not.toContain('Introduce Victor Vâlcescu');
    expect(blueprint.scenes[2].keyBeats.join(' ')).toContain('Introduce Victor Vâlcescu');
    expect(blueprint.scenes.find((scene: any) => scene.id === 's1-blog')?.location).toBe("Kylie's Lipscani Apartment");
    const release = blueprint.scenes.find((scene: any) => scene.id === 's1-4');
    expect(release?.description).toContain('DM pile');
    expect(release?.location).toBe("Kylie's Lipscani Apartment");
  });
});
