import { describe, expect, it, vi, afterEach } from 'vitest';
import { BranchManager, type BranchManagerInput } from './BranchManager';
import { AgentConfig } from '../config';

const config: AgentConfig = {
  provider: 'anthropic',
  model: 'test',
  apiKey: '',
  maxTokens: 1000,
  temperature: 0,
};

function makeInput(): BranchManagerInput {
  return {
    episodeId: 'ep1',
    episodeTitle: 'Episode 1',
    scenes: [
      { id: 's1', name: 'Open', purpose: 'branch', leadsTo: ['s2', 's3'] },
      { id: 's2', name: 'Left', purpose: 'branch', leadsTo: ['s4'] },
      { id: 's3', name: 'Right', purpose: 'branch', leadsTo: ['s4'] },
      { id: 's4', name: 'Merge', purpose: 'bottleneck', leadsTo: [] },
    ] as unknown as BranchManagerInput['scenes'],
    startingSceneId: 's1',
    bottleneckScenes: ['s4'],
    availableFlags: [],
    availableScores: [],
    availableTags: [],
    storyContext: { title: 'T', genre: 'g', tone: 't' },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('BranchManager (deterministic skeleton + annotation)', () => {
  it('builds paths and reconvergence deterministically and applies LLM annotations', async () => {
    const annotation = JSON.stringify({
      pathAnnotations: [
        { id: 'path-1', name: 'The Bold Route', description: 'd1', narrativeTheme: 'courage' },
        { id: 'path-2', name: 'The Cautious Route' }, // only name annotated
      ],
      reconvergenceAnnotations: [
        {
          sceneId: 's4',
          narrativeAcknowledgment: 'Both roads meet here.',
          stateReconciliation: [{ stateVariable: 'trust', howToHandle: 'average them' }],
        },
      ],
      recommendations: ['tighten s2'],
    });
    const spy = vi.spyOn(BranchManager.prototype as never as { callLLM: unknown }, 'callLLM').mockResolvedValue(annotation);

    const res = await new BranchManager(config).execute(makeInput());

    expect(spy).toHaveBeenCalledOnce();
    // Annotation call is schema-strict: a jsonSchema is threaded to callLLM.
    const opts = spy.mock.calls[0][2] as { jsonSchema?: { name: string; schema: unknown } } | undefined;
    expect(opts?.jsonSchema?.name).toBe('branch_annotations');
    expect(opts?.jsonSchema?.schema).toBeTypeOf('object');
    expect(res.success).toBe(true);
    const d = res.data!;
    expect(d.branchPaths.map((p) => p.sceneSequence)).toEqual([
      ['s1', 's2', 's4'],
      ['s1', 's3', 's4'],
    ]);
    expect(d.branchPaths[0].name).toBe('The Bold Route');
    expect(d.branchPaths[0].narrativeTheme).toBe('courage');
    expect(d.branchPaths[1].name).toBe('The Cautious Route');
    expect(d.branchPaths[1].description).toMatch(/\d+ scenes/); // deterministic fallback kept
    const reconv = d.reconvergencePoints.find((r) => r.sceneId === 's4')!;
    expect(reconv.incomingBranches.sort()).toEqual(['path-1', 'path-2']);
    expect(reconv.narrativeAcknowledgment).toBe('Both roads meet here.');
    expect(reconv.stateReconciliation[0]).toMatchObject({ stateVariable: 'trust', howToHandle: 'average them' });
    expect(d.recommendations).toEqual(['tighten s2']);
  });

  it('returns success with the deterministic skeleton when the annotation call fails (e.g. 429)', async () => {
    vi.spyOn(BranchManager.prototype as never as { callLLM: unknown }, 'callLLM').mockRejectedValue(new Error('429 insufficient_quota'));

    const res = await new BranchManager(config).execute(makeInput());

    expect(res.success).toBe(true); // never blocks
    expect(res.data!.branchPaths).toHaveLength(2); // structure intact
    expect(res.data!.reconvergencePoints[0].sceneId).toBe('s4');
    expect(res.data!.branchPaths[0].name).toContain('→'); // deterministic fallback label
  });

  it('returns success when the annotation JSON is malformed (parse failure is non-critical)', async () => {
    vi.spyOn(BranchManager.prototype as never as { callLLM: unknown }, 'callLLM').mockResolvedValue('not json at all {');

    const res = await new BranchManager(config).execute(makeInput());

    expect(res.success).toBe(true);
    expect(res.data!.branchPaths).toHaveLength(2);
  });

  it('ignores annotation entries for ids the LLM invented', async () => {
    const annotation = JSON.stringify({
      pathAnnotations: [{ id: 'path-999', name: 'Hallucinated' }],
    });
    vi.spyOn(BranchManager.prototype as never as { callLLM: unknown }, 'callLLM').mockResolvedValue(annotation);

    const res = await new BranchManager(config).execute(makeInput());

    expect(res.success).toBe(true);
    // No real path got the hallucinated name; deterministic labels stand.
    expect(res.data!.branchPaths.every((p) => p.name !== 'Hallucinated')).toBe(true);
  });

  it('skips the LLM call entirely for a linear episode', async () => {
    const spy = vi.spyOn(BranchManager.prototype as never as { callLLM: unknown }, 'callLLM').mockResolvedValue('{}');
    const linear = makeInput();
    linear.scenes = [
      { id: 's1', name: 'a', purpose: 'transition', leadsTo: ['s2'] },
      { id: 's2', name: 'b', purpose: 'transition', leadsTo: [] },
    ] as unknown as BranchManagerInput['scenes'];

    const res = await new BranchManager(config).execute(linear);

    expect(spy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data!.branchPaths).toHaveLength(1);
    expect(res.data!.reconvergencePoints).toHaveLength(0);
  });
});
