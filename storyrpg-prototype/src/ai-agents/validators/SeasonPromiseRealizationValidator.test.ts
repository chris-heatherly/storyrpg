import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis, TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import { buildSeasonScenePlan } from '../pipeline/seasonScenePlanBuilder';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';
import { buildSeasonPromiseContracts } from '../utils/seasonPromiseContracts';
import { SeasonPromiseRealizationValidator } from './SeasonPromiseRealizationValidator';

const guidance: TreatmentSeasonGuidance = {
  genre: 'Paranormal rom-com that graduates into dark vampire romance by midseason.',
  tone: 'Champagne fizz on top, blood at the bottom; early episodes are bright before the back half darkens.',
  highConceptPitch: 'Sex and the City meets Twilight: dating can be a horror show where the men are actual monsters.',
  logline: 'A food writer in Bucharest starts a dating blog and discovers the man, friends, and city are monsters.',
  coreFantasy: 'New city nightlife, friend group, one more round at dusk, and a blog readership growing by the week.',
  audiencePromise: 'The first episodes feel like vacation; midseason darkens; the finale reveals who was lying.',
  premisePromise: 'Reinvention after public heartbreak, glamorous nightlife with a feeding ground underneath, and a blog the vampire cannot control.',
  themeQuestion: 'Whose voice is yours when love asks you to surrender it?',
  inactionPressure: 'Standing still means losing safety, voice, legacy, or humanity.',
  seasonDramaticQuestion: 'Can Mara learn to author her own story when every monster wants to edit it?',
  centralPressure: 'A beautiful monster mistakes love for ownership and pressures her public voice.',
  playerPromise: 'Choose between being courted and being the author, then watch loyalties and routes shift.',
  emotionalPromise: 'Adoration becomes annihilation, but friendship and straight truth survive.',
  freshVariationPlan: 'Dating montage, country-house courtship, midpoint flip, blog war, reckoning, and convergence.',
  typicalEpisodeDeliverables: 'After the pilot: friend conversation, romance encounter, recontextualizing reveal, footing shift, and major route choice.',
  seasonMustResolve: 'Whether Mara keeps her voice, which life she chooses, whether sanctuary held, and what the monster design cost.',
  futureOpenThreads: 'The older monster, the lost letter, the family line, and the coming visit remain future pressure.',
};

function architecture(): SeasonPlan['seasonPromiseArchitecture'] {
  return {
    seasonDramaticQuestion: 'Can Mara keep her voice when the city asks her to trade it for love?',
    centralPressure: {
      type: 'person',
      description: 'A glamorous monster courts her while her public voice draws danger closer.',
      pressuresLieBy: 'Waiting narrows safety, access, and voice.',
    },
    seasonPromise: {
      premisePromise: 'A newcomer reinvents herself through nightlife and a dangerous public blog.',
      playerExperiencePromise: 'The player chooses how boldly to use voice, trust, and curiosity.',
      emotionalPromise: 'Bright belonging steadily darkens into dread and self-possession.',
      variationPlan: ['vacation sparkle', 'midseason dread', 'finale betrayal'],
    },
    seasonCompleteness: {
      resolvedQuestion: 'Mara chooses her own voice.',
      resolvedStakes: 'The city can no longer fully script her.',
      characterStateChange: 'She ends less dazzled and more self-owned.',
    },
  };
}

function analysis(seasonGuidance: TreatmentSeasonGuidance = guidance): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    sourceTitle: 'Dating After Dusk',
    title: 'Dating After Dusk',
    genre: 'paranormal rom-com',
    tone: 'champagne dread',
    synopsis: 'A dating blog opens a monster city.',
    majorCharacters: [],
    keyLocations: [],
    themes: [],
    treatmentSeasonGuidance: seasonGuidance,
    episodeBreakdown: [],
    totalEstimatedEpisodes: 3,
  } as unknown as SourceMaterialAnalysis;
}

