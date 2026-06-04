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
 * Assign a `choiceType` to every moment to hit the budget ACROSS the whole season —
 * while keeping each EPISODE's slice balanced. A naive type-ordered pool drain front-loads
 * all expression into the early episodes and all dilemma into the last (so a partial or
 * early-read run ships a single-type mix — strictly worse than per-episode 35/30/20/15).
 *
 * Instead we process moments in EPISODE order and, at each step, pick the type that is most
 * "behind schedule" relative to its season target (deficit round-robin / Bresenham spread).
 * That interleaves the four types evenly across the sequence, so each episode's contiguous
 * moments get a proportional mix and the season totals still equal `counts`. Later-payoff
 * moments (cross-episode weight) avoid 'expression' so the rare high-stakes types land on
 * the consequential choices.
 */
export function assignSeasonChoiceTypes(
  moments: SeasonChoiceMoment[],
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): SeasonChoicePlan {
  const n = moments.length;
  const counts = allocateChoiceTypeCounts(n, target);
  const remaining: Record<ChoiceType, number> = { ...counts };
  const assigned: Record<ChoiceType, number> = { expression: 0, relationship: 0, strategic: 0, dilemma: 0 };

  // Episode order (stable) so the even spread tracks the season's progression.
  const order = [...moments]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.episode - b.m.episode || a.i - b.i);

  const assignedById = new Map<string, ChoiceType>();
  let placed = 0;
  for (const { m } of order) {
    placed++;
    const wantNonExpression = isLaterPayoff(m.payoff);
    const allowed = (t: ChoiceType) => remaining[t] > 0 && (!wantNonExpression || t !== 'expression');

    // Pick the allowed type with the largest target-vs-assigned deficit at this position.
    let best: ChoiceType | undefined;
    let bestDeficit = -Infinity;
    for (const t of ORDER) {
      if (!allowed(t)) continue;
      const deficit = counts[t] * (placed / n) - assigned[t];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = t;
      }
    }
    // Fallbacks if the constrained pool was empty (e.g. only expression slots left for a
    // later-payoff moment): take any remaining slot, then a last-resort default.
    if (!best) for (const t of ORDER) if (remaining[t] > 0) { best = t; break; }
    if (!best) best = wantNonExpression ? 'strategic' : 'expression';

    remaining[best] = Math.max(0, remaining[best] - 1);
    assigned[best] += 1;
    assignedById.set(m.id, best);
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

export interface SeasonChoiceStructureInput {
  /** Episode numbers in season order. */
  episodes: number[];
  /** Expected choice points per episode (from the season plan's targetChoicesPerEpisode). */
  choicesPerEpisode: number;
  /** Cross-episode branches → later-payoff moments anchored at their setup episode. */
  crossEpisode?: Array<{ flag?: string; setupEpisode: number; payoffEpisode: number; anchor?: string }>;
}

/**
 * Build the season choice plan from the season structure (deterministic backbone — the
 * SeasonPlanner LLM can later supply richer `anchor`s, but the type allocation works from
 * the structure alone). Cross-episode branches become later-payoff (consequential) moments;
 * the rest are filled in as immediate per-episode decisions up to `choicesPerEpisode`.
 */
export function buildSeasonChoicePlan(
  input: SeasonChoiceStructureInput,
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): SeasonChoicePlan {
  const moments: SeasonChoiceMoment[] = [];
  for (const [idx, c] of (input.crossEpisode ?? []).entries()) {
    moments.push({
      id: `cross-${c.setupEpisode}-${idx}`,
      episode: c.setupEpisode,
      anchor: c.anchor ?? `cross-episode decision (pays off ep ${c.payoffEpisode})`,
      payoff: { payoffEpisode: c.payoffEpisode },
      flag: c.flag,
    });
  }
  const perEpisode = Math.max(0, Math.floor(input.choicesPerEpisode));
  for (const ep of input.episodes) {
    const already = moments.filter((m) => m.episode === ep).length;
    for (let k = already; k < perEpisode; k++) {
      moments.push({ id: `ep${ep}-c${k}`, episode: ep, anchor: 'episode decision', payoff: 'immediate' });
    }
  }
  return assignSeasonChoiceTypes(moments, target);
}

