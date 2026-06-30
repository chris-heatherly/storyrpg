import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { FailureModeAuditContract } from '../../types/scenePlan';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis, TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import { buildSeasonScenePlan } from '../pipeline/seasonScenePlanBuilder';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';
import { buildStakesArchitectureContracts } from '../utils/stakesArchitectureContracts';
import { buildArcPressureContracts } from '../utils/arcPressureContracts';
import { buildBranchConsequenceContracts } from '../utils/branchConsequenceContracts';
import { buildEndingRealizationContracts } from '../utils/endingRealizationContracts';
import { buildTreatmentFieldContractsForGuidance } from '../utils/treatmentFieldContracts';
import { buildWorldTreatmentContracts } from '../utils/worldTreatmentContracts';
import { TreatmentFieldUtilizationValidator } from './TreatmentFieldUtilizationValidator';

const guidance: TreatmentEpisodeGuidance = {
  aPressure: 'Mara needs proof before the steward closes the archive.',
  bPressure: 'Edric tests whether Mara values truth more than safety.',
  cSeed: 'The iron key remains warm in her pocket.',
  encounterAnchors: ['Ritual chase through the archive ladder stacks.'],
  encounterCentralConflict: 'Mara wants truth while Edric protects the locked wing.',
  stakesLayers: ['Identity'],
  themePressure: 'Truth costs comfort.',
  liePressure: 'Mara believes facts keep her safe.',
  encounterBuildup: 'Whispers and locked doors narrow her options.',
  majorChoicePressures: ['Open the door or burn the ledger.'],
  alternativePaths: ['Opening the door creates public suspicion; burning the ledger preserves secrecy.'],
  informationMovement: 'Mara learns the ledger names her family.',
  consequenceSeeds: ['The iron key remains warm in her pocket.'],
  endingTurnout: 'Mara leaves with the key and a new enemy.',
  resolvedEpisodeTension: 'Mara knows the wing is real.',
  cliffhangerHook: 'The portrait opens by itself.',
  cliffhangerQuestion: 'Who unlocked it from inside?',
  nextEpisodePressure: 'The household starts hunting the missing key.',
  cliffhangerSetup: 'The portrait hinge clicked earlier.',
  cliffhangerType: 'revelation',
  emotionalCharge: 'dread',
  endStateChange: 'Mara can enter the locked wing now.',
};

function analysis(treatmentGuidance: TreatmentEpisodeGuidance = guidance): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    title: 'The Locked Wing',
    genre: 'gothic mystery',
    tone: 'tense',
    synopsis: 'Mara finds a wing that should not exist.',
    majorCharacters: [],
    keyLocations: [],
    themes: [],
    episodeBreakdown: [{
      episodeNumber: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      treatmentGuidance,
    }],
    totalEstimatedEpisodes: 2,
  } as unknown as SourceMaterialAnalysis;
}

function plannedSeasonPlan(treatmentGuidance: TreatmentEpisodeGuidance = guidance): SeasonPlan {
  const plan = {
    id: 'season-1',
    sourceTitle: 'The Locked Wing',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    analysisVersion: 'test',
    seasonTitle: 'The Locked Wing',
    seasonSynopsis: 'A manor resists being catalogued.',
    totalEpisodes: 2,
    estimatedTotalDuration: '2 episodes',
    genre: 'gothic mystery',
    tone: 'tense',
    themes: ['truth costs comfort'],
    anchors: {},
    storyCircle: { you: 'Mara finds the locked wing.' },
    arcs: [],
    endingMode: 'single',
    resolvedEndings: [],
    progress: { selectedCount: 0, completedCount: 0, inProgressCount: 0, percentComplete: 0 },
    protagonist: { id: 'mara', name: 'Mara', description: 'An archivist.' },
    characterIntroductions: [],
    locationIntroductions: [],
    encounterPlan: { totalEncounters: 1, difficultyCurve: [], typeDistribution: {} },
    crossEpisodeBranches: [],
    consequenceChains: [{
      id: 'key-seed',
      origin: { episodeNumber: 1, description: 'The iron key remains warm in her pocket.' },
      consequences: [{ episodeNumber: 2, description: 'The household starts hunting the missing key.' }],
    }],
    choiceMoments: [{
      id: 'door-or-ledger',
      episode: 1,
      anchor: 'Open the door or burn the ledger.',
      paysOffEpisode: 2,
    }],
    informationLedger: [{
      id: 'ledger-family',
      label: 'Mara learns the ledger names her family.',
      introducedEpisode: 1,
      plannedRevealEpisode: 1,
      plannedPayoffEpisode: 2,
    }],
    episodes: [{
      episodeNumber: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      status: 'planned',
      dependsOn: [],
      setupsForEpisodes: [2],
      resolvesPlotsFrom: [],
      introducesCharacters: [],
      locations: ['Archive'],
      mainCharacters: ['Mara', 'Edric'],
      estimatedSceneCount: 4,
      treatmentGuidance,
      plannedEncounters: [{
        id: 'treatment-enc-1-1',
        type: 'investigation',
        description: 'Ritual chase through the archive ladder stacks.',
        difficulty: 'moderate',
        relevantSkills: ['notice', 'move'],
        centralConflict: 'Mara wants truth while Edric protects the locked wing.',
        stakes: 'Identity and safety are both at risk.',
        isBranchPoint: true,
        branchOutcomes: { victory: 'Mara keeps the key.', defeat: 'Edric marks her as a threat.' },
      }],
      cliffhangerPlan: {
        type: 'reveal',
        intensity: 'high',
        you: 'The portrait opens by itself.',
        setup: 'The portrait hinge clicked earlier.',
        resolvedEpisodeTension: 'Mara knows the wing is real.',
        newOpenQuestion: 'Who unlocked it from inside?',
        emotionalCharge: 'dread',
        nextEpisodePressure: 'The household starts hunting the missing key.',
        style: 'serialized_tv',
      },
    }],
  } as unknown as SeasonPlan;
  plan.scenePlan = buildSeasonScenePlan(plan);
  return plan;
}

