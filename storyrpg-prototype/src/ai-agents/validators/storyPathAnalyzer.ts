/**
 * Story Path Analyzer
 *
 * Reads a Story object, builds a scene-level DAG, and computes the minimum set
 * of choice paths needed to cover every beat and every choice at least once.
 * Each path is encoded as an array of choice indices that the Playwright test
 * should follow at each decision point.
 */

import type { Story, Episode, Scene, Choice, Encounter } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChoicePathStep {
  /** 0-based index of which choice to pick at this decision point */
  decisionIndex: number;
  /** For encounter-level branching, force this tier */
  encounterTier?: 'success' | 'complicated' | 'failure';
}

/** A single playthrough path through the story */
export interface StoryPath {
  id: string;
  /** Ordered list of choice indices to pick at each decision point */
  choicePath: number[];
  /** Encounter tier to force for this path */
  encounterTier?: 'success' | 'complicated' | 'failure';
  /** Which scene IDs this path is expected to visit */
  expectedScenes: string[];
  /** Which choice IDs this path is expected to exercise */
  expectedChoices: string[];
}

/** Inventory of all testable content in the story */
export interface StoryInventory {
  /** All scene IDs */
  sceneIds: string[];
  /** All beat IDs (scoped: sceneId/beatId) */
  beatIds: string[];
  /** All choice IDs (scoped: sceneId/beatId/choiceId) */
  choiceIds: string[];
  /** Scene IDs that are encounter scenes */
  encounterSceneIds: string[];
  /** Scene IDs reachable only via branching choices */
  branchSceneIds: string[];
}

export interface CoveragePlan {
  paths: StoryPath[];
  inventory: StoryInventory;
  /** Human-readable summary */
  summary: string;
}

// ---------------------------------------------------------------------------
// Scene-level DAG
// ---------------------------------------------------------------------------

interface SceneNode {
  sceneId: string;
  episodeId: string;
  isEncounter: boolean;
  beatCount: number;
  /** Choices that branch to other scenes (with nextSceneId) */
  branchingChoices: { choiceId: string; choiceIndex: number; targetSceneId: string }[];
  /** All choice IDs in this scene (for inventory) */
  allChoiceIds: string[];
  /** All beat IDs in this scene */
  allBeatIds: string[];
  /** Encounter outcome targets */
  encounterTargets: { tier: string; targetSceneId: string }[];
  /** Default next scene (sequential or leadsTo[0]) */
  defaultNextSceneId?: string;
}

function buildSceneDAG(story: Story): { nodes: Map<string, SceneNode>; startSceneIds: string[] } {
  const nodes = new Map<string, SceneNode>();
  const startSceneIds: string[] = [];

  for (const episode of story.episodes) {
    if (episode.startingSceneId) {
      startSceneIds.push(episode.startingSceneId);
    } else if (episode.scenes.length > 0) {
      startSceneIds.push(episode.scenes[0].id);
    }

    for (let si = 0; si < episode.scenes.length; si++) {
      const scene = episode.scenes[si];
      const node: SceneNode = {
        sceneId: scene.id,
        episodeId: episode.id,
        isEncounter: !!scene.encounter,
        beatCount: scene.beats?.length || 0,
        branchingChoices: [],
        allChoiceIds: [],
        allBeatIds: [],
        encounterTargets: [],
      };

      // Collect all beats and choices
      for (const beat of scene.beats || []) {
        node.allBeatIds.push(`${scene.id}/${beat.id}`);
        for (let ci = 0; ci < (beat.choices?.length || 0); ci++) {
          const choice = beat.choices![ci];
          node.allChoiceIds.push(`${scene.id}/${beat.id}/${choice.id}`);
          if (choice.nextSceneId) {
            node.branchingChoices.push({
              choiceId: choice.id,
              choiceIndex: ci,
              targetSceneId: choice.nextSceneId,
            });
          }
        }
      }

      // Encounter outcome targets
      if (scene.encounter) {
        const enc = scene.encounter as Encounter;
        if (enc.outcomes?.victory?.nextSceneId) {
          node.encounterTargets.push({ tier: 'success', targetSceneId: enc.outcomes.victory.nextSceneId });
        }
        if (enc.outcomes?.partialVictory?.nextSceneId) {
          node.encounterTargets.push({ tier: 'complicated', targetSceneId: enc.outcomes.partialVictory.nextSceneId });
        }
        if (enc.outcomes?.defeat?.nextSceneId) {
          node.encounterTargets.push({ tier: 'failure', targetSceneId: enc.outcomes.defeat.nextSceneId });
        }
        if (enc.outcomes?.escape?.nextSceneId) {
          node.encounterTargets.push({ tier: 'escape', targetSceneId: enc.outcomes.escape.nextSceneId });
        }

        // Also collect encounter beat/choice IDs
        for (const phase of enc.phases || []) {
          for (const beat of phase.beats || []) {
            node.allBeatIds.push(`${scene.id}/enc-${phase.id}/${beat.id || 'beat'}`);
            for (const choice of beat.choices || []) {
              node.allChoiceIds.push(`${scene.id}/enc-${phase.id}/${choice.id}`);
            }
          }
        }
      }

      // Default next scene
      if (scene.leadsTo && scene.leadsTo.length > 0) {
        node.defaultNextSceneId = scene.leadsTo[0];
      } else if (si < episode.scenes.length - 1) {
        node.defaultNextSceneId = episode.scenes[si + 1].id;
      }

      nodes.set(scene.id, node);
    }
  }

  return { nodes, startSceneIds };
}

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

