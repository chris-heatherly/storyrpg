import { describe, it, expect } from 'vitest';
import {
  VisualQualityJudge,
  type VisualCheck,
  type VisualCheckResult,
} from './VisualQualityJudge';

function makePassingCheck(id: string, score?: number): VisualCheck<{}> {
  return {
    id,
    severity: 'info',
    description: `passes: ${id}`,
    run: async (): Promise<VisualCheckResult> => ({
      checkId: id,
      severity: 'info',
      passed: true,
      score,
      issues: [],
    }),
  };
}

function makeFailingCheck(
  id: string,
  severity: 'error' | 'warning',
  message = 'bad'
): VisualCheck<{}> {
  return {
    id,
    severity,
    description: `fails: ${id}`,
    run: async (): Promise<VisualCheckResult> => ({
      checkId: id,
      severity,
      passed: false,
      issues: [{ checkId: id, severity, message }],
    }),
  };
}

describe('VisualQualityJudge', () => {
  it('passes when every check passes', async () => {
    const judge = new VisualQualityJudge();
    const report = await judge.run(
      [makePassingCheck('a', 80), makePassingCheck('b', 90)],
      {}
    );

    expect(report.passed).toBe(true);
    expect(report.severity).toBe('info');
    expect(report.averageScore).toBe(85);
    expect(report.issues).toEqual([]);
    expect(report.blockingIssues).toEqual([]);
  });

  it('fails with highest severity when any check errors', async () => {
    const judge = new VisualQualityJudge();
    const report = await judge.run(
      [
        makePassingCheck('a'),
        makeFailingCheck('b', 'warning'),
        makeFailingCheck('c', 'error'),
      ],
      {}
    );

    expect(report.passed).toBe(false);
    expect(report.severity).toBe('error');
    expect(report.issues).toHaveLength(2);
    expect(report.blockingIssues).toHaveLength(1);
    expect(report.blockingIssues[0].checkId).toBe('c');
  });

  it('captures a thrown check as an `error` result without failing the whole judge', async () => {
    const throwingCheck: VisualCheck<{}> = {
      id: 'boom',
      severity: 'error',
      description: 'throws',
      run: async () => {
        throw new Error('LLM timeout');
      },
    };

    const judge = new VisualQualityJudge();
    const report = await judge.run([makePassingCheck('a'), throwingCheck], {});

    const boom = report.results.find((r) => r.checkId === 'boom');
    expect(boom?.error?.message).toBe('LLM timeout');
    expect(boom?.passed).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((i) => i.code === 'check_threw')).toBe(true);
  });

  it('honors the blockingSeverity threshold', async () => {
    const judge = new VisualQualityJudge({ blockingSeverity: 'warning' });
    const report = await judge.run([makeFailingCheck('w', 'warning')], {});

    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toHaveLength(1);
    expect(report.severity).toBe('warning');
  });

  it('failFast stops after the first blocking failure', async () => {
    const calls: string[] = [];
    const spyCheck = (id: string, severity: 'error' | 'warning' | 'info'): VisualCheck<{}> => ({
      id,
      severity,
      description: id,
      run: async () => {
        calls.push(id);
        return {
          checkId: id,
          severity,
          passed: severity !== 'error',
          issues: severity === 'error' ? [{ checkId: id, severity, message: 'no' }] : [],
        };
      },
    });

    const judge = new VisualQualityJudge({ failFast: true, blockingSeverity: 'error' });
    await judge.run([spyCheck('ok', 'info'), spyCheck('boom', 'error'), spyCheck('later', 'info')], {});

    expect(calls).toEqual(['ok', 'boom']);
  });
});
