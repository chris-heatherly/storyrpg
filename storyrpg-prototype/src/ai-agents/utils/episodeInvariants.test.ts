import { describe, expect, it } from 'vitest';
import { extractEpisodeInvariants } from './episodeInvariants';

describe('extractEpisodeInvariants', () => {
  it('extracts a protagonist action-negation (the bite-me ep2 invariant)', () => {
    const out = extractEpisodeInvariants(
      'She finally goes to Vâlcescu Club and has the best conversation in years, but she does not go home with him.',
    );
    expect(out.some((s) => /does not go home with him/i.test(s))).toBe(true);
  });

  it('does NOT fire on a stative negation (the fixture FP: "does not want to be read")', () => {
    expect(extractEpisodeInvariants('An archivist catalogues a manor that does not want to be read.')).toEqual([]);
  });

  it('catches an almost-but-doesn\'t action and several markers', () => {
    expect(extractEpisodeInvariants("He almost — but doesn't — kiss her at the truck.").length).toBeGreaterThan(0);
    expect(extractEpisodeInvariants('She never signs the contract.').length).toBeGreaterThan(0);
    expect(extractEpisodeInvariants('She refuses to give up the blog.').length).toBeGreaterThan(0);
  });

  it('is empty for plain prose, missing text, and other stative verbs', () => {
    expect(extractEpisodeInvariants('Mara finds the passage and must choose how to face Edric.')).toEqual([]);
    expect(extractEpisodeInvariants(undefined)).toEqual([]);
    expect(extractEpisodeInvariants('He does not seem to know what she means.')).toEqual([]); // seem/know/mean excluded
  });

  it('dedupes and caps the result', () => {
    const text = 'She does not go. She does not go. She will not tell. She refuses to stay. She never leaves. She cannot drink.';
    const out = extractEpisodeInvariants(text, 4);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(new Set(out.map((s) => s.toLowerCase())).size).toBe(out.length);
  });
});
