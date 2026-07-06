/**
 * Deterministic fallback strings ChoiceAuthor uses when the LLM omits a field.
 *
 * Centralized (G12) so the validators can recognize them: the G12 audit found the
 * outcome-text pool shipped verbatim on three pivotal choices (the player's first
 * direct question to Victor resolved as "You come back with less than you
 * brought."), and the reminder stubs leaked into auto-injected callback variants.
 * The pool is a last-resort safety net, not authored content — anything matching
 * it in a shipped story is a finding.
 */

export const FALLBACK_OUTCOME_TEXT_POOLS: Record<'success' | 'partial' | 'failure', string[]> = {
  success: [
    'The room settles around the choice, and it lands the way you meant it to.',
    'Clean — you get the better version of what you were reaching for.',
    'For once it goes your way, a little cleaner than you expected.',
  ],
  partial: [
    'Ground gained, but not cleanly; the cost settles in behind it.',
    'Some of it, not all — the rest leaves a mark you will carry.',
    'It works, mostly, though something slips loose in the doing and you notice.',
  ],
  failure: [
    'Not the way you hoped — and the difference is yours to hold.',
    'The moment closes before you can catch it, and it gets away from you.',
    'You come back with less than you brought.',
  ],
};

export const FALLBACK_REMINDER_STUBS: readonly string[] = [
  'The moment lands immediately.',
  'The decision leaves visible residue.',
];

/**
 * Template suffixes appended by `readerTextFallbacks.fallbackOutcomeTexts`
 * (the deterministic fallback CHOICE SET built when ChoiceAuthor fails after
 * all retries): each tier is `"<choice text>. <suffix>"`. A tier ending in one
 * of these was never authored — flag it so the focused LLM re-author
 * (ChoiceAuthor.reauthorOutcomeTexts) rewrites it. Deterministic systems
 * detect; LLMs rewrite.
 */
export const FALLBACK_OUTCOME_TEXT_SUFFIXES: readonly string[] = [
  'The moment yields a clearer emotional footing.',
  'The moment shifts, but the uncertainty stays close.',
  'The hesitation leaves a visible complication behind.',
];

const ALL_FALLBACK_OUTCOME_TEXTS = new Set(
  Object.values(FALLBACK_OUTCOME_TEXT_POOLS).flat().map((s) => s.toLowerCase()),
);

const REMINDER_STUBS = new Set(FALLBACK_REMINDER_STUBS.map((s) => s.toLowerCase()));

const FALLBACK_SUFFIXES_NORM = FALLBACK_OUTCOME_TEXT_SUFFIXES.map((s) => s.toLowerCase());

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when the text is one of ChoiceAuthor's deterministic outcome-text fallbacks. */
export function isFallbackOutcomeText(text: string | undefined): boolean {
  if (!text) return false;
  const normalized = norm(text);
  if (ALL_FALLBACK_OUTCOME_TEXTS.has(normalized)) return true;
  return FALLBACK_SUFFIXES_NORM.some((suffix) => normalized.endsWith(suffix));
}

/** True when the text is a ChoiceAuthor reminder-plan stub (planning register, never reader prose). */
export function isFallbackReminderStub(text: string | undefined): boolean {
  if (!text) return false;
  return REMINDER_STUBS.has(norm(text));
}
