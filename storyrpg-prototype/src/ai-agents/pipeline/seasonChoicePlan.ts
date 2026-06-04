/**
 * Season-level choice-type plan (E1).
 *
 * The 35/30/20/15 expression/relationship/strategic/dilemma mix is a SEASON budget, not
 * a per-episode one — forcing all four into one small episode is wrong (`expression 0% /
 * strategic 0%` in a single episode is fine if the season balances). This module plans
 * the choice landscape ONCE, up front (mirroring how Season Canon plans plant→payoff
 * before authoring), so each episode authors against its slice — no author-all-then-repair.
 *
 *   - The SeasonPlanner (LLM) identifies the choice MOMENTS across the master narrative
 *     (what each decision is, which episode, and whether it pays off now or later).
 *   - This module (deterministic, "canon disposes") assigns each moment a `choiceType` to
 *     hit the season budget, reusing the largest-remainder allocation over the FULL moment
 *     list instead of one episode.
 *   - A "pays off later" moment is literally a Season Canon promise with an explicit
 *     `payoffEpisode` → `spineEntriesFromChoicePlan` feeds the existing `SpinePlantMap`.
 *
 * Pure + unit-testable.
 */

import type { ChoiceType, ChoiceTypeTarget } from './choiceTypePlanner';
import { allocateChoiceTypeCounts, DEFAULT_CHOICE_TYPE_TARGET } from './choiceTypePlanner';

const ORDER: ChoiceType[] = ['expression', 'relationship', 'strategic', 'dilemma'];

export type ChoicePayoff = 'immediate' | { payoffEpisode: number; payoffEpisodeLatest?: number };

export interface SeasonChoiceMoment {
  id: string;
  episode: number;
  /** What the decision is, tied to the arc / seven-point beat (LLM-authored). */
  anchor: string;
  /** When the choice pays off — now, or a specific later episode (a promise). */
  payoff: ChoicePayoff;
  /** Optional flag the choice sets (used to seed the promise / SpinePlantMap). */
  flag?: string;
  /** Assigned by assignSeasonChoiceTypes. */
  choiceType?: ChoiceType;
}

export interface SeasonChoicePlan {
  moments: SeasonChoiceMoment[];
  /** The season-wide target counts the assignment hit (for diagnostics). */
  counts: Record<ChoiceType, number>;
}

function isLaterPayoff(p: ChoicePayoff): p is { payoffEpisode: number } {
  return typeof p === 'object' && p !== null && typeof (p as { payoffEpisode?: number }).payoffEpisode === 'number';
}

/**
 * Assign a `choiceType` to every moment to hit the budget ACROSS the whole season.
 * Later-payoff moments (which carry cross-episode weight) are filled first from the
 * non-expression slots, so the rare high-stakes types land on consequential choices.
 */
export function assignSeasonChoiceTypes(
  moments: SeasonChoiceMoment[],
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): SeasonChoicePlan {
  const n = moments.length;
  const counts = allocateChoiceTypeCounts(n, target);

  // Build the slot pool in type order.
  const pool: ChoiceType[] = [];
  for (const t of ORDER) for (let k = 0; k < counts[t]; k++) pool.push(t);

  const takeSlot = (predicate: (t: ChoiceType) => boolean): ChoiceType | undefined => {
    const idx = pool.findIndex(predicate);
    return idx === -1 ? undefined : pool.splice(idx, 1)[0];
  };

  // Later-payoff moments first (they're the consequential ones); stable by episode.
  const order = [...moments]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => Number(isLaterPayoff(b.m.payoff)) - Number(isLaterPayoff(a.m.payoff)) || a.m.episode - b.m.episode || a.i - b.i);

  const assignedById = new Map<string, ChoiceType>();
  for (const { m } of order) {
    const wantNonExpression = isLaterPayoff(m.payoff);
    let slot = wantNonExpression ? takeSlot((t) => t !== 'expression') : takeSlot(() => true);
    if (!slot) slot = takeSlot(() => true) ?? (wantNonExpression ? 'strategic' : 'expression');
    assignedById.set(m.id, slot);
  }

  return {
    moments: moments.map((m) => ({ ...m, choiceType: assignedById.get(m.id) })),
    counts,
  };
}

/** The choice moments assigned to a given episode (for StoryArchitect to author). */
export function momentsForEpisode(plan: SeasonChoicePlan | undefined, episode: number): SeasonChoiceMoment[] {
  return (plan?.moments ?? []).filter((m) => m.episode === episode);
}

/**
 * Spine plant→payoff entries for the later-payoff moments, so the promise-due gate
 * enforces them at the right episode. Shape matches `SpinePlantEntry` (spinePlantMap.ts).
 */
export function spineEntriesFromChoicePlan(
  plan: SeasonChoicePlan | undefined,
): Array<{ flag?: string; hookId?: string; payoffEpisode: number; payoffEpisodeLatest?: number }> {
  const out: Array<{ flag?: string; payoffEpisode: number; payoffEpisodeLatest?: number }> = [];
  for (const m of plan?.moments ?? []) {
    if (!isLaterPayoff(m.payoff) || !m.flag) continue;
    out.push({
      flag: m.flag,
      payoffEpisode: m.payoff.payoffEpisode,
      payoffEpisodeLatest: (m.payoff as { payoffEpisodeLatest?: number }).payoffEpisodeLatest,
    });
  }
  return out;
}
