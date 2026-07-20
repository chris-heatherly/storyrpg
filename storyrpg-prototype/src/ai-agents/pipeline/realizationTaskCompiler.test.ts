import { describe, expect, it } from 'vitest';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import { assertNoContradictoryLiteralEvidence, compileForeshadowRealizationTasks, compileNarrativeRealizationTasks } from './realizationTaskCompiler';

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

  it('routes choice-dependent event atoms to ChoiceAuthor without requiring a relationship milestone', () => {
    const sourceText = 'The host tests the newcomer, accepts her, and introduces her to the group.';
    const graph = {
      events: [{
        id: 'event:choice-bond', episodeNumber: 1, sourceOrder: 1, sourceText,
        sourceContractIds: ['treatment:choice-bond'], realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['scene-choice'],
        targetSpineUnitIds: [], ownerSceneId: 'scene-choice', provenance: { source: 'treatment_contract', confidence: 'authoritative' },
        realizationAtoms: [
          { id: 'event:choice-bond:setup', description: 'Stage the test', acceptedPatterns: ['tests the newcomer'], sourceText, kind: 'semantic', semanticRole: 'action', prerequisiteAtomIds: [], required: true },
          { id: 'event:choice-bond:acceptance', description: 'Show reciprocal acceptance', acceptedPatterns: ['accepts her'], sourceText, kind: 'semantic', semanticRole: 'relationship_change', prerequisiteAtomIds: ['event:choice-bond:setup'], required: true },
          { id: 'event:choice-bond:introduction', description: 'Introduce her to the group', acceptedPatterns: ['introduces her'], sourceText, kind: 'semantic', semanticRole: 'introduction', prerequisiteAtomIds: ['event:choice-bond:acceptance'], required: true },
        ],
      }],
      dependencies: [],
    } as unknown as NarrativeContractGraph;

    const tasks = compileNarrativeRealizationTasks(graph, [{
      id: 'scene-choice', episodeNumber: 1, order: 0, kind: 'standard', hasChoice: true,
      choiceType: 'relationship', relationshipPacing: [],
    }] as any).filter((task) => task.canonicalEventId === 'event:choice-bond');

    expect(tasks.find((task) => task.ownerStage === 'scene_writer')?.evidenceAtoms).toEqual([
      expect.objectContaining({ id: 'event:choice-bond:setup', temporalSlot: 'pre_choice' }),
    ]);
    expect(tasks.find((task) => task.ownerStage === 'choice_author')).toMatchObject({
      target: { scope: 'all_choice_outcomes', surfaces: ['choice_outcome'] },
      evidenceAtoms: [
        expect.objectContaining({ id: 'event:choice-bond:acceptance', temporalSlot: 'choice_resolution' }),
        expect.objectContaining({ id: 'event:choice-bond:introduction', temporalSlot: 'choice_resolution' }),
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

  it('routes a choice-terminal departure to every ChoiceAuthor outcome', () => {
    const graph = {
      events: [], dependencies: [],
      transitionContracts: [{
        id: 'transition:club-to-park-choice', episodeNumber: 1, fromSceneId: 'club', toSceneId: 'park',
        fromLocation: 'Club', toLocation: 'Park', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Park', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Park'], stateContracts: [], blocking: true, sourceContractIds: [],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club', episodeNumber: 1, order: 0, kind: 'standard', hasChoice: true, choiceType: 'relationship' },
      { id: 'park', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {} },
    ] as any);

    expect(tasks.find((task) => task.id === 'task:transition:club-to-park-choice:departure')).toMatchObject({
      sceneId: 'club',
      ownerStage: 'choice_author',
      repairHandler: 'choice_reauthor',
      target: { scope: 'all_choice_outcomes', surfaces: ['choice_outcome'] },
      evidenceAtoms: [expect.objectContaining({ temporalSlot: 'choice_resolution' })],
    });
  });

  it('r115 gap analysis (2026-07-18): blocks unexplained companion dropout before entering an encounter', () => {
    // Live regression: s1-5 ends with the whole group ("Come on. Let's walk,
    // the air in Cismigiu is better") heading toward Cismigiu together, but
    // the encounter opens with Kylie alone — no farewell, parting, or reason
    // Stela/Mika don't come along.
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:s1-5-to-attack', episodeNumber: 1, fromSceneId: 's1-5', toSceneId: 'treatment-enc-1-1',
        fromLocation: 'rooftop bar', toLocation: 'Cismigiu Gardens', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Cismigiu Gardens', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Cismigiu Gardens'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:s1-5', 'scene:treatment-enc-1-1'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-5', episodeNumber: 1, order: 0, kind: 'standard', npcsInvolved: ['Kylie Marinescu', 'Stela Pavel', 'Mika Dragan'] },
      { id: 'treatment-enc-1-1', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {}, npcsInvolved: ['Kylie Marinescu'] },
    ] as any, 'Kylie Marinescu');

    const companion = tasks.find((task) => task.id === 'task:transition:s1-5-to-attack:companion-continuity');
    expect(companion).toMatchObject({
      sceneId: 's1-5',
      blocking: true,
      evidenceAtoms: [expect.objectContaining({
        verificationAuthority: 'semantic_judge',
        semanticRole: 'transition_bridge',
        required: true,
      })],
    });
    expect(companion!.evidenceAtoms[0].description).toContain('Stela Pavel');
    expect(companion!.evidenceAtoms[0].description).toContain('Mika Dragan');
    expect(companion!.evidenceAtoms[0].description).not.toContain('Kylie');
    expect(companion!.evidenceAtoms[0].description).toContain('part ways');
  });

  it('still requires the check even when the encounter\'s OWN metadata claims the same cast (r115: metadata lied)', () => {
    // r115's actual encounter scene declared all three characters "involved"
    // in its own plan-time npcsInvolved even though only the protagonist
    // appeared in any generated beat — a metadata-vs-metadata diff would have
    // missed exactly this case. The check must not trust the destination's
    // cast claim; it asks the judge to verify the real prose either way.
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [{
        id: 'transition:same-cast', episodeNumber: 1, fromSceneId: 's1-a', toSceneId: 's1-b-encounter',
        fromLocation: 'street', toLocation: 'alley', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'alley', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['alley'], stateContracts: [], blocking: true,
        sourceContractIds: ['scene:s1-a', 'scene:s1-b-encounter'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-a', episodeNumber: 1, order: 0, kind: 'standard', npcsInvolved: ['Kylie Marinescu', 'Stela Pavel'] },
      { id: 's1-b-encounter', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {}, npcsInvolved: ['Kylie Marinescu', 'Stela Pavel'] },
    ] as any, 'Kylie Marinescu');

    const companion = tasks.find((task) => task.id === 'task:transition:same-cast:companion-continuity');
    expect(companion).toBeDefined();
    expect(companion!.evidenceAtoms[0].description).toContain('Stela Pavel');
    expect(companion!.evidenceAtoms[0].description).not.toContain('Kylie Marinescu');
  });

  it('routes companion parting through every outcome when the source scene ends on a choice', () => {
    const graph = {
      events: [], dependencies: [],
      transitionContracts: [{
        id: 'transition:choice-companions', episodeNumber: 1, fromSceneId: 'club', toSceneId: 'attack',
        fromLocation: 'Club', toLocation: 'Park', bridgePolicy: 'orientation_only',
        locationRequirement: { canonicalValue: 'Park', acceptedAliases: [], required: true },
        requiredBridgeEvidence: ['Park'], stateContracts: [], blocking: true, sourceContractIds: [],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'club', episodeNumber: 1, order: 0, kind: 'standard', hasChoice: true, choiceType: 'relationship', npcsInvolved: ['Kylie', 'Mika'] },
      { id: 'attack', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {}, npcsInvolved: ['Kylie'] },
    ] as any, 'Kylie');

    expect(tasks.find((task) => task.id === 'task:transition:choice-companions:companion-continuity')).toMatchObject({
      ownerStage: 'choice_author',
      target: { scope: 'all_choice_outcomes', surfaces: ['choice_outcome'] },
      evidenceAtoms: [expect.objectContaining({ temporalSlot: 'choice_resolution' })],
    });
  });

  it('compiles no companion-continuity task when the arrival is not an encounter, or the departing scene has no companions beyond the protagonist fixture', () => {
    const graph = {
      events: [],
      dependencies: [],
      transitionContracts: [
        {
          id: 'transition:not-encounter', episodeNumber: 1, fromSceneId: 's1-c', toSceneId: 's1-d',
          fromLocation: 'street', toLocation: 'cafe', bridgePolicy: 'orientation_only',
          locationRequirement: { canonicalValue: 'cafe', acceptedAliases: [], required: true },
          requiredBridgeEvidence: ['cafe'], stateContracts: [], blocking: true,
          sourceContractIds: ['scene:s1-c', 'scene:s1-d'],
        },
        {
          id: 'transition:alone', episodeNumber: 2, fromSceneId: 's2-a', toSceneId: 's2-b-encounter',
          fromLocation: 'street', toLocation: 'alley', bridgePolicy: 'orientation_only',
          locationRequirement: { canonicalValue: 'alley', acceptedAliases: [], required: true },
          requiredBridgeEvidence: ['alley'], stateContracts: [], blocking: true,
          sourceContractIds: ['scene:s2-a', 'scene:s2-b-encounter'],
        },
      ],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-c', episodeNumber: 1, order: 0, kind: 'standard', npcsInvolved: ['Kylie Marinescu', 'Mika Dragan'] },
      { id: 's1-d', episodeNumber: 1, order: 1, kind: 'standard', npcsInvolved: ['Kylie Marinescu'] },
      // Episode 2: only the protagonist ever appears — no companions to lose.
      { id: 's2-a', episodeNumber: 2, order: 0, kind: 'standard', npcsInvolved: ['Kylie Marinescu'] },
      { id: 's2-b-encounter', episodeNumber: 2, order: 1, kind: 'encounter', encounter: {}, npcsInvolved: ['Kylie Marinescu'] },
    ] as any, 'Kylie Marinescu');

    expect(tasks.find((task) => task.id === 'task:transition:not-encounter:companion-continuity')).toBeUndefined();
    expect(tasks.find((task) => task.id === 'task:transition:alone:companion-continuity')).toBeUndefined();
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

  it('compiles a blocking judge-verified planting task for a major season anchor on its owning scene', () => {
    const graph = {
      events: [],
      dependencies: [],
      anchorContracts: [{
        id: 'anchor:1:2:stela-s-protection',
        anchorName: "Stela's protection",
        episodeNumber: 1,
        owningSceneId: 's1-3',
        onPageAction: 'Kylie accepts a protective object or blessing from Stela with visible consent.',
        sourceRef: "Stela's protection … become live season anchors.",
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-3', episodeNumber: 1, order: 0, kind: 'standard' },
    ] as any);

    expect(tasks.find((task) => task.id === 'task:anchor:1:2:stela-s-protection:planting')).toMatchObject({
      sceneId: 's1-3',
      blocking: true,
      evidenceAtoms: [expect.objectContaining({
        description: 'Kylie accepts a protective object or blessing from Stela with visible consent.',
        verificationAuthority: 'semantic_judge',
      })],
    });
  });

  it('blocks active restaging of a causal source event inside its consequence scene', () => {
    const graph = {
      events: [{
        id: 'event:publish', episodeNumber: 1, sourceOrder: 1, sourceText: 'Kylie publishes the post.',
        sourceContractIds: ['publish'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
        prerequisiteEventIds: [], targetSceneIds: ['writing'], targetSpineUnitIds: [], ownerSceneId: 'writing',
        provenance: { source: 'episode_spine', confidence: 'authoritative' },
      }, {
        id: 'event:viral', episodeNumber: 1, sourceOrder: 2, sourceText: 'The post goes viral.',
        sourceContractIds: ['viral'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
        prerequisiteEventIds: ['event:publish'], targetSceneIds: ['aftermath'], targetSpineUnitIds: [], ownerSceneId: 'aftermath',
        provenance: { source: 'episode_spine', confidence: 'authoritative' },
      }],
      dependencies: [{
        id: 'dependency:publish:viral', fromEventId: 'event:publish', toEventId: 'event:viral', relation: 'causes',
        sourceEpisodeNumber: 1, targetEpisodeNumbers: [1], targetSceneIds: ['aftermath'], branchConditionKeys: [],
        requiredSurfaces: ['scene_turn'], priority: 'major', sourceContractIds: ['treatment'],
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'writing', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'aftermath', episodeNumber: 1, order: 1, kind: 'standard' },
    ] as any);

    // r115 postmortem: advisory until Phase 4 (route/variant-aware evidence)
    // ships — today's owner-scope collection unions every flag-gated
    // textVariant on the target beat, so 6 mutually-exclusive aftermath
    // retellings of the same beat can misread as restaging.
    expect(tasks.find((task) => task.id === 'task:dependency:publish:viral:causal-restage')).toMatchObject({
      sceneId: 'aftermath',
      blocking: false,
      evidenceAtoms: [expect.objectContaining({
        polarity: 'forbidden',
        verificationAuthority: 'semantic_judge',
      })],
    });
  });

  it('skips anchor tasks whose owning scene is not in the compiled slice', () => {
    const graph = {
      events: [],
      dependencies: [],
      anchorContracts: [{
        id: 'anchor:2:1:x', anchorName: 'X', episodeNumber: 2, owningSceneId: 's2-9', onPageAction: 'Y.',
      }],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 's1-3', episodeNumber: 1, order: 0, kind: 'standard' },
    ] as any);
    expect(tasks.find((task) => task.contractId === 'anchor:2:1:x')).toBeUndefined();
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

  // Wording-invariance (2026-07-16 regression): semantic_judge text is
  // DESCRIPTIVE, never contractual wording. The deleted stem-overlap rule
  // declared plans impossible when an incidental word in a semantic
  // description substring-matched a forbidden literal ("after" inside
  // "Dating After Dusk" killed a fresh analysis). These negative controls
  // pin that incidental wording can never change deterministic feasibility.
  function feasibilityTask(atoms: unknown[]): unknown {
    return {
      id: 'task:wording', contractId: 'wording', episodeNumber: 1, sceneId: 's1-1',
      ownerStage: 'scene_writer', repairHandler: 'scene_prose', sourceContractIds: ['treatment'], blocking: true,
      target: { scope: 'owner', surfaces: ['beat_text'] },
      evidenceAtoms: atoms,
    };
  }
  function forbiddenLiteral(id: string, pattern: string): unknown {
    return { id, description: `Do not use "${pattern}" yet`, acceptedPatterns: [pattern], kind: 'lexical', verificationAuthority: 'literal', required: true, polarity: 'forbidden' };
  }
  function requiredSemantic(id: string, description: string, criteria: string[]): unknown {
    return { id, description, acceptedPatterns: [], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true, semanticCriteria: criteria };
  }

  it('compiles when a semantic description shares an incidental word with a forbidden title ("after" vs "Dating After Dusk")', () => {
    expect(() => assertNoContradictoryLiteralEvidence([feasibilityTask([
      requiredSemantic('premise:identity', 'She observes the room and writes about it after.', ['Kylie observes first, writes later']),
      forbiddenLiteral('artifact:title', 'Dating After Dusk'),
    ]) as never])).not.toThrow();
  });

  it('compiles when a semantic meaning overlaps a forbidden literal word ("become friends" vs "friend")', () => {
    expect(() => assertNoContradictoryLiteralEvidence([feasibilityTask([
      requiredSemantic('rel:befriend', 'You befriend Mika over drinks', ['befriends Mika']),
      forbiddenLiteral('lexicon:friend', 'friend'),
    ]) as never])).not.toThrow();
  });

  it('compiles "club" prose obligations against a forbidden "Dusk Club" coinage', () => {
    expect(() => assertNoContradictoryLiteralEvidence([feasibilityTask([
      requiredSemantic('event:club-night', 'The group spends the night at the club.', ['a night out at the club']),
      forbiddenLiteral('artifact:dusk-club', 'Dusk Club'),
    ]) as never])).not.toThrow();
  });

  it('rewording a semantic description never changes deterministic feasibility', () => {
    const rewordings = [
      'She catalogues the room, drafting sentences for later.',
      'After watching everyone, she plans what to write.',
      'Dating strangers gives her material; dusk is when she writes.',
      'Her habit: observe now, author the story after dusk settles.',
    ];
    for (const description of rewordings) {
      expect(() => assertNoContradictoryLiteralEvidence([feasibilityTask([
        requiredSemantic('premise:identity', description, [description]),
        forbiddenLiteral('artifact:title', 'Dating After Dusk'),
      ]) as never])).not.toThrow();
    }
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

  it('B1: compiles an advisory judge-verified signature task for a named first appearance carrying visualIdentity', () => {
    const graph = {
      firstAppearanceContracts: [
        {
          id: 'first-appearance:stela-pavel', characterId: 'stela-pavel', characterName: 'Stela Pavel',
          episodeNumber: 1, owningSceneId: 's1-2', mode: 'named_on_page', earlierSceneIds: ['s1-1'],
          sourceContractIds: [], blocking: true,
          visualIdentity: 'platinum bob; stag-crest signet ring; calls Kylie "iubita mea"',
        },
        // No visualIdentity → no signature task.
        {
          id: 'first-appearance:radu', characterId: 'radu', characterName: 'Radu',
          episodeNumber: 1, owningSceneId: 's1-3', mode: 'named_on_page', earlierSceneIds: [],
          sourceContractIds: [], blocking: true,
        },
        // Anonymous plant → no signature task (they are not introduced yet).
        {
          id: 'first-appearance:watcher', characterId: 'watcher', characterName: 'The Watcher',
          episodeNumber: 1, owningSceneId: 's1-4', mode: 'anonymous_plant', earlierSceneIds: [],
          sourceContractIds: [], blocking: true, visualIdentity: 'woodsmoke scent',
        },
      ],
      events: [], dependencies: [],
    } as unknown as NarrativeContractGraph;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard', relationshipPacing: [] },
      { id: 's1-2', episodeNumber: 1, order: 1, kind: 'standard', relationshipPacing: [] },
      { id: 's1-3', episodeNumber: 1, order: 2, kind: 'standard', relationshipPacing: [] },
      { id: 's1-4', episodeNumber: 1, order: 3, kind: 'standard', relationshipPacing: [] },
    ] as never;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const signatureTasks = tasks.filter((task) => task.id.endsWith(':signature'));
    expect(signatureTasks).toHaveLength(1);
    expect(signatureTasks[0]).toMatchObject({
      id: 'task:first-appearance:stela-pavel:signature',
      sceneId: 's1-2',
      ownerStage: 'scene_writer',
      blocking: false,
    });
    expect(signatureTasks[0].evidenceAtoms[0]).toMatchObject({
      verificationAuthority: 'semantic_judge',
      required: true,
    });
    expect(signatureTasks[0].evidenceAtoms[0].description).toContain('platinum bob');
    expect(signatureTasks[0].evidenceAtoms[0].description).toContain('never as a checklist');
  });

  it('blocks an anonymous first appearance from being staged in an earlier scene', () => {
    const graph = {
      firstAppearanceContracts: [{
        id: 'first-appearance:radu', characterId: 'radu', characterName: 'Radu Stoian',
        episodeNumber: 1, owningSceneId: 'rooftop', mode: 'anonymous_plant', earlierSceneIds: ['street'],
        sourceContractIds: ['anchor:radu'], blocking: true,
        visualIdentity: 'broad, bearded, scarred inside the forearm, in a hand-knit sweater',
      }],
      events: [], dependencies: [],
    } as unknown as NarrativeContractGraph;
    const tasks = compileNarrativeRealizationTasks(graph, [
      { id: 'street', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 'rooftop', episodeNumber: 1, order: 1, kind: 'standard' },
    ] as any);

    // r115 postmortem: new task class, zero shadow-evidence period — advisory
    // until a live run proves the detector's false-positive rate.
    expect(tasks.find((task) => task.id === 'task:first-appearance:radu:premature:street')).toMatchObject({
      sceneId: 'street',
      blocking: false,
      evidenceAtoms: [expect.objectContaining({
        polarity: 'forbidden',
        verificationAuthority: 'semantic_judge',
      })],
    });
  });

  it('r115 gap analysis (2026-07-18): forbids the full introduction ritual before a named first appearance', () => {
    // Live regression: the bookshop scene (s1-3) staged "Mika, this is Kylie.
    // Kylie, Mika." — a complete first-meeting exchange — one scene before
    // Mika's compiled owning scene (the club, s1-4), which repeated it.
    const graph = {
      firstAppearanceContracts: [{
        id: 'first-appearance:mika', characterId: 'char-mika-dragan', characterName: 'Mika Dragan',
        episodeNumber: 1, owningSceneId: 's1-4', mode: 'named_on_page', earlierSceneIds: ['s1-1', 's1-2', 's1-3'],
        sourceContractIds: ['presence:ep1:s1-4:char-mika-dragan'], blocking: true,
      }],
      events: [], dependencies: [],
    } as unknown as NarrativeContractGraph;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 's1-2', episodeNumber: 1, order: 1, kind: 'standard' },
      { id: 's1-3', episodeNumber: 1, order: 2, kind: 'standard' },
      { id: 's1-4', episodeNumber: 1, order: 3, kind: 'standard' },
    ] as any;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const prematureRitualTasks = tasks.filter((task) => task.id.includes(':premature-ritual:'));

    expect(prematureRitualTasks.map((task) => task.sceneId)).toEqual(['s1-1', 's1-2', 's1-3']);
    for (const task of prematureRitualTasks) {
      expect(task.blocking).toBe(false);
      expect(task.evidenceAtoms[0]).toMatchObject({ polarity: 'forbidden', verificationAuthority: 'semantic_judge' });
    }
    expect(prematureRitualTasks[0].evidenceAtoms[0].description).toContain('introduction ritual');
    expect(prematureRitualTasks[0].evidenceAtoms[0].description).toContain('Mentioning or referencing');
  });

  it('r115 gap analysis (2026-07-18): forbids restaging a named first appearance in a later same-episode scene', () => {
    // Live regression: Mika Dragan got the full "X, this is Y" introduction
    // ritual twice — the compiled owner scene (bookshop, s1-3) and again at
    // the club (s1-4) — with no acknowledgment they'd already met.
    const graph = {
      firstAppearanceContracts: [{
        id: 'first-appearance:mika', characterId: 'char-mika-dragan', characterName: 'Mika Dragan',
        episodeNumber: 1, owningSceneId: 's1-3', mode: 'named_on_page', earlierSceneIds: ['s1-1', 's1-2'],
        sourceContractIds: ['presence:ep1:s1-3:char-mika-dragan'], blocking: true,
      }],
      events: [], dependencies: [],
    } as unknown as NarrativeContractGraph;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard' },
      { id: 's1-2', episodeNumber: 1, order: 1, kind: 'standard' },
      { id: 's1-3', episodeNumber: 1, order: 2, kind: 'standard' },
      { id: 's1-4', episodeNumber: 1, order: 3, kind: 'standard' },
      { id: 's1-5', episodeNumber: 1, order: 4, kind: 'standard' },
      { id: 's2-1', episodeNumber: 2, order: 0, kind: 'standard' },
    ] as any;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const reintroductionTasks = tasks.filter((task) => task.id.includes(':reintroduction:'));

    // Only later scenes IN THE SAME EPISODE are protected — not the owning
    // scene itself, not earlier scenes, not a later episode.
    expect(reintroductionTasks.map((task) => task.sceneId).sort()).toEqual(['s1-4', 's1-5']);
    for (const task of reintroductionTasks) {
      // New task class, zero shadow-evidence period — same discipline as the
      // premature-appearance block above.
      expect(task.blocking).toBe(false);
      expect(task.enforcementPhase).toBe('final_regression');
      expect(task.evidenceAtoms).toHaveLength(1);
      expect(task.evidenceAtoms[0]).toMatchObject({ polarity: 'forbidden', verificationAuthority: 'semantic_judge' });
      expect(task.evidenceAtoms[0].description).toContain('Mika Dragan');
      expect(task.evidenceAtoms[0].description).toContain('already introduced');
    }
  });

  it('B4: compiles advisory foreshadow atoms per owning scene from twist-plan directives', () => {
    const tasks = compileForeshadowRealizationTasks({
      episodeNumber: 1,
      twistPlan: {
        headline: 'The rescue was staged',
        directives: [
          { sceneId: 's1-2', beatRole: 'foreshadow', hint: 'The stranger arrives seconds too fast, as if waiting' },
          { sceneId: 's1-2', beatRole: 'misdirect', hint: 'Stela credits luck, warmly and a little too quickly' },
          { sceneId: 's1-5', beatRole: 'reveal', hint: 'never compiled — reveals are owned by the twist scene itself' },
          { sceneId: 'missing-scene', beatRole: 'foreshadow', hint: 'dropped: unknown scene' },
          { sceneId: 's1-3', beatRole: 'foreshadow', hint: '   ' },
        ],
      },
      scenes: [{ id: 's1-1' }, { id: 's1-2' }, { id: 's1-3' }, { id: 's1-5' }],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task:twist:ep1:s1-2:foreshadow',
      sceneId: 's1-2',
      ownerStage: 'scene_writer',
      blocking: false,
    });
    expect(tasks[0].evidenceAtoms).toHaveLength(2);
    expect(tasks[0].evidenceAtoms[0].verificationAuthority).toBe('semantic_judge');
    expect(tasks[0].evidenceAtoms[0].description).toContain('The rescue was staged');
    expect(tasks[0].evidenceAtoms[0].description).toContain('never signposted');
    expect(tasks[0].evidenceAtoms[1].description).toContain('misdirection beat');
  });

  it('C2: compiles a blocking escalation-budget task on each episode-final scene', () => {
    const graph = { events: [], dependencies: [] } as unknown as NarrativeContractGraph;
    const scenes = [
      { id: 's1-1', episodeNumber: 1, order: 0, kind: 'standard', relationshipPacing: [] },
      { id: 's1-5', episodeNumber: 1, order: 4, kind: 'standard', relationshipPacing: [] },
      { id: 's2-3', episodeNumber: 2, order: 2, kind: 'standard', relationshipPacing: [] },
    ] as never;

    const tasks = compileNarrativeRealizationTasks(graph, scenes);
    const budgets = tasks.filter((task) => task.id.startsWith('task:escalation-budget:'));
    expect(budgets.map((task) => [task.id, task.sceneId])).toEqual([
      ['task:escalation-budget:ep1', 's1-5'],
      ['task:escalation-budget:ep2', 's2-3'],
    ]);
    for (const budget of budgets) {
      // r115 gap analysis (2026-07-18): re-promoted after a second
      // independently-confirmed true positive (bite-me-r115_2026-07-18T04-37-51
      // — the victory beat overridden by a geolocation-threat "Run." coda)
      // past the shadow-evidence bar; see realizationTaskCompiler.ts.
      expect(budget.blocking).toBe(true);
      expect(budget.evidenceAtoms).toHaveLength(2);
      expect(budget.evidenceAtoms.every((atom) => atom.polarity === 'forbidden' && atom.verificationAuthority === 'semantic_judge')).toBe(true);
    }
    expect(budgets[0].evidenceAtoms[0].description).toContain('MORE THAN ONE');
    expect(budgets[0].evidenceAtoms[1].description).toContain('DISPLACES');
  });
});