function finalStory(text: string): Story {
  return {
    id: 'story-1',
    title: 'The Locked Wing',
    genre: 'gothic mystery',
    synopsis: 'A manor resists being catalogued.',
    metadata: {} as never,
    initialState: {} as never,
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      coverImage: {} as never,
      startingSceneId: 's1-1',
      scenes: [{
        id: 's1-1',
        name: 'Archive Door',
        startingBeatId: 'b1',
        leadsTo: [],
        beats: [{ id: 'b1', text } as never],
      }],
    }],
  } as unknown as Story;
}

function finalStoryForScene(sceneId: string, text: string): Story {
  const story = finalStory(text);
  story.episodes[0].startingSceneId = sceneId;
  story.episodes[0].scenes[0].id = sceneId;
  return story;
}

function storyCirclePlan(): SeasonPlan {
  const plan = plannedSeasonPlan();
  Object.assign(plan, {
    storyCircle: {
      you: '',
      need: '',
      go: 'Mara crosses the locked threshold.',
      search: 'The steward narrows the exits.',
      find: 'The ledger names her family and changes the rules.',
      take: 'Edric betrays her to protect the wing.',
      return: 'Mara chooses between burning the ledger and claiming the name.',
      change: 'Mara leaves with the key and a new enemy.',
    },
    treatmentSeasonGuidance: {
      seasonSpine: '- **You:** Mara opens the portrait and the archive starts hunting her.',
      storyCircleBeatEpisodeAnchors: { you: 1 },
    },
  });
  plan.storyCircleBeatContracts = undefined;
  plan.scenePlan = buildSeasonScenePlan(plan);
  return plan;
}

