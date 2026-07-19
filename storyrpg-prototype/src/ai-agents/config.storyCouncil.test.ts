import { describe, expect, it } from 'vitest';
import { resolveStoryCouncilConfig } from './config';

describe('resolveStoryCouncilConfig', () => {
  it('migrates legacy enablement and blocking modes without preserving council veto authority', () => {
    const config = resolveStoryCouncilConfig({
      STORYRPG_QUALITY_COUNCIL: '1',
      STORYRPG_QUALITY_COUNCIL_MODE: 'strict',
    });

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('select-and-repair');
    expect(config.runPlanCouncil).toBe(false);
    expect(config.runChoiceCouncil).toBe(false);
  });

  it('honors canonical values and allows synthesis remediation to be disabled', () => {
    const config = resolveStoryCouncilConfig({
      STORYRPG_STORY_COUNCIL: '1',
      STORYRPG_STORY_COUNCIL_MODE: 'select',
      STORYRPG_STORY_COUNCIL_REMEDIATION_BUDGET: '0',
    });

    expect(config.mode).toBe('select');
    expect(config.councilRemediationBudget).toBe(0);
  });

  it('expands the deep preset when no individual budget override is supplied', () => {
    const config = resolveStoryCouncilConfig({ STORYRPG_STORY_COUNCIL_PRESET: 'deep' });

    expect(config.candidateCount).toBe(4);
    expect(config.synthesisPolicy).toBe('always');
    expect(config.maxCouncilCallsPerRun).toBe(48);
    expect(config.maxConcurrentCandidates).toBe(4);
  });
});
