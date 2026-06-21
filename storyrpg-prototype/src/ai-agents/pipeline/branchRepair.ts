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
  isChoiceBridge?: boolean;
  nextSceneId?: string;
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
  name?: string;
  leadsTo?: string[];
  choicePoint?: { branches?: boolean } | null;
  isEncounter?: boolean;
  plannedEncounterId?: string;
  purpose?: string;
  requiredBeats?: Array<{ tier?: string }>;
}
export interface RepairBlueprint {
  scenes?: RepairBlueprintScene[];
}

export interface BlueprintRequiredSetupSkipRepair {
  sceneId: string;
  fromTargetSceneId: string;
  toTargetSceneId: string;
  skippedSceneIds: string[];
}

export interface RepairChoiceSet {
  sceneId?: string;
  choices?: Array<{
    id?: string;
    nextSceneId?: string;
    repairedRequiredSetupSkip?: boolean;
    repairedInvalidBranchTarget?: boolean;
  }>;
}

function repairBlueprintLeadsTo(
  blueprint: RepairBlueprint | undefined,
  sceneId: string | undefined,
  fromTarget: string | undefined,
  toTarget: string,
): void {
  if (!sceneId || !fromTarget) return;
  const bpScene = blueprint?.scenes?.find((scene) => scene.id === sceneId);
  if (bpScene?.leadsTo?.includes(fromTarget)) {
    bpScene.leadsTo = [...new Set(bpScene.leadsTo.map((target) =>
      target === fromTarget ? toTarget : target,
    ))];
  }
}

function blueprintSceneRequiresSequentialSetup(scene: RepairBlueprintScene): boolean {
  if (scene.isEncounter || scene.plannedEncounterId) return true;
  if (/bottleneck|convergence/i.test(scene.purpose || '')) return true;
  if (/treatment|encounter|required|anchor/i.test(`${scene.id} ${scene.name || ''}`)) return true;
  return (scene.requiredBeats || []).some((beat) =>
    beat?.tier === 'authored' || beat?.tier === 'signature',
  );
}

/**
 * Repair blueprint topology before ChoiceAuthor sees it. A branch scene must not
 * offer both a required setup/encounter and that setup's aftermath as sibling
 * targets; the latter asks the LLM to author a route that skips mandatory story
 * material. Collapse any such target to the first skipped setup scene.
 */
export function repairBlueprintRequiredSetupSkips(
  blueprint: RepairBlueprint | undefined,
): BlueprintRequiredSetupSkipRepair[] {
  const scenes = blueprint?.scenes;
  if (!scenes?.length) return [];

  const indexById = new Map<string, number>();
  scenes.forEach((scene, index) => indexById.set(scene.id, index));

  const repairs: BlueprintRequiredSetupSkipRepair[] = [];
  for (const scene of scenes) {
    const sourceIndex = indexById.get(scene.id);
    if (sourceIndex === undefined || !scene.leadsTo?.length) continue;

    const repairedTargets = scene.leadsTo.map((target) => {
      const targetIndex = indexById.get(target);
      if (targetIndex === undefined || targetIndex <= sourceIndex + 1) return target;

      const skipped = scenes
        .slice(sourceIndex + 1, targetIndex)
        .filter(blueprintSceneRequiresSequentialSetup);
      if (skipped.length === 0) return target;

      const toTarget = skipped[0].id;
      repairs.push({
        sceneId: scene.id,
        fromTargetSceneId: target,
        toTargetSceneId: toTarget,
        skippedSceneIds: skipped.map((skippedScene) => skippedScene.id),
      });
      return toTarget;
    });

    scene.leadsTo = [...new Set(repairedTargets)];
    if (scene.leadsTo.length < 2 && scene.choicePoint?.branches) {
      scene.choicePoint.branches = false;
    }
  }

  return repairs;
}

export function applyBlueprintRequiredSetupSkipRepairsToChoiceSets(
  choiceSets: RepairChoiceSet[] | undefined,
  repairs: BlueprintRequiredSetupSkipRepair[],
): number {
  if (!choiceSets?.length || repairs.length === 0) return 0;
  let repaired = 0;

  for (const repair of repairs) {
    for (const choiceSet of choiceSets) {
      if (choiceSet.sceneId !== repair.sceneId) continue;
      for (const choice of choiceSet.choices || []) {
        if (choice.nextSceneId !== repair.fromTargetSceneId) continue;
        choice.nextSceneId = repair.toTargetSceneId;
        choice.repairedRequiredSetupSkip = true;
        repaired += 1;
      }
    }
  }

  return repaired;
}

export interface RequiredSetupSkipIssue {
  type?: string;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  targetSceneId?: string;
  skippedSceneIds?: string[];
}

export interface InvalidBranchTargetIssue {
  type?: string;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  targetSceneId?: string;
}

function buildSyntheticBranchChoice(beatId: string, index: number): RepairChoice {
  return {
    id: `${beatId || 'beat'}-branch-${index + 1}`,
    text: `Commit to this path.`,
    choiceType: 'strategic',
    consequences: [],
    // Marks this as a repair-synthesized branch so it's traceable in output.
    synthesizedBranch: true,
  };
}

