import { describe, expect, it, vi } from 'vitest';

import {
  buildQuarantineRetryInput,
  runQuarantineRetryPass,
  type QuarantinedEncounterUnit,
} from './encounterQuarantine';
import type { EncounterArchitectInput } from '../../agents/EncounterArchitect';

const baseInput = {
  sceneId: 'scene-3',
  sceneName: 'Encounter Scene',
  sceneDescription: 'A confrontation reaches its breaking point.',
  sceneMood: 'tense',
  storyContext: { title: 'Test Story', genre: 'Drama', tone: 'Intense', userPrompt: 'original prompt' },
  encounterType: 'dramatic',
  encounterDescription: 'The protagonist must survive a charged confrontation.',
  difficulty: 'hard',
  protagonistInfo: { name: 'Alex', pronouns: 'they/them' },
  npcsInvolved: [],
  availableSkills: [],
  targetBeatCount: 4,
} as unknown as EncounterArchitectInput;

const makeUnit = (overrides: Partial<QuarantinedEncounterUnit>): QuarantinedEncounterUnit => ({
  sceneId: 'scene-3',
  sceneName: 'Encounter Scene',
  encounterType: 'dramatic',
  lastFailure: 'boom',
  budgetClass: false,
  retry: async () => ({ success: true, data: {} as never }),
  register: async () => null,
  ...overrides,
});

describe('buildQuarantineRetryInput (failure-class-aware escalation)', () => {
  it('routes a truncation failure into the decomposed budget-recovery ladder, not prompt feedback', () => {
    const { input, budgetClass } = buildQuarantineRetryInput(
      baseInput,
      'All LLM attempts failed: Truncated LLM response from Anthropic: stop_reason=max_tokens (request cap: 8192)',
    );
    expect(budgetClass).toBe(true);
    expect(input.budgetRecovery).toBe(true);
    // Growing the input cannot fix an output-budget failure — the prompt must NOT grow.
    expect(input.storyContext.userPrompt).toBe('original prompt');
  });

  it('routes a content failure to the feedback-augmented prompt without budget recovery', () => {
    const { input, budgetClass } = buildQuarantineRetryInput(
      baseInput,
      'EncounterArchitect returned a hollow encounter: no beat contains player-facing prose.',
    );
    expect(budgetClass).toBe(false);
    expect(input.budgetRecovery).toBeUndefined();
    expect(input.storyContext.userPrompt).toContain('PREVIOUS ATTEMPTS FAILED');
    expect(input.storyContext.userPrompt).toContain('hollow encounter');
  });
});

describe('runQuarantineRetryPass (non-fatal unit exhaustion)', () => {
  it('recovers units whose escalated retry succeeds and registers them', async () => {
    const register = vi.fn(async () => null);
    const recovered: string[] = [];
    const unrecovered = await runQuarantineRetryPass(
      [makeUnit({ register })],
      (unit) => recovered.push(unit.sceneId),
    );
    expect(unrecovered).toEqual([]);
    expect(recovered).toEqual(['scene-3']);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('a failing unit does not stop sibling units from retrying (quarantine isolation)', async () => {
    const secondRetry = vi.fn(async () => ({ success: true, data: {} as never }));
    const unrecovered = await runQuarantineRetryPass([
      makeUnit({ sceneId: 'scene-3', retry: async () => { throw new Error('still truncated'); } }),
      makeUnit({ sceneId: 'scene-7', retry: secondRetry }),
    ]);
    expect(secondRetry).toHaveBeenCalledTimes(1);
    expect(unrecovered).toEqual([{ sceneId: 'scene-3', sceneName: 'Encounter Scene', error: 'still truncated' }]);
  });

  it('a retry that succeeds but fails registration (e.g. template prose) stays unrecovered', async () => {
    const unrecovered = await runQuarantineRetryPass([
      makeUnit({ register: async () => 'quarantine retry still contains 2 template-prose signature(s)' }),
    ]);
    expect(unrecovered).toHaveLength(1);
    expect(unrecovered[0].error).toContain('template-prose');
  });

  it('an unsuccessful agent response surfaces its error', async () => {
    const unrecovered = await runQuarantineRetryPass([
      makeUnit({ retry: async () => ({ success: false, error: 'All LLM attempts failed: budget-recovery decomposed ladder failed' }) }),
    ]);
    expect(unrecovered[0].error).toContain('decomposed ladder failed');
  });

  it('r114: a deterministic code-defect unit SKIPS the escalated retry (no LLM spend) and names the class', async () => {
    const retry = vi.fn(async () => ({ success: true, data: {} as never }));
    const unrecovered = await runQuarantineRetryPass([
      makeUnit({
        sceneId: 'treatment-enc-1-1',
        lastFailure: "All LLM attempts failed: Cannot read properties of undefined (reading 'filter')",
        retry,
      }),
    ]);
    expect(retry).not.toHaveBeenCalled();
    expect(unrecovered).toHaveLength(1);
    expect(unrecovered[0].error).toContain('deterministic code defect');
    expect(unrecovered[0].error).toContain('fix the code, not the content');
  });
});
