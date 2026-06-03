/**
 * Outcome textVariant construction for choice payoff beats (shared by the two
 * payoff-beat builders: FullStoryPipeline and EpisodePipeline).
 *
 * A payoff beat shows BASE text, then swaps to success/failure prose at runtime
 * when the `_outcome_success` / `_outcome_failure` flag is set. Building the
 * variants straight from `choice.outcomeTexts` produced two failure modes:
 *   - a variant whose prose is identical to the base text — a pure runtime no-op
 *     (the beat already shows that prose), just noise in story.json;
 *   - (separately) success and failure prose identical to EACH OTHER — usually a
 *     lazy LLM authoring, surfaced as an advisory nudge (NOT removed: when both
 *     differ from the base each is still needed to override it on its outcome).
 *
 * This module drops the base-equal no-ops (behavior-preserving — the player sees
 * exactly the same text) and exposes the identical-prose smell for advisory use.
 * Pure + unit-testable.
 */

export interface OutcomeTexts {
  success?: string;
  partial?: string;
  failure?: string;
}

export interface OutcomeFlagVariant {
  condition: { type: 'flag'; flag: string; value: boolean };
  text: string;
}

/**
 * Build the success/failure textVariants for a payoff beat given the beat's BASE
 * text. Drops any variant whose prose equals the base (a runtime no-op). Returns
 * undefined when no useful variant remains.
 */
export function buildOutcomeTextVariants(
  outcomeTexts: OutcomeTexts | undefined,
  baseText: string,
): OutcomeFlagVariant[] | undefined {
  if (!outcomeTexts) return undefined;
  const variants: OutcomeFlagVariant[] = [];
  const { success, failure } = outcomeTexts;
  if (typeof success === 'string' && success !== baseText) {
    variants.push({ condition: { type: 'flag', flag: '_outcome_success', value: true }, text: success });
  }
  if (typeof failure === 'string' && failure !== baseText) {
    variants.push({ condition: { type: 'flag', flag: '_outcome_failure', value: true }, text: failure });
  }
  return variants.length > 0 ? variants : undefined;
}

/**
 * True when a choice's success and failure outcome prose are identical — an
 * advisory smell (the stat-check outcome makes no narrative difference). Both
 * variants are still emitted when they differ from the base; this only flags it.
 */
export function hasIdenticalSuccessFailureProse(outcomeTexts: OutcomeTexts | undefined): boolean {
  return (
    !!outcomeTexts &&
    typeof outcomeTexts.success === 'string' &&
    typeof outcomeTexts.failure === 'string' &&
    outcomeTexts.success === outcomeTexts.failure
  );
}
