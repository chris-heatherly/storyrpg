/**
 * Content Generation Phase
 *
 * Phase 4 of story generation — the scene/choice/encounter authoring loop.
 * This is the coherence-critical core of the pipeline: the order in which it
 * assembles LLM-visible context (episode plant context, callback
 * orchestration, thread/twist directives, prevention context, season canon,
 * scene handoffs) IS the story-quality contract.
 *
 * Faithful port of FullStoryPipeline.runContentGeneration (pure move): same
 * prompts, same call order, same events, same repair/fallback chains. The
 * monolith keeps a thin delegating runContentGeneration so both call sites
 * (generate() and the multi-episode generateEpisodeFromOutline) are
 * unchanged. Run-scoped state is accessor-backed; helpers shared with other
 * monolith regions are injected as closures. Verified byte-identical against
 * all three prompt-snapshot goldens (linear / branching+encounter / season).
 */

import { DEFAULT_SKILLS } from '../../../constants/pipeline';
import { buildForbiddenReveals } from '../../utils/forbiddenReveals';
import { BEST_OF_N_DEFAULTS, INCREMENTAL_VALIDATION_DEFAULTS } from '../../../constants/validation';
import { GrowthCurveEntry, buildGrowthTemplates } from '../../../engine/growthConsequenceBuilder';
import { ThreadLedger } from '../../../types/narrativeThread';
import { AgentResponse } from '../../agents/BaseAgent';
import { BranchAnalysis, ReconvergencePoint } from '../../agents/BranchManager';
import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceAuthor, ChoiceAuthorInput, ChoiceSet } from '../../agents/ChoiceAuthor';
import {
  EncounterArchitect,
  EncounterArchitectInput,
  EncounterStructure,
  EncounterTelemetry,
} from '../../agents/EncounterArchitect';
import { GeneratedBeat, SceneContent, SceneWriter } from '../../agents/SceneWriter';
import { EpisodeBlueprint, SceneBlueprint } from '../../agents/StoryArchitect';
import { TwistPlan } from '../../agents/TwistArchitect';
import { WorldBible } from '../../agents/WorldBuilder';
import { RemediationBudget, shouldAttemptRemediation } from '../../remediation/RemediationBudget';
import { gateEnabledPredicate, isGateEnabled } from '../../remediation/gateDefaults';
import {
  improvesMissingRealization,
  insertMissingMomentBeats,
  missingRequiredMoments,
  realizationRetryFeedback,
  rewriteLosesRequiredMoment,
} from '../../remediation/sceneRealizationGuard';
import { RemediationLedgerRecord } from '../../remediation/remediationLedger';
import { isChoiceRegenImprovement, shouldRegenChoices } from '../../remediation/regenChoicesPolicy';
import { resolveCharacterProfile } from '../../utils/characterProfileResolver';
import { buildSceneDependencyGraph, buildTopologicalWaves } from '../../utils/dependencyGraph';
import { slugify as idSlugify } from '../../utils/idUtils';
import { forbiddenNpcNames, introducedNpcIds } from '../../utils/npcIntroductionLedger';
import { saveEarlyDiagnostic } from '../../utils/pipelineOutputWriter';
import { buildSceneTimelineHandoff } from '../../utils/sceneTimeline';
import { StoryVerb } from '../../utils/storyVerbs';
import { PIPELINE_TIMEOUTS, withTimeout } from '../../utils/withTimeout';
import {
  CharacterVoiceProfile,
  FinalStoryContractValidator,
  IncrementalValidationRunner,
  SceneGraphBranchValidator,
  SceneValidationResult,
  aggregateValidationResults,
} from '../../validators';
import { scanEncounterTemplateProse } from '../../validators/EncounterQualityValidator';
import { CallbackLedger } from '../callbackLedger';
import { UnresolvedCallbackForPrompt, recordScenePayoffs } from '../callbackOrchestration';
import { capabilityNoteForProfile } from '../characterCanonFacts';
import { repairBranchFanOut } from '../choiceAssembly';
import { assignChoiceTypes } from '../choiceTypePlanner';
import {
  EpisodePlant,
  emitSceneBranchAxes,
  emitSceneInfoReveals,
  emitSceneTreatmentSeeds,
  extractBranchResidueFromChoiceSet,
  extractPlantsFromChoiceSet,
  extractTintPlantsFromChoiceSet,
  mergeUnresolvedForScene,
  resolveSceneBranchAxes,
  resolveSceneTreatmentSeeds,
} from '../episodePlantContext';
import { PipelineError } from '../errors';
import { isEncounterNarrativelyHollow } from '../encounterCompleteness';
import { filterProtagonistEncounterRefs } from '../encounterParticipants';
import { GenerationPlan, markSceneActive, setSceneBeats } from '../generationPlan';
import { buildOutcomeTextVariants } from '../outcomeVariants';
import { buildSceneSettingContext } from '../planningHelpers';
import { attachResidueRequirements } from '../reconvergenceResidue';
import { buildContinueInLocation, buildPriorEncounterOutcomes } from '../scenePreventionContext';
import { plannedConsequenceTiersByScene } from '../plannedSceneBudgets';
import { SeasonChoicePlan, episodeTypeCounts } from '../seasonChoicePlan';
import {
  SeasonSkillPlan,
  buildSeasonSkillPlan,
  skillsForEpisode,
  validateSeasonSkillPlan,
} from '../seasonSkillPlan';
import {
  ThreadPlannerLike,
  TwistArchitectLike,
  isThreadTwistPlanningEnabled,
  mergeIntoSeasonLedger,
  openPriorThreads,
  planEpisodeThreadsAndTwist,
  sceneActiveThreads,
  sceneTwistDirectives,
} from '../threadTwistPlanning';
import {
  CharacterArcTrackerLike,
  isCharacterArcTrackingEnabled,
  planEpisodeArcTargets,
  toChoiceAuthorArcTargets,
} from '../characterArcPlanning';
import type { CharacterArcTargets } from '../../agents/CharacterArcTracker';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// DEPENDENCY TYPES
// ========================================

/**
 * Everything the phase still borrows from the monolith. Agent instances are
 * passed by reference so config/telemetry stay shared with the rest of the
 * run; run-scoped state is accessor-backed (reads always see the monolith's
 * current values, and the fields this phase ASSIGNS — incrementalValidator,
 * sceneValidationResults, seasonSkillPlan, encounterTelemetry — are wired
 * with setters); helpers shared with other monolith regions are injected as
 * closures.
 */
export interface ContentGenerationPhaseDeps {
  // --- Agents ---
  sceneWriter: Pick<SceneWriter, 'execute'>;
  choiceAuthor: Pick<ChoiceAuthor, 'execute' | 'setEpisodeSkillTargets'>;
  encounterArchitect: Pick<EncounterArchitect, 'execute'>;
  getThreadPlanner: () => ThreadPlannerLike;
  getTwistArchitect: () => TwistArchitectLike;
  getCharacterArcTracker: () => CharacterArcTrackerLike;

  // --- Run-scoped state (accessor-backed) ---
  /** Assigned by this phase (fresh runner per episode). */
  incrementalValidator: IncrementalValidationRunner | null;
  /** Reset by this phase at episode start, appended via recordSceneValidationResult. */
  sceneValidationResults: SceneValidationResult[];
  /** Built lazily by this phase from the season plan. */
  seasonSkillPlan: SeasonSkillPlan | undefined;
  /** Reset by this phase at episode start, appended via captureEncounterTelemetry. */
  encounterTelemetry: EncounterTelemetry[];
  readonly cachedPipelineMemory: string | null;
  readonly callbackLedger: CallbackLedger;
  readonly dependencySchedulerStats: { hasCycle: boolean; waveCount: number; fallbackToSerial: boolean };
  readonly episodeArcTargets: Map<number, CharacterArcTargets>;
  readonly episodeTwistPlans: Map<number, TwistPlan>;
  readonly generationPlan: GenerationPlan | null;
  readonly remediationBudget: RemediationBudget | null;
  readonly seasonChoicePlan: SeasonChoicePlan | undefined;
  readonly seasonThreadLedger: ThreadLedger;

