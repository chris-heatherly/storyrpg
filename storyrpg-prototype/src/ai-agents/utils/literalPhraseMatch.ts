/**
 * Token-boundary literal phrase matching (r115 postmortem).
 *
 * `verificationAuthority: 'literal'` atoms (forbidden codenames, coined
 * titles) were matched with plain substring containment —
 * `normalize(text).includes(normalize(pattern))` — so the forbidden codename
 * "The Mountain" matched inside the unrelated phrase "dressed for the
 * mountains" (mountains = mountain + s; "the mountain" is a literal substring
 * of "the mountains"). A literal check must mean literal: the pattern's
 * words, in order, as whole tokens — never a substring of a longer word.
 */

function normalizeForTokens(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokensOf(value: string): string[] {
  const normalized = normalizeForTokens(value);
  return normalized ? normalized.split(' ') : [];
}

/**
 * True iff `pattern`'s tokens appear as a contiguous, whole-token
 * subsequence of `text`'s tokens. Case/diacritic/punctuation-insensitive.
 * Never matches a token that only partially overlaps (no stemming, no
 * prefix matching) — "mountain" never matches "mountains" or "mountainous".
 */
export function literalPhraseMatch(pattern: string, text: string): boolean {
  const patternTokens = tokensOf(pattern);
  if (patternTokens.length === 0) return false;
  const textTokens = tokensOf(text);
  if (patternTokens.length > textTokens.length) return false;
  for (let start = 0; start <= textTokens.length - patternTokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < patternTokens.length; offset += 1) {
      if (textTokens[start + offset] !== patternTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
