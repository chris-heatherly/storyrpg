import { describe, it, expect } from 'vitest';
import { filterRefsForProvider } from './referencePackBuilder';
import type { ReferenceImage } from '../services/imageGenerationService';

function ref(role: string, opts: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    data: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    role,
    ...opts,
  };
}

const composite = ref('composite-sheet', { characterName: 'Aoi', viewType: 'composite' });
const front = ref('character-reference', { characterName: 'Aoi', viewType: 'front' });
const face = ref('character-reference-face', { characterName: 'Aoi' });
const styleAnchor = ref('style-anchor');
const location = ref('location-master-shot');

describe('filterRefsForProvider', () => {
  describe('nano-banana / atlas-cloud', () => {
    it('strips composite-sheet from the regular ref pack for nano-banana', () => {
      const out = filterRefsForProvider([composite, front, face], 'nano-banana');
      expect(out.refs).not.toContain(composite);
      expect(out.refs).toContain(front);
      expect(out.refs).toContain(face);
    });

    it('extracts the composite so callers can install it as the style anchor', () => {
      const out = filterRefsForProvider([composite, front], 'nano-banana');
      expect(out.extractedComposite).toBe(composite);
    });

    it('behaves identically for atlas-cloud', () => {
      const out = filterRefsForProvider([composite, front, location], 'atlas-cloud');
      expect(out.refs).toEqual([front, location]);
      expect(out.extractedComposite).toBe(composite);
    });

    it('returns an unchanged pack when no composite is present', () => {
      const out = filterRefsForProvider([front, face], 'nano-banana');
      expect(out.refs).toEqual([front, face]);
      expect(out.extractedComposite).toBeUndefined();
    });
  });

  describe('stable-diffusion', () => {
    it('strips composite-sheet and exposes it via extractedComposite', () => {
      const out = filterRefsForProvider([composite, face, front], 'stable-diffusion');
      expect(out.refs).not.toContain(composite);
      expect(out.refs).toContain(face);
      expect(out.refs).toContain(front);
      expect(out.extractedComposite).toBe(composite);
    });
  });

  describe('midapi / useapi (Midjourney)', () => {
    it('keeps ONLY composite-sheet and style-anchor refs for midapi', () => {
      const out = filterRefsForProvider(
        [composite, front, face, styleAnchor, location],
        'midapi',
      );
      expect(out.refs).toContain(composite);
      expect(out.refs).toContain(styleAnchor);
      expect(out.refs).not.toContain(front);
      expect(out.refs).not.toContain(face);
      expect(out.refs).not.toContain(location);
      // Composite stays inside `refs` for MJ — it will be consumed as --cref,
      // so no separate extractedComposite needs to be emitted.
      expect(out.extractedComposite).toBeUndefined();
    });

    it('behaves identically for the legacy useapi slug', () => {
      const out = filterRefsForProvider([composite, front, styleAnchor], 'useapi');
      expect(out.refs).toEqual([composite, styleAnchor]);
    });

    it('drops everything when only individual views are present', () => {
      const out = filterRefsForProvider([front, face], 'midapi');
      expect(out.refs).toEqual([]);
    });
  });

  describe('providers that do not consume refs', () => {
    it('returns empty refs for dall-e', () => {
      const out = filterRefsForProvider([composite, front, face], 'dall-e');
      expect(out.refs).toEqual([]);
    });

    it('returns empty refs for placeholder', () => {
      const out = filterRefsForProvider([composite, front], 'placeholder');
      expect(out.refs).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles undefined and empty input safely', () => {
      expect(filterRefsForProvider(undefined, 'nano-banana').refs).toEqual([]);
      expect(filterRefsForProvider([], 'nano-banana').refs).toEqual([]);
    });

    it('does not mutate the input array', () => {
      const input = [composite, front, face];
      const snapshot = [...input];
      filterRefsForProvider(input, 'nano-banana');
      expect(input).toEqual(snapshot);
    });

    it('returns refs unchanged for unknown providers (forward compat)', () => {
      // Cast through unknown to simulate a future provider slug.
      const out = filterRefsForProvider([composite, front], 'future-provider' as unknown as 'nano-banana');
      expect(out.refs).toEqual([composite, front]);
    });
  });
});
