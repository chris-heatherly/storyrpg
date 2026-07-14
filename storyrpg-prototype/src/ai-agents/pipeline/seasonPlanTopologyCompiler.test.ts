import { describe, expect, it } from 'vitest';

import {
  compileCanonicalSeasonArcTopology,
  reconcileAuthoredSeasonArcs,
} from './seasonPlanTopologyCompiler';

function analysis() {
  const authored = [
    { arcIndex: 1, title: 'Champagne', episodeRange: { start: 1, end: 3 } },
    { arcIndex: 2, title: 'Mirror', episodeRange: { start: 4, end: 6 } },
    { arcIndex: 3, title: 'Blood', episodeRange: { start: 7, end: 8 } },
  ].map((arc) => ({
    ...arc,
    sourceText: `Arc ${arc.arcIndex}: ${arc.title}`,
    arcDramaticQuestion: `${arc.title} question?`,
  }));
  return {
    totalEstimatedEpisodes: 8,
    storyArcs: authored.map((arc) => ({
      id: `arc-${arc.arcIndex}`,
      name: arc.title,
      description: `${arc.title} source description.`,
      estimatedEpisodeRange: arc.episodeRange,
    })),
    treatmentSeasonGuidance: {
      arcGuidance: { rawSection: 'Story Arcs', arcs: authored },
    },
  } as any;
}

describe('seasonPlanTopologyCompiler', () => {
  it('compiles authored arc identity and ranges in source order', () => {
    const canonical = compileCanonicalSeasonArcTopology(analysis());

    expect(canonical.map((arc) => ({ id: arc.id, name: arc.name, range: arc.episodeRange }))).toEqual([
      { id: 'arc-1', name: 'Champagne', range: { start: 1, end: 3 } },
      { id: 'arc-2', name: 'Mirror', range: { start: 4, end: 6 } },
      { id: 'arc-3', name: 'Blood', range: { start: 7, end: 8 } },
    ]);
  });

  it('rejects a generic full-season arc and requests every omitted authored ID', () => {
    const canonical = compileCanonicalSeasonArcTopology(analysis());
    const result = reconcileAuthoredSeasonArcs(canonical, [{
      id: 'arc-1-8',
      name: 'Arc 1-8',
      episodeRange: { start: 1, end: 8 },
    }]);

    expect(result.requiresLlmRepair).toBe(true);
    expect(result.missingArcIds).toEqual(['arc-1', 'arc-2', 'arc-3']);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'unknown_arc_rejected',
      'authored_arc_missing',
      'authored_arc_missing',
      'authored_arc_missing',
    ]);
  });

  it('merges keyed enrichments while preserving canonical identity and range', () => {
    const canonical = compileCanonicalSeasonArcTopology(analysis());
    const result = reconcileAuthoredSeasonArcs(canonical, canonical.slice().reverse().map((arc) => ({
      id: arc.id,
      name: `Provider rename ${arc.name}`,
      description: 'Provider summary.',
      episodeRange: { start: 1, end: 8 },
      finaleAnswer: `${arc.name} answer.`,
    })));

    expect(result.requiresLlmRepair).toBe(false);
    expect(result.arcs.map((arc) => arc.id)).toEqual(['arc-1', 'arc-2', 'arc-3']);
    expect(result.arcs.map((arc) => arc.name)).toEqual(['Champagne', 'Mirror', 'Blood']);
    expect(result.arcs.map((arc) => arc.episodeRange)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: 8 },
    ]);
    expect(result.arcs.map((arc) => arc.finaleAnswer)).toEqual([
      'Champagne answer.',
      'Mirror answer.',
      'Blood answer.',
    ]);
  });

  it('keeps name and range matching behind the legacy migration adapter', () => {
    const canonical = compileCanonicalSeasonArcTopology(analysis());
    const legacyCandidate = [{
      name: 'Champagne',
      episodeRange: { start: 1, end: 3 },
      finaleAnswer: 'A legacy enrichment.',
    }];

    const current = reconcileAuthoredSeasonArcs(canonical, legacyCandidate);
    expect(current.missingArcIds).toEqual(['arc-1', 'arc-2', 'arc-3']);

    const migrated = reconcileAuthoredSeasonArcs(canonical, legacyCandidate, {
      allowLegacyIdentityMatching: true,
    });
    expect(migrated.missingArcIds).toEqual(['arc-2', 'arc-3']);
    expect(migrated.arcs[0].finaleAnswer).toBe('A legacy enrichment.');
  });

  it('does not silently select one of two enrichments for the same authored arc', () => {
    const canonical = compileCanonicalSeasonArcTopology(analysis());
    const result = reconcileAuthoredSeasonArcs(canonical, [
      { id: 'arc-1', name: 'Champagne', episodeRange: { start: 1, end: 3 } },
      { id: 'arc-1', name: 'Champagne Duplicate', episodeRange: { start: 1, end: 3 } },
      { id: 'arc-2', name: 'Mirror', episodeRange: { start: 4, end: 6 } },
      { id: 'arc-3', name: 'Blood', episodeRange: { start: 7, end: 8 } },
    ]);

    expect(result.requiresLlmRepair).toBe(true);
    expect(result.missingArcIds).toEqual(['arc-1']);
    expect(result.issues.some((issue) => issue.code === 'authored_arc_duplicate')).toBe(true);
  });
});
