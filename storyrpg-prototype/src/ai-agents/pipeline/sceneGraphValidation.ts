/**
 * Read-only scene-graph branching validation cluster.
 *
 * Runs SceneGraphBranchValidator plus the Gen-4 audit checks. Findings never
 * retarget choices, rewrite prose, or annotate a committed scene.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { Episode } from '../../types';
import { EpisodeBlueprint } from '../agents/StoryArchitect';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import {
  SceneGraphBranchValidator,
  DuplicateEstablishingBeatValidator,
  TreatmentSeedOnPageValidator,
  EndingReachabilityValidator,
} from '../validators';
import type { SceneGraphBranchValidationResult } from '../validators/SceneGraphBranchValidator';
import { isGateEnabled } from '../remediation/gateDefaults';
import {
  buildGateShadowRecord,
  buildValidatorPromotionRecord,
  type GateShadowRecord,
} from '../remediation/gateShadowLedger';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import type { PipelineEvent } from './events';

export interface SceneGraphValidationDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  recordGateShadowSafe: (
    record: Omit<GateShadowRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ) => Promise<void>;
  throwIfFailFast: (
    message: string,
    phase: string,
    options?: { agent?: string; cause?: unknown; context?: Record<string, unknown> },
  ) => void;
  sceneGraphBranchValidator: Pick<SceneGraphBranchValidator, 'validateEpisode'>;
  duplicateEstablishingBeatValidator: Pick<DuplicateEstablishingBeatValidator, 'validateEpisode'>;
  treatmentSeedOnPageValidator: Pick<TreatmentSeedOnPageValidator, 'validateEpisode'>;
  endingReachabilityValidator: Pick<EndingReachabilityValidator, 'validateEpisode'>;
}

export class SceneGraphValidation {
  constructor(private deps: SceneGraphValidationDeps) {}

  async validateSceneGraphBranching(
    episode: Episode,
    blueprint: EpisodeBlueprint,
    context: {
      phase: string;
      outputDirectory?: string;
      artifactName?: string;
      choiceSets?: ChoiceSet[];
    }
  ): Promise<SceneGraphBranchValidationResult> {
    const hasSafeBranchSlot = blueprintHasSafeSceneGraphBranchSlot(blueprint);
    const branchOptions = {
      requireSceneGraphBranching: !hasSafeBranchSlot ? false : this.deps.config.generation?.requireSceneGraphBranching,
      minSceneGraphBranchesPerEpisode: this.deps.config.generation?.minSceneGraphBranchesPerEpisode,
      allowLinearBottleneckEpisodes: !hasSafeBranchSlot ? true : this.deps.config.generation?.allowLinearBottleneckEpisodes,
      ignoreBlueprintBranchesWithoutSceneRouting: false,
      // Gen-4 audit: flag planned multi-target branch points that assembled as a
      // linear pass-through (dead branch). Default-off; metric always recorded.
      requireBlueprintBranchFanOut: hasSafeBranchSlot && isGateEnabled('GATE_BRANCH_FANOUT'),
    };
    const result = this.deps.sceneGraphBranchValidator.validateEpisode(episode, blueprint, branchOptions);

    this.deps.emit({
      type: result.valid ? 'checkpoint' : 'warning',
      phase: context.phase,
      message: `SceneGraphBranchValidator: ${result.summary}`,
      data: result,
    });

    if (context.outputDirectory && context.artifactName) {
      try {
        await saveEarlyDiagnostic(context.outputDirectory, context.artifactName, result);
      } catch (err) {
        this.deps.emit({
          type: 'warning',
          phase: context.phase,
          message: `Failed to save branch metrics: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (!result.valid) {
      const errors = result.issues.filter(issue => issue.severity === 'error');
      this.deps.throwIfFailFast(
        `Scene-graph branching validation failed: ${errors.map(issue => issue.message).join(' ')}`,
        context.phase,
        {
          context: {
            branchMetrics: result.metrics,
            branchIssues: result.issues,
            failureKind: 'scene_graph_branching',
          },
        }
      );
    }

    // Gen-4 audit: dual-first-entry / duplicate establishing-beat check. Always
    // recorded as a warning event; only fail-fasts when GATE_DUPLICATE_ESTABLISHING_BEAT
    // promotes it to blocking. (The season-level continuity remediation loop is the
    // softer landing once it lands.)
    const dupBlocking = isGateEnabled('GATE_DUPLICATE_ESTABLISHING_BEAT');
    const dup = this.deps.duplicateEstablishingBeatValidator.validateEpisode(episode, blueprint, { blocking: dupBlocking });
    const dupInitialCount = dup.metrics.duplicateEstablishingBeatCount;
    // Wave-0 shadow telemetry: record the flag-INDEPENDENT would-fire count
    // (duplicateEstablishingBeatCount is the same whether blocking is on or off) so
    // gate-shadow-ledger.jsonl accumulates the false-positive data this prose
    // heuristic needs before it can be promoted off -> on. Best-effort, never blocks.
    {
      const dupShadow = buildGateShadowRecord({
        gate: 'GATE_DUPLICATE_ESTABLISHING_BEAT',
        validator: 'DuplicateEstablishingBeatValidator',
        scope: 'episode',
        enabled: dupBlocking,
        blockingCount: dupInitialCount,
        wouldRepairCount: dupInitialCount,
        repairAttempted: false,
        residualBlockingCount: dup.metrics.duplicateEstablishingBeatCount,
        storyId: episode.id,
      });
      const dupDetails = dup.issues.map((issue) => `${issue.priorSceneId}->${issue.sceneId}`).join('; ') || undefined;
      await this.deps.recordGateShadowSafe({ ...dupShadow, details: dupDetails });
    }
    if (dup.issues.length > 0) {
      this.deps.emit({
        type: 'warning',
        phase: context.phase,
        message:
          `DuplicateEstablishingBeatValidator: ${dup.metrics.duplicateEstablishingBeatCount} duplicate establishing beat(s) — ` +
          dup.issues.map(issue => `${issue.priorSceneId}->${issue.sceneId}`).join(', '),
        data: dup,
      });
      if (dupBlocking && !dup.valid) {
        this.deps.throwIfFailFast(
          `Duplicate establishing-beat: ${dup.issues.map(issue => issue.message).join(' ')}`,
          context.phase,
          { context: { duplicateEstablishingBeats: dup.issues, failureKind: 'duplicate_establishing_beat' } },
        );
      }
    }

    // Gen-4 audit: every declared treatment_seed_* must be SET on-page by a setFlag
    // consequence on some choice in the episode. Always emits a warning when a seed
    // is missing; only fail-fasts when GATE_TREATMENT_SEED_ONPAGE is on.
    const seedBlocking = isGateEnabled('GATE_TREATMENT_SEED_ONPAGE');
    const seedCheck = this.deps.treatmentSeedOnPageValidator.validateEpisode(episode, blueprint, { blocking: seedBlocking });
    if (seedCheck.issues.length > 0) {
      this.deps.emit({
        type: 'warning',
        phase: context.phase,
        message:
          `TreatmentSeedOnPageValidator: ${seedCheck.metrics.missingSeeds}/${seedCheck.metrics.declaredSeeds} ` +
          `treatment seed(s) never set on-page — ${seedCheck.issues.map(issue => issue.flag).join(', ')}`,
        data: seedCheck,
      });
      if (seedBlocking && !seedCheck.valid) {
        this.deps.throwIfFailFast(
          `Treatment seed not set on-page: ${seedCheck.issues.map(issue => issue.message).join(' ')}`,
          context.phase,
          { context: { missingTreatmentSeeds: seedCheck.issues, failureKind: 'treatment_seed_not_set_on_page' } },
        );
      }
    }

    // Gen-4 audit (R3): every declared ending-axis (treatment_branch_*) must be SET
    // on-page so the named ending it drives is mechanically reachable. Always warns
    // when an axis is missing; only fail-fasts when GATE_ENDING_REACHABILITY is on
    // (default-off until validated against a full-season run).
    const endingBlocking = isGateEnabled('GATE_ENDING_REACHABILITY');
    const endingCheck = this.deps.endingReachabilityValidator.validateEpisode(episode, blueprint, { blocking: endingBlocking });
    await this.deps.recordGateShadowSafe(buildValidatorPromotionRecord({
      gate: 'GATE_ENDING_REACHABILITY',
      validator: 'EndingReachabilityValidator',
      scope: 'episode',
      placement: 'season-final',
      enabled: endingBlocking,
      blockingCount: endingCheck.metrics.missingAxes,
      residualBlockingCount: endingCheck.metrics.missingAxes,
      suppressedReason: !endingBlocking && endingCheck.metrics.missingAxes > 0
        ? 'partial-season/default-off shadow; promote only with full-season proof or a slice covering all ending-axis setInEpisode obligations'
        : undefined,
      storyId: episode.id,
      issues: endingCheck.issues,
      details:
        `episode=${episode.number}; declaredAxes=${endingCheck.metrics.declaredAxes}; ` +
        `setAxes=${endingCheck.metrics.setAxes}; missingAxes=${endingCheck.metrics.missingAxes}; ` +
        `missing=${endingCheck.issues.map((issue) => issue.flag).join(',') || 'none'}`,
    }));
    if (endingCheck.issues.length > 0) {
      this.deps.emit({
        type: 'warning',
        phase: context.phase,
        message:
          `EndingReachabilityValidator: ${endingCheck.metrics.missingAxes}/${endingCheck.metrics.declaredAxes} ` +
          `ending-axis flag(s) never set on-page — ${endingCheck.issues.map(issue => issue.flag).join(', ')}`,
        data: endingCheck,
      });
      if (endingBlocking && !endingCheck.valid) {
        this.deps.throwIfFailFast(
          `Ending axis not set on-page: ${endingCheck.issues.map(issue => issue.message).join(' ')}`,
          context.phase,
          { context: { missingEndingAxes: endingCheck.issues, failureKind: 'ending_axis_not_set_on_page' } },
        );
      }
    }

    return result;
  }

  /* Removed from the executable pipeline: post-commit branch repair reopened
   * sealed choices/scenes. Kept temporarily as migration history only.
  async repairSceneGraphBranchingChoices(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure>,
    context: { phase: string }
  ): Promise<boolean> {
    const blueprintSetupRepairs = repairBlueprintRequiredSetupSkips(blueprint as never);
    const choiceSetSetupRepairs = applyBlueprintRequiredSetupSkipRepairsToChoiceSets(
      choiceSets as never,
      blueprintSetupRepairs,
    );
    if (blueprintSetupRepairs.length > 0) {
      this.deps.emit({
        type: 'warning',
        phase: context.phase,
        message:
          `Repaired ${blueprintSetupRepairs.length} blueprint branch target(s) that skipped required setup ` +
          `before choice repair${choiceSetSetupRepairs > 0 ? `; retargeted ${choiceSetSetupRepairs} authored choice(s)` : ''}.`,
        data: { repairs: blueprintSetupRepairs },
      });
    }

    const episode = this.deps.assembleEpisode(
      brief,
      worldBible,
      characterBible,
      blueprint,
      sceneContents,
      choiceSets,
      undefined,
      encounters,
      undefined,
    );
    const validation = this.deps.sceneGraphBranchValidator.validateEpisode(episode, blueprint, {
      requireSceneGraphBranching: this.deps.config.generation?.requireSceneGraphBranching,
      minSceneGraphBranchesPerEpisode: this.deps.config.generation?.minSceneGraphBranchesPerEpisode,
      allowLinearBottleneckEpisodes: this.deps.config.generation?.allowLinearBottleneckEpisodes,
    });
    const repairedBlueprintSetup = blueprintSetupRepairs.length > 0 || choiceSetSetupRepairs > 0;
    if (validation.valid) return repairedBlueprintSetup;

    const needsChoiceRepair = validation.issues.some(issue =>
      issue.type === 'lost_branch_during_assembly' ||
      issue.type === 'missing_scene_graph_branch'
    );
    const needsResidueRepair = validation.issues.some(issue =>
      issue.type === 'missing_branch_residue'
    );
    const repairable = needsChoiceRepair || needsResidueRepair;
    if (!repairable) return repairedBlueprintSetup;

    const residueRepaired = needsResidueRepair
      ? this.repairSceneGraphBranchResidue(
          validation,
          blueprint,
          sceneContents,
          context.phase,
        )
      : false;
    if (!needsChoiceRepair) return residueRepaired;

    const branchScenes = blueprint.scenes.filter(scene =>
      scene.choicePoint?.branches &&
      scene.choicePoint.type !== 'expression' &&
      new Set(scene.leadsTo || []).size >= 2 &&
      !scene.isEncounter
    );
    if (branchScenes.length === 0) return residueRepaired;

    let repaired = repairedBlueprintSetup || residueRepaired;
    for (const sceneBlueprint of branchScenes.slice(0, 2)) {
      const sceneContent = sceneContents.find(scene => scene.sceneId === sceneBlueprint.id);
      if (!sceneContent || sceneContent.beats.length === 0) continue;

      let choicePointBeat = sceneContent.beats.find(beat => beat.isChoicePoint);
      if (!choicePointBeat) {
        choicePointBeat = sceneContent.beats[sceneContent.beats.length - 1];
        choicePointBeat.isChoicePoint = true;
      }

      this.deps.emit({
        type: 'regeneration_triggered',
        phase: context.phase,
        message: `Repairing scene-graph branch choices for ${sceneBlueprint.id}`,
        data: { sceneId: sceneBlueprint.id, beatId: choicePointBeat.id, leadsTo: sceneBlueprint.leadsTo },
      });

      const location = this.deps.resolveWorldLocationForScene(sceneBlueprint, worldBible);
      const plannedConsequenceTiers = plannedConsequenceTiersByScene(brief.seasonPlan);
      const repairResult = await withTimeout(this.deps.choiceAuthor.execute({
        sceneBlueprint,
        beatText: choicePointBeat.text,
        beatId: choicePointBeat.id,
        storyContext: {
          title: brief.story.title,
          genre: brief.story.genre,
          tone: brief.story.tone,
          userPrompt:
            `${brief.userPrompt || ''}\n\nCRITICAL SCENE-GRAPH BRANCH REPAIR:\n` +
            `This scene is a required branch point. Every option must include nextSceneId, distributed across these valid future scenes: ${(sceneBlueprint.leadsTo || []).join(', ')}. ` +
            `Do not create expression choices. Preserve the scene's stakes and make each route feel narratively distinct.`,
          worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription),
        },
        protagonistInfo: {
          name: brief.protagonist.name,
          pronouns: brief.protagonist.pronouns,
        },
        npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
        availableFlags: blueprint.suggestedFlags,
        availableScores: blueprint.suggestedScores,
        availableTags: blueprint.suggestedTags,
        unresolvedCallbacks: this.deps.getUnresolvedCallbacksForPrompt(brief.episode?.number) as ChoiceAuthorInput['unresolvedCallbacks'],
        possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
          const scene = blueprint.scenes.find(candidate => candidate.id === id);
          return {
            id,
            name: scene?.name || id,
            description: scene?.description || '',
            location: scene?.location,
          };
        }),
        optionCount: Math.max(sceneBlueprint.choicePoint?.optionHints?.length || 0, Math.min(3, sceneBlueprint.leadsTo.length)),
        sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
        memoryContext: (await this.deps.getAgentMemoryContext?.({
          agentRole: 'ChoiceAuthor',
          lifecycle: 'scene-graph-branch-repair',
          storyId: brief.story.title,
          episodeNumber: brief.episode?.number,
          treatmentId: brief.multiEpisode?.sourceAnalysis?.sourceTitle,
          sceneId: sceneBlueprint.id,
          characterIds: sceneBlueprint.npcsPresent,
          artifactKinds: ['validator-report', 'choice-set'],
          factKinds: ['branch-topology', 'choice-consequence', 'validator-failure', 'repair-learning'],
        })) || this.deps.cachedPipelineMemory || undefined,
        storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
        branchContext: {
          role: 'linear',
          isBranchPoint: true,
          expectedBranches: new Set(sceneBlueprint.leadsTo || []).size,
        },
        plannedConsequenceTier: plannedConsequenceTiers[sceneBlueprint.id],
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonStoryCircle: brief.seasonPlan?.storyCircle,
        episodeStoryCircleRole: brief.seasonPlan?.episodes.find(
          (episodeEntry) => episodeEntry.episodeNumber === brief.episode.number,
        )?.storyCircleRole,
        episodeCircle: blueprint.episodeCircle,
      }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id} scene-graph-branch-repair)`);

      if (!repairResult.success || !repairResult.data) {
        this.deps.emit({
          type: 'warning',
          phase: context.phase,
          message: `Scene-graph branch repair failed for ${sceneBlueprint.id}: ${repairResult.error || 'no data'}`,
        });
        continue;
      }

      const repairedChoiceSet = { ...repairResult.data, sceneId: sceneBlueprint.id };
      const existingIndex = choiceSets.findIndex(choiceSet =>
        (choiceSet.sceneId ? `${choiceSet.sceneId}::${choiceSet.beatId}` : choiceSet.beatId) === `${sceneBlueprint.id}::${choicePointBeat.id}`
      );
      if (existingIndex >= 0) {
        choiceSets[existingIndex] = repairedChoiceSet;
      } else {
        choiceSets.push(repairedChoiceSet);
      }
      repaired = true;
    }

    return repaired;
  }

  private repairSceneGraphBranchResidue(
    validation: SceneGraphBranchValidationResult,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    phase: string,
  ): boolean {
    const targetIds = validation.issues
      .filter(issue => issue.type === 'missing_branch_residue' && issue.targetSceneId)
      .map(issue => issue.targetSceneId!)
      .filter((id, index, all) => all.indexOf(id) === index);
    if (targetIds.length === 0) return false;

    let repaired = false;
    for (const targetId of targetIds) {
      const sceneBlueprint = blueprint.scenes.find(scene => scene.id === targetId);
      const sceneContent = sceneContents.find(scene => scene.sceneId === targetId);
      if (!sceneBlueprint || !sceneContent) continue;

      // Encounter scenes legitimately carry an empty `beats` array — their reader-facing
      // content lives in the encounter structure (situation beats + outcome storylets),
      // and reconvergence residue belongs there too (sceneAcknowledgesBranchResidue
      // already inspects scene.encounter.outcomes). Injecting a residue beat here both
      // leaks structural prose into an encounter AND masks a failed/empty encounter from
      // FinalStoryContractValidator's empty_scene check, which only fires when
      // beats.length === 0. That masking is exactly how G10 Endsong ep2 shipped the
      // "You carry the weight of the choices…" + "Continue…" stub over an encounter whose
      // generation produced no content. Never inject residue into an encounter scene; if
      // its content is genuinely empty, leave beats.length === 0 so the final-contract
      // empty_scene gate catches it.
      if (sceneBlueprint.isEncounter || (sceneContent as { encounter?: unknown }).encounter) {
        this.deps.emit({
          type: 'warning',
          phase,
          message: `Skipped branch-residue injection for encounter scene "${targetId}" — encounter reconvergence residue lives in encounter outcomes, not scene beats.`,
          data: { sceneId: targetId, reason: 'encounter_scene_residue_skip' },
        });
        continue;
      }

      const incomingScenes = blueprint.scenes.filter(scene => scene.leadsTo?.includes(targetId));

      // The residue SceneGraphBranchValidator requires is the callbackHookId MARKER
      // below — NOT reader prose. This repair previously also injected structural
      // commentary ("…leaves a visible residue…") into beat.text, a fiction-first leak
      // (gen-5: it became the Ep2 encounter's opening beat). Attach only the marker;
      // the empty-scene fallback gets an in-world line.
      const hookId = `branch-reconvergence-${targetId}`;

      if (sceneContent.beats.length === 0) {
        sceneContent.beats.push({
          id: `${targetId}-branch-residue`,
          text: 'You carry the weight of the choices that brought you here.',
          callbackHookIds: [hookId],
          intensityTier: 'supporting',
        } as GeneratedBeat);
        sceneContent.startingBeatId = `${targetId}-branch-residue`;
      }

      const firstBeat = sceneContent.beats[0];
      const alreadyAcknowledged = (firstBeat.callbackHookIds || []).some(h => h.startsWith('branch-reconvergence'));
      if (alreadyAcknowledged) {
        repaired = true;
        continue;
      }

      // Attach the marker ONLY — never mutate reader prose with branch commentary.
      firstBeat.callbackHookIds = Array.from(new Set([
        ...(firstBeat.callbackHookIds || []),
        hookId,
      ]));
      sceneContent.isConvergencePoint = true;
      sceneContent.continuityNotes = Array.from(new Set([
        ...(sceneContent.continuityNotes || []),
        `Branch reconvergence residue marked for ${targetId}.`,
      ]));

      this.deps.emit({
        type: 'regeneration_triggered',
        phase,
        message: `Repairing branch reconvergence residue for ${targetId}`,
        data: { sceneId: targetId, incomingScenes: incomingScenes.map(scene => scene.id) },
      });
      repaired = true;
    }

    return repaired;
  }
  */
}

