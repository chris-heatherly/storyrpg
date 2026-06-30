/**
 * Expected-skill curve (Plan Part 5 §Competence loop step 5; Part 11 #7), used by
 * the competence loop gated upstream by `consequenceFlags().competence`
 * (`CHARGE_COMPETENCE`).
 *
 * The no-dead-wall check and the difficulty curve both need to predict the
 * player's skill/attribute level at a given spine position. Players vary — side
 * content is optional — so we never assume the median player. Instead we estimate
 * a **band** per skill per spine position (Part 11 #7):
 *
 *   - `min`      — the level a player who skips all *optional* growth still has
 *                  (mandatory deltas only): the floor.
 *   - `expected` — the level the *typical* player reaches (mandatory growth plus
 *                  the planned fraction of optional growth they engage). Challenge
 *                  is tuned to THIS.
 *   - `max`      — the level a completionist who takes every reachable growth path
 *                  reaches: the ceiling. A *required* payoff is gated against THIS
 *                  (if even the max can't reach the gate, the wall is a dead wall).
 *
 * The curve is read from the planned skill/attribute trajectory (authored growth
 * steps), NOT assumed flat (Part 5 step 5). Each growth step lands at a spine
 * position and adds a signed delta; optional (side-content) growth only counts
 * toward `expected` (by an authored/ default engagement fraction) and `max`.
 *
 * Pure and deterministic — no clock, no randomness; the same trajectory always
 * yields the same band. Generator-internal (fiction-first: never reaches the
 * player).
 */

/**
 * The fraction of an *optional* (side-content) growth step the EXPECTED (typical)
 * player is assumed to engage. Conservative by design (Part 11 #7: never assume
 * the median takes all side content). Mandatory growth always counts in full.
 * A step may override this with its own `engagement`.
 */
export const DEFAULT_OPTIONAL_ENGAGEMENT = 0.5;

/**
 * One authored growth step on a skill/attribute trajectory: at spine position
 * `position`, the dimension `skill` changes by `delta`. A step is `optional`
 * (side content — counts fully toward `max`, partially toward `expected`, not at
 * all toward `min`) or mandatory (counts toward all three bands).
 */
export interface SkillGrowthStep {
  /** Skill/attribute key the step moves (matches gate keys). */
  skill: string;
  /**
   * Spine position the growth lands at (episode number or any monotonic spine
   * ordinal). Growth lands AT this position — a gate at the same position sees it.
   */
  position: number;
  /** Signed level change (usually positive — growth — but losses are allowed). */
  delta: number;
  /**
   * True when this growth is OPTIONAL side content (skippable). Optional growth
   * counts fully toward `max`, by `engagement` toward `expected`, and not at all
   * toward `min`. Mandatory (false/undefined) growth counts toward all bands.
   */
  optional?: boolean;
  /**
   * Override of {@link DEFAULT_OPTIONAL_ENGAGEMENT} for THIS optional step — the
   * fraction of its delta the expected player is assumed to gain. Ignored for
   * mandatory steps. Authored when the planner knows engagement for a strand.
   */
  engagement?: number;
}

/** The planned starting level of a skill/attribute before any growth. */
export interface SkillBaseline {
  skill: string;
  /** Starting level at the season's first spine position. */
  level: number;
}

/** A min/expected/max band for one skill at one spine position. */
export interface SkillBand {
  min: number;
  expected: number;
  max: number;
}

/** Input to {@link buildExpectedSkillCurve}: baselines + the planned growth steps. */
export interface ExpectedSkillCurveInput {
  /** Starting level per skill/attribute (default 0 when omitted). */
  baselines?: SkillBaseline[];
  /** Authored growth steps across the spine (mandatory + optional). */
  growth: SkillGrowthStep[];
}

/**
 * The expected-skill curve: a band per skill per spine position. Query it for the
 * winnability check (`bandAt`) — gate a *required* payoff against `max`, tune
 * challenge to `expected`.
 */
export interface ExpectedSkillCurve {
  /** Skills/attributes present in the curve. */
  skills: string[];
  /**
   * `bandAt(skill, position)` — the band at the given spine position (inclusive
   * of growth landing at or before `position`). Pure.
   */
  bandAt(skill: string, position: number): SkillBand;
}

/** The expected-player gain from a single growth step (full if mandatory). */
function expectedGain(step: SkillGrowthStep): number {
  if (!step.optional) return step.delta;
  const engagement = step.engagement ?? DEFAULT_OPTIONAL_ENGAGEMENT;
  return step.delta * engagement;
}

/**
 * Build the expected-skill curve from a planned trajectory (Plan Part 5 step 5 /
 * Part 11 #7). For each skill, accumulate growth in spine-position order into the
 * three bands:
 *
 *   - `min`      gains only MANDATORY deltas;
 *   - `expected` gains mandatory deltas in full + optional deltas × engagement;
 *   - `max`      gains every delta in full (mandatory + optional).
 *
 * The band at a position reflects all growth landing AT or BEFORE that position.
 * Querying a position before the first growth returns the baseline in all three
 * bands. Pure / deterministic — steps are sorted by `(position, original index)`
 * so equal positions keep input order and the result never depends on input
 * ordering instability.
 */
export function buildExpectedSkillCurve(
  input: ExpectedSkillCurveInput,
): ExpectedSkillCurve {
  const baseline = new Map<string, number>();
  for (const b of input.baselines ?? []) {
    baseline.set(b.skill, b.level);
  }

  // Group growth steps by skill, in stable (position, index) order.
  const stepsBySkill = new Map<string, SkillGrowthStep[]>();
  const order = new Map<SkillGrowthStep, number>();
  input.growth.forEach((s, i) => order.set(s, i));
  for (const step of input.growth) {
    const list = stepsBySkill.get(step.skill);
    if (list) list.push(step);
    else stepsBySkill.set(step.skill, [step]);
  }
  for (const list of stepsBySkill.values()) {
    list.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });
  }

  const skills = [
    ...new Set<string>([...baseline.keys(), ...stepsBySkill.keys()]),
  ];

  const bandAt = (skill: string, position: number): SkillBand => {
    const base = baseline.get(skill) ?? 0;
    let min = base;
    let expected = base;
    let max = base;
    const steps = stepsBySkill.get(skill) ?? [];
    for (const step of steps) {
      if (step.position > position) break; // sorted: nothing later qualifies
      max += step.delta;
      expected += expectedGain(step);
      if (!step.optional) min += step.delta;
    }
    return { min, expected, max };
  };

  return { skills, bandAt };
}
