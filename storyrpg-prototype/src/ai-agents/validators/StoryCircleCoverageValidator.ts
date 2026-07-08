/**
 * Story Circle Coverage Validator
 *
 * Deterministic gate on the season's eight-beat Story Circle structure.
 * New generation must provide Story Circle fields directly; legacy structures
 * are not migrated here.
 */

import {
  STORY_CIRCLE_BEATS,
  StoryAnchors,
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
  StoryEndingTarget,
} from '../../types/sourceAnalysis';
import { SeasonPlan } from '../../types/seasonPlan';
import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildFailureResult,
} from './BaseValidator';
import {
  checkStoryCircleCoverage,
} from '../utils/storyCircleDistribution';

const BEAT_TO_EXPECTED_TIERS: Record<StoryCircleBeat, readonly string[]> = {
  you: ['introduction'],
  need: ['introduction', 'rising'],
  go: ['introduction', 'rising'],
  search: ['rising', 'peak'],
  find: ['peak'],
  take: ['peak', 'finale'],
  return: ['falling', 'finale'],
  change: ['falling', 'finale'],
};

export interface StoryCircleCoverageInput {
  anchors?: StoryAnchors;
  storyCircle?: StoryCircleStructure;
  episodes: Array<{
    episodeNumber: number;
    storyCircleRole?: StoryCircleRoleAssignment[];
    difficultyTier?: string;
  }>;
  resolvedEndings?: StoryEndingTarget[];
}

export function seasonPlanToStoryCircleCoverageInput(plan: SeasonPlan): StoryCircleCoverageInput {
  return {
    anchors: plan.anchors,
    storyCircle: plan.storyCircle,
    episodes: plan.episodes.map((ep) => ({
      episodeNumber: ep.episodeNumber,
      storyCircleRole: ep.storyCircleRole,
      difficultyTier: (ep as unknown as { difficultyTier?: string }).difficultyTier,
    })),
    resolvedEndings: plan.resolvedEndings,
  };
}

export class StoryCircleCoverageValidator extends BaseValidator {
  constructor() {
    super('StoryCircleCoverageValidator');
  }

