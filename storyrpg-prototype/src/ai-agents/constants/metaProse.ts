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
  {
    // Story-planning register from fallback choice reminders. This is not
    // diegetic prose; it names authoring machinery and the next story beat.
    pattern: /\bthe\s+next\s+beat\s+visibly\s+responds\b|\bauthored\s+choice\b/i,
    label: 'choice-response planning language',
    suggestion: 'Describe the consequence in-fiction; never reference authored choices or story beats.',
  },
  {
    // Treatment-residue reminders are planning directives for downstream agents,
    // not prose. They can mention later reveals, scene order, or event anchors and
    // poison event-signature validators if copied into textVariants.
    pattern: /\bshow\s+immediate\s+residue\s+from\b|\bauthored\s+(?:path|residue)\b/i,
    label: 'treatment-residue planning language',
    suggestion: 'Show the consequence in-fiction; never ship treatment-residue instructions as prose.',
  },
];

/**
 * Structural narrative-scaffolding signatures — the "third class" of leak the
 * gen-5 audit surfaced: prose that narrates the STORY ENGINE's mechanics (branch
 * residue, reconvergence, forward-motion) in quasi-poetic language without naming a
 * scene/flag, so the scene-reference and flag-id patterns above miss it. Each entry
 * is a SPECIFIC, tightly-anchored phrasing (not a bare word like "threshold" or
 * "residue", which appear diegetically) so it is safe to feed a blocking detector.
 * These are the exact templates the branch-residue repair and choice-bridge builder
 * used to emit; the generators no longer produce them, so this is a regression backstop.
 */
export const STRUCTURAL_SCAFFOLDING_PATTERNS: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
  {
    pattern: /\bleaves a visible residue\b/i,
    label: 'branch-residue scaffolding',
    suggestion: 'Describe the lingering effect of the earlier choice in-fiction; never narrate "branch residue".',
  },
  {
    pattern: /\bstill colors how (?:everyone|the player|you|they)\s+enters?\b/i,
    label: 'branch-reconvergence scaffolding',
    suggestion: 'Show how the prior path changes this moment in-fiction; do not narrate reconvergence.',
  },
  {
    pattern: /\bthe path here still matters\b/i,
    label: 'branch-path scaffolding',
    suggestion: 'Remove structural commentary about paths/branches from reader prose.',
  },
  {
    pattern: /\bthe (?:route|path) chosen before this moment\b/i,
    label: 'branch-path scaffolding',
    suggestion: 'Remove structural commentary about the chosen route from reader prose.',
  },
  {
    pattern: /\bthe next threshold waits ahead\b/i,
    label: 'forward-motion scaffolding',
    suggestion: 'Replace the structural forward-motion tag with in-fiction prose.',
  },
  {
    pattern: /\bthe path forward is set\b/i,
    label: 'forward-motion scaffolding',
    suggestion: 'Replace the structural forward-motion tag with in-fiction prose.',
  },
  {
    pattern: /\bstill changes how this moment lands\b/i,
    label: 'callback scaffolding',
    suggestion: 'Show the earlier decision changing the scene in-fiction; never ship generic callback scaffolding.',
  },
];

/**
 * Broad reject set for the auto-callback injection filter. Includes the
 * high-confidence signatures above plus planning stubs that are too loose to
 * block on globally but should never be injected as a callback line.
 */
export const META_CALLBACK_REJECT_PATTERNS: RegExp[] = [
  ...READER_PROSE_LEAK_PATTERNS.map((p) => p.pattern),
  ...STRUCTURAL_SCAFFOLDING_PATTERNS.map((p) => p.pattern),
  // Scene-ordering planning phrases: "the next scene should remember this".
  /\bthe\s+(?:next|following|previous|prior|earlier|last|final|first)\s+scene\b/i,
  // Synthesized ledger stub: 'Earlier choice: "…" (sets …).'
  /\bearlier choice:/i,
  // Forward-promise directive register: 'In Episode 3, Mika will mention …'.
  // Fiction-first reader prose never names an episode number, so any such
  // candidate is a planning note (a `reminderPlan.later` directive) — reject it
  // so the callback realizer falls through to clean in-fiction prose.
  /\bepisode[s]?\s+\d+\b/i,
  // Generic planning defaults the autofill emits.
  /\bshould remember this choice\b/i,
  /\bremember this (?:choice|moment)\b/i,
  /\bwhich option the player chose\b/i,
  /\bthe player chose\b/i,
  /\bthe\s+next\s+beat\s+visibly\s+responds\b/i,
  /\bauthored\s+choice\b/i,
  /\bshow\s+immediate\s+residue\s+from\b/i,
  /\bauthored\s+(?:path|residue)\b/i,
];

/**
 * True when `text` reads as agent-facing planning / meta-narration and must not
 * be injected verbatim as reader-facing callback prose.
 */
export function isUnsafeCallbackProse(text: string | undefined): boolean {
  if (!text) return true;
  return META_CALLBACK_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}
