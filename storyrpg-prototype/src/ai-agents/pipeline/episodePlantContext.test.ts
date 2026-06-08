import { describe, expect, it } from 'vitest';
import {
  extractPlantsFromChoiceSet,
  extractTintPlantsFromChoiceSet,
  extractBranchResidueFromChoiceSet,
  plantsToUnresolvedCallbacks,
  mergeUnresolvedForScene,
  treatmentSeedFlagsFromSetupContext,
  buildTreatmentSeedConsequences,
  emitTreatmentSeedConsequences,
  resolveSceneTreatmentSeeds,
  emitSceneTreatmentSeeds,
  resolveSceneBranchAxes,
  emitSceneBranchAxes,
  emitSceneInfoReveals,
  infoRevealFlag,
  type EpisodePlant,
} from './episodePlantContext';
import type { Choice } from '../../types/choice';
import type { CallbackLedger } from './callbackLedger';

// Stub ledger exposing only the method the module uses.
const ledger = {
  trackableFlagsOf: (choice: any) =>
    (choice.consequences ?? [])
      .filter((c: any) => c.type === 'setFlag' && c.value !== false && !String(c.flag).startsWith('tint:') && !String(c.flag).startsWith('route_'))
      .map((c: any) => c.flag),
} as unknown as CallbackLedger;

const choice = (id: string, flag: string | undefined, summary?: string) => ({
  id,
  text: id,
  consequences: flag ? [{ type: 'setFlag', flag, value: true }] : [],
  feedbackCue: summary ? { echoSummary: summary } : undefined,
});

describe('extractPlantsFromChoiceSet', () => {
  it('extracts (flag, authored summary, sceneId) for flag-setting choices with an ack', () => {
    const cs = {
      sceneId: 'scene-1',
      choices: [
        choice('c1', 'lysandra_trusted', 'You chose her over the chain of command.'),
        choice('c2', undefined, 'no flag'),                // no flag → skipped
        choice('c3', 'route_x', 'routing'),                // structural flag → skipped by ledger rule
        choice('c4', 'galen_warned'),                      // flag but no authored summary → skipped
      ] as any,
    };
    const plants = extractPlantsFromChoiceSet(cs, ledger);
    expect(plants).toEqual([
      { flag: 'lysandra_trusted', summary: 'You chose her over the chain of command.', sceneId: 'scene-1' },
    ]);
  });
});

describe('extractTintPlantsFromChoiceSet (Phase F)', () => {
  it('surfaces tint: flags with an ack summary, excluding route_/treatment_branch_', () => {
    const cs = {
      sceneId: 'scene-2',
      choices: [
        choice('c1', 'tint:sentinel_control', 'You sided with control.'),
        choice('c2', 'tint:twilight_connection'),       // no ack summary → skipped
        choice('c3', 'route_x', 'routing'),             // not a tint flag → skipped
        choice('c4', 'treatment_branch_y', 'branch'),   // structural → skipped
      ] as any,
    };
    expect(extractTintPlantsFromChoiceSet(cs)).toEqual([
      { flag: 'tint:sentinel_control', summary: 'You sided with control.', sceneId: 'scene-2' },
    ]);
  });
});

describe('extractBranchResidueFromChoiceSet (C1/C2)', () => {
  it('surfaces route_/treatment_branch_ flags as branch-tier plants, excluding tint/plain', () => {
    const cs = {
      sceneId: 'scene-3',
      choices: [
        choice('c1', 'route_betrayal', 'You took the betrayal road.'),
        choice('c2', 'treatment_branch_siege', 'You held the siege line.'),
        choice('c3', 'tint:mood', 'tint'),               // tint → excluded (tint extractor owns it)
        choice('c4', 'lysandra_trusted', 'plain'),       // plain callback flag → excluded
        choice('c5', 'route_quiet'),                     // no ack summary → skipped
      ] as any,
    };
    expect(extractBranchResidueFromChoiceSet(cs)).toEqual([
      { flag: 'route_betrayal', summary: 'You took the betrayal road.', sceneId: 'scene-3', tier: 'branch' },
      { flag: 'treatment_branch_siege', summary: 'You held the siege line.', sceneId: 'scene-3', tier: 'branch' },
    ]);
  });

  it('branch plants carry consequenceTier "branch" through plantsToUnresolvedCallbacks', () => {
    const plants = extractBranchResidueFromChoiceSet({
      sceneId: 's', choices: [choice('c', 'route_x', 'residue')] as any,
    });
    expect(plantsToUnresolvedCallbacks(plants, 2)[0].consequenceTier).toBe('branch');
  });
});

