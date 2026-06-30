import { describe, expect, it } from 'vitest';
import {
  computeAuthoredCoverage,
  isClockUnderCovered,
  shrinkClockToCoverage,
} from './encounterRemediation';

const singlePhase = (choices: number, goal: number, threat: number) => ({
  goalClock: { name: 'g', segments: goal, filled: 0 },
  threatClock: { name: 't', segments: threat, filled: 0 },
  phases: [{ beats: [{ choices: Array.from({ length: choices }, (_, i) => ({ id: `c${i}` })) }] }],
});

describe('computeAuthoredCoverage', () => {
  it('counts choices from the runtime phases[].beats[] shape', () => {
    expect(computeAuthoredCoverage(singlePhase(3, 6, 4))).toMatchObject({
      authoredPhases: 1, authoredChoices: 3, goalSegments: 6, threatSegments: 4,
    });
  });

  it('counts choices from the agent top-level beats[] shape', () => {
    const agentShape = {
      goalClock: { segments: 6 }, threatClock: { segments: 4 },
      beats: [{ choices: [{}, {}, {}] }, { choices: [{}, {}, {}] }],
    };
    expect(computeAuthoredCoverage(agentShape)).toMatchObject({ authoredPhases: 1, authoredChoices: 6 });
  });
});

describe('isClockUnderCovered', () => {
  it('flags a single-phase encounter whose goal exceeds its choices (the Endsong bug)', () => {
    expect(isClockUnderCovered(singlePhase(3, 6, 4))).toBe(true);
  });
  it('does not flag when choices cover the goal', () => {
    expect(isClockUnderCovered(singlePhase(6, 6, 4))).toBe(false);
  });
  it('does not flag a multi-phase (branching) encounter', () => {
    const multi = {
      goalClock: { segments: 6 }, threatClock: { segments: 4 },
      phases: [{ beats: [{ choices: [{}, {}] }] }, { beats: [{ choices: [{}, {}] }] }],
    };
    expect(isClockUnderCovered(multi)).toBe(false);
  });
});

describe('shrinkClockToCoverage', () => {
  it('shrinks 6/4 → 3/2 for a 3-choice single-phase encounter and reports the change', () => {
    const enc = singlePhase(3, 6, 4);
    expect(shrinkClockToCoverage(enc)).toBe(true);
    expect(enc.goalClock.segments).toBe(3);
    expect(enc.threatClock.segments).toBe(2);
  });

  it('never raises a clock and is a no-op when already covered', () => {
    const enc = singlePhase(6, 6, 4);
    expect(shrinkClockToCoverage(enc)).toBe(false);
    expect(enc.goalClock.segments).toBe(6);
    expect(enc.threatClock.segments).toBe(4);
  });

  it('leaves multi-phase encounters untouched', () => {
    const multi = {
      goalClock: { segments: 6 }, threatClock: { segments: 4 },
      phases: [{ beats: [{ choices: [{}, {}] }] }, { beats: [{ choices: [{}, {}] }] }],
    };
    expect(shrinkClockToCoverage(multi)).toBe(false);
    expect(multi.goalClock.segments).toBe(6);
  });

  it('clamps filled to the new segment count', () => {
    const enc = { ...singlePhase(2, 6, 4) };
    enc.goalClock.filled = 5;
    shrinkClockToCoverage(enc);
    expect(enc.goalClock.segments).toBe(2);
    expect(enc.goalClock.filled).toBeLessThanOrEqual(2);
  });
});
