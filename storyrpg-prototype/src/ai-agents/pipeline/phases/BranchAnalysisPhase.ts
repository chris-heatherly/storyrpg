/**
 * Branch Analysis Phase
 *
 * Phase 3.5 of story generation: runs BranchManager over the episode
 * blueprint to analyze the branch structure (paths, reconvergence points,
 * validation issues — all advisory), cross-checks with the deterministic
 * topology pass (unreachable / dead-end scenes), and captures the LLM-vs-
 * deterministic shadow diff when shadow mode is enabled.
 *
 * Faithful port of FullStoryPipeline.runBranchAnalysis (pure move): same
 * prompts, same events, same never-blocks failure handling (returns null).
 * The monolith keeps a thin delegating runBranchAnalysis wrapper;
 * `branchShadowDiffs` is accessor-backed run-scoped state (read at the
 * multi-episode save site).
 */

import { BranchManager, BranchAnalysis } from '../../agents/BranchManager';
import { EpisodeBlueprint } from '../../agents/StoryArchitect';
import { analyzeBranchTopology } from '../../utils/branchTopology';
import { buildBranchShadowDiff, type BranchShadowDiff } from '../../utils/branchShadowDiff';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import { isAuthoredLiteEpisode } from '../../utils/authoredLiteScenePlan';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// DEPENDENCY TYPES
// ========================================

export interface BranchAnalysisPhaseDeps {
  branchManager: Pick<BranchManager, 'execute'>;
  /** Scoped pipeline memory for BranchManager prompts. */
  readonly memoryContext?: string | null;
  /** Accessor-backed run-scoped sink for I5 shadow-mode diffs. */
  readonly branchShadowDiffs: Array<{ episodeId: string; diff: BranchShadowDiff }>;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class BranchAnalysisPhase {
  readonly name = 'branch_analysis';

  constructor(private readonly deps: BranchAnalysisPhaseDeps) {}

  /** Advisory: returns null (never throws) when analysis fails. */
  async run(
    brief: FullCreativeBrief,
    blueprint: EpisodeBlueprint,
    context: PipelineContext
  ): Promise<BranchAnalysis | null> {
    context.emit({ type: 'agent_start', agent: 'BranchManager', message: 'Analyzing branch structure' });

    try {
      const currentEpisodeNumber = brief.episode?.number;
      const seasonEpisode = currentEpisodeNumber
        ? brief.seasonPlan?.episodes?.find(e => e.episodeNumber === currentEpisodeNumber)
        : undefined;
      const authoredLite = isAuthoredLiteEpisode(seasonEpisode);
      const forceBranchAnnotation = context.config.generation?.branchShadowModeEnabled === true
        || process.env.STORYRPG_BRANCH_ANNOTATION === '1';
      if (authoredLite && !forceBranchAnnotation) {
        context.emit({
          type: 'debug',
          phase: 'branch_analysis',
          message: 'branch_annotation_skipped_authored_lite: deterministic skeleton only',
        });
      }

      const result = await withTimeout(this.deps.branchManager.execute({
        episodeId: blueprint.episodeId,
        episodeTitle: blueprint.title,
        scenes: blueprint.scenes,
        startingSceneId: blueprint.startingSceneId,
        bottleneckScenes: blueprint.bottleneckScenes || [],
        availableFlags: blueprint.suggestedFlags || [],
        availableScores: blueprint.suggestedScores || [],
        availableTags: blueprint.suggestedTags || [],
        storyContext: {
          title: brief.story.title,
          genre: brief.story.genre,
          tone: brief.story.tone,
        },
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonStoryCircle: brief.seasonPlan?.storyCircle,
        episodeStoryCircleRole: seasonEpisode?.storyCircleRole,
        episodeCircle: blueprint.episodeCircle,
        skipLlmAnnotation: authoredLite && !forceBranchAnnotation,
        memoryContext: this.deps.memoryContext || undefined,
      }), PIPELINE_TIMEOUTS.llmAgent, 'BranchManager.execute');

      if (!result.success || !result.data) {
        console.warn(`[Pipeline] BranchManager analysis failed: ${result.error}`);
        context.emit({
          type: 'agent_complete',
          agent: 'BranchManager',
          message: `Branch analysis failed (non-critical): ${result.error}`,
        });
        return null;
      }

      // Log validation issues (as warnings - branch structure issues are advisory, not blocking)
      if (result.data.validationIssues.length > 0) {
        for (const issue of result.data.validationIssues) {
          // Branch validation issues are advisory - don't block generation
          // The story can still work even if branching isn't perfect
          context.emit({
            type: 'warning',
            phase: 'branch_validation',
            message: `[${issue.type}] ${issue.description}`,
          });
        }
      }

      const deterministicTopology = analyzeBranchTopology(blueprint);
      for (const sceneId of deterministicTopology.unreachableSceneIds) {
        context.emit({
          type: 'warning',
          phase: 'branch_validation',
          message: `[deterministic] Scene ${sceneId} is unreachable from ${blueprint.startingSceneId}`,
        });
      }
      for (const sceneId of deterministicTopology.deadEndSceneIds) {
        context.emit({
          type: 'warning',
          phase: 'branch_validation',
          message: `[deterministic] Scene ${sceneId} dead-ends before the ending scene`,
        });
      }

      // I5: capture a side-by-side diff of the LLM vs deterministic passes
      // when shadow mode is enabled. No console spam here — the sidecar is
      // the consumer. The LLM pass keeps running either way (it already
      // does today), so this is pure observation, not gating.
      if (context.config.generation?.branchShadowModeEnabled) {
        try {
          const diff = buildBranchShadowDiff(result.data, deterministicTopology);
          this.deps.branchShadowDiffs.push({ episodeId: blueprint.episodeId, diff });
        } catch (diffErr) {
          console.warn(`[Pipeline] Failed to build branch shadow diff: ${diffErr instanceof Error ? diffErr.message : diffErr}`);
        }
      }

      context.emit({
        type: 'agent_complete',
        agent: 'BranchManager',
        message: `Found ${result.data.branchPaths.length} paths, ${result.data.reconvergencePoints.length} reconvergence points, ${result.data.validationIssues.length} issues`,
      });

      return result.data;
    } catch (error) {
      console.warn(`[Pipeline] BranchManager threw error:`, error);
      context.emit({
        type: 'warning',
        phase: 'branch_analysis',
        message: `Branch analysis skipped due to error`,
      });
      return null;
    }
  }
}
