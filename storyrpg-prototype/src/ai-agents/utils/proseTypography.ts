/**
 * Deterministic typography cleanup for shipped reader-facing prose.
 *
 * The LLM intermittently emits mechanical quote/punctuation artifacts that no
 * craft pass fixes (bite-me 2026-07-03 s1-5: "A new user, 'V. V, ', has left a
 * simple, chilling message: 'I look forward to reading more. '." — spaces
 * before closing quotes, commas pinned inside names, doubled terminal
 * punctuation after quotes). These are safe, meaning-preserving normalizations
 * — no rewording, only spacing/punctuation mechanics. Comma splices
 * ("buzzing incessantly, The post has gone viral") are deliberately NOT
 * auto-repaired: distinguishing a splice from a title/vocative needs judgment,
 * so they stay a SceneCritic concern.
 */

const CLOSING_QUOTES = "'’\"”";

export function normalizeProseTypography(text: string): string {
  if (!text) return text;
  let out = text;

  // Punctuation + spaces + CLOSING quote → pull the quote flush against the
  // punctuation: "reading more. '" → "reading more.'". A quote followed by a
  // letter/digit is an OPENING quote ("user, 'V. V…") and must keep its space.
  out = out.replace(new RegExp(`([.!?,;:])[ \\t]+([${CLOSING_QUOTES}])(?![\\p{L}\\p{N}])`, 'gu'), '$1$2');

  // Terminal punctuation inside the quote followed by a stray period outside:
  // "reading more.'." → "reading more.'"
  out = out.replace(new RegExp(`([.!?])([${CLOSING_QUOTES}])[ \\t]*\\.(?=\\s|$)`, 'g'), '$1$2');

  // Comma inside the quote followed by a comma outside: "'V. V,'," → "'V. V',"
  out = out.replace(new RegExp(`,([${CLOSING_QUOTES}])[ \\t]*,`, 'g'), '$1,');

  // Space before sentence punctuation: "word ." → "word." (never touches
  // apostrophes inside words — a leading space is required to match).
  out = out.replace(/[ \t]+([,.;:!?])(?=[\s'’"”)]|$)/g, '$1');

  // Collapse doubled spaces introduced by the fixes above.
  out = out.replace(/[ \t]{2,}/g, ' ');

  return out;
}

/** Normalize every reader-facing text field on a beat-like object in place. */
export function normalizeBeatTypography<T extends { text?: string; setupText?: string; escalationText?: string; textVariants?: Array<{ text?: string }> }>(beat: T): T {
  if (typeof beat.text === 'string') beat.text = normalizeProseTypography(beat.text);
  if (typeof beat.setupText === 'string') beat.setupText = normalizeProseTypography(beat.setupText);
  if (typeof beat.escalationText === 'string') beat.escalationText = normalizeProseTypography(beat.escalationText);
  for (const variant of beat.textVariants ?? []) {
    if (typeof variant.text === 'string') variant.text = normalizeProseTypography(variant.text);
  }
  return beat;
}
