import { describe, expect, it, vi } from 'vitest';

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

describe('FullStoryPipeline episode sealing boundary', () => {
  it('does not expose the removed episode-local final-contract repair pass', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const pipeline = Object.create(FullStoryPipeline.prototype) as any;

    expect(pipeline.enforceEpisodeIncrementalContractWithTimeout).toBeUndefined();
  });
});
