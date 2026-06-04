import { describe, it, expect, vi } from 'vitest';
import { runGatedRemediation, GatedRemediationError } from './runGatedRemediation';

describe('runGatedRemediation (S4 gated remediation runner)', () => {
  it('passes on the first detect without remediating', async () => {
    const remediate = vi.fn();
    const result = await runGatedRemediation({
      detect: () => ({ passed: true }),
      remediate,
      maxAttempts: 3,
      blocking: true,
    });

    expect(result).toEqual({ passed: true, degraded: false, blocked: false, attempts: 0 });
    expect(remediate).not.toHaveBeenCalled();
  });

  it('passes after k remediation passes', async () => {
    let passAfter = 2;
    const onAttempt = vi.fn();
    const remediate = vi.fn(() => {
      passAfter -= 1;
    });

    const result = await runGatedRemediation({
      detect: () => ({ passed: passAfter <= 0 }),
      remediate,
      maxAttempts: 5,
      blocking: true,
      onAttempt,
    });

    expect(result).toEqual({ passed: true, degraded: false, blocked: false, attempts: 2 });
    expect(remediate).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenNthCalledWith(1, 1);
    expect(onAttempt).toHaveBeenNthCalledWith(2, 2);
  });

  it('degrades when a non-blocking gate exhausts its attempts', async () => {
    const remediate = vi.fn();
    const result = await runGatedRemediation({
      detect: () => ({ passed: false, issues: ['nope'] }),
      remediate,
      maxAttempts: 2,
      blocking: false,
    });

    expect(result).toEqual({ passed: false, degraded: true, blocked: false, attempts: 2 });
    expect(remediate).toHaveBeenCalledTimes(2);
  });

  it('throws GatedRemediationError when a blocking gate exhausts and is not opted out', async () => {
    const remediate = vi.fn();
    await expect(
      runGatedRemediation({
        detect: () => ({ passed: false }),
        remediate,
        maxAttempts: 2,
        blocking: true,
      }),
    ).rejects.toBeInstanceOf(GatedRemediationError);
    expect(remediate).toHaveBeenCalledTimes(2);
  });

  it('carries the attempt count on the thrown error', async () => {
    let caught: unknown;
    try {
      await runGatedRemediation({
        detect: () => ({ passed: false }),
        remediate: () => {},
        maxAttempts: 3,
        blocking: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GatedRemediationError);
    expect((caught as GatedRemediationError).attempts).toBe(3);
  });

  it('never throws when opted out, degrading instead', async () => {
    const result = await runGatedRemediation({
      detect: () => ({ passed: false }),
      remediate: () => {},
      maxAttempts: 2,
      blocking: true,
      optedOut: true,
    });

    expect(result).toEqual({ passed: false, degraded: true, blocked: false, attempts: 2 });
  });

  it('short-circuits to degrade (no throw) when canSpend is false on a blocking gate', async () => {
    const remediate = vi.fn();
    const result = await runGatedRemediation({
      detect: () => ({ passed: false }),
      remediate,
      maxAttempts: 3,
      blocking: true,
      canSpend: () => false,
    });

    expect(result).toEqual({ passed: false, degraded: true, blocked: false, attempts: 0 });
    expect(remediate).not.toHaveBeenCalled();
  });

  it('supports async detect and remediate callbacks', async () => {
    let passAfter = 1;
    const result = await runGatedRemediation({
      detect: async () => ({ passed: passAfter <= 0 }),
      remediate: async () => {
        passAfter -= 1;
      },
      maxAttempts: 3,
      blocking: false,
    });

    expect(result).toEqual({ passed: true, degraded: false, blocked: false, attempts: 1 });
  });
});
