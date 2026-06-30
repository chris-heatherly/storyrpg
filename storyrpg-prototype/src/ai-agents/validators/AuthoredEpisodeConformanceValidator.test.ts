import { describe, expect, it } from 'vitest';

import type { SeasonEpisode } from '../../types/seasonPlan';
import type { StructuralRole, TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import type { ExtractedTreatment } from '../utils/treatmentExtraction';
import { AuthoredEpisodeConformanceValidator } from './AuthoredEpisodeConformanceValidator';

function seasonEpisode(
  episodeNumber: number,
  title: string,
  structuralRole?: StructuralRole[],
): SeasonEpisode {
  return {
    episodeNumber,
    title,
    synopsis: `Synopsis for episode ${episodeNumber}.`,
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: [],
    supportingCharacters: [],
    locations: [],
    estimatedSceneCount: 4,
    estimatedChoiceCount: 3,
    structuralRole,
    narrativeFunction: { setup: '', conflict: '', resolution: '' },
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
  };
}

function treatment(
  episodes: Record<number, Pick<TreatmentEpisodeGuidance, 'authoredTitle'>>,
  seasonSpine?: string,
): Pick<ExtractedTreatment, 'episodes' | 'seasonGuidance'> {
  return {
    episodes: episodes as ExtractedTreatment['episodes'],
    seasonGuidance: seasonSpine
      ? ({ seasonSpine } as ExtractedTreatment['seasonGuidance'])
      : undefined,
  };
}

// Canonical ENDSONG-style three-episode slice with a Section-7 anchor for plotTurn1.
const AUTHORED = treatment(
  {
    1: { authoredTitle: 'Dawn and Discord' },
    2: { authoredTitle: 'The Key and the Cage' },
    3: { authoredTitle: 'The Siege Tightens' },
  },
  'Hook (Ep1)\nPlot turn 1 (Ep3)',
);

describe('AuthoredEpisodeConformanceValidator', () => {
  it('passes when the generated season is a faithful 1:1 image of the authored treatment', () => {
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: AUTHORED,
      seasonPlan: {
        episodes: [
          seasonEpisode(1, 'Dawn and Discord', ['hook']),
          seasonEpisode(2, '**The Key and the Cage**', ['rising']),
          seasonEpisode(3, 'The Siege Tightens', ['plotTurn1']),
        ],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.metrics.titleMatches).toBe(3);
    expect(result.metrics.titleMismatches).toBe(0);
    expect(result.metrics.anchorChecks).toBe(2);
    expect(result.metrics.anchorMismatches).toBe(0);
  });

  it('fails when an authored episode was re-titled (re-cut), not expanded', () => {
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: AUTHORED,
      seasonPlan: {
        episodes: [
          // The ENDSONG defect: re-cut title that the old fuzzy 0.5 check let pass.
          seasonEpisode(1, 'Dawn in Silvermist Valley', ['hook']),
          seasonEpisode(2, 'The Key and the Cage', ['rising']),
          seasonEpisode(3, 'The Siege Tightens', ['plotTurn1']),
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.titleMismatches).toBe(1);
    expect(result.issues.some((issue) =>
      issue.severity === 'error' &&
      issue.message.includes('Episode 1 title drifted') &&
      issue.message.includes('Dawn in Silvermist Valley')
    )).toBe(true);
  });

  it('does not flag a dropped editorial suffix (GAP-E: authored "(FINALE)" vs generated bare title)', () => {
    const authored = treatment({
      1: { authoredTitle: 'Dawn and Discord' },
      2: { authoredTitle: 'The Key and the Cage' },
      3: { authoredTitle: 'Endsong (FINALE)' },
    });
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: authored,
      seasonPlan: {
        episodes: [
          seasonEpisode(1, 'Dawn and Discord', ['hook']),
          seasonEpisode(2, 'The Key and the Cage', ['rising']),
          // Generator kept the title but dropped the editorial "(FINALE)" suffix.
          seasonEpisode(3, 'Endsong', ['climax']),
        ],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.titleMatches).toBe(3);
    expect(result.metrics.titleMismatches).toBe(0);
  });

  it('still flags a genuinely different title even when the authored title carries a suffix', () => {
    const authored = treatment({
      1: { authoredTitle: 'Endsong (FINALE)' },
    });
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: authored,
      seasonPlan: { episodes: [seasonEpisode(1, 'A Wholly Different Finale', ['climax'])] },
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.titleMismatches).toBe(1);
  });

  it('fails on an episode count mismatch (authored episode merged/dropped)', () => {
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: AUTHORED,
      seasonPlan: {
        episodes: [
          seasonEpisode(1, 'Dawn and Discord', ['hook']),
          seasonEpisode(2, 'The Key and the Cage', ['rising', 'plotTurn1']),
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) =>
      issue.message.includes('has 2 episode(s)') && issue.message.includes('has 3')
    )).toBe(true);
  });

  it('fails when an authored Section-7 beat is relocated off its anchored episode', () => {
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: AUTHORED,
      seasonPlan: {
        episodes: [
          seasonEpisode(1, 'Dawn and Discord', ['hook']),
          // plotTurn1 wrongly placed on Ep2 instead of authored Ep3.
          seasonEpisode(2, 'The Key and the Cage', ['plotTurn1']),
          seasonEpisode(3, 'The Siege Tightens', ['rising']),
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.anchorMismatches).toBe(1);
    expect(result.issues.some((issue) =>
      issue.message.includes('Beat "plotTurn1" is authored on episode 3')
    )).toBe(true);
  });

  it('is a no-op when there is no authored treatment to conform to', () => {
    const result = new AuthoredEpisodeConformanceValidator().validate({
      treatment: { episodes: {} as ExtractedTreatment['episodes'], seasonGuidance: undefined },
      seasonPlan: { episodes: [seasonEpisode(1, 'Anything Goes')] },
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.metrics.authoredEpisodeCount).toBe(0);
  });
});
