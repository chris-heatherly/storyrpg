import { describe, expect, it } from 'vitest';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import { assertNoContradictoryLiteralEvidence, assertNoContradictorySemanticLiteralEvidence, compileNarrativeRealizationTasks } from './realizationTaskCompiler';

describe('compileNarrativeRealizationTasks', () => {
  it('compiles premise, route, and relationship obligations with owning stages', () => {
    const graph = {
      premiseContracts: [{
        id: 'premise:wound', episodeNumber: 1, fieldName: 'Wound', fieldKind: 'wound_pressure',
        sourceText: 'The cancelled engagement left her humiliated.', evidencePatterns: ['cancelled engagement', 'humiliated'],
        minimumEvidenceHits: 2, targetSceneIds: ['s1-1'], requiredSurface: ['beat_text'], sourceContractIds: ['treatment:wound'],
        blocking: true, provenance: { source: 'treatment', confidence: 'authoritative' },
      }],
      events: [{
        id: 'event:ep1-u7', episodeNumber: 1, sourceOrder: 1, sourceText: 'She is attacked and rescued before the stranger vanishes.',
        sourceContractIds: ['treatment:encounter'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
        prerequisiteEventIds: [], targetSceneIds: ['enc-1'], targetSpineUnitIds: [], ownerSceneId: 'enc-1', cue: 'threatEncounter',
        evidenceRequirements: [
          { id: 'event:ep1-u7:rescue', eventId: 'event:ep1-u7', kind: 'action', acceptedPatterns: ['rescued', 'saved'], requiredSurface: 'all_routes', routeEvidencePosition: 'path', blocking: true },
          { id: 'event:ep1-u7:threshold-disappearance', eventId: 'event:ep1-u7', kind: 'action', acceptedPatterns: ['vanishes'], requiredSurface: 'all_routes', routeEvidencePosition: 'terminal', blocking: true },
        ], requiredOutcomeTiers: ['victory'], provenance: { source: 'treatment_contract', confidence: 'authoritative' },
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard', relationshipPacing: [] },
      { id: 'enc-1', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {}, relationshipPacing: [] },
      { id: 's1-2', episodeNumber: 1, order: 2, kind: 'standard', relationshipPacing: [{
        id: 'rel:stela', source: 'treatment', startStage: 'acquaintance', targetStage: 'friend', allowedLabels: ['friend'],
        blockedLabels: ['friend'], requiredEvidence: [], minScenesSinceIntroduction: 1, maxDeltaThisScene: 1, mechanicDimensions: ['trust'],
      }] },
    ] as any;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    expect(tasks.find((task) => task.contractId === 'premise:wound')?.repairHandler).toBe('premise_realization');
    expect(tasks.find((task) => task.id === 'task:event:ep1-u7:owner-event')).toMatchObject({
      canonicalEventId: 'event:ep1-u7',
      ownerStage: 'encounter_architect',
      blocking: true,
    });
    expect(tasks.find((task) => task.id === 'task:event:ep1-u7:rescue:route:victory')?.target).toEqual({
      scope: 'route_path',
      outcomeTier: 'victory',
      surfaces: ['encounter_phase', 'encounter_outcome', 'terminal_storylet'],
    });
    expect(tasks.find((task) => task.id === 'task:event:ep1-u7:threshold-disappearance:route:victory')?.target).toEqual({
      scope: 'route_terminal',
      outcomeTier: 'victory',
      surfaces: ['encounter_phase', 'encounter_outcome', 'terminal_storylet'],
    });
    expect(tasks.find((task) => task.id === 'task:event:ep1-u7:rescue:route:victory')?.evidenceAtoms).toEqual([
      expect.objectContaining({
        id: 'event:ep1-u7:rescue:evidence:1:victory',
        acceptedPatterns: ['rescued', 'saved'],
        required: true,
      }),
    ]);
    expect(tasks.find((task) => task.contractId === 'rel:stela')?.sceneId).toBe('s1-2');
  });

  it('compiles a blocking owner task for an ordinary depiction event without specialized route evidence', () => {
    const graph = {
      events: [{
        id: 'event:ep1-writing', episodeNumber: 1, sourceOrder: 2,
        sourceText: 'Kylie writes the first post about the rescue.',
        sourceContractIds: ['treatment:writing'], realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [],
        targetSceneIds: ['s1-6'], targetSpineUnitIds: [], ownerSceneId: 's1-6',
        provenance: { source: 'treatment_contract', confidence: 'authoritative' },
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;

    const [task] = compileNarrativeRealizationTasks(graph, [{
      id: 's1-6', episodeNumber: 1, order: 0, kind: 'standard', relationshipPacing: [],
    }] as any).filter((candidate) => candidate.eventId === 'event:ep1-writing');

    expect(task).toMatchObject({
      id: 'task:event:ep1-writing:owner-event',
      contractId: 'event:ep1-writing',
      sceneId: 's1-6',
      ownerStage: 'scene_writer',
      blocking: true,
      target: { scope: 'owner', surfaces: ['beat_text', 'dialogue', 'text_variant'] },
    });
    expect(task.evidenceAtoms[0]).toMatchObject({
      acceptedPatterns: ['Kylie writes the first post about the rescue.'],
      sourceText: 'Kylie writes the first post about the rescue.',
    });
  });

  it('merges a Story Circle projection into the canonical owner task for the same event', () => {
    const eventText = 'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.';
    const graph = {
      events: [{
        id: 'event:ep1-u3', episodeNumber: 1, sourceOrder: 3, sourceText: eventText,
        sourceContractIds: ['ep1-u3', 's1-3-turn'], realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s1-3'],
        targetSpineUnitIds: [], ownerSceneId: 's1-3', cue: 'storyTurn',
        evidenceRequirements: [], provenance: { source: 'episode_spine', confidence: 'authoritative' },
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;
    const scenes = [{
      id: 's1-3', episodeNumber: 1, order: 2, kind: 'standard', relationshipPacing: [],
      storyCircleBeatContracts: [{
        id: 'story-circle-you-ep1-u3', beat: 'you', sourceText: eventText,
        eventAtoms: [eventText.replace('who befriends her and', 'and')],
        requiredRealization: ['final_prose'], blockingLevel: 'treatment',
      }],
    }] as any;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const ownerTasks = tasks.filter((task) => task.canonicalEventId === 'event:ep1-u3');

    expect(ownerTasks).toHaveLength(1);
    expect(ownerTasks[0]).toMatchObject({
      id: 'task:event:ep1-u3:owner-event',
      projectionOf: ['story-circle-you-ep1-u3'],
      sourceKinds: ['event', 'story_circle'],
    });
    expect(ownerTasks[0].evidenceAtoms[0]?.acceptedPatterns).toEqual(expect.arrayContaining([eventText]));
    expect(tasks.some((task) => task.id === 'task:story-circle-you-ep1-u3:story-circle')).toBe(false);
  });

  it('splits an unconditional choice milestone into pre-choice and all-outcome producer tasks', () => {
    const sourceText = 'After a trial, the travelers become friends and form the Lantern Circle.';
    const graph = {
      events: [{
        id: 'event:alliance', episodeNumber: 1, sourceOrder: 1, sourceText,
        sourceContractIds: ['treatment:alliance'], realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['scene-alliance'],
        targetSpineUnitIds: [], ownerSceneId: 'scene-alliance', provenance: { source: 'treatment_contract', confidence: 'authoritative' },
        realizationAtoms: [
          { id: 'event:alliance:atom:1', description: 'Stage the trial', acceptedPatterns: ['tests the newcomer'], sourceText, kind: 'semantic', semanticRole: 'action', prerequisiteAtomIds: [], required: true },
          { id: 'event:alliance:atom:2', description: 'Earn friendship', acceptedPatterns: ['become friends'], sourceText, kind: 'semantic', semanticRole: 'relationship_change', prerequisiteAtomIds: ['event:alliance:atom:1'], required: true },
          { id: 'event:alliance:atom:3', description: 'Name the group', acceptedPatterns: ['form the Lantern Circle'], sourceText, kind: 'semantic', semanticRole: 'relationship_change', prerequisiteAtomIds: ['event:alliance:atom:2'], required: true },
        ],
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [{
      id: 'scene-alliance', episodeNumber: 1, order: 0, kind: 'standard',
      relationshipPacing: [{
        id: 'relationship:alliance', source: 'treatment', groupId: 'lantern-circle', startStage: 'spark', targetStage: 'friend',
        allowedLabels: ['friend'], blockedLabels: [], requiredEvidence: [], minScenesSinceIntroduction: 1, maxDeltaThisScene: 2,
        mechanicDimensions: ['trust'], milestone: {
          id: 'milestone:alliance', kind: 'group_formation', sourceText, subjectType: 'group', subjectId: 'lantern-circle',
          targetStage: 'friend', introductionSceneIds: ['scene-intro'], testSceneIds: ['scene-alliance'], choiceSceneId: 'scene-alliance',
          memberNpcIds: ['npc-a', 'npc-b'], routeRealizationPolicy: 'all_routes', requiredEvidenceTags: ['respected_agency'],
        },
      }],
    }] as any).filter((task) => task.canonicalEventId === 'event:alliance');

    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.ownerStage === 'scene_writer')).toMatchObject({
      id: 'task:event:alliance:owner-event',
      evidenceAtoms: [expect.objectContaining({ id: 'event:alliance:atom:1', temporalSlot: 'pre_choice' })],
    });
    expect(tasks.find((task) => task.ownerStage === 'choice_author')).toMatchObject({
      id: 'task:event:alliance:choice-resolution',
      prerequisiteTaskIds: ['task:event:alliance:owner-event'],
      target: { scope: 'all_choice_outcomes', surfaces: ['choice_outcome'] },
      evidenceAtoms: [
        expect.objectContaining({ id: 'event:alliance:atom:2', temporalSlot: 'choice_resolution' }),
        expect.objectContaining({ id: 'event:alliance:atom:3', temporalSlot: 'choice_resolution' }),
      ],
    });
  });

  it('moves downstream dependents onto the choice-resolution producer', () => {
    const sourceText = 'The trial changes the group, and they name the pact afterward.';
    const graph = {
      events: [{
        id: 'event:pact', episodeNumber: 1, sourceOrder: 1, sourceText,
        sourceContractIds: ['treatment:pact'], realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['scene-pact'],
        targetSpineUnitIds: [], ownerSceneId: 'scene-pact', provenance: { source: 'treatment_contract', confidence: 'authoritative' },
        realizationAtoms: [
          { id: 'event:pact:semantic:1', description: 'Change the group', acceptedPatterns: ['become allies'], sourceText, kind: 'semantic', semanticRole: 'relationship_change', prerequisiteAtomIds: [], required: true },
          { id: 'event:pact:semantic:2', description: 'Name the pact', acceptedPatterns: ['name the pact'], sourceText, kind: 'semantic', semanticRole: 'action', prerequisiteAtomIds: ['event:pact:semantic:1'], required: true },
        ],
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;

    const tasks = compileNarrativeRealizationTasks(graph, [{
      id: 'scene-pact', episodeNumber: 1, order: 0, kind: 'standard',
      relationshipPacing: [{
        id: 'relationship:pact', source: 'treatment', groupId: 'pact', startStage: 'spark', targetStage: 'ally',
        allowedLabels: ['ally'], blockedLabels: [], requiredEvidence: [], minScenesSinceIntroduction: 1, maxDeltaThisScene: 1,
        mechanicDimensions: ['trust'], milestone: {
          id: 'milestone:pact', kind: 'group_formation', sourceText, subjectType: 'group', subjectId: 'pact',
          targetStage: 'ally', introductionSceneIds: ['scene-intro'], testSceneIds: ['scene-pact'], choiceSceneId: 'scene-pact',
          memberNpcIds: ['npc-a'], routeRealizationPolicy: 'all_routes', requiredEvidenceTags: ['respected_agency'],
        },
      }],
    }] as any).filter((task) => task.canonicalEventId === 'event:pact');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task:event:pact:choice-resolution',
      ownerStage: 'choice_author',
      prerequisiteTaskIds: [],
      evidenceAtoms: [
        expect.objectContaining({ id: 'event:pact:semantic:1', temporalSlot: 'choice_resolution' }),
        expect.objectContaining({ id: 'event:pact:semantic:2', temporalSlot: 'choice_resolution' }),
      ],
    });
  });

  it('coalesces equivalent repeated planning projections without weakening the task', () => {
    const pacing = {
      id: 'relationship:circle', source: 'treatment', groupId: 'lantern-circle', startStage: 'spark', targetStage: 'trust',
      allowedLabels: ['ally'], blockedLabels: ['friend'], requiredEvidence: [], minScenesSinceIntroduction: 1,
      maxDeltaThisScene: 1, mechanicDimensions: ['trust'],
    };
    const tasks = compileNarrativeRealizationTasks({ events: [], dependencies: [] } as unknown as NarrativeContractGraph, [{
      id: 'scene-circle', episodeNumber: 1, order: 0, kind: 'standard', relationshipPacing: [pacing, { ...pacing }],
    }] as any);

    expect(tasks.filter((task) => task.id === 'task:relationship:circle:scene-circle:relationship-labels')).toHaveLength(1);
  });

  it('routes a transition into an encounter to EncounterArchitect entry prose', () => {
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:club-to-park', episodeNumber: 1, fromSceneId: 'club', toSceneId: 'park-attack',
        fromLocation: 'Valescu Club', toLocation: 'Cismigiu Gardens', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Cismigiu Gardens', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Cismigiu Gardens'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:club', 'scene:park-attack'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'park-attack', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {} },
    ] as any);

    expect(tasks.find((task) => task.contractId === 'transition:club-to-park')).toMatchObject({
      ownerStage: 'encounter_architect',
      repairHandler: 'encounter_route',
      artifactPath: 'episodes[1].scenes[park-attack].encounter',
      target: { scope: 'owner', surfaces: ['encounter_entry'] },
      evidenceAtoms: [expect.objectContaining({
        matchStrategy: 'location_identity',
        semanticRole: 'location_entry',
        temporalSlot: 'encounter_entry',
      })],
    });
  });

  it('lets a standard-scene transition realize orientation in player-visible transition prose', () => {
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:apartment-to-streets', episodeNumber: 1, fromSceneId: 'apartment', toSceneId: 'streets',
        fromLocation: 'Apartment', toLocation: 'Bucharest streets', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Bucharest streets', acceptedAliases: ['Bucharest'], required: true },
        requiredBridgeEvidence: ['Bucharest streets'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:apartment', 'scene:streets'],
      }],
    } as unknown as NarrativeContractGraph;

    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'apartment', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'streets', episodeNumber: 1, order: 1, kind: 'standard' },
    ] as any);

    expect(tasks.find((task) => task.contractId === 'transition:apartment-to-streets')).toMatchObject({
      ownerStage: 'scene_writer',
      target: { scope: 'owner', surfaces: ['transition_in', 'beat_text', 'dialogue'] },
    });
  });

  it('compiles an advisory motivated-departure task on the SOURCE scene of a location-changing transition', () => {
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:club-to-park', episodeNumber: 1, fromSceneId: 'club', toSceneId: 'park-attack',
        fromLocation: 'Valescu Club', toLocation: 'Cismigiu Gardens', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Cismigiu Gardens', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Cismigiu Gardens'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:club', 'scene:park-attack'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'park-attack', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {} },
    ] as any);

    const departure = tasks.find((task) => task.id === 'task:transition:club-to-park:departure');
    expect(departure).toMatchObject({
      sceneId: 'club',
      ownerStage: 'scene_writer',
      blocking: false,
      evidenceAtoms: [expect.objectContaining({
        verificationAuthority: 'semantic_judge',
        semanticRole: 'transition_bridge',
      })],
    });
    expect(departure!.evidenceAtoms[0].description).toContain('decides or begins to leave');
    // The arrival bridge is unchanged and still targets the receiving scene.
    expect(tasks.find((task) => task.id === 'task:transition:club-to-park:bridge')).toMatchObject({
      sceneId: 'park-attack',
      blocking: true,
    });
  });

  it('compiles no departure task when the transition stays in the same location', () => {
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:club-to-club-back', episodeNumber: 1, fromSceneId: 'club-front', toSceneId: 'club-back',
        fromLocation: 'Valescu Club', toLocation: 'Valescu Club', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Valescu Club', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Valescu Club'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:club-front', 'scene:club-back'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club-front', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'club-back', episodeNumber: 1, order: 1, kind: 'standard' },
    ] as any);

    expect(tasks.find((task) => task.id === 'task:transition:club-to-club-back:departure')).toBeUndefined();
  });

  it('writes one explicit verification authority on every blocking atom', () => {
    const graph = {
      events: [{
        id: 'event:club', episodeNumber: 1, ownerSceneId: 'club', sourceText: 'They form the Dusk Club.',
        realizationMode: 'depiction', sourceContractIds: ['treatment'],
      }],
      dependencies: [],
      characterPresenceContracts: [{
        id: 'presence:mika', characterId: 'mika', characterName: 'Mika', episodeNumber: 1,
        sceneId: 'club', mode: 'named_on_page', readerNameAllowed: true,
        requiredEvidence: ['Mika'], forbiddenEvidence: [], sourceContractIds: ['treatment'],
        provenance: { source: 'treatment', confidence: 'authoritative' },
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club', episodeNumber: 1, order: 0, kind: 'standard' },
    ] as any);

    expect(tasks.flatMap((candidate) => candidate.evidenceAtoms).map((atom) => atom.verificationAuthority))
      .toEqual(expect.arrayContaining(['semantic_judge', 'literal']));
    expect(tasks.every((candidate) => candidate.evidenceAtoms.every((atom) => Boolean(atom.verificationAuthority))))
      .toBe(true);
  });

  it('rejects a blocking task whose target scene does not exist', () => {
    const graph = {
      events: [], dependencies: [], characterPresenceContracts: [{
        id: 'presence:missing', characterId: 'npc', characterName: 'Mika', episodeNumber: 1,
        sceneId: 'missing', mode: 'named_on_page', readerNameAllowed: true,
        requiredEvidence: ['Mika'], forbiddenEvidence: [], sourceContractIds: ['treatment'],
        provenance: { source: 'treatment', confidence: 'authoritative' },
      }],
    } as unknown as NarrativeContractGraph;

    expect(() => compileNarrativeRealizationTasks(graph, [])).toThrow(/owner_stage_unreachable.*missing scene missing/i);
  });

  it('rejects an unsatisfiable threshold before prose generation', () => {
    const graph = {
      events: [], dependencies: [], premiseContracts: [{
        id: 'premise:impossible', episodeNumber: 1, fieldName: 'Wound', fieldKind: 'wound_pressure',
        sourceText: 'One meaning.', evidencePatterns: ['one'], minimumEvidenceHits: 2,
        targetSceneIds: ['s1'], requiredSurface: ['beat_text'], sourceContractIds: ['treatment'],
        blocking: true, provenance: { source: 'treatment', confidence: 'authoritative' },
      }],
    } as unknown as NarrativeContractGraph;

    expect(() => compileNarrativeRealizationTasks(graph, [
      { id: 's1', episodeNumber: 1, order: 0, kind: 'standard' },
    ] as any)).toThrow(/task_unsatisfiable.*unreachable minimum 2\/1/i);
  });

  it('rejects an exact literal requirement that is also forbidden on the same owner surface', () => {
    expect(() => assertNoContradictoryLiteralEvidence([{
      id: 'task:presence', contractId: 'presence', episodeNumber: 1, sceneId: 'club',
      ownerStage: 'scene_writer', repairHandler: 'scene_prose', sourceContractIds: ['treatment'], blocking: true,
      target: { scope: 'owner', surfaces: ['beat_text'] },
      evidenceAtoms: [
        { id: 'required-name', description: 'Name Mika', acceptedPatterns: ['Mika'], kind: 'lexical', verificationAuthority: 'literal', required: true },
        { id: 'forbidden-name', description: 'Do not name Mika', acceptedPatterns: ['Mika'], kind: 'lexical', verificationAuthority: 'literal', required: true, polarity: 'forbidden' },
      ],
    }])).toThrow(/Contradictory literal evidence.*mika/i);
  });

  it('rejects required semantic stems that conflict with forbidden literal patterns', () => {
    expect(() => assertNoContradictorySemanticLiteralEvidence([{
      id: 'task:friendship', contractId: 'rel', episodeNumber: 1, sceneId: 'club',
      ownerStage: 'scene_writer', repairHandler: 'scene_prose', sourceContractIds: ['treatment'], blocking: true,
      target: { scope: 'owner', surfaces: ['beat_text'] },
      evidenceAtoms: [
        {
          id: 'required-befriend',
          description: 'You befriend Mika over drinks',
          acceptedPatterns: ['befriend'],
          kind: 'semantic',
          verificationAuthority: 'semantic_judge',
          required: true,
          semanticCriteria: ['befriends Mika'],
        },
        {
          id: 'forbidden-friend',
          description: 'Do not say friend',
          acceptedPatterns: ['friend'],
          kind: 'lexical',
          verificationAuthority: 'literal',
          required: true,
          polarity: 'forbidden',
        },
      ],
    } as any])).toThrow(/Contradictory semantic\/literal evidence.*friend/i);
  });

  it('drops second-person-unrealizable pronoun atoms from premise tasks', () => {
    const graph = {
      narrativeVoice: 'second_person',
      premiseContracts: [{
        id: 'premise:character-identity', episodeNumber: 1, fieldName: 'Name and pronouns', fieldKind: 'starting_identity',
        sourceText: 'Kylie Marinescu, she/her.', evidencePatterns: ['Kylie Marinescu'],
        evidenceAtoms: [
          {
            id: 'premise:character-identity:semantic:1', kind: 'behavior', canonicalFact: 'The character is named Kylie Marinescu.',
            acceptedPatterns: ['Kylie Marinescu'], required: true, sourceText: 'Kylie Marinescu, she/her.',
            verificationAuthority: 'literal', semanticCriteria: ['Character is identified as Kylie Marinescu'],
          },
          {
            id: 'premise:character-identity:semantic:2', kind: 'behavior', canonicalFact: 'The character uses she/her pronouns.',
            acceptedPatterns: ['she/her'], required: false, sourceText: 'Kylie Marinescu, she/her.',
            verificationAuthority: 'semantic_judge', semanticCriteria: ['Character is referred to with she/her pronouns'],
          },
        ],
        minimumEvidenceHits: 1, targetSceneIds: ['s1-1'], requiredSurface: ['beat_text'], sourceContractIds: ['treatment:identity'],
        blocking: true, provenance: { source: 'treatment', confidence: 'authoritative' },
      }],
      events: [],
      dependencies: [],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard' },
    ] as any);
    const premise = tasks.find((task) => task.contractId === 'premise:character-identity');
    expect(premise?.evidenceAtoms.map((atom) => atom.id)).toEqual(['premise:character-identity:semantic:1']);
    expect(premise?.minimumEvidenceHits).toBe(1);
  });
});


