/**
 * Shared vocabulary for "major on-page evidence" — the visible events that
 * earn a large hidden-state change (rescue, sacrifice, confession, public
 * cost). Canonical union of the lists that previously lived separately in
 * NarrativeMechanicPressureValidator and RelationshipPacingValidator, so the
 * validators that forgive magnitude on evidence agree on what evidence is.
 *
 * NOTE: seasonScenePlanBuilder keeps its own plan-time MAJOR_EVIDENCE_RE — it
 * mixes in story-specific prop nouns (key/card/threshold) and changing it
 * churns plan goldens; unify it here only alongside a golden regen.
 */
export const MAJOR_EVIDENCE_RE =
  /\b(rescue[ds]?|saved?|sacrifice[ds]?|confess(?:es|ed)?|secret|risk(?:s|ed)?|bled|wounded|protect(?:s|ed)?|shield(?:s|ed)?|blocked|covered|warn(?:s|ed)?|betray(?:s|ed)?|public cost|exposed|gave up|lost|injured|vow|promise)\b/i;

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
