import { describe, expect, it } from 'vitest';
import {
  MemoryArtifactStore,
  RunGraphDefinitionError,
  runGraph,
  topologicalWaves,
  type StepDef,
} from './runGraph';

/** Step helper: run() records its execution and emits `${id}-out` artifacts. */
function makeStep(
  id: string,
  inputs: string[],
  outputs: string[],
  ran: string[],
  impl?: (inputs: Record<string, unknown>) => Record<string, unknown>,
): StepDef<void> {
  return {
    id,
    inputs,
    outputs,
    async run(_ctx, stepInputs) {
      ran.push(id);
      if (impl) return impl(stepInputs);
      return Object.fromEntries(outputs.map((o) => [o, `${o}-value`]));
    },
  };
}

describe('topologicalWaves', () => {
  it('schedules by data dependency into parallel waves', () => {
    const ran: string[] = [];
    const steps = [
      makeStep('world', [], ['world_bible'], ran),
      makeStep('characters', [], ['character_bible'], ran),
      makeStep('blueprint', ['world_bible', 'character_bible'], ['episode_blueprint'], ran),
      makeStep('scene-1', ['episode_blueprint'], ['scene:s1'], ran),
      makeStep('scene-2', ['episode_blueprint'], ['scene:s2'], ran),
      makeStep('assemble', ['scene:s1', 'scene:s2'], ['episode'], ran),
    ];
    expect(topologicalWaves(steps)).toEqual([
      ['world', 'characters'],
      ['blueprint'],
      ['scene-1', 'scene-2'],
      ['assemble'],
    ]);
  });

  it('throws on a dependency cycle', () => {
    const ran: string[] = [];
    const steps = [
      makeStep('a', ['b-out'], ['a-out'], ran),
      makeStep('b', ['a-out'], ['b-out'], ran),
    ];
    expect(() => topologicalWaves(steps)).toThrow(RunGraphDefinitionError);
  });

  it('throws on duplicate producers and duplicate step ids', () => {
    const ran: string[] = [];
    expect(() =>
      topologicalWaves([makeStep('a', [], ['x'], ran), makeStep('b', [], ['x'], ran)]),
    ).toThrow(/two producers/);
    expect(() =>
      topologicalWaves([makeStep('a', [], ['x'], ran), makeStep('a', [], ['y'], ran)]),
    ).toThrow(/Duplicate step id/);
  });
});

