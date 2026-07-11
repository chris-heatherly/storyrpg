import type { PlannedScene } from '../../types/scenePlan';
import { detectStoryEventCues, STORY_EVENT_CUE_ORDER, type StoryEventCue } from '../remediation/storyEventCues';

const EXPLORATION_RE = /\b(?:explores?|wandering|wanders?|roams?|strolls?|walks?\s+(?:through|around|the))\b/i;
const BOOKSHOP_SOCIAL_RE = /\b(?:bookshop|bookstore|lumina|befriend(?:s|ed|ing)?)\b/i;
const CLUB_VENUE_RE = /\b(?:valescu|nightlife|velvet rope|(?<!dusk\s)club)\b/i;
const GROUP_FORMATION_RE = /\b(?:dusk club|become\s+friends|forms?\s+(?:the\s+)?\w+\s+club)\b/i;
/** Social/test beats must rank before bond/group formation (ESC: test < bond). */
const TEST_BEAT_RE = /\b(?:testing|test(?:s|ed)?)\b/i;
const ROOFTOP_RE = /\b(?:rooftop|terrace|charcoal suit|kitchen)\b/i;
const THREAT_TURN_RE = /\b(?:attack(?:s|ed|ing)?|attacked|ambush(?:ed|es)?|rescued|rescue(?:s|d)?|cismigiu|cișmigiu|walk(?:s|ed|ing)?\s+home)\b/i;
const POST_THREAT_RANK = 60;
/** Explicit ranks so test never ties with bond under stable sort. */
export const CHRONOLOGY_RANK_TEST = 42;
export const CHRONOLOGY_RANK_BOND = 45;
export const CHRONOLOGY_RANK_LATE_NIGHT_WRITING = 70;
export const CHRONOLOGY_RANK_BLOG_AFTERMATH = 75;

export function isThreatEncounterTurn(text: string): boolean {
  // Doorstep/threshold aftermath is a standard beat, not the attack/rescue set piece.
  if (/\b(?:doorstep|threshold|vanish(?:es|ed)?)\b/i.test(text)
    && !/\b(?:attack(?:s|ed|ing)?|ambush(?:ed|es)?|rescue(?:s|d)?|rescued|scream(?:s|ed)?|knife|pinned|shadow\s+strikes?)\b/i.test(text)) {
    return false;
  }
  const cues = detectStoryEventCues(text);
  return cues.has('threatEncounter') || cues.has('walkHome') || THREAT_TURN_RE.test(text);
}

export function isPostThreatEpisodeTurn(text: string): boolean {
  if (isThreatEncounterTurn(text)) return false;
  const cues = detectStoryEventCues(text);
  if (cues.has('lateNightWriting') || cues.has('blogAftermath')) return true;
  const rank = chronologyRankForText(text);
  if (rank >= 999) return false;
  return rank >= POST_THREAT_RANK;
}

/** Merge analysis splits like "…codename Mr." + "Midnight, and by evening…". */
/** Split one compound turn when it spans container exploration + specific venue. */
export function splitCompoundSpatialTurnText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const exploreVenue = trimmed.match(
    /^(.+?\bexplores?\s+[^.]+?)\s+and\s+((?:wanders?|walks?)\s+into\s+(?:a\s+)?(?:bookshop|bookstore|lumina).*)$/i,
  );
  if (exploreVenue) {
    const first = exploreVenue[1].trim();
    let second = exploreVenue[2].trim();
    if (!/^[A-Z]/.test(second)) {
      const subject = first.match(/^(\w+)/)?.[1] || 'She';
      second = `${subject} ${second}`;
    }
    return [first, second];
  }
  return [trimmed];
}

export function splitCompoundSpatialEpisodeTurns(turns: string[]): string[] {
  return turns.flatMap((turn) => splitCompoundSpatialTurnText(turn));
}

