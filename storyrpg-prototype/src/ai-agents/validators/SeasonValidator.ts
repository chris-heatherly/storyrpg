/**
 * Season Validator
 * Validates season bible structure and coherence
 */

import { SeasonBible } from '../../types';

export interface SeasonValidationResult {
  valid: boolean;
  scores: {
    overallScore: number;
    structureScore: number;
    coherenceScore: number;
  };
  issues: string[];
  suggestions: string[];
}

export class SeasonValidator {
  validateSeasonBible(seasonBible: SeasonBible): SeasonValidationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Basic validation
    if (!seasonBible.totalEpisodes || seasonBible.totalEpisodes < 1) {
      issues.push('Season must have at least 1 episode');
    }

    if (!seasonBible.episodePlans || seasonBible.episodePlans.length === 0) {
      issues.push('Season must have episode plans');
    }

    if (seasonBible.episodePlans && seasonBible.episodePlans.length !== seasonBible.totalEpisodes) {
      issues.push(`Episode plans count (${seasonBible.episodePlans.length}) doesn't match total episodes (${seasonBible.totalEpisodes})`);
    }

    const overallScore = issues.length === 0 ? 85 : Math.max(40, 85 - issues.length * 15);

    return {
      valid: issues.length === 0,
      scores: {
        overallScore,
        structureScore: overallScore,
        coherenceScore: overallScore,
      },
      issues,
      suggestions,
    };
  }

  /**
   * Walk the season's promiseLedger and cross-reference with per-episode
   * `promisesMade` / `promisesFulfilled` to classify:
   * - fulfilled: a promise that appears in at least one episode's promisesFulfilled
   * - open: a promise that was raised but has not yet been fulfilled by any episode
   * - broken: a promise that appears in promisesMade but was never fulfilled and
   *   has no planned fulfillment in any later episode (including the finale)
   */
  validatePromiseFulfillment(
    seasonBible: SeasonBible,
  ): { fulfilled: string[]; open: string[]; broken: string[] } {
    const fulfilled: Set<string> = new Set();
    const open: Set<string> = new Set();
    const broken: Set<string> = new Set();

    const ledger = seasonBible.promiseLedger || {
      questionsRaised: [],
      characterTrajectories: [],
      relationshipTensions: [],
      themesIntroduced: [],
    };
    const allLedgerPromises: string[] = [
      ...(ledger.questionsRaised ?? []),
      ...(ledger.characterTrajectories ?? []),
      ...(ledger.relationshipTensions ?? []),
      ...(ledger.themesIntroduced ?? []),
    ];

    const fulfilledInEpisodes = new Set<string>();
    const madeInEpisodes = new Set<string>();
    const plans = seasonBible.episodePlans ?? [];
    for (const plan of plans) {
      for (const p of plan.promisesFulfilled ?? []) fulfilledInEpisodes.add(p);
      for (const p of plan.promisesMade ?? []) madeInEpisodes.add(p);
    }

    // Ledger-driven classification
    for (const promise of allLedgerPromises) {
      if (fulfilledInEpisodes.has(promise)) {
        fulfilled.add(promise);
      } else {
        open.add(promise);
      }
    }

    // Episode-level promises that are neither fulfilled nor carried in the ledger
    // are treated as "broken" if we've reached the finale.
    const finaleEpisode = seasonBible.seasonStructure?.finaleEpisode;
    const lastPlan = plans.find((p) => p.episodeNumber === finaleEpisode) ?? plans[plans.length - 1];
    const seasonComplete = Boolean(lastPlan && seasonBible.generationComplete);
    if (seasonComplete) {
      for (const made of madeInEpisodes) {
        if (!fulfilledInEpisodes.has(made) && !allLedgerPromises.includes(made)) {
          broken.add(made);
        }
      }
      // Ledger promises still open at end-of-season are broken
      for (const stillOpen of open) {
        broken.add(stillOpen);
      }
    }

    // A promise can't be both "open" and "broken" in the final report
    for (const b of broken) open.delete(b);

    return {
      fulfilled: Array.from(fulfilled),
      open: Array.from(open),
      broken: Array.from(broken),
    };
  }

  /**
   * Quickly score cliffhanger quality across episodes.
   * - Requires non-finale episodes to have a concrete cliffhangerHook + cliffhangerSetup.
   * - Rewards cliffhanger type variety across the season.
   * - The finale's "nextSeasonHook" is checked separately.
   */
  validateCliffhangerQuality(seasonBible: SeasonBible): { score: number; issues: string[] } {
    const issues: string[] = [];
    const plans = seasonBible.episodePlans ?? [];
    if (plans.length === 0) {
      return { score: 0, issues: ['No episode plans to evaluate'] };
    }

    const finaleEpisodeNumber = seasonBible.seasonStructure?.finaleEpisode;
    const nonFinalePlans = plans.filter((p) => p.episodeNumber !== finaleEpisodeNumber);

    let score = 100;
    let missingHookCount = 0;
    let missingSetupCount = 0;
    const seenTypes = new Set<string>();

    for (const plan of nonFinalePlans) {
      if (!plan.cliffhangerHook || plan.cliffhangerHook.trim().length < 20) {
        issues.push(`Episode ${plan.episodeNumber}: cliffhanger hook is missing or too thin`);
        missingHookCount++;
      }
      if (!plan.cliffhangerSetup || plan.cliffhangerSetup.trim().length < 20) {
        issues.push(`Episode ${plan.episodeNumber}: cliffhanger setup is missing or too thin`);
        missingSetupCount++;
      }
      if (plan.cliffhangerType) {
        seenTypes.add(String(plan.cliffhangerType));
      }
    }

    // Penalties
    if (nonFinalePlans.length > 0) {
      const hookRate = missingHookCount / nonFinalePlans.length;
      const setupRate = missingSetupCount / nonFinalePlans.length;
      score -= Math.min(50, hookRate * 50);
      score -= Math.min(30, setupRate * 30);
    }

    // Variety bonus: reward at least 2 distinct cliffhanger types across the season
    if (nonFinalePlans.length >= 3 && seenTypes.size < 2) {
      issues.push('Season uses only one cliffhanger type across multiple episodes — add variety');
      score -= 10;
    }

    // Finale check — nextSeasonHook is the season-level cliffhanger
    const nextHook = seasonBible.nextSeasonHook;
    if (!nextHook?.hook || nextHook.hook.trim().length < 20) {
      issues.push('Finale lacks a compelling nextSeasonHook.hook');
      score -= 15;
    }

    return {
      score: Math.max(0, Math.round(score)),
      issues,
    };
  }
}
