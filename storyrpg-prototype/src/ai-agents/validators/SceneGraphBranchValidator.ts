import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { isTerminalSceneTarget } from '../../engine/storyEngine';

export type SceneGraphBranchIssueType =
  | 'missing_scene_graph_branch'
  | 'missing_blueprint_branch'
  | 'invalid_branch_target'
  | 'backward_or_self_branch'
  | 'missing_choice_bridge'
  | 'branch_without_reconvergence'
  | 'lost_branch_during_assembly'
  | 'unrealized_blueprint_branch_target'
  | 'missing_branch_residue'
  | 'premature_npc_visual';

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
  /**
   * Blueprint scenes declared as multi-target (leadsTo.size>1) whose own
   * assembled choices fan out to fewer than two of those declared targets — i.e.
   * a planned branch point that assembled as a linear pass-through (a "dead
   * branch"). Always measured; only escalated to an issue when
   * `requireBlueprintBranchFanOut` is set.
   */
  unrealizedBlueprintBranchTargetCount: number;
}

export interface SceneGraphBranchValidationOptions {
  requireSceneGraphBranching?: boolean;
  requireChoiceBridge?: boolean;
  minSceneGraphBranchesPerEpisode?: number;
  allowLinearBottleneckEpisodes?: boolean;
  ignoreBlueprintBranchesWithoutSceneRouting?: boolean;
  importantNpcIds?: string[];
  /**
   * When true, a blueprint scene declared as a multi-target branch point
   * (leadsTo.size>1) whose own choices fan out to fewer than two of its declared
   * targets is reported as an `unrealized_blueprint_branch_target` error. Default
   * (false/undefined) is byte-identical to historical behavior — the count is
   * still measured into metrics, but no issue is emitted. Gated via
   * GATE_BRANCH_FANOUT by the pipeline.
   */
  requireBlueprintBranchFanOut?: boolean;
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
    const requireChoiceBridge = options.requireChoiceBridge !== false;
    const allowLinearBottleneck = options.allowLinearBottleneckEpisodes === true;
    const importantNpcIds = new Set((options.importantNpcIds || []).map(normalizeId));
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
    const introducedImportantNpcIds = new Set<string>();