function arcPressurePlan(): SeasonPlan {
  const plan = plannedSeasonPlan();
  Object.assign(plan, {
    arcs: [{
      id: 'arc-1',
      name: 'Champagne',
      description: 'Kylie tests whether she can start over.',
      episodeRange: { start: 1, end: 3 },
      keyMoments: [],
      arcQuestion: 'Can Kylie start over in a city that does not know her ex name?',
      seasonQuestionRelation: 'Pressures the Lie by giving Kylie adoration with the bill hidden.',
      identityPressureFacet: 'Kylie observes other people lives rather than claiming her own appetite.',
      midpointRecontextualization: {
        episodeNumber: 2,
        questionBefore: 'Is the new life just glamorous?',
        questionAfter: 'Is the new life a funnel?',
        description: 'The glamorous new life is underneath a funnel.',
      },
      lateArcCrisis: {
        episodeNumber: 3,
        apparentFailure: 'Victor and the blog collide.',
        irreversibleCost: 'The first crack between voice and approval opens.',
        description: 'Victor gently lets Kylie know the blog and his privacy are on a collision course.',
      },
      finaleAnswer: 'Kylie returns feeling lucky and lets herself be courted.',
      handoffPressure: 'The quartz consent and missing model carry forward.',
      episodeTurnouts: [
        {
          episodeNumber: 1,
          turnType: 'revelation',
          description: 'E1 ends on revelation and a charged bond.',
          leavesProtagonistWith: 'A viral post and a charged bond.',
          whyThisCannotMoveLater: 'It launches the arc pressure.',
        },
        {
          episodeNumber: 2,
          turnType: 'escalation',
          description: 'E2 ends on escalation and a second suitor.',
          leavesProtagonistWith: 'Two numbers in her phone.',
          whyThisCannotMoveLater: 'It sets the late-arc collision.',
        },
        {
          episodeNumber: 3,
          turnType: 'cost',
          description: 'E3 ends on a quiet wrong-note.',
          leavesProtagonistWith: 'Voice and approval in collision.',
          whyThisCannotMoveLater: 'It hands off the next arc.',
        },
      ],
      status: 'not_started',
      completionPercentage: 0,
    }],
    treatmentSeasonGuidance: {
      arcGuidance: {
        rawSection: 'Arc plan',
        arcs: [{
          arcIndex: 1,
          title: 'Champagne',
          sourceText: 'Arc 1: Champagne',
          episodeRange: { start: 1, end: 3 },
          arcDramaticQuestion: 'Can Kylie start over in a city that does not know her ex name?',
          midpointRecontextualization: 'The glamorous new life is underneath a funnel.',
          lateArcCrisis: 'Victor gently lets Kylie know the blog and his privacy are on a collision course.',
          finaleAnswer: 'Kylie returns feeling lucky and lets herself be courted.',
          handoffPressure: 'The quartz consent and missing model carry forward.',
          episodeTurnouts: [{ episodeNumber: 1, sourceText: 'E1 ends on revelation and a charged bond.', description: 'revelation and a charged bond' }],
        }],
      },
    },
  });
  plan.arcPressureContracts = buildArcPressureContracts({
    guidance: (plan as any).treatmentSeasonGuidance,
    arcs: plan.arcs,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: true,
  });
  plan.scenePlan = buildSeasonScenePlan(plan);
  return plan;
}

function worldContracts() {
  return buildWorldTreatmentContracts({
    guidance: {
      rawSection: 'World and location brief',
      worldPremise: 'A modern city with a hidden supernatural society underneath.',
      timePeriod: 'Present day with phones and blogs.',
      supernaturalRules: ['Strigoi require invitation to enter dwellings unless the dwelling is broken.'],
      dramaticRules: ['A practitioner cannot ward a friend without symbolic consent.'],
      powerStructures: ['The Vâlcescu Coven fronts as a hospitality empire.'],
      costsAndTaboos: ['Sacred — the quartz consent and the salt circle. Dangerous — the velvet rope at the club.'],
      keyLocations: [{
        name: 'Archive',
        sourceText: 'Archive — A locked manor archive. Purpose: the proof funnel. Mood: airless. History: the family ledger is hidden here. Choice pressure: open the door or burn the ledger.',
        purpose: 'the proof funnel',
        mood: 'airless',
        history: 'the family ledger is hidden here',
        choicePressure: 'open the door or burn the ledger',
      }],
    },
    keyLocations: [{ id: 'archive', name: 'Archive', importance: 'major', firstAppearance: 1 }],
    totalEpisodes: 2,
    treatmentSourced: true,
  });
}

function stakesTreatmentMarkdown() {
  return `
# Story Treatment

## 2. Season Promise And Dramatic Engine
- **Season dramatic question:** Can Kylie keep her voice?

### Protagonist
- **Name and pronouns:** Kylie Marinescu (she/her)

## 5. Stakes Architecture

- **Primary material stakes:** The blog and its readership; the apartment as sanctuary; Veronica's hidden letter.
- **Primary relational stakes:** The Dusk Club itself — whether friendship survives being weaponized; Mika's freedom from a contract.
- **Primary identity stakes:** Whether Kylie keeps her voice or becomes an owned, byline-less Consort.
- **Primary existential stakes:** Kylie's humanity and life on the Hunter's Moon; her grandmother's legacy.
- **How stakes escalate gradually:** A new life worth protecting → a viral blog and a courtship → a missing model and warning → a Hunter's Moon where humanity, voice, friendship, and life are all on one ballroom floor.
- **How personal stakes are established before larger stakes:** The pilot makes us care about the blog, friends, and bruised heart before supernatural rules are stated.
- **Which relationships/places/promises make the stakes emotionally legible:** The quartz; Veronica's gold chain and name; the blog readership number at every episode's end.

## 6. Information Ledger
- **INFO-A:** A secret is planted and revealed later.

### Episode 1: Pilot
- **Episode promise:** Kylie tries to start over.
- **Story Circle role:** you
- **Entry goal:** Kylie wants one good night.
`;
}

