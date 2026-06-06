import { describe, it, expect } from 'vitest';
import {
  runFinalContractRepair,
  type ContractRepairReport,
  type ContractRepairHandler,
} from './finalContractRepair';
import type { Story } from '../../types/story';

// Minimal stand-in story; the loop never inspects its fields (handlers/revalidate are fakes).
const story = { id: 's1', title: 'T' } as unknown as Story;
const fail: ContractRepairReport = { passed: false, blockingIssues: [{ message: 'x', severity: 'error' }] };
const pass: ContractRepairReport = { passed: true, blockingIssues: [] };

describe('runFinalContractRepair', () => {
  it('no-ops when the report already passes', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: pass,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => pass,
    });
    expect(out.passed).toBe(true);
    expect(out.attempts).toBe(0);
    expect(out.records).toHaveLength(0);
  });

  it('repairs and re-validates to a pass, recording the handler', async () => {
    const handler: ContractRepairHandler = () => ({
      story,
      changed: true,
      record: { rule: 'structural', scope: 'autofix', attempted: 1, succeeded: true, degraded: false, blocked: false, attempts: 1 },
    });
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [handler],
      revalidate: async () => pass,
    });
    expect(out.passed).toBe(true);
    expect(out.attempts).toBe(1);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].rule).toBe('structural');
  });

  it('stops at a fixpoint when no handler changes anything (still failing)', async () => {
    let revalidations = 0;
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: false })],
      revalidate: async () => {
        revalidations += 1;
        return fail;
      },
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(1); // one round attempted, then fixpoint break
    expect(revalidations).toBe(0); // never re-validated because nothing changed
  });

  it('respects maxAttempts when repairs keep changing but never pass', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => fail,
      maxAttempts: 3,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(3);
  });

  it('stops early when canSpend denies another round', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => fail,
      maxAttempts: 5,
      canSpend: () => false,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(0);
  });
});