describe('plantsToUnresolvedCallbacks', () => {
  it('shapes plants as unresolved-callback entries, deduped by flag', () => {
    const plants: EpisodePlant[] = [
      { flag: 'f1', summary: 's1', sceneId: 'scene-1' },
      { flag: 'f1', summary: 's1b', sceneId: 'scene-2' }, // dup flag
      { flag: 'f2', summary: 's2', sceneId: 'scene-1' },
    ];
    const out = plantsToUnresolvedCallbacks(plants, 1);
    expect(out.map((h) => h.flags[0])).toEqual(['f1', 'f2']);
    expect(out[0]).toMatchObject({ id: 'within-ep1-f1', sourceEpisode: 1, flags: ['f1'] });
  });
});

describe('mergeUnresolvedForScene', () => {
  it('merges cross-episode hooks with within-episode plants', () => {
    const cross = [{ id: 'x', sourceEpisode: 0, summary: 'prior', flags: ['ep0flag'] }];
    const plants: EpisodePlant[] = [{ flag: 'f1', summary: 's1', sceneId: 'scene-1' }];
    const merged = mergeUnresolvedForScene(cross, plants, 1)!;
    expect(merged.map((h) => h.flags[0])).toEqual(['ep0flag', 'f1']);
  });

  it('does not duplicate a flag already covered by a cross-episode hook', () => {
    const cross = [{ id: 'x', sourceEpisode: 0, summary: 'prior', flags: ['f1'] }];
    const plants: EpisodePlant[] = [{ flag: 'f1', summary: 's1', sceneId: 'scene-1' }];
    const merged = mergeUnresolvedForScene(cross, plants, 1)!;
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('x');
  });

  it('returns undefined when nothing to surface', () => {
    expect(mergeUnresolvedForScene(undefined, [], 1)).toBeUndefined();
  });
});

describe('treatment consequence-seed emitters', () => {
  it('parses only treatment_seed_* flag directives from setup context', () => {
    const setupContext = [
      'flag:treatment_seed_ep3_1 — Darian poisons the well',
      'flag:treatment_seed_ep3_1 — duplicate, deduped',
      'flag:some_other_flag — not a seed',
      'relationship:lysandra.trust > 20 — warms the reunion',
      'flag:treatment_seed_ep3_2 — the key is hidden',
    ];
    expect(treatmentSeedFlagsFromSetupContext(setupContext)).toEqual([
      'treatment_seed_ep3_1',
      'treatment_seed_ep3_2',
    ]);
    expect(treatmentSeedFlagsFromSetupContext(undefined)).toEqual([]);
  });

  it('builds setFlag consequences for each seed flag', () => {
    expect(buildTreatmentSeedConsequences(['treatment_seed_ep3_1'])).toEqual([
      { type: 'setFlag', flag: 'treatment_seed_ep3_1', value: true },
    ]);
  });

  it('emits the seed setFlag on-page onto the load-bearing choice', () => {
    const choices: Choice[] = [
      { id: 'c1', text: 'minor', consequences: [] } as unknown as Choice,
      {
        id: 'c2',
        text: 'load-bearing',
        consequences: [{ type: 'setFlag', flag: 'other', value: true }],
      } as unknown as Choice,
    ];
    emitTreatmentSeedConsequences(choices, ['treatment_seed_ep3_1']);
    // Attached to c2 (most existing consequences), not duplicated on c1.
    const c2Flags = (choices[1].consequences ?? []).filter(
      (c) => c.type === 'setFlag' && c.flag === 'treatment_seed_ep3_1',
    );
    expect(c2Flags).toHaveLength(1);
    expect((choices[0].consequences ?? []).length).toBe(0);
  });

  it('does not duplicate a seed flag already set by any choice', () => {
    const choices: Choice[] = [
      {
        id: 'c1',
        text: 'already sets it',
        consequences: [{ type: 'setFlag', flag: 'treatment_seed_ep3_1', value: true }],
      } as unknown as Choice,
    ];
    emitTreatmentSeedConsequences(choices, ['treatment_seed_ep3_1']);
    const matching = (choices[0].consequences ?? []).filter(
      (c) => c.type === 'setFlag' && c.flag === 'treatment_seed_ep3_1',
    );
    expect(matching).toHaveLength(1);
  });

  it('no-ops on empty choices or empty seeds', () => {
    expect(emitTreatmentSeedConsequences([], ['treatment_seed_ep3_1'])).toEqual([]);
    const choices: Choice[] = [{ id: 'c1', text: 't', consequences: [] } as unknown as Choice];
    emitTreatmentSeedConsequences(choices, []);
    expect((choices[0].consequences ?? []).length).toBe(0);
  });
});

