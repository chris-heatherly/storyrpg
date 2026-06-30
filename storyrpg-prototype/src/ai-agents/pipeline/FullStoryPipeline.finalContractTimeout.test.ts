import { describe, expect, it, vi } from 'vitest';
import { TimeoutError } from '../utils/withTimeout';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(async () => {
    throw new Error('not found');
  }),
  deleteAsync: vi.fn(),
}));

describe('FullStoryPipeline episode incremental contract timeout', () => {
  it('fails a stuck episode-local final-contract repair with a resumable timeout', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype) as any;
    pipeline.emit = vi.fn();
    pipeline.enforceFinalStoryContract = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 50)));

    await expect(
      pipeline.enforceEpisodeIncrementalContractWithTimeout(
        2,
        {
          story: {},
          brief: {},
          phase: 'incremental_contract_ep_2',
        },
        10,
      ),
    ).rejects.toBeInstanceOf(TimeoutError);

    expect(pipeline.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      phase: 'incremental_contract_ep_2',
      message: expect.stringContaining('failing the job so it can be resumed safely'),
    }));
  });
});
