import { describe, expect, it } from 'vitest';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import {
  dedupeRelationshipPacingContracts,
  effectiveNpcDeltaCap,
  isGroupPacingContract,
  isNpcPacingContract,
  mergeSceneRelationshipPacing,
  normalizePacingContractNpcIds,
  pacingKeysMatch,
} from './effectiveRelationshipPacing';

function npcContract(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 'npc-rel',
    source: 'planner',
    npcId: 'char-stela-pavel',
    startStage: 'acquaintance',
    targetStage: 'acquaintance',
    minScenesSinceIntroduction: 0,
    maxDeltaThisScene: 8,
    requiredEvidence: [],
    allowedLabels: ['guarded warmth'],
    blockedLabels: ['friend'],
    mechanicDimensions: ['trust', 'respect'],
    ...overrides,
  };
}

function groupContract(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 'group-rel',
    source: 'planner',
    groupId: 'dusk-club',
    startStage: 'unmet',
    targetStage: 'acquaintance',
    minScenesSinceIntroduction: 0,
    maxDeltaThisScene: 6,
    requiredEvidence: [],
    allowedLabels: ['invitation'],
    blockedLabels: ['official'],
    mechanicDimensions: [],
    ...overrides,
  };
}

describe('effectiveRelationshipPacing', () => {
  it('matches pacing keys across char- prefix and display names', () => {
    expect(pacingKeysMatch('char-stela-pavel', 'Stela Pavel')).toBe(true);
    expect(pacingKeysMatch('char-mika-dragan', 'Mika')).toBe(true);
  });

  it('normalizes display-name npc ids to char- form', () => {
    const normalized = normalizePacingContractNpcIds([
      npcContract({ npcId: 'Stela Pavel' }),
    ]);
    expect(normalized[0].npcId).toBe('char-stela-pavel');
  });

  it('dedupes planned and scene copies by contract id, preferring stricter NPC cap', () => {
    const merged = mergeSceneRelationshipPacing(
      [npcContract({ maxDeltaThisScene: 8 })],
      [npcContract({ maxDeltaThisScene: 6 })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].maxDeltaThisScene).toBe(6);
  });

  it('uses only NPC contracts for per-NPC delta caps (group cap must not apply)', () => {
    const contracts = dedupeRelationshipPacingContracts([
      npcContract({ maxDeltaThisScene: 8 }),
      groupContract({ maxDeltaThisScene: 6 }),
    ]);
    expect(isNpcPacingContract(contracts[0])).toBe(true);
    expect(isGroupPacingContract(contracts[1])).toBe(true);
    expect(effectiveNpcDeltaCap(contracts, 'char-stela-pavel', new Map())).toBe(8);
  });
});
