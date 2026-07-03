/**
 * Shared vocabulary for "major on-page evidence" — the visible events that
 * earn a large hidden-state change (rescue, sacrifice, confession, public
 * cost). ONE canonical pattern (audit open-item 2, merged 2026-07-03 with a
 * season-plan golden regen): the union of the runtime validators'
 * (NarrativeMechanicPressure / RelationshipArcLedger) and the plan-time
 * (seasonScenePlanBuilder stage/delta heuristics) vocabularies, so every
 * consumer agrees on what evidence is. The plan-time prop nouns join as the
 * "key card" compound + "threshold" — bare key/card would false-positive on
 * ordinary prose at runtime.
 */
export const MAJOR_EVIDENCE_RE =
  /\b(rescue[ds]?|save[ds]?|sacrifice[ds]?|confess(?:es|ed)?|secret|risk(?:s|ed)?|bleed[s]?|bled|wound(?:ed)?|protect(?:s|ed)?|shield(?:s|ed)?|blocked|covered|warn(?:s|ed)?|betray(?:s|ed)?|public cost|exposed|gave up|lost|injured|vow|promise|key card|threshold)\b/i;

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
