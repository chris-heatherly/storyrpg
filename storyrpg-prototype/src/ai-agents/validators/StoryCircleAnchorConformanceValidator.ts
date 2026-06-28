/**
 * Story Circle Anchor Conformance Validator
 *
 * Asserts authored Story Circle beat→episode anchors survive the season plan.
 * This validator only reads direct Story Circle roles.
 */

import {
  STORY_CIRCLE_BEATS,
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StructuralRole,
} from '../../types/sourceAnalysis';
import { SeasonPlan } from '../../types/seasonPlan';
import { legacyRoleToStoryCircleBeats } from '../utils/storyCircleDistribution';
import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
} from './BaseValidator';

const BEAT_SET = new Set<string>(STORY_CIRCLE_BEATS as readonly string[]);

function isStoryCircleBeat(beat: string): beat is StoryCircleBeat {
  return BEAT_SET.has(beat);
}

export interface StoryCircleAnchorEpisode {
  episodeNumber: number;
  storyCircleRole?: StoryCircleRoleAssignment[];
}

export interface StoryCircleAnchorConformanceInput {
  storyCircleBeatEpisodeAnchors?: Partial<Record<StoryCircleBeat, number>>;
  episodes: StoryCircleAnchorEpisode[];
}

function legacyStructuralRoleToStoryCircleRole(
  structuralRole: unknown,
): StoryCircleRoleAssignment[] {
  const roles = Array.isArray(structuralRole)
    ? structuralRole
    : typeof structuralRole === 'string'
      ? [structuralRole]
      : [];
  const mapped: StoryCircleRoleAssignment[] = [];
  for (const role of roles) {
    if (typeof role !== 'string') continue;
    for (const beat of legacyRoleToStoryCircleBeats(role as StructuralRole)) {
      if (!mapped.some((existing) => existing.beat === beat)) {
        mapped.push({ beat, roleKind: 'primary', source: 'migration' });
      }
    }
  }
  return mapped;
}

export function seasonPlanToStoryCircleAnchorConformanceInput(
  plan: SeasonPlan,
  storyCircleBeatEpisodeAnchors: Partial<Record<StoryCircleBeat, number>> | undefined,
): StoryCircleAnchorConformanceInput {
  return {
    storyCircleBeatEpisodeAnchors,
    episodes: plan.episodes.map((ep) => {
      const storyCircleRole = ep.storyCircleRole?.length
        ? ep.storyCircleRole
        : legacyStructuralRoleToStoryCircleRole((ep as { structuralRole?: unknown }).structuralRole);
      return {
        episodeNumber: ep.episodeNumber,
        storyCircleRole,
      };
    }),
  };
}

export class StoryCircleAnchorConformanceValidator extends BaseValidator {
  constructor() {
    super('StoryCircleAnchorConformanceValidator');
  }

  validate(input: StoryCircleAnchorConformanceInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const anchors = input.storyCircleBeatEpisodeAnchors;
    if (!anchors || Object.keys(anchors).length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    const episodes = input.episodes.map((episode) => ({
      ...episode,
      storyCircleRole: episode.storyCircleRole ?? [],
    }));
    const byNumber = new Map<number, StoryCircleAnchorEpisode & { storyCircleRole: StoryCircleRoleAssignment[] }>();
    for (const ep of episodes) byNumber.set(ep.episodeNumber, ep);

    const carriersByBeat = new Map<StoryCircleBeat, number[]>();
    for (const ep of episodes) {
      for (const role of ep.storyCircleRole || []) {
        if (!isStoryCircleBeat(role.beat) || role.roleKind === 'expansion') continue;
        const list = carriersByBeat.get(role.beat) || [];
        list.push(ep.episodeNumber);
        carriersByBeat.set(role.beat, list);
      }
    }

    for (const beatKey of Object.keys(anchors)) {
      if (!isStoryCircleBeat(beatKey)) continue;
      const beat = beatKey;
      const anchoredEpisode = anchors[beat];
      if (typeof anchoredEpisode !== 'number' || !Number.isFinite(anchoredEpisode)) continue;

      const targetEpisode = byNumber.get(anchoredEpisode);
      if (!targetEpisode) {
        issues.push(this.error(
          `Authored Story Circle anchor places beat "${beat}" on Ep${anchoredEpisode}, but the final season has no episode ${anchoredEpisode}.`,
          `season.episodes[${anchoredEpisode}]`,
          'The episode an authored beat was anchored to must survive into the final season.',
        ));
        continue;
      }

      const carriers = carriersByBeat.get(beat) || [];
      const carriedByAnchored = (targetEpisode.storyCircleRole || []).some(
        (role) => role.beat === beat && role.roleKind !== 'expansion',
      );

      if (!carriedByAnchored) {
        if (carriers.length === 0) {
          issues.push(this.warning(
            `Authored Story Circle beat "${beat}" is anchored to Ep${anchoredEpisode} but no episode in the final season carries it as a primary beat.`,
            `season.episodes[${anchoredEpisode}].storyCircleRole`,
            `Assign primary Story Circle beat "${beat}" to episode ${anchoredEpisode}.`,
          ));
        } else {
          issues.push(this.error(
            `Authored Story Circle beat "${beat}" is anchored to Ep${anchoredEpisode}, but the final season places it on Ep${carriers.join(', Ep')} instead.`,
            `season.episodes[${anchoredEpisode}].storyCircleRole`,
            `Move Story Circle beat "${beat}" back onto episode ${anchoredEpisode}; authored anchors are the spine of record.`,
          ));
        }
        continue;
      }

      const duplicateCarriers = carriers.filter((epNum) => epNum !== anchoredEpisode);
      if (duplicateCarriers.length > 0) {
        issues.push(this.error(
          `Authored Story Circle beat "${beat}" is anchored to Ep${anchoredEpisode}, but it is also carried by Ep${duplicateCarriers.join(', Ep')}.`,
          `season.episodes[${anchoredEpisode}].storyCircleRole`,
          'Do not duplicate a primary authored Story Circle beat onto another episode; use roleKind "expansion" for extra contiguous units.',
        ));
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 30 - warningCount * 5);
    return {
      valid: errorCount === 0,
      score,
      issues,
      suggestions: [],
    };
  }
}
