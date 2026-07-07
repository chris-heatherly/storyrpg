import type {
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type { StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import { storyCircleRoleBeats } from '../utils/storyCircleDistribution';

export interface EpisodeStoryCircleScene {
  id: string;
  narrativeRole?: string;
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
}

export interface EpisodeStoryCircleInput {
  episodeNumber: number;
  episodeCircle?: Partial<StoryCircleStructure>;
  storyCircleRole?: StoryCircleRoleAssignment[];
  scenes: EpisodeStoryCircleScene[];
}

// Whole-value placeholders only — prose that merely contains "unknown"
// ("an unknown payout") is a real beat, not a placeholder (live-run FP class,
// see DramaticStructureValidator). "same as …" stays an embedded check: a
// beat that defers to another beat is a placeholder wherever it appears.
const WHOLE_PLACEHOLDER_RE = /^\s*(?:tbd|todo|placeholder|unknown|not specified|n\/a)\s*[.!?…-]*\s*$/i;
const EMBEDDED_PLACEHOLDER_RE = /\bsame\s+as\b/i;
const WORD_RE = /[a-z0-9']+/gi;
const PAIRS: Array<[StoryCircleBeat, StoryCircleBeat, string]> = [
  ['you', 'find', '`find` should contrast the starting pressure in `you` with the wanted thing or answer obtained.'],
  ['need', 'take', '`take` should answer `need` by making the want or lack cost something.'],
  ['go', 'return', '`return` should carry the prize or wound back toward the threshold crossed in `go`.'],
  ['search', 'change', '`change` should prove the transformation produced by adaptation under pressure in `search`.'],
];

export function hasConcreteStoryCircleBeatText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length >= 8
    && !WHOLE_PLACEHOLDER_RE.test(value)
    && !EMBEDDED_PLACEHOLDER_RE.test(value);
}

function hasConcreteText(value: unknown): value is string {
  return hasConcreteStoryCircleBeatText(value);
}

function normalizedText(value: string): string {
  return (value.match(WORD_RE) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !/^(a|an|the|of|and|or|to|in|on|at|for|with|from|by|this|that|episode|story|beat)$/i.test(word))
    .join(' ');
}

function wordOverlap(left: string, right: string): number {
  const l = new Set(normalizedText(left).split(/\s+/).filter(Boolean));
  const r = new Set(normalizedText(right).split(/\s+/).filter(Boolean));
  if (l.size === 0 || r.size === 0) return 0;
  let overlap = 0;
  for (const word of l) if (r.has(word)) overlap += 1;
  return overlap / Math.min(l.size, r.size);
}

function allContractsFor(input: EpisodeStoryCircleInput): StoryCircleBeatRealizationContract[] {
  const byId = new Map<string, StoryCircleBeatRealizationContract>();
  for (const scene of input.scenes ?? []) {
    for (const contract of scene.storyCircleBeatContracts ?? []) {
      byId.set(contract.id, contract);
    }
  }
  return Array.from(byId.values());
}

export class EpisodeStoryCircleValidator extends BaseValidator {
  constructor() {
    super('EpisodeStoryCircleValidator');
  }

  validate(input: EpisodeStoryCircleInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const contracts = allContractsFor(input);

    this.checkBeatText(input, issues);
    this.checkDuplicateBeatText(input, issues);
    this.checkPolarity(input, issues);
    this.checkContractBindings(input, contracts, issues);
    this.checkMacroRoleRealization(input, contracts, issues);
    this.checkEndingPlacement(input, contracts, issues);

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 20 - warnings * 5),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }

  private activeBeats(input: EpisodeStoryCircleInput): StoryCircleBeat[] {
    const roleBeats = new Set(storyCircleRoleBeats(input.storyCircleRole));
    if (roleBeats.size === 0) return [...STORY_CIRCLE_BEATS];
    return STORY_CIRCLE_BEATS.filter((beat) => {
      if (roleBeats.has(beat)) return true;
      const value = input.episodeCircle?.[beat];
      if (typeof value === 'string' && value.trim().length > 0) return true;
      return hasConcreteText(value);
    });
  }

  private checkBeatText(input: EpisodeStoryCircleInput, issues: ValidationIssue[]): void {
    for (const beat of this.activeBeats(input)) {
      const value = input.episodeCircle?.[beat];
      if (!hasConcreteText(value)) {
        issues.push(this.error(
          `Episode ${input.episodeNumber} episodeCircle beat "${beat}" is missing, too short, or placeholder text.`,
          `episodeCircle.${beat}`,
          'Every episode must complete a concrete local Story Circle loop, even when it carries only one macro season beat.',
        ));
      }
    }
  }

  private checkDuplicateBeatText(input: EpisodeStoryCircleInput, issues: ValidationIssue[]): void {
    const active = new Set(this.activeBeats(input));
    const seen = new Map<string, StoryCircleBeat>();
    for (const beat of STORY_CIRCLE_BEATS) {
      if (!active.has(beat)) continue;
      const text = input.episodeCircle?.[beat];
      if (!hasConcreteText(text)) continue;
      const normalized = normalizedText(text);
      if (normalized.split(/\s+/).filter(Boolean).length < 4) continue;
      const existing = seen.get(normalized);
      if (existing) {
        issues.push(this.error(
          `Episode ${input.episodeNumber} episodeCircle beats "${existing}" and "${beat}" repeat the same structural text.`,
          `episodeCircle.${beat}`,
          'Each local Story Circle beat needs a distinct function: pressure, threshold, adaptation, prize, cost, return, or changed state.',
        ));
      } else {
        seen.set(normalized, beat);
      }
    }
  }

  private checkPolarity(input: EpisodeStoryCircleInput, issues: ValidationIssue[]): void {
    const active = new Set(this.activeBeats(input));
    for (const [left, right, suggestion] of PAIRS) {
      if (!active.has(left) || !active.has(right)) continue;
      const leftText = input.episodeCircle?.[left];
      const rightText = input.episodeCircle?.[right];
      if (!hasConcreteText(leftText) || !hasConcreteText(rightText)) continue;
      if (wordOverlap(leftText, rightText) > 0.85) {
        issues.push(this.warning(
          `Episode ${input.episodeNumber} episodeCircle beats "${left}" and "${right}" read as the same beat instead of a polarity pair.`,
          `episodeCircle.${left} vs episodeCircle.${right}`,
          suggestion,
        ));
      }
    }
  }

  private checkContractBindings(
    input: EpisodeStoryCircleInput,
    contracts: StoryCircleBeatRealizationContract[],
    issues: ValidationIssue[],
  ): void {
    const sceneIds = new Set((input.scenes ?? []).map((scene) => scene.id));
    const active = new Set(this.activeBeats(input));
    for (const beat of STORY_CIRCLE_BEATS) {
      if (!active.has(beat)) continue;
      if (!hasConcreteText(input.episodeCircle?.[beat])) continue;
      const beatContracts = contracts.filter((contract) =>
        contract.beat === beat
        && contract.blockingLevel === 'structural'
        && contract.targetEpisodeNumber === input.episodeNumber
      );
      const bound = beatContracts.some((contract) =>
        contract.targetSceneIds.some((sceneId) => sceneIds.has(sceneId))
      );
      if (!bound) {
        issues.push(this.error(
          `Episode ${input.episodeNumber} episodeCircle beat "${beat}" is not bound to any scene via storyCircleBeatContracts.`,
          `episodeCircle.${beat}`,
          'Build structural Story Circle contracts before blueprint validation so each episode beat has a concrete scene target.',
        ));
      }
    }
  }

  private checkMacroRoleRealization(
    input: EpisodeStoryCircleInput,
    contracts: StoryCircleBeatRealizationContract[],
    issues: ValidationIssue[],
  ): void {
    const roles = input.storyCircleRole ?? [];
    for (const role of roles) {
      if (!role?.beat) continue;
      const realized = contracts.some((contract) =>
        contract.beat === role.beat
        && contract.blockingLevel === 'structural'
        && contract.targetEpisodeNumber === input.episodeNumber
        && contract.targetSceneIds.length > 0
      );
      if (!realized) {
        issues.push(this.error(
          `Episode ${input.episodeNumber} carries season Story Circle beat "${role.beat}" but no local scene contract realizes that macro role.`,
          `episode.storyCircleRole.${role.beat}`,
          'Bind the macro season beat to a local episode scene turn, choice, reveal, cost, ending state, or handoff.',
        ));
      }
    }
  }

  private checkEndingPlacement(
    input: EpisodeStoryCircleInput,
    contracts: StoryCircleBeatRealizationContract[],
    issues: ValidationIssue[],
  ): void {
    const scenes = input.scenes ?? [];
    if (scenes.length === 0) return;
    const finalSceneId = scenes[scenes.length - 1].id;
    const releaseSceneIds = new Set(scenes.filter((scene) => scene.narrativeRole === 'release').map((scene) => scene.id));
    for (const beat of ['return', 'change'] as const) {
      const beatContracts = contracts.filter((contract) =>
        contract.beat === beat
        && contract.blockingLevel === 'structural'
        && contract.targetEpisodeNumber === input.episodeNumber
      );
      if (beatContracts.length === 0) continue;
      const landsOnEndingPressure = beatContracts.some((contract) =>
        contract.targetSceneIds.some((sceneId) => sceneId === finalSceneId || releaseSceneIds.has(sceneId))
      );
      if (!landsOnEndingPressure) {
        issues.push(this.error(
          `Episode ${input.episodeNumber} episodeCircle beat "${beat}" is not assigned to the final aftermath, release, consequence, or handoff scene.`,
          `episodeCircle.${beat}`,
          '`return` and `change` must land as episode ending pressure, not as metadata-only labels in an earlier setup scene.',
        ));
      }
    }
  }
}
