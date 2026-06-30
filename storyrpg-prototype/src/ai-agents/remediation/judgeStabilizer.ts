/**
 * Bucket C judge-stabilization primitive.
 *
 * LLM-as-judge scores are noisy: re-judging the same artifact can land a few
 * points on either side of a hard threshold purely from sampling variance.
 * Naively gating on `score < failThreshold` therefore turns that noise into
 * spurious regeneration churn (a "pass" artifact gets a borderline judge draw,
 * fails, gets regenerated, and the new artifact may be no better).
 *
 * This module offers two complementary, fully deterministic stabilizers. Both
 * are pure given their inputs — there is no wall-clock or randomness here; any
 * stochasticity lives entirely inside the injected judge function the caller
 * supplies to {@link stabilizeBySampling}.
 */

export interface JudgeVerdict {
  failed: boolean;
  score: number;
}

/**
 * Hysteresis gate: only declare failure when the score is *clearly* below the
 * threshold, i.e. below `failThreshold - hysteresisMargin`. Scores that sit in
 * the `[failThreshold - hysteresisMargin, failThreshold)` band are treated as a
 * pass, on the assumption that such a borderline draw is more likely judge
 * noise than a genuine regression. This trades a slightly more permissive gate
 * for far fewer noise-triggered regenerations.
 *
 * @param score            the judge's numeric score
 * @param failThreshold    the nominal score below which an artifact "fails"
 * @param hysteresisMargin how far below the threshold a score must fall before
 *                         we trust the failure (>= 0; 0 reduces to a plain `<`)
 * @returns true only when `score < failThreshold - hysteresisMargin`
 */
export function stabilizeByHysteresis(
  score: number,
  failThreshold: number,
  hysteresisMargin: number,
): boolean {
  return score < failThreshold - hysteresisMargin;
}

/**
 * Sampling gate: run the (potentially noisy) judge `samples` times and combine
 * the verdicts. Failure is decided by majority vote across the samples, and the
 * reported score is the arithmetic mean of the sampled scores. `samples` is
 * expected to be a positive odd integer (e.g. 3) so the majority vote can never
 * tie.
 *
 * Pure given the injected judge: the same scripted `runJudge` yields the same
 * aggregate verdict every time.
 *
 * @param runJudge a judge invocation; called exactly `samples` times in order
 * @param samples  number of independent judge draws (odd, >= 1)
 * @returns aggregate verdict: `failed` = majority of draws failed,
 *          `score` = mean of the drawn scores
 */
export async function stabilizeBySampling(
  runJudge: () => Promise<JudgeVerdict>,
  samples: number,
): Promise<JudgeVerdict> {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`stabilizeBySampling: samples must be a positive integer, got ${samples}`);
  }

  let failedCount = 0;
  let scoreTotal = 0;

  for (let i = 0; i < samples; i += 1) {
    const verdict = await runJudge();
    if (verdict.failed) {
      failedCount += 1;
    }
    scoreTotal += verdict.score;
  }

  return {
    failed: failedCount * 2 > samples,
    score: scoreTotal / samples,
  };
}
