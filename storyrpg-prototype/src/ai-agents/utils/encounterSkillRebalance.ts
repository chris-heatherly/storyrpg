/**
 * WS1.4 — deterministic encounter skill-rebalance. g17's three encounters each let `perception`
 * carry 52–55% of choice slots — a single-skill meta ("always pick perception"). The
 * EncounterQualityValidator flags >40% but only as an advisory warning with no fix, and there
 * is no generation-time cap. This pass evens the distribution in place: while the dominant
 * primarySkill exceeds the cap, it reassigns the excess slots (in stable order) to the
 * least-used skill ALREADY present in the encounter — so reassignments stay within the
 * encounter's own contextually-plausible skill vocabulary rather than inventing a new one.
 *
 * Deterministic + idempotent + golden-parity when no skill exceeds the cap. The EncounterArchitect
 * prompt directive remains the primary (coherent-at-source) fix; this is the guaranteed backstop.
 */

const CAP = 0.4;
const MIN_SLOTS = 6; // mirror EncounterQualityValidator's monoculture guard

interface SkillNode {
  obj: Record<string, unknown>;
}

function collectSkillNodes(encounter: unknown): SkillNode[] {
  const nodes: SkillNode[] = [];
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.primarySkill === 'string' && obj.primarySkill.trim()) nodes.push({ obj });
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v);
  };
  walk(encounter);
  return nodes;
}

function counts(nodes: SkillNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nodes) {
    const k = (n.obj.primarySkill as string).toLowerCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function topShare(nodes: SkillNode[]): number {
  if (nodes.length === 0) return 0;
  const c = counts(nodes);
  return Math.max(...c.values()) / nodes.length;
}

export interface EncounterSkillRebalanceResult {
  changed: number;
  topShareBefore: number;
  topShareAfter: number;
}

/** Reassign excess dominant-skill slots to the least-used present skill until top share ≤ cap. */
export function rebalanceEncounterSkills(encounter: unknown): EncounterSkillRebalanceResult {
  const nodes = collectSkillNodes(encounter);
  const slots = nodes.length;
  const before = topShare(nodes);
  if (slots < MIN_SLOTS) return { changed: 0, topShareBefore: before, topShareAfter: before };

  const skills = Array.from(new Set(nodes.map((n) => (n.obj.primarySkill as string).toLowerCase())));
  if (skills.length < 2) return { changed: 0, topShareBefore: before, topShareAfter: before };

  const cap = Math.floor(CAP * slots);
  let changed = 0;
  // Guard against pathological loops; at most one reassignment per node.
  for (let guard = 0; guard <= slots; guard++) {
    const c = counts(nodes);
    const [topSkill, topCount] = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (topCount <= cap) break;
    // Least-used OTHER skill (deterministic tie-break by name).
    const target = skills
      .filter((s) => s !== topSkill)
      .sort((a, b) => (c.get(a) ?? 0) - (c.get(b) ?? 0) || a.localeCompare(b))[0];
    if (!target) break;
    // Moving one slot from top (count T) to target (count t) lowers the max only if t ≤ T-2
    // (the new max becomes max(T-1, t+1, …)). When the distribution is already as even as the
    // present skills allow (e.g. 7 slots across 3 skills can't beat 3/2/2), stop — this both
    // honors an unsatisfiable cap gracefully and makes the pass idempotent.
    if ((c.get(target) ?? 0) >= topCount - 1) break;
    // Reassign the first still-dominant node (stable order).
    const node = nodes.find((n) => (n.obj.primarySkill as string).toLowerCase() === topSkill);
    if (!node) break;
    node.obj.primarySkill = target;
    changed += 1;
  }
  return { changed, topShareBefore: before, topShareAfter: topShare(nodes) };
}

/** Rebalance every encounter in the story in place. Returns total reassignments. */
export function rebalanceStoryEncounterSkills(story: { episodes?: Array<{ scenes?: Array<{ encounter?: unknown }> }> }): number {
  let changed = 0;
  for (const ep of story.episodes || []) {
    for (const sc of ep.scenes || []) {
      if (sc.encounter) changed += rebalanceEncounterSkills(sc.encounter).changed;
    }
  }
  return changed;
}
