import { describe, expect, it } from 'vitest';

import {
  recomputeContinuityIssueCount,
  normalizeContinuitySeverity,
  deriveContinuityScore,
  deriveVoiceScore,
  deriveEvidenceLimitedScore,
  deriveQAOutcome,
  recomputeQAReportDerived,
  buildQAReportSummary,
  type ContinuityIssue,
  type QAReport,
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

describe('deriveContinuityScore (overallScore recovery instead of blind fail-closed)', () => {
  it('derives a passing score from a clean report that omitted overallScore', () => {
    const score = deriveContinuityScore({
      issues: [],
      passedChecks: ['state consistency', 'timeline'],
      recommendations: [],
      issueCount: { errors: 0, warnings: 0, suggestions: 0 },
    });
    expect(score).toBe(100);
  });

  it('penalizes by issue severity', () => {
    const score = deriveContinuityScore({
      issues: [{} as ContinuityIssue],
      passedChecks: [],
      recommendations: [],
      issueCount: { errors: 1, warnings: 2, suggestions: 1 },
    });
    expect(score).toBe(100 - 25 - 16 - 2); // 57
  });

  it('returns null (→ fail closed) when the report carries no signal at all', () => {
    expect(
      deriveContinuityScore({ issues: [], passedChecks: [], recommendations: [], issueCount: { errors: 0, warnings: 0, suggestions: 0 } }),
    ).toBeNull();
  });
});

describe('deriveVoiceScore', () => {
  it('averages per-character scores, lightly blended with distinction', () => {
    const score = deriveVoiceScore({
      characterScores: [{ score: 80 } as any, { score: 90 } as any],
      issues: [],
      recommendations: [],
      distinctionScore: 60,
    });
    // avg 85 * 0.75 + 60 * 0.25 = 63.75 + 15 = 78.75 -> 79
    expect(score).toBe(79);
  });

  it('falls back to issue count when no character scores', () => {
    expect(
      deriveVoiceScore({ characterScores: [], issues: [{} as any, {} as any], recommendations: [], distinctionScore: 50 }),
    ).toBe(100 - 16);
  });

  it('returns null (→ fail closed) on a true non-response', () => {
    expect(deriveVoiceScore({ characterScores: [], issues: [], recommendations: [], distinctionScore: 50 })).toBeNull();
  });
});

describe('deriveEvidenceLimitedScore', () => {
  it('caps clean incremental-only evidence below excellent quality', () => {
    expect(deriveEvidenceLimitedScore({ scores: [100, 95], evidenceCount: 2 })).toBe(75);
  });

  it('penalizes incremental warnings and errors without a positive floor', () => {
    expect(deriveEvidenceLimitedScore({ scores: [100], evidenceCount: 1, warningCount: 1, errorCount: 1 })).toBe(47);
  });

  it('fails closed when no evidence was collected', () => {
    expect(deriveEvidenceLimitedScore({ scores: [100], evidenceCount: 0 })).toBe(0);
  });
});

describe('deriveQAOutcome / recomputeQAReportDerived', () => {
  const clean = {
    continuity: { overallScore: 100, issueCount: { errors: 0, warnings: 0, suggestions: 0 } },
    voice: { overallScore: 90, issues: [] as Array<{ severity: string }> },
    stakes: { overallScore: 90, metrics: { falseChoiceCount: 0 }, issues: [] as Array<{ severity: string }> },
  };

  it('passes when score >= 70 and there are no critical issues', () => {
    const out = deriveQAOutcome(clean.continuity, clean.voice as never, clean.stakes as never);
    expect(out.criticalIssues).toEqual([]);
    expect(out.passesQA).toBe(true);
    // 100*.35 + 90*.30 + 90*.35 = 35 + 27 + 31.5 = 93.5 -> 94
    expect(out.overallScore).toBe(94);
  });

  it('collects a critical issue per failing sub-report and fails QA', () => {
    const out = deriveQAOutcome(
      { overallScore: 40, issueCount: { errors: 2, warnings: 0, suggestions: 0 } },
      { overallScore: 50, issues: [{ severity: 'error' }] } as never,
      { overallScore: 60, metrics: { falseChoiceCount: 3 }, issues: [{ severity: 'error' }] } as never,
    );
    expect(out.criticalIssues).toEqual(['2 continuity error(s)', 'Voice consistency errors', 'Stakes analysis errors', '3 false choice(s)']);
    expect(out.passesQA).toBe(false);
  });

  it('recompute flips a stale report to passing once continuity errors are repaired to 0', () => {
    const report = {
      continuity: { overallScore: 100, issueCount: { errors: 0, warnings: 0, suggestions: 0 }, issues: [], passedChecks: [], recommendations: [] },
      voice: { overallScore: 90, issues: [] },
      stakes: { overallScore: 90, metrics: { falseChoiceCount: 0 } },
      // stale derived fields from before the repair (2 continuity errors)
      overallScore: 40, passesQA: false, criticalIssues: ['2 continuity error(s)'], summary: '',
    } as unknown as QAReport;
    recomputeQAReportDerived(report);
    expect(report.criticalIssues).toEqual([]);
    expect(report.passesQA).toBe(true);
    expect(report.overallScore).toBe(94);
    expect(report.summary).toContain('Content quality is good');
  });

  it('uses the QA pass threshold in summary text so passing 70s are not labeled revision failures', () => {
    const summary = buildQAReportSummary(
      { overallScore: 79, issueCount: { errors: 0, warnings: 2, suggestions: 0 } },
      { overallScore: 80, distinctionScore: 80, issues: [] } as never,
      { overallScore: 78, metrics: { falseChoiceCount: 0 }, issues: [] } as never,
      79,
    );

    expect(summary).toContain('Content passes QA');
    expect(summary).not.toContain('needs revision before publishing');
  });
});
