import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { finalizeSceneRealizationHandoff } from './finalizeSceneRealizationHandoff';
import type { DeferredRealizationRecord } from './deferredRealization';

// A scene cannot be sealed while its owner-stage realization is incomplete.

const task = {
  id: 'task:event:ep1-u6:rescue:route:complicated',
  contractId: 'event:ep1-u6:rescue',
  canonicalEventId: 'event:ep1-u6',
  sourceKinds: ['event'],
  episodeNumber: 1,
  ownerStage: 'encounter_architect' as const,
  repairHandler: 'encounter_route' as const,
  sceneId: 'enc-1',
  evidenceAtoms: [{
    id: 'event:ep1-u6:rescue:evidence:1:complicated',
    description: 'action evidence for event:ep1-u6 on complicated: rescue / saved',
    acceptedPatterns: ['rescue', 'saved'],
    kind: 'route',
    required: true,
  }],
  target: { scope: 'route_path' as const, outcomeTier: 'complicated', surfaces: ['encounter_phase' as const, 'encounter_outcome' as const, 'terminal_storylet' as const] },
  sourceContractIds: ['ep1-u6'],
  blocking: true,
};

function findingFor(overrides: Record<string, unknown> = {}) {
  return {
    code: 'SEMANTIC_REALIZATION_MISSING' as const,
    taskId: task.id,
    contractId: task.contractId,
    sceneId: 'enc-1',
    ownerStage: 'encounter_architect' as const,
    blocking: true,
    field: 'encounter',
    message: 'missing rescue evidence',
    missingEvidenceAtoms: ['event:ep1-u6:rescue:evidence:1:complicated'],
    fingerprint: 'SEMANTIC_REALIZATION_MISSING::task:event:ep1-u6:rescue:route:complicated::enc-1',
    ...overrides,
  };
}

function makeInput(finding: ReturnType<typeof findingFor>, deferredRecords: DeferredRealizationRecord[]) {
  return {
    sceneBlueprint: { id: 'enc-1', name: 'Rescue', realizationTasks: [task] } as never,
    encounter: { sceneId: 'enc-1', beats: [] } as never,
    episodeNumber: 1,
    deferredRecords,
    executionRecords: [],
    emit: () => undefined,
    validate: async () => ({
      findings: [finding],
      deferredFindings: [],
      semanticReceipt: { sceneId: 'enc-1', ownerStage: 'encounter_architect', candidateHash: 'h', taskIds: [task.id], findingFingerprints: [finding.fingerprint], semanticVerdicts: [] },
    }),
  } as never;
}

describe('finalizeSceneRealizationHandoff terminal policy', () => {
  it('blocks missing-evidence findings before a scene can be sealed', async () => {
    const deferredRecords: DeferredRealizationRecord[] = [];
    await expect(finalizeSceneRealizationHandoff(makeInput(findingFor(), deferredRecords)))
      .rejects.toThrow(/OwnerStageRealizationBlocker/);
    expect(deferredRecords).toHaveLength(0);
  });

  it('still aborts when forbidden meaning is on the page', async () => {
    const deferredRecords: DeferredRealizationRecord[] = [];
    const forbidden = findingFor({ matchedForbiddenAtoms: ['atom:forbidden:1'], missingEvidenceAtoms: [] });
    await expect(finalizeSceneRealizationHandoff(makeInput(forbidden, deferredRecords)))
      .rejects.toThrow(/OwnerStageRealizationBlocker/);
    expect(deferredRecords).toHaveLength(0);
  });
});
