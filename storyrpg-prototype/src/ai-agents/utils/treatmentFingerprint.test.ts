/**
 * Unit tests for the treatment version/identity fingerprint (Phase 0 / RC1).
 *
 * The fingerprint must:
 *   - capture episode count + ordered normalized authored titles + Story Circle
 *     beat episode anchors,
 *   - normalize whitespace/markdown so a trivially re-saved identical treatment
 *     fingerprints identically (no version-guard false positives),
 *   - detect a re-cut/version swap via title comparison.
 */

import { describe, expect, it } from 'vitest';
import type { ExtractedTreatment } from './treatmentExtraction';
import {
  compareTreatmentFingerprints,
  computeTreatmentFingerprint,
  extractStoryCircleBeatEpisodeAnchors,
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
      ? ({ seasonSpine } as ExtractedTreatment['seasonGuidance'])
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

describe('extractStoryCircleBeatEpisodeAnchors', () => {
  it('parses Story Circle (EpN) anchors line-by-line', () => {
    const spine = [
      'You (Ep1): the ordinary pressure',
      'Need (Ep2): the missing truth',
      'Go (Ep3): crossing the threshold',
      'Search (Ep4): adaptive pressure',
      'Find (Ep5): the find discovery',
      'Take (Ep7): the real price',
      'Return (Ep9): carrying the cost home',
      'Change (Ep10): the new identity',
    ].join('\n');
    expect(extractStoryCircleBeatEpisodeAnchors(spine)).toEqual({
      you: 1,
      need: 2,
      go: 3,
      search: 4,
      find: 5,
      take: 7,
      return: 9,
      change: 10,
    });
  });
});

describe('computeTreatmentFingerprint', () => {
  it('captures count, ordered titles, and anchors', () => {
    const fp = computeTreatmentFingerprint(
      treatment({ 1: 'Dawn and Discord', 2: 'The Key and the Cage' }, 'go (Ep3)'),
    );
    expect(fp.episodeCount).toBe(2);
    expect(fp.normalizedTitles).toEqual(['dawn and discord', 'the key and the cage']);
    expect(fp.storyCircleBeatEpisodeAnchors).toEqual({ go: 3 });
  });

  it('fingerprints a trivially re-saved identical treatment identically', () => {
    const canonical = computeTreatmentFingerprint(
      treatment({ 1: 'Dawn and Discord' }, 'Go (Ep3)'),
    );
    const reSaved = computeTreatmentFingerprint(
      treatment({ 1: '  **Dawn and Discord**  ' }, ' Go (Ep3) '),
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
