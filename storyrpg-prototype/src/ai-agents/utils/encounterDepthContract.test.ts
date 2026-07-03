import { afterEach, describe, expect, it } from 'vitest';
import type { Encounter } from '../../types/encounter';
import { analyzeEncounterDepth, deepenRootTerminalWins, deepenStructureRootWins, shrinkClockToAttainable } from './encounterDepthContract';

function enc(choices: unknown[], goalSegments = 6): Encounter {
  return {
    id: 'e1', type: 'social', name: '', description: '',
    goalClock: { id: 'g', name: 'Goal', description: '', segments: goalSegments, filled: 0, type: 'goal' },
    threatClock: { id: 't', name: 'Threat', description: '', segments: 4, filled: 0, type: 'threat' },
    stakes: { victory: '', defeat: '' },
    phases: [{ id: 'p1', name: '', description: '', beats: [{ id: 'b1', choices }], }],
    startingPhaseId: 'p1',
    outcomes: {},
  } as unknown as Encounter;
}

const nested = (goalTicks: number) => ({
  setupText: 'deeper',
  choices: [{
    id: 'c-deep',
    outcomes: {
      success: { tier: 'success', goalTicks, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory', consequences: [{ type: 'setFlag', flag: 'f', value: true }] },
    },
  }],
});

describe('analyzeEncounterDepth (G12)', () => {
  it('flags a root-level terminal victory as a one-click win', () => {
    const e = enc([
      { id: 'c4', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'sit', isTerminal: true, encounterOutcome: 'victory' } } },
      { id: 'c1', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', nextSituation: nested(3) } } },
    ]);
    const a = analyzeEncounterDepth(e);
    expect(a.oneClickWins).toHaveLength(1);
    expect(a.oneClickWins[0]).toMatchObject({ choiceId: 'c4', outcome: 'victory', hasConsequences: false });
    expect(a.maxDepth).toBe(2);
  });

  it('computes max attainable goal ticks across the best path', () => {
    const e = enc([
      { id: 'c1', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', nextSituation: nested(3) } } },
    ]);
    const a = analyzeEncounterDepth(e);
    expect(a.maxGoalTicks).toBe(5); // 2 + 3 < 6 segments — the g12 unfillable-clock shape
    expect(a.goalSegments).toBe(6);
  });

  it('does not flag root-level escape/defeat terminals', () => {
    const e = enc([
      { id: 'c2', outcomes: { failure: { tier: 'failure', goalTicks: 0, threatTicks: 2, narrativeText: 'x', isTerminal: true, encounterOutcome: 'escape' } } },
    ]);
    expect(analyzeEncounterDepth(e).oneClickWins).toHaveLength(0);
  });

  it('does not flag a terminal win in a LATE sustained-set-piece beat reached via nextBeatId', () => {
    // G13: a flat sustained set-piece chains beats beat-1 → … → beat-4 in ONE phase.
    // beat-4's terminal victory is reached only after the earlier beats, so it is not
    // a one-click win — the old walk started every top-level beat at depth 1 and
    // mis-flagged it (endsong ep3 false positive).
    const e = {
      id: 'e1', type: 'social', name: '', description: '',
      goalClock: { id: 'g', name: '', description: '', segments: 4, filled: 0, type: 'goal' },
      threatClock: { id: 't', name: '', description: '', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: '', defeat: '' },
      startingPhaseId: 'p1',
      startingBeatId: 'beat-1',
      outcomes: {},
      phases: [{
        id: 'p1', name: '', description: '', startingBeatId: 'beat-1',
        beats: [
          { id: 'beat-1', choices: [{ id: 'b1-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', nextBeatId: 'beat-2' } } }] },
          { id: 'beat-2', choices: [{ id: 'b2-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', nextBeatId: 'beat-3' } } }] },
          { id: 'beat-3', choices: [{ id: 'b3-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', nextBeatId: 'beat-4' } } }] },
          { id: 'beat-4', choices: [{ id: 'b4-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } }] },
        ],
      }],
    } as unknown as Encounter;
    expect(analyzeEncounterDepth(e).oneClickWins).toHaveLength(0);
  });

  it('still flags a terminal win in the phase ENTRY beat of a multi-beat phase', () => {
    // The entry beat is the true root — a terminal win there IS one-click even when
    // the phase has later chained beats.
    const e = {
      id: 'e1', type: 'social', name: '', description: '',
      goalClock: { id: 'g', name: '', description: '', segments: 4, filled: 0, type: 'goal' },
      threatClock: { id: 't', name: '', description: '', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: '', defeat: '' },
      startingPhaseId: 'p1', startingBeatId: 'beat-1', outcomes: {},
      phases: [{
        id: 'p1', name: '', description: '', startingBeatId: 'beat-1',
        beats: [
          { id: 'beat-1', choices: [
            { id: 'b1-shortcut', outcomes: { success: { tier: 'success', goalTicks: 4, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } },
            { id: 'b1-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', nextBeatId: 'beat-2' } } },
          ] },
          { id: 'beat-2', choices: [{ id: 'b2-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } }] },
        ],
      }],
    } as unknown as Encounter;
    const a = analyzeEncounterDepth(e);
    expect(a.oneClickWins.map((w) => w.choiceId)).toEqual(['b1-shortcut']);
  });
});

