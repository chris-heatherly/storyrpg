/**
 * Scene-graph branch-loss repair (docs/PROJECT_AUDIT_2026-05-28.md).
 *
 * The blueprint can plan a real scene-graph branch (a scene whose choicePoint
 * branches, or that leadsTo >1 scene), but choice assembly intermittently drops
 * it — the branch scene ends up with no choice carrying `nextSceneId`, so the
 * episode fails the scene-graph branching contract and the whole run aborts
 * (observed: episode 1 of the endsong run, while episodes 2 & 3 branched fine).
 *
 * This deterministically repairs a LOST branch: for each blueprint branch scene
 * that produced zero scene-graph branches, it wires `nextSceneId` from the
 * blueprint's forward `leadsTo` targets onto the assembled choice-point beat's
 * choices — and synthesizes minimal branching choices if that beat has none.
 *
 * Pure + structurally typed so the (@ts-nocheck) pipeline can pass its real
 * Episode/Blueprint objects and it can be unit-tested in isolation.
 */

export interface RepairChoice {
  id?: string;
  text?: string;
  choiceType?: string;
  nextSceneId?: string;
  nextBeatId?: string;
  consequences?: unknown[];
  [key: string]: unknown;
}
export interface RepairBeat {
  id?: string;
  isChoicePoint?: boolean;
  choices?: RepairChoice[];
  [key: string]: unknown;
}
export interface RepairScene {
  id: string;
  name?: string;
  beats?: RepairBeat[];
  [key: string]: unknown;
}
export interface RepairEpisode {
  scenes?: RepairScene[];
  [key: string]: unknown;
}
export interface RepairBlueprintScene {
  id: string;
  leadsTo?: string[];
  choicePoint?: { branches?: boolean } | null;
}
export interface RepairBlueprint {
  scenes?: RepairBlueprintScene[];
}

function buildSyntheticBranchChoice(
  targetSceneId: string,
  targetScene: RepairScene | undefined,
  beatId: string,
  index: number,
): RepairChoice {
  const where = targetScene?.name ? `toward ${targetScene.name}` : `down a different path`;
  return {
    id: `${beatId || 'beat'}-branch-${index + 1}`,
    text: `Commit ${where}.`,
    choiceType: 'strategic',
    nextSceneId: targetSceneId,
    consequences: [],
    // Marks this as a repair-synthesized branch so it's traceable in output.
    synthesizedBranch: true,
  };
}

/**
 * Repair lost scene-graph branches in place. Returns the number of branch
 * scenes that were (re)wired. No-op (returns 0) when the episode already has at
 * least one scene-graph branch, or when no blueprint branch scene can be safely
 * wired (needs ≥2 distinct forward targets that exist in the episode).
 */
export function repairLostSceneGraphBranches(
  episode: RepairEpisode | undefined,
  blueprint: RepairBlueprint | undefined,
): number {
  const scenes = episode?.scenes;
  const bpScenes = blueprint?.scenes;
  if (!scenes?.length || !bpScenes?.length) return 0;

  // If any choice already routes to another scene, the episode branches — leave it.
  const alreadyBranches = scenes.some((s) =>
    (s.beats || []).some((b) => (b.choices || []).some((c) => !!c.nextSceneId)),
  );
  if (alreadyBranches) return 0;

  const indexById = new Map<string, number>();
  scenes.forEach((s, i) => indexById.set(s.id, i));

  let wired = 0;
  for (const bp of bpScenes) {
    const needsBranch = !!bp.choicePoint?.branches || new Set(bp.leadsTo || []).size > 1;
    if (!needsBranch) continue;

    const scene = scenes.find((s) => s.id === bp.id);
    if (!scene) continue;
    const currentIdx = indexById.get(scene.id);
    if (currentIdx === undefined) continue;

    // Distinct, forward, in-episode targets (avoid self/backward/missing).
    const targets = [...new Set(bp.leadsTo || [])].filter((t) => {
      const ti = indexById.get(t);
      return t !== scene.id && ti !== undefined && ti > currentIdx;
    });
    if (targets.length < 2) continue; // a real branch needs ≥2 distinct forward targets

    const beats = scene.beats || (scene.beats = []);
    let beat = beats.find((b) => b.isChoicePoint) || beats[beats.length - 1];
    if (!beat) {
      beat = { id: `${scene.id}-choice`, isChoicePoint: true, choices: [] };
      beats.push(beat);
    }
    beat.isChoicePoint = true;
    if (!beat.choices) beat.choices = [];

    // First, wire existing choices that lack a scene target.
    let assigned = 0;
    for (const choice of beat.choices) {
      if (assigned >= targets.length) break;
      if (!choice.nextSceneId) {
        choice.nextSceneId = targets[assigned];
        assigned += 1;
      }
    }
    // Synthesize choices for any remaining targets (e.g. the beat had no choices).
    for (let t = assigned; t < targets.length; t += 1) {
      const targetScene = scenes.find((s) => s.id === targets[t]);
      beat.choices.push(buildSyntheticBranchChoice(targets[t], targetScene, beat.id || scene.id, t));
    }

    wired += 1;
  }

  return wired;
}
