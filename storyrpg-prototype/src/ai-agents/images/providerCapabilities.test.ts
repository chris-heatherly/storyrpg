import { describe, expect, it, afterEach } from 'vitest';

import type { ImageProvider } from '../config';
import {
  getProviderCapabilities,
  overrideProviderCapabilities,
  providerConsumesRefs,
  providerSupportsLoraTraining,
  resetProviderCapabilityOverrides,
} from './providerCapabilities';

const ALL_PROVIDERS: ImageProvider[] = [
  'nano-banana',
  'atlas-cloud',
  'midapi',
  'useapi',
  'dall-e',
  'stable-diffusion',
  'placeholder',
];

describe('providerCapabilities', () => {
  afterEach(() => {
    resetProviderCapabilityOverrides();
  });

  it('exposes a capability row for every known provider', () => {
    for (const id of ALL_PROVIDERS) {
      const caps = getProviderCapabilities(id);
      expect(caps.id).toBe(id);
      expect(typeof caps.supportsLoraTraining).toBe('boolean');
    }
  });

  describe('supportsLoraTraining', () => {
    it('is true only for stable-diffusion', () => {
      for (const id of ALL_PROVIDERS) {
        const expected = id === 'stable-diffusion';
        expect(getProviderCapabilities(id).supportsLoraTraining).toBe(expected);
        expect(providerSupportsLoraTraining(id)).toBe(expected);
      }
    });

    it('is false for unknown providers (falls back to placeholder row)', () => {
      expect(providerSupportsLoraTraining('bogus')).toBe(false);
      expect(providerSupportsLoraTraining(undefined)).toBe(false);
    });

    it('respects runtime overrides', () => {
      overrideProviderCapabilities('nano-banana', { supportsLoraTraining: true });
      expect(providerSupportsLoraTraining('nano-banana')).toBe(true);
      overrideProviderCapabilities('stable-diffusion', { supportsLoraTraining: false });
      expect(providerSupportsLoraTraining('stable-diffusion')).toBe(false);
    });
  });

  describe('providerConsumesRefs', () => {
    it('is false for providers with no refs and true for providers that accept refs', () => {
      expect(providerConsumesRefs('dall-e')).toBe(false);
      expect(providerConsumesRefs('placeholder')).toBe(false);
      expect(providerConsumesRefs('nano-banana')).toBe(true);
      expect(providerConsumesRefs('stable-diffusion')).toBe(true);
      expect(providerConsumesRefs('midapi')).toBe(true);
    });
  });
});