/**
 * Whether a choice already routes to another scene — either directly via
 * nextSceneId, or via a same-scene choice-bridge beat (nextBeatId -> beat with
 * nextSceneId). Mirrors the validator's effective-target logic so repair never
 * double-fires on an episode that already branches.
 */
function choiceHasSceneTarget(scene: RepairScene, choice: RepairChoice): boolean {
  if (choice.nextSceneId) return true;
  if (choice.nextBeatId) {
    const bridge = (scene.beats || []).find((b) => b.id === choice.nextBeatId);
    if (bridge?.nextSceneId) return true;
  }
  return false;
}

/**
 * Route a choice to a target scene THROUGH a choice-bridge beat (the contract
 * the validator enforces when requireChoiceBridge is on): the choice points at
 * a bridge beat via nextBeatId (never a raw nextSceneId), and the bridge beat
 * carries isChoiceBridge + nextSceneId. Mirrors FullStoryPipeline.ensureChoiceBridgeBeats.
 */
function wireChoiceThroughBridge(
  scene: RepairScene,
  beatId: string,
  choice: RepairChoice,
  targetSceneId: string,
  targetScene: RepairScene | undefined,
  index: number,
): void {
  const beats = scene.beats || (scene.beats = []);
  const bridgeId = `${beatId || scene.id}-bridge-${index + 1}`;
  choice.nextBeatId = bridgeId;
  delete choice.nextSceneId;

  if (!beats.find((b) => b.id === bridgeId)) {
    const where = targetScene?.name ? ` toward ${targetScene.name}` : '';
    beats.push({
      id: bridgeId,
      isChoiceBridge: true,
      nextSceneId: targetSceneId,
      text: `The decision turns into motion${where}.`,
      synthesizedBranch: true,
    });
  }
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

  // If any choice already routes to another scene (directly or via a bridge
  // beat), the episode branches — leave it.
  const alreadyBranches = scenes.some((s) =>
    (s.beats || []).some((b) => (b.choices || []).some((c) => choiceHasSceneTarget(s, c))),
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
    const beatId = beat.id || scene.id;

    // Route each target THROUGH a choice-bridge beat (never a raw nextSceneId,
    // which the validator rejects). Reuse existing target-less choices first,
    // then synthesize one per remaining target.
    let assigned = 0;
    for (const choice of beat.choices) {
      if (assigned >= targets.length) break;
      if (!choiceHasSceneTarget(scene, choice)) {
        wireChoiceThroughBridge(scene, beatId, choice, targets[assigned], scenes.find((s) => s.id === targets[assigned]), assigned);
        assigned += 1;
      }
    }
    for (let t = assigned; t < targets.length; t += 1) {
      const choice = buildSyntheticBranchChoice(beatId, t);
      beat.choices.push(choice);
      wireChoiceThroughBridge(scene, beatId, choice, targets[t], scenes.find((s) => s.id === targets[t]), t);
    }

    wired += 1;
  }

  return wired;
}

/**
 * Repair an early choice bridge that jumps over required setup by retargeting
 * the offending bridge to the first skipped setup scene. This preserves the
 * player path and lets the authored scene sequence carry the setup instead of
 * silently allowing a continuity skip.
 */
export function repairRequiredSetupSkips(
  episode: RepairEpisode | undefined,
  issues: RequiredSetupSkipIssue[],
  blueprint?: RepairBlueprint | undefined,
): number {
  const scenes = episode?.scenes;
  if (!scenes?.length || !issues?.length) return 0;
  let repaired = 0;

  for (const issue of issues) {
    if (issue.type !== 'path_missing_required_setup') continue;
    const firstSkippedSceneId = issue.skippedSceneIds?.[0];
    if (!firstSkippedSceneId || !issue.sceneId || !issue.choiceId) continue;
    const source = scenes.find((scene) => scene.id === issue.sceneId);
    if (!source) continue;
    const sourceIndex = scenes.findIndex((scene) => scene.id === issue.sceneId);
    const skippedIndex = scenes.findIndex((scene) => scene.id === firstSkippedSceneId);
    if (sourceIndex < 0 || skippedIndex <= sourceIndex) continue;

    let touched = false;
    for (const beat of source.beats || []) {
      const choice = (beat.choices || []).find((candidate) => candidate.id === issue.choiceId);
      if (!choice) continue;
      if (choice.nextBeatId) {
        const bridge = (source.beats || []).find((candidate) => candidate.id === choice.nextBeatId);
        if (bridge && bridge.nextSceneId === issue.targetSceneId) {
          bridge.nextSceneId = firstSkippedSceneId;
          bridge.repairedRequiredSetupSkip = true;
          touched = true;
        }
      } else if (choice.nextSceneId === issue.targetSceneId) {
        choice.nextSceneId = firstSkippedSceneId;
        choice.repairedRequiredSetupSkip = true;
        touched = true;
      }
    }
    if (touched) {
      repairBlueprintLeadsTo(blueprint, issue.sceneId, issue.targetSceneId, firstSkippedSceneId);
      repaired += 1;
    }
  }

  return repaired;
}

