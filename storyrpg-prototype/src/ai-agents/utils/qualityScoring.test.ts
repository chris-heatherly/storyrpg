import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  it('dedupes identical final-contract and sidecar findings before scoring domains', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'storyrpg-quality-'));
    const message = 'Choice "c1" sets unplanned consequential flag "kept_the_card".';
    writeFileSync(join(outputDir, 'episode-1-incremental-contract.json'), JSON.stringify({
      warnings: [{
        type: 'planned_residue_debt',
        validator: 'ResidueObligationValidator',
        message,
      }],
    }));

    try {
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
          passed: true,
          blockingIssues: [],
          warnings: [{
            type: 'planned_residue_debt',
            validator: 'ResidueObligationValidator',
            message,
            severity: 'warning',
          }],
        } as any,
      }, { outputDir, now: new Date('2026-01-01T00:00:00Z') });

      const branching = result.basis.domains.find((domain) => domain.id === 'branching_consequence_memory');
      expect(branching?.findings.filter((finding) => finding.message === message)).toHaveLength(1);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
