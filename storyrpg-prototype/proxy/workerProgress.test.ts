import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// workerProgress is a CommonJS module; load it via require for stable interop.
const require = createRequire(import.meta.url);
const { estimateWorkerProgress } = require('./workerProgress.js');

describe('estimateWorkerProgress with plan-driven telemetry', () => {
  it('prefers telemetry.overallProgress over the phase ramp', () => {
    // Phase ramp would put 'content' at 60, but the plan says 40.
    const result = estimateWorkerProgress('generation', 'content', 'debug', 0, { generationPlan: {} }, { overallProgress: 40 });
    expect(result).toBe(40);
  });

  it('never decreases below previousProgress (monotonic)', () => {
    // Plan reports 40 but we were already at 55 — stay at 55.
    const result = estimateWorkerProgress('generation', 'content', 'debug', 55, null, { overallProgress: 40 });
    expect(result).toBe(55);
  });

  it('advances as the plan-derived overallProgress climbs', () => {
    const series = [10, 25, 40, 72, 100];
    let prev = 0;
    for (const value of series) {
      const next = estimateWorkerProgress('generation', 'content', 'debug', prev, null, { overallProgress: value });
      expect(next).toBeGreaterThanOrEqual(prev);
      expect(next).toBe(value);
      prev = next;
    }
  });

  it('clamps plan-derived values to 0-100', () => {
    expect(estimateWorkerProgress('generation', 'content', 'debug', 0, null, { overallProgress: 150 })).toBe(100);
  });

  it('falls back to the legacy ramp when no telemetry overallProgress is present', () => {
    // No plan / no telemetry → milestone for 'world'.
    const result = estimateWorkerProgress('generation', 'world', 'phase_start', 0, null, null);
    expect(result).toBeGreaterThan(0);
  });
});
