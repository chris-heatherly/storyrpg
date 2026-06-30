import { describe, expect, it } from 'vitest';
import { runEpisodeLoopOnGraph, runFoundationOnGraph } from './episodeRunGraph';
import type { ArtifactStoreIO } from './checkpointArtifactStore';
import { loadCompletedEpisode } from './episodeCheckpoints';
import type { Episode } from '../../types';

function makeIO(): ArtifactStoreIO & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    async save(name, data) {
      files.set(name, JSON.parse(JSON.stringify(data)));
    },
    load<T>(name: string): T | null {
      return files.has(name) ? (files.get(name) as T) : null;
    },
  };
}

const episode = (n: number): Episode =>
  ({ id: `ep-${n}`, number: n, title: `Episode ${n}`, scenes: [{ id: `s${n}-1`, beats: [] }] }) as unknown as Episode;

describe('runFoundationOnGraph', () => {
  function makeHooks(order: string[]) {
    return {
      buildWorldBible: async () => {
        order.push('build:world');
        return { kind: 'world' };
      },
      buildCharacterBible: async (world: { kind: string }) => {
        order.push(`build:characters(from ${world.kind})`);
        return { kind: 'characters' };
      },
      onWorldBuilt: () => order.push('checkpoint:world'),
      onCharactersBuilt: () => order.push('checkpoint:characters'),
      onWorldResumed: () => order.push('resumed:world'),
      onCharactersResumed: () => order.push('resumed:characters'),
      afterWorld: () => order.push('progress:world'),
      afterCharacters: () => order.push('progress:characters'),
      emitDebug: () => {},
    };
  }

  it('fresh run: builds both, hooks fire in the legacy order', async () => {
    const order: string[] = [];
    const result = await runFoundationOnGraph<{ kind: string }, { kind: string }>({
      resumedWorldBible: undefined,
      resumedCharacterBible: undefined,
      ...makeHooks(order),
    });
    expect(result.worldBible).toEqual({ kind: 'world' });
    expect(result.characterBible).toEqual({ kind: 'characters' });
    expect(order).toEqual([
      'build:world',
      'checkpoint:world',
      'progress:world',
      'build:characters(from world)',
      'checkpoint:characters',
      'progress:characters',
    ]);
  });

  it('resume payload skips its producer step (resume-by-construction)', async () => {
    const order: string[] = [];
    const result = await runFoundationOnGraph<{ kind: string }, { kind: string }>({
      resumedWorldBible: { kind: 'world-from-checkpoint' },
      resumedCharacterBible: undefined,
      ...makeHooks(order),
    });
    expect(result.worldBible).toEqual({ kind: 'world-from-checkpoint' });
    expect(order).toEqual([
      'resumed:world',
      'progress:world',
      'build:characters(from world-from-checkpoint)',
      'checkpoint:characters',
      'progress:characters',
    ]);
  });

  it('both resumed: no builds, both resume hooks fire', async () => {
    const order: string[] = [];
    await runFoundationOnGraph<{ kind: string }, { kind: string }>({
      resumedWorldBible: { kind: 'w' },
      resumedCharacterBible: { kind: 'c' },
      ...makeHooks(order),
    });
    expect(order).toEqual(['resumed:world', 'progress:world', 'resumed:characters', 'progress:characters']);
  });

  it('a failed build rethrows instead of returning a partial foundation', async () => {
    const order: string[] = [];
    const hooks = makeHooks(order);
    await expect(
      runFoundationOnGraph<{ kind: string }, { kind: string }>({
        resumedWorldBible: undefined,
        resumedCharacterBible: undefined,
        ...hooks,
        buildWorldBible: async () => {
          throw new Error('world model unavailable');
        },
      }),
    ).rejects.toThrow('world model unavailable');
  });
});

describe('runEpisodeLoopOnGraph', () => {
  it('strict mode: a failure blocks downstream and rethrows the ORIGINAL error', async () => {
    const io = makeIO();
    const processed: number[] = [];
    const original = new Error('episode 2 exploded');
    await expect(
      runEpisodeLoopOnGraph({
        specs: [1, 2, 3].map((episodeNumber) => ({ episodeNumber })),
        strict: true,
        io,
        processEpisode: async (spec) => {
          processed.push(spec.episodeNumber);
          if (spec.episodeNumber === 2) throw original;
          return episode(spec.episodeNumber);
        },
        emitDebug: () => {},
      }),
    ).rejects.toBe(original);
    // Episode 3 is canon-downstream of 2 in strict mode: blocked, never processed.
    expect(processed).toEqual([1, 2]);
    expect(loadCompletedEpisode(1, io.load)).not.toBeNull();
    expect(loadCompletedEpisode(3, io.load)).toBeNull();
  });

  it('advisory mode: a failure is journaled and the rest continue', async () => {
    const io = makeIO();
    const processed: number[] = [];
    const journal: string[] = [];
    await runEpisodeLoopOnGraph({
      specs: [1, 2, 3].map((episodeNumber) => ({ episodeNumber })),
      strict: false,
      io,
      processEpisode: async (spec) => {
        processed.push(spec.episodeNumber);
        return spec.episodeNumber === 2 ? null : episode(spec.episodeNumber);
      },
      emitDebug: (m) => journal.push(m),
    });
    expect(processed).toEqual([1, 2, 3]);
    expect(loadCompletedEpisode(1, io.load)).not.toBeNull();
    expect(loadCompletedEpisode(2, io.load)).toBeNull();
    expect(loadCompletedEpisode(3, io.load)).not.toBeNull();
    expect(journal.some((m) => m.includes('step_failed: episode-2'))).toBe(true);
    expect(journal.some((m) => m.includes('1 failed step(s)'))).toBe(true);
  });

  it('already-watermarked episodes skip without re-processing', async () => {
    const io = makeIO();
    const processed: number[] = [];
    const run = () =>
      runEpisodeLoopOnGraph({
        specs: [1, 2].map((episodeNumber) => ({ episodeNumber })),
        strict: true,
        io,
        processEpisode: async (spec) => {
          processed.push(spec.episodeNumber);
          return episode(spec.episodeNumber);
        },
        emitDebug: () => {},
      });
    await run();
    await run(); // second pass: both artifacts exist → both steps skip
    expect(processed).toEqual([1, 2]);
  });
});