  validate(input: StoryCircleCoverageInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    this.checkAnchors(input.anchors, issues);
    this.checkStoryCircle(input.storyCircle, issues);

    const normalizedEpisodes = input.episodes.map((episode) => ({
      ...episode,
      storyCircleRole: normalizeRolesForEpisode(episode.storyCircleRole),
    }));

    for (const msg of checkStoryCircleCoverage(normalizedEpisodes)) {
      issues.push(this.error(msg, 'season.episodes.storyCircleRole'));
    }

    this.checkCircleShape(input.storyCircle, issues);
    this.checkPolarityPairs(input.storyCircle, issues);
    this.checkDifficultyTierAlignment(normalizedEpisodes, issues);
    this.checkEndingStakesLinkage(input.anchors, input.resolvedEndings, issues);

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
          'Every anchor must be a concrete 1-2 sentence reference point downstream agents can stage.',
        ));
      }
    }
  }

  private checkStoryCircle(storyCircle: StoryCircleStructure | undefined, issues: ValidationIssue[]): void {
    if (!storyCircle) {
      issues.push(this.error('Season storyCircle block is missing entirely.', 'season.storyCircle'));
      return;
    }
    for (const beat of STORY_CIRCLE_BEATS) {
      const value = storyCircle[beat];
      if (typeof value !== 'string' || value.trim().length < 3) {
        issues.push(this.error(
          `Beat "${beat}" in season.storyCircle is missing or too short.`,
          `season.storyCircle.${beat}`,
        ));
        continue;
      }
      if (isVagueBeatText(value)) {
        issues.push(this.warning(
          `Beat "${beat}" in season.storyCircle is probably too vague to guide generation.`,
          `season.storyCircle.${beat}`,
          'Rewrite this beat as a concrete source-specific event, pressure, cost, or state change that satisfies the full canonical definition.',
        ));
      }
    }
  }

  private checkPolarityPairs(storyCircle: StoryCircleStructure | undefined, issues: ValidationIssue[]): void {
    if (!storyCircle) return;
    const pairs: Array<[StoryCircleBeat, StoryCircleBeat, string]> = [
      ['you', 'find', '`find` must contrast the starting comfort/known-world footing in `you` with the thing obtained in the unfamiliar world.'],
      ['need', 'take', '`take` must answer `need`: the price should expose the cost of the want/lack.'],
      ['go', 'return', '`return` must bring the prize/wound back toward the world or consequence field crossed into by `go`.'],
      ['search', 'change', '`change` must prove the permanent transformation produced by the adaptation pressure of `search`.'],
    ];
    for (const [left, right, suggestion] of pairs) {
      const leftText = storyCircle[left];
      const rightText = storyCircle[right];
      if (!leftText || !rightText) continue;
      const overlap = wordOverlap(leftText, rightText);
      if (overlap > 0.85 && leftText.trim().length > 0 && rightText.trim().length > 0) {
        issues.push(this.error(
          `Story Circle beats "${left}" and "${right}" appear to repeat the same text instead of forming a polarity pair.`,
          `season.storyCircle.${left} vs season.storyCircle.${right}`,
          suggestion,
        ));
      }
    }
  }

  private checkCircleShape(storyCircle: StoryCircleStructure | undefined, issues: ValidationIssue[]): void {
    if (!storyCircle) return;

    const expectations: Array<{
      beat: StoryCircleBeat;
      keywords: readonly string[];
      message: string;
      suggestion: string;
    }> = [
      {
        beat: 'you',
        keywords: KNOWN_WORLD_KEYWORDS,
        message: '`you` does not clearly establish the ordered/familiar known-world pressure.',
        suggestion: 'Show home, routine, comfort, status quo, identity mask, default behavior, recurring pressure, or what normal costs the protagonist.',
      },
      {
        beat: 'need',
        keywords: NEED_KEYWORDS,
        message: '`need` does not clearly name the want/lack that starts motion.',
        suggestion: 'Name the conscious want and, when relevant, the deeper dramatic need or unanswered pressure.',
      },
      {
        beat: 'go',
        keywords: DESCENT_KEYWORDS,
        message: '`go` does not clearly function as the descent crossing into unfamiliar rules.',
        suggestion: 'Make the threshold crossing visible: enter the unknown physically, socially, emotionally, morally, or informationally, with retreat made harder.',
      },
      {
        beat: 'search',
        keywords: ADAPTATION_KEYWORDS,
        message: '`search` does not clearly show adaptation under pressure in the unfamiliar world.',
        suggestion: 'Show failed plans, learned rules, tested allies/tools, exposed identity choices, or changed behavior under pressure.',
      },
      {
        beat: 'find',
        keywords: ACQUISITION_KEYWORDS,
        message: '`find` does not clearly stage the wanted acquisition, answer, access, proof, power, rescue, status, or apparent victory.',
        suggestion: 'Make the deep-bottom acquisition concrete and show how it reveals the real problem or makes the cost unavoidable.',
      },
      {
        beat: 'take',
        keywords: COST_KEYWORDS,
        message: '`take` does not clearly demand a price for `find`.',
        suggestion: 'Name the sacrifice, loss, wound, compromise, rupture, exposure, depletion, identity cost, death, or painful truth caused by the prize.',
      },
      {
        beat: 'return',
        keywords: RETURN_KEYWORDS,
        message: '`return` does not clearly function as the return crossing with prize and wound.',
        suggestion: 'Carry the result of the unknown world back toward home, the original arena, public identity, a relationship, or the consequence field under reintegration pressure.',
      },
      {
        beat: 'change',
        keywords: TRANSFORMATION_KEYWORDS,
        message: '`change` does not clearly prove a new equilibrium or transformed/refused self.',
        suggestion: 'Show changed behavior, relationship, self-concept, world-state, or tragic refusal. This ending becomes the next loop\'s new `you`.',
      },
    ];

    for (const expectation of expectations) {
      const value = storyCircle[expectation.beat];
      if (!value || containsAnyKeyword(value, expectation.keywords)) continue;
      issues.push(this.warning(
        expectation.message,
        `season.storyCircle.${expectation.beat}`,
        expectation.suggestion,
      ));
    }

    const you = storyCircle.you;
    const change = storyCircle.change;
    if (you && change) {
      const overlap = wordOverlap(you, change);
      if (overlap > 0.85) {
        issues.push(this.warning(
          '`change` appears to repeat `you` instead of returning with a difference.',
          'season.storyCircle.you vs season.storyCircle.change',
          '`change` must rhyme with `you`: same world or pressure, different person or meaning.',
        ));
      } else if (overlap < 0.06) {
        issues.push(this.warning(
          '`change` does not clearly rhyme with `you` as a return-with-difference ending.',
          'season.storyCircle.you vs season.storyCircle.change',
          'Echo the starting world, pressure, relationship, arena, or identity question while proving how the protagonist or meaning has changed.',
        ));
      }
    }
  }

  private checkDifficultyTierAlignment(
    episodes: Array<{
      episodeNumber: number;
      storyCircleRole?: StoryCircleRoleAssignment[];
      difficultyTier?: string;
    }>,
    issues: ValidationIssue[],
  ): void {
    for (const ep of episodes) {
      if (!ep.difficultyTier || !ep.storyCircleRole?.length) continue;
      for (const role of ep.storyCircleRole) {
        const expected = BEAT_TO_EXPECTED_TIERS[role.beat];
        if (!expected || expected.includes(ep.difficultyTier)) continue;
        issues.push(this.warning(
          `Episode ${ep.episodeNumber} carries Story Circle beat "${role.beat}" but has difficultyTier "${ep.difficultyTier}".`,
          `season.episodes[${ep.episodeNumber}].difficultyTier`,
          `Expected one of: ${expected.join(', ')}.`,
        ));
      }
    }
  }

  private checkEndingStakesLinkage(
    anchors: StoryAnchors | undefined,
    endings: StoryEndingTarget[] | undefined,
    issues: ValidationIssue[],
  ): void {
    if (!anchors?.stakes || !endings?.length) return;
    const stakesTokens = tokenize(anchors.stakes);
    if (stakesTokens.size === 0) return;
    const hasLinkedEnding = endings.some((ending) => {
      const text = [
        ending.summary,
        ending.themePayoff,
        ...ending.stateDrivers.map((driver) => `${driver.label} ${driver.details}`),
      ].join(' ');
      const endingTokens = tokenize(text);
      return [...stakesTokens].some((token) => endingTokens.has(token));
    });
    if (!hasLinkedEnding) {
      issues.push(this.warning(
        'No ending target clearly references the season Stakes anchor.',
        'season.resolvedEndings',
        'At least one ending should visibly pay off what the protagonist cared about most.',
      ));
    }
  }
}

