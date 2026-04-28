// ========================================
// REWIND ENGINE
// ========================================
//
// Plan 2: lets the post-episode flowchart replay the playthrough from the
// initial state up to (but not including) a specific visit record. This
// provides deterministic state reconstruction when the player wants to
// "rewind to here and choose differently" without keeping every intermediate
// PlayerState snapshot.
//
// Strategy: iterate the visit log in order, applying:
//   - `beat.onShow` consequences (replaying the automatic effects of rendering a beat)
//   - `choice.consequences` (only for committed choices)
//   - identity shifts from `applyConsequences`
// We purposefully do NOT re-fire delayed consequences here — those are tied
// to real playback cadence, not rewind.
//
// Returns a new PlayerState along with the truncated visit log. Idempotent:
// calling twice with the same inputs yields identical output.

import type { Story, PlayerState, VisitRecord, Consequence } from '../types';
import { createInitialPlayerState } from '../stores/playerStatePersistence';
import { executeChoice } from './storyEngine';

export interface RewindOptions {
  /** Character name to preserve across rewind (default: from original state). */
  characterName?: string;
  /** Pronouns to preserve across rewind. */
  pronouns?: PlayerState['characterPronouns'];
}

/**
 * Pure consequence applier scoped to rewind. Handles the flag/score/tag
 * layer of PlayerState — enough to reconstruct state relevant to the
 * post-episode flowchart UI. Identity and relationship shifts are applied
 * in a best-effort way; delayed consequences are NOT re-fired.
 */
function applyConsequencesToState(state: PlayerState, consequences: Consequence[]): PlayerState {
  let next = {
    ...state,
    flags: { ...state.flags },
    scores: { ...state.scores },
    tags: new Set(state.tags),
    relationships: { ...state.relationships },
  };

  for (const c of consequences) {
    const anyC = c as unknown as Record<string, unknown>;
    switch (c.type) {
      case 'setFlag':
        next.flags[(anyC.flag as string) || ''] = Boolean(anyC.value);
        break;
      case 'setScore':
        next.scores[(anyC.score as string) || ''] = Number(anyC.value) || 0;
        break;
      case 'changeScore': {
        const key = (anyC.score as string) || '';
        const delta = Number(anyC.change) || 0;
        next.scores[key] = (next.scores[key] ?? 0) + delta;
        break;
      }
      case 'addTag': {
        const tag = (anyC.tag as string) || (anyC.value as string) || (anyC.name as string);
        if (tag) next.tags.add(tag);
        break;
      }
      case 'removeTag': {
        const tag = (anyC.tag as string) || (anyC.value as string) || (anyC.name as string);
        if (tag) next.tags.delete(tag);
        break;
      }
      case 'relationship': {
        const npcId = (anyC.npcId as string) || '';
        const dim = (anyC.dimension as 'trust' | 'affection' | 'respect' | 'fear') || 'trust';
        const change = Number(anyC.change) || 0;
        const existing = next.relationships[npcId] ?? { npcId, trust: 0, affection: 0, respect: 0, fear: 0 };
        next.relationships[npcId] = { ...existing, [dim]: (existing[dim] ?? 0) + change };
        break;
      }
      default:
        break;
    }
  }

  return next;
}

export interface RewindResult {
  player: PlayerState;
  truncatedLog: VisitRecord[];
  applied: number; // number of visit records whose consequences were applied
}

/**
 * Rebuild PlayerState from the initial state by replaying the visit log
 * up to (but not including) `targetIndex`. `targetIndex` may be `visitLog.length`
 * to replay the whole log.
 */
export function replayToBeat(
  story: Story,
  visitLog: VisitRecord[],
  targetIndex: number,
  options?: RewindOptions,
): RewindResult {
  const initial: PlayerState = {
    ...createInitialPlayerState(),
    characterName: options?.characterName ?? 'Player',
    characterPronouns: options?.pronouns ?? 'they/them',
    currentStoryId: story.id ?? story.episodes[0]?.id ?? null,
  };

  let state = initial;
  const safeIndex = Math.min(Math.max(0, targetIndex), visitLog.length);

  for (let i = 0; i < safeIndex; i++) {
    const record = visitLog[i];
    const episode = story.episodes.find((ep) => ep.id === record.episodeId);
    const scene = episode?.scenes.find((sc) => sc.id === record.sceneId);
    const beat = scene?.beats?.find((b) => b.id === record.beatId);

    if (!beat) continue;

    // Apply beat onShow consequences (passive effects just by visiting).
    if (beat.onShow && beat.onShow.length > 0) {
      state = applyConsequencesToState(state, beat.onShow);
    }

    // Apply committed choice consequences if this visit involved a choice.
    if (record.choiceId) {
      const choice = beat.choices?.find((c) => c.id === record.choiceId);
      if (choice) {
        const result = executeChoice(choice, state);
        if (result.success && result.consequences.length > 0) {
          state = applyConsequencesToState(state, result.consequences);
        }
      }
    }

    state = {
      ...state,
      currentEpisodeId: record.episodeId,
      currentSceneId: record.sceneId,
    };
  }

  return {
    player: state,
    truncatedLog: visitLog.slice(0, safeIndex),
    applied: safeIndex,
  };
}

/**
 * Convenience: rewind to the first visit of a given beat within an episode.
 * Returns null if the beat was never visited.
 */
export function rewindToBeat(
  story: Story,
  visitLog: VisitRecord[],
  target: { episodeId: string; sceneId: string; beatId: string },
  options?: RewindOptions,
): RewindResult | null {
  const index = visitLog.findIndex(
    (v) =>
      v.episodeId === target.episodeId &&
      v.sceneId === target.sceneId &&
      v.beatId === target.beatId,
  );
  if (index < 0) return null;
  return replayToBeat(story, visitLog, index, options);
}