/** A planner-emitted choice-moment seed (E1 slice 4 — SeasonChoiceMomentSeed shape). */
export interface ChoiceMomentSeed {
  id: string;
  episode: number;
  anchor: string;
  paysOffEpisode?: number;
  flag?: string;
}

/** Minimal SeasonPlan shape (avoids importing the full type into pure code). */
interface SeasonPlanLike {
  episodes?: Array<{ episodeNumber: number }>;
  crossEpisodeBranches?: Array<{ originEpisode: number; name?: string; reconvergence?: { episodeNumber?: number } }>;
  preferences?: { targetChoicesPerEpisode?: number };
  choiceMoments?: ChoiceMomentSeed[];
}

/**
 * Build the season choice plan directly from planner-emitted moment seeds (E1 slice 4).
 * A seed that pays off in a later episode becomes a later-payoff (promise) moment; the
 * type allocation runs over the full season list. Used in preference to the deterministic
 * derivation when the planner identified the moments creatively.
 */
export function seasonChoicePlanFromMoments(
  seeds: ChoiceMomentSeed[],
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): SeasonChoicePlan {
  const moments: SeasonChoiceMoment[] = seeds.map((s) => {
    const laterPayoff = typeof s.paysOffEpisode === 'number' && s.paysOffEpisode > s.episode;
    return {
      id: s.id,
      episode: s.episode,
      anchor: s.anchor,
      payoff: laterPayoff ? { payoffEpisode: s.paysOffEpisode as number } : ('immediate' as const),
      flag: s.flag,
    };
  });
  return assignSeasonChoiceTypes(moments, target);
}

/**
 * Build the season choice plan from a SeasonPlan (the pipeline entry point). Falls back to
 * a single-episode plan when no season plan exists (the Endsong case — its one episode is
 * the whole "season"). Cross-episode branches become later-payoff moments at their origin.
 */
export function seasonChoicePlanFromSeasonPlan(
  seasonPlan: SeasonPlanLike | undefined,
  fallback: { episode: number; choicesPerEpisode: number },
  target: ChoiceTypeTarget = DEFAULT_CHOICE_TYPE_TARGET,
): SeasonChoicePlan {
  // E1 slice 4: prefer the planner's creatively-identified choice moments when present.
  const seeds = (seasonPlan?.choiceMoments ?? []).filter(
    (m): m is ChoiceMomentSeed => !!m && typeof m.episode === 'number' && typeof m.anchor === 'string' && !!m.id,
  );
  if (seeds.length > 0) {
    return seasonChoicePlanFromMoments(seeds, target);
  }

  const episodes = (seasonPlan?.episodes ?? [])
    .map((e) => e.episodeNumber)
    .filter((n): n is number => typeof n === 'number');
  const choicesPerEpisode = seasonPlan?.preferences?.targetChoicesPerEpisode ?? fallback.choicesPerEpisode;
  const crossEpisode = (seasonPlan?.crossEpisodeBranches ?? [])
    .filter((b) => typeof b?.originEpisode === 'number')
    .map((b) => ({
      setupEpisode: b.originEpisode,
      payoffEpisode: b.reconvergence?.episodeNumber ?? b.originEpisode,
      anchor: b.name,
    }));
  return buildSeasonChoicePlan(
    {
      episodes: episodes.length ? episodes : [fallback.episode],
      choicesPerEpisode: Math.max(1, Math.floor(choicesPerEpisode)),
      crossEpisode,
    },
    target,
  );
}

/** Per-type counts the season plan assigned to one episode (drives its per-episode allocation). */
export function episodeTypeCounts(
  plan: SeasonChoicePlan | undefined,
  episode: number,
): Record<ChoiceType, number> {
  const counts: Record<ChoiceType, number> = { expression: 0, relationship: 0, strategic: 0, dilemma: 0 };
  for (const m of momentsForEpisode(plan, episode)) {
    if (m.choiceType) counts[m.choiceType] += 1;
  }
  return counts;
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
