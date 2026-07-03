import { beforeEach, describe, expect, it } from 'vitest';
import {
  FlagRegistry,
  inferFlagKind,
  isRuntimeReadableFlag,
  isResidueExcludedFlag,
  isStructuralFlagKind,
  isTintFlagKind,
  resetFlagRegistry,
} from './flagRegistry';
import { isStructuralFlag, isTintFlag } from './callbackLedger';

beforeEach(() => {
  resetFlagRegistry();
});

describe('inferFlagKind', () => {
  it('classifies every legacy namespace', () => {
    expect(inferFlagKind('tint:mercy')).toBe('tint');
    expect(inferFlagKind('route_stealth')).toBe('route');
    expect(inferFlagKind('treatment_branch_ending_a')).toBe('branch_axis');
    expect(inferFlagKind('treatment_seed_ep1_3')).toBe('treatment_seed');
    expect(inferFlagKind('encounter_attack_partialVictory')).toBe('encounter_outcome');
    expect(inferFlagKind('encounter.clock')).toBe('runtime');
    expect(inferFlagKind('_outcome_x')).toBe('runtime');
    expect(inferFlagKind('visited_club')).toBe('runtime');
    expect(inferFlagKind('accepted_quartz')).toBe('narrative');
  });
});

describe('sniffer parity (delegated predicates match the old behavior)', () => {
  it('isStructuralFlag matches the legacy pattern set including flag: strip', () => {
    for (const structural of ['tint:mercy', 'route_left', 'treatment_branch_a', 'encounter_x_victory', 'flag:route_left', 'flag:tint:mercy']) {
      expect(isStructuralFlag(structural)).toBe(true);
    }
    // The legacy sniffer never matched the engine's dotted internals or plain flags.
    for (const nonStructural of ['encounter.clock', 'accepted_quartz', 'treatment_seed_ep1_1', 'flag:accepted_quartz']) {
      expect(isStructuralFlag(nonStructural)).toBe(false);
    }
  });

  it('isTintFlag matches legacy including flag: strip', () => {
    expect(isTintFlag('tint:boldness')).toBe(true);
    expect(isTintFlag('flag:tint:boldness')).toBe(true);
    expect(isTintFlag('boldness')).toBe(false);
    expect(isTintFlagKind('tint:boldness')).toBe(true);
  });

  it('runtime-readable covers the legacy isRuntimeFlag set', () => {
    for (const runtime of ['encounter_x_victory', 'encounter.clock', 'route_left', '_outcome_win']) {
      expect(isRuntimeReadableFlag(runtime)).toBe(true);
    }
    expect(isRuntimeReadableFlag('accepted_quartz')).toBe(false);
  });

  it('residue exclusion covers structural kinds plus treatment seeds', () => {
    expect(isResidueExcludedFlag('treatment_seed_ep2_1')).toBe(true);
    expect(isResidueExcludedFlag('route_left')).toBe(true);
    expect(isResidueExcludedFlag('accepted_quartz')).toBe(false);
  });
});

describe('registration', () => {
  it('registered kind takes precedence over pattern inference', () => {
    const registry = resetFlagRegistry();
    registry.register('oddly_named_seed', 'treatment_seed', 'test');
    expect(registry.kindOf('oddly_named_seed')).toBe('treatment_seed');
    expect(isResidueExcludedFlag('oddly_named_seed')).toBe(true);
  });

  it('is idempotent and first-registration-wins', () => {
    const registry = new FlagRegistry();
    registry.register('x', 'narrative', 'first');
    registry.register('x', 'route', 'second');
    expect(registry.kindOf('x')).toBe('narrative');
    expect(registry.entries()).toHaveLength(1);
  });

  it('namesOfKind filters registered entries', () => {
    const registry = new FlagRegistry();
    registry.registerNarrativeSetter('a', 't');
    registry.registerRouteFlag('route_b', 't');
    expect(registry.namesOfKind('narrative')).toEqual(['a']);
  });
});

describe('parse-time condition canonicalization', () => {
  it('rewrites misspelled encounter-outcome flags inside nested conditions', async () => {
    const { canonicalizeConditionOutcomeFlags } = await import('../utils/encounterOutcomeFlags');
    const condition = {
      type: 'and',
      conditions: [
        { type: 'flag', flag: 'encounter_attack_partial_victory', value: true },
        { type: 'not', condition: { type: 'flag', flag: 'encounter_attack-encounter_escaped', value: true } },
        { type: 'flag', flag: 'accepted_quartz', value: true },
      ],
    };

    const rewritten = canonicalizeConditionOutcomeFlags(condition);

    expect(rewritten).toBe(2);
    expect(condition.conditions[0]).toMatchObject({ flag: 'encounter_attack_partialVictory' });
    expect((condition.conditions[1] as { condition: { flag: string } }).condition.flag).toBe('encounter_attack_escape');
    expect(condition.conditions[2]).toMatchObject({ flag: 'accepted_quartz' });
  });
});

describe('minting', () => {
  it('mints canonical encounter-outcome spellings', () => {
    const registry = resetFlagRegistry();
    const flag = registry.mintEncounterOutcomeFlag('attack-encounter', 'partial_victory', 'test');
    expect(flag).toBe('encounter_attack_partialVictory');
    expect(registry.isRegistered(flag)).toBe(true);
    expect(registry.kindOf(flag)).toBe('encounter_outcome');
  });

  it('mints canonical tint vocabulary from aliases', () => {
    const registry = resetFlagRegistry();
    expect(registry.mintTintFlag('tint:bold', 'test')).toBe('tint:boldness');
    expect(registry.mintTintFlag('tint:reckless', 'test')).toBe('tint:boldness');
  });

  it('mints seed names on the SeasonPlanner convention', () => {
    const registry = resetFlagRegistry();
    expect(registry.mintTreatmentSeedFlag(1, 3, 'test')).toBe('treatment_seed_ep1_3');
  });
});
