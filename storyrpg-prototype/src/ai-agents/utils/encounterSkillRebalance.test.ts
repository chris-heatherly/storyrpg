import { describe, expect, it } from 'vitest';
import { rebalanceEncounterSkills } from './encounterSkillRebalance';

/** Encounter with `n` choices, each carrying the given primarySkill. */
function enc(skills: string[]): unknown {
  return { phases: [{ beats: [{ choices: skills.map((s, i) => ({ id: `c${i}`, primarySkill: s })) }] }] };
}

describe('rebalanceEncounterSkills (WS1.4)', () => {
  it('brings an over-cap dominant skill down to ≤40% by reassigning excess slots', () => {
    // 10 slots, 7 perception (70%) → cap = 4.
    const e = enc(['perception', 'perception', 'perception', 'perception', 'perception', 'perception', 'perception', 'persuasion', 'deception', 'investigation']);
    const r = rebalanceEncounterSkills(e);
    expect(r.topShareBefore).toBeCloseTo(0.7);
    expect(r.topShareAfter).toBeLessThanOrEqual(0.4);
    expect(r.changed).toBeGreaterThan(0);
  });

  it('reassigns only to skills already present (stays in the encounter vocabulary)', () => {
    const e = enc(['perception', 'perception', 'perception', 'perception', 'perception', 'persuasion']);
    rebalanceEncounterSkills(e);
    const used = new Set(
      ((e as { phases: Array<{ beats: Array<{ choices: Array<{ primarySkill: string }> }> }> }).phases[0].beats[0].choices).map((c) => c.primarySkill),
    );
    expect([...used].every((s) => s === 'perception' || s === 'persuasion')).toBe(true);
  });

  it('is a no-op (golden parity) when no skill exceeds the cap', () => {
    const e = enc(['perception', 'persuasion', 'deception', 'investigation', 'athletics', 'intimidation']);
    const before = JSON.stringify(e);
    expect(rebalanceEncounterSkills(e).changed).toBe(0);
    expect(JSON.stringify(e)).toBe(before);
  });

  it('is a no-op below the slot floor or with a single skill (cannot rotate)', () => {
    expect(rebalanceEncounterSkills(enc(['perception', 'perception', 'perception'])).changed).toBe(0); // < 6 slots
    expect(rebalanceEncounterSkills(enc(Array(8).fill('perception'))).changed).toBe(0); // only one skill
  });

  it('is idempotent', () => {
    const e = enc(['perception', 'perception', 'perception', 'perception', 'perception', 'persuasion', 'deception']);
    rebalanceEncounterSkills(e);
    expect(rebalanceEncounterSkills(e).changed).toBe(0);
  });
});
