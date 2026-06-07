import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TREATMENT_FIDELITY_GATE_FLAGS,
  TREATMENT_FIDELITY_VALIDATORS,
  isFidelityGateEnabled,
  isTreatmentFidelityFinding,
} from './treatmentFidelityGate';

describe('treatmentFidelityGate', () => {
  const saved: Record<string, string | undefined> = {};
  const flags = Object.values(TREATMENT_FIDELITY_GATE_FLAGS);

  beforeEach(() => {
    for (const flag of flags) {
      saved[flag] = process.env[flag];
      delete process.env[flag];
    }
  });
  afterEach(() => {
    for (const flag of flags) {
      if (saved[flag] === undefined) delete process.env[flag];
      else process.env[flag] = saved[flag];
    }
  });

  it('is default-on (Wave-5 promotion): every gate flag is enabled when unset', () => {
    for (const flag of flags) {
      expect(isFidelityGateEnabled(flag)).toBe(true);
    }
  });

  it('env "0" is the kill-switch; non-"0" strings fall through to the default-on', () => {
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance] = '0';
    expect(isFidelityGateEnabled(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance)).toBe(false);
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance] = 'true';
    expect(isFidelityGateEnabled(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance)).toBe(true);
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance] = '1';
    expect(isFidelityGateEnabled(TREATMENT_FIDELITY_GATE_FLAGS.authoredEpisodeConformance)).toBe(true);
  });

  it('classifies findings from the five §4 validators as fidelity findings', () => {
    for (const validator of TREATMENT_FIDELITY_VALIDATORS) {
      expect(isTreatmentFidelityFinding({ validator })).toBe(true);
    }
  });

  it('does NOT classify QA-prose / other validators as fidelity findings', () => {
    expect(isTreatmentFidelityFinding({ validator: 'QARunner' })).toBe(false);
    expect(isTreatmentFidelityFinding({ validator: 'IntegratedBestPracticesValidator' })).toBe(false);
    expect(isTreatmentFidelityFinding({})).toBe(false);
  });
});