export function coalesceFragmentedEpisodeTurns(turns: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < turns.length; i += 1) {
    let turn = turns[i].trim();
    while (i + 1 < turns.length && shouldMergeWithNextTurn(turn, turns[i + 1])) {
      turn = `${turn} ${turns[i + 1].trim()}`.replace(/\s+/g, ' ').trim();
      i += 1;
    }
    if (turn) out.push(turn);
  }
  return out;
}

function shouldMergeWithNextTurn(current: string, next: string): boolean {
  const n = next.trim();
  if (!n) return false;
  if (/\b(?:Mr|Dr|Mrs|Ms|St)\.\s*$/i.test(current)) return true;
  if (/\bcodename\s+$/i.test(current)) return true;
  if (!/[.!?]$/.test(current) && n.length > 0 && /^[a-z]/i.test(n)) return true;
  return false;
}

function scenePlayOrder(scene: PlannedScene): number {
  return scene.order ?? 0;
}

export function partitionAuthoredLiteTurnIndices(turns: string[]): {
  preThreat: number[];
  postThreat: number[];
} {
  const preThreat: number[] = [];
  const postThreat: number[] = [];
  turns.forEach((turn, index) => {
    if (isThreatEncounterTurn(turn)) return;
    if (isPostThreatEpisodeTurn(turn)) postThreat.push(index);
    else preThreat.push(index);
  });
  return { preThreat, postThreat };
}

/** Minimum standard + encounter slots for authored_lite spine turns. */
export function countAuthoredLiteSceneBudget(turns: string[], standaloneEncounterCount: number): {
  preThreatScenes: number;
  postThreatScenes: number;
  totalScenes: number;
} {
  const { preThreat, postThreat } = partitionAuthoredLiteTurnIndices(turns);
  const preThreatScenes = Math.max(1, preThreat.length);
  const postThreatScenes = postThreat.length;
  return {
    preThreatScenes,
    postThreatScenes,
    totalScenes: preThreatScenes + postThreatScenes + standaloneEncounterCount,
  };
}

/**
 * When ESC is present, budget from unit.sceneKind — not heuristic threat cues.
 * Doorstep/threshold aftermath often matches walkHome and would otherwise be
 * excluded from both pre- and post-threat pools, orphaning the unit.
 */
export function countAuthoredLiteSceneBudgetFromSpine(
  units: Array<{ sceneKind?: string; kind?: string }>,
  standaloneEncounterCount: number,
  coveredEncounterTurnCount = 0,
): {
  preThreatScenes: number;
  postThreatScenes: number;
  totalScenes: number;
} {
  const standardCount = Math.max(0, units.filter((unit) => unit.sceneKind !== 'encounter').length - coveredEncounterTurnCount);
  const encounterCount = Math.max(
    standaloneEncounterCount,
    units.filter((unit) => unit.sceneKind === 'encounter' || unit.kind === 'set_piece').length,
  );
  return {
    preThreatScenes: Math.max(1, standardCount),
    postThreatScenes: 0,
    totalScenes: Math.max(1, standardCount) + encounterCount,
  };
}

/**
 * Bind authored turns to standard scenes while respecting encounter placement in
 * the full playback timeline. Uses one turn per scene slot (no positional stacking)
 * when enough targets exist in each act.
 */