function branchEndingTreatmentMarkdown() {
  return `
# Bite Me

## 11. Cross-Episode Branches And Consequence Chains

### Branch A: The Quartz

- **Origin episode:** Episode 1.
- **What creates it:** Kylie accepts the rose quartz, refuses it, or loses it in her bag.
- **How it changes a later episode:** With the quartz accepted, the apartment holds at Episode 2; with the quartz refused or lost, Victor crosses the threshold.
- **Reconvergence episode:** Episode 2.
- **What residue remains after reconvergence:** The apartment remains full sanctuary, partial sanctuary, or compromised after the routes reconverge.
- **What state it changes:** Access (apartment sanctuary), resource (Stela's protection), and ending eligibility for the Witness ending.

## 14. Alternate Endings

### Ending 1: The Witness

- **Name:** The Witness
- **Summary:** Kylie keeps the blog, herself, and the friends she chose.
- **Emotional register:** Bittersweet triumph.
- **Theme payoff:** Kylie's voice stays her own.
- **State drivers:** The quartz accepted and kept; Mika freed at the salt circle.
- **Target conditions:** The quartz must be accepted and kept. Kylie stands behind Mika at the salt circle.
- **What repeated choice pattern this ending pays off:** Choosing authorship over being chosen.
- **Final voiceover line:** I wrote it in my own name.

### Episode 1: Quartz
- **Story Circle role:** you
- **Episode promise:** Kylie chooses what to do with Stela's quartz.

### Episode 2: Sanctuary
- **Story Circle role:** change
- **Episode promise:** The apartment's threshold reveals what the quartz choice changed.
`;
}