function plannedSeasonPlan(seasonGuidanceInput: Partial<TreatmentSeasonGuidance> = guidance): SeasonPlan {
  const seasonGuidance: TreatmentSeasonGuidance = {
    ...seasonGuidanceInput,
  };
  const contracts = buildSeasonPromiseContracts({
    guidance: seasonGuidance,
    architecture: architecture(),
    totalEpisodes: 3,
    treatmentSourced: true,
  });
  const plan = {
    id: 'season-1',
    sourceTitle: 'Dating After Dusk',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    analysisVersion: 'test',
    seasonTitle: 'Dating After Dusk',
    seasonSynopsis: 'A newcomer finds nightlife, a blog, and monsters beneath glamour.',
    totalEpisodes: 3,
    estimatedTotalDuration: '3 episodes',
    genre: 'Paranormal rom-com that graduates into dark vampire romance',
    tone: 'Champagne fizz on top, blood at the bottom',
    themes: ['voice under pressure'],
    anchors: {},
    legacyStructure: { hook: 'Mara starts over in the city.' },
    seasonPromiseArchitecture: architecture(),
    seasonPromiseContracts: contracts,
    arcs: [],
    endingMode: 'single',
    resolvedEndings: [],
    progress: { selectedCount: 0, completedCount: 0, inProgressCount: 0, percentComplete: 0 },
    protagonist: { id: 'mara', name: 'Mara', description: 'A food writer.' },
    characterIntroductions: [],
    locationIntroductions: [],
    encounterPlan: { totalEncounters: 1, difficultyCurve: [], typeDistribution: {} },
    crossEpisodeBranches: [],
    consequenceChains: [{
      id: 'voice-pressure',
      origin: { episodeNumber: 1, description: 'Her blog voice makes waiting impossible.' },
      consequences: [{ episodeNumber: 3, description: 'The monster asks her to give the blog up.' }],
    }],
    choiceMoments: [{
      id: 'voice-or-silence',
      episode: 1,
      anchor: 'Keep posting or stay safely quiet.',
      paysOffEpisode: 3,
    }],
    informationLedger: [{
      id: 'monster-city',
      label: 'The glamorous city has a feeding ground underneath.',
      introducedEpisode: 1,
      plannedRevealEpisode: 2,
      plannedPayoffEpisode: 3,
      setupTouchEpisodes: [1],
    }],
    episodes: [1, 2, 3].map((episodeNumber) => ({
      episodeNumber,
      title: `Episode ${episodeNumber}`,
      synopsis: episodeNumber === 1
        ? 'Mara enters the nightlife, finds a friend group, starts over, and chooses whether to use her voice.'
        : episodeNumber === 2
        ? 'The glamour darkens as the city shows teeth.'
        : 'The finale makes love, voice, and monstrosity collide.',
      structuralRole: episodeNumber === 1 ? ['hook'] : episodeNumber === 2 ? ['midpoint'] : ['resolution'],
      status: 'planned',
      dependsOn: [],
      setupsForEpisodes: [],
      resolvesPlotsFrom: [],
      introducesCharacters: [],
      locations: ['Bucharest'],
      mainCharacters: ['Mara'],
      estimatedSceneCount: 3,
    })),
    preferences: { targetScenesPerEpisode: 3, targetChoicesPerEpisode: 2, pacing: 'moderate' },
    warnings: [],
    notes: [],
  } as unknown as SeasonPlan;
  plan.scenePlan = buildSeasonScenePlan(plan);
  return plan;
}

function finalStory(textByEpisode: Record<number, string>, genre = 'Paranormal rom-com that graduates into dark vampire romance'): Story {
  return {
    id: 'story-1',
    title: 'Dating After Dusk',
    genre,
    synopsis: 'A dating blog opens a monster city.',
    metadata: { tone: 'Champagne fizz on top, blood at the bottom' } as never,
    initialState: {} as never,
    episodes: [1, 2, 3].map((number) => ({
      id: `ep-${number}`,
      number,
      title: `Episode ${number}`,
      synopsis: number === 1 ? 'Mara starts over through nightlife and a blog.' : 'Pressure rises.',
      coverImage: {} as never,
      startingSceneId: `s${number}-1`,
      scenes: [{
        id: `s${number}-1`,
        name: `Scene ${number}`,
        startingBeatId: 'b1',
        leadsTo: [],
        beats: [{ id: 'b1', text: textByEpisode[number] ?? 'A quiet scene passes without pressure.' } as never],
      }],
    })),
  } as unknown as Story;
}