describe('reveal-timing negative contracts (F1.1)', () => {
  it('projects forbidden final-regression tasks onto every pre-reveal episode scene only', () => {
    const graph = {
      version: 1, compilerVersion: 't', storyId: 's', sourceHash: 'h',
      events: [], characterPresenceContracts: [], dependencies: [],
      validation: { passed: true, issues: [] },
      revealContracts: [{
        id: 'reveal:1:staged-rescue',
        secretDescription: 'The rescue was staged by Victor as bait.',
        forbiddenMeanings: [
          'The rescue or attack is revealed as staged, arranged, or bait.',
          'Victor serves, reports to, or acts for his father or a larger power.',
        ],
        revealEpisode: 5,
        sourceRef: 'Episode 5 outline',
      }],
    } as never;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 1 },
      { id: 's4-2', episodeNumber: 4, order: 2 },
      { id: 's5-1', episodeNumber: 5, order: 1 },
      { id: 's6-1', episodeNumber: 6, order: 1 },
    ] as never;
    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const revealTasks = tasks.filter((candidate) => candidate.contractId === 'reveal:1:staged-rescue');
    // Episodes 1 and 4 are protected; the reveal episode and later are not.
    expect(revealTasks.map((candidate) => candidate.sceneId).sort()).toEqual(['s1-1', 's4-2']);
    for (const revealTask of revealTasks) {
      expect(revealTask.enforcementPhase).toBe('final_regression');
      expect(revealTask.blocking).toBe(true);
      expect(revealTask.evidenceAtoms).toHaveLength(2);
      expect(revealTask.evidenceAtoms.every((atom) => atom.polarity === 'forbidden')).toBe(true);
    }
  });
});