describe('deepenRootTerminalWins (G13 one-click-win autofix)', () => {
  // The exact failing shape: a tree-routed single-beat encounter whose 4th choice
  // ends the set-piece at the root (success→victory, complicated→partialVictory),
  // with zero consequences.
  const g13Enc = (): Encounter => enc([
    { id: 'c1', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', nextSituation: nested(3) } } },
    {
      id: 'c4', approach: 'social', primarySkill: 'perception',
      outcomes: {
        success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'Two voices, one rhythm.', isTerminal: true, encounterOutcome: 'victory' },
        complicated: { tier: 'complicated', goalTicks: 1, threatTicks: 1, narrativeText: 'It costs you.', isTerminal: true, encounterOutcome: 'partialVictory' },
        failure: { tier: 'failure', goalTicks: 0, threatTicks: 2, narrativeText: 'It breaks.', isTerminal: true, encounterOutcome: 'defeat' },
      },
    },
  ]);

  it('demotes root terminal wins into a two-step finish that satisfies the depth contract', () => {
    const e = g13Enc();
    const result = deepenRootTerminalWins(e);
    expect(result.lifted).toEqual([
      { beatId: 'b1', choiceId: 'c4', outcome: 'victory' },
      { beatId: 'b1', choiceId: 'c4', outcome: 'partialVictory' },
    ]);
    expect(result.skipped).toHaveLength(0);
    // The gate's own analyzer must now be clean.
    expect(analyzeEncounterDepth(e).oneClickWins).toHaveLength(0);

    const c4 = (e.phases[0].beats[0] as any).choices[1];
    // The authored win prose survives as the intermediate result.
    expect(c4.outcomes.success.isTerminal).toBe(false);
    expect(c4.outcomes.success.narrativeText).toBe('Two voices, one rhythm.');
    expect(c4.outcomes.success.encounterOutcome).toBeUndefined();
    // The follow-up covers all three tiers (a missing tier dead-ends the reader)
    // and every terminal carries consequences.
    const sealChoices = c4.outcomes.success.nextSituation.choices;
    expect(sealChoices.map((seal: any) => seal.approach)).toEqual(['aggressive', 'cautious', 'clever']);
    const seal = sealChoices[0];
    expect(seal.id).toBe('c4-aggressive-seal');
    expect(seal.primarySkill).toBe('perception');
    for (const tier of ['success', 'complicated', 'failure']) {
      expect(seal.outcomes[tier].isTerminal).toBe(true);
      expect(seal.outcomes[tier].consequences.length).toBeGreaterThan(0);
    }
    // A botched finish never revokes the earned win — partialVictory is the floor.
    expect(seal.outcomes.success.encounterOutcome).toBe('victory');
    expect(seal.outcomes.failure.encounterOutcome).toBe('partialVictory');
    // The root defeat terminal is allowed by the contract and stays untouched.
    expect(c4.outcomes.failure.isTerminal).toBe(true);
    expect(c4.outcomes.failure.encounterOutcome).toBe('defeat');
  });

  it('is idempotent — a second pass finds nothing to demote', () => {
    const e = g13Enc();
    deepenRootTerminalWins(e);
    const second = deepenRootTerminalWins(e);
    expect(second.lifted).toHaveLength(0);
    expect(analyzeEncounterDepth(e).oneClickWins).toHaveLength(0);
  });

  it('routes flat nextBeatId encounters through appended finish beats instead of injecting unplayable embedded situations', () => {
    // No nextSituation anywhere on the first choice → the reader plays this in
    // flat mode, where an embedded situation is never walked. The repair must
    // therefore add a top-level beat and route to it by nextBeatId.
    const e = {
      id: 'e1', type: 'social', name: '', description: '',
      goalClock: { id: 'g', name: '', description: '', segments: 4, filled: 0, type: 'goal' },
      threatClock: { id: 't', name: '', description: '', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: '', defeat: '' },
      startingPhaseId: 'p1', startingBeatId: 'beat-1', outcomes: {},
      phases: [{
        id: 'p1', name: '', description: '', startingBeatId: 'beat-1',
        beats: [
          { id: 'beat-1', choices: [
            { id: 'b1-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', nextBeatId: 'beat-2' } } },
            { id: 'b1-win', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } },
          ] },
          { id: 'beat-2', choices: [{ id: 'b2-c1', outcomes: { success: { tier: 'success', goalTicks: 1, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } }] },
        ],
      }],
    } as unknown as Encounter;
    const result = deepenRootTerminalWins(e);
    expect(result.lifted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.flatRouted).toEqual([{
      beatId: 'beat-1',
      choiceId: 'b1-win',
      outcome: 'victory',
      finishBeatId: 'beat-1-b1-win-victory-finish',
    }]);
    expect(analyzeEncounterDepth(e).oneClickWins).toHaveLength(0);

    const rootOutcome = ((e.phases[0].beats[0] as any).choices[1].outcomes.success);
    expect(rootOutcome.isTerminal).toBe(false);
    expect(rootOutcome.encounterOutcome).toBeUndefined();
    expect(rootOutcome.nextBeatId).toBe('beat-1-b1-win-victory-finish');
    const finish = (e.phases[0].beats as any[]).find((beat) => beat.id === 'beat-1-b1-win-victory-finish');
    expect(finish.setupText).toContain('opening is real');
    expect(finish.choices.map((seal: any) => seal.approach)).toEqual(['aggressive', 'cautious', 'clever']);
    expect(finish.choices[0].outcomes.success.encounterOutcome).toBe('victory');
    expect(finish.choices[0].outcomes.failure.encounterOutcome).toBe('partialVictory');
  });

  it('reuses authored consequences on the finish terminals when the root win had them', () => {
    const e = g13Enc();
    const c4 = (e.phases[0].beats[0] as any).choices[1];
    c4.outcomes.success.consequences = [{ type: 'setFlag', flag: 'authored_flag', value: true }];
    deepenRootTerminalWins(e);
    const seal = c4.outcomes.success.nextSituation.choices[0];
    expect(seal.outcomes.success.consequences).toEqual([{ type: 'setFlag', flag: 'authored_flag', value: true }]);
  });

  it('never re-seals its own finish beats, even when an upstream pass breaks every nextBeatId edge (4,924-beat explosion regression)', () => {
    // bite-me_2026-07-03T13-21-36: StructuralValidator.autoFix renamed every
    // encounter beat to sequential beat-N while rewriting only choice-level
    // nextBeatId, so all outcome-level edges dangled. Every beat then looked
    // like a root, and the finish beats' seal choices — whose 9 outcomes are
    // ALL terminal wins — were demoted again each contract round: ~9× beat
    // growth per round. The renamer is fixed separately; this pins that the
    // repair itself converges under broken edges instead of compounding.
    const e = {
      id: 'e1', type: 'social', name: '', description: '',
      goalClock: { id: 'g', name: '', description: '', segments: 4, filled: 0, type: 'goal' },
      threatClock: { id: 't', name: '', description: '', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: '', defeat: '' },
      startingPhaseId: 'p1', startingBeatId: 'beat-1', outcomes: {},
      phases: [{
        id: 'p1', name: '', description: '', startingBeatId: 'beat-1',
        beats: [
          { id: 'beat-1', choices: [
            { id: 'b1-win', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory' } } },
          ] },
        ],
      }],
    } as unknown as Encounter;

    const first = deepenRootTerminalWins(e);
    expect(first.flatRouted).toHaveLength(1);
    const beats = e.phases[0].beats as any[];
    expect(beats).toHaveLength(2);

    // Simulate the edge-breaker: sequential renames, outcome refs untouched.
    beats.forEach((beat, i) => { beat.id = `beat-${i + 1}`; });

    const second = deepenRootTerminalWins(e);
    expect(second.flatRouted).toHaveLength(0);
    expect(second.lifted).toHaveLength(0);
    expect(e.phases[0].beats).toHaveLength(2);

    // A third pass stays converged too.
    const third = deepenRootTerminalWins(e);
    expect(third.flatRouted).toHaveLength(0);
    expect(e.phases[0].beats).toHaveLength(2);
  });
});