describe('TreatmentFieldUtilizationValidator', () => {
  it('builds contracts for every enforced authored treatment field', () => {
    const contracts = buildTreatmentFieldContractsForGuidance(1, guidance);
    expect(contracts.map((contract) => contract.contractKind)).toEqual(expect.arrayContaining([
      'pressure_lane',
      'encounter_anchor',
      'encounter_conflict',
      'stakes_layer',
      'theme_angle',
      'lie_pressure',
      'encounter_buildup',
      'major_choice_pressure',
      'alternative_path',
      'information_movement',
      'consequence_seed',
      'ending_turnout',
      'resolved_episode_tension',
      'cliffhanger_hook',
      'cliffhanger_question',
      'next_episode_pressure',
      'cliffhanger_setup',
      'cliffhanger_type',
      'emotional_charge',
      'end_state_change',
    ]));
    expect(contracts.length).toBeGreaterThanOrEqual(21);
  });

  it('fails plan-time validation when a parsed field is not consumed by any concrete artifact', () => {
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: analysis({ aPressure: 'Mara needs proof before the steward closes the archive.' }),
      seasonPlan: { ...plannedSeasonPlan({}), scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [] } } as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('was not consumed into a concrete plan artifact');
  });

  it('passes plan-time validation when generated scene planning assigns the fields to artifacts', () => {
    const plan = plannedSeasonPlan();
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: analysis(),
      seasonPlan: plan,
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(plan.scenePlan?.authoredTreatmentFields?.length).toBeGreaterThan(0);
    expect(plan.scenePlan?.scenes.some((scene) => (scene.authoredTreatmentFields ?? []).length > 0)).toBe(true);
  });

  it('passes plan-time validation when authored Story Circle beat text is assigned to a scene artifact', () => {
    const plan = storyCirclePlan();
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      seasonPlan: plan,
    });

    expect(result.issues.filter((issue) => issue.message.includes('Story Circle beat'))).toEqual([]);
    expect(plan.scenePlan?.storyCircleBeatContracts?.some((contract) => contract.beat === 'you')).toBe(true);
    expect(plan.scenePlan?.scenes.some((scene) => (scene.storyCircleBeatContracts ?? []).some((contract) => contract.beat === 'you'))).toBe(true);
  });

  it('passes plan-time validation when authored arc pressure is assigned to scene artifacts', () => {
    const plan = arcPressurePlan();
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      seasonPlan: plan,
    });

    expect(result.issues.filter((issue) => issue.message.includes('Arc pressure field'))).toEqual([]);
    expect(plan.scenePlan?.arcPressureContracts?.some((contract) => contract.contractKind === 'arc_midpoint_recontextualization')).toBe(true);
    expect(plan.scenePlan?.scenes.some((scene) => (scene.arcPressureContracts ?? []).length > 0)).toBe(true);
  });

  it('fails final validation when authored arc pressure is assigned but absent from prose', () => {
    const plan = arcPressurePlan();
    const target = plan.scenePlan?.arcPressureContracts?.find((contract) => contract.contractKind === 'arc_midpoint_recontextualization');
    const sceneId = target?.targetSceneIds?.[0] ?? 's1-1';
    const result = new TreatmentFieldUtilizationValidator().validate({
      seasonPlan: plan,
      story: finalStoryForScene(sceneId, 'Kylie orders a drink. Nothing changes.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Arc pressure field'))).toBe(true);
  });

  it('fails final validation when assigned fields never reach reader-facing prose', () => {
    const distinctPressure = 'The red ledger must be stolen before sunrise.';
    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: analysis({ aPressure: distinctPressure }),
      seasonPlan: plannedSeasonPlan({ aPressure: distinctPressure }),
      story: finalStory('Mara waits in a quiet room. Nothing changes.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('not realized in reader-facing story pressure'))).toBe(true);
  });

  it('fails final validation when a structural Story Circle beat drops its authored event', () => {
    const plan = storyCirclePlan();
    const sceneId = plan.scenePlan?.storyCircleBeatContracts?.[0]?.targetSceneIds?.[0] ?? 's1-1';
    const result = new TreatmentFieldUtilizationValidator().validate({
      seasonPlan: plan,
      story: finalStoryForScene(sceneId, 'Mara waits in a quiet room. Nothing changes.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Story Circle beat "you"'))).toBe(true);
  });

  it('extracts world/location guidance and builds load-bearing contracts', () => {
    const treatment = extractTreatmentFromMarkdown(`
# Treatment

## 2. Season Promise And Dramatic Engine
- **Season dramatic question:** Can Mara tell the truth?

## 4. World And Location Brief
- **World premise:** Modern Greyharbor with a hidden magical household underneath.
- **Time period:** Now. Phones, posts, and security cameras.
- **Technology/magic/supernatural rules, if any:** Kept quiet until the find.
  - Ghosts cannot cross iron thresholds unless invited by blood.
- **Power structures:** The Hale Household controls the archive.
- **Rules that create drama:**
  - A vow spoken in the archive binds the speaker until dawn.
- **What is forbidden, scarce, dangerous, sacred, expensive, humiliating, or socially costly:** Sacred — the iron key. Dangerous — the locked east wing.
- **3-6 key locations:**
  - Archive — The sealed family archive. Purpose: the proof funnel. Mood: airless. History: the ledger is hidden here. Choice pressure: open the door or burn the ledger.
`);
    const guidance = treatment.seasonGuidance?.worldLocationGuidance;
    expect(guidance?.worldPremise).toContain('Modern Greyharbor');
    expect(guidance?.supernaturalRules?.some((rule) => rule.includes('Ghosts cannot cross'))).toBe(true);
    expect(guidance?.keyLocations?.[0].choicePressure).toContain('open the door');

    const contracts = buildWorldTreatmentContracts({
      guidance,
      keyLocations: [{ id: 'archive', name: 'Archive', importance: 'major', firstAppearance: 1 }],
      totalEpisodes: 2,
      treatmentSourced: true,
    });
    expect(contracts.map((contract) => contract.contractKind)).toEqual(expect.arrayContaining([
      'world_premise',
      'supernatural_rule',
      'dramatic_rule',
      'faction_power',
      'sacred_object',
      'danger_zone',
      'location_purpose',
      'location_history',
      'location_choice_pressure',
    ]));
    expect(contracts.find((contract) => contract.contractKind === 'location_mood')?.blockingLevel).toBe('warning');
  });

  it('assigns world/location contracts into scene planning and mechanic pressure', () => {
    const plan = {
      ...plannedSeasonPlan({}),
      worldTreatmentContracts: worldContracts(),
      locationIntroductions: [{ locationId: 'archive', locationName: 'Archive', introducedInEpisode: 1 }],
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    expect(plan.scenePlan.worldTreatmentContracts?.length).toBeGreaterThan(0);
    expect(plan.scenePlan.scenes.some((scene) => (scene.worldTreatmentContracts ?? []).length > 0)).toBe(true);
    expect(plan.scenePlan.scenes.some((scene) =>
      (scene.mechanicPressure ?? []).some((pressure) => pressure.id.includes('location-choice-pressure'))
    )).toBe(true);
  });

  it('fails plan-time validation when a load-bearing world rule is unassigned', () => {
    const contracts = worldContracts().filter((contract) => contract.contractKind === 'dramatic_rule');
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: { ...analysis({}), worldTreatmentContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        worldTreatmentContracts: contracts,
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [], worldTreatmentContracts: contracts },
      } as unknown as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('World/location treatment field'))).toBe(true);
  });

  it('fails final validation when assigned world choice pressure is not on the page', () => {
    const contracts = worldContracts().filter((contract) => contract.contractKind === 'location_choice_pressure');
    const plan = {
      ...plannedSeasonPlan({}),
      worldTreatmentContracts: contracts,
      locationIntroductions: [{ locationId: 'archive', locationName: 'Archive', introducedInEpisode: 1 }],
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), worldTreatmentContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: plan,
      story: finalStory('Mara sits in a quiet room and thinks about the weather.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('World/location treatment field'))).toBe(true);
  });

  it('defers season-spanning world rules during partial final validation', () => {
    const contract = {
      ...worldContracts().find((candidate) => candidate.contractKind === 'supernatural_rule')!,
      targetEpisodeNumbers: [1, 2],
      targetSceneIds: ['s1-1'],
      sourceText: 'Strigoi require invitations in episode one, reveal their mirror rule in episode two, and pay off the broken-threshold law in the finale.',
    };
    const plan = {
      ...plannedSeasonPlan({}),
      totalEpisodes: 2,
      worldTreatmentContracts: [contract],
      scenePlan: {
        scenes: [{ id: 's1-1', episodeNumber: 1, title: 'The Gate', order: 1, worldTreatmentContracts: [contract] }],
        byEpisode: { 1: ['s1-1'] },
        setupPayoffEdges: [],
        worldTreatmentContracts: [contract],
      },
    } as unknown as SeasonPlan;

    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), worldTreatmentContracts: [contract] } as SourceMaterialAnalysis,
      seasonPlan: plan,
      story: finalStoryForScene('s1-1', 'Mara notices the archive door has rules nobody will explain yet.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.issues.filter((issue) => issue.message.includes('World/location treatment field'))).toEqual([]);
  });

  it('defers staged world-premise revelation during partial final validation', () => {
    const contract = {
      ...worldContracts().find((candidate) => candidate.contractKind === 'supernatural_rule')!,
      targetEpisodeNumbers: [1],
      targetSceneIds: ['s1-1'],
      sourceText: "Modern Bucharest, present day. Underneath, revealed only in stages, a thriving supernatural society older than the country's current name.",
    };
    const plan = {
      ...plannedSeasonPlan({}),
      totalEpisodes: 8,
      worldTreatmentContracts: [contract],
      scenePlan: {
        scenes: [{ id: 's1-1', episodeNumber: 1, title: 'The Gate', order: 1, worldTreatmentContracts: [contract] }],
        byEpisode: { 1: ['s1-1'] },
        setupPayoffEdges: [],
        worldTreatmentContracts: [contract],
      },
    } as unknown as SeasonPlan;

    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), worldTreatmentContracts: [contract], totalEstimatedEpisodes: 8 } as SourceMaterialAnalysis,
      seasonPlan: plan,
      story: finalStoryForScene('s1-1', 'Bucharest glitters around Mara, but the oldest rules stay just out of reach.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.issues.filter((issue) => issue.message.includes('World/location treatment field'))).toEqual([]);
  });

  it('extracts stakes architecture guidance and builds contracts for every stake lane', () => {
    const treatment = extractTreatmentFromMarkdown(stakesTreatmentMarkdown());
    const guidance = treatment.seasonGuidance?.stakesArchitectureGuidance;
    expect(guidance?.primaryMaterialStakes?.join(' ')).toContain('blog');
    expect(guidance?.primaryRelationalStakes?.join(' ')).toContain('Dusk Club');
    expect(guidance?.primaryIdentityStakes?.join(' ')).toContain('voice');
    expect(guidance?.primaryExistentialStakes?.join(' ')).toContain('humanity');
    expect(guidance?.escalationLadder?.length).toBeGreaterThanOrEqual(3);
    expect(guidance?.emotionalLegibilityAnchors?.join(' ')).toContain('quartz');

    const contracts = buildStakesArchitectureContracts({
      guidance: treatment.seasonGuidance,
      totalEpisodes: 8,
      treatmentSourced: true,
    });
    expect(contracts.map((contract) => contract.contractKind)).toEqual(expect.arrayContaining([
      'material_stake',
      'relational_stake',
      'identity_stake',
      'existential_stake',
      'stakes_escalation_step',
      'personal_stakes_prerequisite',
      'emotional_stakes_anchor',
    ]));
    expect(contracts.find((contract) => contract.contractKind === 'existential_stake')?.prerequisiteContractIds.length).toBeGreaterThan(0);
    expect(contracts.some((contract) => contract.blockingLevel === 'treatment' || contract.blockingLevel === 'structural')).toBe(true);
  });

  it('assigns stakes architecture contracts into scene planning and mechanic pressure', () => {
    const treatment = extractTreatmentFromMarkdown(stakesTreatmentMarkdown());
    const contracts = buildStakesArchitectureContracts({
      guidance: treatment.seasonGuidance,
      totalEpisodes: 2,
      treatmentSourced: true,
    });
    const plan = {
      ...plannedSeasonPlan({}),
      treatmentSeasonGuidance: treatment.seasonGuidance,
      stakesArchitectureContracts: contracts,
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    expect(plan.scenePlan.stakesArchitectureContracts?.length).toBeGreaterThan(0);
    expect(plan.scenePlan.scenes.some((scene) => (scene.stakesArchitectureContracts ?? []).length > 0)).toBe(true);
    expect(plan.scenePlan.scenes.some((scene) =>
      (scene.mechanicPressure ?? []).some((pressure) => pressure.id.includes('stakes-'))
    )).toBe(true);
  });

  it('fails plan-time validation when a load-bearing stakes architecture field is unassigned', () => {
    const treatment = extractTreatmentFromMarkdown(stakesTreatmentMarkdown());
    const contracts = buildStakesArchitectureContracts({
      guidance: treatment.seasonGuidance,
      totalEpisodes: 2,
      treatmentSourced: true,
    }).filter((contract) => contract.contractKind === 'material_stake');
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: { ...analysis({}), stakesArchitectureContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        stakesArchitectureContracts: contracts,
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [], stakesArchitectureContracts: contracts },
      } as unknown as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Stakes architecture field'))).toBe(true);
  });

  it('fails final validation when assigned stakes are not visible on the page', () => {
    const treatment = extractTreatmentFromMarkdown(stakesTreatmentMarkdown());
    const contracts = buildStakesArchitectureContracts({
      guidance: treatment.seasonGuidance,
      totalEpisodes: 2,
      treatmentSourced: true,
    }).filter((contract) => contract.contractKind === 'identity_stake');
    const plan = {
      ...plannedSeasonPlan({}),
      treatmentSeasonGuidance: treatment.seasonGuidance,
      stakesArchitectureContracts: contracts,
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), stakesArchitectureContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: plan,
      story: finalStory('Mara sits in a quiet room and thinks about the weather.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Stakes architecture field'))).toBe(true);
  });

  it('assigns branch and ending contracts to scenes and mechanic pressure instead of leaving them as prompt-only summaries', () => {
    const treatment = extractTreatmentFromMarkdown(branchEndingTreatmentMarkdown());
    const endings = treatment.endings;
    const branchContracts = buildBranchConsequenceContracts({
      branches: treatment.branches,
      endings,
      totalEpisodes: 2,
      treatmentSourced: true,
    });
    const endingContracts = buildEndingRealizationContracts({
      endings,
      totalEpisodes: 2,
      treatmentSourced: true,
      branchContracts,
    });
    const plan = {
      ...plannedSeasonPlan({}),
      resolvedEndings: endings,
      branchConsequenceContracts: branchContracts,
      endingRealizationContracts: endingContracts,
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    expect(plan.scenePlan.branchConsequenceContracts?.length).toBeGreaterThan(0);
    expect(plan.scenePlan.endingRealizationContracts?.length).toBeGreaterThan(0);
    expect(plan.scenePlan.scenes.some((scene) => (scene.branchConsequenceContracts ?? []).length > 0)).toBe(true);
    expect(plan.scenePlan.scenes.some((scene) => (scene.endingRealizationContracts ?? []).length > 0)).toBe(true);
    expect(plan.scenePlan.scenes.some((scene) =>
      (scene.mechanicPressure ?? []).some((pressure) => pressure.id.includes('branch-consequence-') || pressure.id.includes('ending-realization-'))
    )).toBe(true);
  });

  it('fails plan-time validation when a parsed branch contract is not consumed by concrete branch artifacts', () => {
    const treatment = extractTreatmentFromMarkdown(branchEndingTreatmentMarkdown());
    const contracts = buildBranchConsequenceContracts({
      branches: treatment.branches,
      endings: treatment.endings,
      totalEpisodes: 2,
      treatmentSourced: true,
    }).filter((contract) => contract.contractKind === 'branch_origin_choice');
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: { ...analysis({}), branchConsequenceContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        branchConsequenceContracts: contracts,
        crossEpisodeBranches: [],
        seasonFlags: [],
        choiceMoments: [],
        consequenceChains: [],
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [], branchConsequenceContracts: contracts },
      } as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Cross-episode branch field'))).toBe(true);
  });

  it('fails final validation when assigned authored branch pressure is absent from generated prose', () => {
    const treatment = extractTreatmentFromMarkdown(branchEndingTreatmentMarkdown());
    const contracts = buildBranchConsequenceContracts({
      branches: treatment.branches,
      endings: treatment.endings,
      totalEpisodes: 2,
      treatmentSourced: true,
    }).filter((contract) => contract.contractKind === 'branch_origin_choice');
    const plan = {
      ...plannedSeasonPlan({}),
      branchConsequenceContracts: contracts,
      choiceMoments: [{ id: 'quartz-choice', episode: 1, anchor: contracts[0].sourceText }],
      seasonFlags: [{ flag: 'quartz_accepted', description: 'Quartz accepted', setInEpisode: 1, checkedInEpisodes: [2] }],
    } as SeasonPlan;
    plan.scenePlan = buildSeasonScenePlan(plan);

    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), branchConsequenceContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: plan,
      story: finalStoryForScene(plan.scenePlan?.scenes[0]?.id ?? 's1-1', 'Mara thinks about ordinary wallpaper.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Cross-episode branch field'))).toBe(true);
  });

  it('fails plan-time validation when an authored ending target condition has no reachable route driver', () => {
    const treatment = extractTreatmentFromMarkdown(branchEndingTreatmentMarkdown());
    const contracts = buildEndingRealizationContracts({
      endings: treatment.endings,
      totalEpisodes: 2,
      treatmentSourced: true,
      branchContracts: [],
    }).filter((contract) => contract.contractKind === 'ending_target_condition');
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: { ...analysis({}), endingRealizationContracts: contracts } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        resolvedEndings: treatment.endings,
        endingRealizationContracts: contracts,
        seasonFlags: [],
        choiceMoments: [],
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [], endingRealizationContracts: contracts },
      } as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Alternate ending field'))).toBe(true);
  });

  it('fails plan-time validation when an authored failure-mode audit contract is assigned nowhere', () => {
    const contract = failureModeContract();
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: { ...analysis({}), failureModeAuditContracts: [contract] } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        failureModeAuditContracts: [contract],
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [], failureModeAuditContracts: [contract] },
      } as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Failure mode audit field'))).toBe(true);
  });

  it('fails final validation when an assigned failure-mode audit mitigation is absent from prose', () => {
    const contract = failureModeContract({ targetSceneIds: ['s1-1'] });
    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), failureModeAuditContracts: [contract] } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        failureModeAuditContracts: [contract],
        scenePlan: {
          scenes: [{ id: 's1-1', episodeNumber: 1, title: 'The Gate', order: 1, failureModeAuditContracts: [contract] }],
          byEpisode: { 1: ['s1-1'] },
          setupPayoffEdges: [],
          failureModeAuditContracts: [contract],
        },
      } as unknown as SeasonPlan,
      story: finalStoryForScene('s1-1', 'Mara waits until strangers solve the gate problem.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Failure mode audit field'))).toBe(true);
  });

  it('defers season-spanning failure-mode audit prose checks during partial final validation', () => {
    const contract = failureModeContract({
      targetSceneIds: ['s1-1'],
      targetEpisodeNumbers: [1, 2],
      sourceText: 'Reset disease avoided: every episode changes the end-state, with episode one opening the archive and episode two making the household hunt the missing key.',
    });
    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: { ...analysis({}), failureModeAuditContracts: [contract] } as SourceMaterialAnalysis,
      seasonPlan: {
        ...plannedSeasonPlan({}),
        totalEpisodes: 2,
        failureModeAuditContracts: [contract],
        scenePlan: {
          scenes: [{ id: 's1-1', episodeNumber: 1, title: 'The Gate', order: 1, failureModeAuditContracts: [contract] }],
          byEpisode: { 1: ['s1-1'] },
          setupPayoffEdges: [],
          failureModeAuditContracts: [contract],
        },
      } as unknown as SeasonPlan,
      story: finalStoryForScene('s1-1', 'Mara opens the archive and cannot return to pretending it is only wallpaper.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.issues.filter((issue) => issue.message.includes('Failure mode audit field'))).toEqual([]);
  });
});

function failureModeContract(overrides: Partial<FailureModeAuditContract> = {}): FailureModeAuditContract {
  return {
    id: 'failure-mode-passive-protagonist-agency',
    source: 'treatment',
    code: 'passive_protagonist',
    label: 'Passive protagonist',
    status: 'watch_item',
    sourceText: 'Mara must choose to use the map she earned instead of being rescued by guards.',
    contractKind: 'agency_claim',
    requiredRealization: ['choice', 'scene_turn', 'ending_route', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers: [1],
    targetSceneIds: [],
    linkedContractIds: [],
    blockingLevel: 'treatment',
    ...overrides,
  };
}
