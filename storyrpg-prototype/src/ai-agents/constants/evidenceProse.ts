/**
 * Shared vocabulary for "major on-page evidence" — the visible events that
 * earn a large hidden-state change (rescue, sacrifice, confession, public
 * cost). Canonical union of the lists that previously lived separately in
 * NarrativeMechanicPressureValidator and RelationshipPacingValidator, so the
 * validators that forgive magnitude on evidence agree on what evidence is.
 *
 * Both evidence regexes now live here (audit open-item 2, relocated
 * 2026-07-03). They are still TWO patterns on purpose: the plan-time variant
 * mixes in story-specific prop nouns (key/card/threshold) and different verb
 * forms, and merging the patterns changes plan-time behavior — that merge
 * stays gated on a season-plan golden regen. The relocation itself is
 * byte-identical (zero behavior change).
 */
export const MAJOR_EVIDENCE_RE =
  /\b(rescue[ds]?|saved?|sacrifice[ds]?|confess(?:es|ed)?|secret|risk(?:s|ed)?|bled|wounded|protect(?:s|ed)?|shield(?:s|ed)?|blocked|covered|warn(?:s|ed)?|betray(?:s|ed)?|public cost|exposed|gave up|lost|injured|vow|promise)\b/i;

/**
 * Plan-time variant used by seasonScenePlanBuilder's relationship-stage and
 * delta-cap heuristics. Verbatim relocation of its former private constant.
 */
export const PLAN_TIME_MAJOR_EVIDENCE_RE =
  /\b(rescue|rescues|saves|protects|sacrifice|bleeds?|wound|secret|confess|confesses|risk|risks|vow|promise|key|card|threshold)\b/i;

/**
 * Appended to repair suggestions that ask the LLM to ADD evidence/residue
 * prose. Keeps the repair from writing exactly what the mechanics-leakage and
 * design-note gates will flag on the next validation round (repair-loop fight
 * observed in the 2026-07-02 audit).
 */
export const FICTION_SAFE_RESIDUE_GUIDANCE =
  'Express the residue as visible behavior, access, or distance in the fiction '
  + '(a door held open, a reply that comes faster, a name remembered) — never as '
  + 'state narration such as "trust level is set", "this flag is set", or any '
  + 'mention of "the player", scores, or stat changes.';
