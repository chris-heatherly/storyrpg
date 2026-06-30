import { describe, expect, it } from 'vitest';
import {
  STORY_CIRCLE_BEAT_DEFINITIONS,
  STORY_CIRCLE_BEAT_DEFINITION_LINES,
  backfillMissingStoryCircleBeats,
  checkStoryCircleCoverage,
  describeStoryCircleDistribution,
  distributeStoryCircle,
} from './storyCircleDistribution';
import { STORY_CIRCLE_BEATS, type StoryCircleBeat } from '../../types/sourceAnalysis';

function beatsFor(totalUnits: number): StoryCircleBeat[][] {
  return distributeStoryCircle(totalUnits).map((entry) =>
    entry.storyCircleRole.map((role) => role.beat)
  );
}

describe('distributeStoryCircle', () => {
  it('returns an empty array for invalid input', () => {
    expect(distributeStoryCircle(0)).toEqual([]);
    expect(distributeStoryCircle(-1)).toEqual([]);
    expect(distributeStoryCircle(NaN)).toEqual([]);
  });

  it('uses the exact required fusions for fewer than eight units', () => {
    expect(beatsFor(1)).toEqual([['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change']]);
    expect(beatsFor(2)).toEqual([
      ['you', 'need', 'go', 'search'],
      ['find', 'take', 'return', 'change'],
    ]);
    expect(beatsFor(3)).toEqual([
      ['you', 'need'],
      ['go', 'search', 'find'],
      ['take', 'return', 'change'],
    ]);
    expect(beatsFor(4)).toEqual([
      ['you', 'need'],
      ['go', 'search'],
      ['find', 'take'],
      ['return', 'change'],
    ]);
    expect(beatsFor(5)).toEqual([
      ['you', 'need'],
      ['go', 'search'],
      ['find'],
      ['take', 'return'],
      ['change'],
    ]);
    expect(beatsFor(6)).toEqual([
      ['you', 'need'],
      ['go'],
      ['search'],
      ['find'],
      ['take', 'return'],
      ['change'],
    ]);
    expect(beatsFor(7)).toEqual([
      ['you'],
      ['need'],
      ['go'],
      ['search'],
      ['find'],
      ['take'],
      ['return', 'change'],
    ]);
  });

  it('places one primary beat per unit for exactly eight units', () => {
    expect(beatsFor(8)).toEqual(STORY_CIRCLE_BEATS.map((beat) => [beat]));
  });

  it('adds more-than-eight extras as contiguous expansions of real beats', () => {
    const entries = distributeStoryCircle(11);
    expect(entries).toHaveLength(11);
    expect(checkStoryCircleCoverage(entries)).toEqual([]);

    const expanded = entries
      .filter((entry) => entry.storyCircleRole.some((role) => role.roleKind === 'expansion'))
      .map((entry) => entry.storyCircleRole[0].beat);
    expect(expanded).toEqual(['search', 'take', 'return']);
  });
});

describe('storyCircleDistribution helpers', () => {
  it('formats distribution summaries with expansion labels', () => {
    const summary = describeStoryCircleDistribution(distributeStoryCircle(9));
    expect(summary).toContain('Episode 4: search');
    expect(summary).toContain('Episode 5: search expansion');
  });

  it('reports missing beats, ordering violations, and non-contiguous expansions', () => {
    const missing = checkStoryCircleCoverage([
      { episodeNumber: 1, storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'llm' }] },
    ]);
    expect(missing.some((issue) => issue.includes('need'))).toBe(true);

    const orderedWrong = checkStoryCircleCoverage([
      { episodeNumber: 1, storyCircleRole: [{ beat: 'need', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 2, storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 3, storyCircleRole: [{ beat: 'go', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 4, storyCircleRole: [{ beat: 'search', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 5, storyCircleRole: [{ beat: 'find', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 6, storyCircleRole: [{ beat: 'take', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 7, storyCircleRole: [{ beat: 'return', roleKind: 'primary', source: 'llm' }] },
      { episodeNumber: 8, storyCircleRole: [{ beat: 'change', roleKind: 'primary', source: 'llm' }] },
    ]);
    expect(orderedWrong.some((issue) => issue.includes('ordering violation'))).toBe(true);

    const nonContiguousExpansion = checkStoryCircleCoverage([
      ...distributeStoryCircle(8),
      { episodeNumber: 12, storyCircleRole: [{ beat: 'search', roleKind: 'expansion', source: 'llm' }] },
    ]);
    expect(nonContiguousExpansion.some((issue) => issue.includes('contiguity violation'))).toBe(true);
  });

  it('backfills missing primary beats from the default distribution', () => {
    const defaults = distributeStoryCircle(8);
    const roles = new Map(defaults.map((entry) => [
      entry.episodeNumber,
      entry.storyCircleRole.filter((role) => role.beat !== 'take'),
    ]));

    expect(checkStoryCircleCoverage(
      Array.from(roles.entries()).map(([episodeNumber, storyCircleRole]) => ({ episodeNumber, storyCircleRole })),
    ).some((issue) => issue.includes('take'))).toBe(true);

    backfillMissingStoryCircleBeats(roles, defaults);
    expect(checkStoryCircleCoverage(
      Array.from(roles.entries()).map(([episodeNumber, storyCircleRole]) => ({ episodeNumber, storyCircleRole })),
    )).toEqual([]);
  });

  it('keeps the full canonical beat definitions available for prompts', () => {
    for (const beat of STORY_CIRCLE_BEATS) {
      expect(STORY_CIRCLE_BEAT_DEFINITION_LINES).toContain(
        `\`${beat}\`: ${STORY_CIRCLE_BEAT_DEFINITIONS[beat]}`,
      );
    }
  });
});