describe('deepenStructureRootWins (G13 source-side guard, EncounterArchitect draft shape)', () => {
  // The architect's DRAFT has top-level `beats` (no `phases`) — the shape it holds
  // the moment the LLM response is parsed/normalized, before agent→runtime conversion.
  // This is the exact failing c4: a branch-gated 4th root choice that wins the
  // set-piece in one click (success→victory, complicated→partialVictory, all costless).
  const g13Draft = () => ({
    id: 'bite-me-ep1-encounter',
    sceneId: 'bite-me-ep1-scene-3',
    startingBeatId: 'beat-1',
    beats: [
      {
        id: 'beat-1',
        choices: [
          {
            id: 'c1', approach: 'bold', primarySkill: 'physical',
            outcomes: {
              success: {
                tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'You press in.',
                nextSituation: {
                  setupText: 'deeper',
                  choices: [{
                    id: 'c1-deep',
                    outcomes: {
                      success: { tier: 'success', goalTicks: 3, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory', consequences: [{ type: 'setFlag', flag: 'f', value: true }] },
                    },
                  }],
                },
              },
            },
          },
          {
            id: 'c4', approach: 'social', primarySkill: 'perception',
            conditions: { type: 'flag', flag: 'treatment_branch_alpha', value: true },
            outcomes: {
              success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'Two voices, one rhythm.', isTerminal: true, encounterOutcome: 'victory' },
              complicated: { tier: 'complicated', goalTicks: 1, threatTicks: 1, narrativeText: 'It costs you.', isTerminal: true, encounterOutcome: 'partialVictory' },
              failure: { tier: 'failure', goalTicks: 0, threatTicks: 2, narrativeText: 'It breaks.', isTerminal: true, encounterOutcome: 'defeat' },
            },
          },
        ],
      },
    ],
  });

  it('demotes the gated root c4 win in the flat draft, mutating it in place', () => {
    const draft = g13Draft();
    const result = deepenStructureRootWins(draft);
    expect(result.lifted).toEqual([
      { beatId: 'beat-1', choiceId: 'c4', outcome: 'victory' },
      { beatId: 'beat-1', choiceId: 'c4', outcome: 'partialVictory' },
    ]);
    expect(result.skipped).toHaveLength(0);

    const c4 = draft.beats[0].choices[1] as any;
    // The branch gate survives — the gated choice now leads to a two-step finish.
    expect(c4.conditions).toEqual({ type: 'flag', flag: 'treatment_branch_alpha', value: true });
    // Authored win prose survives as the intermediate result; terminal lifted to depth 2.
    expect(c4.outcomes.success.isTerminal).toBe(false);
    expect(c4.outcomes.success.encounterOutcome).toBeUndefined();
    expect(c4.outcomes.success.narrativeText).toBe('Two voices, one rhythm.');
    const sealChoices = c4.outcomes.success.nextSituation.choices;
    expect(sealChoices.map((seal: any) => seal.approach)).toEqual(['aggressive', 'cautious', 'clever']);
    const seal = sealChoices[0];
    expect(seal.id).toBe('c4-aggressive-seal');
    expect(seal.primarySkill).toBe('perception');
    for (const tier of ['success', 'complicated', 'failure'] as const) {
      expect(seal.outcomes[tier].isTerminal).toBe(true);
      expect(seal.outcomes[tier].consequences.length).toBeGreaterThan(0);
    }
    // A botched finish never revokes the earned win — partialVictory is the floor.
    expect(seal.outcomes.success.encounterOutcome).toBe('victory');
    expect(seal.outcomes.failure.encounterOutcome).toBe('partialVictory');
    // The root defeat terminal is contract-legal and untouched.
    expect(c4.outcomes.failure.isTerminal).toBe(true);
    expect(c4.outcomes.failure.encounterOutcome).toBe('defeat');
  });

  it('is idempotent on the draft — a second pass finds nothing to demote', () => {
    const draft = g13Draft();
    deepenStructureRootWins(draft);
    const second = deepenStructureRootWins(draft);
    expect(second.lifted).toHaveLength(0);
  });

  it('repairs many flat root-terminal wins in the EncounterArchitect draft shape', () => {
    const draft = {
      id: 'bite-me-cismigiu',
      sceneId: 'treatment-enc-1-1',
      startingBeatId: 'b1',
      beats: Array.from({ length: 3 }, (_, beatIndex) => ({
        id: `b${beatIndex + 1}`,
        choices: Array.from({ length: 3 }, (_, choiceIndex) => ({
          id: `b${beatIndex + 1}-c${choiceIndex + 1}`,
          primarySkill: choiceIndex === 0 ? 'survival' : choiceIndex === 1 ? 'perception' : 'presence',
          outcomes: {
            success: {
              tier: 'success',
              goalTicks: 1,
              threatTicks: 0,
              narrativeText: 'Victor creates an opening.',
              isTerminal: true,
              encounterOutcome: 'victory',
            },
            complicated: {
              tier: 'complicated',
              goalTicks: 1,
              threatTicks: 1,
              narrativeText: 'The opening costs you.',
              isTerminal: true,
              encounterOutcome: 'partialVictory',
            },
            failure: {
              tier: 'failure',
              goalTicks: 0,
              threatTicks: 1,
              narrativeText: 'The shadow presses in.',
              isTerminal: true,
              encounterOutcome: 'defeat',
            },
          },
        })),
      })),
    };

    const result = deepenStructureRootWins(draft);

    expect(result.skipped).toHaveLength(0);
    expect(result.flatRouted).toHaveLength(18);
    expect(draft.beats).toHaveLength(21);
    expect(analyzeEncounterDepth({
      id: draft.id,
      startingBeatId: draft.startingBeatId,
      goalClock: { id: 'g', name: '', description: '', segments: 6, filled: 0, type: 'goal' },
      threatClock: { id: 't', name: '', description: '', segments: 4, filled: 0, type: 'threat' },
      stakes: { victory: '', defeat: '' },
      phases: [{ beats: draft.beats, startingBeatId: draft.startingBeatId }],
    } as unknown as Encounter).oneClickWins).toHaveLength(0);
  });
});