function blueprintHasSafeSceneGraphBranchSlot(blueprint: EpisodeBlueprint): boolean {
  const scenes = blueprint.scenes || [];
  return scenes.some((scene, index) => {
    if (index >= scenes.length - 2 || scene.isEncounter) return false;
    const targets = [...new Set(scene.leadsTo || [])];
    const plannedBranch = scene.choicePoint?.branches || targets.length > 1;
    if (!plannedBranch || targets.length < 2) return false;
    return targets.every((target) => {
      const targetIndex = scenes.findIndex((candidate) => candidate.id === target);
      if (targetIndex < 0 || targetIndex <= index) return false;
      const skipped = scenes.slice(index + 1, targetIndex);
      return !skipped.some(blueprintSceneRequiresSequentialSetup);
    });
  });
}

function blueprintSceneRequiresSequentialSetup(scene: EpisodeBlueprint['scenes'][number]): boolean {
  if (scene.isEncounter || scene.plannedEncounterId) return true;
  if (/bottleneck|convergence/i.test(scene.purpose || '')) return true;
  if (/treatment|encounter|required|anchor/i.test(`${scene.id} ${scene.name || ''}`)) return true;
  return (scene.requiredBeats || []).some((beat) =>
    beat?.tier === 'authored' || beat?.tier === 'signature',
  );
}
