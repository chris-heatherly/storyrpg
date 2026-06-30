import { describe, it, expect, vi } from 'vitest';
import { CompositionCheck } from './CompositionCheck';

function makeAgent(response: any) {
  return {
    execute: vi.fn().mockResolvedValue(response),
  } as any;
}

const request = {
  image: { data: 'abc', mimeType: 'image/png' },
  shotType: 'medium',
  intendedComposition: 'rule-of-thirds',
};

describe('CompositionCheck', () => {
  it('passes when the underlying report is valid', async () => {
    const agent = makeAgent({
      success: true,
      data: { isValid: true, score: 82, feedback: 'good', ruleViolations: [] },
    });
    const check = new CompositionCheck(agent);

    const result = await check.run(request, {});

    expect(result.passed).toBe(true);
    expect(result.score).toBe(82);
    expect(result.issues).toEqual([]);
    expect(agent.execute).toHaveBeenCalledWith(request);
  });

  it('surfaces ruleViolations and poseIssues as separate issues', async () => {
    const agent = makeAgent({
      success: true,
      data: {
        isValid: false,
        score: 42,
        feedback: 'flawed',
        ruleViolations: ['subject centered', 'cluttered background'],
        poseAnalysis: {
          lineOfAction: 'rigid',
          isAsymmetric: false,
          silhouetteReadable: false,
          weightDistributionClear: false,
          poseIssues: ['stiff stance'],
        },
      },
    });
    const check = new CompositionCheck(agent);

    const result = await check.run(request, {});

    expect(result.passed).toBe(false);
    expect(result.issues.map((i) => i.message)).toEqual([
      'subject centered',
      'cluttered background',
      'stiff stance',
    ]);
    expect(result.issues.every((i) => i.checkId === 'composition')).toBe(true);
    expect(result.issues.find((i) => i.code === 'pose_issue')).toBeTruthy();
  });

  it('returns a validator_failed issue when the agent reports no data', async () => {
    const agent = makeAgent({ success: false, error: 'LLM outage' });
    const check = new CompositionCheck(agent);

    const result = await check.run(request, {});

    expect(result.passed).toBe(false);
    expect(result.error?.message).toBe('LLM outage');
    expect(result.issues[0].code).toBe('validator_failed');
  });
});
