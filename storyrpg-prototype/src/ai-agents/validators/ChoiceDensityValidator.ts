/**
 * Choice Density Validator
 *
 * Enforces choice density requirements:
 * - First choice within 60 seconds of reading
 * - Average gap between choices <= 90 seconds
 *
 * Uses pure calculation based on word count and WPM.
 */

import { TimingMetadata } from '../../types';
import {
  ValidationIssue,
  ChoiceDensityMetrics,
  ChoiceDensityValidationResult,
  ChoiceDensityInput,
  ValidationConfig,
} from '../../types/validation';
import { CHOICE_DENSITY_DEFAULTS } from '../../constants/validation';

// Reading speed in words per minute (average adult)
const WORDS_PER_MINUTE = 200;

export interface BeatWithTiming {
  id: string;
  text: string;
  isChoicePoint?: boolean;
  timing: TimingMetadata;
}

export interface SceneWithTiming {
  id: string;
  beats: BeatWithTiming[];
}

export class ChoiceDensityValidator {
  private config: ValidationConfig['rules']['choiceDensity'];

  constructor(config?: Partial<ValidationConfig['rules']['choiceDensity']>) {
    this.config = {
      enabled: true,
      level: 'warning',
      firstChoiceMaxSeconds: CHOICE_DENSITY_DEFAULTS.firstChoiceMaxSeconds,
      averageGapMaxSeconds: CHOICE_DENSITY_DEFAULTS.averageGapMaxSeconds,
      ...config,
    };
  }