/**
 * Same repair as repairRequiredSetupSkips, but applied to the source ChoiceSet
 * artifacts that later assembly reads. Without this, branch validation can repair
 * a temporary assembled episode while the durable episode checkpoint is rebuilt
 * from stale choiceSets and reintroduces the bad bridge target.
 */
export function repairRequiredSetupSkipsInChoiceSets(
  choiceSets: RepairChoiceSet[] | undefined,
  issues: RequiredSetupSkipIssue[],
  blueprint?: RepairBlueprint | undefined,
): number {
  if (!choiceSets?.length || !issues?.length) return 0;
  let repaired = 0;

  for (const issue of issues) {
    if (issue.type !== 'path_missing_required_setup') continue;
    const firstSkippedSceneId = issue.skippedSceneIds?.[0];
    if (!firstSkippedSceneId || !issue.sceneId || !issue.choiceId || !issue.targetSceneId) continue;

    let touched = false;
    for (const choiceSet of choiceSets) {
      if (choiceSet.sceneId !== issue.sceneId) continue;
      const choice = choiceSet.choices?.find((candidate) => candidate.id === issue.choiceId);
      if (!choice || choice.nextSceneId !== issue.targetSceneId) continue;
      choice.nextSceneId = firstSkippedSceneId;
      choice.repairedRequiredSetupSkip = true;
      touched = true;
    }

    if (touched) {
      repairBlueprintLeadsTo(blueprint, issue.sceneId, issue.targetSceneId, firstSkippedSceneId);
      repaired += 1;
    }
  }

  return repaired;
}

function validRepairTarget(
  sceneId: string,
  targetSceneId: string | undefined,
  episode: RepairEpisode | undefined,
  blueprint: RepairBlueprint | undefined,
): string {
  const sceneIds = new Set((episode?.scenes || []).map((scene) => scene.id));
  const blueprintScene = blueprint?.scenes?.find((scene) => scene.id === sceneId);
  const forward = (blueprintScene?.leadsTo || []).find((target) => target !== sceneId && sceneIds.has(target));
  // A terminal scene has no in-episode forward target; route to the reader's
  // existing sentinel instead of preserving an invented missing scene.
  return forward || (targetSceneId?.toLowerCase().startsWith('episode-') ? targetSceneId : 'episode-end');
}

export function repairInvalidBranchTargets(
  episode: RepairEpisode | undefined,
  issues: InvalidBranchTargetIssue[],
  blueprint?: RepairBlueprint | undefined,
): number {
  const scenes = episode?.scenes;
  if (!scenes?.length || !issues?.length) return 0;
  let repaired = 0;

  for (const issue of issues) {
    if (issue.type !== 'invalid_branch_target' || !issue.sceneId || !issue.choiceId || !issue.targetSceneId) continue;
    const source = scenes.find((scene) => scene.id === issue.sceneId);
    if (!source) continue;
    const target = validRepairTarget(issue.sceneId, issue.targetSceneId, episode, blueprint);

    let touched = false;
    for (const beat of source.beats || []) {
      for (const choice of beat.choices || []) {
        if (choice.id !== issue.choiceId) continue;
        if (choice.nextSceneId === issue.targetSceneId) {
          choice.nextSceneId = target;
          choice.repairedInvalidBranchTarget = true;
          touched = true;
        }
        if (choice.nextBeatId) {
          const bridge = (source.beats || []).find((candidate) => candidate.id === choice.nextBeatId);
          if (bridge?.nextSceneId === issue.targetSceneId) {
            bridge.nextSceneId = target;
            bridge.repairedInvalidBranchTarget = true;
            touched = true;
          }
        }
      }
    }
    if (touched) repaired += 1;
  }

  return repaired;
}

export function repairInvalidBranchTargetsInChoiceSets(
  choiceSets: RepairChoiceSet[] | undefined,
  issues: InvalidBranchTargetIssue[],
  episode?: RepairEpisode | undefined,
  blueprint?: RepairBlueprint | undefined,
): number {
  if (!choiceSets?.length || !issues?.length) return 0;
  let repaired = 0;

  for (const issue of issues) {
    if (issue.type !== 'invalid_branch_target' || !issue.sceneId || !issue.choiceId || !issue.targetSceneId) continue;
    const target = validRepairTarget(issue.sceneId, issue.targetSceneId, episode, blueprint);
    let touched = false;
    for (const choiceSet of choiceSets) {
      if (choiceSet.sceneId !== issue.sceneId) continue;
      const choice = choiceSet.choices?.find((candidate) => candidate.id === issue.choiceId);
      if (!choice || choice.nextSceneId !== issue.targetSceneId) continue;
      choice.nextSceneId = target;
      choice.repairedInvalidBranchTarget = true;
      touched = true;
    }
    if (touched) repaired += 1;
  }

  return repaired;
}