/**
 * Compute the minimum set of paths to cover all choices.
 * Uses DFS through the scene DAG, forking at each branching choice point.
 */
function computePaths(dag: Map<string, SceneNode>, startSceneIds: string[]): StoryPath[] {
  const paths: StoryPath[] = [];

  // Collect all unique branching decisions and encounter tiers we need to cover
  const allBranchTargets = new Set<string>();
  const allEncounterTiers = new Set<string>();

  for (const node of dag.values()) {
    for (const bc of node.branchingChoices) {
      allBranchTargets.add(`${node.sceneId}:${bc.choiceIndex}:${bc.targetSceneId}`);
    }
    for (const et of node.encounterTargets) {
      allEncounterTiers.add(`${node.sceneId}:${et.tier}`);
    }
  }

  // Path 0: default path — always pick choice index 0, encounter tier "success"
  const defaultPath = tracePath(dag, startSceneIds, 0, 'success');
  defaultPath.id = 'path-0';
  defaultPath.encounterTier = 'success';
  paths.push(defaultPath);

  // Track which branch targets and encounter tiers are covered
  const coveredBranches = new Set<string>();
  const coveredTiers = new Set<string>();
  markCovered(defaultPath, dag, coveredBranches, coveredTiers);

  // Path 1: pick choice index 1 everywhere, encounter tier "failure"
  if (hasUncoveredContent(allBranchTargets, coveredBranches) ||
      hasUncoveredContent(allEncounterTiers, coveredTiers)) {
    const altPath = tracePath(dag, startSceneIds, 1, 'failure');
    altPath.id = 'path-1';
    altPath.encounterTier = 'failure';
    paths.push(altPath);
    markCovered(altPath, dag, coveredBranches, coveredTiers);
  }

  // Path 2: pick choice index 2 if needed, encounter tier "complicated"
  if (hasUncoveredContent(allBranchTargets, coveredBranches) ||
      hasUncoveredContent(allEncounterTiers, coveredTiers)) {
    const thirdPath = tracePath(dag, startSceneIds, 2, 'complicated');
    thirdPath.id = 'path-2';
    thirdPath.encounterTier = 'complicated';
    paths.push(thirdPath);
    markCovered(thirdPath, dag, coveredBranches, coveredTiers);
  }

  // Additional targeted paths for any remaining uncovered branches
  let pathIndex = paths.length;
  for (const branchKey of allBranchTargets) {
    if (coveredBranches.has(branchKey)) continue;
    const [sceneId, choiceIndexStr] = branchKey.split(':');
    const choiceIndex = parseInt(choiceIndexStr, 10);

    // Build a path that specifically targets this branch
    const targetedPath = tracePathWithTargetedChoice(dag, startSceneIds, sceneId, choiceIndex);
    targetedPath.id = `path-${pathIndex}`;
    paths.push(targetedPath);
    markCovered(targetedPath, dag, coveredBranches, coveredTiers);
    pathIndex++;
  }

  return paths;
}

function tracePath(
  dag: Map<string, SceneNode>,
  startSceneIds: string[],
  defaultChoiceIndex: number,
  encounterTier: string,
): StoryPath {
  const choicePath: number[] = [];
  const visitedScenes: string[] = [];
  const visitedChoices: string[] = [];
  const visited = new Set<string>();

  for (const startId of startSceneIds) {
    let currentSceneId: string | undefined = startId;

    while (currentSceneId && !visited.has(currentSceneId)) {
      visited.add(currentSceneId);
      const node = dag.get(currentSceneId);
      if (!node) break;

      visitedScenes.push(currentSceneId);

      if (node.isEncounter) {
        // For encounters, the tier determines which target scene we go to
        const tierTarget = node.encounterTargets.find(t => t.tier === encounterTier);
        currentSceneId = tierTarget?.targetSceneId || node.defaultNextSceneId;
        continue;
      }

      if (node.branchingChoices.length > 0) {
        // Pick the choice at defaultChoiceIndex (wrapping if needed)
        const idx = defaultChoiceIndex % Math.max(node.branchingChoices.length, node.allChoiceIds.length);
        choicePath.push(idx);

        // Determine where this choice sends us
        const branch = node.branchingChoices[idx % node.branchingChoices.length];
        if (branch) {
          visitedChoices.push(branch.choiceId);
          currentSceneId = branch.targetSceneId;
        } else {
          currentSceneId = node.defaultNextSceneId;
        }
      } else if (node.allChoiceIds.length > 0) {
        // Non-branching choices (no nextSceneId) — still record the index
        const idx = defaultChoiceIndex % node.allChoiceIds.length;
        choicePath.push(idx);
        currentSceneId = node.defaultNextSceneId;
      } else {
        // No choices at all — auto-advance
        currentSceneId = node.defaultNextSceneId;
      }
    }
  }

  return {
    id: '',
    choicePath,
    expectedScenes: visitedScenes,
    expectedChoices: visitedChoices,
  };
}

