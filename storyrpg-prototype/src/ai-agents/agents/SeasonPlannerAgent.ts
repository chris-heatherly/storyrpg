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
  SourceMaterialAnalysis,
  EpisodeOutline,
  CrossEpisodeBranch,
  ConsequenceChain,
  PlannedEncounter,
  EncounterCategory,
  EndingMode,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
  SEVEN_POINT_BEATS,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';
import {
  SeasonPlan,
  SeasonEpisode,
  SeasonArc,
  ArcEpisodeTurnout,
  ArcEpisodeTurnoutType,
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
} from '../../types/seasonPlan';
import {
  distributeSevenPoints,
  describeDistribution,
  backfillMissingBeats,
} from '../utils/sevenPointDistribution';
import { SEASON_PLANNER_CRAFT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { buildSeasonPromiseContracts } from '../utils/seasonPromiseContracts';
import { buildStakesArchitectureContracts } from '../utils/stakesArchitectureContracts';
import { buildSevenPointBeatContracts } from '../utils/sevenPointBeatContracts';
import {
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
  SevenPointCoverageValidator,
  seasonPlanToCoverageInput,
} from '../validators/SevenPointCoverageValidator';
import { ArcPressureArchitectureValidator } from '../validators/ArcPressureArchitectureValidator';
import { PLAN_GATE_FLAGS, shouldGate } from '../remediation/planGatePolicy';
import { gateEnabledPredicate } from '../remediation/gateDefaults';
import { CharacterArchitectureValidator } from '../validators/CharacterArchitectureValidator';
import { SeasonPromiseValidator } from '../validators/SeasonPromiseValidator';
import { InformationLedgerValidator } from '../validators/InformationLedgerValidator';
import {
  buildDefaultCliffhangerPlan,
  normalizeCliffhangerPlan,
  selectMappedStructuralRole,
  shouldForceHighIntensityHook,
} from '../utils/cliffhangerPlanning';
import {
  CRAFT_PRESSURE_GUIDANCE,
  buildGenreAwareJeopardyGuidance,
} from '../prompts/storytellingPrinciples';
import { clampSceneCount } from '../../constants/pipeline';
import { isSceneFirstPlanningEnabled } from '../config/sceneFirstPlanning';
import { buildSeasonScenePlan, scenesForEpisode, MIN_SCENES_PER_EPISODE } from '../pipeline/seasonScenePlanBuilder';
import { reconcileBeatAnchors } from '../pipeline/beatAnchorReconciliation';
import { buildScenePlanPrompt, normalizeAuthoredScenePlan } from '../pipeline/authorScenePlan';
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
    episodeStructureMode?: 'standard' | 'sceneEpisodes';
    sceneEpisodeEncounterCadence?: number;
    sceneEpisodeBranchMinEpisodes?: number;
    sceneEpisodeBranchMaxEpisodes?: number;
    pacing?: 'tight' | 'moderate' | 'expansive';
    endingMode?: EndingMode;
    /**
     * Treatment-fidelity strict mode (Phase 1, Step 1.2). When true, a conflict
     * between an authored Section-7 beat→episode anchor and the per-episode
     * structuralRole assignment throws instead of being repaired+logged. Default
     * OFF (opt-in per run), consistent with the validator-gating pattern.
     */
    strictTreatmentValidation?: boolean;
  };
  
  // Optional: existing plan to update
  existingPlanId?: string;

  /**
   * 7-point spine gate (tier 1). When not explicitly false, a season plan whose 3-act/
   * 7-point spine is incomplete or out of canonical order is REJECTED (execute throws)
   * rather than shipped — a season without a complete spine should not generate. Default ON.
   */
  sevenPointBlocking?: boolean;
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

    console.log(`[SeasonPlanner] Creating season plan for: ${sourceAnalysis.sourceTitle}`);

    // Always use LLM - we need it for encounter planning and cross-episode branching
    let planData: MutablePlanData;

    try {
      const prompt = this.buildPlanningPrompt(sourceAnalysis, preferences);
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      planData = this.parseJSON(response);
      const topKeys = Object.keys(planData);
      console.log(`[SeasonPlanner] LLM plan received with ${topKeys.length} top-level keys: ${topKeys.join(', ')}`);
      
      // Detect possible truncation — warn if critical fields are missing
      const criticalFields = ['arcs', 'episodeEncounters', 'crossEpisodeBranches', 'episodeEndingRoutes'];
      const missingCritical = criticalFields.filter(f => !(f in planData));
      if (missingCritical.length > 0) {
        console.warn(`[SeasonPlanner] WARNING: LLM response may be truncated — missing fields: ${missingCritical.join(', ')}. Response length: ${response.length} chars. Re-fetching just those before any deterministic fallback.`);
        await this.refetchMissingPlanFields(planData, missingCritical, sourceAnalysis, preferences);
      }
    } catch (error) {
      console.warn(`[SeasonPlanner] LLM planning failed, using fallback:`, error);
      planData = this.buildFallbackPlan(sourceAnalysis);
    }
    planData = this.mergeTreatmentGuidanceIntoPlanData(sourceAnalysis, planData);

    // Build the complete season plan
    const seasonPlan = this.buildSeasonPlan(sourceAnalysis, planData, preferences);

    console.log(`[SeasonPlanner] Created plan with ${seasonPlan.totalEpisodes} episodes, ${seasonPlan.arcs.length} arcs, ${seasonPlan.encounterPlan.totalEncounters} encounters, ${seasonPlan.crossEpisodeBranches.length} cross-episode branches`);

    // Scene-first planning: buildSeasonPlan attaches a DETERMINISTIC spine as a
    // guaranteed fallback. Here we attempt to UPGRADE it to an LLM-authored
    // spine (scenes planned with real dramatic content + setup/payoff logic).
    // On any failure the deterministic spine is kept.
    const isTreatmentSourcedPlan = seasonPlan.episodes.some((ep) => Boolean(ep.treatmentGuidance));
    if (
      isSceneFirstPlanningEnabled(preferences?.episodeStructureMode === 'sceneEpisodes' ? 'sceneEpisodes' : 'standard') &&
      seasonPlan.scenePlan &&
      !isTreatmentSourcedPlan
    ) {
      // Standard-mode episodes must stay branchable, so hold the LLM-authored
      // spine to the deterministic per-episode scene floor; sceneEpisodes mode
      // legitimately runs single-scene episodes and is exempt.
      const isSceneEpisodes = preferences?.episodeStructureMode === 'sceneEpisodes';
      const authored = await this.authorScenePlanLLM(
        seasonPlan,
        isSceneEpisodes ? {} : { minScenesPerEpisode: MIN_SCENES_PER_EPISODE },
      );
      if (authored) {
        seasonPlan.scenePlan = authored;
        for (const ep of seasonPlan.episodes) {
          ep.plannedScenes = scenesForEpisode(authored, ep.episodeNumber);
        }
        seasonPlan.notes.push(
          `Scene-first planning: LLM-authored spine (${authored.scenes.length} scenes, ${authored.setupPayoffEdges.length} setup/payoff edges).`,
        );
      }
    } else if (seasonPlan.scenePlan && isTreatmentSourcedPlan) {
      seasonPlan.notes.push(
        'Scene-first planning: kept deterministic treatment-bound spine so authored required beats remain the source of truth.',
      );
    }

    // Season choice/consequence BUDGET layer. Runs AFTER the scene plan is built
    // and (optionally) LLM-upgraded, and BEFORE the plan is finalized/returned —
    // budgets are allocated over the spine, then validated, while the spine can
    // still be rejected by the gate below. Scene-first only; no-op otherwise.
    if (
      isSceneFirstPlanningEnabled(preferences?.episodeStructureMode === 'sceneEpisodes' ? 'sceneEpisodes' : 'standard') &&
      seasonPlan.scenePlan
    ) {
      // Build the positional-axis context (Plan Part 3, Layers A–C): map each
      // episode number to its structuralRole(s). The allocator/validator read it
      // only when CONSEQUENCE_POSITIONAL is on; otherwise behavior is unchanged.
      const roleByEpisode: Record<number, StructuralRole[]> = {};
      for (const ep of seasonPlan.episodes) {
        roleByEpisode[ep.episodeNumber] = ep.structuralRole ?? [];
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

      // HARD GATE (opt-in, default OFF). Only when GATE_SEASON_BUDGETS=1 do
      // error-severity budget findings block the plan. Mirrors the arcPressure
      // gate below.
      if (process.env.GATE_SEASON_BUDGETS === '1') {
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

    // 7-point spine GATE (tier 1, default ON / opt-out). A season whose 3-act/7-point
    // spine is incomplete or out of canonical order must not generate — the spine is the
    // structural contract every downstream episode is authored against. Coverage is
    // engineered to pass (the structuralRole distribution is built for full coverage), so
    // this fires only on a genuine structural failure.
    if (input.sevenPointBlocking !== false) {
      const coverage = new SevenPointCoverageValidator().validate(seasonPlanToCoverageInput(seasonPlan));
      const blockingIssues = coverage.issues.filter((i) => i.severity === 'error');
      if (blockingIssues.length > 0) {
        throw new Error(
          `[SevenPointGate] Season 7-point spine failed the blocking gate (${blockingIssues.length} issue(s)): ` +
            blockingIssues.map((i) => i.message).join('; ') +
            '. Set SEVEN_POINT_BLOCKING=0 to downgrade to advisory.',
        );
      }
    }

    // Bucket D: ArcPressure architecture gate. Inferred arcs remain advisory
    // unless the rollout flag is enabled. Treatment-authored arc plans are
    // binding because the parsed arc fields now carry authored contracts.
    const treatmentArcPlanSourced = (seasonPlan.arcPressureContracts ?? []).some((contract) => contract.source === 'treatment');
    if (gateEnabledPredicate(PLAN_GATE_FLAGS.arcPressure) || treatmentArcPlanSourced) {
      const arcPressureGateResult = new ArcPressureArchitectureValidator().validate(seasonPlan, {
        episodeStructureMode:
          preferences?.episodeStructureMode === 'sceneEpisodes' ? 'sceneEpisodes' : 'standard',
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
        throw new Error(
          `[ArcPressureGate] Season arc architecture failed the blocking gate (${arcPressureGate.blockingCount} issue(s)): ` +
            arcErrors.map((i) => i.message).join('; ') +
            (treatmentArcPlanSourced
              ? '. Treatment-authored arc plans are binding; repair the arc plan assignments instead of downgrading.'
              : '. Unset GATE_ARC_PRESSURE to downgrade to advisory.'),
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
   */
  private async authorScenePlanLLM(
    plan: SeasonPlan,
    opts: { minScenesPerEpisode?: number } = {},
  ): Promise<SeasonScenePlan | null> {
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
      console.warn('[SeasonPlanner] Scene-plan authoring failed; keeping deterministic spine:', error);
      return null;
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

    const arcList = analysis.storyArcs
      .map(arc => `- ${arc.name}: ${arc.description} (Episodes ${arc.estimatedEpisodeRange.start}-${arc.estimatedEpisodeRange.end})`)
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
    const sp = analysis.sevenPoint;
    const anchorBlock = anchors
      ? [
          `- Stakes: ${anchors.stakes}`,
          `- Goal: ${anchors.goal}`,
          `- Inciting Incident: ${anchors.incitingIncident}`,
          `- Climax: ${anchors.climax}`,
        ].join('\n')
      : '(not yet derived — inherit from episode breakdown)';
    const sevenPointBlock = sp
      ? SEVEN_POINT_BEATS.map((b) => `- ${b}: ${sp[b]}`).join('\n')
      : '(not yet derived — inherit from episode breakdown)';
    const distributionHint = describeDistribution(distributeSevenPoints(analysis.totalEstimatedEpisodes));

    const isSceneEpisodes = preferences?.episodeStructureMode === 'sceneEpisodes';
    const treatmentMode = analysis.treatmentSeasonGuidance?.episodeStructureMode;
    const effectiveSceneEpisodes = isSceneEpisodes || treatmentMode === 'sceneEpisodes';
    const treatmentSeasonBlock = analysis.treatmentSeasonGuidance ? `
## Authored Treatment Season Guidance
The source document is a StoryRPG treatment. Preserve these authored sections as planning constraints; do not treat them as optional flavor.
- Treatment mode: ${analysis.treatmentSeasonGuidance.episodeStructureMode}
- Parsed sections: ${analysis.treatmentSeasonGuidance.rawSectionSummary?.join(', ') || 'season guidance'}
${analysis.treatmentSeasonGuidance.genre ? `\n### Authored Genre\n${analysis.treatmentSeasonGuidance.genre}` : ''}
${analysis.treatmentSeasonGuidance.tone ? `\n### Authored Tone\n${analysis.treatmentSeasonGuidance.tone}` : ''}
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

## Season 7-Point Beat Map
${sevenPointBlock}

## Default Beat Distribution (HINT — override if the source demands it)
${distributionHint}
Every canonical beat MUST land on at least one episode in canonical order.
Every \`episodeEncounters\` entry should reflect the difficulty implied by
the beats its episode carries (Midpoint / Pinch 2 / Climax episodes are
the hardest).

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
- Plan protagonist-facing pressure lanes when the episode has room: A-plot is the external episode pressure; B-plot is playable relationship/identity pressure that can be a scene, a sceneEpisode, an underlay, or offscreen NPC motivation surfaced through protagonist-visible signals; C-plot is usually a future seed, callback, world-pressure hint, or tonal counterweight with a visible plant and payoff plan. Do not create non-protagonist POV scenes, omniscient cutaways, or filler C-plot scenes.
- Define each arc as a 3-8 episode pressure movement inside the season, not a competing act schema. The season 7-point spine is authoritative; arc architecture explains how a smaller question escalates, recontextualizes, hits a late crisis, resolves, and hands off pressure.
- Episode endings inside an arc are arc turn-outs, not literal TV acts. Each must escalate, reverse, reveal, cost, force a choice, recontextualize, crisis-hit, finale-answer, or hand off pressure. Do not end an arc episode with a flat transition.
- Each arc needs: arcQuestion, seasonQuestionRelation, identityPressureFacet, midpointRecontextualization, lateArcCrisis, finaleAnswer, episodeTurnouts, and handoffPressure when the arc does not end the season. The midpoint must change the question being asked, not merely intensify danger. The late crisis should be apparent failure, irreversible cost, or collapse of the current plan, not mandatory genre-inappropriate despair.
- In sceneEpisodes mode, an arc is a chain of scene-length runtime episodes. Do not force each sceneEpisode to carry a whole arc by itself; distribute arc setup, recontextualization, crisis, finale, and handoff across the sceneEpisode chain. If the source treatment is already a sceneEpisode treatment, each listed sceneEpisode is already one runtime episode and must not be split again.
- Define Season Promise Architecture without adding fixed TV episode positions. Include one seasonDramaticQuestion, one centralPressure that can be a person/institution/mystery/environment/relationship/internal force/situation, a seasonPromise that names premise/player/emotional promises, and seasonCompleteness that explains how this season satisfies as a complete story while leaving earned future pressure.
- Episode 1 should establish the premise, player role, protagonist pressure, dramatic engine, and promise of play. Episode 2 may clarify the repeatable engine when season length allows, but do NOT force a rigid re-pilot. Do NOT force penultimate climax or fixed tent-pole episode numbers; the season 7-point distribution remains authoritative.
- Build an Information Ledger for major questions, threats, secrets, reveals, and payoffs. Use suspense/dramatic irony by default when the player can know the threat without breaking POV. Mystery is capped at 3 box questions per season. For major payoffs, plants should be 3-4 standard episodes ahead or 5-8 sceneEpisodes ahead unless the season is shorter than the runway.
- After the Climax, resolve quickly: show what was saved or changed, then show future cost, identity change, or legacy.
- Ensure the Inciting Incident lands in Act 1 and the Climax lands in Act 3.
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
- Episode structure mode: ${effectiveSceneEpisodes ? 'sceneEpisodes (one runtime episode = one dramatic scene)' : 'standard'}
- Scenes per episode: ${effectiveSceneEpisodes ? 1 : clampSceneCount(preferences?.targetScenesPerEpisode || 6)}
- Choices per episode: ${preferences?.targetChoicesPerEpisode || 3}
- Pacing: ${preferences?.pacing || 'moderate'}
${effectiveSceneEpisodes ? `- Scene-length episode rules: exactly 1 scene per runtime episode; normal episodes need 6-10 beats, target 8; every episode ends with a cliffhanger or forward-pressure hook; milestone encounters happen every ${preferences?.sceneEpisodeEncounterCadence || 6} master-spine episodes; branch paths last ${preferences?.sceneEpisodeBranchMinEpisodes || 1}-${preferences?.sceneEpisodeBranchMaxEpisodes || 2} episodes before reconverging.
` : ''}

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
- Plan what information/relationships/stakes the pre-encounter scenes must establish so the encounter choices feel loaded
- Design a DIFFICULTY CURVE across the season (introduction → rising → peak → falling → finale)
- Vary encounter types — no two consecutive episodes should use the same type
- Encounters at arc climaxes should be the hardest and most personally costly

In the \`episodeEncounters\` JSON, add an \`encounterBuildup\` field describing what the episode's earlier scenes need to establish for the encounter to land.

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
- **anchor**: what the decision is, in fiction (tie it to an arc beat or seven-point turn). Never expose stats/mechanics.
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
  "episodeEncounters": {
    "1": [
      {
        "id": "enc-1-1",
        "type": "combat|social|chase|stealth|puzzle|exploration|mixed",
        "description": "What this encounter is about — be specific and dramatic",
        "difficulty": "easy|moderate|hard|extreme",
        "npcsInvolved": ["character names"],
        "stakes": "What's personally at risk for the protagonist — not just plot stakes",
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
  },
  "episodeEndingRoutes": {
    "1": [
      {
        "endingId": "ending-1",
        "role": "opens|reinforces|threatens|locks",
        "description": "How this episode moves the player toward or away from that ending"
      }
    ]
  },
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
      "mappedStructuralRole": "hook|plotTurn1|pinch1|midpoint|pinch2|climax|resolution|rising|falling"
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
${isSceneEpisodes ? '- In sceneEpisodes mode, treat each SeasonPlan episode as one scene-length runtime episode, not a chapter. Use route metadata mentally: master spine episodes carry the canonical arc; branch-only episodes are route paths and do not count toward encounter cadence.\n' : ''}
${isSceneEpisodes ? `- In sceneEpisodes mode, only milestone master-spine episodes need encounters by default; other scene-length episodes are normal choice/cliffhanger episodes.` : `- Every episode MUST have at least 1 encounter — and it must be the episode's dramatic anchor`}
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
- Cliffhanger style MUST map to the episode's structuralRole:
  - hook: shock or emotional hook; Episode 1 must be high-intensity and reveal that the story is bigger, darker, or more personal than expected
  - plotTurn1: danger, decision, or arrival hook that forces commitment
  - pinch1: antagonist pressure, loss, betrayal, or exposed vulnerability
  - midpoint: major revelation/reframe; strongest shock ending after Episode 1
  - pinch2: emotional collapse, moral cost, relationship rupture, or apparent failure
  - climax: high-stakes fallout hook only if not finale; otherwise move toward resolution
  - resolution: legacy/next-season pressure, not a fake unresolved main conflict
  - rising/falling: serialized-TV hooks, with lower intensity unless cadence requires a spike
- Cadence rule: Episode 1, midpoint, pinch2, and at least every 2-3 episodes in longer seasons should use high-intensity shock, emotional_hook, betrayal, reframe, revelation, or loss.
- Arc pressure rule: each arc should span 3-8 episodes where practical. If source length forces a shorter or longer arc, explain the exception in warnings.
- Arc turn-out rule: every episode inside an arc must leave the protagonist with new damage, knowledge, obligation, exposure, compromise, relationship pressure, choice residue, or future pressure. If an episode's arc turnout could be swapped with a later episode, the arc is slack and must be tightened.
- Arc finale rule: if an arc does not end on the season finale episode, its finaleAnswer must resolve the local arc question and its handoffPressure must launch the next arc. Do not give a non-final arc season-level finality.
- Season promise rule: deliver the premise/player/emotional promises in fresh variations across the season. Breaking the core promise is a planning failure unless the user explicitly asked for a genre-breaking subversion.
- Season completeness rule: the final episode must answer the seasonDramaticQuestion enough to satisfy and show changed stakes/character state. Future hooks are allowed only as earned residue, not as a fake unresolved main conflict.
- Information ledger rule: maximum 3 mystery/box-question entries per season. Every box question needs a planned reveal or payoff before introduction. Major payoffs need setup touches planted 3-4 regular episodes ahead or 5-8 sceneEpisodes ahead. The finale should close more major questions than it opens.
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
        encounters.push({
          id: `enc-${epNum}-${i + 1}`,
          type: encounterTypes[typeIdx],
          description: `${encounterTypes[typeIdx]} encounter in "${ep.title}"`,
          difficulty,
          npcsInvolved: ep.mainCharacters.slice(0, 2),
          stakes: ep.narrativeFunction.conflict,
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
      const anchors = (guidance.encounterAnchors && guidance.encounterAnchors.length > 0)
        ? guidance.encounterAnchors
        : [
            guidance.forcedChoice,
            guidance.obstacle,
            guidance.dramaticQuestion,
            guidance.entryGoal,
          ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, 1);
      if (anchors.length > 0) {
        merged.episodeEncounters![epKey] = anchors.map((anchor, index) => ({
          id: `treatment-enc-${ep.episodeNumber}-${index + 1}`,
          type: this.inferEncounterType(anchor, analysis.genre),
          description: guidance.encounterCentralConflict
            ? `${anchor} Central conflict: ${guidance.encounterCentralConflict}`
            : guidance.forcedChoice
              ? `${anchor} Forced choice: ${guidance.forcedChoice}`
            : anchor,
          difficulty: this.inferEncounterDifficulty(ep.episodeNumber, analysis.totalEstimatedEpisodes),
          npcsInvolved: ep.mainCharacters,
          stakes: guidance.stakesLayers?.join(' | ') || guidance.encounterCentralConflict || guidance.episodePromise || ep.narrativeFunction.conflict,
          centralConflict: guidance.encounterCentralConflict || guidance.dramaticQuestion || guidance.obstacle,
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
        }));
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
      difficultyCurve?: any[];
      episodeEndingRoutes?: Record<number | string, any[]>;
      episodeCliffhangers?: Record<number | string, Partial<CliffhangerPlan>>;
    },
    preferences?: SeasonPlannerInput['preferences']
  ): SeasonPlan {
    const now = new Date();
    const planId = `season-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const isSceneEpisodes = preferences?.episodeStructureMode === 'sceneEpisodes';
    const encounterCadence = Math.max(1, preferences?.sceneEpisodeEncounterCadence || 6);

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
        episodeEncountersMap[epNum] = encounters.map((enc: any) => ({
          id: enc.id || `enc-${epNum}-${Math.random().toString(36).substr(2, 6)}`,
          type: (enc.type || 'mixed') as EncounterCategory,
          description: enc.description || 'Encounter',
          difficulty: enc.difficulty || 'moderate',
          npcsInvolved: enc.npcsInvolved || [],
          stakes: enc.stakes || '',
          centralConflict: enc.centralConflict || undefined,
          aftermathConsequence: enc.aftermathConsequence || undefined,
          relevantSkills: enc.relevantSkills || [],
          encounterBuildup: enc.encounterBuildup || '',
          encounterSetupContext: Array.isArray(enc.encounterSetupContext) ? enc.encounterSetupContext : undefined,
          isBranchPoint: !!enc.isBranchPoint,
          branchOutcomes: enc.branchOutcomes || undefined,
        }));
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
    if (isSceneEpisodes) {
      for (const branch of crossEpisodeBranches) {
        for (const path of branch.paths) {
          const routeFlag = this.buildSceneEpisodeRouteFlag(branch.id, path.id);
          if (seasonFlags.some((f: any) => f.flag === routeFlag)) continue;
          seasonFlags.push({
            flag: routeFlag,
            description: `Route flag for ${branch.name} / ${path.name}; origin choices set exactly one sibling route flag.`,
            setInEpisode: branch.originEpisode,
            checkedInEpisodes: [
              ...path.affectedEpisodes.map(affected => affected.episodeNumber),
              ...(branch.reconvergence?.episodeNumber ? [branch.reconvergence.episodeNumber] : []),
            ],
          });
        }
      }
    }

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

    if (isSceneEpisodes) {
      for (const ep of analysis.episodeBreakdown) {
        const isMilestone = ep.episodeNumber % encounterCadence === 0;
        const hasAuthoredTreatmentEncounter = Boolean(ep.treatmentGuidance && episodeEncountersMap[ep.episodeNumber]?.length);
        if (!isMilestone && !hasAuthoredTreatmentEncounter) {
          episodeEncountersMap[ep.episodeNumber] = [];
          continue;
        }
        if (!episodeEncountersMap[ep.episodeNumber]?.length) {
          episodeEncountersMap[ep.episodeNumber] = [{
            id: `scene-episode-milestone-${ep.episodeNumber}`,
            type: 'dramatic',
            description: `Milestone confrontation for "${ep.title}"`,
            difficulty: ep.episodeNumber >= analysis.totalEstimatedEpisodes ? 'extreme' : 'hard',
            npcsInvolved: ep.mainCharacters.slice(0, 3),
            stakes: ep.narrativeFunction?.conflict || ep.synopsis,
            relevantSkills: [],
            encounterBuildup: `Prior scene-length episodes escalate into the milestone confrontation in "${ep.title}".`,
            isBranchPoint: false,
          }];
        }
      }
    }

    // Calculate total encounter count
    let totalEncounters = 0;
    const typeDistribution: Record<string, number> = {};
    for (const encounters of Object.values(episodeEncountersMap)) {
      totalEncounters += encounters.length;
      for (const enc of encounters) {
        typeDistribution[enc.type] = (typeDistribution[enc.type] || 0) + 1;
      }
    }

    // Build the season's structuralRole map. Prefer the structuralRole
    // already present on each EpisodeOutline (set by SourceMaterialAnalyzer
    // when the source material implied one). Otherwise use the default
    // distribution so the SevenPointCoverageValidator sees full coverage.
    const defaultDistribution = distributeSevenPoints(analysis.totalEstimatedEpisodes);
    const structuralRoleByEpisode = new Map<number, StructuralRole[]>();
    for (const entry of defaultDistribution) {
      structuralRoleByEpisode.set(entry.episodeNumber, [...entry.structuralRole]);
    }
    for (const ep of analysis.episodeBreakdown) {
      if (ep.structuralRole && ep.structuralRole.length > 0) {
        structuralRoleByEpisode.set(ep.episodeNumber, [...ep.structuralRole]);
      }
    }

    // 1.5: a PARTIAL LLM-authored distribution can drop a canonical 7-point beat
    // (e.g. no episode keeps `climax`, leaving the finale without one). Run the
    // coverage check that already exists but was never called, and backfill any
    // missing canonical beat onto the episode the default distribution assigns
    // it — feeding the result back into the map instead of discarding it.
    backfillMissingBeats(structuralRoleByEpisode, defaultDistribution);

    // Step 1.2 (defensive second pass): the LLM planner output can re-introduce
    // beat drift via per-episode structuralRole. Reconcile the assembled map
    // against the authored Section-7 anchors — the anchor wins, conflicts are
    // logged, and in strict mode a conflict throws. Mirrors the reconciliation
    // SourceMaterialAnalyzer already ran on the analysis upstream.
    const beatAnchors = analysis.treatmentSeasonGuidance?.beatEpisodeAnchors;
    if (beatAnchors) {
      const reconcilable = [...structuralRoleByEpisode.entries()].map(([episodeNumber, structuralRole]) => ({
        episodeNumber,
        structuralRole,
      }));
      reconcileBeatAnchors(reconcilable, beatAnchors, {
        strict: preferences?.strictTreatmentValidation ?? false,
        log: (message) => console.warn(`[SeasonPlannerAgent] Beat-anchor reconciliation: ${message}`),
      });
      for (const entry of reconcilable) {
        structuralRoleByEpisode.set(entry.episodeNumber, entry.structuralRole ?? []);
      }
    }

    // Build SeasonEpisode objects with encounter data
    const episodes: SeasonEpisode[] = analysis.episodeBreakdown.map(ep => {
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
      const routeMeta = ep.routeMeta || {
        kind: 'master' as const,
        spineIndex: ep.episodeNumber,
        displayLabel: `${ep.episodeNumber}`,
        isMilestoneEncounter: isSceneEpisodes && ep.episodeNumber % encounterCadence === 0,
      };
      
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

      const structuralRole = structuralRoleByEpisode.get(ep.episodeNumber)
        ?? ep.structuralRole
        ?? (defaultDistribution.find((e) => e.episodeNumber === ep.episodeNumber)?.structuralRole ?? []);
      const fallbackCliffhanger = buildDefaultCliffhangerPlan({
        episode: { ...ep, structuralRole },
        totalEpisodes: analysis.totalEstimatedEpisodes,
        seasonStakes: analysis.anchors?.stakes,
        nextEpisodeTitle: analysis.episodeBreakdown.find(e => e.episodeNumber === ep.episodeNumber + 1)?.title,
      });
      const cliffhangerPlan = normalizeCliffhangerPlan(
        episodeCliffhangerMap[ep.episodeNumber],
        fallbackCliffhanger,
      );
      const mappedRole = selectMappedStructuralRole(structuralRole, ep.episodeNumber);
      if (shouldForceHighIntensityHook(ep.episodeNumber, analysis.totalEstimatedEpisodes, mappedRole)) {
        cliffhangerPlan.intensity = 'high';
        cliffhangerPlan.mappedStructuralRole = mappedRole;
        if (cliffhangerPlan.type === 'mystery') {
          cliffhangerPlan.type = mappedRole === 'midpoint' ? 'reframe' : 'emotional_hook';
        }
      }

      return {
        ...ep,
        episodeStructureMode: isSceneEpisodes ? 'sceneEpisodes' as const : ep.episodeStructureMode,
        routeMeta,
        structuralRole,
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

    const routedEpisodes = isSceneEpisodes
      ? this.expandSceneEpisodeRouteEpisodes(episodes, crossEpisodeBranches, {
          minLength: preferences?.sceneEpisodeBranchMinEpisodes || 1,
          maxLength: preferences?.sceneEpisodeBranchMaxEpisodes || 2,
        })
      : episodes;

    // Build arcs from LLM output or source analysis. Each arc receives a
    // `beats` array computed from the structuralRoles that fall inside its
    // episodeRange — this makes it easy for downstream agents (validators,
    // UI, checkpoint review) to answer "which beats does this arc own?"
    // without recomputing from the per-episode map.
    const arcs: SeasonArc[] = (planData.arcs || analysis.storyArcs.map(arc => ({
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
      const beats: StructuralRole[] = [];
      if (authoredArc.episodeRange) {
        for (let epNum = authoredArc.episodeRange.start; epNum <= authoredArc.episodeRange.end; epNum++) {
          const roles = structuralRoleByEpisode.get(epNum) || [];
          for (const r of roles) {
            if (r !== 'rising' && r !== 'falling' && !beats.includes(r)) beats.push(r);
          }
        }
      }
      return {
        ...authoredArc,
        id: authoredArc.id || `arc-${authoredArc.episodeRange?.start || 1}-${authoredArc.episodeRange?.end || analysis.totalEstimatedEpisodes}`,
        name: authoredArc.name || `Arc ${authoredArc.episodeRange?.start || 1}-${authoredArc.episodeRange?.end || analysis.totalEstimatedEpisodes}`,
        description: authoredArc.description || `Episodes ${authoredArc.episodeRange?.start || 1}-${authoredArc.episodeRange?.end || analysis.totalEstimatedEpisodes}`,
        episodeRange: authoredArc.episodeRange || { start: 1, end: analysis.totalEstimatedEpisodes },
        keyMoments: authoredArc.keyMoments || [],
        status: 'not_started' as const,
        completionPercentage: 0,
        beats: beats.length > 0 ? beats : undefined,
        ...this.normalizeArcPressureArchitecture(authoredArc as SeasonArc, analysis, episodes, beats),
      };
    });

    const seasonPromiseArchitecture = this.normalizeSeasonPromiseArchitecture(
      planData.seasonPromiseArchitecture,
      analysis,
      routedEpisodes,
    );
    const seasonPromiseContracts = buildSeasonPromiseContracts({
      guidance: analysis.treatmentSeasonGuidance,
      architecture: seasonPromiseArchitecture,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentSeasonGuidance),
    });
    const characterTreatmentContracts = analysis.characterTreatmentContracts ?? [];
    const worldTreatmentContracts = analysis.worldTreatmentContracts ?? [];
    const stakesArchitectureContracts = analysis.stakesArchitectureContracts ?? buildStakesArchitectureContracts({
      guidance: analysis.treatmentSeasonGuidance,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentSeasonGuidance?.stakesArchitecture),
    });
    const sevenPointBeatContracts = analysis.sevenPointBeatContracts ?? buildSevenPointBeatContracts({
      guidance: analysis.treatmentSeasonGuidance,
      sevenPoint: analysis.sevenPoint,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentSeasonGuidance?.seasonSpine),
    });
    const arcPressureContracts = analysis.arcPressureContracts ?? buildArcPressureContracts({
      guidance: analysis.treatmentSeasonGuidance,
      arcs,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentSeasonGuidance?.arcGuidance?.arcs?.length),
    });
    const branchConsequenceContracts = analysis.branchConsequenceContracts ?? buildBranchConsequenceContracts({
      branches: analysis.treatmentBranches,
      endings: analysis.resolvedEndings,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentBranches?.length),
    });
    const endingRealizationContracts = analysis.endingRealizationContracts ?? buildEndingRealizationContracts({
      endings: analysis.resolvedEndings,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || (analysis.resolvedEndings || []).some((ending) => ending.sourceConfidence === 'explicit'),
      branchContracts: branchConsequenceContracts,
    });
    const failureModeAuditContracts = analysis.failureModeAuditContracts ?? buildFailureModeAuditContracts({
      guidance: analysis.treatmentSeasonGuidance,
      totalEpisodes: routedEpisodes.length,
      treatmentSourced: analysis.sourceFormat === 'story_treatment'
        || analysis.treatmentMetadata?.detected
        || Boolean(analysis.treatmentSeasonGuidance?.failureModeAuditGuidance),
      linkedContracts: [
        characterTreatmentContracts,
        worldTreatmentContracts,
        stakesArchitectureContracts,
        sevenPointBeatContracts,
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
      isSceneEpisodes,
    );

    // E1 slice 4: normalize the planner's season-level choice moments.
    const choiceMoments = this.normalizeChoiceMoments(
      (planData as any).choiceMoments,
      routedEpisodes.length,
    );

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
      createdAt: now,
      updatedAt: now,
      analysisVersion: analysis.analysisTimestamp?.toISOString() || now.toISOString(),
      seasonTitle: planData.seasonTitle || `${analysis.sourceTitle}: Season 1`,
      seasonSynopsis: planData.seasonSynopsis || `An interactive adaptation spanning ${routedEpisodes.length} episodes.`,
      totalEpisodes: routedEpisodes.length,
      estimatedTotalDuration: `${routedEpisodes.length * 3}-${routedEpisodes.length * 8} minutes`,
      genre: analysis.genre,
      tone: analysis.tone,
      themes: analysis.themes,
      arcs,
      anchors: analysis.anchors,
      sevenPoint: analysis.sevenPoint,
      seasonPromiseArchitecture,
      seasonPromiseContracts,
      stakesArchitectureContracts,
      sevenPointBeatContracts,
      arcPressureContracts,
      branchConsequenceContracts,
      endingRealizationContracts,
      failureModeAuditContracts,
      characterTreatmentContracts,
      worldTreatmentContracts,
      informationLedger,
      choiceMoments,
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
        targetScenesPerEpisode: isSceneEpisodes ? 1 : clampSceneCount(preferences?.targetScenesPerEpisode || 6),
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

    // Run the 7-point coverage validator. Issues are accumulated into plan.warnings here
    // for the diagnostics trail; the actual BLOCKING enforcement (tier 1) happens in
    // execute() after the plan is built (it throws on error-severity coverage issues unless
    // sevenPointBlocking is opted out). Keeping the warning-collection here means the trail
    // is populated even when the gate is disabled.
    const coverageResult = new SevenPointCoverageValidator().validate(
      seasonPlanToCoverageInput(plan),
    );
    for (const warning of this.validateTreatmentHandoff(analysis, plan)) {
      plan.warnings.push(warning);
    }
    for (const issue of coverageResult.issues) {
      plan.warnings.push(`[SevenPointCoverage:${issue.severity}] ${issue.message}`);
    }
    const arcPressureResult = new ArcPressureArchitectureValidator().validate(plan, {
      episodeStructureMode: isSceneEpisodes ? 'sceneEpisodes' : 'standard',
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
    const informationResult = new InformationLedgerValidator().validate(plan, {
      episodeStructureMode: isSceneEpisodes ? 'sceneEpisodes' : 'standard',
    });
    for (const issue of informationResult.issues) {
      plan.warnings.push(`[InformationLedger:${issue.severity}] ${issue.message}`);
    }

    // Scene-first planning: enumerate scenes (encounters included) at the season
    // level and attach the spine to the plan + each episode's slice. Default-off;
    // auto-on for authored sceneEpisodes treatments. When off, downstream falls
    // back to per-episode scene invention in StoryArchitect.
    if (isSceneFirstPlanningEnabled(isSceneEpisodes ? 'sceneEpisodes' : 'standard')) {
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
    }

    return plan;
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
    isSceneEpisodes: boolean,
  ): InformationLedgerEntry[] {
    const totalEpisodes = Math.max(1, episodes.length || analysis.totalEstimatedEpisodes);
    const finaleEpisode = episodes[episodes.length - 1]?.episodeNumber || totalEpisodes;
    const targetRunway = isSceneEpisodes ? 5 : 3;
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
      ? Math.max(range.start, Math.min(range.end, Math.round(range.start + Math.max(1, range.end - range.start) * (2 / 3))))
      : rawArc.lateArcCrisis?.episodeNumber;
    const turnouts = guidance.episodeTurnouts?.map((turnout) => ({
      episodeNumber: turnout.episodeNumber,
      turnType: this.normalizeAuthoredArcTurnoutType(turnout.turnType),
      description: turnout.description || turnout.sourceText,
      leavesProtagonistWith: turnout.description || turnout.sourceText,
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

  private normalizeArcPressureArchitecture(
    rawArc: Partial<SeasonArc>,
    analysis: SourceMaterialAnalysis,
    episodes: SeasonEpisode[],
    beats: StructuralRole[],
  ): Pick<
    SeasonArc,
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
      const turnType = existing?.turnType || this.inferArcTurnoutType(episode, anchors);
      const cliffhanger = episode.cliffhangerPlan;
      return {
        episodeNumber: episode.episodeNumber,
        turnType,
        description: existing?.description
          || cliffhanger?.hook
          || episode.narrativeFunction?.conflict
          || episode.synopsis
          || `Episode ${episode.episodeNumber} turns the arc.`,
        leavesProtagonistWith: existing?.leavesProtagonistWith
          || cliffhanger?.nextEpisodePressure
          || cliffhanger?.emotionalCharge
          || episode.narrativeFunction?.resolution
          || `New consequence residue from Episode ${episode.episodeNumber}.`,
        whyThisCannotMoveLater: existing?.whyThisCannotMoveLater
          || `Episode ${episode.episodeNumber}'s turnout follows from its setup, structural role, and cliffhanger pressure; moving it later would break causal order.`,
      };
    });
  }

  private inferArcTurnoutType(
    episode: SeasonEpisode,
    anchors: { start: number; end: number; midpointEpisode: number; crisisEpisode: number },
  ): ArcEpisodeTurnoutType {
    if (episode.episodeNumber === anchors.start) return 'setup';
    if (episode.episodeNumber === anchors.end) return anchors.end === anchors.start ? 'finale' : 'finale';
    if (episode.episodeNumber === anchors.midpointEpisode || episode.structuralRole?.includes('midpoint')) return 'recontextualization';
    if (episode.episodeNumber === anchors.crisisEpisode || episode.structuralRole?.includes('pinch2')) return 'crisis';
    if (episode.structuralRole?.includes('pinch1')) return 'cost';
    if (episode.structuralRole?.includes('plotTurn1')) return 'choice';
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

  private expandSceneEpisodeRouteEpisodes(
    masterEpisodes: SeasonEpisode[],
    crossEpisodeBranches: CrossEpisodeBranch[],
    options: { minLength: number; maxLength: number }
  ): SeasonEpisode[] {
    if (crossEpisodeBranches.length === 0) {
      return masterEpisodes.map((episode, index) => ({
        ...episode,
        episodeNumber: index + 1,
        estimatedSceneCount: 1,
        episodeStructureMode: 'sceneEpisodes' as const,
        routeMeta: {
          ...(episode.routeMeta || {}),
          kind: 'master' as const,
          spineIndex: episode.routeMeta?.spineIndex || episode.episodeNumber,
          displayLabel: episode.routeMeta?.displayLabel || `${episode.routeMeta?.spineIndex || episode.episodeNumber}`,
        },
      }));
    }

    const branchesByOrigin = new Map<number, CrossEpisodeBranch[]>();
    for (const branch of crossEpisodeBranches) {
      const list = branchesByOrigin.get(branch.originEpisode) || [];
      list.push(branch);
      branchesByOrigin.set(branch.originEpisode, list);
    }

    const masterBySpine = new Map<number, SeasonEpisode>();
    for (const episode of masterEpisodes) {
      masterBySpine.set(episode.routeMeta?.spineIndex || episode.episodeNumber, episode);
    }
    const maxSpine = Math.max(...masterEpisodes.map(episode => episode.routeMeta?.spineIndex || episode.episodeNumber));
    const routed: SeasonEpisode[] = [];
    let runtimeEpisodeNumber = 1;

    for (const master of masterEpisodes) {
      const spineIndex = master.routeMeta?.spineIndex || master.episodeNumber;
      const runtimeMasterNumber = runtimeEpisodeNumber++;
      routed.push({
        ...master,
        episodeNumber: runtimeMasterNumber,
        estimatedSceneCount: 1,
        episodeStructureMode: 'sceneEpisodes' as const,
        routeMeta: {
          ...(master.routeMeta || {}),
          kind: 'master' as const,
          spineIndex,
          displayLabel: master.routeMeta?.displayLabel || `${spineIndex}`,
        },
      });

      const originBranches = branchesByOrigin.get(spineIndex) || [];
      for (const branch of originBranches) {
        const rejoinSpine = branch.reconvergence?.episodeNumber || Math.min(maxSpine, spineIndex + options.maxLength + 1);
        branch.paths.forEach((path, pathIndex) => {
          const affectedEpisodes = path.affectedEpisodes || [];
          const pathLength = Math.max(
            options.minLength,
            Math.min(options.maxLength, affectedEpisodes.length || options.minLength)
          ) as 1 | 2;
          const displayLetter = String.fromCharCode(65 + pathIndex);
          const routeFlag = this.buildSceneEpisodeRouteFlag(branch.id, path.id);

          for (let step = 1; step <= pathLength; step++) {
            const affected = affectedEpisodes[step - 1];
            const sourceSpine = affected?.episodeNumber || Math.min(rejoinSpine - 1, spineIndex + step);
            const sourceEpisode = masterBySpine.get(sourceSpine) || master;
            routed.push({
              ...sourceEpisode,
              episodeNumber: runtimeEpisodeNumber++,
              title: `${path.name}: ${sourceEpisode.title}`,
              synopsis: affected?.description || path.condition || sourceEpisode.synopsis,
              estimatedSceneCount: 1,
              estimatedChoiceCount: Math.max(1, sourceEpisode.estimatedChoiceCount || 1),
              plannedEncounters: [],
              episodeStructureMode: 'sceneEpisodes' as const,
              routeMeta: {
                kind: 'branch' as const,
                spineIndex,
                branchGroupId: branch.id,
                branchPathId: path.id,
                branchStep: step,
                branchLength: pathLength,
                rejoinsAtSpineIndex: rejoinSpine,
                displayLabel: `${spineIndex}${displayLetter}${pathLength > 1 ? `-${step}` : ''}`,
                hideWhenInactive: true,
              },
              unlockConditions: {
                type: 'flag' as const,
                flag: routeFlag,
                value: true,
              },
              outgoingBranches: undefined,
              incomingBranches: [branch.id],
              checksFlags: [
                ...(sourceEpisode.checksFlags || []),
                {
                  flag: routeFlag,
                  ifTrue: `Player is on ${path.name}.`,
                  ifFalse: `Player is not on ${path.name}.`,
                },
              ],
              dependsOn: [runtimeMasterNumber],
              setupsForEpisodes: [rejoinSpine],
              resolvesPlotsFrom: [runtimeMasterNumber],
            } as SeasonEpisode);
          }
        });
      }
    }

    return routed;
  }

  private buildSceneEpisodeRouteFlag(branchId: string, pathId: string): string {
    return `route_${branchId}_${pathId}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
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
