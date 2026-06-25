import { describe, expect, it } from 'vitest';
import {
  ChoiceDistributionValidator,
  ChoiceDistributionInput,
  ChoiceDistributionTargets,
} from './ChoiceDistributionValidator';

const TARGETS: ChoiceDistributionTargets = {
  expression: 25,
  relationship: 25,
  strategic: 25,
  dilemma: 25,
};

function makeSet(
  beatId: string,
  choiceType: ChoiceDistributionInput['choiceSets'][number]['choiceType'],
  hasBranching = false,
  sceneId?: string
): ChoiceDistributionInput['choiceSets'][number] {
  return { beatId, choiceType, hasBranching, sceneId };
}

describe('ChoiceDistributionValidator', () => {
  it('passes when type distribution matches targets and branching is within cap', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression'),
        makeSet('b2', 'expression'),
        makeSet('b3', 'relationship', true, 's3'),
        makeSet('b4', 'relationship'),
        makeSet('b5', 'strategic', true, 's5'),
        makeSet('b6', 'strategic'),
        makeSet('b7', 'dilemma', true, 's7'),
        makeSet('b8', 'dilemma'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input);

    expect(result.valid).toBe(true);
    // Exactly on target (25% each) and 3 branching <= cap of 4 -> no issues.
    expect(result.issues).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('reports branch cap excess as telemetry by default', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'relationship', true, 's1'),
        makeSet('b2', 'relationship', true, 's2'),
        makeSet('b3', 'strategic', true, 's3'),
        makeSet('b4', 'dilemma', true, 's4'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 2,
    };

    const result = new ChoiceDistributionValidator().validate(input);

    expect(result.valid).toBe(true);
    const telemetry = result.issues.filter((i) => i.severity === 'info');
    expect(telemetry.some((i) => i.message.includes('exceed the cap of 2'))).toBe(true);
  });

  it('emits an error when branching cap policy is strict', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'relationship', true, 's1'),
        makeSet('b2', 'relationship', true, 's2'),
        makeSet('b3', 'strategic', true, 's3'),
        makeSet('b4', 'dilemma', true, 's4'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 2,
    };

    const result = new ChoiceDistributionValidator().validate(input, { branchCapPolicy: 'strict' });

    expect(result.valid).toBe(false);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.some((i) => i.message.includes('exceed the cap of 2'))).toBe(true);
  });

  it('flags expression choice sets that branch as errors', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression', true, 'sceneX'),
        makeSet('b2', 'relationship'),
        makeSet('b3', 'strategic'),
        makeSet('b4', 'dilemma'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input);

    expect(result.valid).toBe(false);
    const expressionError = result.issues.find(
      (i) => i.severity === 'error' && i.message.includes('"b1"')
    );
    expect(expressionError).toBeDefined();
    expect(expressionError?.message).toContain('must not route to different scenes');
    expect(expressionError?.location).toBe('scene:sceneX');
  });

  it('reports heavy target skew as telemetry by default', () => {
    // 6 of 8 expression = 75% vs 25% target = +50pp deviation (> default 25 error tolerance).
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression'),
        makeSet('b2', 'expression'),
        makeSet('b3', 'expression'),
        makeSet('b4', 'expression'),
        makeSet('b5', 'expression'),
        makeSet('b6', 'expression'),
        makeSet('b7', 'relationship'),
        makeSet('b8', 'strategic'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input);

    expect(result.valid).toBe(true);
    const expressionTelemetry = result.issues.find(
      (i) => i.severity === 'info' && i.message.includes('"expression"')
    );
    expect(expressionTelemetry).toBeDefined();
    expect(expressionTelemetry?.message).toContain('75%');
    // Heavy deviation drives the score well below a clean distribution.
    expect(result.score).toBeLessThan(100);
  });

  it('reports heavy target skew as warning-severity in advisory mode', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression'),
        makeSet('b2', 'expression'),
        makeSet('b3', 'expression'),
        makeSet('b4', 'expression'),
        makeSet('b5', 'expression'),
        makeSet('b6', 'expression'),
        makeSet('b7', 'relationship'),
        makeSet('b8', 'strategic'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input, { targetPolicy: 'advisory' });

    expect(result.valid).toBe(true);
    const expressionWarning = result.issues.find(
      (i) => i.severity === 'warning' && i.message.includes('"expression"')
    );
    expect(expressionWarning).toBeDefined();
    expect(expressionWarning?.message).toContain('75%');
  });

  it('preserves legacy error-severity target failures in strict mode', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression'),
        makeSet('b2', 'expression'),
        makeSet('b3', 'expression'),
        makeSet('b4', 'expression'),
        makeSet('b5', 'expression'),
        makeSet('b6', 'expression'),
        makeSet('b7', 'relationship'),
        makeSet('b8', 'strategic'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input, { targetPolicy: 'strict' });

    expect(result.valid).toBe(false);
    const expressionError = result.issues.find(
      (i) => i.severity === 'error' && i.message.includes('"expression"')
    );
    expect(expressionError).toBeDefined();
    expect(expressionError?.message).toContain('75%');
  });

  it('keeps unknown choice types advisory by default', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression'),
        makeSet('b2', 'relationship'),
        makeSet('b3', 'strategic'),
        makeSet('b4', 'mystery'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 4,
    };

    const result = new ChoiceDistributionValidator().validate(input);

    expect(result.valid).toBe(true);
    expect(result.issues.some((i) =>
      i.severity === 'warning' && i.message.includes('unrecognized type "mystery"')
    )).toBe(true);
  });

  it('computeMetrics reports counts, percentages, and branching without issuing validation', () => {
    const input: ChoiceDistributionInput = {
      choiceSets: [
        makeSet('b1', 'expression', true),
        makeSet('b2', 'relationship'),
        makeSet('b3', 'strategic'),
        makeSet('b4', 'dilemma'),
      ],
      targets: TARGETS,
      maxBranchingChoicesPerEpisode: 2,
    };

    const metrics = new ChoiceDistributionValidator().computeMetrics(input);

    expect(metrics.totalChoiceSets).toBe(4);
    expect(metrics.counts.expression).toBe(1);
    expect(metrics.actualPercentages.expression).toBe(25);
    expect(metrics.branchingCount).toBe(1);
    expect(metrics.branchingCap).toBe(2);
  });
});
