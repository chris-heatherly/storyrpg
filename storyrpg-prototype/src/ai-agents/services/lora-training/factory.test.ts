import { describe, expect, it } from 'vitest';

import { createLoraTrainerAdapter } from './factory';
import { KohyaAdapter } from './KohyaAdapter';

describe('createLoraTrainerAdapter', () => {
  it('returns a KohyaAdapter for backend=kohya', () => {
    const adapter = createLoraTrainerAdapter({
      backend: 'kohya',
      kohya: { proxyBaseUrl: 'http://localhost:3001/lora-training' },
    });
    expect(adapter).toBeInstanceOf(KohyaAdapter);
    expect(adapter.id).toBe('kohya');
  });

  it('throws a clear error for disabled', () => {
    expect(() => createLoraTrainerAdapter({ backend: 'disabled' })).toThrowError(
      /disabled/i,
    );
  });

  it('throws a "not implemented" error for known-but-unsupported backends', () => {
    for (const backend of ['a1111-dreambooth', 'comfy-training', 'replicate', 'fal'] as const) {
      expect(() => createLoraTrainerAdapter({ backend })).toThrowError(
        new RegExp(`${backend}.*not implemented`),
      );
    }
  });

  it('throws for unknown backends', () => {
    expect(() =>
      createLoraTrainerAdapter({ backend: 'mystery' as unknown as 'kohya' }),
    ).toThrowError(/Unknown LoRA trainer backend/);
  });

  it('defaults to disabled when no options are provided', () => {
    expect(() => createLoraTrainerAdapter(undefined)).toThrowError(/disabled/i);
  });
});
