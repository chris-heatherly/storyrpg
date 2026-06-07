/**
 * Meta / design-note prose detection.
 *
 * Agent-facing PLANNING language ("In the caravan scene, she …", "The next scene
 * should remember this choice", raw flag identifiers like `treatment_seed_ep2_1`)
 * must never reach reader-facing prose. Two consumers share these patterns:
 *
 *  1. `callbackOrchestration.injectFallbackCallbacks` — REJECT filter. The
 *     auto-callback realizer sources its TextVariant text from authored
 *     `reminderPlan`/`feedbackCue`/ledger summaries, which are all
 *     planning-register. Over-rejecting here is harmless (the callback is simply
 *     not injected), so it uses the broad {@link META_CALLBACK_REJECT_PATTERNS}.
 *  2. `MechanicsLeakageValidator` (design-note scan) — DETECTOR. This runs over
 *     ALL reader prose and can escalate to blocking, so it uses the narrower,
 *     high-confidence {@link READER_PROSE_LEAK_PATTERNS} (anchored scene
 *     references + raw flag identifiers) to avoid false-positive blocks on
 *     legitimate diegetic uses of the word "scene".
 */

/**
 * High-confidence reader-prose leak signatures, safe to feed a blocking
 * validator. Each entry carries a label/suggestion for issue reporting.
 */
export const READER_PROSE_LEAK_PATTERNS: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
  {
    // "In the caravan scene, …", "In the wall-breach encounter, …" — the
    // auto-callback signature. Anchored to a sentence start so legitimate
    // diegetic uses mid-sentence ("the final scene of the opera") don't fire.
    pattern: /(?:^|[.!?]\s+)in the\b[^.!?]*\b(?:scene|encounter)\b/i,
    label: 'meta reference to a scene/encounter',
    suggestion: 'Describe what happens in-fiction; never reference a scene or encounter by name or position.',
  },
  {
    // Raw flag/seed identifiers — e.g. treatment_seed_ep2_1, aethavyr_held_distance.
    // snake_case tokens with an episode suffix never appear in real prose.
    pattern: /\b(?:treatment_seed_\w+|\w+_ep\d+(?:_\d+)?)\b/i,
    label: 'raw flag identifier',
    suggestion: 'Remove raw flag/seed identifiers from reader prose.',
  },
  {
    // Parenthetical system-variable mention — "(sets treatment_seed_ep2_1)",
    // "(moved thorne_loyalty)" — emitted by synthesized ledger summaries.
    pattern: /\(\s*(?:sets?|moved|moves)\s+[\w:]+\s*\)/i,
    label: 'parenthetical system-variable mention',
    suggestion: 'Remove system-variable mentions from reader prose.',
  },
];

/**
 * Broad reject set for the auto-callback injection filter. Includes the
 * high-confidence signatures above plus planning stubs that are too loose to
 * block on globally but should never be injected as a callback line.
 */
export const META_CALLBACK_REJECT_PATTERNS: RegExp[] = [
  ...READER_PROSE_LEAK_PATTERNS.map((p) => p.pattern),
  // Scene-ordering planning phrases: "the next scene should remember this".
  /\bthe\s+(?:next|following|previous|prior|earlier|last|final|first)\s+scene\b/i,
  // Synthesized ledger stub: 'Earlier choice: "…" (sets …).'
  /\bearlier choice:/i,
  // Generic planning defaults the autofill emits.
  /\bshould remember this choice\b/i,
  /\bremember this (?:choice|moment)\b/i,
];

/**
 * True when `text` reads as agent-facing planning / meta-narration and must not
 * be injected verbatim as reader-facing callback prose.
 */
export function isUnsafeCallbackProse(text: string | undefined): boolean {
  if (!text) return true;
  return META_CALLBACK_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}
