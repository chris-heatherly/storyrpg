import { describe, expect, it, vi } from 'vitest';
import { PipelineEventBus, PipelineEvent } from './events';

describe('PipelineEventBus', () => {
  it('fans out events to subscribers in subscription order', () => {
    const bus = new PipelineEventBus();
    const calls: string[] = [];
    bus.subscribe((e) => calls.push(`A:${e.type}`));
    bus.subscribe((e) => calls.push(`B:${e.type}`));

    bus.emit({ type: 'phase_start', message: 'go' });

    expect(calls).toEqual(['A:phase_start', 'B:phase_start']);
  });

  it('stamps timestamp when caller omits one', () => {
    const bus = new PipelineEventBus();
    const received: PipelineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ type: 'debug', message: 'hi' });

    expect(received).toHaveLength(1);
    expect(received[0].timestamp).toBeInstanceOf(Date);
  });

  it('preserves provided timestamp', () => {
    const bus = new PipelineEventBus();
    const provided = new Date('2025-01-01T00:00:00Z');
    const received: PipelineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ type: 'debug', message: 'hi', timestamp: provided });

    expect(received[0].timestamp).toBe(provided);
  });

  it('isolates subscriber errors from each other', () => {
    const bus = new PipelineEventBus();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good: PipelineEvent[] = [];

    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => good.push(e));

    bus.emit({ type: 'warning', message: 'mixed' });

    expect(good).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[PipelineEventBus] handler threw',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('unsubscribe removes a handler', () => {
    const bus = new PipelineEventBus();
    const calls: number[] = [];
    const off = bus.subscribe(() => calls.push(1));
    bus.subscribe(() => calls.push(2));

    off();
    bus.emit({ type: 'debug', message: 'x' });

    expect(calls).toEqual([2]);
    expect(bus.size).toBe(1);
  });

  it('unsubscribeAll clears every handler', () => {
    const bus = new PipelineEventBus();
    bus.subscribe(() => {});
    bus.subscribe(() => {});
    expect(bus.size).toBe(2);

    bus.unsubscribeAll();

    expect(bus.size).toBe(0);
  });
});