export function assignAuthoredLiteTurnsToStandardScenes(
  turns: string[],
  turnTargets: PlannedScene[],
  allScenes: PlannedScene[],
): number[] {
  const assignment = turns.map(() => -1);
  if (turns.length === 0 || turnTargets.length === 0) return assignment;

  const encounter = allScenes.find((scene) => scene.kind === 'encounter');
  const encounterOrder = encounter ? scenePlayOrder(encounter) : Number.POSITIVE_INFINITY;
  const beforeTargets = turnTargets.filter((scene) => scenePlayOrder(scene) < encounterOrder);
  const afterTargets = turnTargets.filter((scene) => scenePlayOrder(scene) > encounterOrder);
  const { preThreat, postThreat } = partitionAuthoredLiteTurnIndices(turns);

  const bindOneToOne = (turnIndices: number[], targets: PlannedScene[]) => {
    if (turnIndices.length === 0 || targets.length === 0) return;
    // ESC lockdown: never stack overflow turns onto the last slot — leave unbound
    // so callers can error. Cap at targets.length (extra turns stay -1).
    turnIndices.forEach((turnIndex, i) => {
      if (i >= targets.length) return;
      const targetScene = targets[i];
      const slot = turnTargets.indexOf(targetScene);
      if (slot >= 0) assignment[turnIndex] = slot;
    });
  };

  bindOneToOne(preThreat, beforeTargets.length > 0 ? beforeTargets : turnTargets);
  bindOneToOne(postThreat, afterTargets.length > 0 ? afterTargets : turnTargets);

  for (let t = 0; t < turns.length; t += 1) {
    if (assignment[t] >= 0 || isThreatEncounterTurn(turns[t])) continue;
    const pool = isPostThreatEpisodeTurn(turns[t])
      ? (afterTargets.length > 0 ? afterTargets : turnTargets)
      : (beforeTargets.length > 0 ? beforeTargets : turnTargets);
    // Do not stack: only bind if a free slot remains for this turn index within the pool.
    const poolIndex = (isPostThreatEpisodeTurn(turns[t]) ? postThreat : preThreat).indexOf(t);
    if (poolIndex < 0 || poolIndex >= pool.length) continue;
    const slot = turnTargets.indexOf(pool[poolIndex]);
    if (slot >= 0) assignment[t] = slot;
  }

  // Monotonic repair only among already-bound turns — never invent stacking.
  let lastBound = -1;
  for (let t = 0; t < assignment.length; t += 1) {
    if (assignment[t] < 0) continue;
    if (assignment[t] < lastBound) assignment[t] = lastBound;
    lastBound = assignment[t];
  }
  return assignment;
}

export interface ChronologyViolation {
  turnIndex: number;
  priorTurnIndex: number;
  message: string;
}

/** Lower rank = earlier in episode playback order. */
export function chronologyRankForText(text: string): number {
  const cues = detectStoryEventCues(text);
  const cueRanks = [...cues]
    .map((cue) => STORY_EVENT_CUE_ORDER[cue as StoryEventCue])
    .filter((rank): rank is number => typeof rank === 'number');
  let rank = cueRanks.length > 0 ? Math.min(...cueRanks) : 999;

  if (BOOKSHOP_SOCIAL_RE.test(text) && !CLUB_VENUE_RE.test(text)) {
    rank = Math.min(rank, 25);
  }
  if (EXPLORATION_RE.test(text) && !BOOKSHOP_SOCIAL_RE.test(text) && !/\b(?:arrives?|arrival|suitcases?)\b/i.test(text)) {
    rank = Math.min(rank, 15);
  }
  if (CLUB_VENUE_RE.test(text) && !cues.has('blogAftermath') && !cues.has('lateNightWriting')) {
    rank = Math.min(rank, 35);
  }
  // Test before bond — FORCE these ranks (do not Math.min with earlier socialMeet
  // cues, or bond stays at 25 and sorts before test at 42).
  if (TEST_BEAT_RE.test(text) && !GROUP_FORMATION_RE.test(text)) {
    rank = CHRONOLOGY_RANK_TEST;
  }
  if (GROUP_FORMATION_RE.test(text)) {
    rank = CHRONOLOGY_RANK_BOND;
  }
  // Suitors/rooftop must follow test→bond (club formation), not precede them via
  // socialMeet cue rank 40.
  if (ROOFTOP_RE.test(text) && !cues.has('blogAftermath') && !cues.has('lateNightWriting')
    && !TEST_BEAT_RE.test(text) && !GROUP_FORMATION_RE.test(text)) {
    rank = CHRONOLOGY_RANK_BOND + 5;
  }
  // Apartment threshold / vanish / keycard doorstep is post-rescue aftermath,
  // not an early venueDoor beat — keycard language otherwise ranks at 20 and
  // pulls the doorstep scene before bookshop/club (ESC chronology drift).
  if (/\b(?:doorstep|threshold|vanish(?:es|ed)?)\b/i.test(text)
    || (/\b(?:key\s*card|keycard)\b/i.test(text) && /\b(?:apartment|flat|home|door)\b/i.test(text))) {
    rank = Math.max(rank, POST_THREAT_RANK);
  }
  // Writing and viral metrics always follow the threat act — never compete with
  // club/venue ranks from incidental "at the club" wording.
  if (cues.has('lateNightWriting') || /\b(?:4\s*am|writes?\s+(?:the\s+)?blog|mr\.?\s*midnight|codename)\b/i.test(text)) {
    rank = Math.max(rank, CHRONOLOGY_RANK_LATE_NIGHT_WRITING);
  }
  if (cues.has('blogAftermath') || /\b(?:goes\s+viral|went\s+viral|viral\s+(?:post|blog)|readership)\b/i.test(text)) {
    rank = Math.max(rank, CHRONOLOGY_RANK_BLOG_AFTERMATH);
  }

  return rank;
}

