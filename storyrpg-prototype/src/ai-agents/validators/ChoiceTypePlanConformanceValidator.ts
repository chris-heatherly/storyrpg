import type { Story, ChoiceType } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { episodeTypeCounts, type SeasonChoicePlan } from '../pipeline/seasonChoicePlan';

/**
 * Choice-type PLAN CONFORMANCE (G10, L2).
 *
 * Choice-type BALANCE (the 35/30/20/15 mix) is a whole-season property validated ONCE at
 * plan time, over every planned episode's moments (`seasonChoicePlan` → ChoiceDistribution
 * over the full season). Measuring a generated K-of-N slice against that target is a
 * category error — it made Endsong's legitimate partial-season "strategic = 0%" read as a
 * −20pp defect when the plan correctly parks most strategic choices in episodes 4–10.
 *
 * This validator does the CORRECT per-episode thing instead: for each GENERATED episode,
 * assert it realized what the season plan assigned to IT — no target-percentage math.
 *
 *   Check B (budget fidelity, always): every choice type the season plan budgeted for
 *     episode E (count ≥ 1 in `episodeTypeCounts(plan, E)`) appears at least once in E's
 *     generated choices. Catches the real failure mode — a type the season balance was
 *     counting on for E silently dropped to zero (e.g. the per-episode slice re-allocation
 *     in assignChoiceTypes losing a strategic to largest-remainder rounding). Presence,
 *     not exact counts, so benign rounding is not penalized.
 *   Check A (binding fidelity, when `plannedTypesByScene` is supplied): each generated
 *     choice's `choiceType` equals the planned `choicePoint.type` for its scene. Should
 *     hold by construction (ChoiceAuthor forces the planned type); the guard catches drift
 *     where the force was lost (e.g. on an encounter/branch scene).
 *
 * Deterministic, no LLM. Pure.
 */

const CANON: ChoiceType[] = ['expression', 'relationship', 'strategic', 'dilemma'];

export interface ChoiceTypePlanConformanceInput {
  seasonPlan: SeasonChoicePlan;
  story: Story;
  /** Optional planned per-scene type (blueprint `choicePoint.type` / choice-type-plan
   * `finalTypes`). When present, enables Check A (binding fidelity). */
  plannedTypesByScene?: Record<string, string>;
}

interface SceneChoiceTypes {
  episodeNumber: number;
  sceneId: string;
  types: string[]; // beat-level choice-point types in this scene
}

/** Gather scene-level choice-point types per episode (excludes encounter sub-choices). */
function collectSceneChoiceTypes(story: Story): SceneChoiceTypes[] {
  const out: SceneChoiceTypes[] = [];
  for (const episode of story.episodes || []) {
    if (typeof episode.number !== 'number') continue;
    for (const scene of episode.scenes || []) {
      const types: string[] = [];
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          if (typeof choice.choiceType === 'string') types.push(choice.choiceType);
        }
      }
      if (types.length > 0) out.push({ episodeNumber: episode.number, sceneId: scene.id, types });
    }
  }
  return out;
}

export class ChoiceTypePlanConformanceValidator extends BaseValidator {
  constructor() {
    super('ChoiceTypePlanConformanceValidator');
  }

  validate(input: ChoiceTypePlanConformanceInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const sceneTypes = collectSceneChoiceTypes(input.story);
    if (sceneTypes.length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    // Which episodes were actually generated (have ≥1 typed choice point).
    const generatedEpisodes = Array.from(new Set(sceneTypes.map((s) => s.episodeNumber))).sort(
      (a, b) => a - b,
    );

    // --- Check B: budget fidelity, per generated episode ---
    for (const ep of generatedEpisodes) {
      const planned = episodeTypeCounts(input.seasonPlan, ep);
      // No plan for this episode (e.g. plan empty) → nothing to conform to.
      if (CANON.every((t) => (planned[t] ?? 0) === 0)) continue;
      const actual = new Set(
        sceneTypes.filter((s) => s.episodeNumber === ep).flatMap((s) => s.types),
      );
      for (const t of CANON) {
        if ((planned[t] ?? 0) >= 1 && !actual.has(t)) {
          issues.push(this.warning(
            `Episode ${ep} plan budgeted at least one "${t}" choice, but the generated episode has none — the season-plan balance counted on it. (planned ${JSON.stringify(planned)}; realized types: ${[...actual].join(', ') || 'none'})`,
            `ep${ep}`,
            `Ensure the per-episode choice-type assignment realizes the "${t}" choice the season plan budgeted for episode ${ep} (check assignChoiceTypes slice re-allocation and ChoiceAuthor type binding).`,
          ));
        }
      }
    }

    // --- Check A: binding fidelity (only when planned per-scene types are supplied) ---
    if (input.plannedTypesByScene) {
      for (const s of sceneTypes) {
        const plannedType = input.plannedTypesByScene[s.sceneId];
        if (!plannedType) continue;
        // The scene's choice points should carry the planned type. If any differ, the
        // planner's forced type did not stick for this scene.
        const mismatched = s.types.filter((t) => t !== plannedType);
        if (mismatched.length > 0 && !s.types.includes(plannedType)) {
          issues.push(this.warning(
            `Scene "${s.sceneId}" (episode ${s.episodeNumber}) was assigned type "${plannedType}" by the planner but its generated choice(s) are "${[...new Set(s.types)].join(', ')}" — choice-type binding drifted.`,
            `ep${s.episodeNumber}:${s.sceneId}`,
            'ChoiceAuthor should force the planner-assigned choicePoint.type; investigate why it was lost for this scene.',
          ));
        }
      }
    }

    const warnings = issues.length;
    return {
      valid: true, // advisory by nature; gating handled by the caller
      score: Math.max(0, 100 - warnings * 8),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
