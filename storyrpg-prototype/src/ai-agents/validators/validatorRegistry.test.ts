import { describe, it, expect } from 'vitest';
import { VALIDATOR_REGISTRY, blockingValidators, type ValidatorStage, type ValidatorTier } from './validatorRegistry';

const STAGES: ValidatorStage[] = ['season', 'architecture', 'phase', 'quick', 'full', 'diagnostic', 'final'];
const TIERS: ValidatorTier[] = ['blocking', 'advisory', 'autofix'];

describe('validatorRegistry (B4 dispatch map)', () => {
  it('every entry has a known stage and tier', () => {
    for (const e of VALIDATOR_REGISTRY) {
      expect(STAGES).toContain(e.stage);
      expect(TIERS).toContain(e.tier);
      expect(e.validator).toBeTruthy();
      expect(e.dispatchedFrom).toBeTruthy();
    }
  });

  it('has no duplicate (validator, stage) pairs', () => {
    const seen = new Set<string>();
    for (const e of VALIDATOR_REGISTRY) {
      const key = `${e.validator}@${e.stage}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('the architecture-stage craft validators are advisory (B1 tiering)', () => {
    const arch = VALIDATOR_REGISTRY.filter((e) => e.stage === 'architecture');
    expect(arch.length).toBeGreaterThanOrEqual(5);
    expect(arch.every((e) => e.tier === 'advisory')).toBe(true);
  });

  it('the final story contract is the blocking gate', () => {
    expect(blockingValidators()).toContain('FinalStoryContractValidator');
  });

  it('does not list the removed dead SeasonValidator', () => {
    expect(VALIDATOR_REGISTRY.some((e) => e.validator === 'SeasonValidator')).toBe(false);
  });
});
