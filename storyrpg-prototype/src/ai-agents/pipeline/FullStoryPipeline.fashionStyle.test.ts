import { describe, expect, it } from 'vitest';

import { buildFashionPrimaryClothing, buildFashionStyleSummary } from '../images/characterFashionStyle';
import { computeCharacterIdentityFingerprint } from '../agents/image-team/ImageAgentTeam';

const fashionStyle = {
  styleSummary: 'Layered streetwear with ritual embroidery.',
  styleTags: ['ritual streetwear'],
  signatureGarments: ['oversized embroidered jacket', 'wrapped boots'],
  materials: ['denim', 'linen tape'],
  colorPalette: ['indigo', 'bone white'],
  accessories: ['threaded charm bracelet'],
};

describe('FullStoryPipeline character fashion style image handoff', () => {
  it('prefers structured fashion style when extracting clothing for reference sheets', () => {
    const primary = buildFashionPrimaryClothing({
      typicalAttire: 'short utility cape',
      fashionStyle,
    });

    expect(primary).toContain('short utility cape');
    expect(primary).toContain('oversized embroidered jacket');
    expect(primary).toContain('materials: denim, linen tape');
    expect(fashionStyle.accessories).toEqual(['threaded charm bracelet']);
    expect(fashionStyle.colorPalette).toEqual(['indigo', 'bone white']);
  });

  it('includes fashion style in scene-facing character descriptions and canonical attire', () => {
    const fashionSummary = buildFashionStyleSummary(fashionStyle)!;
    const defaultAttire = ['short utility cape', fashionSummary].filter(Boolean).join('; ');

    expect(`Fashion style: ${fashionSummary}`).toContain('Fashion style: Layered streetwear');
    expect(fashionSummary).toContain('signature garments: oversized embroidered jacket');
    expect(defaultAttire).toContain('short utility cape');
    expect(defaultAttire).toContain('ritual streetwear');
  });

  it('changes the character identity fingerprint when fashion style changes', () => {
    const base = {
      name: 'Kira',
      role: 'ally',
      physicalDescription: 'A quick-moving courier.',
      distinctiveFeatures: ['silver eyebrow scar'],
      typicalAttire: 'short utility cape',
    };

    const withoutFashion = computeCharacterIdentityFingerprint(base);
    const withFashion = computeCharacterIdentityFingerprint({ ...base, fashionStyle });
    const withChangedFashion = computeCharacterIdentityFingerprint({
      ...base,
      fashionStyle: { ...fashionStyle, colorPalette: ['crimson'] },
    });

    expect(withFashion).not.toBe(withoutFashion);
    expect(withChangedFashion).not.toBe(withFashion);
  });
});
