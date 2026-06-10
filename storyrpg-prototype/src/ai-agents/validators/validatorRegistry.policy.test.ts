import { describe, it, expect } from 'vitest';
import { VALIDATOR_REGISTRY, type ValidatorRegistryEntry } from './validatorRegistry';

/**
 * Policy ratchet: no blocking gate without a wired repair.
 *
 * A `tier: 'blocking'` registry entry hard-fails a run, so it must declare a
 * remediation route (`remediation` set and not 'none') — otherwise a gate
 * failure strands the run with no automated way out. The allowlist below
 * grandfathers the blocking gates that predate the S1 remediation plan; it may
 * ONLY shrink. Adding a NEW blocking gate without a wired repair fails this
 * test by design — wire a remediation route instead of growing the allowlist.
 */
const BLOCKING_WITHOUT_REPAIR_ALLOWLIST: ReadonlySet<string> = new Set([
  // Season-spine hard gate: SeasonPlannerAgent.execute throws on an incomplete/out-of-order 7-point spine; no repair wired.
  'SevenPointCoverageValidator',
  // Umbrella final-assembly contract (structural corruption class); the repair loop lives per-issue-class, not on the umbrella gate.
  'FinalStoryContractValidator',
  // Final-contract encounter gate; encounter regen is not yet wired as its remediation route.
  'EncounterQualityValidator',
  // Season Canon promise-ledger seal gate (P4); due/dangling promise failures have no automated repair yet.
  'PromiseLedgerValidators',
  // Season Canon knowledge-state seal gate (P4); impossible-knowledge failures have no automated repair yet.
  'CanonConsistencyValidator',
]);

/** True when the entry has a wired repair: a remediation route that is not 'none'. */
function hasWiredRepair(e: ValidatorRegistryEntry): boolean {
  return e.remediation !== undefined && e.remediation !== 'none';
}

describe('validatorRegistry policy: no blocking gate without a wired repair', () => {
  it('every blocking entry has a wired repair unless explicitly allowlisted', () => {
    for (const e of VALIDATOR_REGISTRY) {
      if (e.tier !== 'blocking') continue;
      if (hasWiredRepair(e)) continue;
      expect(
        BLOCKING_WITHOUT_REPAIR_ALLOWLIST.has(e.validator),
        `blocking validator ${e.validator} has no wired repair (remediation is ${JSON.stringify(e.remediation)}) ` +
          'and is not allowlisted — wire a remediation route instead of growing the allowlist',
      ).toBe(true);
    }
  });

  it('the allowlist contains only current, still-violating blocking entries (ratchet)', () => {
    for (const name of BLOCKING_WITHOUT_REPAIR_ALLOWLIST) {
      const entry = VALIDATOR_REGISTRY.find((e) => e.validator === name);
      expect(entry, `allowlisted validator ${name} is no longer in the registry — remove it from the allowlist`).toBeDefined();
      expect(
        entry!.tier,
        `allowlisted validator ${name} is no longer blocking — remove it from the allowlist`,
      ).toBe('blocking');
      expect(
        hasWiredRepair(entry!),
        `allowlisted validator ${name} now has a wired repair — remove it from the allowlist`,
      ).toBe(false);
    }
  });
});
