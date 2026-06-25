import { describe, expect, it } from 'vitest';
import { buildChoiceAgencyCanonicalReport } from './choiceAgencyCanonicalReport';
import type { ValidationIssue } from '../../types/validation';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    category: 'choice_impact',
    level: 'warning',
    message: 'Meaningful choice "choice-1" has no impactFactors.',
    location: { sceneId: 'scene-1', beatId: 'beat-1', choiceId: 'choice-1' },
    ...overrides,
  };
}

describe('choice agency canonical report', () => {
  it('dedupes missing impact domains from ChoiceImpact and FiveFactor on the same choice', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'choice_impact',
        message: 'Meaningful choice "choice-1" has no impactFactors.',
      }),
      issue({
        category: 'five_factor',
        level: 'error',
        message: 'DILEMMA choice has no meaningful impact on any of the five factors',
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(1);
    expect(report.metrics.suppressedDuplicateCount).toBe(1);
    expect(report.findings[0].contract).toBe('choice_impact_domain_missing');
    expect(report.suppressedDuplicates[0].canonicalId).toBe(report.findings[0].id);
  });

  it('dedupes missing stakes while preserving weak stakes as a separate contract', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'choice_impact',
        message: 'Choice "choice-1" needs complete stakes metadata.',
      }),
      issue({
        category: 'stakes_triangle',
        level: 'error',
        message: 'DILEMMA choice is missing stakes: COST',
      }),
      issue({
        category: 'stakes_triangle',
        level: 'warning',
        message: 'COST score (45) below threshold: the risk is too generic',
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(3);
    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.metrics.suppressedDuplicateCount).toBe(1);
    expect(report.findings.map((finding) => finding.contract).sort()).toEqual([
      'choice_stakes_missing',
      'choice_stakes_weak',
    ]);
  });

  it('dedupes missing reactive surface with durable-impact warnings only on the same choice', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'mechanical_storytelling',
        level: 'error',
        message: 'Meaningful choice "choice-1" has no visible reactive surface.',
      }),
      issue({
        category: 'choice_impact',
        message: 'Choice "choice-1" is tiered as sceneTint but has no durable consequence or route impact.',
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(1);
    expect(report.findings[0].contract).toBe('choice_reactive_surface_missing');
  });

  it('keeps branch residue distinct from generic route impact', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'choice_impact',
        message: 'Choice "choice-1" is tiered as sceneTint but has no durable consequence or route impact.',
      }),
      issue({
        category: 'branch_mechanical_divergence',
        message: 'Branch choice "choice-1" reconverges with no obvious mechanical residue.',
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.findings.map((finding) => finding.contract).sort()).toEqual([
      'branch_residue_missing',
      'choice_reactive_surface_missing',
    ]);
  });

  it('never suppresses runtime reference integrity findings', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'mechanical_storytelling',
        level: 'error',
        message: 'Witness reaction on choice "choice-1" references unknown NPC "ghost".',
      }),
      issue({
        category: 'mechanical_storytelling',
        level: 'error',
        message: 'Relationship consequence on choice "choice-1" targets unknown NPC "ghost".',
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.metrics.suppressedDuplicateCount).toBe(0);
    expect(report.findings.every((finding) => finding.contract === 'choice_reference_invalid')).toBe(true);
  });

  it('keeps skill surface as scene-level evidence separate from playable failure', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({
        category: 'mechanical_storytelling',
        level: 'warning',
        message: 'Stat-check choice "choice-1" has no playable failure signal.',
      }),
      issue({
        category: 'skill_surface',
        level: 'warning',
        message: 'Hard scene "scene-1" has fewer than two skill surfaces.',
        location: { sceneId: 'scene-1' },
      }),
    ]);

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.findings.map((finding) => finding.contract).sort()).toEqual([
      'playable_failure_missing',
      'skill_surface_missing',
    ]);
  });

  it('keeps suppressed duplicates inspectable', () => {
    const report = buildChoiceAgencyCanonicalReport([
      issue({ category: 'choice_impact', message: 'Choice "choice-1" needs complete stakes metadata.' }),
      issue({ category: 'stakes_triangle', level: 'error', message: 'DILEMMA choice is missing stakes: WANT' }),
    ]);

    expect(report.suppressedDuplicates).toHaveLength(1);
    expect(report.suppressedDuplicates[0].suppressed.sourceValidator).toBe('StakesTriangleValidator');
    expect(report.suppressedDuplicates[0].reason).toContain('same contract');
  });
});
