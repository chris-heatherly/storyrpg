/**
 * Path Simulator
 *
 * Walks an Episode's scene graph along every choice permutation and returns
 * terminal-state fingerprints. Intended for off-engine analysis — the engine
 * remains the source of truth at runtime. The simulator applies a coarse
 * subset of consequences (flags, scores, relationships, tags) without
 * evaluating stat checks, so treat results as a structural approximation
 * good enough to detect *cosmetic* vs *meaningful* branching.
 *
 * Limits:
 *   - Does not evaluate conditions (treats all choices as available).
 *   - Does not roll stat checks — picks the 'success' outcome if authored.
 *   - Caps explored paths to avoid combinatorial blowup.
 */

import { Episode, Scene, Beat, Choice, Consequence } from '../../types';

export interface TerminalState {
  /** Canonical fingerprint of the terminal state (used for divergence checks). */
  fingerprint: string;
  flags: Record<string, boolean>;
  scores: Record<string, number>;
  relationships: Record<string, { trust?: number; affection?: number; respect?: number; fear?: number }>;
  tags: string[];
  /** Ordered list of choice ids taken to reach this terminal. */
  path: string[];
  /** Scene the simulation ended in. */
  terminalSceneId: string;
}

export interface PathSimulationResult {
  episodeId: string;
  terminals: TerminalState[];
  truncated: boolean;
  exploredCount: number;
}

export interface SimulatorOptions {
  maxPaths?: number;
  maxDepth?: number;
}

interface SimState {
  flags: Record<string, boolean>;
  scores: Record<string, number>;
  relationships: Record<string, { trust?: number; affection?: number; respect?: number; fear?: number }>;
  tags: Set<string>;
  path: string[];
  visited: Set<string>;
}

export function simulateEpisodePaths(
  episode: Episode,
  options: SimulatorOptions = {},
): PathSimulationResult {
  const maxPaths = options.maxPaths ?? 512;
  const maxDepth = options.maxDepth ?? 64;
  const scenesById = new Map<string, Scene>();
  for (const s of episode.scenes) scenesById.set(s.id, s);

  const terminals: TerminalState[] = [];
  let exploredCount = 0;
  let truncated = false;

  const initialState: SimState = {
    flags: {},
    scores: {},
    relationships: {},
    tags: new Set(),
    path: [],
    visited: new Set(),
  };

  const start = scenesById.get(episode.startingSceneId);
  if (!start) {
    return { episodeId: episode.id, terminals: [], truncated: false, exploredCount: 0 };
  }

  const stack: Array<{ scene: Scene; state: SimState }> = [{ scene: start, state: initialState }];

  while (stack.length > 0) {
    if (terminals.length >= maxPaths) {
      truncated = true;
      break;
    }
    const { scene, state } = stack.pop()!;
    exploredCount++;
    if (state.visited.has(scene.id)) {
      // Cycle — record terminal and skip.
      terminals.push(snapshotTerminal(state, scene.id));
      continue;
    }
    if (state.path.length > maxDepth) {
      truncated = true;
      terminals.push(snapshotTerminal(state, scene.id));
      continue;
    }
    const localState = {
      ...state,
      tags: new Set(state.tags),
      visited: new Set(state.visited),
    };
    localState.visited.add(scene.id);

    // Apply onShow consequences for each beat in order.
    for (const beat of scene.beats) {
      if (beat.onShow) applyConsequences(localState, beat.onShow);
    }

    // Decision: pick the last beat that authored choices; fall back to the
    // last beat for nextSceneId transitions.
    const lastBeat: Beat | undefined = scene.beats[scene.beats.length - 1];
    const beatWithChoices = [...scene.beats].reverse().find(b => b.choices && b.choices.length > 0);
    const choices = beatWithChoices?.choices || [];

    if (!choices.length) {
      // Terminal — may transition via lastBeat.nextSceneId
      const nextId = lastBeat?.nextSceneId;
      if (nextId) {
        const nextScene = scenesById.get(nextId);
        if (nextScene) {
          stack.push({ scene: nextScene, state: localState });
          continue;
        }
      }
      terminals.push(snapshotTerminal(localState, scene.id));
      continue;
    }

    for (const choice of choices) {
      if (terminals.length >= maxPaths) {
        truncated = true;
        break;
      }
      const childState: SimState = {
        flags: { ...localState.flags },
        scores: { ...localState.scores },
        relationships: cloneRels(localState.relationships),
        tags: new Set(localState.tags),
        path: [...localState.path, choice.id],
        visited: new Set(localState.visited),
      };
      applyChoice(childState, choice);
      const targetSceneId = choice.nextSceneId || lastBeat?.nextSceneId;
      if (!targetSceneId) {
        terminals.push(snapshotTerminal(childState, scene.id));
        continue;
      }
      const nextScene = scenesById.get(targetSceneId);
      if (!nextScene) {
        terminals.push(snapshotTerminal(childState, scene.id));
        continue;
      }
      stack.push({ scene: nextScene, state: childState });
    }
  }

  return {
    episodeId: episode.id,
    terminals,
    truncated,
    exploredCount,
  };
}

function applyChoice(state: SimState, choice: Choice): void {
  if (choice.consequences) applyConsequences(state, choice.consequences);
  const statCheck = (choice as unknown as { statCheck?: { outcomes?: { success?: { consequences?: Consequence[] } } } }).statCheck;
  if (statCheck?.outcomes?.success?.consequences) {
    applyConsequences(state, statCheck.outcomes.success.consequences);
  }
}

function applyConsequences(state: SimState, consequences: Consequence[]): void {
  for (const c of consequences) {
    switch (c.type) {
      case 'setFlag':
        state.flags[c.flag] = Boolean(c.value);
        break;
      case 'changeScore':
        state.scores[c.score] = (state.scores[c.score] || 0) + c.change;
        break;
      case 'setScore':
        state.scores[c.score] = c.value;
        break;
      case 'relationship': {
        const rel = state.relationships[c.npcId] || {};
        rel[c.dimension] = (rel[c.dimension] || 0) + c.change;
        state.relationships[c.npcId] = rel;
        break;
      }
      case 'addTag':
        state.tags.add(c.tag);
        break;
      case 'removeTag':
        state.tags.delete(c.tag);
        break;
      default:
        // Ignored: attribute/skill/item — not modeled in the simulator.
        break;
    }
  }
}

function cloneRels(
  rels: Record<string, { trust?: number; affection?: number; respect?: number; fear?: number }>,
): Record<string, { trust?: number; affection?: number; respect?: number; fear?: number }> {
  const out: Record<string, { trust?: number; affection?: number; respect?: number; fear?: number }> = {};
  for (const [k, v] of Object.entries(rels)) out[k] = { ...v };
  return out;
}

function snapshotTerminal(state: SimState, terminalSceneId: string): TerminalState {
  const tags = Array.from(state.tags).sort();
  const flags = Object.fromEntries(Object.entries(state.flags).sort());
  const scores = Object.fromEntries(Object.entries(state.scores).sort());
  const relationships: TerminalState['relationships'] = {};
  for (const key of Object.keys(state.relationships).sort()) {
    const v = state.relationships[key];
    relationships[key] = {
      trust: v.trust ?? 0,
      affection: v.affection ?? 0,
      respect: v.respect ?? 0,
      fear: v.fear ?? 0,
    };
  }
  const fingerprint = JSON.stringify({ flags, scores, relationships, tags });
  return {
    fingerprint,
    flags,
    scores,
    relationships,
    tags,
    path: [...state.path],
    terminalSceneId,
  };
}
