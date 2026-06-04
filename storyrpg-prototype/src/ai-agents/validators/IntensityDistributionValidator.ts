/**
 * Intensity Distribution Validator (E5).
 *
 * Beats carry an `intensityTier` ('dominant' | 'supporting' | 'rest') — the
 * narrative-intensity tiering from the prose-craft contract. A scene that turns
 * needs at least one DOMINANT beat (its peak); a longer scene also needs a REST
 * beat (room to breathe); a scene that is ALL dominant has no modulation and
 * reads as flat-loud. This validator surfaces those distribution problems.
 *
 * Advisory — it never blocks. Beats with no tier are treated as 'supporting'
 * (the neutral middle), so an un-tiered scene only trips the "no dominant" check
 * if NOTHING is marked dominant. Encounter scenes (content lives in the runtime
 * encounter, not authored beats) are exempt.
 *
 * Pure + unit-testable.
 */

import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildSuccessResult,
  buildFailureResult,
} from './BaseValidator';

type IntensityTier = 'dominant' | 'supporting' | 'rest';

interface IntensityBeat {
  id?: string;
  intensityTier?: IntensityTier;
}

interface IntensityScene {
  sceneId?: string;
  sceneName?: string;
  isEncounter?: boolean;
  beats?: IntensityBeat[];
}

export interface IntensityDistributionInput {
  sceneContents: IntensityScene[];
}

export interface IntensityDistributionMetrics {
  scenesChecked: number;
  scenesWithoutDominant: number;
  scenesAllDominant: number;
  scenesMissingRest: number;
}

// A scene needs enough beats before modulation is even meaningful.
const MIN_BEATS_FOR_DOMINANT = 3;
// Above this, a scene with no rest beat reads as relentless.
const MIN_BEATS_FOR_REST = 4;

export class IntensityDistributionValidator extends BaseValidator {
  constructor() {
    super('IntensityDistributionValidator');
  }

  validate(input: IntensityDistributionInput): ValidationResult & { metrics: IntensityDistributionMetrics } {
    const issues: ValidationIssue[] = [];
    const metrics: IntensityDistributionMetrics = {
      scenesChecked: 0,
      scenesWithoutDominant: 0,
      scenesAllDominant: 0,
      scenesMissingRest: 0,
    };

    for (const scene of input.sceneContents ?? []) {
      if (scene.isEncounter) continue;
      const beats = scene.beats ?? [];
      if (beats.length < MIN_BEATS_FOR_DOMINANT) continue;
      metrics.scenesChecked++;

      const where = scene.sceneId ? `scene:${scene.sceneId}` : undefined;
      const label = scene.sceneName || scene.sceneId || 'scene';
      const tiers = beats.map((b) => b.intensityTier ?? 'supporting');
      const dominant = tiers.filter((t) => t === 'dominant').length;
      const rest = tiers.filter((t) => t === 'rest').length;

      if (dominant === 0) {
        metrics.scenesWithoutDominant++;
        issues.push(
          this.warning(
            `Scene "${label}" has no dominant beat — no clear emotional peak across ${beats.length} beats.`,
            where,
            'Mark the turn/peak beat intensityTier="dominant" so the scene has a high point.',
          ),
        );
      } else if (dominant === beats.length) {
        metrics.scenesAllDominant++;
        issues.push(
          this.warning(
            `Scene "${label}" is all-dominant (${beats.length}/${beats.length}) — no modulation, reads as flat-loud.`,
            where,
            'Demote some beats to supporting/rest so the dominant beat lands.',
          ),
        );
      }

      if (beats.length >= MIN_BEATS_FOR_REST && rest === 0) {
        metrics.scenesMissingRest++;
        issues.push(
          this.info(
            `Scene "${label}" (${beats.length} beats) has no rest beat — little room to breathe.`,
            where,
            'Consider an intensityTier="rest" beat to vary the rhythm.',
          ),
        );
      }
    }

    if (issues.some((i) => i.severity === 'error' || i.severity === 'warning')) {
      // Score scales with how many checked scenes had a structural (warning) problem.
      const flagged = metrics.scenesWithoutDominant + metrics.scenesAllDominant;
      const score = Math.max(40, Math.round(100 - (flagged / Math.max(1, metrics.scenesChecked)) * 60));
      return { ...buildFailureResult(issues, score), metrics };
    }
    // Success, but keep any info issues (missing-rest) instead of dropping them.
    return { ...buildSuccessResult(100), issues, metrics };
  }
}
