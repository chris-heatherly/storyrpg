import type { SeasonPlan } from '../../types/seasonPlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface SeasonPromiseMetrics {
  hasSeasonDramaticQuestion: boolean;
  hasCentralPressure: boolean;
  hasSeasonPromise: boolean;
  hasSeasonCompleteness: boolean;
  variationCount: number;
}

export interface SeasonPromiseResult extends ValidationResult {
  metrics: SeasonPromiseMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const VALID_PRESSURE_TYPES = new Set([
  'person',
  'institution',
  'mystery',
  'environment',
  'relationship',
  'internal',
  'situation',
]);
const PLAYER_EXPERIENCE_LANGUAGE = /\b(player|choice|choose|agency|interactive|risk|relationship|information|identity|consequence|branch|route|cost|commit|refuse)\b/i;
const COMPLETENESS_LANGUAGE = /\b(resolve|answer|save|lost|changed|paid|cost|aftermath|legacy|complete|satisfy|future|pressure|residue|different)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function tokenSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3)
  );
}

function overlapRatio(a: string | undefined, b: string | undefined): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(3, Math.min(left.size, right.size));
}

export class SeasonPromiseValidator extends BaseValidator {
  constructor() {
    super('SeasonPromiseValidator');
  }

  validate(plan: Pick<
    SeasonPlan,
    'seasonPromiseArchitecture' | 'episodes' | 'anchors' | 'characterArchitecture' | 'totalEpisodes'
  >): SeasonPromiseResult {
    const issues: ValidationIssue[] = [];
    const architecture = plan.seasonPromiseArchitecture;
    const metrics: SeasonPromiseMetrics = {
      hasSeasonDramaticQuestion: hasText(architecture?.seasonDramaticQuestion),
      hasCentralPressure: Boolean(architecture?.centralPressure),
      hasSeasonPromise: Boolean(architecture?.seasonPromise),
      hasSeasonCompleteness: Boolean(architecture?.seasonCompleteness),
      variationCount: architecture?.seasonPromise?.variationPlan?.length || 0,
    };

    if (!architecture) {
      issues.push(this.error(
        'Season promise architecture is missing.',
        'season.seasonPromiseArchitecture',
        'Add seasonDramaticQuestion, centralPressure, seasonPromise, and seasonCompleteness.',
      ));
      return this.result(issues, metrics);
    }

    if (!hasText(architecture.seasonDramaticQuestion)) {
      issues.push(this.error(
        'seasonDramaticQuestion is missing.',
        'season.seasonPromiseArchitecture.seasonDramaticQuestion',
      ));
    }

    this.validateCentralPressure(plan, issues);
    this.validateSeasonPromise(plan, issues);
    this.validateCompleteness(plan, issues);

    return this.result(issues, metrics);
  }

  private validateCentralPressure(
    plan: Pick<SeasonPlan, 'seasonPromiseArchitecture' | 'characterArchitecture'>,
    issues: ValidationIssue[],
  ): void {
    const pressure = plan.seasonPromiseArchitecture?.centralPressure;
    if (!pressure) {
      issues.push(this.error(
        'centralPressure is missing.',
        'season.seasonPromiseArchitecture.centralPressure',
      ));
      return;
    }
    if (!VALID_PRESSURE_TYPES.has(pressure.type)) {
      issues.push(this.error(
        `centralPressure.type "${pressure.type}" is invalid.`,
        'season.seasonPromiseArchitecture.centralPressure.type',
      ));
    }
    if (!hasText(pressure.description)) {
      issues.push(this.error(
        'centralPressure.description is missing.',
        'season.seasonPromiseArchitecture.centralPressure.description',
      ));
    }
    if (!hasText(pressure.pressuresLieBy)) {
      issues.push(this.error(
        'centralPressure.pressuresLieBy is missing.',
        'season.seasonPromiseArchitecture.centralPressure.pressuresLieBy',
      ));
    }

    const protagonist = plan.characterArchitecture?.protagonist;
    if (protagonist && hasText(pressure.pressuresLieBy)) {
      const linked = Math.max(
        overlapRatio(pressure.pressuresLieBy, protagonist.lie),
        overlapRatio(pressure.pressuresLieBy, protagonist.truth),
        overlapRatio(pressure.pressuresLieBy, protagonist.need),
      );
      if (linked === 0) {
        issues.push(this.warning(
          'centralPressure.pressuresLieBy does not obviously connect to the protagonist Lie/Truth/Need.',
          'season.seasonPromiseArchitecture.centralPressure.pressuresLieBy',
          'Name how the central pressure makes the false belief harder to sustain or the Truth harder to avoid.',
        ));
      }
    }
  }

