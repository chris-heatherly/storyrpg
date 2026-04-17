import { describe, it, expect } from 'vitest';
import {
  buildVerbatimProfile,
  composeCanonicalStyleString,
  resolveArtStyleProfile,
} from './artStyleProfile';

describe('buildVerbatimProfile', () => {
  it('echoes the raw input into the DNA fields', () => {
    const profile = buildVerbatimProfile('romance novel cover');
    expect(profile.name).toBe('romance novel cover');
    expect(profile.family).toBe('unknown');
    expect(profile.renderingTechnique).toContain('romance novel cover');
    expect(profile.colorPhilosophy).toContain('romance novel cover');
    expect(profile.lightingApproach).toContain('romance novel cover');
    expect(profile.compositionStyle).toContain('romance novel cover');
    expect(profile.moodRange).toContain('romance novel cover');
  });

  it('never seeds cinematic positive vocabulary for unknown styles', () => {
    const profile = buildVerbatimProfile('ink wash risograph zine');
    expect(profile.positiveVocabulary).not.toContain('cinematic');
    expect(profile.positiveVocabulary).not.toContain('dramatic');
    expect(profile.positiveVocabulary).not.toContain('emotionally charged');
    expect(profile.positiveVocabulary).not.toContain('sharp focus');
  });

  it('handles empty input gracefully', () => {
    const profile = buildVerbatimProfile('');
    expect(profile.family).toBe('unknown');
    expect(profile.name.length).toBeGreaterThan(0);
  });
});

describe('resolveArtStyleProfile', () => {
  it('routes unknown style strings through the verbatim builder', () => {
    const profile = resolveArtStyleProfile('romance novel cover');
    expect(profile.family).toBe('unknown');
    expect(profile.name).toContain('romance novel');
    expect(profile.positiveVocabulary).not.toContain('cinematic');
  });

  it('still resolves recognized families with their preset', () => {
    const profile = resolveArtStyleProfile('watercolor');
    expect(profile.family).toBe('watercolor');
    expect(profile.positiveVocabulary).toContain('watercolor texture');
  });
});

describe('composeCanonicalStyleString', () => {
  it('flattens every DNA field the pipeline cares about into one string', () => {
    const profile = buildVerbatimProfile('romance novel cover');
    const out = composeCanonicalStyleString(profile);
    expect(out).toContain('romance novel cover');
    expect(out).toContain(profile.renderingTechnique);
    expect(out).toContain(profile.colorPhilosophy);
    expect(out).toContain(profile.lightingApproach);
    expect(out).toContain(profile.lineWeight);
    expect(out).toContain(profile.compositionStyle);
    expect(out).toContain(profile.moodRange);
  });

  it('returns an empty string when no profile is supplied', () => {
    expect(composeCanonicalStyleString(undefined)).toBe('');
    expect(composeCanonicalStyleString(null)).toBe('');
  });
});
