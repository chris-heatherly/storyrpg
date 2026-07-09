import { describe, expect, it, vi } from 'vitest';
import { runReconvergenceResidueGate, type ResidueCriticLike } from './reconvergenceResidueRepair';
import type { ResidueValidationResultLike } from '../pipeline/reconvergenceResidue';

type Emitted = { type: 'warning' | 'debug'; phase?: string; message: string; data?: unknown };

function failingResult(extra: ResidueValidationResultLike['issues'] = []): ResidueValidationResultLike {
  return {
    valid: false,
    issues: [
      {
        type: 'missing_branch_residue',
        severity: 'error',
        message: 'Reconverged branch target s4 has no conditional text, callback you, or onShow residue to acknowledge the branch path.',
        targetSceneId: 's4',
      },
      ...extra,
    ],
  };
}

const passingResult: ResidueValidationResultLike = { valid: true, issues: [] };

function sceneContents() {
  return [
    {
      sceneId: 's4',
      startingBeatId: 's4-b1',
      beats: [{
        id: 's4-b1',
        text: 'The gate looms.',
      } as {
        id: string;
        text?: string;
        callbackHookIds?: string[];
        textVariants?: Array<{
          condition?: { type?: string; flag?: string; value?: unknown };
          text?: string;
          callbackHookId?: string;
        }>;
      }],
    },
  ];
}

const episodeScenes = [
  {
    id: 's2',
    beats: [{ id: 's2-b1', choices: [{ id: 'c1', text: 'Cross the bridge', nextSceneId: 's4', consequences: [{ type: 'setFlag', flag: 'took_bridge' }] }] }],
  },
  { id: 's4', beats: [{ id: 's4-b1' }] },
];

function criticReturning(rewrittenBeats: Array<{ id: string; text?: string; textVariants?: unknown }>): ResidueCriticLike & { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn().mockResolvedValue({ success: true, data: { rewrittenBeats } }) };
}

