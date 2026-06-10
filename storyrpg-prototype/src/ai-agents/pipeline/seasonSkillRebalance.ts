/**
 * Season-final skill-coverage rebalance (G10).
 *
 * `SkillCoverageValidator` enforces a SEASON property: across the whole story the stat
 * checks should exercise ≥6 of the 8 canonical skills and let no single skill carry >30%
 * of stat-check weight. `ChoiceAuthor.rebalanceStatCheckSkills` runs PER choiceSet (per
 * scene) with only a local accumulator, so it cannot see — let alone hit — a season target;
 * Bite Me G10 still shipped 4/8 skills with perception at 45%.
 *
 * This is the missing season-level pass: a deterministic, LLM-free reassignment over the
 * ASSEMBLED story that moves stat-check weight off an over-used skill onto under-used (or
 * entirely-unused) ones until the season clears ≥6/8 coverage and <30% dominance, or no
 * further beneficial swap exists. It operates at the COMPONENT level — the real generator
 * authors blended `skillWeights` (e.g. {perception:0.6, investigation:0.4}), so the dominance
 * is a sum across blends, not a pile of single-skill checks. It RELABELS the dominant
 * component of a check (preserving its weight value and the blend's shape) onto an under-used
 * skill WITHIN the choice type's plausible set (mirroring ChoiceAuthor's RELEVANT_SKILLS), so
 * a swap never contradicts the choice's prose, and only ever moves weight off the current
 * global-dominant skill in a strictly gap-reducing direction (guaranteed to halt). Difficulty
 * is preserved. Fiction-first: the skill behind a check is generator-internal, never shown.
 */

import type { Story } from '../../types';
import { CANON_SKILLS } from './seasonSkillPlan';
import { normalizeStatCheck } from '../../engine/resolutionEngine';

/**
 * Plausible skills per choice type — mirrors `ChoiceAuthor.RELEVANT_SKILLS` (keep in sync).
 * A check is only reassigned within its type's set so the new skill still fits the action.
 */
const RELEVANT_SKILLS: Record<string, readonly string[]> = {
  relationship: ['persuasion', 'deception', 'intimidation'],
  strategic: ['investigation', 'perception', 'stealth', 'athletics', 'survival'],
  dilemma: ['survival', 'investigation', 'perception', 'athletics', 'persuasion'],
};

const DOMINANCE_CAP = 0.3;
const MIN_SKILLS = 6;

interface StatCheckLike {
  skill?: string;
  skillWeights?: Record<string, number>;
  difficulty?: number;
}
interface ChoiceLike {
  choiceType?: string;
  statCheck?: StatCheckLike;
}

export interface SeasonSkillRebalanceResult {
  reassignments: number;
  before: { coveredSkills: number; dominantSkill?: string; dominantShare: number };
  after: { coveredSkills: number; dominantSkill?: string; dominantShare: number };
}

/** One reassignable weight component of a stat check (its key within `weights`). */
interface Component {
  weights: Record<string, number>; // the check's own (normalized) skillWeights, mutated in place
  choiceType: string;
  key: string; // the skill this component currently carries (lowercased)
}

const EPS = 1e-9;

function metricsOf(weights: Record<string, number>) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  const [dominantSkill, dominantWeight = 0] = entries.sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    coveredSkills: entries.length,
    dominantSkill,
    dominantShare: total > 0 ? dominantWeight / total : 0,
    total,
  };
}

/**
 * Rebalance stat-check skills across the whole story toward season coverage targets.
 * Mutates `statCheck` objects in place; returns before/after metrics + the swap count.
 */
export function rebalanceSeasonSkillCoverage(story: Story): SeasonSkillRebalanceResult {
  const weights: Record<string, number> = {};
  const components: Component[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const choice = obj as ChoiceLike;
    const sc = choice.statCheck;
    if (sc && (sc.skill || sc.skillWeights)) {
      // Normalize to an own skillWeights map we can mutate in place (covers the `skill`
      // shorthand and canonicalizes keys), then write it back onto the check.
      const norm = normalizeStatCheck(sc as never);
      const own: Record<string, number> = {};
      for (const [skill, w] of Object.entries(norm.skillWeights)) {
        const k = skill.toLowerCase();
        own[k] = (own[k] ?? 0) + w;
        weights[k] = (weights[k] ?? 0) + w;
      }
      sc.skillWeights = own;
      delete sc.skill;
      const choiceType = String(choice.choiceType || '');
      if (RELEVANT_SKILLS[choiceType]) {
        for (const key of Object.keys(own)) components.push({ weights: own, choiceType, key });
      }
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v);
  };
  walk(story.episodes);

  const before = metricsOf(weights);
  let reassignments = 0;

  // Greedy: repeatedly relabel one component off the global-dominant skill onto an under-used
  // relevant skill — preferring an entirely-uncovered skill while coverage is short, else the
  // least-used relevant skill, and only when the move strictly reduces the dominant↔target gap
  // (so it cannot create a worse dominant or oscillate). Bounded to guarantee halt.
  let guard = components.length * CANON_SKILLS.length + 1;
  while (guard-- > 0) {
    const m = metricsOf(weights);
    if (m.total === 0) break;
    const needCoverage = m.coveredSkills < MIN_SKILLS;
    const needDominance = m.dominantShare > DOMINANCE_CAP;
    if (!needCoverage && !needDominance) break;
    const dom = m.dominantSkill;
    if (!dom) break;

    let swapped = false;
    for (const comp of components) {
      if (comp.key !== dom) continue;
      const relevant = RELEVANT_SKILLS[comp.choiceType];
      if (!relevant) continue;
      const w = comp.weights[dom] ?? 0;
      if (w <= 0) continue;
      const ranked = [...relevant]
        .filter((s) => s !== dom)
        .sort((a, b) => (weights[a] ?? 0) - (weights[b] ?? 0));
      // Eligible target: the move must strictly reduce the gap — after moving weight `w`
      // from dom to t, t must not exceed dom (weights[t] + w <= weights[dom] - w + EPS),
      // i.e. weights[t] <= weights[dom] - 2w. For a coverage move onto an uncovered skill
      // (weights[t] == 0) we accept the looser bound weights[t] + w <= weights[dom].
      const gapTarget = ranked.find((s) => (weights[s] ?? 0) <= (weights[dom] ?? 0) - 2 * w + EPS);
      const coverageTarget = needCoverage
        ? ranked.find((s) => (weights[s] ?? 0) <= EPS && w <= (weights[dom] ?? 0) + EPS)
        : undefined;
      const chosen = coverageTarget ?? gapTarget;
      if (!chosen) continue;

      // Relabel the component dom→chosen in this check's own weights, merging if present.
      delete comp.weights[dom];
      comp.weights[chosen] = (comp.weights[chosen] ?? 0) + w;
      weights[dom] = Math.max(0, (weights[dom] ?? 0) - w);
      weights[chosen] = (weights[chosen] ?? 0) + w;
      comp.key = chosen;
      reassignments++;
      swapped = true;
      break;
    }
    if (!swapped) break;
  }

  const after = metricsOf(weights);
  return {
    reassignments,
    before: { coveredSkills: before.coveredSkills, dominantSkill: before.dominantSkill, dominantShare: before.dominantShare },
    after: { coveredSkills: after.coveredSkills, dominantSkill: after.dominantSkill, dominantShare: after.dominantShare },
  };
}
