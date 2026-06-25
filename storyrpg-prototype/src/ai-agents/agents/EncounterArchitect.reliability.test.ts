import { describe, expect, it, vi } from 'vitest';
import {
  EncounterArchitect,
  classifyPhaseError,
  mapWithConcurrency,
  type EncounterArchitectInput,
  type EncounterPhaseError,
  type Phase1Result,
  type Phase4Result,
} from './EncounterArchitect';
import { TimeoutError } from '../utils/withTimeout';
import { buildEncounterStoryletDraftJsonSchema } from '../schemas/encounterSchemas';

const config = {
  provider: 'gemini' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
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
  encounterBeatPlan: ['Opening pressure', 'Escalation', 'Resolution'],
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

function makePhase1(): Phase1Result {
  const mkOutcome = (g: number) => ({ narrativeText: 'A specific result of this exact action unfolds.', goalTicks: g, threatTicks: 0 });
  const mkChoice = (id: string, skill: string, approach: string) => ({
    id,
    text: `${approach} option`,
    approach,
    primarySkill: skill,
    impliedApproach: approach,
    outcomes: { success: mkOutcome(2), complicated: mkOutcome(1), failure: mkOutcome(0) },
  });
  return {
    sceneId: 'scene-3',
    encounterType: 'dramatic',
    goalClock: { name: 'Drive back', segments: 6, description: 'goal' },
    threatClock: { name: 'Overwhelmed', segments: 4, description: 'threat' },
    stakes: { victory: 'You prevail.', defeat: 'You fall.' },
    openingBeat: {
      setupText: 'Alex squares up as the confrontation reaches its breaking point in the hall.',
      choices: [
        mkChoice('c1', 'resolve', 'aggressive'),
        mkChoice('c2', 'persuasion', 'cautious'),
        mkChoice('c3', 'deception', 'clever'),
      ],
    },
  };
}

const makePhase4 = (): Phase4Result => ({
  victory: { id: 'sv', name: 'Victory', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'The win changes the room.', beats: [{ id: 'sv-1', text: 'The confrontation releases its grip, and the room makes space for what Alex just proved.', isTerminal: true }], startingBeatId: 'sv-1', consequences: [] },
  partialVictory: { id: 'sp', name: 'Costly Victory', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: 'The win carries a visible cost.', beats: [{ id: 'sp-1', text: 'Alex gets the opening, but Eros leaves a cost visible in the silence between them.', isTerminal: true }], startingBeatId: 'sp-1', consequences: [] },
  defeat: { id: 'sd', name: 'Defeat', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'The loss points toward recovery.', beats: [{ id: 'sd-1', text: 'The exchange goes wrong, and Alex sees exactly what must change before facing Eros again.', isTerminal: true }], startingBeatId: 'sd-1', consequences: [] },
  escape: { id: 'se', name: 'Escape', triggerOutcome: 'escape', tone: 'relieved', narrativeFunction: 'The narrow escape keeps danger alive.', beats: [{ id: 'se-1', text: 'Distance opens just enough to breathe, though the threat remains close behind.', isTerminal: true }], startingBeatId: 'se-1', consequences: [] },
});

describe('getMinimumRequiredBeatCount (authored-anchor scaling)', () => {
  const min = (overrides: Partial<EncounterArchitectInput>): number => {
    const architect = new EncounterArchitect(config) as any;
    return architect.getMinimumRequiredBeatCount({ ...input, ...overrides });
  };

  it('scales the minimum to the authored encounterBeatPlan length', () => {
    // The Gen-4 defect: a 5-beat authored anchor rendered as 1 beat.
    expect(min({ encounterBeatPlan: ['a', 'b', 'c', 'd', 'e'], targetBeatCount: 6 })).toBe(5);
    expect(min({ encounterBeatPlan: ['a', 'b', 'c'], targetBeatCount: 4 })).toBe(3);
  });

  it('falls back to 2 when there is no authored beat plan', () => {
    expect(min({ encounterBeatPlan: [], targetBeatCount: 4 })).toBe(2);
    expect(min({ encounterBeatPlan: undefined, targetBeatCount: 4 })).toBe(2);
  });

  it('never demands more beats than the target structure, and caps at a sane ceiling', () => {
    expect(min({ encounterBeatPlan: ['a', 'b', 'c', 'd', 'e'], targetBeatCount: 4 })).toBe(4);
    expect(min({ encounterBeatPlan: Array(12).fill('x'), targetBeatCount: 12 })).toBe(8);
  });
});

describe('classifyPhaseError', () => {
  it('classifies timeout, parse, empty, and other', () => {
    expect(classifyPhaseError(new TimeoutError('x', 1000))).toBe('timeout');
    expect(classifyPhaseError(new Error('Truncated LLM response from Gemini: finishReason=MAX_TOKENS'))).toBe('max_tokens');
    expect(classifyPhaseError(new Error('Failed to parse Gemini response as JSON: Gemini returned empty content (finishReason=SAFETY). HARM_CATEGORY_SEXUALLY_EXPLICIT'))).toBe('safety');
    expect(classifyPhaseError(new Error('Failed to parse Gemini response as JSON: Gemini returned empty content (finishReason=RECITATION).'))).toBe('recitation');
    expect(classifyPhaseError(new Error('The operation was aborted'))).toBe('timeout');
    expect(classifyPhaseError(new Error('Failed to parse JSON response'))).toBe('parse');
    expect(classifyPhaseError(new Error('empty response from model'))).toBe('empty');
    expect(classifyPhaseError(new Error('something else'))).toBe('other');
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe('Phase 4 Gemini safety retry prompt', () => {
  it('uses a stricter social-suspense boundary after safety or recitation failures', () => {
    const architect = new EncounterArchitect(config) as any;
    const romanticInput = {
      ...input,
      encounterType: 'romantic',
      storyContext: { title: 'Bite Me', genre: 'Vampire Romance', tone: 'Sensual gothic' },
      encounterStakes: 'She lets herself be courted by a magnetic vampire and must claim her appetite.',
    };
    const normal = architect.buildPhase4StoryletPrompt(romanticInput, { briefText: 'The attraction changes who has access.' }, 'defeat');
    const retry = architect.buildPhase4StoryletPrompt(romanticInput, { briefText: 'The attraction changes who has access.' }, 'defeat', { safetyRetry: true });

    expect(normal).toContain('PG-13 gothic-romance tension only');
    expect(normal).toContain('Vampire Romance');
    expect(normal).toContain('magnetic vampire');
    expect(retry).toContain('Gemini Safety Retry Boundary');
    expect(retry).toContain('Write social suspense only');
    expect(retry).toContain('status, trust, access, distance');
    expect(retry).toContain('social-suspense aftermath');
    expect(retry).not.toContain('Keep desire, danger, glamour');
    expect(retry).not.toContain('Vampire Romance');
    expect(retry).not.toContain('Sensual gothic');
    expect(retry).not.toContain('magnetic vampire');
    expect(retry).not.toContain('claim her appetite');
    expect(retry).not.toContain('The attraction changes who has access.');
  });
});

describe('Phase 1 Gemini budget retry', () => {
  it('uses a compact opening-beat prompt after Gemini max-token failure', async () => {
    const architect = new EncounterArchitect(config) as any;
    const prompts: string[] = [];
    const schemaNames: string[] = [];
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any, _retries: number, options: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      prompts.push(prompt);
      schemaNames.push(options?.jsonSchema?.name);
      if (prompts.length === 1) {
        throw new Error('Truncated LLM response from Gemini: finishReason=MAX_TOKENS (limit: 8192)');
      }
      return JSON.stringify(makePhase1());
    });

    const sink: EncounterPhaseError[] = [];
    const result = await architect.runPhase1(input, { npcDynamics: [], knockOnEffects: [], briefText: '' }, sink);

    expect(result.openingBeat.choices).toHaveLength(3);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('COMPACT PHASE 1 RETRY');
    expect(prompts[1]).toContain('COMPACT PHASE 1 RETRY');
    expect(prompts[1]).toContain('exhausted its structured output budget');
    expect(prompts[1]).toContain('Omit reminderPlan and feedbackCue');
    expect(prompts[1].length).toBeLessThan(prompts[0].length);
    expect(schemaNames).toEqual(['encounter_phase_1', 'encounter_phase_1_compact']);
    expect(sink).toMatchObject([{ phase: 'phase1', attempt: 1, reason: 'max_tokens' }]);
  });

  it('does not escalate phase-1 max-token exhaustion into the larger legacy lean fallback', async () => {
    const architect = new EncounterArchitect(config) as any;
    const leanSpy = vi.spyOn(architect, 'buildLeanMessages');
    vi.spyOn(architect, 'callLLM').mockRejectedValue(
      new Error('Truncated LLM response from Gemini: finishReason=MAX_TOKENS (limit: 8192)'),
    );

    const result = await architect.execute(input);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Phase 1 failed to generate an authored opening beat/);
    expect(leanSpy).not.toHaveBeenCalled();
  });
});

describe('runPhaseWithRetry', () => {
  it('recovers on a retry after a single timeout and records the failed attempt', async () => {
    const architect = new EncounterArchitect(config) as any;
    const sink: EncounterPhaseError[] = [];
    let calls = 0;
    const result = await architect.runPhaseWithRetry('phase2:c1', 50, sink, async () => {
      calls++;
      if (calls === 1) throw new TimeoutError('EncounterArchitect.phase2:c1', 50);
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ phase: 'phase2:c1', attempt: 1, reason: 'timeout' });
  });

  it('throws after exhausting attempts and records every failure', async () => {
    const architect = new EncounterArchitect(config) as any;
    const sink: EncounterPhaseError[] = [];
    await expect(
      architect.runPhaseWithRetry('phase4', 50, sink, async () => {
        throw new Error('parse: bad JSON');
      }),
    ).rejects.toThrow();
    expect(sink).toHaveLength(2); // PHASE_RETRY_ATTEMPTS
    expect(sink.every((e: EncounterPhaseError) => e.reason === 'parse')).toBe(true);
  });
});

/** Minimal valid Phase2Result for one opening-beat choice. */
function makePhase2(choiceId: string): unknown {
  const outcome = (eo: string) => ({
    narrativeText: `The ${choiceId} gambit resolves; Eros gives ground in the hall, but the cost lands where Alex least expects.`,
    goalTicks: 1,
    threatTicks: 1,
    isTerminal: true,
    encounterOutcome: eo,
  });
  const situation = (suffix: string) => ({
    setupText: `The hall shifts after the ${choiceId}-${suffix} turn; Eros recalibrates with dangerous patience and closes the distance.`,
    choices: [
      {
        id: `${choiceId}-${suffix}-c1`,
        text: 'Press the advantage now',
        approach: 'bold',
        primarySkill: 'resolve',
        outcomes: { success: outcome('victory'), complicated: outcome('partialVictory'), failure: outcome('defeat') },
      },
      {
        id: `${choiceId}-${suffix}-c2`,
        text: 'Change the pressure point',
        approach: 'clever',
        primarySkill: 'persuasion',
        outcomes: { success: outcome('victory'), complicated: outcome('partialVictory'), failure: outcome('escape') },
      },
      {
        id: `${choiceId}-${suffix}-c3`,
        text: 'Hold position and read the room',
        approach: 'careful',
        primarySkill: 'resolve',
        outcomes: { success: outcome('victory'), complicated: outcome('partialVictory'), failure: outcome('defeat') },
      },
    ],
  });
  return { choiceId, afterSuccess: situation('s'), afterComplicated: situation('c'), afterFailure: situation('f') };
}

describe('executePhased telemetry', () => {
  // NO-BOILERPLATE MANDATE (2026-06-11): a total branch-phase loss used to ship
  // a deterministic TEMPLATE encounter as success. It must now throw so the
  // caller's regen ladder re-authors the encounter instead.
  it('REJECTS when every later phase fails — no template fallback may ship', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    // Phase 1 succeeds (opening beat); phases 2/3/4 always fail.
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      throw new Error('The operation was aborted'); // simulate timeout/abort
    });

    await expect(architect.executePhased(input)).rejects.toThrow(/Phase 4 failed to generate authored storylets/);
  });

  it('rejects a PARTIAL gap when phase 4 fails, even if branches are OK', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      if (prompt.includes('NEXT MOMENT')) {
        const choiceId = /"choiceId": "(c\d+)"/.exec(prompt)?.[1] ?? 'c1';
        return JSON.stringify(makePhase2(choiceId));
      }
      throw new Error('The operation was aborted'); // phase 4 fails
    });

    await expect(architect.executePhased(input)).rejects.toThrow(/Phase 4 failed to generate authored storylets/);
  });

  it('generates phase 4 as bounded per-storylet slot calls and assembles the existing shape', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    const phase4 = makePhase4();
    const phase4Prompts: string[] = [];

    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      if (prompt.includes('NEXT MOMENT')) {
        const choiceId = /"choiceId": "(c\d+)"/.exec(prompt)?.[1] ?? 'c1';
        return JSON.stringify(makePhase2(choiceId));
      }
      if (prompt.includes('Generate ONE compact encounter aftermath DRAFT')) {
        phase4Prompts.push(prompt);
        const slot = /"([^"]+)" aftermath/.exec(prompt)?.[1] as keyof Phase4Result;
        const beatCounts: Record<keyof Phase4Result, number> = { victory: 1, partialVictory: 2, defeat: 3, escape: 2 };
        const baseText = phase4[slot]?.beats[0]?.text ?? 'Specific aftermath text lands in the scene.';
        return JSON.stringify({
          ...(slot === 'partialVictory' ? { cost: phase4.partialVictory?.cost ?? {
            domain: 'mixed',
            severity: 'moderate',
            whoPays: 'protagonist',
            immediateEffect: 'Eros leaves one visible cost in the room.',
            visibleComplication: 'The silence changes how everyone looks at Alex.',
          } } : {}),
          beats: Array.from({ length: beatCounts[slot] }, (_, index) => ({ text: `${baseText} Beat ${index + 1}.` })),
        });
      }
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    });

    const result = await architect.executePhased(input);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data?.storylets ?? {}).sort()).toEqual(['defeat', 'escape', 'partialVictory', 'victory']);
    expect(phase4Prompts).toHaveLength(4);
    for (const prompt of phase4Prompts) {
      expect(prompt).not.toContain('Generate 4 storylets');
      expect(prompt).toContain('Keep the JSON compact');
      expect(prompt).toContain('under 45 words per beat');
      expect(prompt).toContain('Do NOT include id, name, triggerOutcome');
      expect(prompt).toContain('PG-13 gothic-romance tension only');
      expect(prompt.length).toBeLessThan(8000);
    }
    expect(result.metadata?.encounterTelemetry?.phase4Ok).toBe(true);
    expect(result.data?.storylets?.victory.id).toBe('scene-3-svictory');
    expect(result.data?.storylets?.victory.startingBeatId).toBe('scene-3-svictory-beat-1');
    expect(result.data?.storylets?.defeat.beats).toHaveLength(3);
  });

  it('keeps phase-4 draft calls compact enough to avoid runaway structured output', () => {
    expect(buildEncounterStoryletDraftJsonSchema('victory').maxOutputTokens).toBe(4096);
    expect((buildEncounterStoryletDraftJsonSchema('partialVictory').schema as any).required).toEqual(['beats', 'cost']);
  });

  it('does not escalate phase-4 max-token failure into the larger legacy lean fallback', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    const leanSpy = vi.spyOn(architect, 'buildLeanMessages');
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      if (prompt.includes('NEXT MOMENT')) {
        const choiceId = /"choiceId": "(c\d+)"/.exec(prompt)?.[1] ?? 'c1';
        return JSON.stringify(makePhase2(choiceId));
      }
      if (prompt.includes('Generate ONE compact encounter aftermath DRAFT')) {
        throw new Error('Truncated LLM response from Gemini: finishReason=MAX_TOKENS (limit: 16384)');
      }
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    });

    const result = await architect.execute(input);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Phase 4 failed to generate authored storylets/);
    expect(leanSpy).not.toHaveBeenCalled();
  });

  it('does not escalate phase-4 Gemini safety failure into the larger legacy lean fallback', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    const leanSpy = vi.spyOn(architect, 'buildLeanMessages');
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      if (prompt.includes('NEXT MOMENT')) {
        const choiceId = /"choiceId": "(c\d+)"/.exec(prompt)?.[1] ?? 'c1';
        return JSON.stringify(makePhase2(choiceId));
      }
      if (prompt.includes('Generate ONE compact encounter aftermath DRAFT')) {
        throw new Error('Failed to parse Gemini response as JSON: Gemini returned empty content (finishReason=SAFETY). HARM_CATEGORY_SEXUALLY_EXPLICIT');
      }
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    });

    const result = await architect.execute(input);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Phase 4 failed to generate authored storylets/);
    expect(leanSpy).not.toHaveBeenCalled();
  });

  it('rejects encounters whose outcomes have no playable route before downstream validation', () => {
    const architect = new EncounterArchitect(config) as any;
    const structure: any = {
      sceneId: 'scene-3',
      encounterType: 'dramatic',
      goalClock: { name: 'g', segments: 6, filled: 0, type: 'goal' },
      threatClock: { name: 't', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: 'You prevail.', defeat: 'You fall.' },
      storylets: makePhase4(),
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'Open',
          setupText: 'Alex stands in the hall as Eros waits for an answer.',
          choices: [
            {
              id: 'c1',
              text: 'Step toward Eros',
              approach: 'bold',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex changes the room.', goalTicks: 2, threatTicks: 0 },
                complicated: { tier: 'complicated', narrativeText: 'Alex gains ground with a visible cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Eros takes control of the room.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'c2',
              text: 'Hold position',
              approach: 'careful',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex reads the pressure correctly.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex keeps composure at a cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The pause gives Eros leverage.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'c3',
              text: 'Name the pressure',
              approach: 'clever',
              primarySkill: 'persuasion',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex names the truth aloud.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'The truth lands imperfectly.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The truth misses its mark.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        },
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'Resolve',
          setupText: 'The confrontation narrows to its consequence.',
          choices: [
            {
              id: 'r1',
              text: 'Accept the consequence',
              approach: 'bold',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex carries the outcome forward.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex carries the cost forward.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Alex learns what must change.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'r2',
              text: 'Protect the opening',
              approach: 'careful',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'The opening holds.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'The opening holds imperfectly.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The opening closes.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'r3',
              text: 'Leave with the lesson',
              approach: 'clever',
              primarySkill: 'persuasion',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex leaves with leverage.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex leaves with leverage and a cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Alex leaves with a sharper lesson.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        },
      ],
    };

    expect(() => architect.validateStructure(structure, input)).toThrow(/has neither nextSituation/);
  });

  it('routes dangling outcomes to existing authored storylets without creating storylet prose', () => {
    const architect = new EncounterArchitect(config) as any;
    const storylets = makePhase4();
    const structure: any = {
      sceneId: 'scene-3',
      encounterType: 'dramatic',
      goalClock: { name: 'g', segments: 6, filled: 0, type: 'goal' },
      threatClock: { name: 't', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: 'You prevail.', defeat: 'You fall.' },
      storylets,
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'Open',
          setupText: 'Alex stands in the hall as Eros waits for an answer.',
          choices: [
            {
              id: 'c1',
              text: 'Step toward Eros',
              approach: 'bold',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex changes the room.', goalTicks: 2, threatTicks: 0 },
                complicated: { tier: 'complicated', narrativeText: 'Alex gains ground with a visible cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Eros takes control of the room.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'c2',
              text: 'Hold position',
              approach: 'careful',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex reads the pressure correctly.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex keeps composure at a cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The pause gives Eros leverage.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'c3',
              text: 'Name the pressure',
              approach: 'clever',
              primarySkill: 'persuasion',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex names the truth aloud.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'The truth lands imperfectly.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The truth misses its mark.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        },
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'Resolve',
          setupText: 'The confrontation narrows to its consequence.',
          choices: [
            {
              id: 'r1',
              text: 'Accept the consequence',
              approach: 'bold',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex carries the outcome forward.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex carries the cost forward.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Alex learns what must change.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'r2',
              text: 'Protect the opening',
              approach: 'careful',
              primarySkill: 'resolve',
              outcomes: {
                success: { tier: 'success', narrativeText: 'The opening holds.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'The opening holds imperfectly.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'The opening closes.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
            {
              id: 'r3',
              text: 'Leave with the lesson',
              approach: 'clever',
              primarySkill: 'persuasion',
              outcomes: {
                success: { tier: 'success', narrativeText: 'Alex leaves with leverage.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'Alex leaves with leverage and a cost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
                failure: { tier: 'failure', narrativeText: 'Alex leaves with a sharper lesson.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        },
      ],
    };
    const storyletsBefore = JSON.stringify(structure.storylets);

    const repaired = architect.routeDanglingOutcomesToAuthoredStorylets(structure, input);

    expect(repaired).toBe(1);
    expect(structure.beats[0].choices[0].outcomes.success).toMatchObject({
      isTerminal: true,
      encounterOutcome: 'victory',
    });
    expect(JSON.stringify(structure.storylets)).toBe(storyletsBefore);
    expect(() => architect.validateStructure(structure, input)).not.toThrow();
  });
});

describe('phase-3 conditional choices resolve terminally (no template branch)', () => {
  it('applyEnrichment marks a conditional choice TERMINAL so it never gets a fallback nextSituation', () => {
    const architect = new EncounterArchitect(config) as any;
    const choices: any[] = [{ id: 'c1', text: 'base', outcomes: { success: {}, complicated: {}, failure: {} } }];
    const enrichment = {
      conditionalChoices: [{
        id: 'c4', text: 'Unlocked move', approach: 'tactical', primarySkill: 'perception',
        conditions: { flag: 'earned_trust' }, showWhenLocked: true, lockedText: 'You’d need their trust.',
        outcomes: {
          success: { narrativeText: 'You end it on your terms.', goalTicks: 2, threatTicks: 0 },
          complicated: { narrativeText: 'It works, but at a cost.', goalTicks: 1, threatTicks: 1 },
          failure: { narrativeText: 'It backfires.', goalTicks: 0, threatTicks: 2 },
        },
      }],
    };
    architect.applyEnrichment(choices, { choices: [] }, enrichment);

    const c4 = choices.find((c) => c.id === 'c4');
    expect(c4).toBeTruthy();
    for (const tier of ['success', 'complicated', 'failure'] as const) {
      expect(c4.outcomes[tier].isTerminal).toBe(true);
      expect(c4.outcomes[tier].encounterOutcome).toBeTruthy();
      expect(c4.outcomes[tier].nextSituation).toBeUndefined();
    }
  });

  it('normalizeStructure does NOT synthesize a template resolution beat for a 1-beat TREE encounter', () => {
    const architect = new EncounterArchitect(config) as any;
    // A valid single-beat tree encounter: choices whose outcomes carry embedded nextSituation.
    const structure = {
      sceneId: 'scene-3', encounterType: 'dramatic',
      goalClock: { name: 'g', segments: 6, filled: 0, type: 'goal' },
      threatClock: { name: 't', segments: 4, filled: 0, type: 'threat' },
      storylets: makePhase4(),
      beats: [{
        id: 'beat-1', phase: 'setup', name: 'Open', setupText: 'Vraxxan steps from shadow.',
        choices: [
          { id: 'c1', text: 'Strike', outcomes: { success: { tier: 'success', narrativeText: 'Hit.', nextSituation: { setupText: 'He reels, bespoke and specific.', choices: [{ id: 'n', text: 'Press the advantage' }] } }, complicated: { tier: 'complicated', narrativeText: 'Glances.', isTerminal: true, encounterOutcome: 'partialVictory' }, failure: { tier: 'failure', narrativeText: 'Miss.', isTerminal: true, encounterOutcome: 'defeat' } } },
        ],
      }],
    };
    const normalized = architect.normalizeStructure(structure, input);
    // Should remain a single beat (no synthesized template resolution beat).
    expect(normalized.beats).toHaveLength(1);
    const blob = JSON.stringify(normalized);
    expect(blob.includes('This is the moment that decides everything')).toBe(false);
    expect(blob.includes('Push for a decisive outcome')).toBe(false);
  });
});