/** Stable sort authored turns into treatment playback order. */
export function orderAuthoredEpisodeTurns(turns: string[]): string[] {
  return turns
    .map((turn, index) => ({ turn, index, rank: chronologyRankForText(turn) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.turn);
}

export function assertMonotonicTurnAssignment(
  turns: string[],
  assignment: number[],
): ChronologyViolation[] {
  const violations: ChronologyViolation[] = [];
  for (let t = 1; t < turns.length; t += 1) {
    const prevRank = chronologyRankForText(turns[t - 1]);
    const curRank = chronologyRankForText(turns[t]);
    if (curRank < prevRank && assignment[t] <= assignment[t - 1]) {
      violations.push({
        turnIndex: t,
        priorTurnIndex: t - 1,
        message: `Turn ${t} (${turns[t].slice(0, 40)}…) binds to scene ${assignment[t]} before turn ${t - 1} (${turns[t - 1].slice(0, 40)}…) at scene ${assignment[t - 1]}.`,
      });
    }
  }
  return violations;
}

export function positionalTurnAssignment(turnCount: number, sceneCount: number): number[] {
  if (turnCount <= 0 || sceneCount <= 0) return [];
  return Array.from({ length: turnCount }, (_, index) => Math.min(index, sceneCount - 1));
}

function sceneBindingText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    ...(scene.requiredBeats ?? [])
      .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature')
      .flatMap((beat) => [beat.mustDepict, beat.sourceTurn]),
  ].filter(Boolean).join('\n');
}

export function chronologyRankForScene(scene: PlannedScene): number {
  return chronologyRankForText(sceneBindingText(scene));
}

/** Stable-sort standard scenes within each encounter-delimited segment by route-cue rank. */
export function sortPlannedScenesByChronologyCue(scenes: PlannedScene[]): number {
  const segments: number[][] = [];
  let current: number[] = [];
  scenes.forEach((scene, index) => {
    if (scene.kind !== 'standard') {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push(index);
  });
  if (current.length > 0) segments.push(current);

  let moves = 0;
  for (const movableIndices of segments) {
    if (movableIndices.length < 2) continue;
    const entries = movableIndices.map((index) => ({
      index,
      scene: scenes[index],
      rank: chronologyRankForScene(scenes[index]),
    }));
    const sorted = [...entries].sort((a, b) => a.rank - b.rank || a.index - b.index);
    const orderValues = movableIndices.map((index) => scenes[index].order);
    sorted.forEach((entry, position) => {
      const targetIndex = movableIndices[position];
      if (scenes[targetIndex] !== entry.scene) moves += 1;
      scenes[targetIndex] = entry.scene;
      entry.scene.order = orderValues[position];
    });
  }
  return moves;
}