  /**
   * Calculate reading time for a given text
   */
  calculateReadingTime(text: string): number {
    const wordCount = this.countWords(text);
    return (wordCount / WORDS_PER_MINUTE) * 60; // Convert to seconds
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Annotate beats with timing metadata
   */
  annotateBeatsWithTiming(beats: Array<{ id: string; text: string; isChoicePoint?: boolean }>): BeatWithTiming[] {
    let cumulativeSeconds = 0;

    return beats.map(beat => {
      const wordCount = this.countWords(beat.text);
      const readingTimeSeconds = this.calculateReadingTime(beat.text);
      cumulativeSeconds += readingTimeSeconds;

      return {
        ...beat,
        timing: {
          estimatedReadingTimeSeconds: readingTimeSeconds,
          wordCount,
          isChoicePoint: beat.isChoicePoint || false,
          cumulativeSeconds,
        },
      };
    });
  }

  /**
   * Annotate scenes with timing metadata
   */
  annotateScenesWithTiming(scenes: ChoiceDensityInput['scenes']): SceneWithTiming[] {
    let globalCumulativeSeconds = 0;

    return scenes.map(scene => {
      const beatsWithTiming = scene.beats.map(beat => {
        const wordCount = this.countWords(beat.text);
        const readingTimeSeconds = this.calculateReadingTime(beat.text);
        globalCumulativeSeconds += readingTimeSeconds;

        return {
          ...beat,
          timing: {
            estimatedReadingTimeSeconds: readingTimeSeconds,
            wordCount,
            isChoicePoint: beat.isChoicePoint || false,
            cumulativeSeconds: globalCumulativeSeconds,
          },
        };
      });

      return {
        id: scene.id,
        beats: beatsWithTiming,
      };
    });
  }

  /**
   * Validate choice density across scenes
   */
  async validate(input: ChoiceDensityInput): Promise<ChoiceDensityValidationResult> {
    const issues: ValidationIssue[] = [];

    // Annotate all scenes with timing
    const scenesWithTiming = this.annotateScenesWithTiming(input.scenes);

    // Collect all beats with timing across all scenes
    const allBeats = scenesWithTiming.flatMap(scene => scene.beats);

    // Find all choice points
    const choicePoints = allBeats.filter(beat => beat.isChoicePoint);

    // Calculate metrics
    const totalReadingTimeSeconds = allBeats.length > 0
      ? allBeats[allBeats.length - 1].timing.cumulativeSeconds
      : 0;

    const choiceCount = choicePoints.length;

    // Find first choice timing
    const firstChoiceSeconds = choicePoints.length > 0
      ? choicePoints[0].timing.cumulativeSeconds
      : totalReadingTimeSeconds;

    // Calculate gaps between choices
    const gaps: number[] = [];
    for (let i = 1; i < choicePoints.length; i++) {
      const gap = choicePoints[i].timing.cumulativeSeconds - choicePoints[i - 1].timing.cumulativeSeconds;
      gaps.push(gap);
    }

    // Add initial gap (time to first choice)
    if (choicePoints.length > 0) {
      gaps.unshift(firstChoiceSeconds);
    }

    const averageGapSeconds = gaps.length > 0
      ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
      : totalReadingTimeSeconds;

    const longestGapSeconds = gaps.length > 0
      ? Math.max(...gaps)
      : totalReadingTimeSeconds;

    // Build metrics
    const metrics: ChoiceDensityMetrics = {
      totalReadingTimeSeconds,
      choiceCount,
      averageGapSeconds,
      firstChoiceSeconds,
      longestGapSeconds,
      beatsWithTiming: allBeats.map(beat => ({
        beatId: beat.id,
        timing: beat.timing,
      })),
    };

    // Check first choice timing (cap)
    if (firstChoiceSeconds > this.config.firstChoiceMaxSeconds) {
      issues.push({
        category: 'choice_density',
        level: this.config.level,
        message: `First choice appears at ${Math.round(firstChoiceSeconds)}s, exceeds ${this.config.firstChoiceMaxSeconds}s cap`,
        location: {
          beatId: choicePoints[0]?.id,
        },
        suggestion: `Consider adding an earlier choice point—cap is ${this.config.firstChoiceMaxSeconds}s`,
      });
    }

    // Check average gap (cap)
    if (averageGapSeconds > this.config.averageGapMaxSeconds) {
      issues.push({
        category: 'choice_density',
        level: this.config.level,
        message: `Average gap between choices is ${Math.round(averageGapSeconds)}s, exceeds ${this.config.averageGapMaxSeconds}s cap`,
        location: {},
        suggestion: `Consider adding more choice points—cap is ${this.config.averageGapMaxSeconds}s`,
      });
    }

    // Check for very long gaps
    const veryLongGapThreshold = this.config.averageGapMaxSeconds * 1.5;
    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i] > veryLongGapThreshold) {
        const afterBeatId = i === 0 ? 'start' : choicePoints[i - 1]?.id;
        const beforeBeatId = choicePoints[i]?.id;
        issues.push({
          category: 'choice_density',
          level: 'suggestion',
          message: `Long gap of ${Math.round(gaps[i])}s between choices`,
          location: {
            beatId: beforeBeatId,
          },
          suggestion: `Consider adding a choice point between "${afterBeatId}" and "${beforeBeatId}"`,
        });
      }
    }

    // Check for no choices - this is a critical error for interactive fiction
    if (choiceCount === 0) {
      issues.push({
        category: 'choice_density',
        level: 'error',
        message: `No choice points found in episode - interactive fiction requires player choices`,
        location: {},
        suggestion: `Add branching or dilemma choices to give players agency`,
      });
    }

    // Determine if validation passed
    const hasBlockingIssues = issues.some(i => i.level === 'error');
    const hasWarnings = issues.some(i => i.level === 'warning');

    return {
      passed: !hasBlockingIssues && (this.config.level !== 'warning' || !hasWarnings),
      metrics,
      issues,
    };
  }

  /**
   * Get timing metadata for a single beat
   */
  getTimingForBeat(text: string, cumulativeSecondsBefore: number = 0): TimingMetadata {
    const wordCount = this.countWords(text);
    const readingTimeSeconds = this.calculateReadingTime(text);

    return {
      estimatedReadingTimeSeconds: readingTimeSeconds,
      wordCount,
      isChoicePoint: false,
      cumulativeSeconds: cumulativeSecondsBefore + readingTimeSeconds,
    };
  }
}
