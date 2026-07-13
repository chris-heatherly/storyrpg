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
});
