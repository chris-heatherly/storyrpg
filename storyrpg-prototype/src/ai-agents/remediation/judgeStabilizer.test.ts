import { describe, expect, it } from 'vitest';
import {
  type JudgeVerdict,
  stabilizeByHysteresis,
  stabilizeBySampling,
} from './judgeStabilizer';

/**
 * Deterministic stub judge: returns scripted verdicts by call index so the
 * sampling aggregation is fully reproducible (no randomness, no wall-clock).
 */
const scriptedJudge = (verdicts: JudgeVerdict[]): (() => Promise<JudgeVerdict>) => {
  let call = 0;
  return () => {
    const verdict = verdicts[call];
    call += 1;
    return Promise.resolve(verdict);
  };
};

describe('stabilizeByHysteresis', () => {
  const failThreshold = 70;
  const margin = 5;

  it('fails when the score is below the threshold minus the margin', () => {
    // 64 < 70 - 5 (65) => clearly below => failed
    expect(stabilizeByHysteresis(64, failThreshold, margin)).toBe(true);
  });

  it('does not fail for a borderline score within the margin band', () => {
    // 67 is below the nominal threshold but inside [65, 70) => treated as pass
    expect(stabilizeByHysteresis(67, failThreshold, margin)).toBe(false);
    // exactly at the lower edge (65) is not strictly below => pass
    expect(stabilizeByHysteresis(65, failThreshold, margin)).toBe(false);
  });

  it('does not fail for a score well above the threshold', () => {
    expect(stabilizeByHysteresis(90, failThreshold, margin)).toBe(false);
  });

  it('reduces to a plain less-than comparison with a zero margin', () => {
    expect(stabilizeByHysteresis(69, failThreshold, 0)).toBe(true);
    expect(stabilizeByHysteresis(70, failThreshold, 0)).toBe(false);
  });
});

describe('stabilizeBySampling', () => {
  it('fails when a majority (2 of 3) of samples fail', async () => {
    const judge = scriptedJudge([
      { failed: true, score: 60 },
      { failed: false, score: 80 },
      { failed: true, score: 64 },
    ]);
    const result = await stabilizeBySampling(judge, 3);
    expect(result.failed).toBe(true);
    expect(result.score).toBe((60 + 80 + 64) / 3);
  });

  it('does not fail when a minority (1 of 3) of samples fail', async () => {
    const judge = scriptedJudge([
      { failed: false, score: 90 },
      { failed: true, score: 50 },
      { failed: false, score: 88 },
    ]);
    const result = await stabilizeBySampling(judge, 3);
    expect(result.failed).toBe(false);
    expect(result.score).toBe((90 + 50 + 88) / 3);
  });

  it('averages the sampled scores', async () => {
    const judge = scriptedJudge([
      { failed: false, score: 72 },
      { failed: false, score: 78 },
      { failed: false, score: 75 },
    ]);
    const result = await stabilizeBySampling(judge, 3);
    expect(result.score).toBe(75);
  });

  it('invokes the judge exactly `samples` times in order', async () => {
    const calls: number[] = [];
    let i = 0;
    const judge = () => {
      const score = [10, 20, 30][i];
      calls.push(score);
      i += 1;
      return Promise.resolve({ failed: false, score });
    };
    await stabilizeBySampling(judge, 3);
    expect(calls).toEqual([10, 20, 30]);
  });

  it('rejects non-positive or non-integer sample counts', async () => {
    const judge = scriptedJudge([{ failed: false, score: 80 }]);
    await expect(stabilizeBySampling(judge, 0)).rejects.toThrow();
    await expect(stabilizeBySampling(judge, 2.5)).rejects.toThrow();
  });
});
