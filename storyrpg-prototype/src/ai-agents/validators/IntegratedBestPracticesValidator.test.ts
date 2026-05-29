import { describe, it, expect } from 'vitest';
import { IntegratedBestPracticesValidator, type ValidationInput } from './IntegratedBestPracticesValidator';
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
