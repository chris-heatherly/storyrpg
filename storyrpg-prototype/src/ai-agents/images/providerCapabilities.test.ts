import { describe, expect, it, afterEach } from 'vitest';

import type { ImageProvider } from '../config';
import {
  getProviderCapabilities,
  overrideProviderCapabilities,
  providerConsumesRefs,
  providerSupportsLoraTraining,
  resetProviderCapabilityOverrides,
} from './providerCapabilities';

// `useapi` is a legacy alias for `midapi`; it intentionally resolves to the
// `midapi` capability row. All other provider ids are canonical.
const CANONICAL_PROVIDERS: ImageProvider[] = [
  'nano-banana',
  'atlas-cloud',
  'midapi',
  'dall-e',
  'stable-diffusion',
  'placeholder',
];

describe('providerCapabilities', () => {
  afterEach(() => {
    resetProviderCapabilityOverrides();
  });

  it('exposes a capability row for every canonical provider', () => {
    for (const id of CANONICAL_PROVIDERS) {
      const caps = getProviderCapabilities(id);
      expect(caps.id).toBe(id);
      expect(typeof caps.supportsLoraTraining).toBe('boolean');
    }
  });

  it('aliases useapi → midapi so the two cannot drift apart', () => {
    const midapiCaps = getProviderCapabilities('midapi');
    const useapiCaps = getProviderCapabilities('useapi');
    expect(useapiCaps).toEqual(midapiCaps);
    expect(useapiCaps.id).toBe('midapi');
    // Override applied to either alias must affect both lookups.
    overrideProviderCapabilities('useapi', { concurrency: 7 });
    expect(getProviderCapabilities('midapi').concurrency).toBe(7);
    expect(getProviderCapabilities('useapi').concurrency).toBe(7);
  });

  describe('supportsLoraTraining', () => {
    it('is true only for stable-diffusion', () => {
      for (const id of CANONICAL_PROVIDERS) {
        const expected = id === 'stable-diffusion';
        expect(getProviderCapabilities(id).supportsLoraTraining).toBe(expected);
        expect(providerSupportsLoraTraining(id)).toBe(expected);
      }
      // useapi alias inherits midapi's value
      expect(getProviderCapabilities('useapi').supportsLoraTraining).toBe(false);
      expect(providerSupportsLoraTraining('useapi')).toBe(false);
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
      expect(providerConsumesRefs('dall-e')).toBe(true);
      expect(providerConsumesRefs('placeholder')).toBe(false);
      expect(providerConsumesRefs('nano-banana')).toBe(true);
      expect(providerConsumesRefs('stable-diffusion')).toBe(true);
      expect(providerConsumesRefs('midapi')).toBe(true);
    });
  });
});
