import { describe, it, expect } from 'vitest';
import {
  VALIDATOR_REGISTRY,
  blockingValidators,
  remediationRoute,
  type ValidatorRegistryEntry,
  type ValidatorRemediation,
  type ValidatorStage,
  type ValidatorTier,
} from './validatorRegistry';

const STAGES: ValidatorStage[] = ['season', 'architecture', 'phase', 'quick', 'full', 'diagnostic', 'final'];
const TIERS: ValidatorTier[] = ['blocking', 'advisory', 'autofix'];
const REMEDIATIONS: ValidatorRemediation[] = [
  'autofix',
  'regen-scene',
  'regen-choices',
  'regen-encounter',
  'regen-episode',
  'plan-time',
  'none',
];

// S1 — blocking validators that do NOT yet declare a remediation route. The
// invariant test below tolerates these so it lands green today; remove names as
// each blocking gate gets a route, then delete this allowlist to tighten the rule.
const BLOCKING_WITHOUT_REMEDIATION_ALLOWLIST: ReadonlySet<string> = new Set([
  'SevenPointCoverageValidator',
  'FinalStoryContractValidator',
  'EncounterQualityValidator',
  'PromiseLedgerValidators',
  'CanonConsistencyValidator',
]);

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

  it('accepts optional remediation metadata fields (S1)', () => {
    const entry: ValidatorRegistryEntry = {
      validator: 'ExampleValidator',
      stage: 'final',
      tier: 'blocking',
      dispatchedFrom: 'test',
      remediation: 'regen-scene',
      rolloutFlag: 'gating.example',
      maxRemediationAttempts: 2,
    };
    expect(REMEDIATIONS).toContain(entry.remediation);
    expect(entry.rolloutFlag).toBe('gating.example');
    expect(entry.maxRemediationAttempts).toBe(2);
  });

  it('any declared remediation/maxRemediationAttempts is well-formed', () => {
    for (const e of VALIDATOR_REGISTRY) {
      if (e.remediation !== undefined) {
        expect(REMEDIATIONS).toContain(e.remediation);
      }
      if (e.maxRemediationAttempts !== undefined) {
        expect(Number.isInteger(e.maxRemediationAttempts)).toBe(true);
        expect(e.maxRemediationAttempts).toBeGreaterThan(0);
      }
    }
  });

  it('remediationRoute resolves declared routes and undefined otherwise', () => {
    const withRoute = VALIDATOR_REGISTRY.find((e) => e.remediation !== undefined);
    if (withRoute) {
      expect(remediationRoute(withRoute.validator)).toBe(withRoute.remediation);
    }
    expect(remediationRoute('NoSuchValidator')).toBeUndefined();
  });

  // S1 scaffold: blocking validators SHOULD declare a remediation route. This
  // passes today by allowing undefined for pre-existing blocking entries (see the
  // allowlist above); shrink the allowlist to enforce the requirement validator by
  // validator. Entries NOT in the allowlist are already held to the rule.
  it('every blocking entry declares a remediation route (allowlisted exceptions)', () => {
    for (const e of VALIDATOR_REGISTRY) {
      if (e.tier !== 'blocking') continue;
      if (e.remediation !== undefined) continue;
      expect(
        BLOCKING_WITHOUT_REMEDIATION_ALLOWLIST.has(e.validator),
        `blocking validator ${e.validator} has no remediation route and is not allowlisted`,
      ).toBe(true);
    }
  });
});
