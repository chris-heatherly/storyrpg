/**
 * Season Planner Agent
 *
 * Creates comprehensive season plans from source material analysis.
 * The season plan:
 * - Maps out all episodes with dependencies
 * - Tracks story arcs and character introductions
 * - Persists locally so generation can resume later
 * - Identifies which episodes should be generated together
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import {
  buildSeasonArcEnrichmentJsonSchema,
  buildSeasonEpisodeUnitRepairJsonSchema,
  buildSeasonPlanJsonSchema,
} from '../schemas/seasonPlanSchema';
import {
  SourceMaterialAnalysis,
  EpisodeOutline,
  CrossEpisodeBranch,
  ConsequenceChain,
  PlannedEncounter,
  EncounterCategory,
  EndingMode,
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleBeat,
  StoryCircleStructure,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';
import {
  SeasonPlan,
  SeasonEpisode,
  SeasonArc,
  ArcEpisodeTurnout,
  ArcEpisodeTurnoutType,
  ArcStoryCircleSpan,
  SeasonCentralPressureType,
  SeasonPromiseArchitecture,
  AudienceKnowledgeState,
  InformationKnowledgeHolder,
  InformationLedgerEntry,
  InformationTensionMode,
  EpisodeRecommendation,
  EpisodeSelectionState,
  CliffhangerPlan,
  SeasonChoiceMomentSeed,
  SeasonResidueObligation,
  ResidueObligationKind,
  ResiduePayoffPolicy,
} from '../../types/seasonPlan';
import {
  STORY_CIRCLE_BEAT_DEFINITION_LINES,
  STORY_CIRCLE_GEOMETRY_PRINCIPLES,
  backfillMissingStoryCircleBeats,
  describeStoryCircleDistribution,
  distributeStoryCircle,
  storyCircleRoleBeats,
} from '../utils/storyCircleDistribution';
import {
  buildEncounterStoryCircleTargetRationale,
  formatEncounterStoryCircleTargetCriteria,
  normalizeEncounterStoryCircleTarget,
} from '../utils/encounterStoryCircleTarget';
import { SEASON_PLANNER_CRAFT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { detectStoryEventCues, isQuestionShapedAnchor } from '../remediation/storyEventCues';
import { buildSeasonPromiseContracts } from '../utils/seasonPromiseContracts';
import { buildStakesArchitectureContracts } from '../utils/stakesArchitectureContracts';
import { buildStoryCircleBeatContracts } from '../utils/storyCircleBeatContracts';
import {
  arcGuidanceId,
  buildArcPressureContracts,
  findAuthoredArcGuidanceForArc,
} from '../utils/arcPressureContracts';
import { buildBranchConsequenceContracts } from '../utils/branchConsequenceContracts';
import { buildEndingRealizationContracts } from '../utils/endingRealizationContracts';
import { buildFailureModeAuditContracts } from '../utils/failureModeAuditContracts';
import {
  authoredInformationLedgerEntries,
  mergeAuthoredInformationLedger,
} from '../utils/informationLedgerContracts';
import {
  StoryCircleCoverageValidator,
  seasonPlanToStoryCircleCoverageInput,
} from '../validators/StoryCircleCoverageValidator';
import { ArcPressureArchitectureValidator, hasSubstantiveArcText } from '../validators/ArcPressureArchitectureValidator';
import { PLAN_GATE_FLAGS, shouldGate } from '../remediation/planGatePolicy';
import { gateEnabledPredicate, isGateEnabled } from '../remediation/gateDefaults';
import { CharacterArchitectureValidator } from '../validators/CharacterArchitectureValidator';
import { SeasonPromiseValidator } from '../validators/SeasonPromiseValidator';
import { InformationLedgerValidator } from '../validators/InformationLedgerValidator';
import {
  buildDefaultCliffhangerPlan,
  normalizeCliffhangerPlan,
  selectCliffhangerStoryCircleBeat,
  shouldForceHighIntensityHook,
} from '../utils/cliffhangerPlanning';
import {
  CRAFT_PRESSURE_GUIDANCE,
  buildGenreAwareJeopardyGuidance,
} from '../prompts/storytellingPrinciples';
import { clampSceneCount } from '../../constants/pipeline';
import { isSceneFirstPlanningEnabled } from '../config/sceneFirstPlanning';
import { buildSeasonScenePlan, scenesForEpisode, MIN_SCENES_PER_EPISODE } from '../pipeline/seasonScenePlanBuilder';
import { buildScenePlanPrompt, normalizeAuthoredScenePlan } from '../pipeline/authorScenePlan';
import { compileAndApplyNarrativeContracts } from '../pipeline/narrativeContractCompiler';
import { synthesizeTreatmentGuidance } from '../pipeline/synthesizeTreatmentGuidance';
import { SceneSpineValidator } from '../validators/SceneSpineValidator';
import { SeasonBudgetValidator } from '../validators/SeasonBudgetValidator';
import { ConvergenceLedgerValidator } from '../validators/ConvergenceLedgerValidator';
import {
  CompetenceReachabilityValidator,
  type FailForwardArm,
} from '../validators/CompetenceReachabilityValidator';
import {
  buildBudgetUnits,
  allocateChoiceTypes,
  allocateConsequenceTiers,
  weightedChoiceMix,
  weightedConsequenceMix,
  computeChargeMap,
  type BudgetContext,
} from '../pipeline/seasonBudgetAllocator';
import {
  buildConvergenceLedger,
  type SkillRoadblock,
} from '../pipeline/convergenceLedgerBuilder';
import type { SkillGrowthStep } from '../pipeline/expectedSkillCurve';
import { consequenceFlags } from '../pipeline/consequenceFlags';
import type { SeasonScenePlan } from '../../types/scenePlan';
import type { ThreadLedger } from '../../types/narrativeThread';
import { PipelineError } from '../pipeline/errors';
import {
  compileCanonicalSeasonArcTopology,
  reconcileAuthoredSeasonArcs,
  type CanonicalSeasonArcSkeleton,
} from '../pipeline/seasonPlanTopologyCompiler';

type MutablePlanData = Partial<SeasonPlan> & {
  encounterPlan?: any;
  crossEpisodeBranches?: any[];
  consequenceChains?: any[];
  seasonFlags?: any[];
  episodeEncounters?: Record<number | string, any[]>;
  episodeEndingRoutes?: Record<number | string, any[]>;
  episodeCliffhangers?: Record<number | string, Partial<CliffhangerPlan>>;
  difficultyCurve?: any[];
  seasonPromiseArchitecture?: Partial<SeasonPromiseArchitecture>;
  informationLedger?: any[];
  choiceMoments?: any[];
  residuePlan?: any[];
};

type ProviderSeasonPlanDraft = Omit<MutablePlanData, 'episodeEncounters' | 'episodeEndingRoutes'> & {
  episodeEncounters?: unknown;
  episodeEndingRoutes?: unknown;
};

// ========================================
// INPUT TYPES
// ========================================

export interface SeasonPlannerInput {
  // The source analysis to build a season plan from
  sourceAnalysis: SourceMaterialAnalysis;
  
  // User preferences
  preferences?: {
    targetScenesPerEpisode?: number;
    targetChoicesPerEpisode?: number;
    pacing?: 'tight' | 'moderate' | 'expansive';
    endingMode?: EndingMode;
    /**
     * Treatment-fidelity strict mode. When true, authored Story Circle anchors
     * are treated as hard constraints by downstream validators.
     */
    strictTreatmentValidation?: boolean;
  };
  
  // Optional: existing plan to update
  existingPlanId?: string;

  /**
   * Story Circle spine gate (tier 1). When not explicitly false, a season plan
   * whose Story Circle spine is incomplete, non-contiguous, or out of canonical
   * order is REJECTED (execute throws). Default ON.
   */
  storyCircleBlocking?: boolean;
}

/**
 * Mine the episode synopsis for the first sentence that stages a concrete
 * threat/confrontation. Used as the encounter-anchor fallback when the
 * treatment authors no explicit anchors — the synopsis sentence IS the staged
 * hinge (e.g. the Cismigiu attack), so downstream coverage matching binds the
 * encounter onto the scene that already dramatizes it.
 */
