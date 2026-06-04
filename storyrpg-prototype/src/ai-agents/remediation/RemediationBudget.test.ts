import { describe, expect, it } from 'vitest';
import { RemediationBudget, createRemediationBudget } from './RemediationBudget';

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
