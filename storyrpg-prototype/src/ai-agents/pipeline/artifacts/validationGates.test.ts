import { describe, expect, it } from 'vitest';
import { ARTIFACT_GATE_REGISTRY, blockingGatesForArtifact, gatesForArtifact, validatorNamesForArtifact } from './validationGates';

describe('artifact validation gate registry', () => {
  it('maps runtime episodes to playback, branching, arc, payoff, and treatment gates', () => {
    const validators = validatorNamesForArtifact('runtime-episode');

    expect(validators).toEqual(expect.arrayContaining([
      'StructuralValidator',
      'SceneGraphBranchValidator',
      'ArcDeltaValidator',
      'SetupPayoffValidator',
      'TreatmentFidelityValidator',
      'MechanicsLeakageValidator',
    ]));
    expect(blockingGatesForArtifact('runtime-episode')).toHaveLength(1);
  });

  it('keeps NPC payoff, information, and character arc contracts first-class', () => {
    expect(gatesForArtifact('npc-payoff-ledger')[0]?.validators).toEqual(expect.arrayContaining(['SetupPayoffValidator']));
    expect(gatesForArtifact('information-ledger')[0]?.validators).toEqual(expect.arrayContaining(['InformationLedgerValidator']));
    expect(gatesForArtifact('character-arc-plan')[0]?.validators).toEqual(expect.arrayContaining(['ArcDeltaValidator']));
  });

  it('keeps every registered gate tied to a concrete contract and validator list', () => {
    expect(ARTIFACT_GATE_REGISTRY.length).toBeGreaterThan(10);
    for (const gate of ARTIFACT_GATE_REGISTRY) {
      expect(gate.id).toBeTruthy();
      expect(gate.contract.length).toBeGreaterThan(20);
      expect(gate.validators.length).toBeGreaterThan(0);
      expect(gate.tier).toBe('blocking');
    }
  });
});
