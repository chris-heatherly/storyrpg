/**
 * AuthoredEpisodeConformanceValidator (Treatment-Fidelity Remediation §4.1 — NEW, blocking).
 *
 * When a story is generated from an authored treatment, the treatment is the
 * *spine of record*: the pipeline must EXPAND each authored episode, never
 * re-cut, re-title, re-order, split, or merge it. This validator asserts that
 * the generated {@link SeasonPlan.episodes} is a faithful 1:1 image of the parsed
 * {@link ExtractedTreatment} episode outline.
 *
 * The ENDSONG incident (§0/RC1) slipped through because the only existing title
 * check was a fuzzy 0.5 token-overlap (`TreatmentFidelityValidator.ts:350`), which
 * let a re-cut document validate against itself. This validator therefore matches
 * titles EXACTLY after normalization (markdown/whitespace only — see
 * {@link normalizeTreatmentTitle}), not fuzzily.
 *
 * Asserts (all blocking / `severity: 'error'`):
 *   (a) episode COUNT equals authored;
 *   (b) ORDER preserved (episode N in the plan maps to authored episode N);
 *   (c) each TITLE matches the authored title exactly after normalization;
 *   (d) no authored episode SPLIT or MERGED (1:1 slot mapping — a side effect of
 *       (a)+(b)+(c), reported explicitly when the slot mapping is not bijective).
 *
 * Default-OFF behind a gate flag — registered by the Wiring phase, consistent
 * with how recent validators landed. This module is standalone and does not
 * register itself.
 */

import type { SeasonEpisode, SeasonPlan } from '../../types/seasonPlan';
import type { ExtractedTreatment } from '../utils/treatmentExtraction';
import { normalizeTreatmentTitle } from '../utils/treatmentFingerprint';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface AuthoredEpisodeConformanceInput {
  /** The parsed authored treatment — the spine of record. */
  treatment: Pick<ExtractedTreatment, 'episodes' | 'seasonGuidance'>;
  /** The generated season plan whose episode identity must conform. */
  seasonPlan: Pick<SeasonPlan, 'episodes'>;
}

export interface AuthoredEpisodeConformanceMetrics {
  authoredEpisodeCount: number;
  generatedEpisodeCount: number;
  titleMatches: number;
  titleMismatches: number;
}

export interface AuthoredEpisodeConformanceResult extends ValidationResult {
  metrics: AuthoredEpisodeConformanceMetrics;
}

function authoredTitleFor(
  treatment: AuthoredEpisodeConformanceInput['treatment'],
  episodeNumber: number,
): string | undefined {
  return treatment.episodes?.[episodeNumber]?.authoredTitle;
}

export class AuthoredEpisodeConformanceValidator extends BaseValidator {
  constructor() {
    super('AuthoredEpisodeConformanceValidator');
  }

  validate(input: AuthoredEpisodeConformanceInput): AuthoredEpisodeConformanceResult {
    const issues: ValidationIssue[] = [];
    const authoredNumbers = Object.keys(input.treatment.episodes || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const generated = [...(input.seasonPlan.episodes || [])].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );

    const metrics: AuthoredEpisodeConformanceMetrics = {
      authoredEpisodeCount: authoredNumbers.length,
      generatedEpisodeCount: generated.length,
      titleMatches: 0,
      titleMismatches: 0,
    };

    // Nothing authored → nothing to conform to (not a treatment-sourced run).
    if (authoredNumbers.length === 0) {
      return this.result(issues, metrics);
    }

    // (a) Episode COUNT equals authored. A count mismatch is the headline signal
    //     of a split/merge or a recut, so report it first and explicitly.
    if (generated.length !== authoredNumbers.length) {
      issues.push(this.error(
        `Generated season has ${generated.length} episode(s); authored treatment has ${authoredNumbers.length}. ` +
          'The treatment is the spine of record — episodes must not be split, merged, added, or dropped.',
        'seasonPlan.episodes',
        'Expand each authored episode 1:1; do not re-cut the episode list.',
      ));
    }

    // (b)+(c)+(e) Walk authored slots in order. Slot N must map to a generated
    //     episode N with the authored title (exact after normalization).
    const generatedByNumber = new Map<number, SeasonEpisode>();
    for (const episode of generated) {
      // (e) 1:1 mapping: two generated episodes claiming the same slot means a split.
      if (generatedByNumber.has(episode.episodeNumber)) {
        issues.push(this.error(
          `Episode slot ${episode.episodeNumber} is claimed by more than one generated episode — authored episode split.`,
          `seasonPlan.episodes.${episode.episodeNumber}`,
          'Each authored episode must map to exactly one generated episode.',
        ));
        continue;
      }
      generatedByNumber.set(episode.episodeNumber, episode);
    }

    for (const num of authoredNumbers) {
      const authoredTitle = authoredTitleFor(input.treatment, num);
      const generatedEpisode = generatedByNumber.get(num);

      // (b)/(e) Order/slot preserved: authored episode N must have a generated
      //         counterpart at the same number.
      if (!generatedEpisode) {
        issues.push(this.error(
          `Authored episode ${num}${authoredTitle ? ` ("${authoredTitle}")` : ''} has no generated episode at the same position.`,
          `seasonPlan.episodes.${num}`,
          'Preserve authored episode order and identity; do not merge or drop an authored episode.',
        ));
        metrics.titleMismatches += 1;
        continue;
      }

      // (c) Title matches authored EXACTLY after normalization (not fuzzy).
      if (authoredTitle && authoredTitle.trim().length > 0) {
        const expected = normalizeTreatmentTitle(authoredTitle);
        const actual = normalizeTreatmentTitle(generatedEpisode.title);
        if (expected === actual) {
          metrics.titleMatches += 1;
        } else {
          metrics.titleMismatches += 1;
          issues.push(this.error(
            `Episode ${num} title drifted from the authored treatment: expected "${authoredTitle}", got "${generatedEpisode.title}".`,
            `seasonPlan.episodes.${num}.title`,
            'Use the authored episode title verbatim. A re-titled episode is a re-cut, not an expansion.',
          ));
        }
      }
    }

    return this.result(issues, metrics);
  }

  private result(
    issues: ValidationIssue[],
    metrics: AuthoredEpisodeConformanceMetrics,
  ): AuthoredEpisodeConformanceResult {
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
