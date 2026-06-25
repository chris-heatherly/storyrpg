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
import type { RelationshipValueState } from '../../types/relationshipValue';
import { classifyRelationshipValueState, relationshipValueKey } from '../../engine/relationshipValueLadder';

export interface TerminalState {
  /** Canonical fingerprint of the terminal state (used for divergence checks). */
  fingerprint: string;
  /**
   * Experience fingerprint (G12): hash of the text the player actually READS along
   * the path (base beats + variants that fire given accumulated state + chosen
   * outcome texts) plus the mechanical state they FEEL (scores/relationships/tags).
   * Raw flags are deliberately excluded — write-only flags made the state
   * fingerprint trivially distinct (divergenceRatio 1.0 on a run where 77/110
   * flags were never read), so it measured bookkeeping, not experience.
   */
  experienceFingerprint: string;
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
  relationshipValueStates: Record<string, RelationshipValueState>;
  tags: Set<string>;
  path: string[];
  visited: Set<string>;
  /** Rolling FNV-1a hash of the rendered text along this path. */
  textHash: number;
}

const FNV_PRIME = 0x01000193;
function fnv(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

/**
 * Coarse condition matcher mirroring the engine's evaluator over the simulator's
 * state. `_outcome_success` is treated as true (the simulator picks success);
 * other `_outcome_*` pseudo-flags false; unknown condition types conservatively
 * fail (base text renders).
 */
function simConditionMatches(cond: unknown, state: SimState): boolean {
  if (typeof cond === 'string') return simFlagValue(cond, state) === true;
  if (!cond || typeof cond !== 'object') return false;
  const c = cond as Record<string, unknown>;
  switch (c.type) {
    case 'flag': {
      const expected = c.value === undefined ? true : c.value;
      return simFlagValue(String(c.flag ?? ''), state) === expected;
    }
    case 'score': {
      const val = state.scores[String(c.score ?? c.name ?? '')] ?? 0;
      return compare(val, String(c.operator ?? '>='), Number(c.value ?? 0));
    }
    case 'tag':
      return state.tags.has(String(c.tag ?? '')) === (c.hasTag === undefined ? true : Boolean(c.hasTag));
    case 'relationshipRung': {
      const npcId = String(c.npcId ?? '');
      const axis = String(c.axis ?? 'love') as RelationshipValueState['axis'];
      const rung = String(c.rung ?? '');
      const key = relationshipValueKey(npcId, axis);
      const derived = classifyRelationshipValueState({
        npcId,
        axis,
        relationship: state.relationships[npcId],
        previousState: state.relationshipValueStates[key],
      });
      return derived.rung === rung;
    }
    case 'and':
      return Array.isArray(c.conditions) && c.conditions.every((x) => simConditionMatches(x, state));
    case 'or':
      return Array.isArray(c.conditions) && c.conditions.some((x) => simConditionMatches(x, state));
    case 'not':
      return !simConditionMatches(c.condition, state);
    default:
      return false;
  }
}

function simFlagValue(flag: string, state: SimState): boolean | string | undefined {
  if (flag === '_outcome_success') return true;
  if (flag.startsWith('_outcome_')) return false;
  return state.flags[flag];
}

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

/** The text the engine would render for this beat given the accumulated state. */
function renderBeatText(beat: Beat, state: SimState): string {
  const variants = (beat as { textVariants?: Array<{ condition?: unknown; text?: string }> }).textVariants || [];
  for (const v of variants) {
    if (typeof v.text === 'string' && v.text.trim() && simConditionMatches(v.condition, state)) {
      return v.text;
    }
  }
  return typeof beat.text === 'string' ? beat.text : '';
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
    relationshipValueStates: {},
    tags: new Set(),
    path: [],
    visited: new Set(),
    textHash: 0x811c9dc5,
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
      relationshipValueStates: { ...state.relationshipValueStates },
      visited: new Set(state.visited),
    };
    localState.visited.add(scene.id);

    // Apply onShow consequences and accumulate the RENDERED text for each beat in
    // order — variant selection happens against the state accumulated so far, so a
    // prior choice's residue (a variant that fires) makes this path's experience
    // fingerprint distinct, and a write-only flag does not.
    for (const beat of scene.beats) {
      if (beat.onShow) applyConsequences(localState, beat.onShow);
      localState.textHash = fnv(localState.textHash, renderBeatText(beat, localState));
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
        relationshipValueStates: { ...localState.relationshipValueStates },
        tags: new Set(localState.tags),
        path: [...localState.path, choice.id],
        visited: new Set(localState.visited),
        textHash: localState.textHash,
      };
      applyChoice(childState, choice);
      // The player READS the chosen outcome (storyEngine overrides narrativeText
      // from outcomeTexts) — hash it so sibling choices with distinct prose
      // diverge and identical/stub prose does not.
      const outcomeProse = (choice as { outcomeTexts?: { success?: string }; reactionText?: string }).outcomeTexts?.success
        ?? (choice as { reactionText?: string }).reactionText
        ?? choice.text
        ?? '';
      childState.textHash = fnv(childState.textHash, outcomeProse);
      const payoffBeat = choice.nextBeatId ? scene.beats.find((b) => b.id === choice.nextBeatId) : undefined;
      if (payoffBeat) {
        childState.textHash = fnv(childState.textHash, renderBeatText(payoffBeat, childState));
      }
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
  if (choice.relationshipValueEvidence?.length) {
    applyConsequences(state, choice.relationshipValueEvidence.map(evidence => ({
      type: 'relationshipEvidence',
      npcId: evidence.npcId,
      axis: evidence.axis,
      evidenceTags: evidence.evidenceTags,
      reason: evidence.reason,
      intendedSurface: evidence.intendedSurface,
    })));
  }
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
      case 'relationshipEvidence': {
        const key = relationshipValueKey(c.npcId, c.axis);
        state.relationshipValueStates[key] = classifyRelationshipValueState({
          npcId: c.npcId,
          axis: c.axis,
          relationship: state.relationships[c.npcId],
          previousState: state.relationshipValueStates[key],
          evidenceTags: c.evidenceTags,
        });
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
  const experienceFingerprint = JSON.stringify({ text: state.textHash, scores, relationships, tags });
  return {
    fingerprint,
    experienceFingerprint,
    flags,
    scores,
    relationships,
    tags,
    path: [...state.path],
    terminalSceneId,
  };
}