  // --- Helpers shared with other monolith regions (injected closures) ---
  assertSceneDependencyInvariants: (blueprint: EpisodeBlueprint, sceneContents: SceneContent[]) => void;
  buildBranchFallbackChoiceSet: (
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat | undefined
  ) => ChoiceSet | undefined;
  /**
   * A minimal deterministic choice set for a single-target (non-branch) scene
   * whose ChoiceAuthor failed. Unlike {@link buildBranchFallbackChoiceSet} this
   * does NOT require ≥2 leadsTo targets, so a seed-bearing choice point still
   * gets choices it can plant its on-page contract onto. Returns undefined when
   * there is no choice-point beat to anchor to.
   */
  buildDeterministicChoiceSet: (
    sceneBlueprint: SceneBlueprint,
    choiceBeat: GeneratedBeat | undefined
  ) => ChoiceSet | undefined;
  buildChoiceAuthorNpcs: (
    npcIds: string[],
    characterBible: CharacterBible
  ) => Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    voiceNotes?: string;
    physicalDescription?: string;
  }>;
  buildCompactWorldContext: (worldBible: WorldBible, locationDescription?: string) => string;
  buildEncounterPriorStateContext: (
    encounterScene: SceneBlueprint,
    blueprint: EpisodeBlueprint,
    npcsInvolved: Array<{ id: string; name: string }>,
    currentSetFlags?: ReadonlySet<string>
  ) => EncounterArchitectInput['priorStateContext'];
  captureEncounterTelemetry: (metadata: Record<string, unknown> | undefined, sceneId?: string) => void;
  checkCancellation: () => Promise<void>;
  deriveStoryVerbsForBrief: (
    brief: FullCreativeBrief,
    worldBible?: WorldBible
  ) => StoryVerb[];
  emitPhaseProgress: (
    phase: string,
    done: number,
    total: number,
    source: string,
    message?: string
  ) => void;
  emitPlanUpdate: (message: string) => void;
  episodeCheckpointFile: (episodeNumber: number, kind: string, id?: string) => string;
  establishedCanonForPrompt: (episodeNumber?: number) => string | undefined;
  getPhase4DefaultCollisions: (metadata: Record<string, unknown> | undefined) => string[];
  getTargetBeatCountForScene: (sceneBlueprint: SceneBlueprint) => number;
  getUnresolvedCallbacksForPrompt: (
    episodeNumber: number | undefined
  ) => UnresolvedCallbackForPrompt[] | undefined;
  inferBranchType: (
    sceneBlueprint: SceneBlueprint,
    blueprint: EpisodeBlueprint
  ) => 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  isEpisodeFinalScene: (scene: SceneBlueprint, blueprint: EpisodeBlueprint) => boolean;
  loadResumeUnit: <T>(
    outputDirectory: string | undefined,
    unitId: string,
    artifactPath: string
  ) => T | undefined;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string }
  ) => Promise<void>;
  recordSceneValidationResult: (result: SceneValidationResult) => void;
  repairSceneEpisodePlayableContract: (
    sceneBlueprint: SceneBlueprint,
    content: SceneContent,
    choiceSets: ChoiceSet[],
    context: { phase: string }
  ) => void;
  resolveWorldLocationForScene: (
    sceneBlueprint: Pick<SceneBlueprint, 'location' | 'name' | 'description'>,
    worldBible: WorldBible
  ) => WorldBible['locations'][number] | undefined;
  runSceneCriticPass: (sceneContents: SceneContent[], characterBible: CharacterBible) => Promise<void>;
  sanitizeReaderFacingSceneName: (name: string | undefined, fallback?: string) => string;
  saveResumeUnit: <T>(
    outputDirectory: string | undefined,
    unitId: string,
    artifactPath: string,
    data: T
  ) => Promise<void>;
  throwIfFailFast: (
    message: string,
    phase: string,
    options?: {
      agent?: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    }
  ) => void;
  trackEncounterFlagConsequences: (encounter: EncounterStructure) => void;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class ContentGenerationPhase {
  readonly name = 'content_generation';

  constructor(private readonly deps: ContentGenerationPhaseDeps) {}

  async run(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    branchAnalysis: BranchAnalysis | undefined,
    outputDirectory: string | undefined,
    episodeNumber: number | undefined,
    context: PipelineContext
  ): Promise<{ sceneContents: SceneContent[]; choiceSets: ChoiceSet[]; encounters: Map<string, EncounterStructure> }> {
    const sceneContents: SceneContent[] = [];
    const choiceSets: ChoiceSet[] = [];
    // Phase 1 (Season Canon): flags planted by EARLIER scenes this episode, fed
    // to LATER scenes so SceneWriter can author within-episode callback payoffs.
    const episodePlants: EpisodePlant[] = [];
    const encounters: Map<string, EncounterStructure> = new Map();

    // Fix 3: re-assert the choice-type plan on the blueprint THIS loop iterates.
    // assignChoiceTypes also runs right after StoryArchitect, but choicePoint.type
    // can be lost before here (clone / checkpoint reload), leaving ChoiceAuthor with
    // no planned type to honor (observed: relationship 0 / strategic 0). Re-running on
    // the loop's own blueprint guarantees the type is on the objects ChoiceAuthor reads
    // (Phase D then forces it). Persist the plan so we can tell allocation- from
    // propagation-failures at a glance.
    // E1: re-assert against THIS episode's season-assigned slice (same plan built in
    // runEpisodeArchitecture; the lookup is by episode number so the slice survives a
    // clone/checkpoint reload). Empty slice → default mix.
    const episodeSlice = episodeTypeCounts(this.deps.seasonChoicePlan, episodeNumber ?? 1);
    const choiceTypePlan = assignChoiceTypes(blueprint.scenes as never, undefined, episodeSlice);
    const plannedConsequenceTiers = plannedConsequenceTiersByScene(brief.seasonPlan);

    // P2-skills: bias this episode's stat-check skill assignment toward the season
    // skill plan so the season exercises >=6 of the 8 skills with no >30% dominance.
    // Built once from the season's episode set; ChoiceAuthor (a persistent instance)
    // honors the per-episode targets when assigning/rebalancing stat-check skills.
    if (!this.deps.seasonSkillPlan) {
      this.deps.seasonSkillPlan = buildSeasonSkillPlan(
        Array.from(new Set((this.deps.seasonChoicePlan?.moments ?? []).map((m) => m.episode)))
          .filter((n): n is number => typeof n === 'number'),
      );
      // L1 season-coverage guard: the rotation satisfies this by construction, so a
      // failure means a future change regressed the spread. Log (don't throw) so a run
      // is never aborted by a balance-of-skills invariant.
      const skillPlanCheck = validateSeasonSkillPlan(this.deps.seasonSkillPlan);
      if (!skillPlanCheck.valid) {
        context.emit({
          type: 'warning',
          phase: 'content_generation',
          message: `Season skill plan failed its coverage invariant: ${skillPlanCheck.issues.join('; ')}`,
          data: { coveredSkills: skillPlanCheck.coveredSkills },
        });
      }
    }
    this.deps.choiceAuthor.setEpisodeSkillTargets(skillsForEpisode(this.deps.seasonSkillPlan, episodeNumber ?? 1));
    if (outputDirectory) {
      await saveEarlyDiagnostic(outputDirectory, 'choice-type-plan.json', {
        generatedAt: new Date().toISOString(),
        episodeNumber,
        assignments: choiceTypePlan,
        seasonSlice: episodeSlice,
        finalTypes: blueprint.scenes
          .filter((s) => s.choicePoint)
          .map((s) => ({ sceneId: s.id, isEncounter: !!s.isEncounter, branches: !!s.choicePoint?.branches, type: s.choicePoint?.type })),
      });
      // E1: persist the whole season choice plan so the "plan up front" is inspectable
      // (which episode owns which typed moments, and which pay off later).
      if (this.deps.seasonChoicePlan) {
        await saveEarlyDiagnostic(outputDirectory, 'season-choice-plan.json', {
          generatedAt: new Date().toISOString(),
          counts: this.deps.seasonChoicePlan.counts,
          moments: this.deps.seasonChoicePlan.moments,
        }).catch(() => undefined);
      }
    }

    // Thread/Twist planning (Phase 5.3 + 6 wiring): author this episode's thread
    // ledger + TwistPlan after the blueprint is final, before scene prose. All logic
    // lives in threadTwistPlanning (monolith ratchet). Default-off; both agents fail open.
    if (isThreadTwistPlanningEnabled(context.config.generation)) {
      const ttEpisode = episodeNumber ?? brief.episode.number;
      const { threadLedger, twistPlan } = await planEpisodeThreadsAndTwist({
        enabled: true,
        threadPlanner: this.deps.getThreadPlanner(),
        twistArchitect: this.deps.getTwistArchitect(),
        episodeBlueprint: blueprint,
        episodeNumber: ttEpisode,
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonSevenPoint: brief.seasonPlan?.sevenPoint,
        episodeStructuralRole: brief.seasonPlan?.episodes.find((e) => e.episodeNumber === ttEpisode)?.structuralRole,
        priorThreads: openPriorThreads(this.deps.seasonThreadLedger, ttEpisode),
        emitWarning: (message) => context.emit({ type: 'warning', phase: 'content', message }),
      });
      if (threadLedger) mergeIntoSeasonLedger(this.deps.seasonThreadLedger, threadLedger, ttEpisode);
      if (twistPlan) this.deps.episodeTwistPlans.set(ttEpisode, twistPlan);
      if (outputDirectory && (threadLedger || twistPlan)) {
        await saveEarlyDiagnostic(outputDirectory, `episode-${ttEpisode}-thread-twist-plan.json`, {
          generatedAt: new Date().toISOString(),
          threadLedger,
          twistPlan,
          seasonThreadCount: this.deps.seasonThreadLedger.threads.length,
        }).catch(() => undefined);
      }
    }

    // Character-arc tracking (WS0 wiring): author this episode's identity/
    // relationship targets after the blueprint is final, before scene prose.
    // All logic lives in characterArcPlanning (monolith ratchet). Default-off;
    // the agent fails open.
    if (isCharacterArcTrackingEnabled(context.config.generation)) {
      const atEpisode = episodeNumber ?? brief.episode.number;
      const { arcTargets } = await planEpisodeArcTargets({
        enabled: true,
        characterArcTracker: this.deps.getCharacterArcTracker(),
        episodeBlueprint: blueprint,
        characterBible,
        seasonArcPlan: brief.seasonPlan,
        episodeIndex: atEpisode,
        totalEpisodes: brief.seasonPlan?.episodes?.length ?? atEpisode,
        seasonAnchors: brief.seasonPlan?.anchors,
        seasonSevenPoint: brief.seasonPlan?.sevenPoint,
        episodeStructuralRole: brief.seasonPlan?.episodes.find((e) => e.episodeNumber === atEpisode)?.structuralRole,
        characterArchitecture: brief.multiEpisode?.sourceAnalysis?.characterArchitecture,
        emitWarning: (message) => context.emit({ type: 'warning', phase: 'content', message }),
      });
      if (arcTargets) {
        this.deps.episodeArcTargets.set(atEpisode, arcTargets);
        if (outputDirectory) {
          await saveEarlyDiagnostic(outputDirectory, `episode-${atEpisode}-arc-targets.json`, {
            generatedAt: new Date().toISOString(),
            arcTargets,
          }).catch(() => undefined);
        }
      }
    }

    // Initialize incremental validation
    const incrementalConfig = {
      ...INCREMENTAL_VALIDATION_DEFAULTS,
      ...brief.options?.incrementalValidation,
    };
    
    // Extract known flags and scores from blueprint
    const knownFlags = blueprint.suggestedFlags?.map(f => f.name) || [];
    const knownScores = blueprint.suggestedScores?.map(s => s.name) || [];
    
    // Extract valid skills for encounter validation
    const validSkills = ['athletics', 'stealth', 'perception', 'persuasion', 'intimidation', 'deception', 'investigation', 'survival'];
    
    this.deps.incrementalValidator = new IncrementalValidationRunner(
      knownFlags,
      knownScores,
      validSkills,
      incrementalConfig
    );

    // Initialize relationship baselines from character bible so the
    // validator can detect unreachable relationship conditions.
    const npcBaselines = characterBible.characters
      .filter(c => c.id !== brief.protagonist.id)
      .map(c => ({
        id: c.id,
        initialRelationship: c.initialStats as Partial<Record<string, number>> | undefined,
      }));
    this.deps.incrementalValidator.setRelationshipBaselines(npcBaselines);
    // Powers the beat-level POV-consistency check (third-person-drift detection).
    this.deps.incrementalValidator.setProtagonistName(brief.protagonist?.name);

    // Reset scene validation results
    this.deps.sceneValidationResults = [];
    // Reset encounter telemetry (I2 — fresh per episode run)
    this.deps.encounterTelemetry = [];
    
    context.emit({
      type: 'debug',
      phase: 'incremental_validation',
      message: `Initialized incremental validation with ${knownFlags.length} flags, ${knownScores.length} scores, ${npcBaselines.length} NPC relationship baselines`,
      data: { config: incrementalConfig },
    });

    // Defense-in-depth: if the LLM set isEncounter but omitted encounterType,
    // auto-assign 'mixed' so the encounter pipeline doesn't silently skip the scene.
    for (const scene of blueprint.scenes) {
      if (scene.isEncounter && !scene.encounterType) {
        scene.encounterType = 'mixed';
        console.warn(`[Pipeline] Scene ${scene.id} has isEncounter=true but missing encounterType — defaulting to 'mixed'`);
        context.emit({ type: 'warning', phase: 'content', message: `Scene ${scene.id} encounter missing encounterType — defaulted to 'mixed'` });
      }
      const originalLeadsTo = [...(scene.leadsTo || [])];
      scene.leadsTo = originalLeadsTo.filter((targetId) => targetId && targetId !== scene.id);
      if (scene.requires?.length) {
        scene.requires = scene.requires.filter((targetId) => targetId && targetId !== scene.id);
      }
      if (originalLeadsTo.length !== scene.leadsTo.length) {
        context.emit({
          type: 'warning',
          phase: 'content',
          message: `Removed self-routing leadsTo from scene ${scene.id} before content generation.`,
        });
      }
      if (scene.choicePoint?.branches && new Set(scene.leadsTo || []).size < 2) {
        scene.choicePoint.branches = false;
        context.emit({
          type: 'warning',
          phase: 'content',
          message: `Removed branches=true from scene ${scene.id}; fewer than two distinct future scene targets remain.`,
        });
      }
    }

    // Phase 1.1: Build a per-scene branch topology index from BranchManager output.
    // This is threaded into SceneWriter and ChoiceAuthor so they know whether a
    // given scene is a bottleneck, branch-only, or reconvergence point, and which
    // state variables need to be acknowledged at reconvergence.
    const branchContextByScene: Map<string, {
      role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear';
      branchPathIds?: string[];
      incomingBranchIds?: string[];
      stateReconciliationNotes?: string[];
      reconvergenceNarrativeAcknowledgment?: string;
    }> = new Map();
    // For branch fan-out repair: scene id -> the authored immediate-next target(s) on
    // each branch path through it, labelled with the path's name/description so an
    // under-fanned branch can be re-routed by AUTHORED INTENT (matching a choice's text
    // to its path), never arbitrarily. Empty when there is no branch analysis.
    const branchTargetHintsByScene = new Map<string, Array<{ target: string; label: string }>>();
    if (branchAnalysis) {
      const bottlenecks = new Set(blueprint.bottleneckScenes || []);
      const branchPathsByScene = new Map<string, string[]>();
      for (const path of branchAnalysis.branchPaths || []) {
        for (const sid of path.sceneSequence || []) {
          const arr = branchPathsByScene.get(sid) || [];
          arr.push(path.id);
          branchPathsByScene.set(sid, arr);
        }
      }
      for (const path of branchAnalysis.branchPaths || []) {
        const seq = path.sceneSequence || [];
        const label = `${path.name || ''} ${path.description || ''}`.trim();
        for (let i = 0; i + 1 < seq.length; i++) {
          const s = seq[i];
          const t = seq[i + 1];
          if (!s || !t || s === t) continue;
          const arr = branchTargetHintsByScene.get(s) || [];
          const existing = arr.find((h) => h.target === t);
          if (existing) existing.label = `${existing.label} ${label}`.trim();
          else arr.push({ target: t, label });
          branchTargetHintsByScene.set(s, arr);
        }
      }
      const reconvMap = new Map<string, ReconvergencePoint>();
      for (const rp of branchAnalysis.reconvergencePoints || []) {
        reconvMap.set(rp.sceneId, rp);
      }
      for (const scene of blueprint.scenes) {
        const paths = branchPathsByScene.get(scene.id) || [];
        const reconv = reconvMap.get(scene.id);
        let role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear' = 'linear';
        if (reconv) role = 'reconvergence';
        else if (bottlenecks.has(scene.id) || scene.purpose === 'bottleneck') role = 'bottleneck';
        else if (paths.length === 1) role = 'branch';
        branchContextByScene.set(scene.id, {
          role,
          branchPathIds: paths,
          incomingBranchIds: reconv?.incomingBranches,
          stateReconciliationNotes: reconv?.stateReconciliation?.map(
            r => `${r.stateVariable}: ${r.howToHandle}`
          ),
          reconvergenceNarrativeAcknowledgment: reconv?.narrativeAcknowledgment,
        });
      }
      // Emit a warning for any branch without reconvergence (branch_topology repair hint).
      const allReconvSceneIds = new Set((branchAnalysis.reconvergencePoints || []).map(r => r.sceneId));
      for (const path of branchAnalysis.branchPaths || []) {
        const endsAt = path.endSceneId;
        const endScene = blueprint.scenes.find(s => s.id === endsAt);
        const endsAtBottleneck = endScene ? (bottlenecks.has(endsAt) || endScene.purpose === 'bottleneck' || (endScene.leadsTo?.length || 0) === 0) : false;
        if (!allReconvSceneIds.has(endsAt) && !endsAtBottleneck) {
          context.emit({
            type: 'warning',
            phase: 'branch_topology',
            message: `Branch "${path.id}" ends at scene ${endsAt} without reconvergence; consider adding a bottleneck or reconvergence point`,
            data: { branchId: path.id, endSceneId: endsAt },
          });
        }
      }
    }

    // WS2a (reconvergence residue by construction): stamp a structured residue requirement
    // onto every reconvergence-target scene blueprint so SceneWriter authors the
    // path-acknowledging textVariants at WRITING time, not hunted post-hoc by the validator.
    attachResidueRequirements(blueprint, branchAnalysis ?? undefined);

    // Phase 1.5: Build GrowthTemplate from season plan's growth curve for this
    // episode. It is attached to the first strategic choice point in the episode
    // (the "development scene" concept) so ChoiceAuthor can frame skill options
    // as in-world actions rather than stat labels.
    let episodeGrowthTemplate: ReturnType<typeof buildGrowthTemplates> | undefined;
    let growthTemplateAttached = false;
    try {
      const currentEpisodeNumber = brief.episode?.number ?? 1;
      const totalEpisodes = brief.seasonPlan?.episodes?.length ?? 1;
      const growthCurveEntry = (brief.seasonPlan as unknown as { growthCurve?: GrowthCurveEntry[] })?.growthCurve
        ?.find((g) => g.episodeNumber === currentEpisodeNumber);
      if (growthCurveEntry && growthCurveEntry.focusSkills && growthCurveEntry.focusSkills.length > 0) {
        episodeGrowthTemplate = buildGrowthTemplates(growthCurveEntry, currentEpisodeNumber, totalEpisodes);
        context.emit({
          type: 'debug',
          phase: 'content',
          message: `Growth template ready: ${episodeGrowthTemplate.skillOptions.length} skill options${episodeGrowthTemplate.mentorship ? ` + mentorship with ${episodeGrowthTemplate.mentorship.npcName}` : ''}`,
        });
      }
    } catch (err) {
      context.emit({
        type: 'warning',
        phase: 'content',
        message: `Failed to build growth templates: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Find the primary encounter scene so pre-encounter scenes can be written
    // with the encounter in mind. We take the first encounter scene as the anchor.
    const primaryEncounterScene = blueprint.scenes.find(s => s.isEncounter && s.encounterType);
    const primaryEncounterContext = primaryEncounterScene ? {
      encounterType: primaryEncounterScene.encounterType!,
      encounterDescription: primaryEncounterScene.encounterDescription || primaryEncounterScene.description,
      encounterDifficulty: primaryEncounterScene.encounterDifficulty || 'moderate',
      // encounterBuildup will be overridden per-scene below
      encounterBuildup: primaryEncounterScene.encounterBuildup || '',
    } : undefined;
    // Build a dependency graph and flatten topological waves into a serial
    // ordering. Scene content generation is intentionally serial today because
    // the loop below threads previous-scene summaries, repair loops, and shared
    // state. Real wave-based parallel execution is tracked as a follow-up once
    // the `ContentGenerationPhase` is extracted (see pipeline/phases/).
    const dependencyGraph = buildSceneDependencyGraph(blueprint);
    const topoWaves = dependencyGraph.hasCycle ? [] : buildTopologicalWaves(blueprint);
    this.deps.dependencySchedulerStats.hasCycle = dependencyGraph.hasCycle;
    this.deps.dependencySchedulerStats.waveCount = topoWaves.length;
    this.deps.dependencySchedulerStats.fallbackToSerial = dependencyGraph.hasCycle;
    if (dependencyGraph.hasCycle) {
      context.emit({
        type: 'warning',
        phase: 'content',
        message: dependencyGraph.cycleReason || 'Scene dependency graph cycle detected; falling back to serial ordering.',
      });
    } else if (context.config.generation?.shadowSchedulerEnabled) {
      context.emit({
        type: 'debug',
        phase: 'content',
        message: `Dependency scheduler planned ${topoWaves.length} wave(s): ${topoWaves.map(w => `[${w.sceneIds.join(',')}]`).join(' -> ')}`,
      });
    }

    const sceneOrder = (!dependencyGraph.hasCycle && topoWaves.length > 0)
      ? topoWaves.flatMap((wave) => wave.sceneIds.map((id) => blueprint.scenes.find((s) => s.id === id)).filter((s): s is SceneBlueprint => Boolean(s)))
      : blueprint.scenes;

    // Safety: ensure every blueprint scene gets content, even if the dependency graph missed it
    const orderedIds = new Set(sceneOrder.map(s => s.id));
    for (const bp of blueprint.scenes) {
      if (!orderedIds.has(bp.id)) {
        console.warn(`[Pipeline] Scene ${bp.id} missing from topological order — appending to ensure content generation`);
        context.emit({ type: 'warning', phase: 'scenes', message: `Scene ${bp.id} not in dependency graph — appended to generation order` });
        sceneOrder.push(bp);
      }
    }

    const finalizedScenes = new Set<string>();
    const contentWorkTotal = Math.max(
      1,
      sceneOrder.reduce((sum, scene) =>
        sum + 1 + (scene.choicePoint ? 1 : 0) + (scene.isEncounter && scene.encounterType ? 1 : 0), 0)
    );
    let contentWorkCompleted = 0;
    this.deps.emitPhaseProgress('content', 0, contentWorkTotal, 'content:work', 'Preparing scene generation queue...');

    for (let i = 0; i < sceneOrder.length; i++) {
      await this.deps.checkCancellation();
      const sceneBlueprint = sceneOrder[i];
      const previousScene = i > 0 ? sceneContents[i - 1] : undefined;
      const sceneUnitId = episodeNumber ? `scene_content:episode-${episodeNumber}:${sceneBlueprint.id}` : '';
      const choiceUnitId = episodeNumber ? `choice_set:episode-${episodeNumber}:${sceneBlueprint.id}` : '';
      const encounterUnitId = episodeNumber ? `encounter:episode-${episodeNumber}:${sceneBlueprint.id}` : '';
      const sceneCheckpointPath = episodeNumber ? this.deps.episodeCheckpointFile(episodeNumber, 'scene', sceneBlueprint.id) : '';
      const choiceCheckpointPath = episodeNumber ? this.deps.episodeCheckpointFile(episodeNumber, 'choices', sceneBlueprint.id) : '';
      const encounterCheckpointPath = episodeNumber ? this.deps.episodeCheckpointFile(episodeNumber, 'encounter', sceneBlueprint.id) : '';
      const requiredScenes = new Set<string>([
        ...(sceneBlueprint.requires || []),
        ...((dependencyGraph.nodes.get(sceneBlueprint.id)?.predecessors || [])),
      ].filter((sceneId) => sceneId && sceneId !== sceneBlueprint.id));
      const unresolvedDeps = Array.from(requiredScenes).filter((dep) => !finalizedScenes.has(dep));
      if (unresolvedDeps.length > 0) {
        throw new PipelineError(
          `Dependency contract violation in content generation for ${sceneBlueprint.id}: unresolved prerequisites ${unresolvedDeps.join(', ')}`,
          'content_generation',
          { context: { sceneId: sceneBlueprint.id, unresolvedDeps } }
        );
      }

      if (outputDirectory && episodeNumber) {
        const resumedScene = this.deps.loadResumeUnit<SceneContent>(outputDirectory, sceneUnitId, sceneCheckpointPath);
        const resumedChoice = sceneBlueprint.choicePoint
          ? this.deps.loadResumeUnit<ChoiceSet>(outputDirectory, choiceUnitId, choiceCheckpointPath)
          : undefined;
        const resumedEncounter = sceneBlueprint.isEncounter && sceneBlueprint.encounterType
          ? this.deps.loadResumeUnit<EncounterStructure>(outputDirectory, encounterUnitId, encounterCheckpointPath)
          : undefined;
        const hasRequiredChoice = !sceneBlueprint.choicePoint || Boolean(resumedChoice);
        const hasRequiredEncounter = !(sceneBlueprint.isEncounter && sceneBlueprint.encounterType) || Boolean(resumedEncounter);
        if (resumedScene && hasRequiredChoice && hasRequiredEncounter) {
          sceneContents.push(resumedScene);
          if (resumedChoice) choiceSets.push(resumedChoice);
          if (resumedEncounter) encounters.set(sceneBlueprint.id, resumedEncounter);
          contentWorkCompleted += 1 + (resumedChoice ? 1 : 0) + (resumedEncounter ? 1 : 0);
          finalizedScenes.add(sceneBlueprint.id);
          if (this.deps.generationPlan) {
            setSceneBeats(this.deps.generationPlan, episodeNumber ?? brief.episode.number, sceneBlueprint.id, resumedScene.beats?.length ?? 0);
          }
          this.deps.emitPhaseProgress(
            'content',
            contentWorkCompleted,
            contentWorkTotal,
            'content:work',
            `Resumed completed content for ${sceneBlueprint.id}`
          );
          continue;
        }
      }

      if (this.deps.generationPlan) {
        markSceneActive(this.deps.generationPlan, episodeNumber ?? brief.episode.number, sceneBlueprint.id, 'writing');
        this.deps.emitPlanUpdate(`Writing scene ${sceneBlueprint.id}`);
      }

      // Filter protagonist from npcsPresent — the protagonist is always implicit,
      // and including them as an NPC causes duplication in scenes and images
      if (sceneBlueprint.npcsPresent) {
        sceneBlueprint.npcsPresent = sceneBlueprint.npcsPresent.filter(
          npcId => npcId !== brief.protagonist.id
        );
      }
      this.alignMandatoryOpeningBeatContext(sceneBlueprint);

      // Resolve authored location first so downstream image systems do not re-guess scene setting.
      const location = this.deps.resolveWorldLocationForScene(sceneBlueprint, worldBible);
      const sceneSettingContext = buildSceneSettingContext(sceneBlueprint, location, worldBible, brief);
      const primaryNextScene = sceneBlueprint.leadsTo?.length === 1
        ? blueprint.scenes.find((scene) => scene.id === sceneBlueprint.leadsTo[0])
        : undefined;
      const nextSceneContext = primaryNextScene ? {
        id: primaryNextScene.id,
        name: primaryNextScene.name,
        location: primaryNextScene.location,
        description: primaryNextScene.description,
        isEncounter: primaryNextScene.isEncounter,
        encounterType: primaryNextScene.encounterType,
        encounterDescription: primaryNextScene.encounterDescription,
        encounterBeatPlan: primaryNextScene.encounterBeatPlan,
      } : undefined;

      const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

      // Skip SceneWriter for encounter scenes - EncounterArchitect provides all content
      if (sceneBlueprint.isEncounter && sceneBlueprint.encounterType) {
        context.emit({
          type: 'debug',
          phase: 'scenes',
          message: `Skipping SceneWriter for encounter scene ${sceneBlueprint.id} - EncounterArchitect will provide content`,
        });

        // Create minimal placeholder scene content for encounters
        // The actual narrative content comes from EncounterArchitect's setupText and outcome narratives
        
        // Determine branch metadata
        const isBottleneck = blueprint.bottleneckScenes?.includes(sceneBlueprint.id) || sceneBlueprint.purpose === 'bottleneck';
        const incomingScenes = blueprint.scenes.filter(s => s.leadsTo?.includes(sceneBlueprint.id));
        const isConvergencePoint = incomingScenes.length > 1;
        
        const encounterSceneContent: SceneContent = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          locationId: sceneSettingContext.locationId,
          beats: [], // Empty - encounter beats come from EncounterArchitect
          startingBeatId: '', // Will be set from encounter structure
          moodProgression: [sceneBlueprint.mood],
          charactersInvolved: sceneBlueprint.npcsPresent,
          keyMoments: [sceneBlueprint.encounterDescription || sceneBlueprint.description],
          continuityNotes: [`Encounter scene: ${sceneBlueprint.encounterType}`],
          // Branch metadata for visual differentiation
          branchType: this.deps.inferBranchType(sceneBlueprint, blueprint),
          isBottleneck,
          isConvergencePoint,
          settingContext: sceneSettingContext,
        };
        sceneContents.push(encounterSceneContent);
        // Encounter scenes are built by EncounterArchitect later in this same
        // iteration (setup + outcomes + storylets) — show "designing encounter"
        // now; the scene is marked complete only once that finishes.
        if (this.deps.generationPlan) {
          markSceneActive(this.deps.generationPlan, episodeNumber ?? brief.episode.number, sceneBlueprint.id, 'encounter');
          this.deps.emitPlanUpdate(`Designing encounter ${sceneBlueprint.id}`);
        }
        contentWorkCompleted += 1;
        this.deps.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Scene scaffold ready for ${sceneBlueprint.id}`
        );
      } else {
        // Regular scene - use SceneWriter
        context.emit({
          type: 'agent_start',
          agent: 'SceneWriter',
          message: `Writing scene ${i + 1}/${blueprint.scenes.length}: ${sceneBlueprint.name}`,
        });

        // On-page introduction state (uncontextualized-character fix): which roster
        // NPCs has the reader met before this scene in planned reading order?
        const rosterNpcs = characterBible.characters
          .filter((c) => c.id !== brief.protagonist.id)
          .map((c) => ({ id: c.id, name: c.name }));
        const blueprintOrderIdx = (blueprint.scenes || []).findIndex((s) => s.id === sceneBlueprint.id);
        const introducedBeforeScene = introducedNpcIds({
          episodeNumber: brief.episode.number,
          rosterNpcIds: rosterNpcs.map((c) => c.id),
          characterIntroductions: brief.seasonPlan?.characterIntroductions,
          alreadyStagedNpcIds: (blueprint.scenes || [])
            .slice(0, Math.max(0, blueprintOrderIdx))
            .flatMap((s) => s.npcsPresent || []),
        });
        this.pruneUnscopedTreatmentSeedBeats(sceneBlueprint);

        const sceneWriterInput = {
          sceneBlueprint,
          storyContext: {
            title: brief.story.title,
            genre: brief.story.genre,
            tone: brief.story.tone,
            userPrompt: brief.userPrompt,
            worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
          },
          protagonistInfo: {
            name: brief.protagonist.name,
            pronouns: brief.protagonist.pronouns,
            description: protagonistProfile?.fullBackground || brief.protagonist.description,
            physicalDescription: protagonistProfile?.physicalDescription,
          },
          npcs: sceneBlueprint.npcsPresent.map(npcId => {
            const profile = resolveCharacterProfile(characterBible.characters, npcId);
            // Prevention: append the capability constraint so the writer never
            // depicts a non-combatant fighting (Season Canon, Phase B).
            const capabilityNote = profile ? capabilityNoteForProfile(profile) : '';
            return {
              id: npcId,
              name: profile?.name || npcId,
              pronouns: profile?.pronouns || 'they/them',
              description: [profile?.overview || '', capabilityNote].filter(Boolean).join(' '),
              physicalDescription: profile?.physicalDescription,
              voiceNotes: profile?.voiceProfile?.writingGuidance || '',
              currentMood: profile?.voiceProfile?.whenNervous,
              isFirstOnPageAppearance: !introducedBeforeScene.has(npcId),
            };
          }),
          // Roster characters the reader hasn't met and who aren't in this scene's
          // cast — the writer must not name them (the "who is this?" defect class).
          notYetIntroducedNames: forbiddenNpcNames({
            roster: rosterNpcs,
            introduced: introducedBeforeScene,
            sceneCastIds: sceneBlueprint.npcsPresent,
          }),
          // Diegetic timeline handoff: previous scene's time/place + whether this
          // scene's planned time/location differ (transition acknowledgment required).
          sceneTimeline: buildSceneTimelineHandoff(blueprint.scenes || [], sceneBlueprint),
          relevantFlags: blueprint.suggestedFlags,
          relevantScores: blueprint.suggestedScores,
          // Step 2 (info-reveal): resolve the INFO ids assigned to this scene (Step 1)
          // to their authored fact text so SceneWriter dramatizes each reveal on-page.
          // Empty when no reveal is scheduled here, so the prompt is unchanged otherwise.
          revealDirectives: (sceneBlueprint.revealsInfoIds ?? [])
            .map((infoId) => {
              const entry = brief.seasonPlan?.informationLedger?.find((e) => e.id === infoId);
              const fact = entry?.label || entry?.description;
              return fact ? { infoId, fact } : undefined;
            })
            .filter((d): d is { infoId: string; fact: string } => Boolean(d)),
          // G12 (forbidden reveals): the inverse of revealDirectives — ledger facts
          // still withheld at this episode, so the writer cannot burn a season secret
          // early (Carmen unmasked in ep2, the staged rescue confirmed in ep2, …).
          forbiddenReveals: buildForbiddenReveals(
            brief.seasonPlan?.informationLedger,
            brief.episode?.number ?? 1,
            sceneBlueprint.revealsInfoIds,
          ),
          // B1 (Season Canon read-back): serve the sealed canon as authoritative
          // "do not contradict" context so prior-episode facts constrain this prose.
          establishedCanon: this.deps.establishedCanonForPrompt(brief.episode?.number),
          unresolvedCallbacks: mergeUnresolvedForScene(this.deps.getUnresolvedCallbacksForPrompt(brief.episode?.number), episodePlants, brief.episode?.number ?? 1),
          targetBeatCount: this.deps.getTargetBeatCountForScene(sceneBlueprint),
          dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
          previousSceneSummary: previousScene
            ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
            : undefined,
          nextSceneContext,
          incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
          // W4 prevention: if an encounter routes into this scene, hand the writer the
          // encounter's outcomes + their pre-seeded state flags so it authors
          // outcome-conditioned variants natively (the scene reflects what happened).
          // The generated encounter map adds the REAL stakes + clock pressure (scenes
          // are written in dependency order, so an incoming encounter already exists).
          priorEncounterOutcomes: buildPriorEncounterOutcomes(
            blueprint, sceneBlueprint, (n, f) => this.deps.sanitizeReaderFacingSceneName(n, f), encounters,
          ),
          // B1 prevention: if the prior scene shares this scene's location, tell the
          // writer to continue the visit rather than re-stage an arrival (dual-first-entry).
          continueInLocation: buildContinueInLocation(blueprint, sceneBlueprint),
          sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
          episodeEncounterContext: primaryEncounterContext && !sceneBlueprint.isEncounter
            ? {
                ...primaryEncounterContext,
                encounterBuildup: sceneBlueprint.encounterBuildup || 'Foreshadow the encounter stakes without depicting or resolving the encounter event itself.',
              }
            : undefined,
          memoryContext: this.deps.cachedPipelineMemory || undefined,
          branchContext: branchContextByScene.get(sceneBlueprint.id),
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonSevenPoint: brief.seasonPlan?.sevenPoint,
          episodeStructuralRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.structuralRole,
          cliffhangerPlan: this.deps.isEpisodeFinalScene(sceneBlueprint, blueprint)
            ? brief.seasonPlan?.episodes.find((e) => e.episodeNumber === brief.episode.number)?.cliffhangerPlan
            : undefined,
          // Thread/Twist planning (default-off): threads to plant/pay off in THIS
          // scene + the TwistPlan directives targeting it. Both mappers return
          // undefined unless STORYRPG_THREAD_TWIST_PLANNING populated the run
          // ledger above, so the prompt is byte-identical by default.
          activeThreads: sceneActiveThreads(this.deps.seasonThreadLedger, sceneBlueprint.id, episodeNumber ?? brief.episode.number),
          twistDirectives: sceneTwistDirectives(this.deps.episodeTwistPlans.get(episodeNumber ?? brief.episode.number), sceneBlueprint.id),
        };

        // === KARPATHY LOOP: Best-of-N for critical scenes ===
        const bestOfN = brief.options?.bestOfN ?? BEST_OF_N_DEFAULTS.candidates;
        const isCriticalScene =
          (BEST_OF_N_DEFAULTS.enabledForBottleneck && (sceneBlueprint.purpose === 'bottleneck' || blueprint.bottleneckScenes?.includes(sceneBlueprint.id))) ||
          (BEST_OF_N_DEFAULTS.enabledForOpening && sceneBlueprint.id === blueprint.startingSceneId) ||
          (BEST_OF_N_DEFAULTS.enabledForClimax && (sceneBlueprint.purpose as string) === 'climax');
        const useBestOfN = bestOfN > 1 && isCriticalScene && this.deps.incrementalValidator;

        let sceneResult: AgentResponse<SceneContent>;

        if (useBestOfN) {
          context.emit({
            type: 'debug',
            phase: 'scenes',
            message: `Best-of-${bestOfN} for critical scene ${sceneBlueprint.id} (${sceneBlueprint.purpose || 'opening'})`,
          });

          const candidates = await Promise.all(
            Array.from({ length: bestOfN }, (_, idx) =>
              withTimeout(
                this.deps.sceneWriter.execute(sceneWriterInput),
                PIPELINE_TIMEOUTS.llmAgent,
                `SceneWriter.execute(${sceneBlueprint.id} candidate-${idx})`
              ).catch((err) => ({
                success: false as const,
                data: null as SceneContent | null,
                error: err instanceof Error ? err.message : String(err),
              }))
            )
          );

          const validCandidates = candidates.filter(
            (c): c is AgentResponse<SceneContent> & { success: true; data: SceneContent } =>
              c.success === true && c.data != null
          );

          if (validCandidates.length > 1) {
            const bestOfNVoiceProfiles: CharacterVoiceProfile[] = sceneBlueprint.npcsPresent
              .map(npcId => {
                const profile = resolveCharacterProfile(characterBible.characters, npcId);
                if (!profile?.voiceProfile) return null;
                const legacyVoice = profile.voiceProfile as typeof profile.voiceProfile & {
                  speechPatterns?: string[];
                  vocabularyLevel?: string;
                };
                return {
                  characterId: npcId,
                  characterName: profile.name,
                  voiceGuidance: profile.voiceProfile.writingGuidance || '',
                  speechPatterns: legacyVoice.speechPatterns || [],
                  vocabularyLevel: legacyVoice.vocabularyLevel,
                } as unknown as CharacterVoiceProfile;
              })
              .filter((p): p is CharacterVoiceProfile => p !== null);

            const scored = await Promise.all(
              validCandidates.map(async (candidate) => {
                const tempContent = { ...candidate.data, sceneId: sceneBlueprint.id };
                const validation = await this.deps.incrementalValidator!.validateScene(
                  tempContent,
                  undefined,
                  bestOfNVoiceProfiles,
                  undefined
                );
                const voiceScore = validation.voice?.score ?? 0;
                const stakesScore = validation.stakes?.score ?? 0;
                return { candidate, score: voiceScore + stakesScore, validation };
              })
            );

            scored.sort((a, b) => b.score - a.score);
            sceneResult = scored[0].candidate;
            context.emit({
              type: 'debug',
              phase: 'scenes',
              message: `Best-of-${bestOfN} winner for ${sceneBlueprint.id}: score ${scored[0].score} vs ${scored.slice(1).map(s => s.score).join(', ')}`,
            });
          } else if (validCandidates.length === 1) {
            sceneResult = validCandidates[0];
          } else {
            sceneResult = candidates[0] as AgentResponse<SceneContent>;
          }
        } else {
          sceneResult = await withTimeout(
            this.deps.sceneWriter.execute(sceneWriterInput),
            PIPELINE_TIMEOUTS.llmAgent,
            `SceneWriter.execute(${sceneBlueprint.id})`
          );
        }

        if (!sceneResult.success || !sceneResult.data) {
          // Karpathy loop: retry SceneWriter once with explicit error feedback before falling back
          context.emit({
            type: 'regeneration_triggered',
            phase: 'scenes',
            message: `SceneWriter failed for ${sceneBlueprint.id}, retrying with error feedback`,
            data: { reason: sceneResult.error },
          });

          const sceneFailureReason = sceneResult.error || 'unknown SceneWriter failure';
          const compactRetryInstruction = /raw processing budget|response exceeded/i.test(sceneFailureReason)
            ? '\n\nCOMPACT RETRY MODE: The previous response was too large to safely process. Return one complete SceneContent JSON object under the hard raw-response budget. Use 6-8 beats, concise prose, compact visual metadata, no optional boilerplate arrays/fields, and textVariants only when they have a real condition from the prompt.'
            : '';

          const retrySceneResult = await withTimeout(this.deps.sceneWriter.execute({
            sceneBlueprint,
            storyContext: {
              title: brief.story.title,
              genre: brief.story.genre,
              tone: brief.story.tone,
              userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Previous scene generation attempt FAILED with error: ${sceneFailureReason}. Please produce valid scene content. Keep it simple and well-structured.${compactRetryInstruction}`,
              worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
            },
            protagonistInfo: {
              name: brief.protagonist.name,
              pronouns: brief.protagonist.pronouns,
              description: protagonistProfile?.fullBackground || brief.protagonist.description,
              physicalDescription: protagonistProfile?.physicalDescription,
            },
            npcs: sceneBlueprint.npcsPresent.map(npcId => {
              const profile = resolveCharacterProfile(characterBible.characters, npcId);
              return {
                id: npcId,
                name: profile?.name || npcId,
                pronouns: profile?.pronouns || 'they/them',
                description: profile?.overview || '',
                physicalDescription: profile?.physicalDescription,
                voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                currentMood: profile?.voiceProfile?.whenNervous,
              };
            }),
            relevantFlags: blueprint.suggestedFlags,
            relevantScores: blueprint.suggestedScores,
            targetBeatCount: this.deps.getTargetBeatCountForScene(sceneBlueprint),
            dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
            previousSceneSummary: previousScene
              ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
              : undefined,
            nextSceneContext,
            incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
            sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
            memoryContext: this.deps.cachedPipelineMemory || undefined,
          }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneBlueprint.id} retry)`);

          if (retrySceneResult.success && retrySceneResult.data) {
            // Retry succeeded — replace the original result so the rest of the loop uses it
            sceneResult = retrySceneResult;
            context.emit({
              type: 'debug',
              phase: 'scenes',
              message: `SceneWriter retry succeeded for ${sceneBlueprint.id}`,
            });
          } else {
            // Retry also failed — fall back to placeholder
            const swFailMsg = `Scene Writer failed on ${sceneBlueprint.id} after retry: ${retrySceneResult.error || sceneResult.error}`;
            console.error(`[Pipeline] ❌ ${swFailMsg}`);
            context.emit({ type: 'warning', phase: 'scenes', message: swFailMsg });
            this.deps.throwIfFailFast(swFailMsg, 'content', {
              agent: 'SceneWriter',
              context: {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                failureKind: 'content',
              },
            });

            sceneContents.push({
              sceneId: sceneBlueprint.id,
              sceneName: sceneBlueprint.name,
              locationId: sceneSettingContext.locationId,
              beats: [{
                id: `${sceneBlueprint.id}-fallback-beat-1`,
                text: `[Scene content generation failed: ${sceneResult.error || 'Unknown error'}]`,
                nextBeatId: undefined,
              }],
              startingBeatId: `${sceneBlueprint.id}-fallback-beat-1`,
              moodProgression: [sceneBlueprint.mood],
              charactersInvolved: sceneBlueprint.npcsPresent,
              keyMoments: [sceneBlueprint.description],
              continuityNotes: [`SceneWriter failed: ${sceneResult.error}`],
              settingContext: sceneSettingContext,
            });
            finalizedScenes.add(sceneBlueprint.id);
            contentWorkCompleted += 1;
            this.deps.emitPhaseProgress(
              'content',
              contentWorkCompleted,
              contentWorkTotal,
              'content:work',
              `Fallback scene scaffold created for ${sceneBlueprint.id}`
            );
            if (sceneBlueprint.choicePoint) {
              contentWorkCompleted += 1;
              this.deps.emitPhaseProgress(
                'content',
                contentWorkCompleted,
                contentWorkTotal,
                'content:work',
                `Skipped choice generation for ${sceneBlueprint.id}`
              );
            }
            continue;
          }
        }

        // Ensure the scene content has the correct sceneId matching the blueprint
        const sceneContent = sceneResult.data!;
        sceneContent.sceneId = sceneBlueprint.id;
        sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
        sceneContent.locationId = sceneSettingContext.locationId;
        sceneContent.settingContext = sceneSettingContext;
        // Carry the authored realization contract WITH the content so every
        // later rewrite pass can verify it isn't paraphrasing a moment away.
        sceneContent.requiredBeats = sceneBlueprint.requiredBeats;
        sceneContent.signatureMoment = sceneBlueprint.signatureMoment;

        // Scene-time realization check (GATE_SCENE_REQUIRED_BEAT_CHECK):
        // verify the freshly written prose depicts every authored
        // requiredBeat/signatureMoment using the same scoring the season-final
        // validators apply (deterministic, no LLM). An under-realized scene
        // gets a tiny bounded SceneWriter retry loop whose feedback names the
        // exact missing content words — a retry here costs one scene; the same
        // miss at the final contract costs the whole run (bite-me-g13).
        if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
          let missing = missingRequiredMoments(sceneBlueprint, sceneContent.beats);
          if (missing.length > 0) {
            try {
              for (let attempt = 1; attempt <= 2 && missing.length > 0; attempt++) {
                context.emit({
                  type: 'regeneration_triggered',
                  phase: 'scenes',
                  message: `Scene ${sceneBlueprint.id} under-realizes ${missing.length} authored moment(s) — retrying with realization feedback (${attempt}/2)`,
                  data: { missing: missing.map(m => ({ tier: m.tier, missingTokens: m.missingTokens })) },
                });
                const realizationRetry = await withTimeout(
                  this.deps.sceneWriter.execute({
                    ...sceneWriterInput,
                    storyContext: {
                      ...sceneWriterInput.storyContext,
                      userPrompt: `${sceneWriterInput.storyContext.userPrompt || ''}\n\n${realizationRetryFeedback(missing)}`,
                    },
                  }),
                  PIPELINE_TIMEOUTS.llmAgent,
                  `SceneWriter.execute(${sceneBlueprint.id} realization-retry-${attempt})`,
                );
                if (!realizationRetry.success || !realizationRetry.data) continue;
                const retryMissing = missingRequiredMoments(sceneBlueprint, realizationRetry.data.beats);
                if (improvesMissingRealization(missing, retryMissing)) {
                  // Retry realized more of the contract — adopt it in place
                  // (sceneContent stays the canonical object the rest of the
                  // loop and the push use; re-apply the normalization).
                  Object.assign(sceneContent, realizationRetry.data);
                  sceneContent.sceneId = sceneBlueprint.id;
                  sceneContent.sceneName = sceneContent.sceneName || sceneBlueprint.name;
                  sceneContent.locationId = sceneSettingContext.locationId;
                  sceneContent.settingContext = sceneSettingContext;
                  sceneContent.requiredBeats = sceneBlueprint.requiredBeats;
                  sceneContent.signatureMoment = sceneBlueprint.signatureMoment;
                  missing = retryMissing;
                }
                context.emit({
                  type: 'debug',
                  phase: 'scenes',
                  message: `Realization retry ${attempt}/2 for ${sceneBlueprint.id}: ${missing.length} under-realized moment(s) remain`,
                });
              }
              if (missing.length > 0) {
                const beforeRecovery = missing;
                insertMissingMomentBeats(sceneBlueprint.id, sceneContent.beats, missing);
                sceneContent.startingBeatId = sceneContent.beats[0]?.id ?? sceneContent.startingBeatId;
                missing = missingRequiredMoments(sceneBlueprint, sceneContent.beats);
                context.emit({
                  type: missing.length > 0 ? 'warning' : 'debug',
                  phase: 'scenes',
                  message:
                    `Scene ${sceneBlueprint.id} deterministic authored-moment recovery inserted ` +
                    `${beforeRecovery.length} beat(s); ${missing.length} under-realized moment(s) remain`,
                  data: { inserted: beforeRecovery.map((m) => ({ tier: m.tier, moment: m.moment })) },
                });
              }
              if (missing.length > 0) {
                const unresolved = missing
                  .map((m) => `[${m.tier}] ${m.moment}`)
                  .join('; ');
                throw new Error(
                  `Scene ${sceneBlueprint.id} still under-realizes authored moment(s) after realization retry: ${unresolved}`,
                );
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              context.emit({
                type: 'error',
                phase: 'scenes',
                message: `Realization retry for ${sceneBlueprint.id} failed authored realization gate: ${message}`,
              });
              throw err;
            }
          }
        }

        // Add branch metadata for visual differentiation
        const isSceneBottleneck = blueprint.bottleneckScenes?.includes(sceneBlueprint.id) || sceneBlueprint.purpose === 'bottleneck';
        const incomingToScene = blueprint.scenes.filter(s => s.leadsTo?.includes(sceneBlueprint.id));
        const isSceneConvergence = incomingToScene.length > 1;
        
        sceneContent.branchType = this.deps.inferBranchType(sceneBlueprint, blueprint);
        sceneContent.isBottleneck = isSceneBottleneck;
        sceneContent.isConvergencePoint = isSceneConvergence;
        sceneContent.incomingChoiceContext = sceneBlueprint.incomingChoiceContext;

        sceneContents.push(sceneContent);

        // Within-episode callback crediting: record this scene's textVariant payoffs
        // NOW, so later scenes in the same episode see up-to-date hook counts in
        // getUnresolvedCallbacksForPrompt (previously only the end-of-episode harvest
        // credited them — scene 5 was still offered a hook scene 2 had already paid,
        // double-acknowledging the same decision). The beat-level dedupe key makes
        // the end-of-episode harvest re-scan a no-op for these beats.
        recordScenePayoffs(this.deps.callbackLedger, brief.episode?.number ?? 1, {
          sceneId: sceneContent.sceneId,
          beats: (sceneContent.beats ?? []) as unknown as Parameters<typeof recordScenePayoffs>[2]['beats'],
        });

        context.emit({
          type: 'agent_complete',
          agent: 'SceneWriter',
          message: `Wrote ${sceneContent.beats.length} beats for ${sceneBlueprint.id}`,
        });
        if (this.deps.generationPlan) {
          setSceneBeats(
            this.deps.generationPlan,
            episodeNumber ?? brief.episode.number,
            sceneBlueprint.id,
            sceneContent.beats.length,
          );
          this.deps.emitPlanUpdate(`Scene ${sceneBlueprint.id} written (${sceneContent.beats.length} beats)`);
        }
        contentWorkCompleted += 1;
        this.deps.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Scene written for ${sceneBlueprint.id}`
        );

        // Choice Author (for non-encounter scenes with choice points)
        context.emit({ type: 'debug', phase: 'scenes', message: `Scene ${sceneBlueprint.id} choicePoint: ${sceneBlueprint.choicePoint ? `YES (${sceneBlueprint.choicePoint.type})` : 'NO'}` });
        if (sceneBlueprint.choicePoint) {
          let choicePointBeat = sceneResult.data!.beats.find(b => b.isChoicePoint);
          context.emit({ type: 'debug', phase: 'choices', message: `Looking for choicePoint beat in ${sceneResult.data!.beats.length} beats... Found: ${choicePointBeat ? choicePointBeat.id : 'NONE'}` });

          // FALLBACK: If SceneWriter didn't mark a choice point but the blueprint requires one,
          // auto-mark the last beat as the choice point to ensure choices are generated
          if (!choicePointBeat && sceneResult.data!.beats.length > 0) {
            const lastBeat = sceneResult.data!.beats[sceneResult.data!.beats.length - 1];
            console.warn(`[Pipeline] FALLBACK: Auto-marking last beat "${lastBeat.id}" as isChoicePoint for scene ${sceneBlueprint.id}`);
            lastBeat.isChoicePoint = true;
            choicePointBeat = lastBeat;
          }

          if (choicePointBeat) {
            context.emit({
              type: 'agent_start',
              agent: 'ChoiceAuthor',
              message: `Creating choices for ${sceneBlueprint.name}`,
            });

            const choiceAuthorInput: ChoiceAuthorInput = {
              sceneBlueprint,
              beatText: choicePointBeat.text,
              beatId: choicePointBeat.id,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: brief.userPrompt,
                worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
              },
              protagonistInfo: {
                name: brief.protagonist.name,
                pronouns: brief.protagonist.pronouns,
              },
              npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
              availableFlags: blueprint.suggestedFlags,
              availableScores: blueprint.suggestedScores,
              availableTags: blueprint.suggestedTags,
              // B1: sealed canon as authoritative "do not contradict" context.
              establishedCanon: this.deps.establishedCanonForPrompt(brief.episode?.number),
              unresolvedCallbacks: this.deps.getUnresolvedCallbacksForPrompt(brief.episode?.number) as ChoiceAuthorInput['unresolvedCallbacks'],
              possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                const scene = blueprint.scenes.find(s => s.id === id);
                return {
                  id,
                  name: scene?.name || id,
                  description: scene?.description || '',
                };
              }),
              optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
              sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
              memoryContext: this.deps.cachedPipelineMemory || undefined,
              storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
              growthTemplates: (() => {
                // Attach the episode-level growth template to the FIRST
                // strategic choice point (the development scene anchor).
                if (!episodeGrowthTemplate || growthTemplateAttached) return undefined;
                const isStrategic = sceneBlueprint.choicePoint?.type === 'strategic';
                const isTransition = sceneBlueprint.purpose === 'transition';
                if (isStrategic && isTransition) {
                  growthTemplateAttached = true;
                  return episodeGrowthTemplate;
                }
                return undefined;
              })(),
              branchContext: (() => {
                const bc = branchContextByScene.get(sceneBlueprint.id);
                if (!bc) return undefined;
                const leadsToDistinct = new Set(sceneBlueprint.leadsTo || []).size;
                return {
                  role: bc.role,
                  isBranchPoint: leadsToDistinct > 1 || ((sceneBlueprint.choicePoint?.type as string) === 'branching'),
                  expectedBranches: leadsToDistinct > 1 ? leadsToDistinct : undefined,
                  reconvergenceTargets: bc.incomingBranchIds,
                  stateReconciliationHints: bc.stateReconciliationNotes,
                };
              })(),
              plannedConsequenceTier: plannedConsequenceTiers[sceneBlueprint.id],
              // Character-arc tracking (default-off): planned identity/relationship
              // movement, mapped to hint shape. Undefined when the flag is off.
              arcTargets: toChoiceAuthorArcTargets(
                this.deps.episodeArcTargets.get(episodeNumber ?? brief.episode.number),
              ),
              seasonAnchors: brief.seasonPlan?.anchors,
              seasonSevenPoint: brief.seasonPlan?.sevenPoint,
              episodeStructuralRole: brief.seasonPlan?.episodes.find(
                (e) => e.episodeNumber === brief.episode.number,
              )?.structuralRole,
            };
            // Bounded retry: a transient ChoiceAuthor failure (LLM/parse blip) must not
            // leave a scene choiceless. For a branch point that unrealizes the branch and
            // hard-aborts the whole episode at GATE_BRANCH_FANOUT, so retry before degrading.
            // THROW-SAFE author call: a thrown timeout/rejection/parse-exception from the
            // LLM call must be treated like a RETURNED failure, otherwise it escapes the
            // retry → per-target regen → template fallback chain entirely and ships a branch
            // point choiceless (the endsong s2-1 hard-abort). Never throws.
            const authorChoices = async (input: typeof choiceAuthorInput, label: string) => {
              try {
                return await withTimeout(this.deps.choiceAuthor.execute(input), PIPELINE_TIMEOUTS.llmAgent, label);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                context.emit({ type: 'warning', phase: 'choices', message: `Choice Author threw for ${sceneBlueprint.id} (${label}): ${msg} — treating as failure for fallback.` });
                return { success: false as const, error: msg, data: undefined };
              }
            };

            const maxChoiceAuthorAttempts = 3;
            let choiceAuthorAttempt = 1;
            let choiceResult = await authorChoices(choiceAuthorInput, `ChoiceAuthor.execute(${sceneBlueprint.id})`);
            while ((!choiceResult.success || !choiceResult.data) && choiceAuthorAttempt < maxChoiceAuthorAttempts) {
              choiceAuthorAttempt++;
              context.emit({ type: 'warning', phase: 'choices', message: `Choice Author failed on ${sceneBlueprint.id} (attempt ${choiceAuthorAttempt - 1}/${maxChoiceAuthorAttempts}): ${choiceResult.error ?? 'no data'} — retrying.` });
              choiceResult = await authorChoices(choiceAuthorInput, `ChoiceAuthor.execute(${sceneBlueprint.id} retry-${choiceAuthorAttempt})`);
            }

            // Per-target branch regeneration (preferred over a templated fallback): if the
            // choices still failed AND this is a multi-target branch point with authored
            // target intents, re-run ChoiceAuthor with explicit one-choice-per-target
            // guidance so the LLM authors a REAL, coherent choice for each branch. On
            // success, promote it so the normal success path (emitters, plants, validation,
            // fan-out repair) runs uniformly.
            const branchRegenHints = branchTargetHintsByScene.get(sceneBlueprint.id);
            if (
              (!choiceResult.success || !choiceResult.data)
              && new Set(sceneBlueprint.leadsTo ?? []).size > 1
              && branchRegenHints && branchRegenHints.length > 0
            ) {
              context.emit({ type: 'debug', phase: 'choices', message: `Regenerating ${sceneBlueprint.id} choices with explicit per-target branch guidance (${branchRegenHints.length} target(s)) before any templated fallback.` });
              const branchRegen = await authorChoices(
                {
                  ...choiceAuthorInput,
                  requiredBranchTargets: branchRegenHints.map((h) => ({ sceneId: h.target, intent: h.label })),
                },
                `ChoiceAuthor.execute(${sceneBlueprint.id} branch-regen)`,
              );
              if (branchRegen.success && branchRegen.data && (branchRegen.data.choices?.length ?? 0) > 0) {
                choiceResult = branchRegen;
                context.emit({ type: 'warning', phase: 'choices', message: `Authored ${sceneBlueprint.id} branch choices via per-target regeneration (one coherent choice per branch) — no templated fallback needed.` });
              }
            }

            // The treatment-seed / ending-axis / info-reveal on-page contracts must be
            // planted on whatever choice set ultimately ships for this scene — the
            // authored one OR a deterministic fallback. Factor it so both paths agree:
            // before this, the failure path planted NONE of them, so a seed-bearing scene
            // whose ChoiceAuthor failed hard-aborted the episode at GATE_TREATMENT_SEED_ONPAGE
            // (bite-me-g14 ep2 s2-4: 4 seeds declared, choices never authored).
            const applyOnPageContracts = (choices: ChoiceSet['choices']): void => {
              // §3.3/GAP-C: SET authored consequence seeds (treatment_seed_*) so a later
              // authored precondition reading the seed can be true. No-op off treatment runs.
              emitSceneTreatmentSeeds(sceneBlueprint, choices);
              // Ending reachability: SET the season's ending-axis flags (treatment_branch_*)
              // so the finale's ending-route logic can read them and each named ending is
              // mechanically reachable. No-op off treatment runs.
              emitSceneBranchAxes(sceneBlueprint, choices);
              // Step 3 (info-reveal): SET the detectable <id>_reveal flag for each INFO
              // reveal assigned to this scene, so the schedule validator can confirm the
              // reveal landed. No-op when the scene has no assigned reveals.
              emitSceneInfoReveals(sceneBlueprint, choices);
            };

            if (!choiceResult.success || !choiceResult.data) {
              // ChoiceAuthor failed after retries AND per-target regeneration — only now
              // fall back to deterministic templated choices. The scene ships without
              // LLM-authored choices at this point.
              const caFailMsg = `Choice Author failed on ${sceneBlueprint.id} after ${choiceAuthorAttempt} attempt(s): ${choiceResult.error}`;
              console.error(`[Pipeline] ❌ ${caFailMsg}`);
              context.emit({ type: 'warning', phase: 'choices', message: caFailMsg });
              // Branch-aware fallback: a choiceless BRANCH POINT would unrealize the branch
              // and hard-abort at GATE_BRANCH_FANOUT, so route across leadsTo. Any planned
              // choice point also needs a deterministic set when ChoiceAuthor fails; otherwise
              // season-assigned choice types silently degrade into a generic "Continue..."
              // expression at assembly time (observed: planned strategic scene s1-5 shipped
              // no strategic choice after Gemini rejected the schema).
              const declaresOnPageContract =
                resolveSceneTreatmentSeeds(sceneBlueprint).length > 0 ||
                resolveSceneBranchAxes(sceneBlueprint).length > 0 ||
                (sceneBlueprint.revealsInfoIds ?? []).length > 0;
              const fallbackChoiceSet =
                this.deps.buildBranchFallbackChoiceSet(sceneBlueprint, choicePointBeat)
                ?? (declaresOnPageContract || sceneBlueprint.choicePoint
                  ? this.deps.buildDeterministicChoiceSet(sceneBlueprint, choicePointBeat)
                  : undefined);
              if (fallbackChoiceSet) {
                // Plant the on-page contracts on the deterministic fallback too — the
                // success path is not the only place these obligations must be honored.
                applyOnPageContracts(fallbackChoiceSet.choices);
                choiceSets.push(fallbackChoiceSet);
                // Record the fallback's planted flags so later scenes can pay them off,
                // exactly as the authored path does below.
                episodePlants.push(...extractPlantsFromChoiceSet({ sceneId: sceneBlueprint.id, choices: fallbackChoiceSet.choices }, this.deps.callbackLedger));
                context.emit({ type: 'warning', phase: 'choices', message: `Inserted deterministic fallback choice set for ${sceneBlueprint.id} (${fallbackChoiceSet.choices.length} choice(s)) and planted its on-page contracts after ChoiceAuthor failed.` });
              }
            } else {
            applyOnPageContracts(choiceResult.data.choices);
            // Branch fan-out repair: a multi-target branch point (leadsTo.size>1) whose
            // authored choices all route to ONE target leaves the other branch orphaned
            // and hard-aborts the episode at GATE_BRANCH_FANOUT (the bite-me-gen-8 s1-1
            // case: both choices → s1-2). Deterministically re-point a spare choice at
            // each unreached target so the planned branch is realized. No-op for
            // non-branch scenes or already-fanned choices.
            if ((new Set(sceneBlueprint.leadsTo ?? []).size) > 1) {
              const repaired = repairBranchFanOut(choiceResult.data.choices, sceneBlueprint.leadsTo, {
                pathHints: branchTargetHintsByScene.get(sceneBlueprint.id),
              });
              if (repaired) {
                const hinted = branchTargetHintsByScene.has(sceneBlueprint.id);
                context.emit({ type: 'warning', phase: 'choices', message: `Repaired branch fan-out for ${sceneBlueprint.id}: re-pointed a choice to its authored target [${[...new Set(sceneBlueprint.leadsTo ?? [])].join(', ')}]${hinted ? ' (matched to authored branch intent)' : ' (no branch-path hints — first-spare fallback)'}.` });
              }
            }
            choiceSets.push({ ...choiceResult.data, sceneId: sceneBlueprint.id });
            // Phase 1: record this scene's planted flags so later scenes can pay them off.
            episodePlants.push(...extractPlantsFromChoiceSet({ sceneId: sceneBlueprint.id, choices: choiceResult.data.choices }, this.deps.callbackLedger));
            // Phase F: also surface cosmetic tint: flags so later scenes acknowledge them (raises tint%).
            episodePlants.push(...extractTintPlantsFromChoiceSet({ sceneId: sceneBlueprint.id, choices: choiceResult.data.choices }));
            // C1/C2: surface branch residue (route_/treatment_branch_ flags) so the
            // reconvergence scene authors path-aware residue instead of generic prose.
            episodePlants.push(...extractBranchResidueFromChoiceSet({ sceneId: sceneBlueprint.id, choices: choiceResult.data.choices }));

            context.emit({
              type: 'agent_complete',
              agent: 'ChoiceAuthor',
              message: `Created ${choiceResult.data.choices.length} choices`,
            });

            // === INCREMENTAL STAKES VALIDATION ===
            if (this.deps.incrementalValidator && incrementalConfig.stakesValidation) {
              const stakesResult = this.deps.incrementalValidator.validateStakes(choiceResult.data);
              
              if (!stakesResult.passed) {
                context.emit({
                  type: 'incremental_validation',
                  phase: 'stakes',
                  message: `Stakes validation: ${stakesResult.score}/100 for ${sceneBlueprint.id}`,
                  data: { issues: stakesResult.issues, hasFalseChoices: stakesResult.hasFalseChoices },
                });

                // Attempt regeneration if needed
                if (stakesResult.shouldRegenerate) {
                  let choiceRegenerationAttempt = 0;
                  let currentStakesResult = stakesResult;
                  let currentChoiceData = choiceResult.data;
                  
                  while (
                    currentStakesResult.shouldRegenerate &&
                    choiceRegenerationAttempt < incrementalConfig.maxRegenerationAttempts
                  ) {
                    choiceRegenerationAttempt++;
                    context.emit({
                      type: 'regeneration_triggered',
                      phase: 'choices',
                      message: `Regenerating choices for ${sceneBlueprint.id} (attempt ${choiceRegenerationAttempt})`,
                      data: { reason: currentStakesResult.issues.map(i => i.issue) },
                    });

                    // Regenerate with guidance
                    const revisedChoiceResult = await withTimeout(this.deps.choiceAuthor.execute({
                      sceneBlueprint,
                      beatText: choicePointBeat.text,
                      beatId: choicePointBeat.id,
                      storyContext: {
                        title: brief.story.title,
                        genre: brief.story.genre,
                        tone: brief.story.tone,
                        userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Fix these stakes issues: ${currentStakesResult.issues.map(i => i.issue).join('; ')}`,
                        worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
                      },
                      protagonistInfo: {
                        name: brief.protagonist.name,
                        pronouns: brief.protagonist.pronouns,
                      },
                      npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
                      availableFlags: blueprint.suggestedFlags,
                      availableScores: blueprint.suggestedScores,
                      availableTags: blueprint.suggestedTags,
                      possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                        const scene = blueprint.scenes.find(s => s.id === id);
                        return { id, name: scene?.name || id, description: scene?.description || '' };
                      }),
                      optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
                      sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                      memoryContext: this.deps.cachedPipelineMemory || undefined,
                      storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
                    }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id} regen)`);

                    if (revisedChoiceResult.success && revisedChoiceResult.data) {
                      currentChoiceData = revisedChoiceResult.data;
                      currentStakesResult = this.deps.incrementalValidator.validateStakes(currentChoiceData);
                      
                      // Update the choice set in the array
                      choiceSets[choiceSets.length - 1] = currentChoiceData;
                    } else {
                      break; // Stop if regeneration fails
                    }
                  }

                  if (currentStakesResult.hasFalseChoices) {
                    context.emit({
                      type: 'warning',
                      phase: 'incremental_validation',
                      message: `False choices remain in ${sceneBlueprint.id} after ${choiceRegenerationAttempt} attempts`,
                    });
                  }
                }
              }

              // Track flags and relationship changes set by choices for continuity
              for (const choice of choiceResult.data.choices) {
                for (const consequence of choice.consequences || []) {
                  if (consequence.type === 'setFlag') {
                    this.deps.incrementalValidator.trackFlagSet((consequence as { flag: string }).flag);
                  }
                  if (consequence.type === 'relationship' || (consequence.type as string) === 'changeRelationship') {
                    const rel = consequence as { characterId?: string; npcId?: string; dimension?: string; change?: number };
                    const npcId = rel.characterId || rel.npcId;
                    if (npcId && rel.dimension && typeof rel.change === 'number') {
                      this.deps.incrementalValidator.trackRelationshipChange(npcId, rel.dimension, rel.change);
                    }
                  }
                }
              }
            }
            // === CHOICE PAYOFF BEATS ===
            // For non-branching choices (expression/flavor), create per-choice payoff beats
            // so each choice gets a unique visual beat showing the action before advancing.
            const finalChoiceSet = choiceSets[choiceSets.length - 1];
            if (finalChoiceSet) {
              const nonBranchingChoices = finalChoiceSet.choices.filter(
                c => !c.nextSceneId && !c.nextBeatId
              );

              if (nonBranchingChoices.length > 0 && choicePointBeat) {
                // Final scene (empty leadsTo) → episode-end sentinel so payoff beats route consistently (reader finishes on it) instead of dead-ending.
                const nextSceneId = sceneBlueprint.leadsTo?.[0] || 'episode-end';

                // The choice point is the scene's decision beat; navigation
                // after a choice flows payoff → next scene, never back to the
                // choice point. A self-referential successor (some SceneWriter
                // outputs point the last/choice beat at itself) would loop
                // payoff → choice point → payoff forever, so treat it as "no
                // onward beat" and let the payoff advance to the next scene.
                const choicePointSuccessor =
                  choicePointBeat.nextBeatId && choicePointBeat.nextBeatId !== choicePointBeat.id
                    ? choicePointBeat.nextBeatId
                    : undefined;

                for (let ci = 0; ci < nonBranchingChoices.length; ci++) {
                  const choice = nonBranchingChoices[ci];
                  const payoffId = `${choicePointBeat.id}-payoff-${ci + 1}`;

                  // Use the authored outcomeTexts.partial as the narrative prose for this beat.
                  // This is the original story text describing the choice IN ACTION — not the
                  // choice label itself (which is dialogue / a decision prompt, not prose).
                  //
                  // Fallback chain (best → worst):
                  //   1. outcomeTexts.partial — distinct narrative prose (preferred)
                  //   2. reactionText — world response to the choice (better than repeating label)
                  //   3. Derived from choice label — used only as last resort
                  const GENERIC_REACTION = 'The moment settles, its weight already reshaping what comes next.';
                  const partialIsDistinct = choice.outcomeTexts?.partial
                    && choice.outcomeTexts.partial.trim() !== choice.text.trim();
                  const reactionIsDistinct = choice.reactionText
                    && choice.reactionText.trim() !== choice.text.trim()
                    && choice.reactionText.trim() !== GENERIC_REACTION;
                  
                  const narrativeText = partialIsDistinct
                    ? choice.outcomeTexts!.partial
                    : reactionIsDistinct
                      ? choice.reactionText!
                      : (choice.text.endsWith('.') ? choice.text : choice.text + '.');
                  
                  if (!partialIsDistinct) {
                    console.warn(`[Pipeline] ⚠ Choice "${choice.id}" has no distinct outcomeTexts.partial — payoff beat will ${reactionIsDistinct ? 'use reactionText' : 'repeat choice label'}. This means the ChoiceAuthor LLM omitted or repeated outcomeTexts for this choice.`);
                  }

                  const payoffBeat: GeneratedBeat & {
                    isChoicePayoff?: boolean;
                    textVariants?: Array<{ condition: object; text: string }>;
                    choiceContext?: string;
                  } = {
                    id: payoffId,
                    text: narrativeText,
                    // textVariants: swap to success/failure outcome prose at runtime based on stat-check result
                    // (drops variants identical to the base text — pure runtime no-ops)
                    textVariants: buildOutcomeTextVariants(choice.outcomeTexts, narrativeText),
                    isChoicePoint: false,
                    nextBeatId: choicePointSuccessor,
                    // When the choice point has no real onward beat, route the
                    // payoff straight to the next scene instead of dead-ending
                    // or looping back into the choice point.
                    nextSceneId: choicePointSuccessor ? undefined : nextSceneId,
                    // A payoff beat that carries the scene transition IS the
                    // choice bridge: it's the prose beat between the choice and
                    // the next scene. Flag it so the scene-graph branching
                    // contract (which rejects choices that teleport without a
                    // bridge beat) recognizes it. See SceneGraphBranchValidator.
                    isChoiceBridge: !choicePointSuccessor && !!nextSceneId,
                    // Use the narrative prose as the visual description, NOT the choice label.
                    // The choice label is dialogue/decision text; the outcomeTexts describe the
                    // physical action unfolding — which is what the image should depict.
                    visualMoment: narrativeText,
                    primaryAction: narrativeText,
                    emotionalRead: 'Living out the consequences of the chosen action',
                    // mustShowDetail is intentionally omitted here — embedding the narrative
                    // prose into the composition "Must include:" field produces bad prompts.
                    // The visualMoment + primaryAction fields carry the visual intent.
                    //
                    // Store the choice label separately so the image system can use it as a
                    // natural-language anchor ("the player chose X — show it playing out").
                    choiceContext: choice.text,
                    isChoicePayoff: true,
                  };

                  choice.nextBeatId = payoffId;
                  sceneContent.beats.push(payoffBeat as GeneratedBeat);
                }

                context.emit({
                  type: 'debug',
                  phase: 'choices',
                  message: `Created ${nonBranchingChoices.length} payoff beats for expression choices in ${sceneBlueprint.id}`,
                });
              }
            }

            } // close else (choiceResult success)
          }
          contentWorkCompleted += 1;
          this.deps.emitPhaseProgress(
            'content',
            contentWorkCompleted,
            contentWorkTotal,
            'content:work',
            `Choice pass complete for ${sceneBlueprint.id}`
          );
        }

        // === INCREMENTAL SCENE VALIDATION (Voice, Sensitivity, Continuity) ===
        if (this.deps.incrementalValidator) {
          const voiceProfiles: CharacterVoiceProfile[] = sceneBlueprint.npcsPresent
            .map(npcId => {
              const profile = resolveCharacterProfile(characterBible.characters, npcId);
              if (profile && profile.voiceProfile) {
                return {
                  id: profile.id,
                  name: profile.name,
                  voiceProfile: profile.voiceProfile,
                };
              }
              return null;
            })
            .filter((p): p is CharacterVoiceProfile => p !== null);

          const sceneChoiceSet = choiceSets.find(cs => 
            sceneContent.beats.some(b => b.id === cs.beatId)
          );

          const sceneValidation = await this.deps.incrementalValidator.validateScene(
            sceneContent,
            sceneChoiceSet,
            voiceProfiles,
            undefined // No encounter for regular scenes
          );
          sceneValidation.episodeNumber = brief.episode.number;

          this.deps.recordSceneValidationResult(sceneValidation);

          context.emit({
            type: 'incremental_validation',
            phase: 'scene_complete',
            message: `Scene ${sceneBlueprint.id}: ${sceneValidation.overallPassed ? 'PASSED' : 'ISSUES FOUND'}`,
            data: {
              povClarity: sceneValidation.povClarity ? { passed: sceneValidation.povClarity.passed, issues: sceneValidation.povClarity.issues.length } : null,
              voice: sceneValidation.voice ? { score: sceneValidation.voice.score, issues: sceneValidation.voice.issues.length } : null,
              sensitivity: sceneValidation.sensitivity ? { passed: sceneValidation.sensitivity.passed, flags: sceneValidation.sensitivity.flags.length } : null,
              continuity: sceneValidation.continuity ? { passed: sceneValidation.continuity.passed, issues: sceneValidation.continuity.issues.length } : null,
            },
          });

          // Emit warnings for sensitivity issues
          if (sceneValidation.sensitivity && !sceneValidation.sensitivity.passed) {
            context.emit({
              type: 'warning',
              phase: 'sensitivity',
              message: `Content rating concern in ${sceneBlueprint.id}: may push to ${sceneValidation.sensitivity.ratingImplication}`,
              data: { flags: sceneValidation.sensitivity.flags },
            });
          }

          // Emit warnings for continuity issues (non-blocking)
          if (sceneValidation.continuity && !sceneValidation.continuity.passed) {
            for (const issue of sceneValidation.continuity.issues.filter(i => i.severity === 'error')) {
              context.emit({
                type: 'warning',
                phase: 'continuity',
                message: `Continuity issue in ${sceneBlueprint.id}: ${issue.detail}`,
              });
            }
          }

          // === KARPATHY LOOP: Scene regeneration based on POV/voice/continuity validation ===
          if (
            sceneValidation.regenerationRequested === 'scene' &&
            (incrementalConfig.povClarityValidation || incrementalConfig.voiceValidation)
          ) {
            // S3: degrade gracefully when the per-run remediation budget is spent
            // (default 1000 ceiling => never trips in normal operation).
            if (!shouldAttemptRemediation(this.deps.remediationBudget)) {
              context.emit({
                type: 'warning',
                phase: 'scenes',
                message: `Remediation budget exhausted; accepting scene ${sceneBlueprint.id} as-is`,
              });
              await this.deps.recordRemediationSafe({
                rule: 'scene_regeneration', scope: 'scene', attempted: 0,
                succeeded: false, degraded: true, blocked: false, attempts: 0,
                storyId: idSlugify(brief.story.title), details: `Scene ${sceneBlueprint.id} not regenerated — budget exhausted`,
              });
            } else {
            let sceneRegenAttempt = 0;
            const maxSceneRegenAttempts = incrementalConfig.maxRegenerationAttempts;

            while (sceneRegenAttempt < maxSceneRegenAttempts) {
              sceneRegenAttempt++;
              this.deps.remediationBudget?.spend(1); // S3: debit one regeneration attempt
              const issueDescriptions: string[] = [];
              if (sceneValidation.povClarity && sceneValidation.povClarity.issues.length > 0) {
                issueDescriptions.push(
                  ...sceneValidation.povClarity.issues.map(i => `POV clarity issue: ${i.issue} ${i.suggestion}`)
                );
              }
              if (sceneValidation.voice && sceneValidation.voice.issues.length > 0) {
                issueDescriptions.push(
                  ...sceneValidation.voice.issues.map(i => `Voice issue (${i.characterName}): ${i.issue}`)
                );
              }
              if (sceneValidation.continuity && sceneValidation.continuity.issues.length > 0) {
                issueDescriptions.push(
                  ...sceneValidation.continuity.issues.map(i => `Continuity: ${i.detail}`)
                );
              }

              context.emit({
                type: 'regeneration_triggered',
                phase: 'scenes',
                message: `Regenerating scene ${sceneBlueprint.id} for POV/voice/continuity (attempt ${sceneRegenAttempt}/${maxSceneRegenAttempts})`,
                data: { reason: issueDescriptions },
              });

              const revisedSceneResult = await withTimeout(this.deps.sceneWriter.execute({
                sceneBlueprint,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - Fix these issues from validation:\n${issueDescriptions.join('\n')}\n\nEXISTING SCENE CONTENT TO PRESERVE STRUCTURALLY:\n${JSON.stringify(sceneContent).slice(0, 12000)}\n\nFor POV clarity fixes, rewrite only prose/textVariants needed to anchor POV to the player character. Preserve beat IDs, visual contract fields, choice-point flags, thread IDs, callback IDs, and navigation. The first non-empty beat must use you/your, the protagonist name, or a concrete pronoun before focusing on NPCs, setting, or exposition. Do not emit template variables.`,
                  worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                  description: protagonistProfile?.fullBackground || brief.protagonist.description,
                  physicalDescription: protagonistProfile?.physicalDescription,
                },
                npcs: sceneBlueprint.npcsPresent.map(npcId => {
                  const profile = resolveCharacterProfile(characterBible.characters, npcId);
                  return {
                    id: npcId,
                    name: profile?.name || npcId,
                    pronouns: profile?.pronouns || 'they/them',
                    description: profile?.overview || '',
                    physicalDescription: profile?.physicalDescription,
                    voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                    currentMood: profile?.voiceProfile?.whenNervous,
                  };
                }),
                relevantFlags: blueprint.suggestedFlags,
                relevantScores: blueprint.suggestedScores,
                targetBeatCount: this.deps.getTargetBeatCountForScene(sceneBlueprint),
                dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
                previousSceneSummary: previousScene
                  ? `Previous: ${previousScene.sceneName} - ${previousScene.keyMoments.join(', ')}`
                  : undefined,
                incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: this.deps.cachedPipelineMemory || undefined,
              }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneBlueprint.id} regen-${sceneRegenAttempt})`);

              if (!revisedSceneResult.success || !revisedSceneResult.data) {
                context.emit({
                  type: 'warning',
                  phase: 'scenes',
                  message: `Scene regeneration failed for ${sceneBlueprint.id}, keeping original`,
                });
                break;
              }

              const revisedContent = revisedSceneResult.data;
              revisedContent.sceneId = sceneBlueprint.id;
              revisedContent.sceneName = revisedContent.sceneName || sceneBlueprint.name;
              revisedContent.locationId = sceneSettingContext.locationId;
              revisedContent.settingContext = sceneSettingContext;
              revisedContent.requiredBeats = sceneBlueprint.requiredBeats;
              revisedContent.signatureMoment = sceneBlueprint.signatureMoment;

              // Realization guard: a POV/voice rewrite must not LOSE an
              // authored moment the current prose depicts — the season-final
              // realization validators block on it and a voice win is not
              // worth a contract abort. Deterministic check, no LLM.
              if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
                const lost = rewriteLosesRequiredMoment(sceneBlueprint, sceneContent.beats, revisedContent.beats);
                if (lost) {
                  context.emit({
                    type: 'warning',
                    phase: 'scenes',
                    message: `Scene regen for ${sceneBlueprint.id} dropped the authored ${lost.tier} moment ("${lost.moment.slice(0, 80)}…") — keeping the original prose`,
                  });
                  break;
                }
              }

              const revisedValidation = await this.deps.incrementalValidator.validateScene(
                revisedContent,
                sceneChoiceSet,
                voiceProfiles,
                undefined
              );
              revisedValidation.episodeNumber = brief.episode.number;

              if (revisedValidation.regenerationRequested === 'none' ||
                  (revisedValidation.voice && sceneValidation.voice &&
                   revisedValidation.voice.score > sceneValidation.voice.score) ||
                  (revisedValidation.povClarity?.passed && !sceneValidation.povClarity?.passed)) {
                // Revised version is better — swap it in
                const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneBlueprint.id);
                if (sceneIdx !== -1) {
                  sceneContents[sceneIdx] = revisedContent;
                }
                // Update the validation result too
                const valIdx = this.deps.sceneValidationResults.findIndex(v =>
                  v.sceneId === sceneBlueprint.id && (v.episodeNumber === undefined || v.episodeNumber === brief.episode.number)
                );
                if (valIdx !== -1) {
                  this.deps.sceneValidationResults[valIdx] = revisedValidation;
                }
                this.deps.recordSceneValidationResult(revisedValidation);
                context.emit({
                  type: 'debug',
                  phase: 'scenes',
                  message: `Scene ${sceneBlueprint.id} regenerated successfully (pov: ${sceneValidation.povClarity?.score ?? '?'} -> ${revisedValidation.povClarity?.score ?? '?'}, voice: ${sceneValidation.voice?.score ?? '?'} -> ${revisedValidation.voice?.score ?? '?'})`,
                });
                await this.deps.recordRemediationSafe({
                  rule: 'scene_regeneration', scope: 'scene', attempted: 1,
                  succeeded: true, degraded: false, blocked: false, attempts: sceneRegenAttempt,
                  storyId: idSlugify(brief.story.title), details: `Scene ${sceneBlueprint.id} regenerated for POV/voice/continuity`,
                });
                break;
              }

              // Update references for next loop iteration
              Object.assign(sceneValidation, revisedValidation);

              // S3: loop exhausted without acceptance — record a degrade.
              if (sceneRegenAttempt >= maxSceneRegenAttempts) {
                await this.deps.recordRemediationSafe({
                  rule: 'scene_regeneration', scope: 'scene', attempted: sceneRegenAttempt,
                  succeeded: false, degraded: true, blocked: false, attempts: sceneRegenAttempt,
                  storyId: idSlugify(brief.story.title), details: `Scene ${sceneBlueprint.id} regeneration exhausted; kept best available`,
                });
              }
            }
            }
          }

          // === KARPATHY LOOP (B1): regenerate the choice set on a stakes failure. ===
          // Pure default-off gate: with GATE_REGEN_CHOICES unset shouldRegenChoices
          // is always false, so this loop never runs and behavior is unchanged.
          if (
            shouldRegenChoices(
              sceneValidation.regenerationRequested,
              incrementalConfig.stakesValidation,
              gateEnabledPredicate,
            ) &&
            this.deps.incrementalValidator
          ) {
            const regenChoicePointBeat = sceneContent.beats.find(b => b.isChoicePoint);
            // Locate the choice set holder for this scene (matched by beatId).
            const choiceSetIdx = sceneChoiceSet
              ? choiceSets.findIndex(cs => cs === sceneChoiceSet)
              : -1;

            if (regenChoicePointBeat && sceneChoiceSet && choiceSetIdx !== -1 && sceneValidation.stakes &&
                shouldAttemptRemediation(this.deps.remediationBudget)) {
              let choicesRegenAttempt = 0;
              const maxChoicesRegenAttempts = incrementalConfig.maxRegenerationAttempts;
              let currentStakes = sceneValidation.stakes;
              let currentChoiceSet = sceneChoiceSet;
              let choicesAccepted = false;

              while (choicesRegenAttempt < maxChoicesRegenAttempts && shouldAttemptRemediation(this.deps.remediationBudget)) {
                choicesRegenAttempt++;
                this.deps.remediationBudget?.spend(1); // S3: debit one regeneration attempt
                const stakesIssueDescriptions = currentStakes.issues
                  .map(i => `- [${i.severity}] ${i.issue}${i.suggestion ? ` (${i.suggestion})` : ''}`)
                  .join('\n');

                context.emit({
                  type: 'regeneration_triggered',
                  phase: 'choices',
                  message: `Regenerating choices for ${sceneBlueprint.id} for stakes (attempt ${choicesRegenAttempt}/${maxChoicesRegenAttempts}): ${currentStakes.issues.length} issue(s)`,
                  data: { issues: currentStakes.issues },
                });

                try {
                  const revisedChoiceResult = await withTimeout(this.deps.choiceAuthor.execute({
                    sceneBlueprint,
                    beatText: regenChoicePointBeat.text,
                    beatId: regenChoicePointBeat.id,
                    storyContext: {
                      title: brief.story.title,
                      genre: brief.story.genre,
                      tone: brief.story.tone,
                      userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL CHOICE FIXES REQUIRED — the choice set failed stakes validation. Fix these issues:\n${stakesIssueDescriptions}`,
                      worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
                    },
                    protagonistInfo: {
                      name: brief.protagonist.name,
                      pronouns: brief.protagonist.pronouns,
                    },
                    npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
                    availableFlags: blueprint.suggestedFlags,
                    availableScores: blueprint.suggestedScores,
                    availableTags: blueprint.suggestedTags,
                    possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                      const scene = blueprint.scenes.find(s => s.id === id);
                      return { id, name: scene?.name || id, description: scene?.description || '' };
                    }),
                    optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
                    sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                    memoryContext: this.deps.cachedPipelineMemory || undefined,
                    storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
                  }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${sceneBlueprint.id} regen-choices-${choicesRegenAttempt})`);

                  if (!revisedChoiceResult.success || !revisedChoiceResult.data) {
                    context.emit({
                      type: 'warning',
                      phase: 'choices',
                      message: `Choice regeneration failed for ${sceneBlueprint.id}, keeping previous choices`,
                    });
                    break;
                  }

                  const revisedChoiceSet = { ...revisedChoiceResult.data, sceneId: sceneBlueprint.id };
                  const revisedStakes = this.deps.incrementalValidator.validateStakes(revisedChoiceSet);

                  if (isChoiceRegenImprovement(currentStakes.issues.length, revisedStakes.issues.length, revisedStakes.passed)) {
                    // Accept the rewrite: swap it into the choiceSets holder and
                    // refresh the recorded scene validation result.
                    choiceSets[choiceSetIdx] = revisedChoiceSet;
                    currentChoiceSet = revisedChoiceSet;
                    const valIdx = this.deps.sceneValidationResults.findIndex(v =>
                      v.sceneId === sceneBlueprint.id && (v.episodeNumber === undefined || v.episodeNumber === brief.episode.number)
                    );
                    if (valIdx !== -1) {
                      const updated = {
                        ...this.deps.sceneValidationResults[valIdx],
                        stakes: revisedStakes,
                        overallPassed: this.deps.sceneValidationResults[valIdx].overallPassed && revisedStakes.passed,
                        regenerationRequested: revisedStakes.passed
                          ? ('none' as const)
                          : ('choices' as const),
                      };
                      this.deps.sceneValidationResults[valIdx] = updated;
                      this.deps.recordSceneValidationResult(updated);
                    }
                    context.emit({
                      type: 'debug',
                      phase: 'choices',
                      message: `Choices for ${sceneBlueprint.id} regenerated (stakes issues: ${currentStakes.issues.length} -> ${revisedStakes.issues.length}, passed: ${revisedStakes.passed})`,
                    });
                    currentStakes = revisedStakes;
                    if (revisedStakes.passed) { choicesAccepted = true; break; }
                  } else {
                    context.emit({
                      type: 'debug',
                      phase: 'choices',
                      message: `Choice regen attempt ${choicesRegenAttempt} for ${sceneBlueprint.id} did not improve, keeping previous`,
                    });
                  }
                } catch (regenChoicesErr) {
                  context.emit({
                    type: 'warning',
                    phase: 'choices',
                    message: `Choice regeneration threw for ${sceneBlueprint.id}: ${regenChoicesErr instanceof Error ? regenChoicesErr.message : String(regenChoicesErr)}`,
                  });
                  break;
                }
              }
              // Keep `sceneChoiceSet` consistent with the accepted rewrite so any
              // later same-scope reads see the regenerated choices (degrades to the
              // last accepted set on exhaustion).
              void currentChoiceSet;
              // S3: record the terminal outcome (passed => succeeded; otherwise degraded).
              await this.deps.recordRemediationSafe({
                rule: 'choice_regeneration', scope: 'choices', attempted: choicesRegenAttempt,
                succeeded: choicesAccepted, degraded: !choicesAccepted, blocked: false, attempts: choicesRegenAttempt,
                storyId: idSlugify(brief.story.title),
                details: choicesAccepted
                  ? `Choices for ${sceneBlueprint.id} regenerated; stakes passed`
                  : `Choices for ${sceneBlueprint.id} regen exhausted; kept best available`,
              });
            }
          }
        }
      }

      // Encounter Architect (if this is an encounter scene)
      if (sceneBlueprint.isEncounter && sceneBlueprint.encounterType) {
        context.emit({
          type: 'agent_start',
          agent: 'EncounterArchitect',
          message: `Designing ${sceneBlueprint.encounterType} encounter for ${sceneBlueprint.name}`,
        });

        // Build available skills — start with defaults, then merge in season plan skills
        const defaultSkills: Array<{ name: string; attribute: string; description: string }> = [...DEFAULT_SKILLS];
        const seasonEp = brief.seasonPlan?.episodes.find(e => e.episodeNumber === brief.episode.number);
        const plannedEnc = seasonEp?.plannedEncounters?.find(pe => 
          pe.id === sceneBlueprint.plannedEncounterId ||
          pe.id === sceneBlueprint.id || 
          sceneBlueprint.name?.toLowerCase().includes(pe.description?.toLowerCase()?.substring(0, 20) || '')
        );
        const encounterBeatPlan = (sceneBlueprint.encounterBeatPlan && sceneBlueprint.encounterBeatPlan.length > 0
          ? sceneBlueprint.encounterBeatPlan
          : [
              sceneBlueprint.encounterBuildup || plannedEnc?.encounterBuildup || `Opening pressure around ${sceneBlueprint.encounterDescription || sceneBlueprint.description}`,
              sceneBlueprint.encounterDescription || plannedEnc?.description || sceneBlueprint.description,
              sceneBlueprint.encounterStakes || plannedEnc?.stakes || 'A final commitment decides the cost of success or failure',
            ]
        )
          .map((beat) => (beat || '').trim())
          .filter(Boolean)
          .slice(0, 5);
        const encounterRelevantSkills = Array.from(new Set([
          ...(sceneBlueprint.encounterRelevantSkills || []),
          ...(plannedEnc?.relevantSkills || []),
        ].map((skill) => skill.trim()).filter(Boolean)));
        // Only characters that were actually DESIGNED (exist in the character bible)
        // and are not clearly off-page relations may be FORCED present in the encounter.
        // The season roster over-harvests names from treatment prose — e.g. Kylie's
        // 7-year-old niece Sadie in Boston, a FaceTime/photo only — and the unfiltered
        // union forced EncounterArchitect to stage her at the Bucharest rooftop with full
        // relationship dimensions. An undeclared or remote name can still be REFERENCED in
        // prose; it just won't be a required present NPC. (Ties into the WS1 cast gap.)
        const OFF_PAGE_RELATION = /\b(niece|nephew|grandchild|in Boston|back home|overseas|abroad|long[- ]distance|via (?:face\s?time|phone|video)|on the phone|photo on (?:her|the) desk)\b/i;
        const isStageablePresent = (npcId: string): boolean => {
          const profile = resolveCharacterProfile(characterBible.characters, npcId);
          if (!profile) return false; // undeclared name — never force-stage it (reference only)
          const briefNpc = brief.npcs.find((n) => n.id === npcId || n.name === npcId);
          const text = [
            profile.role,
            profile.description,
            (briefNpc as { relationshipToProtagonist?: string } | undefined)?.relationshipToProtagonist,
            briefNpc?.description,
          ].filter(Boolean).join(' ');
          return !OFF_PAGE_RELATION.test(text);
        };
        const encounterRequiredNpcIds = filterProtagonistEncounterRefs(Array.from(new Set([
          ...(sceneBlueprint.encounterRequiredNpcIds || []),
          ...(plannedEnc?.npcsInvolved || []),
          ...(sceneBlueprint.npcsPresent || []),
        ])), brief.protagonist).filter(isStageablePresent);
        
        // NOTE: encounterRelevantSkills are passed to the architect as *prompt
        // hints* (see availableSkills/encounterRelevantSkills inputs below), but
        // they must NOT be merged into the valid-skill canon. The story's skill
        // set is hardwired to DEFAULT_SKILLS (see initialState.skills), so any
        // name beyond those (e.g. "empathy", "resolve", "honesty") is undefined
        // at runtime and fails FinalStoryContractValidator's playable-encounter
        // check. Keeping availableSkills == DEFAULT_SKILLS lets EncounterArchitect's
        // snapEncounterSkill() map invented skills back to a canonical one
        // (empathy→persuasion, agility→athletics, …). Do NOT re-add a merge here.
        // See docs/PROJECT_AUDIT_2026-05-28.md (F1).

        // Determine next scene IDs for storylet branching
        // Victory continues to first leadsTo scene, defeat to second (or same if only one)
        const leadsToScenes = sceneBlueprint.leadsTo || [];
        const victoryNextSceneId = leadsToScenes[0] || '';
        const defeatNextSceneId = leadsToScenes[1] || leadsToScenes[0] || '';

        // Dynamic beat count based on difficulty - use config.generation.encounterBeatCount as base.
        // Scene-length milestone encounters can be richer, but still honor the configured effective path cap.
        const sceneEpisodeEncounterMax = context.config.generation?.episodeStructureMode === 'sceneEpisodes'
          ? (context.config.generation.sceneEpisodeEncounterMaxBeats || 15)
          : undefined;
        const baseEncounterBeats = context.config.generation?.encounterBeatCount || 4;
        const beatCountByDifficulty: Record<string, number> = {
          easy: Math.max(2, baseEncounterBeats - 1),
          moderate: baseEncounterBeats,
          hard: baseEncounterBeats + 1,
          extreme: baseEncounterBeats + 2,
        };
        // Honor the authored anchor: a treatment encounterBeatPlan enumerates the
        // required beats (e.g. a two-location "rooftop + 1am attack/rescue"
        // sequence). Target at least one beat per planned anchor so the architect
        // renders the full shape on the first pass instead of collapsing it.
        const uncappedTargetBeatCount = Math.max(
          beatCountByDifficulty[sceneBlueprint.encounterDifficulty || 'moderate'] || baseEncounterBeats,
          encounterBeatPlan.length,
        );
        const targetBeatCount = sceneEpisodeEncounterMax
          ? Math.min(sceneEpisodeEncounterMax, uncappedTargetBeatCount)
          : uncappedTargetBeatCount;

        // Extract protagonist skills from character profile if available
        const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);
        const protagonistSkills = protagonistProfile?.skills?.map(s => ({
          name: s.name,
          level: s.level || 1,
        })) || [];

        // Build NPCs list - add a fallback antagonist if none present for combat/chase encounters
        let npcsInvolved = encounterRequiredNpcIds.map(npcId => {
          const profile = resolveCharacterProfile(characterBible.characters, npcId);
          const npcBrief = brief.npcs.find(n => n.id === npcId);
          return {
            id: npcId,
            name: profile?.name || npcId,
            pronouns: (profile?.pronouns || 'they/them') as 'he/him' | 'she/her' | 'they/them',
            role: (npcBrief?.role === 'antagonist' ? 'enemy' : 
                   npcBrief?.role === 'ally' ? 'ally' : 
                   npcBrief?.role === 'neutral' ? 'neutral' : 'obstacle') as 'ally' | 'enemy' | 'neutral' | 'obstacle',
            description: profile?.overview || '',
            physicalDescription: profile?.physicalDescription,
            voiceNotes: profile?.voiceProfile?.writingGuidance || '',
          };
        });

        // If no NPCs for an encounter that typically needs one, create a placeholder
        if (npcsInvolved.length === 0 && ['combat', 'chase', 'social', 'stealth'].includes(sceneBlueprint.encounterType || '')) {
          this.deps.throwIfFailFast(
            `Encounter ${sceneBlueprint.id} has no NPC participants to author against`,
            'encounter_generation',
            {
              agent: 'EncounterArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                encounterType: sceneBlueprint.encounterType,
                failureKind: 'validation',
              },
            }
          );
          console.warn(`[Pipeline] No NPCs for ${sceneBlueprint.encounterType} encounter ${sceneBlueprint.id} - creating placeholder antagonist`);
          npcsInvolved = [{
            id: 'unnamed-antagonist',
            name: 'the adversary',
            pronouns: 'they/them' as const,
            role: 'enemy' as const,
            description: sceneBlueprint.encounterDescription || 'An opposing force',
            physicalDescription: undefined,
            voiceNotes: '',
          }];
        }

        if (plannedEnc && sceneBlueprint.plannedEncounterId !== plannedEnc.id) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is not explicitly bound to planned encounter ${plannedEnc.id}. Story Architect must set plannedEncounterId exactly.`,
            'encounters',
            {
              agent: 'StoryArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                plannedEncounterId: plannedEnc.id,
                failureKind: 'validation',
              },
            }
          );
        }

        if (!(sceneBlueprint.encounterDescription || plannedEnc?.description || sceneBlueprint.description)) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing an encounter description.`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }
        if (!(sceneBlueprint.encounterStakes || plannedEnc?.stakes)) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing encounter stakes.`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }
        if (encounterBeatPlan.length < 3) {
          throw new PipelineError(
            `Encounter scene ${sceneBlueprint.id} is missing a usable encounter beat plan (need at least 3 beats).`,
            'encounters',
            { agent: 'StoryArchitect', context: { sceneId: sceneBlueprint.id, failureKind: 'validation' } }
          );
        }

        // Build priorStateContext from the blueprint's encounterSetupContext and
        // the suggested flags/relationships defined by the StoryArchitect.
        // Pass current setFlags so the architect knows which flags are already available.
        const currentSetFlags = this.deps.incrementalValidator?.getSetFlags();
        const priorStateContext = this.deps.buildEncounterPriorStateContext(
          sceneBlueprint,
          blueprint,
          npcsInvolved,
          currentSetFlags
        );
        if (priorStateContext) {
          const authoredRelationships = priorStateContext.relevantRelationships.filter((entry) => entry.authored !== false).length;
          const autoRelationships = priorStateContext.relevantRelationships.filter((entry) => entry.authored === false).length;
          context.emit({
            type: 'debug',
            phase: 'encounters',
            message: `Encounter prior-state context for ${sceneBlueprint.id}: ${priorStateContext.relevantFlags.length} flag(s), ${authoredRelationships} authored relationship check(s), ${autoRelationships} fallback relationship check(s), ${priorStateContext.significantChoices.length} significant choice hint(s)`,
          });
        }

        // G12: episode-so-far summary — without it the architect re-staged the
        // premise from scratch (timeline rewound to arrival night, established
        // relationships erased, protagonist seated as an NPC).
        const sceneOrder = blueprint.scenes || [];
        const encounterSceneIdx = sceneOrder.findIndex((sc) => sc.id === sceneBlueprint.id);
        const episodeSoFarSummary = encounterSceneIdx > 0
          ? sceneOrder.slice(0, encounterSceneIdx)
              .map((sc, i) => `${i + 1}. ${sc.name}${sc.location ? ` [${sc.location}]` : ''}: ${(sc.description || '').replace(/\s+/g, ' ').slice(0, 220)}`)
              .join('\n')
          : undefined;

        const encounterInput: EncounterArchitectInput = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          sceneDescription: sceneBlueprint.description,
          sceneMood: sceneBlueprint.mood,
          sceneLocation: sceneBlueprint.location,
          // Timeline handoff across the encounter seam — the audited hard cuts
          // (e.g. afternoon bookshop → 4am rooftop) happened at encounter scenes.
          sceneTimeline: buildSceneTimelineHandoff(blueprint.scenes || [], sceneBlueprint),
          plannedEncounterId: sceneBlueprint.plannedEncounterId || plannedEnc?.id,
          storyContext: {
            title: brief.story.title,
            genre: brief.story.genre,
            tone: brief.story.tone,
            userPrompt: brief.userPrompt,
          },
          encounterType: sceneBlueprint.encounterType,
          encounterStyle: sceneBlueprint.encounterStyle || plannedEnc?.style || (
            sceneBlueprint.encounterType === 'combat' || sceneBlueprint.encounterType === 'chase'
              ? 'action'
              : sceneBlueprint.encounterType === 'stealth' || sceneBlueprint.encounterType === 'heist'
                ? 'stealth'
                : sceneBlueprint.encounterType === 'exploration' || sceneBlueprint.encounterType === 'survival'
                  ? 'adventure'
                  : sceneBlueprint.encounterType === 'puzzle' || sceneBlueprint.encounterType === 'investigation'
                    ? 'mystery'
                    : sceneBlueprint.encounterType === 'romantic'
                      ? 'romantic'
                      : sceneBlueprint.encounterType === 'dramatic'
                        ? 'dramatic'
                        : 'social'
          ),
          encounterDescription: sceneBlueprint.encounterDescription || sceneBlueprint.description,
          encounterStakes: sceneBlueprint.encounterStakes || plannedEnc?.stakes,
          // Authored-treatment anchor (G12): the architect must SEE the
          // authored texts to realize them — EncounterAnchorContentValidator
          // blocks the run when one is missing from the encounter's prose.
          requiredBeats: sceneBlueprint.requiredBeats?.map((beat) => ({
            id: beat.id,
            mustDepict: beat.mustDepict,
            tier: beat.tier,
          })),
          signatureMoment: sceneBlueprint.signatureMoment,
          centralConflict: sceneBlueprint.encounterCentralConflict || plannedEnc?.centralConflict,
          encounterRequiredNpcIds,
          encounterRelevantSkills,
          encounterBeatPlan,
          difficulty: sceneBlueprint.encounterDifficulty || 'moderate',
          partialVictoryCost: sceneBlueprint.encounterPartialVictoryCost,
          protagonistInfo: {
            name: brief.protagonist.name,
            pronouns: brief.protagonist.pronouns,
            physicalDescription: protagonistProfile?.physicalDescription,
            relevantSkills: protagonistSkills.length > 0 ? protagonistSkills : undefined,
          },
          npcsInvolved,
          availableSkills: defaultSkills,
          targetBeatCount,
          victoryNextSceneId,
          defeatNextSceneId,
          // Blueprint branch discipline: prefer the season plan's explicit flag,
          // else infer from the scene's leadsTo fan-out; undefined = unknown.
          isBranchPoint: plannedEnc?.isBranchPoint
            ?? (leadsToScenes.length > 0 ? new Set(leadsToScenes).size > 1 : undefined),
          priorStateContext,
          episodeSoFarSummary,
          forbiddenReveals: buildForbiddenReveals(
            brief.seasonPlan?.informationLedger,
            brief.episode?.number ?? 1,
            sceneBlueprint.revealsInfoIds,
          ),
          memoryContext: this.deps.cachedPipelineMemory || undefined,
          storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
          seasonAnchors: brief.seasonPlan?.anchors,
          seasonSevenPoint: brief.seasonPlan?.sevenPoint,
          episodeStructuralRole: brief.seasonPlan?.episodes.find(
            (e) => e.episodeNumber === brief.episode.number,
          )?.structuralRole,
        };

        const encounterInputSummary = {
          sceneId: sceneBlueprint.id,
          sceneName: sceneBlueprint.name,
          plannedEncounterId: sceneBlueprint.plannedEncounterId || plannedEnc?.id || 'none',
          encounterType: sceneBlueprint.encounterType,
          difficulty: sceneBlueprint.encounterDifficulty || 'moderate',
          descriptionChars: (sceneBlueprint.encounterDescription || sceneBlueprint.description || '').length,
          stakesChars: (sceneBlueprint.encounterStakes || plannedEnc?.stakes || '').length,
          userPromptChars: (brief.userPrompt || '').length,
          npcCount: npcsInvolved.length,
          requiredNpcCount: encounterRequiredNpcIds.length,
          availableSkillCount: defaultSkills.length,
          relevantSkillCount: encounterRelevantSkills.length,
          protagonistSkillCount: protagonistSkills.length,
          targetBeatCount,
          beatPlanCount: encounterBeatPlan.length,
          priorStateFlags: priorStateContext?.relevantFlags.length || 0,
          priorStateRelationships: priorStateContext?.relevantRelationships.length || 0,
          priorStateSignificantChoices: priorStateContext?.significantChoices.length || 0,
        };

        // Log input for debugging encounter generation issues
        console.log(`[Pipeline] EncounterArchitect input summary for ${sceneBlueprint.id}: ${JSON.stringify(encounterInputSummary)}`);
        console.log(`[Pipeline] EncounterArchitect input preview for ${sceneBlueprint.id}:
  - Scene: ${sceneBlueprint.name}
  - Planned encounter: ${sceneBlueprint.plannedEncounterId || plannedEnc?.id || 'none'}
  - Type: ${sceneBlueprint.encounterType}
  - Description: ${(sceneBlueprint.encounterDescription || sceneBlueprint.description || '').substring(0, 100)}...
  - Stakes: ${(sceneBlueprint.encounterStakes || plannedEnc?.stakes || '').substring(0, 100)}
  - Difficulty: ${sceneBlueprint.encounterDifficulty || 'moderate'}
  - NPCs: ${npcsInvolved.map(n => n.name).join(', ') || 'None'}
  - Target beats: ${targetBeatCount}
  - Beat plan: ${encounterBeatPlan.join(' | ')}`);

        // Build initial relationship snapshot from character profiles for the
        // relationship dynamics analysis in the phased encounter generator.
        const playerRelationships: Record<string, import('../../../types').Relationship> = {};
        for (const npc of npcsInvolved) {
          const profile = characterBible.characters.find(c => c.id === npc.id);
          const stats = profile?.initialStats;
          playerRelationships[npc.id] = {
            npcId: npc.id,
            trust: stats?.trust ?? 0,
            affection: stats?.affection ?? 0,
            respect: stats?.respect ?? 0,
            fear: stats?.fear ?? 0,
          };
        }
        const allNpcInfos = characterBible.characters
          .filter(c => c.id !== brief.protagonist.id)
          .map(c => ({ id: c.id, name: c.name }));

        // EncounterArchitect.execute() uses phased generation:
        //   Phase 1: Opening beat (180s timeout, sequential)
        //   Phase 2: Branch situations — one call per opening-beat choice, run at
        //            concurrency 2 (240s each, so ≥3 choices = 2 sequential waves)
        //   Phase 3: Enrichment (180s, only when priorStateContext is present)
        //   Phase 4: Storylets (180s) — phases 2/3/4 run in parallel after phase 1
        //   Lean flow on phased failure: lean prompt → retry with feedback
        // The outer PIPELINE_TIMEOUTS.encounterAgent budget must cover phase 1 PLUS
        // the parallel block (dominated by phase 2's waves) — see withTimeout.ts.
        // Each phase still aborts on its own timeout, so a true hang fails fast there.
        //
        // NO-BOILERPLATE MANDATE: the architect no longer ships a deterministic
        // template fallback — a total failure surfaces as a throw/success:false.
        // Give it one more FULL attempt with the failure fed back as guidance
        // (each attempt already retries internally) before failing the episode
        // at generation time, where a retry is cheap — never 90 minutes later
        // at the final contract.
        let encounterResult: AgentResponse<EncounterStructure> | null = null;
        let lastEncounterFailure: string | undefined;
        const maxEncounterAttempts = 2;
        for (let encAttempt = 1; encAttempt <= maxEncounterAttempts; encAttempt++) {
          const attemptInput: EncounterArchitectInput = lastEncounterFailure
            ? {
                ...encounterInput,
                storyContext: {
                  ...encounterInput.storyContext,
                  userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nPREVIOUS ATTEMPT FAILED: ${lastEncounterFailure}\nAddress the failure and return the complete, valid encounter JSON.`,
                },
              }
            : encounterInput;
          try {
            const attemptResult = await withTimeout(
              this.deps.encounterArchitect.execute(attemptInput, playerRelationships, allNpcInfos),
              PIPELINE_TIMEOUTS.encounterAgent,
              `EncounterArchitect.execute(${sceneBlueprint.id}${encAttempt > 1 ? ` attempt-${encAttempt}` : ''})`,
              () => {
                console.error(
                  `[Pipeline] EncounterArchitect safety-net timeout for ${sceneBlueprint.id}: ${JSON.stringify(encounterInputSummary)}`
                );
              }
            );
            if (attemptResult.success && attemptResult.data) {
              if (isEncounterNarrativelyHollow(attemptResult.data)) {
                lastEncounterFailure = 'EncounterArchitect returned a hollow encounter: no beat contains player-facing narrative setup, description, escalation, or choice outcome prose.';
              } else {
              encounterResult = attemptResult;
              break;
              }
            } else {
              lastEncounterFailure = attemptResult.error || 'EncounterArchitect returned no data';
            }
          } catch (encErr) {
            lastEncounterFailure = encErr instanceof Error ? encErr.message : String(encErr);
          }
          console.error(`[Pipeline] Encounter generation attempt ${encAttempt}/${maxEncounterAttempts} failed for ${sceneBlueprint.id}: ${lastEncounterFailure}`);
          context.emit({
            type: 'warning',
            phase: 'encounters',
            message: `Encounter generation attempt ${encAttempt}/${maxEncounterAttempts} failed for ${sceneBlueprint.id}: ${lastEncounterFailure}`,
          });
        }

        if (!encounterResult) {
          throw new PipelineError(
            `Encounter generation failed for ${sceneBlueprint.id} after ${maxEncounterAttempts} full attempt(s): ${lastEncounterFailure}`,
            'encounters',
            {
              agent: 'EncounterArchitect',
              context: {
                sceneId: sceneBlueprint.id,
                sceneName: sceneBlueprint.name,
                encounterType: sceneBlueprint.encounterType,
                failureKind: 'content',
              },
            }
          );
        }

        // Only register encounter + run validation if EncounterArchitect succeeded
        if (encounterResult?.success && encounterResult.data) {
          encounters.set(sceneBlueprint.id, encounterResult.data);
          this.deps.captureEncounterTelemetry(encounterResult.metadata, sceneBlueprint.id);
          context.emit({
            type: 'agent_complete',
            agent: 'EncounterArchitect',
            message: `Designed ${encounterResult.data.beats.length}-beat ${sceneBlueprint.encounterDifficulty || 'moderate'} encounter with ${Object.keys(encounterResult.data.storylets || {}).length} storylets for ${sceneBlueprint.id}`,
          });
          // Encounter (incl. outcomes + storylets) is fully built — only now is
          // this scene genuinely complete in the progress plan.
          if (this.deps.generationPlan) {
            setSceneBeats(
              this.deps.generationPlan,
              episodeNumber ?? brief.episode.number,
              sceneBlueprint.id,
              encounterResult.data.beats.length,
            );
            this.deps.emitPlanUpdate(`Encounter ${sceneBlueprint.id} complete`);
          }

          // === FLAG CHRONOLOGY CHECK: validate encounter conditions BEFORE tracking flags ===
          if (this.deps.incrementalValidator) {
            const conditionIssues = this.deps.incrementalValidator.checkEncounterChoiceConditions(encounterResult.data);
            if (conditionIssues.length > 0) {
              context.emit({
                type: 'warning',
                phase: 'encounter',
                message: `Encounter ${sceneBlueprint.id}: ${conditionIssues.length} flag chronology issue(s) — ${conditionIssues.map(i => i.detail).join('; ')}`,
              });
            }

            // Track setFlag consequences from encounter choice outcomes so
            // subsequent scenes/encounters see them in the flag tracker.
            this.deps.trackEncounterFlagConsequences(encounterResult.data);
          }

          // === INCREMENTAL ENCOUNTER VALIDATION ===
          if (this.deps.incrementalValidator && incrementalConfig.encounterValidation) {
            const encounterValidation = this.deps.incrementalValidator.validators.encounter.validateEncounter(encounterResult.data);
            
            // Get the placeholder scene content for this encounter
            const encounterSceneContent = sceneContents.find(sc => sc.sceneId === sceneBlueprint.id);
            
            if (encounterSceneContent) {
              // Create a validation result for the encounter scene
              const sceneValidation: SceneValidationResult = {
                sceneId: sceneBlueprint.id,
                episodeNumber: brief.episode.number,
                sceneName: sceneBlueprint.name,
                encounter: encounterValidation,
                overallPassed: encounterValidation.passed,
                regenerationRequested: encounterValidation.passed ? 'none' : 'encounter',
                validationTimeMs: 0,
              };
              
              this.deps.recordSceneValidationResult(sceneValidation);

              context.emit({
                type: 'incremental_validation',
                phase: 'encounter',
                message: `Encounter ${sceneBlueprint.id}: ${encounterValidation.passed ? 'PASSED' : 'ISSUES FOUND'} (${encounterValidation.beatCount} beats)`,
                data: {
                  passed: encounterValidation.passed,
                  beatCount: encounterValidation.beatCount,
                  hasVictoryPath: encounterValidation.hasVictoryPath,
                  hasDefeatPath: encounterValidation.hasDefeatPath,
                  issues: encounterValidation.issues,
                },
              });

              // Warn about missing victory/defeat paths
              if (!encounterValidation.hasVictoryPath || !encounterValidation.hasDefeatPath) {
                context.emit({
                  type: 'warning',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} may be missing ${!encounterValidation.hasVictoryPath ? 'victory' : ''} ${!encounterValidation.hasDefeatPath ? 'defeat' : ''} path`,
                });
              }

              // Phase-4 default-collisions (identical fallback prose) are
              // advisory: they drive a best-effort regeneration but NEVER fail
              // the recorded scene validation, so they can't cause aborts.
              let phase4Collisions = this.deps.getPhase4DefaultCollisions(encounterResult.metadata);
              if (phase4Collisions.length > 0) {
                context.emit({
                  type: 'warning',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} shipped default fallback prose for: ${phase4Collisions.join(', ')} — attempting regeneration for distinct outcomes`,
                });
              }

              // NO-BOILERPLATE MANDATE: scan the full encounter tree for template
              // prose at GENERATION time (the final contract's template-collapse
              // gate runs this same scan 90 minutes later and hard-aborts the run;
              // catching it here makes it a cheap per-scene regen instead). The
              // substring scan is a superset of the phase-4 hash-match collisions:
              // it also catches gap-filled default storylets and partially-edited
              // template fragments anywhere in the tree.
              let templateHits = scanEncounterTemplateProse(encounters.get(sceneBlueprint.id));
              if (templateHits.length > 0) {
                context.emit({
                  type: 'warning',
                  phase: 'encounter',
                  message: `Encounter ${sceneBlueprint.id} contains ${templateHits.length} template-prose signature(s) — regeneration required (template prose must never ship)`,
                });
              }

              // === KARPATHY LOOP: regenerate on a real failure, a collision, or template prose. ===
              if (
                (sceneValidation.regenerationRequested === 'encounter' || phase4Collisions.length > 0 || templateHits.length > 0) &&
                incrementalConfig.encounterValidation &&
                shouldAttemptRemediation(this.deps.remediationBudget)
              ) {
                let encounterRegenAttempt = 0;
                const maxEncounterRegenAttempts = incrementalConfig.maxRegenerationAttempts;
                let encounterAccepted = false;

                while (encounterRegenAttempt < maxEncounterRegenAttempts && shouldAttemptRemediation(this.deps.remediationBudget)) {
                  encounterRegenAttempt++;
                  this.deps.remediationBudget?.spend(1); // S3: debit one regeneration attempt
                  const issueDescriptions = encounterValidation.issues
                    .map(i => `- [${i.severity}] ${i.type}: ${i.detail}`)
                    .join('\n');

                  context.emit({
                    type: 'regeneration_triggered',
                    phase: 'encounters',
                    message: `Regenerating encounter ${sceneBlueprint.id} (attempt ${encounterRegenAttempt}/${maxEncounterRegenAttempts}): ${encounterValidation.issues.length} issue(s)`,
                    data: { issues: encounterValidation.issues },
                  });

                  const collisionGuidance = phase4Collisions.length > 0
                    ? `\n\nThese outcomes shipped identical fallback prose and MUST be authored as distinct, outcome-specific scenes: ${phase4Collisions.join(', ')}.`
                    : '';
                  const templateGuidance = templateHits.length > 0
                    ? `\n\nThe previous attempt contained GENERIC TEMPLATE PROSE that must be replaced with bespoke content grounded in this scene's stakes, setting, and characters. Offending fragments: ${templateHits.slice(0, 5).map(t => `"${t}"`).join(', ')}. Author every player-facing string (setup, choices, outcomes, storylets) specifically for this encounter.`
                    : '';
                  const regenEncounterInput: EncounterArchitectInput = {
                    ...encounterInput,
                    storyContext: {
                      ...encounterInput.storyContext,
                      userPrompt: `${encounterInput.storyContext.userPrompt || ''}\n\nCRITICAL ENCOUNTER FIXES REQUIRED:\n${issueDescriptions}\n\nEnsure the encounter has ${!encounterValidation.hasVictoryPath ? 'a clear victory path, ' : ''}${!encounterValidation.hasDefeatPath ? 'a clear defeat path, ' : ''}proper skill checks, and complete outcome branches.${collisionGuidance}${templateGuidance}`,
                    },
                  };

                  try {
                    const regenEncounterResult = await withTimeout(
                      this.deps.encounterArchitect.execute(regenEncounterInput, playerRelationships, allNpcInfos),
                      PIPELINE_TIMEOUTS.encounterAgent,
                      `EncounterArchitect.execute(${sceneBlueprint.id} regen-${encounterRegenAttempt})`
                    );

                    if (!regenEncounterResult.success || !regenEncounterResult.data) {
                      context.emit({
                        type: 'warning',
                        phase: 'encounters',
                        message: `Encounter regeneration failed for ${sceneBlueprint.id}, keeping original`,
                      });
                      break;
                    }

                    const regenValidation = this.deps.incrementalValidator!.validators.encounter.validateEncounter(regenEncounterResult.data);
                    const regenCollisions = this.deps.getPhase4DefaultCollisions(regenEncounterResult.metadata);
                    const regenTemplateHits = scanEncounterTemplateProse(regenEncounterResult.data);

                    if (regenValidation.passed ||
                        regenValidation.issues.length < encounterValidation.issues.length ||
                        regenCollisions.length < phase4Collisions.length ||
                        regenTemplateHits.length < templateHits.length) {
                      encounters.set(sceneBlueprint.id, regenEncounterResult.data);
                      this.deps.captureEncounterTelemetry(regenEncounterResult.metadata, sceneBlueprint.id);
                      // overallPassed is driven only by the real validator —
                      // collisions never flip a passing scene to failed.
                      const valIdx = this.deps.sceneValidationResults.findIndex(v =>
                        v.sceneId === sceneBlueprint.id && (v.episodeNumber === undefined || v.episodeNumber === brief.episode.number)
                      );
                      let updatedSceneValidation: SceneValidationResult | undefined;
                      if (valIdx !== -1) {
                        updatedSceneValidation = {
                          ...this.deps.sceneValidationResults[valIdx],
                          encounter: regenValidation,
                          overallPassed: regenValidation.passed,
                          regenerationRequested: regenValidation.passed ? 'none' : 'encounter',
                        };
                        this.deps.sceneValidationResults[valIdx] = updatedSceneValidation;
                      }
                      if (updatedSceneValidation) {
                        this.deps.recordSceneValidationResult(updatedSceneValidation);
                      }
                      context.emit({
                        type: 'debug',
                        phase: 'encounters',
                        message: `Encounter ${sceneBlueprint.id} regenerated (issues: ${encounterValidation.issues.length} -> ${regenValidation.issues.length}, collisions: ${phase4Collisions.length} -> ${regenCollisions.length}, template hits: ${templateHits.length} -> ${regenTemplateHits.length})`,
                      });
                      phase4Collisions = regenCollisions;
                      templateHits = regenTemplateHits;
                      // Stop only once it passes, is collision-free, AND carries
                      // zero template prose (no-boilerplate mandate).
                      if (regenValidation.passed && phase4Collisions.length === 0 && templateHits.length === 0) { encounterAccepted = true; break; }
                      Object.assign(encounterValidation, regenValidation);
                    } else {
                      context.emit({
                        type: 'debug',
                        phase: 'encounters',
                        message: `Encounter ${sceneBlueprint.id} regen attempt ${encounterRegenAttempt} did not improve, keeping previous`,
                      });
                    }
                  } catch (regenErr) {
                    context.emit({
                      type: 'warning',
                      phase: 'encounters',
                      message: `Encounter regeneration threw for ${sceneBlueprint.id}: ${regenErr instanceof Error ? regenErr.message : String(regenErr)}`,
                    });
                    break;
                  }
                }
                // S3: record terminal outcome (passed+collision-free => succeeded).
                await this.deps.recordRemediationSafe({
                  rule: 'encounter_regeneration', scope: 'encounter', attempted: encounterRegenAttempt,
                  succeeded: encounterAccepted, degraded: !encounterAccepted, blocked: false, attempts: encounterRegenAttempt,
                  storyId: idSlugify(brief.story.title),
                  details: encounterAccepted
                    ? `Encounter ${sceneBlueprint.id} regenerated; passed`
                    : `Encounter ${sceneBlueprint.id} regen exhausted; kept best available`,
                });
              }

              // NO-BOILERPLATE MANDATE: an encounter with template prose may
              // never ship. If regeneration exhausted (or never ran — budget
              // dry / regen disabled) with signatures still present, fail the
              // EPISODE here at generation time. Shipping it would guarantee a
              // run-level abort at the final contract's template-collapse gate
              // after every remaining episode had been paid for. Validation
              // ISSUES without template prose keep the existing ship-with-
              // advisory behavior — only boilerplate is a hard no-ship.
              if (templateHits.length > 0) {
                throw new PipelineError(
                  `Encounter ${sceneBlueprint.id} still contains template prose after regeneration (${templateHits.slice(0, 3).map(t => `"${t.slice(0, 40)}…"`).join(', ')}). Template prose must never ship — failing at generation time.`,
                  'encounters',
                  {
                    agent: 'EncounterArchitect',
                    context: {
                      sceneId: sceneBlueprint.id,
                      sceneName: sceneBlueprint.name,
                      encounterType: sceneBlueprint.encounterType,
                      failureKind: 'content',
                      templateSignatures: templateHits,
                    },
                  }
                );
              }
            }
          }
        }
        contentWorkCompleted += 1;
        this.deps.emitPhaseProgress(
          'content',
          contentWorkCompleted,
          contentWorkTotal,
          'content:work',
          `Encounter pass complete for ${sceneBlueprint.id}`
        );
      }
      const completedScene = sceneContents.find((sc) => sc.sceneId === sceneBlueprint.id);
      if (completedScene) {
        this.deps.repairSceneEpisodePlayableContract(
          sceneBlueprint,
          completedScene,
          choiceSets,
          { phase: episodeNumber ? `episode_${episodeNumber}_micro_episode_repair` : 'micro_episode_repair' }
        );
      }
      if (completedScene && outputDirectory && episodeNumber) {
        await this.deps.saveResumeUnit(outputDirectory, sceneUnitId, sceneCheckpointPath, completedScene);
        const completedChoice = choiceSets.find((cs) =>
          completedScene.beats.some((beat) => beat.id === cs.beatId)
        );
        if (completedChoice) {
          await this.deps.saveResumeUnit(outputDirectory, choiceUnitId, choiceCheckpointPath, completedChoice);
        }
        const completedEncounter = encounters.get(sceneBlueprint.id);
        if (completedEncounter) {
          await this.deps.saveResumeUnit(outputDirectory, encounterUnitId, encounterCheckpointPath, completedEncounter);
        }
      }
      finalizedScenes.add(sceneBlueprint.id);
    }

    // Emit aggregated validation summary
    if (this.deps.incrementalValidator && this.deps.sceneValidationResults.length > 0) {
      const aggregated = aggregateValidationResults(this.deps.sceneValidationResults);
      context.emit({
        type: 'validation_aggregated',
        phase: 'incremental_validation',
        message: `Incremental validation complete: ${aggregated.passedScenes}/${aggregated.totalScenes} scenes passed`,
        data: aggregated,
      });
    }

    // Summary of content generation
    const totalChoices = choiceSets.reduce((sum, cs) => sum + cs.choices.length, 0);
    const totalEncounters = encounters.size;
    context.emit({ 
      type: 'phase_complete', 
      phase: 'content', 
      message: `Content complete: ${sceneContents.length} scenes, ${choiceSets.length} choice sets, ${totalChoices} choices, ${totalEncounters} encounters` 
    });
    if (totalChoices === 0 && totalEncounters === 0) {
      console.error(`[Pipeline] CRITICAL: No choices or encounters were generated! This will result in a non-interactive story.`);
    }
    // Gate on isEncounter alone — encounterType should have been normalized above,
    // but we never want the safety check to use a narrower filter than the generation gate.
    const expectedEncounterSceneIds = blueprint.scenes
      .filter((scene) => scene.isEncounter)
      .map((scene) => scene.id);
    const missingEncounterSceneIds = expectedEncounterSceneIds.filter((sceneId) => !encounters.has(sceneId));
    if (missingEncounterSceneIds.length > 0) {
      throw new PipelineError(
        `Encounter scenes missing concrete encounter content: ${missingEncounterSceneIds.join(', ')}. ` +
        `This usually means encounterType was missing and the scene was processed by SceneWriter instead of EncounterArchitect.`,
        'encounters',
        {
          context: {
            expectedEncounterSceneIds,
            missingEncounterSceneIds,
            failureKind: 'content',
          },
        }
      );
    }
    this.deps.assertSceneDependencyInvariants(blueprint, sceneContents);

    await this.deps.runSceneCriticPass(sceneContents, characterBible);

    return { sceneContents, choiceSets, encounters };
  }

  private pruneUnscopedTreatmentSeedBeats(sceneBlueprint: SceneBlueprint): void {
    const seedFlags = resolveSceneTreatmentSeeds(sceneBlueprint);
    if (seedFlags.length === 0) return;

    const existing = sceneBlueprint.requiredBeats ?? [];
    const allowedSeedIds = new Set(seedFlags);
    const scopedExisting = existing.filter((beat) => {
      if (beat.tier !== 'seed') return true;
      const beatId = String(beat.id || '');
      return Array.from(allowedSeedIds).some((flag) => beatId.includes(flag));
    });
    if (scopedExisting.length !== existing.length) {
      sceneBlueprint.requiredBeats = scopedExisting;
    }
  }

  private alignMandatoryOpeningBeatContext(sceneBlueprint: SceneBlueprint): void {
    const coldOpen = (sceneBlueprint.requiredBeats ?? [])
      .find((beat) => beat.tier === 'coldopen' && beat.mustDepict?.trim())
      ?.mustDepict
      ?.trim();
    if (!coldOpen) return;

    const directive = `Open with this cold-open moment before the scene's main pressure, then transition into the planned scene: ${coldOpen}`;
    const alreadyAligned = (text?: string): boolean =>
      Boolean(text && (text.includes(coldOpen) || text.includes('Open with this cold-open moment')));

    sceneBlueprint.keyBeats = Array.isArray(sceneBlueprint.keyBeats) ? sceneBlueprint.keyBeats : [];
    if (!sceneBlueprint.keyBeats.some((beat) => alreadyAligned(beat))) {
      sceneBlueprint.keyBeats.unshift(directive);
    }

    if (!alreadyAligned(sceneBlueprint.description)) {
      sceneBlueprint.description = `Cold-open prelude: ${coldOpen}\n\nThen continue into the planned scene: ${sceneBlueprint.description || sceneBlueprint.name}`;
    }

    if (!alreadyAligned(sceneBlueprint.narrativeFunction)) {
      sceneBlueprint.narrativeFunction = `Open on the required cold-open prelude, then fulfill the planned scene function: ${sceneBlueprint.narrativeFunction || sceneBlueprint.description || sceneBlueprint.name}`;
    }
  }
}
