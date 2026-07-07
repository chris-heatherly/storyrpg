import type { PlannedScene } from '../../types/scenePlan';
import { detectStoryEventCues, STORY_EVENT_CUE_ORDER, type StoryEventCue } from '../remediation/storyEventCues';

const EXPLORATION_RE = /\b(?:explores?|wandering|wanders?|roams?|strolls?|walks?\s+(?:through|around|the))\b/i;
const BOOKSHOP_SOCIAL_RE = /\b(?:bookshop|bookstore|lumina|befriend(?:s|ed|ing)?)\b/i;
const CLUB_VENUE_RE = /\b(?:valescu|nightlife|club|velvet rope)\b/i;
const GROUP_FORMATION_RE = /\b(?:dusk club|become\s+friends|forms?\s+(?:the\s+)?\w+\s+club|testing)\b/i;
const ROOFTOP_RE = /\b(?:rooftop|terrace|charcoal suit|kitchen)\b/i;

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
  if (CLUB_VENUE_RE.test(text)) {
    rank = Math.min(rank, 35);
  }
  if (GROUP_FORMATION_RE.test(text)) {
    rank = Math.min(rank, 45);
  }
  if (ROOFTOP_RE.test(text)) {
    rank = Math.min(rank, 55);
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
