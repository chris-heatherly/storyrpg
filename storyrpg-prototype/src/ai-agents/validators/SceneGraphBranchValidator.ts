import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';

export type SceneGraphBranchIssueType =
  | 'missing_scene_graph_branch'
  | 'missing_blueprint_branch'
  | 'invalid_branch_target'
  | 'backward_or_self_branch'
  | 'branch_without_reconvergence'
  | 'lost_branch_during_assembly'
  | 'missing_branch_residue';

export interface SceneGraphBranchIssue {
  type: SceneGraphBranchIssueType;
  severity: 'error' | 'warning';
  message: string;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  targetSceneId?: string;
}

export interface SceneGraphBranchMetrics {
  episodeId: string;
  episodeNumber?: number;
  sceneCount: number;
  regularChoiceCount: number;
  sceneGraphBranchChoiceCount: number;
  encounterSceneCount: number;
  encounterChoiceCount: number;
  encounterOutcomeBranchCount: number;
  storyletCount: number;
  blueprintBranchPointCount: number;
  blueprintMultiTargetSceneCount: number;
  reconvergingBranchTargetCount: number;
}

export interface SceneGraphBranchValidationOptions {
  requireSceneGraphBranching?: boolean;
  minSceneGraphBranchesPerEpisode?: number;
  allowLinearBottleneckEpisodes?: boolean;
}

export interface SceneGraphBranchValidationResult {
  valid: boolean;
  metrics: SceneGraphBranchMetrics;
  issues: SceneGraphBranchIssue[];
  summary: string;
}

export class SceneGraphBranchValidator {
  validateEpisode(
    episode: Episode,
    blueprint?: EpisodeBlueprint,
    options: SceneGraphBranchValidationOptions = {},
  ): SceneGraphBranchValidationResult {
    const minBranches = options.minSceneGraphBranchesPerEpisode ?? 1;
    const requireBranching = options.requireSceneGraphBranching !== false;
    const allowLinearBottleneck = options.allowLinearBottleneckEpisodes === true;
    const issues: SceneGraphBranchIssue[] = [];
    const sceneIndex = new Map<string, number>();
    const scenesById = new Map<string, Scene>();
    episode.scenes.forEach((scene, index) => {
      sceneIndex.set(scene.id, index);
      scenesById.set(scene.id, scene);
    });

    let regularChoiceCount = 0;
    let sceneGraphBranchChoiceCount = 0;
    let encounterSceneCount = 0;
    let encounterChoiceCount = 0;
    let encounterOutcomeBranchCount = 0;
    let storyletCount = 0;
    let reconvergingBranchTargetCount = 0;
    const branchTargets = new Set<string>();

    for (const scene of episode.scenes) {
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          regularChoiceCount += 1;
          const effectiveNextSceneId = choice.nextSceneId || resolveChoicePayoffSceneTarget(scene, choice.nextBeatId);
          if (!effectiveNextSceneId) continue;
          sceneGraphBranchChoiceCount += 1;
          branchTargets.add(effectiveNextSceneId);

          const targetIndex = sceneIndex.get(effectiveNextSceneId);
          const currentIndex = sceneIndex.get(scene.id);
          if (targetIndex === undefined) {
            issues.push({
              type: 'invalid_branch_target',
              severity: 'error',
              message: `Choice ${choice.id} routes to missing scene ${effectiveNextSceneId}.`,
              sceneId: scene.id,
              beatId: beat.id,
              choiceId: choice.id,
              targetSceneId: effectiveNextSceneId,
            });
          } else if (currentIndex !== undefined && targetIndex <= currentIndex) {
            issues.push({
              type: 'backward_or_self_branch',
              severity: 'error',
              message: `Choice ${choice.id} routes backward or to its own scene (${effectiveNextSceneId}).`,
              sceneId: scene.id,
              beatId: beat.id,
              choiceId: choice.id,
              targetSceneId: effectiveNextSceneId,
            });
          }
        }
      }