    for (const scene of episode.scenes) {
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          regularChoiceCount += 1;
          const effectiveNextSceneId = choice.nextSceneId || resolveChoicePayoffSceneTarget(scene, choice.nextBeatId);
          if (!effectiveNextSceneId) continue;
          // A choice routing to a terminal sentinel (episode-end / story-end / …)
          // ENDS the story — it is not a scene-graph branch, and the target scene
          // legitimately does not exist in this episode's index. Skip all
          // branch-target checks (mirrors FinalStoryContractValidator + the reader
          // engine, which both treat these as valid terminal targets).
          if (isTerminalSceneTarget(effectiveNextSceneId)) continue;
          sceneGraphBranchChoiceCount += 1;
          branchTargets.add(effectiveNextSceneId);

          if (requireChoiceBridge) {
            const bridgeBeat = choice.nextBeatId
              ? (scene.beats || []).find(candidate => candidate.id === choice.nextBeatId)
              : undefined;
            if (choice.nextSceneId || !bridgeBeat?.isChoiceBridge) {
              issues.push({
                type: 'missing_choice_bridge',
                severity: 'error',
                message: `Choice ${choice.id} routes to ${effectiveNextSceneId} without a choice bridge beat.`,
                sceneId: scene.id,
                beatId: beat.id,
                choiceId: choice.id,
                targetSceneId: effectiveNextSceneId,
              });
            }
          }

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

      if (importantNpcIds.size > 0) {
        for (const beat of scene.beats || []) {
          const mentionedNpcIds = mentionedImportantNpcIds(beat, importantNpcIds);
          for (const npcId of visualMetadataImportantNpcIds(beat, importantNpcIds)) {
            if (!introducedImportantNpcIds.has(npcId) && !mentionedNpcIds.includes(npcId)) {
              issues.push({
                type: 'premature_npc_visual',
                severity: 'warning',
                message: `Beat ${beat.id} stages ${npcId} in visual metadata before the active path introduces them.`,
                sceneId: scene.id,
                beatId: beat.id,
              });
            }
          }
          for (const npcId of mentionedNpcIds) {
            introducedImportantNpcIds.add(npcId);
          }
        }
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

    // Fan-out coverage: a blueprint scene declared as a multi-target branch point
    // must have its OWN choices route to ≥2 of its declared `leadsTo` targets.
    // When the assembled choices all collapse to a single target, the planned
    // branch became a linear pass-through (a "dead branch" — the Endsong s3-1
    // case where leadsTo:[s3-2,s3-3] but every choice forced s3-2).
    let unrealizedBlueprintBranchTargetCount = 0;
    for (const bpScene of blueprint?.scenes || []) {
      const declaredTargets = new Set((bpScene.leadsTo || []).filter(Boolean));
      if (declaredTargets.size <= 1) continue;
      const assembled = scenesById.get(bpScene.id);
      if (!assembled) continue;
      const reachedTargets = new Set<string>();
      for (const beat of assembled.beats || []) {
        for (const choice of beat.choices || []) {
          const target = choice.nextSceneId || resolveChoicePayoffSceneTarget(assembled, choice.nextBeatId);
          if (target && declaredTargets.has(target)) reachedTargets.add(target);
        }
      }
      if (reachedTargets.size < 2) {
        unrealizedBlueprintBranchTargetCount += 1;
        if (options.requireBlueprintBranchFanOut) {
          issues.push({
            type: 'unrealized_blueprint_branch_target',
            severity: 'error',
            message:
              `Scene ${bpScene.id} is a planned branch point (leadsTo: ${[...declaredTargets].join(', ')}) ` +
              `but its choices only reach ${reachedTargets.size === 0 ? 'none' : [...reachedTargets].join(', ')} ` +
              'of those targets — the branch assembled as a linear pass-through.',
            sceneId: bpScene.id,
          });
        }
      }
    }

    if (blueprintRequiresBranches && sceneGraphBranchChoiceCount === 0 && !options.ignoreBlueprintBranchesWithoutSceneRouting) {
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
      unrealizedBlueprintBranchTargetCount,
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

/** A single choice acknowledges the branch path if it carries any residue signal. */
function choiceAcknowledgesResidue(choice: unknown): boolean {
  if (!choice || typeof choice !== 'object') return false;
  const c = choice as Record<string, unknown>;
  return Boolean(
    c.reminderPlan
      || c.memorableMoment
      || c.tintFlag
      || (Array.isArray(c.residueHints) && c.residueHints.length > 0)
      || (Array.isArray(c.witnessReactions) && c.witnessReactions.length > 0),
  );
}

/** A list of beats acknowledges residue via beat-level signals or any of their choices. */
function beatsAcknowledgeResidue(beats: unknown): boolean {
  if (!Array.isArray(beats)) return false;
  return beats.some((beat) => {
    if (!beat || typeof beat !== 'object') return false;
    const b = beat as Record<string, unknown>;
    return (
      (Array.isArray(b.textVariants) && b.textVariants.length > 0)
      || (Array.isArray(b.callbackHookIds) && b.callbackHookIds.length > 0)
      || (Array.isArray(b.onShow) && b.onShow.length > 0)
      || (Array.isArray(b.choices) && b.choices.some(choiceAcknowledgesResidue))
    );
  });
}

function sceneAcknowledgesBranchResidue(scene: Scene): boolean {
  // Regular scene beats.
  if (beatsAcknowledgeResidue(scene.beats)) return true;
  // ENCOUNTER scenes carry their content (and thus their branch-acknowledgment residue —
  // outcome-conditioned storylets, witness reactions, residue hints, onShow tints) inside the
  // nested encounter structure, NOT in top-level scene.beats. Without scanning here, every
  // reconverged encounter target (e.g. treatment-enc-2-1) false-fails this gate even when it
  // does acknowledge the branch. Scan phase beats AND outcome storylet beats.
  const enc = (scene as {
    encounter?: {
      beats?: unknown;
      phases?: Array<{ beats?: unknown }>;
      storylets?: Record<string, { beats?: unknown } | null | undefined>;
      outcomes?: Record<string, { nextSceneId?: string } | null | undefined>;
    };
  }).encounter;
  if (enc) {
    // The architect emits a flat `beats` array pre-normalization and `phases[].beats` after;
    // either may be present at validation time. Outcome storylets (victory/partial/defeat/
    // escape) also carry per-outcome beats. Scan all three for explicit residue signals.
    if (beatsAcknowledgeResidue(enc.beats)) return true;
    for (const phase of enc.phases || []) {
      if (beatsAcknowledgeResidue(phase?.beats)) return true;
    }
    for (const storylet of Object.values(enc.storylets || {})) {
      if (storylet && beatsAcknowledgeResidue(storylet.beats)) return true;
    }
    // Structural acknowledgment: an encounter scene is the designed MERGE point — branches
    // reconverge INTO it, and it re-diverges by OUTCOME. A genuinely-branched encounter
    // (≥2 distinct outcome storylets / outcomes) is therefore path-reactive by construction;
    // that is how an encounter acknowledges the branch path, since it carries no plain beats
    // and gets no SequenceDirector residue pass (which only authors conditional text on
    // regular scenes). Requiring beat-level residue on it is a category error — the validator
    // already holds that "encounter branches/storylets do not satisfy [scene-graph branching]"
    // elsewhere; the same special-casing applies here. A degenerate encounter (≤1 outcome,
    // no residue) still fails. NOTE: this credits the encounter's OWN outgoing branching, not
    // an incoming-branch callback — authoring convergence-aware encounter OPENINGS is a known
    // generative follow-up (SequenceDirector); see memory g10-shadow-gate-audit.
    const storyletCount = Object.values(enc.storylets || {}).filter(Boolean).length;
    const outcomeCount = Object.values(enc.outcomes || {}).filter(Boolean).length;
    if (storyletCount >= 2 || outcomeCount >= 2) return true;
  }
  return false;
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

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function visualMetadataImportantNpcIds(beat: Scene['beats'][number], importantNpcIds: Set<string>): string[] {
  const imagePrompt = (beat as unknown as { imagePrompt?: Record<string, unknown> }).imagePrompt;
  const promptCharacters = Array.isArray(imagePrompt?.characters) ? imagePrompt.characters as string[] : [];
  const promptReferenceIds = Array.isArray(imagePrompt?.referenceCharIds) ? imagePrompt.referenceCharIds as string[] : [];
  const visible = [
    ...(beat.visualCast?.sceneCharacterIds || []),
    ...(beat.coveragePlan?.requiredVisibleCharacterIds || []),
    ...(beat.coveragePlan?.optionalVisibleCharacterIds || []),
    ...(beat.coveragePlan?.focalCharacterIds || []),
    ...(beat.coveragePlan?.offscreenCharacterIds || []),
    ...(beat.visualCast?.activeCharacterIds || []),
    ...(beat.visualCast?.foregroundCharacterIds || []),
    ...(beat.visualCast?.backgroundCharacterIds || []),
    ...(beat.visualCast?.offscreenCharacterIds || []),
    ...promptCharacters,
    ...promptReferenceIds,
  ];
  return [...new Set(visible.map(normalizeId).filter(id => importantNpcIds.has(id)))];
}

function mentionedImportantNpcIds(beat: Scene['beats'][number], importantNpcIds: Set<string>): string[] {
  const fields = [
    beat.text,
    (beat as { visualMoment?: string }).visualMoment,
    (beat as { primaryAction?: string }).primaryAction,
    (beat as { emotionalRead?: string }).emotionalRead,
    (beat as { mustShowDetail?: string }).mustShowDetail,
  ];
  return [...importantNpcIds].filter(npcId => fields.some(field => mentionsNpc(field, npcId)));
}

function mentionsNpc(text: string | undefined, npcId: string): boolean {
  if (!text) return false;
  return normalizeId(text).includes(npcId);
}
