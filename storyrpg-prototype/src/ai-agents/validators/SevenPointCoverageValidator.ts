/**
 * Seven-Point Coverage Validator
 *
 * Deterministic gate on the season's 3-act / 7-point structure.
 *
 * Responsibilities
 * ----------------
 *  1. Every canonical beat (hook, plotTurn1, pinch1, midpoint, pinch2,
 *     climax, resolution) must be carried by at least one episode.
 *  2. Beats must appear in canonical order across episodes (hook before
 *     plotTurn1, etc.).
 *  3. The anchors declared at the season level must be non-empty strings.
 *  4. The season-level `sevenPoint.climax` must line up with
 *     `anchors.climax` (either an exact match or a clear rephrasing).
 *  5. The difficultyTier on each episode should reflect the beat(s) it
 *     carries: Hook / PT1 episodes trend toward introduction/rising;
 *     Midpoint / PT2 / Climax episodes trend toward peak/finale;
 *     Resolution episodes trend toward falling/finale.
 *  6. Ending targets should link to `anchors.stakes` (the season's core
 *     stakes) in at least one ending's stateDrivers / themePayoff.
 *
 * This validator runs in the SeasonPlanner → StoryArchitect Karpathy retry
 * loop: if it fails, the season plan is re-prompted with the issues as
 * feedback. Downstream StoryArchitect invocations trust the plan once
 * the validator passes.
 */

import {
  SEVEN_POINT_BEATS,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
  StoryEndingTarget,
} from '../../types/sourceAnalysis';
import { SeasonPlan } from '../../types/seasonPlan';
import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildFailureResult,
  buildSuccessResult,
} from './BaseValidator';
import { checkSevenPointCoverage } from '../utils/sevenPointDistribution';

const BEAT_TO_EXPECTED_TIERS: Record<Exclude<StructuralRole, 'rising' | 'falling'>, readonly string[]> = {
  hook: ['introduction'],
  plotTurn1: ['introduction', 'rising'],
  pinch1: ['rising'],
  midpoint: ['rising', 'peak'],
  pinch2: ['peak'],
  climax: ['peak', 'finale'],
  resolution: ['falling', 'finale'],
};

export interface SevenPointCoverageInput {
  anchors: StoryAnchors;
  sevenPoint: SevenPointStructure;
  episodes: Array<{
    episodeNumber: number;
    structuralRole?: StructuralRole[];
    difficultyTier?: string;
  }>;
  resolvedEndings?: StoryEndingTarget[];
}

/**
 * Extract the validator's input shape from a fully-built SeasonPlan.
 * Helper so callers outside the pipeline (tests, CLI diagnostics) can run
 * this validator without reshaping data by hand.
 */
export function seasonPlanToCoverageInput(plan: SeasonPlan): SevenPointCoverageInput {
  return {
    anchors: plan.anchors,
    sevenPoint: plan.sevenPoint,
    episodes: plan.episodes.map((ep) => ({
      episodeNumber: ep.episodeNumber,
      structuralRole: ep.structuralRole,
      difficultyTier: (ep as unknown as { difficultyTier?: string }).difficultyTier,
    })),
    resolvedEndings: plan.resolvedEndings,
  };
}

export class SevenPointCoverageValidator extends BaseValidator {
  constructor() {
    super('SevenPointCoverageValidator');
  }

  validate(input: SevenPointCoverageInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    this.checkAnchors(input.anchors, issues);
    this.checkSevenPoint(input.sevenPoint, issues);
    this.checkClimaxAlignment(input.anchors, input.sevenPoint, issues);

    const coverageIssues = checkSevenPointCoverage(input.episodes);
    for (const msg of coverageIssues) {
      issues.push(this.error(msg, 'season.episodes.structuralRole'));
    }

    this.checkDifficultyTierAlignment(input.episodes, issues);
    this.checkEndingStakesLinkage(input.anchors, input.resolvedEndings, issues);

    // Any `error` severity issue is blocking. Warnings only lower the score.
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 25 - warningCount * 5);

