import { describe, expect, it } from 'vitest';

import {
  recomputeContinuityIssueCount,
  normalizeContinuitySeverity,
  type ContinuityIssue,
} from './QAAgents';

describe('QAAgents continuity normalization', () => {
  it('normalizes model severity casing and recomputes issue counts from issues', () => {
    const issues = [
      { severity: 'ERROR', type: 'impossible_knowledge', location: { sceneId: 'scene-5' }, description: 'A recalled quote never happened.', suggestedFix: 'Remove the false quote.' },
      { severity: 'Warning', type: 'missing_setup', location: { sceneId: 'scene-3' }, description: 'Setup is thin.', suggestedFix: 'Seed the setup.' },
      { severity: 'suggestion', type: 'contradiction', location: { sceneId: 'scene-2' }, description: 'Minor polish.', suggestedFix: 'Polish.' },
    ] as unknown as ContinuityIssue[];

    const normalized = issues.map(issue => ({ ...issue, severity: normalizeContinuitySeverity(issue.severity) }));

    expect(normalized.map(issue => issue.severity)).toEqual(['error', 'warning', 'suggestion']);
    expect(recomputeContinuityIssueCount(normalized)).toEqual({
      errors: 1,
      warnings: 1,
      suggestions: 1,
    });
  });
});
