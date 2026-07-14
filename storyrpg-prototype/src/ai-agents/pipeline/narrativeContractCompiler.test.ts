import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { EpisodeSpineContract } from '../../types/episodeSpine';
import type { AuthoredEventSemanticIR } from '../../types/narrativeContract';
import {
  applyEpisodeEventPlans,
  assertSelectedEpisodeEventPlansExecutable,
  compileAndApplyNarrativeContracts,
  compileEpisodeEventPlan,
  compileNarrativeContractGraph,
  projectSetupPayoffEdgesFromGraph,
  validateCanonicalEpisodeBlueprintProjection,
} from './narrativeContractCompiler';
import {
  SEMANTIC_CONTRACT_IR_POLICY_VERSION,
  semanticContractEventSeeds,
  semanticContractPremiseSeeds,
  semanticContractPremiseSourceHash,
  semanticContractSourceHash,
} from './semanticContractIr';

function scene(overrides: Partial<PlannedScene> & Pick<PlannedScene, 'id' | 'episodeNumber' | 'order'>): PlannedScene {
  return {
    kind: 'standard',
    title: overrides.id,
    dramaticPurpose: overrides.id,
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    turnContract: {
      turnId: `${overrides.id}-turn`,
      source: 'treatment',
      centralTurn: overrides.dramaticPurpose || overrides.id,
      beforeState: 'before',
      turnEvent: overrides.dramaticPurpose || overrides.id,
      afterState: 'after',
      handoff: 'handoff',
    },
    ...overrides,
  };
}

function plan(episodes: number[]): SeasonPlan {
  return {
    id: 'story',
    sourceTitle: 'Story',
    episodes: episodes.map((episodeNumber) => ({ episodeNumber, plannedScenes: [] })),
    residuePlan: [],
  } as unknown as SeasonPlan;
}

function scenePlan(scenes: PlannedScene[], spines: Record<number, EpisodeSpineContract> = {}): SeasonScenePlan {
  return {
    scenes,
    byEpisode: Object.fromEntries(Array.from(new Set(scenes.map((item) => item.episodeNumber))).map((episode) => [episode, scenes.filter((item) => item.episodeNumber === episode).map((item) => item.id)])),
    setupPayoffEdges: [],
    episodeSpines: spines,
    sourceHash: 'source',
  };
}

