import { describe, expect, it } from 'vitest';
import { ChoiceCoverageValidator } from './ChoiceCoverageValidator';

describe('ChoiceCoverageValidator', () => {
  it('flags a planned choice scene that authored no choice', () => {
    const r = new ChoiceCoverageValidator().validate({
      plannedChoiceSceneIds: ['s1', 's2', 's3'],
      authoredChoiceSceneIds: ['s1', 's3'],
    });
    expect(r.valid).toBe(false);
    expect(r.metrics.missing).toEqual(['s2']);
    expect(r.metrics.coverageRatio).toBeCloseTo(2 / 3);
  });

  it('passes when every planned scene authored its choice', () => {
    const r = new ChoiceCoverageValidator().validate({
      plannedChoiceSceneIds: ['s1', 's2'],
      authoredChoiceSceneIds: ['s1', 's2'],
    });
    expect(r.valid).toBe(true);
    expect(r.metrics.coverageRatio).toBe(1);
  });

  it('surfaces unplanned coverage as info (not a failure)', () => {
    const r = new ChoiceCoverageValidator().validate({
      plannedChoiceSceneIds: ['s1'],
      authoredChoiceSceneIds: ['s1', 's2'],
    });
    expect(r.valid).toBe(true);
    expect(r.metrics.unplanned).toEqual(['s2']);
    expect(r.issues.some((i) => i.severity === 'info')).toBe(true);
  });

  it('handles an empty plan', () => {
    const r = new ChoiceCoverageValidator().validate({ plannedChoiceSceneIds: [], authoredChoiceSceneIds: [] });
    expect(r.valid).toBe(true);
    expect(r.metrics.coverageRatio).toBe(1);
  });
});
