import { describe, it, expect } from 'vitest';
import {
  getReferenceStrategy,
  providerBenefitsFromCharacterRefs,
} from './referenceStrategy';

describe('getReferenceStrategy', () => {
  describe('dall-e (gpt-image-2)', () => {
    it('generates ONLY the front view — no 3q, profile, composite, expressions, body, silhouette', () => {
      const s = getReferenceStrategy('dall-e');
      expect(s.generateViews).toEqual(['front']);
      expect(s.generateComposite).toBe(false);
      expect(s.generateExpressions).toBe(false);
      expect(s.generateBodyVocabulary).toBe(false);
      expect(s.generateSilhouette).toBe(false);
    });

    it('uses front+face scene refs with a tight cap', () => {
      const s = getReferenceStrategy('dall-e');
      expect(s.sceneRefs).toBe('front+face');
      // gpt-image-2 prefers 1-2 clean refs; strategy cap is tighter than
      // the provider capability's 16 on purpose.
      expect(s.maxSceneRefs).toBeLessThanOrEqual(2);
    });
  });

  describe('nano-banana', () => {
    it('keeps the full three-view pack + composite + expressions + silhouette', () => {
      const s = getReferenceStrategy('nano-banana');
      expect(s.generateViews).toEqual(['front', 'three-quarter', 'profile']);
      expect(s.generateComposite).toBe(true);
      expect(s.generateExpressions).toBe(true);
      expect(s.generateBodyVocabulary).toBe(true);
      expect(s.generateSilhouette).toBe(true);
      expect(s.sceneRefs).toBe('all-views');
    });
  });

  describe('atlas-cloud', () => {
    it('matches the Gemini-family behavior', () => {
      const s = getReferenceStrategy('atlas-cloud');
      expect(s.generateViews.length).toBe(3);
      expect(s.generateComposite).toBe(true);
      expect(s.sceneRefs).toBe('all-views');
    });
  });

  describe('midapi / useapi (Midjourney)', () => {
    it('generates composite for --cref; scene refs are composite-anchor shaped', () => {
      const mj = getReferenceStrategy('midapi');
      expect(mj.generateComposite).toBe(true);
      expect(mj.sceneRefs).toBe('composite-anchor');
      // MJ accepts only --cref and --sref (2 slots).
      expect(mj.maxSceneRefs).toBe(2);
    });

    it('useapi is aliased to the same row as midapi', () => {
      const mj = getReferenceStrategy('midapi');
      const ua = getReferenceStrategy('useapi');
      expect(ua).toEqual(mj);
    });
  });

  describe('placeholder', () => {
    it('generates nothing and requests no scene refs', () => {
      const s = getReferenceStrategy('placeholder');
      expect(s.generateViews).toEqual([]);
      expect(s.generateComposite).toBe(false);
      expect(s.generateExpressions).toBe(false);
      expect(s.sceneRefs).toBe('none');
      expect(s.maxSceneRefs).toBe(0);
    });
  });

  describe('unknown providers', () => {
    it('falls back to the conservative placeholder row', () => {
      // Cast through unknown to simulate a future provider slug.
      const s = getReferenceStrategy('future-provider' as unknown as 'dall-e');
      expect(s.generateViews).toEqual([]);
      expect(s.sceneRefs).toBe('none');
    });
  });
});

describe('providerBenefitsFromCharacterRefs', () => {
  it('returns true for providers that generate views OR composite', () => {
    expect(providerBenefitsFromCharacterRefs('nano-banana')).toBe(true);
    expect(providerBenefitsFromCharacterRefs('atlas-cloud')).toBe(true);
    expect(providerBenefitsFromCharacterRefs('midapi')).toBe(true);
    expect(providerBenefitsFromCharacterRefs('dall-e')).toBe(true);
  });

  it('returns false for placeholder', () => {
    expect(providerBenefitsFromCharacterRefs('placeholder')).toBe(false);
  });
});