describe('runGraph', () => {
  it('runs all steps in dependency order and persists artifacts', async () => {
    const ran: string[] = [];
    const store = new MemoryArtifactStore();
    const result = await runGraph({
      steps: [
        makeStep('plan', [], ['plan'], ran),
        makeStep('write', ['plan'], ['draft'], ran),
        makeStep('review', ['draft'], ['review'], ran),
      ],
      store,
      ctx: undefined,
    });
    expect(result.ok).toBe(true);
    expect(ran).toEqual(['plan', 'write', 'review']);
    expect(await store.has('review')).toBe(true);
  });

  it('RESUME: skips steps whose outputs already exist (only missing work re-runs)', async () => {
    const ran: string[] = [];
    const store = new MemoryArtifactStore({ plan: 'p', draft: 'd' }); // first two steps' outputs exist
    const result = await runGraph({
      steps: [
        makeStep('plan', [], ['plan'], ran),
        makeStep('write', ['plan'], ['draft'], ran),
        makeStep('review', ['draft'], ['review'], ran),
      ],
      store,
      ctx: undefined,
    });
    expect(result.ok).toBe(true);
    expect(ran).toEqual(['review']); // resume-by-construction
    expect(result.results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'completed']);
  });

  it('SURGICAL REPAIR: invalidating an artifact re-runs its producer and all downstream, not siblings', async () => {
    const ran: string[] = [];
    const store = new MemoryArtifactStore({
      plan: 'p',
      'scene:s1': 'old-s1',
      'scene:s2': 'old-s2',
      episode: 'old-ep',
    });
    const result = await runGraph({
      steps: [
        makeStep('plan', [], ['plan'], ran),
        makeStep('scene-1', ['plan'], ['scene:s1'], ran),
        makeStep('scene-2', ['plan'], ['scene:s2'], ran),
        makeStep('assemble', ['scene:s1', 'scene:s2'], ['episode'], ran),
      ],
      store,
      ctx: undefined,
      invalidate: ['scene:s1'],
    });
    expect(result.ok).toBe(true);
    // s1's producer re-ran, assembly (downstream) re-ran; plan and s2 skipped.
    expect(ran.sort()).toEqual(['assemble', 'scene-1']);
    expect(await store.load('scene:s1')).toBe('scene:s1-value');
    expect(await store.load('scene:s2')).toBe('old-s2');
    expect(await store.load('episode')).toBe('episode-value');
  });

  it('FAILURE ISOLATION: a failed step blocks its downstream; independent branches complete', async () => {
    const ran: string[] = [];
    const failing: StepDef<void> = {
      id: 'scene-1',
      inputs: ['plan'],
      outputs: ['scene:s1'],
      async run() {
        throw new Error('LLM exploded');
      },
    };
    const result = await runGraph({
      steps: [
        makeStep('plan', [], ['plan'], ran),
        failing,
        makeStep('scene-2', ['plan'], ['scene:s2'], ran),
        makeStep('assemble', ['scene:s1', 'scene:s2'], ['episode'], ran),
        makeStep('images-s2', ['scene:s2'], ['img:s2'], ran), // independent of the failure
      ],
      store: new MemoryArtifactStore(),
      ctx: undefined,
    });
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.results.map((r) => [r.id, r]));
    expect(byId['scene-1'].status).toBe('failed');
    expect(byId['scene-1'].error).toContain('LLM exploded');
    expect(byId['assemble'].status).toBe('blocked');
    expect(byId['assemble'].blockedBy).toEqual(['scene-1']);
    expect(byId['scene-2'].status).toBe('completed');
    expect(byId['images-s2'].status).toBe('completed'); // independent branch survived
  });

  it('fails a step that omits a declared output, blocking downstream', async () => {
    const ran: string[] = [];
    const result = await runGraph({
      steps: [
        makeStep('a', [], ['x', 'y'], ran, () => ({ x: 1 })), // forgets y
        makeStep('b', ['y'], ['z'], ran),
      ],
      store: new MemoryArtifactStore(),
      ctx: undefined,
    });
    const byId = Object.fromEntries(result.results.map((r) => [r.id, r]));
    expect(byId['a'].status).toBe('failed');
    expect(byId['a'].error).toContain('did not return declared output "y"');
    expect(byId['b'].status).toBe('blocked');
  });

  it('fails fast when an EXTERNAL input is missing from the store', async () => {
    const ran: string[] = [];
    const result = await runGraph({
      steps: [makeStep('write', ['brief'], ['draft'], ran)], // nothing produces 'brief'
      store: new MemoryArtifactStore(),
      ctx: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('External input artifact "brief" is missing');
    expect(ran).toEqual([]);
  });

  it('passes external inputs through when present', async () => {
    const ran: string[] = [];
    const store = new MemoryArtifactStore({ brief: { title: 'Endsong' } });
    const result = await runGraph({
      steps: [
        makeStep('write', ['brief'], ['draft'], ran, (inputs) => ({
          draft: `draft-of-${(inputs.brief as { title: string }).title}`,
        })),
      ],
      store,
      ctx: undefined,
    });
    expect(result.ok).toBe(true);
    expect(await store.load('draft')).toBe('draft-of-Endsong');
  });

  it('CANCELLATION: stops scheduling and blocks downstream of the cancelled step', async () => {
    const ran: string[] = [];
    let cancelAfterFirst = false;
    const result = await runGraph({
      steps: [
        makeStep('a', [], ['x'], ran, () => {
          cancelAfterFirst = true;
          return { x: 1 };
        }),
        makeStep('b', ['x'], ['y'], ran),
        makeStep('c', ['y'], ['z'], ran),
      ],
      store: new MemoryArtifactStore(),
      ctx: undefined,
      shouldCancel: () => cancelAfterFirst,
    });
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.results.map((r) => [r.id, r]));
    expect(byId['a'].status).toBe('completed');
    expect(byId['b'].status).toBe('cancelled');
    expect(byId['c'].status).toBe('blocked');
  });

  it('bounds concurrency within a wave', async () => {
    let active = 0;
    let maxActive = 0;
    const steps: Array<StepDef<void>> = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      inputs: [],
      outputs: [`o${i}`],
      async run() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { [`o${i}`]: i };
      },
    }));
    const result = await runGraph({ steps, store: new MemoryArtifactStore(), ctx: undefined, concurrency: 2 });
    expect(result.ok).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('emits lifecycle events', async () => {
    const ran: string[] = [];
    const events: string[] = [];
    await runGraph({
      steps: [makeStep('a', [], ['x'], ran), makeStep('b', ['x'], ['y'], ran)],
      store: new MemoryArtifactStore({ x: 'pre' }),
      ctx: undefined,
      onEvent: (e) => events.push(`${e.type}${e.stepId ? `:${e.stepId}` : ''}`),
    });
    expect(events).toContain('step_skipped:a');
    expect(events).toContain('step_start:b');
    expect(events).toContain('step_complete:b');
  });
});
