import { describe, expect, it } from 'vitest';
import { deriveStoryCircleQualityScore } from './qualityScoring';

describe('qualityScoring caps and eligibility', () => {
  it('caps planning-register leakage below the 90 target and marks the run ineligible', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: {
        id: 'synthetic',
        title: 'Synthetic',
        metadata: { version: '1', createdAt: '', updatedAt: '' },
        initialState: {},
        episodes: [{
          id: 'ep1',
          number: 1,
          title: 'Episode',
          synopsis: '',
          startingSceneId: 's1',
          scenes: [{
            id: 's1',
            startingBeatId: 'b1',
            beats: [{ id: 'b1', text: 'You open the door.' }],
          }],
        }],
      } as any,
      finalStoryContractReport: {
        passed: false,
        blockingIssues: [{
          type: 'planning_register_prose',
          validator: 'PlanningRegisterLeakValidator',
          message: 'Planning-register instruction leaked into story content.',
          severity: 'error',
        }],
        warnings: [],
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    expect(result.score).toBeLessThan(90);
    expect(result.basis.qualityEligibility.eligibleFor90).toBe(false);
    expect(result.basis.caps.some((cap) => cap.id === 'planning_register_leak' && cap.maxScore === 69)).toBe(true);
  });
});
