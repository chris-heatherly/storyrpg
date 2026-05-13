import { describe, it, expect } from 'vitest';
import { buildBranchShadowDiff } from './branchShadowDiff';
import type { DeterministicBranchTopology } from './branchTopology';
import type { BranchAnalysis, ValidationIssue } from '../agents/BranchManager';

function makeDeterministic(
  overrides: Partial<DeterministicBranchTopology> = {},
): DeterministicBranchTopology {
  return {
    unreachableSceneIds: [],
    deadEndSceneIds: [],
    reconvergenceSceneIds: [],
    incomingCounts: {},
    ...overrides,
  };
}

function makeIssue(
  partial: Partial<ValidationIssue> & Pick<ValidationIssue, 'affectedScenes'>,
): ValidationIssue {
  return {
    severity: 'warning',
    type: 'unreachable_scene',
    description: 'test',
    ...partial,
  };
}

function makeLlm(issues: ValidationIssue[]): BranchAnalysis {
  return {
    episodeId: 'ep-1',
    branchPaths: [],
    reconvergencePoints: [],
    stateTrackingMap: [],
    validationIssues: issues,
    recommendations: [],
  };
}

describe('buildBranchShadowDiff', () => {
  it('returns empty agreement when both sides flag nothing', () => {
    const diff = buildBranchShadowDiff(makeLlm([]), makeDeterministic());
    expect(diff.agreedScenes).toEqual([]);
    expect(diff.llmOnlyScenes).toEqual([]);
    expect(diff.deterministicOnlyScenes).toEqual([]);
    expect(diff.counts.llmValidationIssues).toBe(0);
  });

  it('classifies overlapping findings as agreed', () => {
    const llm = makeLlm([makeIssue({ affectedScenes: ['s1', 's2'] })]);
    const det = makeDeterministic({ unreachableSceneIds: ['s1'], deadEndSceneIds: ['s2'] });

    const diff = buildBranchShadowDiff(llm, det);

    expect(diff.agreedScenes).toEqual(['s1', 's2']);
    expect(diff.llmOnlyScenes).toEqual([]);
    expect(diff.deterministicOnlyScenes).toEqual([]);
  });

  it('splits findings when only one side flags a scene', () => {
    const llm = makeLlm([makeIssue({ affectedScenes: ['only-llm'] })]);
    const det = makeDeterministic({ deadEndSceneIds: ['only-det'] });

    const diff = buildBranchShadowDiff(llm, det);

    expect(diff.agreedScenes).toEqual([]);
    expect(diff.llmOnlyScenes).toEqual(['only-llm']);
    expect(diff.deterministicOnlyScenes).toEqual(['only-det']);
  });

  it('treats reconvergence points as non-issues for scene diffing', () => {
    const llm = makeLlm([]);
    const det = makeDeterministic({ reconvergenceSceneIds: ['s-reconverge'] });

    const diff = buildBranchShadowDiff(llm, det);

    expect(diff.deterministicOnlyScenes).toEqual([]);
    expect(diff.counts.deterministicReconvergence).toBe(1);
    expect(diff.deterministicFindings.reconvergenceSceneIds).toEqual(['s-reconverge']);
  });

  it('handles null LLM output gracefully', () => {
    const det = makeDeterministic({ unreachableSceneIds: ['s1'] });
    const diff = buildBranchShadowDiff(null, det);
    expect(diff.llmIssues).toEqual([]);
    expect(diff.llmOnlyScenes).toEqual([]);
    expect(diff.deterministicOnlyScenes).toEqual(['s1']);
    expect(diff.counts.llmValidationIssues).toBe(0);
  });
});