      if (scene.encounter) {
        encounterSceneCount += 1;
        for (const phase of scene.encounter.phases || []) {
          for (const beat of phase.beats || []) {
            encounterChoiceCount += beat.choices?.length || 0;
          }
        }
        for (const outcome of Object.values(scene.encounter.outcomes || {})) {
          if (outcome?.nextSceneId) encounterOutcomeBranchCount += 1;
        }
        storyletCount += Object.values(scene.encounter.storylets || {}).filter(Boolean).length;
      }
    }

    for (const targetId of branchTargets) {
      const incomingCount = countIncomingEdges(episode.scenes, targetId);
      const target = scenesById.get(targetId);
      if (incomingCount > 1 || target?.isConvergencePoint || target?.isBottleneck) {
        reconvergingBranchTargetCount += 1;
      }
    }

    const blueprintBranchPointCount = blueprint?.scenes?.filter(scene => scene.choicePoint?.branches).length || 0;
    const blueprintMultiTargetSceneCount = blueprint?.scenes?.filter(scene => new Set(scene.leadsTo || []).size > 1).length || 0;
    const blueprintRequiresBranches = blueprintBranchPointCount > 0 || blueprintMultiTargetSceneCount > 0;

    if (blueprintRequiresBranches && sceneGraphBranchChoiceCount === 0) {
      issues.push({
        type: 'lost_branch_during_assembly',
        severity: 'error',
        message: 'Blueprint planned scene-graph branching, but no assembled choice has nextSceneId.',
      });
    }

    if (requireBranching && !allowLinearBottleneck) {
      if (!blueprintRequiresBranches && blueprint) {
        issues.push({
          type: 'missing_blueprint_branch',
          severity: 'error',
          message: 'Blueprint has no choicePoint with branches=true and no scene with multiple leadsTo targets.',
        });
      }
      if (sceneGraphBranchChoiceCount < minBranches) {
        issues.push({
          type: 'missing_scene_graph_branch',
          severity: 'error',
          message: `Episode has ${sceneGraphBranchChoiceCount} scene-graph branch choice(s); expected at least ${minBranches}. Encounter branches/storylets do not satisfy this contract.`,
        });
      }
    }

    for (const targetId of branchTargets) {
      if (countIncomingEdges(episode.scenes, targetId) <= 1) {
        issues.push({
          type: 'branch_without_reconvergence',
          severity: 'warning',
          message: `Branch target ${targetId} has no obvious reconvergence/bottleneck incoming edge.`,
          targetSceneId: targetId,
        });
      }
    }

    for (const scene of episode.scenes) {
      const distinctIncomingScenes = countDistinctIncomingSourceScenes(episode.scenes, scene.id);
      if (distinctIncomingScenes <= 1 && !scene.isConvergencePoint) continue;
      if (!(scene.isBottleneck || scene.isConvergencePoint || distinctIncomingScenes > 1)) continue;
      if (!sceneAcknowledgesBranchResidue(scene)) {
        issues.push({
          type: 'missing_branch_residue',
          severity: 'error',
          message: `Reconverged branch target ${scene.id} has no conditional text, callback hook, or onShow residue to acknowledge the branch path.`,
          targetSceneId: scene.id,
        });
      }
    }

    const metrics: SceneGraphBranchMetrics = {
      episodeId: episode.id,
      episodeNumber: episode.number,
      sceneCount: episode.scenes.length,
      regularChoiceCount,
      sceneGraphBranchChoiceCount,
      encounterSceneCount,
      encounterChoiceCount,
      encounterOutcomeBranchCount,
      storyletCount,
      blueprintBranchPointCount,
      blueprintMultiTargetSceneCount,
      reconvergingBranchTargetCount,
    };

    const errorCount = issues.filter(issue => issue.severity === 'error').length;
    return {
      valid: errorCount === 0,
      metrics,
      issues,
      summary:
        `${regularChoiceCount} choices, ${sceneGraphBranchChoiceCount} scene branches, ` +
        `${encounterSceneCount} encounters, ${encounterChoiceCount} encounter choices, ${storyletCount} storylets`,
    };
  }
}

function sceneAcknowledgesBranchResidue(scene: Scene): boolean {
  return (scene.beats || []).some((beat) =>
    (beat.textVariants?.length ?? 0) > 0
      || (beat.callbackHookIds?.length ?? 0) > 0
      || (beat.onShow?.length ?? 0) > 0
      || (beat.choices || []).some((choice) =>
        Boolean(
          choice.reminderPlan
            || choice.memorableMoment
            || choice.tintFlag
            || (choice.residueHints?.length ?? 0) > 0
            || (choice.witnessReactions?.length ?? 0) > 0
        )
      )
  );
}

function countIncomingEdges(scenes: Scene[], targetId: string): number {
  let count = 0;
  for (const scene of scenes) {
    if (scene.leadsTo?.includes(targetId)) count += 1;
    for (const beat of scene.beats || []) {
      for (const choice of beat.choices || []) {
        if ((choice.nextSceneId || resolveChoicePayoffSceneTarget(scene, choice.nextBeatId)) === targetId) count += 1;
      }
    }
    if (scene.encounter) {
      for (const outcome of Object.values(scene.encounter.outcomes || {})) {
        if (outcome?.nextSceneId === targetId) count += 1;
      }
    }
  }
  return count;
}

function countDistinctIncomingSourceScenes(scenes: Scene[], targetId: string): number {
  const sourceSceneIds = new Set<string>();
  for (const scene of scenes) {
    if (scene.id === targetId) continue;
    if (scene.leadsTo?.includes(targetId)) sourceSceneIds.add(scene.id);
    for (const beat of scene.beats || []) {
      for (const choice of beat.choices || []) {
        if ((choice.nextSceneId || resolveChoicePayoffSceneTarget(scene, choice.nextBeatId)) === targetId) {
          sourceSceneIds.add(scene.id);
        }
      }
      if (beat.nextSceneId === targetId) sourceSceneIds.add(scene.id);
    }
    if (scene.encounter) {
      for (const outcome of Object.values(scene.encounter.outcomes || {})) {
        if (outcome?.nextSceneId === targetId) sourceSceneIds.add(scene.id);
      }
    }
  }
  return sourceSceneIds.size;
}

function resolveChoicePayoffSceneTarget(scene: Scene, nextBeatId?: string): string | undefined {
  if (!nextBeatId) return undefined;
  const nextBeat = (scene.beats || []).find((beat) => beat.id === nextBeatId);
  return nextBeat?.nextSceneId;
}
