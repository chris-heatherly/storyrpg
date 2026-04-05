import { describe, expect, it } from 'vitest';
import { assertValidWorkerPayload } from './workerPayload';

describe('assertValidWorkerPayload', () => {
  it('accepts a valid generation payload', () => {
    const payload = {
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      generationInput: {
        brief: {
          story: { title: 'Test' },
        },
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('rejects a malformed analysis payload', () => {
    const payload = {
      mode: 'analysis',
      config: {},
      resultPath: '/tmp/result.json',
      analysisInput: {
        title: 'Missing source text',
      },
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/sourceText and title/i);
  });
});