describe('runReconvergenceResidueGate', () => {
  it('repairs via one targeted critic regen and returns the revalidated passing result', async () => {
    const contents = sceneContents();
    const critic = criticReturning([
      { id: 's4-b1', text: 'The gate looms.', textVariants: [{ condition: { type: 'flag', flag: 'took_bridge', value: true }, text: 'Your boots still drip from the bridge crossing.' }] },
    ]);
    const emitted: Emitted[] = [];
    const revalidate = vi.fn().mockReturnValue(passingResult);

    const outcome = await runReconvergenceResidueGate({
      result: failingResult(),
      episodeScenes,
      sceneContents: contents,
      critic: () => critic,
      revalidate,
      emit: (e) => emitted.push(e),
      phase: 'branch_validation',
      timeoutMs: 1000,
    });

    expect(outcome.result.valid).toBe(true);
    expect(outcome.repairedSceneIds).toEqual(['s4']);
    expect(outcome.advisorySceneIds).toEqual([]);
    expect(outcome.attemptedSceneIds).toEqual(['s4']);
    // The regen merged the textVariants into the in-memory scene contents.
    expect(contents[0].beats[0].textVariants).toBeDefined();
    expect(contents[0].beats[0].textVariants?.[0]?.callbackHookId).toBe('flag:took_bridge');
    expect(contents[0].beats[0].callbackHookIds).toContain('flag:took_bridge');
    // Exactly ONE regen pass, with the residue requirement injected and the
    // earliest beat flagged.
    expect(critic.execute).toHaveBeenCalledTimes(1);
    const input = critic.execute.mock.calls[0][0];
    expect(input.directorNotes).toContain('RECONVERGENCE RESIDUE REPAIR for scene s4');
    expect(input.directorNotes).toContain('`took_bridge`');
    expect(input.flaggedBeatIds).toEqual(['s4-b1']);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(emitted.some((e) => e.message.includes('[advisory]'))).toBe(false);
  });

  it('degrades to an advisory warning (never throws) when the regen still lacks residue', async () => {
    const critic = criticReturning([]); // critic produced nothing usable
    const emitted: Emitted[] = [];
    const stillFailing = failingResult();
    const outcome = await runReconvergenceResidueGate({
      result: failingResult(),
      episodeScenes,
      sceneContents: sceneContents(),
      critic: () => critic,
      revalidate: () => stillFailing,
      emit: (e) => emitted.push(e),
      phase: 'branch_validation',
      timeoutMs: 1000,
    });

    // The story ships: residue errors became warnings and the result is valid.
    expect(outcome.result.valid).toBe(true);
    expect(outcome.result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(outcome.advisorySceneIds).toEqual(['s4']);
    expect(outcome.repairedSceneIds).toEqual([]);
    const advisory = emitted.filter((e) => e.message.includes('[advisory]'));
    expect(advisory).toHaveLength(1);
    expect(advisory[0].type).toBe('warning');
    expect(advisory[0].message).toContain('Reconverged branch target s4');
  });

  it('keeps non-residue errors blocking after the degrade', async () => {
    const withOtherError = failingResult([
      { type: 'invalid_branch_target', severity: 'error', message: 'Choice c9 routes to missing scene s9.' },
    ]);
    const outcome = await runReconvergenceResidueGate({
      result: withOtherError,
      episodeScenes,
      sceneContents: sceneContents(),
      critic: () => criticReturning([]),
      revalidate: () => withOtherError,
      emit: () => {},
      phase: 'branch_validation',
      timeoutMs: 1000,
    });
    // Residue degraded, but the structural error still fails the result — the
    // pipeline's existing throw handles it.
    expect(outcome.result.valid).toBe(false);
    expect(outcome.result.issues.find((i) => i.type === 'missing_branch_residue')?.severity).toBe('warning');
    expect(outcome.result.issues.find((i) => i.type === 'invalid_branch_target')?.severity).toBe('error');
  });

  it('skips regen and goes straight to degrade when no repair capability is provided', async () => {
    const emitted: Emitted[] = [];
    const outcome = await runReconvergenceResidueGate({
      result: failingResult(),
      episodeScenes,
      emit: (e) => emitted.push(e),
      phase: 'branch_validation',
    });
    expect(outcome.result.valid).toBe(true);
    expect(outcome.attemptedSceneIds).toEqual([]);
    expect(emitted.some((e) => e.message.includes('[advisory]'))).toBe(true);
  });

  it('treats a thrown critic error as a failed repair and still degrades', async () => {
    const emitted: Emitted[] = [];
    const stillFailing = failingResult();
    const outcome = await runReconvergenceResidueGate({
      result: failingResult(),
      episodeScenes,
      sceneContents: sceneContents(),
      critic: () => ({ execute: vi.fn().mockRejectedValue(new Error('LLM exploded')) }),
      revalidate: () => stillFailing,
      emit: (e) => emitted.push(e),
      phase: 'branch_validation',
      timeoutMs: 1000,
    });
    expect(outcome.result.valid).toBe(true);
    expect(emitted.some((e) => e.message.includes('LLM exploded'))).toBe(true);
    expect(emitted.some((e) => e.message.includes('[advisory]'))).toBe(true);
  });

  it('returns the original passing result untouched when there is nothing to repair', async () => {
    const critic = criticReturning([]);
    const outcome = await runReconvergenceResidueGate({
      result: passingResult,
      episodeScenes,
      sceneContents: sceneContents(),
      critic: () => critic,
      revalidate: () => passingResult,
      emit: () => {},
      phase: 'branch_validation',
    });
    expect(outcome.result).toBe(passingResult);
    expect(critic.execute).not.toHaveBeenCalled();
    expect(outcome.attemptedSceneIds).toEqual([]);
  });

  it('uses the planning-time stamped requirement to enrich the director notes', async () => {
    const critic = criticReturning([{ id: 's4-b1', text: 'x', textVariants: [{}] }]);
    await runReconvergenceResidueGate({
      result: failingResult(),
      episodeScenes,
      blueprintScenes: [{
        id: 's4',
        residueRequirement: {
          sceneId: 's4',
          reconvergedFrom: ['s2', 's3'],
          expectedResidue: 'conditionalText',
          gatingFlags: ['planned_flag'],
          pathSummaries: [],
          acknowledgmentHint: 'The guard notices how you arrived',
        },
      }],
      sceneContents: sceneContents(),
      critic: () => critic,
      revalidate: () => passingResult,
      emit: () => {},
      phase: 'branch_validation',
      timeoutMs: 1000,
    });
    const notes = critic.execute.mock.calls[0][0].directorNotes as string;
    expect(notes).toContain('`planned_flag`');
    expect(notes).toContain('The guard notices how you arrived');
  });
});
