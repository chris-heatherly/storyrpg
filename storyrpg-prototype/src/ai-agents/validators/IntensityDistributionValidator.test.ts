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

  // --- default (strict OFF): severities are byte-for-byte the historical ones ---

  it('default: all-dominant is a warning, never an error', () => {
    const input = {
      sceneContents: [{ sceneId: 's1', beats: [beat('dominant'), beat('dominant'), beat('dominant')] }],
    };
    const r = new IntensityDistributionValidator().validate(input);
    const allDominant = r.issues.find((i) => /all-dominant/.test(i.message))!;
    expect(allDominant.severity).toBe('warning');
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
    // strict:false is identical to omitting options.
    const explicitOff = new IntensityDistributionValidator().validate(input, { strict: false });
    expect(explicitOff).toEqual(r);
  });

  it('default: no-dominant stays a warning even with other scenes present', () => {
    const r = new IntensityDistributionValidator().validate({
      sceneContents: [{ sceneId: 's1', beats: [beat('supporting'), beat('supporting'), beat('rest')] }],
    });
    const noDominant = r.issues.find((i) => /no dominant beat/.test(i.message))!;
    expect(noDominant.severity).toBe('warning');
  });

  // --- strict ON: only the genuine all-dominant violation escalates to error ---

  it('strict: all-dominant escalates to error (metrics/score/valid unchanged from default)', () => {
    const input = {
      sceneContents: [{ sceneId: 's1', beats: [beat('dominant'), beat('dominant'), beat('dominant')] }],
    };
    const off = new IntensityDistributionValidator().validate(input);
    const on = new IntensityDistributionValidator().validate(input, { strict: true });
    const allDominant = on.issues.find((i) => /all-dominant/.test(i.message))!;
    expect(allDominant.severity).toBe('error');
    // Only the severity flips; everything else is identical.
    expect(on.metrics).toEqual(off.metrics);
    expect(on.score).toBe(off.score);
    expect(on.valid).toBe(off.valid);
    expect(on.issues.length).toBe(off.issues.length);
  });

  it('strict: no-dominant and missing-rest are NOT escalated', () => {
    const r = new IntensityDistributionValidator().validate(
      {
        sceneContents: [
          // no dominant + long enough to also trip missing-rest
          { sceneId: 's1', beats: [beat('supporting'), beat('supporting'), beat('supporting'), beat('supporting')] },
        ],
      },
      { strict: true },
    );
    const noDominant = r.issues.find((i) => /no dominant beat/.test(i.message))!;
    expect(noDominant.severity).toBe('warning');
    const missingRest = r.issues.find((i) => /no rest beat/.test(i.message))!;
    expect(missingRest.severity).toBe('info');
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('strict: a well-modulated scene still passes (no false escalation)', () => {
    const r = new IntensityDistributionValidator().validate(
      { sceneContents: [{ sceneId: 's1', beats: [beat('supporting'), beat('dominant'), beat('rest'), beat('supporting')] }] },
      { strict: true },
    );
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });
});
