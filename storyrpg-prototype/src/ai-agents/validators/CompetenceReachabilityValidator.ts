/**
 * Competence Reachability Validator (Plan Part 9, the no-dead-wall guard; Part 5
 * §Competence loop). Advisory unless the caller gates it.
 *
 * The competence loop is a `lock → fail-forward → grow → overcome` arc (Part 5).
 * This validator holds its three story-first invariants as code (not comments),
 * reading the planned **expected-skill curve** (a min/expected/max band per skill
 * per spine position — never the flat median player, Part 11 #7):
 *
 *  1. **No dead walls (winnability).** For every skill/attribute-gated heavy
 *     moment, classify the wall against the curve:
 *
 *     | Case | Expected vs gate `N` | Verdict |
 *     |---|---|---|
 *     | **winnable-now**   | `expected ≥ N` at the wall | a fair check (ok) |
 *     | **winnable-later** | `expected < N` now, but `max` reaches `N` before a *required* payoff AND a growth path + a return opportunity both exist | a deliberate roadblock (ok) |
 *     | **never-winnable** | even `max` never reaches `N` before it is required | ILLEGAL dead wall (ERROR) |
 *
 *     A required payoff gated against the achievable `max` (Part 11 #7): if even a
 *     completionist cannot reach `N` before the gate is required, the wall is a
 *     dead end — lower the gate, add a growth path, or make it fail-forward-only.
 *
 *  2. **No dangling growth.** A skill/attribute *gain* that unlocks NO downstream
 *     wall is uncharged texture — the same defect as a hollow branch (Part 5
 *     step 4). Flagged so side-content growth stays load-bearing.
 *
 *  3. **No fail-forward gaps.** A failed-check arm must `leadsTo` a continuing,
 *     different path — every failure must continue (Part 5 step 3). A failure arm
 *     that leads nowhere is a dead end (punishment/reload), not fail-forward.
 *
 * Pure / deterministic — reads the plan's scene order and the expected-skill
 * curve; no clock, no randomness. Generator-internal (fiction-first).
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { ConsequenceTier, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { SkillRoadblock } from '../pipeline/convergenceLedgerBuilder';
import {
  buildExpectedSkillCurve,
  type SkillGrowthStep,
  type ExpectedSkillCurve,
} from '../pipeline/expectedSkillCurve';

/** Heaviness rank for consequence tiers (heavy = branchlet/branch). */
const TIER_RANK: Record<ConsequenceTier, number> = {
  callback: 0,
  tint: 1,
  branchlet: 2,
  branch: 3,
};
const HEAVY_RANK = TIER_RANK.branchlet;

/**
 * A failed-check arm that must continue (Part 5 step 3 — fail-forward). The
 * caller (EncounterArchitect / ChoiceAuthor projection) supplies, per gated
 * moment, which failure arms exist and where each leads. An arm whose `leadsTo`
 * is empty is a fail-forward GAP (a dead end).
 */
export interface FailForwardArm {
  /** The gated scene/encounter this failure arm belongs to. */
  sceneId: string;
  /** Human-readable arm label (e.g. "defeat", "partial", "escape"). */
  arm: string;
  /**
   * Scene/storylet the failed arm continues into. EMPTY (undefined / blank) =
   * fail-forward gap: the failure leads nowhere (punishment/reload, not forward).
   */
  leadsTo?: string;
}

/** Context for {@link CompetenceReachabilityValidator.validate}. */
export interface CompetenceReachabilityContext {
  /** The planned competence roadblocks (skill/attribute walls). */
  roadblocks: SkillRoadblock[];
  /** The authored skill/attribute growth steps (mandatory + optional side content). */
  growth?: SkillGrowthStep[];
  /** Baselines per skill (default 0). */
  baselines?: { skill: string; level: number }[];
  /** Failed-check arms to check for fail-forward gaps. */
  failForwardArms?: FailForwardArm[];
}

