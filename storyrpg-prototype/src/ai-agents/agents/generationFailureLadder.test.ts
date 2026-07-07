import { describe, expect, it, vi } from 'vitest';

import {
  ENCOUNTER_TRUNCATION_RECOVERY,
  EncounterArchitect,
  EncounterPhasedGenerationError,
  classifyPhaseError,
  type EncounterArchitectInput,
  type EncounterPhaseError,
  type Phase4Result,
} from './EncounterArchitect';
import {
  buildEncounterCoreJsonSchema,
  buildEncounterPhase1CompactJsonSchema,
  buildEncounterPhase1JsonSchema,
  buildEncounterStoryletDraftJsonSchema,
  buildEncounterStructureJsonSchema,
} from '../schemas/encounterSchemas';

/**
 * Monotone truncation-recovery ladder coverage (P1, 2026-07-06).
 *
 * Invariant: when a generation unit hits max_tokens, the NEXT attempt must
 * strictly reduce the requested output — never repeat the same-size ask,
 * never escalate to a larger one. The bite-me 2026-07-06 abort made the same
 * impossible full-structure lean ask four times (lean, lean_retry, then both
 * again via the outer prompt-feedback retry) before killing a 62-minute run.
 */

const config = {
  provider: 'gemini' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 16384,
  temperature: 0.1,
};

const input: EncounterArchitectInput = {
  sceneId: 'scene-3',
  sceneName: 'Encounter Scene',
  sceneDescription: 'A confrontation reaches its breaking point.',
  sceneMood: 'tense',
  plannedEncounterId: 'enc-3-1',
  storyContext: { title: 'Test Story', genre: 'Drama', tone: 'Intense' },
  encounterType: 'dramatic',
  encounterStyle: 'dramatic',
  encounterDescription: 'The protagonist must survive a charged confrontation.',
  encounterStakes: 'A key relationship is on the line.',
  encounterRequiredNpcIds: ['eros'],
  encounterRelevantSkills: ['persuasion', 'resolve'],
  encounterBeatPlan: ['Opening pressure', 'Resolution'],
  difficulty: 'hard',
  protagonistInfo: { name: 'Alex', pronouns: 'they/them' },
  npcsInvolved: [
    { id: 'eros', name: 'Eros', pronouns: 'he/him', role: 'enemy', description: 'A dangerous god.' },
  ],
  availableSkills: [
    { name: 'persuasion', attribute: 'social', description: 'Talk your way through conflict.' },
    { name: 'resolve', attribute: 'mind', description: 'Hold firm under pressure.' },
    { name: 'deception', attribute: 'social', description: 'Misdirect the opponent.' },
  ],
  targetBeatCount: 4,
};

