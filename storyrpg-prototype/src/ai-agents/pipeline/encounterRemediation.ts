/**
 * Encounter remediation — pure helpers for keeping a degraded encounter HONEST.
 *
 * When the phased encounter build loses phases (e.g. Phase 2 branch situations
 * fail), the encounter ends up with fewer authored rounds than its goal/threat
 * clocks imply (the Endsong bug: 1 authored phase / 3 choices against a goal=6 /
 * threat=4 clock). Rather than ship template filler for the uncovered segments,
 * `shrinkClockToCoverage` recomputes the clocks DOWN to what the authored
 * content can actually deliver — never up, never inventing ticks. The clocks are
 * mechanical metadata, so this changes no player-facing prose and keeps the
 * fiction-first contract intact.
 *
 * Pure + dependency-free so it can be unit-tested and called from either the
 * agent (post-assembly) or the pipeline without importing the monolith.
 */

interface ClockLike {
  segments?: number;
  filled?: number;
}
interface BeatLike {
  choices?: unknown[];
  isTerminal?: boolean;
}
interface PhaseLike {
  beats?: BeatLike[];
}
export interface EncounterCoverageShape {
  goalClock?: ClockLike;
  threatClock?: ClockLike;
  /** Runtime story encounter shape. */
  phases?: PhaseLike[];
  /** Agent EncounterStructure shape (top-level beats, no phases). */
  beats?: BeatLike[];
}

export interface AuthoredCoverage {
  authoredPhases: number;
  authoredChoices: number;
  goalSegments: number;
  threatSegments: number;
}

/** Count the authored interaction surface of an encounter (handles both the
 * runtime `phases[].beats[]` shape and the agent `beats[]` shape). */
export function computeAuthoredCoverage(enc: EncounterCoverageShape): AuthoredCoverage {
  const phases: PhaseLike[] = enc.phases && enc.phases.length > 0
    ? enc.phases
    : (enc.beats ? [{ beats: enc.beats }] : []);
  let authoredChoices = 0;
  for (const phase of phases) {
    for (const beat of phase.beats || []) {
      authoredChoices += Array.isArray(beat.choices) ? beat.choices.length : 0;
    }
  }
  return {
    authoredPhases: phases.length,
    authoredChoices,
    goalSegments: enc.goalClock?.segments ?? 0,
    threatSegments: enc.threatClock?.segments ?? 0,
  };
}

/**
 * True when the encounter's clocks demand more progression than the authored
 * phases/choices can plausibly deliver. Heuristic: a single-phase encounter can
 * realistically fill at most one goal segment per authored choice; if the goal
 * clock exceeds that, it's under-covered. Multi-phase encounters (branching
 * rounds) are assumed to cover their clocks.
 */
export function isClockUnderCovered(enc: EncounterCoverageShape): boolean {
  const c = computeAuthoredCoverage(enc);
  if (c.goalSegments <= 0) return false;
  if (c.authoredPhases >= 2) return false; // branching rounds cover the clock
  return c.authoredChoices < c.goalSegments;
}

/**
 * Shrink the goal/threat clocks DOWN to the authored coverage of a single-phase
 * encounter. Goal → number of authored choices (≥1); threat scaled by the same
 * ratio (preserving the goal:threat balance, e.g. 6/4 → 3/2). Never raises a
 * clock and never touches a multi-phase (covered) encounter. Returns true if it
 * changed anything.
 */
export function shrinkClockToCoverage(enc: EncounterCoverageShape): boolean {
  if (!isClockUnderCovered(enc)) return false;
  const c = computeAuthoredCoverage(enc);
  const newGoal = Math.max(1, Math.min(c.goalSegments, c.authoredChoices || 1));
  if (newGoal >= c.goalSegments) return false;

  let changed = false;
  if (enc.goalClock && typeof enc.goalClock.segments === 'number') {
    enc.goalClock.segments = newGoal;
    if (typeof enc.goalClock.filled === 'number') {
      enc.goalClock.filled = Math.min(enc.goalClock.filled, newGoal);
    }
    changed = true;
  }
  if (enc.threatClock && typeof enc.threatClock.segments === 'number' && c.threatSegments > 0) {
    const ratio = newGoal / c.goalSegments;
    const newThreat = Math.max(1, Math.round(c.threatSegments * ratio));
    if (newThreat < enc.threatClock.segments) {
      enc.threatClock.segments = newThreat;
      if (typeof enc.threatClock.filled === 'number') {
        enc.threatClock.filled = Math.min(enc.threatClock.filled, newThreat);
      }
    }
    changed = true;
  }
  return changed;
}
