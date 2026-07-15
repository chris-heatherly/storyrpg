/**
 * Cross-artifact ENTITY identity (Systemic Guards Plan W2.2).
 *
 * STANDING RULE: two independently generated LLM outputs never agree on exact
 * strings — comparing them with `===` / `Set.has` is a per-run coin flip that
 * presents as an intermittent hard failure. July 2026 instances: route tiers
 * vs storylet keys, mined location cues vs the plan lexicon, IR locations vs
 * the location authority ("Kylie's Lipscani apartment" vs "Kylie's
 * Apartment"), rescue-evidence tokens vs encounter surfaces.
 *
 * Use `entityTokensMatch` whenever one LLM output must be recognized as
 * naming the same ENTITY (location, character, venue, prop) as another.
 * Qualifiers and sub-entities of a known entity match; genuinely different
 * entities do not.
 *
 * Scope limits — this is identity matching, not similarity scoring:
 * - NOT for sentence/turn similarity (use a judge; token subsets on prose
 *   sentences are far too loose).
 * - NOT for content verdicts ("was this meaning dramatized?") — those belong
 *   to the semantic judge and are never fuzzy.
 */

const ENTITY_STOP_TOKENS = new Set([
  'the', 'a', 'an', 'in', 'at', 'of', 'on', 'near', 'inside', 'outside',
  'her', 'his', 'their', 'your', 's',
]);

/** Normalized content tokens of a free-text entity reference. */
export function entityTokens(value: unknown): Set<string> {
  return new Set(
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token && !ENTITY_STOP_TOKENS.has(token)),
  );
}

function isTokenSubset(candidate: Set<string>, container: Set<string>): boolean {
  if (candidate.size === 0 || candidate.size > container.size) return false;
  for (const token of candidate) {
    if (!container.has(token)) return false;
  }
  return true;
}

/**
 * Do two free-text references plausibly name the same entity? True when the
 * content tokens of one are a subset of the other's ("the apartment in
 * Lipscani" ~ "Kylie's Lipscani Apartment"). Empty references match nothing.
 */
export function entityTokensMatch(a: unknown, b: unknown): boolean {
  const left = entityTokens(a);
  const right = entityTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  return isTokenSubset(left, right) || isTokenSubset(right, left);
}

/** Is `reference` a known entity per `authority` (any-entry token match)? */
export function matchesEntityAuthority(
  reference: unknown,
  authorityTokenSets: ReadonlyArray<Set<string>>,
): boolean {
  const tokens = entityTokens(reference);
  if (tokens.size === 0) return true; // nothing to verify
  return authorityTokenSets.some((known) =>
    isTokenSubset(tokens, known) || isTokenSubset(known, tokens));
}
