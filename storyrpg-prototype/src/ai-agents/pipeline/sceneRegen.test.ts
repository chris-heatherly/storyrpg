import { describe, expect, it, vi } from 'vitest';
import { regenUntilClean } from './sceneRegen';
import { RemediationBudget } from '../remediation/RemediationBudget';

describe('regenUntilClean', () => {
  it('accepts the first candidate that validates', async () => {
    const attempt = vi.fn(async () => 'v1');
    const result = await regenUntilClean({
      label: 'x', maxAttempts: 3,
      attempt,
      validate: () => ({ ok: true, issues: [] }),
    });
    expect(result).toMatchObject({ accepted: true, degraded: false, attempts: 1 });
    expect(result.value).toBe('v1');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries with prior issues then accepts', async () => {
    let n = 0;
    const seenPriorIssues: string[][] = [];
    const result = await regenUntilClean({
      label: 'x', maxAttempts: 3,
      attempt: async (ctx) => { seenPriorIssues.push(ctx.priorIssues); return `v${++n}`; },
      validate: (v) => v === 'v2' ? { ok: true, issues: [] } : { ok: false, issues: [`bad ${v}`] },
    });
    expect(result.accepted).toBe(true);
    expect(result.value).toBe('v2');
    expect(result.attempts).toBe(2);
    // First attempt sees no prior issues; second sees the first failure's issues.
    expect(seenPriorIssues[0]).toEqual([]);
    expect(seenPriorIssues[1]).toEqual(['bad v1']);
  });

  it('degrades after maxAttempts, returning the last candidate + outstanding issues', async () => {
    let n = 0;
    const result = await regenUntilClean({
      label: 'x', maxAttempts: 2,
      attempt: async () => `v${++n}`,
      validate: (v) => ({ ok: false, issues: [`still bad ${v}`] }),
    });
    expect(result.accepted).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.value).toBe('v2');
    expect(result.finalIssues).toEqual(['still bad v2']);
  });

  it('debits the remediation budget and stops when exhausted', async () => {
    const budget = new RemediationBudget(1);
    const attempt = vi.fn(async () => 'v');
    const result = await regenUntilClean({
      label: 'x', maxAttempts: 5, budget,
      attempt,
      validate: () => ({ ok: false, issues: ['no'] }),
    });
    // Only one attempt could be afforded.
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.degraded).toBe(true);
    expect(budget.remaining()).toBe(0);
  });

  it('does nothing and reports no attempt when maxAttempts is 0', async () => {
    const attempt = vi.fn(async () => 'v');
    const result = await regenUntilClean({
      label: 'x', maxAttempts: 0,
      attempt,
      validate: () => ({ ok: true, issues: [] }),
    });
    expect(attempt).not.toHaveBeenCalled();
    expect(result).toMatchObject({ accepted: false, degraded: false, attempts: 0, value: undefined });
  });

  it('emits triggered/accepted events', async () => {
    const events: string[] = [];
    await regenUntilClean({
      label: 'scene:s1', maxAttempts: 2,
      attempt: async () => 'v',
      validate: () => ({ ok: true, issues: [] }),
      onEvent: (e) => events.push(e.type),
    });
    expect(events).toEqual(['regeneration_triggered', 'regeneration_accepted']);
  });
});
