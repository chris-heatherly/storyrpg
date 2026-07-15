import { describe, expect, it } from 'vitest';
import { flagUnsafeReaderDescription } from './unsafeReaderText';

describe('flagUnsafeReaderDescription (one ruler for description safety)', () => {
  it('flags the treatment-synopsis paste that survived three runs', () => {
    // isPlanningRegisterText alone returned FALSE for this sentence, so the
    // producer sanitation waved it through while the final validator flagged
    // it — the detect/sanitize/repair stages were measuring with different
    // rulers.
    const label = flagUnsafeReaderDescription(
      'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger, who walks her to her threshold and vanishes.',
    );
    expect(label).toBeTruthy();
  });

  it('passes clean second-person playable description text', () => {
    expect(flagUnsafeReaderDescription(
      'Fog pools between the chestnut trees as you cut through the park, footsteps somewhere behind you refusing to fade.',
    )).toBeUndefined();
    expect(flagUnsafeReaderDescription('')).toBeUndefined();
  });
});
