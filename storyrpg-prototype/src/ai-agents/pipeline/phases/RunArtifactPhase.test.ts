import { describe, expect, it, vi } from 'vitest';
import { RunArtifactPhase, deriveRunId } from './RunArtifactPhase';
import type { Episode } from '../../../types';

function makeStore() {
  const files = new Map<string, unknown>();
  return {
    files,
    save: async (outputDirectory: string, name: string, data: unknown) => {
      files.set(`${outputDirectory}/${name}`, JSON.parse(JSON.stringify(data)));
    },
    load: <T,>(outputDirectory: string, name: string): T | null => {
      return files.has(`${outputDirectory}/${name}`)
        ? files.get(`${outputDirectory}/${name}`) as T
        : null;
    },
  };
}

function makeContext() {
  return {
    config: {} as never,
    emit: vi.fn(),
    addCheckpoint: vi.fn(),
  };
}

describe('RunArtifactPhase', () => {
  it('creates run artifact runtime from a fresh output directory', async () => {
    const store = makeStore();
    const phase = new RunArtifactPhase({
      createOutputDirectory: vi.fn(async () => 'generated-stories/my-run'),
      ensureDirectory: vi.fn(),
      save: store.save,
      load: store.load,
    });
    const context = makeContext();

    const runtime = await phase.run({ storyTitle: 'My Story' }, context);

    expect(runtime.outputDirectory).toBe('generated-stories/my-run');
    expect(runtime.storyId).toBe('my-story');
    expect(runtime.runId).toBe('my-run');
    expect(context.addCheckpoint).toHaveBeenCalledWith('Output Directory', { outputDirectory: 'generated-stories/my-run' }, false);
  });

  it('writes legacy completion and shadow artifacts through the runtime', async () => {
    const store = makeStore();
    const phase = new RunArtifactPhase({
      createOutputDirectory: vi.fn(async () => 'generated-stories/run'),
      ensureDirectory: vi.fn(),
      save: store.save,
      load: store.load,
    });
    const runtime = await phase.run({ storyTitle: 'Story' }, makeContext());
    const episode = {
      number: 1,
      title: 'One',
      scenes: [{ id: 's1', name: 'Opening', beats: [{ id: 'b1', text: 'Start' }] }],
    } as unknown as Episode;

    const watermark = await runtime.writeEpisodeCompletion({
      episode,
      episodeNumber: 1,
      title: 'One',
      lock: {
        runtimeContractPassed: true,
        canonSealed: true,
        incrementalContractArtifact: 'episode-1-incremental-contract.json',
        seasonCanonArtifact: 'season-canon.json',
      },
    });

    expect(watermark.lock).toMatchObject({
      runtimeContractPassed: true,
      canonSealed: true,
      incrementalContractArtifact: 'episode-1-incremental-contract.json',
      seasonCanonArtifact: 'season-canon.json',
    });
    expect(store.files.has('generated-stories/run/checkpoints/episode-1-complete.json')).toBe(true);
    expect(store.files.has('generated-stories/run/artifacts/episodes/001/runtime-episode.rev1.json')).toBe(true);
    expect(store.files.has('generated-stories/run/artifacts/episodes/001/context-out.rev1.json')).toBe(true);
  });

  it('derives a stable run id from absolute and relative paths', () => {
    expect(deriveRunId('/tmp/generated-stories/run-a/', 'fallback')).toBe('run-a');
    expect(deriveRunId('generated-stories/run-b', 'fallback')).toBe('run-b');
    expect(deriveRunId('', 'fallback')).toBe('fallback');
  });
});
