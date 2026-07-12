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

  it('returns canonical tasks unchanged and formats their target deterministically', () => {
    const canonical: NarrativeRealizationTask = {
      ...shared,
      target: { scope: 'route_terminal', outcomeTier: 'victory', surfaces: ['terminal_storylet'] },
    };

    expect(normalizePersistedRealizationTask(canonical)).toBe(canonical);
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
});
