import { describe, expect, it, vi } from 'vitest';
import {
  EncounterArchitect,
  classifyPhaseError,
  mapWithConcurrency,
  type EncounterArchitectInput,
  type EncounterPhaseError,
  type Phase1Result,
} from './EncounterArchitect';
import { TimeoutError } from '../utils/withTimeout';

const config = {
  provider: 'anthropic' as const,
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

describe('classifyPhaseError', () => {
  it('classifies timeout, parse, empty, and other', () => {
    expect(classifyPhaseError(new TimeoutError('x', 1000))).toBe('timeout');
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

describe('executePhased telemetry', () => {
  it('records phaseErrors and marks degraded when later phases fail', async () => {
    const architect = new EncounterArchitect(config) as any;
    const phase1Json = JSON.stringify(makePhase1());
    // Phase 1 succeeds (opening beat); phases 2/3/4 always fail → degraded.
    vi.spyOn(architect, 'callLLM').mockImplementation(async (messages: any) => {
      const prompt: string = messages?.[0]?.content ?? '';
      if (prompt.includes('OPENING BEAT')) return phase1Json;
      throw new Error('The operation was aborted'); // simulate timeout/abort
    });

    const res = await architect.executePhased(input);
    expect(res.success).toBe(true);
    const tel = res.metadata?.encounterTelemetry;
    expect(tel).toBeTruthy();
    expect(tel.phase1Ok).toBe(true);
    expect(tel.degraded).toBe(true);
    expect(tel.mode).toBe('phased_with_gaps');
    expect(tel.phase2.every((ok: boolean) => ok === false)).toBe(true);
    expect(Array.isArray(tel.phaseErrors)).toBe(true);
    expect(tel.phaseErrors.length).toBeGreaterThan(0);
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
