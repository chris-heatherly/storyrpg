import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { EpisodeSpineContract } from '../../types/episodeSpine';
import {
  applyEpisodeEventPlans,
  compileAndApplyNarrativeContracts,
  compileEpisodeEventPlan,
  compileNarrativeContractGraph,
  validateCanonicalEpisodeBlueprintProjection,
} from './narrativeContractCompiler';

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

    expect(compiled.scenes.find((candidate) => candidate.id === 's1-4')?.relationshipPacing).toEqual([]);
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
      scene({ id: 's1-late-night-writing', episodeNumber: 1, order: 6, dramaticPurpose: 'At 4am she writes the post.', planningOrigin: { kind: 'binder_split', splitKind: 'late_night_writing', parentSceneId: 's1-7', reason: 'split' } }),
      scene({ id: 'treatment-enc-1-1', episodeNumber: 1, order: 7, kind: 'encounter', spineUnitId: 'ep1-u7', dramaticPurpose: 'Kylie is attacked and Victor rescues her.' }),
      scene({ id: 's1-7', episodeNumber: 1, order: 8, spineUnitId: 'ep1-u8', dramaticPurpose: 'At 4am she writes the post, and by evening it has gone viral.' }),
    ];
    const graph = compileNarrativeContractGraph(plan([1]), scenePlan(scenes, { 1: spine }));
    const plans = applyEpisodeEventPlans(graph, scenes);

    expect(plans[1].sceneOrder).toEqual(['treatment-enc-1-1', 's1-late-night-writing', 's1-7']);
    expect(scenes.map((item) => item.id)).toEqual(['treatment-enc-1-1', 's1-late-night-writing', 's1-7']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting', 'blogAftermath']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents[1]?.text).toMatch(/^By evening/i);
    expect(new Set(plans[1].orderedEventIds).size).toBe(plans[1].orderedEventIds.length);
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
    expect(canonical.transitionContracts?.some((contract) => contract.toSceneId === 'ep1-night')).toBe(true);
    expect(canonical.sourceHash).toBe(compileNarrativeContractGraph(planned, scenePlan(scenes)).sourceHash);
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
});