/** Per-wall winnability classification (diagnostics). */
export type WinnabilityVerdict = 'winnable-now' | 'winnable-later' | 'never-winnable';

export class CompetenceReachabilityValidator extends BaseValidator {
  constructor() {
    super('CompetenceReachabilityValidator');
  }

  validate(plan: SeasonScenePlan, ctx: CompetenceReachabilityContext): ValidationResult {
    const issues: ValidationIssue[] = [];

    const sceneById = new Map<string, PlannedScene>();
    for (const s of plan.scenes) sceneById.set(s.id, s);

    // Spine position of a scene = its episode number (the monotonic spine ordinal
    // growth steps are keyed against). A wall "before its required payoff" means
    // the growth must land at or before the gated scene's episode.
    const positionOf = (sceneId: string): number | undefined =>
      sceneById.get(sceneId)?.episodeNumber;

    const curve: ExpectedSkillCurve = buildExpectedSkillCurve({
      baselines: ctx.baselines,
      growth: ctx.growth ?? [],
    });

    // Skills that have ANY growth step, and the latest position the `max` band
    // reaches each gate — used both for winnable-later and dangling-growth.
    const growth = ctx.growth ?? [];

    // --- 1) Winnability per wall ---------------------------------------------
    // Track which skills are actually gated by some wall (for dangling-growth).
    const gatedSkills = new Set<string>();

    for (const wall of ctx.roadblocks) {
      gatedSkills.add(wall.skill);

      // No anchorless walls (story-first): a roadblock must name its authored
      // object. (The builder drops these, but a caller may validate pre-build.)
      const anchor = typeof wall.anchorId === 'string' ? wall.anchorId.trim() : '';
      if (anchor.length === 0) {
        issues.push(this.error(
          `Competence roadblock on skill "${wall.skill}" (gate ${wall.gateLevel}) at "${wall.to}" has no anchorId; a wall must name the authored test milestone / competence thread it serves.`,
          `competenceWall:${wall.to}`,
          'Anchor the wall on an ArcMilestone(phase:\'test\') or a competence thread, or drop it (no anchorless skill walls).',
        ));
      }

      const pos = positionOf(wall.to);
      if (pos === undefined) {
        issues.push(this.warning(
          `Competence roadblock references scene "${wall.to}" not present in the plan; cannot classify its winnability.`,
          `competenceWall:${wall.to}`,
          'Ensure the gated scene is in the season plan.',
        ));
        continue;
      }

      const verdict = this.classify(wall, pos, curve, growth);
      const scene = sceneById.get(wall.to);
      const isHeavy = scene?.consequenceTier
        ? TIER_RANK[scene.consequenceTier] >= HEAVY_RANK
        : false;

      if (verdict === 'never-winnable') {
        issues.push(this.error(
          `Dead wall: skill "${wall.skill}" gate ${wall.gateLevel} at "${wall.to}" is never winnable — even the achievable max skill level never reaches the gate before it is required.`,
          `competenceWall:${wall.to}`,
          'Lower the gate level, add a growth path (side strand) that reaches it before this required payoff, or make the wall fail-forward-only.',
        ));
      } else if (verdict === 'winnable-later') {
        // Legal ONLY IF a growth path AND a return opportunity both exist.
        const hasGrowthPath = this.hasGrowthReaching(wall, pos, growth);
        const hasReturn = wall.overcomesPriorFailure === true;
        if (!hasGrowthPath || !hasReturn) {
          issues.push(this.error(
            `Illegal roadblock: skill "${wall.skill}" gate ${wall.gateLevel} at "${wall.to}" is winnable-later but ${!hasGrowthPath ? 'no growth path reaches the gate' : 'no return opportunity (overcome) exists'} — a deliberate roadblock is legal only if BOTH a charging growth path and a return opportunity exist.`,
            `competenceWall:${wall.to}`,
            'Add a side-content growth strand that reaches the gate, and a return scene where the wall is overcome (overcomesPriorFailure), or lower the gate to winnable-now.',
          ));
        } else if (isHeavy) {
          issues.push(this.info(
            `Deliberate roadblock OK: skill "${wall.skill}" gate ${wall.gateLevel} at heavy-tier "${wall.to}" — failed first, grew, returns to overcome.`,
            `competenceWall:${wall.to}`,
          ));
        }
      }
    }

    // --- 2) Dangling growth: a gain that unlocks no downstream wall ----------
    // A skill/attribute that grows but is never gated by ANY wall is uncharged
    // texture (Part 5 step 4) — the same defect as a hollow branch.
    const grownSkills = new Set<string>();
    for (const step of growth) {
      if (step.delta > 0) grownSkills.add(step.skill);
    }
    for (const skill of grownSkills) {
      if (!gatedSkills.has(skill)) {
        issues.push(this.warning(
          `Dangling growth: skill "${skill}" gains level but gates no downstream wall — side-content growth must charge a later roadblock (else it is uncharged texture).`,
          `danglingGrowth:${skill}`,
          'Add a downstream skill-gated wall that this growth unlocks, or remove the growth as inert.',
        ));
      }
    }

    // --- 3) Fail-forward gaps: a failure arm that leads nowhere ---------------
    for (const arm of ctx.failForwardArms ?? []) {
      const dest = typeof arm.leadsTo === 'string' ? arm.leadsTo.trim() : '';
      if (dest.length === 0) {
        issues.push(this.error(
          `Fail-forward gap: failure arm "${arm.arm}" of "${arm.sceneId}" leads nowhere — every failed check must continue to a different, worse-but-alive path (not punishment/reload).`,
          `failForward:${arm.sceneId}:${arm.arm}`,
          'Give the failure arm a leadsTo destination (a divergent continuing storylet), so failure fails FORWARD.',
        ));
      }
    }

    return finalize(issues);
  }

