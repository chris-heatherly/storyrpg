import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/pipelineOutputWriter', () => ({
  savePipelineOutputs: vi.fn(),
}));

import { savePipelineOutputs } from '../../utils/pipelineOutputWriter';
import { SavingPhase } from './SavingPhase';
import type { PipelineContext } from './index';

function makeContext(): {
  context: PipelineContext;
  events: Array<Record<string, unknown>>;
  checkpoints: Array<{ name: string; data: unknown }>;
} {
  const events: Array<Record<string, unknown>> = [];
  const checkpoints: Array<{ name: string; data: unknown }> = [];
  const context: PipelineContext = {
    config: {} as any,
    emit: (event) => events.push({ ...event }),
    addCheckpoint: (name, data) => checkpoints.push({ name, data }),
  };
  return { context, events, checkpoints };
}

const inputOutputs = {
  brief: { story: { title: 'Story' }, episode: {}, protagonist: {} },
} as any;

describe('SavingPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a phase_complete event with the manifest file count on success', async () => {
    (savePipelineOutputs as any).mockResolvedValue({
      files: [{ name: 'brief' }, { name: 'world' }],
    });

    const phase = new SavingPhase();
    const { context, events } = makeContext();

    const result = await phase.run(
      {
        outputDirectory: '/tmp/story-out/',
        outputs: inputOutputs,
        durationMs: 1234,
      },
      context
    );

    expect(result.manifest?.files).toHaveLength(2);
    expect(savePipelineOutputs).toHaveBeenCalledWith('/tmp/story-out/', inputOutputs, 1234);

    const complete = events.find((e) => e.type === 'phase_complete');
    expect(complete?.phase).toBe('saving');
    expect(String(complete?.message)).toContain('/tmp/story-out/');
  });

  it('emits a warning and returns null manifest when savePipelineOutputs throws', async () => {
    (savePipelineOutputs as any).mockRejectedValue(new Error('disk full'));

    const phase = new SavingPhase();
    const { context, events } = makeContext();

    const result = await phase.run(
      { outputDirectory: '/tmp/out/', outputs: inputOutputs },
      context
    );

    expect(result.manifest).toBeNull();
    expect(result.error?.message).toBe('disk full');
    const warning = events.find((e) => e.type === 'warning');
    expect(warning?.phase).toBe('saving');
    expect(String(warning?.message)).toContain('disk full');
  });

  it('times out when savePipelineOutputs never settles', async () => {
    (savePipelineOutputs as any).mockImplementation(() => new Promise(() => {}));

    const phase = new SavingPhase();
    const { context, events } = makeContext();

    const result = await phase.run(
      { outputDirectory: '/tmp/out/', outputs: inputOutputs, timeoutMs: 15 },
      context
    );

    expect(result.manifest).toBeNull();
    expect(result.error?.message).toMatch(/timed out/i);
    expect(events.some((e) => e.type === 'warning')).toBe(true);
  });
});
