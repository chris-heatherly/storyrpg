/**
 * Provider billing/quota error classification (Consistency Plan WS1b).
 *
 * A billing-exhausted account fails every subsequent call, so these errors are
 * (a) never retried, (b) abort the run at the next cancellation checkpoint
 * instead of burning through remaining scenes/episodes, and (c) map to a
 * 'paused' job status at the worker boundary so the run can resume after a
 * credit top-up instead of being discarded as failed.
 *
 * The thrown type is BaseAgent's existing LLMQuotaError; this module owns the
 * message-level classification so the worker and pipeline can detect quota
 * errors that lost their type crossing serialization or re-wrap boundaries,
 * without importing BaseAgent.
 *
 * Detection is deliberately tight: only definitive billing/quota-exhaustion
 * signals pause a run. Rate limits (429) and overload (529) stay retryable
 * transient errors.
 */

export const PROVIDER_QUOTA_FAILURE_KIND = 'provider-quota';

/** Definitive billing-exhaustion signals only — not rate limits or overload. */
export function isBillingQuotaMessage(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return (
    lower.includes('credit balance is too low') ||
    lower.includes('insufficient credit') ||
    lower.includes('payment required') ||
    lower.includes('billing_error')
  );
}

/**
 * True for LLMQuotaError instances (matched by name so it works across
 * serialization boundaries) and for billing errors re-wrapped into plain
 * Error messages by retry/fallback layers.
 */
export function isProviderQuotaError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'LLMQuotaError' || isBillingQuotaMessage(error.message);
  }
  return typeof error === 'string' && isBillingQuotaMessage(error);
}