describe('SeasonPromiseRealizationValidator', () => {
  it('builds contracts for explicit top-level treatment fields', () => {
    const contracts = buildSeasonPromiseContracts({
      guidance,
      architecture: architecture(),
      totalEpisodes: 3,
      treatmentSourced: true,
    });

    expect(contracts.map((contract) => contract.contractKind)).toEqual(expect.arrayContaining([
      'genre_progression',
      'tone_progression',
      'high_concept_pitch',
      'logline_engine',
      'core_fantasy',
      'audience_promise',
      'premise_promise',
      'theme_question',
      'inaction_pressure',
      'season_dramatic_question',
      'central_pressure',
      'player_promise',
      'emotional_promise',
      'fresh_variation_plan',
      'typical_episode_engine',
      'season_resolution_obligation',
      'future_open_thread',
    ]));
    expect(contracts.every((contract) => contract.blockingLevel === 'treatment')).toBe(true);
    expect(contracts.find((contract) => contract.contractKind === 'high_concept_pitch')).toMatchObject({
      sourceText: guidance.highConceptPitch,
      requiredRealization: expect.arrayContaining(['episode_plan', 'scene_turn', 'choice', 'encounter', 'final_prose']),
    });
  });

  it('extracts Season Promise And Dramatic Engine bullets into structured guidance', () => {
    const treatment = extractTreatmentFromMarkdown(`
# Test Treatment

## 2. Season Promise And Dramatic Engine
- **Season dramatic question framed around the protagonist's Lie:** Can Mara author her own story?
- **Central pressure:** The monster wants her voice quiet.
- **Player promise:** Choose authoring or being chosen.
- **Emotional promise:** Sparkle becomes dread, then self-possession.
- **Fresh variation plan:** Pilot, midpoint flip, finale reckoning.
- **What a typical episode delivers after the pilot:** Conversation, romance encounter, reveal, cost, route choice.
- **What the season must resolve:** Voice, sanctuary, freedom, and the monster's design.
- **What can remain open for future seasons:** The old letter and older monster.

## Episode Outline
### Episode 1: Pilot
- **Entry goal:** Mara wants a new life.
- **Forced choice:** Write or stay quiet.
- **Exit shift:** She posts.
- **Cliffhanger question:** Who read it?
`);

    expect(treatment.seasonGuidance?.seasonDramaticQuestion).toContain('author her own story');
    expect(treatment.seasonGuidance?.typicalEpisodeDeliverables).toContain('romance encounter');
    expect(treatment.seasonGuidance?.seasonMustResolve).toContain('sanctuary');
    expect(treatment.seasonGuidance?.futureOpenThreads).toContain('older monster');
  });

  it('fails plan-time validation when a parsed promise is assigned nowhere', () => {
    const result = new SeasonPromiseRealizationValidator().validatePlan({
      sourceAnalysis: analysis({ ...guidance, coreFantasy: 'The moonlit market must become a playable fantasy.' }),
      seasonPlan: {
        ...plannedSeasonPlan({}),
        seasonPromiseContracts: [],
        seasonPromiseArchitecture: undefined,
        scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [] },
      } as SeasonPlan,
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('not consumed into concrete plan artifacts');
  });

  it('passes plan-time validation when the scene plan assigns promise contracts', () => {
    const plan = plannedSeasonPlan();
    const result = new SeasonPromiseRealizationValidator().validatePlan({
      sourceAnalysis: analysis(),
      seasonPlan: plan,
      treatmentSourced: true,
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(plan.scenePlan?.seasonPromiseContracts?.length).toBeGreaterThan(0);
    expect(plan.scenePlan?.scenes.some((scene) => (scene.seasonPromiseContracts ?? []).length > 0)).toBe(true);
  });

  it('recognizes authoritative treatment genre and tone text when metadata is condensed', () => {
    const plan = plannedSeasonPlan();
    plan.genre = 'Paranormal Romance / Dark Urban Fantasy';
    plan.tone = 'witty, gothic, suspenseful';

    const result = new SeasonPromiseRealizationValidator().validatePlan({
      sourceAnalysis: analysis(),
      seasonPlan: plan,
      treatmentSourced: true,
    });

    expect(result.issues.filter((issue) =>
      issue.severity === 'error'
      && /genre_progression|tone_progression/.test(issue.message)
    )).toEqual([]);
  });

  it('fails final validation when a theme or inaction promise stays metadata-only', () => {
    const seasonGuidance = {
      themeQuestion: 'Whose voice is yours when love asks you to surrender it?',
      inactionPressure: 'Standing still means losing safety, voice, legacy, or humanity.',
    } satisfies TreatmentSeasonGuidance;
    const plan = plannedSeasonPlan(seasonGuidance);

    const result = new SeasonPromiseRealizationValidator().validate({
      sourceAnalysis: analysis(seasonGuidance),
      seasonPlan: plan,
      story: finalStory({ 1: 'Mara sits in a quiet room. The evening is pleasant. Nothing costs anything.' }),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('not realized as reader-facing story material'))).toBe(true);
  });

  it('passes final validation when different wording visibly delivers the promise', () => {
    const plan = plannedSeasonPlan();
    const result = new SeasonPromiseRealizationValidator().validate({
      sourceAnalysis: analysis(),
      seasonPlan: plan,
      story: finalStory({
        1: 'In Bucharest nightlife, Mara becomes the new name at the table: friends order one more round at dusk, the dating blog starts pulling readers, and she chooses to keep posting even though silence would be safer.',
        2: 'The vacation sparkle curdles into danger: a friend conversation names the stakes, a romance encounter exposes a new detail, and the reveal shifts her footing with the blog at real cost.',
        3: 'By the finale, the man who loves her asks for her voice; Mara refuses, keeps the blog, resolves sanctuary and freedom, and leaves changed, less dazzled and more her own. The old letter remains open future pressure.',
      }),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
