import type {
  EncounterStoryCircleTarget,
  StoryCircleBeat,
  StoryCircleRoleAssignment,
} from '../../types/sourceAnalysis';

export const ENCOUNTER_STORY_CIRCLE_TARGETS: readonly EncounterStoryCircleTarget[] = [
  'go',
  'search',
  'find',
  'take',
] as const;

const TARGET_SET = new Set<string>(ENCOUNTER_STORY_CIRCLE_TARGETS);

const TARGET_BY_EPISODE_BEAT: Partial<Record<StoryCircleBeat, EncounterStoryCircleTarget>> = {
  you: 'go',
  need: 'go',
  go: 'go',
  search: 'search',
  find: 'find',
  take: 'take',
  return: 'take',
  change: 'take',
};

const KEYWORDS_BY_TARGET: Record<EncounterStoryCircleTarget, readonly string[]> = {
  go: [
    'threshold',
    'cross',
    'enter',
    'commit',
    'forced',
    'retreat',
    'unknown',
    'unfamiliar',
    'new rule',
    'old rule',
    'arrival',
    'exposed',
  ],
  search: [
    'adapt',
    'test',
    'trial',
    'fail',
    'learn',
    'improvise',
    'pressure',
    'ally',
    'tool',
    'skill',
    'rule',
    'investigate',
  ],
  find: [
    'find',
    'gets',
    'gain',
    'obtain',
    'discover',
    'answer',
    'access',
    'proof',
    'rescue',
    'power',
    'victory',
    'reveal',
  ],
  take: [
    'cost',
    'price',
    'loss',
    'sacrifice',
    'wound',
    'rupture',
    'exposure',
    'compromise',
    'depletion',
    'failure',
    'truth',
    'betray',
  ],
};

export function isEncounterStoryCircleTarget(value: unknown): value is EncounterStoryCircleTarget {
  return typeof value === 'string' && TARGET_SET.has(value);
}

export function normalizeEncounterStoryCircleTarget(
  value: unknown,
  episodeStoryCircleRole?: StoryCircleRoleAssignment[],
  textHint?: string,
): EncounterStoryCircleTarget {
  if (isEncounterStoryCircleTarget(value)) return value;

  const lowerText = String(textHint || '').toLowerCase();
  const inferencePriority: readonly EncounterStoryCircleTarget[] = ['take', 'go', 'search', 'find'];
  for (const target of inferencePriority) {
    if (KEYWORDS_BY_TARGET[target].some((keyword) => lowerText.includes(keyword))) {
      return target;
    }
  }

  const primaryRole = episodeStoryCircleRole?.find((role) => role.roleKind !== 'expansion')
    ?? episodeStoryCircleRole?.[0];
  return TARGET_BY_EPISODE_BEAT[primaryRole?.beat ?? 'search'] ?? 'search';
}

export function describeEncounterStoryCircleTarget(target: EncounterStoryCircleTarget): string {
  switch (target) {
    case 'go':
      return 'forces commitment across a threshold into unfamiliar rules where retreat is harder';
    case 'search':
      return 'tests adaptation under pressure: plans fail, rules are learned, allies/tools/skills are tested, and choices expose identity';
    case 'find':
      return 'grants the wanted thing, answer, access, proof, rescue, power, status, or apparent victory while exposing the next problem';
    case 'take':
      return 'demands payment for the want or prize: cost, loss, wound, exposure, rupture, depletion, compromise, or painful truth';
  }
}

export function buildEncounterStoryCircleTargetRationale(
  target: EncounterStoryCircleTarget,
  episodeStoryCircleRole?: StoryCircleRoleAssignment[],
  description?: string,
): string {
  const roles = episodeStoryCircleRole?.map((role) => role.beat).join(', ') || 'no supplied episode role';
  const base = describeEncounterStoryCircleTarget(target);
  const anchor = description?.trim()
    ? ` Encounter anchor: ${description.trim()}`
    : '';
  return `Target \`${target}\` because this encounter ${base}. Episode Story Circle role(s): ${roles}.${anchor}`;
}

export function formatEncounterStoryCircleTargetCriteria(): string {
  return [
    'Choose `go` when the encounter forces commitment: threshold crossing, new arena/rules, retreat harder, or irreversible exposure.',
    'Choose `search` when the encounter tests adaptation: failed or stressed plans, learned rules, improvised tactics, tested allies/tools/skills, or identity exposed under pressure.',
    'Choose `find` when the encounter grants the wanted thing: answer, access, proof, rescue, power, status, intimacy, or apparent victory that exposes the next problem.',
    'Choose `take` when the encounter demands payment: cost, loss, wound, rupture, public exposure, depletion, moral compromise, apparent failure, or painful truth.',
    'Tie-breakers: explicit treatment/source anchor first; then the episode Story Circle role; then the protagonist change required by the episode; then the cliffhanger handoff into the next `need` or `go`; then season pacing and variety.',
    'Allowed compound movement: `go -> search`, `search -> find`, `find -> take`, or `take -> next need/go via cliffhanger`. Still choose one primary target.',
  ].join('\n');
}
