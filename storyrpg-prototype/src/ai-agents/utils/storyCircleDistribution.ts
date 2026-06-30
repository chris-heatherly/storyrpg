/**
 * Story Circle Distribution Helper
 *
 * Deterministically maps the eight Story Circle beats onto any number of
 * episodes or scenes. This is the canonical structural helper for generation.
 */

import type {
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';

export const STORY_CIRCLE_BEAT_DEFINITIONS: Record<StoryCircleBeat, string> = {
  you: 'The protagonist in their known world. This establishes the stable normal, comfort zone, rut, identity mask, recurring pressure, core value, and audience foothold. It is not passive exposition; it must show what “home” means, what behavior the protagonist defaults to, and what personal stake would hurt if disrupted.',
  need: 'The want or lack that starts motion. This must name both the conscious want and, when relevant, the deeper dramatic need. It should create active pressure: hunger, curiosity, fear, desire, obligation, shame, ambition, love, survival, denial, or an unanswered question. A vague “they want change” is not enough.',
  go: 'The threshold crossing. The protagonist enters an unfamiliar situation physically, socially, emotionally, morally, or informationally. Old rules stop working. This beat must be caused by a decision, forced event, discovery, invitation, refusal, threat, or consequence that makes retreat meaningfully harder.',
  search: 'Adaptation under pressure. This is the trial-and-learning zone: plans fail, new rules are learned, allies/tools are tested, choices expose identity, and the protagonist changes behavior to survive the unfamiliar world. It must not be filler escalation.',
  find: 'The protagonist gets the wanted thing, answer, access, intimacy, proof, power, rescue, status, or apparent victory. This is not the ending. It is the deep-bottom acquisition that reveals the real problem or makes the cost unavoidable.',
  take: 'The price. The story demands payment for `find`: sacrifice, loss, wound, moral compromise, relationship rupture, public exposure, resource depletion, identity cost, death symbolic or literal, or a painful truth. This beat must answer `need`; if the want cost nothing, the structure fails.',
  return: 'The road back with prize and wound. The protagonist carries the result of the unknown world back toward the known world, original arena, relationship, home, public identity, or practical consequence field. This beat must show reintegration pressure, not just travel or denouement.',
  change: 'The new equilibrium. The protagonist proves transformation through changed behavior, changed relationships, changed self-concept, changed world-state, or tragic refusal. The ending must rhyme with `you`: same world or pressure, different person/meaning. This also becomes the next loop’s new `you`.',
};

export const STORY_CIRCLE_BEAT_DEFINITION_LINES = STORY_CIRCLE_BEATS.map(
  (beat) => `\`${beat}\`: ${STORY_CIRCLE_BEAT_DEFINITIONS[beat]}`,
);

export const STORY_CIRCLE_GEOMETRY_PRINCIPLES = [
  'The Story Circle is a return-with-difference loop, not a line: the protagonist comes back to a recognizable world, pressure, relationship, arena, or identity question, but the return now means something different because the protagonist has changed.',
  '`you` and `need` establish ordered/familiar/known-world pressure: home, routine, comfort, status quo, surface identity, recurring pressure, and the want or lack that makes motion necessary.',
  '`go`, `search`, `find`, and `take` carry the unfamiliar/chaotic/special-world descent: old rules stop working, the protagonist adapts under pressure, obtains the wanted thing or answer, and pays the unavoidable price.',
  'The descent crossing happens between `need` and `go`: the want or lack must force a threshold into unfamiliar physical, social, emotional, moral, or informational rules where retreat is meaningfully harder.',
  'The return crossing happens between `take` and `return`: the price of `find` must be carried back toward the known world, original arena, home, public identity, relationship, or consequence field.',
  'The ending must rhyme with the beginning: `change` should answer `you` with the same world or pressure made different by changed behavior, changed relationships, changed self-concept, changed world-state, or tragic refusal.',
  'Polarity pairs must resonate: `you` <-> `find` contrasts starting comfort with the thing obtained; `need` <-> `take` contrasts want/lack with price; `go` <-> `return` contrasts threshold out with threshold back; `search` <-> `change` contrasts adaptation under pressure with the permanent transformation it produced.',
  'Fractal episode rule: each episode also completes its own eight-beat loop. By the episode `change`, the protagonist must be altered in behavior, relationship, self-concept, world-state, or tragic refusal; non-finale cliffhangers then tease the next episode cycle by launching the next `need` or forcing the next `go`.',
];

export interface StoryCircleDistributionEntry {
  episodeNumber: number;
  storyCircleRole: StoryCircleRoleAssignment[];
}

const SHORT_SEASON_FUSIONS: Record<number, StoryCircleBeat[][]> = {
  1: [['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change']],
  2: [
    ['you', 'need', 'go', 'search'],
    ['find', 'take', 'return', 'change'],
  ],
  3: [
    ['you', 'need'],
    ['go', 'search', 'find'],
    ['take', 'return', 'change'],
  ],
  4: [
    ['you', 'need'],
    ['go', 'search'],
    ['find', 'take'],
    ['return', 'change'],
  ],
  5: [
    ['you', 'need'],
    ['go', 'search'],
    ['find'],
    ['take', 'return'],
    ['change'],
  ],
  6: [
    ['you', 'need'],
    ['go'],
    ['search'],
    ['find'],
    ['take', 'return'],
    ['change'],
  ],
  7: [
    ['you'],
    ['need'],
    ['go'],
    ['search'],
    ['find'],
    ['take'],
    ['return', 'change'],
  ],
};

const EXPANSION_PRIORITY: StoryCircleBeat[] = [
  'search',
  'take',
  'return',
  'search',
  'take',
  'return',
  'find',
  'go',
  'you',
  'need',
  'change',
];

export function distributeStoryCircle(totalUnits: number): StoryCircleDistributionEntry[] {
  if (!Number.isFinite(totalUnits) || totalUnits < 1) {
    return [];
  }

  if (totalUnits <= 7) {
    return SHORT_SEASON_FUSIONS[totalUnits].map((beats, index) => ({
      episodeNumber: index + 1,
      storyCircleRole: beats.map((beat) => ({
        beat,
        roleKind: 'primary' as const,
        source: 'distribution' as const,
      })),
    }));
  }

  if (totalUnits === 8) {
    return STORY_CIRCLE_BEATS.map((beat, index) => ({
      episodeNumber: index + 1,
      storyCircleRole: [{
        beat,
        roleKind: 'primary' as const,
        source: 'distribution' as const,
      }],
    }));
  }

  const expansionCounts = new Map<StoryCircleBeat, number>();
  const extraCount = totalUnits - STORY_CIRCLE_BEATS.length;
  for (let i = 0; i < extraCount; i++) {
    const beat = EXPANSION_PRIORITY[i % EXPANSION_PRIORITY.length];
    expansionCounts.set(beat, (expansionCounts.get(beat) ?? 0) + 1);
  }

  const entries: StoryCircleDistributionEntry[] = [];
  const primaryUnitByBeat = new Map<StoryCircleBeat, number>();

  for (const beat of STORY_CIRCLE_BEATS) {
    const primaryEpisode = entries.length + 1;
    primaryUnitByBeat.set(beat, primaryEpisode);
    entries.push({
      episodeNumber: primaryEpisode,
      storyCircleRole: [{
        beat,
        roleKind: 'primary',
        source: 'distribution',
      }],
    });

    const expansions = expansionCounts.get(beat) ?? 0;
    for (let i = 0; i < expansions; i++) {
      entries.push({
        episodeNumber: entries.length + 1,
        storyCircleRole: [{
          beat,
          roleKind: 'expansion',
          expansionOfUnit: primaryUnitByBeat.get(beat),
          source: 'distribution',
        }],
      });
    }
  }

  return entries;
}

export function describeStoryCircleDistribution(entries: StoryCircleDistributionEntry[]): string {
  return entries
    .map((entry) => {
      const roles = entry.storyCircleRole.map((role) =>
        role.roleKind === 'expansion'
          ? `${role.beat} expansion`
          : role.beat
      ).join(', ');
      return `  Episode ${entry.episodeNumber}: ${roles}`;
    })
    .join('\n');
}

export function checkStoryCircleCoverage(
  perUnitRoles: Array<{ episodeNumber?: number; unitNumber?: number; storyCircleRole?: StoryCircleRoleAssignment[] }>,
): string[] {
  const issues: string[] = [];
  const primaryUnitByBeat = new Map<StoryCircleBeat, number>();
  const unitsByBeat = new Map<StoryCircleBeat, number[]>();

  for (const entry of perUnitRoles) {
    const unit = entry.episodeNumber ?? entry.unitNumber;
    if (!Number.isFinite(unit)) continue;
    for (const role of entry.storyCircleRole || []) {
      if (!role || !(STORY_CIRCLE_BEATS as readonly string[]).includes(role.beat)) continue;
      const beat = role.beat;
      const units = unitsByBeat.get(beat) ?? [];
      units.push(unit as number);
      unitsByBeat.set(beat, units);
      if (role.roleKind !== 'expansion' && !primaryUnitByBeat.has(beat)) {
        primaryUnitByBeat.set(beat, unit as number);
      }
    }
  }

  for (const beat of STORY_CIRCLE_BEATS) {
    if (!primaryUnitByBeat.has(beat)) {
      issues.push(`Missing Story Circle beat: "${beat}" has no primary unit.`);
    }
  }

  let lastPrimaryUnit = -Infinity;
  for (const beat of STORY_CIRCLE_BEATS) {
    const unit = primaryUnitByBeat.get(beat);
    if (unit === undefined) continue;
    if (unit < lastPrimaryUnit) {
      issues.push(`Story Circle ordering violation: "${beat}" lands on unit ${unit}, before an earlier canonical beat has finished.`);
    }
    lastPrimaryUnit = Math.max(lastPrimaryUnit, unit);
  }

  for (const beat of STORY_CIRCLE_BEATS) {
    const units = [...(unitsByBeat.get(beat) ?? [])].sort((a, b) => a - b);
    if (units.length <= 1) continue;
    for (let i = 1; i < units.length; i++) {
      if (units[i] !== units[i - 1] + 1) {
        issues.push(`Story Circle expansion contiguity violation: "${beat}" appears on non-contiguous units ${units.join(', ')}.`);
        break;
      }
    }
  }

  return issues;
}

export function backfillMissingStoryCircleBeats(
  roleByUnit: Map<number, StoryCircleRoleAssignment[]>,
  defaultDistribution: StoryCircleDistributionEntry[],
): Map<number, StoryCircleRoleAssignment[]> {
  const covered = new Set<StoryCircleBeat>();
  for (const roles of roleByUnit.values()) {
    for (const role of roles) {
      if (role.roleKind !== 'expansion') covered.add(role.beat);
    }
  }

  for (const beat of STORY_CIRCLE_BEATS) {
    if (covered.has(beat)) continue;
    const target = defaultDistribution.find((entry) =>
      entry.storyCircleRole.some((role) => role.beat === beat && role.roleKind !== 'expansion')
    );
    if (!target) continue;
    const roles = roleByUnit.get(target.episodeNumber) ?? [];
    if (!roles.some((role) => role.beat === beat && role.roleKind !== 'expansion')) {
      roles.push({ beat, roleKind: 'primary', source: 'distribution' });
    }
    roleByUnit.set(target.episodeNumber, roles);
  }

  return roleByUnit;
}

export function storyCircleRoleBeats(
  roles?: StoryCircleRoleAssignment[],
): StoryCircleBeat[] {
  if (!roles?.length) return [];
  return roles
    .map((role) => role.beat)
    .filter((beat, index, beats) => beats.indexOf(beat) === index);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