    if (errorCount > 0) {
      return buildFailureResult(issues, score);
    }
    return {
      valid: true,
      score,
      issues,
      suggestions: [],
    };
  }

  private checkAnchors(anchors: StoryAnchors | undefined, issues: ValidationIssue[]): void {
    if (!anchors) {
      issues.push(this.error('Season anchors block is missing entirely.', 'season.anchors'));
      return;
    }
    const fields: Array<keyof StoryAnchors> = ['stakes', 'goal', 'incitingIncident', 'climax'];
    for (const field of fields) {
      const value = anchors[field];
      if (typeof value !== 'string' || value.trim().length < 3) {
        issues.push(this.error(
          `Anchor "${field}" is missing or too short (got: ${JSON.stringify(value)}).`,
          `season.anchors.${field}`,
          'Every anchor must be a 1-2 sentence description that downstream agents can reference.',
        ));
      }
    }
  }

  private checkSevenPoint(sp: SevenPointStructure | undefined, issues: ValidationIssue[]): void {
    if (!sp) {
      issues.push(this.error('Season sevenPoint block is missing entirely.', 'season.sevenPoint'));
      return;
    }
    for (const beat of SEVEN_POINT_BEATS) {
      const value = sp[beat];
      if (typeof value !== 'string' || value.trim().length < 3) {
        issues.push(this.error(
          `Beat "${beat}" in season.sevenPoint is missing or too short.`,
          `season.sevenPoint.${beat}`,
        ));
      }
    }
  }

  /**
   * The season Climax anchor and the 7-point structure's climax beat should
   * describe the same event. We do a loose word-overlap check because the
   * LLM may rephrase one against the other.
   */
  private checkClimaxAlignment(
    anchors: StoryAnchors | undefined,
    sp: SevenPointStructure | undefined,
    issues: ValidationIssue[],
  ): void {
    if (!anchors || !sp) return;
    const anchorWords = tokenize(anchors.climax);
    const beatWords = tokenize(sp.climax);
    if (anchorWords.size === 0 || beatWords.size === 0) return;
    const shared = [...anchorWords].filter((w) => beatWords.has(w)).length;
    const overlap = shared / Math.max(3, Math.min(anchorWords.size, beatWords.size));
    if (overlap < 0.2) {
      issues.push(this.warning(
        'Season Climax anchor and sevenPoint.climax appear to describe different events.',
        'season.anchors.climax vs season.sevenPoint.climax',
        'These two fields should describe the SAME decisive confrontation. Rephrase one to match the other.',
      ));
    }
  }

  private checkDifficultyTierAlignment(
    episodes: SevenPointCoverageInput['episodes'],
    issues: ValidationIssue[],
  ): void {
    for (const ep of episodes) {
      if (!ep.difficultyTier || !ep.structuralRole || ep.structuralRole.length === 0) continue;
      for (const role of ep.structuralRole) {
        if (role === 'rising' || role === 'falling') continue;
        const expectedTiers = BEAT_TO_EXPECTED_TIERS[role];
        if (!expectedTiers.includes(ep.difficultyTier)) {
          issues.push(this.warning(
            `Episode ${ep.episodeNumber} carries beat "${role}" but its difficultyTier is "${ep.difficultyTier}" (expected one of: ${expectedTiers.join(', ')}).`,
            `season.episodes[${ep.episodeNumber}].difficultyTier`,
            `Adjust the difficulty curve so beat-${role} episodes trend toward ${expectedTiers.join(' / ')} difficulty.`,
          ));
        }
      }
    }
  }

  private checkEndingStakesLinkage(
    anchors: StoryAnchors | undefined,
    endings: StoryEndingTarget[] | undefined,
    issues: ValidationIssue[],
  ): void {
    if (!anchors || !endings || endings.length === 0) return;
    const stakesTokens = tokenize(anchors.stakes);
    if (stakesTokens.size === 0) return;

    const linked = endings.some((ending) => {
      const tokens = new Set<string>();
      tokenize(ending.themePayoff).forEach((t) => tokens.add(t));
      for (const driver of ending.stateDrivers || []) {
        tokenize(driver.label).forEach((t) => tokens.add(t));
        tokenize(driver.details || '').forEach((t) => tokens.add(t));
      }
      const shared = [...stakesTokens].filter((w) => tokens.has(w)).length;
      return shared / Math.max(3, stakesTokens.size) >= 0.2;
    });

    if (!linked) {
      issues.push(this.warning(
        'No ending appears to reference the season Stakes anchor; the final beats may feel disconnected from what the protagonist cares about.',
        'season.resolvedEndings',
        'Update at least one ending\'s themePayoff or stateDrivers so the season Stakes visibly pay off at the finale.',
      ));
    }
  }
}

/**
 * Lower-case, alphanumeric-only token set with common stopwords removed.
 * Pure helper, used for the climax-alignment and stakes-linkage heuristics.
 */
function tokenize(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'are',
    'was', 'were', 'be', 'been', 'their', 'his', 'her', 'its', 'this', 'that',
    'with', 'for', 'by', 'as', 'it', 'they', 'them', 'he', 'she',
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}
