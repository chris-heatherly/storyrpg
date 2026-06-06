/**
 * Unit tests for the treatment version/identity fingerprint (Phase 0 / RC1).
 *
 * The fingerprint must:
 *   - capture episode count + ordered normalized authored titles + Section-7
 *     beat->episode anchors,
 *   - normalize whitespace/markdown so a trivially re-saved identical treatment
 *     fingerprints identically (no version-guard false positives),
 *   - detect a re-cut/version swap via title comparison.
 */

import { describe, expect, it } from 'vitest';
import type { ExtractedTreatment } from './treatmentExtraction';
import {
  compareTreatmentFingerprints,
  computeTreatmentFingerprint,
  extractBeatEpisodeAnchors,
  normalizeTreatmentTitle,
} from './treatmentFingerprint';

function treatment(
  titles: Record<number, string>,
  seasonSpine?: string,
): Pick<ExtractedTreatment, 'episodes' | 'seasonGuidance'> {
  const episodes: ExtractedTreatment['episodes'] = {};
  for (const [num, authoredTitle] of Object.entries(titles)) {
    episodes[Number(num)] = { authoredTitle } as ExtractedTreatment['episodes'][number];
  }
  return {
    episodes,
    seasonGuidance: seasonSpine
      ? ({ episodeStructureMode: 'standard', seasonSpine } as ExtractedTreatment['seasonGuidance'])
      : undefined,
  };
}

describe('normalizeTreatmentTitle', () => {
  it('strips markdown emphasis and collapses whitespace', () => {
    expect(normalizeTreatmentTitle('**Dawn and Discord**')).toBe('dawn and discord');
    expect(normalizeTreatmentTitle('  Dawn   and   Discord ')).toBe('dawn and discord');
    expect(normalizeTreatmentTitle('## Dawn and Discord')).toBe('dawn and discord');
  });

  it('distinguishes genuinely different titles', () => {
    expect(normalizeTreatmentTitle('Dawn and Discord')).not.toBe(
      normalizeTreatmentTitle('Dawn in Silvermist Valley'),
    );
  });

  it('drops a trailing editorial parenthetical so an omitted suffix is not a false mismatch', () => {
    // GAP-E: a generator that keeps the title but drops "(FINALE)" must still match.
    expect(normalizeTreatmentTitle('Endsong (FINALE)')).toBe('endsong');
    expect(normalizeTreatmentTitle('Endsong')).toBe('endsong');
    expect(normalizeTreatmentTitle('Endsong (FINALE)')).toBe(
      normalizeTreatmentTitle('Endsong'),
    );
    // Tolerant even with markdown emphasis around the suffixed title.
    expect(normalizeTreatmentTitle('**Dawn and Discord (FINALE)**')).toBe(
      normalizeTreatmentTitle('Dawn and Discord'),
    );
  });

  it('only strips a TRAILING parenthetical, so genuinely different titles stay distinct', () => {
    expect(normalizeTreatmentTitle('Dawn and Discord (FINALE)')).not.toBe(
      normalizeTreatmentTitle('Dawn in Silvermist Valley'),
    );
  });
});

describe('extractBeatEpisodeAnchors', () => {
  it('parses Section-7 (EpN) anchors line-by-line', () => {
    const spine = [
      'Hook (Ep1): the bargain',
      'Plot turn 1 (Ep3): the siege',
      'Pinch 1 (Ep4): the ravine',
      'Midpoint (Ep6): the reveal',
      'Pinch 2 (Ep7): betrayal',
      'Climax (Ep10): the endsong',
    ].join('\n');
    expect(extractBeatEpisodeAnchors(spine)).toEqual({
      hook: 1,
      plotTurn1: 3,
      pinch1: 4,
      midpoint: 6,
      pinch2: 7,
      climax: 10,
    });
  });

  it('returns an empty map when there is no spine', () => {
    expect(extractBeatEpisodeAnchors(undefined)).toEqual({});
  });
});

describe('computeTreatmentFingerprint', () => {
  it('captures count, ordered titles, and anchors', () => {
    const fp = computeTreatmentFingerprint(
      treatment({ 1: 'Dawn and Discord', 2: 'The Key and the Cage' }, 'Plot turn 1 (Ep3)'),
    );
    expect(fp.episodeCount).toBe(2);
    expect(fp.normalizedTitles).toEqual(['dawn and discord', 'the key and the cage']);
    expect(fp.beatEpisodeAnchors).toEqual({ plotTurn1: 3 });
  });

  it('fingerprints a trivially re-saved identical treatment identically', () => {
    const canonical = computeTreatmentFingerprint(
      treatment({ 1: 'Dawn and Discord' }, 'Plot turn 1 (Ep3)'),
    );
    const reSaved = computeTreatmentFingerprint(
      treatment({ 1: '  **Dawn and Discord**  ' }, ' Plot turn 1 (Ep3) '),
    );
    expect(compareTreatmentFingerprints(reSaved, canonical).matches).toBe(true);
  });
});

describe('compareTreatmentFingerprints', () => {
  it('detects a re-cut/version swap by title', () => {
    const canonical = computeTreatmentFingerprint(treatment({ 1: 'Dawn and Discord' }));
    const recut = computeTreatmentFingerprint(treatment({ 1: 'Dawn in Silvermist Valley' }));
    const result = compareTreatmentFingerprints(recut, canonical);
    expect(result.matches).toBe(false);
    expect(result.differences.join(' ')).toContain('episode 1 title');
  });

  it('detects an episode-count mismatch', () => {
    const a = computeTreatmentFingerprint(treatment({ 1: 'A', 2: 'B', 3: 'C' }));
    const b = computeTreatmentFingerprint(treatment({ 1: 'A', 2: 'B' }));
    expect(compareTreatmentFingerprints(a, b).matches).toBe(false);
  });

  it('compares against a bare signature string', () => {
    const fp = computeTreatmentFingerprint(treatment({ 1: 'Dawn and Discord' }));
    expect(compareTreatmentFingerprints(fp, fp.signature).matches).toBe(true);
    expect(compareTreatmentFingerprints(fp, 'episodes=9;titles=wrong;anchors=').matches).toBe(false);
  });
});