const makeStorylets = (): Phase4Result => ({
  victory: { id: 'sv', name: 'Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'The win changes the room.', beats: [{ id: 'sv-1', text: 'The confrontation releases its grip, and the room makes space for what Alex just proved.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
  partialVictory: { id: 'sp', name: 'Costly Victory', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: 'The win carries a visible cost.', beats: [{ id: 'sp-1', text: 'Alex gets the opening, but Eros leaves a cost visible in the silence between them.', isTerminal: true }], startingBeatId: 'sp-1', consequences: [] },
  defeat: { id: 'sd', name: 'Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'The loss points toward recovery.', beats: [{ id: 'sd-1', text: 'The exchange goes wrong, and Alex sees exactly what must change before facing Eros again.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
  escape: { id: 'se', name: 'Escape', triggerOutcome: 'escape', tone: 'relieved', narrativeFunction: 'The narrow escape keeps danger alive.', beats: [{ id: 'se-1', text: 'Distance opens just enough to breathe, though the threat remains close behind.', isTerminal: true }], startingBeatId: 'se-1', consequences: [] },
});

const makeFakeStructure = () => ({
  sceneId: 'scene-3',
  encounterType: 'dramatic',
  goalClock: { name: 'Drive back', segments: 6, description: 'goal' },
  threatClock: { name: 'Overwhelmed', segments: 4, description: 'threat' },
  stakes: { victory: 'You prevail.', defeat: 'You fall.' },
  beats: [
    { id: 'beat-1', phase: 'setup', name: 'Open', setupText: 'Alex squares up in the hall as Eros closes the distance.', choices: [] },
    { id: 'beat-2', phase: 'resolution', name: 'Turn', setupText: 'The confrontation peaks and demands an answer.', isTerminal: true, choices: [] },
  ],
  startingBeatId: 'beat-1',
  storylets: makeStorylets(),
});

const TRUNCATION_ERROR = 'Truncated LLM response from Anthropic: stop_reason=max_tokens (request cap: 16384)';

describe('recovery-strategy map covers every generation unit', () => {
  it('documents a monotone strategy for each phase plus the lean flow', () => {
    expect(Object.keys(ENCOUNTER_TRUNCATION_RECOVERY).sort()).toEqual(
      ['lean', 'phase1', 'phase2', 'phase3', 'phase4'].sort(),
    );
    expect(ENCOUNTER_TRUNCATION_RECOVERY.phase1).toBe('compact_schema_retry');
    expect(ENCOUNTER_TRUNCATION_RECOVERY.phase2).toBe('compact_prompt_retry');
    expect(ENCOUNTER_TRUNCATION_RECOVERY.phase3).toBe('degrade');
    expect(ENCOUNTER_TRUNCATION_RECOVERY.phase4).toBe('fail_closed_at_compact_floor');
    expect(ENCOUNTER_TRUNCATION_RECOVERY.lean).toBe('decompose');
  });

  it('classifyPhaseError recognizes every provider truncation message shape', () => {
    const reasons: EncounterPhaseError['reason'][] = ['timeout', 'parse', 'empty', 'max_tokens', 'safety', 'recitation', 'other'];
    expect(reasons).toContain(classifyPhaseError(new Error(TRUNCATION_ERROR)));
    expect(classifyPhaseError(new Error(TRUNCATION_ERROR))).toBe('max_tokens');
    expect(classifyPhaseError(new Error('Truncated LLM response from Gemini stream: finishReason=MAX_TOKENS (request cap: 8192)'))).toBe('max_tokens');
  });
});

describe('decomposed calls strictly shrink the ask', () => {
  it('encounter_core omits storylets and never exceeds the full-structure budget', () => {
    const core = buildEncounterCoreJsonSchema();
    const full = buildEncounterStructureJsonSchema();
    const coreSchema = core.schema as { required: string[]; properties: Record<string, unknown> };
    expect(coreSchema.required).not.toContain('storylets');
    expect(coreSchema.properties.storylets).toBeUndefined();
    expect(core.maxOutputTokens!).toBeLessThanOrEqual(full.maxOutputTokens!);
    // The core prompt omits four authored storylets, so the schema-implied
    // output is strictly smaller than the full-structure ask it replaces.
    expect(JSON.stringify(core.schema).length).toBeLessThan(JSON.stringify(full.schema).length);
  });

  it('per-slot storylet drafts are far below the full-structure budget', () => {
    const full = buildEncounterStructureJsonSchema();
    for (const slot of ['victory', 'partialVictory', 'defeat', 'escape']) {
      expect(buildEncounterStoryletDraftJsonSchema(slot).maxOutputTokens!).toBeLessThan(full.maxOutputTokens!);
    }
  });

  it('the compact phase-1 retry schema is strictly smaller than the full phase-1 schema', () => {
    expect(buildEncounterPhase1CompactJsonSchema().maxOutputTokens!).toBeLessThan(
      buildEncounterPhase1JsonSchema().maxOutputTokens!,
    );
  });
});

describe('lean flow decomposes on truncation instead of repeating the ask', () => {
  it('a truncated lean attempt skips the same-size lean_retry and runs the decomposed ladder', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'executePhased').mockRejectedValue(new Error('phase 1 exhausted (parse)'));
    const leanAttempt = vi.spyOn(architect, 'tryLLMAttempt').mockResolvedValue({ success: false, error: TRUNCATION_ERROR });
    const decomposed = vi.spyOn(architect, 'tryDecomposedLeanAttempt').mockResolvedValue(makeFakeStructure());

    const result = await architect.execute(input);

    expect(result.success).toBe(true);
    // Exactly ONE full-size lean ask — the truncation must not be retried at the same size.
    expect(leanAttempt).toHaveBeenCalledTimes(1);
    expect(leanAttempt.mock.calls[0][2]).toBe('lean');
    expect(decomposed).toHaveBeenCalledTimes(1);
    expect(result.metadata?.encounterTelemetry?.mode).toBe('lean_decomposed');
  });

  it('a non-truncation lean failure still gets the feedback retry (no behavior regression)', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'executePhased').mockRejectedValue(new Error('phase 1 exhausted (parse)'));
    const leanAttempt = vi.spyOn(architect, 'tryLLMAttempt')
      .mockResolvedValueOnce({ success: false, error: 'JSON parse error: unexpected token' })
      .mockResolvedValueOnce({ success: true, data: makeFakeStructure() });
    const decomposed = vi.spyOn(architect, 'tryDecomposedLeanAttempt').mockResolvedValue(makeFakeStructure());

    const result = await architect.execute(input);

    expect(result.success).toBe(true);
    expect(leanAttempt).toHaveBeenCalledTimes(2);
    expect(leanAttempt.mock.calls[1][2]).toBe('lean_retry');
    expect(decomposed).not.toHaveBeenCalled();
  });

  it('a truncated lean_retry (after a non-truncation first failure) also decomposes', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'executePhased').mockRejectedValue(new Error('phase 1 exhausted (parse)'));
    const leanAttempt = vi.spyOn(architect, 'tryLLMAttempt')
      .mockResolvedValueOnce({ success: false, error: 'JSON parse error: unexpected token' })
      .mockResolvedValueOnce({ success: false, error: TRUNCATION_ERROR });
    const decomposed = vi.spyOn(architect, 'tryDecomposedLeanAttempt').mockResolvedValue(makeFakeStructure());

    const result = await architect.execute(input);

    expect(result.success).toBe(true);
    expect(leanAttempt).toHaveBeenCalledTimes(2);
    expect(decomposed).toHaveBeenCalledTimes(1);
  });
});

