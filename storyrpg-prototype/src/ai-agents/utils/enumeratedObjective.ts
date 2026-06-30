/**
 * Enumerated-objective parsing (G10) — SHARED between the SceneWriter (which must dramatize
 * each enumerated clue on-page) and ReferencedEventPresenceValidator (which flags any that
 * never appear). Keeping the parser in one place guarantees the generator and the gate agree
 * on exactly which objectives count as enumerations and what their items are.
 *
 * A scene's `sequenceIntent.objective` sometimes ENUMERATES concrete things the scene
 * promises to show, e.g. "Kylie collects four splinters of wrongness — Ileana's tears, the
 * photograph, the maiden name, Mika's absence." The three items beyond the first were never
 * dramatized in G10 yet later scenes paid them off. This parser extracts those items (only
 * for explicit ≥3-item enumerations after an enumeration lead-in) so both sides can act on
 * the same list. Deterministic, no LLM.
 */

const STOPWORDS = new Set([
  'the', 'and', 'her', 'his', 'their', 'with', 'that', 'this', 'from', 'into', 'over',
  'four', 'three', 'five', 'two', 'some', 'each', 'every', 'they', 'them', 'then',
  'wrongness', 'things', 'details', 'moments', 'collects', 'collect', 'notices', 'notice',
  'plants', 'plant', 'gathers', 'gather', 'before', 'after', 'while', 'about',
  'player', 'reader', 'audience', // meta references, never concrete clues
]);

// Lead-in words that signal the objective is ENUMERATING observed concrete clues (vs.
// describing an abstract dramatic arc). Without one of these, a dash/list is just prose
// structure, not a promise of on-page details — so it is not treated as a list.
const ENUMERATION_TRIGGER_RE =
  /\b(collect|collects|gather|gathers|notice|notices|catalog|catalogs|clue|clues|splinter|splinters|detail|details|sign|signs|tell|tells|spot|spots|observe|observes|piece|pieces|note|notes|inventory)\b/i;

// A concrete clue item is a short noun phrase. Reject items that read as verb clauses (a
// leading/standalone verb or any gerund) — those are arc descriptions, not clues.
const VERBY_RE = /\b\w+ing\b/i;
const LEADING_VERB_RE =
  /^(move|set|setting|test|tests|establish|build|deepen|reveal|push|shift|survive|survives|absorb|recalibrate|earn|trade)\b/i;

/** Lowercased content tokens (length ≥4, non-stopword) used for keyword overlap. */
export function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Extract enumerated list items from an objective, or [] when it is not an enumeration.
 * Recognizes "lead — a, b, c[, and d]" / "lead: a, b, c" and bare comma lists of ≥3.
 */
export function enumeratedItems(objective: string): string[] {
  if (!objective) return [];
  // Require a dash/colon that separates an enumeration lead-in from the list.
  const dashSplit = objective.split(/\s[—–:-]\s/);
  if (dashSplit.length < 2) return [];
  const lead = dashSplit[0];
  // The lead-in must signal an enumeration of concrete clues, not an abstract arc.
  if (!ENUMERATION_TRIGGER_RE.test(lead)) return [];

  const tail = dashSplit.slice(1).join(' ');
  const items = tail
    .split(/,|\band\b/i)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean)
    .filter((s) => contentTokens(s).length > 0)
    // A concrete clue is a SHORT noun phrase: ≤5 words, no gerund, no leading verb.
    .filter((s) => s.split(/\s+/).length <= 5 && !VERBY_RE.test(s) && !LEADING_VERB_RE.test(s));
  // Only treat as an enumeration when there are genuinely ≥3 distinct concrete items.
  return items.length >= 3 ? items : [];
}
