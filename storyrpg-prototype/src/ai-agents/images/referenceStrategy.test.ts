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
    it('uses the same front-only identity strategy as gpt-image-2', () => {
      const s = getReferenceStrategy('nano-banana');
      expect(s.generateViews).toEqual(['front']);
      expect(s.generateComposite).toBe(false);
      expect(s.generateExpressions).toBe(false);
      expect(s.generateBodyVocabulary).toBe(false);
      expect(s.generateSilhouette).toBe(false);
      expect(s.sceneRefs).toBe('front+face');
      expect(s.maxSceneRefs).toBeLessThanOrEqual(2);
    });
  });

  describe('atlas-cloud', () => {
    it('uses front-only refs so Atlas-hosted GPT Image 2 avoids turnarounds', () => {
      const s = getReferenceStrategy('atlas-cloud');
      expect(s.generateViews).toEqual(['front']);
      expect(s.generateComposite).toBe(false);
      expect(s.sceneRefs).toBe('front+face');
      expect(s.maxSceneRefs).toBeLessThanOrEqual(2);
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