  /**
   * Classify a wall's winnability against the expected-skill curve (Part 5 table).
   * Challenge is tuned to `expected`; the *required*-payoff reachability is gated
   * against the achievable `max` (Part 11 #7). A wall whose `max` never reaches
   * the gate before it is required is never-winnable.
   */
  private classify(
    wall: SkillRoadblock,
    pos: number,
    curve: ExpectedSkillCurve,
    growth: SkillGrowthStep[],
  ): WinnabilityVerdict {
    const bandNow = curve.bandAt(wall.skill, pos);
    // Tune challenge to EXPECTED: passable-with-tension now iff the typical player
    // is at/above the gate.
    if (bandNow.expected >= wall.gateLevel) return 'winnable-now';
    // Gate the REQUIRED payoff against the achievable MAX at the wall's position:
    // if even a completionist who took every reachable growth path before this
    // point cannot reach the gate, it is a dead wall.
    if (bandNow.max < wall.gateLevel) return 'never-winnable';
    // expected < N but max ≥ N at/before the wall: a deliberate roadblock that the
    // grind can clear. Legal only if a growth path + return both exist (checked
    // by the caller). If there is no growth between baseline and here at all, the
    // max simply equals baseline and we would have returned never-winnable above.
    return this.hasGrowthReaching(wall, pos, growth) ? 'winnable-later' : 'never-winnable';
  }

  /**
   * True iff there is a positive growth step for the wall's skill landing at or
   * before the wall's position (a charging path toward the gate exists before the
   * required payoff). Used for both winnable-later legality and the never-winnable
   * fallback.
   */
  private hasGrowthReaching(
    wall: SkillRoadblock,
    pos: number,
    growth: SkillGrowthStep[],
  ): boolean {
    return growth.some(
      (g) => g.skill === wall.skill && g.delta > 0 && g.position <= pos,
    );
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const nonErrors = issues.length - errors;
  const score = Math.max(0, 100 - errors * 10 - nonErrors * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
