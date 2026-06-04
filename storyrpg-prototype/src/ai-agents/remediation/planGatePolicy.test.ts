import { describe, expect, it } from 'vitest';
import { PLAN_GATE_FLAGS, shouldGate } from './planGatePolicy';

const allOff = () => false;
const enable =
  (...flags: string[]) =>
  (flag: string) =>
    flags.includes(flag);

const FLAG = PLAN_GATE_FLAGS.setupPayoff;

describe('planGatePolicy', () => {
  it('exposes the four Bucket D plan-gate flags', () => {
    expect(PLAN_GATE_FLAGS).toEqual({
      setupPayoff: 'GATE_SETUP_PAYOFF',
      callbackCoverage: 'GATE_CALLBACK_COVERAGE',
      choiceDistribution: 'GATE_CHOICE_DISTRIBUTION',
      arcPressure: 'GATE_ARC_PRESSURE',
    });
  });

  it('does not gate when the flag is off even with error issues (default-off)', () => {
    const issues = [{ severity: 'error' }, { severity: 'error' }, { severity: 'warning' }];
    expect(shouldGate(FLAG, issues, allOff)).toEqual({ gate: false, blockingCount: 2 });
  });

  it('gates when the flag is on and error issues exist, with the correct count', () => {
    const issues = [{ severity: 'error' }, { severity: 'warning' }, { severity: 'error' }];
    expect(shouldGate(FLAG, issues, enable(FLAG))).toEqual({ gate: true, blockingCount: 2 });
  });

  it('does not gate when the flag is on but only warnings are present', () => {
    const issues = [{ severity: 'warning' }, { severity: 'info' }];
    expect(shouldGate(FLAG, issues, enable(FLAG))).toEqual({ gate: false, blockingCount: 0 });
  });

  it('does not gate on an empty issue list', () => {
    expect(shouldGate(FLAG, [], enable(FLAG))).toEqual({ gate: false, blockingCount: 0 });
  });

  it('only gates the rule whose flag is enabled', () => {
    const issues = [{ severity: 'error' }];
    expect(
      shouldGate(PLAN_GATE_FLAGS.callbackCoverage, issues, enable(PLAN_GATE_FLAGS.setupPayoff)),
    ).toEqual({ gate: false, blockingCount: 1 });
    expect(
      shouldGate(PLAN_GATE_FLAGS.callbackCoverage, issues, enable(PLAN_GATE_FLAGS.callbackCoverage)),
    ).toEqual({ gate: true, blockingCount: 1 });
  });
});
