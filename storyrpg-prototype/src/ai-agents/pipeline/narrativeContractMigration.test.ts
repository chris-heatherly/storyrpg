import { describe, expect, it } from 'vitest';
import type { LegacyNarrativeRealizationTaskV2, NarrativeRealizationTask } from '../../types/narrativeContract';
import { describeNarrativeEvidenceTarget, normalizePersistedRealizationTask, normalizePersistedSeasonScenePlan } from './narrativeContractMigration';

const shared = {
  id: 'task:event:route:victory',
  contractId: 'event:route',
  eventId: 'event',
  episodeNumber: 1,
  ownerStage: 'encounter_architect' as const,
  repairHandler: 'encounter_route' as const,
  sceneId: 's1',
  evidenceAtoms: [{ id: 'atom', description: 'route evidence', acceptedPatterns: ['rescues you'], kind: 'route' as const, required: true }],
  sourceContractIds: ['source'],
  blocking: true,
};

describe('narrative contract migration', () => {
  it('normalizes a version-2 route task into one canonical target', () => {
    const legacy: LegacyNarrativeRealizationTaskV2 = {
      ...shared,
      outcomeTier: 'victory',
      requiredSurface: ['encounter_phase', 'encounter_outcome'],
      routePolicy: 'path_required',
    };

    const normalized = normalizePersistedRealizationTask(legacy);
    expect(normalized.target).toEqual({
      scope: 'route_path',
      outcomeTier: 'victory',
      surfaces: ['encounter_phase', 'encounter_outcome'],
    });
    expect(normalized).not.toHaveProperty('routePolicy');
    expect(normalized).not.toHaveProperty('requiredSurface');
    expect(normalized).not.toHaveProperty('outcomeTier');
  });

  it('adds explicit version-8 authority to canonical tasks and formats their target deterministically', () => {
    const canonical: NarrativeRealizationTask = {
      ...shared,
      target: { scope: 'route_terminal', outcomeTier: 'victory', surfaces: ['terminal_storylet'] },
    };

    expect(normalizePersistedRealizationTask(canonical).evidenceAtoms[0].verificationAuthority).toBe('semantic_judge');
    expect(describeNarrativeEvidenceTarget(canonical.target)).toBe('terminal route=victory surfaces=terminal_storylet');
  });

  it('normalizes nested graph and episode projections in a persisted season scene plan', () => {
    const legacyTask = {
      ...shared,
      outcomeTier: 'victory',
      requiredSurface: ['encounter_outcome'] as const,
      routePolicy: 'terminal_required' as const,
    };
    const plan = normalizePersistedSeasonScenePlan({
      scenes: [], byEpisode: {}, setupPayoffEdges: [],
      narrativeContractGraph: { realizationTasks: [legacyTask] },
      episodeEventPlans: { 1: { realizationTasks: [legacyTask] } },
    } as any);
    expect(plan.narrativeContractGraph?.realizationTasks?.[0].target.scope).toBe('route_terminal');
    expect(plan.episodeEventPlans?.[1].realizationTasks?.[0].target.scope).toBe('route_terminal');
  });

  it('recompiles version-6 transition ownership from the target scene kind', () => {
    const legacyPlan = {
      scenes: [
        { id: 'club', episodeNumber: 1, order: 0, kind: 'standard' },
        { id: 'park', episodeNumber: 1, order: 1, kind: 'encounter', encounter: {} },
      ],
      byEpisode: { 1: ['club', 'park'] }, setupPayoffEdges: [],
      narrativeContractGraph: {
        version: 6, compilerVersion: 'narrative-contract-compiler-v18', storyId: 'story', sourceHash: 'old-hash',
        events: [], characterPresenceContracts: [], dependencies: [], validation: { passed: true, issues: [] },
        transitionContracts: [{
          id: 'transition:club-to-park', episodeNumber: 1, fromSceneId: 'club', toSceneId: 'park',
          fromLocation: 'Valescu Club', toLocation: 'Cismigiu Gardens', requiredBridgeEvidence: ['Cismigiu Gardens'],
          blocking: true, sourceContractIds: ['scene:club', 'scene:park'],
        }],
      },
      episodeEventPlans: {
        1: {
          version: 6, compilerVersion: 'narrative-contract-compiler-v18', episodeNumber: 1,
          sourceGraphHash: 'old-hash', orderedEventIds: [], assignments: [], sceneOrder: ['club', 'park'],
          sceneContexts: [], dueDependencyIds: [], activeDependencyIds: [], characterPresenceContracts: [],
          transitionContracts: [], realizationTasks: [], validation: { passed: true, issues: [] },
        },
      },
    } as any;

    const migrated = normalizePersistedSeasonScenePlan(legacyPlan);
    expect(migrated.narrativeContractGraph).toMatchObject({ version: 8 });
    expect(migrated.narrativeContractGraph?.transitionContracts?.[0]).toMatchObject({
      bridgePolicy: 'orientation_only',
      locationRequirement: { canonicalValue: 'Cismigiu Gardens', required: true },
    });
    expect(migrated.narrativeContractGraph?.realizationTasks?.[0]).toMatchObject({
      ownerStage: 'encounter_architect', repairHandler: 'encounter_route',
      target: { scope: 'owner', surfaces: ['encounter_entry'] },
      evidenceAtoms: [expect.objectContaining({ verificationAuthority: 'literal' })],
    });
    expect(normalizePersistedSeasonScenePlan(migrated)).toEqual(migrated);
  });
});