describe('shrinkClockToAttainable', () => {
  it('shrinks an unfillable goal clock to best attainable ticks', () => {
    const e = enc([
      { id: 'c1', outcomes: { success: { tier: 'success', goalTicks: 2, threatTicks: 0, narrativeText: 'x', nextSituation: nested(3) } } },
    ]);
    const r = shrinkClockToAttainable(e);
    expect(r).toEqual({ goalShrunk: true, goalFrom: 6, goalTo: 5 });
    expect(e.goalClock.segments).toBe(5);
    // Idempotent.
    expect(shrinkClockToAttainable(e).goalShrunk).toBe(false);
  });

  it('no-ops when the clock is already fillable or no ticks authored', () => {
    const fillable = enc([
      { id: 'c1', outcomes: { success: { tier: 'success', goalTicks: 6, threatTicks: 0, narrativeText: 'x', isTerminal: true, encounterOutcome: 'victory', consequences: [{}], nextSituation: undefined } } },
    ], 5);
    expect(shrinkClockToAttainable(fillable).goalShrunk).toBe(false);
    const empty = enc([], 6);
    expect(shrinkClockToAttainable(empty).goalShrunk).toBe(false);
  });
});

describe('keepFlatEncounterSpine (encounter unification W2 rollout flag)', () => {
  afterEach(() => {
    delete process.env.STORYRPG_ENCOUNTER_FLAT;
  });

  it('defaults OFF (current tree-converting behavior)', async () => {
    const { keepFlatEncounterSpine } = await import('./encounterDepthContract');
    delete process.env.STORYRPG_ENCOUNTER_FLAT;
    expect(keepFlatEncounterSpine()).toBe(false);
  });

  it('turns on with STORYRPG_ENCOUNTER_FLAT=1', async () => {
    const { keepFlatEncounterSpine } = await import('./encounterDepthContract');
    process.env.STORYRPG_ENCOUNTER_FLAT = '1';
    expect(keepFlatEncounterSpine()).toBe(true);
  });
});