describe('budget-recovery mode (failure-class-aware outer retry)', () => {
  it('skips the phased and full-size lean flows entirely', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phased = vi.spyOn(architect, 'executePhased');
    const leanAttempt = vi.spyOn(architect, 'tryLLMAttempt');
    const decomposed = vi.spyOn(architect, 'tryDecomposedLeanAttempt').mockResolvedValue(makeFakeStructure());

    const result = await architect.execute({ ...input, budgetRecovery: true });

    expect(result.success).toBe(true);
    expect(phased).not.toHaveBeenCalled();
    expect(leanAttempt).not.toHaveBeenCalled();
    expect(decomposed).toHaveBeenCalledTimes(1);
    expect(result.metadata?.encounterTelemetry?.mode).toBe('lean_decomposed');
  });

  it('fails closed (no template fallback) when the decomposed ladder is exhausted', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'tryDecomposedLeanAttempt').mockRejectedValue(new Error(TRUNCATION_ERROR));

    const result = await architect.execute({ ...input, budgetRecovery: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/All LLM attempts failed/);
    expect(result.data).toBeUndefined();
  });
});

describe('decomposed ladder call shapes', () => {
  it('core call uses encounter_core (no storylets) and storylets come from per-slot drafts', async () => {
    const architect = new EncounterArchitect(config) as any;
    const schemaNames: string[] = [];
    const prompts: string[] = [];
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any, _retries?: any, options?: any) => {
      schemaNames.push(options?.jsonSchema?.name);
      prompts.push(String(messages?.[0]?.content ?? ''));
      return JSON.stringify(makeFakeStructure());
    });
    const runPhase4 = vi.spyOn(architect, 'runPhase4').mockResolvedValue(makeStorylets());
    vi.spyOn(architect, 'requireAuthoredStorylets').mockImplementation(() => undefined);
    vi.spyOn(architect, 'normalizeStructure').mockImplementation((s: any) => s);
    vi.spyOn(architect, 'validateStructure').mockImplementation(() => undefined);

    const structure = await architect.tryDecomposedLeanAttempt(input, 1, 2, [], []);

    expect(schemaNames).toEqual(['encounter_core']);
    expect(prompts[0]).toContain('Do NOT include a "storylets" field');
    expect(prompts[0]).not.toContain('"triggerOutcome": "victory"');
    expect(runPhase4).toHaveBeenCalledTimes(1);
    expect(Object.keys(structure.storylets).sort()).toEqual(['defeat', 'escape', 'partialVictory', 'victory']);
  });
});

describe('phase-2/3 truncation refuses lean escalation', () => {
  it('does not fall back to the larger lean flow when phase 2 exhausts on max_tokens', async () => {
    const architect = new EncounterArchitect(config) as any;
    vi.spyOn(architect, 'executePhased').mockRejectedValue(
      new EncounterPhasedGenerationError('Phase 2 failed after compact retry', [
        { phase: 'phase2:c1', attempt: 2, reason: 'max_tokens', ms: 1200 },
      ]),
    );
    const leanAttempt = vi.spyOn(architect, 'tryLLMAttempt');
    const decomposed = vi.spyOn(architect, 'tryDecomposedLeanAttempt');

    const result = await architect.execute(input);

    expect(result.success).toBe(false);
    expect(leanAttempt).not.toHaveBeenCalled();
    expect(decomposed).not.toHaveBeenCalled();
    expect(result.error).toMatch(/Phase 2 failed/);
    expect(result.metadata?.phaseErrors).toEqual([
      { phase: 'phase2:c1', attempt: 2, reason: 'max_tokens', ms: 1200 },
    ]);
  });
});

describe('phase-2 compact retry (compact_prompt_retry strategy)', () => {
  it('appends the compact-output directive only after a truncation failure', () => {
    const architect = new EncounterArchitect(config) as any;
    const brief = { npcDynamics: [], knockOnEffects: [], briefText: '' };
    const choice = {
      id: 'c1', text: 'Press forward', approach: 'bold', primarySkill: 'resolve',
      outcomes: {
        success: { narrativeText: 'It lands.', goalTicks: 2, threatTicks: 0 },
        complicated: { narrativeText: 'It costs.', goalTicks: 1, threatTicks: 1 },
        failure: { narrativeText: 'It slips.', goalTicks: 0, threatTicks: 2 },
      },
    };
    const normal = architect.buildPhase2Prompt(input, brief, choice);
    const compact = architect.buildPhase2Prompt(input, brief, choice, { compactRetry: true });
    expect(normal).not.toContain('COMPACT RETRY');
    expect(compact).toContain('COMPACT RETRY');
    expect(compact).toContain('Exactly 3 choices per situation');
    // Monotone: the retry shrinks per-string budgets below the normal ask.
    expect(compact).toContain('narrativeText: 15-25 words');
  });
});
