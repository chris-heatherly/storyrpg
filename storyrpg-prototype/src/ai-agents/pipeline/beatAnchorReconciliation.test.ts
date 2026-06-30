/**
 * Unit tests for Section-7 beat-anchor reconciliation (Phase 1, Step 1.2).
 *
 * The authored Section-7 `(EpN)` anchor is the spine of record. When the
 * per-episode structuralRole disagrees, the beat is moved onto the anchored
 * episode and the conflict is logged; in strict mode it throws. When the
 * anchors and roles already agree, nothing changes.
 */

import { describe, expect, it, vi } from 'vitest';
import { reconcileBeatAnchors } from './beatAnchorReconciliation';
import { TreatmentValidationError } from '../utils/treatmentExtraction';
import type { StructuralRole } from '../../types/sourceAnalysis';

function ep(episodeNumber: number, structuralRole: StructuralRole[]) {
  return { episodeNumber, structuralRole };
}

describe('reconcileBeatAnchors', () => {
  it('no-ops when there are no anchors', () => {
    const episodes = [ep(1, ['hook']), ep(2, ['plotTurn1'])];
    const result = reconcileBeatAnchors(episodes, undefined);
    expect(result.conflicts).toHaveLength(0);
    expect(episodes[1].structuralRole).toEqual(['plotTurn1']);
  });

  it('no conflict when the anchor matches the sole carrier', () => {
    const episodes = [ep(1, ['hook']), ep(3, ['plotTurn1'])];
    const result = reconcileBeatAnchors(episodes, { plotTurn1: 3 });
    expect(result.conflicts).toHaveLength(0);
    expect(episodes[1].structuralRole).toEqual(['plotTurn1']);
  });

  it('moves a misplaced beat onto the anchored episode (non-strict)', () => {
    // Anchor says plotTurn1 belongs on Ep3, but the role sits on Ep2.
    const episodes = [ep(1, ['hook']), ep(2, ['plotTurn1']), ep(3, ['rising'])];
    const log = vi.fn();
    const result = reconcileBeatAnchors(episodes, { plotTurn1: 3 }, { log });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ beat: 'plotTurn1', anchoredEpisode: 3, carryingEpisodes: [2] });
    expect(log).toHaveBeenCalledOnce();
    // Ep2 loses the beat (backfilled to rising since it would be empty)…
    expect(episodes[1].structuralRole).toEqual(['rising']);
    // …and Ep3 gains it.
    expect(episodes[2].structuralRole).toContain('plotTurn1');
  });

  it('strips a beat from an episode but keeps its other roles', () => {
    const episodes = [ep(2, ['plotTurn1', 'pinch1']), ep(3, ['rising'])];
    reconcileBeatAnchors(episodes, { plotTurn1: 3 });
    expect(episodes[0].structuralRole).toEqual(['pinch1']);
    expect(episodes[1].structuralRole).toContain('plotTurn1');
  });

  it('assigns an unassigned anchored beat to its episode', () => {
    const episodes = [ep(1, ['hook']), ep(10, ['rising'])];
    const result = reconcileBeatAnchors(episodes, { climax: 10 });
    expect(result.conflicts).toHaveLength(1);
    expect(episodes[1].structuralRole).toContain('climax');
  });

  it('throws in strict mode on the first conflict', () => {
    const episodes = [ep(2, ['plotTurn1']), ep(3, ['rising'])];
    expect(() => reconcileBeatAnchors(episodes, { plotTurn1: 3 }, { strict: true })).toThrow(
      TreatmentValidationError,
    );
  });

  it('reconciles the full canonical ENDSONG anchor map', () => {
    // Default distribution-style assignment that drifts by one on plotTurn1.
    const episodes = [
      ep(1, ['hook']),
      ep(2, ['plotTurn1']), // drift: anchor says Ep3
      ep(3, ['rising']),
      ep(4, ['pinch1']),
      ep(6, ['midpoint']),
      ep(7, ['pinch2']),
      ep(10, ['climax', 'resolution']),
    ];
    const result = reconcileBeatAnchors(episodes, {
      plotTurn1: 3,
      pinch1: 4,
      midpoint: 6,
      pinch2: 7,
      climax: 10,
    });
    // Only plotTurn1 was off.
    expect(result.conflicts.map((c) => c.beat)).toEqual(['plotTurn1']);
    expect(episodes.find((e) => e.episodeNumber === 3)?.structuralRole).toContain('plotTurn1');
    expect(episodes.find((e) => e.episodeNumber === 2)?.structuralRole).toEqual(['rising']);
  });
});
