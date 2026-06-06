import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GATE_DEFAULTS, isGateEnabled, gateEnabledPredicate, isShadowLoggingEnabled } from './gateDefaults';

// Save/restore the exact env keys we mutate so tests don't leak state.
const TOUCHED = [
  'GATE_NPC_DEPTH',
  'GATE_DESIGN_NOTE_LEAK',
  'GATE_WITNESS_ID_INTEGRITY',
  'GATE_SETUP_PAYOFF',
  'GATE_UNKNOWN_NEVER_REGISTERED',
  'STORYRPG_GATE_SHADOW',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED) saved[k] = process.env[k];
  for (const k of TOUCHED) delete process.env[k];
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('isGateEnabled', () => {
  it('returns the rolled-out default when no env override is present', () => {
    expect(GATE_DEFAULTS.GATE_NPC_DEPTH).toBe(true);
    expect(isGateEnabled('GATE_NPC_DEPTH')).toBe(true); // Wave 1 default-on
    expect(isGateEnabled('GATE_SETUP_PAYOFF')).toBe(false); // Wave 4, still off
  });

  it('treats an unregistered flag as default-off (old opt-in semantics)', () => {
    expect(isGateEnabled('GATE_UNKNOWN_NEVER_REGISTERED')).toBe(false);
    process.env.GATE_UNKNOWN_NEVER_REGISTERED = '1';
    expect(isGateEnabled('GATE_UNKNOWN_NEVER_REGISTERED')).toBe(true);
  });

  it("env '0' is a kill-switch that overrides a default-on gate", () => {
    process.env.GATE_NPC_DEPTH = '0';
    expect(isGateEnabled('GATE_NPC_DEPTH')).toBe(false);
  });

  it("env '1' force-enables a default-off gate", () => {
    process.env.GATE_SETUP_PAYOFF = '1';
    expect(isGateEnabled('GATE_SETUP_PAYOFF')).toBe(true);
  });

  it('only the exact strings 1/0 override; other values fall through to the default', () => {
    process.env.GATE_NPC_DEPTH = 'true';
    expect(isGateEnabled('GATE_NPC_DEPTH')).toBe(true); // falls through to default true
    process.env.GATE_SETUP_PAYOFF = 'yes';
    expect(isGateEnabled('GATE_SETUP_PAYOFF')).toBe(false); // falls through to default false
  });

  it('design-note-leak is default-on after a clean shadow pass (reversible via env 0)', () => {
    expect(isGateEnabled('GATE_DESIGN_NOTE_LEAK')).toBe(true);
    process.env.GATE_DESIGN_NOTE_LEAK = '0';
    expect(isGateEnabled('GATE_DESIGN_NOTE_LEAK')).toBe(false);
  });

  it('keeps witness-id default-on (validated by witnessNpcResolver fix)', () => {
    expect(isGateEnabled('GATE_WITNESS_ID_INTEGRITY')).toBe(true);
  });

  it('gateEnabledPredicate mirrors isGateEnabled', () => {
    expect(gateEnabledPredicate('GATE_NPC_DEPTH')).toBe(isGateEnabled('GATE_NPC_DEPTH'));
    expect(gateEnabledPredicate('GATE_SETUP_PAYOFF')).toBe(isGateEnabled('GATE_SETUP_PAYOFF'));
  });

  it('shadow logging is on by default and killable via STORYRPG_GATE_SHADOW=0', () => {
    expect(isShadowLoggingEnabled()).toBe(true);
    process.env.STORYRPG_GATE_SHADOW = '0';
    expect(isShadowLoggingEnabled()).toBe(false);
    process.env.STORYRPG_GATE_SHADOW = '1';
    expect(isShadowLoggingEnabled()).toBe(true);
  });
});