// GAP-C end-to-end seam: the pipeline calls emitSceneTreatmentSeeds(blueprint, choices)
// at the ChoiceAuthor seam. The seed flags are resolved from BOTH choicePoint.
// setsTreatmentSeeds (the StoryArchitect-recorded list) and the encounterSetupContext
// flag directives, so an episode whose origin is an encounter still emits seeds.
describe('resolveSceneTreatmentSeeds + emitSceneTreatmentSeeds (GAP-C wiring)', () => {
  it('resolves seeds from choicePoint.setsTreatmentSeeds and encounterSetupContext, deduped + filtered', () => {
    const scene = {
      choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep3_1', 'not_a_seed', 'treatment_seed_ep3_1'] },
      encounterSetupContext: [
        'flag:treatment_seed_ep3_2 — the key is hidden',
        'flag:treatment_seed_ep3_1 — duplicate across sources',
        'flag:plain_flag — ignored',
      ],
    };
    expect(resolveSceneTreatmentSeeds(scene)).toEqual([
      'treatment_seed_ep3_1',
      'treatment_seed_ep3_2',
    ]);
  });

  it('resolves seeds from encounterSetupContext alone when there is no choicePoint (encounter origin)', () => {
    const encounterScene = {
      encounterSetupContext: ['flag:treatment_seed_ep4_1 — Darian springs the trap'],
    };
    expect(resolveSceneTreatmentSeeds(encounterScene)).toEqual(['treatment_seed_ep4_1']);
  });

  it('deterministically emits the seed setFlag on-page for a scene that declares seeds', () => {
    const scene = { choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep3_1'] } };
    const choices: Choice[] = [
      { id: 'c1', text: 'minor', consequences: [] } as unknown as Choice,
      { id: 'c2', text: 'load-bearing', consequences: [{ type: 'setFlag', flag: 'x', value: true }] } as unknown as Choice,
    ];
    emitSceneTreatmentSeeds(scene, choices);
    const allSet = choices.flatMap((c) => c.consequences ?? []).filter(
      (c) => c.type === 'setFlag' && c.flag === 'treatment_seed_ep3_1',
    );
    // Guaranteed by code: exactly one emitter for the declared seed (acceptance §7.6 count > 0).
    expect(allSet).toHaveLength(1);
  });

  it('no-ops for a scene that declares no treatment seeds (non-treatment runs unaffected)', () => {
    const scene = { choicePoint: { setsTreatmentSeeds: [] }, encounterSetupContext: ['relationship:npc.trust > 20 — warms'] };
    const choices: Choice[] = [{ id: 'c1', text: 't', consequences: [] } as unknown as Choice];
    emitSceneTreatmentSeeds(scene, choices);
    expect((choices[0].consequences ?? []).length).toBe(0);
  });
});

describe('ending-axis emitters (treatment_branch_*)', () => {
  it('resolveSceneBranchAxes reads setsBranchAxes and prefix-guards', () => {
    const scene = { choicePoint: { setsBranchAxes: ['treatment_branch_a', 'route_x', 'treatment_branch_a', 'treatment_branch_b'] } };
    expect(resolveSceneBranchAxes(scene)).toEqual(['treatment_branch_a', 'treatment_branch_b']);
  });

  it('emitSceneBranchAxes distributes axes round-robin across choices so distinct choices drive distinct axes', () => {
    const scene = { choicePoint: { setsBranchAxes: ['treatment_branch_a', 'treatment_branch_b'] } };
    const choices: Choice[] = [
      { id: 'c1', text: 't', consequences: [] } as unknown as Choice,
      { id: 'c2', text: 't', consequences: [] } as unknown as Choice,
    ];
    emitSceneBranchAxes(scene, choices);
    const flagsOf = (c: Choice) => (c.consequences ?? []).filter((x: any) => x.type === 'setFlag').map((x: any) => x.flag);
    expect(flagsOf(choices[0])).toEqual(['treatment_branch_a']);
    expect(flagsOf(choices[1])).toEqual(['treatment_branch_b']);
  });

  it('does not duplicate an axis already set on any choice, and no-ops when nothing is declared', () => {
    const scene = { choicePoint: { setsBranchAxes: ['treatment_branch_a'] } };
    const choices: Choice[] = [
      { id: 'c1', text: 't', consequences: [{ type: 'setFlag', flag: 'treatment_branch_a', value: true }] } as unknown as Choice,
    ];
    emitSceneBranchAxes(scene, choices);
    expect((choices[0].consequences ?? []).length).toBe(1);

    const empty: Choice[] = [{ id: 'c1', text: 't', consequences: [] } as unknown as Choice];
    emitSceneBranchAxes({ choicePoint: { setsBranchAxes: [] } }, empty);
    expect((empty[0].consequences ?? []).length).toBe(0);
  });
});

describe('emitSceneBranchAxes semantic placement (gen-5 wine-branch collapse)', () => {
  const hasFlag = (choice: Choice, flag: string): boolean =>
    (choice.consequences ?? []).some((c) => c.type === 'setFlag' && (c as { flag?: string }).flag === flag);

  it('attaches a descriptive axis to the semantically-matching choice, not round-robin', () => {
    const choices: Choice[] = [
      { id: 'c-rose', text: 'Compose a sentence about the black rose on the wall.', consequences: [] } as unknown as Choice,
      { id: 'c-wine', text: 'Drink the dark wine Victor pours at the Equinox toast.', consequences: [] } as unknown as Choice,
    ];
    emitSceneBranchAxes(
      { id: 's3-2', choicePoint: { setsBranchAxes: ['treatment_branch_the_country_house_wine_a_new_appetite_vs_none'] } },
      choices,
    );
    expect(hasFlag(choices[1], 'treatment_branch_the_country_house_wine_a_new_appetite_vs_none')).toBe(true);
    expect(hasFlag(choices[0], 'treatment_branch_the_country_house_wine_a_new_appetite_vs_none')).toBe(false);
  });

  it('still sets an axis with no semantic match (falls back to round-robin)', () => {
    const choices: Choice[] = [
      { id: 'c1', text: 'Say nothing.', consequences: [] } as unknown as Choice,
    ];
    emitSceneBranchAxes(
      { id: 's1', choicePoint: { setsBranchAxes: ['treatment_branch_quartz_sanctuary_vs_open_threshold'] } },
      choices,
    );
    expect(hasFlag(choices[0], 'treatment_branch_quartz_sanctuary_vs_open_threshold')).toBe(true);
  });
});

describe('emitSceneInfoReveals (Step 3)', () => {
  const mkChoice = (id: string): Choice => ({ id, text: id, choiceType: 'relationship', consequences: [] } as unknown as Choice);

  it('sets a detectable <id>_reveal flag for each assigned reveal, round-robin across choices', () => {
    const choices = [mkChoice('c1'), mkChoice('c2')];
    emitSceneInfoReveals({ id: 's3', revealsInfoIds: ['info-A', 'info-F'] }, choices);
    const flags = choices.flatMap((c) => (c.consequences ?? []).map((x: any) => x.flag));
    expect(flags).toContain(infoRevealFlag('info-A'));
    expect(flags).toContain(infoRevealFlag('info-F'));
    // round-robin: one flag on each choice
    expect((choices[0].consequences ?? []).length).toBe(1);
    expect((choices[1].consequences ?? []).length).toBe(1);
  });

  it('the emitted flag matches the schedule validator reveal convention (<id> + _reveal)', () => {
    expect(infoRevealFlag('info-A')).toBe('info-A_reveal');
  });

  it('is idempotent (skips a flag already set) and a no-op without reveals or choices', () => {
    const pre = [{ id: 'c1', text: 'c1', choiceType: 'relationship', consequences: [{ type: 'setFlag', flag: 'info-A_reveal', value: true }] } as unknown as Choice];
    emitSceneInfoReveals({ id: 's3', revealsInfoIds: ['info-A'] }, pre);
    expect((pre[0].consequences ?? []).filter((c: any) => c.flag === 'info-A_reveal').length).toBe(1);
    const none = [mkChoice('c1')];
    expect(emitSceneInfoReveals({ id: 's3' }, none)).toBe(none);
    expect((none[0].consequences ?? []).length).toBe(0);
    expect(emitSceneInfoReveals({ id: 's3', revealsInfoIds: ['info-A'] }, [])).toEqual([]);
  });
});