function minedEventAnchorFromSynopsis(ep: EpisodeOutline): string | undefined {
  const sentences = (ep.synopsis || '')
    .split(/(?<=[.!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.find((sentence) =>
    !isQuestionShapedAnchor(sentence) && detectStoryEventCues(sentence).has('threatEncounter'));
}

function textOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function defaultStoryCircleFromAnchors(anchors?: Partial<StoryAnchors>): StoryCircleStructure {
  return {
    you: textOrFallback(anchors?.stakes, 'The protagonist begins in a recognizable world with a pressure already present.'),
    need: textOrFallback(anchors?.goal, 'The protagonist wants something concrete before the deeper need becomes visible.'),
    go: textOrFallback(anchors?.incitingIncident, 'An inciting pressure forces the protagonist across a threshold.'),
    search: 'The protagonist adapts, tests options, and discovers what the new world demands.',
    find: 'The protagonist gains a decisive insight, ally, tool, truth, or false victory.',
    take: 'The apparent gain demands a serious cost and exposes the central pressure.',
    return: textOrFallback(anchors?.climax, 'The protagonist brings the changed self back into the core conflict.'),
    change: 'The season resolves into a new equilibrium shaped by what the protagonist has become.',
  };
}

// ========================================
// SEASON PLANNER AGENT
// ========================================

export class SeasonPlannerAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Season Planner', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Master Season Architect

You create the MASTER BLUEPRINT for interactive fiction series. Your season plan is the single source of truth
that guides ALL downstream generation - encounters, story architecture, branching, and consequences.

Your plans must define:

### 1. Episode Structure & Dependencies
- Map which episodes introduce key characters/locations
- Plot threads spanning multiple episodes
- Critical episodes that can't be skipped

### 2. Story Arcs
- Group episodes into narrative arcs
- Identify arc beginnings, midpoints, and climaxes

### 3. ENCOUNTER PLANNING (Critical)
- Define 1-3 interactive encounters PER EPISODE
- Encounters are the ACTION SEQUENCES - combat, chases, social confrontations, stealth, puzzles
- Vary encounter types across the season (don't repeat the same type)
- Design a DIFFICULTY CURVE: introduction → rising → peak → falling → finale
- Encounter difficulty should escalate through the season
- Climactic episodes should have the hardest encounters

### 4. CROSS-EPISODE BRANCHING (Critical)
- Player choices should MATTER across episodes, not just within them
- Define 2-4 major branch points where choices create different experiences later
- Branches should reconverge eventually (finite parallel content)
- Use story flags to track decisions

### 5. CONSEQUENCE CHAINS
- Design cascading consequences: a choice in episode 2 ripples into episodes 4 and 6
- Create the feeling of a living, responsive world
- Include both positive and negative long-term effects

## Key Principles
- Every encounter should feel like an ACTION/REACTION sequence
- Encounter outcomes at branch points should lead to FUNDAMENTALLY different paths, not just tonal changes
- The season should feel like a complete arc: setup → escalation → climax → resolution
`;
  }

  async execute(input: SeasonPlannerInput): Promise<AgentResponse<SeasonPlan>> {
    const { sourceAnalysis, preferences } = input;
    const canonicalArcTopology = compileCanonicalSeasonArcTopology(sourceAnalysis);

    console.log(`[SeasonPlanner] Creating season plan for: ${sourceAnalysis.sourceTitle}`);

    if (
      sourceAnalysis.sourceCanon?.lockStatus !== 'locked'
      || sourceAnalysis.canonLockManifest?.requiredConceptsSatisfied !== true
    ) {
      return {
        success: false,
        error: 'Source canon is not locked. SourceMaterialAnalyzer must establish and lock canonical story facts before season planning.',
      };
    }

    // Always use LLM - we need it for encounter planning and cross-episode branching
    let planData: MutablePlanData;

    try {
      const prompt = this.buildPlanningPrompt(sourceAnalysis, preferences);
      const { data: parsedPlan, rawResponse } = await this.callLLMForJson<ProviderSeasonPlanDraft>([
        { role: 'user', content: prompt },
      ], {
        jsonSchema: buildSeasonPlanJsonSchema({
          expectedArcCount: canonicalArcTopology.length || sourceAnalysis.storyArcs.length || 1,
          expectedEpisodeCount: sourceAnalysis.totalEstimatedEpisodes,
        }),
      });
      const response = rawResponse;
      planData = this.normalizeProviderPlanData(parsedPlan);
      const topKeys = Object.keys(planData);
      console.log(`[SeasonPlanner] LLM plan received with ${topKeys.length} top-level keys: ${topKeys.join(', ')}`);
      
      // Detect possible truncation — warn if critical fields are missing
      const criticalFields = ['arcs', 'episodeEncounters', 'crossEpisodeBranches', 'episodeEndingRoutes'];
      const missingCritical = criticalFields.filter(f => !(f in planData));
      if (missingCritical.length > 0) {
        console.warn(`[SeasonPlanner] WARNING: LLM response may be truncated — missing fields: ${missingCritical.join(', ')}. Response length: ${response.length} chars. Re-fetching just those before any deterministic fallback.`);
        await this.refetchMissingPlanFields(planData, missingCritical, sourceAnalysis, preferences);
        planData = this.normalizeProviderPlanData(planData);
        const stillMissing = criticalFields.filter((field) => !(field in planData));
        if (stillMissing.length > 0) {
          console.warn(`[SeasonPlanner] Missing-field recovery left ${stillMissing.join(', ')} absent; using the source-derived fallback plan.`);
          planData = this.buildFallbackPlan(sourceAnalysis);
        }
      }
    } catch (error) {
      console.warn(`[SeasonPlanner] LLM planning failed, using fallback:`, error);
      planData = this.buildFallbackPlan(sourceAnalysis);
    }
    planData = await this.reconcileAuthoredArcTopology(
      sourceAnalysis,
      planData,
      canonicalArcTopology,
    );
    planData = await this.repairMissingEpisodePlanUnits(sourceAnalysis, planData);
    planData = this.mergeTreatmentGuidanceIntoPlanData(sourceAnalysis, planData);
    this.assertEpisodePlanUnitCoverage(sourceAnalysis, planData);

    // Build the complete season plan
    const seasonPlan = this.buildSeasonPlan(sourceAnalysis, planData, preferences);

    console.log(`[SeasonPlanner] Created plan with ${seasonPlan.totalEpisodes} episodes, ${seasonPlan.arcs.length} arcs, ${seasonPlan.encounterPlan.totalEncounters} encounters, ${seasonPlan.crossEpisodeBranches.length} cross-episode branches`);

    // Scene-first planning: buildSeasonPlan attaches a DETERMINISTIC spine as a
    // guaranteed fallback. Here we attempt to UPGRADE it to an LLM-authored
    // spine (scenes planned with real dramatic content + setup/payoff logic).
    // On any failure the deterministic spine is kept.
    //
    // Authored-lite / treatment ESC lockdown: NEVER call authorScenePlanLLM —
    // ESC + seasonScenePlanBuilder own scene order/identity. SeasonPlanner may
    // only overlay metadata (budgets/flags) onto the projected plan.
    const isTreatmentSourcedPlan = seasonPlan.episodes.some((ep) => Boolean(ep.treatmentGuidance));
    const isAuthoredLitePlan = seasonPlan.episodes.some(
      (ep) => ep.treatmentGuidance?.sourceKind === 'authored_lite',
    );
    if (
      isSceneFirstPlanningEnabled() &&
      seasonPlan.scenePlan &&
      !isTreatmentSourcedPlan
      && !isAuthoredLitePlan
    ) {
      const authored = await this.authorScenePlanLLM(
        seasonPlan,
        { minScenesPerEpisode: MIN_SCENES_PER_EPISODE },
      );
      if (authored) {
        const compiledAuthored = compileAndApplyNarrativeContracts(seasonPlan, authored);
        seasonPlan.scenePlan = compiledAuthored;
        for (const ep of seasonPlan.episodes) {
          ep.plannedScenes = scenesForEpisode(compiledAuthored, ep.episodeNumber);
        }
        seasonPlan.notes.push(
          `Scene-first planning: canonically compiled LLM-authored spine (${compiledAuthored.scenes.length} scenes, ${compiledAuthored.setupPayoffEdges.length} setup/payoff edges, graph ${compiledAuthored.narrativeContractGraph?.sourceHash ?? 'missing'}).`,
        );
      }
    } else if (seasonPlan.scenePlan && (isTreatmentSourcedPlan || isAuthoredLitePlan)) {
      // Defense in depth: snapshot scene identity before budget overlay so any
      // later mutation of order/id/spineUnitId is detectable.
      const authoredLiteSceneFingerprint = isAuthoredLitePlan
        ? this.fingerprintAuthoredLiteScenePlan(seasonPlan)
        : null;
      seasonPlan.notes.push(
        isAuthoredLitePlan
          ? 'Scene-first planning: authored-lite ESC projection is sole structural author; SeasonPlanner metadata overlay only.'
          : 'Scene-first planning: kept deterministic treatment-bound spine so authored required beats remain the source of truth.',
      );
      // Stash fingerprint on the plan object for the post-budget assert below.
      if (authoredLiteSceneFingerprint) {
        (seasonPlan as { __authoredLiteSceneFingerprint?: string }).__authoredLiteSceneFingerprint =
          authoredLiteSceneFingerprint;
      }
    }

    // Season choice/consequence BUDGET layer. Runs AFTER the scene plan is built
    // and (optionally) LLM-upgraded, and BEFORE the plan is finalized/returned —
    // budgets are allocated over the spine, then validated, while the spine can
    // still be rejected by the gate below. Scene-first only; no-op otherwise.
    if (
      isSceneFirstPlanningEnabled() &&
      seasonPlan.scenePlan
    ) {
      // Build the positional-axis context: map each episode number to its Story
      // Circle beat(s). The allocator/validator read it
      // only when CONSEQUENCE_POSITIONAL is on; otherwise behavior is unchanged.
      const roleByEpisode: Record<number, StoryCircleBeat[]> = {};
      for (const ep of seasonPlan.episodes) {
        roleByEpisode[ep.episodeNumber] = storyCircleRoleBeats(ep.storyCircleRole);
      }
      const budgetCtx: BudgetContext = { roleByEpisode };

      // Phase 4 (Plan Part 6 + Part 9): Convergence Ledger. Active ONLY when the
      // CONVERGENCE_LEDGER flag is on. We project the season plan's setup/payoff
      // edges and any available ThreadLedger onto ONE ledger, derive the dramatic
      // charge map from it, and thread both into the allocator/validator via
      // budgetCtx. With the flag off, no ledger is built and budgetCtx carries no
      // charge — behavior is byte-identical to before.
      let convergenceLedger:
        | import('../../types/convergenceLedger').ConvergenceLedger
        | undefined;
      // The ThreadLedger is not yet a canonical SeasonPlan field at this stage;
      // read it defensively so an upstream contributor can supply it, and tolerate
      // its absence (Plan Part 6: many contributors, one read path).
      const seasonThreadLedger = (seasonPlan as { threadLedger?: ThreadLedger })
        .threadLedger;
      // Phase 5b (CHARGE_COMPETENCE): competence roadblocks / growth / fail-forward
      // arms are not yet canonical SeasonPlan fields at this stage — read them
      // defensively so an upstream contributor (EncounterArchitect / arc tracker)
      // can supply them, and tolerate their absence.
      const competenceInput = seasonPlan as {
        skillRoadblocks?: SkillRoadblock[];
        skillGrowth?: SkillGrowthStep[];
        skillBaselines?: { skill: string; level: number }[];
        failForwardArms?: FailForwardArm[];
      };
      if (consequenceFlags().ledger) {
        convergenceLedger = buildConvergenceLedger(seasonPlan.scenePlan, {
          threadLedger: seasonThreadLedger,
          // Roadblocks only project when CHARGE_COMPETENCE is on (builder-gated).
          roadblocks: competenceInput.skillRoadblocks,
        });
        budgetCtx.ledger = convergenceLedger;
        budgetCtx.chargeMap = computeChargeMap(
          seasonPlan.scenePlan,
          convergenceLedger,
        ).charge;
      }

      // Allocate choiceType/consequenceTier/budgetWeight onto the PlannedScenes
      // in plan.scenePlan, then re-slice each episode so ep.plannedScenes carry
      // the same budgeted fields.
      const units = buildBudgetUnits(seasonPlan.scenePlan);
      allocateChoiceTypes(units, budgetCtx);
      allocateConsequenceTiers(units, budgetCtx);
      for (const ep of seasonPlan.episodes) {
        ep.plannedScenes = scenesForEpisode(seasonPlan.scenePlan, ep.episodeNumber);
      }

      // Validate the realized dramatic diet (advisory into plan.warnings).
      const budgetResult = new SeasonBudgetValidator().validate(seasonPlan.scenePlan, budgetCtx);
      for (const issue of budgetResult.issues) {
        seasonPlan.warnings.push(`[SeasonBudget:${issue.severity}] ${issue.message}`);
      }

      // Phase 4: run the ConvergenceLedgerValidator ADVISORY (not hard-gated here)
      // when the ledger was built — forward-only edges, no anchorless heavy charge,
      // charge-coverage on heavy tiers, and major-promise detonation. Findings go
      // into plan.warnings for the diagnostics trail.
      if (convergenceLedger) {
        const ledgerResult = new ConvergenceLedgerValidator().validate(
          seasonPlan.scenePlan,
          convergenceLedger,
          { threadLedger: seasonThreadLedger },
        );
        for (const issue of ledgerResult.issues) {
          seasonPlan.warnings.push(`[ConvergenceLedger:${issue.severity}] ${issue.message}`);
        }
      }

      // Phase 5b (CHARGE_COMPETENCE): the no-dead-wall / dangling-growth /
      // fail-forward-gap guard, ADVISORY into plan.warnings. Active ONLY when the
      // competence flag is on AND roadblock/growth/arm data was supplied; with the
      // flag off (or no competence data) nothing runs and behavior is unchanged.
      if (
        consequenceFlags().competence &&
        ((competenceInput.skillRoadblocks?.length ?? 0) > 0 ||
          (competenceInput.failForwardArms?.length ?? 0) > 0)
      ) {
        const competenceResult = new CompetenceReachabilityValidator().validate(
          seasonPlan.scenePlan,
          {
            roadblocks: competenceInput.skillRoadblocks ?? [],
            growth: competenceInput.skillGrowth,
            baselines: competenceInput.skillBaselines,
            failForwardArms: competenceInput.failForwardArms,
          },
        );
        for (const issue of competenceResult.issues) {
          seasonPlan.warnings.push(`[CompetenceReachability:${issue.severity}] ${issue.message}`);
        }
      }

      // Summarize the realized weighted mix for the diagnostics trail.
      const choiceMix = weightedChoiceMix(units);
      const consequenceMix = weightedConsequenceMix(units);
      const pct = (mix: { percentages: Record<string, number> }, keys: string[]): string =>
        keys.map((k) => `${k} ${Math.round(mix.percentages[k] ?? 0)}%`).join(' / ');
      seasonPlan.notes.push(
        `Season budget: ${units.length} budgeted units (weighted ${choiceMix.total}). ` +
          `Choice mix ${pct(choiceMix, ['expression', 'relationship', 'strategic', 'dilemma'])}; ` +
          `consequence mix ${pct(consequenceMix, ['callback', 'tint', 'branchlet', 'branch'])}.`,
      );

      // Authored-lite: budgets may annotate scenes but must not reorder/replace them.
      if (isAuthoredLitePlan) {
        const expected = (seasonPlan as { __authoredLiteSceneFingerprint?: string }).__authoredLiteSceneFingerprint;
        this.assertAuthoredLiteScenePlanFrozen(seasonPlan, expected, 'post-budget');
        delete (seasonPlan as { __authoredLiteSceneFingerprint?: string }).__authoredLiteSceneFingerprint;
      }

      // HARD GATE (opt-in, default OFF). Only when GATE_SEASON_BUDGETS=1 do
      // error-severity budget findings block the plan. Mirrors the arcPressure
      // gate below.
      if (isGateEnabled('GATE_SEASON_BUDGETS')) {
        const budgetErrors = budgetResult.issues.filter((i) => i.severity === 'error');
        if (budgetErrors.length > 0) {
          throw new Error(
            `[SeasonBudgetGate] Season choice/consequence budget failed the blocking gate (${budgetErrors.length} issue(s)): ` +
              budgetErrors.map((i) => i.message).join('; ') +
              '. Unset GATE_SEASON_BUDGETS to downgrade to advisory.',
          );
        }
      }
    }

    // Scene-first planning is a new-run contract: downstream episode architecture
    // should elaborate the season-owned scene spine, not silently fall back to
    // inventing episode-local scenes. Keep warnings advisory, but block missing
    // or structurally invalid scene plans before any episode generation starts.
    if (isSceneFirstPlanningEnabled()) {
      if (!seasonPlan.scenePlan) {
        throw new Error(
          '[ScenePlanGate] Scene-first planning is enabled but SeasonPlanner produced no SeasonScenePlan. ' +
          'Repair season planning instead of falling back to episode-local scene invention.',
        );
      }
      const sceneSpineGate = new SceneSpineValidator().validate(seasonPlan.scenePlan);
      const sceneSpineErrors = sceneSpineGate.issues.filter((i) => i.severity === 'error');
      if (sceneSpineErrors.length > 0) {
        throw new Error(
          `[ScenePlanGate] Season scene spine failed the blocking gate (${sceneSpineErrors.length} issue(s)): ` +
            sceneSpineErrors.map((i) => i.message).join('; ') +
            '. Repair the SeasonScenePlan before episode generation.',
        );
      }
    }

    // Story Circle spine GATE (tier 1, default ON / opt-out). A season whose
    // eight-beat Story Circle spine is incomplete, out of canonical order, or
    // non-contiguous must not generate.
    const storyCircleBlocking = input.storyCircleBlocking;
    if (storyCircleBlocking !== false) {
      const coverage = new StoryCircleCoverageValidator().validate(seasonPlanToStoryCircleCoverageInput(seasonPlan));
      const blockingIssues = coverage.issues.filter((i) => i.severity === 'error');
      if (blockingIssues.length > 0) {
        throw new Error(
          `[StoryCircleGate] Season Story Circle spine failed the blocking gate (${blockingIssues.length} issue(s)): ` +
            blockingIssues.map((i) => i.message).join('; ') +
            '. Set STORY_CIRCLE_BLOCKING=0 to downgrade to advisory.',
        );
      }
    }

    // Bucket D: ArcPressure architecture gate. Inferred arcs remain advisory
    // unless the rollout flag is enabled. Treatment-authored arc plans are
    // binding because the parsed arc fields now carry authored contracts.
    const treatmentArcPlanSourced = (seasonPlan.arcPressureContracts ?? []).some((contract) => contract.source === 'treatment');
    if (gateEnabledPredicate(PLAN_GATE_FLAGS.arcPressure) || treatmentArcPlanSourced) {
      const arcPressureGateResult = new ArcPressureArchitectureValidator().validate(seasonPlan, {
        treatmentSourced: treatmentArcPlanSourced,
        arcPressureContracts: seasonPlan.arcPressureContracts,
      });
      const arcPressureGate = shouldGate(
        PLAN_GATE_FLAGS.arcPressure,
        arcPressureGateResult.issues,
        treatmentArcPlanSourced ? () => true : gateEnabledPredicate,
      );
      if (arcPressureGate.gate) {
        // S3: remediation-ledger recording is DEFERRED for plan-stage gates — the
        // SeasonPlanner scope has no run output directory / ledger baseDir to write
        // to. This throw is already observable upstream (caught in
        // storyGenerationService and folded into the failed-run quality ledger).
        const arcErrors = arcPressureGateResult.issues.filter((i) => i.severity === 'error');
        throw new PipelineError(
          `[ArcPressureGate] Season arc architecture failed the blocking gate (${arcPressureGate.blockingCount} issue(s)): ` +
            arcErrors.map((i) => i.message).join('; ') +
            (treatmentArcPlanSourced
              ? '. Treatment-authored arc plans are binding; repair the arc plan assignments instead of downgrading.'
              : '. Unset GATE_ARC_PRESSURE to downgrade to advisory.'),
          'season_plan',
          {
            agent: 'ArcPressureArchitectureValidator',
            context: {
              issues: arcErrors,
              metrics: arcPressureGateResult.metrics,
            },
            failure: {
              code: treatmentArcPlanSourced ? 'season_plan_topology_invalid' : 'season_graph_invalid',
              ownerStage: 'season_plan',
              retryClass: treatmentArcPlanSourced ? 'retry_structured_output' : 'none',
              issueCodes: arcErrors.map((issue) => issue.metadata?.issueCode || 'arc_pressure_invalid'),
              repairTarget: 'season-arcs',
            },
          },
        );
      }
    }

    return {
      success: true,
      data: seasonPlan,
    };
  }

  /**
   * Author the season scene plan via the LLM, normalized + validated. Returns
   * null on any failure (truncated/invalid JSON, spine validation errors) so the
   * caller keeps the deterministic spine. See {@link normalizeAuthoredScenePlan}.
   *
   * Must never be called for authored-lite / treatment ESC plans — those use
   * compileEpisodeSpine + seasonScenePlanBuilder as sole structural author.
   */
  private async authorScenePlanLLM(
    plan: SeasonPlan,
    opts: { minScenesPerEpisode?: number } = {},
  ): Promise<SeasonScenePlan | null> {
    if (plan.episodes.some((ep) => ep.treatmentGuidance?.sourceKind === 'authored_lite')) {
      throw new Error(
        '[EscAuthority] authorScenePlanLLM refused: authored-lite ESC projection is the sole structural author.',
      );
    }
    try {
      const prompt = buildScenePlanPrompt(plan);
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const raw = this.parseJSON(response);
      const normalized = normalizeAuthoredScenePlan(raw, plan, opts);
      if (!normalized) {
        console.warn('[SeasonPlanner] Authored scene plan failed normalization/validation; keeping deterministic spine.');
      }
      return normalized;
    } catch (error) {
      if (error instanceof Error && error.message.includes('[EscAuthority]')) throw error;
      console.warn('[SeasonPlanner] Scene-plan authoring failed; keeping deterministic spine:', error);
      return null;
    }
  }

  /** Stable fingerprint of scene id/order/spineUnitId for authored-lite freeze checks. */
  private fingerprintAuthoredLiteScenePlan(plan: SeasonPlan): string {
    const scenes = (plan.scenePlan?.scenes ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((scene) => `${scene.id}|${scene.order}|${scene.spineUnitId ?? ''}`);
    return scenes.join(';');
  }

  /**
   * Authored-lite consumeEscPlan invariant: SeasonPlanner may overlay budgets/
   * flags but must not change scene identity or ESC projection order.
   */
  private assertAuthoredLiteScenePlanFrozen(
    plan: SeasonPlan,
    expectedFingerprint: string | null | undefined,
    phase: string,
  ): void {
    if (!expectedFingerprint) return;
    const actual = this.fingerprintAuthoredLiteScenePlan(plan);
    if (actual !== expectedFingerprint) {
      throw new Error(
        `[EscAuthority] Authored-lite scene plan identity drifted during ${phase}. ` +
          'SeasonPlanner must only annotate budgets/flags onto the ESC projection, never reorder or replace scenes. ' +
          `expected=${expectedFingerprint} actual=${actual}`,
      );
    }
  }

  /**
   * Re-fetch just the critical plan fields the first pass dropped (a truncated /
   * incomplete LLM plan), in one focused call, and merge them in — before the
   * deterministic fallback fills them with placeholders. The season plan is the
   * highest-leverage artifact (its cross-episode branching / encounter planning
   * cascades through the whole run), so recovering the authored fields beats
   * shipping deterministic stand-ins. One attempt; on failure the missing fields
   * fall through to the deterministic fill as before. No-op (no LLM call) when
   * nothing is missing, so a complete first pass — incl. golden runs — is
   * unaffected. Mutates `planData` in place.
   */
  private async refetchMissingPlanFields(
    planData: MutablePlanData,
    missing: string[],
    analysis: SourceMaterialAnalysis,
    preferences?: SeasonPlannerInput['preferences'],
  ): Promise<void> {
    if (missing.length === 0) return;
    try {
      const focused =
        `${this.buildPlanningPrompt(analysis, preferences)}\n\n` +
        `IMPORTANT: your previous response OMITTED these required top-level fields (it was likely ` +
        `too long and got cut off): ${missing.join(', ')}. Re-emit ONLY those fields now, COMPLETE ` +
        `and compact, as a single JSON object whose keys are exactly [${missing.join(', ')}]. No other ` +
        `keys, no prose outside the JSON.`;
      const response = await this.callLLM([{ role: 'user', content: focused }]);
      const patch = this.parseJSON<Record<string, unknown>>(response);
      let filled = 0;
      for (const field of missing) {
        if (patch && field in patch && patch[field] != null) {
          (planData as Record<string, unknown>)[field] = patch[field];
          filled += 1;
        }
      }
      console.log(`[SeasonPlanner] Re-fetched ${filled}/${missing.length} missing plan field(s).`);
    } catch (err) {
      console.warn(`[SeasonPlanner] Missing-field re-fetch failed (deterministic fill will cover it): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private normalizeProviderPlanData(draft: ProviderSeasonPlanDraft | MutablePlanData): MutablePlanData {
    return {
      ...(draft as MutablePlanData),
      episodeEncounters: this.normalizeEpisodeIndexedCollection(draft.episodeEncounters, 'encounters'),
      episodeEndingRoutes: this.normalizeEpisodeIndexedCollection(draft.episodeEndingRoutes, 'routes'),
    };
  }

  private normalizeEpisodeIndexedCollection(
    value: unknown,
    itemField: 'encounters' | 'routes',
  ): Record<number | string, any[]> {
    if (!value) return {};
    if (!Array.isArray(value) && typeof value === 'object') {
      const normalized: Record<number | string, any[]> = {};
      for (const [episodeNumber, items] of Object.entries(value as Record<string, unknown>)) {
        if (/^\d+$/.test(episodeNumber) && Array.isArray(items)) {
          normalized[episodeNumber] = items;
        }
      }
      return normalized;
    }

    if (!Array.isArray(value)) return {};
    const normalized: Record<number | string, any[]> = {};
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const episodeNumber = Number((entry as Record<string, unknown>).episodeNumber);
      const items = (entry as Record<string, unknown>)[itemField];
      if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || !Array.isArray(items)) continue;
      normalized[episodeNumber] = items;
    }
    return normalized;
  }

  private async reconcileAuthoredArcTopology(
    analysis: SourceMaterialAnalysis,
    planData: MutablePlanData,
    canonical: CanonicalSeasonArcSkeleton[],
  ): Promise<MutablePlanData> {
    if (canonical.length === 0) return planData;

    let reconciliation = reconcileAuthoredSeasonArcs(canonical, planData.arcs);
    const rejectedUnknown = reconciliation.issues.filter((issue) => issue.code === 'unknown_arc_rejected');
    if (rejectedUnknown.length > 0) {
      console.warn(
        `[SeasonPlanner] Rejected ${rejectedUnknown.length} provider arc(s) outside the authored topology: ` +
        rejectedUnknown.map((issue) => issue.candidateArcId || 'unknown').join(', '),
      );
    }

    if (reconciliation.requiresLlmRepair) {
      const missing = canonical.filter((arc) => reconciliation.missingArcIds.includes(arc.id));
      try {
        const repaired = await this.requestAuthoredArcEnrichments(analysis, missing);
        reconciliation = reconcileAuthoredSeasonArcs(
          canonical,
          [...reconciliation.acceptedEnrichments, ...repaired],
        );
      } catch (error) {
        throw this.authoredArcTopologyError(canonical, reconciliation, error);
      }
    }

    if (reconciliation.requiresLlmRepair) {
      throw this.authoredArcTopologyError(canonical, reconciliation);
    }

    return {
      ...planData,
      arcs: reconciliation.arcs as SeasonArc[],
    };
  }

  private async requestAuthoredArcEnrichments(
    analysis: SourceMaterialAnalysis,
    arcs: CanonicalSeasonArcSkeleton[],
  ): Promise<Partial<SeasonArc>[]> {
    const guidanceById = new Map(
      (analysis.treatmentSeasonGuidance?.arcGuidance?.arcs ?? [])
        .map((guidance) => [arcGuidanceId(guidance), guidance] as const),
    );
    const repairPayload = arcs.map((arc) => ({
      arcId: arc.id,
      name: arc.name,
      episodeRange: arc.episodeRange,
      sourceText: arc.sourceText,
      authoredGuidance: guidanceById.get(arc.id),
      episodes: analysis.episodeBreakdown
        .filter((episode) =>
          episode.episodeNumber >= arc.episodeRange.start
          && episode.episodeNumber <= arc.episodeRange.end
        )
        .map((episode) => ({
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          synopsis: episode.synopsis,
          storyCircleRole: episode.storyCircleRole,
        })),
    }));
    const prompt = `
Repair ONLY the missing authored season-arc enrichments for "${analysis.sourceTitle}".

The arc IDs, names, order, episode ranges, and authored field text below are immutable source canon.
Return exactly one enrichment for every supplied arcId and no other arcs. Preserve authored dramatic
questions, season relations, identity pressure, recontextualizations, crises, finale answers, handoffs,
and episode turnouts verbatim where supplied. You may author only missing interpretive detail.

Every arc must include id, name, description, episodeRange, arcQuestion, seasonQuestionRelation,
identityPressureFacet, midpointRecontextualization, lateArcCrisis, finaleAnswer, handoffPressure, and
one episodeTurnout for every episode in its range. A non-final arc must hand pressure into the next arc.
The final arc may use an empty handoffPressure only when the season resolves completely.

Canonical arc slots:
${JSON.stringify(repairPayload, null, 2)}

Return only: {"arcs":[...]}
`;
    const { data } = await this.callLLMForJson<{ arcs?: Partial<SeasonArc>[] }>([
      { role: 'user', content: prompt },
    ], {
      jsonSchema: buildSeasonArcEnrichmentJsonSchema(arcs.length),
    });
    return Array.isArray(data.arcs) ? data.arcs : [];
  }

  private authoredArcTopologyError(
    canonical: CanonicalSeasonArcSkeleton[],
    reconciliation: ReturnType<typeof reconcileAuthoredSeasonArcs>,
    originalError?: unknown,
  ): PipelineError {
    const issueCodes = reconciliation.issues
      .filter((issue) => issue.code !== 'unknown_arc_rejected')
      .map((issue) => `${issue.code}:${issue.arcId || 'unknown'}`);
    return new PipelineError(
      `[SeasonPlanTopology] Authored arc topology could not be enriched without changing source canon. ` +
        `Expected [${canonical.map((arc) => arc.id).join(', ')}]; missing [${reconciliation.missingArcIds.join(', ')}].`,
      'season_plan',
      {
        agent: 'SeasonPlanner',
        originalError: originalError instanceof Error ? originalError : undefined,
        context: {
          canonicalArcs: canonical.map((arc) => ({
            id: arc.id,
            name: arc.name,
            episodeRange: arc.episodeRange,
          })),
          issues: reconciliation.issues,
        },
        failure: {
          code: 'season_plan_topology_invalid',
          ownerStage: 'season_plan',
          retryClass: 'retry_structured_output',
          issueCodes: issueCodes.length > 0 ? issueCodes : ['authored_arc_enrichment_invalid'],
          repairTarget: `season-arcs:${reconciliation.missingArcIds.join(',')}`,
        },
      },
    );
  }

  private missingEpisodePlanUnits(
    analysis: SourceMaterialAnalysis,
    planData: MutablePlanData,
  ): { encounterEpisodes: number[]; endingRouteEpisodes: number[] } {
    const episodeNumbers = analysis.episodeBreakdown.map((episode) => episode.episodeNumber);
    const encounters = planData.episodeEncounters ?? {};
    const endingRoutes = planData.episodeEndingRoutes ?? {};
    const requiresEndingRoutes = (analysis.resolvedEndings?.length ?? 0) > 0;
    return {
      encounterEpisodes: episodeNumbers.filter((episodeNumber) =>
        !Array.isArray(encounters[episodeNumber]) || encounters[episodeNumber].length === 0
      ),
      endingRouteEpisodes: requiresEndingRoutes
        ? episodeNumbers.filter((episodeNumber) =>
            !Array.isArray(endingRoutes[episodeNumber]) || endingRoutes[episodeNumber].length === 0
          )
        : [],
    };
  }

  private async repairMissingEpisodePlanUnits(
    analysis: SourceMaterialAnalysis,
    planData: MutablePlanData,
  ): Promise<MutablePlanData> {
    const missing = this.missingEpisodePlanUnits(analysis, planData);
    const requestedEpisodes = [...new Set([
      ...missing.encounterEpisodes,
      ...missing.endingRouteEpisodes,
    ])].sort((left, right) => left - right);
    if (requestedEpisodes.length === 0) return planData;

    const episodeSlots = analysis.episodeBreakdown
      .filter((episode) => requestedEpisodes.includes(episode.episodeNumber))
      .map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        synopsis: episode.synopsis,
        storyCircleRole: episode.storyCircleRole,
        treatmentGuidance: episode.treatmentGuidance,
        needsEncounter: missing.encounterEpisodes.includes(episode.episodeNumber),
        needsEndingRoutes: missing.endingRouteEpisodes.includes(episode.episodeNumber),
      }));
    const prompt = `
Repair only the missing per-episode Season Planner units for "${analysis.sourceTitle}".
Return encounter plans only for slots where needsEncounter=true and ending-route plans only where
needsEndingRoutes=true. Every encounter must stage the episode's concrete playable pressure and carry
its Story Circle function. Do not change episode identity, chronology, treatment events, or ending IDs.

Valid ending IDs: ${JSON.stringify((analysis.resolvedEndings ?? []).map((ending) => ending.id))}
Episode slots: ${JSON.stringify(episodeSlots, null, 2)}

Return only:
{"episodeEncounters":[{"episodeNumber":1,"encounters":[...]}],"episodeEndingRoutes":[{"episodeNumber":1,"routes":[...]}]}
Use an empty array for a collection with no requested slots.
`;

    try {
      const { data } = await this.callLLMForJson<ProviderSeasonPlanDraft>([
        { role: 'user', content: prompt },
      ], {
        jsonSchema: buildSeasonEpisodeUnitRepairJsonSchema(
          missing.encounterEpisodes.length,
          missing.endingRouteEpisodes.length,
        ),
      });
      const patch = this.normalizeProviderPlanData(data);
      const encounterPatch = Object.fromEntries(
        Object.entries(patch.episodeEncounters ?? {})
          .filter(([episodeNumber]) => missing.encounterEpisodes.includes(Number(episodeNumber))),
      );
      const endingRoutePatch = Object.fromEntries(
        Object.entries(patch.episodeEndingRoutes ?? {})
          .filter(([episodeNumber]) => missing.endingRouteEpisodes.includes(Number(episodeNumber))),
      );
      return {
        ...planData,
        episodeEncounters: {
          ...(planData.episodeEncounters ?? {}),
          ...encounterPatch,
        },
        episodeEndingRoutes: {
          ...(planData.episodeEndingRoutes ?? {}),
          ...endingRoutePatch,
        },
      };
    } catch (error) {
      console.warn(
        `[SeasonPlanner] Focused episode-unit repair failed; authored treatment projection may still supply the missing units: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
      return planData;
    }
  }

  private assertEpisodePlanUnitCoverage(
    analysis: SourceMaterialAnalysis,
    planData: MutablePlanData,
  ): void {
    const missing = this.missingEpisodePlanUnits(analysis, planData);
    if (missing.encounterEpisodes.length === 0 && missing.endingRouteEpisodes.length === 0) return;
    const issueCodes = [
      ...missing.encounterEpisodes.map((episodeNumber) => `episode_encounter_missing:${episodeNumber}`),
      ...missing.endingRouteEpisodes.map((episodeNumber) => `episode_ending_routes_missing:${episodeNumber}`),
    ];
    throw new PipelineError(
      `[SeasonPlanCoverage] Season planning remains incomplete after focused repair and authored projection. ` +
        `Missing encounters for Episodes [${missing.encounterEpisodes.join(', ')}]; ` +
        `missing ending routes for Episodes [${missing.endingRouteEpisodes.join(', ')}].`,
      'season_plan',
      {
        agent: 'SeasonPlanner',
        context: { missing },
        failure: {
          code: 'season_plan_topology_invalid',
          ownerStage: 'season_plan',
          retryClass: 'retry_structured_output',
          issueCodes,
          repairTarget: `season-episode-units:${[...new Set([...missing.encounterEpisodes, ...missing.endingRouteEpisodes])].join(',')}`,
        },
      },
    );
  }

  private buildPlanningPrompt(
    analysis: SourceMaterialAnalysis,
    preferences?: SeasonPlannerInput['preferences']
  ): string {
    const episodeSummaries = analysis.episodeBreakdown
      .map(ep => `Episode ${ep.episodeNumber}: "${ep.title}" - ${ep.synopsis}`)
      .join('\n');

    const characterList = analysis.majorCharacters
      .map(c => `- ${c.name} (${c.role}): ${c.description}`)
      .join('\n');

    const canonicalArcTopology = compileCanonicalSeasonArcTopology(analysis);
    const arcList = canonicalArcTopology.length > 0
      ? canonicalArcTopology
          .map((arc) =>
            `- ${arc.id} | ${arc.name}: ${arc.description} ` +
            `(Episodes ${arc.episodeRange.start}-${arc.episodeRange.end}; ID/name/range immutable)`
          )
          .join('\n')
      : analysis.storyArcs
          .map((arc) =>
            `- ${arc.id} | ${arc.name}: ${arc.description} ` +
            `(Episodes ${arc.estimatedEpisodeRange.start}-${arc.estimatedEpisodeRange.end})`
          )
          .join('\n');
    const activeEndingMode = preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single';
    const endingList = (analysis.resolvedEndings || [])
      .map((ending) => {
        const drivers = ending.stateDrivers.map((driver) => `${driver.type}: ${driver.label}`).join('; ');
        const conditions = ending.targetConditions.join(' | ');
        return `- ${ending.id} | ${ending.name}: ${ending.summary}
  Theme payoff: ${ending.themePayoff}
  Emotional register: ${ending.emotionalRegister}
  Drivers: ${drivers || 'n/a'}
  Conditions: ${conditions || 'n/a'}`;
      })
      .join('\n');

    const anchors = analysis.anchors;
    const storyCircle = analysis.storyCircle ?? defaultStoryCircleFromAnchors(anchors);
    const anchorBlock = anchors
      ? [
          `- Stakes: ${anchors.stakes}`,
          `- Goal: ${anchors.goal}`,
          `- Inciting Incident: ${anchors.incitingIncident}`,
          `- Climax: ${anchors.climax}`,
        ].join('\n')
      : '(not yet derived — inherit from episode breakdown)';
    const storyCircleBlock = storyCircle
      ? Object.entries(storyCircle)
          .map(([beat, description]) => `- ${beat}: ${description}`)
          .join('\n')
      : '(not yet derived — inherit from episode breakdown)';
    const storyCircleDistributionHint = describeStoryCircleDistribution(distributeStoryCircle(analysis.totalEstimatedEpisodes));

    const treatmentSeasonBlock = analysis.treatmentSeasonGuidance ? `
## Authored Treatment Season Guidance
The source document is a StoryRPG treatment. Preserve these authored sections as planning constraints; do not treat them as optional flavor.
- Parsed sections: ${analysis.treatmentSeasonGuidance.rawSectionSummary?.join(', ') || 'season guidance'}
${analysis.treatmentSeasonGuidance.genre ? `\n### Authored Genre\n${analysis.treatmentSeasonGuidance.genre}` : ''}
${analysis.treatmentSeasonGuidance.tone ? `\n### Authored Tone\n${analysis.treatmentSeasonGuidance.tone}` : ''}
${analysis.treatmentSeasonGuidance.highConceptPitch ? `\n### Authored High Concept Pitch\n${analysis.treatmentSeasonGuidance.highConceptPitch}` : ''}
${analysis.treatmentSeasonGuidance.logline ? `\n### Authored Logline Engine\n${analysis.treatmentSeasonGuidance.logline}` : ''}
${analysis.treatmentSeasonGuidance.coreFantasy ? `\n### Authored Core Fantasy\n${analysis.treatmentSeasonGuidance.coreFantasy}` : ''}
${analysis.treatmentSeasonGuidance.audiencePromise ? `\n### Authored Audience Promise\n${analysis.treatmentSeasonGuidance.audiencePromise}` : ''}
${analysis.treatmentSeasonGuidance.premisePromise ? `\n### Authored Premise Promise\n${analysis.treatmentSeasonGuidance.premisePromise}` : ''}
${analysis.treatmentSeasonGuidance.themeQuestion ? `\n### Authored Theme Question\n${analysis.treatmentSeasonGuidance.themeQuestion}` : ''}
${analysis.treatmentSeasonGuidance.inactionPressure ? `\n### Authored Inaction Pressure\n${analysis.treatmentSeasonGuidance.inactionPressure}` : ''}
${analysis.treatmentSeasonGuidance.seasonPromiseAndDramaticEngine ? `\n### Season Promise / Dramatic Engine\n${analysis.treatmentSeasonGuidance.seasonPromiseAndDramaticEngine}` : ''}
${analysis.treatmentSeasonGuidance.protagonistGuidance?.rawSection ? `\n### Authored Protagonist Treatment Fields\n${analysis.treatmentSeasonGuidance.protagonistGuidance.rawSection}` : ''}
${analysis.treatmentSeasonGuidance.worldLocationGuidance?.rawSection ? `\n### Authored World And Location Fields\n${analysis.treatmentSeasonGuidance.worldLocationGuidance.rawSection}` : ''}
${analysis.treatmentSeasonGuidance.stakesArchitecture ? `\n### Stakes Architecture\n${analysis.treatmentSeasonGuidance.stakesArchitecture}` : ''}
${analysis.treatmentSeasonGuidance.informationLedger ? `\n### Information Ledger\n${analysis.treatmentSeasonGuidance.informationLedger}` : ''}
${analysis.treatmentSeasonGuidance.arcPlan ? `\n### Arc Plan\n${analysis.treatmentSeasonGuidance.arcPlan}` : ''}
${analysis.treatmentSeasonGuidance.branchAndConsequenceChains ? `\n### Branch / Consequence Chains\n${analysis.treatmentSeasonGuidance.branchAndConsequenceChains}` : ''}
${analysis.treatmentSeasonGuidance.failureModeAudit ? `\n### Failure Mode Audit\n${analysis.treatmentSeasonGuidance.failureModeAudit}` : ''}
` : '';
    return `
Create a comprehensive MASTER SEASON PLAN for this interactive fiction series.
This plan is the BLUEPRINT that guides ALL episode generation - encounters, branches, and consequences.

## Source Material
- **Title**: ${analysis.sourceTitle}
- **Genre**: ${analysis.genre}
- **Tone**: ${analysis.tone}
- **Themes**: ${analysis.themes.join(', ')}
- **Total Episodes**: ${analysis.totalEstimatedEpisodes}

## Season Narrative Anchors (MUST be honoured end-to-end)
${anchorBlock}

## Canonical Story Circle Beat Definitions (authoritative — do not summarize or replace)
${STORY_CIRCLE_BEAT_DEFINITION_LINES.join('\n')}

## Story Circle Shape Principles (AUTHORITATIVE)
${STORY_CIRCLE_GEOMETRY_PRINCIPLES.join('\n')}

## Season Story Circle Beat Map
${storyCircleBlock}

## Default Story Circle Distribution (AUTHORITATIVE DEFAULT)
${storyCircleDistributionHint}
Every canonical Story Circle beat MUST land on at least one episode in canonical order.
For fewer than 8 episodes, adjacent beats fuse and no beat is omitted. For more
than 8 episodes, extra episodes are contiguous expansions of real beats; prefer
expanding \`search\`, \`take\`, and \`return\`. Do not use generic rising or falling
structural buffers for Story Circle roles.

Every \`episodeEncounters\` entry should reflect the difficulty implied by
the Story Circle beat its episode carries (\`find\`, \`take\`, and climactic
\`return\` episodes are the hardest).

## Story Craft Guidance
Use the source analysis as the authority, but learn from reusable structure:
- Establish ordinary world, protagonist core value, and a stronger motivated antagonizing force.
- Escalate pressure toward the shared Stakes and Goal without assuming every story needs combat.
- Pressure can be physical danger, social cost, mystery revelation, romantic vulnerability, moral compromise, environmental threat, resource loss, or identity pressure.
- Make plans go partly wrong often enough that choices require improvisation.
- Plan each episode around 3-6 major episode turns expressed through buildup, encounter pressure, player choice, consequence, aftermath, and cliffhanger/resolution.
- Each episode's central conflict should manifest in its encounter. The encounter is where relationships, information, risks, prior choices, player capabilities, and current stakes are tested through play.
- If the protagonist falls short, fail forward into a natural path for growth, preparation, alliance, recovery, information gathering, training, mentorship, or alternate leverage.
- Capability growth should respect existing mechanics: skills, attributes, relationships, flags, identity, prior choices, consequences, and encounter outcomes, while keeping all player-facing language fiction-first.
- Plan skill surfaces, not just hidden rolls: passive insights (what the protagonist notices), prepared advantages (prior flags/items/relationships that reduce risk), choice affordances, outcome texture, and branch residue.
- Each episode should identify 2-3 focusSkills, 1-2 growth/preparation opportunities, and at least one expectedPreparedAdvantage that can pay off later as a statCheck modifier or alternate route.
- Convert broad source themes into one working theme question for the season. Each episode should test that question from a distinct angle through protagonist/player choice, cost, relationship pressure, information, or identity movement.
- Plan protagonist-facing pressure lanes when the episode has room: A-plot is the external episode pressure; B-plot is playable relationship/identity pressure that can be a scene, an underlay, or offscreen NPC motivation surfaced through protagonist-visible signals; C-plot is usually a future seed, callback, world-pressure hint, or tonal counterweight with a visible plant and payoff plan. Do not create non-protagonist POV scenes, omniscient cutaways, or filler C-plot scenes.
- Define each arc as a 3-8 episode pressure movement inside the Story Circle, not an act or a competing structure. Each arc must own a contiguous Story Circle span with storyCircleSpan.startBeat, endBeat, ownedBeats, startEpisode, and endEpisode.
- Episode endings inside an arc are arc turn-outs, not literal TV acts. Each must escalate, reverse, reveal, cost, force a choice, recontextualize, crisis-hit, finale-answer, or hand off pressure. Do not end an arc episode with a flat transition.
- Every episode is a fractal Story Circle loop inside the season loop. By that episode's \`change\`, the protagonist must be altered in behavior, relationship, self-concept, world-state, or tragic refusal; non-finale cliffhangers then tease the next episode cycle by launching the next \`need\` or forcing the next \`go\`.
- Each arc needs: storyCircleSpan, arcQuestion, seasonQuestionRelation, identityPressureFacet, finaleAnswer, episodeTurnouts, and handoffPressure when the arc does not end the season. Each episodeTurnout must include episodeNumber, storyCircleBeat, storyCircleRoleKind, turnType, description, leavesProtagonistWith, and whyThisCannotMoveLater.
- Define Season Promise Architecture without adding fixed TV episode positions. Include one seasonDramaticQuestion, one centralPressure that can be a person/institution/mystery/environment/relationship/internal force/situation, a seasonPromise that names premise/player/emotional promises, and seasonCompleteness that explains how this season satisfies as a complete story while leaving earned future pressure.
- Episode 1 cold open is the first visible realization of \`you + need\`: it must establish protagonist foothold, normal pressure, personal stake, and want/lack before the larger engine fully moves.
- Episode 2 may clarify the repeatable engine when season length allows, but do NOT force a rigid re-pilot. Do NOT force penultimate climax or fixed tent-pole episode numbers; the season Story Circle distribution remains authoritative.
- Build an Information Ledger for major questions, threats, secrets, reveals, and payoffs. Use suspense/dramatic irony by default when the player can know the threat without breaking POV. Mystery is capped at 3 box questions per season. For major payoffs, plants should be 3-4 episodes ahead unless the season is shorter than the runway.
- After the Climax, resolve quickly: show what was saved or changed, then show future cost, identity change, or legacy.
- From the Inciting Incident through the Climax, make difficulty rise and make the protagonist's transformation increasingly necessary to achieve the Goal.
- Following the Climax, include only brief resolution pressure: first what was saved, redeemed, or improved; then the protagonist's future, cost, identity change, or legacy.

${CRAFT_PRESSURE_GUIDANCE}

## Genre-Aware Jeopardy Policy
${buildGenreAwareJeopardyGuidance(analysis.genre)}

${analysis.schemaAbstraction ? `## Reusable Pattern Abstraction
- Archetype: ${analysis.schemaAbstraction.archetype}
- Mode: ${analysis.schemaAbstraction.adaptationMode}
- Pattern: ${analysis.schemaAbstraction.reusablePatternSummary}
- Guidance: ${analysis.schemaAbstraction.generalizationGuidance.join('; ')}
` : ''}${analysis.themeArgument ? `## Theme Argument / Resonance Contract
- Theme question: ${analysis.themeArgument.themeQuestion}
- Controlling idea: ${analysis.themeArgument.controllingIdea.sentence}
- Counter-idea: ${analysis.themeArgument.counterIdea.sentence}
- Value ladder: positive=${analysis.themeArgument.valueLadder.positive}; contrary=${analysis.themeArgument.valueLadder.contrary}; contradiction=${analysis.themeArgument.valueLadder.contradiction}; negation=${analysis.themeArgument.valueLadder.negationOfNegation}
- Climax resonant event: ${analysis.themeArgument.climaxResonantEvent}
Use this as planning metadata only. Do not copy labels like controlling idea, counter-idea, or negation-of-negation into player-facing prose.
` : ''}${treatmentSeasonBlock}${SEASON_PLANNER_CRAFT_EXAMPLE}

## Episode Breakdown
${episodeSummaries}

## Major Characters
${characterList}

## Story Arcs
${arcList}

## Protagonist
- **Name**: ${analysis.protagonist.name}
- **Arc**: ${analysis.protagonist.arc}
${analysis.characterArchitecture ? `- Lie: ${analysis.characterArchitecture.protagonist.lie}
- Origin pressure: ${analysis.characterArchitecture.protagonist.originPressure}
- Truth: ${analysis.characterArchitecture.protagonist.truth}
- Want: ${analysis.characterArchitecture.protagonist.want}
- Need: ${analysis.characterArchitecture.protagonist.need}
- Arc mode: ${analysis.characterArchitecture.protagonist.arcMode}
- Climax choice: ${analysis.characterArchitecture.protagonist.climaxChoice.choiceQuestion}
` : ''}

## User Preferences
- Scenes per episode: ${clampSceneCount(preferences?.targetScenesPerEpisode || 6)}
- Choices per episode: ${preferences?.targetChoicesPerEpisode || 3}
- Pacing: ${preferences?.pacing || 'moderate'}

## Ending Targets
- Active ending mode: ${activeEndingMode}
${endingList ? endingList : '- No explicit endings supplied. Create a convergent primary ending route that still pays off the source themes.'}

## YOUR TASK - MASTER BLUEPRINT

**Design each episode from the encounter outward.** The encounter is the episode's central conflict / pressure event. The episode's narrative exists to build toward the encounter, test the player's relationships, information, skills, prior choices, and current stakes, then play out the consequences.

### THE ENCOUNTER-FIRST PLANNING PROCESS

For each episode, answer in this order:

1. **What central conflict or pressure event should this episode test through play?** That is the encounter. You are NOT bound to the source material — invent or heighten any confrontation that fits the themes. A social standoff in a drawing room is as valid as a sword fight.

2. **What does the player need to feel and know before reaching that encounter?** Plan buildup scenes that establish: the relationships that will be tested, the information that will become a weapon, and the personal stakes that make each encounter choice feel like a value statement, not just a tactical decision.

3. **What do the encounter choices draw on?** The best encounter choices reference what was established in the buildup — "do I use the trust I built with this character?" or "do I reveal the secret I discovered in the opening scene?" Plan the skills, relationships, and information that should be in play.

4. **What are the branching outcomes?** Victory, defeat, and escape should diverge meaningfully — not just different text, but different situations with different emotional weight and different paths forward.

You must plan THREE critical things at the SEASON level:

### 1. ENCOUNTER PLANNING (Encounter-First)
For each episode, design the encounter FIRST as the dramatic anchor, then plan how the episode builds toward it.
- Each encounter must feel like the episode's reason for existing — the culmination of everything that came before
- Each encounter must manifest the episode's central conflict / pressure event
- Before choosing encounter type/style, choose exactly one encounter Story Circle target from \`go\`, \`search\`, \`find\`, or \`take\`.
- Encounter target criteria:
${formatEncounterStoryCircleTargetCriteria().split('\n').map((line) => `  - ${line}`).join('\n')}
- Plan what information/relationships/stakes the pre-encounter scenes must establish so the encounter choices feel loaded
- Design a DIFFICULTY CURVE across the season (introduction → rising → peak → falling → finale)
- Vary encounter types — no two consecutive episodes should use the same type
- Encounters at arc climaxes should be the hardest and most personally costly

In the \`episodeEncounters\` JSON, add \`storyCircleTarget\`, \`storyCircleTargetRationale\`, \`storyCircleTargetEvidence\`, and \`encounterBuildup\`. The target is the encounter's structural function; the type/style is only how that function is expressed.

### 2. CROSS-EPISODE BRANCHING
Player choices should have consequences ACROSS episodes, not just within them.
- Identify 2-4 major branch points where player choices create DIFFERENT experiences in later episodes
- Encounter outcomes (victory/defeat/escape) are the richest source of cross-episode branches
- Branches should eventually reconverge (you can't make infinite parallel stories)

### 3. CONSEQUENCE CHAINS
Track how a single decision ripples through the season.
- A mercy shown in episode 2 might save you in episode 5
- An alliance formed in episode 1 might betray you in episode 4
- These create the feeling of a living, responsive world

### 4. CHARACTER GROWTH CURVE
Plan how the protagonist develops across the season through story progression and existing game state. For each episode, specify:
- **focusSkills**: 2-3 skills thematically relevant to this episode's challenges (from: athletics, stealth, perception, persuasion, intimidation, deception, investigation, survival)
- **developmentScene**: A fiction-first scene concept where the player CHOOSES how to prepare, recover, train, investigate, seek help, or gain alternate leverage. Each option should naturally support a different skill or capability. Place 1-2 per episode.
- **mentorshipOpportunity**: If an NPC's expected relationship is strong enough by this episode, note the NPC and which attribute they can help develop. Mentorship grows ATTRIBUTES (charm, wit, courage, empathy, resolve, resourcefulness).

Growth should follow the difficulty curve:
- Early episodes: easy challenges, generous development opportunities
- Mid episodes: harder challenges that expose skill gaps, mentorship opens up
- Late episodes: tight challenges that reward investment, mentorship pays off in the climax
- Failure should never become a dead end or rote grind. If a character falls short, route the consequence into playable story material: debt, suspicion, injury, lost leverage, damaged trust, recovery, preparation, alliance, investigation, training, or a harder alternate approach.
- Keep growth invisible as mechanics in player-facing prose. Do not expose stats, thresholds, dice, percentages, or "train until ready" language.

### 5. ENDING TARGETING
- In \`single\` mode, all major routes must ultimately point back toward ONE ending target.
- In \`multiple\` mode, preserve DISTINCT routes and tie them to specific ending IDs.
- Use \`crossEpisodeBranches.paths[].targetEndingIds\` to show which ending routes a branch serves.
- Use \`episodeEndingRoutes\` to mark whether each episode opens, reinforces, threatens, or locks a route.

### 6. CHOICE MOMENTS (season-level)
Identify the key DECISIONS across the master narrative as \`choiceMoments\` — not every minor pick,
but the moments that define the season's interactivity. For each:
- **anchor**: what the decision is, in fiction (tie it to an arc beat or Story Circle beat). Never expose stats/mechanics.
- **episode**: where the player makes it.
- **paysOffEpisode**: when its consequence lands — the SAME episode for an immediate payoff, or a LATER episode for a decision that echoes across the season. Omit for immediate.
- **flag** (only for later-payoff moments): a snake_case flag the choice sets, so the payoff can be enforced.
Spread them across episodes; a few should pay off later (those are the season's connective tissue).
Do NOT assign a choice "type" — that is allocated downstream across the whole season.

Return this JSON:
{
  "seasonTitle": "Compelling season title",
  "seasonSynopsis": "2-3 sentence season overview",
  "seasonPromiseArchitecture": {
    "seasonDramaticQuestion": "One protagonist-centered season question that fuses goal, stakes, and Lie/Truth pressure",
    "centralPressure": {
      "type": "person|institution|mystery|environment|relationship|internal|situation",
      "description": "The season-long pressure that forces the protagonist's Lie/Truth into crisis",
      "pressuresLieBy": "How this pressure makes the protagonist false/protective belief harder to sustain"
    },
    "seasonPromise": {
      "premisePromise": "What kind of story/premise the opening promises",
      "playerExperiencePromise": "What kind of choices, agency, and interactive pressure the player should expect",
      "emotionalPromise": "What emotional contract the season makes with the audience/player",
      "variationPlan": [
        "How later episodes deliver fresh variations on the promise without repeating the pilot"
      ]
    },
    "seasonCompleteness": {
      "resolvedQuestion": "How the final episode answers or directly resolves the seasonDramaticQuestion enough to satisfy",
      "resolvedStakes": "What is saved, lost, changed, or paid off this season",
      "characterStateChange": "How the protagonist is different by the end",
      "openFuturePressure": "Optional earned future pressure; must not erase season completeness"
    }
  },
  "informationLedger": [
    {
      "id": "info-1",
      "label": "Short label for the question, secret, threat, or plant",
      "description": "What information is at stake",
      "audienceKnowledgeState": "shared|withheld|selective",
      "tensionMode": "suspense|mystery|dramatic_irony|surprise|revelation|foreshadowing",
      "knownBy": ["player|protagonist|ally|antagonist|world"],
      "withheldFrom": ["player|protagonist|ally|antagonist|world"],
      "introducedEpisode": 1,
      "plannedRevealEpisode": 3,
      "plannedPayoffEpisode": 5,
      "setupTouchEpisodes": [1, 2],
      "payoffPlan": "How this information pays off in choice, reveal, cost, reversal, or consequence",
      "isBoxQuestion": false,
      "closesQuestionIds": [],
      "opensQuestionIds": []
    }
  ],
  "arcs": [
    {
      "id": "arc-1",
      "name": "Arc name",
      "description": "Arc description",
      "episodeRange": { "start": 1, "end": 3 },
      "arcQuestion": "The specific arc-level dramatic question, narrower than the season question",
      "seasonQuestionRelation": "How this arc question pressures or narrows the season's theme/goal/stakes question",
      "identityPressureFacet": "The protagonist false belief, wound, fear, vow, loyalty, ambition, self-image, or value conflict this arc pressures",
      "midpointRecontextualization": {
        "episodeNumber": 2,
        "questionBefore": "What the protagonist/player thought the arc question was asking",
        "questionAfter": "How the question changes after the midpoint reveal/reversal/discovery",
        "description": "The event that changes the meaning of the arc"
      },
      "lateArcCrisis": {
        "episodeNumber": 3,
        "apparentFailure": "How the current plan appears to fail or collapse",
        "irreversibleCost": "What cannot be restored even if the protagonist recovers",
        "description": "The crisis beat near the final third of the arc"
      },
      "finaleAnswer": "How the arc question is answered without pretending the season is over unless this is the season finale",
      "handoffPressure": "Required when this arc finale is not the season finale: the new pressure, residue, or question that drives the next arc",
      "episodeTurnouts": [
        {
          "episodeNumber": 1,
          "turnType": "setup|escalation|reversal|revelation|cost|choice|recontextualization|crisis|finale|handoff",
          "description": "How this episode ending turns the arc",
          "leavesProtagonistWith": "The new damage, knowledge, obligation, exposure, compromise, relationship pressure, or choice residue",
          "whyThisCannotMoveLater": "Why this turnout must happen here and could not be swapped with a later episode"
        }
      ],
      "keyMoments": [
        { "episodeNumber": 1, "description": "Key moment", "importance": "critical" }
      ]
    }
  ],
  "episodeDependencies": {
    "2": [1],
    "3": [1, 2]
  },
  "episodeEncounters": [
    {
      "episodeNumber": 1,
      "encounters": [
      {
        "id": "enc-1-1",
        "type": "combat|social|chase|stealth|puzzle|exploration|mixed",
        "description": "What this encounter is about — be specific and dramatic",
        "difficulty": "easy|moderate|hard|extreme",
        "npcsInvolved": ["character names"],
        "stakes": "What's personally at risk for the protagonist — not just plot stakes",
        "storyCircleTarget": "go|search|find|take",
        "storyCircleTargetRationale": "Why this encounter target is correct: threshold, adaptation, acquisition, or cost",
        "storyCircleTargetEvidence": {
          "episodeStoryCircleRole": ["go"],
          "episodeQuestion": "The episode pressure this encounter tests",
          "protagonistChange": "How the protagonist is altered by the encounter and episode ending",
          "cliffhangerHandoff": "next_need|next_go|none"
        },
        "relevantSkills": ["athletics", "persuasion", "stealth"],
        "encounterBuildup": "What the episode's earlier scenes must establish so this encounter's choices feel earned — relationships built, information revealed, personal stakes made clear",
        "encounterSetupContext": [
          "flag:example_flag — how the earlier choice echoes inside the encounter",
          "relationship:npc-id.trust >= 20 — what changes if trust is high enough"
        ],
        "isBranchPoint": false,
        "branchOutcomes": {
          "victory": "What happens on success — specific narrative consequence",
          "defeat": "What happens on failure — specific narrative consequence",
          "escape": "Optional escape outcome"
        }
      }
      ]
    }
  ],
  "episodeEndingRoutes": [
    {
      "episodeNumber": 1,
      "routes": [
      {
        "endingId": "ending-1",
        "role": "opens|reinforces|threatens|locks",
        "description": "How this episode moves the player toward or away from that ending"
      }
      ]
    }
  ],
  "episodeCliffhangers": {
    "1": {
      "type": "shock|emotional_hook|reframe|revelation|danger|betrayal|arrival|decision|mystery|loss|transformation",
      "intensity": "low|medium|high",
      "hook": "The exact serialized-TV hook the final beat should deliver",
      "setup": "What earlier scene detail, relationship pressure, clue, or promise earns this ending",
      "resolvedEpisodeTension": "The immediate episode conflict that gets acknowledged or partially resolved before the hook lands",
      "newOpenQuestion": "The new question the reader must continue to answer",
      "emotionalCharge": "The dominant feeling: shock, dread, heartbreak, temptation, awe, etc.",
      "nextEpisodePressure": "How this ending pushes into the next episode",
      "storyCircleLaunchBeat": "you|need|go|search|find|take|return|change"
    }
  },
  "difficultyCurve": [
    { "episodeNumber": 1, "difficulty": "introduction", "encounterCount": 1 },
    { "episodeNumber": 2, "difficulty": "rising", "encounterCount": 2 }
  ],
  "growthCurve": [
    {
      "episodeNumber": 1,
      "focusSkills": ["persuasion", "perception"],
      "developmentScene": "After the opening confrontation, a quiet moment to regroup. Options: practice reading people (perception) / rehearse talking points (persuasion) / explore the grounds (investigation)",
      "mentorshipOpportunity": null
    },
    {
      "episodeNumber": 3,
      "focusSkills": ["athletics", "intimidation"],
      "developmentScene": "Training montage before the big confrontation. Options: spar with Marcus (athletics) / practice intimidation (intimidation) / study the layout (stealth)",
      "mentorshipOpportunity": {
        "npcId": "marcus",
        "npcName": "Marcus",
        "requiredRelationship": { "dimension": "respect", "threshold": 60 },
        "attribute": "courage",
        "narrativeHook": "Marcus recognizes the player's hesitation and offers to train them"
      }
    }
  ],
  "crossEpisodeBranches": [
    {
      "id": "branch-1",
      "name": "The Alliance Choice",
      "originEpisode": 2,
      "trigger": {
        "type": "encounter_outcome|story_choice|relationship_state",
        "description": "What triggers this branch"
      },
      "paths": [
        {
          "id": "path-1a",
          "name": "Alliance with rebels",
          "condition": "Player chose to help the rebels",
          "targetEndingIds": ["ending-1"],
          "affectedEpisodes": [
            { "episodeNumber": 3, "impact": "major", "description": "Rebels provide safe passage" },
            { "episodeNumber": 5, "impact": "moderate", "description": "Rebel contact provides intel" }
          ]
        },
        {
          "id": "path-1b",
          "name": "Loyal to the crown",
          "condition": "Player chose to report the rebels",
          "targetEndingIds": ["ending-2"],
          "affectedEpisodes": [
            { "episodeNumber": 3, "impact": "major", "description": "Must fight through rebel territory alone" },
            { "episodeNumber": 5, "impact": "moderate", "description": "Crown rewards with resources" }
          ]
        }
      ],
      "reconvergence": {
        "episodeNumber": 6,
        "description": "Both paths lead to the same final confrontation"
      }
    }
  ],
  "consequenceChains": [
    {
      "id": "chain-1",
      "origin": {
        "episodeNumber": 1,
        "description": "Spare the guard's life"
      },
      "consequences": [
        { "episodeNumber": 3, "description": "Guard remembers mercy, provides information", "severity": "noticeable" },
        { "episodeNumber": 5, "description": "Guard becomes unexpected ally in final battle", "severity": "dramatic" }
      ]
    }
  ],
  "seasonFlags": [
    {
      "flag": "spared_guard",
      "description": "Player showed mercy to the guard in episode 1",
      "setInEpisode": 1,
      "checkedInEpisodes": [3, 5]
    }
  ],
  "choiceMoments": [
    { "id": "cm-1", "episode": 1, "anchor": "Confront the captain or hold your tongue", "paysOffEpisode": 1 },
    { "id": "cm-2", "episode": 1, "anchor": "Spare the envoy or take the prisoner", "paysOffEpisode": 4, "flag": "spared_envoy" },
    { "id": "cm-3", "episode": 2, "anchor": "Trust Lysandra's plan or override it" }
  ],
  "characterIntroductions": [
    { "characterId": "char-1", "characterName": "Name", "introducedInEpisode": 1, "role": "protagonist" }
  ],
  "locationIntroductions": [
    { "locationId": "loc-1", "locationName": "Name", "introducedInEpisode": 1 }
  ],
  "recommendedGenerationOrder": [1, 2, 3, 4],
  "criticalEpisodes": [1, 3, 5],
  "warnings": ["Any adaptation concerns"]
}

CRITICAL RULES:
- Every episode MUST have at least 1 encounter — and it must be the episode's dramatic anchor
- Every encounter MUST have \`storyCircleTarget\` set to exactly one of: \`go\`, \`search\`, \`find\`, \`take\`.
- Every encounter MUST have \`storyCircleTargetRationale\` explaining why the playable pressure event is a threshold, adaptation test, acquisition, or price.
- Every encounter MUST have \`storyCircleTargetEvidence.protagonistChange\` naming how the protagonist is altered by the episode; non-finale encounter aftermath/cliffhanger should hand pressure to the next \`need\` or \`go\` when appropriate.
- Every encounter MUST have an encounterBuildup field describing what earlier scenes must establish
- Every encounter SHOULD include encounterSetupContext when earlier relationship/flag setup should visibly pay off inside the encounter
- Use encounterSetupContext entries in the format: "flag:<name> — <effect>" or "relationship:<npcId>.<dimension> <operator> <threshold> — <effect>"
- Preserve relationship operators exactly (\`<\`, \`<=\`, \`>\`, \`>=\`, \`==\`, \`!=\`) so downstream agents know whether high or low relationship state matters
- In \`multiple\` mode, make sure multiple distinct ending IDs remain reachable in the plan
- In \`single\` mode, branch routes may diverge temporarily but should reconverge toward the same final ending target
- Encounter types MUST VARY — no two consecutive episodes use the same type
- At least 2 cross-episode branches for a season with 3+ episodes (encounter outcomes are the best source)
- Consequence chains should span at least 2 episodes
- Difficulty should generally increase through the season
- Every non-finale episode MUST have an \`episodeCliffhangers\` entry.
- Cliffhanger style MUST map to the episode's Story Circle role:
  - \`you + need\`: this is the cold open contract; Episode 1 must establish protagonist foothold, normal pressure, personal stake, and want/lack, then reveal that the story is bigger, darker, more tempting, or more personal than expected
  - \`go\`: danger, decision, discovery, invitation, refusal, threat, or consequence that forces commitment and makes retreat harder
  - \`search\`: failed plan, learned rule, exposed identity, tested ally/tool, or new behavior under pressure
  - \`find\`: apparent victory, answer, access, intimacy, proof, power, rescue, or status that exposes the problem created by the prize
  - \`take\`: strongest hooks; cost, rupture, loss, apparent failure, public exposure, resource depletion, identity wound, or painful truth
  - \`return\`: prize-and-wound pressure, reintegration consequence, changed public identity, relationship reckoning, or road-back complication
  - \`change\`: close the main circle and seed only earned legacy/future pressure, never a fake unresolved main conflict
- Cadence rule: Episode 1, midpoint, pinch2, and at least every 2-3 episodes in longer seasons should use high-intensity shock, emotional_hook, betrayal, reframe, revelation, or loss.
- Arc pressure rule: each arc should span 3-8 episodes where practical. If source length forces a shorter or longer arc, explain the exception in warnings.
- Arc turn-out rule: every episode inside an arc must leave the protagonist with new damage, knowledge, obligation, exposure, compromise, relationship pressure, choice residue, or future pressure. If an episode's arc turnout could be swapped with a later episode, the arc is slack and must be tightened.
- Arc finale rule: if an arc does not end on the season finale episode, its finaleAnswer must resolve the local arc question and its handoffPressure must launch the next arc. Do not give a non-final arc season-level finality.
- Season promise rule: deliver the premise/player/emotional promises in fresh variations across the season. Breaking the core promise is a planning failure unless the user explicitly asked for a genre-breaking subversion.
- Season completeness rule: the final episode must answer the seasonDramaticQuestion enough to satisfy and show changed stakes/character state. Future hooks are allowed only as earned residue, not as a fake unresolved main conflict.
- Information ledger rule: maximum 3 mystery/box-question entries per season. Every box question needs a planned reveal or payoff before introduction. Major payoffs need setup touches planted 3-4 episodes ahead. The finale should close more major questions than it opens.
- You are NOT limited to what the source material literally contains — invent more dramatically intense encounters that fit the themes
- Return ONLY valid JSON
`;
  }

  private buildFallbackPlan(analysis: SourceMaterialAnalysis): Partial<SeasonPlan> & {
    encounterPlan?: any;
    crossEpisodeBranches?: any[];
    consequenceChains?: any[];
    seasonFlags?: any[];
      episodeEncounters?: Record<number, any[]>;
      episodeEndingRoutes?: Record<number, any[]>;
      episodeCliffhangers?: Record<number, Partial<CliffhangerPlan>>;
  } {
    // Fallback plan with auto-generated encounters and basic branching
    const episodeDependencies: Record<number, number[]> = {};
    for (let i = 2; i <= analysis.totalEstimatedEpisodes; i++) {
      episodeDependencies[i] = [i - 1];
    }

    // Auto-generate encounters based on episode content
    const encounterTypes: EncounterCategory[] = ['combat', 'social', 'romantic', 'dramatic', 'exploration', 'chase', 'stealth', 'puzzle', 'mixed'];
    const episodeEncounters: Record<number, PlannedEncounter[]> = {};
    const episodeEndingRoutes: Record<number, Array<{ endingId: string; role: string; description: string }>> = {};
    const episodeCliffhangers: Record<number, Partial<CliffhangerPlan>> = {};
    const totalEps = analysis.totalEstimatedEpisodes;
    const activeEndings = analysis.resolvedEndings || [];
    const activeMode = analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single';

    analysis.episodeBreakdown.forEach((ep, idx) => {
      const epNum = ep.episodeNumber;
      const progress = epNum / totalEps;
      
      // Determine difficulty based on position in season
      let difficulty: PlannedEncounter['difficulty'] = 'easy';
      if (progress > 0.75) difficulty = 'extreme';
      else if (progress > 0.5) difficulty = 'hard';
      else if (progress > 0.25) difficulty = 'moderate';
      
      // Create 1-2 encounters per episode
      const encounterCount = epNum === totalEps || progress > 0.5 ? 2 : 1;
      const encounters: PlannedEncounter[] = [];
      
      for (let i = 0; i < encounterCount; i++) {
        const typeIdx = (idx * 2 + i) % encounterTypes.length;
        const storyCircleTarget = normalizeEncounterStoryCircleTarget(
          undefined,
          ep.storyCircleRole,
          `${ep.title} ${ep.synopsis} ${ep.narrativeFunction.conflict}`,
        );
        encounters.push({
          id: `enc-${epNum}-${i + 1}`,
          type: encounterTypes[typeIdx],
          description: `${encounterTypes[typeIdx]} encounter in "${ep.title}"`,
          difficulty,
          npcsInvolved: ep.mainCharacters.slice(0, 2),
          stakes: ep.narrativeFunction.conflict,
          storyCircleTarget,
          storyCircleTargetRationale: buildEncounterStoryCircleTargetRationale(
            storyCircleTarget,
            ep.storyCircleRole,
            ep.narrativeFunction.conflict,
          ),
          storyCircleTargetEvidence: {
            episodeStoryCircleRole: ep.storyCircleRole?.map((role) => role.beat),
            episodeQuestion: ep.narrativeFunction.conflict,
            protagonistChange: ep.narrativeFunction.resolution || ep.synopsis,
            cliffhangerHandoff: epNum < totalEps ? 'next_need' : 'none',
          },
          relevantSkills: [],
          isBranchPoint: i === encounterCount - 1 && epNum < totalEps,
          branchOutcomes: i === encounterCount - 1 ? {
            victory: `Success in ${ep.title}`,
            partialVictory: `Costly success in ${ep.title}`,
            defeat: `Setback in ${ep.title}`,
          } : undefined,
        });
      }
      
      episodeEncounters[epNum] = encounters;
      episodeEndingRoutes[epNum] = activeEndings.length > 0
        ? (activeMode === 'multiple'
          ? activeEndings.map((ending, routeIndex) => ({
              endingId: ending.id,
              role: epNum === totalEps ? 'locks' : epNum === 1 ? 'opens' : (routeIndex + epNum) % 3 === 0 ? 'threatens' : 'reinforces',
              description: epNum === totalEps
                ? `This episode commits the player to ${ending.name}.`
                : epNum === 1
                  ? `This episode opens the possibility of ${ending.name}.`
                  : `This episode keeps ${ending.name} active through encounter and choice pressure.`,
            }))
          : [{
              endingId: activeEndings[0].id,
              role: epNum === totalEps ? 'locks' : epNum === 1 ? 'opens' : 'reinforces',
              description: epNum === totalEps
                ? `This episode locks the convergent route toward ${activeEndings[0].name}.`
                : `This episode keeps the season converging toward ${activeEndings[0].name}.`,
            }])
        : [];
      const nextEpisodeTitle = analysis.episodeBreakdown.find(e => e.episodeNumber === epNum + 1)?.title;
      episodeCliffhangers[epNum] = buildDefaultCliffhangerPlan({
        episode: ep,
        totalEpisodes: totalEps,
        seasonStakes: analysis.anchors?.stakes,
        nextEpisodeTitle,
      });
    });

    return {
      seasonTitle: `${analysis.sourceTitle}: Season 1`,
      seasonSynopsis: `An interactive adaptation of ${analysis.sourceTitle}, spanning ${analysis.totalEstimatedEpisodes} episodes.`,
      arcs: analysis.storyArcs.map(arc => ({
        id: arc.id,
        name: arc.name,
        description: arc.description,
        episodeRange: arc.estimatedEpisodeRange,
        keyMoments: [],
        status: 'not_started' as const,
        completionPercentage: 0,
      })),
      episodeEncounters,
      episodeEndingRoutes,
      crossEpisodeBranches: [],
      consequenceChains: [],
      seasonFlags: [],
      episodeCliffhangers,
    };
  }

  private mergeTreatmentGuidanceIntoPlanData(analysis: SourceMaterialAnalysis, planData: MutablePlanData): MutablePlanData {
    const hasTreatment = analysis.episodeBreakdown.some((ep) => ep.treatmentGuidance)
      || (analysis.treatmentBranches || []).length > 0;
    if (!hasTreatment) return planData;

    const merged: MutablePlanData = {
      ...planData,
      episodeEncounters: { ...(planData.episodeEncounters || {}) },
      episodeCliffhangers: { ...(planData.episodeCliffhangers || {}) },
      episodeEndingRoutes: { ...(planData.episodeEndingRoutes || {}) },
      crossEpisodeBranches: [...(planData.crossEpisodeBranches || [])],
      consequenceChains: [...(planData.consequenceChains || [])],
      seasonFlags: [...(planData.seasonFlags || [])],
      choiceMoments: [...(planData.choiceMoments || [])],
    };
    const endingIds = (analysis.resolvedEndings || []).map((ending) => ending.id);

    for (const ep of analysis.episodeBreakdown) {
      const guidance = ep.treatmentGuidance;
      if (!guidance) continue;
      const epKey = String(ep.episodeNumber);
      // Anchors must be stageable events. Authored anchors are trusted but
      // still question-filtered; the fallback prefers a concrete threat
      // sentence mined from the synopsis over guidance fields, and NEVER uses
      // dramaticQuestion (a question is not an event — see isQuestionShapedAnchor).
      const authoredAnchors = (guidance.encounterAnchors ?? [])
        .filter((value): value is string => typeof value === 'string' && !isQuestionShapedAnchor(value));
      const fallbackAnchor = minedEventAnchorFromSynopsis(ep)
        ?? [guidance.forcedChoice, guidance.obstacle, guidance.entryGoal]
          .find((value): value is string => typeof value === 'string' && !isQuestionShapedAnchor(value));
      const anchors = authoredAnchors.length > 0
        ? authoredAnchors
        : (fallbackAnchor ? [fallbackAnchor] : []);
      if (anchors.length > 0) {
        merged.episodeEncounters![epKey] = anchors.map((anchor, index) => {
          const description = guidance.encounterCentralConflict
            ? `${anchor} Central conflict: ${guidance.encounterCentralConflict}`
            : guidance.forcedChoice
              ? `${anchor} Forced choice: ${guidance.forcedChoice}`
              : anchor;
          const storyCircleTarget = guidance.encounterStoryCircleTarget ?? normalizeEncounterStoryCircleTarget(
            undefined,
            ep.storyCircleRole,
            [
              description,
              guidance.encounterCentralConflict,
              guidance.forcedChoice,
              guidance.encounterAftermath,
              guidance.exitShift,
              guidance.consequenceResidue,
              ep.narrativeFunction.conflict,
            ].filter(Boolean).join(' '),
          );
          return {
            id: `treatment-enc-${ep.episodeNumber}-${index + 1}`,
            type: this.inferEncounterType(anchor, analysis.genre),
            description,
            difficulty: this.inferEncounterDifficulty(ep.episodeNumber, analysis.totalEstimatedEpisodes),
            npcsInvolved: ep.mainCharacters,
            stakes: guidance.stakesLayers?.join(' | ') || guidance.encounterCentralConflict || guidance.episodePromise || ep.narrativeFunction.conflict,
            centralConflict: guidance.encounterCentralConflict || guidance.dramaticQuestion || guidance.obstacle,
            storyCircleTarget,
            storyCircleTargetRationale: guidance.encounterStoryCircleTargetRationale
              || buildEncounterStoryCircleTargetRationale(storyCircleTarget, ep.storyCircleRole, description),
            storyCircleTargetEvidence: {
              episodeStoryCircleRole: ep.storyCircleRole?.map((role) => role.beat),
              episodeQuestion: guidance.dramaticQuestion || ep.narrativeFunction.conflict,
              protagonistChange: guidance.endStateChange || guidance.exitShift || guidance.encounterAftermath || ep.narrativeFunction.resolution,
              cliffhangerHandoff: ep.episodeNumber < analysis.totalEstimatedEpisodes ? 'next_need' : 'none',
            },
            aftermathConsequence: guidance.encounterAftermath || guidance.exitShift || guidance.consequenceResidue || guidance.connectsBy,
            relevantSkills: this.inferRelevantSkills(anchor),
            encounterBuildup: guidance.encounterBuildup || guidance.entryGoal || guidance.openingSituation,
            encounterSetupContext: [
            ...(guidance.dramaticQuestion ? [`question:treatment_ep${ep.episodeNumber} — ${guidance.dramaticQuestion}`] : []),
            ...(guidance.entryGoal ? [`entry_goal:treatment_ep${ep.episodeNumber} — ${guidance.entryGoal}`] : []),
            ...(guidance.obstacle ? [`obstacle:treatment_ep${ep.episodeNumber} — ${guidance.obstacle}`] : []),
            ...(guidance.forcedChoice ? [`forced_choice:treatment_ep${ep.episodeNumber} — ${guidance.forcedChoice}`] : []),
            ...(guidance.exitShift ? [`exit_shift:treatment_ep${ep.episodeNumber} — ${guidance.exitShift}`] : []),
            ...(guidance.powerShift ? [`power_shift:treatment_ep${ep.episodeNumber} — ${guidance.powerShift}`] : []),
            ...(guidance.subtextGap ? [`subtext_gap:treatment_ep${ep.episodeNumber} — ${guidance.subtextGap}`] : []),
            ...(guidance.connectsBy ? [`connects_by:treatment_ep${ep.episodeNumber} — ${guidance.connectsBy}`] : []),
            ...(guidance.themePressure ? [`theme:treatment_ep${ep.episodeNumber} — ${guidance.themePressure}`] : []),
            ...(guidance.liePressure ? [`lie_pressure:treatment_ep${ep.episodeNumber} — ${guidance.liePressure}`] : []),
            ...(guidance.informationMovement ? [`information:treatment_ep${ep.episodeNumber} — ${guidance.informationMovement}`] : []),
            ...(guidance.stakesLayers || []).slice(0, 4).map((layer, layerIndex) =>
              `stakes:treatment_stakes_ep${ep.episodeNumber}_${layerIndex + 1} — ${layer}`
            ),
            ...(guidance.episodeTurns || []).slice(0, 4).map((turn, turnIndex) =>
              `turn:treatment_turn_ep${ep.episodeNumber}_${turnIndex + 1} — ${turn}`
            ),
            ...(guidance.consequenceSeeds || []).slice(0, 4).map((seed, seedIndex) =>
              `flag:treatment_seed_ep${ep.episodeNumber}_${seedIndex + 1} — ${seed}`
            ),
            ...(guidance.consequenceResidue ? [`residue:treatment_ep${ep.episodeNumber} — ${guidance.consequenceResidue}`] : []),
            ...(guidance.capabilityGrowthGuidance || []).slice(0, 2).map((growth, growthIndex) =>
              `growth:treatment_growth_ep${ep.episodeNumber}_${growthIndex + 1} — ${growth}`
            ),
            ...(guidance.encounterAftermath ? [`aftermath:treatment_ep${ep.episodeNumber} — ${guidance.encounterAftermath}`] : []),
          ],
          isBranchPoint: (guidance.alternativePaths || []).length > 0,
          branchOutcomes: (guidance.alternativePaths || []).length > 0 ? {
            victory: guidance.alternativePaths![0] || `The player earns a better version of ${ep.title}.`,
            partialVictory: guidance.alternativePaths![1] || `The player gets what they want, but residue follows.`,
            defeat: guidance.alternativePaths![2] || `The player pays a visible cost in ${ep.title}.`,
          } : undefined,
          };
        });
      }

      const forwardPressure = guidance.nextEpisodePressure
        || guidance.nextEpisodeCausality
        || guidance.cliffhangerQuestion
        || guidance.cliffhangerHook
        || guidance.endingPressure
        || guidance.authoredCliffhanger
        || guidance.consequenceResidue;
      const cliffhangerHook = guidance.cliffhangerHook || forwardPressure || guidance.endingTurnout;
      const cliffhangerQuestion = guidance.cliffhangerQuestion || forwardPressure;
      if (forwardPressure && ep.episodeNumber < analysis.totalEstimatedEpisodes) {
        merged.episodeCliffhangers![epKey] = {
          ...(guidance.cliffhangerType ? { type: guidance.cliffhangerType } : {}),
          hook: cliffhangerHook,
          setup: guidance.cliffhangerSetup || guidance.encounterAftermath || guidance.exitShift || guidance.consequenceSeeds?.join(' | ') || guidance.encounterBuildup || ep.narrativeFunction.conflict,
          resolvedEpisodeTension: guidance.resolvedEpisodeTension || guidance.exitShift || guidance.endingTurnout || ep.narrativeFunction.resolution,
          newOpenQuestion: cliffhangerQuestion,
          emotionalCharge: guidance.emotionalCharge,
          nextEpisodePressure: forwardPressure,
        };
      } else if (guidance.resolutionAftermath && ep.episodeNumber >= analysis.totalEstimatedEpisodes) {
        merged.episodeCliffhangers![epKey] = {
          hook: guidance.resolutionAftermath,
          setup: guidance.encounterAftermath || ep.narrativeFunction.conflict,
          resolvedEpisodeTension: guidance.resolutionAftermath,
          newOpenQuestion: guidance.resolutionAftermath,
          nextEpisodePressure: guidance.resolutionAftermath,
        };
      }

      if (endingIds.length > 0) {
        merged.episodeEndingRoutes![epKey] = endingIds.map((endingId) => ({
          endingId,
          role: ep.episodeNumber === analysis.totalEstimatedEpisodes ? 'locks' : ep.episodeNumber === 1 ? 'opens' : 'reinforces',
          description: `${ep.title} keeps ${endingId} available through authored treatment choice pressure.`,
        }));
      }

      for (const [index, seed] of (guidance.consequenceSeeds || []).entries()) {
        const id = `treatment-chain-ep${ep.episodeNumber}-${index + 1}`;
        if (!merged.consequenceChains!.some((chain: any) => chain.id === id)) {
          merged.consequenceChains!.push({
            id,
            origin: { episodeNumber: ep.episodeNumber, description: seed },
            consequences: [
              {
                episodeNumber: Math.min(analysis.totalEstimatedEpisodes, ep.episodeNumber + 1),
                description: seed,
                severity: ep.episodeNumber + 1 >= analysis.totalEstimatedEpisodes ? 'dramatic' : 'noticeable',
              },
            ],
          });
        }
      }
    }

    for (const branch of analysis.treatmentBranches || []) {
      if (merged.crossEpisodeBranches!.some((existing: any) => existing.name === branch.name || existing.id === branch.id)) continue;
      const originEpisode = branch.originEpisode || 1;
      const reconvergenceEpisode = branch.reconvergenceEpisode || Math.min(analysis.totalEstimatedEpisodes, originEpisode + 2);
      const branchContracts = (analysis.branchConsequenceContracts || []).filter((contract) => contract.branchId === branch.id);
      const eligibilityEndingIds = Array.from(new Set(branchContracts.flatMap((contract) => contract.targetEndingIds || [])))
        .filter((endingId) => endingIds.includes(endingId));
      const pathVariants = (branch.pathVariants && branch.pathVariants.length > 0)
        ? branch.pathVariants
        : [{
            id: `${branch.id}-authored`,
            label: branch.name,
            conditionText: branch.createdBy || branch.summary,
            resultText: branch.laterEpisodeChange || branch.summary,
            stateChanges: branch.stateChanges || [],
            targetEndingIds: eligibilityEndingIds,
          }];
      merged.crossEpisodeBranches!.push({
        id: branch.id,
        name: branch.name,
        originEpisode,
        trigger: { type: 'story_choice', description: branch.createdBy || branch.summary },
        paths: pathVariants.map((variant) => ({
          id: variant.id,
          name: variant.label,
          condition: variant.conditionText,
          targetEndingIds: (variant.targetEndingIds?.length ? variant.targetEndingIds : eligibilityEndingIds).filter((endingId) => endingIds.includes(endingId)),
          affectedEpisodes: [
            {
              episodeNumber: reconvergenceEpisode,
              impact: 'major',
              description: variant.resultText || branch.laterEpisodeChange || branch.summary,
            },
          ],
        })),
        reconvergence: branch.reconvergenceEpisode ? {
          episodeNumber: reconvergenceEpisode,
          description: branch.reconvergenceResidue || `Authored treatment reconvergence for ${branch.name}.`,
        } : undefined,
      });
      for (const variant of pathVariants) {
        const flag = variant.id.replace(/-/g, '_');
        if (!merged.seasonFlags!.some((existing: any) => existing.flag === flag)) {
          merged.seasonFlags!.push({
            flag,
            description: [branch.name, variant.conditionText, variant.resultText, ...(variant.stateChanges || [])].filter(Boolean).join(' — '),
            setInEpisode: originEpisode,
            checkedInEpisodes: [reconvergenceEpisode],
          });
        }
      }
      const chainId = `${branch.id}-chain`;
      if (!merged.consequenceChains!.some((chain: any) => chain.id === chainId)) {
        merged.consequenceChains!.push({
          id: chainId,
          origin: { episodeNumber: originEpisode, description: branch.createdBy || branch.summary },
          consequences: [
            ...(branch.laterEpisodeChange ? [{ episodeNumber: reconvergenceEpisode, description: branch.laterEpisodeChange, severity: 'dramatic' }] : []),
            ...(branch.reconvergenceResidue ? [{ episodeNumber: reconvergenceEpisode, description: branch.reconvergenceResidue, severity: 'noticeable' }] : []),
          ],
        });
      }
      const choiceMomentId = `${branch.id}-choice`;
      if (!merged.choiceMoments!.some((moment: any) => moment.id === choiceMomentId)) {
        merged.choiceMoments!.push({
          id: choiceMomentId,
          episode: originEpisode,
          anchor: branch.createdBy || branch.summary,
          paysOffEpisode: reconvergenceEpisode,
          flag: pathVariants[0]?.id.replace(/-/g, '_') || branch.id.replace(/-/g, '_'),
        });
      }
    }

    return merged;
  }

  private inferEncounterType(text: string, genre: string): EncounterCategory {
    const lower = `${text} ${genre}`.toLowerCase();
    if (lower.includes('kiss') || lower.includes('romance') || lower.includes('bedroom')) return 'romantic';
    if (lower.includes('conversation') || lower.includes('confession') || lower.includes('friend')) return 'dramatic';
    if (lower.includes('club') || lower.includes('ball') || lower.includes('door')) return 'social';
    if (lower.includes('chase') || lower.includes('run')) return 'chase';
    if (lower.includes('investigat') || lower.includes('mystery')) return 'investigation';
    if (lower.includes('fight') || lower.includes('attack') || lower.includes('combat')) return 'combat';
    return 'dramatic';
  }

  private inferEncounterDifficulty(episodeNumber: number, totalEpisodes: number): PlannedEncounter['difficulty'] {
    const progress = episodeNumber / Math.max(1, totalEpisodes);
    if (progress >= 0.8) return 'extreme';
    if (progress >= 0.55) return 'hard';
    if (progress >= 0.25) return 'moderate';
    return 'easy';
  }

  private inferRelevantSkills(text: string): string[] {
    const lower = text.toLowerCase();
    const skills = new Set<string>();
    if (lower.includes('conversation') || lower.includes('club') || lower.includes('ball')) skills.add('persuasion');
    if (lower.includes('confession') || lower.includes('friend') || lower.includes('romance')) skills.add('empathy');
    if (lower.includes('attack') || lower.includes('fight') || lower.includes('run')) skills.add('athletics');
    if (lower.includes('mystery') || lower.includes('realiz') || lower.includes('reveal')) skills.add('perception');
    if (skills.size === 0) skills.add('resolve');
    return [...skills];
  }

  private buildSeasonPlan(
    analysis: SourceMaterialAnalysis,
    planData: Partial<SeasonPlan> & {
      episodeEncounters?: Record<number | string, any[]>;
      crossEpisodeBranches?: any[];
      consequenceChains?: any[];
      seasonFlags?: any[];
      residuePlan?: any[];
      difficultyCurve?: any[];
      episodeEndingRoutes?: Record<number | string, any[]>;
      episodeCliffhangers?: Record<number | string, Partial<CliffhangerPlan>>;
    },
    preferences?: SeasonPlannerInput['preferences']
  ): SeasonPlan {
    const now = new Date();
    const planId = `season-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const defaultStoryCircleDistribution = distributeStoryCircle(analysis.totalEstimatedEpisodes);
    const storyCircleRolesForEpisode = (episodeNumber: number): StoryCircleRoleAssignment[] => {
      const authored = analysis.episodeBreakdown.find((ep) => ep.episodeNumber === episodeNumber)?.storyCircleRole;
      if (authored?.length) return authored;
      return defaultStoryCircleDistribution.find((entry) => entry.episodeNumber === episodeNumber)?.storyCircleRole ?? [];
    };

    // Parse episode dependencies from LLM output or use defaults
    const dependenciesMap: Record<number, number[]> = 
      (planData as any).episodeDependencies || {};

    // Parse encounter data per episode
    const episodeEncountersMap: Record<number, PlannedEncounter[]> = {};
    const rawEncounters = planData.episodeEncounters || {};
    const episodeEndingRoutesMap: Record<number, SeasonEpisode['endingRoutes']> = {};
    const rawEndingRoutes = planData.episodeEndingRoutes || {};
    const episodeCliffhangerMap: Record<number, Partial<CliffhangerPlan>> = {};
    const rawCliffhangers = planData.episodeCliffhangers || {};
    for (const [epKey, encounters] of Object.entries(rawEncounters)) {
      const epNum = parseInt(String(epKey));
      if (!isNaN(epNum) && Array.isArray(encounters)) {
        const episodeStoryCircleRole = storyCircleRolesForEpisode(epNum);
        const episodeOutline = analysis.episodeBreakdown.find((ep) => ep.episodeNumber === epNum);
        episodeEncountersMap[epNum] = encounters.map((enc: any) => {
          const description = enc.description || 'Encounter';
          const storyCircleTarget = normalizeEncounterStoryCircleTarget(
            enc.storyCircleTarget,
            episodeStoryCircleRole,
            [
              description,
              enc.stakes,
              enc.centralConflict,
              enc.aftermathConsequence,
              episodeOutline?.narrativeFunction?.conflict,
              episodeOutline?.narrativeFunction?.resolution,
            ].filter(Boolean).join(' '),
          );
          return {
            id: enc.id || `enc-${epNum}-${Math.random().toString(36).substr(2, 6)}`,
            type: (enc.type || 'mixed') as EncounterCategory,
            description,
            difficulty: enc.difficulty || 'moderate',
            npcsInvolved: enc.npcsInvolved || [],
            stakes: enc.stakes || '',
            centralConflict: enc.centralConflict || undefined,
            storyCircleTarget,
            storyCircleTargetRationale: enc.storyCircleTargetRationale
              || buildEncounterStoryCircleTargetRationale(storyCircleTarget, episodeStoryCircleRole, description),
            storyCircleTargetEvidence: {
              episodeStoryCircleRole: Array.isArray(enc.storyCircleTargetEvidence?.episodeStoryCircleRole)
                ? enc.storyCircleTargetEvidence.episodeStoryCircleRole
                : episodeStoryCircleRole.map((role) => role.beat),
              episodeQuestion: enc.storyCircleTargetEvidence?.episodeQuestion
                || episodeOutline?.treatmentGuidance?.dramaticQuestion
                || episodeOutline?.narrativeFunction?.conflict
                || enc.centralConflict
                || enc.stakes
                || description,
              protagonistChange: enc.storyCircleTargetEvidence?.protagonistChange
                || episodeOutline?.treatmentGuidance?.endStateChange
                || episodeOutline?.narrativeFunction?.resolution
                || enc.aftermathConsequence
                || 'The encounter changes the protagonist\'s leverage, relationship pressure, or self-concept.',
              cliffhangerHandoff: enc.storyCircleTargetEvidence?.cliffhangerHandoff
                || (epNum < analysis.totalEstimatedEpisodes ? 'next_need' : 'none'),
            },
            aftermathConsequence: enc.aftermathConsequence || undefined,
            relevantSkills: enc.relevantSkills || [],
            encounterBuildup: enc.encounterBuildup || '',
            encounterSetupContext: Array.isArray(enc.encounterSetupContext) ? enc.encounterSetupContext : undefined,
            isBranchPoint: !!enc.isBranchPoint,
            branchOutcomes: enc.branchOutcomes || undefined,
          };
        });
      }
    }
    for (const [epKey, routes] of Object.entries(rawEndingRoutes)) {
      const epNum = parseInt(String(epKey));
      if (!isNaN(epNum) && Array.isArray(routes)) {
        episodeEndingRoutesMap[epNum] = routes
          .map((route: any) => {
            if (!route || typeof route !== 'object') return null;
            const role = route.role === 'opens' || route.role === 'reinforces' || route.role === 'threatens' || route.role === 'locks'
              ? route.role
              : 'reinforces';
            return {
              endingId: route.endingId || '',
              role,
              description: route.description || '',
            };
          })
          .filter(Boolean) as NonNullable<SeasonEpisode['endingRoutes']>;
      }
    }
    for (const [epKey, cliffhanger] of Object.entries(rawCliffhangers)) {
      const epNum = parseInt(String(epKey));
      if (!isNaN(epNum) && cliffhanger && typeof cliffhanger === 'object') {
        episodeCliffhangerMap[epNum] = cliffhanger as Partial<CliffhangerPlan>;
      }
    }

    // Parse cross-episode branches
    const crossEpisodeBranches: CrossEpisodeBranch[] = (planData.crossEpisodeBranches || []).map((branch: any) => ({
      id: branch.id || `branch-${Math.random().toString(36).substr(2, 6)}`,
      name: branch.name || 'Unnamed branch',
      originEpisode: branch.originEpisode || 1,
      trigger: {
        type: branch.trigger?.type || 'story_choice',
        description: branch.trigger?.description || '',
        sourceId: branch.trigger?.sourceId,
      },
      paths: (branch.paths || []).map((path: any) => ({
        id: path.id || `path-${Math.random().toString(36).substr(2, 6)}`,
        name: path.name || 'Unnamed path',
        condition: path.condition || '',
        targetEndingIds: Array.isArray(path.targetEndingIds)
          ? path.targetEndingIds.filter((endingId: unknown) => typeof endingId === 'string')
          : undefined,
        affectedEpisodes: (path.affectedEpisodes || []).map((ae: any) => ({
          episodeNumber: ae.episodeNumber,
          impact: ae.impact || 'moderate',
          description: ae.description || '',
        })),
      })),
      reconvergence: branch.reconvergence || undefined,
    }));

    // Parse consequence chains
    const consequenceChains: ConsequenceChain[] = (planData.consequenceChains || []).map((chain: any) => ({
      id: chain.id || `chain-${Math.random().toString(36).substr(2, 6)}`,
      origin: {
        episodeNumber: chain.origin?.episodeNumber || 1,
        description: chain.origin?.description || '',
        sourceId: chain.origin?.sourceId,
      },
      consequences: (chain.consequences || []).map((c: any) => ({
        episodeNumber: c.episodeNumber,
        description: c.description || '',
        severity: c.severity || 'noticeable',
      })),
    }));

    // Parse season flags
    const seasonFlags = (planData.seasonFlags || []).map((f: any) => ({
      flag: f.flag || '',
      description: f.description || '',
      setInEpisode: f.setInEpisode || 1,
      checkedInEpisodes: f.checkedInEpisodes || [],
    }));
    // Build difficulty curve
    const difficultyCurve = planData.difficultyCurve || analysis.episodeBreakdown.map((ep, idx) => {
      const progress = (idx + 1) / analysis.totalEstimatedEpisodes;
      let difficulty: string;
      if (progress <= 0.15) difficulty = 'introduction';
      else if (progress <= 0.45) difficulty = 'rising';
      else if (progress <= 0.7) difficulty = 'peak';
      else if (progress <= 0.85) difficulty = 'falling';
      else difficulty = 'finale';
      return {
        episodeNumber: ep.episodeNumber,
        difficulty,
        encounterCount: (episodeEncountersMap[ep.episodeNumber] || []).length || 1,
      };
    });

    // Calculate total encounter count
    let totalEncounters = 0;
    const typeDistribution: Record<string, number> = {};
    for (const encounters of Object.values(episodeEncountersMap)) {
      totalEncounters += encounters.length;
      for (const enc of encounters) {
        typeDistribution[enc.type] = (typeDistribution[enc.type] || 0) + 1;
      }
    }

    // Build the season's Story Circle map. Prefer authored/source analysis
    // assignments, then backfill the canonical season-long Story Circle.
    const storyCircleRoleByEpisode = new Map<number, StoryCircleRoleAssignment[]>();
    for (const entry of defaultStoryCircleDistribution) {
      storyCircleRoleByEpisode.set(
        entry.episodeNumber,
        entry.storyCircleRole.map((role) => ({ ...role })),
      );
    }
    for (const ep of analysis.episodeBreakdown) {
      if (ep.storyCircleRole && ep.storyCircleRole.length > 0) {
        storyCircleRoleByEpisode.set(ep.episodeNumber, ep.storyCircleRole.map((role) => ({ ...role })));
      }
    }

    // Missing Story Circle beats are assigned to the default distribution
    // episode instead of being discarded.
    backfillMissingStoryCircleBeats(storyCircleRoleByEpisode, defaultStoryCircleDistribution);

    // Build SeasonEpisode objects with encounter data
    const episodes: SeasonEpisode[] = analysis.episodeBreakdown.map(ep => {
      const canonEpisodeFact = analysis.sourceCanon?.facts.find((fact) =>
        fact.domain === 'episode'
        && fact.kind === 'episode_profile'
        && fact.subjectId === `episode-${ep.episodeNumber}`
      );
      const deps = dependenciesMap[ep.episodeNumber] || 
        (ep.episodeNumber > 1 ? [ep.episodeNumber - 1] : []);
      
      // Find characters introduced in this episode
      const introducesCharacters = analysis.majorCharacters
        .filter(c => c.firstAppearance === ep.episodeNumber)
        .map(c => c.id);

      // Find which episodes this sets up (episodes that depend on it)
      const setupsFor = Object.entries(dependenciesMap)
        .filter(([_, deps]) => deps.includes(ep.episodeNumber))
        .map(([epNum]) => parseInt(epNum));

      // Get encounter data for this episode
      const plannedEncounters = episodeEncountersMap[ep.episodeNumber] || [];
      // Get difficulty tier from curve
      const curveEntry = difficultyCurve.find((d: any) => d.episodeNumber === ep.episodeNumber);
      const difficultyTier = (curveEntry?.difficulty || 'rising') as 'introduction' | 'rising' | 'peak' | 'falling' | 'finale';

      // Find cross-episode branches that originate or affect this episode
      const outgoingBranches = crossEpisodeBranches
        .filter(b => b.originEpisode === ep.episodeNumber)
        .map(b => b.id);
      
      const incomingBranches = crossEpisodeBranches
        .filter(b => b.paths.some(p => 
          p.affectedEpisodes.some(ae => ae.episodeNumber === ep.episodeNumber)
        ))
        .map(b => b.id);

      // Find flags set/checked in this episode
      const setsFlags = seasonFlags
        .filter(f => f.setInEpisode === ep.episodeNumber)
        .map(f => ({ flag: f.flag, description: f.description }));
      
      const checksFlags = seasonFlags
        .filter(f => f.checkedInEpisodes.includes(ep.episodeNumber))
        .map(f => ({ flag: f.flag, ifTrue: f.description, ifFalse: `No ${f.flag}` }));

      const storyCircleRole = storyCircleRoleByEpisode.get(ep.episodeNumber)
        ?? ep.storyCircleRole
        ?? (defaultStoryCircleDistribution.find((e) => e.episodeNumber === ep.episodeNumber)?.storyCircleRole ?? []);
      const fallbackCliffhanger = buildDefaultCliffhangerPlan({
        episode: { ...ep, storyCircleRole },
        totalEpisodes: analysis.totalEstimatedEpisodes,
        seasonStakes: analysis.anchors?.stakes,
        nextEpisodeTitle: analysis.episodeBreakdown.find(e => e.episodeNumber === ep.episodeNumber + 1)?.title,
      });
      const cliffhangerPlan = normalizeCliffhangerPlan(
        episodeCliffhangerMap[ep.episodeNumber],
        fallbackCliffhanger,
      );
      const cliffhangerBeat = selectCliffhangerStoryCircleBeat(storyCircleRole, ep.episodeNumber);
      if (!cliffhangerPlan.storyCircleLaunchBeat && storyCircleRole.length > 0) {
        cliffhangerPlan.storyCircleLaunchBeat = storyCircleRole[storyCircleRole.length - 1]?.beat;
      }
      if (shouldForceHighIntensityHook(ep.episodeNumber, analysis.totalEstimatedEpisodes, cliffhangerBeat)) {
        cliffhangerPlan.intensity = 'high';
        if (cliffhangerPlan.type === 'mystery') {
          cliffhangerPlan.type = cliffhangerBeat === 'find' ? 'reframe' : 'emotional_hook';
        }
      }

      return {
        ...ep,
        canonEpisodeId: canonEpisodeFact?.id,
        derivedFromFactIds: canonEpisodeFact ? [canonEpisodeFact.id] : undefined,
        storyCircleRole,
        status: 'planned' as const,
        dependsOn: deps,
        setupsForEpisodes: setupsFor,
        resolvesPlotsFrom: deps.slice(0, -1),
        introducesCharacters,
        // New encounter planning fields
        plannedEncounters,
        difficultyTier,
        outgoingBranches: outgoingBranches.length > 0 ? outgoingBranches : undefined,
        incomingBranches: incomingBranches.length > 0 ? incomingBranches : undefined,
        setsFlags: setsFlags.length > 0 ? setsFlags : undefined,
        checksFlags: checksFlags.length > 0 ? checksFlags : undefined,
        endingRoutes: episodeEndingRoutesMap[ep.episodeNumber]?.length
          ? episodeEndingRoutesMap[ep.episodeNumber]
          : undefined,
        cliffhangerPlan,
      };
    });

    const routedEpisodes = episodes;

    // Build arcs from LLM output or source analysis. Each arc receives a
    // Story Circle span computed from the episode roles that fall inside its
    // episodeRange. Arcs are pressure movements inside the eight-beat spine,
    // not act buckets and not a parallel structural model.
    let arcs: SeasonArc[] = (planData.arcs || analysis.storyArcs.map(arc => ({
      id: arc.id,
      name: arc.name,
      description: arc.description,
      episodeRange: arc.estimatedEpisodeRange,
      keyMoments: [],
      status: 'not_started' as const,
      completionPercentage: 0,
    }))).map(arc => {
      const authoredArc = this.applyAuthoredArcGuidance(
        arc as Partial<SeasonArc>,
        findAuthoredArcGuidanceForArc(arc as Partial<SeasonArc>, analysis.treatmentSeasonGuidance),
        analysis.totalEstimatedEpisodes,
      );
      const episodeRange = authoredArc.episodeRange || { start: 1, end: analysis.totalEstimatedEpisodes };
      const storyCircleSpan = this.deriveArcStoryCircleSpan(episodeRange, storyCircleRoleByEpisode);
      const canonArcFact = analysis.sourceCanon?.facts.find((fact) => {
        if (fact.domain !== 'arc' || fact.kind !== 'arc') return false;
        const value = fact.value as { name?: string; episodeRange?: { start?: number; end?: number } } | undefined;
        return value?.name === authoredArc.name
          || (
            value?.episodeRange?.start === episodeRange.start
            && value?.episodeRange?.end === episodeRange.end
          );
      });
      return {
        ...authoredArc,
        id: authoredArc.id || `arc-${episodeRange.start}-${episodeRange.end}`,
        canonArcId: canonArcFact?.id,
        derivedFromFactIds: canonArcFact ? [canonArcFact.id] : authoredArc.derivedFromFactIds,
        name: authoredArc.name || `Arc ${episodeRange.start}-${episodeRange.end}`,
        description: authoredArc.description || `Episodes ${episodeRange.start}-${episodeRange.end}`,
        episodeRange,
        keyMoments: authoredArc.keyMoments || [],
        status: 'not_started' as const,
        completionPercentage: 0,
        storyCircleSpan,
        ...this.normalizeArcPressureArchitecture(authoredArc as SeasonArc, analysis, episodes, storyCircleSpan),
      };
    });
    const canonicalArcTopology = compileCanonicalSeasonArcTopology(analysis);
    if (canonicalArcTopology.length > 0) {
      this.assertAuthoredArcTopologyPreserved(arcs, canonicalArcTopology);
    } else {
      arcs = this.repairArcStoryCircleCoverage(arcs, analysis, episodes, storyCircleRoleByEpisode);
    }

	    const seasonPromiseArchitecture = this.normalizeSeasonPromiseArchitecture(
	      planData.seasonPromiseArchitecture,
	      analysis,
	      routedEpisodes,
	    );
	    const sourceTotalEpisodes = Math.max(
	      analysis.totalEstimatedEpisodes || 0,
	      episodes.length || 0,
	      routedEpisodes.length || 0,
	      1,
	    );
	    const seasonPromiseContracts = buildSeasonPromiseContracts({
	      guidance: analysis.treatmentSeasonGuidance,
	      architecture: seasonPromiseArchitecture,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentSeasonGuidance),
	    });
    const characterTreatmentContracts = analysis.characterTreatmentContracts ?? [];
    const worldTreatmentContracts = analysis.worldTreatmentContracts ?? [];
	    const stakesArchitectureContracts = analysis.stakesArchitectureContracts ?? buildStakesArchitectureContracts({
	      guidance: analysis.treatmentSeasonGuidance,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentSeasonGuidance?.stakesArchitecture),
	    });
    const storyCircleBeatContracts = analysis.storyCircleBeatContracts ?? buildStoryCircleBeatContracts({
	      guidance: analysis.treatmentSeasonGuidance,
	      storyCircle: analysis.storyCircle,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentSeasonGuidance?.seasonSpine),
	    });
    const arcPressureContracts = analysis.arcPressureContracts ?? buildArcPressureContracts({
	      guidance: analysis.treatmentSeasonGuidance,
	      arcs,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentSeasonGuidance?.arcGuidance?.arcs?.length),
	    });
	    const branchConsequenceContracts = analysis.branchConsequenceContracts ?? buildBranchConsequenceContracts({
	      branches: analysis.treatmentBranches,
	      endings: analysis.resolvedEndings,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentBranches?.length),
	    });
	    const endingRealizationContracts = analysis.endingRealizationContracts ?? buildEndingRealizationContracts({
	      endings: analysis.resolvedEndings,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || (analysis.resolvedEndings || []).some((ending) => ending.sourceConfidence === 'explicit'),
	      branchContracts: branchConsequenceContracts,
    });
	    const failureModeAuditContracts = analysis.failureModeAuditContracts ?? buildFailureModeAuditContracts({
	      guidance: analysis.treatmentSeasonGuidance,
	      totalEpisodes: sourceTotalEpisodes,
	      treatmentSourced: analysis.sourceFormat === 'story_treatment'
	        || analysis.treatmentMetadata?.detected
	        || Boolean(analysis.treatmentSeasonGuidance?.failureModeAuditGuidance),
	      linkedContracts: [
        characterTreatmentContracts,
        worldTreatmentContracts,
        stakesArchitectureContracts,
        storyCircleBeatContracts,
        arcPressureContracts,
        branchConsequenceContracts,
        endingRealizationContracts,
      ],
    });
    const informationLedger = this.normalizeInformationLedger(
      planData.informationLedger,
      analysis,
      routedEpisodes,
      seasonPromiseArchitecture,
    );

    // E1 slice 4: normalize the planner's season-level choice moments.
	    const choiceMoments = this.normalizeChoiceMoments(
	      (planData as any).choiceMoments,
	      sourceTotalEpisodes,
	    );
    const residuePlan = this.normalizeResiduePlan({
      raw: (planData as any).residuePlan,
      choiceMoments,
	      seasonFlags,
	      consequenceChains,
	      crossEpisodeBranches,
	      totalEpisodes: sourceTotalEpisodes,
	    });
    if (residuePlan?.length) {
      for (const episode of routedEpisodes) {
        const incoming = residuePlan
          .filter((obligation) =>
            obligation.sourceEpisodeNumber <= episode.episodeNumber &&
            obligation.targetEpisodeNumbers.includes(episode.episodeNumber)
          )
          .map((obligation) => obligation.id);
        const outgoing = residuePlan
          .filter((obligation) => obligation.sourceEpisodeNumber === episode.episodeNumber)
          .map((obligation) => obligation.id);
        if (incoming.length) episode.incomingResidueIds = incoming;
        if (outgoing.length) episode.outgoingResidueIds = outgoing;
      }
    }

    // Build character introductions
    const characterIntroductions = (planData as any).characterIntroductions || 
      analysis.majorCharacters.map(c => ({
        characterId: c.id,
        characterName: c.name,
        introducedInEpisode: c.firstAppearance,
        role: c.role,
      }));

    // Build location introductions
    const locationIntroductions = (planData as any).locationIntroductions ||
      analysis.keyLocations.map(loc => ({
        locationId: loc.id,
        locationName: loc.name,
        introducedInEpisode: loc.firstAppearance,
      }));

    const plan: SeasonPlan = {
      id: planId,
      sourceTitle: analysis.sourceTitle,
      sourceAuthor: analysis.sourceAuthor,
      sourceCanon: analysis.sourceCanon,
      canonLockManifest: analysis.canonLockManifest,
      createdAt: now,
      updatedAt: now,
      analysisVersion: analysis.analysisTimestamp?.toISOString() || now.toISOString(),
      seasonTitle: planData.seasonTitle || `${analysis.sourceTitle}: Season 1`,
	      seasonSynopsis: planData.seasonSynopsis || `An interactive adaptation spanning ${sourceTotalEpisodes} episodes.`,
	      totalEpisodes: sourceTotalEpisodes,
	      estimatedTotalDuration: `${sourceTotalEpisodes * 3}-${sourceTotalEpisodes * 8} minutes`,
      genre: analysis.genre,
      tone: analysis.tone,
      themes: analysis.themes,
      arcs,
      anchors: analysis.anchors,
      storyCircle: analysis.storyCircle ?? defaultStoryCircleFromAnchors(analysis.anchors),
      themeArgument: analysis.themeArgument,
      seasonPromiseArchitecture,
      seasonPromiseContracts,
      stakesArchitectureContracts,
      storyCircleBeatContracts,
      arcPressureContracts,
      branchConsequenceContracts,
      endingRealizationContracts,
      failureModeAuditContracts,
      characterTreatmentContracts,
      worldTreatmentContracts,
      informationLedger,
      choiceMoments,
      residuePlan,
      endingMode: preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single',
      resolvedEndings: analysis.resolvedEndings || [],
      episodes: routedEpisodes,
      progress: {
        selectedCount: 0,
        completedCount: 0,
        inProgressCount: 0,
        percentComplete: 0,
        nextRecommendedEpisode: 1,
      },
      protagonist: analysis.protagonist,
      characterArchitecture: analysis.characterArchitecture,
      characterIntroductions,
      locationIntroductions,
      // New encounter master plan
      encounterPlan: {
        totalEncounters,
        difficultyCurve: difficultyCurve.map((d: any) => ({
          episodeNumber: d.episodeNumber,
          difficulty: d.difficulty,
          encounterCount: d.encounterCount,
        })),
        typeDistribution,
      },
      // New cross-episode branching
      crossEpisodeBranches,
      consequenceChains,
      seasonFlags,
      preferences: {
        targetScenesPerEpisode: clampSceneCount(preferences?.targetScenesPerEpisode || 6),
        targetChoicesPerEpisode: preferences?.targetChoicesPerEpisode || 3,
        pacing: preferences?.pacing || 'moderate',
      },
      warnings: this.validateEndingPlan({
        warnings: analysis.warnings || [],
        endingMode: preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single',
        resolvedEndingCount: (analysis.resolvedEndings || []).length,
        episodes: routedEpisodes,
        crossEpisodeBranches,
      }),
      notes: [],
    };

    // Run the Story Circle coverage validator. Issues are accumulated into
    // plan.warnings here for the diagnostics trail; the actual BLOCKING
    // enforcement happens in execute() after the plan is built.
    const coverageResult = new StoryCircleCoverageValidator().validate(
      seasonPlanToStoryCircleCoverageInput(plan),
    );
    for (const warning of this.validateTreatmentHandoff(analysis, plan)) {
      plan.warnings.push(warning);
    }
    for (const issue of coverageResult.issues) {
      plan.warnings.push(`[StoryCircleCoverage:${issue.severity}] ${issue.message}`);
    }
    const arcPressureResult = new ArcPressureArchitectureValidator().validate(plan, {
      treatmentSourced: arcPressureContracts.some((contract) => contract.source === 'treatment'),
      arcPressureContracts,
    });
    for (const issue of arcPressureResult.issues) {
      plan.warnings.push(`[ArcPressure:${issue.severity}] ${issue.message}`);
    }
    const characterArchitectureResult = new CharacterArchitectureValidator().validate({
      characterArchitecture: plan.characterArchitecture,
      plan,
    });
    for (const issue of characterArchitectureResult.issues) {
      plan.warnings.push(`[CharacterArchitecture:${issue.severity}] ${issue.message}`);
    }
    const seasonPromiseResult = new SeasonPromiseValidator().validate(plan);
    for (const issue of seasonPromiseResult.issues) {
      plan.warnings.push(`[SeasonPromise:${issue.severity}] ${issue.message}`);
    }
    const informationResult = new InformationLedgerValidator().validate(plan);
    for (const issue of informationResult.issues) {
      plan.warnings.push(`[InformationLedger:${issue.severity}] ${issue.message}`);
    }

    // Scene-first planning: enumerate scenes (encounters included) at the season
    // level and attach the spine to the plan + each episode's slice.
    if (isSceneFirstPlanningEnabled()) {
      // Unify the downstream input: from-scratch episodes get treatment-shaped
      // guidance synthesized so the scene builder sees one shape on both paths.
      synthesizeTreatmentGuidance(plan);
      const scenePlan = buildSeasonScenePlan(plan);
      plan.scenePlan = scenePlan;
      for (const ep of plan.episodes) {
        ep.plannedScenes = scenesForEpisode(scenePlan, ep.episodeNumber);
      }
      const spineResult = new SceneSpineValidator().validate(scenePlan);
      for (const issue of spineResult.issues) {
        plan.warnings.push(`[SceneSpine:${issue.severity}] ${issue.message}`);
      }
      plan.notes.push(
        `Scene-first planning: ${scenePlan.scenes.length} scenes across ${plan.episodes.length} episodes, ${scenePlan.setupPayoffEdges.length} setup/payoff edges.`,
      );
      const deferredEpisodePlans = Object.values(scenePlan.episodeEventPlans ?? {})
        .filter((eventPlan) => !eventPlan.validation.passed);
      if (deferredEpisodePlans.length > 0) {
        plan.warnings.push(
          `[EpisodeEventPlanDeferred] Detailed scene executability remains unresolved for episode(s) ${deferredEpisodePlans.map((eventPlan) => eventPlan.episodeNumber).join(', ')}. Those episodes will block if selected; season event identity and cross-episode dependencies remain valid.`,
        );
        plan.notes.push(
          `Deferred episode-plan diagnostics: ${deferredEpisodePlans.flatMap((eventPlan) => eventPlan.validation.issues.map((issue) => `ep${eventPlan.episodeNumber}:${issue.code}`)).join(', ')}.`,
        );
      }
    }

    return plan;
  }

  /**
   * Normalize first-class planned residue. The LLM may emit explicit obligations,
   * but the deterministic floor is every flagged choiceMoment and seasonFlag.
   */
  private normalizeResiduePlan(params: {
    raw: unknown;
    choiceMoments?: SeasonChoiceMomentSeed[];
    seasonFlags: Array<{ flag: string; description: string; setInEpisode: number; checkedInEpisodes: number[] }>;
    consequenceChains: ConsequenceChain[];
    crossEpisodeBranches: CrossEpisodeBranch[];
    totalEpisodes: number;
  }): SeasonResidueObligation[] | undefined {
    const maxEp = Math.max(1, params.totalEpisodes);
    const clamp = (n: number) => Math.min(maxEp, Math.max(1, Math.floor(n)));
    const out = new Map<string, SeasonResidueObligation>();
    const note = (rawObligation: Partial<SeasonResidueObligation> & { id?: string; flag?: string }): void => {
      const flag = typeof rawObligation.flag === 'string' ? rawObligation.flag.trim() : '';
      if (!flag) return;
      const sourceEpisodeNumber = clamp(Number(rawObligation.sourceEpisodeNumber) || 1);
      const kind = this.normalizeResidueKind(rawObligation.kind);
      if (!this.isAllowedResidueFlag(flag, kind)) return;
      const targets = Array.from(new Set((rawObligation.targetEpisodeNumbers || [])
        .map((target) => clamp(Number(target)))
        .filter((target) => target >= sourceEpisodeNumber)));
      const payoffPolicy = this.normalizeResiduePayoffPolicy(rawObligation.payoffPolicy, sourceEpisodeNumber, targets);
      if (payoffPolicy !== 'terminal_slice_ok' && targets.length === 0) return;
      const idBase = rawObligation.id || `residue-${sourceEpisodeNumber}-${flag}`;
      let id = idBase.replace(/[^a-zA-Z0-9:_-]+/g, '-');
      let suffix = 2;
      while (out.has(id)) id = `${idBase}-${suffix++}`;
      out.set(id, {
        id,
        source: rawObligation.source || 'deterministic_fallback',
        sourceEpisodeNumber,
        sourceSceneId: rawObligation.sourceSceneId,
        sourceChoiceMomentId: rawObligation.sourceChoiceMomentId,
        choiceAnchor: rawObligation.choiceAnchor || rawObligation.sourceMaterial?.choiceText || rawObligation.authoringGuidance || flag,
        flag,
        conditionKey: rawObligation.conditionKey || flag,
        kind,
        consequenceDomain: rawObligation.consequenceDomain,
        payoffPolicy,
        targetEpisodeNumbers: targets,
        targetSceneIds: rawObligation.targetSceneIds?.filter(Boolean),
        targetNpcIds: rawObligation.targetNpcIds?.filter(Boolean),
        targetTopics: rawObligation.targetTopics?.filter(Boolean),
        treatmentContractIds: rawObligation.treatmentContractIds?.filter(Boolean),
        sourceMaterial: {
          choiceText: rawObligation.sourceMaterial?.choiceText,
          reminderImmediate: rawObligation.sourceMaterial?.reminderImmediate,
          reminderShortTerm: rawObligation.sourceMaterial?.reminderShortTerm,
          reminderLater: rawObligation.sourceMaterial?.reminderLater,
          feedbackEcho: rawObligation.sourceMaterial?.feedbackEcho,
          feedbackProgress: rawObligation.sourceMaterial?.feedbackProgress,
          residueHints: rawObligation.sourceMaterial?.residueHints?.filter(Boolean),
          witnessReactions: rawObligation.sourceMaterial?.witnessReactions?.filter(Boolean),
        },
        authoringGuidance: rawObligation.authoringGuidance || rawObligation.choiceAnchor || rawObligation.sourceMaterial?.reminderShortTerm || '',
        requiredSurface: rawObligation.requiredSurface?.length ? rawObligation.requiredSurface : ['text_variant'],
        priority: rawObligation.priority || (kind === 'branch_reconvergence' || kind === 'ending_eligibility' ? 'major' : 'moderate'),
      });
    };

    if (Array.isArray(params.raw)) {
      for (const raw of params.raw) {
        if (raw && typeof raw === 'object') note(raw as Partial<SeasonResidueObligation>);
      }
    }

    for (const moment of params.choiceMoments || []) {
      if (!moment.flag) continue;
      const target = moment.paysOffEpisode && moment.paysOffEpisode > moment.episode
        ? [moment.paysOffEpisode]
        : [moment.episode];
      note({
        id: `choice:${moment.id}`,
        source: 'choice_moment',
        sourceEpisodeNumber: moment.episode,
        sourceChoiceMomentId: moment.id,
        choiceAnchor: moment.anchor,
        flag: moment.flag,
        conditionKey: moment.flag,
        kind: 'callback_line',
        payoffPolicy: moment.paysOffEpisode && moment.paysOffEpisode > moment.episode ? 'specific_episode' : 'later_scene_same_episode',
        targetEpisodeNumbers: target,
        sourceMaterial: {
          choiceText: moment.anchor,
          reminderImmediate: moment.anchor,
          reminderShortTerm: moment.anchor,
          feedbackEcho: moment.anchor,
          residueHints: [moment.anchor],
        },
        authoringGuidance: moment.anchor,
        requiredSurface: ['text_variant'],
        priority: moment.paysOffEpisode && moment.paysOffEpisode > moment.episode ? 'major' : 'moderate',
      });
    }

    for (const flagEntry of params.seasonFlags || []) {
      if (!flagEntry.flag || out.has(`season-flag:${flagEntry.flag}`)) continue;
      const targets = (flagEntry.checkedInEpisodes || []).filter((ep) => ep >= flagEntry.setInEpisode);
      if (!targets.length) continue;
      note({
        id: `season-flag:${flagEntry.flag}`,
        source: 'season_planner',
        sourceEpisodeNumber: flagEntry.setInEpisode,
        choiceAnchor: flagEntry.description || flagEntry.flag,
        flag: flagEntry.flag,
        conditionKey: flagEntry.flag,
        kind: this.isBranchOrEndingResidueFlag(flagEntry.flag) ? 'branch_reconvergence' : 'callback_line',
        payoffPolicy: targets.length === 1 ? 'specific_episode' : 'episode_window',
        targetEpisodeNumbers: targets,
        sourceMaterial: {
          reminderImmediate: flagEntry.description,
          reminderShortTerm: flagEntry.description,
          feedbackEcho: flagEntry.description,
          residueHints: flagEntry.description ? [flagEntry.description] : [],
        },
        authoringGuidance: flagEntry.description || `Pay off ${flagEntry.flag} in reader-facing prose.`,
        requiredSurface: ['text_variant'],
        priority: targets.some((target) => target > flagEntry.setInEpisode) ? 'major' : 'moderate',
      });
    }

    for (const chain of params.consequenceChains || []) {
      const originEp = clamp(chain.origin?.episodeNumber || 1);
      const slug = String(chain.id || chain.origin?.sourceId || `chain-${originEp}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const flag = `consequence_${slug}`;
      if (!flag) continue;
      note({
        id: `chain:${chain.id || flag}`,
        source: 'consequence_chain',
        sourceEpisodeNumber: originEp,
        choiceAnchor: chain.origin?.description || chain.id || flag,
        flag,
        conditionKey: flag,
        kind: 'failure_residue',
        payoffPolicy: 'episode_window',
        targetEpisodeNumbers: (chain.consequences || []).map((c) => c.episodeNumber).filter((ep) => ep >= originEp),
        sourceMaterial: {
          reminderImmediate: chain.origin?.description,
          reminderShortTerm: chain.consequences?.[0]?.description,
          feedbackEcho: chain.consequences?.[0]?.description,
          residueHints: (chain.consequences || []).map((c) => c.description).filter(Boolean),
        },
        authoringGuidance: chain.consequences?.[0]?.description || chain.origin?.description || '',
        requiredSurface: ['text_variant'],
        priority: 'major',
      });
    }

    return out.size > 0 ? [...out.values()] : undefined;
  }

  private normalizeResidueKind(kind: unknown): ResidueObligationKind {
    const allowed: ResidueObligationKind[] = [
      'callback_line',
      'relationship_behavior',
      'information_recall',
      'item_or_prop',
      'reputation',
      'danger',
      'identity',
      'branch_reconvergence',
      'failure_residue',
      'ending_eligibility',
    ];
    return allowed.includes(kind as ResidueObligationKind) ? kind as ResidueObligationKind : 'callback_line';
  }

  private normalizeResiduePayoffPolicy(
    policy: unknown,
    sourceEpisodeNumber: number,
    targetEpisodeNumbers: number[],
  ): ResiduePayoffPolicy {
    const allowed: ResiduePayoffPolicy[] = [
      'same_scene',
      'later_scene_same_episode',
      'specific_episode',
      'episode_window',
      'terminal_slice_ok',
    ];
    if (allowed.includes(policy as ResiduePayoffPolicy)) return policy as ResiduePayoffPolicy;
    if (targetEpisodeNumbers.length === 0) return 'terminal_slice_ok';
    if (targetEpisodeNumbers.length === 1 && targetEpisodeNumbers[0] > sourceEpisodeNumber) return 'specific_episode';
    if (targetEpisodeNumbers.every((target) => target === sourceEpisodeNumber)) return 'later_scene_same_episode';
    return 'episode_window';
  }

  private isAllowedResidueFlag(flag: string, kind: ResidueObligationKind): boolean {
    if (/^tint:/.test(flag)) return false;
    if (this.isBranchOrEndingResidueFlag(flag)) {
      return kind === 'branch_reconvergence' || kind === 'ending_eligibility';
    }
    if (/^encounter[_.]/.test(flag)) return false;
    return /^[a-z0-9_:-]+$/.test(flag);
  }

  private isBranchOrEndingResidueFlag(flag: string): boolean {
    return /^route_/.test(flag) || /^treatment_branch_/.test(flag);
  }

  /**
   * E1 slice 4: normalize planner-emitted choice moments. Drops malformed entries,
   * clamps episodes to the valid range, de-dupes ids, drops a later-payoff target that
   * isn't actually later (→ immediate), and only keeps a snake_case flag. Returns
   * undefined when nothing valid remains (consumer falls back to deterministic derivation).
   */
  private normalizeChoiceMoments(
    raw: unknown,
    totalEpisodes: number,
  ): SeasonChoiceMomentSeed[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const maxEp = Math.max(1, totalEpisodes);
    const clamp = (n: number) => Math.min(maxEp, Math.max(1, Math.floor(n)));
    const seen = new Set<string>();
    const out: SeasonChoiceMomentSeed[] = [];
    for (const [idx, entry] of raw.entries()) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const anchor = typeof e.anchor === 'string' ? e.anchor.trim() : '';
      if (!anchor || typeof e.episode !== 'number') continue;
      const episode = clamp(e.episode);
      let id = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `cm-${episode}-${idx}`;
      while (seen.has(id)) id = `${id}-${idx}`;
      seen.add(id);
      const moment: SeasonChoiceMomentSeed = { id, episode, anchor };
      if (typeof e.paysOffEpisode === 'number') {
        const payoff = clamp(e.paysOffEpisode);
        if (payoff > episode) moment.paysOffEpisode = payoff; // only keep genuine later payoffs
      }
      if (typeof e.flag === 'string' && /^[a-z0-9_]+$/.test(e.flag)) moment.flag = e.flag;
      out.push(moment);
    }
    return out.length > 0 ? out : undefined;
  }

  private normalizeInformationLedger(
    rawEntries: any[] | undefined,
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
    seasonPromise: SeasonPromiseArchitecture,
  ): InformationLedgerEntry[] {
    const totalEpisodes = Math.max(1, episodes.length || analysis.totalEstimatedEpisodes);
    const finaleEpisode = episodes[episodes.length - 1]?.episodeNumber || totalEpisodes;
    const targetRunway = 3;
    const fallbackTouch = Math.max(1, finaleEpisode - targetRunway);
    const normalizedRaw = Array.isArray(rawEntries)
      ? rawEntries.map((entry, index) => this.normalizeInformationLedgerEntry(entry, index, totalEpisodes))
      : [];
    const authoredEntries = authoredInformationLedgerEntries(analysis, totalEpisodes);

    const fallbackEntries: InformationLedgerEntry[] = [
      {
        id: 'info-season-central-pressure',
        label: 'Season central pressure',
        description: seasonPromise.centralPressure.description,
        audienceKnowledgeState: 'shared',
        tensionMode: 'suspense',
        knownBy: ['player', 'protagonist'],
        withheldFrom: [],
        introducedEpisode: 1,
        plannedRevealEpisode: undefined,
        plannedPayoffEpisode: finaleEpisode,
        setupTouchEpisodes: Array.from(new Set([1, fallbackTouch])).filter((episode) => episode < finaleEpisode),
        payoffPlan: seasonPromise.seasonCompleteness.resolvedQuestion,
        isBoxQuestion: false,
        closesQuestionIds: [],
        opensQuestionIds: [],
      },
    ];

    for (const arc of analysis.storyArcs.slice(0, 3)) {
      const range = arc.estimatedEpisodeRange;
      const midpoint = this.clampEpisode(this.episodeAtArcRatio(range.start, range.end, 0.5), range.start, range.end);
      fallbackEntries.push({
        id: `info-${arc.id || arc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-reframe`,
        label: `${arc.name} reframe`,
        description: arc.description,
        audienceKnowledgeState: 'selective',
        tensionMode: 'revelation',
        knownBy: ['player', 'protagonist'],
        withheldFrom: ['ally', 'antagonist'],
        introducedEpisode: Math.max(1, range.start),
        plannedRevealEpisode: midpoint,
        plannedPayoffEpisode: Math.min(finaleEpisode, range.end),
        setupTouchEpisodes: Array.from(new Set([range.start, Math.max(range.start, midpoint - 1)])).filter((episode) => episode < midpoint),
        payoffPlan: `The ${arc.name} information changes what the protagonist can choose before the arc resolves.`,
        isBoxQuestion: false,
        closesQuestionIds: [],
        opensQuestionIds: [],
      });
    }

    const byId = new Map<string, InformationLedgerEntry>();
    for (const entry of [...mergeAuthoredInformationLedger(normalizedRaw, authoredEntries), ...fallbackEntries]) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    const entries = [...byId.values()];
    let mysteryCount = 0;
    return entries.map((entry) => {
      if (entry.tensionMode === 'mystery' || entry.isBoxQuestion) {
        mysteryCount += 1;
        if (mysteryCount > 3) {
          return {
            ...entry,
            tensionMode: 'suspense' as const,
            isBoxQuestion: false,
            audienceKnowledgeState: entry.audienceKnowledgeState === 'withheld' ? 'selective' : entry.audienceKnowledgeState,
          };
        }
      }
      return entry;
    });
  }

  private normalizeInformationLedgerEntry(
    raw: any,
    index: number,
    totalEpisodes: number,
  ): InformationLedgerEntry {
    const introducedEpisode = this.clampEpisode(Number(raw?.introducedEpisode) || 1, 1, totalEpisodes);
    const reveal = Number(raw?.plannedRevealEpisode) || undefined;
    const payoff = Number(raw?.plannedPayoffEpisode) || reveal || totalEpisodes;
    const setupTouchEpisodes = Array.isArray(raw?.setupTouchEpisodes)
      ? raw.setupTouchEpisodes
          .map((episode: unknown) => this.clampEpisode(Number(episode) || introducedEpisode, 1, totalEpisodes))
          .filter((episode: number) => episode <= (payoff || totalEpisodes))
      : [introducedEpisode];
    return {
      id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `info-${index + 1}`,
      label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : `Information ${index + 1}`,
      description: typeof raw?.description === 'string' ? raw.description : '',
      audienceKnowledgeState: this.normalizeAudienceKnowledgeState(raw?.audienceKnowledgeState),
      tensionMode: this.normalizeInformationTensionMode(raw?.tensionMode),
      knownBy: this.normalizeKnowledgeHolders(raw?.knownBy, ['player']),
      withheldFrom: this.normalizeKnowledgeHolders(raw?.withheldFrom, []),
      introducedEpisode,
      plannedRevealEpisode: reveal ? this.clampEpisode(reveal, introducedEpisode, totalEpisodes) : undefined,
      plannedPayoffEpisode: payoff ? this.clampEpisode(payoff, introducedEpisode, totalEpisodes) : undefined,
      setupTouchEpisodes: Array.from(new Set(setupTouchEpisodes)),
      payoffPlan: typeof raw?.payoffPlan === 'string' ? raw.payoffPlan : '',
      isBoxQuestion: Boolean(raw?.isBoxQuestion || raw?.tensionMode === 'mystery'),
      closesQuestionIds: Array.isArray(raw?.closesQuestionIds) ? raw.closesQuestionIds.filter((id: unknown): id is string => typeof id === 'string') : [],
      opensQuestionIds: Array.isArray(raw?.opensQuestionIds) ? raw.opensQuestionIds.filter((id: unknown): id is string => typeof id === 'string') : [],
      sourceText: typeof raw?.sourceText === 'string' ? raw.sourceText : undefined,
      authoredId: typeof raw?.authoredId === 'string' ? raw.authoredId : undefined,
      factualAtoms: Array.isArray(raw?.factualAtoms) ? raw.factualAtoms : undefined,
      namedKnowledge: raw?.namedKnowledge && typeof raw.namedKnowledge === 'object' ? raw.namedKnowledge : undefined,
      knowledgePhases: Array.isArray(raw?.knowledgePhases) ? raw.knowledgePhases : undefined,
      setupTouchDetails: Array.isArray(raw?.setupTouchDetails) ? raw.setupTouchDetails : undefined,
    };
  }

  private normalizeAudienceKnowledgeState(value: unknown): AudienceKnowledgeState {
    return value === 'shared' || value === 'withheld' || value === 'selective' ? value : 'shared';
  }

  private normalizeInformationTensionMode(value: unknown): InformationTensionMode {
    return value === 'suspense' ||
      value === 'mystery' ||
      value === 'dramatic_irony' ||
      value === 'surprise' ||
      value === 'revelation' ||
      value === 'foreshadowing'
      ? value
      : 'suspense';
  }

  private normalizeKnowledgeHolders(value: unknown, fallback: InformationKnowledgeHolder[]): InformationKnowledgeHolder[] {
    const allowed: InformationKnowledgeHolder[] = ['player', 'protagonist', 'ally', 'antagonist', 'world'];
    if (!Array.isArray(value)) return fallback;
    const normalized = value.filter((holder): holder is InformationKnowledgeHolder => allowed.includes(holder as InformationKnowledgeHolder));
    return normalized.length > 0 ? normalized : fallback;
  }

  private normalizeSeasonPromiseArchitecture(
    raw: Partial<SeasonPromiseArchitecture> | undefined,
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
  ): SeasonPromiseArchitecture {
    const protagonist = analysis.protagonist;
    const character = analysis.characterArchitecture?.protagonist;
    const lie = character?.lie || protagonist.arc || 'the identity pressure driving the protagonist';
    const truth = character?.truth || protagonist.arc || 'a changed way of acting';
    const goal = analysis.anchors?.goal || 'the season goal';
    const stakes = analysis.anchors?.stakes || 'what matters most';
    const firstEpisode = episodes[0];
    const finale = episodes[episodes.length - 1];
    const rawCentral = raw?.centralPressure;
    const rawPromise = raw?.seasonPromise;
    const rawCompleteness = raw?.seasonCompleteness;

    return {
      seasonDramaticQuestion: this.cleanSeasonPromiseText(
        raw?.seasonDramaticQuestion,
        `Can ${protagonist.name} pursue ${goal} without being ruled by ${lie}?`,
      ),
      centralPressure: {
        type: this.normalizeSeasonCentralPressureType(rawCentral?.type),
        description: this.cleanSeasonPromiseText(
          rawCentral?.description,
          `${goal} collides with ${stakes}, forcing ${protagonist.name}'s identity pressure into the open.`,
        ),
        pressuresLieBy: this.cleanSeasonPromiseText(
          rawCentral?.pressuresLieBy,
          `It makes ${lie} increasingly costly and makes ${truth} harder to avoid.`,
        ),
      },
      seasonPromise: {
        premisePromise: this.cleanSeasonPromiseText(
          rawPromise?.premisePromise,
          firstEpisode?.synopsis || `The opening promises ${analysis.genre} pressure around ${goal}.`,
        ),
        playerExperiencePromise: this.cleanSeasonPromiseText(
          rawPromise?.playerExperiencePromise,
          `The player shapes ${protagonist.name}'s choices through risk, relationships, information, and identity pressure.`,
        ),
        emotionalPromise: this.cleanSeasonPromiseText(
          rawPromise?.emotionalPromise,
          `A ${analysis.tone} season where choices leave visible cost and residue.`,
        ),
        variationPlan: Array.isArray(rawPromise?.variationPlan) && rawPromise!.variationPlan!.length > 0
          ? rawPromise!.variationPlan!.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : episodes.slice(0, 5).map((episode) =>
              `Episode ${episode.episodeNumber} varies the promise through ${episode.narrativeFunction?.conflict || episode.synopsis}.`
            ),
      },
      seasonCompleteness: {
        resolvedQuestion: this.cleanSeasonPromiseText(
          rawCompleteness?.resolvedQuestion,
          finale?.narrativeFunction?.resolution || `The finale answers whether ${protagonist.name} can act beyond ${lie}.`,
        ),
        resolvedStakes: this.cleanSeasonPromiseText(
          rawCompleteness?.resolvedStakes,
          `The season shows what happened to ${stakes}.`,
        ),
        characterStateChange: this.cleanSeasonPromiseText(
          rawCompleteness?.characterStateChange,
          `By season end, ${protagonist.name} is changed by the pressure between ${lie} and ${truth}.`,
        ),
        openFuturePressure: this.cleanSeasonPromiseText(rawCompleteness?.openFuturePressure, ''),
      },
    };
  }

  private normalizeSeasonCentralPressureType(value: unknown): SeasonCentralPressureType {
    return value === 'person' ||
      value === 'institution' ||
      value === 'mystery' ||
      value === 'environment' ||
      value === 'relationship' ||
      value === 'internal' ||
      value === 'situation'
      ? value
      : 'situation';
  }

  private cleanSeasonPromiseText(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  }

  private applyAuthoredArcGuidance(
    rawArc: Partial<SeasonArc>,
    guidance: NonNullable<TreatmentSeasonGuidance['arcGuidance']>['arcs'][number] | undefined,
    totalEpisodes: number,
  ): Partial<SeasonArc> {
    if (!guidance) return rawArc;
    const range = guidance.episodeRange
      ? {
        start: Math.max(1, Math.min(totalEpisodes, guidance.episodeRange.start)),
        end: Math.max(guidance.episodeRange.start, Math.min(totalEpisodes, guidance.episodeRange.end)),
      }
      : rawArc.episodeRange;
    const midpointEpisode = range
      ? Math.max(range.start, Math.min(range.end, Math.round((range.start + range.end) / 2)))
      : rawArc.midpointRecontextualization?.episodeNumber;
    const crisisEpisode = range
      ? Math.max(range.start, Math.min(range.end, Math.ceil(range.start + Math.max(1, range.end - range.start) * (2 / 3))))
      : rawArc.lateArcCrisis?.episodeNumber;
    // Same shared-predicate discipline as normalizeArcEpisodeTurnouts: a
    // placeholder-valued description ("TBD"/"none") must not shadow the real
    // authored sourceText, or the ArcPressure gate rejects the field this
    // merge claims to have filled (r119 defect class).
    const substantiveOrUndefined = (value: string | undefined): string | undefined =>
      hasSubstantiveArcText(value) ? value : undefined;
    const turnouts = guidance.episodeTurnouts?.map((turnout) => ({
      episodeNumber: turnout.episodeNumber,
      turnType: this.normalizeAuthoredArcTurnoutType(turnout.turnType),
      description: substantiveOrUndefined(turnout.description) ?? turnout.sourceText,
      leavesProtagonistWith: substantiveOrUndefined(turnout.description) ?? turnout.sourceText,
      whyThisCannotMoveLater: `Authored turnout from the treatment for Episode ${turnout.episodeNumber}: ${turnout.sourceText}`,
    })) as ArcEpisodeTurnout[] | undefined;
    return {
      ...rawArc,
      id: rawArc.id || `arc-${guidance.arcIndex}`,
      name: guidance.title || rawArc.name,
      description: guidance.arcDramaticQuestion || rawArc.description || guidance.sourceText,
      episodeRange: range,
      arcQuestion: guidance.arcDramaticQuestion || rawArc.arcQuestion,
      seasonQuestionRelation: guidance.relationToSeasonQuestion || rawArc.seasonQuestionRelation,
      identityPressureFacet: guidance.lieFacet || rawArc.identityPressureFacet,
      midpointRecontextualization: guidance.midpointRecontextualization
        ? {
          episodeNumber: midpointEpisode || rawArc.midpointRecontextualization?.episodeNumber || 1,
          questionBefore: rawArc.midpointRecontextualization?.questionBefore || `Before the arc midpoint, ${guidance.title} appears to be one kind of pressure.`,
          questionAfter: rawArc.midpointRecontextualization?.questionAfter || `After the arc midpoint, ${guidance.title} is recontextualized by the authored reveal.`,
          description: guidance.midpointRecontextualization,
        }
        : rawArc.midpointRecontextualization,
      lateArcCrisis: guidance.lateArcCrisis
        ? {
          episodeNumber: crisisEpisode || rawArc.lateArcCrisis?.episodeNumber || range?.end || 1,
          apparentFailure: rawArc.lateArcCrisis?.apparentFailure || guidance.lateArcCrisis,
          irreversibleCost: rawArc.lateArcCrisis?.irreversibleCost || guidance.lateArcCrisis,
          description: guidance.lateArcCrisis,
        }
        : rawArc.lateArcCrisis,
      finaleAnswer: guidance.finaleAnswer || rawArc.finaleAnswer,
      handoffPressure: guidance.handoffPressure || rawArc.handoffPressure,
      episodeTurnouts: turnouts?.length ? turnouts : rawArc.episodeTurnouts,
    };
  }

  private normalizeAuthoredArcTurnoutType(value: unknown): ArcEpisodeTurnoutType {
    const text = typeof value === 'string' ? value : '';
    if (text === 'setup' || text === 'escalation' || text === 'reversal' || text === 'revelation'
      || text === 'cost' || text === 'choice' || text === 'recontextualization' || text === 'crisis'
      || text === 'finale' || text === 'handoff') {
      return text;
    }
    return 'escalation';
  }

  private assertAuthoredArcTopologyPreserved(
    arcs: SeasonArc[],
    canonical: CanonicalSeasonArcSkeleton[],
  ): void {
    const actualById = new Map(arcs.map((arc) => [arc.id, arc]));
    const issueCodes: string[] = [];
    for (const expected of canonical) {
      const actual = actualById.get(expected.id);
      if (!actual) {
        issueCodes.push(`authored_arc_missing:${expected.id}`);
        continue;
      }
      if (
        actual.name !== expected.name
        || actual.episodeRange.start !== expected.episodeRange.start
        || actual.episodeRange.end !== expected.episodeRange.end
      ) {
        issueCodes.push(`authored_arc_identity_drift:${expected.id}`);
      }
    }
    for (const actual of arcs) {
      if (!canonical.some((expected) => expected.id === actual.id)) {
        issueCodes.push(`unknown_arc_present:${actual.id}`);
      }
    }
    if (issueCodes.length === 0) return;

    throw new PipelineError(
      `[SeasonPlanTopology] Authored arc topology changed during SeasonPlan normalization: ${issueCodes.join(', ')}.`,
      'season_plan',
      {
        agent: 'SeasonPlanner',
        context: {
          expected: canonical.map((arc) => ({ id: arc.id, name: arc.name, episodeRange: arc.episodeRange })),
          actual: arcs.map((arc) => ({ id: arc.id, name: arc.name, episodeRange: arc.episodeRange })),
        },
        failure: {
          code: 'season_plan_topology_invalid',
          ownerStage: 'season_plan',
          retryClass: 'none',
          issueCodes,
          repairTarget: 'season-arcs',
        },
      },
    );
  }

  private normalizeArcTurnoutType(value: unknown, fallback: ArcEpisodeTurnoutType): ArcEpisodeTurnoutType {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text === 'setup' || text === 'escalation' || text === 'reversal' || text === 'revelation'
      || text === 'cost' || text === 'choice' || text === 'recontextualization' || text === 'crisis'
      || text === 'finale' || text === 'handoff') {
      return text;
    }
    return fallback;
  }

  private deriveArcStoryCircleSpan(
    range: { start: number; end: number },
    storyCircleRoleByEpisode: Map<number, StoryCircleRoleAssignment[]>,
  ): ArcStoryCircleSpan | undefined {
    const ownedBeats: ArcStoryCircleSpan['ownedBeats'] = [];
    for (let epNum = range.start; epNum <= range.end; epNum += 1) {
      const roles = storyCircleRoleByEpisode.get(epNum) ?? [];
      for (const role of roles) {
        if (role.roleKind === 'expansion') continue;
        if (!ownedBeats.includes(role.beat)) ownedBeats.push(role.beat);
      }
    }
    if (ownedBeats.length === 0) return undefined;
    return {
      startBeat: ownedBeats[0],
      endBeat: ownedBeats[ownedBeats.length - 1],
      ownedBeats,
      startEpisode: range.start,
      endEpisode: range.end,
    };
  }

  private repairArcStoryCircleCoverage(
    arcs: SeasonArc[],
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
    storyCircleRoleByEpisode: Map<number, StoryCircleRoleAssignment[]>,
  ): SeasonArc[] {
    if (arcs.length === 0 || episodes.length === 0) return arcs;

    const repaired = this.partitionArcStoryCircleOwnership(arcs, analysis, episodes, storyCircleRoleByEpisode);
    const ownerCount = new Map<string, number>();
    for (const arc of repaired) {
      for (const beat of arc.storyCircleSpan?.ownedBeats ?? []) {
        ownerCount.set(beat, (ownerCount.get(beat) ?? 0) + 1);
      }
    }

    const missingEpisodes = episodes
      .filter((episode) => (episode.storyCircleRole ?? []).some((role) =>
        role.roleKind !== 'expansion' && (ownerCount.get(role.beat) ?? 0) === 0
      ))
      .map((episode) => episode.episodeNumber)
      .sort((a, b) => a - b);
    if (missingEpisodes.length === 0) return repaired;

    const groups: Array<{ start: number; end: number }> = [];
    for (const episodeNumber of missingEpisodes) {
      const current = groups[groups.length - 1];
      if (current && episodeNumber === current.end + 1) current.end = episodeNumber;
      else groups.push({ start: episodeNumber, end: episodeNumber });
    }

    const rebuildArc = (arc: SeasonArc, range: { start: number; end: number }): SeasonArc => {
      const storyCircleSpan = this.deriveArcStoryCircleSpan(range, storyCircleRoleByEpisode);
      const rawArc: SeasonArc = {
        ...arc,
        episodeRange: range,
        storyCircleSpan,
      };
      return {
        ...rawArc,
        ...this.normalizeArcPressureArchitecture(rawArc, analysis, episodes, storyCircleSpan),
      };
    };

    for (const group of groups) {
      const previousIndex = repaired
        .map((arc, index) => ({ arc, index }))
        .filter(({ arc }) => arc.episodeRange?.end === group.start - 1)
        .sort((a, b) => b.arc.episodeRange.end - a.arc.episodeRange.end)[0]?.index;

      if (previousIndex !== undefined) {
        const previous = repaired[previousIndex];
        repaired[previousIndex] = rebuildArc(previous, {
          start: previous.episodeRange.start,
          end: group.end,
        });
        continue;
      }

      const nextIndex = repaired
        .map((arc, index) => ({ arc, index }))
        .filter(({ arc }) => arc.episodeRange?.start === group.end + 1)
        .sort((a, b) => a.arc.episodeRange.start - b.arc.episodeRange.start)[0]?.index;

      if (nextIndex !== undefined) {
        const next = repaired[nextIndex];
        repaired[nextIndex] = rebuildArc(next, {
          start: group.start,
          end: next.episodeRange.end,
        });
        continue;
      }

      const range = { start: group.start, end: group.end };
      const storyCircleSpan = this.deriveArcStoryCircleSpan(range, storyCircleRoleByEpisode);
      const fallbackArc: SeasonArc = {
        id: `arc-${range.start}-${range.end}`,
        name: range.end === analysis.totalEstimatedEpisodes ? 'Final Reckoning' : `Arc ${range.start}-${range.end}`,
        description: `Episodes ${range.start}-${range.end} carry the remaining Story Circle pressure left uncovered by the authored arc plan.`,
        episodeRange: range,
        keyMoments: [],
        status: 'not_started',
        completionPercentage: 0,
        storyCircleSpan,
        ...this.normalizeArcPressureArchitecture(
          {
            id: `arc-${range.start}-${range.end}`,
            name: range.end === analysis.totalEstimatedEpisodes ? 'Final Reckoning' : `Arc ${range.start}-${range.end}`,
            description: `Episodes ${range.start}-${range.end}`,
            episodeRange: range,
          },
          analysis,
          episodes,
          storyCircleSpan,
        ),
      };
      repaired.push(fallbackArc);
    }

    return repaired.sort((a, b) => (a.episodeRange?.start ?? 0) - (b.episodeRange?.start ?? 0));
  }

  private partitionArcStoryCircleOwnership(
    arcs: SeasonArc[],
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
    storyCircleRoleByEpisode: Map<number, StoryCircleRoleAssignment[]>,
  ): SeasonArc[] {
    if (arcs.length <= 1) return arcs;

    const primaryEpisodes = episodes
      .map((episode) => ({
        episodeNumber: episode.episodeNumber,
        beats: (episode.storyCircleRole ?? [])
          .filter((role) => role.roleKind !== 'expansion')
          .map((role) => role.beat),
      }))
      .filter((entry) => entry.beats.length > 0)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (primaryEpisodes.length === 0) return arcs;

    const entries = arcs.map((arc, index) => {
      const start = arc.episodeRange?.start ?? 1;
      const end = arc.episodeRange?.end ?? analysis.totalEstimatedEpisodes;
      return { arc, index, start, end, width: Math.max(0, end - start) };
    });
    const assignedEpisodes = new Map<number, number[]>();

    for (const episode of primaryEpisodes) {
      const candidates = entries
        .filter((entry) => episode.episodeNumber >= entry.start && episode.episodeNumber <= entry.end)
        .sort((a, b) => a.width - b.width || a.start - b.start || a.index - b.index);
      const owner = candidates[0];
      if (!owner) continue;
      assignedEpisodes.set(owner.index, [...(assignedEpisodes.get(owner.index) ?? []), episode.episodeNumber]);
    }

    const rebuilt: SeasonArc[] = [];
    const rebuildArc = (arc: SeasonArc, range: { start: number; end: number }, suffix?: number): SeasonArc => {
      const storyCircleSpan = this.deriveArcStoryCircleSpan(range, storyCircleRoleByEpisode);
      const rawArc: SeasonArc = {
        ...arc,
        id: suffix ? `${arc.id}-part-${suffix}` : arc.id,
        name: suffix ? `${arc.name} (${range.start}-${range.end})` : arc.name,
        episodeRange: range,
        storyCircleSpan,
      };
      return {
        ...rawArc,
        ...this.normalizeArcPressureArchitecture(rawArc, analysis, episodes, storyCircleSpan),
      };
    };

    for (const entry of entries) {
      const episodeNumbers = Array.from(new Set(assignedEpisodes.get(entry.index) ?? [])).sort((a, b) => a - b);
      if (episodeNumbers.length === 0) continue;
      const groups: Array<{ start: number; end: number }> = [];
      for (const episodeNumber of episodeNumbers) {
        const current = groups[groups.length - 1];
        if (current && episodeNumber === current.end + 1) current.end = episodeNumber;
        else groups.push({ start: episodeNumber, end: episodeNumber });
      }
      groups.forEach((range, groupIndex) => {
        rebuilt.push(rebuildArc(entry.arc, range, groupIndex === 0 ? undefined : groupIndex + 1));
      });
    }

    if (rebuilt.length === 0) return arcs;

    const owned = new Set<StoryCircleBeat>();
    for (const arc of rebuilt) {
      for (const beat of arc.storyCircleSpan?.ownedBeats ?? []) owned.add(beat);
    }
    const originalOwned = new Set<StoryCircleBeat>();
    for (const arc of arcs) {
      for (const beat of arc.storyCircleSpan?.ownedBeats ?? []) originalOwned.add(beat);
    }
    for (const beat of originalOwned) {
      if (!owned.has(beat)) return arcs;
    }

    return rebuilt.sort((a, b) => (a.episodeRange?.start ?? 0) - (b.episodeRange?.start ?? 0));
  }

  private normalizeArcPressureArchitecture(
    rawArc: Partial<SeasonArc>,
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
    storyCircleSpan: ArcStoryCircleSpan | undefined,
  ): Pick<
    SeasonArc,
    | 'storyCircleSpan'
    | 'arcQuestion'
    | 'seasonQuestionRelation'
    | 'identityPressureFacet'
    | 'midpointRecontextualization'
    | 'lateArcCrisis'
    | 'finaleAnswer'
    | 'handoffPressure'
    | 'episodeTurnouts'
  > {
    const start = rawArc.episodeRange?.start || 1;
    const end = rawArc.episodeRange?.end || Math.max(1, analysis.totalEstimatedEpisodes);
    const midpointEpisode = this.clampEpisode(
      rawArc.midpointRecontextualization?.episodeNumber || this.episodeAtArcRatio(start, end, 0.5),
      start,
      end,
    );
    const crisisEpisode = this.clampEpisode(
      rawArc.lateArcCrisis?.episodeNumber || this.episodeAtArcRatio(start, end, 2 / 3),
      start,
      end,
    );
    const finaleEpisode = end;
    const midpointEp = episodes.find((ep) => ep.episodeNumber === midpointEpisode);
    const crisisEp = episodes.find((ep) => ep.episodeNumber === crisisEpisode);
    const finaleEp = episodes.find((ep) => ep.episodeNumber === finaleEpisode);
    const arcName = rawArc.name || 'Arc';
    const arcDescription = rawArc.description || `Episodes ${start}-${end}`;
    const seasonPressure = analysis.anchors?.stakes || analysis.anchors?.goal || analysis.themes.join(', ');
    const identityPressure = rawArc.identityPressureFacet
      || analysis.characterArchitecture?.protagonist.lie
      || analysis.protagonist.arc
      || `${analysis.protagonist.name}'s self-image under pressure`;
    const protagonistTruth = analysis.characterArchitecture?.protagonist.truth || analysis.protagonist.arc;

    const episodeTurnouts = this.normalizeArcEpisodeTurnouts(
      rawArc.episodeTurnouts,
      episodes.filter((ep) => ep.episodeNumber >= start && ep.episodeNumber <= end),
      {
        start,
        end,
        midpointEpisode,
        crisisEpisode,
      },
    );

    return {
      storyCircleSpan,
      arcQuestion: rawArc.arcQuestion
        || `What changes for ${analysis.protagonist.name} as "${arcName}" pressures ${arcDescription}?`,
      seasonQuestionRelation: rawArc.seasonQuestionRelation
        || `This arc narrows the season pressure by testing ${seasonPressure || 'the season goal and stakes'} through ${arcName}.`,
      identityPressureFacet: identityPressure,
      midpointRecontextualization: {
        episodeNumber: midpointEpisode,
        questionBefore: rawArc.midpointRecontextualization?.questionBefore
          || `Can ${analysis.protagonist.name} survive the visible pressure of ${arcName}?`,
        questionAfter: rawArc.midpointRecontextualization?.questionAfter
          || `Did ${analysis.protagonist.name} understand what ${arcName} was really demanding from the Lie/Truth conflict?`,
        description: rawArc.midpointRecontextualization?.description
          || midpointEp?.cliffhangerPlan?.newOpenQuestion
          || midpointEp?.synopsis
          || `Episode ${midpointEpisode} reframes the arc question instead of merely raising the volume.`,
      },
      lateArcCrisis: {
        episodeNumber: crisisEpisode,
        apparentFailure: rawArc.lateArcCrisis?.apparentFailure
          || crisisEp?.cliffhangerPlan?.hook
          || `The current plan for ${arcName} appears to fail.`,
        irreversibleCost: rawArc.lateArcCrisis?.irreversibleCost
          || crisisEp?.cliffhangerPlan?.emotionalCharge
          || `A cost, exposed truth, damaged bond, or lost option cannot be fully restored.`,
        description: rawArc.lateArcCrisis?.description
          || crisisEp?.cliffhangerPlan?.nextEpisodePressure
          || `Episode ${crisisEpisode} creates a late-arc crisis that forces a changed approach.`,
      },
      finaleAnswer: rawArc.finaleAnswer
        || finaleEp?.narrativeFunction?.resolution
        || `Episode ${finaleEpisode} answers the local arc question for ${arcName} by forcing ${analysis.protagonist.name} toward or away from ${protagonistTruth}.`,
      handoffPressure: rawArc.handoffPressure
        || (finaleEpisode < analysis.totalEstimatedEpisodes
          ? finaleEp?.cliffhangerPlan?.nextEpisodePressure || `The answer to ${arcName} creates pressure for the next arc.`
          : undefined),
      episodeTurnouts,
    };
  }

  private normalizeArcEpisodeTurnouts(
    rawTurnouts: ArcEpisodeTurnout[] | undefined,
    arcEpisodes: SeasonEpisode[],
    anchors: { start: number; end: number; midpointEpisode: number; crisisEpisode: number },
  ): ArcEpisodeTurnout[] {
    return arcEpisodes.map((episode) => {
      const existing = rawTurnouts?.find((turnout) => turnout.episodeNumber === episode.episodeNumber);
      const storyCircleRole = this.primaryStoryCircleRoleForEpisode(episode) ?? episode.storyCircleRole?.[0];
      const storyCircleBeat = existing?.storyCircleBeat || storyCircleRole?.beat || 'search';
      const storyCircleRoleKind = existing?.storyCircleRoleKind || storyCircleRole?.roleKind || 'expansion';
      const inferredTurnType = this.inferArcTurnoutType(episode, storyCircleBeat, anchors);
      const turnType = this.normalizeArcTurnoutType(existing?.turnType, inferredTurnType);
      const cliffhanger = episode.cliffhangerPlan;
      // Candidate selection uses the ArcPressure validator's OWN completeness
      // predicate, not bare `||` truthiness: a truthy placeholder like "TBD"
      // or "none" used to survive these fallbacks "filled" and then fail the
      // validator's hasText, aborting the whole season-plan run on a defect
      // this very function exists to repair (r119, 2026-07-18,
      // worker-1784411845734-fy0bmr4g: arc "Champagne" episode-1 turnout).
      // The trailing template is always substantive, so every field passes
      // the gate by construction after normalization.
      const firstSubstantive = (...candidates: Array<string | undefined>): string | undefined =>
        candidates.find((candidate) => hasSubstantiveArcText(candidate));
      return {
        episodeNumber: episode.episodeNumber,
        storyCircleBeat,
        storyCircleRoleKind,
        turnType,
        description: firstSubstantive(
          existing?.description,
          cliffhanger?.hook,
          episode.narrativeFunction?.conflict,
          episode.synopsis,
        ) ?? `Episode ${episode.episodeNumber} turns the arc.`,
        leavesProtagonistWith: firstSubstantive(
          existing?.leavesProtagonistWith,
          cliffhanger?.nextEpisodePressure,
          cliffhanger?.emotionalCharge,
          episode.narrativeFunction?.resolution,
        ) ?? `New consequence residue from Episode ${episode.episodeNumber}.`,
        whyThisCannotMoveLater: firstSubstantive(existing?.whyThisCannotMoveLater)
          ?? `Episode ${episode.episodeNumber}'s turnout follows from its Story Circle role (${storyCircleBeat}) and cliffhanger pressure; moving it later would break causal order.`,
      };
    });
  }

  private primaryStoryCircleRoleForEpisode(episode: SeasonEpisode): StoryCircleRoleAssignment | undefined {
    return episode.storyCircleRole?.find((role) => role.roleKind !== 'expansion')
      ?? episode.storyCircleRole?.[0];
  }

  private inferArcTurnoutType(
    episode: SeasonEpisode,
    storyCircleBeat: StoryCircleRoleAssignment['beat'],
    anchors: { start: number; end: number; midpointEpisode: number; crisisEpisode: number },
  ): ArcEpisodeTurnoutType {
    if (episode.episodeNumber === anchors.start) return 'setup';
    if (episode.episodeNumber === anchors.end) return anchors.end === anchors.start ? 'finale' : 'finale';
    if (storyCircleBeat === 'need' || storyCircleBeat === 'go') return 'choice';
    if (storyCircleBeat === 'search') return 'escalation';
    if (storyCircleBeat === 'find') return 'recontextualization';
    if (storyCircleBeat === 'take') return 'cost';
    if (storyCircleBeat === 'return') return 'handoff';
    if (storyCircleBeat === 'change') return 'finale';
    const type = episode.cliffhangerPlan?.type;
    if (type === 'reframe') return 'recontextualization';
    if (type === 'revelation' || type === 'mystery') return 'revelation';
    if (type === 'loss' || type === 'betrayal') return 'cost';
    if (type === 'decision') return 'choice';
    if (episode.episodeNumber + 1 === anchors.end) return 'escalation';
    return 'escalation';
  }

  private episodeAtArcRatio(start: number, end: number, ratio: number): number {
    const length = Math.max(1, end - start);
    return Math.round(start + length * ratio);
  }

  private clampEpisode(value: number, start: number, end: number): number {
    return Math.max(start, Math.min(end, value));
  }

  private validateTreatmentHandoff(analysis: SourceMaterialAnalysis, plan: SeasonPlan): string[] {
    const warnings: string[] = [];
    const treatmentEpisodes = analysis.episodeBreakdown.filter((ep) => ep.treatmentGuidance);
    if (treatmentEpisodes.length === 0 && !(analysis.treatmentBranches || []).length) return warnings;

    if ((analysis.resolvedEndings || []).length !== 3 || plan.endingMode !== 'multiple') {
      warnings.push('[TreatmentHandoff] Treatment-driven seasons should preserve exactly 3 alternate endings in multiple-ending mode.');
    }

    for (const episode of plan.episodes) {
      const hadTreatment = Boolean(analysis.episodeBreakdown.find((ep) => ep.episodeNumber === episode.episodeNumber)?.treatmentGuidance);
      if (!hadTreatment) continue;
      if (!(episode.plannedEncounters || []).length) {
        warnings.push(`[TreatmentHandoff] Episode ${episode.episodeNumber} has treatment guidance but no planned encounter.`);
      }
      if (episode.episodeNumber < plan.totalEpisodes && !episode.cliffhangerPlan?.hook) {
        warnings.push(`[TreatmentHandoff] Episode ${episode.episodeNumber} has treatment guidance but no cliffhanger hook.`);
      }
    }

    for (const branch of analysis.treatmentBranches || []) {
      const found = plan.crossEpisodeBranches.some((candidate) => candidate.name === branch.name || candidate.id === branch.id)
        || plan.consequenceChains.some((candidate) => candidate.id.includes(branch.id) || candidate.origin.description.includes(branch.name));
      if (!found) {
        warnings.push(`[TreatmentHandoff] Treatment branch "${branch.name}" was not preserved as a branch or consequence chain.`);
      }
    }

    const authoredAlternativeCount = treatmentEpisodes.reduce((sum, ep) => sum + (ep.treatmentGuidance?.alternativePaths?.length || 0), 0);
    if (authoredAlternativeCount > 0 && plan.crossEpisodeBranches.length === 0 && plan.consequenceChains.length === 0) {
      warnings.push('[TreatmentHandoff] Authored alternative paths exist but no downstream branch or residue chain was produced.');
    }

    return warnings;
  }

  private validateEndingPlan(input: {
    warnings: string[];
    endingMode: EndingMode;
    resolvedEndingCount: number;
    episodes: SeasonEpisode[];
    crossEpisodeBranches: CrossEpisodeBranch[];
  }): string[] {
    const warnings = [...input.warnings];
    const referencedEndingIds = new Set<string>();

    for (const episode of input.episodes) {
      for (const route of episode.endingRoutes || []) {
        if (route.endingId) referencedEndingIds.add(route.endingId);
      }
    }
    for (const branch of input.crossEpisodeBranches) {
      for (const path of branch.paths) {
        for (const endingId of path.targetEndingIds || []) {
          referencedEndingIds.add(endingId);
        }
      }
    }

    if (input.endingMode === 'multiple' && input.resolvedEndingCount < 2) {
      warnings.push('Multiple-ending mode is active, but fewer than two distinct ending targets were resolved.');
    }
    if (input.endingMode === 'single' && input.resolvedEndingCount > 1) {
      warnings.push('Single-ending mode is active, but more than one ending target remains resolved.');
    }
    if (input.resolvedEndingCount > 0 && referencedEndingIds.size === 0) {
      warnings.push('Ending targets were resolved but never referenced by episode routes or cross-episode branches.');
    }
    if (input.endingMode === 'multiple' && referencedEndingIds.size === 1 && input.resolvedEndingCount > 1) {
      warnings.push('Multiple-ending mode is active, but the season plan only references one ending route.');
    }

    return warnings;
  }

  /**
   * Get recommendations for which episodes to generate based on current selection
   */
  getEpisodeRecommendations(
    plan: SeasonPlan,
    selectedEpisodes: number[]
  ): EpisodeRecommendation[] {
    const recommendations: EpisodeRecommendation[] = [];

    for (const episode of plan.episodes) {
      if (selectedEpisodes.includes(episode.episodeNumber)) continue;
      if (this.isEpisodeGenerated(episode)) continue;

      // Check if this episode is needed for selected episodes
      const isNeededBySelected = selectedEpisodes.some(selNum => {
        const selEp = plan.episodes.find(e => e.episodeNumber === selNum);
        return selEp?.dependsOn.includes(episode.episodeNumber);
      });

      // Check if this episode introduces critical characters for selected episodes
      const introducesNeededCharacter = episode.introducesCharacters.some(charId => {
        return selectedEpisodes.some(selNum => {
          const selEp = plan.episodes.find(e => e.episodeNumber === selNum);
          return selEp?.mainCharacters.includes(charId);
        });
      });

      if (isNeededBySelected) {
        recommendations.push({
          episodeNumber: episode.episodeNumber,
          reason: `Required dependency for episode(s) ${selectedEpisodes.filter(n => 
            plan.episodes.find(e => e.episodeNumber === n)?.dependsOn.includes(episode.episodeNumber)
          ).join(', ')}`,
          priority: 'must_generate',
          dependencyChain: this.getDependencyChain(plan, episode.episodeNumber),
        });
      } else if (introducesNeededCharacter) {
        recommendations.push({
          episodeNumber: episode.episodeNumber,
          reason: `Introduces character(s) needed in selected episodes`,
          priority: 'recommended',
          dependencyChain: this.getDependencyChain(plan, episode.episodeNumber),
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { must_generate: 0, recommended: 1, optional: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Get the full dependency chain for an episode
   */
  private getDependencyChain(plan: SeasonPlan, episodeNumber: number): number[] {
    const chain: number[] = [];
    const visited = new Set<number>();

    const addDeps = (epNum: number) => {
      if (visited.has(epNum)) return;
      visited.add(epNum);
      
      const ep = plan.episodes.find(e => e.episodeNumber === epNum);
      if (!ep) return;

      for (const dep of ep.dependsOn) {
        addDeps(dep);
      }
      chain.push(epNum);
    };

    addDeps(episodeNumber);
    return chain;
  }

  /**
   * Validate episode selection and return warnings
   */
  validateSelection(
    plan: SeasonPlan,
    selectedEpisodes: number[]
  ): EpisodeSelectionState {
    const warnings: string[] = [];
    const sorted = [...selectedEpisodes].sort((a, b) => a - b);

    // Check for missing dependencies
    for (const epNum of sorted) {
      const ep = plan.episodes.find(e => e.episodeNumber === epNum);
      if (!ep) continue;

      if (this.isEpisodeGenerated(ep)) {
        warnings.push(`Episode ${epNum} is already generated. Keeping it selected will regenerate that episode.`);
      }

      for (const dep of ep.dependsOn) {
        const depEp = plan.episodes.find(e => e.episodeNumber === dep);
        if (!sorted.includes(dep) && !this.isEpisodeGenerated(depEp)) {
          warnings.push(`Episode ${epNum} depends on Episode ${dep}, which is not selected or completed.`);
        }
      }
    }

    // Check for skipped episodes in arcs
    for (const arc of plan.arcs) {
      const arcEpisodes = sorted.filter(
        n => n >= arc.episodeRange.start && n <= arc.episodeRange.end
      );
      if (arcEpisodes.length > 0 && arcEpisodes.length < (arc.episodeRange.end - arc.episodeRange.start + 1)) {
        const missing = [];
        for (let i = arc.episodeRange.start; i <= arc.episodeRange.end; i++) {
          const episode = plan.episodes.find(e => e.episodeNumber === i);
          if (!sorted.includes(i) && !this.isEpisodeGenerated(episode)) missing.push(i);
        }
        if (missing.length > 0) {
          warnings.push(`Arc "${arc.name}" has gaps: episodes ${missing.join(', ')} are not selected or already generated.`);
        }
      }
    }

    // Recommend optimal order
    const recommendedOrder = this.getOptimalOrder(plan, sorted);

    return {
      planId: plan.id,
      selectedEpisodes: sorted,
      recommendedOrder,
      warnings,
    };
  }

  /**
   * Get optimal generation order for selected episodes
   */
  private getOptimalOrder(plan: SeasonPlan, selectedEpisodes: number[]): number[] {
    const ordered: number[] = [];
    const remaining = new Set(selectedEpisodes);
    const completed = new Set(
      plan.episodes.filter(e => this.isEpisodeGenerated(e)).map(e => e.episodeNumber)
    );

    while (remaining.size > 0) {
      // Find episodes whose dependencies are satisfied
      const ready = [...remaining].filter(epNum => {
        const ep = plan.episodes.find(e => e.episodeNumber === epNum);
        if (!ep) return false;
        return ep.dependsOn.every(dep => completed.has(dep) || ordered.includes(dep));
      });

      if (ready.length === 0) {
        // Circular dependency or missing deps - add remaining in order
        const remainingArray = [...remaining].sort((a, b) => a - b);
        ordered.push(...remainingArray);
        break;
      }

      // Add the lowest-numbered ready episode
      const next = Math.min(...ready);
      ordered.push(next);
      remaining.delete(next);
    }

    return ordered;
  }

  private isEpisodeGenerated(episode: Pick<SeasonEpisode, 'status' | 'generatedEpisodeId' | 'generatedStoryId' | 'generatedJobId' | 'outputDir'> | undefined): boolean {
    return Boolean(
      episode
      && (
        episode.status === 'completed'
        || episode.generatedEpisodeId
        || episode.generatedStoryId
        || episode.generatedJobId
        || episode.outputDir
      )
    );
  }
}