describe('NarrativeContractCompiler', () => {
  it('moves group pacing to the canonical bond-unit owner before task compilation', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u4', order: 3, text: 'Testing Kylie.', kind: 'test', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u5', order: 4, text: 'The three form the Dusk Club.', kind: 'bond', storyCircleFacets: [], prerequisites: ['ep1-u4'], sceneKind: 'standard' },
      ],
    };
    const groupContract = {
      id: 'dusk-club-pacing', source: 'treatment' as const, groupId: 'dusk-club',
      startStage: 'noticed' as const, targetStage: 'spark' as const,
      allowedLabels: ['joke'], blockedLabels: ['official'], requiredEvidence: ['earn membership'],
      minScenesSinceIntroduction: 1, maxDeltaThisScene: 1, mechanicDimensions: ['trust' as const],
      milestone: {
        id: 'dusk-club-milestone', kind: 'group_formation' as const,
        sourceText: 'The three form the Dusk Club.', subjectType: 'group' as const,
        subjectId: 'dusk-club', targetStage: 'spark' as const,
        introductionSceneIds: ['s1-4'], testSceneIds: ['s1-4'], choiceSceneId: 's1-4',
        memberNpcIds: ['mika'], requiredEvidenceTags: ['respected_agency' as const],
      },
    };
    const scenes = [
      scene({ id: 's1-4', episodeNumber: 1, order: 3, spineUnitId: 'ep1-u4', dramaticPurpose: 'Testing Kylie.', relationshipPacing: [groupContract] }),
      scene({ id: 's1-5', episodeNumber: 1, order: 4, spineUnitId: 'ep1-u5', dramaticPurpose: 'A rooftop stranger notices Kylie.' }),
    ];

    const compiled = compileAndApplyNarrativeContracts(plan([1]), scenePlan(scenes, { 1: spine }));

    expect(compiled.scenes.some((candidate) => candidate.id === 's1-4')).toBe(false);
    expect(compiled.scenes.find((candidate) => candidate.id === 's1-5')?.relationshipPacing?.[0]?.id).toBe('dusk-club-pacing');
    expect(compiled.scenes.find((candidate) => candidate.id === 's1-5')?.choiceType).toBe('relationship');
    expect(compiled.narrativeContractGraph?.realizationTasks?.some((task) =>
      task.contractId === 'dusk-club-pacing' && task.sceneId === 's1-5',
    )).toBe(true);
  });

  it('orders Bite Me rescue before writing and writing before viral aftermath without duplicate ownership', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u7', order: 6, text: 'Kylie is attacked and Victor rescues her.', kind: 'set_piece', storyCircleFacets: [], prerequisites: [], encounterProfile: 'staged_rescue', sceneKind: 'encounter' },
        { id: 'ep1-u8', order: 7, text: 'At 4am she writes the post, and by evening it has gone viral.', kind: 'late_night_writing', storyCircleFacets: [], prerequisites: ['ep1-u7'], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({ id: 'treatment-enc-1-1', episodeNumber: 1, order: 6, kind: 'encounter', spineUnitId: 'ep1-u7', dramaticPurpose: 'Kylie is attacked and Victor rescues her.' }),
      scene({
        id: 's1-7',
        episodeNumber: 1,
        order: 7,
        spineUnitId: 'ep1-u8',
        dramaticPurpose: 'At 4am she writes the post, and by evening it has gone viral.',
        turnContract: {
          turnId: 's1-7-turn',
          source: 'treatment',
          centralTurn: 'At 4am she writes the post, and by evening it has gone viral.',
          beforeState: 'The night is private.',
          turnEvent: 'At 4am she writes the post, and by evening it has gone viral.',
          afterState: 'The post is public.',
          handoff: 'Carry the moment forward.',
        },
      }),
    ];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    const plans = applyEpisodeEventPlans(graph, scenes);

    expect(plans[1].sceneOrder).toEqual(['treatment-enc-1-1', 's1-7', 's1-blog-aftermath']);
    expect(scenes.map((item) => item.id)).toEqual(['treatment-enc-1-1', 's1-7', 's1-blog-aftermath']);
    expect(scenes[1].turnContract?.centralTurn).toBe('At 4am she writes the post');
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['blogAftermath']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents[0]?.text).toMatch(/^By evening/i);
    expect(graph.validation.issues.some((issue) => issue.code === 'compound_writing_aftermath_scene_split')).toBe(true);
    expect(new Set(plans[1].orderedEventIds).size).toBe(plans[1].orderedEventIds.length);
  });

  it('folds an interpretive Story Circle summary into canonical rescue and aftermath events', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u6', order: 0, text: 'Kylie is attacked and rescued by Mr. Midnight.', kind: 'set_piece', storyCircleFacets: [], prerequisites: [], encounterProfile: 'staged_rescue', sceneKind: 'encounter' },
        { id: 'ep1-u7', order: 1, text: 'At 4am she writes the first post, and by evening it has gone viral.', kind: 'late_night_writing', storyCircleFacets: [], prerequisites: ['ep1-u6'], sceneKind: 'standard' },
      ],
    };
    const summary = 'Kylie after a terrifying rescue by Mr Midnight, as the first viral proof that she can author a new life';
    const storyCircleContract: NonNullable<PlannedScene['storyCircleBeatContracts']>[number] = {
      id: 'story-circle-you-rescue-to-viral-proof',
      beat: 'you' as const,
      sourceText: summary,
      targetEpisodeNumber: 1,
      requiredRealization: ['season_plan', 'scene_turn', 'final_prose'],
      eventAtoms: [summary],
      preservedMarkers: ['viral'],
      stateChange: summary,
      targetSceneIds: ['rescue'],
      blockingLevel: 'treatment' as const,
    };
    const scenes = [
      scene({
        id: 'rescue', episodeNumber: 1, order: 0, kind: 'encounter', spineUnitId: 'ep1-u6',
        dramaticPurpose: 'Kylie is attacked and rescued by Mr. Midnight.',
        requiredBeats: [
          { id: 'rescue-beat', sourceTurn: 'Kylie is attacked and rescued by Mr. Midnight.', mustDepict: 'Kylie is attacked and rescued by Mr. Midnight.', tier: 'authored' },
          { id: 'rescue-story-circle-summary', sourceTurn: summary, mustDepict: summary, tier: 'authored' },
        ],
        storyCircleBeatContracts: [storyCircleContract],
      }),
      scene({
        id: 'writing', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u7',
        dramaticPurpose: 'At 4am she writes the first post, and by evening it has gone viral.',
      }),
    ];

    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    const plans = applyEpisodeEventPlans(graph, scenes);
    const episodeEvents = graph.events.filter((event) => event.episodeNumber === 1 && event.realizationMode === 'depiction');

    expect(episodeEvents.filter((event) => event.cue === 'blogAftermath')).toHaveLength(1);
    expect(episodeEvents.some((event) => event.sourceText === summary)).toBe(false);
    expect(scenes.find((candidate) => candidate.id === 'rescue')?.requiredBeats?.some((beat) => beat.mustDepict === summary)).toBe(false);
    expect(scenes.find((candidate) => candidate.id === 'rescue')?.storyCircleBeatContracts).toBeUndefined();
    expect(episodeEvents.filter((event) => event.sourceContractIds.includes(storyCircleContract.id))).toHaveLength(1);
    expect(plans[1].orderedEventIds.map((eventId) => graph.events.find((event) => event.id === eventId)?.cue))
      .toEqual(['threatEncounter', 'lateNightWriting', 'blogAftermath']);
    expect(graph.validation.issues.some((issue) => issue.code === 'interpretive_story_circle_contract_folded')).toBe(true);
  });

  it('keeps local ownership episode-scoped while projecting an explicit cross-episode payoff', () => {
    const scenes = [
      scene({ id: 'ep1-rescue', episodeNumber: 1, order: 0, dramaticPurpose: 'Victor rescues Kylie from an attack.', requiredBeats: [{ id: 'rescue', sourceTurn: 'rescue', mustDepict: 'Victor rescues Kylie from an attack.', tier: 'authored' }] }),
      scene({ id: 'ep2-discovery', episodeNumber: 2, order: 0, dramaticPurpose: 'Kylie discovers evidence that the attack was staged.', requiredBeats: [{ id: 'discovery', sourceTurn: 'discovery', mustDepict: 'Kylie discovers evidence that the attack was staged.', tier: 'authored' }] }),
    ];
    const sp = scenePlan(scenes);
    sp.setupPayoffEdges.push({ from: 'ep1-rescue', to: 'ep2-discovery', span: 'cross_episode', description: 'The staged rescue is exposed.' });
    const graph = compileNarrativeContractGraph(plan([1, 2]), sp);
    const plans = applyEpisodeEventPlans(graph, scenes);

    expect(plans[2].dueDependencyIds).toHaveLength(1);
    expect(scenes[1].sceneEventOwnership?.priorEventsWithinEpisode).toEqual([]);
    expect(scenes[1].sceneEventOwnership?.episodeNumber).toBe(2);
    expect(graph.dependencies[0].sourceEpisodeNumber).toBe(1);
    expect(graph.dependencies[0].targetEpisodeNumbers).toEqual([2]);
  });

  it('migrates a legacy abstract test owner into the dependent bond event', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'legacy-ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u1', order: 0, text: 'Testing Kylie', kind: 'test', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u2', order: 1, text: 'The three become friends and form the Dusk Club.', kind: 'bond', storyCircleFacets: [], prerequisites: ['ep1-u1'], sceneKind: 'standard' },
      ],
    };
    const input = scenePlan([
      scene({ id: 's1-test', episodeNumber: 1, order: 0, spineUnitId: 'ep1-u1', dramaticPurpose: 'Testing Kylie' }),
      scene({
        id: 's1-bond', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u2',
        dramaticPurpose: 'The three form the Dusk Club.', npcsInvolved: ['Stela', 'Mika'],
      }),
    ], { 1: spine });

    const compiled = compileAndApplyNarrativeContracts(plan([1]), input);
    expect(compiled.scenes.map((item) => item.id)).toEqual(['s1-bond']);
    expect(compiled.episodeSpines?.[1].units.map((unit) => unit.id)).toEqual(['ep1-u2']);
    expect(compiled.scenes[0].behavioralIntents).toEqual([expect.objectContaining({
      kind: 'behavioral_intent', intentKind: 'social_test',
    })]);
    const socialTestAtom = compiled.narrativeContractGraph?.realizationTasks
      ?.flatMap((task) => task.evidenceAtoms)
      .find((atom) => atom.description.includes('authored social test'));
    expect(socialTestAtom?.acceptedPatterns).toEqual(expect.arrayContaining([
      'Stela tests you',
      'Stela questions you',
      'Mika probes you',
      'Mika asks you',
    ]));
    expect(compiled.narrativeContractGraph?.events.some((event) => event.sourceText === 'Testing Kylie')).toBe(false);
    expect(compiled.narrativeContractGraph?.validation.issues.some((issue) =>
      issue.code === 'legacy_abstract_test_folded_into_dependent_event'
    )).toBe(true);
  });

  it('binds spine events to the scene that carries the authored turn, not the positional spine slot', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u1', order: 0, text: 'Kylie arrives in Bucharest.', kind: 'arrival', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u2', order: 1, text: 'She explores the streets of Bucharest.', kind: 'explore', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u3', order: 2, text: 'She wanders into the bookshop.', kind: 'meet', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({
        id: 's1-1', episodeNumber: 1, order: 0, spineUnitId: 'ep1-u1',
        dramaticPurpose: 'Kylie arrives in Bucharest.',
        requiredBeats: [
          { id: 'arrival', sourceTurn: 'arrival', mustDepict: 'Kylie arrives in Bucharest.', tier: 'authored' },
          { id: 'explore', sourceTurn: 'explore', mustDepict: 'She explores the streets of Bucharest.', tier: 'authored' },
        ],
      }),
      scene({
        id: 's1-2', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u2',
        dramaticPurpose: 'She wanders into the bookshop.',
        requiredBeats: [{ id: 'bookshop', sourceTurn: 'bookshop', mustDepict: 'She wanders into the bookshop.', tier: 'authored' }],
      }),
      scene({ id: 's1-3', episodeNumber: 1, order: 2, spineUnitId: 'ep1-u3', dramaticPurpose: 'Testing Kylie.' }),
    ];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    expect(graph.events.filter((event) => event.episodeNumber === 1).map((event) => [event.id, event.ownerSceneId])).toEqual([
      ['event:ep1-u1', 's1-1'],
      ['event:ep1-u2', 's1-2'],
      ['event:ep1-u3', 's1-3'],
    ]);
    const plans = applyEpisodeEventPlans(graph, scenes);
    expect(plans[1].sceneContexts.find((context) => context.sceneId === 's1-1')?.ownedEventIds).toEqual(['event:ep1-u1']);
  });

  it('repairs a referenced destination mistaken for the staged event location', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1, sourceHash: 'ep1', episodeStoryCircleBeats: ['you'], polarityFacets: [],
      units: [
        { id: 'ep1-u2', order: 1, text: 'Kylie explores the streets of Bucharest.', kind: 'explore', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u3', order: 2, text: 'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.', kind: 'meet', storyCircleFacets: [], prerequisites: ['ep1-u2'], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({ id: 's1-2', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u2', locations: ['Lumina Books'], dramaticPurpose: 'Kylie explores Bucharest.' }),
      scene({ id: 's1-3', episodeNumber: 1, order: 2, spineUnitId: 'ep1-u3', locations: ['Valescu Club'], dramaticPurpose: spine.units[1].text }),
    ];

    const compiled = compileAndApplyNarrativeContracts(plan([1]), scenePlan(scenes, { 1: spine }));
    expect(compiled.scenes.find((candidate) => candidate.id === 's1-2')?.locations).toEqual(['Bucharest streets']);
    expect(compiled.scenes.find((candidate) => candidate.id === 's1-3')?.locations).toEqual(['Lumina Books']);
    expect(compiled.narrativeContractGraph?.validation.issues).toContainEqual(expect.objectContaining({
      code: 'scene_location_repaired_from_bound_event',
      sceneId: 's1-2',
      severity: 'warning',
    }));
    expect(compiled.narrativeContractGraph?.validation.issues).toContainEqual(expect.objectContaining({
      code: 'scene_location_repaired_from_reference',
      sceneId: 's1-3',
      severity: 'warning',
    }));
    expect(compiled.episodeEventPlans?.[1].validation.passed).toBe(true);
  });

  it('blocks an event whose staged location remains incompatible with its owner scene', () => {
    const scenes = [scene({
      id: 's1', episodeNumber: 1, order: 0, locations: ['Rooftop Bar'],
      dramaticPurpose: 'Kylie enters Lumina Books and finds the hidden ledger.',
    })];
    // Include the canonical location in the season catalog without making it
    // the owner scene or a referenced destination eligible for auto-repair.
    const locationCatalog = scene({ id: 's2', episodeNumber: 2, order: 0, locations: ['Lumina Books'], dramaticPurpose: 'Later aftermath.' });
    const graph = compileNarrativeContractGraph(plan([1, 2]), scenePlan([...scenes, locationCatalog]));
    const eventPlan = compileEpisodeEventPlan(graph, scenes, 1);
    expect(eventPlan.validation.passed).toBe(false);
    expect(eventPlan.validation.issues).toContainEqual(expect.objectContaining({
      code: 'scene_location_event_mismatch',
      sceneId: 's1',
    }));
  });

  it('allows an authored event to move through a prerequisite-ordered location sequence', () => {
    const scenes = [scene({
      id: 'rescue', episodeNumber: 1, order: 0, locations: ['Cismigiu Gardens'],
      dramaticPurpose: 'Kylie is attacked in Cismigiu, rescued, and walked home.',
    })];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes));
    const event = graph.events[0];
    event.realizationAtoms = [
      {
        id: 'attack', description: 'Kylie is attacked in Cismigiu.', acceptedPatterns: ['attacked'],
        kind: 'semantic', verificationAuthority: 'semantic_judge', semanticCriteria: ['Kylie is attacked.'],
        semanticRole: 'action', prerequisiteAtomIds: [], stagedLocation: 'Cismigiu Gardens', required: true,
      },
      {
        id: 'rescue', description: 'A stranger rescues Kylie.', acceptedPatterns: ['rescues'],
        kind: 'semantic', verificationAuthority: 'semantic_judge', semanticCriteria: ['A stranger saves Kylie.'],
        semanticRole: 'action', prerequisiteAtomIds: ['attack'], stagedLocation: 'Cismigiu Gardens', required: true,
      },
      {
        id: 'walk-home', description: 'The stranger walks Kylie home.', acceptedPatterns: ['walks her home'],
        kind: 'semantic', verificationAuthority: 'semantic_judge', semanticCriteria: ['The stranger escorts Kylie home.'],
        semanticRole: 'action', prerequisiteAtomIds: ['rescue'], stagedLocation: 'Bucharest streets', required: true,
      },
    ];

    const eventPlan = compileEpisodeEventPlan(graph, scenes, 1);
    expect(eventPlan.validation.passed).toBe(true);
    expect(eventPlan.validation.issues).toContainEqual(expect.objectContaining({
      code: 'event_sequential_location_transition',
      severity: 'warning',
      sceneId: 'rescue',
    }));
  });

  it('still blocks unrelated action staged at multiple locations', () => {
    const scenes = [scene({
      id: 'split-action', episodeNumber: 1, order: 0, locations: ['Cismigiu Gardens'],
      dramaticPurpose: 'Kylie is attacked while Victor opens a ledger elsewhere.',
    })];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes));
    const event = graph.events[0];
    event.realizationAtoms = [
      {
        id: 'attack', description: 'Kylie is attacked in Cismigiu.', acceptedPatterns: ['attacked'],
        kind: 'semantic', verificationAuthority: 'semantic_judge', semanticCriteria: ['Kylie is attacked.'],
        semanticRole: 'action', prerequisiteAtomIds: [], stagedLocation: 'Cismigiu Gardens', required: true,
      },
      {
        id: 'ledger', description: 'Victor opens a ledger.', acceptedPatterns: ['opens a ledger'],
        kind: 'semantic', verificationAuthority: 'semantic_judge', semanticCriteria: ['Victor opens a ledger.'],
        semanticRole: 'action', prerequisiteAtomIds: ['attack'], stagedLocation: 'Lipscani Apartment', required: true,
      },
    ];

    const eventPlan = compileEpisodeEventPlan(graph, scenes, 1);
    expect(eventPlan.validation.passed).toBe(false);
    expect(eventPlan.validation.issues).toContainEqual(expect.objectContaining({
      code: 'event_multiple_staged_locations',
      severity: 'error',
      sceneId: 'split-action',
    }));
  });

  it('defers future episode executability without weakening the selected episode gate', () => {
    const scenes = [
      scene({ id: 's1', episodeNumber: 1, order: 0, locations: ['Bucharest'], dramaticPurpose: 'Kylie arrives in Bucharest.' }),
      scene({ id: 's6', episodeNumber: 6, order: 0, locations: ['Casa Lupului'], dramaticPurpose: 'Kylie returns to the Lipscani Apartment.' }),
      scene({ id: 's7', episodeNumber: 7, order: 0, locations: ['Lipscani Apartment'], dramaticPurpose: 'Later aftermath.' }),
    ];
    const compiled = compileAndApplyNarrativeContracts(plan([1, 6, 7]), scenePlan(scenes));

    expect(compiled.episodeEventPlans?.[6].validation.passed).toBe(false);
    expect(() => assertSelectedEpisodeEventPlansExecutable(compiled, [1])).not.toThrow();
    expect(() => assertSelectedEpisodeEventPlansExecutable(compiled, [6])).toThrow(/EpisodeEventPlanGate/);
  });

  it('keeps independent authored beats as separate events and rebinds by staged location', () => {
    const scenes = [
      scene({
        id: 'enc-6-wolf-at-the-door', episodeNumber: 6, order: 1, kind: 'encounter', locations: ['Casa Lupului'],
        dramaticPurpose: 'At Casa Lupului, Radu confesses he is a pricolici.',
        requiredBeats: [{
          id: 'ep6-black-rose', sourceTurn: 'Kylie returns home and finds a black rose inside the Lipscani Apartment.',
          mustDepict: 'Kylie returns home and finds a black rose inside the Lipscani Apartment.', tier: 'authored', contractKind: 'depiction',
        }],
      }),
      scene({
        id: 's6-apartment', episodeNumber: 6, order: 5, locations: ['Lipscani Apartment'],
        dramaticPurpose: 'Kylie returns to the Lipscani Apartment.',
      }),
    ];

    const graph = compileNarrativeContractGraph(plan([6]), scenePlan(scenes));
    const eventPlan = compileEpisodeEventPlan(graph, scenes, 6);
    const confession = graph.events.find((event) => /Radu confesses/i.test(event.sourceText));
    const rose = graph.events.find((event) => /black rose/i.test(event.sourceText));

    expect(confession?.ownerSceneId).toBe('enc-6-wolf-at-the-door');
    expect(rose?.id).not.toBe(confession?.id);
    expect(rose?.ownerSceneId).toBe('s6-apartment');
    expect(eventPlan.validation.passed).toBe(true);
    expect(graph.validation.issues).toContainEqual(expect.objectContaining({
      code: 'event_owner_rebound_to_staged_location',
      sceneId: 's6-apartment',
    }));
  });

  it('does not let an exact prose match move an explicitly bound spine event', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u1', order: 0, text: 'The authored turn.', kind: 'meet', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({ id: 'bound', episodeNumber: 1, order: 0, spineUnitId: 'ep1-u1', dramaticPurpose: 'Different connective tissue.' }),
      scene({ id: 'prose-match', episodeNumber: 1, order: 1, dramaticPurpose: 'The authored turn.' }),
    ];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    expect(graph.events.find((event) => event.id === 'event:ep1-u1')?.ownerSceneId).toBe('bound');
  });

  it('does not promote a question-shaped pressure shell to a depiction event when an ESC exists', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1, sourceHash: 'ep1', episodeStoryCircleBeats: ['you'], polarityFacets: [],
      units: [{ id: 'ep1-u1', order: 0, text: 'Kylie arrives in Bucharest.', kind: 'arrival', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' }],
    };
    const scenes = [
      scene({ id: 's1-1', episodeNumber: 1, order: 0, spineUnitId: 'ep1-u1', dramaticPurpose: 'Kylie arrives in Bucharest.' }),
      scene({ id: 's1-pressure', episodeNumber: 1, order: 1, dramaticPurpose: 'Can Kylie be known without being consumed?', turnContract: { turnId: 'pressure', source: 'choice', centralTurn: 'Can Kylie be known without being consumed?', beforeState: '', turnEvent: 'Can Kylie be known without being consumed?', afterState: '', handoff: '' } }),
    ];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    const pressure = graph.events.find((event) => event.sourceText.includes('Can Kylie'));
    expect(pressure?.realizationMode).toBe('context_only');
    expect(pressure?.ownerSceneId).toBeUndefined();
  });

  it('collapses a planner pressure shell that has no canonical event owner', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'ep1',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        { id: 'ep1-u1', order: 0, text: 'Kylie arrives in Bucharest.', kind: 'arrival', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u2', order: 1, text: 'She explores the streets of Bucharest.', kind: 'explore', storyCircleFacets: [], prerequisites: ['ep1-u1'], sceneKind: 'standard' },
        { id: 'ep1-u3', order: 2, text: 'She meets Stela in the bookshop.', kind: 'meet', storyCircleFacets: [], prerequisites: ['ep1-u2'], sceneKind: 'standard' },
        { id: 'ep1-u4', order: 3, text: 'The three form the Dusk Club.', kind: 'bond', storyCircleFacets: [], prerequisites: ['ep1-u3'], sceneKind: 'standard' },
        { id: 'ep1-u5', order: 4, text: 'At a rooftop bar Kylie catches the attention of a man in a charcoal suit.', kind: 'meet', storyCircleFacets: [], prerequisites: ['ep1-u4'], sceneKind: 'standard' },
        { id: 'ep1-u6', order: 5, text: 'At the rooftop bar Kylie catches the attention of the man in the charcoal suit.', kind: 'meet', storyCircleFacets: [], prerequisites: ['ep1-u5'], sceneKind: 'standard' },
        { id: 'ep1-u7', order: 6, text: 'At 4am Kylie writes the first Dating After Dusk post.', kind: 'late_night_writing', storyCircleFacets: [], prerequisites: ['ep1-u6'], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({ id: 's1-1', episodeNumber: 1, order: 0, spineUnitId: 'ep1-u1', dramaticPurpose: 'Kylie arrives in Bucharest.' }),
      scene({ id: 's1-2', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u2', dramaticPurpose: 'She explores the streets of Bucharest.' }),
      scene({ id: 's1-3', episodeNumber: 1, order: 2, spineUnitId: 'ep1-u3', dramaticPurpose: 'She meets Stela in the bookshop.' }),
      scene({ id: 's1-4', episodeNumber: 1, order: 3, spineUnitId: 'ep1-u4', dramaticPurpose: 'The three form the Dusk Club.' }),
      scene({ id: 's1-5', episodeNumber: 1, order: 4, spineUnitId: 'ep1-u5', dramaticPurpose: 'At a rooftop bar Kylie catches the attention of a man in a charcoal suit.' }),
      scene({
        id: 's1-pressure',
        episodeNumber: 1,
        order: 5,
        spineUnitId: 'ep1-u6',
        dramaticPurpose: 'The player-facing choice changes the scene pressure: Can Kylie start over and write under her own name?',
        turnContract: {
          turnId: 'pressure-turn',
          source: 'treatment',
          centralTurn: 'The player-facing choice changes the scene pressure: Can Kylie start over and write under her own name?',
          beforeState: '', turnEvent: 'The player-facing choice changes the scene pressure.', afterState: '', handoff: '',
        },
      }),
      scene({ id: 's1-7', episodeNumber: 1, order: 6, spineUnitId: 'ep1-u7', dramaticPurpose: 'At 4am Kylie writes the first Dating After Dusk post.' }),
    ];
    const compiled = compileAndApplyNarrativeContracts(plan([1]), scenePlan(scenes, { 1: spine }));

    expect(compiled.scenes.map((item) => item.id)).toEqual(['s1-1', 's1-2', 's1-3', 's1-4', 's1-5', 's1-7']);
    expect(compiled.episodeEventPlans?.[1].assignments.find((assignment) => assignment.eventId === 'event:ep1-u5')?.sceneId).toBe('s1-5');
    expect(compiled.episodeEventPlans?.[1].assignments.find((assignment) => assignment.eventId === 'event:ep1-u6')?.sceneId).toBe('s1-5');
  });

  it('is deterministic and isolated for seasons from one through twelve episodes', () => {
    for (let count = 1; count <= 12; count += 1) {
      const scenes = Array.from({ length: count }, (_, index) => scene({
        id: `ep${index + 1}-event`, episodeNumber: index + 1, order: 0,
        dramaticPurpose: `Episode ${index + 1} changes the situation.`,
        requiredBeats: [{ id: `beat-${index + 1}`, sourceTurn: 'turn', mustDepict: `Episode ${index + 1} changes the situation.`, tier: 'authored' }],
      }));
      const input = scenePlan(scenes);
      const first = compileNarrativeContractGraph(plan(Array.from({ length: count }, (_, index) => index + 1)), input);
      const second = compileNarrativeContractGraph(plan(Array.from({ length: count }, (_, index) => index + 1)), input);
      expect(first.sourceHash).toBe(second.sourceHash);
      for (let episode = 1; episode <= count; episode += 1) {
        const eventPlan = compileEpisodeEventPlan(first, scenes.filter((item) => item.episodeNumber === episode), episode);
        expect(eventPlan.validation.passed).toBe(true);
        expect(eventPlan.assignments.every((assignment) => assignment.sceneId.startsWith(`ep${episode}-`))).toBe(true);
      }
    }
  });

  it('rejects blueprint ownership that invents an event outside its immutable episode assignment', () => {
    const scenes = [scene({ id: 's1', episodeNumber: 1, order: 0, dramaticPurpose: 'Kylie arrives.' })];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes));
    const eventPlan = compileEpisodeEventPlan(graph, scenes, 1);
    const issues = validateCanonicalEpisodeBlueprintProjection(eventPlan, [{
      ...scenes[0],
      narrativeEventIds: ['event:not-assigned'],
      sceneEventOwnership: {
        id: 's1-ownership',
        sceneId: 's1',
        episodeNumber: 1,
        ownedEvents: [{ key: 'event:not-assigned', eventContractId: 'event:not-assigned', cue: 'arrival', text: 'invented', sourceContractIds: [] }],
        forbiddenRestageEvents: [],
        sourceContractIds: [],
        diagnostics: [],
        promptGuidance: [],
      },
    }], 1);
    expect(issues.some((issue) => issue.code === 'blueprint_event_outside_assignment')).toBe(true);
  });

  it('compiles an anonymous first-contact contract without forcing a roster name', () => {
    const planned = plan([1]);
    planned.protagonist = { id: 'char-kylie', name: 'Kylie Marinescu', description: '' };
    planned.characterIntroductions = [
      { characterId: 'char-victor', characterName: 'Victor Valcescu', introducedInEpisode: 2, role: 'love_interest' },
    ];
    const scenes = [scene({
      id: 'treatment-enc-1-1', episodeNumber: 1, order: 0, kind: 'encounter',
      npcsInvolved: ['char-victor'],
      dramaticPurpose: 'A man in a charcoal suit intervenes in the park.',
      encounter: { type: 'dramatic', difficulty: 'moderate', relevantSkills: [], isBranchPoint: true, description: 'A stranger in a charcoal suit intervenes.' },
    })];
    const graph = compileNarrativeContractGraph(planned, scenePlan(scenes));
    const contract = graph.characterPresenceContracts[0];
    expect(contract.mode).toBe('anonymous_plant');
    expect(contract.readerNameAllowed).toBe(false);
    expect(contract.forbiddenEvidence).toContain('Victor Valcescu');
    expect(compileEpisodeEventPlan(graph, scenes, 1).characterPresenceContracts).toHaveLength(1);
  });

  it('projects a named introduction to the canonical event that names the character, not an earlier stale cast hint', () => {
    const planned = plan([1]);
    planned.protagonist = { id: 'char-kylie', name: 'Kylie Marinescu', description: '' };
    planned.characterIntroductions = [
      { characterId: 'char-stela', characterName: 'Stela Pavel', introducedInEpisode: 1, role: 'ally' },
    ];
    const spine: EpisodeSpineContract = {
      episodeNumber: 1, sourceHash: 'ep1', episodeStoryCircleBeats: ['you'], polarityFacets: [],
      units: [
        { id: 'ep1-u2', order: 1, text: 'Kylie explores the streets of Bucharest.', kind: 'explore', storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' },
        { id: 'ep1-u3', order: 2, text: 'Kylie enters a bookshop and meets Stela Pavel.', kind: 'meet', storyCircleFacets: [], prerequisites: ['ep1-u2'], sceneKind: 'standard' },
      ],
    };
    const scenes = [
      scene({ id: 's1-2', episodeNumber: 1, order: 1, spineUnitId: 'ep1-u2', dramaticPurpose: 'Kylie explores Bucharest.', npcsInvolved: ['char-stela'] }),
      scene({ id: 's1-3', episodeNumber: 1, order: 2, spineUnitId: 'ep1-u3', dramaticPurpose: 'Kylie meets Stela Pavel.', npcsInvolved: ['char-stela'] }),
    ];

    const graph = compileNarrativeContractGraph(planned, scenePlan(scenes, { 1: spine }));
    expect(graph.characterPresenceContracts.find((contract) => contract.characterId === 'char-stela')?.sceneId).toBe('s1-3');
    expect(graph.realizationTasks?.some((task) => task.id === 'task:presence:ep1:s1-3:char-stela:named-introduction')).toBe(true);
  });

  it('compiles premise, canonical state, downstream seed, and transition projections together', () => {
    const planned = plan([1, 2]);
    planned.protagonist = { id: 'protagonist', name: 'Avery', description: '' };
    planned.characterTreatmentContracts = [{
      id: 'character-role', source: 'treatment', subject: 'protagonist', characterId: 'protagonist', characterName: 'Avery',
      fieldName: 'Role in the world', sourceText: 'A food writer from New York starts over.', contractKind: 'role_fact',
      requiredRealization: ['scene_turn', 'final_prose'], targetEpisodeNumbers: [1], targetSceneIds: [], targetEndingIds: [], blockingLevel: 'treatment',
    }];
    planned.seasonFlags = [{ flag: 'trusted_contact', description: 'Contact remembers the first confidence.', setInEpisode: 1, checkedInEpisodes: [2] }];
    planned.residuePlan = [{
      id: 'residue-trust', source: 'treatment_guidance', sourceEpisodeNumber: 1, choiceAnchor: 'Trust the contact early.', flag: 'trusted_contact',
      kind: 'relationship_behavior', consequenceDomain: 'relationship', payoffPolicy: 'specific_episode', targetEpisodeNumbers: [2], targetSceneIds: ['ep2-payoff'],
      sourceMaterial: { reminderLater: 'The contact remembers that trust.' }, authoringGuidance: 'Carry the trust into the later meeting.', requiredSurface: ['beat_text'], priority: 'major',
    }];
    const scenes = [
      scene({ id: 'ep1-opening', episodeNumber: 1, order: 0, locations: ['bookshop'], timeOfDay: 'afternoon', dramaticPurpose: 'Avery arrives and starts over.', continuityStates: [{ id: 'luggage-arrives', subject: 'luggage', disposition: 'with Avery', requiredEvidence: ['luggage'] }] }),
      scene({ id: 'ep1-night', episodeNumber: 1, order: 1, locations: ['rooftop bar'], timeOfDay: 'night', timeJump: 'later that night', dramaticPurpose: 'Avery makes the choice.' }),
      scene({ id: 'ep2-payoff', episodeNumber: 2, order: 0, locations: ['bookshop'], timeOfDay: 'morning', dramaticPurpose: 'The contact remembers the trust.' }),
    ];
    const canonical = compileNarrativeContractGraph(planned, scenePlan(scenes));
    const rolePremise = canonical.premiseContracts?.find((contract) => contract.fieldName === 'Role in the world');
    expect(rolePremise).toBeDefined();
    expect(rolePremise?.evidenceAtoms?.length).toBeGreaterThan(0);
    expect(rolePremise?.minimumEvidenceHits).toBeGreaterThanOrEqual(1);
    expect(canonical.stateContracts?.map((contract) => contract.canonicalStateId)).toContain('trusted_contact');
    expect(canonical.seedContracts?.map((contract) => contract.id)).toContain('seed:residue-trust');
    expect(canonical.transitionContracts?.find((contract) => contract.toSceneId === 'ep1-night')).toMatchObject({
      bridgePolicy: 'orientation_only',
      locationRequirement: { canonicalValue: 'rooftop bar', required: true },
      timeRequirement: { canonicalValue: 'night', required: true },
    });
    expect(canonical.sourceHash).toBe(compileNarrativeContractGraph(planned, scenePlan(scenes)).sourceHash);
  });

  it('keeps canonical identity in metadata and distributes prose premises across the first two scenes', () => {
    const planned = plan([1]);
    planned.protagonist = { id: 'protagonist', name: 'Avery', description: '' };
    planned.characterTreatmentContracts = [
      ['identity', 'Name and pronouns', 'Avery Chen uses she/her pronouns.', 'canonical_identity'],
      ['role', 'Role in the world', 'Avery is a food writer starting over.', 'role_fact'],
      ['wound', 'Defining wound', 'Avery still carries the humiliation of a public cancellation.', 'wound_pressure'],
      ['starting-identity', 'Starting identity', 'Avery keeps herself small when attention turns toward her.', 'starting_identity'],
    ].map(([id, fieldName, sourceText, contractKind]) => ({
      id: `character-${id}`,
      source: 'treatment' as const,
      subject: 'protagonist' as const,
      characterId: 'protagonist',
      characterName: 'Avery',
      fieldName,
      sourceText,
      contractKind: contractKind as 'canonical_identity' | 'role_fact' | 'wound_pressure' | 'starting_identity',
      requiredRealization: ['scene_turn', 'final_prose'] as Array<'scene_turn' | 'final_prose'>,
      targetEpisodeNumbers: [1],
      targetSceneIds: ['ep1-opening'],
      targetEndingIds: [],
      blockingLevel: 'treatment' as const,
    }));
    const scenes = [
      scene({ id: 'ep1-opening', episodeNumber: 1, order: 0 }),
      scene({ id: 'ep1-followup', episodeNumber: 1, order: 1 }),
    ];

    const graph = compileNarrativeContractGraph(planned, scenePlan(scenes));
    const targets = (graph.premiseContracts ?? []).map((contract) => contract.targetSceneIds[0]);
    const load = targets.reduce<Record<string, number>>((counts, sceneId) => {
      counts[sceneId] = (counts[sceneId] ?? 0) + 1;
      return counts;
    }, {});

    expect(new Set(targets)).toEqual(new Set(['ep1-opening', 'ep1-followup']));
    expect(load).toEqual({ 'ep1-opening': 2, 'ep1-followup': 1 });
    expect(graph.premiseContracts?.some((contract) => contract.fieldKind === 'canonical_identity')).toBe(false);
    expect(graph.realizationTasks?.filter((task) => task.sourceKinds?.includes('premise'))).toHaveLength(3);
  });

  it('splits independently required compound premise meanings across opening scene owners', () => {
    const planned = plan([1]);
    const sourceText = "Her cancelled engagement left her publicly humiliated, and her grandmother's unexplained escape left her family history unresolved.";
    planned.characterTreatmentContracts = [{
      id: 'character-wound', source: 'treatment', subject: 'protagonist', characterId: 'protagonist',
      characterName: 'Avery', fieldName: 'Defining wound', sourceText, contractKind: 'wound_pressure',
      requiredRealization: ['scene_turn', 'final_prose'], targetEpisodeNumbers: [1], targetSceneIds: [],
      targetEndingIds: [], blockingLevel: 'treatment',
    }];
    const scenes = [
      scene({ id: 'ep1-opening', episodeNumber: 1, order: 0 }),
      scene({ id: 'ep1-followup', episodeNumber: 1, order: 1 }),
    ];
    const bootstrapPlan = scenePlan(scenes);
    const bootstrapGraph = compileNarrativeContractGraph(planned, bootstrapPlan);
    const eventSeeds = semanticContractEventSeeds(bootstrapGraph);
    const premiseSeeds = semanticContractPremiseSeeds(bootstrapGraph);
    const premiseId = premiseSeeds[0].premiseId;
    const semanticEventIr: AuthoredEventSemanticIR = {
      version: 1, policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION, provider: 'gemini', model: 'gemini-test',
      sourceHash: semanticContractSourceHash(eventSeeds),
      events: eventSeeds.map((event) => ({
        ...event,
        propositions: event.sources.map((source, index) => ({
          id: `${event.eventId}:semantic:${index + 1}`, sourceId: source.id, sourceSpan: source.text,
          proposition: source.text, semanticRole: 'action' as const, participantIds: [],
          semanticCriteria: ['The authored event occurs'], prerequisitePropositionIds: [],
          referencedLocations: [], required: true,
        })),
      })),
      premiseSourceHash: semanticContractPremiseSourceHash(premiseSeeds),
      premises: [{
        premiseId, sourceText, minimumEvidenceHits: 2,
        propositions: [
          {
            id: `${premiseId}:semantic:1`, sourceSpan: 'Her cancelled engagement left her publicly humiliated',
            proposition: 'The protagonist carries public humiliation from her cancelled engagement.',
            semanticCriteria: ['The cancelled engagement caused public humiliation'], verificationAuthority: 'semantic_judge', required: true,
          },
          {
            id: `${premiseId}:semantic:2`, sourceSpan: "her grandmother's unexplained escape left her family history unresolved",
            proposition: "The protagonist lacks closure about her grandmother's escape and family history.",
            semanticCriteria: ['The grandmother mystery leaves family history unresolved'], verificationAuthority: 'semantic_judge', required: true,
          },
        ],
      }],
    };

    const graph = compileNarrativeContractGraph(planned, { ...bootstrapPlan, semanticEventIr });
    const premise = graph.premiseContracts?.[0];
    const tasks = graph.realizationTasks?.filter((task) => task.contractId === premiseId) ?? [];

    expect(graph.validation.passed).toBe(true);
    expect(new Set(premise?.targetSceneIds)).toEqual(new Set(['ep1-opening', 'ep1-followup']));
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.sceneId))).toEqual(new Set(['ep1-opening', 'ep1-followup']));
    expect(tasks.every((task) => task.evidenceAtoms.length === 1 && task.minimumEvidenceHits === 1)).toBe(true);
  });

  it('rejects a semantically compiled scene that exceeds the blocking premise claim budget', () => {
    const planned = plan([1]);
    planned.protagonist = { id: 'protagonist', name: 'Avery', description: '' };
    planned.characterTreatmentContracts = [
      ['identity', 'Name and pronouns', 'Avery Chen uses she and her pronouns.', 'canonical_identity'],
      ['role', 'Role in the world', 'Avery is a food writer starting over.', 'role_fact'],
      ['wound', 'Defining wound', 'Avery carries the humiliation of a public cancellation.', 'wound_pressure'],
      ['starting-identity', 'Starting identity', 'Avery keeps herself small when attention turns toward her.', 'starting_identity'],
    ].map(([id, fieldName, sourceText, contractKind]) => ({
      id: `character-${id}`, source: 'treatment' as const, subject: 'protagonist' as const,
      characterId: 'protagonist', characterName: 'Avery', fieldName, sourceText,
      contractKind: contractKind as 'canonical_identity' | 'role_fact' | 'wound_pressure' | 'starting_identity',
      requiredRealization: ['scene_turn', 'final_prose'] as Array<'scene_turn' | 'final_prose'>,
      targetEpisodeNumbers: [1], targetSceneIds: ['ep1-opening'], targetEndingIds: [], blockingLevel: 'treatment' as const,
    }));
    const scenes = [scene({ id: 'ep1-opening', episodeNumber: 1, order: 0 })];
    const bootstrapPlan = scenePlan(scenes);
    const bootstrapGraph = compileNarrativeContractGraph(planned, bootstrapPlan);
    const eventSeeds = semanticContractEventSeeds(bootstrapGraph);
    const premiseSeeds = semanticContractPremiseSeeds(bootstrapGraph);
    const semanticEventIr: AuthoredEventSemanticIR = {
      version: 1,
      policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION,
      provider: 'gemini',
      model: 'gemini-test',
      sourceHash: semanticContractSourceHash(eventSeeds),
      events: eventSeeds.map((event) => ({
        ...event,
        propositions: event.sources.map((source, index) => ({
          id: `${event.eventId}:semantic:${index + 1}`,
          sourceId: source.id,
          sourceSpan: source.text,
          proposition: source.text,
          semanticRole: 'action' as const,
          participantIds: [],
          semanticCriteria: ['The authored scene event occurs'],
          prerequisitePropositionIds: [],
          referencedLocations: [],
          required: true,
        })),
      })),
      premiseSourceHash: semanticContractPremiseSourceHash(premiseSeeds),
      premises: premiseSeeds.map((premise) => ({
        premiseId: premise.premiseId,
        sourceText: premise.sourceText,
        minimumEvidenceHits: 1,
        propositions: Array.from({ length: 5 }, (_, index) => ({
          id: `${premise.premiseId}:semantic:${index + 1}`,
          sourceSpan: premise.sourceText,
          proposition: `${premise.sourceText} This is proposition ${index + 1}.`,
          semanticCriteria: ['The complete authored premise is established'],
          verificationAuthority: 'semantic_judge' as const,
          required: true,
        })),
      })),
    };

    const graph = compileNarrativeContractGraph(planned, { ...bootstrapPlan, semanticEventIr });

    expect(graph.validation.passed).toBe(false);
    expect(graph.validation.issues).toContainEqual(expect.objectContaining({
      code: 'semantic_premise_capacity_exceeded',
      sceneId: 'ep1-opening',
    }));
  });

  it('compiles explicit continuity-state changes into the receiving transition', () => {
    const planned = plan([1]);
    const scenes = [
      scene({
        id: 's1', episodeNumber: 1, order: 0, locations: ['station'],
        continuityStates: [{ id: 'bag-start', subject: 'luggage', disposition: 'left at station', requiredEvidence: ['luggage'] }],
      }),
      scene({
        id: 's2', episodeNumber: 1, order: 1, locations: ['apartment'],
        continuityStates: [{ id: 'bag-end', subject: 'luggage', disposition: 'inside the apartment', requiredEvidence: ['luggage', 'inside'] }],
      }),
    ];

    const transition = compileNarrativeContractGraph(planned, scenePlan(scenes)).transitionContracts?.[0];
    expect(transition?.stateContracts).toEqual([expect.objectContaining({
      subject: 'luggage',
      fromDisposition: 'left at station',
      toDisposition: 'inside the apartment',
      blocking: true,
    })]);
    expect(transition?.blocking).toBe(true);
  });

  it('projects legacy setup/payoff edges from canonical pays_off dependencies', () => {
    const graph = {
      events: [
        { id: 'event:setup', episodeNumber: 1, ownerSceneId: 's1' },
        { id: 'event:payoff', episodeNumber: 3, ownerSceneId: 's3' },
      ],
      dependencies: [{
        id: 'dep:setup-payoff', fromEventId: 'event:setup', toEventId: 'event:payoff',
        relation: 'pays_off', sourceEpisodeNumber: 1, targetEpisodeNumbers: [3],
        targetSceneIds: ['s3'], branchConditionKeys: [], requiredSurfaces: ['final_prose'],
        priority: 'major', sourceContractIds: [], description: 'The later reveal pays off the planted clue.',
      }],
    } as any;
    expect(projectSetupPayoffEdgesFromGraph(graph, [
      scene({ id: 's1', episodeNumber: 1, order: 0 }),
      scene({ id: 's3', episodeNumber: 3, order: 0 }),
    ])).toEqual([{
      from: 's1', to: 's3', span: 'cross_episode',
      description: 'The later reveal pays off the planted clue.',
    }]);
  });
});
