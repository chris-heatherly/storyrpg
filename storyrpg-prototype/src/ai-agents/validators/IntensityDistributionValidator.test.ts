import { describe, expect, it } from 'vitest';
import { IntensityDistributionValidator } from './IntensityDistributionValidator';

const beat = (intensityTier?: 'dominant' | 'supporting' | 'rest') => ({ id: 'b', intensityTier });

describe('IntensityDistributionValidator', () => {
  it('flags a multi-beat scene with no dominant beat', () => {
    const r = new IntensityDistributionValidator().validate({
      sceneContents: [{ sceneId: 's1', beats: [beat('supporting'), beat('supporting'), beat('rest')] }],
    });
    expect(r.metrics.scenesWithoutDominant).toBe(1);
    expect(r.issues.some((i) => /no dominant beat/.test(i.message))).toBe(true);
  });

  it('flags an all-dominant scene (no modulation)', () => {
    const r = new IntensityDistributionValidator().validate({
      sceneContents: [{ sceneId: 's1', beats: [beat('dominant'), beat('dominant'), beat('dominant')] }],
    });
    expect(r.metrics.scenesAllDominant).toBe(1);
    expect(r.issues.some((i) => /all-dominant/.test(i.message))).toBe(true);
  });

  it('passes a well-modulated scene (dominant + supporting + rest)', () => {
    const r = new IntensityDistributionValidator().validate({
      sceneContents: [{ sceneId: 's1', beats: [beat('supporting'), beat('dominant'), beat('rest'), beat('supporting')] }],
    });
    expect(r.valid).toBe(true);
    expect(r.metrics.scenesWithoutDominant).toBe(0);
  });

  it('exempts encounter scenes and short scenes', () => {
    const r = new IntensityDistributionValidator().validate({
      sceneContents: [
        { sceneId: 'enc', isEncounter: true, beats: [beat(), beat(), beat(), beat()] },
        { sceneId: 'short', beats: [beat(), beat()] },
      ],
    });
    expect(r.metrics.scenesChecked).toBe(0);
  });
});
