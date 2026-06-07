import { describe, it, expect } from 'vitest';
import {
  IntegratedBestPracticesValidator,
  resolveStakesForValidation,
  type ValidationInput,
} from './IntegratedBestPracticesValidator';
import { PLACEHOLDER_STAKES } from '../constants/placeholderStakes';
import type { AgentConfig } from '../config';

// Empty apiKey keeps the LLM-backed sub-validators (StakesTriangle, FiveFactor)
// on their heuristic, non-LLM paths so this aggregator test is deterministic.
const agentConfig: AgentConfig = {
  provider: 'anthropic',
  model: 'test-model',
  apiKey: '',
  maxTokens: 1024,
  temperature: 0,
};

function baseInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    scenes: [
      { id: 'scene-1', charactersInvolved: [], beats: [{ id: 'beat-1', text: 'Something happens in the room.' }] },
    ],
    npcs: [],
    choices: [],
    ...overrides,
  };
}

describe('IntegratedBestPracticesValidator (aggregator)', () => {
  it('short-circuits when validation is disabled', async () => {
    const validator = new IntegratedBestPracticesValidator(agentConfig, { mode: 'disabled' });
    const result = await validator.runQuickValidation(baseInput({ choices: [
      { id: 'c1', text: 'A dilemma with no stakes', choiceType: 'dilemma', consequences: [] },
    ] }));
    // Disabled mode must not block, regardless of content.
    expect(result.canProceed).toBe(true);
    expect(result.blockingIssues).toHaveLength(0);
    expect(result.warningCount).toBe(0);
  });

  it('quick validation blocks an episode with no choice points', async () => {
    // Interactive fiction requires choices — an episode with none is blocked.
    const validator = new IntegratedBestPracticesValidator(agentConfig);
    const result = await validator.runQuickValidation(baseInput());
    expect(result.canProceed).toBe(false);
    expect(result.blockingIssues.some((i) => i.category === 'choice_density')).toBe(true);
  });

  it('quick validation blocks a dilemma choice missing its Stakes Triangle', async () => {
    const validator = new IntegratedBestPracticesValidator(agentConfig);
    const result = await validator.runQuickValidation(baseInput({
      choices: [
        // dilemma with no stakesAnnotation => missing WANT/COST/IDENTITY (blocking, no LLM)
        { id: 'c-dilemma', text: 'Betray the crew or take the fall yourself.', choiceType: 'dilemma', consequences: [] },
      ],
    }));
    expect(result.canProceed).toBe(false);
    const stakesIssue = result.blockingIssues.find((i) => i.category === 'stakes_triangle');
    expect(stakesIssue).toBeDefined();
    expect(stakesIssue?.level).toBe('error');
    expect(stakesIssue?.location?.choiceId).toBe('c-dilemma');
  });

  it('reports totalChoices from the real choice inventory, not choice-point beats', async () => {
    // Regression: choiceDensity.totalChoices used to read ChoiceDensity's
    // choiceCount (beats flagged isChoicePoint, ~2), making a 14-choice story
    // read as a 2-choice story. It must report the actual choice count.
    const choices = Array.from({ length: 14 }, (_, i) => ({
      id: `c${i}`,
      text: `Choice ${i}`,
      choiceType: 'expression',
      sceneId: 'scene-1',
      consequences: [],
    }));
    const validator = new IntegratedBestPracticesValidator(agentConfig);
    const report = await validator.runFullValidation(baseInput({ choices }));
    expect(report.metrics.choiceDensity.totalChoices).toBe(14);
  });

  it('surfaces the choice TYPE distribution metric (previously unmeasured)', async () => {
    // ChoiceDistributionValidator was unregistered, so the taxonomy mix was
    // never reported. Full validation must now expose it.
    const mk = (i: number, type: string, branches = false) => ({
      id: `c${i}`,
      text: `Choice ${i}`,
      choiceType: type,
      sceneId: 'scene-1',
      consequences: [],
      ...(branches ? { nextSceneId: 'scene-2' } : {}),
    });
    const choices = [
      ...Array.from({ length: 7 }, (_, i) => mk(i, 'expression')),
      ...Array.from({ length: 4 }, (_, i) => mk(i + 7, 'relationship', i < 2)),
      ...Array.from({ length: 2 }, (_, i) => mk(i + 11, 'strategic')),
      mk(13, 'dilemma'),
    ];
    const validator = new IntegratedBestPracticesValidator(agentConfig);
    const report = await validator.runFullValidation(baseInput({ choices }));

    const dist = report.metrics.choiceDistribution;
    expect(dist).toBeDefined();
    expect(dist?.totalChoiceSets).toBe(14);
    expect(dist?.counts.expression).toBe(7);
    expect(dist?.counts.relationship).toBe(4);
    expect(dist?.counts.strategic).toBe(2);
    expect(dist?.counts.dilemma).toBe(1);
    // Two relationship choices route to another scene.
    expect(dist?.branchingCount).toBe(2);
    expect(dist?.targetPercentages).toEqual({ expression: 35, relationship: 30, strategic: 20, dilemma: 15 });
  });

  it('full validation returns a scored ComprehensiveValidationReport', async () => {
    const validator = new IntegratedBestPracticesValidator(agentConfig);
    const report = await validator.runFullValidation(baseInput());

    expect(typeof report.overallScore).toBe('number');
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(typeof report.overallPassed).toBe('boolean');
    // Default mode is advisory: the run is reported as passed even though it
    // aggregates the no-choice-points blocking issue (advisory never hard-fails).
    expect(report.overallPassed).toBe(true);
    expect(report.blockingIssues.some((i) => i.category === 'choice_density')).toBe(true);
    expect(report.metrics).toBeDefined();
    expect(report.timestamp).toBeInstanceOf(Date);
  });
});

describe('resolveStakesForValidation', () => {
  it('prefers the authored choice.stakes over a placeholder stakesAnnotation', () => {
    const resolved = resolveStakesForValidation({
      stakes: {
        want: 'Get an honest answer from someone who might have one',
        cost: 'Asking directly puts Mika in a position she cannot answer honestly',
        identity: 'Trusting a new friend enough to ask is a different kind of courage',
      },
      stakesAnnotation: {
        want: PLACEHOLDER_STAKES.want('Stray Dog, Black Roses'),
        cost: PLACEHOLDER_STAKES.cost,
        identity: PLACEHOLDER_STAKES.identity,
      },
    });

    expect(resolved.want).toBe('Get an honest answer from someone who might have one');
    expect(resolved.cost).toContain('position she cannot answer honestly');
    expect(resolved.identity).toContain('different kind of courage');
  });

  it('falls back to stakesAnnotation when the choice was never authored', () => {
    const resolved = resolveStakesForValidation({
      stakesAnnotation: {
        want: PLACEHOLDER_STAKES.want('American Shoes'),
        cost: PLACEHOLDER_STAKES.cost,
        identity: PLACEHOLDER_STAKES.identity,
      },
    });

    expect(resolved.want).toBe(PLACEHOLDER_STAKES.want('American Shoes'));
    expect(resolved.cost).toBe(PLACEHOLDER_STAKES.cost);
  });
});
