import { describe, expect, it } from 'vitest';
import { RemediationBudget, createRemediationBudget, shouldAttemptRemediation } from './RemediationBudget';

describe('RemediationBudget', () => {
  it('starts with the full budget available', () => {
    const budget = new RemediationBudget(5);
    expect(budget.spent()).toBe(0);
    expect(budget.remaining()).toBe(5);
    expect(budget.canSpend()).toBe(true);
    expect(budget.canSpend(5)).toBe(true);
    expect(budget.canSpend(6)).toBe(false);
  });

  it('debits the budget on spend', () => {
    const budget = new RemediationBudget(5);
    budget.spend();
    expect(budget.spent()).toBe(1);
    expect(budget.remaining()).toBe(4);
    budget.spend(2);
    expect(budget.spent()).toBe(3);
    expect(budget.remaining()).toBe(2);
  });

  it('reports canSpend false once exhausted at the total', () => {
    const budget = new RemediationBudget(2);
    budget.spend(2);
    expect(budget.spent()).toBe(2);
    expect(budget.remaining()).toBe(0);
    expect(budget.canSpend()).toBe(false);
    expect(budget.canSpend(1)).toBe(false);
  });

  it('clamps remaining at 0 when spending over the total', () => {
    const budget = new RemediationBudget(2);
    budget.spend(5);
    expect(budget.spent()).toBe(2);
    expect(budget.remaining()).toBe(0);
    expect(budget.canSpend()).toBe(false);
  });

  it('ignores non-positive spend amounts', () => {
    const budget = new RemediationBudget(3);
    budget.spend(0);
    budget.spend(-2);
    expect(budget.spent()).toBe(0);
    expect(budget.remaining()).toBe(3);
  });

  it('treats a zero (or negative) total as immediately exhausted', () => {
    const zero = new RemediationBudget(0);
    expect(zero.remaining()).toBe(0);
    expect(zero.canSpend()).toBe(false);

    const negative = new RemediationBudget(-4);
    expect(negative.remaining()).toBe(0);
    expect(negative.canSpend()).toBe(false);
  });

  it('createRemediationBudget defaults to a total of 12', () => {
    const budget = createRemediationBudget();
    expect(budget.remaining()).toBe(12);
    expect(budget.canSpend(12)).toBe(true);
    expect(budget.canSpend(13)).toBe(false);
  });

  it('createRemediationBudget honors an explicit total', () => {
    const budget = createRemediationBudget(3);
    expect(budget.remaining()).toBe(3);
  });
});

describe('shouldAttemptRemediation', () => {
  it('treats a null/undefined budget as unbudgeted (always allow)', () => {
    expect(shouldAttemptRemediation(null)).toBe(true);
    expect(shouldAttemptRemediation(undefined)).toBe(true);
    expect(shouldAttemptRemediation(null, 999)).toBe(true);
  });

  it('allows attempts while budget remains and denies once exhausted', () => {
    const budget = new RemediationBudget(2);
    expect(shouldAttemptRemediation(budget)).toBe(true);
    budget.spend(1);
    expect(shouldAttemptRemediation(budget)).toBe(true);
    budget.spend(1);
    expect(shouldAttemptRemediation(budget)).toBe(false);
  });

  it('respects a multi-unit requested cost', () => {
    const budget = new RemediationBudget(2);
    expect(shouldAttemptRemediation(budget, 2)).toBe(true);
    expect(shouldAttemptRemediation(budget, 3)).toBe(false);
  });

  it('a HIGH default ceiling never denies a realistic number of attempts', () => {
    // Mirrors the pipeline default (1000): existing always-on regen is never gated.
    const budget = createRemediationBudget(1000);
    for (let i = 0; i < 50; i++) {
      expect(shouldAttemptRemediation(budget)).toBe(true);
      budget.spend(1);
    }
    expect(budget.remaining()).toBe(950);
  });
});
