import { describe, expect, it, vi } from 'vitest';
import { lockGeneratedEpisodeArtifact } from './episodeLocking';
import type { Episode } from '../../types';

function makeEpisode(): Episode {
  return {
    number: 2,
    title: 'Two',
    scenes: [{ id: 's2-1', name: 'Opening' }],
  } as unknown as Episode;
}

describe('lockGeneratedEpisodeArtifact', () => {
  it('validates runtime contract before canon sealing and writes the watermark last', async () => {
    const order: string[] = [];

    const lock = await lockGeneratedEpisodeArtifact({
      episodeNumber: 2,
      title: 'Two',
      episode: makeEpisode(),
      hasEpisodeBrief: true,
      writeWatermark: true,
      validateRuntimeContract: vi.fn(async () => { order.push('validate'); }),
      sealCanon: vi.fn(async () => {
        order.push('seal');
        return {
          canonSealed: true,
          seasonCanonArtifact: 'season-canon.json',
        };
      }),
      writeCompletion: vi.fn(async () => { order.push('write'); }),
    });

    expect(order).toEqual(['validate', 'seal', 'write']);
    expect(lock).toEqual({
      runtimeContractPassed: true,
      incrementalContractArtifact: 'episode-2-incremental-contract.json',
      canonSealed: true,
      seasonCanonArtifact: 'season-canon.json',
    });
  });

  it('does not seal canon when runtime contract validation fails', async () => {
    const sealCanon = vi.fn(async () => ({ canonSealed: true }));
    const writeCompletion = vi.fn(async () => undefined);

    await expect(lockGeneratedEpisodeArtifact({
      episodeNumber: 2,
      title: 'Two',
      episode: makeEpisode(),
      hasEpisodeBrief: true,
      writeWatermark: true,
      validateRuntimeContract: vi.fn(async () => { throw new Error('runtime failed'); }),
      sealCanon,
      writeCompletion,
    })).rejects.toThrow(/runtime failed/);

    expect(sealCanon).not.toHaveBeenCalled();
    expect(writeCompletion).not.toHaveBeenCalled();
  });

  it('fails closed when episode brief evidence is missing', async () => {
    await expect(lockGeneratedEpisodeArtifact({
      episodeNumber: 2,
      title: 'Two',
      episode: makeEpisode(),
      hasEpisodeBrief: false,
      writeWatermark: true,
      validateRuntimeContract: vi.fn(async () => undefined),
      sealCanon: vi.fn(async () => ({ canonSealed: true })),
      writeCompletion: vi.fn(async () => undefined),
    })).rejects.toThrow(/cannot be locked without an episode brief/);
  });

  it('can validate and seal without writing a legacy completion watermark', async () => {
    const writeCompletion = vi.fn(async () => undefined);

    const lock = await lockGeneratedEpisodeArtifact({
      episodeNumber: 3,
      title: 'Three',
      episode: makeEpisode(),
      hasEpisodeBrief: true,
      writeWatermark: false,
      validateRuntimeContract: vi.fn(async () => undefined),
      sealCanon: vi.fn(async () => ({ canonSealed: true })),
      writeCompletion,
    });

    expect(lock.runtimeContractPassed).toBe(true);
    expect(lock.canonSealed).toBe(true);
    expect(writeCompletion).not.toHaveBeenCalled();
  });
});
