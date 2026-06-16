// ========================================
// EPISODE INVARIANTS (negative constraints)
// ========================================
//
// A treatment episode often states things that must NOT happen — "she does not go
// home with him", "he almost — but doesn't — kiss her". These are invariants the
// prose must HOLD, and nothing surfaces them to the author, so SceneWriter freely
// inverts them (bite-me-g15 ep2 opened "the memory of last night with Victor" though
// the treatment is emphatic she does not go home with him).
//
// We extract them CONSERVATIVELY: only a strong negation immediately followed by a
// concrete ACTION verb counts, so a stative negation ("a manor that does not WANT to
// be read") is never mistaken for an invariant. Advisory only — the surfaced lines
// steer the author; nothing blocks. Pure + deterministic.

/** Negation markers that introduce an invariant when followed by an action verb. */
const NEGATION = '(?:does not|doesn\'t|did not|didn\'t|will not|won\'t|never|refuses to|refused to|cannot|can\'t)';

/**
 * Concrete action verbs an invariant negates. Deliberately a whitelist (not "any
 * verb") so stative/abstract negations (want, seem, know, mean, need, feel) are
 * excluded — those are description, not a held line.
 */
const ACTION_VERB =
  '(?:go|goes|went|kiss|kisses|tell|tells|told|give|gives|gave|sleep|sleeps|slept|stay|stays|stayed|' +
  'leave|leaves|left|take|takes|took|drink|drinks|drank|sign|signs|signed|agree|agrees|agreed|' +
  'accept|accepts|accepted|return|returns|returned|reveal|reveals|revealed|confess|confesses|confessed|' +
  'come|comes|came|call|calls|called|open|opens|opened|answer|answers|answered)';

// Allow a dash/whitespace gap (but not words) between the negation and the verb so
// "almost — but doesn't — kiss her" is caught while "does not ever go" stays out.
const INVARIANT_RE = new RegExp(`\\b${NEGATION}[\\s—–-]+${ACTION_VERB}\\b[^.;:!?]*`, 'gi');

/**
 * Extract up to `limit` protagonist-action invariants from episode text (synopsis /
 * turnout). Each result is the negation clause verbatim (trimmed), e.g.
 * "does not go home with him". Empty when the text states no action-negation.
 */
export function extractEpisodeInvariants(text: string | undefined, limit = 4): string[] {
  if (!text || typeof text !== 'string') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(INVARIANT_RE)) {
    const clause = match[0].replace(/\s+/g, ' ').trim();
    const key = clause.toLowerCase();
    if (clause.length >= 6 && !seen.has(key)) {
      seen.add(key);
      out.push(clause);
      if (out.length >= limit) break;
    }
  }
  return out;
}
