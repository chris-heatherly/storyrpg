import { describe, expect, it } from 'vitest';

import {
  recomputeContinuityIssueCount,
  normalizeContinuitySeverity,
  deriveContinuityScore,
  groundContinuityEvidence,
  deriveVoiceScore,
  deriveEvidenceLimitedScore,
  deriveQAOutcome,
  recomputeQAReportDerived,
  buildQAReportSummary,
  extractQuotedDialogueLines,
  VoiceValidator,
  QARunner,
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

describe('groundContinuityEvidence (judge-hallucination filter)', () => {
  const issue = (overrides: Partial<ContinuityIssue>): ContinuityIssue => ({
    severity: 'error',
    type: 'missing_setup',
    location: { sceneId: 's1-1' },
    description: 'Problem.',
    suggestedFix: 'Fix it.',
    ...overrides,
  } as ContinuityIssue);
  const prose = 'A woman with a vintage silk scarf waves from a cafe patio. You met online, a lifeline of DMs and shared fashion posts.';

  it('downgrades an error whose quoted evidence appears nowhere in the prose (bite-me 2026-07-02)', () => {
    const issues = [issue({
      description: "Mika is introduced as already met ('You met her on the flight over'), but no flight is depicted.",
    })];

    const result = groundContinuityEvidence(issues, prose);

    expect(result.downgraded).toBe(1);
    expect(result.issues[0].severity).toBe('warning');
    expect(result.issues[0].description).toContain('evidence-ungrounded');
  });

  it('keeps an error whose quoted evidence is present (normalization-tolerant)', () => {
    const issues = [issue({
      description: "The line 'You met online, a lifeline of DMs' contradicts the later flashback.",
    })];

    const result = groundContinuityEvidence(issues, prose);

    expect(result.downgraded).toBe(0);
    expect(result.issues[0].severity).toBe('error');
  });

  it('leaves errors without prose-shaped quotes untouched', () => {
    const issues = [
      issue({ description: 'Flag never set before it is read.' }),
      issue({ description: "The flag 'treatment_seed_ep1_1' is read before it is set." }),
    ];

    const result = groundContinuityEvidence(issues, prose);

    expect(result.downgraded).toBe(0);
    expect(result.issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('never touches warnings or suggestions', () => {
    const issues = [issue({
      severity: 'warning',
      description: "Quoted phantom 'this text does not exist anywhere at all' in a warning.",
    })];

    const result = groundContinuityEvidence(issues, prose);

    expect(result.downgraded).toBe(0);
    expect(result.issues[0].severity).toBe('warning');
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

describe('extractQuotedDialogueLines', () => {
  it('extracts straight and curly quoted speech', () => {
    expect(extractQuotedDialogueLines('Mika smiles. "Careful." Stela adds, “Listen closely, child.”')).toEqual([
      'Careful.',
      'Listen closely, child.',
    ]);
  });

  it('ignores narrative and treatment instructions without quoted dialogue', () => {
    expect(
      extractQuotedDialogueLines(
        "Escalate the episode pressure through a concrete turn: The 'Mr. Midnight' post goes viral, and Kylie lets herself be courted by Victor.",
      ),
    ).toEqual([]);
  });

  it('keeps VoiceValidator prompt dialogue-scoped even when beats have speakers', () => {
    const validator = new VoiceValidator({} as any);
    const prompt = (validator as any).buildPrompt({
      sceneContents: [
        {
          sceneId: 's2-2',
          sceneName: 'Club',
          beats: [
            {
              id: 'b1',
              speaker: 'Mika',
              text: "Escalate the episode pressure through a concrete turn: The 'Mr. Midnight' post goes viral.",
            },
            {
              id: 'b2',
              speaker: 'Mika',
              text: 'Mika taps the phone once. “Darling, you just became interesting.”',
            },
          ],
        },
      ],
      characterProfiles: [
        {
          id: 'char-mika',
          name: 'Mika',
          voiceProfile: {
            vocabulary: 'sharp',
            sentenceLength: 'short',
            formality: 'casual',
            verbalTics: [],
            favoriteExpressions: [],
            whenHappy: 'teasing',
            whenAngry: 'cutting',
            greetingExamples: [],
          },
        },
      ],
    });

    expect(prompt).toContain('Darling, you just became interesting.');
    expect(prompt).not.toContain('Escalate the episode pressure');
  });
});

describe('deriveEvidenceLimitedScore', () => {
  it('keeps clean incremental-only evidence eligible for excellent quality', () => {
    expect(deriveEvidenceLimitedScore({ scores: [100, 95], evidenceCount: 2 })).toBe(98);
  });

  it('penalizes incremental warnings and errors without a positive floor', () => {
    expect(deriveEvidenceLimitedScore({ scores: [100], evidenceCount: 1, warningCount: 1, errorCount: 1 })).toBe(72);
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
      { overallScore: 79, issueCount: { errors: 0, warnings: 2, suggestions: 0 }, issues: [], passedChecks: [], recommendations: [] },
      { overallScore: 80, distinctionScore: 80, issues: [] } as never,
      { overallScore: 78, metrics: { falseChoiceCount: 0 }, issues: [] } as never,
      79,
    );

    expect(summary).toContain('Content passes QA');
    expect(summary).not.toContain('needs revision before publishing');
  });
});

describe('QARunner failure evidence', () => {
  it('preserves VoiceValidator failure text in the fail-closed voice report', async () => {
    const runner = new QARunner({} as any);
    (runner as any).continuityChecker = {
      execute: async () => ({
        success: true,
        data: {
          overallScore: 100,
          issueCount: { errors: 0, warnings: 0, suggestions: 0 },
          issues: [],
          passedChecks: ['ok'],
          recommendations: [],
        },
      }),
    };
    (runner as any).voiceValidator = {
      execute: async () => ({ success: false, error: 'Unexpected token after JSON at position 12' }),
    };
    (runner as any).stakesAnalyzer = {
      execute: async () => ({
        success: true,
        data: {
          overallScore: 90,
          choiceSetAnalysis: [],
          metrics: { averageStakesScore: 90, falseChoiceCount: 0, dilemmaQuality: 90, varietyScore: 90 },
          issues: [],
          strengths: [],
          recommendations: [],
        },
      }),
    };

    const report = await runner.runFullQA({
      sceneContents: [],
      choiceSets: [],
      characterProfiles: [],
      knownFlags: [],
      knownScores: [],
      establishedFacts: [],
      sceneContexts: [],
      storyThemes: [],
      targetTone: '',
    });

    expect(report.voice.overallScore).toBe(0);
    expect(report.voice.issues[0]).toMatchObject({
      severity: 'error',
      issue: 'Voice validator failed: Unexpected token after JSON at position 12',
    });
    expect(report.voice.recommendations[0]).toContain('Unexpected token after JSON');
  });
});