function normalizeRolesForEpisode(
  storyCircleRole?: StoryCircleRoleAssignment[],
): StoryCircleRoleAssignment[] {
  if (storyCircleRole?.length) {
    return storyCircleRole.filter((role) =>
      role && (STORY_CIRCLE_BEATS as readonly string[]).includes(role.beat)
    );
  }
  return [];
}

function isVagueBeatText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.split(/\s+/).filter(Boolean).length < 5) return true;
  return /^(tbd|n\/a|none|unknown|change happens|they change|things escalate)$/i.test(trimmed);
}

function tokenize(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function wordOverlap(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function containsAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

const KNOWN_WORLD_KEYWORDS = [
  'home',
  'routine',
  'normal',
  'known',
  'familiar',
  'comfort',
  'status quo',
  'identity',
  'default',
  'pressure',
  'stable',
  'mask',
  'habit',
];

const NEED_KEYWORDS = [
  'want',
  'wants',
  'need',
  'needs',
  'lack',
  'hunger',
  'curiosity',
  'fear',
  'desire',
  'obligation',
  'shame',
  'ambition',
  'love',
  'survival',
  'question',
];

const DESCENT_KEYWORDS = [
  'threshold',
  'cross',
  'enter',
  'unfamiliar',
  'unknown',
  'new rule',
  'old rule',
  'retreat',
  'decision',
  'forced',
  'discover',
  'invitation',
  'threat',
  'consequence',
  'traitor',
];

const ADAPTATION_KEYWORDS = [
  'adapt',
  'trial',
  'fail',
  'fails',
  'learn',
  'learns',
  'test',
  'tested',
  'ally',
  'allies',
  'tool',
  'rules',
  'choice',
  'pressure',
  'survive',
  'improvise',
];

const ACQUISITION_KEYWORDS = [
  'get',
  'gets',
  'obtain',
  'answer',
  'access',
  'intimacy',
  'proof',
  'power',
  'rescue',
  'status',
  'victory',
  'prize',
  'find',
  'finds',
  'reveal',
  'ledger',
];

const COST_KEYWORDS = [
  'cost',
  'costs',
  'price',
  'sacrifice',
  'loss',
  'lose',
  'wound',
  'compromise',
  'rupture',
  'exposed',
  'exposure',
  'depletion',
  'identity',
  'death',
  'truth',
  'impossible',
];

const RETURN_KEYWORDS = [
  'return',
  'returns',
  'back',
  'home',
  'original',
  'arena',
  'relationship',
  'public',
  'identity',
  'consequence',
  'carry',
  'carries',
  'prize',
  'wound',
  'reintegration',
  'toward',
];

const TRANSFORMATION_KEYWORDS = [
  'change',
  'changes',
  'changed',
  'new equilibrium',
  'new',
  'no longer',
  'proves',
  'relationship',
  'self-concept',
  'world-state',
  'refusal',
  'different',
  'public',
  'accepts',
];

const STOPWORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'into',
  'they',
  'their',
  'them',
  'then',
  'when',
  'where',
  'what',
  'which',
  'while',
  'after',
  'before',
  'because',
  'protagonist',
]);
