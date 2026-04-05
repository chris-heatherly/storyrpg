import { describe, expect, it } from 'vitest';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { applyEndingModeToAnalysis } from './endingResolver';

function createAnalysis(): SourceMaterialAnalysis {
  return {
    sourceTitle: 'Celestial Hearts',
    genre: 'Fantasy Romance',
    tone: 'Lyrical and tense',
    themes: ['divinity', 'identity', 'sacrifice'],
    setting: {
      timePeriod: 'Mythic present',
      location: 'A divided city',
      worldDetails: 'Gods and mortals share one skyline.',
    },
    storyArcs: [
      {
        id: 'arc-1',
        name: 'The Divine Bargain',
        description: 'A promise to the gods keeps pulling the protagonist away from human life.',
        estimatedEpisodeRange: { start: 1, end: 4 },
      },
    ],
    detectedEndingMode: 'single',
    resolvedEndingMode: 'single',
    extractedEndings: [],
    generatedEndings: [],
    resolvedEndings: [],
    episodeBreakdown: [
      {
        episodeNumber: 1,
        title: 'Arrival',
        synopsis: 'The bargain begins.',
        sourceChapters: ['1'],
        sourceSummary: 'The bargain begins.',
        plotPoints: [],
        mainCharacters: ['char-rhea'],
        supportingCharacters: [],
        locations: ['loc-city'],
        estimatedSceneCount: 6,
        estimatedChoiceCount: 3,
        narrativeFunction: {
          setup: 'Introduce the bargain.',
          conflict: 'The price becomes clear.',
          resolution: 'The route opens.',
        },
      },
    ],
    totalEstimatedEpisodes: 1,
    protagonist: {
      id: 'char-rhea',
      name: 'Rhea',
      description: 'A mortal oracle',
      arc: 'Rhea decides whether to belong to the gods, the city, or herself.',
    },
    majorCharacters: [],
    keyLocations: [],
    analysisTimestamp: new Date(),
    confidenceScore: 84,
    warnings: [],
  };
}

describe('endingResolver', () => {
  it('generates alternate endings when multiple mode is enabled without extracted endings', () => {
    const updated = applyEndingModeToAnalysis(createAnalysis(), 'multiple');

    expect(updated.resolvedEndingMode).toBe('multiple');
    expect(updated.resolvedEndings?.length).toBeGreaterThanOrEqual(3);
    expect(updated.resolvedEndings?.every((ending) => ending.sourceConfidence === 'generated')).toBe(true);
  });

  it('collapses to a single primary ending when single mode is active', () => {
    const updated = applyEndingModeToAnalysis(createAnalysis(), 'single');

    expect(updated.resolvedEndingMode).toBe('single');
    expect(updated.resolvedEndings).toHaveLength(1);
    expect(updated.resolvedEndings?.[0].sourceConfidence).not.toBe('generated');
  });
});
