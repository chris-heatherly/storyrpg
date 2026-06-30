/**
 * Unit tests for the consequence-intelligence feature-flag reader.
 *
 * The reader must be DEFAULT-OFF (every flag false when its var is unset),
 * activate a flag only on the exact string '1', and be UNCACHED so a mid-run
 * env change is observed on the next call.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { consequenceFlags } from './consequenceFlags';

const FLAG_VARS = [
  'CONSEQUENCE_POSITIONAL',
  'CONSEQUENCE_TWO_POP',
  'CONSEQUENCE_CHARGE',
  'CONVERGENCE_LEDGER',
  'CHARGE_STATS',
  'CHARGE_COMPETENCE',
  'GATE_CHARGE_MATERIALIZATION',
] as const;

function clearFlags(): void {
  for (const v of FLAG_VARS) delete process.env[v];
}

afterEach(clearFlags);

describe('consequenceFlags', () => {
  it('is default-off: every flag false when no env var is set', () => {
    clearFlags();
    expect(consequenceFlags()).toEqual({
      positional: false,
      twoPop: false,
      charge: false,
      ledger: false,
      chargeStats: false,
      competence: false,
      materializationGate: false,
    });
  });

  it("maps each env var to its flag when === '1'", () => {
    clearFlags();
    process.env.CONSEQUENCE_POSITIONAL = '1';
    process.env.CONSEQUENCE_TWO_POP = '1';
    process.env.CONSEQUENCE_CHARGE = '1';
    process.env.CONVERGENCE_LEDGER = '1';
    process.env.CHARGE_STATS = '1';
    process.env.CHARGE_COMPETENCE = '1';
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    expect(consequenceFlags()).toEqual({
      positional: true,
      twoPop: true,
      charge: true,
      ledger: true,
      chargeStats: true,
      competence: true,
      materializationGate: true,
    });
  });

  it("treats any value other than '1' as off", () => {
    clearFlags();
    process.env.CONSEQUENCE_CHARGE = 'true';
    process.env.CONVERGENCE_LEDGER = '0';
    process.env.CHARGE_STATS = '';
    process.env.CHARGE_COMPETENCE = '11';
    const flags = consequenceFlags();
    expect(flags.charge).toBe(false);
    expect(flags.ledger).toBe(false);
    expect(flags.chargeStats).toBe(false);
    expect(flags.competence).toBe(false);
  });

  it('is uncached: re-reads env on every call', () => {
    clearFlags();
    expect(consequenceFlags().positional).toBe(false);
    process.env.CONSEQUENCE_POSITIONAL = '1';
    expect(consequenceFlags().positional).toBe(true);
    delete process.env.CONSEQUENCE_POSITIONAL;
    expect(consequenceFlags().positional).toBe(false);
  });
});
