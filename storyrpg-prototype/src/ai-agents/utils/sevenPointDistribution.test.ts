import { describe, it, expect } from 'vitest';
import {
  distributeSevenPoints,
  describeDistribution,
  checkSevenPointCoverage,
  CANONICAL_BEATS,
} from './sevenPointDistribution';

describe('distributeSevenPoints', () => {
  it('returns an empty array for invalid input', () => {
    expect(distributeSevenPoints(0)).toEqual([]);
    expect(distributeSevenPoints(-1)).toEqual([]);
    expect(distributeSevenPoints(NaN)).toEqual([]);
  });

  it('places every canonical beat when N >= 7', () => {
    const entries = distributeSevenPoints(9);
    expect(entries).toHaveLength(9);

    const placed = new Set(entries.flatMap((e) => e.structuralRole));
    for (const beat of CANONICAL_BEATS) {
      expect(placed.has(beat)).toBe(true);
    }
  });

  it('preserves canonical order across episodes', () => {
    const entries = distributeSevenPoints(12);

    const beatToEpisode = new Map<string, number>();
    for (const entry of entries) {
      for (const role of entry.structuralRole) {
        if (!beatToEpisode.has(role)) {
          beatToEpisode.set(role, entry.episodeNumber);
        }
      }
    }

    let last = -Infinity;
    for (const beat of CANONICAL_BEATS) {
      const ep = beatToEpisode.get(beat)!;
      expect(ep).toBeGreaterThanOrEqual(last);
      last = ep;
    }
  });

  it('fuses beats onto shared episodes when N < 7', () => {
    const entries = distributeSevenPoints(3);
    expect(entries).toHaveLength(3);

    // Every beat still appears.
    const placed = new Set(entries.flatMap((e) => e.structuralRole));
    for (const beat of CANONICAL_BEATS) {
      expect(placed.has(beat)).toBe(true);
    }
  });

  it('fills empty episodes with rising/falling buffers split on the midpoint', () => {
    const entries = distributeSevenPoints(12);
    const midpointIdx = entries.findIndex((e) => e.structuralRole.includes('midpoint'));
    expect(midpointIdx).toBeGreaterThan(0);

    for (const entry of entries) {
      if (entry.structuralRole.length === 1) {
        const role = entry.structuralRole[0];
        if (role === 'rising') {
          expect(entry.episodeNumber).toBeLessThanOrEqual(midpointIdx + 1);
        } else if (role === 'falling') {
          expect(entry.episodeNumber).toBeGreaterThan(midpointIdx + 1);
        }
      }
    }
  });

  it('handles a single-episode season by fusing every beat', () => {
    const entries = distributeSevenPoints(1);
    expect(entries).toHaveLength(1);
    const placed = new Set(entries[0].structuralRole);
    for (const beat of CANONICAL_BEATS) {
      expect(placed.has(beat)).toBe(true);
    }
  });
});

describe('describeDistribution', () => {
  it('formats each episode on its own line with comma-separated roles', () => {
    const summary = describeDistribution([
      { episodeNumber: 1, structuralRole: ['hook'] },
      { episodeNumber: 2, structuralRole: ['rising', 'plotTurn1'] },
    ]);

    expect(summary).toContain('Episode 1: hook');
    expect(summary).toContain('Episode 2: rising, plotTurn1');
  });
});

describe('checkSevenPointCoverage', () => {
  it('returns no issues when every beat is covered in canonical order', () => {
    const entries = distributeSevenPoints(10);
    expect(checkSevenPointCoverage(entries)).toEqual([]);
  });

  it('reports a missing beat', () => {
    const issues = checkSevenPointCoverage([
      { episodeNumber: 1, structuralRole: ['hook'] },
      { episodeNumber: 2, structuralRole: ['plotTurn1'] },
      { episodeNumber: 3, structuralRole: ['pinch1'] },
      { episodeNumber: 4, structuralRole: ['midpoint'] },
      { episodeNumber: 5, structuralRole: ['pinch2'] },
      // climax intentionally missing
      { episodeNumber: 6, structuralRole: ['resolution'] },
    ]);

    expect(issues.some((i) => i.includes('climax'))).toBe(true);
  });

  it('reports beat ordering violations', () => {
    // plotTurn1 placed BEFORE hook across episodes — canonical order says
    // hook must come first.
    const issues = checkSevenPointCoverage([
      { episodeNumber: 1, structuralRole: ['plotTurn1'] },
      { episodeNumber: 2, structuralRole: ['hook'] },
      { episodeNumber: 3, structuralRole: ['pinch1'] },
      { episodeNumber: 4, structuralRole: ['midpoint'] },
      { episodeNumber: 5, structuralRole: ['pinch2'] },
      { episodeNumber: 6, structuralRole: ['climax'] },
      { episodeNumber: 7, structuralRole: ['resolution'] },
    ]);

    expect(issues.some((i) => i.includes('ordering violation'))).toBe(true);
  });

  it('treats undefined structuralRole as empty', () => {
    const issues = checkSevenPointCoverage([
      { episodeNumber: 1 },
      { episodeNumber: 2, structuralRole: undefined },
    ]);

    // All 7 beats missing.
    expect(issues.length).toBe(CANONICAL_BEATS.length);
  });
});
