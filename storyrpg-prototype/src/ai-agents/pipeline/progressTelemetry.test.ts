import { describe, expect, it } from 'vitest';
import { ProgressTelemetryTracker } from './progressTelemetry';
import type { GenerationPlan } from './generationPlan';

function makeTracker(overrides?: { startedAtMs?: number; plan?: GenerationPlan | null }) {
  return new ProgressTelemetryTracker({
    pipelineStartedAtMs: () => overrides?.startedAtMs ?? 0,
    generationPlan: () => overrides?.plan ?? null,
  });
}

describe('normalizeTelemetryPhase', () => {
  const tracker = makeTracker();

  it('maps raw phases onto telemetry phases', () => {
    expect(tracker.normalizeTelemetryPhase(undefined)).toBe('initialization');
    expect(tracker.normalizeTelemetryPhase('multi_episode_init')).toBe('initialization');
    expect(tracker.normalizeTelemetryPhase('episode_3')).toBe('content');
    expect(tracker.normalizeTelemetryPhase('qa_ep_2')).toBe('qa');
    expect(tracker.normalizeTelemetryPhase('images_ep_1')).toBe('images');
    expect(tracker.normalizeTelemetryPhase('image_manifest')).toBe('images');
    expect(tracker.normalizeTelemetryPhase('assembly')).toBe('assembly');
  });
});

describe('getTelemetryPhaseBounds', () => {
  it('returns the fixed ramp for known phases', () => {
    const tracker = makeTracker();
    expect(tracker.getTelemetryPhaseBounds('content')).toEqual([54, 72]);
    expect(tracker.getTelemetryPhaseBounds('complete')).toEqual([100, 100]);
  });

  it('anchors unknown phases at the last overall progress', () => {
    const tracker = makeTracker();
    expect(tracker.getTelemetryPhaseBounds('mystery')).toEqual([0, 1]);
  });
});

describe('buildProgressTelemetry', () => {
  it('is monotonic: progress never regresses across events', () => {
    const tracker = makeTracker();
    const first = tracker.buildProgressTelemetry({ type: 'phase_complete', phase: 'architecture', message: '' });
    expect(first?.overallProgress).toBe(48);
    const second = tracker.buildProgressTelemetry({ type: 'phase_start', phase: 'world', message: '' });
    expect(second?.overallProgress).toBeGreaterThanOrEqual(48);
  });

  it('computes phase progress from item counts in event data', () => {
    const tracker = makeTracker();
    const t = tracker.buildProgressTelemetry({
      type: 'debug',
      phase: 'content',
      message: '',
      data: { currentItem: 1, totalItems: 4, subphaseLabel: 'scenes' },
    });
    expect(t?.phaseProgress).toBe(25);
    expect(t?.currentItem).toBe(1);
    expect(t?.totalItems).toBe(4);
    expect(t?.subphaseLabel).toBe('scenes');
  });

  it('reset() drops the monotonic floor for a new run', () => {
    const tracker = makeTracker();
    tracker.buildProgressTelemetry({ type: 'phase_complete', phase: 'qa', message: '' });
    tracker.reset();
    const t = tracker.buildProgressTelemetry({ type: 'phase_start', phase: 'initialization', message: '' });
    expect(t?.overallProgress).toBe(0);
  });

  it('reports elapsed seconds once the pipeline has started', () => {
    const tracker = makeTracker({ startedAtMs: Date.now() - 5000 });
    const t = tracker.buildProgressTelemetry({ type: 'debug', phase: 'content', message: '' });
    expect(t?.elapsedSeconds).toBeGreaterThanOrEqual(4);
    expect(t?.elapsedSeconds).toBeLessThanOrEqual(7);
  });
});
