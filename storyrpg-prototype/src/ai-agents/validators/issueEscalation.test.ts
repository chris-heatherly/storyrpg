import { describe, it, expect, afterEach } from 'vitest';
import { isEscalatedIssue, gateDesignNoteLeak, gateWitnessIdIntegrity } from './issueEscalation';

const DESIGN = { message: 'Player-facing text "bridge" leaks meta-narration (addresses "the player").' };
const WITNESS = { message: 'Witness reaction on choice "c1" references unknown NPC "lysandra_brightwell".' };
// Presence PREFERENCE, NOT an integrity bug — the NPC is real/canonical, just not in
// the scene's roster. Must never be escalated to a hard blocker (regression guard:
// a broad /witness reaction/ match once hard-aborted a run on 30 of these).
const WITNESS_NOT_LISTED = { message: 'Witness reaction NPC "char-carmen-iliescu" is not listed in scene "s1-1".' };
const UNRELATED = { message: 'COST score (35) below threshold: the cost is generic.' };

describe('issueEscalation (Fix 5b)', () => {
  afterEach(() => {
    delete process.env.GATE_DESIGN_NOTE_LEAK;
    delete process.env.GATE_WITNESS_ID_INTEGRITY;
  });

  it('by default both design-note and witness-id are on (central registry, post shadow pass)', () => {
    expect(gateDesignNoteLeak()).toBe(true); // default-on after clean shadow data
    expect(gateWitnessIdIntegrity()).toBe(true); // default-on (witnessNpcResolver fix)
    expect(isEscalatedIssue(DESIGN)).toBe(true);
    expect(isEscalatedIssue(WITNESS)).toBe(true);
    expect(isEscalatedIssue(UNRELATED)).toBe(false);
  });

  it('escalates nothing when both flags are explicitly killed (env 0)', () => {
    process.env.GATE_DESIGN_NOTE_LEAK = '0';
    process.env.GATE_WITNESS_ID_INTEGRITY = '0';
    expect(gateDesignNoteLeak()).toBe(false);
    expect(gateWitnessIdIntegrity()).toBe(false);
    expect(isEscalatedIssue(DESIGN)).toBe(false);
    expect(isEscalatedIssue(WITNESS)).toBe(false);
    expect(isEscalatedIssue(UNRELATED)).toBe(false);
  });

  it('escalates only the design-note class when GATE_DESIGN_NOTE_LEAK=1 (witness killed)', () => {
    process.env.GATE_DESIGN_NOTE_LEAK = '1';
    process.env.GATE_WITNESS_ID_INTEGRITY = '0';
    expect(isEscalatedIssue(DESIGN)).toBe(true);
    expect(isEscalatedIssue(WITNESS)).toBe(false);
    expect(isEscalatedIssue(UNRELATED)).toBe(false);
  });

  it('escalates only the witness-id class when GATE_WITNESS_ID_INTEGRITY=1 (design-note killed)', () => {
    process.env.GATE_WITNESS_ID_INTEGRITY = '1';
    process.env.GATE_DESIGN_NOTE_LEAK = '0';
    expect(isEscalatedIssue(WITNESS)).toBe(true);
    expect(isEscalatedIssue(DESIGN)).toBe(false);
    expect(isEscalatedIssue(UNRELATED)).toBe(false);
  });

  it('does NOT escalate the "not listed in scene" presence class, even with witness-id on', () => {
    process.env.GATE_WITNESS_ID_INTEGRITY = '1';
    expect(isEscalatedIssue(WITNESS)).toBe(true); // genuine integrity bug → blocks
    expect(isEscalatedIssue(WITNESS_NOT_LISTED)).toBe(false); // presence preference → advisory
  });

  it('does not escalate the presence class by default either (witness-id default-on)', () => {
    expect(gateWitnessIdIntegrity()).toBe(true);
    expect(isEscalatedIssue(WITNESS_NOT_LISTED)).toBe(false);
  });

  it('never escalates an unrelated advisory finding even with both flags on', () => {
    process.env.GATE_DESIGN_NOTE_LEAK = '1';
    process.env.GATE_WITNESS_ID_INTEGRITY = '1';
    expect(isEscalatedIssue(UNRELATED)).toBe(false);
  });
});
