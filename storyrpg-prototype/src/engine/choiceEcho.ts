/**
 * Choice-echo phrasing helpers (pure, reader-safe).
 *
 * Builds the short "what you just chose" acknowledgment line shown after a
 * choice. Extracted from StoryReader so it can be unit-tested in isolation.
 *
 * IMPORTANT: the preferred echo is the AUTHORED `feedbackCue.echoSummary`
 * (well-formed, e.g. "You gave the honest answer. It cost you something
 * visible."). `sentenceFromChoiceText` is only the FALLBACK for choices that
 * lack one — and it must degrade gracefully for dialogue / first-person /
 * long-declarative choice text, which does not fit the "You chose to {x}"
 * verb-phrase template (that produced "You chose to i knew less than I should
 * have…").
 */

export function lowercaseFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function sentenceFromChoiceText(choiceText?: string): string | undefined {
  const cleaned = choiceText?.replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '');
  if (!cleaned) return undefined;

  // Dialogue / first-person / multi-sentence / long choice text doesn't fit the
  // "You chose to {x}" template (it reads as broken grammar). Render a clean
  // quoted form instead.
  const looksLikeStatement =
    /^(i|we|you|he|she|they|it|"|')\b/i.test(cleaned) ||
    cleaned.split(' ').length > 9 ||
    /[.!?].+/.test((choiceText ?? '').trim().replace(/[.!?]$/, '')); // multiple sentences
  if (looksLikeStatement) {
    const oneLine = cleaned.length > 90 ? `${cleaned.slice(0, 87).trimEnd()}…` : cleaned;
    return `You said: “${oneLine}.”`;
  }

  const dont = /^don't\s+(.+)$/i.exec(cleaned)?.[1];
  if (dont) return `You chose not to ${lowercaseFirst(dont)}.`;
  const action = /^(?:choose to|try to|attempt to|decide to)\s+(.+)$/i.exec(cleaned)?.[1] || cleaned;
  return `You chose to ${lowercaseFirst(action)}.`;
}
