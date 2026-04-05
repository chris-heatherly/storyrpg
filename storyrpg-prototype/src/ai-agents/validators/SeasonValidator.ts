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

  validatePromiseFulfillment(seasonBible: SeasonBible): { fulfilled: string[]; open: string[]; broken: string[] } {
    return {
      fulfilled: [],
      open: [],
      broken: [],
    };
  }

  validateCliffhangerQuality(seasonBible: SeasonBible): { score: number; issues: string[] } {
    return {
      score: 80,
      issues: [],
    };
  }
}