  private validateSeasonPromise(
    plan: Pick<SeasonPlan, 'seasonPromiseArchitecture' | 'episodes'>,
    issues: ValidationIssue[],
  ): void {
    const promise = plan.seasonPromiseArchitecture?.seasonPromise;
    if (!promise) {
      issues.push(this.error(
        'seasonPromise is missing.',
        'season.seasonPromiseArchitecture.seasonPromise',
      ));
      return;
    }
    if (!hasText(promise.premisePromise)) {
      issues.push(this.error('seasonPromise.premisePromise is missing.', 'season.seasonPromiseArchitecture.seasonPromise.premisePromise'));
    }
    if (!hasText(promise.playerExperiencePromise)) {
      issues.push(this.error('seasonPromise.playerExperiencePromise is missing.', 'season.seasonPromiseArchitecture.seasonPromise.playerExperiencePromise'));
    } else if (!PLAYER_EXPERIENCE_LANGUAGE.test(promise.playerExperiencePromise)) {
      issues.push(this.warning(
        'seasonPromise.playerExperiencePromise does not clearly describe interactive/player agency.',
        'season.seasonPromiseArchitecture.seasonPromise.playerExperiencePromise',
      ));
    }
    if (!hasText(promise.emotionalPromise)) {
      issues.push(this.error('seasonPromise.emotionalPromise is missing.', 'season.seasonPromiseArchitecture.seasonPromise.emotionalPromise'));
    }
    if (!Array.isArray(promise.variationPlan) || promise.variationPlan.length === 0) {
      issues.push(this.error(
        'seasonPromise.variationPlan is missing.',
        'season.seasonPromiseArchitecture.seasonPromise.variationPlan',
        'List how later episodes deliver fresh variations on the opening promise.',
      ));
    }
    const episodeOne = plan.episodes?.find((episode) => episode.episodeNumber === 1);
    if (episodeOne && hasText(promise.premisePromise)) {
      const openingText = [episodeOne.synopsis, episodeOne.narrativeFunction?.setup, episodeOne.narrativeFunction?.conflict].join(' ');
      if (overlapRatio(openingText, promise.premisePromise) === 0) {
        issues.push(this.warning(
          'Episode 1 does not obviously establish the premisePromise.',
          'season.episodes[1]',
          'The opening episode should establish premise, player role, dramatic engine, and promise of play.',
        ));
      }
    }
  }

  private validateCompleteness(
    plan: Pick<SeasonPlan, 'seasonPromiseArchitecture' | 'episodes' | 'anchors' | 'totalEpisodes'>,
    issues: ValidationIssue[],
  ): void {
    const completeness = plan.seasonPromiseArchitecture?.seasonCompleteness;
    if (!completeness) {
      issues.push(this.error(
        'seasonCompleteness is missing.',
        'season.seasonPromiseArchitecture.seasonCompleteness',
      ));
      return;
    }
    for (const field of ['resolvedQuestion', 'resolvedStakes', 'characterStateChange'] as const) {
      if (!hasText(completeness[field])) {
        issues.push(this.error(
          `seasonCompleteness.${field} is missing.`,
          `season.seasonPromiseArchitecture.seasonCompleteness.${field}`,
        ));
      }
    }
    const completenessText = [
      completeness.resolvedQuestion,
      completeness.resolvedStakes,
      completeness.characterStateChange,
    ].join(' ');
    if (hasText(completenessText) && !COMPLETENESS_LANGUAGE.test(completenessText)) {
      issues.push(this.warning(
        'seasonCompleteness does not clearly describe resolution, changed stakes, or changed character state.',
        'season.seasonPromiseArchitecture.seasonCompleteness',
      ));
    }

    const finale = plan.episodes?.find((episode) => episode.episodeNumber === plan.totalEpisodes)
      || plan.episodes?.[plan.episodes.length - 1];
    if (finale && hasText(completeness.resolvedQuestion)) {
      const finaleText = [finale.synopsis, finale.narrativeFunction?.resolution, finale.cliffhangerPlan?.resolvedEpisodeTension].join(' ');
      if (overlapRatio(finaleText, completeness.resolvedQuestion) === 0) {
        issues.push(this.warning(
          'Final episode does not obviously resolve the seasonDramaticQuestion.',
          `season.episodes[${finale.episodeNumber}]`,
          'The finale should answer the season question enough to satisfy, even if it leaves earned future pressure.',
        ));
      }
    }

    if (hasText(completeness.openFuturePressure) && !COMPLETENESS_LANGUAGE.test(completeness.openFuturePressure)) {
      issues.push(this.warning(
        'openFuturePressure should read as earned residue, not an unresolved main conflict.',
        'season.seasonPromiseArchitecture.seasonCompleteness.openFuturePressure',
      ));
    }
  }

  private result(
    issues: ValidationIssue[],
    metrics: SeasonPromiseMetrics,
  ): SeasonPromiseResult {
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 20 - warningCount * 5),
      issues,
      suggestions: [],
      metrics,
    };
  }
}
