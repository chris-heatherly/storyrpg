import { describe, expect, it } from 'vitest';
import type { LegacyNarrativeRealizationTaskV2, NarrativeRealizationTask } from '../../types/narrativeContract';
import { describeNarrativeEvidenceTarget, normalizePersistedRealizationTask } from './narrativeContractMigration';

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
});
