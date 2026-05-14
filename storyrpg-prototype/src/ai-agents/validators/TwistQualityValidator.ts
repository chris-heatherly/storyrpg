/**
 * TwistQualityValidator
 *
 * Evaluates whether an episode's twist is:
 *   1. Present — at least one beat has plotPointType='twist' or 'revelation'.
 *   2. Foreshadowed — there is a prior beat with plotPointType='setup' (or
 *      a narrative thread plant) in an earlier scene.
 *   3. Surprising-but-inevitable — foreshadow must precede the reveal by at
 *      least one scene (not same-scene "gotcha").
 */

import {
  BaseValidator,
  ValidationResult,
  ValidationIssue,
} from './BaseValidator';
import { SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { TwistPlan } from '../agents/TwistArchitect';

export interface TwistQualityInput {
  sceneContents: SceneContent[];
  /** Planned twist, if the TwistArchitect ran. Used to cross-check. */
  twistPlan?: TwistPlan;
}

export interface TwistQualityMetrics {
  twistPresent: boolean;
  foreshadowPresent: boolean;
  foreshadowPrecedesReveal: boolean;
  matchesPlan: boolean;
}

export interface TwistQualityResult extends ValidationResult {
  metrics: TwistQualityMetrics;
}

interface LocatedBeat {
  sceneIndex: number;
  sceneId: string;
  beatIndex: number;
  beat: GeneratedBeat;
}

export class TwistQualityValidator extends BaseValidator {
  constructor() {
    super('TwistQualityValidator');
  }

  validate(input: TwistQualityInput): TwistQualityResult {
    const issues: ValidationIssue[] = [];
    const flat: LocatedBeat[] = [];
    input.sceneContents.forEach((sc, sceneIndex) => {
      sc.beats.forEach((beat, beatIndex) => {
        flat.push({ sceneIndex, sceneId: sc.sceneId, beatIndex, beat });
      });
    });

    const reveals = flat.filter(
      b => b.beat.plotPointType === 'twist' || b.beat.plotPointType === 'revelation',
    );
    const setups = flat.filter(b => b.beat.plotPointType === 'setup');

    const metrics: TwistQualityMetrics = {
      twistPresent: reveals.length > 0,
      foreshadowPresent: setups.length > 0,
      foreshadowPrecedesReveal: false,
      matchesPlan: false,
    };

    if (!metrics.twistPresent) {
      issues.push({
        severity: 'warning',
        message: 'No twist/revelation beat found in this episode',
        suggestion: 'Mark the reversal beat with plotPointType="twist" or "revelation", or schedule one via TwistArchitect.',
      });
    }

    if (metrics.twistPresent && !metrics.foreshadowPresent) {
      issues.push({
        severity: 'error',
        message: 'Twist is present but has no foreshadow (plotPointType="setup")',
        suggestion: 'Plant a setup beat at least one scene before the twist so the reveal feels inevitable.',
      });
    }

    if (metrics.twistPresent && metrics.foreshadowPresent) {
      const earliestReveal = reveals.reduce((earliest, cur) =>
        cur.sceneIndex < earliest.sceneIndex ||
        (cur.sceneIndex === earliest.sceneIndex && cur.beatIndex < earliest.beatIndex)
          ? cur
          : earliest,
      );
      const earliestSetupBefore = setups.find(
        s =>
          s.sceneIndex < earliestReveal.sceneIndex ||
          (s.sceneIndex === earliestReveal.sceneIndex && s.beatIndex < earliestReveal.beatIndex),
      );
      if (earliestSetupBefore) {
        metrics.foreshadowPrecedesReveal = true;
        // Warn if the setup is in the same scene as the reveal (too soon).
        if (earliestSetupBefore.sceneIndex === earliestReveal.sceneIndex) {
          issues.push({
            severity: 'warning',
            message: 'Foreshadow is in the same scene as the reveal — risks "gotcha" twist',
            suggestion: 'Move the setup beat to an earlier scene for proper surprise-but-inevitable pacing.',
          });
        }
      } else {
        issues.push({
          severity: 'error',
          message: 'All setup beats occur AFTER the twist beat',
          suggestion: 'Re-author so that foreshadow precedes the reveal in story time.',
        });
      }
    }

    if (input.twistPlan) {
      const plannedReveal = flat.find(
        b => b.sceneId === input.twistPlan!.twistSceneId && b.beat.id === input.twistPlan!.twistBeatId,
      );
      const plannedForeshadow = flat.find(
        b =>
          b.sceneId === input.twistPlan!.foreshadowSceneId &&
          b.beat.id === input.twistPlan!.foreshadowBeatId,
      );
      metrics.matchesPlan = Boolean(
        plannedReveal &&
          plannedForeshadow &&
          (plannedReveal.beat.plotPointType === 'twist' ||
            plannedReveal.beat.plotPointType === 'revelation') &&
          plannedForeshadow.beat.plotPointType === 'setup',
      );
      if (!metrics.matchesPlan) {
        issues.push({
          severity: 'warning',
          message: 'Generated scenes do not honor the planned twist scheduling',
          suggestion: `Ensure beat ${input.twistPlan.twistBeatId} is marked twist/revelation and beat ${input.twistPlan.foreshadowBeatId} is marked setup.`,
        });
      }
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 25 - warnings * 10);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map(i => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics,
    };
  }
}
