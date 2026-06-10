import { describe, it, expect } from 'vitest';
import { isBillingQuotaMessage, isProviderQuotaError } from './providerErrors';
import { LLMQuotaError, BaseAgent } from '../agents/BaseAgent';

describe('providerErrors', () => {
  it('detects definitive billing-exhaustion messages', () => {
    expect(isBillingQuotaMessage(
      'Anthropic API error: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    )).toBe(true);
    expect(isBillingQuotaMessage('billing_error: account suspended')).toBe(true);
    expect(isBillingQuotaMessage('HTTP 402 Payment Required')).toBe(true);
  });

  it('does NOT classify transient errors as quota (they must stay retryable)', () => {
    expect(isBillingQuotaMessage('rate limit exceeded, retry after 30s')).toBe(false);
    expect(isBillingQuotaMessage('Anthropic API error: 529 overloaded')).toBe(false);
    expect(isBillingQuotaMessage('fetch failed')).toBe(false);
    expect(isBillingQuotaMessage('stream idle timeout')).toBe(false);
  });

  it('recognizes LLMQuotaError instances and re-wrapped billing messages', () => {
    expect(isProviderQuotaError(new LLMQuotaError('quota', 'anthropic'))).toBe(true);
    // Re-wrapped by a retry layer into a plain Error — type lost, message kept.
    expect(isProviderQuotaError(new Error(
      'Scene Writer failed on s2-2 after retry: Anthropic API error: Your credit balance is too low to access the Anthropic API.',
    ))).toBe(true);
    expect(isProviderQuotaError(new Error('Scene Writer failed on s2-2 after retry: timeout'))).toBe(false);
  });

  it('billing errors are not retryable in BaseAgent classification', () => {
    const { isRetryable } = BaseAgent.classifyLlmError({
      message: 'anthropic api error: your credit balance is too low to access the anthropic api.',
      isQuotaError: true,
    });
    expect(isRetryable).toBe(false);
  });

  it('BaseAgent billing latch starts clear and resets', () => {
    BaseAgent.resetBillingQuotaState();
    expect(BaseAgent.billingQuotaExhausted()).toBeNull();
  });
});
