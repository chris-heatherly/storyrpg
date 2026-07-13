import { describe, expect, it } from 'vitest';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import { compileNarrativeRealizationTasks } from './realizationTaskCompiler';

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
});