function tracePathWithTargetedChoice(
  dag: Map<string, SceneNode>,
  startSceneIds: string[],
  targetSceneId: string,
  targetChoiceIndex: number,
): StoryPath {
  const choicePath: number[] = [];
  const visitedScenes: string[] = [];
  const visitedChoices: string[] = [];
  const visited = new Set<string>();

  for (const startId of startSceneIds) {
    let currentSceneId: string | undefined = startId;

    while (currentSceneId && !visited.has(currentSceneId)) {
      visited.add(currentSceneId);
      const node = dag.get(currentSceneId);
      if (!node) break;

      visitedScenes.push(currentSceneId);

      if (node.isEncounter) {
        const tierTarget = node.encounterTargets[0];
        currentSceneId = tierTarget?.targetSceneId || node.defaultNextSceneId;
        continue;
      }

      if (currentSceneId === targetSceneId && node.branchingChoices.length > 0) {
        // This is our targeted scene — pick the specific choice index
        const idx = targetChoiceIndex % Math.max(node.branchingChoices.length, node.allChoiceIds.length);
        choicePath.push(idx);
        const branch = node.branchingChoices[idx % node.branchingChoices.length];
        if (branch) {
          visitedChoices.push(branch.choiceId);
          currentSceneId = branch.targetSceneId;
        } else {
          currentSceneId = node.defaultNextSceneId;
        }
      } else if (node.branchingChoices.length > 0 || node.allChoiceIds.length > 0) {
        // Default: pick first choice
        choicePath.push(0);
        const branch = node.branchingChoices[0];
        currentSceneId = branch?.targetSceneId || node.defaultNextSceneId;
      } else {
        currentSceneId = node.defaultNextSceneId;
      }
    }
  }

  return {
    id: '',
    choicePath,
    expectedScenes: visitedScenes,
    expectedChoices: visitedChoices,
  };
}

function markCovered(
  path: StoryPath,
  dag: Map<string, SceneNode>,
  coveredBranches: Set<string>,
  coveredTiers: Set<string>,
) {
  for (const sceneId of path.expectedScenes) {
    const node = dag.get(sceneId);
    if (!node) continue;
    // Mark all encounter tiers for visited encounter scenes
    if (node.isEncounter && path.encounterTier) {
      coveredTiers.add(`${sceneId}:${path.encounterTier}`);
    }
    // Mark branching choices that this path exercised
    for (const bc of node.branchingChoices) {
      if (path.expectedScenes.includes(bc.targetSceneId)) {
        coveredBranches.add(`${sceneId}:${bc.choiceIndex}:${bc.targetSceneId}`);
      }
    }
  }
}

function hasUncoveredContent(all: Set<string>, covered: Set<string>): boolean {
  for (const key of all) {
    if (!covered.has(key)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeStoryPaths(story: Story): CoveragePlan {
  const { nodes: dag, startSceneIds } = buildSceneDAG(story);

  // Build inventory
  const inventory: StoryInventory = {
    sceneIds: [],
    beatIds: [],
    choiceIds: [],
    encounterSceneIds: [],
    branchSceneIds: [],
  };

  const branchTargets = new Set<string>();

  for (const node of dag.values()) {
    inventory.sceneIds.push(node.sceneId);
    inventory.beatIds.push(...node.allBeatIds);
    inventory.choiceIds.push(...node.allChoiceIds);
    if (node.isEncounter) inventory.encounterSceneIds.push(node.sceneId);
    for (const bc of node.branchingChoices) {
      branchTargets.add(bc.targetSceneId);
    }
    for (const et of node.encounterTargets) {
      branchTargets.add(et.targetSceneId);
    }
  }

  // Branch scenes are those only reachable via explicit branching (not on the default sequential path)
  for (const target of branchTargets) {
    if (!inventory.branchSceneIds.includes(target)) {
      inventory.branchSceneIds.push(target);
    }
  }

  const paths = computePaths(dag, startSceneIds);

  const summary = [
    `Story: ${story.title}`,
    `Scenes: ${inventory.sceneIds.length}`,
    `Beats: ${inventory.beatIds.length}`,
    `Choices: ${inventory.choiceIds.length}`,
    `Encounters: ${inventory.encounterSceneIds.length}`,
    `Branch scenes: ${inventory.branchSceneIds.length}`,
    `Coverage paths: ${paths.length}`,
  ].join(', ');

  return { paths, inventory, summary };
}
